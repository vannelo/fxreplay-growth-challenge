# Process — how this challenge is being worked

The evaluators said: *"we want to understand the system you build around AI,"* and *"not how many prompts you generated."*
So this process is built around **who decides what**, **how every AI output gets verified**, and **evidence captured as I go**.

## Principles
1. **I own the decisions; AI owns the throughput.** Problem framing, trade-offs, the experiment hypothesis,
   and the final read of every diff are mine. Drafting, boilerplate, audits, and test scaffolding are delegated.
2. **Verify with something that isn't the author.** Tests, a browser, a separate reviewer agent, or my own read.
3. **Plan, then build, then audit.** No code before the contract and tracking plan exist.
4. **Capture evidence live.** `ai-judgment-log.md` is written during the work, never reconstructed after.

## Time budget (~6h)

| Phase | Time | Owner of the key decision | AI's role |
|---|---|---|---|
| 0. Frame: read brief, assumptions, ADRs | 30m | **Me** | Challenge my assumptions, find gaps |
| 1. Contract: Users API schema, error shape, tracking plan | 45m | **Me** (shape) | Draft schemas, enumerate edge cases |
| 2. Build API + persistence + tests | 60m | Me (persistence ADR) | Implement from contract, write tests |
| 3. Landing + signup UI (brand tokens, states) | 90m | **Me** (value prop, layout, copy intent) | Implement, variants, states |
| 4. Instrument analytics + e2e assertions | 45m | **Me** (event taxonomy) | Wire `track()`, write Playwright assertions |
| 5. Audit: a11y, perf, API review, tracking audit | 45m | Me (accept/reject findings) | Specialist agents run in parallel |
| 6. Docs, deploy, experiment, rehearse review | 45m | **Me** | Draft, tighten, find holes in my story |

Where I cut scope, I document it under "What I'd do next" instead of half-building it.

## The loop for every feature
```
Plan mode → contract/ADR → implement (main thread) → tests → specialist agent review
   → I read the diff → accept / correct / reject → log it → commit
```

## What I will intentionally do myself (and say so in the review)
- Value proposition and the primary-conversion framing
- Event taxonomy and funnel definition (I've validated tracking in production pipelines; I won't outsource the contract)
- The experiment hypothesis, metric and decision rules
- Persistence choice and its trade-offs
- Final accept/reject on every agent finding

## Candidate ADRs to settle early (recommendation in bold)
- ADR-001 Frontend: **Astro (required), prerendered landing + one hydrated form island** (accepted, see decisions/ADR-001)
- ADR-006 Island framework: **Preact** (smallest bundle) vs React; decide with a measured bundle size, not preference
- ADR-002 Persistence: **`UserRepository` interface; in-memory adapter for local/tests, Postgres (Neon) adapter for the live deploy**
  (accepted, see decisions/ADR-002). In-memory resets on serverless, so it is never used in production.
- ADR-003 Analytics: **PostHog behind a typed wrapper** (funnels + flags + experiments in one tool, fewer third-party scripts than GA4+GTM+Optimizely)
- ADR-004 Experiment assignment: **middleware bucketing to avoid flicker**. Because the landing page is prerendered, either
  render each variant as a prerendered route and rewrite to it in middleware (CDN-cacheable, my recommendation), or render on demand. Decide with the caching trade-off written down.
- ADR-005 Conversion source of truth: **server-confirmed event after 201**, not the button click

## Candidate experiment (decide and own it)
Reduce friction vs add reassurance. Example: *"Email-only signup (variant) will lift
visit→signup_succeeded over email + name (control) because each extra field costs conversion; guardrail: activation proxy within 24h."*
The API already supports both arms: `email` required, `name` optional (see `api-contract.md`). The arms differ only in whether the form renders the name field.
Pick one primary change. Stating the guardrail is what shows maturity.
