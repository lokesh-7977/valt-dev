---
name: tech-plan
description: Turn a PRD or feature request into an executable engineering plan — technical approach, ordered atomic tasks with exact file paths, dependency graph, parallelization, and rollback. Use when the user asks how to build something, wants a technical plan, task breakdown, or implementation strategy, or has a PRD ready to hand to engineering. Produces docs/plans/<slug>-plan.md that the execute skill consumes.
---

# Tech Plan

Turn **what** into **an ordered list of how**. Output feeds `execute` directly, so every task must be actionable without re-reading the PRD.

## Procedure

1. **Find the input.** Look for `docs/product/<slug>-prd.md`. No PRD and the request is vague? Say so and offer `prd` first. No PRD but the request is concrete? Proceed and note it.
2. **Read the real code.** Trace every path you intend to touch. Record `file_path:line` for each integration point. Never name a file, function, or symbol you have not confirmed exists.
3. **Choose an approach.** If there is a real fork, state 2 options with the trade-off in one line each and pick one. Don't survey.
4. **Decompose.** Atomic tasks — one reviewable change each, exact files, explicit "done when."
5. **Order** by dependency; mark parallel-safe tasks.
6. **Write** `docs/plans/<slug>-plan.md`.
7. **Report** path, task count, critical path, parallel tasks. Offer `/execute <slug>`.

## Stack facts (this repo)

- **Contract changes are two files**: `apps/api/src/valt_api/schemas.py` and `packages/shared/src/index.ts` are hand-synced. Changing an API shape without both is broken by construction.
- **API**: routers in `apps/api/src/valt_api/routers/`, registered in `main.py:create_app` with the `/api` prefix. Settings via `config.py`.
- **Web**: Next.js 15 App Router. Server components fetch via `apps/web/src/lib/api.ts`; browser requests hit `/api/py/*` and are rewritten in `apps/web/next.config.ts`.
- **Shared workspace package** `@valt/shared` is source-only (no build step) and is listed in `transpilePackages`.
- Verify with `pnpm --filter @valt/web build`, `pnpm --filter @valt/web typecheck`, and, for the API, the venv binaries at `apps/api/.venv/Scripts/`.

## Template

```markdown
# <Feature Name> — Engineering Plan

**PRD:** docs/product/<slug>-prd.md · **Date:** <YYYY-MM-DD> · **Tasks:** <n>

## Approach
Three to five sentences. What we build and the one structural decision that shapes it.

### Decision: <the fork>
- **Chosen:** <option> — <why in one line>
- **Rejected:** <option> — <why in one line>

## Touch points
| File | Line | What changes |
|------|------|--------------|
| apps/api/src/valt_api/routers/items.py | 12 | add list filter |

## Tasks

### [ ] T1 — <imperative title>
- **Files:** `<exact paths>`
- **Change:** <what, concretely>
- **Done when:** <observable condition>
- **Depends on:** none

### [ ] T2 — ...

## Order
Critical path: T1 → T3 → T4
Parallel: T2, T5 (no shared files, no dependency)

## Risks
- <risk> — <mitigation>

## Rollback
<how to undo this if it goes wrong in one step>
```

## Rules

- Every task heading starts with `[ ]` — the `execute` skill flips it to `[x]` to track progress, so the marker is required.
- A task naming a file that does not exist (and is not created by an earlier task) is a defect.
- If a task needs a paragraph to explain, split it.
- No test tasks — verification is the "Done when" line plus build/typecheck.
- Do not implement. Read-only commands only.
