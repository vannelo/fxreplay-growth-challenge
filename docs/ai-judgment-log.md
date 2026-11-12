# AI Judgment Log

The review asks: *what did you delegate, what did you do yourself, what did you reject or correct, how did you validate?*
This log answers that with evidence. **Fill it in during the work.** Do not invent or backfill entries; an empty
honest log is better than a polished fake one.

## How to log (30 seconds per entry)
Copy the template below, paste at the top of the entries section, fill it in right after the interaction.

```
### YYYY-MM-DD HH:MM — <short title>
- **Phase / agent:** (e.g. Phase 2, main thread | api-reviewer)
- **Delegated:** what I asked AI to do
- **Prompt:** link to docs/prompts/NN-*.md or paste the key part
- **Output (summary):** what it produced
- **My judgment:** accepted | corrected | rejected
- **Why:** the specific problem or the reason it was fine
- **Validation:** test / tool run / manual read / agent review that confirmed it
- **Commit:** <hash>
```

## Entries
### 2026-11-11 20:51 — Contract change from the tracking review: `X-Visitor-Id` (+ two AI-made choices still unreviewed)
- **Phase / agent:** Phase 1 (contract), main thread
- **Delegated:** implement my decision (e): visitor id reaches the server in an `X-Visitor-Id` header, zod-validated; variant read from the middleware cookie only. Update `src/contracts/users.ts` and `api-contract.md`; write ADR-007 and the new analytics plan.
- **Prompt:** direct instruction after the analytics review; see entries below.
- **Output (summary):** `VisitorId` schema + `VISITOR_ID_HEADER` in the contract, header table and "analytics side effects" in `api-contract.md` (+5 edge cases), ADR-007, rewritten `analytics-plan.md`, `CLAUDE.md` rule 5.
- **My judgment:** the header and cookie-only variant are **my decision**. Two choices the AI made on its own, **pending my review (not yet accepted)**: (1) `VisitorId` is optional and a malformed value is treated as absent instead of a 422, so analytics can never block a signup (`z.uuid().optional().catch(undefined)`); (2) `landing_viewed` doubles as the exposure event (the review proposed keeping `experiment_exposed`, my funnel starts at `landing_viewed`, so one event carries both).
- **Why:** both follow from my funnel and from not letting an analytics failure cost a conversion.
- **Validation:** AI ran a typecheck under `strict` and 5 inputs against zod 4.6.7 (valid / absent / garbage / empty / email → only the valid one survives). Not independent of the author; the API tests are the real check. PostHog options were checked against the posthog-js config docs, which did not confirm that `persistence: 'memory'` avoids cookies, so ADR-007 relies on `disable_persistence` and a Playwright assertion.
- **Commit:** n/a (repo not yet under git)

### 2026-11-11 20:51 — Tracking-plan review: my corrections and decisions on AI findings
- **Phase / agent:** Phase 1, `analytics-architect` (read-only) + main thread
- **Delegated:** stress-test my draft taxonomy (P2.2). The agent edited nothing.
- **Prompt:** [docs/prompts/02-contract.md](prompts/02-contract.md) P2.2
- **Output (summary):** findings on formatting, double-counting, consent, funnel bias, PII and bots.
- **My judgment:**
  - **Accepted:** findings 1-5 (server-emitted conversion; skip emit on idempotent replay and key on user id; consent model; funnel-bias note; one exposure/entry event with once-guards) and all medium items (submit/failed semantics, `email_taken` reported separately, `landing_viewed` allow-list, `cta_clicked`/`signup_started` weakness).
  - **Corrected (`cta_clicked`):** the main-thread AI hedged ("keep it if the CTA leads to the form"). I corrected it with a fact it did not have: the form is in the hero, visible on load, so I dropped the event; `signup_started` is the intent step.
  - **Corrected (activation guardrail):** the agent said "add an event or drop the claim". I dropped it and chose `signup_failed` rate, `email_taken` rate and LCP as guardrails, since a real activation event needs the FX Replay app.
  - **Replaced (`is_internal`):** the agent proposed an event property. I replaced it with a documented PostHog filter process (per-env projects, internal-user filter), not a property.
  - **Chosen (consent):** the agent flagged the gap; the model is my decision (ADR-007: cookieless SDK + one first-party id cookie, legal assumption pending).
- **Why:** the corrections rest on product facts and scope the agent could not see from the files.
- **Validation:** the main-thread AI checked the agent's formatting claims against the actual file (they held); the data-quality section of `analytics-plan.md` turns each accepted finding into a CI or production check. None of those checks exist yet.
- **Commit:** n/a (repo not yet under git)

### 2026-11-11 20:32 — Signup field set decided by AI, reviewed and accepted
- **Phase / agent:** Phase 1 (contract), main thread
- **Delegated:** design the Users API contract (P2.1). The "which fields does signup collect" decision was left as a blank placeholder in the prompt.
- **Prompt:** [docs/prompts/02-contract.md](prompts/02-contract.md) P2.1
- **Output (summary):** AI filled the gap itself: `email` required, `name` optional, no password (no auth system), and said so explicitly as an assumption.
- **My judgment:** accepted
- **Why:** it supports both experiment arms (control: email + name, variant: email only) with no schema change. This was an AI-made decision on a field I had marked as mine, so I reviewed it before accepting.
- **Validation:** I read the contract and its assumptions list. Schema behaviour was probed by the AI against zod 4.6.7 (typecheck under `strict`, 16 inputs); that probe is not independent of the author, so the P3.1 tests are the real check.
- **Commit:** n/a (repo not yet under git)

_(append new entries above this line, newest first)_

---

## Categories to look for (prompts for my own attention, not entries)
Good rejection/correction candidates tend to be where AI is confidently wrong:
- Over-engineering (extra abstractions, unneeded dependencies, generic "enterprise" structure)
- Validation only on the client, or schemas duplicated between client and server
- Analytics firing on click instead of server-confirmed conversion; PII in event properties; duplicate events
- Accessibility theater (ARIA added where native semantics suffice, missing focus management after errors)
- Raw hex colors or off-brand fonts instead of semantic tokens
- Persistence that silently breaks on serverless (in-memory/file on Vercel)
- Invented statistics, baselines, or sample-size numbers
- Tests that assert implementation details or always pass

## Summary for the review (fill in at the end, from the entries above)
- Delegated: …
- Did myself: …
- Rejected/corrected (top 3, with evidence): …
- How I validated: …
