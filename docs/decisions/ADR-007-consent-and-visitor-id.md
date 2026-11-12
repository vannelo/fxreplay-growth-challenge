# ADR-007: Cookieless analytics + one first-party visitor-id cookie

- **Status:** accepted (consent assumption **pending legal confirmation**)
- **Date:** 2026-11-11
- **Decided by:** me. Claude's tracking-plan review flagged the missing consent model and the missing way to attribute the server-side conversion; the options below and the model chosen are mine.

## Context
- CLAUDE.md rule 5 required "consent-aware" analytics, but the draft plan had no consent model.
- The conversion event (`signup_succeeded`) is emitted **server-side** (ADR-005). To attribute it to the same visitor and experiment arm as the client events, the server needs a visitor id and the variant.
- The landing page was assumed prerendered and cacheable, so a per-visitor id **cannot be embedded in the HTML**; it has to be a cookie that client JS can read. (Amended: the challenge build now renders the page on demand, see ADR-004 and the amendment note below; the cookie design is kept so the production path is identical.)
- Experiment bucketing (ADR-004) already needs a sticky per-visitor assignment.
- I don't know FX Replay's legal position, audience geography, or consent-management tooling. I won't invent them.

## Options considered
1. **Full consent banner (CMP) gating all analytics.** Most conservative. Costs: a third-party script and layout shift on the page we are optimizing for LCP/CLS, a conversion-rate hit of its own, and the A/B test loses everyone who declines.
2. **No identifier at all (fully anonymous, no cookie).** Cleanest privacy position, but no stable bucketing (flicker/arm-switching), no visitor-level funnel, and no way to tie the server conversion to its arm.
3. **Cookieless analytics SDK + one first-party random id cookie used only for bucketing and as the analytics distinct id.** Small footprint, no banner, works for the experiment.

## Decision
**Option 3**, as an explicit **assumption that legal must confirm** before production.

- **Analytics stores nothing.** (Amended 2026-11-12: there is no SDK. ADR-003 replaced the planned `posthog-js` with a thin typed client that only reads the cookies below and POSTs events; it writes no cookie, localStorage or sessionStorage. Playwright asserts that after a full flow only `fxr_vid` and `fxr_variant` exist and both storages are empty.)
- **One cookie, set by middleware:** `fxr_vid` = random UUID v4, no personal data, `SameSite=Lax; Secure; Path=/; Max-Age=90 days` (the 90-day duration is my assumption). It is readable by JS (not `HttpOnly`) because the page is static and the client needs it as the distinct id (`bootstrap.distinctID`). A sibling cookie `fxr_variant` holds the sticky assignment (set at first visit; never reassigned).
- **Purpose limitation:** the visitor id is used for experiment bucketing and analytics distinct id only. No cross-site tracking, no advertising use, never joined to email/name, not sent to third parties other than the analytics processor.
- **Server attribution (contract change):** the signup island sends `X-Visitor-Id: <fxr_vid>`. The contract validates it with zod (`VisitorId`: a UUID, else treated as absent). It never blocks a signup. The server reads the **variant from the `fxr_variant` cookie only**, never from the body or a header.
- **No PII in events.** Email and name never appear in event properties. The allow-list is enforced in `src/analytics/events.ts` and by a CI test (see analytics plan).

## Consent gate (amended 2026-11-12, P5)
With no banner, "consent denied" is the browser's **Global Privacy Control** signal: `navigator.globalPrivacyControl` in the page and `Sec-GPC: 1` on requests. If either is set, **nothing is sent from the browser or the server** (the signup itself still works). The default is **allowed**, which is the same legal assumption this ADR already carries. The check is one function (`gpcOptedOut` in `src/analytics/payload.ts`) so a CMP can replace it. Verified by unit tests on both emitters and an e2e test that sets GPC and asserts zero requests reach the capture sink.

## Trade-offs accepted
- **Legal risk is accepted knowingly, not solved.** Whether a first-party bucketing/analytics cookie is "strictly necessary" depends on jurisdiction and counsel. If legal says no, the production fallback is below.
- **Both identifiers are client-controlled.** A user can edit `fxr_vid` or `fxr_variant`, or send any `X-Visitor-Id`. The result can only pollute analytics attribution (nothing is authorized on it). v1 leaves the cookies unsigned. Production would sign the variant (HMAC) and treat the visitor id as untrusted.
- **Cookie-blocking visitors are unattributed:** no id → the server emits `signup_succeeded` under the user's id with `variant: "unattributed"`. Report that share; if it's material, investigate.
- **`Set-Cookie` and CDN caching: resolved by ADR-004 (amended 2026-11-11).** Astro middleware does not run for prerendered pages on Vercel, so the landing page is rendered on demand for the challenge build and its responses are `Cache-Control: private, no-store` (cookies set by Astro middleware). Production would use an edge rewrite to two prerendered variants, with the cookies set at the edge. Cookie names, flags and semantics in this ADR are unchanged on both paths.
- *Amendment note:* with an on-demand page the server **could** embed the visitor id in the HTML and the cookie could be `HttpOnly`. I'm deliberately keeping it JS-readable so the challenge build and the production (prerendered) path behave identically.
- Visitors who clear cookies are new visitors (inflates unique visitors slightly; same for both arms).

## What would change this at FX Replay production scale
- A CMP (or the company's existing consent tool) provides a consent state; the client `track()` wrapper and the **server** event are gated on it. The client forwards a consent flag to the server (header), and without consent the server emits nothing identifying (or nothing at all). The ADR-005 conversion count then needs a documented, consented-only vs. total reconciliation.
- Visitor id and variant signed; retention reviewed; a data-processing agreement with the analytics vendor; region-aware behaviour if required.
- Identify the user (user id, not email) at conversion once an account exists in the real FX Replay app.

## AI involvement
Claude's analytics review raised the gap; I chose option 3 and its scope. Claude drafted this text; the cookie duration and the `unattributed` handling are Claude-proposed defaults for my review.
