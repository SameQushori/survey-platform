import type { OrganizationWorkspaceDTO } from "../shared/contracts";
import { jsonResponse, methodNotAllowed, problemResponse } from "./http";
import { requireOrganizationAccess, type AuthorizedSession } from "./session";
import { routeAuthoringApi } from "./authoring";
import { routeResultsApi } from "./results";

async function organizationWorkspace(
  env: Env,
  session: AuthorizedSession,
  organizationId: string,
  requestId: string,
): Promise<Response> {
  const role = requireOrganizationAccess(session, organizationId);
  const organization = await env.DB
    .prepare("SELECT id, name, slug FROM organizations WHERE id = ?1 AND status = 'active'")
    .bind(organizationId)
    .first<{ id: string; name: string; slug: string }>();
  if (!organization) {
    return problemResponse({ code: "not_found", requestId, status: 404, title: "Рабочее пространство не найдено" });
  }
  const body: OrganizationWorkspaceDTO = { organization, role };
  return jsonResponse(body, requestId);
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

  return problemResponse({ code: "not_found", detail: "Запрошенный API-ресурс не существует.", requestId, status: 404, title: "Ресурс не найден" });
}
