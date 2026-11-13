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
### 2026-11-12 23:30 — Postgres (Neon) adapter: built, raced on the real database, reviewed by a second agent
- **Phase / agent:** pre-deploy, main thread (plan mode) → `api-reviewer` (independent)
- **Delegated:** I created the Neon database and asked whether the in-memory storage limitation could be fixed before deploying. The AI planned and built the ADR-002 adapter and the guard.
- **Output (summary):**
  - Neon over HTTP with single-statement writes. This settles ADR-002's open driver question from Neon's current docs.
  - A contract suite that runs against memory, Postgres-on-PGlite and Postgres-on-Neon.
  - `db:migrate`.
  - The guard: prod/preview without `DATABASE_URL` refuse to serve the API.
- **Mistakes caught by verification, not by reading:**
  - **Leftover test rows.** A sabotage run left 10 test rows in my Neon database. `Promise.all` rejected early, cleanup ran while writes were still in flight, and the users delete then failed on the foreign key. Found by counting rows afterwards. Fixed with `allSettled` and a single-statement cleanup, then re-proved: the database was empty after a second sabotage run.
  - **Guard wording.** The plan said the guard fails "at startup". Running a real production build showed it fails on the first API request, because routes load lazily, while the landing page still returns 200. The docs were corrected to say that.
- **Independent review (`api-reviewer`):** no correctness bug in the race logic.
  - **Two Mediums, fixed:**
    - Expired key rows, each holding a copy of an email, were never purged, and the foreign key blocked erasure. Fixed: every create purges expired rows through an index, and the foreign key is now `ON DELETE CASCADE`.
    - The concurrent key-conflict branch was unreachable in CI. Fixed with injected-failure tests, plus a test pinning the constraint names to the real schema.
  - **Lows fixed:** uppercase user ids (lowercased in the contract), the migration script echoing the connection string on error, and the expiry behaviour documented in the API contract.
  - **Lows left, with reasons:**
    - No fetch timeout on the Neon client.
    - A replay after a lost 201 doesn't re-emit the conversion. That is the analytics plan's "never on replay" rule, and the outbox is the real fix.
    - Bare `astro dev` defaults to `prod` and hits the guard; `npm run dev` sets `dev`.
- **Validation:**
  - Neon race tests: 10 parallel creates per case give exactly 1 `created` plus 9 `replayed` / `email_taken` / `key_reuse`, with no orphans.
  - Sabotage: S1–S3 each fail tests, and S2/S3 now fail without Neon too.
  - Persistence survives a dev-server restart (409 on the second signup).
  - `astro check` 0 errors, 257 Vitest tests pass, 94 Playwright tests pass. E2E is pinned to memory, and Neon was empty afterwards.
- **My judgment:** _pending: owner to confirm the deferred Lows._ The Neon password was pasted into the chat and must be rotated after verification.
- **Commit:** not yet committed

### 2026-11-12 15:05 — Owner decisions on the last open items
- **Phase / agent:** Phase 5, main thread. The AI asked; I decided.
- **My judgment:**
  - **Hydration = `client:load`.** Applied my pre-registered rule; both modes missed the 1 s threshold, which makes the rule's fallback `client:load`. In practice a tie (re-measure: 1497 vs 1518 ms, LCP equal).
  - **`request_in_progress` removed** (unreachable, "no dead code").
  - **Sign-in URL and PostHog key left unset** on purpose, documented in the README as required before the live deploy.
  - **I will write `docs/architecture.md` and `docs/performance-review.md` myself**; P6.3 runs against them afterwards.
- **What the AI changed:**
  - Removed the temporary `HYDRATE_MODE` switch and the `signup-hydrated` mark.
  - Reworked `scripts/measure-hydration.mjs` so it still runs on the real build: "interactive" is now when the server-disabled submit button is enabled, which is not the old performance mark, so it reads slightly later.
  - Removed the error code from the contract and docs. One unit test had used it as "another 409"; it now uses a code outside the contract and expects `reported: false`.
  - ADR-006 → accepted; ADR-002 dead-code section → resolved.
  - README local setup and configuration table.
