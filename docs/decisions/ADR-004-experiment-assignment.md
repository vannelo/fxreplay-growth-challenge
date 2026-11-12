# ADR-004: Experiment assignment: on-demand landing page + Astro middleware (challenge); edge rewrite to two prerendered variants (production)

- **Status:** accepted
- **Date:** 2026-11-11
- **Decided by:** me (both the challenge build and the production path); Claude drafted the text and found the constraint below.
- **Amends:** the "landing page is prerendered" part of ADR-001 and `CLAUDE.md` ("static landing page, on-demand API"). Those two still say prerendered; this ADR is the documented deviation they require.

## Context
- Experiment `signup_fields`: `control` (email + name) vs `email_only`. Assignment must be sticky per visitor and rendered on the server, with **no flicker** (never swap after paint).
- ADR-007 needs a first-party visitor id and a sticky variant cookie set on the first response.
- **Constraint found in the docs:** the Astro Vercel adapter page says its middleware runs for on-demand routes, and *"static assets and prerendered pages skip it"*. A prerendered `/` is a static file on the CDN: Astro middleware cannot assign a variant or set a cookie for it. My earlier ADRs assumed it could.

## Options considered
1. **Landing page on-demand (`prerender = false`) + Astro middleware.** Middleware runs per request, sets the cookies, passes `variant` through `Astro.locals`, and the page renders that variant on the server. One code path, testable with Playwright against `astro build && preview`. Cost: the HTML is produced by a function on every request: no CDN page cache, a function in the TTFB/LCP path, cold starts.
2. **Vercel Routing Middleware (edge) rewriting to two prerendered variant pages.** Static HTML from the CDN, variant chosen and cookies set at the edge. Best performance. More moving parts, a second middleware system outside Astro, and its cookie/cache behaviour needs verifying.
3. **PostHog feature flag, client side.** Async flag fetch ⇒ flicker or layout shift. Rejected by the no-flicker rule.
4. **Client-side swap after paint.** Rejected (CLS, flicker, `CLAUDE.md`).

## Decision
- **Challenge build: option 1.** The landing page sets `export const prerender = false`; `src/middleware.ts` assigns the variant and sets `fxr_vid`/`fxr_variant` per ADR-007, exposes them via typed `Astro.locals`, and the page renders the matching form. Everything else on the page stays static markup (zero JS except the form island).
- **Production path: option 2.** One page template rendered twice at build via `getStaticPaths` (one source of truth, two static outputs), with an edge rewrite choosing between them and setting the cookies. This restores CDN-served HTML.
- Assignment: first request with no `fxr_vid` ⇒ new UUID; variant = deterministic 50/50 from the id (e.g. parity of a hash of the id), stored in `fxr_variant` and never reassigned. Variant values: `control`, `email_only`.
- Responses from the middleware path send `Cache-Control: private, no-store` so no shared cache can serve one visitor's variant (or `Set-Cookie`) to another.

## Trade-offs accepted
- **Performance cost, to be measured, not assumed:** TTFB now includes function execution; the CDN no longer serves the HTML. The LCP budget (< 2.0 s mobile) is at risk. Vercel documents Fluid compute reducing cold starts (bytecode caching, pre-warming on production), which helps but does not remove them. The performance review must report TTFB and LCP for this page honestly, and the production path above is the mitigation.
- Higher function cost per visit (every page view is an invocation).
- **Crawlers** have no cookie and get a random variant. Both variants share the same URL and the same content except the optional name field; accepted. A stricter option (serve `control` to known crawler user agents) is deferred.
- Two middleware systems exist if the production path is adopted; the cookie/assignment logic must live in one shared function to avoid drift.
- The cookie is not `HttpOnly` (client needs it as the analytics distinct id) so a user can edit it: attribution can be polluted, nothing is authorized on it (ADR-007).

## What would change this at FX Replay production scale
Option 2, plus: signed variant cookie; assignment from the experimentation platform with exposure logging; holdouts and mutual exclusion across concurrent experiments; a kill switch that forces `control` without a deploy.

## AI involvement
Claude found the Vercel/middleware constraint while researching Astro docs for P4.1 and flagged that ADR-001, ADR-007 and `CLAUDE.md` assumed otherwise. I chose the resolution. See `ai-judgment-log.md`.
