# ADR-007: Cookieless analytics + one first-party visitor-id cookie

- **Status:** accepted (consent assumption **pending legal confirmation**)
- **Date:** 2026-11-11
- **Decided by:** me. Claude's tracking-plan review flagged the missing consent model and the missing way to attribute the server-side conversion; the options below and the model chosen are mine.

## Context
- CLAUDE.md rule 5 required "consent-aware" analytics, but the draft plan had no consent model.
- The conversion event (`signup_succeeded`) is emitted **server-side** (ADR-005). To attribute it to the same visitor and experiment arm as the client events, the server needs a visitor id and the variant.
- The landing page is prerendered and cacheable, so a per-visitor id **cannot be embedded in the HTML**; it has to be a cookie that middleware sets and client JS can read.
- Experiment bucketing (ADR-004) already needs a sticky per-visitor assignment.
- I don't know FX Replay's legal position, audience geography, or consent-management tooling. I won't invent them.

## Options considered
1. **Full consent banner (CMP) gating all analytics.** Most conservative. Costs: a third-party script and layout shift on the page we are optimizing for LCP/CLS, a conversion-rate hit of its own, and the A/B test loses everyone who declines.
2. **No identifier at all (fully anonymous, no cookie).** Cleanest privacy position, but no stable bucketing (flicker/arm-switching), no visitor-level funnel, and no way to tie the server conversion to its arm.
3. **Cookieless analytics SDK + one first-party random id cookie used only for bucketing and as the analytics distinct id.** Small footprint, no banner, works for the experiment.

## Decision
**Option 3**, as an explicit **assumption that legal must confirm** before production.

- **Analytics SDK stores nothing.** PostHog is initialized with `disable_persistence: true` (documented to disable cookies, session storage and local storage), `capture_pageview: false` (our own `landing_viewed`, no duplicate `$pageview`) and autocapture off. `persistence: 'memory'` exists too, but its docs don't say it avoids cookies/localStorage, so we rely on `disable_persistence` and **test it** (Playwright asserts the browser has no PostHog cookie/localStorage keys after a full flow).
- **One cookie, set by middleware:** `fxr_vid` = random UUID v4, no personal data, `SameSite=Lax; Secure; Path=/; Max-Age=90 days` (the 90-day duration is my assumption). It is readable by JS (not `HttpOnly`) because the page is static and the client needs it as the distinct id (`bootstrap.distinctID`). A sibling cookie `fxr_variant` holds the sticky assignment (set at first visit; never reassigned).
- **Purpose limitation:** the visitor id is used for experiment bucketing and analytics distinct id only. No cross-site tracking, no advertising use, never joined to email/name, not sent to third parties other than the analytics processor.
- **Server attribution (contract change):** the signup island sends `X-Visitor-Id: <fxr_vid>`. The contract validates it with zod (`VisitorId`: a UUID, else treated as absent). It never blocks a signup. The server reads the **variant from the `fxr_variant` cookie only**, never from the body or a header.
- **No PII in events.** Email and name never appear in event properties. The allow-list is enforced in `src/analytics/events.ts` and by a CI test (see analytics plan).

## Trade-offs accepted
- **Legal risk is accepted knowingly, not solved.** Whether a first-party bucketing/analytics cookie is "strictly necessary" depends on jurisdiction and counsel. If legal says no, the production fallback is below.
- **Both identifiers are client-controlled.** A user can edit `fxr_vid` or `fxr_variant`, or send any `X-Visitor-Id`. The result can only pollute analytics attribution (nothing is authorized on it). v1 leaves the cookies unsigned. Production would sign the variant (HMAC) and treat the visitor id as untrusted.
- **Cookie-blocking visitors are unattributed:** no id → the server emits `signup_succeeded` under the user's id with `variant: "unattributed"`. Report that share; if it's material, investigate.
- **`Set-Cookie` on the HTML response interacts with CDN caching** of the prerendered variants. How middleware sets the cookie without making every page response uncacheable is **an open item for ADR-004**, not solved here.
- Visitors who clear cookies are new visitors (inflates unique visitors slightly; same for both arms).

## What would change this at FX Replay production scale
- A CMP (or the company's existing consent tool) provides a consent state; the client `track()` wrapper and the **server** event are gated on it. The client forwards a consent flag to the server (header), and without consent the server emits nothing identifying (or nothing at all). The ADR-005 conversion count then needs a documented, consented-only vs. total reconciliation.
- Visitor id and variant signed; retention reviewed; a data-processing agreement with the analytics vendor; region-aware behaviour if required.
- Identify the user (user id, not email) at conversion once an account exists in the real FX Replay app.

## AI involvement
Claude's analytics review raised the gap; I chose option 3 and its scope. Claude drafted this text; the cookie duration and the `unattributed` handling are Claude-proposed defaults for my review.
