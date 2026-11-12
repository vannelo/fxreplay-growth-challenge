/**
 * Users API contract — single source of truth for client, server and tests.
 * Contract only: no I/O, no framework imports. Handlers and the signup island both parse with these schemas.
 * Uses `zod/mini` (not classic `zod`): the island imports this file, and classic zod measured ~95 KB gzip in the
 * browser bundle vs ~6 KB for mini (see ai-judgment-log.md, ADR-006). Behaviour is pinned by tests/api/users.test.ts.
 *
 * Conventions
 *  - Success bodies are wrapped: `{ data }` (single) or `{ data, nextCursor }` (list).
 *  - Errors are always `{ error: { code, message, fields? } }`. `fields` keys are input field names.
 *  - Schema validation failures are 422; malformed JSON is 400.
 *  - Email is normalized (trim + lowercase) *before* validation, so the stored/compared value is canonical.
 */
import * as z from 'zod/mini';

/** Max request body for mutating endpoints. A valid body is well under 1 KB (email ≤254 + name ≤80 chars). */
export const MAX_BODY_BYTES = 4096;

/* ---------- Field primitives ---------- */

export const Email = z.pipe(
  z.string().check(z.trim(), z.toLowerCase()),
  z.email({ error: 'Enter a valid email address' }).check(z.maxLength(254, { error: 'Email is too long' })),
);

/**
 * Optional on create. Blank is NOT accepted: clients omit the key instead of sending "".
 * Rejects control, surrogate, private-use and unassigned code points, zero-width space/BOM and bidi overrides,
 * but ALLOWS ZWNJ/ZWJ (U+200C/U+200D): needed for Persian/Indic names and emoji sequences.
 */
export const Name = z.string().check(
  z.trim(),
  z.minLength(1, { error: 'Name cannot be empty' }),
  z.maxLength(80, { error: 'Name is too long (max 80)' }),
  z.regex(/^[^\p{Cc}\p{Cs}\p{Co}\p{Cn}\u200B\u202A-\u202E\u2066-\u2069\uFEFF]*$/u, { error: 'Name contains invalid characters' }),
);

/* ---------- Analytics attribution header (ADR-007) ---------- */

export const VISITOR_ID_HEADER = 'X-Visitor-Id';

/**
 * First-party random visitor id (UUID) sent by the signup island so the server-side conversion event can be
 * attributed to the same visitor as the client events. Analytics must never block a signup, so this does NOT
 * live in CreateUserHeaders: absent or malformed parses to `undefined` instead of failing the request.
 * Client-supplied, therefore untrusted: it may only ever be used as an analytics distinct id, never for authorization.
 * Usage: `VisitorId.parse(request.headers.get(VISITOR_ID_HEADER) ?? undefined)`
 */
export const VisitorId = z.catch(z.optional(z.uuid()), undefined);

/* ---------- Resource ---------- */

