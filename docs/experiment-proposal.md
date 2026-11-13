# Experiment proposal: `signup_fields`

Status: proposed, not run. No FX Replay baseline, traffic or prior result exists in this repo; every number below marked ASSUMED is a placeholder to be replaced with the owner's real data before launch.

## Hypothesis
If we remove the optional "Name (optional)" field from the hero signup form for marketing-traffic visitors, visitor → `signup_succeeded` rises by at least the chosen relative MDE (see sample size), because each extra field costs conversion (owner's hypothesis, `docs/00-process.md`). Falsified if the email_only rate is not higher than control by the pre-registered rule below.

## Control
`control`: email + "Name (optional)". Name is optional in the API (`docs/api-contract.md`), so control is not "two required fields".

## Variant
`email_only`: email only. One change only: the name field is not rendered. API, copy, layout, CTA and everything else are identical (`src/components/signup/SignupForm.tsx`, `src/lib/experiment.ts`).

## Success metric (one primary)
Visitor → `signup_succeeded`: unique `distinct_id`s with `signup_succeeded` ÷ unique `distinct_id`s with `landing_viewed`, per arm, 7-day window from first `landing_viewed` (`docs/analytics-plan.md`, Funnel). `variant: "unattributed"` is excluded. The rate is "of measured visitors"; only the arm-vs-arm difference is interpreted.

Diagnostics only (not decision inputs): started rate, submitted ÷ started, succeeded ÷ submitted, `name_provided` share in control.

## Randomization and assignment (as built)
- Unit: visitor, identified by the first-party `fxr_vid` UUID cookie (ADR-007). Not user, not session.
- Assignment: `src/middleware.ts` on the on-demand landing page (ADR-004). First request with no `fxr_vid` gets a new UUID; variant = FNV-1a 32-bit hash of `signup_fields:<visitor id>`, modulo 2 (`assignVariant` in `src/lib/experiment.ts`), so 50/50 and deterministic. Stored in `fxr_variant`, sticky, never reassigned.
- Rendered server-side, so no flicker. Response is `private, no-store`, so no shared cache serves one visitor's arm to another.
- Exposure = `landing_viewed` (fires at island hydration); there is no separate exposure event.
- Limits: cookie is editable (attribution can be polluted); a visitor who clears cookies or switches device is a new visitor (same in both arms); crawlers get a random arm.

## Guardrails
An arm that wins on the primary but breaches a guardrail is not shipped.
| Guardrail | Definition | Breach rule (pre-registered) |
|---|---|---|
| `signup_failed` rate | unique visitors with `signup_failed` ÷ visitors with `signup_submitted`, per arm | email_only worse than control with the one-sided 95% upper bound of the difference above +2 percentage points |
| `email_taken` rate | share of failures with `error_code = email_taken`, shown with and without returning users | same rule, +2 pp |
| LCP (mobile) | not collected by the analytics client (no web vitals, no RUM) | Guarded in the lab, not the field: before launch, run the same mobile-profile Lighthouse/Playwright measurement on each arm (they differ by one field, so a gap is a build bug); both must meet < 2.0 s. After launch, no field LCP exists; do not claim one. Adding RUM is a prerequisite for a production rollout. |

Not available: an activation guardrail (the activation event lives in the FX Replay app, outside this build). Until one exists, a "ship" means "more signups", not "more activated users"; this is the main residual risk and is stated in the decision.

## Sample size
Two-sided two-proportion test, equal arms, per-arm visitors (hydrated `landing_viewed`):

n = (z_(1-alpha/2) + z_(1-beta))^2 × [p1(1-p1) + p2(1-p2)] ÷ (p2 - p1)^2

Inputs: alpha = 0.05 (z = 1.96), power = 0.80 (z = 0.8416), so (1.96 + 0.8416)^2 = 7.849. p1 = ASSUMED baseline, p2 = p1 × (1 + relative MDE). Normal approximation, no continuity correction.

Baselines are ASSUMED, chosen only to span a plausible range; they are NOT FX Replay data. Per-arm n is rounded up to the nearest 100.

| ASSUMED p1 | Rel. MDE | p2 | p1(1-p1)+p2(1-p2) | (p2-p1)^2 | n per arm | Total | Visitors/day for 14 days (total ÷ 14) |
|---|---|---|---|---|---|---|---|
| 5% | 10% | 5.5% | 0.099475 | 0.000025 | 31,300 | 62,600 | 4,500 |
| 5% | 20% | 6.0% | 0.1039 | 0.0001 | 8,200 | 16,400 | 1,200 |
| 10% | 10% | 11% | 0.1879 | 0.0001 | 14,800 | 29,600 | 2,200 |
| 10% | 20% | 12% | 0.1956 | 0.0004 | 3,900 | 7,800 | 600 |
| 20% | 10% | 22% | 0.3316 | 0.0004 | 6,600 | 13,200 | 1,000 |
| 20% | 20% | 24% | 0.3424 | 0.0016 | 1,700 | 3,400 | 250 |

Owner inputs required before launch: real p1 (of measured visitors), the smallest relative lift worth shipping (MDE), and real daily marketing visitors (hydrated). Required run = max(whole weeks to reach total n, 2 weeks), then plus 7 days for the conversion window to mature. If daily traffic is below the table's visitors/day, extend in whole weeks rather than lowering power. Because the name field is optional, I expect the true effect to be small; if the owner's MDE is 10% relative or lower at a low baseline, the test may be impractical at this traffic and should not be run underpowered.

## Peeking policy
Fixed horizon. The sample size and end date are fixed at launch; no efficacy readout before the horizon, and no stopping on a significant interim result. Run in whole weeks (weekday/weekend mix) and read only visitors whose first `landing_viewed` is at least 7 days before the cut-off (conversion window matured). Why not sequential: it needs tooling and an alpha-spending plan this build does not have; a fixed horizon is simpler to audit. Only the harm and data-validity checks below may be looked at early.

## Decision rules (set before launch)
Read in this order, at the horizon only.
1. Invalid: SRM chi-square on `landing_viewed` per arm vs 50/50 gives p < 0.001, or unattributed share is more than a small fraction (owner sets the threshold, suggest 5%) or differs between arms, or server `signup_succeeded` count differs from `users` rows, or bot/internal traffic review fails. Result: no decision, fix and rerun.
2. Guardrail breach (any rule in the table, or lab LCP of either arm >= 2.0 s): do not ship regardless of the primary.
3. Ship email_only: SRM passes, no guardrail breach, and the two-sided 95% CI for (p_email_only - p_control) lies entirely above 0 AND the point estimate is at least the pre-registered MDE. Ship also requires the owner's acknowledgement that activation quality is unmeasured.
4. Reject: the 95% CI lies entirely below 0, or the CI upper bound is below the MDE (the lift worth shipping is ruled out). Keep control.
5. Continue (once, to a pre-stated extended horizon of whole weeks, with n recalculated and the extension written down before looking): the CI includes 0 and the upper bound is at or above the MDE, and the planned n was not reached or traffic was lower than assumed. If n was reached, the result is inconclusive: keep control, do not extend indefinitely.

## Threats to validity (this build)
- Small effect: name is optional in control, so the friction gap is smaller than "two required fields vs one"; expect a small lift and a large required n. Check `name_provided` share in control: if most visitors skip name, a null result is expected.
- Funnel denominator undercount (ad-blockers, JS off, GPC visitors send no events, leaving before the SDK loads): shared by both arms, so the difference is mostly safe, the absolute rate is not. Unless blocking correlates with arm (it should not; the arms differ by one field), no bias; the SRM check would reveal it.
- Exposure is conditional on hydration (`landing_viewed` fires at island hydration): the SRM check is conditional on hydration too. If the form's extra field slows hydration measurably, arms could differ in who is counted; check the lab hydration timing per arm.
- Unattributed conversions (no cookie) are excluded: report their share per arm.
- Conversion vs quality: email_only may add low-intent signups that never activate. No activation event exists here; first metric to add in production, and the 24h activation proxy in `docs/00-process.md` is the intended guardrail.
- Novelty: a visibly shorter form could spike early; the full-week horizon helps but does not remove it. Compare week 1 vs week 2 point estimates as a diagnostic; a large decay should be flagged in the readout.
- Traffic mix shift (campaigns, UTM sources, device mix): a campaign launching mid-test changes both arms equally in expectation; do not start or stop campaigns during the run; check `utm_source` and `device_class` balance across arms.
- Bots and internal traffic: filter per the data-quality table in `docs/analytics-plan.md` before readout; honeypot/min-time-to-submit is not built.
- Cookie editing, multi-device and returning visitors dilute the effect equally in both arms.
- Timed-out requests are logged as network failures though they may have succeeded; read the failure rate as "failures or ambiguous outcomes".

## Stop early (harm only)
Stop and force `control` if any of: signup_failed rate in email_only exceeds control by more than 5 pp over at least 500 submissions per arm; a server 5xx spike or conversion-to-DB mismatch (data loss); a legal/privacy finding about the cookie model (ADR-007 legal assumption is still pending). There is no kill switch without a deploy in this build (ADR-004 lists it as a production item), so stopping means a deploy. Decider: the experiment owner (Allan, Growth Engineering) calls it; no one else changes the horizon or rules after launch. Any change after launch is written down and invalidates the pre-registered ship rule.
