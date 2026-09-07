import type {
  AssessmentDraftDTO,
  AssessmentListItemDTO,
  DistributionDTO,
  CreatedInvitationDTO,
  InvitationDTO,
  PublishAssessmentResponse,
} from "../shared/contracts";
import type { AssessmentQuestion } from "../shared/domain";
import {
  createAssessmentSchema,
  createInvitationBatchSchema,
  draftAssessmentSchema,
  editableAssessmentDraftSchema,
  publicationSettingsSchema,
} from "../shared/validation";
import type { z } from "zod";
import { auditStatement } from "./audit";
import { jsonResponse, methodNotAllowed, problemResponse, readJsonBody } from "./http";
import { accessCredentialDigest } from "./turnstile";
import {
  requireOrganizationAccess,
  type AuthorizedSession,
} from "./session";

type EditableDraft = z.infer<typeof editableAssessmentDraftSchema>;

interface AssessmentAccessRow {
  assessment_id: string;
  organization_id: string;
  status: "draft" | "published" | "closed" | "archived";
}

interface DraftRow extends AssessmentAccessRow {
  version_id: string;
  version_number: number;
  revision: number;
  draft_json: string | null;
}

interface PublishedRevisionRow extends AssessmentAccessRow {
  publication_id: string;
  publication_status: "published" | "closed" | "archived";
  version_id: string;
  version_number: number;
  title: string;
  description: string;
  duration_seconds: number | null;
  access_mode: "open" | "controlled";
  open_repeat_policy: "unlimited" | "best_effort_once" | null;
  show_participant_result: number;
  opens_at: number | null;
  closes_at: number | null;
}

