# Users API — contract notes

Schemas live in [`src/contracts/users.ts`](../src/contracts/users.ts) (source of truth). This file is the behaviour table and the test list.

## Status table
Mutating requests must send `Content-Type: application/json`. Astro's `security.checkOrigin` does **not** inspect JSON
requests (it only covers form-style content types, verified in the config reference), so the 415 rule plus no CORS
headers (a JSON POST from another origin needs a preflight, which we never approve) is the CSRF defence.

| Endpoint | Success | Failures (trigger) |
|---|---|---|
| `POST /api/users` | **201** `{data: User}` + `Location: /api/users/:id` | 400 `invalid_json` (unparseable body) · 415 `unsupported_media_type` (not JSON) · 413 `payload_too_large` (body > 4096 bytes, by `Content-Length` or actual size) · 422 `validation_error` (bad/missing email, bad name, unknown key, missing/malformed `Idempotency-Key`) · 409 `email_taken` (email exists, different key) · 409 `request_in_progress` (same key still running) · 422 `idempotency_key_reuse` (same key, different payload) · 429 `rate_limited` (+`Retry-After`) · 500 `internal_error` |
| `POST /api/users` (replay: same key, same payload) | **201** original body + `Idempotent-Replayed: true` | as above |
| `PATCH /api/users/:id` | **200** `{data: User}` | 400 `invalid_json` · 415 · 413 · 422 `validation_error` (id not a UUID, empty body, unknown/immutable key `id`/`createdAt`/`updatedAt`, bad email/name) · 404 `not_found` · 409 `email_taken` (new email belongs to another user) · 429 · 500 |
| `GET /api/users` | **200** `{data: User[], nextCursor: string \| null}` | 422 `validation_error` (`limit` not an int in 1..100; malformed/foreign `cursor`) · 429 · 500 |
| any route, other method | n/a | 405 `method_not_allowed` (+`Allow`) |

## Request headers on `POST /api/users`
| Header | Required | Validation | On failure |
|---|---|---|---|
| `Content-Type: application/json` | yes | exact media type | 415 |
| `Idempotency-Key` | yes | `CreateUserHeaders` | 422 (`fields["idempotency-key"]`) |
| `X-Visitor-Id` | **no** | `VisitorId` (UUID) | **never fails**: absent/malformed ⇒ treated as absent (ADR-007) |

The variant is **not** a header or body field: the handler reads it from the middleware-set `fxr_variant` cookie only.
`X-Visitor-Id` is client-supplied and untrusted: analytics distinct id only, never authorization. It is a header (not a body
field) because the body is `strictObject`, so analytics context can't leak into the resource contract.

## Analytics side effects (handler behaviour, defined here so it is testable)
| Outcome | Server emits |
|---|---|
| 201 first-time create | `signup_succeeded` once, after the DB commit (`$insert_id` = user id) |
| 201 **replay** (`Idempotent-Replayed: true`) | **nothing** (already counted) |
| 409 `email_taken`, 422, 5xx | `signup_failed` (`source: server`) |
| 429 | nothing: bots would flood the project; rate limiting is observed via server logs/metrics |
| 400 / 415 (not produced by the form) | nothing |

Emission is best-effort and never changes the HTTP response: an analytics failure is logged, not thrown. It must complete (or be handed to the platform's `waitUntil`) before the function is frozen. Known loss mode: crash between DB commit and emit ⇒ conversion undercounted (production: outbox, see ADR-002).

## Decisions baked in (flag if you disagree)
- **`X-Visitor-Id` is optional and never fails the request**, because analytics must not be able to block a signup. (AI-made decision: revert to required by moving it into `CreateUserHeaders`.)
- **Fields: `email` required, `name` optional.** No password (no auth system). Supports both experiment arms (email-only vs email+name) with no schema change.
- **Idempotency-Key is required on POST**, 16–128 URL-safe chars. Same key+payload replays the first response; same key+different payload is 422; concurrent duplicate is 409. The email-unique rule remains the backstop for a *different* key.
- **422 for schema failures, 400 only for unparseable JSON.**
- **PATCH is `strictObject`**: immutable fields error instead of being silently ignored. `name: null` clears the name. `email` is updatable (re-checked for uniqueness).
- **`email_taken` reveals that an account exists** (user enumeration). Accepted for UX on a signup form; mitigated by rate limit. Production would move to email-verification flow.
- **Lowercasing the whole email**: standard practice, but `a+1@x.com` / dotted Gmail variants are distinct accounts.

## Known gaps (documented, not built)
- **No auth ⇒ anyone can `PATCH` any user and `GET` the list, which contains emails (PII).** IDs are unguessable UUIDs, but the list is open. Needed before any real data: auth/ownership on PATCH, admin-only list (or masked emails).
- No `GET /api/users/:id`, no DELETE (brief doesn't ask).
- No optimistic concurrency (`If-Match`); last write wins.

## Edge-case inputs → tests (P3.1)
1. `email: "  A@B.CO "` → stored as `a@b.co`; then `a@b.co` again with a new key → 409.
2. `email: "a@b"`, `""`, 255-char email, missing email, `email: 123` → 422 with `fields.email`.
3. `name: "   "` and `name: ""` → 422; `name` omitted → 201 with `name: null`; `name: "a\u0000b"` → 422; 81-char name → 422; emoji / non-Latin name → 201.
4. Body `{email, id: "x"}` on POST → 422 (`fields.id`).
5. PATCH with `{id}`, `{createdAt}`, `{}` and `{name: null}` → 422, 422, 422, 200.
6. PATCH with non-UUID id → 422; valid-but-unknown UUID → 404; PATCH email to another user's email → 409; PATCH email to its own current email → 200.
7. POST missing `Idempotency-Key`, 15-char key, key with spaces → 422 (`fields["idempotency-key"]`).
8. Same key + same body twice → both 201, same `id`, second has `Idempotent-Replayed: true`, exactly one row. Same key + different email → 422 `idempotency_key_reuse`. Two simultaneous requests with the same key → one 201, one 201-replay or 409 `request_in_progress`, never two rows.
9. Two simultaneous requests, same email, *different* keys → exactly one 201, one 409 (race on unique email).
10. Malformed JSON, `Content-Type: text/plain` (and form-encoded) body, array/`null` body → 400 / 415 / 422; response is always the error envelope, never a stack trace.
11. (Extra) `GET ?limit=0|101|abc` → 422; paging with `limit=1` over 3 users returns every user once, newest first, final page `nextCursor: null`; tampered `cursor` → 422; users created between pages don't cause duplicates.
12. `X-Visitor-Id`: valid UUID, absent, `""`, `not-a-uuid`, an email address → all 201; no 4xx ever caused by this header. Event payload carries the id only when valid.
13. Replay (same key + body) emits **no** second `signup_succeeded`; exactly one event per created user (assert on the capture sink).
14. 429 emits no event. 409 `email_taken` emits one `signup_failed` with `error_code: email_taken`.
15. Variant comes only from the `fxr_variant` cookie: a body/header claiming a variant is ignored (422 for body via `strictObject`); no cookie ⇒ event has `variant: "unattributed"`.
16. Assert no emitted property value contains an email address or the submitted name.
