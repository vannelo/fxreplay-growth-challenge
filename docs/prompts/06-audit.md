# 06 — Audit (author ≠ reviewer)

## P6.1 Independent API review
```
Use the api-reviewer agent on `src/pages/api` and `src/server`. Assume there are bugs. For every finding give a concrete failing input.
Specifically attack: concurrent duplicate signups, PATCH mass-assignment, malformed/oversized payloads, error leakage, idempotency replay.
```

## P6.2 Parallel specialist run
```
Run in parallel with independent contexts: a11y-auditor (all signup states), perf-auditor (production build, mobile throttled),
analytics-architect via /tracking-audit. Merge into the /ship-gate report format. List what was NOT verified.
```
**Verify:** I triage each finding: fix / reject with reason / defer to "what I'd do next". Every decision is logged. If an agent
reports nothing, I spot-check one area manually to confirm the agent isn't rubber-stamping.

## P6.3 Adversarial pass on my own claims
```
Read @docs/performance-review.md and @docs/architecture.md. Find every claim not backed by a measurement, test, or source.
Mark each as: measured | reasoned | asserted. For "asserted", tell me how to measure it or to reword it to what I can actually defend.
```