interface PublishedQuestionRow {
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

interface PublishedOptionRow {
  id: string;
  question_id: string;
  text: string;
  position: number;
  is_correct: number;
}

const authoringBodyLimit = 262_144;
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function invitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function validationFailure(
  requestId: string,
  error: { flatten(): { fieldErrors: Record<string, string[]> } },
): Response {
  return problemResponse({
    code: "validation_failed",
    fieldErrors: error.flatten().fieldErrors,
    requestId,
    status: 422,
    title: "Проверьте содержимое теста",
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateAccessCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => codeAlphabet[byte & 31]).join("");
}

function parseRevision(request: Request): number | null {
  const value = request.headers.get("if-match")?.trim().replace(/^W\//, "").replaceAll('"', "");
  if (!value || !/^\d+$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

async function assessmentAccess(
  db: D1Database,
  session: AuthorizedSession,
  assessmentId: string,
): Promise<AssessmentAccessRow | null> {
  const assessment = await db
    .prepare(
      `SELECT id AS assessment_id, organization_id, status
       FROM assessments WHERE id = ?1`,
    )
    .bind(assessmentId)
    .first<AssessmentAccessRow>();
  if (assessment) requireOrganizationAccess(session, assessment.organization_id);
  return assessment;
}

async function activeDraft(
  db: D1Database,
  session: AuthorizedSession,
  assessmentId: string,
): Promise<DraftRow | null> {
  const assessment = await assessmentAccess(db, session, assessmentId);
  if (!assessment) return null;
  return db
    .prepare(
      `SELECT a.id AS assessment_id, a.organization_id, a.status,
              av.id AS version_id, av.version_number, av.revision, av.draft_json
       FROM assessments a
       JOIN assessment_versions av ON av.assessment_id = a.id AND av.state = 'draft'
       WHERE a.id = ?1`,
    )
    .bind(assessmentId)
    .first<DraftRow>();
}

function parseStoredDraft(row: DraftRow): EditableDraft {
  if (!row.draft_json) throw new Error("Draft payload is missing");
  const parsed = editableAssessmentDraftSchema.safeParse(JSON.parse(row.draft_json) as unknown);
  if (!parsed.success) throw new Error("Stored draft payload is invalid");
  return parsed.data;
}

function draftDto(row: DraftRow, draft: EditableDraft): AssessmentDraftDTO {
  const questions = draft.questions.map((question) => {
    if (question.type !== "rating") return question;
    const { scaleMinLabel, scaleMaxLabel, ...required } = question;
    return {
      ...required,
      ...(scaleMinLabel === undefined ? {} : { scaleMinLabel }),
      ...(scaleMaxLabel === undefined ? {} : { scaleMaxLabel }),
    };
  });
  return {
    assessmentId: row.assessment_id,
    organizationId: row.organization_id,
    revision: row.revision,
    title: draft.title,
    description: draft.description,
    durationSeconds: draft.durationSeconds,
    questions,
    settings: draft.settings,
  };
}

async function draftFromPublishedSnapshot(
  db: D1Database,
  source: PublishedRevisionRow,
): Promise<EditableDraft> {
  const [questionResult, optionResult] = await Promise.all([
    db.prepare(
      `SELECT id, type, text, position, is_required, is_scored, points,
              scale_min, scale_max, scale_min_label, scale_max_label
       FROM questions WHERE assessment_version_id = ?1 ORDER BY position`,
    ).bind(source.version_id).all<PublishedQuestionRow>(),
    db.prepare(
      `SELECT qo.id, qo.question_id, qo.text, qo.position, qo.is_correct
       FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       WHERE q.assessment_version_id = ?1
       ORDER BY q.position, qo.position`,
    ).bind(source.version_id).all<PublishedOptionRow>(),
  ]);
  const optionsByQuestion = new Map<string, PublishedOptionRow[]>();
  for (const option of optionResult.results) {
    const options = optionsByQuestion.get(option.question_id) ?? [];
    options.push(option);
    optionsByQuestion.set(option.question_id, options);
  }
  const questions: AssessmentQuestion[] = questionResult.results.map((question) => {
    const questionId = id("question");
    const base = {
      id: questionId,
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
        ...(question.scale_min_label === null ? {} : { scaleMinLabel: question.scale_min_label }),
        ...(question.scale_max_label === null ? {} : { scaleMaxLabel: question.scale_max_label }),
      };
    }
    return {
      ...base,
      type: question.type,
      scored: question.is_scored === 1,
      points: question.points,
      options: (optionsByQuestion.get(question.id) ?? []).map((option) => ({
        id: id("option"),
        text: option.text,
        position: option.position,
        isCorrect: option.is_correct === 1,
      })),
    };
  });
  return editableAssessmentDraftSchema.parse({
    title: source.title,
    description: source.description,
    durationSeconds: source.duration_seconds,
    questions,
    settings: {
      accessMode: source.access_mode,
      openRepeatPolicy: source.open_repeat_policy,
      showParticipantResult: source.show_participant_result === 1,
      opensAt: source.opens_at,
      closesAt: source.closes_at,
    },
  });
}

async function collectionRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  organizationId: string,
): Promise<Response> {
  requireOrganizationAccess(session, organizationId);
  const organization = await env.DB
    .prepare("SELECT id FROM organizations WHERE id = ?1 AND status = 'active'")
    .bind(organizationId)
    .first();
  if (!organization) {
    return problemResponse({ code: "not_found", requestId, status: 404, title: "Организация не найдена" });
  }

  if (request.method === "GET") {
    const [result, publicationResult] = await Promise.all([
      env.DB.prepare(
        `SELECT a.id, a.title, a.status, a.updated_at,
                (SELECT MAX(av.version_number) FROM assessment_versions av
                 WHERE av.assessment_id = a.id AND av.state = 'published') AS published_version,
                (SELECT p.id FROM publications p
                 WHERE p.assessment_id = a.id AND p.status IN ('published', 'closed', 'archived')
                 ORDER BY p.published_at DESC LIMIT 1) AS current_publication_id,
                (SELECT COUNT(*) FROM attempts att
                 JOIN publications p ON p.id = att.publication_id
                 WHERE p.assessment_id = a.id AND att.status = 'submitted') AS completed_attempts
         FROM assessments a
         WHERE a.organization_id = ?1
         ORDER BY a.updated_at DESC
         LIMIT 100`,
      ).bind(organizationId).all<{
        id: string;
        title: string;
        status: "draft" | "published" | "closed" | "archived";
        updated_at: number;
        published_version: number | null;
        completed_attempts: number;
        current_publication_id: string | null;
      }>(),
      env.DB.prepare(
        `SELECT p.assessment_id, p.id AS publication_id, p.status, p.published_at, av.version_number, av.title
         FROM publications p
         JOIN assessments a ON a.id = p.assessment_id
         JOIN assessment_versions av ON av.id = p.assessment_version_id
         WHERE a.organization_id = ?1
         ORDER BY p.published_at DESC`,
      ).bind(organizationId).all<{
        assessment_id: string;
        publication_id: string;
        title: string;
        status: "published" | "closed" | "archived";
        published_at: number;
        version_number: number;
      }>(),
    ]);
    const publicationsByAssessment = new Map<string, AssessmentListItemDTO["publications"]>();
    for (const publication of publicationResult.results) {
      const items = publicationsByAssessment.get(publication.assessment_id) ?? [];
      items.push({
        publicationId: publication.publication_id,
        title: publication.title,
        version: publication.version_number,
        status: publication.status,
        publishedAt: publication.published_at,
      });
      publicationsByAssessment.set(publication.assessment_id, items);
    }
    const body: AssessmentListItemDTO[] = result.results.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      publishedVersion: row.published_version,
      completedAttempts: row.completed_attempts,
      currentPublicationId: row.current_publication_id,
      publications: publicationsByAssessment.get(row.id) ?? [],
    }));
    return jsonResponse(body, requestId);
  }

