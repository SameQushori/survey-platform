import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const organizerHeaders = {
  "x-vecta-local-email": "organizer@vecta.local",
  "x-vecta-local-subject": "local:organizer",
};

function apiRequest(path: string, headers: HeadersInit = organizerHeaders, init: RequestInit = {}): Request {
  return new Request(`https://vecta.test${path}`, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(headers)), ...Object.fromEntries(new Headers(init.headers)) },
  });
}

describe("Vecta organizer identity and tenant authorization", () => {
  it("returns 401 when the organizer identity is absent", async () => {
    const response = await exports.default.fetch("https://vecta.test/api/v1/session");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "unauthorized" });
  });

  it("resolves an organizer session only through an active membership", async () => {
    const response = await exports.default.fetch(apiRequest("/api/v1/session"));
    const body = await response.json<{ memberships: Array<{ organizationId: string }>; user: Record<string, unknown> }>();
    expect(response.status).toBe(200);
    expect(body.user).not.toHaveProperty("platformRole");
    expect(body.memberships).toEqual([
      expect.objectContaining({ organizationId: "org_vecta", role: "organizer" }),
    ]);
  });

  it("enforces organization membership for workspace context", async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
       VALUES ('org_isolated', 'Изолированная организация', 'isolated', 'active', ?1, ?1)`,
    ).bind(now).run();

    const response = await exports.default.fetch(apiRequest("/api/v1/organizations/org_isolated/workspace"));
    expect(response.status).toBe(403);
  });

  it("does not expose the retired platform administration API", async () => {
    const response = await exports.default.fetch(apiRequest("/api/v1/organizations"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "not_found" });
  });
});
