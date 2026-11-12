# 03 — Build API

## P3.1 Tests first, from the contract
```
Context: @src/contracts/users.ts and the edge-case list from P2.1.
Write Vitest tests for the Users API route handlers BEFORE the implementation exists. One test per edge case plus:
duplicate email race (two concurrent POSTs), PATCH on missing id (404), PATCH attempting to set createdAt (rejected),
malformed JSON, oversized body, repository throwing (500 without leaking internals), idempotent retry returns the same user.
Test through the public handler interface, not internals. Use the in-memory repository.
Constraints: no snapshot tests; assertions must be on status code AND body shape.
```
**Verify:** run them; they must FAIL for the right reasons first (red), then pass after implementation.

## P3.2 Implement to green
```
Implement the route handlers and the UserRepository (in-memory adapter) to make the tests pass.
Constraints: validate with the shared zod schemas; map every failure to the error envelope; centralize error mapping in ONE function;
no try/catch scattered per handler; no new dependencies. Smallest implementation that passes. Show me the diff summary, not the files.
```
**Verify:** tests green; then run the `api-reviewer` agent (P6.1) because the author must not be the reviewer.

## P3.3 Persistence honesty check
```
Given ADR-002, list precisely what breaks if this runs on Vercel serverless with in-memory/file storage
(cold starts, multiple instances, read-only FS), what I should say about it in the architecture doc, and the minimal change to
swap in Postgres via the repository interface. Do not implement it.
```
**Verify:** I check the claims against Vercel's actual runtime behavior before writing them down.