  if (request.method === "POST") {
    const raw = await readJsonBody(request, requestId);
    if (raw instanceof Response) return raw;
    const parsed = createAssessmentSchema.safeParse(raw);
    if (!parsed.success) return validationFailure(requestId, parsed.error);
    const assessmentId = id("assessment");
    const versionId = id("version");
    const now = Date.now();
    const draft = editableAssessmentDraftSchema.parse({
      title: parsed.data.title,
      description: "",
      durationSeconds: null,
      questions: [],
      settings: {
        accessMode: "open",
        openRepeatPolicy: "best_effort_once",
        showParticipantResult: false,
        opensAt: null,
        closesAt: null,
      },
    });
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO assessments
           (id, organization_id, created_by_user_id, title, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?5)`,
        )
        .bind(assessmentId, organizationId, session.user.id, parsed.data.title, now),
      env.DB
        .prepare(
          `INSERT INTO assessment_versions
           (id, assessment_id, version_number, state, title, description, duration_seconds,
            created_by_user_id, created_at, revision, draft_json)
           VALUES (?1, ?2, 1, 'draft', ?3, '', NULL, ?4, ?5, 1, ?6)`,
        )
        .bind(versionId, assessmentId, parsed.data.title, session.user.id, now, JSON.stringify(draft)),
      auditStatement(env.DB, session, requestId, "assessment.created", "assessment", assessmentId, organizationId),
    ]);
    return jsonResponse(
      { id: assessmentId, title: parsed.data.title, status: "draft", updatedAt: now, publishedVersion: null, completedAttempts: 0, currentPublicationId: null, publications: [] },
      requestId,
      { status: 201 },
    );
  }

  return methodNotAllowed(requestId, ["GET", "POST"]);
}

async function draftRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  assessmentId: string,
): Promise<Response> {
  const row = await activeDraft(env.DB, session, assessmentId);
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Черновик не найден" });

  if (request.method === "GET") {
    return jsonResponse(draftDto(row, parseStoredDraft(row)), requestId, {
      headers: { ETag: `"${row.revision}"` },
    });
  }

  if (request.method === "PUT") {
    const expectedRevision = parseRevision(request);
    if (expectedRevision === null) {
      return problemResponse({ code: "bad_request", detail: "Для сохранения требуется If-Match с revision черновика.", requestId, status: 428, title: "Не указана версия черновика" });
    }
    const raw = await readJsonBody(request, requestId, authoringBodyLimit);
    if (raw instanceof Response) return raw;
    const parsed = editableAssessmentDraftSchema.safeParse(raw);
    if (!parsed.success) return validationFailure(requestId, parsed.error);
    const nextRevision = expectedRevision + 1;
    const now = Date.now();
    const batch = await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE assessment_versions
           SET title = ?1, description = ?2, duration_seconds = ?3, draft_json = ?4, revision = ?5
           WHERE id = ?6 AND state = 'draft' AND revision = ?7`,
        )
        .bind(parsed.data.title, parsed.data.description, parsed.data.durationSeconds, JSON.stringify(parsed.data), nextRevision, row.version_id, expectedRevision),
      env.DB
        .prepare(
          `UPDATE assessments SET title = ?1, updated_at = ?2
           WHERE id = ?3 AND EXISTS (
             SELECT 1 FROM assessment_versions
             WHERE id = ?4 AND state = 'draft' AND revision = ?5
           )`,
        )
        .bind(parsed.data.title, now, assessmentId, row.version_id, nextRevision),
    ]);
    if (batch[0]?.meta.changes !== 1) {
      return problemResponse({ code: "conflict", detail: "Черновик уже изменён в другой вкладке. Обновите страницу.", requestId, status: 409, title: "Конфликт версии" });
    }
    return jsonResponse(
      { ...draftDto({ ...row, revision: nextRevision }, parsed.data), revision: nextRevision },
      requestId,
      { headers: { ETag: `"${nextRevision}"` } },
    );
  }

  return methodNotAllowed(requestId, ["GET", "PUT"]);
}

