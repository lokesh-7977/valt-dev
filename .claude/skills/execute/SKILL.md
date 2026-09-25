---
name: execute
description: Execute an engineering plan from docs/plans/ task by task — implement each task, verify it, check it off in the plan file, and keep going until the plan is done. Use when the user says execute, implement the plan, build it, start the work, or continue/resume a plan. Takes an optional plan slug argument.
---

# Execute

Run a plan from `docs/plans/<slug>-plan.md` to completion. Stateful: the plan file is the source of truth for progress, so an interrupted run resumes cleanly.

## Procedure

1. **Locate the plan.**
   - Slug given → `docs/plans/<slug>-plan.md`.
   - No slug → list `docs/plans/*-plan.md`. Exactly one with unchecked tasks → use it. Several → ask which.
   - None → say so and offer `tech-plan`.
2. **Read the whole plan**, then read every file named in Touch points. Do not start from the task list alone.
3. **Resume check.** Tasks marked `[x]` are done — skip them. Start at the first unchecked task whose dependencies are all checked.
4. **Per task, in order:**
   a. State the task ID and title in one line before starting.
   b. Implement exactly that task. Nothing from a later task, nothing the plan doesn't call for.
      If the task has an **Owner**, follow that owner's rules: read `.claude/agents/<owner>.md` and
      apply its skill (`engineering-backend-architect` for backend/ai, `postgres-sqlalchemy` for database,
      `engineering-frontend-developer` for frontend, `gcp-deploy` for devops). Delegate the task to the owner agent only when the user asked for delegated or
      parallel execution.
   c. Verify the "Done when" condition — run the real command, read the real output.
   d. Mark it `[x]` in the plan file immediately, before moving on.
5. **When the plan is complete**, run the full gate (below) and report.

## Verification gate

Run after the last task, and after any task that changes a contract:

```bash
pnpm --filter @valt/web typecheck
pnpm --filter @valt/web build
apps/api/.venv/Scripts/ruff check apps/api/src
apps/api/.venv/Scripts/mypy apps/api/src
```

Quote failures exactly. Never report green without having seen it.

## Deviation rule

The plan is wrong sometimes — a file moved, a signature differs, a task is impossible as written.

- **Small and obvious** (path drifted, name differs): fix it, do the task, note the deviation in your report.
- **Structural** (the approach doesn't work, a task needs to split, scope grows): stop, state the problem in two sentences, propose the amendment, wait.

Never silently expand scope. Never invent a task the plan doesn't have.

## Reporting

Progress line per task, terse: `T3 ✓ items filter — apps/api/src/valt_api/routers/items.py`.

Final report:
- tasks completed / total
- verification gate results, with exact output on failure
- deviations taken
- anything left unchecked and why

## Rules

- Contract changes touch both `apps/api/src/valt_api/schemas.py` and `packages/shared/src/index.ts`. Doing one is a broken build waiting to happen.
- Check off tasks in the plan file as you go, not in a batch at the end — a crash mid-run must not lose progress.
- No test-writing unless a task explicitly says to.
- No commits unless the user asks.
