import type {
  OrganizerAttemptDetailDTO,
  OrganizerAttemptListItemDTO,
  OrganizerAttemptsPageDTO,
  QuestionAnalysisDTO,
  QuestionAnalysisItemDTO,
  ResultsOverviewDTO,
} from "../shared/contracts";
import { csvRow } from "../shared/csv";
import { jsonResponse, methodNotAllowed, problemResponse } from "./http";
import { requireOrganizationAccess, type AuthorizedSession } from "./session";

interface PublicationAccessRow {
  publication_id: string;
  assessment_version_id: string;
  organization_id: string;
  title: string;
  status: "published" | "closed" | "archived";
  access_mode: "open" | "controlled";
  published_at: number;
}

interface AttemptListRow {
  id: string;
  display_name: string;
  status: "active" | "submitted" | "expired";
  completion_reason: "submitted" | "deadline" | "abandoned" | null;
  started_at: number;
  updated_at: number;
  submitted_at: number | null;
  score: number | null;
  max_score: number | null;
}

interface AttemptDetailRow extends AttemptListRow {
  publication_id: string;
  assessment_version_id: string;
  assessment_title: string;
  organization_id: string;
}

interface QuestionDetailRow {
  id: string;
  type: "single_choice" | "multiple_choice" | "rating";
  text: string;
  position: number;
  is_scored: number;
  points: number;
  value_kind: "choice" | "rating" | "empty" | null;
  rating_value: number | null;
}

interface OptionDetailRow {
  id: string;
  question_id: string;
  text: string;
  position: number;
  is_correct: number;
  is_selected: number;
}

interface AttemptCursor {
  startedAt: number;
  id: string;
}

const scoreRanges = ["0–49", "50–69", "70–84", "85–100"] as const;

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function attemptDto(row: AttemptListRow): OrganizerAttemptListItemDTO {
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.status,
    completionReason: row.completion_reason,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.status === "active" ? null : (row.submitted_at ?? row.updated_at),
    score: row.score,
    maxScore: row.max_score,
    scorePercent: row.score === null || row.max_score === null || row.max_score === 0
      ? null
      : rounded((row.score * 100) / row.max_score),
  };
}

async function publicationAccess(
  db: D1Database,
  session: AuthorizedSession,
  publicationId: string,
): Promise<PublicationAccessRow | null> {
  const row = await db.prepare(
    `SELECT p.id AS publication_id, p.assessment_version_id, a.organization_id,
            av.title, p.status, p.access_mode, p.published_at
     FROM publications p
     JOIN assessments a ON a.id = p.assessment_id
     JOIN assessment_versions av ON av.id = p.assessment_version_id
     WHERE p.id = ?1`,
  ).bind(publicationId).first<PublicationAccessRow>();
  if (row) requireOrganizationAccess(session, row.organization_id);
  return row;
}

function missingPublication(requestId: string): Response {
  return problemResponse({ code: "not_found", requestId, status: 404, title: "Публикация не найдена" });
}