function conditionalAuditStatement(
  db: D1Database,
  session: AuthorizedSession,
  requestId: string,
  action: string,
  entityType: string,
  entityId: string,
  organizationId: string,
  versionId: string,
  publishedAt: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
       (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_json, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}', ?8
       WHERE EXISTS (
         SELECT 1 FROM assessment_versions
         WHERE id = ?9 AND state = 'published' AND published_at = ?8
       )`,
    )
    .bind(id("audit"), organizationId, session.user.id, action, entityType, entityId, requestId, publishedAt, versionId);
}

async function publishRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  assessmentId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const expectedRevision = parseRevision(request);
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (expectedRevision === null || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return problemResponse({ code: "bad_request", detail: "Требуются валидные If-Match и Idempotency-Key.", requestId, status: 400, title: "Некорректные заголовки публикации" });
  }
  const assessment = await assessmentAccess(env.DB, session, assessmentId);
  if (!assessment) return problemResponse({ code: "not_found", requestId, status: 404, title: "Тест не найден" });
  const requestHash = await sha256(JSON.stringify({ assessmentId, expectedRevision }));
  const keyDigest = await sha256(idempotencyKey);
  const scope = `publish:${assessmentId}`;
  const replay = await env.DB
    .prepare("SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE scope = ?1 AND key_digest = ?2 AND expires_at > ?3")
    .bind(scope, keyDigest, Date.now())
    .first<{ request_hash: string; response_status: number; response_body: string }>();
  if (replay) {
    if (replay.request_hash !== requestHash) {
      return problemResponse({ code: "idempotency_conflict", requestId, status: 409, title: "Ключ уже использован для другого запроса" });
    }
    return jsonResponse(JSON.parse(replay.response_body) as unknown, requestId, {
      status: replay.response_status,
      headers: { "X-Idempotent-Replay": "true" },
    });
  }
  const row = await activeDraft(env.DB, session, assessmentId);
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Черновик не найден" });
  const editable = parseStoredDraft(row);
  const strict = draftAssessmentSchema.safeParse({
    title: editable.title,
    description: editable.description,
    durationSeconds: editable.durationSeconds,
    questions: editable.questions,
  });
  if (!strict.success) return validationFailure(requestId, strict.error);
  const settings = publicationSettingsSchema.parse(editable.settings);
  if (row.revision !== expectedRevision) {
    return problemResponse({ code: "conflict", detail: "Черновик изменился перед публикацией.", requestId, status: 409, title: "Конфликт версии" });
  }

  const publicationId = id("publication");
  const publishedAt = Date.now();
  const code = settings.accessMode === "open" ? generateAccessCode() : null;
  const codeDigest = code ? await accessCredentialDigest(env, "code", code) : null;
  const codeHint = code?.slice(-2) ?? null;
  const contentHash = await sha256(JSON.stringify(strict.data));
  const response: PublishAssessmentResponse = {
    assessmentId,
    publicationId,
    version: row.version_number,
    publishedAt,
    access: { mode: settings.accessMode, code, codeHint },
  };
  const responseBody = JSON.stringify(response);
  const statements: D1PreparedStatement[] = [
    env.DB
      .prepare(
        `UPDATE assessment_versions
         SET state = 'published', published_at = ?1, content_hash = ?2, draft_json = NULL, revision = revision + 1
         WHERE id = ?3 AND state = 'draft' AND revision = ?4`,
      )
      .bind(publishedAt, contentHash, row.version_id, expectedRevision),
    env.DB
      .prepare(
        `UPDATE assessments SET status = 'published', title = ?1, updated_at = ?2
         WHERE id = ?3 AND EXISTS (
           SELECT 1 FROM assessment_versions WHERE id = ?4 AND state = 'published' AND published_at = ?2
         )`,
      )
      .bind(strict.data.title, publishedAt, assessmentId, row.version_id),
    env.DB
      .prepare(
        `INSERT INTO publications
         (id, assessment_id, assessment_version_id, status, access_mode, open_repeat_policy,
          code_digest, code_hint, show_participant_result, opens_at, closes_at, published_at)
         SELECT ?1, ?2, ?3, 'published', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
         WHERE EXISTS (
           SELECT 1 FROM assessment_versions WHERE id = ?3 AND state = 'published' AND published_at = ?11
         )`,
      )
      .bind(publicationId, assessmentId, row.version_id, settings.accessMode, settings.openRepeatPolicy, codeDigest, codeHint, settings.showParticipantResult ? 1 : 0, settings.opensAt, settings.closesAt, publishedAt),
  ];

  for (const question of strict.data.questions) {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO questions
           (id, assessment_version_id, type, text, position, is_required, is_scored, points,
            scale_min, scale_max, scale_min_label, scale_max_label)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
           WHERE EXISTS (
             SELECT 1 FROM assessment_versions WHERE id = ?2 AND state = 'published' AND published_at = ?13
           )`,
        )
        .bind(
          question.id,
          row.version_id,
          question.type,
          question.text,
          question.position,
          question.required ? 1 : 0,
          question.scored ? 1 : 0,
          question.points,
          question.type === "rating" ? question.scaleMin : null,
          question.type === "rating" ? question.scaleMax : null,
          question.type === "rating" ? question.scaleMinLabel ?? null : null,
          question.type === "rating" ? question.scaleMaxLabel ?? null : null,
          publishedAt,
        ),
    );
    if (question.type !== "rating") {
      for (const option of question.options) {
        statements.push(
          env.DB
            .prepare(
              `INSERT INTO question_options (id, question_id, text, position, is_correct)
               SELECT ?1, ?2, ?3, ?4, ?5
               WHERE EXISTS (
                 SELECT 1 FROM questions q
                 JOIN assessment_versions av ON av.id = q.assessment_version_id
                 WHERE q.id = ?2 AND av.state = 'published' AND av.published_at = ?6
               )`,
            )
            .bind(option.id, question.id, option.text, option.position, option.isCorrect ? 1 : 0, publishedAt),
        );
      }
    }
  }
  statements.push(
    conditionalAuditStatement(env.DB, session, requestId, "assessment.published", "assessment", assessmentId, row.organization_id, row.version_id, publishedAt),
    env.DB
      .prepare(
        `INSERT INTO idempotency_keys
         (id, scope, key_digest, request_hash, response_status, response_body, created_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, 201, ?5, ?6, ?7
         WHERE EXISTS (
           SELECT 1 FROM assessment_versions WHERE id = ?8 AND state = 'published' AND published_at = ?6
         )`,
      )
      .bind(id("idempotency"), scope, keyDigest, requestHash, responseBody, publishedAt, publishedAt + 7 * 24 * 60 * 60 * 1000, row.version_id),
  );
  const batch = await env.DB.batch(statements);
  if (batch[0]?.meta.changes !== 1) {
    return problemResponse({ code: "conflict", detail: "Черновик уже опубликован или изменён.", requestId, status: 409, title: "Публикация не выполнена" });
  }
  return jsonResponse(response, requestId, { status: 201 });
}

