import { z } from "zod";

import type { OrganizerLoginChallengeDTO, OrganizerLoginVerificationDTO } from "../shared/contracts";
import { authSecretDigest, organizerSessionCookie, verifyAuthSecretDigest } from "./auth";
import { jsonResponse, methodNotAllowed, problemResponse, readJsonBody } from "./http";
import { verifyTurnstile } from "./turnstile";

const requestCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  turnstileToken: z.string().min(1).max(2_048),
}).strict();

const verifyCodeSchema = z.object({
  challengeId: z.string().regex(/^challenge_[0-9a-f-]{36}$/),
  code: z.string().regex(/^\d{6}$/),
}).strict();

const challengeLifetimeMs = 10 * 60 * 1_000;
const sessionLifetimeMs = 12 * 60 * 60 * 1_000;
const maxFailedAttempts = 5;

interface LoginUserRow {
  id: string;
  email: string;
}

interface ChallengeRow {
  code_digest: string;
  expires_at: number;
  failed_attempts: number;
  user_id: string;
}

class EmailProviderError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Email provider returned ${status}`);
    this.name = "EmailProviderError";
    this.status = status;
  }
}

function opaqueToken(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function oneTimeCode(): string {
  const value = new Uint32Array(1);
  const unbiasedLimit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(value); while ((value[0] ?? 0) >= unbiasedLimit);
  return String((value[0] ?? 0) % 1_000_000).padStart(6, "0");
}

function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
}

async function allowedByRateLimit(env: Env, key: string): Promise<boolean> {
  if (!env.AUTH_RATE_LIMITER) throw new Error("Organizer authentication rate limiter is not configured");
  const result = await env.AUTH_RATE_LIMITER.limit({ key });
  return result.success;
}

function emailDeliveryConfigured(env: Env): boolean {
  return env.AUTH_EMAIL_PROVIDER === "resend"
    && Boolean(env.AUTH_EMAIL_FROM?.trim())
    && Boolean(env.RESEND_API_KEY?.trim());
}

function loginEmail(code: string): { html: string; subject: string; text: string } {
  const subject = "Код входа в Vecta";
  const text = `Код входа в Vecta: ${code}\n\nОн действует 10 минут и подходит только для одного входа. Если вы не запрашивали код, просто проигнорируйте это письмо.`;
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f8ff;font-family:Arial,sans-serif;color:#0b2447"><div style="max-width:520px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border:1px solid #dbe7f7;border-radius:16px;padding:32px"><p style="margin:0 0 12px;color:#2878ff;font-weight:700">Vecta</p><h1 style="margin:0 0 14px;font-size:24px">Код для входа</h1><p style="margin:0 0 22px;line-height:1.6;color:#55708f">Введите этот код в окне входа. Он действует 10 минут и подходит только один раз.</p><div style="letter-spacing:10px;font-size:32px;font-weight:700;background:#f3f7fd;border-radius:12px;padding:18px 20px;text-align:center">${code}</div><p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#7186a0">Если вы не запрашивали код, просто проигнорируйте письмо.</p></div></div></body></html>`;
  return { html, subject, text };
}

