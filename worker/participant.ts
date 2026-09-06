import type {
  AbandonAttemptResponse,
  AttemptStateDTO,
  CreateAttemptResponse,
  ParticipantResultDTO,
  PublicAssessmentDTO,
  PublicQuestionDTO,
  ResolvedPublicationDTO,
  SaveAnswerResponse,
  SubmitAttemptResponse,
} from "../shared/contracts";
import type { AnswerValue, AssessmentQuestion } from "../shared/domain";
import { calculateScore } from "../shared/scoring";
import { answerValueSchema, createAttemptSchema, resolvePublicationSchema } from "../shared/validation";
import { jsonResponse, methodNotAllowed, problemResponse, readJsonBody } from "./http";
import { secretDigest, signAttemptToken, verifyAttemptToken } from "./participant-security";
import { accessCredentialDigest, verifyTurnstile } from "./turnstile";

interface PublicationRow {
  publication_id: string;
  assessment_version_id: string;
  status: "published" | "closed" | "archived";
  access_mode: "open" | "controlled";
  open_repeat_policy: "unlimited" | "best_effort_once" | null;
  show_participant_result: number;
  opens_at: number | null;
  closes_at: number | null;
  title: string;
  description: string;
  duration_seconds: number | null;
}

interface AttemptRow extends PublicationRow {
  attempt_id: string;
  invitation_id: string | null;
  display_name: string;
  attempt_status: "active" | "submitted" | "expired";
  token_version: number;
  started_at: number;
  deadline_at: number | null;
  submitted_at: number | null;
  completion_reason: "submitted" | "deadline" | "abandoned" | null;
}

interface QuestionRow {
  id: string;
  type: "single_choice" | "multiple_choice" | "rating";
  text: string;
  position: number;
  is_required: number;
  is_scored: number;
  points: number;
  scale_min: number | null;
  scale_max: number | null;
  scale_min_label: string | null;
  scale_max_label: string | null;
}

interface OptionRow {
  id: string;
  question_id: string;
  text: string;
  position: number;
  is_correct: number;
}

const participantBodyLimit = 16_384;

function entityId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function validationProblem(requestId: string, title = "Проверьте данные участника"): Response {
  return problemResponse({ code: "validation_failed", requestId, status: 422, title });
}

function accessWindowProblem(row: PublicationRow, requestId: string, now = Date.now()): Response | null {
  if (row.status !== "published") {
    return problemResponse({ code: "assessment_closed", requestId, status: 410, title: "Тест завершён" });
  }
  if (row.opens_at !== null && row.opens_at > now) {
    return problemResponse({ code: "access_expired", requestId, status: 410, title: "Тест ещё не открыт" });
  }
  if (row.closes_at !== null && row.closes_at <= now) {
    return problemResponse({ code: "access_expired", requestId, status: 410, title: "Срок доступа истёк" });
  }
  return null;
}

async function enforceRateLimit(env: Env, key: string, requestId: string): Promise<Response | null> {
  const outcome = await env.PARTICIPANT_RATE_LIMITER.limit({ key });
  if (outcome.success) return null;
  return problemResponse({
    code: "rate_limited",
    detail: "Слишком много запросов. Повторите через минуту.",
    headers: { "Retry-After": "60" },
    requestId,
    status: 429,
    title: "Слишком много попыток",
  });
}

async function publicationByCode(env: Env, code: string): Promise<PublicationRow | null> {
  const digest = await accessCredentialDigest(env, "code", code);
  return env.DB.prepare(
    `SELECT p.id AS publication_id, p.assessment_version_id, p.status, p.access_mode,
            p.open_repeat_policy, p.show_participant_result, p.opens_at, p.closes_at,
            av.title, av.description, av.duration_seconds
     FROM publications p
     JOIN assessment_versions av ON av.id = p.assessment_version_id
     WHERE p.code_digest = ?1 AND p.access_mode = 'open'`,
  ).bind(digest).first<PublicationRow>();
}

