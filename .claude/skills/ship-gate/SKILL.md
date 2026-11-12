---
name: ship-gate
description: Pre-merge quality gate for the FX Replay growth experience. Runs typecheck, lint, tests, then delegates a11y, performance, analytics, and API review to the specialist agents and returns a single go/no-go report.
---

# Ship Gate

Run in this order and stop on the first hard failure in steps 1-2.

0. **Owner placeholders**: `grep -rn "TODO(owner)" src` must return nothing. Any hit is a hard NO-GO (copy or a URL the owner still has to supply).
1. **Static**: `npm run check` (`astro check`). Lint is not configured in this repo: report "lint: not configured", do not claim it passed.
2. **Tests**: `npm test` (Vitest: API, unit, design tokens), then `npm run test:e2e` (Playwright against the production build served by the Node adapter, see ADR-008; `astro preview` does not support the Vercel adapter). Run under Node >= 22.23.4.
3. **Agents (run in parallel, independent contexts)**:
   - `api-reviewer` on changed files under `src/pages/api` and `src/server`
   - `a11y-auditor` on all signup states
   - `perf-auditor` on the production build (`npm run build:e2e && PORT=<p> node dist/server/entry.mjs`), mobile profile; also report TTFB, since the page is rendered on demand (ADR-004)
   - `analytics-architect` via `/tracking-audit`
4. **Report** in this exact format:

```
SHIP GATE — <commit or date>
Static: pass|fail   Tests: pass|fail (n passed / n failed)
API review:   <n blocking / n non-blocking>
A11y:         <n blocking / n non-blocking>
Perf:         LCP x  CLS x  INP x  (budget met: yes|no)
Analytics:    <contract matches: yes|no>
VERDICT: GO | NO-GO — <one-line reason>
Unverified: <anything not checked, stated plainly>
```

Never report GO if any agent returned a blocking finding. Always list what was NOT verified.
After the gate, append a line to `docs/ai-judgment-log.md` for any agent finding you accepted or rejected.