- **Validation:** no leftovers (`grep`); `astro check` 0 errors; 227 Vitest; 94 Playwright. Measurement script on the final build (5 runs): interactive 1473 ms median, LCP 640 ms, TBT 0, worst interaction 32 ms, typed text lost 0/5.
- **Commit:** n/a

### 2026-11-12 14:52 — P6 audits (author ≠ reviewer) and the fix pass
- **Phase / agent:** Phase 5 (audit). Independent read-only runs: `api-reviewer` (attacked the live production build), `a11y-auditor` (real browser this time), `analytics-architect` (tracking audit), then `perf-auditor` alone so its lab numbers weren't skewed. Fixes by the main thread. **Plan mode was skipped for the fix pass** because I said "address everything you can address now".
- **Delegated:** finding bugs (each agent was told to assume they exist and to list what held up, so silence is evidence). Triage is mine; this entry records it.
- **Spot-checks before accepting anything (the AI's own reproductions):** the prototype-key 500 (live: `toString`/`constructor`/`__proto__` → 500), the ZWNJ/ZWJ name rejections, the font bug (real browser: body computed to a literal `"Nunito Sans"`, all Nunito faces `unloaded`), and four of the tracking findings by reading the code and docs.
- **Fixed (each with a regression test; the two Highs were also proven to FAIL with the bug put back):**
  - **High:** body font was never Nunito Sans (a token literal shadowed Astro's hashed font variable).
  - **High:** an unknown key named like an `Object.prototype` member made the API return 500.
  - **Medium:** analytics `capture` throwing could turn a created signup into a 500. Two agents found this independently.
  - **Medium:** request bodies are now capped while streaming, and invalid UTF-8 is a 400.
  - **Medium:** a replay now returns the original 201 body (ADR-002 amended).
  - **Medium:** platform failures (non-envelope 502/504/403) were invisible to the failure guardrail; the browser now reports them.
  - **Medium:** once-guards were consumed before consent; a later grant now recovers the entry and started events.
  - **Medium:** in forced colours the button and CTA had no boundary.
  - **Low:**
    - The client now validates the visitor-id cookie.
    - Clock-skew correction via `sent_at` (verified in the PostHog docs; its exact position in the body is not documented).
    - `PUBLIC_APP_ENV` now defaults to `prod`.
    - `limit` accepts decimal digits only.
    - Cursors must decode to a real date and a UUID.
    - Names now allow Persian and emoji sequences.
    - API responses are `no-store` + `nosniff`.
    - Error logs are redacted; my own earlier test had pinned a connection string in the log, and it was flipped.
    - "1 seconds" is now "1 second".
    - The final CTA hides after success.
    - The vacuous `pageshow` test was removed and a loose `toMatchObject` was tightened.
  - **Gap closed:** CSP via Astro `security.csp`. Verified: on on-demand pages it is a real header with hashes, no `'unsafe-inline'`, `frame-ancestors 'none'`, and zero violations through a full signup.
  - **Doc drift fixed:** stale SDK text in ADR-007 and the plan, the plan's back/forward overclaim, the `user_id` fallback contradiction, and `CLAUDE.md` lines that contradicted ADR-004/008.
- **Deferred, with reason (to "what I'd do next"):**
  - Rate limiting: needs a shared store or WAF; per-instance memory is false comfort on serverless.
  - `$geoip_disable`: not found in the PostHog docs I checked.
  - UTM charset restriction: it would drop legitimate campaign names; the real fix is a campaign allow-list.
  - Double announcements: need a screen reader before changing.
  - `modulepreload`: the agent measured it trading 440 ms of hydration for +220 ms of LCP.
  - Compression and immutable cache headers: platform behaviour; Vercel's CDN sets them, not verified.
  - INP, Lighthouse, field data.
  - The Postgres adapter and the shared adapter test suite.
- **Rejected:** typing `signup_failed.source` per emitter. The browser now legitimately reports platform failures as `source: server`.
- **Left for the owner:** the hydration directive (ADR-006 proposes `client:load`; code still runs the temporary `idle` default), removing `request_in_progress`, the copy, `PUBLIC_SIGNIN_URL`, `PUBLIC_POSTHOG_KEY`.
- **AI mistakes in this phase, all caught by running things:**
  - **Stale server:** I told the owner the perf audit ran on a "fresh server". It ran on a stale process left by an earlier, stopped agent: my new server failed to bind the busy port, and my health check was answered by the old one. The perf agent noticed (the page 404'd its own assets).
  - **My test helper:** it parsed error bodies with `z.record`, which itself drops a `__proto__` key, so one new test failed for the helper's reason, not the server's.
  - **CSP test:** I first asserted a CSP `<meta>`; Astro sends a header on on-demand pages.
  - **Unexplained:** the full-funnel test lost the API response body inside Chromium's DevTools protocol after this batch; not reproduced in isolation. The test now reads the body through `route.fetch`. Root cause unknown.
- **Validation:** `astro check` 0 errors; 227 Vitest; 94 Playwright (production build, mobile + desktop). Clean lab re-measure (10 runs per mode, Pixel 7, 4x CPU, 1.6 Mbps/150 ms): LCP median 636–652 ms, TBT 0, typed text lost 0. **Time-to-hydrated rose to ~1.50 s from ~1.31 s.** My hypothesis, unverified: the body font now actually loads and competes for the throttled link.
- **Not verified:** VoiceOver/NVDA speech, Safari/Firefox, real devices, the Vercel deployment, a real PostHog project, P6.3 (`performance-review.md` and `architecture.md` don't exist yet).
- **Commit:** n/a

### 2026-11-12 14:18 — P5 instrumentation: typed analytics, server-side conversion, data-level tests
- **Phase / agent:** Phase 4 (instrument), main thread (plan mode first). No specialist agent ran; the independent check is the sabotage run below, which is the AI testing its own work.
- **Delegated:** P5.1 typed wrapper + server emit, P5.2 Playwright tests that assert the data.
- **My judgment:** two decisions are mine, taken from measurements: **thin HTTP client instead of `posthog-js`** (126 KB vs 0.3 KB gzip; the layer added +1.6 KB to the real build) and **Global Privacy Control as the consent-denied signal** (ADR-003, ADR-007 amendment). The code is pending my read of the diff.
- **Where the AI changed the prompt, on purpose (flagged in the plan before building):** dedupe the conversion by *user id and skip-on-replay*, not "by idempotency key" (per-attempt, as accepted earlier); a hand-written registry + a **drift test** that parses `analytics-plan.md`, instead of generating code from markdown; no session id (cookieless, not in the plan); the PII guard throws in dev/test and *drops* in production so analytics can never break a signup.
- **Evidence the gate can fail (a gate that has never failed is unproven).** Each break was applied alone and every restore was checksum-verified: rename an event → 8 e2e fail; double-fire `signup_submitted` → 7; drop the `utm_campaign` key → 1 (the diff printed `- "utm_campaign": "spring"`); emit on idempotent replay → 1 e2e + 1 unit; server ignores GPC → 1 e2e + 1 unit; client ignores GPC → 1 e2e + 2 unit; leak the user's name into the conversion (not email-shaped, so the regex guard cannot catch it) → 1 e2e; rename a planned property in the plan → drift test fails. The type-level gate was proven the same way: legalizing one banned call made `astro check` fail with "Unused @ts-expect-error".
- **A mistake of mine that mattered:** my first sabotage script did not restore between runs (zsh does not split an unquoted variable, so the backup `cp` silently failed), leaving all six mutations in the working tree and contaminating five of the six results. It was caught because the "baseline" run still failed. I reversed each mutation by exact string, re-proved the tree (types clean, 194 unit, 80 e2e), and re-ran everything from a bash script with checksum verification (the first rewrite aborted on macOS bash 3.2 before touching anything). Only the second run's results are reported above.
- **Other AI errors caught by running things:** a strict-mode locator hitting both the visible message and the live region (twice), and a stray nonsense expression in a test.
- **Validation:** `astro check` 0 errors; 194 Vitest tests (50 analytics, 8 handler-level); 80 Playwright tests (40 × mobile + desktop) against the production build with a local capture sink that records both browser and server requests. Most of these tests passed on their first run because they were written after the code, which is why the sabotage run matters.
- **Not verified:** anything involving a real PostHog project (the browser transport's CORS/`sendBeacon` acceptance of `text/plain` bodies, `$insert_id` dedupe, events showing up in funnels); `waitUntil` on the deployed Vercel runtime (off-Vercel it is unit-tested to fall back safely); the real network panel (you run that check; steps below).
- **Commit:** n/a (not committed by the AI)

### 2026-11-12 12:35 — Landing page + signup island: AI errors caught by tests and measurement
- **Phase / agent:** Phase 3 (UI), main thread (plan mode first). `a11y-auditor` and `perf-auditor` run after this entry; their findings get their own entry.
- **Delegated:** build the page, the island, the state machine, middleware, e2e/unit tests, and the G2 hydration measurement from the approved plan.
- **My judgment:** pending my read of the diff. Facts below are what the AI itself got wrong or found, and what exposed it.
  - **Real bug in the AI's component, found by the measurement (not by a test I asked for):** controlled inputs wiped text typed before hydration (5 of 30 runs lost it). Fixed (uncontrolled inputs + adopt DOM values on mount). A deterministic regression test was added, and it was **verified to fail with the bug put back** (`Received: ""`) and pass without it.
  - **Latent AA failure in the AI's own token choice, found by the contrast test:** `--text-link` = blue-500 is 4.44:1 on the form card. axe never saw it because the 409 sign-in link isn't rendered until the URL exists. Switched to blue-400 (an existing primitive). Also removed a raw-hex `theme-color` meta that the hygiene test flagged.
  - **Wrong assumption retracted:** the plan expected `astro preview` to work with the Vercel adapter; it does not (ADR-008, Node adapter for e2e). Earlier I had also assumed the origin check was irrelevant to forms: observed instead, a cross-origin form POST gets **403** from Astro's check and a same-origin one gets our **415** (source read: only form-like content types are checked; there is a TODO to check all unsafe requests in Astro 8).
  - **Docs vs installed source:** the Fonts docs page doesn't show per-weight preload, but the installed `filterPreloads` supports `{ weight, style, subset }`, so the layout preloads only Lato 900 and Nunito Sans 400.
  - **My own estimates were off and were corrected in the log:** `zod/mini` for the real contract measured 13.8 KB in scratch (not the 6.4 KB first quoted); the real build's whole client JS is ~21.5 KB gzip.
  - **Test-writing mistakes by the AI, caught by running them:** a test that didn't pin its experiment arm (flaky ~50%, found with `--repeat-each=15`), an illegal cookie value, a strict-mode locator hitting both the visible message and the live region, and a `ship-gate` skill that still described pnpm/lint/`astro preview` (fixed to match the repo; lint is reported as "not configured", not as passing).
- **Validation:** 129 Vitest tests, 52 Playwright tests (26 × mobile + desktop, production build), `astro check` clean. **Mutation checks** on the state machine (always-reuse key, never-reuse key, no double-submit guard): 4, 4 and 2 tests failed respectively, so those tests can catch the bugs they name. axe has a **negative control** (a deliberately broken page produced contrast, alt, label, button-name and target-size violations), so "zero violations" is not an artefact of a broken helper.
- **Not verified:** screen-reader behaviour (VoiceOver), real devices, Vercel-specific behaviour (headers, cookies, CORS preflight on the deployed adapter), anything about the copy (all `TODO(owner)` placeholders are still in).
- **Commit:** n/a (not committed by the AI)

### 2026-11-12 12:35 — Hydration measurement (G2): what the numbers say, and what they don't
- **Phase / agent:** Phase 3 (UI), main thread
- **Delegated:** measure `client:load` vs `client:idle` before choosing (my instruction), using the rule I pre-registered in the plan.
- **Output (summary):** 15 runs per mode, Pixel 7 viewport, 4x CPU, 1.6 Mbps/150 ms RTT (`docs/measurements/hydration-run2.json`): time-to-hydrated median 1316.7 ms (`idle`) vs 1313.6 ms (`load`); LCP 652 vs 648 ms; TBT 0; worst interaction 32 ms; typed-text lost 0/15 in both after the fix. By my rule (median hydrated < 1 s required) both modes fail, so the rule says `client:load`.
- **My judgment:** **proposed `client:load`, not yet confirmed by me.** It is a tie in practice (3 ms); I treat the choice as low-stakes and reversible, and ADR-006 is marked "proposed" for the directive. The temporary switch stays in the code until I confirm.
- **Why it is not stronger:** lab only, n = 15, a single throttled profile; the INP proxy is quantized (constant 32 ms) and cannot separate the modes; the scripted "early press" landed after hydration, so **"0 dead presses" is not evidence**: the honest number is a ~0.67 s window where the button is visible but disabled, in both modes. My hypothesis that the 1.3 s is a module-chunk waterfall is **unverified**.
- **Validation:** run 2's raw per-run data is saved (`docs/measurements/hydration-run2.json`) and `scripts/measure-hydration.mjs` reproduces it. The first run exposed the typed-text bug above; **its raw JSON was deleted by mistake during cleanup** and is not recoverable, so `docs/measurements/hydration-run1-notes.md` holds only the numbers transcribed from the console output at the time.
- **Commit:** n/a

### 2026-11-11 22:11 — Hydration strategy: decision is "measure before choosing"; zod client size measured
- **Phase / agent:** Phase 3 (UI), main thread
- **Delegated:** P4.1 docs research (hydration directives) and a size measurement of the shared contract in the browser bundle.
- **Output (summary):** the docs do not say how `client:visible` behaves for a component already in the viewport. `client:idle` has a `timeout` option. The AI proposed `client:idle` + a disabled-until-hydrated submit button as the starting point.
- **My judgment:** I decided **not to pick yet**: build the form, then measure `client:load` vs `client:idle` (hydration time and INP) and choose from the numbers. No hydration choice has been made and none is claimed here.
- **Why:** `CLAUDE.md` allows `client:load` only when justified by a measurement; the hero form is above the fold, so an unmeasured `client:idle` could cost early interactions.
- **Validation (zod size, AI-run, scratch project, esbuild, minified, gzip, not the real Astro/Vite build, so re-measure there):** the contract imported as-is = **95.4 KB gzip** (459 KB raw); an equivalent `zod/mini` body schema = **6.4 KB gzip**; Preact + a small `useReducer` island = **5.8 KB gzip**. Importing the full contract into the island would be ~16x the cost of the framework itself.
- **Correction (after the G1 port to `zod/mini`):** the 6.4 KB figure was for a minimal email+name schema I wrote for the measurement, not the real contract. The real ported contract (the exports the island imports: `CreateUserBody`, `fieldErrorsFrom`, header constants) measures **13.8 KB gzip** in the same scratch setup, so about 7x smaller than classic zod but twice what the plan said. The 66 API tests pass unchanged on the port and `astro check` is clean. Still a scratch esbuild number; the real Astro build is the final measurement.
- **Commit:** n/a

### 2026-11-11 22:11 — Idempotency-key rule in my own P4.2 prompt was wrong (AI caught it, I fixed the prompt)
- **Phase / agent:** Phase 3 (UI), main thread
- **Delegated:** read P4.2 against the API contract before building.
- **Output (summary):** the spec "idempotency key generated once per form session" breaks as written: after a 409/422 the user edits the email and resubmits; same key + different body = 422 `idempotency_key_reuse` (the server compares payload hashes).
- **My judgment:** accepted; I corrected the prompt. Rule: reuse the key only for an exact retry of the same payload (network error, 5xx, 429); generate a new key when the payload changes or after a definitive 4xx.
- **Validation:** the server half is already covered by an existing test ("same key with a different payload → 422 idempotency_key_reuse"). The client half has no test yet; a Playwright test for edit-and-resubmit after a 409 is in the build plan.
- **Commit:** n/a

### 2026-11-11 22:11 — Doc check caught a wrong assumption in my own ADRs: Astro middleware skips prerendered pages on Vercel
- **Phase / agent:** Phase 3 (UI), main thread (docs research required by P4.1)
- **Delegated:** read the current Astro/Vercel docs before planning the landing page.
- **Output (summary):** the Vercel adapter page says its middleware runs for on-demand routes and "static assets and prerendered pages skip it". That contradicts the plan in ADR-007 (cookies set by middleware on a prerendered page), the ADR-004 draft in `00-process.md`, ADR-001 and `CLAUDE.md`. The AI-drafted ADR-007 had carried the same wrong assumption, and was corrected.
- **My judgment:** the finding is the AI's, the resolution is mine: the landing page becomes on-demand (`prerender = false`) so middleware runs; production would use an edge rewrite to two prerendered variants. ADR-004 did not exist (only referenced), so it was **created**, and ADR-007 was **amended**. `CLAUDE.md` and ADR-001 still say "prerendered" and now conflict with ADR-004; not edited (pending my call).
- **Validation:** a documentation quote only. Not yet verified in a running build or on Vercel. The plan makes a Playwright check against `astro build && preview` (cookie set on first visit, variant sticky, no cookie change on reload) the gate, and the Vercel behaviour still needs one deployed check.
- **Commit:** n/a

### 2026-11-11 21:27 — Users API: tests first (red), implementation (green), and what the tests caught
- **Phase / agent:** Phase 2 (build API), main thread (plan mode used first, per CLAUDE.md); `api-reviewer` was launched but stopped before reporting, so **no independent review has happened yet**.
- **Delegated:** P3.1 tests before implementation, P3.2 smallest implementation, P3.3 Vercel analysis.
- **Prompt:** [docs/prompts/03-build-api.md](prompts/03-build-api.md)
- **Output (summary):** 66 Vitest tests through the public handler interface; handlers, one error-mapping function, in-memory repository, two thin Astro route files.
- **My judgment:** pending my read of the diff. The items below are what the AI itself caught or corrected during the work, recorded as facts.
  - **Red was real:** 66/66 failed against stubs, and every failure was `expected 501 to be <status>` (one race test: `[501, 501]` vs `[201, 409]`). First red run failed inside a JSON parse of the stub's empty body, so the helper was changed to assert status first; otherwise the failures would have been for the wrong reason.
  - **Test caught an AI implementation bug:** the cursor row was returned again on the next page, because the comparator returned -1 (not 0) for an identical position. 2 pagination tests failed, fixed in the comparator, 66/66 green.
  - **AI over-specified a test and removed it:** it asserted 409 carries no `fields`, which the contract never states. A "determinism" test that reached into repository internals was removed (it broke "public handler interface only").
  - **Sloppy AI output corrected in the same turn:** a nonsense ternary in the `invalid_cursor` branch of the GET handler, replaced before any test run.
  - **Contract gap found by the test list:** no body-size rule existed for the "oversized body" case, so 413 `payload_too_large` + `MAX_BODY_BYTES` were added to the contract (AI-made, awaiting my review).
  - **Unverified claim retracted:** ADR-002 said Vercel's filesystem is read-only/ephemeral; the Vercel pages fetched do not state it, so the ADR was softened to "unverified".
- **Validation:** `vitest run` 66/66, `astro check` 0 errors, plus a curl smoke test against the real Astro dev server (201 / replay header / 409 / 415 / 422 / 405+Allow / PATCH) because the unit tests bypass Astro routing. The smoke test is the AI's own; the independent review is `api-reviewer`.
- **Commit:** n/a (not committed by the AI)

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