async function overviewRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  const publication = await publicationAccess(env.DB, session, publicationId);
  if (!publication) return missingPublication(requestId);

  const [metrics, invitationCount, distributionResult, trendResult] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(att.id) AS total_attempts,
              COALESCE(SUM(CASE WHEN att.status = 'active' THEN 1 ELSE 0 END), 0) AS active_attempts,
              COALESCE(SUM(CASE WHEN r.attempt_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS completed_attempts,
              COALESCE(SUM(CASE WHEN att.completion_reason = 'abandoned' THEN 1 ELSE 0 END), 0) AS abandoned_attempts,
              AVG(CASE WHEN r.max_score > 0 THEN (100.0 * r.score) / r.max_score END) AS average_score_percent
       FROM attempts att
       LEFT JOIN results r ON r.attempt_id = att.id
       WHERE att.publication_id = ?1`,
    ).bind(publicationId).first<{
      total_attempts: number;
      active_attempts: number;
      completed_attempts: number;
      abandoned_attempts: number;
      average_score_percent: number | null;
    }>(),
    publication.access_mode === "controlled"
      ? env.DB.prepare("SELECT COUNT(*) AS total FROM participant_invitations WHERE publication_id = ?1")
        .bind(publicationId).first<{ total: number }>()
      : Promise.resolve(null),
    env.DB.prepare(
      `SELECT CASE
                WHEN score_percent < 50 THEN '0–49'
                WHEN score_percent < 70 THEN '50–69'
                WHEN score_percent < 85 THEN '70–84'
                ELSE '85–100'
              END AS score_range,
              COUNT(*) AS amount
       FROM (
         SELECT (100.0 * r.score) / r.max_score AS score_percent
         FROM attempts att
         JOIN results r ON r.attempt_id = att.id
         WHERE att.publication_id = ?1 AND r.max_score > 0
       ) scored
       GROUP BY score_range`,
    ).bind(publicationId).all<{ score_range: ResultsOverviewDTO["scoreDistribution"][number]["range"]; amount: number }>(),
    env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', COALESCE(att.submitted_at, att.updated_at) / 1000, 'unixepoch') AS response_date,
              COUNT(*) AS responses
       FROM attempts att
       JOIN results r ON r.attempt_id = att.id
       WHERE att.publication_id = ?1
       GROUP BY response_date
       ORDER BY response_date ASC`,
    ).bind(publicationId).all<{ response_date: string; responses: number }>(),
  ]);

  const totalAttempts = metrics?.total_attempts ?? 0;
  const invitationsTotal = invitationCount?.total ?? null;
  const distributionCounts = new Map(distributionResult.results.map((row) => [row.score_range, row.amount]));
  const scoredTotal = distributionResult.results.reduce((sum, row) => sum + row.amount, 0);
  const body: ResultsOverviewDTO = {
    publication: {
      id: publication.publication_id,
      title: publication.title,
      status: publication.status,
      accessMode: publication.access_mode,
      publishedAt: publication.published_at,
    },
    attempts: {
      total: totalAttempts,
      active: metrics?.active_attempts ?? 0,
      completed: metrics?.completed_attempts ?? 0,
      abandoned: metrics?.abandoned_attempts ?? 0,
    },
    invitationsTotal,
    participationPercent: invitationsTotal === null || invitationsTotal === 0
      ? null
      : rounded((totalAttempts * 100) / invitationsTotal),
    averageScorePercent: rounded(metrics?.average_score_percent ?? null),
    scoreDistribution: scoreRanges.map((range) => {
      const count = distributionCounts.get(range) ?? 0;
      return { range, count, percent: scoredTotal === 0 ? 0 : rounded((count * 100) / scoredTotal) ?? 0 };
    }),
    responseTrend: trendResult.results.map((row) => ({ date: row.response_date, responses: row.responses })),
  };
  return jsonResponse(body, requestId);
}

async function questionsRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  const publication = await publicationAccess(env.DB, session, publicationId);
  if (!publication) return missingPublication(requestId);

  const result = await env.DB.prepare(
    `WITH finalized_attempts AS (
       SELECT att.id
       FROM attempts att
       JOIN results r ON r.attempt_id = att.id
       WHERE att.publication_id = ?1
     ),
     correct_totals AS (
       SELECT q.id AS question_id,
              COALESCE(SUM(CASE WHEN qo.is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct_options
       FROM questions q
       LEFT JOIN question_options qo ON qo.question_id = q.id
       WHERE q.assessment_version_id = ?2
       GROUP BY q.id
     ),
     answer_stats AS (
       SELECT a.id AS answer_id, a.question_id, a.value_kind, a.rating_value,
              COUNT(ao.option_id) AS selected_options,
              COALESCE(SUM(CASE WHEN qo.is_correct = 1 THEN 1 ELSE 0 END), 0) AS selected_correct
       FROM answers a
       JOIN finalized_attempts fa ON fa.id = a.attempt_id
       LEFT JOIN answer_options ao ON ao.answer_id = a.id
       LEFT JOIN question_options qo ON qo.id = ao.option_id
       WHERE a.value_kind != 'empty'
       GROUP BY a.id, a.question_id, a.value_kind, a.rating_value
     )
     SELECT q.id AS question_id, q.position, q.text, q.type, q.is_scored, q.points,
            COUNT(ans.answer_id) AS answered_count,
            CASE WHEN q.is_scored = 1 THEN
              COALESCE(SUM(CASE
                WHEN ans.answer_id IS NOT NULL
                 AND ans.selected_options = ct.correct_options
                 AND ans.selected_correct = ct.correct_options
                 AND ct.correct_options > 0 THEN 1 ELSE 0 END), 0)
              ELSE NULL END AS correct_count,
            AVG(CASE WHEN q.type = 'rating' THEN ans.rating_value END) AS average_rating
     FROM questions q
     JOIN correct_totals ct ON ct.question_id = q.id
     LEFT JOIN answer_stats ans ON ans.question_id = q.id
     WHERE q.assessment_version_id = ?2
     GROUP BY q.id, q.position, q.text, q.type, q.is_scored, q.points
     ORDER BY q.position`,
  ).bind(publicationId, publication.assessment_version_id).all<{
    question_id: string;
    position: number;
    text: string;
    type: "single_choice" | "multiple_choice" | "rating";
    is_scored: number;
    points: number;
    answered_count: number;
    correct_count: number | null;
    average_rating: number | null;
  }>();

  const items: QuestionAnalysisItemDTO[] = result.results.map((row) => ({
    questionId: row.question_id,
    position: row.position,
    text: row.text,
    type: row.type,
    scored: row.is_scored === 1,
    points: row.points,
    answeredCount: row.answered_count,
    correctCount: row.correct_count,
    correctPercent: row.correct_count === null || row.answered_count === 0
      ? null
      : rounded((row.correct_count * 100) / row.answered_count),
    averageRating: rounded(row.average_rating),
  }));
  const body: QuestionAnalysisDTO = { publicationId, items };
  return jsonResponse(body, requestId);
}

