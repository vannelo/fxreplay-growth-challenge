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
import { ApiError, errorResponse, withErrors } from './errors';
import type { UserRepository } from './user-repository';

/** The subset of Astro's APIContext the handlers use. APIRoute is assignable to this shape. */
export interface HandlerContext {
  request: Request;
  params: Record<string, string | undefined>;
}
export type UsersHandler = (ctx: HandlerContext) => Promise<Response>;

/* ---------- request helpers ---------- */

/** Transport checks in order: media type (415) → size (413) → JSON syntax (400). Schema validation happens after. */
async function readJsonBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ApiError('unsupported_media_type', 'Content-Type must be application/json');
  }
  const tooLarge = () => new ApiError('payload_too_large', `Request body must be at most ${MAX_BODY_BYTES} bytes`);
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge();
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw tooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('invalid_json', 'Request body is not valid JSON');
  }
}

const invalidFields = (fields: Record<string, string[]>) =>
  new ApiError('validation_error', 'Some fields are invalid', fields);

/** One 422 for everything wrong with a request (body, headers, params, query), not one problem at a time. */
function validationError(...errors: Array<z.core.$ZodError | undefined>): ApiError {
  const fields: Record<string, string[]> = {};
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

/* ---------- handlers ---------- */

export function createUsersHandlers(repo: UserRepository) {
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
        return Response.json({ data: result.user }, { status: 201, headers: { Location: `/api/users/${result.user.id}` } });
      case 'replayed':
        return Response.json(
          { data: result.user },
          { status: 201, headers: { Location: `/api/users/${result.user.id}`, [IDEMPOTENCY_REPLAYED_HEADER]: 'true' } },
        );
      case 'key_reuse':
        throw new ApiError('idempotency_key_reuse', `${IDEMPOTENCY_HEADER} was already used with a different request`);
      case 'email_taken':
        throw new ApiError('email_taken', 'An account with this email already exists');
    }
  });

  const PATCH = withErrors<HandlerContext>(async ({ request, params }) => {
    const raw = await readJsonBody(request);
    const body = UpdateUserBody.safeParse(raw);
    const param = UserIdParam.safeParse(params);
    if (!body.success || !param.success) throw validationError(body.error, param.error);

    const result = await repo.update(param.data.id, body.data);
    switch (result.kind) {
      case 'updated':
        return Response.json({ data: result.user });
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
    return Response.json(result.page);
  });

  return {
    collection: { GET, POST, ALL: methodNotAllowed('GET, POST') },
    item: { PATCH, ALL: methodNotAllowed('PATCH') },
  };
}
