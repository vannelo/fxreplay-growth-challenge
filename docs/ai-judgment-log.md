# AI Judgment Log

The review asks: *what did you delegate, what did you do yourself, what did you reject or correct, how did you validate?*
This log answers that with evidence. **Fill it in during the work.** Do not invent or backfill entries; an empty
honest log is better than a polished fake one.

## How to log (30 seconds per entry)
Copy the template below, paste at the top of the entries section, fill it in right after the interaction.

```
### YYYY-MM-DD HH:MM — <short title>
- **Phase / agent:** (e.g. Phase 2, main thread | api-reviewer)
- **Delegated:** what I asked AI to do
- **Prompt:** link to docs/prompts/NN-*.md or paste the key part
- **Output (summary):** what it produced
- **My judgment:** accepted | corrected | rejected
- **Why:** the specific problem or the reason it was fine
- **Validation:** test / tool run / manual read / agent review that confirmed it
- **Commit:** <hash>
```

## Entries
_(none yet — start logging when work begins)_

---

## Categories to look for (prompts for my own attention, not entries)
Good rejection/correction candidates tend to be where AI is confidently wrong:
- Over-engineering (extra abstractions, unneeded dependencies, generic "enterprise" structure)
- Validation only on the client, or schemas duplicated between client and server
- Analytics firing on click instead of server-confirmed conversion; PII in event properties; duplicate events
- Accessibility theater (ARIA added where native semantics suffice, missing focus management after errors)
- Raw hex colors or off-brand fonts instead of semantic tokens
- Persistence that silently breaks on serverless (in-memory/file on Vercel)
- Invented statistics, baselines, or sample-size numbers
- Tests that assert implementation details or always pass

## Summary for the review (fill in at the end, from the entries above)
- Delegated: …
- Did myself: …
- Rejected/corrected (top 3, with evidence): …
- How I validated: …
