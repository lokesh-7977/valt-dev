# FastAPI Patterns (VALT)

Patterns match the existing code in `apps/api/src/valt_api/`. Python 3.11+, Pydantic v2, mypy strict.

## Settings with secrets

```python
# valt_api/config.py
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a local .env file."""

    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    env: str = "development"
    cors_origins: list[str] = ["http://localhost:3000"]
    service_name: str = "valt-api"

    # LLM (ADR 0004) — API_LLM_PROVIDER, API_LLM_MODEL, API_LLM_API_KEY
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: SecretStr | None = None
    llm_temperature: float = 0.2
    llm_max_tokens: int = 2048
    llm_timeout_s: float = 60.0

    # Postgres for LangGraph checkpoints (ADR 0005). None → in-memory checkpointer.
    database_url: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

Add every new variable to `apps/api/.env.example` with a safe placeholder.

## Router with dependencies

```python
# valt_api/routers/threads.py
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from langgraph.graph.state import CompiledStateGraph

from valt_api.schemas import ThreadSummary

router = APIRouter(prefix="/threads", tags=["threads"])


def get_chat_graph(request: Request) -> CompiledStateGraph:
    graph: CompiledStateGraph = request.app.state.chat_graph
    return graph


ChatGraphDep = Annotated[CompiledStateGraph, Depends(get_chat_graph)]


@router.get("/{thread_id}", response_model=ThreadSummary)
async def get_thread(thread_id: str, graph: ChatGraphDep) -> ThreadSummary:
    snapshot = await graph.aget_state({"configurable": {"thread_id": thread_id}})
    if not snapshot.values:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="thread not found")
    return ThreadSummary.from_state(thread_id, snapshot.values)
```

Register in `main.py`: `app.include_router(threads.router, prefix="/api")`.

## Cursor pagination

```python
@router.get("", response_model=Page[ThreadSummary])
async def list_threads(
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Page[ThreadSummary]:
    rows = await repo.list_after(cursor, limit + 1)  # fetch one extra to know if there's more
    return Page(items=rows[:limit], next_cursor=rows[limit - 1].id if len(rows) > limit else None)
```

```python
# schemas.py
from typing import Generic, TypeVar

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None
```

## Lifespan: open shared resources once

```python
# valt_api/main.py
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from langgraph.checkpoint.memory import InMemorySaver

from valt_api.ai.graphs.chat import build_graph
from valt_api.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.database_url:
        # pip install langgraph-checkpoint-postgres "psycopg[binary,pool]"
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        async with AsyncPostgresSaver.from_conn_string(settings.database_url) as saver:
            await saver.setup()  # idempotent; creates checkpoint tables
            app.state.chat_graph = build_graph(saver)
            yield
    else:
        app.state.chat_graph = build_graph(InMemorySaver())
        yield
```

## Offloading sync work

```python
from starlette.concurrency import run_in_threadpool

text = await run_in_threadpool(extract_pdf_text, upload_bytes)  # CPU/sync work off the loop
```

## Errors

```python
import logging

logger = logging.getLogger(__name__)

try:
    result = await summarize(doc)
except ProviderError:
    logger.exception("summarize failed", extra={"doc_id": doc.id})
    raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="summarizer unavailable") from None
```

`from None` keeps the provider's message (which may echo prompt content) out of the chained
traceback that error reporters capture.

## Tests (match `tests/test_health.py`)

```python
import httpx
import pytest
from httpx import ASGITransport
from langgraph.checkpoint.memory import InMemorySaver

from valt_api.ai.graphs.chat import build_graph
from valt_api.main import app
from tests.fakes import fake_model  # see ai-patterns.md


@pytest.fixture
async def client():
    # ASGITransport does not run lifespan — wire app.state by hand.
    app.state.chat_graph = build_graph(InMemorySaver(), model=fake_model("hello"))
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_unknown_thread_404(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/threads/nope")
    assert res.status_code == 404


async def test_invalid_body_422(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/chat/runs", json={})
    assert res.status_code == 422
```
