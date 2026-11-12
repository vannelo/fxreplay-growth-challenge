# ADR-006: Island stack: Preact + `zod/mini` contract; hydration directive from measurements

- **Status:** **accepted**, including the hydration directive: **`client:load`** (confirmed by the owner 2026-11-12; the temporary `HYDRATE_MODE` switch and the `signup-hydrated` mark were removed). A re-measure after the P6 fixes gave time-to-hydrated 1497 ms (`load`) vs 1518 ms (`idle`), LCP equal, TBT 0: still a tie, decided by the pre-registered rule.
- **Date:** 2026-11-12
- **Decided by:** me for the framework and the contract port; the hydration rule was pre-registered by me before measuring (plan, "G2"). Claude ran every measurement.

## Context
`CLAUDE.md` wants ONE hydrated island, the cheapest framework, one validation source shared by client and server, and `client:load` only if a measurement justifies it. The form is above the fold in the hero. Three costs were unknown and are measured here, not assumed.

## Measurements (all numbers are from this repo; scratch = esbuild in a throwaway project, real = the Astro/Vite production build)
| Question | Result |
|---|---|
| React 19 vs Preact 11 for the same trivial `useReducer` island (scratch) | **69.1 KB vs 5.8 KB gzip** (about 12x) |
| Shared contract in the client bundle: classic `zod` vs `zod/mini` (scratch) | **95.4 KB vs 13.8 KB gzip** (the exports the island imports) |
| Whole client JS in the real build | **~21.5 KB gzip**: form chunk 11.1 (contract + machine + client + component), preact 4.6, signals 3.0, astro hydration 1.6, hooks 1.2 |
| Hydration directive, `client:idle` vs `client:load` (15 runs each, Pixel 7 viewport, 4x CPU, 1.6 Mbps/750 Kbps/150 ms RTT; `docs/measurements/hydration-run2.json`) | time-to-hydrated median **1316.7 ms vs 1313.6 ms** (p75 1323.6 vs 1324.2); LCP median 652 vs 648 ms; TBT 0 ms; worst interaction 32 ms in both; page visible-but-not-interactive window **~668 ms vs ~665 ms** |

## Decision
- **Preact** for the island, **`zod/mini`** for the contract (same exports, same behaviour; the 66 API tests passed unchanged on the port, and the contract is still the single source for client and server).
- **Hydration (proposed):** apply the rule I wrote before measuring: *choose `client:idle` if p75 interaction latency < 200 ms AND median time-to-hydrated < 1 s on the throttled profile; otherwise `client:load` and record why.* Latency passes (32 ms), time-to-hydrated does not (1.31 s in **both** modes), so the rule says **`client:load`**. In practice it is a tie: a 3 ms difference is inside the noise, LCP is equal, TBT is 0. `client:load` also stops hydration depending on `requestIdleCallback` once later work (analytics) competes for the main thread.

## What the measurement found beyond the question
- **A real bug.** The first run showed typed text lost in 5 of 30 runs (its raw JSON was deleted by mistake; see `docs/measurements/hydration-run1-notes.md` for the transcribed numbers): a controlled `value=""` input wiped text typed before hydration. Fixed (uncontrolled inputs + adopting pre-hydration DOM values on mount); a deterministic Playwright regression test holds the island script back, types, and checks the text survives. The test was verified to fail with the bug reintroduced (`Received: ""`) and pass without it. After the fix: 0/15 lost in both modes.
- **The 1 s threshold fails for a reason the directive can't fix.** My hypothesis (NOT yet verified) is that ~1.3 s is dominated by the module-chunk waterfall on a 150 ms-RTT profile (island → framework → hooks → signals), not by when hydration starts. Next step: inspect the waterfall and try `modulepreload`/chunk merging.

## Trade-offs and limits (read before quoting any number)
- Lab only: headless Chromium with CDP throttling, n = 15, one device profile. Not field data and not Lighthouse; INP is a proxy (Event Timing on scripted keystrokes, 8 ms granularity: the constant 32 ms means the proxy cannot separate the modes).
- **"0 dead presses" is not evidence there is no dead window.** The scripted press landed ~1.35 s, after hydration (~1.31 s). The honest figure is the exposure window: the button is visible and disabled for ~0.67 s on this profile, in both modes.
- The submit button ships `disabled` until hydrated (no pre-hydration native submit); early users see a disabled button for that window.
- Preact is a smaller ecosystem than React; with one form that is acceptable.

## What would change this at FX Replay production scale
Real-user INP/LCP from the field (web-vitals reporting to the analytics project), the waterfall fix above, and re-running the comparison with the analytics SDK present, since that is when `idle` vs `load` could actually diverge.

## AI involvement
Claude built the form, ran the measurements and found the typed-text bug through them (the first run's data, not a guess). I set the rule before the numbers existed and decide the directive. See `ai-judgment-log.md`.
