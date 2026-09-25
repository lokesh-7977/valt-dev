---
name: postgres-sqlalchemy
description: Design and change VALT's PostgreSQL data layer with async SQLAlchemy 2.0, psycopg 3, Alembic migrations, and pgvector — models, relationships, indexes, repositories, sessions/transactions, migrations, query performance, and DB tests. Use when adding or changing a table/column/index, writing a migration, writing queries or repositories, adding embeddings/vector search, debugging slow queries or MissingGreenlet/lazy-load errors, or setting up the database for the first time.
metadata:
  version: "1.0.0"
---

# Postgres + SQLAlchemy Guide (VALT)

Decision: `docs/adr/0011-postgres-with-sqlalchemy-and-alembic.md`. Patterns with code:
[references/patterns.md](references/patterns.md).

## Layout

```
apps/api/
  alembic.ini
  migrations/            env.py (async), versions/
  src/valt_api/db/
    base.py              Base(DeclarativeBase) + naming convention
    session.py           make_engine, make_sessionmaker, get_session dependency
    models/<aggregate>.py
    repositories/<aggregate>.py
```

Dependencies (pin in `pyproject.toml`): `sqlalchemy[asyncio]>=2.0`, `psycopg[binary,pool]>=3.2`,
`alembic`, `pgvector` (when embeddings exist).

## Modeling rules

- Typed declarative only: `Mapped[T]` + `mapped_column(...)`. `Mapped[str | None]` means nullable.
- Primary keys: `BigInteger` identity for internal tables; `UUID` (`uuid7`/`gen_random_uuid()`)
  for IDs exposed in URLs or shared across systems (threads, documents).
- Every table has `created_at` and `updated_at` (`timestamptz`, server defaults). Store UTC only.
- Constraints live in the DB: `nullable=False`, `UniqueConstraint`, `CheckConstraint`, FKs with an
  explicit `ondelete`. Pydantic validation is not a substitute.
- The `Base.metadata` naming convention is mandatory — unnamed constraints make Alembic
  migrations non-deterministic.
- Enums: `String` + `CheckConstraint` (or a native enum only if values are truly fixed) — native
  Postgres enums are painful to alter.
- Flexible attributes: `JSONB`, but anything you filter or join on gets a real column.
- Money: `Numeric(12, 2)`, never float.
- Relationships default to `lazy="raise"`; load explicitly with `selectinload`/`joinedload`.
- SQLAlchemy models never leave the repository/service layer. Routers return Pydantic schemas
  (`Schema.model_validate(obj, from_attributes=True)`).
- Multi-user data carries an `owner_id`/`user_id` FK, and every repository query filters by it.

## Index rules

- Index every FK column used in joins or `WHERE` (Postgres doesn't do it automatically).
- Composite index column order: equality columns first, then range/sort (`(user_id, created_at DESC)`).
- Partial indexes for hot subsets (`WHERE deleted_at IS NULL`, `WHERE status = 'active'`).
- Vectors: `HNSW` index with the operator class matching the distance you query with
  (`vector_cosine_ops` ↔ `<=>`). Fix the embedding dimension in the column type.
- Check with `EXPLAIN (ANALYZE, BUFFERS)` on realistic volume before merging a new query path;
  no sequential scans on tables expected past ~10k rows.

## Session and transaction rules

- One `AsyncSession` per request via the `get_session` dependency; never share a session across
  concurrent tasks (`asyncio.gather` with one session is a bug).
- Engine created once in `lifespan` (`pool_pre_ping=True`, sized pool), disposed on shutdown.
- `expire_on_commit=False` on the sessionmaker so objects stay readable after commit.
- Engine sets `connect_args={"options": "-c timezone=UTC"}` so timestamps serialize as UTC.
- Migrations run through psycopg **sync** mode (`migrations/env.py`) — no event loop involved.
- Windows: psycopg async needs a Selector event loop. `uvicorn --reload` uses one; tests set it via
  the `pytest_asyncio_loop_factories` hook in `tests/conftest.py`.
- Unit of work: repositories `flush()` (and `refresh()` to load server defaults); the endpoint or
  service that owns the request's unit of work calls `await session.commit()` exactly once. No
  commits inside repositories, no `session.begin()` blocks mixed with autobegun reads.
- Bulk work: `insert(...).values([...])` / `on_conflict_do_update` (postgresql dialect), not
  per-row ORM adds in a loop.
- Queries: `select()` 2.0 style, `session.scalars(...)`, cursor (keyset) pagination on
  `(created_at, id)`, always a `LIMIT`.
- Never interpolate strings into SQL; `text()` only with bound parameters.

## Migration rules (Alembic)

- Every model change ships with a migration in the same PR:
  `alembic revision --autogenerate -m "add threads table"` → **read and edit** the file.
- Autogenerate misses: renames (shows drop+add — rewrite as `alter_column`/`rename`), server
  defaults changes, extension creation, data backfills, `CONCURRENTLY` indexes.
- Additive and backward-compatible first: new columns nullable or with a server default. Renames
  and type changes use expand → backfill → switch reads → contract, across releases.
- Large-table indexes: `op.create_index(..., postgresql_concurrently=True)` inside
  `with op.get_context().autocommit_block():`.
- Backfills in batches; anything that could run >30s is a separate script/job, not a migration.
- Every migration has a working `downgrade()` or an explicit comment why it can't.
- Enable extensions in a migration: `op.execute("CREATE EXTENSION IF NOT EXISTS vector")`.
- `migrations/env.py` excludes LangGraph checkpoint tables (`checkpoints`, `checkpoint_blobs`,
  `checkpoint_writes`, `checkpoint_migrations`) so autogenerate never drops them.

## Testing rules

- Repository/migration tests hit **real Postgres**, never SQLite (different types, constraints,
  JSONB, vectors).
- Mark them `@pytest.mark.db`; skip when `API_TEST_DATABASE_URL` is unset so `pnpm test` works
  without Docker.
- Each test runs inside a transaction that's rolled back (connection-level `begin()` +
  `join_transaction_mode="create_savepoint"`).
- A migration test runs `alembic upgrade head` then `downgrade base` on an empty DB.

## Self-verification

```bash
cd apps/api
alembic upgrade head && alembic downgrade -1 && alembic upgrade head   # round-trip
alembic check                                                          # models == migrations
pnpm --filter @valt/api typecheck
pnpm --filter @valt/api test        # with API_TEST_DATABASE_URL set for db tests
```

Plus `EXPLAIN (ANALYZE, BUFFERS)` output for new query paths in the report.

## Failure recovery

- **`MissingGreenlet` / "greenlet_spawn has not been called"**: lazy load or attribute refresh
  outside await. Add `selectinload(...)`, keep `expire_on_commit=False`, or `await session.refresh(obj, ["attr"])`.
- **`InvalidRequestError: ... lazy='raise'`**: working as intended — load the relationship
  explicitly in the query.
- **Autogenerate wants to drop checkpoint tables**: `include_name` filter in `env.py` missing.
- **Autogenerate shows spurious constraint changes**: naming convention missing or changed.
- **"too many connections"**: pool size × workers × instances > `max_connections`. Lower the pool,
  add PgBouncer (transaction mode; psycopg `prepare_threshold=None`).
- **Slow query after data growth**: `EXPLAIN (ANALYZE, BUFFERS)`, check `pg_stat_statements`, add
  or reorder the index, `ANALYZE` the table.
- **Migration locks a hot table**: it rewrote the table (type change, NOT NULL without default) —
  split into expand/backfill/contract.