async function publicationByInvitation(
  env: Env,
  token: string,
): Promise<{ publication: PublicationRow; invitationId: string; invitationStatus: string; invitationExpiresAt: number | null } | null> {
  const digest = await accessCredentialDigest(env, "invitation", token);
  const row = await env.DB.prepare(
    `SELECT p.id AS publication_id, p.assessment_version_id, p.status, p.access_mode,
            p.open_repeat_policy, p.show_participant_result, p.opens_at, p.closes_at,
            av.title, av.description, av.duration_seconds,
            i.id AS invitation_id, i.status AS invitation_status, i.expires_at AS invitation_expires_at
     FROM participant_invitations i
     JOIN publications p ON p.id = i.publication_id
     JOIN assessment_versions av ON av.id = p.assessment_version_id
     WHERE i.token_digest = ?1 AND p.access_mode = 'controlled'`,
  ).bind(digest).first<PublicationRow & { invitation_id: string; invitation_status: string; invitation_expires_at: number | null }>();
  return row ? {
    publication: row,
    invitationId: row.invitation_id,
    invitationStatus: row.invitation_status,
    invitationExpiresAt: row.invitation_expires_at,
  } : null;
}

async function loadQuestions(db: D1Database, versionId: string): Promise<AssessmentQuestion[]> {
  const [questionResult, optionResult] = await Promise.all([
    db.prepare(
      `SELECT id, type, text, position, is_required, is_scored, points,
              scale_min, scale_max, scale_min_label, scale_max_label
       FROM questions WHERE assessment_version_id = ?1 ORDER BY position`,
    ).bind(versionId).all<QuestionRow>(),
    db.prepare(
      `SELECT qo.id, qo.question_id, qo.text, qo.position, qo.is_correct
       FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       WHERE q.assessment_version_id = ?1
       ORDER BY q.position, qo.position`,
    ).bind(versionId).all<OptionRow>(),
  ]);
  const optionsByQuestion = new Map<string, OptionRow[]>();
  for (const option of optionResult.results) {
    const options = optionsByQuestion.get(option.question_id) ?? [];
    options.push(option);
    optionsByQuestion.set(option.question_id, options);
  }
  return questionResult.results.map((question): AssessmentQuestion => {
    const base = {
      id: question.id,
      text: question.text,
      position: question.position,
      required: question.is_required === 1,
    };
    if (question.type === "rating") {
      return {
        ...base,
        type: "rating",
        scored: false,
        points: 0,
        scaleMin: question.scale_min ?? 1,
        scaleMax: question.scale_max ?? 5,
        ...(question.scale_min_label ? { scaleMinLabel: question.scale_min_label } : {}),
        ...(question.scale_max_label ? { scaleMaxLabel: question.scale_max_label } : {}),
      };
    }
    return {
      ...base,
      type: question.type,
      scored: question.is_scored === 1,
      points: question.points,
      options: (optionsByQuestion.get(question.id) ?? []).map((option) => ({
        id: option.id,
        text: option.text,
        position: option.position,
        isCorrect: option.is_correct === 1,
      })),
    };
  });
}

function publicQuestion(question: AssessmentQuestion): PublicQuestionDTO {
  const base = { id: question.id, text: question.text, position: question.position, required: question.required };
  if (question.type === "rating") {
    return {
      ...base,
      type: "rating",
      scaleMin: question.scaleMin,
      scaleMax: question.scaleMax,
      ...(question.scaleMinLabel ? { scaleMinLabel: question.scaleMinLabel } : {}),
      ...(question.scaleMaxLabel ? { scaleMaxLabel: question.scaleMaxLabel } : {}),
    };
  }
  return {
    ...base,
    type: question.type,
    options: question.options.map(({ id, text, position }) => ({ id, text, position })),
  };
}

async function publicAssessment(db: D1Database, row: PublicationRow, questions?: AssessmentQuestion[]): Promise<PublicAssessmentDTO> {
  const source = questions ?? await loadQuestions(db, row.assessment_version_id);
  return {
    publicationId: row.publication_id,
    title: row.title,
    description: row.description,
    durationSeconds: row.duration_seconds,
    accessMode: row.access_mode,
    questions: source.map(publicQuestion),
  };
}

