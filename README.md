# Try FX Replay Free — Growth Engineer Challenge

Marketing landing + signup flow + Users API, built with an AI-native workflow.

## Start here (reviewers)
| Looking for | Read |
|---|---|
| How the work was done and who decided what | [docs/00-process.md](docs/00-process.md) |
| Evidence of AI judgment (delegated / corrected / rejected) | [docs/ai-judgment-log.md](docs/ai-judgment-log.md) |
| Project instructions for Claude Code | [CLAUDE.md](CLAUDE.md) |
| Agents and skills | [.claude/agents](.claude/agents), [.claude/skills](.claude/skills) |
| MCP setup | [.mcp.json](.mcp.json), [docs/expertise-map.md](docs/expertise-map.md) |
| Prompts used | [docs/prompts](docs/prompts) |
| Decisions | [docs/decisions](docs/decisions) |

## Deliverables status
- [x] Working implementation + local setup
- [ ] docs/architecture.md
- [x] docs/analytics-plan.md
- [ ] docs/experiment-proposal.md
- [ ] docs/ai-workflow.md (synthesized from this repo's config + the judgment log)
- [ ] docs/performance-review.md
- [ ] Live deployment URL

## Local setup
Requires Node >= 22.23.4 (pinned in `.nvmrc`) and npm.

```bash
nvm install                      # or any Node >= 22.23.4
npm install
npm run dev                      # http://localhost:4321 (PUBLIC_APP_ENV=dev; POSIX env prefix)
```

Checks:

```bash
npx playwright install chromium  # once, for e2e
npm run check                    # astro check (strict types)
npm test                         # Vitest: API, unit, analytics, design tokens
npm run test:e2e                 # Playwright on the PRODUCTION build (Node adapter, ADR-008) + a local analytics capture sink
npm run measure:hydration        # optional lab numbers (writes docs/measurements/hydration.json)
```

Storage (ADR-002): with no `DATABASE_URL`, `npm run dev` uses an in-memory store that resets on restart (zero setup). With
`DATABASE_URL` in `.env`, dev uses Postgres. Tests and e2e always run without a network database: Vitest runs the Postgres
adapter on PGlite (in-process Postgres), and Playwright pins `DATABASE_URL` empty.

```bash
npm run db:migrate               # apply db/schema.sql to DATABASE_URL (idempotent)
TEST_DATABASE_URL=… npx vitest run tests/api/repository-contract.test.ts   # optional: real-concurrency tests on Neon (cleans up its own rows)
```

## Configuration
All optional locally; see `.env.example`. Only `DATABASE_URL` is a secret.

| Variable | What it does | If unset |
|---|---|---|
| `DATABASE_URL` | Postgres (Neon) connection string; **server-only secret** | in-memory store locally; **prod/preview refuse to serve the API** (guard) |
| `PUBLIC_POSTHOG_KEY` | PostHog project key for analytics (ADR-003) | analytics is a clean no-op |
| `PUBLIC_POSTHOG_HOST` | Ingestion host (EU cloud: `https://eu.i.posthog.com`) | `https://us.i.posthog.com` |
| `PUBLIC_APP_ENV` | `prod`, `preview`, `dev` or `test`; dev/test throw on an analytics PII/allow-list violation, prod drops the event | `prod` |
| `PUBLIC_SIGNIN_URL` | Target of the "Sign in" link on a 409 and on success | "Sign in" is plain text, never a fake link |

**Required before the live deploy:** `PUBLIC_POSTHOG_KEY` and `PUBLIC_SIGNIN_URL` are deliberately **unset** in this repo (no invented values). Set them in the Vercel project, plus `PUBLIC_POSTHOG_HOST` on EU cloud, and `PUBLIC_APP_ENV=preview` for preview deployments. Add `DATABASE_URL` as a Vercel **secret** and run `npm run db:migrate` once against it. For this demo, Preview deployments share the production database (a Neon branch per preview is the production-grade setup).
