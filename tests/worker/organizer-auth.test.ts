import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { authenticateRequest, authSecretDigest, IdentityError, verifyAuthSecretDigest } from "../../worker/auth";
import { routeOrganizerAuth } from "../../worker/organizer-auth";
import { network } from "./network";

function sessionEnv(): Env {
  return {
    ...env,
    APP_ENV: "staging",
    AUTH_MODE: "session",
    AUTH_EMAIL_PROVIDER: "resend",
    AUTH_EMAIL_FROM: "Vecta <onboarding@resend.dev>",
    AUTH_TOKEN_SECRET: "worker-test-auth-secret-with-enough-entropy",
    RESEND_API_KEY: "re_test_key",
  } as Env;
}

function authRequest(path: string, body?: unknown, cookie?: string): Request {
  return new Request(`https://vecta.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function allowTurnstile(): void {
  network.use(
    http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () => HttpResponse.json({
      success: true,
      action: "organizer_login",
      hostname: "vecta.test",
    })),
  );
}

function executionContext(): { ctx: ExecutionContext; drain: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      passThroughOnException() {},
      waitUntil(promise: Promise<unknown>) { pending.push(promise); },
    } as unknown as ExecutionContext,
    drain: () => Promise.all(pending).then(() => undefined),
  };
}

function allowedEnv(): Env {
  return {
    ...sessionEnv(),
    TURNSTILE_HOSTNAMES: "vecta.test",
    TURNSTILE_SITEKEY: "test-sitekey",
    TURNSTILE_SECRET: "test-turnstile-secret",
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) } as RateLimit,
  } as unknown as Env;
}

describe("Vecta organizer session authentication", () => {
  it("verifies HMAC digests without comparing the raw secret", async () => {
    const testEnv = sessionEnv();
    const digest = await authSecretDigest(testEnv, "organizer-login-code", "challenge:123456");

    await expect(verifyAuthSecretDigest(testEnv, "organizer-login-code", "challenge:123456", digest)).resolves.toBe(true);
    await expect(verifyAuthSecretDigest(testEnv, "organizer-login-code", "challenge:654321", digest)).resolves.toBe(false);
  });

  it("resolves a valid HttpOnly session token through its stored digest", async () => {
    const testEnv = sessionEnv();
    const token = "A".repeat(43);
    const digest = await authSecretDigest(testEnv, "session", token);
    const now = Date.now();
    await testEnv.DB.prepare(
      `INSERT INTO organizer_auth_sessions
       (id, user_id, token_digest, expires_at, created_at, last_seen_at)
       VALUES (?1, 'user_organizer', ?2, ?3, ?4, ?4)`,
    ).bind(`session_${crypto.randomUUID()}`, digest, now + 60_000, now).run();

    const identity = await authenticateRequest(new Request("https://vecta.test/api/v1/session", {
      headers: { cookie: `__Host-vecta_session=${token}` },
    }), testEnv);

    expect(identity).toEqual({ email: "organizer@vecta.local", subject: "local:organizer" });
  });

  it("rejects cookie-authenticated cross-site mutations", async () => {
    const request = new Request("https://vecta.test/api/v1/organizations", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    await expect(authenticateRequest(request, sessionEnv())).rejects.toMatchObject({ status: 401 } satisfies Partial<IdentityError>);
  });

  it("keeps local header identity disabled outside local development", async () => {
    const request = new Request("https://app.vecta.test/api/v1/session", {
      headers: { "x-vecta-local-email": "organizer@vecta.local", "x-vecta-local-subject": "local:organizer" },
    });
    const testEnv = { ...sessionEnv(), AUTH_MODE: "local" } as Env;
    await expect(authenticateRequest(request, testEnv)).rejects.toMatchObject({ status: 500 } satisfies Partial<IdentityError>);
  });

  it("sends a one-time code, creates a session, and revokes it on logout", async () => {
    allowTurnstile();
    const testEnv = allowedEnv();
    let deliveredCode = "";
    network.use(http.post("https://api.resend.com/emails", async ({ request }) => {
      expect(request.headers.get("authorization")).toBe("Bearer re_test_key");
      expect(request.headers.get("idempotency-key")).toMatch(/^challenge_/);
      const body = await request.json() as { text: string; to: string[] };
      deliveredCode = body.text.match(/\b\d{6}\b/)?.[0] ?? "";
      expect(body.to).toEqual(["admin@vecta.local"]);
      return HttpResponse.json({ id: "email_test" });
    }));
    const context = executionContext();

    const requested = await routeOrganizerAuth(authRequest("/api/v1/auth/request-code", {
      email: "ADMIN@VECTA.LOCAL",
      turnstileToken: "turnstile-test-token",
    }), testEnv, context.ctx, crypto.randomUUID());
    expect(requested?.status).toBe(202);
    const challenge = await requested?.json() as { challengeId: string };
    await context.drain();
    expect(deliveredCode).toMatch(/^\d{6}$/);

    const verified = await routeOrganizerAuth(authRequest("/api/v1/auth/verify-code", {
      challengeId: challenge.challengeId,
      code: deliveredCode,
    }), testEnv, executionContext().ctx, crypto.randomUUID());
    expect(verified?.status).toBe(200);
    const setCookie = verified?.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-vecta_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    const cookie = setCookie.split(";", 1)[0] ?? "";

    await expect(authenticateRequest(new Request("https://vecta.test/api/v1/session", { headers: { cookie } }), testEnv))
      .resolves.toMatchObject({ email: "admin@vecta.local", subject: "local:super-admin" });

    const loggedOut = await routeOrganizerAuth(authRequest("/api/v1/auth/logout", {}, cookie), testEnv, executionContext().ctx, crypto.randomUUID());
    expect(loggedOut?.status).toBe(200);
    await expect(authenticateRequest(new Request("https://vecta.test/api/v1/session", { headers: { cookie } }), testEnv))
      .rejects.toMatchObject({ status: 401 });
  });

  it("makes a code unusable after five failed attempts", async () => {
    allowTurnstile();
    const testEnv = allowedEnv();
    let deliveredCode = "";
    network.use(http.post("https://api.resend.com/emails", async ({ request }) => {
      const body = await request.json() as { text: string };
      deliveredCode = body.text.match(/\b\d{6}\b/)?.[0] ?? "";
      return HttpResponse.json({ id: "email_test" });
    }));
    const context = executionContext();
    const requested = await routeOrganizerAuth(authRequest("/api/v1/auth/request-code", {
      email: "organizer@vecta.local",
      turnstileToken: "turnstile-test-token",
    }), testEnv, context.ctx, crypto.randomUUID());
    const challenge = await requested?.json() as { challengeId: string };
    await context.drain();
    const wrongCode = deliveredCode === "000000" ? "000001" : "000000";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await routeOrganizerAuth(authRequest("/api/v1/auth/verify-code", {
        challengeId: challenge.challengeId,
        code: wrongCode,
      }), testEnv, executionContext().ctx, crypto.randomUUID());
      expect(response?.status).toBe(401);
    }
    const stored = await testEnv.DB.prepare("SELECT status, failed_attempts FROM organizer_auth_challenges WHERE id = ?1")
      .bind(challenge.challengeId).first<{ status: string; failed_attempts: number }>();
    expect(stored).toEqual({ status: "expired", failed_attempts: 5 });
  });

  it("does not reveal whether an email exists when delivery fails", async () => {
    allowTurnstile();
    const testEnv = allowedEnv();
    network.use(http.post("https://api.resend.com/emails", () => new HttpResponse(null, { status: 500 })));
    const knownContext = executionContext();
    const unknownContext = executionContext();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const known = await routeOrganizerAuth(authRequest("/api/v1/auth/request-code", {
      email: "organizer@vecta.local",
      turnstileToken: "known-token",
    }), testEnv, knownContext.ctx, crypto.randomUUID());
    const unknown = await routeOrganizerAuth(authRequest("/api/v1/auth/request-code", {
      email: "unknown@example.com",
      turnstileToken: "unknown-token",
    }), testEnv, unknownContext.ctx, crypto.randomUUID());
    const knownBody = await known?.json() as Record<string, unknown>;
    const unknownBody = await unknown?.json() as Record<string, unknown>;
    await Promise.all([knownContext.drain(), unknownContext.drain()]);

    expect(known?.status).toBe(202);
    expect(unknown?.status).toBe(202);
    expect(Object.keys(knownBody).sort()).toEqual(Object.keys(unknownBody).sort());
    const stored = await testEnv.DB.prepare("SELECT id FROM organizer_auth_challenges WHERE id = ?1")
      .bind(knownBody.challengeId).first();
    expect(stored).toBeNull();
    expect(errorLog).toHaveBeenCalledOnce();
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
      errorName: "EmailProviderError",
      event: "organizer_login_email_failed",
      providerStatus: 500,
    });
    errorLog.mockRestore();
  });
});