async function loadAnswers(db: D1Database, attemptId: string, questions: readonly AssessmentQuestion[]): Promise<Record<string, AnswerValue>> {
  const result = await db.prepare(
    `SELECT a.question_id, a.value_kind, a.rating_value, ao.option_id
     FROM answers a
     LEFT JOIN answer_options ao ON ao.answer_id = a.id
     WHERE a.attempt_id = ?1
     ORDER BY ao.option_id`,
  ).bind(attemptId).all<{ question_id: string; value_kind: "choice" | "rating" | "empty"; rating_value: number | null; option_id: string | null }>();
  const questionTypes = new Map(questions.map((question) => [question.id, question.type]));
  const answers: Record<string, AnswerValue> = {};
  for (const row of result.results) {
    if (row.value_kind === "empty") answers[row.question_id] = null;
    else if (row.value_kind === "rating") answers[row.question_id] = row.rating_value;
    else if (row.option_id) {
      const existing = answers[row.question_id];
      const options = Array.isArray(existing) ? existing : [];
      options.push(row.option_id);
      answers[row.question_id] = options;
    }
  }
  for (const [questionId, value] of Object.entries(answers)) {
    if (questionTypes.get(questionId) === "single_choice" && Array.isArray(value)) answers[questionId] = value[0] ?? null;
  }
  return answers;
}

async function loadResult(db: D1Database, row: AttemptRow): Promise<ParticipantResultDTO | null> {
  if (row.attempt_status === "active") return null;
  const result = await db.prepare("SELECT score, max_score FROM results WHERE attempt_id = ?1").bind(row.attempt_id).first<{ score: number; max_score: number }>();
  if (!result || row.show_participant_result !== 1) return { completed: true, resultVisible: false };
  return { completed: true, resultVisible: true, score: result.score, maxScore: result.max_score };
}

