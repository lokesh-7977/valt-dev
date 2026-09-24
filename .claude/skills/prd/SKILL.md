---
name: prd
description: Write a scoped Product Requirements Document for a feature or product idea — problem, users, v1 scope, user stories with acceptance criteria, explicit non-goals, and success metrics. Use when the user asks for a PRD, product spec, requirements, user stories, or says they want to define/scope a feature before building it. Produces docs/product/<slug>-prd.md. Do not use for technical design (use tech-plan) or implementation (use execute).
---

# PRD

Turn a rough idea into a written, scoped product definition. One file, one feature.

## Procedure

1. **Pick a slug.** Kebab-case, short: `item-tagging`, `user-auth`. Reuse an existing slug only when revising that same PRD.
2. **Ground yourself.** Read `README.md`, any file in `docs/product/`, and skim what already exists (`apps/api/src/valt_api/routers/`, `apps/web/src/app/`). Note anything the idea overlaps or contradicts.
3. **Ask at most 3 questions, batched, once** — only where different answers change the PRD materially. Otherwise assume and label the assumption.
4. **Cut to a v1.** Ruthlessly. Anything not needed to prove the core value moves to "Not in v1."
5. **Write** `docs/product/<slug>-prd.md` with the template below.
6. **Report** the path, the problem in one line, the v1 cut, and the biggest risk. Offer handoff to `tech-plan`.

## Template

```markdown
# <Feature Name> — PRD

**Status:** draft · **Owner:** <user> · **Date:** <YYYY-MM-DD>

## Problem
Two or three sentences. Who hurts, how, and what it costs them today. No solution language.

## Users
The specific segment this is for. Who it is explicitly NOT for.

## Goal
One sentence: the change in user behavior or outcome this creates.

## Success metrics
- <metric> — from <baseline> to <target>, measured by <how>

## v1 scope
| # | Story | Acceptance criteria |
|---|-------|---------------------|
| 1 | As a <user>, I can <action> so that <outcome> | - <observable, testable statement><br>- <another> |

## Not in v1
- <item> — <why deferred, and what would pull it forward>

## Assumptions
- <assumption made in place of asking, and what breaks if it's wrong>

## Open questions
- <question> — blocks <what>, needed by <when>

## Risks
- <risk> — <impact> — <mitigation or "accepted">
```

## Rules

- Acceptance criteria are observable statements. "Toast appears within 2s on 5xx" — not "handles errors well."
- No endpoints, no schemas, no file paths, no library names. That is `tech-plan`'s job.
- Every story maps to the goal. If it doesn't, it is not in v1.
- "Not in v1" is never empty. An empty one means you didn't cut.
