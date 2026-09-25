---
name: superpowers
description: End-to-end feature pipeline — takes a raw idea and drives it through brainstorm, PRD, engineering plan, and execution in one continuous run, dispatching to the product-manager and engineering-manager agents and handing off to the execute skill. Use when the user says superpowers, wants a feature built start to finish, says "take this from idea to shipped", "do the whole thing", "run the full pipeline", or hands over a vague idea with no artifacts yet. For a single stage, use prd, tech-plan, or execute directly.
---

# Superpowers

One idea in, working code out. This skill is the conductor — it does not write PRDs, plans, or code
itself. It decides **what stage the work is at**, dispatches the right agent or skill, checks the
artifact that came back, and moves to the next stage without asking permission between every step.

No testing stage. Verification is each task's "Done when" condition plus the build gate.

## Stages

```
0 brainstorm ──▶ 1 prd ──▶ 2 plan ──▶ 3 execute ──▶ 4 report
   (inline)      product-       engineering-      execute
                 manager        manager           skill
```

| # | Stage | Runs | Artifact |
|---|-------|------|----------|
| 0 | Brainstorm | this skill, inline | none (conversation) |
| 1 | PRD | `product-manager` agent | `docs/product/<slug>-prd.md` |
| 2 | Plan | `engineering-manager` agent | `docs/plans/<slug>-plan.md` |
| 3 | Execute | `execute` skill | code + `[x]` in the plan |
| 4 | Report | this skill, inline | summary |

## Entry routing

Determine the slug first (kebab-case, short), then find the highest stage already complete and
**start at the next one**. Never redo a stage whose artifact exists unless the user asks.

- `docs/plans/<slug>-plan.md` exists with unchecked tasks → **stage 3**
- `docs/plans/<slug>-plan.md` exists, all checked → **stage 4**, report and stop
- `docs/product/<slug>-prd.md` exists, no plan → **stage 2**
- Nothing exists, request is concrete (names the change, the surface, the behavior) → **stage 2**, skip the PRD and say why
- Nothing exists, request is vague → **stage 0**

Say which stage you are entering at and why, in one line, before dispatching.

## Stage 0 — Brainstorm

Only when the idea is too vague to scope. Keep it to one exchange:

1. Read `README.md` and `.claude/README.md` for context.
2. Offer **2–3 concrete shapes** the idea could take, one line each, with the trade-off named.
3. Ask **one** question: which shape, or what is wrong with all of them.
4. On an answer, go straight to stage 1. Do not brainstorm twice.

If the user's idea is already one clear shape, skip this stage entirely.

## Stage 1 — PRD

Dispatch the `product-manager` agent. Give it: the idea verbatim, the chosen shape from stage 0, the
slug, and any constraint the user stated.

Check what comes back before continuing:
- file exists at `docs/product/<slug>-prd.md`
- "Not in v1" is non-empty (an empty one means scope was not cut — send it back once)
- every acceptance criterion is an observable statement
- Evidence section has sources; AI features have a filled AI contract (≥3 quality examples, numeric budgets)

Then go to stage 2 without asking.

## Stage 2 — Plan

Dispatch the `engineering-manager` agent with the PRD path (or the raw request, if the PRD was
skipped) and the slug.

Check what comes back:
- file exists at `docs/plans/<slug>-plan.md`
- every task heading is `### [ ] T<n> — <title>`
- every file path named in the plan either exists on disk or is created by an earlier task — verify
  this yourself, do not trust the plan
- any task changing an API shape touches **both** `apps/api/src/valt_api/schemas.py` and
  `packages/shared/src/index.ts`
- every task has an Owner; AI features have an AI design section with budget math and an eval task

A failed check goes back to the agent once with the specific defect. Twice failed → stop and tell the user.

## Stage 3 — Execute

Invoke the `execute` skill with the slug. It owns task order, checkoffs, the verification gate, and
the deviation rule — do not re-implement any of that here.

## Stage 4 — Report

- what shipped, in one line
- artifacts: PRD path, plan path
- tasks completed / total
- verification gate result, with exact output on failure
- deviations taken during execution
- what was deferred ("Not in v1" carried forward)

## Rules

- **Do not stop between stages to ask permission.** The user invoking this skill is the approval.
  Stop only for: a stage-0 question, a check that failed twice, or a structural deviation escalated
  by `execute`.
- **One slug per run.** Every artifact shares it. Reuse an existing slug only to continue that work.
- **Never skip a check to save a step.** A plan naming a file that does not exist wastes the entire
  execution stage.
- **Do not write the artifacts yourself.** If an agent is unavailable, invoke the matching skill
  (`prd`, `tech-plan`) rather than improvising the document.
- Resumable: rerunning `/superpowers <slug>` after any interruption re-routes from the artifacts on
  disk and continues.
