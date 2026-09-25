# 0011. PostgreSQL with SQLAlchemy 2.0 (async) and Alembic

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

The API has no database: `routers/items.py` keeps items in a module-level dict. ADR 0005 needs
Postgres for LangGraph checkpoints, and ADR 0004 needs a vector store for retrieval. App data
(users, threads metadata, documents, items) needs durable, relational storage with migrations.
The backend is async FastAPI (ADR 0003), so the data layer must be async too.

## Decision

- **Database:** PostgreSQL 17 with the **pgvector** extension — one instance for app tables,
  LangGraph checkpoints, and embeddings until load proves otherwise. Local/dev image:
  `pgvector/pgvector:pg17`.
- **ORM:** **SQLAlchemy 2.0**, async (`create_async_engine`, `AsyncSession`), typed declarative
  models (`Mapped[...]`, `mapped_column`).
- **Driver:** **psycopg 3** (`postgresql+psycopg://`) for SQLAlchemy — the same driver
  `langgraph-checkpoint-postgres` uses, so there is one driver and one set of connection settings.
- **Migrations:** **Alembic** (async template) in `apps/api/migrations/`, config in
  `apps/api/alembic.ini`. Every schema change is a reviewed migration. Autogenerate is a draft,
  not the answer.
- **Ownership split:** Alembic owns app tables. LangGraph's checkpoint tables are created by
  `AsyncPostgresSaver.setup()` and are excluded from Alembic autogenerate.
- **Layout:**
  ```
  valt_api/db/
    base.py        DeclarativeBase + naming convention
    session.py     engine/sessionmaker factory, get_session dependency
    models/        one module per aggregate
    repositories/  query functions taking an AsyncSession
  ```
  Routers depend on repositories/services, never build queries inline.
- **Config:** `API_DATABASE_URL` in `Settings`; engine created in `lifespan`, stored on
  `app.state`.

## Alternatives considered

- **MySQL** — no pgvector equivalent in core, weaker JSONB/partial-index story, and LangGraph's
  maintained SQL checkpointer targets Postgres.
- **SQLModel** — nicer Pydantic overlap, but lags SQLAlchemy 2.0 features and typing; we keep API
  schemas (Pydantic) and tables (SQLAlchemy) deliberately separate anyway.
- **Raw asyncpg / psycopg** — fastest, but hand-written SQL for all CRUD and no migration
  autogenerate.
- **Separate vector DB (Pinecone, Qdrant)** — another service and bill before we need it.
- **asyncpg driver** — fast, but a second driver next to psycopg for LangGraph.

## Consequences

### Positive

- One database, one driver, one backup story for app data, agent state, and vectors.
- Typed models work under `mypy --strict` without a plugin.
- Migrations reviewed in PRs like code.

### Negative / risks

- Async SQLAlchemy forbids implicit lazy loading — relationships must be loaded explicitly
  (`selectinload`) or access raises. Set `lazy="raise"` to catch this in development.
- Two schema definitions per entity (SQLAlchemy model + Pydantic schema) — intentional, but it's
  mapping code to maintain.
- Tests that need the DB require a running Postgres; they are marked and skipped when
  `API_TEST_DATABASE_URL` is unset so `pnpm test` still runs without Docker.
- Checkpoint tables live outside Alembic; their upgrades come with `langgraph-checkpoint-postgres`
  version bumps.

### Follow-ups

- Add `postgres` service to `docker-compose.yml`, `.env.example` entries, and a CI service
  container (devops-engineer).
- Replace the in-memory store in `routers/items.py` as the first real table.
- Wire `AsyncPostgresSaver` in `lifespan` when `API_DATABASE_URL` is set (ADR 0005).
