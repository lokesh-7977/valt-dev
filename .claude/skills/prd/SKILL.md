---
name: prd
description: Write a scoped Product Requirements Document for a feature or product idea — problem, users, v1 scope, user stories with acceptance criteria, explicit non-goals, and success metrics. Use when the user asks for a PRD, product spec, requirements, user stories, or says they want to define/scope a feature before building it. Produces docs/product/<slug>-prd.md. Do not use for technical design (use tech-plan) or implementation (use execute).
---

# PRD

Turn a rough idea into a written, scoped product definition. One file, one feature.

## Procedure

1. **Pick a slug.** Kebab-case, short: `item-tagging`, `user-auth`. Reuse an existing slug only when revising that same PRD.
2. **Ground yourself.** Read `README.md`, any file in `docs/product/`, and skim what already exists (`apps/api/src/valt_api/routers/`, `apps/web/src/app/`). Note anything the idea overlaps or contradicts.
3. **Research.** Web-search users' pain, 3–5 competitors/alternatives, and what current AI models can actually do for this task (capability, failure modes, cost, latency). Cite every external claim in Evidence. Unverified → Assumptions.
4. **Decide if and how AI fits** (no AI / assist / approve / autonomous) and compare 2–3 product shapes before choosing one.
5. **Ask at most 3 questions, batched, once** — only where different answers change the PRD materially. Otherwise assume and label the assumption.
6. **Cut to a v1.** Ruthlessly. Anything not needed to prove the core value moves to "Not in v1."
7. **Self-critique**, then **write** `docs/product/<slug>-prd.md` with the template below.
8. **Report** the path, the problem in one line, the v1 cut, and the biggest risk. Offer handoff to `tech-plan`.

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

## Evidence
- <finding> — <source link> (<date accessed>)

## Approach chosen
- **Shape:** <no AI | AI assist | AI with approval | autonomous> — <why>
- **Alternatives rejected:** <shape> — <why it lost>

## Success metrics
- <metric> — from <baseline> to <target>, measured by <how>
- AI quality: <pass rate on eval set ≥ X%> · time to first token ≤ <n>s · cost ≤ <$ per use>

## v1 scope
| # | Story | Acceptance criteria |
|---|-------|---------------------|
| 1 | As a <user>, I can <action> so that <outcome> | - <observable, testable statement><br>- <another> |

## AI contract
**Quality bar (seeds the eval set):**
| Input | Good output looks like | Must not |
|-------|------------------------|----------|
| <example> | <expected> | <failure to avoid> |

- **Launch threshold:** <pass rate / criteria>
- **Failure behaviour:** <what the user sees when the model is wrong, unsure, slow, refuses, or down>
- **Human in the loop:** <actions requiring user approval>
- **Trust UX:** <sources shown, progress/steps streamed, undo/edit>
- **Latency & cost budget:** <TTFT, total time, cost per use / per user per month>
- **Data & privacy:** <what goes to model providers, what is stored, retention>
- **Abuse & safety:** <injection via content, misuse, limits>

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
- AI features always have a filled AI contract with at least 3 quality-bar examples and numeric budgets. Non-AI features write "N/A — no model involved" and why.
- Every external claim has a source in Evidence. No invented numbers.
