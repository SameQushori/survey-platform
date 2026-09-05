import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Vecta Worker API foundation", () => {
  it("reports Worker and D1 health without exposing configuration", async () => {
    const response = await exports.default.fetch("https://vecta.test/api/health");
    const body = await response.json<{
      checks: { database: string };
      status: string;
    }>();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", checks: { database: "ok" } });
    expect(JSON.stringify(body)).not.toContain("database_name");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("preserves a safe caller request ID", async () => {
    const response = await exports.default.fetch(
      new Request("https://vecta.test/api/health", {
        headers: { "x-request-id": "test-request-123" },
      }),
    );

    expect(response.headers.get("x-request-id")).toBe("test-request-123");
  });

  it("returns the shared problem format for an unknown API route", async () => {
    const response = await exports.default.fetch("https://vecta.test/api/missing");
    const body = await response.json<{
      code: string;
      requestId: string;
      status: number;
      type: string;
    }>();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).toMatchObject({
      code: "not_found",
      status: 404,
      type: "https://vecta.invalid/problems/not_found",
    });
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("rejects unsupported methods and advertises the allowed method", async () => {
    const response = await exports.default.fetch(
      new Request("https://vecta.test/api/health", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
