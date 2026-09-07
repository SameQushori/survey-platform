import { createClerkClient } from "@clerk/backend";

export interface AuthenticatedIdentity {
  subject: string;
  email: string | null;
  displayName: string | null;
  providerUserId: string | null;
}

export interface ClerkOrganizerProfile {
  email: string;
  displayName: string;
}

export class IdentityError extends Error {
  readonly status: 401 | 500;

  constructor(status: 401 | 500, message: string) {
    super(message);
    this.name = "IdentityError";
    this.status = status;
  }
}

const localSubjects = new Map([
  ["local:organizer", "organizer@vecta.local"],
]);

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

  return { subject, email, displayName: null, providerUserId: null };
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

function clerkConfiguration(env: Env): {
  authorizedParties: string[];
  publishableKey: string;
  secretKey: string;
} {
  const publishableKey = env.CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  const secretKey = env.CLERK_SECRET_KEY?.trim() ?? "";
  const authorizedParties = (env.CLERK_AUTHORIZED_PARTIES ?? "")
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean);

  if (!publishableKey || !secretKey || authorizedParties.length === 0) {
    throw new IdentityError(500, "Clerk authentication is not configured");
  }

  return { authorizedParties, publishableKey, secretKey };
}

function clerkClient(env: Env) {
  const { publishableKey, secretKey } = clerkConfiguration(env);
  return createClerkClient({ publishableKey, secretKey });
}

async function clerkIdentity(request: Request, env: Env): Promise<AuthenticatedIdentity> {
  assertSameOriginMutation(request);
  const { authorizedParties } = clerkConfiguration(env);

  let requestState;
  try {
    requestState = await clerkClient(env).authenticateRequest(request, { authorizedParties });
  } catch {
    throw new IdentityError(500, "Clerk session verification is unavailable");
  }

  if (!requestState.isAuthenticated) {
    throw new IdentityError(401, "Clerk session is missing or invalid");
  }

  const { userId } = requestState.toAuth();
  if (!userId) throw new IdentityError(401, "Clerk user is missing from the session");

  return {
    subject: `clerk:${userId}`,
    email: null,
    displayName: null,
    providerUserId: userId,
  };
}

export async function loadClerkOrganizerProfile(env: Env, userId: string): Promise<ClerkOrganizerProfile> {
  let user;
  try {
    user = await clerkClient(env).users.getUser(userId);
  } catch {
    throw new IdentityError(500, "Clerk user profile is unavailable");
  }

  const primaryEmail = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)
    ?? user.emailAddresses[0];
  const email = primaryEmail?.emailAddress.trim().toLowerCase() ?? "";
  if (!email) throw new IdentityError(500, "Clerk user does not have an email address");

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
    || email.split("@")[0]
    || "Организатор";
  return { email, displayName };
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthenticatedIdentity> {
  if (env.AUTH_MODE === "local") return localIdentity(request, env);
  if (env.AUTH_MODE === "clerk") return clerkIdentity(request, env);
  throw new IdentityError(500, "Authentication mode is not configured");
}
