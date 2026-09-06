import { z } from "zod";

import type { OrganizerLoginChallengeDTO, OrganizerLoginVerificationDTO } from "../shared/contracts";
import { authSecretDigest, organizerSessionCookie, verifyAuthSecretDigest } from "./auth";
import { EmailProviderError, emailDeliveryConfigured, sendTransactionalEmail } from "./email-delivery";
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
  status: "active" | "disabled";
}

interface ChallengeRow {
  code_digest: string;
  expires_at: number;
  failed_attempts: number;
  user_id: string;
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

function loginEmail(code: string): { html: string; subject: string; text: string } {
  const subject = "Код входа в Vecta";
  const text = `Код входа в Vecta: ${code}\n\nОн действует 10 минут и подходит только для одного входа. Если вы не запрашивали код, просто проигнорируйте это письмо.`;
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f8ff;font-family:Arial,sans-serif;color:#0b2447"><div style="max-width:520px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border:1px solid #dbe7f7;border-radius:16px;padding:32px"><p style="margin:0 0 12px;color:#2878ff;font-weight:700">Vecta</p><h1 style="margin:0 0 14px;font-size:24px">Код для входа</h1><p style="margin:0 0 22px;line-height:1.6;color:#55708f">Введите этот код в окне входа. Он действует 10 минут и подходит только один раз.</p><div style="letter-spacing:10px;font-size:32px;font-weight:700;background:#f3f7fd;border-radius:12px;padding:18px 20px;text-align:center">${code}</div><p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#7186a0">Если вы не запрашивали код, просто проигнорируйте письмо.</p></div></div></body></html>`;
  return { html, subject, text };
}

async function deliverLoginCode(
  env: Env,
  challengeId: string,
  userId: string,
  email: string,
  code: string,
  removeProvisionalUserOnFailure: boolean,
): Promise<boolean> {
  try {
    await sendTransactionalEmail(env, challengeId, email, loginEmail(code));
    return true;
  } catch (error) {
    const cleanup: D1PreparedStatement[] = [
      env.DB.prepare("DELETE FROM organizer_auth_challenges WHERE id = ?1 AND status = 'active'").bind(challengeId),
    ];
    if (removeProvisionalUserOnFailure) {
      cleanup.push(env.DB.prepare(
        `DELETE FROM users
         WHERE id = ?1
           AND auth_subject LIKE 'pending:%'
           AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM organizer_auth_sessions WHERE user_id = ?1)`,
      ).bind(userId));
    }
    await env.DB.batch(cleanup);
    console.error(JSON.stringify({
      event: "organizer_login_email_failed",
      challengeId,
      userId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      provider: error instanceof EmailProviderError ? error.provider : env.AUTH_EMAIL_PROVIDER,
      providerStatus: error instanceof EmailProviderError ? error.status : null,
    }));
    return false;
  }
}

async function findOrCreateLoginUser(env: Env, email: string, now: number): Promise<LoginUserRow & { created: boolean }> {
  const existing = await env.DB.prepare(
    "SELECT id, email, status FROM users WHERE lower(email) = ?1",
  ).bind(email).first<LoginUserRow>();

  if (existing) {
    return { ...existing, created: false };
  }

  const userId = `user_${crypto.randomUUID()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO users
       (id, auth_subject, email, display_name, platform_role, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'Организатор', NULL, 'active', ?4, ?4)`,
    ).bind(userId, `pending:${email}`, email, now).run();
    return { id: userId, email, status: "active", created: true };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
    const concurrent = await env.DB.prepare(
      "SELECT id, email, status FROM users WHERE lower(email) = ?1",
    ).bind(email).first<LoginUserRow>();
    if (!concurrent) throw error;
    return { ...concurrent, created: false };
  }
}

async function requestCode(request: Request, env: Env, requestId: string): Promise<Response> {
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
  const emailDigest = await authSecretDigest(env, "login-email", parsed.data.email);
  if (!(await allowedByRateLimit(env, `request-code-email:${emailDigest}`))) {
    return problemResponse({ code: "rate_limited", headers: { "Retry-After": "60" }, requestId, status: 429, title: "Слишком много запросов кода" });
  }

  const user = await findOrCreateLoginUser(env, parsed.data.email, now);
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
  const delivered = await deliverLoginCode(env, challengeId, user.id, user.email, code, user.created);
  if (!delivered) {
    return problemResponse({ code: "email_delivery_failed", requestId, status: 502, title: "Не удалось отправить код. Попробуйте ещё раз" });
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
  const existingMembership = await env.DB.prepare(
    `SELECT id FROM memberships WHERE user_id = ?1 AND status = 'active' LIMIT 1`,
  ).bind(challenge.user_id).first<{ id: string }>();
  const organizationId = `org_${crypto.randomUUID()}`;
  const setup: D1PreparedStatement[] = [];
  if (!existingMembership) {
    setup.push(
      env.DB.prepare(
        `INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
         VALUES (?1, 'Личное пространство', ?2, 'active', ?3, ?3)`,
      ).bind(organizationId, `workspace-${crypto.randomUUID()}`, now),
      env.DB.prepare(
        `INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'organizer', 'active', ?4, ?4)`,
      ).bind(`membership_${crypto.randomUUID()}`, organizationId, challenge.user_id, now),
      env.DB.prepare(
        `INSERT INTO audit_log
         (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_json, created_at)
         VALUES (?1, ?2, ?3, 'account.registered', 'user', ?3, ?4, '{}', ?5)`,
      ).bind(`audit_${crypto.randomUUID()}`, organizationId, challenge.user_id, requestId, now),
    );
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET auth_subject = ?1, updated_at = ?2 WHERE id = ?3 AND auth_subject LIKE 'pending:%'")
      .bind(`app:${challenge.user_id}`, now, challenge.user_id),
    ...setup,
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
  _ctx: ExecutionContext,
  requestId: string,
): Promise<Response | null> {
  if (env.AUTH_MODE !== "session") return null;
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/v1/auth/request-code") return requestCode(request, env, requestId);
  if (pathname === "/api/v1/auth/verify-code") return verifyCode(request, env, requestId);
  if (pathname === "/api/v1/auth/logout") return logout(request, env, requestId);
  return null;
}
