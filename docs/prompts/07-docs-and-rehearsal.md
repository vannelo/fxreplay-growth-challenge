# 07 — Docs and review rehearsal

## P7.1 Architecture doc (I outline; AI drafts; I cut)
```
Draft docs/architecture.md from the ADRs in @docs/decisions and the actual code structure (read it, don't assume).
Sections exactly as in the brief's deliverable #2, plus a diagram in Mermaid. Max 2 pages.
Rules: every decision links to its ADR; trade-offs stated as costs, not marketing; "what I'd change for production" is concrete
(named services, named risks). Remove any sentence that would be equally true of any project.
```

## P7.2 Experiment write-up
```
Use experiment-analyst. My hypothesis: "<mine>". Fill the five sections from the brief (hypothesis, control, variant,
success metric, decision criteria) and add: randomization unit, guardrails, sample-size method with ASSUMED baseline (labeled as assumption),
peeking policy, and pre-registered ship / continue / reject rules. Do not invent FX Replay baseline numbers.
```

## P7.3 Technical review rehearsal (60 min)
```
Act as the FX Replay engineering panel. Interview me about this repo one question at a time and wait for my answer.
Probe: architecture trade-offs, why this analytics design, how I'd detect a silent conversion drop, what I'd do on a 10x traffic spike,
what I delegated vs wrote myself, which AI output I rejected and why. After each answer, give a 1-line critique of how convincing it was.
After 10 questions, introduce ONE surprise requirement (e.g. "add a second signup path via Google OAuth" or "support 5 locales")
and evaluate how I adapt. End with my 3 weakest answers.
```
**Verify:** I answer out loud, with the repo open. Weak answers become additions to "what I'd do next" or fixes to the code.
