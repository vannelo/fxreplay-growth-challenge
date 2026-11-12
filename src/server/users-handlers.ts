import { createHash } from 'node:crypto';
import type * as z from 'zod/mini';
import {
  CreateUserBody,
  CreateUserHeaders,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  ListUsersQuery,
  MAX_BODY_BYTES,
  UpdateUserBody,
  UserIdParam,
  fieldErrorsFrom,
} from '../contracts/users';
import type { FieldName } from '../analytics/events';
import type { ServerAnalytics } from '../analytics/server';
import { ApiError, apiJson, errorResponse, redact, withErrors } from './errors';
import type { UserRepository } from './user-repository';

/** The subset of Astro's APIContext the handlers use. APIRoute is assignable to this shape. */
export interface HandlerContext {
  request: Request;
  params: Record<string, string | undefined>;
}
export type UsersHandler = (ctx: HandlerContext) => Promise<Response>;

/* ---------- request helpers ---------- */

const tooLarge = () => new ApiError('payload_too_large', `Request body must be at most ${MAX_BODY_BYTES} bytes`);

/**
 * Reads at most MAX_BODY_BYTES and stops the stream as soon as that is exceeded, so a chunked body with no
 * Content-Length cannot make the server buffer megabytes before saying no (audit finding).
 */
async function readCapped(request: Request): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Transport checks in order: media type (415) → size (413) → UTF-8 + JSON syntax (400). Schema validation happens after. */
async function readJsonBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ApiError('unsupported_media_type', 'Content-Type must be application/json');
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge();
  const bytes = await readCapped(request);
  try {
    // fatal: invalid UTF-8 is an error, never silently replaced with U+FFFD and stored (audit finding)
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError('invalid_json', 'Request body is not valid UTF-8 JSON');
  }
}

const invalidFields = (fields: Record<string, string[]>) =>
  new ApiError('validation_error', 'Some fields are invalid', fields);

/** One 422 for everything wrong with a request (body, headers, params, query), not one problem at a time. */
function validationError(...errors: Array<z.core.$ZodError | undefined>): ApiError {
  const fields: Record<string, string[]> = Object.create(null); // see fieldErrorsFrom: keys like "__proto__" are data
  for (const error of errors) {
    if (!error) continue;
    for (const [field, messages] of Object.entries(fieldErrorsFrom(error))) (fields[field] ??= []).push(...messages);
  }
  return invalidFields(fields);
}

const requestHash = (body: CreateUserBody) =>
  createHash('sha256')
    .update(JSON.stringify({ email: body.email, name: body.name ?? null }))
    .digest('hex');

const methodNotAllowed =
  (allow: string): UsersHandler =>
  async () =>
    errorResponse('method_not_allowed', 'Method not allowed', undefined, { Allow: allow });

/** Failures the signup form can cause and analytics counts. 400/413/415/405/404 and 429 are deliberately NOT events. */
const COUNTED_FAILURES = new Set(['email_taken', 'validation_error', 'idempotency_key_reuse', 'internal_error']);
const isField = (key: string): key is FieldName => key === 'email' || key === 'name';

/* ---------- handlers ---------- */

export function createUsersHandlers(repo: UserRepository, analytics: ServerAnalytics) {
  /** Analytics is an observer: whatever it does (including a strict-mode throw in dev/test), the HTTP response stands. */
  const emit: ServerAnalytics['capture'] = (event, request) => {
    try {
      analytics.capture(event, request);
    } catch (error) {
      console.error('analytics capture threw (response unaffected)', redact(error));
    }
  };

  const POST = withErrors<HandlerContext>(async ({ request }) => {
    const raw = await readJsonBody(request);
    const body = CreateUserBody.safeParse(raw);
    const headers = CreateUserHeaders.safeParse({ 'idempotency-key': request.headers.get(IDEMPOTENCY_HEADER) ?? undefined });
    if (!body.success || !headers.success) throw validationError(body.error, headers.error);

    const result = await repo.create(body.data, {
      key: headers.data['idempotency-key'],
      requestHash: requestHash(body.data),
    });
    switch (result.kind) {
      case 'created':
        // The conversion: server-confirmed, once, after the commit. A replay (below) is NOT counted again.
        emit({ name: 'signup_succeeded', props: { user_id: result.user.id, name_provided: result.user.name !== null } }, request);
        return apiJson({ data: result.user }, { status: 201, headers: { Location: `/api/users/${result.user.id}` } });
      case 'replayed':
        return apiJson(
          { data: result.user },
          { status: 201, headers: { Location: `/api/users/${result.user.id}`, [IDEMPOTENCY_REPLAYED_HEADER]: 'true' } },
        );
      case 'key_reuse':
        throw new ApiError('idempotency_key_reuse', `${IDEMPOTENCY_HEADER} was already used with a different request`);
      case 'email_taken':
        throw new ApiError('email_taken', 'An account with this email already exists');
    }
  }, ({ code, fields }, { request }) => {
    if (!COUNTED_FAILURES.has(code)) return;
    const failedFields = Object.keys(fields ?? {}).filter(isField);
    emit(
      {
        name: 'signup_failed',
        props: { source: 'server', error_code: code, retryable: code === 'internal_error', ...(failedFields.length ? { failed_fields: failedFields } : {}) },
      },
      request,
    );
  });

  const PATCH = withErrors<HandlerContext>(async ({ request, params }) => {
    const raw = await readJsonBody(request);
    const body = UpdateUserBody.safeParse(raw);
    const param = UserIdParam.safeParse(params);
    if (!body.success || !param.success) throw validationError(body.error, param.error);

    const result = await repo.update(param.data.id, body.data);
    switch (result.kind) {
      case 'updated':
        return apiJson({ data: result.user });
      case 'not_found':
        throw new ApiError('not_found', 'User not found');
      case 'email_taken':
        throw new ApiError('email_taken', 'An account with this email already exists');
    }
  });

  const GET = withErrors<HandlerContext>(async ({ request }) => {
    const query = ListUsersQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw validationError(query.error);

    const result = await repo.list(query.data);
    if (result.kind === 'invalid_cursor') throw invalidFields({ cursor: ['Invalid cursor'] });
    return apiJson(result.page);
  });

  return {
    collection: { GET, POST, ALL: methodNotAllowed('GET, POST') },
    item: { PATCH, ALL: methodNotAllowed('PATCH') },
  };
}
