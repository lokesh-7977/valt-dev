# Claude workspace

Planning-and-execution pipeline for this repo. No testing stage by design — verification is the
"Done when" condition on each task plus the build/typecheck gate.

```
                       /superpowers  (conductor — runs all of it)
                             │
   idea ──▶ brainstorm ──▶ product-manager ──▶ engineering-manager ──▶ execute
                             (prd skill)        (tech-plan skill)     (execute skill)
                                 │                      │                   │
                    docs/product/<slug>-prd.md  docs/plans/<slug>-plan.md  code + [x]
```

## Agents (`.claude/agents/`)

| Agent | Owns | Never does |
| --- | --- | --- |
| `product-manager` | problem, users, v1 scope, stories, non-goals | technical design |
| `engineering-manager` | approach, task breakdown, ordering, risk | writes feature code |

Invoke by name, e.g. "use the product-manager agent to scope offline mode".

## Skills (`.claude/skills/`)

| Skill | Input | Output |
| --- | --- | --- |
| `/superpowers` | raw idea | everything below, end to end |
| `/prd` | rough idea | `docs/product/<slug>-prd.md` |
| `/tech-plan` | PRD or concrete request | `docs/plans/<slug>-plan.md` |
| `/execute [slug]` | a plan file | code, tasks checked off in place |

## Why plans live on disk

`execute` reads and writes the plan file as it goes, flipping `### [ ] T3` to `### [x] T3` after each
task. An interrupted run resumes from the first unchecked task with satisfied dependencies — no state
lives in the conversation.

## Two ways to run it

**Full pipeline** — one command, no stops between stages:

```
/superpowers add tagging to items
```

It picks the slug, routes to the right starting stage based on which artifacts already exist,
dispatches both agents, validates each artifact before moving on, and hands off to `execute`.
Rerun it after an interruption — it re-routes from disk.

**Stage at a time** — when you want to read and edit an artifact before the next stage:

```
/prd add tagging to items
/tech-plan item-tagging
/execute item-tagging
```

Skip `/prd` when the ask is already concrete; `/tech-plan` handles a direct request and says so in the plan.

## Stage gates

`/superpowers` refuses to advance on a bad artifact. A PRD with an empty "Not in v1" means scope was
never cut. A plan naming a file that does not exist wastes the whole execution stage, so paths are
verified against disk before execution starts. Each failed check goes back to the agent once.