export const User = z.object({
  id: z.uuid(),
  email: Email,
  name: z.nullable(Name),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type User = z.infer<typeof User>;

/* ---------- POST /api/users ---------- */

/** Required header. Client generates one per submit attempt (crypto.randomUUID()) and reuses it on retry. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Parse `{ 'idempotency-key': request.headers.get(IDEMPOTENCY_HEADER) ?? undefined }` so errors are keyed by header name. */
export const CreateUserHeaders = z.object({
  'idempotency-key': z
    .string({ error: `${IDEMPOTENCY_HEADER} header is required` })
    .check(z.regex(/^[A-Za-z0-9_-]{16,128}$/, { error: '16–128 chars: letters, digits, "_" or "-"' })),
});

export const CreateUserBody = z.strictObject({
  email: Email,
  name: z.optional(Name),
});
export type CreateUserInput = z.input<typeof CreateUserBody>;
export type CreateUserBody = z.output<typeof CreateUserBody>;

export const CreateUserResponse = z.object({ data: User });
export type CreateUserResponse = z.infer<typeof CreateUserResponse>;

/* ---------- PATCH /api/users/:id ---------- */

export const UserIdParam = z.object({ id: z.uuid({ error: 'Invalid user id' }) });

/**
 * strictObject: `id`, `createdAt`, `updatedAt` (or anything unknown) is rejected with 422, never silently dropped,
 * so a client that thinks it changed an immutable field finds out. `name: null` clears the name.
 */
export const UpdateUserBody = z
  .strictObject({
    email: z.optional(Email),
    name: z.optional(z.nullable(Name)),
  })
  .check(
    z.refine((b) => b.email !== undefined || b.name !== undefined, {
      error: 'Provide at least one field to update',
    }),
  );
export type UpdateUserInput = z.input<typeof UpdateUserBody>;
export type UpdateUserBody = z.output<typeof UpdateUserBody>;

export const UpdateUserResponse = z.object({ data: User });
export type UpdateUserResponse = z.infer<typeof UpdateUserResponse>;

/* ---------- GET /api/users ---------- */

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 100;

/** Query-string input: values arrive as strings, hence coerce. Order is fixed: newest first, id as tiebreak. */
export const ListUsersQuery = z.object({
  // Decimal digits only: `Number()` would otherwise accept "1e1", "0x2" or " " (audit finding).
  limit: z._default(
    z.pipe(
      z.string().check(z.regex(/^[0-9]{1,3}$/, { error: `Must be a whole number from 1 to ${LIST_MAX_LIMIT}` })),
      z.pipe(z.coerce.number<string>(), z.int().check(z.gte(1), z.lte(LIST_MAX_LIMIT))),
    ),
    LIST_DEFAULT_LIMIT,
  ),
  /** Opaque to clients. Produced by the repository; a bad/foreign cursor → 422 on `cursor`. */
  cursor: z.optional(z.string().check(z.minLength(1), z.maxLength(256))),
});
export type ListUsersQuery = z.output<typeof ListUsersQuery>;

export const ListUsersResponse = z.object({
  data: z.array(User),
  nextCursor: z.nullable(z.string()),
});
export type ListUsersResponse = z.infer<typeof ListUsersResponse>;

/* ---------- Errors ---------- */

export const ErrorCode = z.enum([
  'invalid_json', // body is not parseable JSON
  'unsupported_media_type', // Content-Type is not application/json
  'payload_too_large', // body exceeds MAX_BODY_BYTES
  'validation_error', // schema failure (body, query, params, headers)
  'not_found', // no user with that id
  'email_taken', // unique email violated
  'idempotency_key_reuse', // same Idempotency-Key, different payload
  'rate_limited', // too many requests (sets Retry-After)
  'method_not_allowed',
  'internal_error', // never carries internals
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_STATUS = {
  invalid_json: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
  validation_error: 422,
  not_found: 404,
  email_taken: 409,
  idempotency_key_reuse: 422,
  rate_limited: 429,
  method_not_allowed: 405,
  internal_error: 500,
} as const satisfies Record<ErrorCode, number>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    fields: z.optional(z.record(z.string(), z.array(z.string()))),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/**
 * ZodError → `fields`. Unlike z.flattenError, unknown keys from strictObject are attributed to the key
 * itself ("id is not allowed"), which is what makes the PATCH-immutable-field case legible to the client.
 * Issues with no field (e.g. the "at least one field" refinement) go under `_form`.
 */
export function fieldErrorsFrom(error: z.core.$ZodError): Record<string, string[]> {
  // Null prototype: an unknown key named "__proto__", "constructor" or "toString" must become a field, not hit
  // Object.prototype (that turned a 422 into a 500; audit finding).
  const fields: Record<string, string[]> = Object.create(null);
  const add = (key: string, message: string) => (fields[key] ??= []).push(message);
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) add(key, `"${key}" is not allowed`);
    } else {
      add(issue.path.length ? issue.path.join('.') : '_form', issue.message);
    }
  }
  return fields;
}
