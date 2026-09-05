import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const organizerHeaders = {
  "x-vecta-local-email": "organizer@vecta.local",
  "x-vecta-local-subject": "local:organizer",
};

const adminHeaders = {
  "x-vecta-local-email": "admin@vecta.local",
  "x-vecta-local-subject": "local:super-admin",
};

function apiRequest(path: string, headers: HeadersInit, init: RequestInit = {}): Request {
  return new Request(`https://vecta.test${path}`, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(headers)), ...Object.fromEntries(new Headers(init.headers)) },
  });
}

describe("Vecta identity and organization authorization", () => {
  it("returns 401 when the organizer identity is absent", async () => {
    const response = await exports.default.fetch("https://vecta.test/api/v1/session");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "unauthorized" });
  });

  it("resolves an organizer session exclusively from the server-side membership", async () => {
    const response = await exports.default.fetch(apiRequest("/api/v1/session", organizerHeaders));
    const body = await response.json<{ memberships: Array<{ organizationId: string }>; user: { platformRole: string | null } }>();
    expect(response.status).toBe(200);
    expect(body.user.platformRole).toBeNull();
    expect(body.memberships).toEqual([
      expect.objectContaining({ organizationId: "org_vecta", role: "organizer" }),
    ]);
  });

  it("does not grant Super Admin endpoints to an organizer", async () => {
    const response = await exports.default.fetch(apiRequest("/api/v1/organizations", organizerHeaders));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "forbidden" });
  });

  it("enforces organization membership for workspace context", async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
       VALUES ('org_isolated', 'Изолированная организация', 'isolated', 'active', ?1, ?1)`,
    ).bind(now).run();

    const response = await exports.default.fetch(
      apiRequest("/api/v1/organizations/org_isolated/workspace", organizerHeaders),
    );
    expect(response.status).toBe(403);
  });

  it("lets Super Admin create an organization and records a non-PII audit event", async () => {
    const slug = `quality-${crypto.randomUUID().slice(0, 8)}`;
    const response = await exports.default.fetch(
      apiRequest("/api/v1/organizations", adminHeaders, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Контроль качества", slug }),
      }),
    );
    const body = await response.json<{ id: string }>();
    expect(response.status).toBe(201);

    const event = await env.DB.prepare(
      "SELECT action, actor_user_id, metadata_json FROM audit_log WHERE entity_id = ?1",
    ).bind(body.id).first<{ action: string; actor_user_id: string; metadata_json: string }>();
    expect(event).toMatchObject({ action: "organization.created", actor_user_id: "user_super_admin" });
    expect(event?.metadata_json).toBe("{}");
  });

  it("preprovisions an organizer by normalized email without putting email in audit metadata", async () => {
    const email = `new-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const response = await exports.default.fetch(
      apiRequest("/api/v1/organizations/org_vecta/members", adminHeaders, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Новый организатор", email: email.toUpperCase() }),
      }),
    );
    const body = await response.json<{ membershipId: string; userId: string; email: string }>();
    expect(response.status).toBe(201);
    expect(body.email).toBe(email);

    const user = await env.DB.prepare("SELECT auth_subject FROM users WHERE id = ?1").bind(body.userId).first<{ auth_subject: string }>();
    expect(user?.auth_subject).toBe(`pending:${email}`);
    const event = await env.DB.prepare("SELECT metadata_json FROM audit_log WHERE entity_id = ?1").bind(body.membershipId).first<{ metadata_json: string }>();
    expect(event?.metadata_json).not.toContain(email);
    expect(event?.metadata_json).toContain(body.userId);
  });

  it("lets Super Admin disable and restore one membership with an audit event", async () => {
    const email = `status-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const created = await exports.default.fetch(
      apiRequest("/api/v1/organizations/org_vecta/members", adminHeaders, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Управление доступом", email }),
      }),
    );
    const member = await created.json<{ membershipId: string }>();
    expect(created.status).toBe(201);

    const disable = await exports.default.fetch(
      apiRequest(`/api/v1/organizations/org_vecta/members/${member.membershipId}`, adminHeaders, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "disabled" }),
      }),
    );
    expect(disable.status).toBe(200);
    await expect(disable.json()).resolves.toMatchObject({ membershipId: member.membershipId, status: "disabled" });

    const disabled = await env.DB.prepare("SELECT status FROM memberships WHERE id = ?1")
      .bind(member.membershipId)
      .first<{ status: string }>();
    expect(disabled?.status).toBe("disabled");

    const restore = await exports.default.fetch(
      apiRequest(`/api/v1/organizations/org_vecta/members/${member.membershipId}`, adminHeaders, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }),
    );
    expect(restore.status).toBe(200);
    await expect(restore.json()).resolves.toMatchObject({ membershipId: member.membershipId, status: "active" });

    const event = await env.DB.prepare(
      "SELECT metadata_json FROM audit_log WHERE entity_id = ?1 AND action = 'membership.updated' ORDER BY created_at DESC LIMIT 1",
    ).bind(member.membershipId).first<{ metadata_json: string }>();
    expect(event?.metadata_json).toBe('{"status":"active"}');
    expect(event?.metadata_json).not.toContain(email);
  });
});
