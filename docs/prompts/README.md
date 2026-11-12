# Prompt library

Prompts are versioned engineering assets here, not chat history. Each one states its intent, the prompt, and **how I verify the output**.

## Anatomy of every prompt
1. **Role / lens**: who is answering (or which agent runs it)
2. **Context**: pointers to files (`@docs/...`) instead of pasting; the brief, brand constraints, prior ADRs
3. **Task**: one outcome, not a bundle
4. **Constraints**: what NOT to do (scope, dependencies, style); the stack in CLAUDE.md applies
5. **Output format**: so the result is checkable (table, diff, schema, findings with severity)
6. **Verification hook**: how the output will be checked by something other than the author

## Index
| File | Phase | Use |
|---|---|---|
| `01-frame.md` | Frame | Surface assumptions, gaps, risks before building |
| `02-contract.md` | Contract | Users API contract + tracking plan, before code |
| `03-build-api.md` | Build | Implement + test the API from the contract |
| `04-build-ui.md` | Build | Landing + signup states within brand tokens |
| `05-analytics.md` | Instrument | Typed wrapper, e2e assertions on real payloads |
| `06-audit.md` | Audit | Specialist agents, adversarial review |
| `07-docs-and-rehearsal.md` | Wrap | Architecture doc, experiment, and review rehearsal |

## Rules of use
- If I edit a prompt after seeing a bad result, I keep both versions and log why in `ai-judgment-log.md`.
- If I use a prompt twice, it becomes a skill under `.claude/skills/`.
- Placeholders in `<angle brackets>` are filled with my own decision. I never let the model choose the product framing.
