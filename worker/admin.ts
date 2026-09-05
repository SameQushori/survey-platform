import type {
  OrganizationMemberDTO,
  OrganizationSummaryDTO,
  OrganizationWorkspaceDTO,
} from "../shared/contracts";
import {
  addOrganizationMemberSchema,
  createOrganizationSchema,
  updateMembershipSchema,
  updateOrganizationSchema,
} from "../shared/validation";
import { jsonResponse, methodNotAllowed, problemResponse, readJsonBody } from "./http";
import {
  requireOrganizationAccess,
  requireSuperAdmin,
  type AuthorizedSession,
} from "./session";
import { auditStatement } from "./audit";
import { routeAuthoringApi } from "./authoring";
import { routeResultsApi } from "./results";

function validationFailure(requestId: string, error: { flatten(): { fieldErrors: Record<string, string[]> } }): Response {
  return problemResponse({
    code: "validation_failed",
    fieldErrors: error.flatten().fieldErrors,
    requestId,
    status: 422,
    title: "Проверьте заполненные поля",
  });
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function organizationWorkspace(
  env: Env,
  session: AuthorizedSession,
  organizationId: string,
  requestId: string,
): Promise<Response> {
  const role = requireOrganizationAccess(session, organizationId);
  const organization = await env.DB
    .prepare(`SELECT id, name, slug FROM organizations WHERE id = ?1 AND status = 'active'`)
    .bind(organizationId)
    .first<{ id: string; name: string; slug: string }>();
  if (!organization) {
    return problemResponse({ code: "not_found", requestId, status: 404, title: "Организация не найдена" });
  }
  const body: OrganizationWorkspaceDTO = { organization, role };
  return jsonResponse(body, requestId);
}

async function organizations(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
): Promise<Response> {
  requireSuperAdmin(session);

  if (request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT o.id, o.name, o.slug, o.status, o.updated_at,
              COUNT(CASE WHEN m.status = 'active' THEN 1 END) AS organizer_count
       FROM organizations o
       LEFT JOIN memberships m ON m.organization_id = o.id
       GROUP BY o.id
       ORDER BY o.updated_at DESC
       LIMIT 100`,
    ).all<{
      id: string;
      name: string;
      slug: string;
      status: "active" | "disabled";
      updated_at: number;
      organizer_count: number;
    }>();
    const body: OrganizationSummaryDTO[] = result.results.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      organizerCount: row.organizer_count,
      updatedAt: row.updated_at,
    }));
    return jsonResponse(body, requestId);
  }

  if (request.method === "POST") {
    const raw = await readJsonBody(request, requestId);
    if (raw instanceof Response) return raw;
    const parsed = createOrganizationSchema.safeParse(raw);
    if (!parsed.success) return validationFailure(requestId, parsed.error);
    const organizationId = id("org");
    const now = Date.now();
    try {
      await env.DB.batch([
        env.DB
          .prepare(
            `INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'active', ?4, ?4)`,
          )
          .bind(organizationId, parsed.data.name, parsed.data.slug, now),
        auditStatement(env.DB, session, requestId, "organization.created", "organization", organizationId, organizationId),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return problemResponse({ code: "conflict", detail: "Этот slug уже занят.", requestId, status: 409, title: "Организация уже существует" });
      }
      throw error;
    }
    return jsonResponse({ id: organizationId, ...parsed.data, status: "active", organizerCount: 0, updatedAt: now }, requestId, { status: 201 });
  }

  return methodNotAllowed(requestId, ["GET", "POST"]);
}

async function organizationById(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  organizationId: string,
): Promise<Response> {
  requireSuperAdmin(session);
  if (request.method !== "PATCH") return methodNotAllowed(requestId, ["PATCH"]);
  const raw = await readJsonBody(request, requestId);
  if (raw instanceof Response) return raw;
  const parsed = updateOrganizationSchema.safeParse(raw);
  if (!parsed.success) return validationFailure(requestId, parsed.error);
  const current = await env.DB.prepare("SELECT name, status FROM organizations WHERE id = ?1").bind(organizationId).first<{ name: string; status: string }>();
  if (!current) return problemResponse({ code: "not_found", requestId, status: 404, title: "Организация не найдена" });
  const now = Date.now();
  const name = parsed.data.name ?? current.name;
  const status = parsed.data.status ?? current.status;
  await env.DB.batch([
    env.DB.prepare("UPDATE organizations SET name = ?1, status = ?2, updated_at = ?3 WHERE id = ?4").bind(name, status, now, organizationId),
    auditStatement(env.DB, session, requestId, "organization.updated", "organization", organizationId, organizationId, { status }),
  ]);
  return jsonResponse({ id: organizationId, name, status, updatedAt: now }, requestId);
}

async function members(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  organizationId: string,
): Promise<Response> {
  requireSuperAdmin(session);
  const exists = await env.DB.prepare("SELECT id FROM organizations WHERE id = ?1").bind(organizationId).first();
  if (!exists) return problemResponse({ code: "not_found", requestId, status: 404, title: "Организация не найдена" });

  if (request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT m.id AS membership_id, u.id AS user_id, u.display_name, u.email, m.role, m.status
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ?1 ORDER BY u.display_name ASC LIMIT 100`,
    ).bind(organizationId).all<{ membership_id: string; user_id: string; display_name: string; email: string | null; role: "organizer"; status: "active" | "disabled" }>();
    const body: OrganizationMemberDTO[] = result.results.map((row) => ({
      membershipId: row.membership_id,
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
      status: row.status,
    }));
    return jsonResponse(body, requestId);
  }

  if (request.method === "POST") {
    const raw = await readJsonBody(request, requestId);
    if (raw instanceof Response) return raw;
    const parsed = addOrganizationMemberSchema.safeParse(raw);
    if (!parsed.success) return validationFailure(requestId, parsed.error);
    const now = Date.now();
    const existingUser = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ?1").bind(parsed.data.email).first<{ id: string }>();
    const userId = existingUser?.id ?? id("user");
    const membershipId = id("membership");
    const statements: D1PreparedStatement[] = [];
    if (!existingUser) {
      statements.push(env.DB.prepare(
        `INSERT INTO users (id, auth_subject, email, display_name, platform_role, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, NULL, 'active', ?5, ?5)`,
      ).bind(userId, `pending:${parsed.data.email}`, parsed.data.email, parsed.data.displayName, now));
    }
    statements.push(env.DB.prepare(
      `INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'organizer', 'active', ?4, ?4)`,
    ).bind(membershipId, organizationId, userId, now));
    statements.push(auditStatement(env.DB, session, requestId, "membership.created", "membership", membershipId, organizationId, { userId }));
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return problemResponse({ code: "conflict", detail: "Этот организатор уже добавлен.", requestId, status: 409, title: "Доступ уже существует" });
      }
      throw error;
    }
    return jsonResponse({ membershipId, userId, displayName: parsed.data.displayName, email: parsed.data.email, role: "organizer", status: "active" }, requestId, { status: 201 });
  }

  return methodNotAllowed(requestId, ["GET", "POST"]);
}

