# ADR-002: Persistence behind a `UserRepository` interface (in-memory for local/tests, Neon Postgres for live)

- **Status:** accepted
- **Date:** 2026-11-11
- **Decided by:** me (adapters, unique index and idempotency table are my decision; Claude drafted this text and added the analysis marked "AI-found" below)

## Context
The Users API ([contract](../api-contract.md)) needs create / update / list, a **unique email**, and **idempotent POST**.
The live deploy is on Vercel (ADR-001), which is serverless: each function instance has its own memory and its own
ephemeral filesystem, and instances start and stop freely. The brief leaves persistence open but asks for the rationale and trade-offs.

## Options considered
1. **In-memory only.** Zero setup. On serverless, each instance holds a different, short-lived copy: signups "succeed" then
   vanish, `GET /api/users` returns different data per request, and unique-email and idempotency are not enforced across instances. Wrong silently.
2. **JSON file.** Same problem; Vercel's filesystem is read-only/ephemeral. Fine only locally.
3. **Redis / KV (e.g. Upstash).** Durable and fast, but no unique constraint on a secondary field (email needs a manual lock/index), no ordered listing without extra structures.
4. **Notion / Sheets.** Brief mentions Notion. Strict rate limits, no uniqueness or transactions, slow; fine for a demo, poor for a conversion endpoint.
5. **Postgres (Neon) + in-memory adapter for local/tests.** Real constraints and transactions, serverless-friendly, free tier, branchable for CI. A hosted dependency to set up.

## Decision
**Option 5.** Handlers depend only on a `UserRepository` interface; two adapters implement it:
- `MemoryUserRepository`: local dev, unit and API tests, zero setup for reviewers (`npm run dev` works with no env).
- `PostgresUserRepository` (Neon): the live deploy. Selected when `DATABASE_URL` is set.

**Guard:** a production build with no `DATABASE_URL` fails at startup. It never falls back to memory, because that failure is silent (option 1).

### Interface (sketch; the final shape is settled in implementation)
Outcomes are returned as a discriminated union, not thrown, so handlers map them 1:1 to the contract's error codes.
```ts
interface UserRepository {
  create(input: CreateUserBody, idem: { key: string; requestHash: string }): Promise<
    | { kind: 'created'; user: User }
    | { kind: 'replayed'; user: User }          // same key + same payload
    | { kind: 'key_reuse' }                     // same key, different payload  → 422
    | { kind: 'email_taken' }                   // → 409
  >;
  update(id: string, patch: UpdateUserBody):
    Promise<{ kind: 'updated'; user: User } | { kind: 'not_found' } | { kind: 'email_taken' }>;
  list(q: ListUsersQuery): Promise<ListUsersResponse | { kind: 'invalid_cursor' }>; // → 422 on `cursor`
}
```
Idempotency lives **inside** `create`, not in the handler, because it must be atomic with the insert.

### Postgres schema
```sql
create table users (
  id         uuid primary key,
  email      text not null,
  name       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_normalized check (email = lower(btrim(email)))
);
create unique index users_email_key on users (email);
create index users_created_idx on users (created_at desc, id desc);   -- keyset pagination

create table idempotency_keys (
  key          text primary key,
  request_hash text not null,                         -- sha256 of the normalized body
  user_id      uuid not null references users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null                   -- now() + 24h; expired rows are deleted opportunistically
);
```
- **Unique index on normalized email:** the contract normalizes (trim + lowercase) before validation; the `CHECK` makes the
  database refuse anything not normalized, so a plain unique index is a unique index on the normalized value and every
  query stays a simple equality lookup. (Chosen over a `unique (lower(btrim(email)))` expression index so `ON CONFLICT (email)` and lookups need no expression matching.)
- **Create** runs in **one transaction**: claim `idempotency_keys(key)`; if the key exists, compare `request_hash`
  (different → `key_reuse`; same → return the stored user as `replayed`); otherwise insert the user, and a unique-violation
  on `users_email_key` rolls everything back → `email_taken`.
- **Pagination:** keyset on `(created_at desc, id desc)`. The cursor is an opaque base64url of that pair; the repository
  owns the encoding and returns `invalid_cursor` for anything it can't decode.
- **Migrations:** one plain `db/schema.sql` applied by a script. No ORM (no dependency for three tables). Driver: `@neondatabase/serverless`
  (HTTP/WebSocket; works from Vercel functions, avoids TCP connection exhaustion). **Not yet verified:** which mode supports the interactive
  transaction above (HTTP mode only batches); the alternative is one statement with data-modifying CTEs. Settle against Neon's docs when implementing.

## Trade-offs accepted
- **The two adapters can drift.** Mitigation: one shared **contract test suite** runs against both. Memory in unit tests; Postgres in CI (GitHub Actions `postgres` service container, or a Neon branch). If the suites diverge, the Postgres result wins.
- **In-memory cannot demonstrate cross-instance behaviour** (race on unique email across instances). Only the Postgres suite proves that.
- **A hosted dependency** and a secret (`DATABASE_URL`, server-only via `astro:env`) for the live deploy; reviewers who only run locally don't need it.
- **Cold-start/connection latency** added to `POST /api/users` on the live site. Measure it; it sits on the conversion path.
- **Rate limiting (429) is not solved here.** In-memory counters have the same serverless problem; it needs its own decision (edge/WAF or a shared store).
- Idempotency records for failed attempts (e.g. `email_taken`) are not stored: a retry with the same key re-evaluates and, deterministically, fails the same way.

## AI-found: `request_in_progress` is unreachable with this design
Because the key claim and the user insert share one transaction, a concurrent request with the same key blocks on the primary-key
conflict until the first commits or rolls back, then sees the committed row (replay) or none. There is no visible "in progress"
state, in either adapter. The contract's `request_in_progress` (409) code is therefore dead. Under the "no dead code" rule it should be
removed from `src/contracts/users.ts` and `api-contract.md`; **pending my confirmation** (not changed by this ADR).
A lock-wait timeout would instead surface as a 5xx/retry and is worth a test.

## What would change this at FX Replay production scale
- The Users API becomes its own service with real auth (ownership on PATCH, admin-only list); the marketing site only calls it.
- Email verification before an account is "created", which also removes the enumeration leak from `email_taken`.
- PII handling: retention policy, deletion/export (GDPR/CCPA), encryption at rest, audit log, no emails in application logs.
- Migrations through a real tool with review and rollback; connection pooling sized for traffic; read replica or caching for any list use.
- Conversion events emitted from a transactional outbox so server-confirmed `signup_completed` can't be lost or double-counted if the process dies after the insert.

## AI involvement
Claude drafted this document from my decision and added the transaction/idempotency analysis, the `CHECK`-constraint refinement
of "unique index on normalized email", and the dead-code finding above. I made the persistence choice and the schema requirements.
Nothing here is validated by running code yet; the shared contract tests (P3.1) and the Postgres CI run are the validation.