async function distributionRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  const row = await env.DB
    .prepare(
      `SELECT p.id, p.assessment_id, p.status, p.access_mode, p.open_repeat_policy,
              p.show_participant_result, p.opens_at, p.closes_at, p.code_hint,
              a.organization_id, a.title
       FROM publications p JOIN assessments a ON a.id = p.assessment_id
       WHERE p.id = ?1`,
    )
    .bind(publicationId)
    .first<{
      id: string;
      assessment_id: string;
      status: "published" | "closed" | "archived";
      access_mode: "open" | "controlled";
      open_repeat_policy: "unlimited" | "best_effort_once" | null;
      show_participant_result: number;
      opens_at: number | null;
      closes_at: number | null;
      code_hint: string | null;
      organization_id: string;
      title: string;
    }>();
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Публикация не найдена" });
  requireOrganizationAccess(session, row.organization_id);
  const settings = publicationSettingsSchema.parse({
    accessMode: row.access_mode,
    openRepeatPolicy: row.open_repeat_policy,
    showParticipantResult: row.show_participant_result === 1,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
  });
  const body: DistributionDTO = {
    assessmentId: row.assessment_id,
    publicationId: row.id,
    title: row.title,
    status: row.status,
    settings,
    codeHint: row.code_hint,
    codeAvailable: false,
  };
  return jsonResponse(body, requestId);
}

async function closeRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const row = await env.DB
    .prepare(
      `SELECT p.assessment_id, p.status, a.organization_id
       FROM publications p JOIN assessments a ON a.id = p.assessment_id WHERE p.id = ?1`,
    )
    .bind(publicationId)
    .first<{ assessment_id: string; status: string; organization_id: string }>();
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Публикация не найдена" });
  requireOrganizationAccess(session, row.organization_id);
  if (row.status === "closed") return jsonResponse({ publicationId, status: "closed" }, requestId);
  if (row.status !== "published") return problemResponse({ code: "conflict", requestId, status: 409, title: "Публикацию нельзя завершить" });
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE publications SET status = 'closed', closed_at = ?1 WHERE id = ?2 AND status = 'published'").bind(now, publicationId),
    env.DB.prepare("UPDATE assessments SET status = 'closed', updated_at = ?1 WHERE id = ?2 AND status = 'published'").bind(now, row.assessment_id),
    auditStatement(env.DB, session, requestId, "publication.closed", "publication", publicationId, row.organization_id),
  ]);
  return jsonResponse({ publicationId, status: "closed", closedAt: now }, requestId);
}

