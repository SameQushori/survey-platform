import type { OrganizerSessionDTO } from "../shared/contracts";
import { loadClerkOrganizerProfile, type AuthenticatedIdentity } from "./auth";

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
}

interface UserStatusRow extends UserRow {
  status: "active" | "disabled";
}

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  role: "organizer";
}

export interface AuthorizedSession {
  identity: AuthenticatedIdentity;
  user: UserRow;
  memberships: MembershipRow[];
  dto: OrganizerSessionDTO;
}

export class AuthorizationError extends Error {
  readonly status: 403 | 404;

  constructor(status: 403 | 404, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

async function findActiveUser(db: D1Database, subject: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, display_name, email
       FROM users
       WHERE auth_subject = ?1 AND status = 'active'`,
    )
    .bind(subject)
    .first<UserRow>();
}

async function findUser(db: D1Database, subject: string): Promise<UserStatusRow | null> {
  return db
    .prepare(
      `SELECT id, display_name, email, status
       FROM users
       WHERE auth_subject = ?1`,
    )
    .bind(subject)
    .first<UserStatusRow>();
}

export async function provisionClerkOrganizer(
  env: Env,
  identity: AuthenticatedIdentity,
  requestId: string,
  profileLoader: typeof loadClerkOrganizerProfile = loadClerkOrganizerProfile,
): Promise<UserRow> {
  if (!identity.providerUserId || !identity.subject.startsWith("clerk:")) {
    throw new AuthorizationError(403, "This identity has not been granted access to Vecta");
  }

  const profile = await profileLoader(env, identity.providerUserId);
  const now = Date.now();
  const userId = `user_${crypto.randomUUID()}`;
  const organizationId = `org_${crypto.randomUUID()}`;
  const membershipId = `membership_${crypto.randomUUID()}`;
  const auditId = `audit_${crypto.randomUUID()}`;
  const displayName = profile.displayName.trim().slice(0, 200) || profile.email.split("@")[0] || "Организатор";
  const organizationName = `${displayName.slice(0, 170)} — личное пространство`;
  const slugStem = (profile.email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "workspace";
  const organizationSlug = `${slugStem}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users
         (id, auth_subject, email, display_name, platform_role, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, NULL, 'active', ?5, ?5)`,
      ).bind(userId, identity.subject, profile.email, displayName, now),
      env.DB.prepare(
        `INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', ?4, ?4)`,
      ).bind(organizationId, organizationName, organizationSlug, now),
      env.DB.prepare(
        `INSERT INTO memberships
         (id, organization_id, user_id, role, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'organizer', 'active', ?4, ?4)`,
      ).bind(membershipId, organizationId, userId, now),
      env.DB.prepare(
        `INSERT INTO audit_log
         (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_json, created_at)
         VALUES (?1, ?2, ?3, 'organizer.register', 'organization', ?2, ?4, ?5, ?6)`,
      ).bind(auditId, organizationId, userId, requestId, JSON.stringify({ provider: "clerk" }), now),
    ]);
  } catch (error) {
    const concurrentUser = await findActiveUser(env.DB, identity.subject);
    if (concurrentUser) return concurrentUser;
    throw error;
  }

  return { id: userId, display_name: displayName, email: profile.email };
}

export async function resolveSession(
  env: Env,
  identity: AuthenticatedIdentity,
  requestId: string,
): Promise<AuthorizedSession> {
  const existingUser = await findUser(env.DB, identity.subject);
  if (existingUser?.status === "disabled") {
    throw new AuthorizationError(403, "This Vecta account is disabled");
  }
  const user = existingUser ?? await provisionClerkOrganizer(env, identity, requestId);

  const membershipResult = await env.DB
    .prepare(
      `SELECT m.organization_id, o.name AS organization_name, m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = ?1
         AND m.status = 'active'
         AND o.status = 'active'
       ORDER BY o.name ASC`,
    )
    .bind(user.id)
    .all<MembershipRow>();
  const memberships = membershipResult.results;

  return {
    identity,
    user,
    memberships,
    dto: {
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
      },
      memberships: memberships.map((membership) => ({
        organizationId: membership.organization_id,
        organizationName: membership.organization_name,
        role: membership.role,
      })),
    },
  };
}

export function requireOrganizationAccess(
  session: AuthorizedSession,
  organizationId: string,
): "organizer" {
  if (session.memberships.some((membership) => membership.organization_id === organizationId)) {
    return "organizer";
  }
  throw new AuthorizationError(403, "Organization membership is required");
}
