# Analytics plan

Source of truth for events. The typed registry `src/analytics/events.ts` mirrors this file; `/tracking-audit` checks code against it.
Consent/identity model: [ADR-007](decisions/ADR-007-consent-and-visitor-id.md). Conversion is server-confirmed: ADR-005 (see [00-process.md](00-process.md)).
Tool: PostHog (events, funnels). Experiment: `signup_fields`, arms `control` (email + name) and `email_only`.

## Context attached to every event
Registered once (client super-properties; read from cookies server-side), so intermediate events do not repeat them.

| Context | Type | Source |
|---|---|---|
| `distinct_id` | uuid | `fxr_vid` cookie (first-party random id; never an email or user id) |
| `experiment` | `"signup_fields"` | constant |
| `variant` | `"control"` \| `"email_only"` \| `"unattributed"` | `fxr_variant` cookie, set by middleware. Server reads the cookie only. `unattributed` = no cookie |
| `env` | `"prod"` \| `"preview"` \| `"dev"` \| `"test"` | build config; each env uses its own PostHog project key |

## Events (5)
Owner for all: **Growth Engineering**. `?` = optional. Property values are limited to exactly what is listed; the registry rejects anything else.

| Event | Emitted by | Trigger | Properties (type) | Notes |
|---|---|---|---|---|
| `landing_viewed` | client | Landing page rendered, once per page view. Not on bfcache restore (`pageshow` with `persisted`). SDK `$pageview` disabled. | `utm_source?`, `utm_medium?`, `utm_campaign?`, `utm_content?`, `utm_term?` (string, ≤100 chars, allow-listed keys only), `referrer_origin?` (string, **origin only**, no path/query), `device_class` (`"mobile"` \| `"tablet"` \| `"desktop"`) | Funnel entry **and** the experiment exposure (the variant is rendered when this fires), so there is no separate exposure event. |
| `signup_started` | client | First `focusin` inside the signup form, once per page view. The form never autofocuses. | `fields_shown` (`("email"\|"name")[]`) | Engagement signal, not intent. Autofill can fire it. |
| `signup_submitted` | client | Client validation passed **and** the POST is dispatched. Button disabled while pending. One per POST. | `attempt` (int ≥ 1, per page view), `name_provided` (boolean) | A fix-and-resubmit counts again, so funnels use unique visitors. A retry reuses the `Idempotency-Key`. |
| `signup_failed` | client **or** server | Client: validation failed (`client_validation`) or the request never got a response (`network`). Server: handler returns 409/422/5xx (`server`). Never both for one failure. 429 emits nothing. | `source` (`"client_validation"` \| `"server"` \| `"network"`), `error_code` (contract `ErrorCode` \| `"network_error"`), `failed_fields?` (`("email"\|"name")[]`, names only), `retryable` (boolean) | Never carries values, messages or `field` text. `email_taken` is a code here and reported on its own. |
| `signup_succeeded` | **server** | `POST /api/users` first-time 201, after DB commit. **Not** on replay (`Idempotent-Replayed: true`). | `user_id` (uuid, not PII), `name_provided` (boolean) | **Primary conversion.** `$insert_id` = `user_id`. Properties are built explicitly, never from the `User` object. |

Removed from the draft, with reasons: `cta_clicked` (the form is in the hero, visible on load, so `signup_started` is the intent step), `experiment_exposed` (same moment as `landing_viewed`; two events for one fact), `idempotency_key` (per-attempt id, not a user key), `variant` as a repeated per-event property (now context).
One SDK built-in is kept: web vitals (LCP) for the guardrail below. **To verify at implementation:** how PostHog's `capture_performance` / web-vitals capture behaves with persistence disabled.

## Funnel
`landing_viewed` → `signup_started` → `signup_submitted` → `signup_succeeded`
Counted as **unique `distinct_id`s**, broken down by `variant`. Conversion window: 7 days from first `landing_viewed` (my assumption; revisit with real return-visit data).

- **Primary metric:** visitor → `signup_succeeded` rate = unique visitors with `signup_succeeded` ÷ unique visitors with `landing_viewed`, per variant.
- **Diagnostic:** started rate, submitted ÷ started, succeeded ÷ submitted.
- **Guardrails** (an arm that wins on the primary but breaks these is not shipped): `signup_failed` rate, `email_taken` rate (also shown with and without returning users), LCP (mobile). **No activation guardrail:** a real activation event lives in the FX Replay app, outside this challenge; it would be the first thing to add in production.

## Funnel bias (read before quoting any rate)
- The **numerator is complete** (server-emitted, can't be blocked). The **denominator is incomplete**: `landing_viewed` is client-side, so ad-blockers, JS-off, and visitors who leave before the SDK loads (it loads after idle, per the performance budget) are missing. **The absolute rate is biased upward.**
- Both arms share the bias, so the **A/B comparison is mostly safe, the absolute rate is not.** Report arm-vs-arm deltas, and label any absolute rate "of measured visitors".
- Visitors with cookies blocked have no id: their conversions arrive as `variant: "unattributed"`. Report that share. If it is more than a small fraction, investigate before trusting the experiment.
- A returning visitor on a different device or after clearing cookies is a new visitor (equal in both arms).

## Data quality: how we know the numbers are right
| Check | How | When |
|---|---|---|
| Server conversion = database | Daily: count `signup_succeeded` vs rows created in `users`. They should match; a gap means dropped or double-fired events. | Production, scheduled |
| Sample ratio mismatch | Chi-square of `landing_viewed` counts per arm against the intended split. A mismatch invalidates the experiment, whatever the metric says. | Before reading any result |
| Fires exactly once | Playwright: one full flow → exactly one `landing_viewed`, `signup_started`, `signup_submitted`, `signup_succeeded` on the capture sink; back/forward and reload don't re-fire the entry or conversion event. Double-click submit → one POST. | CI |
| Replay safe | API test: same key + body twice → one `signup_succeeded`. | CI |
| No PII | CI test: no event property value matches an email regex or equals the submitted name; registry rejects properties not in the allow-list (no spreading `User`). | CI |
| Nothing stored by the SDK | Playwright: after a full flow, no PostHog cookie or localStorage key exists. Only `fxr_vid` and `fxr_variant`. | CI |
| Typed events only | Events exist only in `events.ts`; `/tracking-audit` diffs code against this file. | CI / pre-merge |
| Internal and bot traffic | A documented PostHog filter process, **not an event property**: (1) one PostHog project per env (`dev`/`test`/`preview` never write to prod); (2) in prod, PostHog's internal/test-user filter set to the team's IP ranges; (3) review the bot-looking traffic (known-bot user agents, zero-dwell submits) before reading any experiment. | Setup + before each readout |

## Not built (next, with more time)
Honeypot or minimum-time-to-submit check against bot signups; signed variant cookie; transactional outbox for the conversion event (ADR-002); an app-side activation event; consent-flag gating when a CMP exists (ADR-007).
