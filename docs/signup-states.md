# Signup form: states (implemented in `src/components/signup/`)

Pure reducer: `signup-machine.ts` (unit-tested). I/O: `signup-client.ts`. UI: `SignupForm.tsx`. "Tracked" = added with the analytics step (P5); the client never emits server-side events (`analytics-plan.md`).

| State | User sees | Announced (`role="status"`, polite) | Tracked (P5) |
|---|---|---|---|
| `idle` | Form. Submit is `disabled` in the server HTML until the island hydrates | nothing | `signup_started` on first focus, once |
| `validating` | Transient: validation is synchronous, so it is never painted | nothing | none |
| `fieldError` | Inline error under each invalid field (`aria-describedby`, `aria-invalid`), focus on the first invalid field, input kept. Also used for a server 422 that names a known field | "1 field needs attention." / "N fields need attention." | client `signup_failed` (`client_validation`) |
| `submitting` | Button `aria-disabled` (keeps focus) with spinner, "Creating account…", inputs read-only | "Creating your account…" | `signup_submitted` when the POST is dispatched |
| `success` | "Account created" panel, focus on its heading, no redirect | "Account created." | none (server emits `signup_succeeded`) |
| `serverError` · 409 | Email field flagged and focused, "This email already has an account. Sign in instead, or use a different email." + "Sign in" link when `PUBLIC_SIGNIN_URL` is set, plain text when it is not (no invented URL) | same message | none (server emits `signup_failed`) |
| `serverError` · 429 (retryable) | "Too many attempts. Please wait [N seconds, from `Retry-After`] and try again."; button reads "Try again" | same message | none (API logs only) |
| `serverError` · 5xx, or a 422 naming no known field | "Something went wrong on our side. Please try again."; "Try again" | same message | none if our API answered (the server emits `signup_failed`); client `signup_failed` (`source: server`) if the platform answered (no error envelope) |
| `networkError` | "Connection problem. Check your connection and try again."; "Try again"; input kept | same message | client `signup_failed` (`network`) |

## Idempotency-Key policy
| Situation | Next submit uses |
|---|---|
| Exact retry after a network error, timeout, 5xx or 429 | the **same** key (the server replays instead of creating twice) |
| Payload changed (even after a retryable failure) | a **new** key (same key + different body = 422 `idempotency_key_reuse`) |
| After a 409, a mappable 422 or an unmappable 422 | a **new** key (definitive answer; never reuse) |
| After success | terminal; no further submits |

A request timeout is reported as `networkError` on purpose: it may have succeeded, and retrying with the same key is what makes that safe.

## Two behaviours added by testing, not by the original spec
- Inputs are uncontrolled and pre-hydration DOM values are adopted on mount (typed or autofilled text used to be wiped).
- A 422 that names a known field is shown as `fieldError` (inline) instead of a generic server error.

## Verified by
Unit: `tests/unit/signup-machine.test.ts`, `signup-client.test.ts`. E2E (production build, mobile + desktop): `tests/e2e/signup.spec.ts` (every state above, key reuse/rotation, keyboard-only, typed-before-hydration, axe on idle / fieldError / 409 / 5xx / network / success). Not verified by me: screen-reader behaviour (VoiceOver), real-device touch.