function encodeCursor(cursor: AttemptCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function parseCursor(value: string | null): AttemptCursor | null | undefined {
  if (!value) return null;
  if (value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Partial<AttemptCursor>;
    if (!Number.isSafeInteger(parsed.startedAt) || typeof parsed.id !== "string" || !parsed.id) return undefined;
    return { startedAt: parsed.startedAt, id: parsed.id } as AttemptCursor;
  } catch {
    return undefined;
  }
}

async function attemptsRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  const publication = await publicationAccess(env.DB, session, publicationId);
  if (!publication) return missingPublication(requestId);
  const url = new URL(request.url);
  const cursor = parseCursor(url.searchParams.get("cursor"));
  if (cursor === undefined) {
    return problemResponse({ code: "bad_request", requestId, status: 400, title: "Некорректный курсор" });
  }
  const requestedLimit = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 25;
  const statement = cursor
    ? env.DB.prepare(
      `SELECT att.id, att.display_name, att.status, att.completion_reason,
              att.started_at, att.updated_at, att.submitted_at, r.score, r.max_score
       FROM attempts att
       LEFT JOIN results r ON r.attempt_id = att.id
       WHERE att.publication_id = ?1
         AND (att.started_at < ?2 OR (att.started_at = ?2 AND att.id < ?3))
       ORDER BY att.started_at DESC, att.id DESC
       LIMIT ?4`,
    ).bind(publicationId, cursor.startedAt, cursor.id, limit + 1)
    : env.DB.prepare(
      `SELECT att.id, att.display_name, att.status, att.completion_reason,
              att.started_at, att.updated_at, att.submitted_at, r.score, r.max_score
       FROM attempts att
       LEFT JOIN results r ON r.attempt_id = att.id
       WHERE att.publication_id = ?1
       ORDER BY att.started_at DESC, att.id DESC
       LIMIT ?2`,
    ).bind(publicationId, limit + 1);
  const result = await statement.all<AttemptListRow>();
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  const body: OrganizerAttemptsPageDTO = {
    publicationId,
    items: rows.map(attemptDto),
    nextCursor: result.results.length > limit && last ? encodeCursor({ startedAt: last.started_at, id: last.id }) : null,
  };
  return jsonResponse(body, requestId);
}

