# ADR-001: Astro for the frontend

- **Status:** accepted
- **Date:** 2026-11-11
- **Decided by:** me (requirement I set for this project)

## Context
A marketing landing page where LCP, SEO and conversion matter, with exactly one interactive surface (the signup form),
plus a small Users API. Brief weights Core Web Vitals, rendering strategy and third-party script cost.

## Options considered
1. **Astro**: static HTML by default, islands for interactivity, minimal client JS. Fits a content-first conversion page.
2. Next.js App Router: more capable, but ships a larger runtime for a page that needs almost no client state.

## Decision
Astro (current 7.x). Landing page prerendered; `/api/users` endpoints rendered on demand via the Vercel adapter;
the signup form is the single hydrated island.

## Trade-offs accepted
- Smaller ecosystem for app-like state than Next.js; fine because there is one form.
- Server logic is endpoint/middleware based, not React Server Components. Fine for this scope.
- Hybrid rendering needs care: prerendered pages cannot read per-request data, so experiment bucketing must happen in
  middleware (see ADR-004), not in the page.
- Version moves quickly: I verify every API against current docs instead of trusting memory (or the model's training data).

## What would change this at FX Replay production scale
If the marketing site grows into an authenticated app surface, keep Astro for marketing and put the app in a separate
deployable; share design tokens and the zod contracts package between them. Move the Users API out of the web tier into its own service.

## AI involvement
AI is told to verify Astro APIs against docs. Log every instance where it used a removed/renamed API in `ai-judgment-log.md`.