async function deliverLoginCode(env: Env, challengeId: string, userId: string, email: string, code: string): Promise<void> {
  try {
    if (!emailDeliveryConfigured(env)) throw new Error("Email delivery is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      const message = loginEmail(code);
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": challengeId,
          "User-Agent": "Vecta/1.0 (+https://github.com/SameQushori/survey-platform)",
        },
        body: JSON.stringify({
          from: env.AUTH_EMAIL_FROM,
          to: [email],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new EmailProviderError(response.status);
  } catch (error) {
    await env.DB.prepare("DELETE FROM organizer_auth_challenges WHERE id = ?1 AND status = 'active'")
      .bind(challengeId)
      .run();
    console.error(JSON.stringify({
      event: "organizer_login_email_failed",
      challengeId,
      userId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      providerStatus: error instanceof EmailProviderError ? error.status : null,
    }));
  }
}

async function requestCode(request: Request, env: Env, ctx: ExecutionContext, requestId: string): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const raw = await readJsonBody(request, requestId);
  if (raw instanceof Response) return raw;
  const parsed = requestCodeSchema.safeParse(raw);
  if (!parsed.success) {
    return problemResponse({ code: "validation_failed", requestId, status: 422, title: "Проверьте email и защитную проверку" });
  }
  if (!emailDeliveryConfigured(env)) {
    return problemResponse({ code: "internal_error", requestId, status: 503, title: "Вход по email временно недоступен" });
  }

  const ipDigest = await authSecretDigest(env, "login-ip", clientKey(request));
  if (!(await allowedByRateLimit(env, `request-code:${ipDigest}`))) {
    return problemResponse({ code: "rate_limited", headers: { "Retry-After": "60" }, requestId, status: 429, title: "Слишком много запросов кода" });
  }

  const turnstile = await verifyTurnstile(request, env, parsed.data.turnstileToken, "organizer_login");
  if (!turnstile.ok) {
    return problemResponse({
      code: turnstile.reason === "unavailable" ? "internal_error" : "turnstile_failed",
      requestId,
      status: turnstile.reason === "unavailable" ? 503 : 400,
      title: turnstile.reason === "unavailable" ? "Защитная проверка временно недоступна" : "Защитная проверка не пройдена",
    });
  }

  const now = Date.now();
  const expiresAt = now + challengeLifetimeMs;
  const challengeId = `challenge_${crypto.randomUUID()}`;
  const body: OrganizerLoginChallengeDTO = { challengeId, expiresAt };
  const user = await env.DB.prepare(
    `SELECT u.id, u.email
     FROM users u
     WHERE lower(u.email) = ?1
       AND u.status = 'active'
       AND (u.platform_role = 'super_admin' OR EXISTS (
         SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.status = 'active'
       ))`,
  ).bind(parsed.data.email).first<LoginUserRow>();

  if (user?.email) {
    const code = oneTimeCode();
    const codeDigest = await authSecretDigest(env, "organizer-login-code", `${challengeId}:${code}`);
    await env.DB.batch([
      env.DB.prepare("UPDATE organizer_auth_challenges SET status = 'expired' WHERE user_id = ?1 AND status = 'active'").bind(user.id),
      env.DB.prepare(
        `INSERT INTO organizer_auth_challenges
         (id, user_id, code_digest, status, failed_attempts, expires_at, created_at)
         VALUES (?1, ?2, ?3, 'active', 0, ?4, ?5)`,
      ).bind(challengeId, user.id, codeDigest, expiresAt, now),
    ]);
    ctx.waitUntil(deliverLoginCode(env, challengeId, user.id, user.email, code));
  }

  return jsonResponse(body, requestId, { status: 202 });
}

async function verifyCode(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  const raw = await readJsonBody(request, requestId);
  if (raw instanceof Response) return raw;
  const parsed = verifyCodeSchema.safeParse(raw);
  if (!parsed.success) {
    return problemResponse({ code: "validation_failed", requestId, status: 422, title: "Введите шестизначный код" });
  }

  const ipDigest = await authSecretDigest(env, "login-ip", clientKey(request));
  if (!(await allowedByRateLimit(env, `verify-code:${ipDigest}`))) {
    return problemResponse({ code: "rate_limited", headers: { "Retry-After": "60" }, requestId, status: 429, title: "Слишком много попыток входа" });
  }

  const now = Date.now();
  const challenge = await env.DB.prepare(
    `SELECT c.code_digest, c.expires_at, c.failed_attempts, c.user_id
     FROM organizer_auth_challenges c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = ?1 AND c.status = 'active' AND u.status = 'active'`,
  ).bind(parsed.data.challengeId).first<ChallengeRow>();
  const valid = await verifyAuthSecretDigest(
    env,
    "organizer-login-code",
    `${parsed.data.challengeId}:${parsed.data.code}`,
    challenge?.code_digest ?? "0".repeat(64),
  );

  if (!challenge || challenge.expires_at <= now || challenge.failed_attempts >= maxFailedAttempts || !valid) {
    await env.DB.prepare(
      `UPDATE organizer_auth_challenges
       SET failed_attempts = min(failed_attempts + 1, ?1),
           status = CASE WHEN expires_at <= ?2 OR failed_attempts + 1 >= ?1 THEN 'expired' ELSE status END
       WHERE id = ?3 AND status = 'active'`,
    ).bind(maxFailedAttempts, now, parsed.data.challengeId).run();
    return problemResponse({ code: "unauthorized", requestId, status: 401, title: "Код неверный или уже истёк" });
  }

  const consumed = await env.DB.prepare(
    `UPDATE organizer_auth_challenges SET status = 'used', used_at = ?1
     WHERE id = ?2 AND status = 'active' AND expires_at > ?1 AND failed_attempts < ?3`,
  ).bind(now, parsed.data.challengeId, maxFailedAttempts).run();
  if (consumed.meta.changes !== 1) {
    return problemResponse({ code: "unauthorized", requestId, status: 401, title: "Код неверный или уже истёк" });
  }

  const sessionToken = opaqueToken(32);
  const sessionDigest = await authSecretDigest(env, "session", sessionToken);
  const expiresAt = now + sessionLifetimeMs;
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET auth_subject = ?1, updated_at = ?2 WHERE id = ?3 AND auth_subject LIKE 'pending:%'")
      .bind(`app:${challenge.user_id}`, now, challenge.user_id),
    env.DB.prepare(
      `INSERT INTO organizer_auth_sessions
       (id, user_id, token_digest, expires_at, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    ).bind(`session_${crypto.randomUUID()}`, challenge.user_id, sessionDigest, expiresAt, now),
  ]);

  const body: OrganizerLoginVerificationDTO = { authenticated: true, expiresAt };
  return jsonResponse(body, requestId, {
    headers: { "Set-Cookie": `${organizerSessionCookie}=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1_000)}` },
  });
}

async function logout(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(requestId, ["POST"]);
  if (request.headers.get("x-requested-with") !== "XMLHttpRequest") {
    return problemResponse({ code: "unauthorized", requestId, status: 401, title: "Некорректный запрос выхода" });
  }
  const token = (request.headers.get("cookie") ?? "")
    .split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${organizerSessionCookie}=`))
    ?.slice(organizerSessionCookie.length + 1) ?? "";
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
    const digest = await authSecretDigest(env, "session", token);
    await env.DB.prepare("UPDATE organizer_auth_sessions SET revoked_at = ?1 WHERE token_digest = ?2 AND revoked_at IS NULL")
      .bind(Date.now(), digest).run();
  }
  return jsonResponse({ authenticated: false }, requestId, {
    headers: { "Set-Cookie": `${organizerSessionCookie}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` },
  });
}

export async function routeOrganizerAuth(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requestId: string,
): Promise<Response | null> {
  if (env.AUTH_MODE !== "session") return null;
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/v1/auth/request-code") return requestCode(request, env, ctx, requestId);
  if (pathname === "/api/v1/auth/verify-code") return verifyCode(request, env, requestId);
  if (pathname === "/api/v1/auth/logout") return logout(request, env, requestId);
  return null;
}
