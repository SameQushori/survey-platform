import { env, exports } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { network } from "./network";

const organizerHeaders = {
  "x-vecta-local-email": "organizer@vecta.local",
  "x-vecta-local-subject": "local:organizer",
};

function apiRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://vecta.test${path}`, init);
}

function authorizedRequest(
  path: string,
  identity: Record<string, string> = organizerHeaders,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(identity)) headers.set(name, value);
  return apiRequest(path, { ...init, headers });
}

function mockSuccessfulTurnstile(): void {
  network.use(http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () => HttpResponse.json({
    success: true,
    action: "test",
    hostname: "localhost",
  })));
}

async function publishFixture(
  organizationId = "org_vecta",
  identity: Record<string, string> = organizerHeaders,
) {
  const title = `Analytics ${crypto.randomUUID()}`;
  const created = await exports.default.fetch(authorizedRequest(`/api/v1/organizations/${organizationId}/assessments`, identity, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  }));
  expect(created.status).toBe(201);
  const { id: assessmentId } = await created.json<{ id: string }>();
  const questionId = `question_${crypto.randomUUID()}`;
  const ratingId = `question_${crypto.randomUUID()}`;
  const correctOptionId = `option_${crypto.randomUUID()}`;
  const wrongOptionId = `option_${crypto.randomUUID()}`;
  const saved = await exports.default.fetch(authorizedRequest(`/api/v1/assessments/${assessmentId}/draft`, identity, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": "\"1\"" },
    body: JSON.stringify({
      title,
      description: "Dataset for analytics",
      durationSeconds: null,
      questions: [
        {
          id: questionId,
          type: "single_choice",
          text: "Какой ответ правильный?",
          position: 0,
          required: true,
          scored: true,
          points: 2,
          options: [
            { id: correctOptionId, text: "Правильный", position: 0, isCorrect: true },
            { id: wrongOptionId, text: "Неверный", position: 1, isCorrect: false },
          ],
        },
        {
          id: ratingId,
          type: "rating",
          text: "Оцените понятность",
          position: 1,
          required: false,
          scored: false,
          points: 0,
          scaleMin: 1,
          scaleMax: 5,
        },
      ],
      settings: {
        accessMode: "open",
        openRepeatPolicy: "best_effort_once",
        showParticipantResult: false,
        opensAt: null,
        closesAt: null,
      },
    }),
  }));
  expect(saved.status).toBe(200);
  const published = await exports.default.fetch(authorizedRequest(`/api/v1/assessments/${assessmentId}/publish`, identity, {
    method: "POST",
    headers: { "if-match": "\"2\"", "idempotency-key": crypto.randomUUID() },
  }));
  expect(published.status).toBe(201);
  const body = await published.json<{ publicationId: string; access: { code: string } }>();
  return { ...body, questionId, ratingId, correctOptionId, wrongOptionId };
}

async function createAttempt(code: string, displayName: string) {
  const response = await exports.default.fetch(apiRequest("/api/v1/attempts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      displayName,
      participantIdentity: crypto.randomUUID(),
      turnstileToken: "test-turnstile-token",
    }),
  }));
  expect(response.status).toBe(201);
  return response.json<{ attemptId: string; attemptToken: string }>();
}

