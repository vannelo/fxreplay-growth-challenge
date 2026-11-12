# 04 — Build UI

## P4.1 Landing page from MY value prop
**Intent:** the positioning is mine. AI executes layout and states.

```
Context: @CLAUDE.md brand constraints, @tokens.css, FX Replay logos.
Value proposition (my words): "<headline>" / "<subhead>" / primary CTA "<label>". Audience: <who, what they're trying to do>.

FIRST read the current Astro docs for every API you plan to use (pages, `astro:assets`, fonts, `astro:env`, client directives, adapter)
and list the doc URLs you relied on. Do not write Astro code from memory.
Build the landing page as prerendered `.astro` components with ONE hydrated island (the signup form, Preact, `client:visible` or `client:idle`). Sections: hero + CTA, <2-3 proof/benefit
sections I specify>, final CTA. Dark-first on #030303 using semantic tokens only.
Constraints: Lato headings / Nunito Sans body via next/font with subsetting; no stock-photo filler; no invented stats, testimonials,
or customer logos; no financial or performance-return claims; no carousel. Semantic HTML landmarks and a single h1.
The hero LCP element must be identifiable and not lazy-loaded. Respect prefers-reduced-motion.
Before writing code, list the component tree and the JS you expect to ship to the client.
```
**Verify:** I review the rendered page at 360 / 768 / 1280px; grep for raw hex; Lighthouse mobile in `perf-auditor`.

## P4.2 Signup form state machine
```
Build the signup form as an explicit state machine: idle | validating | submitting | success | fieldError | serverError | networkError.
Use the shared zod schema from @src/contracts/users.ts for client validation. Calls POST /api/users with an idempotency key
generated once per form session. Requirements:
- inline field errors linked via aria-describedby; focus moves to first invalid field on submit failure
- aria-live="polite" region announces submitting / success / error
- disable double-submit; preserve user input on every error; retry affordance on network error
- success state shows the conversion state and next step; no redirect required
- 409 duplicate email shows a helpful message without revealing account existence beyond what's necessary (<my call>)
Output: the component plus a table of every state → what the user sees → what is announced → what is tracked.
```
**Verify:** Playwright test for each state; `a11y-auditor` runs on every state; I walk it with keyboard only and a screen reader (VoiceOver).