async function reopenRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const row = await env.DB
    .prepare(
      `SELECT p.assessment_id, p.status AS publication_status, p.closes_at,
              a.organization_id, a.status AS assessment_status,
              CASE WHEN p.id = (
                SELECT latest.id FROM publications latest
                WHERE latest.assessment_id = p.assessment_id
                ORDER BY latest.published_at DESC LIMIT 1
              ) THEN 1 ELSE 0 END AS is_latest
       FROM publications p
       JOIN assessments a ON a.id = p.assessment_id
       WHERE p.id = ?1`,
    )
    .bind(publicationId)
    .first<{
      assessment_id: string;
      publication_status: "published" | "closed" | "archived";
      closes_at: number | null;
      organization_id: string;
      assessment_status: "draft" | "published" | "closed" | "archived";
      is_latest: number;
    }>();
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Публикация не найдена" });
  requireOrganizationAccess(session, row.organization_id);
  if (row.is_latest !== 1) {
    return problemResponse({ code: "conflict", requestId, status: 409, title: "Можно возобновить только последнюю версию теста" });
  }
  if (row.publication_status === "published" && row.assessment_status === "published") {
    return jsonResponse({ assessmentId: row.assessment_id, publicationId, status: "published", reopenedAt: Date.now(), closesAt: row.closes_at }, requestId);
  }
  if ((row.publication_status !== "closed" && row.publication_status !== "archived") || (row.assessment_status !== "closed" && row.assessment_status !== "archived")) {
    return problemResponse({ code: "conflict", detail: "Нельзя возобновить публикацию, пока существует редактируемый черновик.", requestId, status: 409, title: "Тест нельзя запустить повторно" });
  }
  const reopenedAt = Date.now();
  const closesAt = row.closes_at !== null && row.closes_at <= reopenedAt ? null : row.closes_at;
  const batch = await env.DB.batch([
    env.DB.prepare(
      `UPDATE publications
       SET status = 'published', closed_at = NULL, closes_at = ?1
       WHERE id = ?2 AND status IN ('closed', 'archived')`,
    ).bind(closesAt, publicationId),
    env.DB.prepare(
      `UPDATE assessments
       SET status = 'published', archived_at = NULL, updated_at = ?1
       WHERE id = ?2 AND status IN ('closed', 'archived')
         AND EXISTS (SELECT 1 FROM publications WHERE id = ?3 AND status = 'published')`,
    ).bind(reopenedAt, row.assessment_id, publicationId),
    env.DB.prepare(
      `INSERT INTO audit_log
       (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_json, created_at)
       SELECT ?1, ?2, ?3, 'publication.reopened', 'publication', ?4, ?5, ?6, ?7
       WHERE EXISTS (
         SELECT 1 FROM publications p
         JOIN assessments a ON a.id = p.assessment_id
         WHERE p.id = ?4 AND p.status = 'published' AND a.status = 'published' AND a.updated_at = ?7
       )`,
    ).bind(id("audit"), row.organization_id, session.user.id, publicationId, requestId, JSON.stringify({ closesAt: closesAt === null ? "cleared" : String(closesAt) }), reopenedAt),
  ]);
  if (batch[0]?.meta.changes !== 1 || batch[1]?.meta.changes !== 1) {
    return problemResponse({ code: "conflict", requestId, status: 409, title: "Не удалось запустить тест повторно" });
  }
  return jsonResponse({ assessmentId: row.assessment_id, publicationId, status: "published", reopenedAt, closesAt }, requestId);
}

