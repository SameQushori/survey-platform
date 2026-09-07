import type { AuthorizedSession } from "./session";

export function auditStatement(
  db: D1Database,
  session: AuthorizedSession,
  requestId: string,
  action: string,
  entityType: string,
  entityId: string,
  organizationId: string | null,
  metadata: Record<string, string> = {},
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
       (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      `audit_${crypto.randomUUID()}`,
      organizationId,
      session.user.id,
      action,
      entityType,
      entityId,
      requestId,
      JSON.stringify(metadata),
      Date.now(),
    );
}
