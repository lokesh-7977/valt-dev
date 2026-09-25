# 0002. Monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

VALT has two deployables in different languages — a Next.js web app and a FastAPI service — plus
shared TypeScript config and types. Features usually touch both sides (a new AI endpoint and the UI
that calls it), so they should land in one PR and one review.

## Decision

We will keep everything in one repository:

```
apps/web          Next.js app            (pnpm workspace)
apps/api          FastAPI service        (Python, own venv; pnpm scripts wrap it)
packages/shared   TS types used by web
packages/tsconfig base tsconfig
```

- **pnpm workspaces** for JS dependencies.
- **Turborepo** (`turbo.json`) runs `dev`, `build`, `lint`, `typecheck`, `test` across apps.
  `apps/api/package.json` exposes the Python toolchain (uvicorn, pytest, ruff, mypy) as turbo tasks so
  one `pnpm dev` / `pnpm test` covers both languages.
- **docker-compose.yml** runs both services together.

## Alternatives considered

- **Separate repos for web and api** — cross-cutting features need coordinated PRs and version
  pinning between repos; too much overhead for one team.
- **Nx** — heavier, more opinionated; Turborepo is enough for two apps.

## Consequences

### Positive

- Atomic cross-stack changes; one CI pipeline.
- Turbo caches JS builds and typechecks.

### Negative / risks

- Python is a guest in a JS toolchain: the venv lives in `apps/api/.venv` and the `api:*` scripts
  assume the Windows venv layout (see README). Contributors on macOS/Linux set it up by hand.
- Shared API types are synced by hand between `packages/shared/src/index.ts` and
  `apps/api/src/valt_api/schemas.py`. As AI endpoints multiply, switch to generating TS types from
  `/openapi.json` (`openapi-typescript`).
