---
name: tracking-audit
description: Verifies the codebase emits exactly the events defined in docs/analytics-plan.md with the documented properties, and that a Playwright test asserts each funnel event. Use after any change to UI flows or analytics code.
---

# Tracking Audit

Inspired by validating ad-pixel firing in CI: assert behavior in a real browser, don't trust the code reading.

1. Parse `docs/analytics-plan.md` and `src/analytics/events.ts`. List events in the plan vs the registry. Report drift in either direction.
2. Grep for any `track(` call or analytics-vendor call outside the typed wrapper. Each is a violation.
3. For each funnel event, confirm a Playwright test triggers the user action and asserts on the captured payload
   (event name, required properties, no PII, fires once, correct order).
4. Check consent behavior: no events before consent when consent is required.
5. Check the conversion event: emitted server-confirmed after the Users API returns 201, deduped by idempotency key.

Output: table `event | in plan | in registry | emitted in code | e2e asserted | issues`, then a verdict and a list of
fixes. Do not modify files; hand fixes back to the main thread.