async function attemptDetailRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  attemptId: string,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  const attempt = await env.DB.prepare(
    `SELECT att.id, att.publication_id, att.assessment_version_id, att.display_name,
            att.status, att.completion_reason, att.started_at, att.updated_at,
            att.submitted_at, r.score, r.max_score, av.title AS assessment_title,
            a.organization_id
     FROM attempts att
     JOIN publications p ON p.id = att.publication_id
     JOIN assessments a ON a.id = p.assessment_id
     JOIN assessment_versions av ON av.id = att.assessment_version_id
     LEFT JOIN results r ON r.attempt_id = att.id
     WHERE att.id = ?1`,
  ).bind(attemptId).first<AttemptDetailRow>();
  if (!attempt) {
    return problemResponse({ code: "not_found", requestId, status: 404, title: "Попытка не найдена" });
  }
  requireOrganizationAccess(session, attempt.organization_id);

  const [questionResult, optionResult] = await Promise.all([
    env.DB.prepare(
      `SELECT q.id, q.type, q.text, q.position, q.is_scored, q.points,
              ans.value_kind, ans.rating_value
       FROM questions q
       LEFT JOIN answers ans ON ans.question_id = q.id AND ans.attempt_id = ?1
       WHERE q.assessment_version_id = ?2
       ORDER BY q.position`,
    ).bind(attemptId, attempt.assessment_version_id).all<QuestionDetailRow>(),
    env.DB.prepare(
      `SELECT qo.id, qo.question_id, qo.text, qo.position, qo.is_correct,
              CASE WHEN ao.option_id IS NULL THEN 0 ELSE 1 END AS is_selected
       FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       LEFT JOIN answers ans ON ans.question_id = q.id AND ans.attempt_id = ?1
       LEFT JOIN answer_options ao ON ao.answer_id = ans.id AND ao.option_id = qo.id
       WHERE q.assessment_version_id = ?2
       ORDER BY q.position, qo.position`,
    ).bind(attemptId, attempt.assessment_version_id).all<OptionDetailRow>(),
  ]);
  const optionsByQuestion = new Map<string, OptionDetailRow[]>();
  for (const option of optionResult.results) {
    const options = optionsByQuestion.get(option.question_id) ?? [];
    options.push(option);
    optionsByQuestion.set(option.question_id, options);
  }
  const answers = questionResult.results.map((question) => {
    const options = optionsByQuestion.get(question.id) ?? [];
    const selected = options.filter((option) => option.is_selected === 1);
    const correct = options.filter((option) => option.is_correct === 1);
    const answered = question.type === "rating" ? question.rating_value !== null : selected.length > 0;
    const exact = question.is_scored === 1
      && selected.length === correct.length
      && correct.length > 0
      && selected.every((option) => option.is_correct === 1);
    return {
      questionId: question.id,
      position: question.position,
      questionText: question.text,
      answerText: !answered
        ? "Без ответа"
        : question.type === "rating"
          ? String(question.rating_value)
          : selected.map((option) => option.text).join(", "),
      correctAnswerText: question.is_scored === 1 ? correct.map((option) => option.text).join(", ") : null,
      isCorrect: question.is_scored === 1 ? exact : null,
      pointsAwarded: question.is_scored === 1 && attempt.score !== null ? (exact ? question.points : 0) : null,
      maxPoints: question.is_scored === 1 ? question.points : null,
    };
  });
  const body: OrganizerAttemptDetailDTO = {
    ...attemptDto(attempt),
    publicationId: attempt.publication_id,
    assessmentTitle: attempt.assessment_title,
    answers,
  };
  return jsonResponse(body, requestId);
}

function isoDate(value: number | null): string {
  return value === null ? "" : new Date(value).toISOString();
}

async function exportRoute(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  publicationId: string,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(requestId, ["GET"]);
  const publication = await publicationAccess(env.DB, session, publicationId);
  if (!publication) return missingPublication(requestId);
  const result = await env.DB.prepare(
    `SELECT att.id, att.display_name, att.status, att.completion_reason,
            att.started_at, att.updated_at, att.submitted_at, r.score, r.max_score
     FROM attempts att
     LEFT JOIN results r ON r.attempt_id = att.id
     WHERE att.publication_id = ?1
     ORDER BY att.started_at DESC, att.id DESC
     LIMIT 10001`,
  ).bind(publicationId).all<AttemptListRow>();
  if (result.results.length > 10_000) {
    return problemResponse({
      code: "bad_request",
      detail: "Синхронный экспорт ограничен 10 000 попытками.",
      requestId,
      status: 413,
      title: "Экспорт слишком большой",
    });
  }
  const rows = [
    csvRow(["ID попытки", "Участник", "Статус", "Причина завершения", "Начало", "Завершение", "Балл", "Максимум", "Процент"]),
    ...result.results.map((row) => {
      const dto = attemptDto(row);
      return csvRow([
        dto.id,
        dto.displayName,
        dto.status,
        dto.completionReason,
        isoDate(dto.startedAt),
        isoDate(dto.completedAt),
        dto.score,
        dto.maxScore,
        dto.scorePercent,
      ]);
    }),
  ];
  return new Response(`\uFEFF${rows.join("\r\n")}\r\n`, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": "attachment; filename=\"vecta-results.csv\"",
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}

export async function routeResultsApi(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const overview = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/results\/overview$/);
  if (overview?.[1]) return overviewRoute(request, env, session, requestId, decodeURIComponent(overview[1]));
  const questions = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/results\/questions$/);
  if (questions?.[1]) return questionsRoute(request, env, session, requestId, decodeURIComponent(questions[1]));
  const attempts = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/attempts$/);
  if (attempts?.[1]) return attemptsRoute(request, env, session, requestId, decodeURIComponent(attempts[1]));
  const detail = pathname.match(/^\/api\/v1\/attempts\/([^/]+)\/detail$/);
  if (detail?.[1]) return attemptDetailRoute(request, env, session, requestId, decodeURIComponent(detail[1]));
  const exportCsv = pathname.match(/^\/api\/v1\/publications\/([^/]+)\/export\.csv$/);
  if (exportCsv?.[1]) return exportRoute(request, env, session, requestId, decodeURIComponent(exportCsv[1]));
  return null;
}
