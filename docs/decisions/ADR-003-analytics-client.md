# ADR-003: PostHog behind a typed track(), sent by a thin HTTP client (not `posthog-js`)

- **Status:** accepted
- **Date:** 2026-11-12
- **Decided by:** me (chose from measured options). Claude ran the measurements and wrote the implementation.

## Context
Events, funnels and experiment readouts live in PostHog (plan, ADR-007). `CLAUDE.md` wants one typed `track()`, analytics that never blocks render, no PII, and a cookieless model. The page is on-demand rendered and LCP-sensitive; the whole page ships ~21.5 KB of gzip JS today.

## Options considered (sizes measured in this repo's tooling)
1. **`posthog-js`, lazy-loaded after idle.** Official, full features. **126 KB gzip** (372 KB raw) bundled, about 6x everything else on the page, and the SDK decides what it stores and sends.
2. **Thin typed client over PostHog's documented HTTP capture API** (`POST /batch/` from the browser, `POST /i/v0/e/` from the server, `$process_person_profile: false`). **~0.3 KB** for the transport; the whole analytics layer added **+1.6 KB gzip** to the real build (form chunk 11.1 → 12.7 KB; total 21.5 → 23.1 KB).
3. **GA4 + GTM.** Not measured. Rejected on principle: third-party scripts on the conversion page, and no server-side conversion without more infrastructure.

## Decision
Option 2. Every payload is built by us from a typed registry (`src/analytics/events.ts`), so what leaves the page is exactly what the plan lists: nothing is autocaptured, nothing is stored (ADR-007), PII cannot ride along by accident. A user-supplied `distinct_id` is the first-party `fxr_vid`.

- **Browser:** events queue and go out as ONE ordered `/batch/` request on idle (max 2 s), on first interaction, or on `pagehide` (`sendBeacon`, fallback `fetch keepalive`, `no-cors`).
- **Server:** the conversion (`signup_succeeded`, first-time 201 only) and server-side failures are POSTed to `/i/v0/e/` through Vercel's `waitUntil`, so they never delay the HTTP response. A failure to deliver is logged (error name only) and never affects the signup.
- **Consent:** Global Privacy Control (`navigator.globalPrivacyControl` / `Sec-GPC: 1`) means nothing is sent from either side (ADR-007 amendment).
- **Guards:** only registry properties; no email-like value anywhere; bounded strings. A violation THROWS in dev/test and DROPS the event with a warning in production.
- **No key ⇒ no events** and no errors: the app is a clean no-op until `PUBLIC_POSTHOG_KEY` is set.

## Trade-offs accepted
- **No autocapture, session replay, feature flags or built-in web vitals.** The plan's LCP guardrail is no longer fed by an SDK built-in; it needs its own collection (not built; see the plan). Experiment arms come from our middleware, not PostHog flags, so flags are not needed.
- **We depend on PostHog's documented HTTP endpoints** rather than a maintained SDK. No retries and no offline queue: a failed batch is lost (analytics, not money; the conversion is also in our database and is reconciled daily, see the plan).
- **Unverified until a real project key is used:** that PostHog accepts our `text/plain` `sendBeacon`/`no-cors` JSON bodies from the browser (CORS), and the semantics of `$insert_id` deduplication. The e2e suite uses a local capture sink, which proves what we SEND, not what PostHog does with it.
- **Ad blockers** block the PostHog domain, undercounting client events (the plan's funnel-bias note). A first-party reverse proxy (a Vercel rewrite) would recover most of them; not built.

## What would change this at FX Replay production scale
First-party proxy for the ingestion host; `posthog-js` (or a server-side SDK) if the team wants replay/flags/web vitals, with the lazy-load cost measured against the budget; a transactional outbox for the conversion so a crash between the commit and the emit cannot lose it.

## AI involvement
Claude measured both options and implemented the layer; I chose the thin client and Global Privacy Control after seeing the numbers. Two instructions in the original task were changed on purpose and logged: dedupe by user id and skip-on-replay (not "by idempotency key", which is per attempt), and a hand-written registry plus a drift test instead of generating code from the plan's markdown.
