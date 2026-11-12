# Brand Kit — open questions for design

Source: `brand-kit.html` (repo copy). Companion: `tokens.proposal.css`. Contrast ratios computed (WCAG 2.x relative luminance), not eyeballed.

## Inconsistencies / gaps
1. **`blue-950` undefined.** `btn-bg-primary-disabled` points to it; the kit's JS hard-codes `#000000`. Is a disabled primary button really pure black on a `#030303` page (invisible surface)?
2. **Two blacks, no distinction.** `Brand › Black #000000` / `neutral-950` / `dark-950` / `blue-950` are all `#000`; `Brand › Accent #2A2A2A` duplicates `dark-600`. Which primitive names are canonical?
3. **`neutral-900…500` are mid-greys (#3D3D3D→#6D6D6D), not near-black**, unlike `dark-*`. Inverted from the usual scale. Intentional? Nothing semantic uses them.
4. **Kit page uses off-palette values.** `--card:#0b0b0b`, `--line:#1c1c1c`, `--ink-3:#9a9a9a`, `#060606`, `#070707` are not in the palette; and it loads **JetBrains Mono**, which is not in the type system. I treated these as kit-page chrome, not brand.
5. **No tokens/ or source/ directory.** The Brand Kit README (not readable by me: `~/Downloads` is blocked by macOS permissions) reportedly mentions them. The repo README does not. No type scale, spacing, radius, shadow or motion tokens exist anywhere.
6. **No focus-ring token.** Needed for WCAG 2.2 (2.4.7 / 2.4.13). `border-brand` (blue-600) is the nearest candidate.
7. **No hover/pressed for links or `text-brand`**; only `btn-text-minimal-*` (blue-500).
8. **Logo rules are thin:** "never recolor, stretch, effects". No clear-space, min size, or on-which-backgrounds beyond dark / blue / light. `logos/` has `FXReplayLogo.svg`, `isotypeBlack.svg`, `isotypeWhite.svg` (the kit's inline isotype uses blue `#0260FD` + `#F6F6F6` two-tone, which has no file in `logos/`).
9. **Naming drift:** semantic `alternate` has no `bg-` prefix; I renamed it `--bg-alternate`. Confirm.
10. **Type:** no sizes, line-heights or tracking spec. Kit page uses `-0.02em` on headings; unspecified as brand.

## Contrast findings (pairs I'd use)
| Pair | Ratio | Verdict |
|---|---|---|
| text-primary / bg-primary | 19.08 | pass |
| text-secondary / bg-primary | 13.51 | pass |
| text-disabled (#888) / bg-primary | 5.82 | pass (but disabled text is exempt anyway) |
| **text-brand (blue-600) / bg-primary** | **4.02** | **FAIL AA for normal text**; OK only for large text (≥24px / 18.66px bold) and UI components (3:1) |
| blue-500 / bg-primary | 5.26 | pass on the page; **4.44 on card-bg-secondary (dark-700): fails**. Use blue-400 for inline brand text/links on both surfaces (`--text-link` in `src/styles/tokens.css`) |
| btn-text / btn-primary (blue-600) | 4.75 | pass, narrowly; pure white gives 5.13 |
| btn-text / hover (blue-800), pressed (blue-900) | 11.2 / 14.6 | pass |
| btn-text-disabled / btn-secondary-disabled | 2.65 | fail, but disabled controls are exempt from 1.4.3 |
| btn-border-outline / bg-primary | 3.81 | pass for non-text (≥3:1) |
| **border-primary / border-secondary vs bg-primary** | **1.19 / 1.44** | decorative only. **Never use as an input border** (1.4.11 needs 3:1). Use `btn-border-outline` or lighter for form fields |
| blue-600 focus ring / bg-primary | 4.02 | pass (≥3:1) |
| **error (#CD3636) / bg-primary** | **4.10** | **FAIL for error text**; use `error-light` (15.44) for text and keep `error` for fills/borders |
| **btn-text / bg-success** | **2.36** | **FAIL**; do not put light text on success fill. |
| **btn-text / bg-warning** | **2.67** | **FAIL**, same |
| btn-text / bg-error | 4.65 | pass, narrowly |
| text-error (error-light) / bg-error | 3.76 | **FAIL** for the kit's own `text-error` on `bg-error` pairing |

**Impact on the build:** (a) inline brand-blue text/links use `blue-500`, not `text-brand`; (b) inline field-error messages use `text-error` (error-light) on the dark ground, with an `error` icon/border; (c) success/warning banners need dark text (`dark-900` on success = 8.08), but the kit defines no token for that, so it's a request to design; (d) form field borders need a token ≥3:1.

## Needs a design decision (I did not invent these)
- Dark-on-success/warning text token.
- Input border / field-surface tokens.
- Focus-ring token.
- Whether `text-brand` is meant for large display text only.