async function finalizeDeadline(env: Env, row: AttemptRow, now: number): Promise<AttemptRow> {
  const questions = await loadQuestions(env.DB, row.assessment_version_id);
  const answers = await loadAnswers(env.DB, row.attempt_id, questions);
  const score = calculateScore(questions, answers);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE attempts SET status = 'expired', completion_reason = 'deadline', updated_at = ?1
       WHERE id = ?2 AND status = 'active' AND deadline_at IS NOT NULL AND deadline_at <= ?1`,
    ).bind(now, row.attempt_id),
    env.DB.prepare(
      `INSERT OR IGNORE INTO results (attempt_id, score, max_score, calculated_at)
       SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (
         SELECT 1 FROM attempts WHERE id = ?1 AND status = 'expired' AND completion_reason = 'deadline'
       )`,
    ).bind(row.attempt_id, score.score, score.maxScore, now),
    env.DB.prepare(
      `UPDATE participant_invitations SET status = 'expired', used_at = ?1
       WHERE id = ?2 AND EXISTS (
         SELECT 1 FROM attempts WHERE id = ?3 AND status = 'expired' AND completion_reason = 'deadline'
       )`,
    ).bind(now, row.invitation_id, row.attempt_id),
  ]);
  return { ...row, attempt_status: "expired", completion_reason: "deadline" };
}

async function authenticatedAttempt(request: Request, env: Env, routeAttemptId: string): Promise<AttemptRow | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const claims = await verifyAttemptToken(env, token);
  if (!claims || claims.attemptId !== routeAttemptId) return null;
  const row = await env.DB.prepare(
    `SELECT att.id AS attempt_id, att.invitation_id, att.display_name,
            att.status AS attempt_status, att.token_version, att.started_at,
            att.deadline_at, att.submitted_at, att.completion_reason,
            p.id AS publication_id, p.assessment_version_id, p.status, p.access_mode,
            p.open_repeat_policy, p.show_participant_result, p.opens_at, p.closes_at,
            av.title, av.description, av.duration_seconds
     FROM attempts att
     JOIN publications p ON p.id = att.publication_id
     JOIN assessment_versions av ON av.id = att.assessment_version_id
     WHERE att.id = ?1`,
  ).bind(routeAttemptId).first<AttemptRow>();
  if (!row || row.token_version !== claims.tokenVersion) return null;
  if (row.attempt_status === "active" && row.deadline_at !== null && row.deadline_at <= Date.now()) {
    return finalizeDeadline(env, row, Date.now());
  }
  return row;
}

async function attemptResponse(env: Env, row: AttemptRow): Promise<CreateAttemptResponse> {
  return {
    attemptId: row.attempt_id,
    attemptToken: await signAttemptToken(env, row.attempt_id, row.token_version, row.deadline_at),
    deadlineAt: row.deadline_at,
    showParticipantResult: row.show_participant_result === 1,
    assessment: await publicAssessment(env.DB, row),
  };
}

async function publicConfigRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  return jsonResponse({ turnstileSitekey: env.TURNSTILE_SITEKEY }, requestId);
}

async function resolveRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const body = await readJsonBody(request, requestId, participantBodyLimit);
  if (body instanceof Response) return body;
  const parsed = resolvePublicationSchema.safeParse(body);
  if (!parsed.success) return validationProblem(requestId, "Некорректный код теста");
  const rateKey = await secretDigest(env, "rate:resolve", parsed.data.code);
  const limited = await enforceRateLimit(env, rateKey, requestId);
  if (limited) return limited;
  const row = await publicationByCode(env, parsed.data.code);
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Код не найден" });
  const windowProblem = accessWindowProblem(row, requestId);
  if (windowProblem) return windowProblem;
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM questions WHERE assessment_version_id = ?1").bind(row.assessment_version_id).first<{ count: number }>();
  const response: ResolvedPublicationDTO = {
    publicationId: row.publication_id,
    title: row.title,
    description: row.description,
    durationSeconds: row.duration_seconds,
    accessMode: row.access_mode,
    questionCount: count?.count ?? 0,
    showParticipantResult: row.show_participant_result === 1,
  };
  return jsonResponse(response, requestId);
}

async function createAttemptRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const body = await readJsonBody(request, requestId, participantBodyLimit);
  if (body instanceof Response) return body;
  const parsed = createAttemptSchema.safeParse(body);
  if (!parsed.success) return validationProblem(requestId);
  const input = parsed.data;
  const accessKey = input.code ?? input.invitationToken ?? "";
  const rateKey = await secretDigest(env, "rate:create-attempt", `${input.participantIdentity ?? "controlled"}:${accessKey}`);
  const limited = await enforceRateLimit(env, rateKey, requestId);
  if (limited) return limited;
  const turnstile = await verifyTurnstile(request, env, input.turnstileToken, "attempt_start");
  if (!turnstile.ok) {
    return problemResponse({
      code: "turnstile_failed",
      requestId,
      status: turnstile.reason === "unavailable" ? 502 : 403,
      title: turnstile.reason === "unavailable" ? "Проверка защиты временно недоступна" : "Проверка защиты не пройдена",
    });
  }

  let publication: PublicationRow;
  let invitationId: string | null = null;
  if (input.code) {
    const resolved = await publicationByCode(env, input.code);
    if (!resolved) return problemResponse({ code: "not_found", requestId, status: 404, title: "Код не найден" });
    publication = resolved;
  } else {
    const resolved = await publicationByInvitation(env, input.invitationToken ?? "");
    if (!resolved) return problemResponse({ code: "not_found", requestId, status: 404, title: "Приглашение не найдено" });
    if (resolved.invitationStatus !== "active" || (resolved.invitationExpiresAt !== null && resolved.invitationExpiresAt <= Date.now())) {
      return problemResponse({ code: "attempt_already_used", requestId, status: 409, title: "Приглашение уже использовано" });
    }
    publication = resolved.publication;
    invitationId = resolved.invitationId;
  }
  const windowProblem = accessWindowProblem(publication, requestId);
  if (windowProblem) return windowProblem;

  const identityDigest = publication.access_mode === "open" && publication.open_repeat_policy === "best_effort_once"
    ? await secretDigest(env, "participant-identity", `${publication.publication_id}:${input.participantIdentity}`)
    : null;
  const existing = await env.DB.prepare(
    `SELECT id FROM attempts
     WHERE publication_id = ?1 AND (
       (?2 IS NOT NULL AND participant_identity_digest = ?2) OR
       (?3 IS NOT NULL AND invitation_id = ?3)
     ) LIMIT 1`,
  ).bind(publication.publication_id, identityDigest, invitationId).first<{ id: string }>();
  if (existing) {
    const row = await env.DB.prepare(
      `SELECT att.id AS attempt_id, att.invitation_id, att.display_name,
              att.status AS attempt_status, att.token_version, att.started_at,
              att.deadline_at, att.submitted_at, att.completion_reason,
              p.id AS publication_id, p.assessment_version_id, p.status, p.access_mode,
              p.open_repeat_policy, p.show_participant_result, p.opens_at, p.closes_at,
              av.title, av.description, av.duration_seconds
       FROM attempts att JOIN publications p ON p.id = att.publication_id
       JOIN assessment_versions av ON av.id = att.assessment_version_id WHERE att.id = ?1`,
    ).bind(existing.id).first<AttemptRow>();
    if (row?.attempt_status === "active" && (row.deadline_at === null || row.deadline_at > Date.now())) {
      return jsonResponse(await attemptResponse(env, row), requestId);
    }
    return problemResponse({ code: "attempt_already_used", requestId, status: 409, title: "Попытка уже использована" });
  }

  const now = Date.now();
  const attemptId = entityId("attempt");
  const deadlineAt = publication.duration_seconds === null ? null : now + publication.duration_seconds * 1_000;
  const inserted = await env.DB.prepare(
    `INSERT INTO attempts
     (id, publication_id, assessment_version_id, invitation_id, access_mode,
      participant_identity_digest, display_name, status, token_version,
      started_at, deadline_at, submitted_at, updated_at, completion_reason)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', 1, ?8, ?9, NULL, ?8, NULL
     WHERE EXISTS (SELECT 1 FROM publications WHERE id = ?2 AND status = 'published')`
  ).bind(attemptId, publication.publication_id, publication.assessment_version_id, invitationId, publication.access_mode, identityDigest, input.displayName, now, deadlineAt).run();
  if (inserted.meta.changes !== 1) return problemResponse({ code: "assessment_closed", requestId, status: 410, title: "Тест завершён" });
  const row: AttemptRow = {
    ...publication,
    attempt_id: attemptId,
    invitation_id: invitationId,
    display_name: input.displayName,
    attempt_status: "active",
    token_version: 1,
    started_at: now,
    deadline_at: deadlineAt,
    submitted_at: null,
    completion_reason: null,
  };
  return jsonResponse(await attemptResponse(env, row), requestId, { status: 201 });
}

async function getAttemptRoute(request: Request, env: Env, requestId: string, attemptId: string): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  const row = await authenticatedAttempt(request, env, attemptId);
  if (!row) return problemResponse({ code: "unauthorized", requestId, status: 401, title: "Сессия попытки недействительна" });
  const questions = await loadQuestions(env.DB, row.assessment_version_id);
  const response: AttemptStateDTO = {
    attemptId,
    displayName: row.display_name,
    status: row.attempt_status,
    deadlineAt: row.deadline_at,
    showParticipantResult: row.show_participant_result === 1,
    assessment: await publicAssessment(env.DB, row, questions),
    answers: await loadAnswers(env.DB, attemptId, questions),
    result: await loadResult(env.DB, row),
  };
  return jsonResponse(response, requestId);
}

async function saveAnswerRoute(
  request: Request,
  env: Env,
  requestId: string,
  attemptId: string,
  questionId: string,
): Promise<Response> {
  if (request.method !== "PUT") return methodNotAllowed(requestId, ["PUT"]);
  const row = await authenticatedAttempt(request, env, attemptId);
  if (!row) return problemResponse({ code: "unauthorized", requestId, status: 401, title: "Сессия попытки недействительна" });
  if (row.attempt_status !== "active") return problemResponse({ code: "attempt_expired", requestId, status: 410, title: "Попытка завершена" });
  const body = await readJsonBody(request, requestId, participantBodyLimit);
  if (body instanceof Response) return body;
  if (typeof body !== "object" || body === null || !("value" in body)) return validationProblem(requestId, "Некорректный ответ");
  const parsed = answerValueSchema.safeParse(body.value);
  if (!parsed.success) return validationProblem(requestId, "Некорректный ответ");
  const value = parsed.data;
  const question = await env.DB.prepare(
    `SELECT id, type, is_required, scale_min, scale_max
     FROM questions WHERE id = ?1 AND assessment_version_id = ?2`,
  ).bind(questionId, row.assessment_version_id).first<{ id: string; type: string; is_required: number; scale_min: number | null; scale_max: number | null }>();
  if (!question) return problemResponse({ code: "not_found", requestId, status: 404, title: "Вопрос не найден" });
  if (value === null && question.is_required === 1) return validationProblem(requestId, "Обязательный ответ нельзя очистить");

  let optionIds: string[] = [];
  let ratingValue: number | null = null;
  let valueKind: "choice" | "rating" | "empty" = "empty";
  if (value !== null && question.type === "rating") {
    if (typeof value !== "number" || question.scale_min === null || question.scale_max === null || value < question.scale_min || value > question.scale_max) return validationProblem(requestId, "Оценка находится вне шкалы");
    valueKind = "rating";
    ratingValue = value;
  } else if (value !== null && question.type === "single_choice") {
    if (typeof value !== "string") return validationProblem(requestId, "Выберите один вариант");
    valueKind = "choice";
    optionIds = [value];
  } else if (value !== null && question.type === "multiple_choice") {
    if (!Array.isArray(value) || value.length === 0) return validationProblem(requestId, "Выберите хотя бы один вариант");
    valueKind = "choice";
    optionIds = value;
  } else if (value !== null) return validationProblem(requestId, "Тип ответа не соответствует вопросу");

  if (optionIds.length > 0) {
    const placeholders = optionIds.map((_, index) => `?${index + 2}`).join(", ");
    const valid = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM question_options WHERE question_id = ?1 AND id IN (${placeholders})`,
    ).bind(questionId, ...optionIds).first<{ count: number }>();
    if (valid?.count !== optionIds.length) return validationProblem(requestId, "Вариант не принадлежит вопросу");
  }

  const existing = await env.DB.prepare("SELECT id FROM answers WHERE attempt_id = ?1 AND question_id = ?2").bind(attemptId, questionId).first<{ id: string }>();
  const answerId = existing?.id ?? entityId("answer");
  const savedAt = Date.now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO answers (id, attempt_id, question_id, value_kind, rating_value, answered_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET
         value_kind = excluded.value_kind, rating_value = excluded.rating_value, answered_at = excluded.answered_at`,
    ).bind(answerId, attemptId, questionId, valueKind, ratingValue, savedAt),
    env.DB.prepare("DELETE FROM answer_options WHERE answer_id = ?1").bind(answerId),
    ...optionIds.map((optionId) => env.DB.prepare("INSERT INTO answer_options (answer_id, option_id) VALUES (?1, ?2)").bind(answerId, optionId)),
    env.DB.prepare("UPDATE attempts SET updated_at = ?1 WHERE id = ?2 AND status = 'active'").bind(savedAt, attemptId),
  ];
  await env.DB.batch(statements);
  const response: SaveAnswerResponse = { attemptId, questionId, savedAt };
  return jsonResponse(response, requestId);
}

async function submitRoute(request: Request, env: Env, requestId: string, attemptId: string): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const row = await authenticatedAttempt(request, env, attemptId);
  if (!row) return problemResponse({ code: "unauthorized", requestId, status: 401, title: "Сессия попытки недействительна" });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) return problemResponse({ code: "bad_request", requestId, status: 400, title: "Не указан Idempotency-Key" });
  const scope = `submit:${attemptId}`;
  const keyDigest = await secretDigest(env, "idempotency", idempotencyKey);
  const requestHash = await secretDigest(env, "submit-request", attemptId);
  const replay = await env.DB.prepare("SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE scope = ?1 AND key_digest = ?2 AND expires_at > ?3").bind(scope, keyDigest, Date.now()).first<{ request_hash: string; response_status: number; response_body: string }>();
  if (replay) {
    if (replay.request_hash !== requestHash) return problemResponse({ code: "idempotency_conflict", requestId, status: 409, title: "Ключ уже использован" });
    return jsonResponse(JSON.parse(replay.response_body) as unknown, requestId, { status: replay.response_status, headers: { "X-Idempotent-Replay": "true" } });
  }
  if (row.attempt_status !== "active") return problemResponse({ code: "attempt_already_used", requestId, status: 409, title: "Попытка уже завершена" });
  const questions = await loadQuestions(env.DB, row.assessment_version_id);
  const answers = await loadAnswers(env.DB, attemptId, questions);
  if (questions.some((question) => question.required && (answers[question.id] === null || answers[question.id] === undefined))) {
    return validationProblem(requestId, "Ответьте на обязательные вопросы");
  }
  const score = calculateScore(questions, answers);
  const submittedAt = Date.now();
  const participantResult: ParticipantResultDTO = row.show_participant_result === 1
    ? { completed: true, resultVisible: true, score: score.score, maxScore: score.maxScore }
    : { completed: true, resultVisible: false };
  const response: SubmitAttemptResponse = { attemptId, submittedAt, result: participantResult };
  const responseBody = JSON.stringify(response);
  const batch = await env.DB.batch([
    env.DB.prepare(
      `UPDATE attempts SET status = 'submitted', submitted_at = ?1, updated_at = ?1, completion_reason = 'submitted'
       WHERE id = ?2 AND status = 'active' AND (deadline_at IS NULL OR deadline_at > ?1)`,
    ).bind(submittedAt, attemptId),
    env.DB.prepare(
      `INSERT INTO results (attempt_id, score, max_score, calculated_at)
       SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (
         SELECT 1 FROM attempts WHERE id = ?1 AND status = 'submitted' AND submitted_at = ?4
       )`,
    ).bind(attemptId, score.score, score.maxScore, submittedAt),
    env.DB.prepare(
      `UPDATE participant_invitations SET status = 'used', used_at = ?1
       WHERE id = ?2 AND EXISTS (SELECT 1 FROM attempts WHERE id = ?3 AND status = 'submitted')`,
    ).bind(submittedAt, row.invitation_id, attemptId),
    env.DB.prepare(
      `INSERT INTO idempotency_keys
       (id, scope, key_digest, request_hash, response_status, response_body, created_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, 200, ?5, ?6, ?7 WHERE EXISTS (
         SELECT 1 FROM attempts WHERE id = ?8 AND status = 'submitted' AND submitted_at = ?6
       )`,
    ).bind(entityId("idempotency"), scope, keyDigest, requestHash, responseBody, submittedAt, submittedAt + 7 * 24 * 60 * 60 * 1_000, attemptId),
  ]);
  if (batch[0]?.meta.changes !== 1) return problemResponse({ code: "attempt_expired", requestId, status: 410, title: "Время попытки истекло" });
  return jsonResponse(response, requestId);
}

async function abandonRoute(request: Request, env: Env, requestId: string, attemptId: string): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const row = await authenticatedAttempt(request, env, attemptId);
  if (!row) return problemResponse({ code: "unauthorized", requestId, status: 401, title: "Сессия попытки недействительна" });
  if (row.attempt_status === "active") {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE attempts SET status = 'expired', completion_reason = 'abandoned', token_version = token_version + 1, updated_at = ?1 WHERE id = ?2 AND status = 'active'").bind(now, attemptId),
      env.DB.prepare("UPDATE participant_invitations SET status = 'expired', used_at = ?1 WHERE id = ?2").bind(now, row.invitation_id),
    ]);
  }
  const response: AbandonAttemptResponse = { attemptId, status: "expired", reason: "abandoned" };
  return jsonResponse(response, requestId);
}

export async function routeParticipantApi(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/v1/public/config") return publicConfigRoute(request, env, requestId);
  if (pathname === "/api/v1/publications/resolve") return resolveRoute(request, env, requestId);
  if (pathname === "/api/v1/attempts") return createAttemptRoute(request, env, requestId);
  const attempt = pathname.match(/^\/api\/v1\/attempts\/([^/]+)$/);
  if (attempt?.[1]) return getAttemptRoute(request, env, requestId, decodeURIComponent(attempt[1]));
  const answer = pathname.match(/^\/api\/v1\/attempts\/([^/]+)\/answers\/([^/]+)$/);
  if (answer?.[1] && answer[2]) return saveAnswerRoute(request, env, requestId, decodeURIComponent(answer[1]), decodeURIComponent(answer[2]));
  const submit = pathname.match(/^\/api\/v1\/attempts\/([^/]+)\/submit$/);
  if (submit?.[1]) return submitRoute(request, env, requestId, decodeURIComponent(submit[1]));
  const abandon = pathname.match(/^\/api\/v1\/attempts\/([^/]+)\/abandon$/);
  if (abandon?.[1]) return abandonRoute(request, env, requestId, decodeURIComponent(abandon[1]));
  return null;
}
