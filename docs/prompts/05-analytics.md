# 05 — Instrument

## P5.1 Typed wrapper
```
Context: @docs/analytics-plan.md (final) and CLAUDE.md rule 5.
Implement `src/analytics/events.ts` as a discriminated union generated from the plan (event name → required properties),
and `track()` that only accepts those. Provider adapter for PostHog, loaded after idle/interaction (no render-blocking script).
Include: consent gate, session/visitor id, UTM + referrer capture at landing, PII guard that throws in dev if an email-like value is in props.
Server-side: emit `signup_succeeded` from the API after 201, deduped by idempotency key.
Do not add any other analytics library. Show the bundle-size impact.
```
**Verify:** the unit test that tries `track('nonexistent')` fails at type level; check the network panel myself for the real request.

## P5.2 Assert the data, not the code (my Pixelball approach)
```
Write Playwright tests that drive the real funnel: land with UTMs → view → focus form → submit invalid → submit valid → success.
Intercept the analytics network requests and assert, in order: event name, required properties, UTM propagation,
no PII, each event exactly once, and `signup_succeeded` only after the API returned 201.
Also test: consent denied → zero events; double-click submit → one conversion; page reload on success → no re-fire.
These tests are the CI gate for data quality; failures must print the actual payload diff.
```
**Verify:** I deliberately break an event (rename it / double-fire) and confirm the test fails. A gate that has never failed is unproven.