async function reviseRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  assessmentId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const assessment = await assessmentAccess(env.DB, session, assessmentId);
  if (!assessment) return problemResponse({ code: "not_found", requestId, status: 404, title: "Тест не найден" });
  if (assessment.status === "draft") {
    return problemResponse({ code: "conflict", requestId, status: 409, title: "Черновик уже существует" });
  }
  const source = await env.DB.prepare(
    `SELECT a.id AS assessment_id, a.organization_id, a.status,
            p.id AS publication_id, p.status AS publication_status,
            p.access_mode, p.open_repeat_policy, p.show_participant_result,
            p.opens_at, p.closes_at,
            av.id AS version_id, av.version_number, av.title, av.description, av.duration_seconds
     FROM assessments a
     JOIN publications p ON p.assessment_id = a.id
     JOIN assessment_versions av ON av.id = p.assessment_version_id
     WHERE a.id = ?1 AND p.status IN ('published', 'closed', 'archived')
     ORDER BY p.published_at DESC
     LIMIT 1`,
  ).bind(assessmentId).first<PublishedRevisionRow>();
  if (!source) return problemResponse({ code: "not_found", requestId, status: 404, title: "Опубликованная версия не найдена" });
  const draft = await draftFromPublishedSnapshot(env.DB, source);
  const versionId = id("version");
  const createdAt = Date.now();
  const nextVersion = source.version_number + 1;
  const batch = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO assessment_versions
       (id, assessment_id, version_number, state, title, description, duration_seconds,
        content_hash, created_by_user_id, created_at, published_at, revision, draft_json)
       SELECT ?1, ?2, ?3, 'draft', ?4, ?5, ?6, NULL, ?7, ?8, NULL, 1, ?9
       WHERE EXISTS (
         SELECT 1 FROM assessments
         WHERE id = ?2 AND status IN ('published', 'closed', 'archived')
       ) AND NOT EXISTS (
         SELECT 1 FROM assessment_versions WHERE assessment_id = ?2 AND state = 'draft'
       )`,
    ).bind(versionId, assessmentId, nextVersion, draft.title, draft.description, draft.durationSeconds, session.user.id, createdAt, JSON.stringify(draft)),
    env.DB.prepare(
      `UPDATE publications
       SET status = 'closed', closed_at = COALESCE(closed_at, ?1)
       WHERE id = ?2 AND status = 'published'
         AND EXISTS (SELECT 1 FROM assessment_versions WHERE id = ?3 AND state = 'draft')`,
    ).bind(createdAt, source.publication_id, versionId),
    env.DB.prepare(
      `UPDATE assessments
       SET status = 'draft', title = ?1, archived_at = NULL, updated_at = ?2
       WHERE id = ?3 AND status IN ('published', 'closed', 'archived')
         AND EXISTS (SELECT 1 FROM assessment_versions WHERE id = ?4 AND state = 'draft')`,
    ).bind(draft.title, createdAt, assessmentId, versionId),
    env.DB.prepare(
      `INSERT INTO audit_log
       (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_json, created_at)
       SELECT ?1, ?2, ?3, 'assessment.revision_started', 'assessment', ?4, ?5, ?6, ?7
       WHERE EXISTS (SELECT 1 FROM assessment_versions WHERE id = ?8 AND state = 'draft')`,
    ).bind(id("audit"), source.organization_id, session.user.id, assessmentId, requestId, JSON.stringify({ sourcePublicationId: source.publication_id, version: nextVersion }), createdAt, versionId),
  ]);
  if (batch[0]?.meta.changes !== 1 || batch[2]?.meta.changes !== 1) {
    return problemResponse({ code: "conflict", requestId, status: 409, title: "Не удалось создать новую версию" });
  }
  return jsonResponse(
    draftDto({
      assessment_id: assessmentId,
      organization_id: source.organization_id,
      status: "draft",
      version_id: versionId,
      version_number: nextVersion,
      revision: 1,
      draft_json: JSON.stringify(draft),
    }, draft),
    requestId,
    { status: 201, headers: { ETag: '"1"' } },
  );
}

async function archiveRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  assessmentId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const assessment = await assessmentAccess(env.DB, session, assessmentId);
  if (!assessment) return problemResponse({ code: "not_found", requestId, status: 404, title: "Тест не найден" });
  if (assessment.status !== "closed") return problemResponse({ code: "conflict", requestId, status: 409, title: "Сначала завершите тест" });
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE assessments SET status = 'archived', archived_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'closed'").bind(now, assessmentId),
    env.DB.prepare("UPDATE publications SET status = 'archived' WHERE assessment_id = ?1 AND status = 'closed'").bind(assessmentId),
    auditStatement(env.DB, session, requestId, "assessment.archived", "assessment", assessmentId, assessment.organization_id),
  ]);
  return jsonResponse({ assessmentId, status: "archived", archivedAt: now }, requestId);
}

async function rotateCodeRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const row = await env.DB
    .prepare(
      `SELECT p.status, p.access_mode, a.organization_id
       FROM publications p JOIN assessments a ON a.id = p.assessment_id WHERE p.id = ?1`,
    )
    .bind(publicationId)
    .first<{ status: string; access_mode: string; organization_id: string }>();
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Публикация не найдена" });
  requireOrganizationAccess(session, row.organization_id);
  if (row.status !== "published" || row.access_mode !== "open") {
    return problemResponse({ code: "conflict", requestId, status: 409, title: "Код недоступен для этой публикации" });
  }
  const code = generateAccessCode();
  const codeDigest = await accessCredentialDigest(env, "code", code);
  const codeHint = code.slice(-2);
  await env.DB.batch([
    env.DB.prepare("UPDATE publications SET code_digest = ?1, code_hint = ?2 WHERE id = ?3 AND status = 'published' AND access_mode = 'open'").bind(codeDigest, codeHint, publicationId),
    auditStatement(env.DB, session, requestId, "publication.code_rotated", "publication", publicationId, row.organization_id),
  ]);
  return jsonResponse({ publicationId, code, codeHint }, requestId);
}

async function controlledPublicationAccess(
  env: Env,
  session: AuthorizedSession,
  publicationId: string,
  requestId: string,
): Promise<{ organizationId: string; status: string } | Response> {
  const row = await env.DB.prepare(
    `SELECT p.status, p.access_mode, a.organization_id
     FROM publications p JOIN assessments a ON a.id = p.assessment_id
     WHERE p.id = ?1`,
  ).bind(publicationId).first<{ status: string; access_mode: string; organization_id: string }>();
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Публикация не найдена" });
  requireOrganizationAccess(session, row.organization_id);
  if (row.access_mode !== "controlled") {
    return problemResponse({ code: "conflict", requestId, status: 409, title: "Приглашения недоступны для открытого теста" });
  }
  return { organizationId: row.organization_id, status: row.status };
}

async function invitationsRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  const access = await controlledPublicationAccess(env, session, publicationId, requestId);
  if (access instanceof Response) return access;
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE participant_invitations SET status = 'expired'
     WHERE publication_id = ?1 AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?2`,
  ).bind(publicationId, now).run();
  const rows = await env.DB.prepare(
    `SELECT id, participant_label, status, expires_at, created_at
     FROM participant_invitations WHERE publication_id = ?1
     ORDER BY created_at DESC LIMIT 500`,
  ).bind(publicationId).all<{
    id: string;
    participant_label: string;
    status: InvitationDTO["status"];
    expires_at: number | null;
    created_at: number;
  }>();
  const response: InvitationDTO[] = rows.results.map((row) => ({
    id: row.id,
    participantLabel: row.participant_label,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
  return jsonResponse(response, requestId);
}

async function createInvitationBatchRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const access = await controlledPublicationAccess(env, session, publicationId, requestId);
  if (access instanceof Response) return access;
  if (access.status !== "published") {
    return problemResponse({ code: "assessment_closed", requestId, status: 410, title: "Тест завершён" });
  }
  const raw = await readJsonBody(request, requestId, 32_768);
  if (raw instanceof Response) return raw;
  const parsed = createInvitationBatchSchema.safeParse(raw);
  if (!parsed.success || (parsed.data.expiresAt !== null && parsed.data.expiresAt <= Date.now())) {
    return problemResponse({ code: "validation_failed", requestId, status: 422, title: "Проверьте список приглашений" });
  }
  const createdAt = Date.now();
  const invitations: CreatedInvitationDTO[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const participantLabel of parsed.data.participantLabels) {
    const invitationId = id("invitation");
    const token = invitationToken();
    const digest = await accessCredentialDigest(env, "invitation", token);
    statements.push(env.DB.prepare(
      `INSERT INTO participant_invitations
       (id, publication_id, token_digest, participant_label, status, expires_at, created_at, used_at, revoked_at)
       VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, NULL, NULL)`,
    ).bind(invitationId, publicationId, digest, participantLabel, parsed.data.expiresAt, createdAt));
    invitations.push({
      id: invitationId,
      participantLabel,
      status: "active",
      expiresAt: parsed.data.expiresAt,
      createdAt,
      invitationToken: token,
      joinPath: `/join#invite=${encodeURIComponent(token)}`,
    });
  }
  statements.push(auditStatement(env.DB, session, requestId, "invitation.batch_created", "publication", publicationId, access.organizationId, { count: String(invitations.length) }));
  await env.DB.batch(statements);
  return jsonResponse(invitations, requestId, { status: 201 });
}

async function revokeInvitationRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  invitationId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const row = await env.DB.prepare(
    `SELECT i.status, i.publication_id, a.organization_id
     FROM participant_invitations i
     JOIN publications p ON p.id = i.publication_id
     JOIN assessments a ON a.id = p.assessment_id
     WHERE i.id = ?1`,
  ).bind(invitationId).first<{ status: string; publication_id: string; organization_id: string }>();
  if (!row) return problemResponse({ code: "not_found", requestId, status: 404, title: "Приглашение не найдено" });
  requireOrganizationAccess(session, row.organization_id);
  if (row.status !== "active") {
    return problemResponse({ code: "conflict", requestId, status: 409, title: "Приглашение уже недоступно" });
  }
  const revokedAt = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE participant_invitations SET status = 'revoked', revoked_at = ?1 WHERE id = ?2 AND status = 'active'").bind(revokedAt, invitationId),
    auditStatement(env.DB, session, requestId, "invitation.revoked", "invitation", invitationId, row.organization_id, { publicationId: row.publication_id }),
  ]);
  return jsonResponse({ invitationId, status: "revoked", revokedAt }, requestId);
}

