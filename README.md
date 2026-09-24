# VALT

Monorepo: Next.js 15 web app + FastAPI service, wired together through a Next.js rewrite.

```
valt/
├── apps/
│   ├── web/                 Next.js 15 (App Router, TS, Tailwind v4)
│   └── api/                 FastAPI (Python 3.11+, pydantic-settings)
├── packages/
│   ├── shared/              TS types shared by the web app
│   └── tsconfig/            base tsconfig
├── turbo.json               task pipeline
└── docker-compose.yml       both services
```

## Setup

```bash
pnpm install          # JS workspaces
pnpm api:install      # creates apps/api/.venv and installs the API + dev deps
cp .env.example .env
```

`pnpm api:install` uses the Windows venv layout (`.venv/Scripts/python`). On
macOS/Linux use:

```bash
cd apps/api && python -m venv .venv && .venv/bin/python -m pip install -e ".[dev]"
```

## Run

```bash
pnpm dev              # turbo runs web (:3000) and api (:8000) together
```

Run the API alone with `pnpm api:dev`. The uvicorn on PATH must be the one from
`apps/api/.venv`, so activate the venv first (`apps/api/.venv/Scripts/activate`)
or run `apps/api/.venv/Scripts/uvicorn` directly.

- Web: http://localhost:3000
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

## How they talk

- Browser → `/api/py/*` → rewritten by `apps/web/next.config.ts` → `http://localhost:8000/api/*`. Same origin, no CORS preflight.
- Server components → `API_INTERNAL_URL` directly (`apps/web/src/lib/api.ts`).
- CORS is still enabled on the API for direct calls (`API_CORS_ORIGINS`).

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | all apps in dev mode |
| `pnpm build` | build everything |
| `pnpm test` | run tests (pytest for the API) |
| `pnpm lint` | eslint + ruff |
| `pnpm typecheck` | tsc + mypy |
| `docker compose up --build` | both services in containers |

## Shared types

`packages/shared/src/index.ts` and `apps/api/src/valt_api/schemas.py` are kept in
sync by hand. To generate the TS types instead, run
`curl localhost:8000/openapi.json` through `openapi-typescript`.
