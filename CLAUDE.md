# FX Replay — "Try FX Replay Free" Growth Experience

Take-home for the Growth Engineer role. Goal: raise marketing-traffic → account-creation conversion.
Timebox ~6h. Prefer a small, well-justified solution over a large one. Document assumptions and keep moving.

## Owner context
Built by Allan Castellanos (10y full-stack; Disney+ MarTech/pixel validation, NerdWallet landing pages + MCP tooling,
PayPal feature-flagged migrations + test culture). Decisions here should reflect that experience and be defensible
in a 60-min technical review. Every non-trivial decision gets an ADR in `docs/decisions/`.

## Stack (defaults — change only via ADR)
- **Astro (latest, 7.x; REQUIRED by the owner)** + TypeScript strict, Tailwind v4 via `@tailwindcss/vite`, driven by brand tokens
- Users API: Astro API endpoints (`src/pages/api/users/*`, `prerender = false`), `zod` schemas as the single source of truth for contract + types
- Interactive UI: ONE framework island for the signup form (Preact via `@astrojs/preact` by default, for the smallest bundle; React only if justified in an ADR)
- Persistence behind a `UserRepository` interface (see ADR-002)
- Analytics: one typed `track()` wrapper → PostHog (events, funnels, flags/experiments)
- Tests: Vitest (unit/API), Playwright (e2e + analytics assertions)
- CI: GitHub Actions. Hosting: Vercel via `@astrojs/vercel` (see `docs/architecture.md`)
- Node >= 22.23.4 (Astro's engines requirement); pin it in `.nvmrc` and `package.json` `engines`

## Astro best practices (apply all; deviations need an ADR)
- **Verify against current docs first.** Astro moves fast and your training data is stale. Before using any Astro API,
  config option, or integration, check docs.astro.build (and the installed package's types). Never write Astro code from memory.
- **Zero JS by default.** `.astro` components for everything static. Hydrate only the signup form, with the cheapest
  directive that works (`client:visible` or `client:idle`; `client:load` only if justified by a measurement).
- **Landing page rendered on demand, by decision (ADR-004):** Astro middleware does not run for prerendered pages on Vercel, and
  the experiment needs it. Production path: an edge rewrite to two prerendered variants. Everything else static; per-route rendering, not whole-site SSR.
- **Server Islands / `server:defer`** only for genuinely personalized fragments. Not needed for v1; don't add for show.
- **Experiments without flicker:** assign variants in middleware/edge, render the variant on the server. Never swap content client-side after paint.
- **Fonts:** use Astro's built-in font handling (check current docs for the stable API); self-host Lato + Nunito Sans, subset, preload only the LCP-critical weights.
- **Images:** `astro:assets` (`<Image>`/`<Picture>`), explicit dimensions, AVIF/WebP, `fetchpriority="high"` on the LCP image only.
- **Env/secrets:** `astro:env` schema with `context`/`access` set correctly. Public analytics key = client/public; anything else server-secret.
- **Types:** `astro check` in CI; `Astro.locals` typed via `env.d.ts`.
- **Security:** Astro's `security.checkOrigin` covers only form-style content types; JSON endpoints rely on 415 + no CORS approval.
  CSP = Astro `security.csp` (sent as a hashed header on on-demand pages). Rate limiting POST is NOT built (needs a shared store or WAF).
- **Tests:** Vitest with `getViteConfig()` for units/API; Playwright against the production build served by the Node adapter
  (`astro preview` does not support the Vercel adapter, ADR-008), never `astro dev`.
- **Considered and not chosen for the Users API:** Astro Actions. Great DX for forms, but the brief asks for a Users REST API
  (create/update/list); a real HTTP contract is more reviewable and reusable. Revisit in the review if asked (ADR-001).

## Brand constraints (non-negotiable)
- Colors/fonts come from the FX Replay Brand Kit only. Brand blue `#0260FD`, ground `#030303`.
- Headings: Lato (400/700/900). Body/UI: Nunito Sans (400/600/700).
- Use SEMANTIC tokens (`var(--bg-primary)`), never raw hex or primitives in components.
- "Evolve the direction where appropriate" = layout, motion, composition. Not new colors or fonts.

## Engineering rules
1. Contract first: define the zod schema + error shape before the handler or the form.
2. One validation source: the same schema validates client and server.
3. Error shape is stable: `{ error: { code, message, fields? } }`. Never leak stack traces.
4. Signup form states are explicit: idle, validating, submitting, success, field-error, server-error, network-error.
5. Analytics are product code: events defined in `src/analytics/events.ts` (typed registry = the property allow-list), never ad-hoc strings.
   Build properties explicitly; never spread a domain object (e.g. `User`) into an event. No PII in event properties (omit email and name).
   Consent model: cookieless SDK + one first-party visitor-id cookie (ADR-007; legal assumption pending). The conversion event
   is emitted server-side, once, never on an idempotent replay. `docs/analytics-plan.md` is the source of truth for events.
6. Performance budget: LCP < 2.0s, CLS < 0.05, INP < 200ms on mobile profile. No third-party script blocks render;
   analytics loads after interaction/idle.
7. A11y: WCAG 2.2 AA. Real labels, `aria-live` for async status, visible focus, 4.5:1 contrast, keyboard-complete.
8. No dead code, no speculative abstractions, no new dependency without a one-line justification in the PR/commit.

## AI workflow rules (this is part of the deliverable)
- Plan before code: use plan mode for anything touching more than 2 files.
- Delegate to the specialist agents in `.claude/agents/` instead of doing everything in the main thread.
- Every AI-generated artifact is verified by something other than the AI that wrote it: a test, a tool run, or a human read.
- Log meaningful AI interactions in `docs/ai-judgment-log.md` AS THEY HAPPEN (what was delegated, what was
  rejected/corrected, how it was validated). Never backfill or invent entries.
- Reusable prompts live in `docs/prompts/`. If a prompt is used twice, promote it to a skill.

## Commands
- `/ship-gate` runs the pre-merge gate (types, tests, a11y, perf, analytics contract).
- `/tracking-audit` verifies the code emits exactly the events in the tracking plan.

## Definition of done (per change)
Typecheck + lint + tests green, a11y and analytics checks pass, ADR written if a decision was made, judgment log updated.
