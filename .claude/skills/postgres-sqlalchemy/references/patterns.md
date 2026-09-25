# Postgres + SQLAlchemy Patterns (VALT)

## Settings

```python
# valt_api/config.py (additions)
database_url: str | None = None          # postgresql+psycopg://valt:valt@localhost:5432/valt
db_pool_size: int = 5
db_max_overflow: int = 10
```

LangGraph's `AsyncPostgresSaver.from_conn_string` wants a plain libpq URL. Derive it:
`settings.database_url.replace("postgresql+psycopg://", "postgresql://", 1)`.

> The live implementation is in `apps/api/src/valt_api/db/` (Phase 1). Prefer copying from there.

## Base with naming convention

```python
# valt_api/db/base.py
from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

## Engine, sessionmaker, dependency

```python
# valt_api/db/session.py
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from valt_api.config import Settings


def make_engine(settings: Settings) -> AsyncEngine:
    assert settings.database_url
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    sessionmaker: async_sessionmaker[AsyncSession] = request.app.state.sessionmaker
    async with sessionmaker() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
```

```python
# valt_api/main.py — lifespan (DB part)
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    engine = make_engine(settings)
    app.state.sessionmaker = make_sessionmaker(engine)
    try:
        yield  # (checkpointer setup from ADR 0005 nests here too)
    finally:
        await engine.dispose()
```

## Models

```python
# valt_api/db/models/items.py
from sqlalchemy import BigInteger, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from valt_api.db.base import Base, TimestampMixin


class ItemRow(TimestampMixin, Base):
    __tablename__ = "items"
    __table_args__ = (UniqueConstraint("owner_id", "name"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # identity
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    owner: Mapped["UserRow"] = relationship(back_populates="items", lazy="raise")
```

Suffix ORM classes with `Row` so they're never confused with the Pydantic `Item` in `schemas.py`.

### Vector column (pgvector)

```python
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import Index, text

EMBED_DIM = 1536  # must match the embedding model in settings


class ChunkRow(TimestampMixin, Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        Index(
            "ix_document_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBED_DIM), nullable=False)
```

```python
# nearest neighbours, scoped to the user
stmt = (
    select(ChunkRow)
    .join(DocumentRow)
    .where(DocumentRow.owner_id == user_id)
    .order_by(ChunkRow.embedding.cosine_distance(query_vec))
    .limit(k)
)
```

## Repository functions

```python
# valt_api/db/repositories/items.py
from datetime import datetime

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from valt_api.db.models.items import ItemRow


async def list_items(
    session: AsyncSession, owner_id: int, *, after: tuple[datetime, int] | None, limit: int
) -> list[ItemRow]:
    stmt = select(ItemRow).where(ItemRow.owner_id == owner_id)
    if after:
        stmt = stmt.where(tuple_(ItemRow.created_at, ItemRow.id) < after)
    stmt = stmt.order_by(ItemRow.created_at.desc(), ItemRow.id.desc()).limit(limit)
    return list(await session.scalars(stmt))


async def create_item(session: AsyncSession, owner_id: int, name: str, description: str | None) -> ItemRow:
    row = ItemRow(owner_id=owner_id, name=name, description=description)
    session.add(row)
    await session.flush()
    await session.refresh(row)  # load server defaults (id, timestamps)
    return row  # the endpoint commits
```

Index to match: `Index("ix_items_owner_created", "owner_id", ItemRow.created_at.desc(), "id")`.

Router side:

```python
@router.post("", response_model=Item, status_code=201)
async def create(payload: ItemCreate, session: SessionDep, user: CurrentUser) -> Item:
    try:
        row = await items_repo.create_item(session, user.id, payload.name, payload.description)
        await session.commit()
    except IntegrityError:
        raise HTTPException(409, detail="an item with that name already exists") from None
    return Item.model_validate(row, from_attributes=True)
```

## Upsert

```python
from sqlalchemy.dialects.postgresql import insert

stmt = insert(ItemRow).values(rows).on_conflict_do_update(
    index_elements=[ItemRow.owner_id, ItemRow.name],
    set_={"description": insert(ItemRow).excluded.description},
)
await session.execute(stmt)
await session.commit()
```

## Alembic (async)

```bash
cd apps/api
alembic init -t async migrations
```

`alembic.ini`: leave `sqlalchemy.url` empty; `env.py` reads settings.

```python
# migrations/env.py (key parts)
from valt_api.config import get_settings
from valt_api.db.base import Base
import valt_api.db.models  # noqa: F401  — import all models so metadata is complete

config.set_main_option("sqlalchemy.url", get_settings().database_url or "")
target_metadata = Base.metadata

LANGGRAPH_TABLES = {"checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"}


def include_name(name, type_, parent_names):
    if type_ == "table":
        return name not in LANGGRAPH_TABLES
    return True


def do_run_migrations(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_name=include_name,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()
```

`valt_api/db/models/__init__.py` imports every model module.

### Concurrent index in a migration

```python
def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_items_owner_created", "items", ["owner_id", sa.text("created_at DESC"), "id"],
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index("ix_items_owner_created", table_name="items", postgresql_concurrently=True)
```

## docker-compose service (devops-engineer applies)

```yaml
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: valt
      POSTGRES_PASSWORD: valt   # dev only
      POSTGRES_DB: valt
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U valt -d valt"]
      interval: 5s
      retries: 10

volumes:
  pgdata:
```

`api` gets `API_DATABASE_URL: postgresql+psycopg://valt:valt@postgres:5432/valt` and
`depends_on: { postgres: { condition: service_healthy } }`.

## Tests against real Postgres

```python
# tests/conftest.py
import os

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

TEST_DB_URL = os.getenv("API_TEST_DATABASE_URL")


def pytest_collection_modifyitems(config, items):
    if TEST_DB_URL:
        return
    skip = pytest.mark.skip(reason="API_TEST_DATABASE_URL not set")
    for item in items:
        if "db" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
async def db_session():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.connect() as conn:
        trans = await conn.begin()
        session = AsyncSession(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()
    await engine.dispose()
```

Register the marker in `pyproject.toml`: `markers = ["db: needs a real Postgres"]`.
Run migrations once against the test DB before the suite (`alembic upgrade head`).
