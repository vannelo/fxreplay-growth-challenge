# ADR-008: E2E runs the production build on the Node adapter, because `astro preview` does not support the Vercel adapter

- **Status:** accepted
- **Date:** 2026-11-12
- **Decided by:** me (the fallback was written into the plan as a contingency; this records that it was triggered). Claude ran the check.

## Context
`CLAUDE.md` requires Playwright to run against production output (`astro build && astro preview`), never `astro dev`. With `@astrojs/vercel` 11.0.21:
`astro preview` exits immediately ("Preview server process exited before becoming ready") and the adapter source contains no preview entrypoint.

## Options considered
1. **`vercel dev` / Vercel CLI locally.** Closest to production, but needs the CLI, an account/login and project linking; poor for a reviewer who clones and runs.
2. **Run `astro dev`.** Forbidden: different code path (unbundled, different middleware/caching behaviour).
3. **`@astrojs/node` (standalone) for test builds, selected by `E2E=1`.** Still a production build with a real server. One extra dependency; zero setup for reviewers.

## Decision
Option 3. `astro.config.mjs` picks `node({ mode: 'standalone' })` when `E2E=1`, else `vercel()`. Playwright builds with `E2E=1` and runs `node dist/server/entry.mjs`.

## Trade-offs accepted
- E2E does not exercise Vercel-specific behaviour (function bundling, edge/CDN headers, Fluid compute). The Vercel path needs its own check on a deployed preview (headers, `Cache-Control`, cookies, CORS preflight): listed as a deploy-step verification, not assumed.
- The two adapters could differ in how they apply `Set-Cookie`/headers; a deployed smoke test is the mitigation.
- One additional dependency: `@astrojs/node` (devDependency in spirit; test-build only).

## What would change this at FX Replay production scale
Run the same Playwright suite against every Vercel preview deployment URL in CI (the suite takes `baseURL`), keeping the Node-adapter run as the fast local check.

## AI involvement
Claude ran the preview check and proposed the fallback; I accepted it in advance as the plan's contingency.
