# 01 — Frame

## P1.1 Brief red-team (plan mode)
**Intent:** make sure I've understood the brief and found the ambiguities *before* investing time. I answer the questions myself.

```
You are a skeptical staff engineer reviewing a take-home brief. Read @docs/brief.md and @CLAUDE.md.

Task: do NOT propose a solution. Produce:
1. The 8 evaluation criteria the reviewers are most likely to weight, ranked, with the evidence in the brief for each.
2. Ambiguities or missing requirements, each with the assumption you would make and the cost if the assumption is wrong.
3. The top 5 ways a candidate could score poorly while "technically completing" the brief.
4. What a smaller-but-excellent submission looks like vs. a larger-but-diffuse one for a ~6h timebox.

Constraints: cite brief sections. No code. No invented facts about FX Replay's business or metrics.
Output: four numbered sections, terse.
```
**Verify:** I read it against the brief myself; assumptions I accept go into `docs/assumptions.md`; the ones I reject get logged.

## P1.2 Brand constraint extraction
```
Read the Brand Kit at @"/Users/vannelo/Downloads/Brand Kit/brand-kit.html" and @README.md.
Extract: semantic color tokens (name → purpose → hex), type families and weights, logo usage rules, and anything inconsistent
or missing (the README mentions tokens/ and source/ that may not exist; blue-950 is referenced but undefined).
Output a tokens.css proposal using semantic names only, and list every inconsistency as a question for design.
Do not invent colors. If a needed token doesn't exist, say so.
```
**Verify:** diff the output hex values against the HTML source; contrast-check pairs I intend to use.
