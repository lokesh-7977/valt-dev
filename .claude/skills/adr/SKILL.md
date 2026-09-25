---
name: adr
description: Write a new Architecture Decision Record in docs/adr/ — or supersede an existing one — using the repo template, the next free number, and an updated index. Use when the user says ADR, "record this decision", "why did we choose X", adds a framework/infrastructure dependency, or when an agent reports that a change needs an ADR.
---

# ADR

Record one decision in `docs/adr/`. Format and rules: `docs/adr/0001-record-architecture-decisions.md`.

## Procedure

1. **Read** `docs/adr/README.md` (index) and `docs/adr/template.md`. Skim ADRs related to the topic —
   a new ADR must not silently contradict an accepted one.
2. **Decide the kind:**
   - New decision → next free number (`ls docs/adr/[0-9]*.md`, highest + 1, zero-padded to 4).
   - Changing an accepted decision → new ADR that supersedes it. Edit the old one's status line
     only: `Superseded by [NNNN](NNNN-title.md)`. Never rewrite an accepted ADR's body.
3. **Ground it in the repo.** Context cites real files and current state (`path:line` where useful).
   If a fact is unknown (e.g. provider not chosen), say so — don't invent it.
4. **Write** `docs/adr/NNNN-kebab-title.md` from the template:
   - Title in the imperative/noun form used by existing ADRs.
   - Status `Proposed` unless the user said it's decided → `Accepted`. Date = today.
   - At least two real alternatives, each with why-not in one line.
   - Consequences: positive, negative/risks, follow-ups. Negatives are mandatory — every decision
     costs something.
5. **Update the index** table in `docs/adr/README.md` (and the diagram if the decision changes it).
6. **Report** the path, status, and any ADRs it supersedes or follow-ups it creates.

## Rules

- One decision per ADR. If you're writing "and also", split it.
- Keep it under ~80 lines; link out for detail.
- Don't commit unless asked.
