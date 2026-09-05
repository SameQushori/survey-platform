export interface AuthenticatedIdentity {
  subject: string;
  email: string | null;
}

export class IdentityError extends Error {
  readonly status: 401 | 500;

  constructor(status: 401 | 500, message: string) {
    super(message);
    this.name = "IdentityError";
    this.status = status;
  }
}

interface SessionUserRow {
  auth_subject: string;
  email: string | null;
}

const localSubjects = new Map([
  ["local:organizer", "organizer@vecta.local"],
  ["local:super-admin", "admin@vecta.local"],
]);

export const organizerSessionCookie = "__Host-vecta_session";

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".test");
}

function localIdentity(request: Request, env: Env): AuthenticatedIdentity {
  const hostname = new URL(request.url).hostname;
  if (env.APP_ENV !== "local" || !isLocalHostname(hostname)) {
    throw new IdentityError(500, "Local identity mode is disabled for this environment");
  }

  const subject = request.headers.get("x-vecta-local-subject")?.trim() ?? "";
  const email = request.headers.get("x-vecta-local-email")?.trim().toLowerCase() ?? "";
  if (!subject || !email || localSubjects.get(subject) !== email) {
    throw new IdentityError(401, "Local development identity is missing or invalid");
  }

  return { subject, email };
}

function cookieValue(request: Request, name: string): string {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function assertSameOriginMutation(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("x-requested-with") !== "XMLHttpRequest") {
    throw new IdentityError(401, "Same-origin request marker is missing");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new IdentityError(401, "Cross-site mutation is not allowed");
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new IdentityError(401, "Request origin is invalid");
  }
}

async function authSecretKey(env: Env): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  if (!env.AUTH_TOKEN_SECRET) throw new IdentityError(500, "Authentication secret is not configured");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_TOKEN_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

export async function authSecretDigest(env: Env, purpose: string, value: string): Promise<string> {
  const key = await authSecretKey(env);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${purpose}\0${value}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyAuthSecretDigest(env: Env, purpose: string, value: string, digest: string): Promise<boolean> {
  const normalized = /^[0-9a-f]{64}$/.test(digest) ? digest : "0".repeat(64);
  const signature = new Uint8Array(normalized.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
  const key = await authSecretKey(env);
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(`${purpose}\0${value}`));
}

async function sessionIdentity(request: Request, env: Env): Promise<AuthenticatedIdentity> {
  assertSameOriginMutation(request);
  const token = cookieValue(request, organizerSessionCookie);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new IdentityError(401, "Organizer session is missing");
  }

  const tokenDigest = await authSecretDigest(env, "session", token);
  const row = await env.DB.prepare(
    `SELECT u.auth_subject, u.email
     FROM organizer_auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_digest = ?1
       AND s.revoked_at IS NULL
       AND s.expires_at > ?2
       AND u.status = 'active'`,
  ).bind(tokenDigest, Date.now()).first<SessionUserRow>();

  if (!row) throw new IdentityError(401, "Organizer session is invalid or expired");
  return { subject: row.auth_subject, email: row.email?.trim().toLowerCase() ?? null };
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthenticatedIdentity> {
  if (env.AUTH_MODE === "local") return localIdentity(request, env);
  if (env.AUTH_MODE === "session") return sessionIdentity(request, env);
  throw new IdentityError(500, "Authentication mode is not configured");
}
