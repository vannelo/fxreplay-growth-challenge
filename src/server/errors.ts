import { ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from '../contracts/users';

/** Thrown by handlers for every expected failure; turned into the contract envelope in exactly one place (`withErrors`). */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string[]>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

/** On every API response: never cached (the list contains emails), never content-sniffed. */
export const API_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const;

export function apiJson(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: { ...API_HEADERS, ...(init.headers as Record<string, string> | undefined) } });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  fields?: Record<string, string[]>,
  headers?: Record<string, string>,
): Response {
  const body: ErrorEnvelope = { error: { code, message, ...(fields && { fields }) } };
  return apiJson(body, { status: ERROR_STATUS[code], ...(headers && { headers }) });
}

/** What reaches the logs for an unexpected error: name + a message with credentials and emails removed. Never the stack's data. */
export function redact(error: unknown): { name: string; message: string } {
  const e = error instanceof Error ? error : new Error(String(error));
  const message = e.message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@') // scheme://user:pass@host → scheme://***@host
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, '<email>')
    .slice(0, 300);
  return { name: e.name, message };
}

/** The only try/catch around handlers. Unknown errors are logged server-side and never reach the client. */
export function withErrors<Ctx>(
  handler: (ctx: Ctx) => Promise<Response>,
  /** Observes every mapped failure (e.g. analytics). Must not throw; it cannot change the response. */
  onError?: (failure: { code: ErrorCode; fields?: Record<string, string[]> | undefined }, ctx: Ctx) => void,
): (ctx: Ctx) => Promise<Response> {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (error) {
      const failure = error instanceof ApiError ? { code: error.code, fields: error.fields } : { code: 'internal_error' as const };
      if (!(error instanceof ApiError)) console.error('Unhandled error in Users API', redact(error));
      try {
        onError?.(failure, ctx); // an observer (analytics) must never change the response
      } catch (observerError) {
        console.error('Users API error observer threw (response unaffected)', redact(observerError).name);
      }
      return error instanceof ApiError
        ? errorResponse(error.code, error.message, error.fields, error.headers)
        : errorResponse('internal_error', 'Something went wrong. Please try again.');
    }
  };
}
