import { env, exports } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { verifyTurnstile } from "../../worker/turnstile";
import { network } from "./network";

const organizerHeaders = {
  "x-vecta-local-email": "organizer@vecta.local",
  "x-vecta-local-subject": "local:organizer",
};

function apiRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://vecta.test${path}`, init);
}

function organizerRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(organizerHeaders)) headers.set(name, value);
  return apiRequest(path, { ...init, headers });
}

function mockSuccessfulTurnstile(): void {
  network.use(http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () => HttpResponse.json({
    success: true,
    action: "test",
    hostname: "localhost",
  })));
}

async function publishAssessment(showParticipantResult = true, accessMode: "open" | "controlled" = "open") {
  const title = `Participant ${crypto.randomUUID()}`;
  const created = await exports.default.fetch(organizerRequest("/api/v1/organizations/org_vecta/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  }));
  const { id: assessmentId } = await created.json<{ id: string }>();
  const questionId = `question_${crypto.randomUUID()}`;
  const correctOptionId = `option_${crypto.randomUUID()}`;
  const wrongOptionId = `option_${crypto.randomUUID()}`;
  const draft = {
    title,
    description: "Безопасный participant snapshot",
    durationSeconds: 900,
    questions: [{
      id: questionId,
      type: "single_choice",
      text: "Где хранить рабочий пароль?",
      position: 0,
      required: true,
      scored: true,
      points: 2,
      options: [
        { id: correctOptionId, text: "В менеджере паролей", position: 0, isCorrect: true },
        { id: wrongOptionId, text: "В общем чате", position: 1, isCorrect: false },
      ],
    }],
    settings: {
      accessMode,
      openRepeatPolicy: accessMode === "open" ? "best_effort_once" : null,
      showParticipantResult,
      opensAt: null,
      closesAt: null,
    },
  };
  const saved = await exports.default.fetch(organizerRequest(`/api/v1/assessments/${assessmentId}/draft`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": "\"1\"" },
    body: JSON.stringify(draft),
  }));
  expect(saved.status).toBe(200);
  const published = await exports.default.fetch(organizerRequest(`/api/v1/assessments/${assessmentId}/publish`, {
    method: "POST",
    headers: { "if-match": "\"2\"", "idempotency-key": crypto.randomUUID() },
  }));
  expect(published.status).toBe(201);
  const body = await published.json<{ publicationId: string; access: { code: string | null } }>();
  return { ...body, assessmentId, questionId, correctOptionId, wrongOptionId };
}

async function createAttempt(code: string, participantIdentity = crypto.randomUUID()) {
  const response = await exports.default.fetch(apiRequest("/api/v1/attempts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      displayName: "Анна Петрова",
      participantIdentity,
      turnstileToken: "test-turnstile-token",
    }),
  }));
  const body = await response.json<{ attemptId: string; attemptToken: string; assessment: { questions: Array<{ id: string; options?: Array<{ id: string }> }> } }>();
  return { response, body };
}

