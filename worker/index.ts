import { getRequestId, jsonResponse, methodNotAllowed, problemResponse } from "./http";
import { routeAuthorizedApi } from "./admin";
import { authenticateRequest, IdentityError } from "./auth";
import { AuthorizationError, resolveSession } from "./session";
import { routeParticipantApi } from "./participant";
import { routeOrganizerAuth } from "./organizer-auth";

async function healthResponse(env: Env, requestId: string): Promise<Response> {
  const databaseCheck = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

  if (databaseCheck?.ok !== 1) {
    return problemResponse({
      code: "internal_error",
      requestId,
      status: 503,
      title: "Сервис временно недоступен",
    });
  }

  return jsonResponse(
    {
      status: "ok",
      checks: { database: "ok" },
    },
    requestId,
  );
}

async function routeApi(request: Request, env: Env, ctx: ExecutionContext, requestId: string): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    if (request.method !== "GET") {
      return methodNotAllowed(requestId);
    }

    return healthResponse(env, requestId);
  }

  if (url.pathname.startsWith("/api/v1/")) {
    const participantResponse = await routeParticipantApi(request, env, requestId);
    if (participantResponse) return participantResponse;

    const organizerAuthResponse = await routeOrganizerAuth(request, env, ctx, requestId);
    if (organizerAuthResponse) return organizerAuthResponse;

    try {
      const identity = await authenticateRequest(request, env);
      const session = await resolveSession(env.DB, identity);
      return await routeAuthorizedApi(request, env, session, requestId);
    } catch (error) {
      if (error instanceof IdentityError) {
        return problemResponse({
          code: error.status === 401 ? "unauthorized" : "internal_error",
          requestId,
          status: error.status,
          title: error.status === 401 ? "Требуется вход" : "Аутентификация не настроена",
        });
      }
      if (error instanceof AuthorizationError) {
        return problemResponse({
          code: error.status === 403 ? "forbidden" : "not_found",
          requestId,
          status: error.status,
          title: error.status === 403 ? "Недостаточно прав" : "Ресурс не найден",
        });
      }
      throw error;
    }
  }

  return problemResponse({
    code: "not_found",
    detail: "Запрошенный API-ресурс не существует.",
    requestId,
    status: 404,
    title: "Ресурс не найден",
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const requestId = getRequestId(request);

    try {
      return await routeApi(request, env, ctx, requestId);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "api_request_failed",
          method: request.method,
          path: new URL(request.url).pathname,
          requestId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );

      return problemResponse({
        code: "internal_error",
        requestId,
        status: 500,
        title: "Внутренняя ошибка сервиса",
      });
    }
  },
} satisfies ExportedHandler<Env>;
