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

export function errorResponse(
  code: ErrorCode,
  message: string,
  fields?: Record<string, string[]>,
  headers?: Record<string, string>,
): Response {
  const body: ErrorEnvelope = { error: { code, message, ...(fields && { fields }) } };
  return Response.json(body, { status: ERROR_STATUS[code], headers });
}

/** The only try/catch around handlers. Unknown errors are logged server-side and never reach the client. */
export function withErrors<Ctx>(handler: (ctx: Ctx) => Promise<Response>): (ctx: Ctx) => Promise<Response> {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error.code, error.message, error.fields, error.headers);
      console.error('Unhandled error in Users API', error);
      return errorResponse('internal_error', 'Something went wrong. Please try again.');
    }
  };
}
