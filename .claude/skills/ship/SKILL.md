---
name: ship
description: Take finished work to a reviewable pull request — run the full quality gate across both apps, check contract sync and secrets, branch off main if needed, commit with a conventional message, push, and open a PR with gh. Use when the user says ship it, open a PR, ready for review, commit and push, or wrap up this branch.
---

# Ship

Invoking this skill is the user's request to commit, push, and open a PR for the current work.
Anything beyond that (merging, deploying, force-pushing) still needs its own explicit ask.

## Procedure

1. **Survey.** `git status`, `git diff --stat`, `git log --oneline main..HEAD`. Identify what's in
   scope. Anything unrelated or surprising (large binaries, `.env`, lockfile churn you didn't
   cause) → ask before including.
2. **Secrets check.** Grep the diff for keys/tokens (`sk-`, `AKIA`, `-----BEGIN`, `api_key=`,
   `password=`) and make sure no `.env` file is staged. Stop on any hit.
3. **Contract check.** If `apps/api/src/valt_api/schemas.py` or `packages/shared/src/index.ts`
   changed, the other must be consistent — run the `sync-contract` skill's drift check.
4. **Gate** — all must pass; quote failures exactly and stop:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```
5. **ADR check.** New framework/infrastructure dependency or structural change without an ADR in
   `docs/adr/`? Offer the `adr` skill before shipping.
6. **Branch.** On `main` → create `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, or `docs/<slug>`.
7. **Commit.** Conventional Commits, matching repo history (`feat(web): …`, `feat(api): …`,
   `docs: …`). Split into several commits only when the changes are independently meaningful.
   End the message with the attribution lines required by the session.
8. **Push and open PR** with `gh pr create --base main`. Body:
   ```markdown
   ## What
   <1–3 bullets>

   ## Why
   <link PRD / plan / ADR if any>

   ## How verified
   - pnpm lint / typecheck / test / build: pass
   - <manual checks actually performed>

   ## Notes for reviewers
   <risks, follow-ups, anything not verified>
   ```
   End the body with the PR attribution line required by the session.
9. **Report** the branch, commits, and PR URL.

## Rules

- Never `--no-verify`, never force-push, never merge.
- If `gh` isn't authenticated, stop after pushing and tell the user to run `! gh auth login`.
- Never claim a check passed that you didn't run.