async function membershipById(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
  organizationId: string,
  membershipId: string,
): Promise<Response> {
  requireSuperAdmin(session);
  if (request.method !== "PATCH") return methodNotAllowed(requestId, ["PATCH"]);
  const raw = await readJsonBody(request, requestId);
  if (raw instanceof Response) return raw;
  const parsed = updateMembershipSchema.safeParse(raw);
  if (!parsed.success) return validationFailure(requestId, parsed.error);
  const membership = await env.DB.prepare(
    "SELECT id FROM memberships WHERE id = ?1 AND organization_id = ?2",
  ).bind(membershipId, organizationId).first();
  if (!membership) {
    return problemResponse({ code: "not_found", requestId, status: 404, title: "Доступ не найден" });
  }
  const now = Date.now();
  const update = env.DB.prepare(
    "UPDATE memberships SET status = ?1, updated_at = ?2 WHERE id = ?3 AND organization_id = ?4",
  ).bind(parsed.data.status, now, membershipId, organizationId);
  await env.DB.batch([
    update,
    auditStatement(env.DB, session, requestId, "membership.updated", "membership", membershipId, organizationId, { status: parsed.data.status }),
  ]);
  return jsonResponse({ membershipId, status: parsed.data.status, updatedAt: now }, requestId);
}

export async function routeAuthorizedApi(
  request: Request,
  env: Env,
  session: AuthorizedSession,
  requestId: string,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/v1/session") {
    return request.method === "GET" ? jsonResponse(session.dto, requestId) : methodNotAllowed(requestId, ["GET"]);
  }
  if (pathname === "/api/v1/organizations") return organizations(request, env, session, requestId);

  const authoringResponse = await routeAuthoringApi(request, env, session, requestId);
  if (authoringResponse) return authoringResponse;

  const resultsResponse = await routeResultsApi(request, env, session, requestId);
  if (resultsResponse) return resultsResponse;

  const workspaceMatch = pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/workspace$/);
  if (workspaceMatch?.[1]) {
    return request.method === "GET"
      ? organizationWorkspace(env, session, decodeURIComponent(workspaceMatch[1]), requestId)
      : methodNotAllowed(requestId, ["GET"]);
  }
  const memberMatch = pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/members\/([^/]+)$/);
  if (memberMatch?.[1] && memberMatch[2]) {
    return membershipById(request, env, session, requestId, decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]));
  }
  const membersMatch = pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/members$/);
  if (membersMatch?.[1]) return members(request, env, session, requestId, decodeURIComponent(membersMatch[1]));
  const organizationMatch = pathname.match(/^\/api\/v1\/organizations\/([^/]+)$/);
  if (organizationMatch?.[1]) return organizationById(request, env, session, requestId, decodeURIComponent(organizationMatch[1]));

  return problemResponse({ code: "not_found", detail: "Запрошенный API-ресурс не существует.", requestId, status: 404, title: "Ресурс не найден" });
}
