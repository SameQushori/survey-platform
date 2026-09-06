import { secretDigest } from "./participant-security";

export type TurnstileVerification =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unavailable" };

interface TurnstileEnvironment {
  APP_ENV: string;
  AUTH_MODE: string;
  TURNSTILE_HOSTNAMES: string;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITEKEY: string;
}

interface TurnstileResult {
  success: boolean;
  action?: string;
  hostname?: string;
}

async function parseTurnstileResponse(response: Response): Promise<TurnstileResult | null> {
  if (!response.ok) return null;
  try {
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || !("success" in value) || typeof value.success !== "boolean") {
      return null;
    }
    const action = "action" in value && typeof value.action === "string" ? value.action : undefined;
    const hostname = "hostname" in value && typeof value.hostname === "string" ? value.hostname : undefined;
    return { success: value.success, ...(action ? { action } : {}), ...(hostname ? { hostname } : {}) };
  } catch {
    return null;
  }
}

export async function verifyTurnstile(
  request: Request,
  env: TurnstileEnvironment,
  token: string,
  expectedAction: string,
): Promise<TurnstileVerification> {
  const hostnames = new Set(env.TURNSTILE_HOSTNAMES.split(",").map((value) => value.trim()).filter(Boolean));
  if (!token || token.length > 2_048 || hostnames.size === 0) return { ok: false, reason: "invalid" };

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
    idempotency_key: crypto.randomUUID(),
  });
  const remoteIp = request.headers.get("cf-connecting-ip")?.trim();
  if (remoteIp) body.set("remoteip", remoteIp);

  let result: TurnstileResult | null = null;
  for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      result = await parseTurnstileResponse(response);
    } catch {
      result = null;
    }
  }
  if (!result) return { ok: false, reason: "unavailable" };

  const localDummyVerification = env.APP_ENV === "local"
    && env.AUTH_MODE === "local"
    && env.TURNSTILE_SITEKEY === "1x00000000000000000000AA"
    && result.success;
  if (localDummyVerification) return { ok: true };
  if (!result.success || result.action !== expectedAction || !result.hostname || !hostnames.has(result.hostname)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}

export async function accessCredentialDigest(env: Env, kind: "code" | "invitation", credential: string): Promise<string> {
  const normalized = kind === "code" ? credential.trim().toUpperCase() : credential.trim();
  return secretDigest(env, `access:${kind}`, normalized);
}
