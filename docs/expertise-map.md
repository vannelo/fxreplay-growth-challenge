# Expertise map — where my experience shows up in this challenge

Purpose: so the submission reads as *my* engineering judgment, and so I can answer "why did you do it that way?"
with a real story. Only claims from my CV; I'll use the ones that genuinely apply, not all of them.

| Challenge area | Real experience (CV) | How it shapes my decision here |
|---|---|---|
| **Analytics accuracy / "can the data be trusted?"** | Disney+ **Pixelball**: Playwright validation engine that checks ad pixels (TikTok, Reddit, Spotify…) fire correctly; GitHub Actions integration; ~70% less manual verification | Playwright e2e asserts the *actual network/event payloads*, not just code. A CI gate fails the build if a funnel event stops firing. This is the centerpiece of the data-quality section. |
| **LLM-assisted validation** | Pixelball used Claude Opus/Sonnet to score runs with confidence signals and flag false negatives | If I use AI in analytics QA, it triages anomalies; deterministic tests remain the pass/fail authority. |
| **Conversion landing pages, CMS, rendering** | NerdWallet: PHP/Angular → Next.js migration, conversion-focused landing pages, CMS-driven templates | Static-first Next.js, reusable section components, copy separated from layout so marketing can iterate. |
| **MCP in a real workflow** | NerdWallet: MCP tooling for Storybook generation, Playwright test creation, docs | Playwright MCP is used where it adds value (a11y/perf in a real browser). Production MCP proposal (below) comes from tools I've built. |
| **Experiments & safe rollout** | PayPal: reframed a migration into a **feature-flagged, gradual rollout** | Variants ship behind a flag with a kill switch; guardrail metrics defined before launch. |
| **Quality culture** | PayPal: test coverage ~20% → 85%; incidents ~5/sprint → 1–2 | Contract tests on the API and e2e on the funnel from the start, not at the end. |
| **Production operations** | PayPal on-call rotation; Trendsetera: hosting, DNS, deployments, Nginx, Linux | Infrastructure section is operational, not theoretical: DNS/TTL, CDN caching rules, rollback, alerting on conversion drops. |
| **SEO, performance, lead generation** | Konfio/SR Pago: contributed to SEO visibility, lead-gen, conversion, performance, launch speed | Core Web Vitals budget, structured data, font strategy, no render-blocking third parties. |
| **Product ownership + stakeholders** | Konfio: partnered with CEO/CTO; Disney+: weekly work with marketing users | I'll write the architecture doc for a marketing + engineering audience and call out trade-offs plainly. |
| **AI engineering discipline** | Structured outputs, schema validation, prompt-injection protection, observability, cost monitoring | Zod-validated boundaries everywhere; agents have scoped tools; prompts are versioned in `docs/prompts/`. |

## Proposed production MCP architecture (documented, not all built)
| MCP server | Why | How agents use it |
|---|---|---|
| Playwright (built here) | Real-browser verification | a11y/perf auditors run pages and assert behavior |
| PostHog | Live funnel + experiment data | `experiment-analyst` reads results against pre-registered decision rules |
| GitHub | PRs, CI status | `api-reviewer` comments; `ship-gate` reads check results |
| Vercel | Deploy + runtime logs | Triage production incidents, verify cache headers on the real deployment |
| Figma / design tokens | Brand fidelity | Prevent drift from the Brand Kit tokens |

## Honest gaps to be ready for
- I have not run FX Replay's analytics stack or seen their baseline conversion; I will state assumptions, not invent numbers.
- Trading/forex domain: keep copy credible and generic; do not make performance or financial claims.
