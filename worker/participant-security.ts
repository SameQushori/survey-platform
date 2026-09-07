import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();
const jwtIssuer = "vecta";
const jwtAudience = "vecta-participant";

export interface AttemptTokenClaims {
  attemptId: string;
  tokenVersion: number;
}

export async function secretDigest(env: Env, purpose: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.ATTEMPT_TOKEN_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${purpose}\0${value}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signAttemptToken(
  env: Env,
  attemptId: string,
  tokenVersion: number,
  deadlineAt: number | null,
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const hardLimit = nowSeconds + 24 * 60 * 60;
  const deadlineLimit = deadlineAt === null ? hardLimit : Math.floor(deadlineAt / 1_000) + 60 * 60;
  return new SignJWT({ tokenVersion, type: "attempt" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(attemptId)
    .setIssuer(jwtIssuer)
    .setAudience(jwtAudience)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(Math.min(hardLimit, deadlineLimit))
    .sign(encoder.encode(env.ATTEMPT_TOKEN_SECRET));
}

export async function verifyAttemptToken(env: Env, token: string): Promise<AttemptTokenClaims | null> {
  try {
    const verified = await jwtVerify(token, encoder.encode(env.ATTEMPT_TOKEN_SECRET), {
      algorithms: ["HS256"],
      audience: jwtAudience,
      issuer: jwtIssuer,
    });
    if (
      verified.payload.type !== "attempt" ||
      typeof verified.payload.sub !== "string" ||
      typeof verified.payload.tokenVersion !== "number" ||
      !Number.isInteger(verified.payload.tokenVersion) ||
      verified.payload.tokenVersion < 1
    ) return null;
    return { attemptId: verified.payload.sub, tokenVersion: verified.payload.tokenVersion };
  } catch {
    return null;
  }
}
