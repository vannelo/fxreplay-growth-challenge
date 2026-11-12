# 02 — Contract (before any implementation)

## P2.1 Users API contract
**Intent:** design the contract once, as zod schemas, used by client and server.

```
Role: API designer. Context: @CLAUDE.md engineering rules 1-3, ADR-002 (persistence behind a UserRepository interface).

Design the Users API for the "Try FX Replay Free" signup, implemented as Astro API endpoints (`src/pages/api/users`, on-demand). Check current Astro endpoint docs. Do not write handlers yet.
Deliver a single file `src/contracts/users.ts` with zod schemas + inferred types for:
- POST /api/users (create), PATCH /api/users/:id (update), GET /api/users (list, with cursor pagination)
- the error envelope { error: { code, message, fields? } } and an enum of error codes
Then a table: endpoint | success status | every failure status with its trigger.

Constraints: <my decision: which fields signup collects — email only vs email+name>. Normalize email (trim, lowercase).
PATCH must not allow setting id/createdAt. Handle duplicate email (409). Include an idempotency-key header for POST.
No auth system. No extra endpoints. No new dependencies besides zod.
Also list 10 edge-case inputs I should have tests for.
```
**Verify:** I read the schema; check that status codes are right; the 10 edge cases become test cases in P3.1.

## P2.2 Tracking plan (I write the taxonomy; AI stress-tests it)
**Intent:** the event taxonomy is my decision. AI finds holes.

```
Use the analytics-architect agent. Context: @docs/analytics-plan.md (my draft taxonomy) and the funnel in @docs/00-process.md.
Review my draft. For each event report: does it inform a decision? duplicate-fire risks? PII risk? consent-gating? 
Is the conversion event server-confirmed? What would make this number wrong in production (bots, internal traffic,
ad-blockers, double submits, back-button re-fires)? Propose removals before additions.
Output: `[severity] event — problem — fix`. Do not edit the file.
```
**Verify:** I accept/reject each finding in the log. Accepted ones become Playwright assertions (see 05).
