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
pnpm api:install      # creates apps/api/.venv; installs API + dev + AI libs (FastAPI, Pydantic,
                      # SQLAlchemy, psycopg, Alembic, LangChain, LangGraph, CrewAI, pgvector)
cp .env.example .env
cp apps/api/.env.example apps/api/.env
pnpm db:up            # Postgres 17 + pgvector in Docker (or point API_DATABASE_URL at any Postgres)
pnpm db:migrate       # alembic upgrade head
```

Without a database the API still starts; `/api/health` works and DB endpoints return
`503 database_unavailable`. Without `GEMINI_API_KEY`, AI endpoints return `503 ai_unavailable`.

Routes are versioned under `/api/v1`. The generic Gemini endpoints (`/upload`, `/analyze`,
`/generate`, `/generate/stream`, `/process`) and how to add domain logic on hackathon day are
covered in [docs/api/ai-backend.md](docs/api/ai-backend.md).

Run the DB tests against a separate database:
`API_TEST_DATABASE_URL=postgresql+psycopg://valt:valt@localhost:5432/valt_test pnpm --filter @valt/api test`

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
| `pnpm db:up` / `pnpm db:migrate` | start Postgres / apply migrations |
| `pnpm --filter @valt/api db:revision "msg"` | new Alembic migration (review it!) |
| `pnpm lint` | eslint + ruff |
| `pnpm typecheck` | tsc + mypy |
| `docker compose up --build` | both services in containers |
| `pnpm gcp:deploy` | deploy the API to GCP Cloud Run (see `infra/gcp/README.md`) |

## API & product docs

- Response format and error codes: [`docs/api/conventions.md`](docs/api/conventions.md)
- Phased product spec (Phases 1–10): [`docs/product/roadmap.md`](docs/product/roadmap.md)
- Live API docs: http://localhost:8000/docs

## Shared types

`packages/shared/src/index.ts` and `apps/api/src/valt_api/schemas.py` are kept in
sync by hand. To generate the TS types instead, run
`curl localhost:8000/openapi.json` through `openapi-typescript`.

## Deploy (API → GCP)

```bash
cp infra/gcp/config.env.example infra/gcp/config.env   # project, region, LLM settings
pnpm gcp:deploy                                        # setup + build + migrate + deploy
```

After the first run, deploys are one click in GitHub Actions ("Deploy API (GCP Cloud Run)").
Details: [`infra/gcp/README.md`](infra/gcp/README.md). Decisions: [`docs/adr/`](docs/adr/README.md).
