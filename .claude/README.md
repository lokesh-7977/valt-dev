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

| Agent | Stage | Owns | Never does |
| --- | --- | --- | --- |
| `product-manager` | define | AI product thinking: web research with sources, "should this be AI?", 2–3 shapes compared, AI contract (quality bar, failure UX, cost), v1 cut | technical design |
| `engineering-manager` | plan | docs-verified approach, AI design + budget math, eval task, tasks with an **Owner**, ordering, risk | writes feature code |
| `ai-engineer` | build | `apps/api/.../ai/`: model calls, LangGraph, CrewAI, RAG, prompts, evals, cost | UI; breaks ADRs 0003–0007 without a new ADR |
| `backend-engineer` | build | rest of `apps/api`: endpoints, schemas, settings, persistence, auth | AI layer, web |
| `frontend-engineer` | build | `apps/web`: pages, TanStack Query, shadcn/ui, streamed run UI | API code |
| `database-engineer` | build | Postgres: SQLAlchemy models, Alembic migrations, repositories, indexes, pgvector | routers/UI; runs migrations on non-dev DBs unasked |
| `devops-engineer` | build/run | CI, Docker/compose, env config, infra services, observability | feature code; paid/remote infra without asking |
| `qa-engineer` | verify (on demand) | acceptance-criteria tests, pytest, Playwright e2e, bug repro | changes product code unasked |
| `security-reviewer` | verify (on demand) | auth, secrets, input handling, prompt injection, tool privilege, deps | edits code |

Invoke by name, e.g. "use the ai-engineer agent to build document Q&A" or "use security-reviewer on
this branch". `qa-engineer` and `security-reviewer` sit outside the default pipeline — call them when
you want that pass.

## Skills (`.claude/skills/`)

| Skill | Input | Output |
| --- | --- | --- |
| `/superpowers` | raw idea | everything below, end to end |
| `/prd` | rough idea | `docs/product/<slug>-prd.md` |
| `/tech-plan` | PRD or concrete request | `docs/plans/<slug>-plan.md` (tasks tagged with Owner) |
| `/execute [slug]` | a plan file | code, tasks checked off in place, owner rules applied per task |
| `/adr` | a decision | `docs/adr/NNNN-*.md` + index update |
| `/sync-contract` | schema change or drift audit | `schemas.py` ⇄ `packages/shared` in sync |
| `/ai-eval` | AI feature or prompt/model change | eval cases, runner, before/after scores |
| `/ship` | finished work | gate passed, branch, commit, PR |
| `/postgres-sqlalchemy` | DB task | models, migrations, repositories, indexes, DB tests |
| `/gcp-deploy` | deploy/infra task | Cloud Run + Cloud SQL deploy, one command or one click |
| `/ui-ux-pro-max` | UI/UX decision | searchable styles, palettes, fonts, UX rules; VALT direction in `design-system/valt/MASTER.md` |
| `/engineering-system-designer` | architecture question | capacity math, failure modes, design docs (`docs/design/`) |
| `/engineering-backend-architect` | API or AI task | FastAPI + LangChain/LangGraph/CrewAI rules and patterns |
| `/engineering-frontend-developer` | web UI task | Next.js + TanStack Query + shadcn/ui rules and patterns |

The `engineering-*` skills come from [PeterHdd/agent-skills](https://github.com/PeterHdd/agent-skills)
(MIT). Backend and frontend are rewritten around `docs/adr/`, and system-designer is kept as-is with a VALT
context note. `ui-ux-pro-max` comes from
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT,
core skill only, script paths made repo-relative). Each folder keeps its license.

## Full product lifecycle

```
idea ─▶ /prd ─▶ /tech-plan ─▶ /execute ───────────────▶ qa-engineer ─▶ security-reviewer ─▶ /ship ─▶ deploy
        PM       EM (owners)   db / ai / backend /         (optional)     (optional)          PR       GCP (ADR 0012)
                               frontend / devops per task
   decisions along the way ─▶ /adr        contract changes ─▶ /sync-contract     AI quality ─▶ /ai-eval
```

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
