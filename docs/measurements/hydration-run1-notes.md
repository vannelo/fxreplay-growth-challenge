# Hydration run 1 (the run that exposed the typed-text bug): transcribed notes

**The raw JSON for this run (`hydration-run1.json`) was deleted by mistake during cleanup and cannot be regenerated** without reintroducing the bug. These notes are transcribed from the console output printed at the time. Treat them as a record of what was observed, not as reproducible data. The reproducible run is `hydration-run2.json`.

Conditions of run 1 (differs from run 2): the scripted interaction started when the `load` event fired (run 2 starts at `commit`, before hydration); the island still used **controlled inputs** (`value={state.values.email}`).

| | `client:idle` | `client:load` |
|---|---|---|
| time-to-hydrated, median / p75 (ms) | 1315.2 / 1319 | 1301.1 / 1307.4 |
| LCP, median (ms) | 640 | 644 |
| TBT (5 s) | 0 | 0 |
| worst interaction (ms) | 32 | 32 |
| runs with typed text lost | **4 / 15** | **1 / 15** |
| typed text kept, per run (Y/N) | `YYYYYNYNYNYNYYY` | `YYYYYYYYYYYNYYY` |

The loss was a race: runs where typing began before hydration lost the text when the controlled input rendered `value=""`. Fixed afterwards (uncontrolled inputs, adopt DOM values on mount); run 2 and a deterministic regression test (`tests/e2e/signup.spec.ts`, "text typed BEFORE the island hydrates") cover it.