async function answer(attemptId: string, token: string, questionId: string, value: string | number) {
  const response = await exports.default.fetch(apiRequest(`/api/v1/attempts/${attemptId}/answers/${questionId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ value }),
  }));
  expect(response.status).toBe(200);
}

async function submit(attemptId: string, token: string) {
  const response = await exports.default.fetch(apiRequest(`/api/v1/attempts/${attemptId}/submit`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
  }));
  expect(response.status).toBe(200);
}

describe("organizer results and exports", () => {
  it("matches the fixture aggregates and returns paginated attempt details", async () => {
    mockSuccessfulTurnstile();
    const fixture = await publishFixture();
    const correct = await createAttempt(fixture.access.code, "Анна Петрова");
    await answer(correct.attemptId, correct.attemptToken, fixture.questionId, fixture.correctOptionId);
    await answer(correct.attemptId, correct.attemptToken, fixture.ratingId, 5);
    await submit(correct.attemptId, correct.attemptToken);

    const wrong = await createAttempt(fixture.access.code, "Иван Смирнов");
    await answer(wrong.attemptId, wrong.attemptToken, fixture.questionId, fixture.wrongOptionId);
    await answer(wrong.attemptId, wrong.attemptToken, fixture.ratingId, 3);
    await submit(wrong.attemptId, wrong.attemptToken);

    const abandoned = await createAttempt(fixture.access.code, "Мария Орлова");
    const abandonedResponse = await exports.default.fetch(apiRequest(`/api/v1/attempts/${abandoned.attemptId}/abandon`, {
      method: "POST",
      headers: { authorization: `Bearer ${abandoned.attemptToken}` },
    }));
    expect(abandonedResponse.status).toBe(200);
    await createAttempt(fixture.access.code, "=1+1");

    const overviewResponse = await exports.default.fetch(authorizedRequest(`/api/v1/publications/${fixture.publicationId}/results/overview`));
    expect(overviewResponse.status).toBe(200);
    const overview = await overviewResponse.json<{
      attempts: { total: number; active: number; completed: number; abandoned: number };
      averageScorePercent: number;
      scoreDistribution: Array<{ range: string; count: number; percent: number }>;
      responseTrend: Array<{ responses: number }>;
    }>();
    expect(overview.attempts).toEqual({ total: 4, active: 1, completed: 2, abandoned: 1 });
    expect(overview.averageScorePercent).toBe(50);
    expect(overview.scoreDistribution).toEqual([
      { range: "0–49", count: 1, percent: 50 },
      { range: "50–69", count: 0, percent: 0 },
      { range: "70–84", count: 0, percent: 0 },
      { range: "85–100", count: 1, percent: 50 },
    ]);
    expect(overview.responseTrend.reduce((sum, point) => sum + point.responses, 0)).toBe(2);

    const questionsResponse = await exports.default.fetch(authorizedRequest(`/api/v1/publications/${fixture.publicationId}/results/questions`));
    const questions = await questionsResponse.json<{ items: Array<Record<string, unknown>> }>();
    expect(questionsResponse.status).toBe(200);
    expect(questions.items).toEqual([
      expect.objectContaining({ questionId: fixture.questionId, answeredCount: 2, correctCount: 1, correctPercent: 50 }),
      expect.objectContaining({ questionId: fixture.ratingId, answeredCount: 2, correctCount: null, averageRating: 4 }),
    ]);

    const firstPageResponse = await exports.default.fetch(authorizedRequest(`/api/v1/publications/${fixture.publicationId}/attempts?limit=2`));
    const firstPage = await firstPageResponse.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    expect(firstPageResponse.status).toBe(200);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPageResponse = await exports.default.fetch(authorizedRequest(`/api/v1/publications/${fixture.publicationId}/attempts?limit=2&cursor=${firstPage.nextCursor}`));
    const secondPage = await secondPageResponse.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    expect(secondPage.items).toHaveLength(2);
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size).toBe(4);

    const detailResponse = await exports.default.fetch(authorizedRequest(`/api/v1/attempts/${wrong.attemptId}/detail`));
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      id: wrong.attemptId,
      score: 0,
      maxScore: 2,
      answers: [
        { questionId: fixture.questionId, answerText: "Неверный", correctAnswerText: "Правильный", isCorrect: false, pointsAwarded: 0, maxPoints: 2 },
        { questionId: fixture.ratingId, answerText: "3", isCorrect: null },
      ],
    });

    const exportResponse = await exports.default.fetch(authorizedRequest(`/api/v1/publications/${fixture.publicationId}/export.csv`));
    const csv = await exportResponse.text();
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-disposition")).toContain("attachment");
    expect(csv).toContain('"\'=1+1"');
    expect(csv).not.toContain('\r\n"=1+1"');
  });

  it("does not expose another organization's results or export", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org_${suffix}`;
    const membershipId = `membership_${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
         VALUES (?1, 'Изолированная организация', ?2, 'active', ?3, ?3)`,
      ).bind(organizationId, `isolated-${suffix}`, now),
      env.DB.prepare(
        `INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, updated_at)
         VALUES (?1, ?2, 'user_organizer', 'organizer', 'active', ?3, ?3)`,
      ).bind(membershipId, organizationId, now),
    ]);
    const fixture = await publishFixture(organizationId);
    await env.DB.prepare("UPDATE memberships SET status = 'disabled', updated_at = ?1 WHERE id = ?2")
      .bind(Date.now(), membershipId).run();

    const overview = await exports.default.fetch(authorizedRequest(`/api/v1/publications/${fixture.publicationId}/results/overview`));
    const exportResponse = await exports.default.fetch(authorizedRequest(`/api/v1/publications/${fixture.publicationId}/export.csv`));
    expect(overview.status).toBe(403);
    expect(exportResponse.status).toBe(403);
    expect(exportResponse.headers.get("content-type")).toContain("application/problem+json");
  });
});
