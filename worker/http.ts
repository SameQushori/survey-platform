import type { ApiProblem, ApiProblemCode } from "../shared/contracts";

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;

const apiSecurityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();

  return supplied && requestIdPattern.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

function withStandardHeaders(
  headers: HeadersInit | undefined,
  requestId: string,
): Headers {
  const result = new Headers(headers);

  for (const [name, value] of Object.entries(apiSecurityHeaders)) {
    result.set(name, value);
  }

  result.set("X-Request-Id", requestId);
  return result;
}

export function jsonResponse(
  body: unknown,
  requestId: string,
  init: ResponseInit = {},
): Response {
  const headers = withStandardHeaders(init.headers, requestId);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return Response.json(body, { ...init, headers });
}

interface ProblemOptions {
  code: ApiProblemCode;
  detail?: string;
  headers?: HeadersInit;
  requestId: string;
  status: number;
  title: string;
  fieldErrors?: Record<string, string[]>;
}

export function problemResponse(options: ProblemOptions): Response {
  const problem: ApiProblem = {
    type: `https://vecta.invalid/problems/${options.code}`,
    title: options.title,
    status: options.status,
    code: options.code,
    requestId: options.requestId,
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
  };
  const headers = withStandardHeaders(options.headers, options.requestId);
  headers.set("Content-Type", "application/problem+json; charset=utf-8");

  return Response.json(problem, { status: options.status, headers });
}

export function methodNotAllowed(requestId: string, allowed = ["GET"]): Response {
  return problemResponse({
    code: "bad_request",
    detail: "Этот HTTP-метод не поддерживается для указанного ресурса.",
    headers: { Allow: allowed.join(", ") },
    requestId,
    status: 405,
    title: "Метод не поддерживается",
  });
}

export async function readJsonBody(
  request: Request,
  requestId: string,
  maxBytes = 32_768,
): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    return problemResponse({
      code: "bad_request",
      detail: "Ожидается тело запроса в формате application/json.",
      requestId,
      status: 415,
      title: "Неподдерживаемый формат",
    });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return problemResponse({
      code: "bad_request",
      detail: "Тело запроса превышает допустимый размер.",
      requestId,
      status: 413,
      title: "Слишком большой запрос",
    });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    return problemResponse({
      code: "bad_request",
      detail: "Тело запроса превышает допустимый размер.",
      requestId,
      status: 413,
      title: "Слишком большой запрос",
    });
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return problemResponse({
      code: "bad_request",
      detail: "Тело запроса содержит некорректный JSON.",
      requestId,
      status: 400,
      title: "Некорректный запрос",
    });
  }
}
