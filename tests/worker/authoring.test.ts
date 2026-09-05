import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const organizerHeaders = {
  "x-vecta-local-email": "organizer@vecta.local",
  "x-vecta-local-subject": "local:organizer",
};

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(organizerHeaders)) headers.set(name, value);
  return new Request(`https://vecta.test${path}`, { ...init, headers });
}

async function createAssessment(title = "Основы безопасности"): Promise<string> {
  const response = await exports.default.fetch(request("/api/v1/organizations/org_vecta/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  }));
  expect(response.status).toBe(201);
  const body = await response.json<{ id: string }>();
  return body.id;
}

function validDraft(title = "Основы безопасности") {
  return {
    title,
    description: "Короткая проверка знаний",
    durationSeconds: 900,
    questions: [
      {
        id: `question_${crypto.randomUUID()}`,
        type: "single_choice",
        text: "Как хранить рабочие пароли?",
        position: 0,
        required: true,
        scored: true,
        points: 2,
        options: [
          { id: `option_${crypto.randomUUID()}`, text: "В менеджере паролей", position: 0, isCorrect: true },
          { id: `option_${crypto.randomUUID()}`, text: "В общем чате", position: 1, isCorrect: false },
        ],
      },
      {
        id: `question_${crypto.randomUUID()}`,
        type: "rating",
        text: "Насколько понятна политика?",
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
  };
}

async function createPublishedAssessment(title: string) {
  const assessmentId = await createAssessment(title);
  const draft = validDraft(title);
  const saved = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/draft`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": '"1"' },
    body: JSON.stringify(draft),
  }));
  expect(saved.status).toBe(200);
  const published = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/publish`, {
    method: "POST",
    headers: { "if-match": '"2"', "idempotency-key": crypto.randomUUID() },
  }));
  expect(published.status).toBe(201);
  const body = await published.json<{ publicationId: string; version: number }>();
  return { assessmentId, publicationId: body.publicationId, draft };
}

describe("assessment authoring and immutable publishing", () => {
  it("creates an empty revisioned draft and lists it only in its organization", async () => {
    const assessmentId = await createAssessment(`Черновик ${crypto.randomUUID()}`);
    const draftResponse = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/draft`));
    const draft = await draftResponse.json<{ questions: unknown[]; revision: number }>();
    expect(draftResponse.status).toBe(200);
    expect(draftResponse.headers.get("etag")).toBe('"1"');
    expect(draft).toMatchObject({ revision: 1, questions: [] });

    const listResponse = await exports.default.fetch(request("/api/v1/organizations/org_vecta/assessments"));
    const list = await listResponse.json<Array<{ id: string; status: string }>>();
    expect(list).toContainEqual(expect.objectContaining({ id: assessmentId, status: "draft" }));
  });

  it("uses If-Match so a stale editor cannot overwrite a newer draft", async () => {
    const assessmentId = await createAssessment(`Revision ${crypto.randomUUID()}`);
    const payload = validDraft();
    const first = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify(payload),
    }));
    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe('"2"');

    const stale = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({ ...payload, title: "Затёртое название" }),
    }));
    expect(stale.status).toBe(409);
    const stored = await env.DB.prepare("SELECT title, revision FROM assessment_versions WHERE assessment_id = ?1 AND state = 'draft'").bind(assessmentId).first<{ title: string; revision: number }>();
    expect(stored).toMatchObject({ title: payload.title, revision: 2 });
  });

  it("blocks publication of an incomplete draft", async () => {
    const assessmentId = await createAssessment(`Пустой ${crypto.randomUUID()}`);
    const response = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/publish`, {
      method: "POST",
      headers: { "if-match": '"1"', "idempotency-key": crypto.randomUUID() },
    }));
    expect(response.status).toBe(422);
    const publication = await env.DB.prepare("SELECT id FROM publications WHERE assessment_id = ?1").bind(assessmentId).first();
    expect(publication).toBeNull();
  });

  it("publishes one immutable normalized snapshot and replays the idempotent response", async () => {
    const assessmentId = await createAssessment(`Publish ${crypto.randomUUID()}`);
    const payload = validDraft();
    const save = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify(payload),
    }));
    expect(save.status).toBe(200);
    const idempotencyKey = crypto.randomUUID();
    const publishRequest = () => request(`/api/v1/assessments/${assessmentId}/publish`, {
      method: "POST",
      headers: { "if-match": '"2"', "idempotency-key": idempotencyKey },
    });
    const published = await exports.default.fetch(publishRequest());
    const body = await published.json<{ publicationId: string; access: { code: string } }>();
    expect(published.status).toBe(201);
    expect(body.access.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    const replay = await exports.default.fetch(publishRequest());
    expect(replay.status).toBe(201);
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");
    await expect(replay.json()).resolves.toEqual(body);

    const version = await env.DB.prepare("SELECT state, draft_json, content_hash FROM assessment_versions WHERE assessment_id = ?1").bind(assessmentId).first<{ state: string; draft_json: string | null; content_hash: string }>();
    expect(version).toMatchObject({ state: "published", draft_json: null });
    expect(version?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const questionCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM questions q JOIN assessment_versions av ON av.id = q.assessment_version_id WHERE av.assessment_id = ?1").bind(assessmentId).first<{ total: number }>();
    expect(questionCount?.total).toBe(2);
    const publication = await env.DB.prepare("SELECT code_digest, code_hint FROM publications WHERE id = ?1").bind(body.publicationId).first<{ code_digest: string; code_hint: string }>();
    expect(publication?.code_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(publication?.code_digest).not.toContain(body.access.code);
    expect(publication?.code_hint).toBe(body.access.code.slice(-2));
  });

  it("closes and archives a publication without deleting its snapshot", async () => {
    const assessmentId = await createAssessment(`Lifecycle ${crypto.randomUUID()}`);
    const payload = validDraft();
    await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify(payload),
    }));
    const published = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/publish`, {
      method: "POST",
      headers: { "if-match": '"2"', "idempotency-key": crypto.randomUUID() },
    }));
    const { publicationId } = await published.json<{ publicationId: string }>();

    const close = await exports.default.fetch(request(`/api/v1/publications/${publicationId}/close`, { method: "POST" }));
    expect(close.status).toBe(200);
    const archive = await exports.default.fetch(request(`/api/v1/assessments/${assessmentId}/archive`, { method: "POST" }));
    expect(archive.status).toBe(200);
    const snapshot = await env.DB.prepare("SELECT COUNT(*) AS total FROM questions q JOIN assessment_versions av ON av.id = q.assessment_version_id WHERE av.assessment_id = ?1").bind(assessmentId).first<{ total: number }>();
    expect(snapshot?.total).toBe(2);
  });

  it("reopens a completed publication and preserves its stored snapshot", async () => {
    const fixture = await createPublishedAssessment(`Reopen ${crypto.randomUUID()}`);
    const closed = await exports.default.fetch(request(`/api/v1/publications/${fixture.publicationId}/close`, { method: "POST" }));
    expect(closed.status).toBe(200);
    await env.DB.prepare("UPDATE publications SET closes_at = ?1 WHERE id = ?2").bind(Date.now() - 1, fixture.publicationId).run();

    const reopened = await exports.default.fetch(request(`/api/v1/publications/${fixture.publicationId}/reopen`, { method: "POST" }));
    expect(reopened.status).toBe(200);
    await expect(reopened.json()).resolves.toMatchObject({
      assessmentId: fixture.assessmentId,
      publicationId: fixture.publicationId,
      status: "published",
      closesAt: null,
    });
    const lifecycle = await env.DB.prepare(
      `SELECT a.status AS assessment_status, p.status AS publication_status, p.closed_at, p.closes_at
       FROM assessments a JOIN publications p ON p.assessment_id = a.id
       WHERE a.id = ?1 AND p.id = ?2`,
    ).bind(fixture.assessmentId, fixture.publicationId).first<{
      assessment_status: string;
      publication_status: string;
      closed_at: number | null;
      closes_at: number | null;
    }>();
    expect(lifecycle).toEqual({ assessment_status: "published", publication_status: "published", closed_at: null, closes_at: null });
    const snapshot = await env.DB.prepare("SELECT COUNT(*) AS total FROM questions WHERE assessment_version_id IN (SELECT id FROM assessment_versions WHERE assessment_id = ?1)").bind(fixture.assessmentId).first<{ total: number }>();
    expect(snapshot?.total).toBe(2);
  });

  it("creates a new editable version from a running publication without mutating history", async () => {
    const fixture = await createPublishedAssessment(`Revise ${crypto.randomUUID()}`);
    const originalQuestionIds = fixture.draft.questions.map((question) => question.id);

    const revised = await exports.default.fetch(request(`/api/v1/assessments/${fixture.assessmentId}/revise`, { method: "POST" }));
    expect(revised.status).toBe(201);
    expect(revised.headers.get("etag")).toBe('"1"');
    const draft = await revised.json<{ revision: number; title: string; questions: Array<{ id: string; text: string }> }>();
    expect(draft).toMatchObject({ revision: 1, title: fixture.draft.title });
    expect(draft.questions.map((question) => question.text)).toEqual(fixture.draft.questions.map((question) => question.text));
    expect(draft.questions.map((question) => question.id)).not.toEqual(originalQuestionIds);

    const lifecycle = await env.DB.prepare(
      `SELECT a.status AS assessment_status, p.status AS publication_status
       FROM assessments a JOIN publications p ON p.assessment_id = a.id
       WHERE a.id = ?1 AND p.id = ?2`,
    ).bind(fixture.assessmentId, fixture.publicationId).first<{ assessment_status: string; publication_status: string }>();
    expect(lifecycle).toEqual({ assessment_status: "draft", publication_status: "closed" });
    const versionsBeforeRepublish = await env.DB.prepare("SELECT state, version_number FROM assessment_versions WHERE assessment_id = ?1 ORDER BY version_number").bind(fixture.assessmentId).all<{ state: string; version_number: number }>();
    expect(versionsBeforeRepublish.results).toEqual([
      { state: "published", version_number: 1 },
      { state: "draft", version_number: 2 },
    ]);

    const republished = await exports.default.fetch(request(`/api/v1/assessments/${fixture.assessmentId}/publish`, {
      method: "POST",
      headers: { "if-match": '"1"', "idempotency-key": crypto.randomUUID() },
    }));
    expect(republished.status).toBe(201);
    await expect(republished.json()).resolves.toMatchObject({ assessmentId: fixture.assessmentId, version: 2 });
    const publicationCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM publications WHERE assessment_id = ?1").bind(fixture.assessmentId).first<{ total: number }>();
    expect(publicationCount?.total).toBe(2);
    const oldSnapshot = await env.DB.prepare("SELECT COUNT(*) AS total FROM questions WHERE assessment_version_id = (SELECT assessment_version_id FROM publications WHERE id = ?1)").bind(fixture.publicationId).first<{ total: number }>();
    expect(oldSnapshot?.total).toBe(2);
    const listResponse = await exports.default.fetch(request("/api/v1/organizations/org_vecta/assessments"));
    const list = await listResponse.json<Array<{ id: string; publications: Array<{ publicationId: string; version: number }> }>>();
    const listedAssessment = list.find((item) => item.id === fixture.assessmentId);
    expect(listedAssessment?.publications).toHaveLength(2);
    expect(listedAssessment?.publications.map((publication) => publication.version)).toEqual([2, 1]);
  });

  it("rejects an organizer attempting to author in another tenant", async () => {
    const response = await exports.default.fetch(request("/api/v1/organizations/org_isolated/assessments"));
    expect(response.status).toBe(403);
  });
});
