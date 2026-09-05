import type { OrganizerSessionDTO } from "../shared/contracts";
import type { AuthenticatedIdentity } from "./auth";

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  platform_role: "super_admin" | null;
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
      `SELECT id, display_name, email, platform_role
       FROM users
       WHERE auth_subject = ?1 AND status = 'active'`,
    )
    .bind(subject)
    .first<UserRow>();
}

async function claimPreprovisionedUser(
  db: D1Database,
  identity: AuthenticatedIdentity,
): Promise<UserRow | null> {
  if (!identity.email) return null;
  const pendingSubject = `pending:${identity.email}`;
  const pending = await db
    .prepare(
      `SELECT id, display_name, email, platform_role
       FROM users
       WHERE lower(email) = ?1 AND auth_subject = ?2 AND status = 'active'`,
    )
    .bind(identity.email, pendingSubject)
    .first<UserRow>();

  if (!pending) return null;

  const result = await db
    .prepare(
      `UPDATE users
       SET auth_subject = ?1, updated_at = ?2
       WHERE id = ?3 AND auth_subject = ?4 AND status = 'active'`,
    )
    .bind(identity.subject, Date.now(), pending.id, pendingSubject)
    .run();

  return result.meta.changes === 1 ? findActiveUser(db, identity.subject) : null;
}

export async function resolveSession(
  db: D1Database,
  identity: AuthenticatedIdentity,
): Promise<AuthorizedSession> {
  const user =
    (await findActiveUser(db, identity.subject)) ??
    (await claimPreprovisionedUser(db, identity));

  if (!user) {
    throw new AuthorizationError(403, "This identity has not been granted access to Vecta");
  }

  const membershipResult = await db
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
        platformRole: user.platform_role,
      },
      memberships: memberships.map((membership) => ({
        organizationId: membership.organization_id,
        organizationName: membership.organization_name,
        role: membership.role,
      })),
    },
  };
}

export function requireSuperAdmin(session: AuthorizedSession): void {
  if (session.user.platform_role !== "super_admin") {
    throw new AuthorizationError(403, "Super Admin access is required");
  }
}

export function requireOrganizationAccess(
  session: AuthorizedSession,
  organizationId: string,
): "organizer" | "super_admin" {
  if (session.user.platform_role === "super_admin") return "super_admin";
  if (session.memberships.some((membership) => membership.organization_id === organizationId)) {
    return "organizer";
  }
  throw new AuthorizationError(403, "Organization membership is required");
}