export async function routeAuthoringApi(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const collection = pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/assessments$/);
  if (collection?.[1]) return collectionRoute(request, env, session, requestId, decodeURIComponent(collection[1]));

  const draft = pathname.match(/^\/api\/v1\/assessments\/([^/]+)\/draft$/);
  if (draft?.[1]) return draftRoute(request, env, session, requestId, decodeURIComponent(draft[1]));
  const publish = pathname.match(/^\/api\/v1\/assessments\/([^/]+)\/publish$/);
  if (publish?.[1]) return publishRoute(request, env, session, requestId, decodeURIComponent(publish[1]));
  const revise = pathname.match(/^\/api\/v1\/assessments\/([^/]+)\/revise$/);
  if (revise?.[1]) return reviseRoute(request, env, session, requestId, decodeURIComponent(revise[1]));
  const archive = pathname.match(/^\/api\/v1\/assessments\/([^/]+)\/archive$/);
  if (archive?.[1]) return archiveRoute(request, env, session, requestId, decodeURIComponent(archive[1]));

  const distribution = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/distribution$/);
  if (distribution?.[1]) return distributionRoute(request, env, session, requestId, decodeURIComponent(distribution[1]));
  const close = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/close$/);
  if (close?.[1]) return closeRoute(request, env, session, requestId, decodeURIComponent(close[1]));
  const reopen = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/reopen$/);
  if (reopen?.[1]) return reopenRoute(request, env, session, requestId, decodeURIComponent(reopen[1]));
  const rotate = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/code\/rotate$/);
  if (rotate?.[1]) return rotateCodeRoute(request, env, session, requestId, decodeURIComponent(rotate[1]));
  const invitationBatch = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/invitations\/batch$/);
  if (invitationBatch?.[1]) return createInvitationBatchRoute(request, env, session, requestId, decodeURIComponent(invitationBatch[1]));
  const invitations = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/invitations$/);
  if (invitations?.[1]) return invitationsRoute(request, env, session, requestId, decodeURIComponent(invitations[1]));
  const revokeInvitation = pathname.match(/^\/api\/v1\/invitations\/([^/]+)\/revoke$/);
  if (revokeInvitation?.[1]) return revokeInvitationRoute(request, env, session, requestId, decodeURIComponent(revokeInvitation[1]));
  return null;
}