describe("participant attempt lifecycle", () => {
  it("resolves a code without leaking questions or the answer key", async () => {
    const publication = await publishAssessment();
    const response = await exports.default.fetch(apiRequest("/api/v1/publications/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: publication.access.code?.toLowerCase() }),
    }));
    const body = await response.json<Record<string, unknown>>();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ title: expect.any(String), accessMode: "open", questionCount: 1 });
    expect(body).not.toHaveProperty("questions");
    expect(JSON.stringify(body)).not.toContain("isCorrect");
  });

  it("creates an attempt, validates answers and submits idempotently", async () => {
    mockSuccessfulTurnstile();
    const publication = await publishAssessment(true);
    const { response: created, body: attempt } = await createAttempt(publication.access.code ?? "");
    expect(created.status).toBe(201);
    expect(JSON.stringify(attempt.assessment)).not.toContain("isCorrect");
    expect(JSON.stringify(attempt.assessment)).not.toContain("points");

    const invalid = await exports.default.fetch(apiRequest(`/api/v1/attempts/${attempt.attemptId}/answers/${publication.questionId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${attempt.attemptToken}`, "content-type": "application/json" },
      body: JSON.stringify({ value: `option_${crypto.randomUUID()}` }),
    }));
    expect(invalid.status).toBe(422);

    const saved = await exports.default.fetch(apiRequest(`/api/v1/attempts/${attempt.attemptId}/answers/${publication.questionId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${attempt.attemptToken}`, "content-type": "application/json" },
      body: JSON.stringify({ value: publication.correctOptionId }),
    }));
    expect(saved.status).toBe(200);

    const idempotencyKey = crypto.randomUUID();
    const submitRequest = () => apiRequest(`/api/v1/attempts/${attempt.attemptId}/submit`, {
      method: "POST",
      headers: { authorization: `Bearer ${attempt.attemptToken}`, "idempotency-key": idempotencyKey },
    });
    const submitted = await exports.default.fetch(submitRequest());
    expect(submitted.status).toBe(200);
    await expect(submitted.json()).resolves.toMatchObject({ result: { completed: true, resultVisible: true, score: 2, maxScore: 2 } });
    const replay = await exports.default.fetch(submitRequest());
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");
    const resultCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM results WHERE attempt_id = ?1").bind(attempt.attemptId).first<{ count: number }>();
    expect(resultCount?.count).toBe(1);
  });

  it("fails closed when Turnstile rejects the token", async () => {
    network.use(http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () => HttpResponse.json({ success: false })));
    const publication = await publishAssessment();
    const { response } = await createAttempt(publication.access.code ?? "");
    expect(response.status).toBe(403);
    const attempts = await env.DB.prepare("SELECT COUNT(*) AS count FROM attempts WHERE publication_id = ?1").bind(publication.publicationId).first<{ count: number }>();
    expect(attempts?.count).toBe(0);
  });

  it("validates the Turnstile action and hostname outside local dummy mode", async () => {
    network.use(http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () => HttpResponse.json({
      success: true,
      action: "another_action",
      hostname: "tests.vecta.example",
    })));
    const result = await verifyTurnstile(
      apiRequest("/api/v1/attempts"),
      {
        APP_ENV: "production",
        AUTH_MODE: "access",
        TURNSTILE_HOSTNAMES: "tests.vecta.example",
        TURNSTILE_SECRET: "test-secret",
        TURNSTILE_SITEKEY: "test-sitekey",
      },
      "valid-looking-token",
      "attempt_start",
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("retries a transient Siteverify failure once with the same idempotency key", async () => {
    const idempotencyKeys: string[] = [];
    let requests = 0;
    network.use(http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", async ({ request }) => {
      requests += 1;
      const form = await request.formData();
      idempotencyKeys.push(String(form.get("idempotency_key")));
      if (requests === 1) return HttpResponse.text("temporary", { status: 503 });
      return HttpResponse.json({ success: true, action: "attempt_start", hostname: "tests.vecta.example" });
    }));
    const result = await verifyTurnstile(
      apiRequest("/api/v1/attempts"),
      {
        APP_ENV: "production",
        AUTH_MODE: "access",
        TURNSTILE_HOSTNAMES: "tests.vecta.example",
        TURNSTILE_SECRET: "test-secret",
        TURNSTILE_SITEKEY: "test-sitekey",
      },
      "valid-looking-token",
      "attempt_start",
    );
    expect(result).toEqual({ ok: true });
    expect(requests).toBe(2);
    expect(new Set(idempotencyKeys).size).toBe(1);
  });

  it("rate limits repeated publication resolution attempts", async () => {
    const statuses: number[] = [];
    for (let requestNumber = 0; requestNumber < 21; requestNumber += 1) {
      const response = await exports.default.fetch(apiRequest("/api/v1/publications/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "Q2W3E4" }),
      }));
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(404));
    expect(statuses[20]).toBe(429);
  });

  it("finalizes saved answers when the server deadline has passed", async () => {
    mockSuccessfulTurnstile();
    const publication = await publishAssessment(false);
    const { body: attempt } = await createAttempt(publication.access.code ?? "");
    const now = Date.now();
    await env.DB.prepare("UPDATE attempts SET started_at = ?1, deadline_at = ?2 WHERE id = ?3")
      .bind(now - 120_000, now - 1, attempt.attemptId).run();
    const state = await exports.default.fetch(apiRequest(`/api/v1/attempts/${attempt.attemptId}`, {
      headers: { authorization: `Bearer ${attempt.attemptToken}` },
    }));
    expect(state.status).toBe(200);
    await expect(state.json()).resolves.toMatchObject({ status: "expired", result: { completed: true, resultVisible: false } });
    const stored = await env.DB.prepare("SELECT completion_reason FROM attempts WHERE id = ?1").bind(attempt.attemptId).first<{ completion_reason: string }>();
    expect(stored?.completion_reason).toBe("deadline");
  });

  it("issues one-time controlled invitations without returning tokens from the list", async () => {
    mockSuccessfulTurnstile();
    const publication = await publishAssessment(false, "controlled");
    const batch = await exports.default.fetch(organizerRequest(`/api/v1/publications/${publication.publicationId}/invitations/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantLabels: ["Анна Петрова"], expiresAt: null }),
    }));
    expect(batch.status).toBe(201);
    const [invitation] = await batch.json<Array<{ id: string; invitationToken: string; joinPath: string }>>();
    expect(invitation?.invitationToken.length).toBeGreaterThanOrEqual(32);
    expect(invitation?.joinPath).toContain("#invite=");

    const list = await exports.default.fetch(organizerRequest(`/api/v1/publications/${publication.publicationId}/invitations`));
    const listed = await list.json<Array<Record<string, unknown>>>();
    expect(list.status).toBe(200);
    expect(listed[0]).not.toHaveProperty("invitationToken");

    const first = await exports.default.fetch(apiRequest("/api/v1/attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationToken: invitation?.invitationToken, displayName: "Анна Петрова", turnstileToken: "test-turnstile-token" }),
    }));
    expect(first.status).toBe(201);
    const second = await exports.default.fetch(apiRequest("/api/v1/attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationToken: invitation?.invitationToken, displayName: "Анна Петрова", turnstileToken: "test-turnstile-token" }),
    }));
    expect(second.status).toBe(200);
    const firstBody = await first.json<{ attemptId: string }>();
    await expect(second.json()).resolves.toMatchObject({ attemptId: firstBody.attemptId });
  });
});
