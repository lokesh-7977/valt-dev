import asyncio
import os
import sys
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fakes import FakeModelClient, FakeRunPage
from httpx import ASGITransport
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from valt_api.main import app
from valt_api.qa_agent.agent import Emit, run_qa
from valt_api.qa_agent.guards import Guards
from valt_api.qa_agent.manager import QAManager
from valt_api.qa_agent.scenarios import Scenario
from valt_api.schemas import QADoneEvent, QARunInfo
from valt_api.services.ai import ComputerUseProvider
from valt_api.services.storage import LocalFileStorage

API_DIR = Path(__file__).resolve().parents[1]
TEST_DB_URL = os.environ.get("API_TEST_DATABASE_URL")


def pytest_asyncio_loop_factories(
    config: pytest.Config, item: pytest.Item
) -> dict[str, Callable[[], asyncio.AbstractEventLoop]]:
    # psycopg async can't run on Windows' default Proactor loop.
    if sys.platform == "win32":
        return {"selector": asyncio.SelectorEventLoop}
    return {"default": asyncio.new_event_loop}


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if TEST_DB_URL:
        return
    skip = pytest.mark.skip(reason="API_TEST_DATABASE_URL not set")
    for item in items:
        if "db" in item.keywords:
            item.add_marker(skip)


async def _client() -> AsyncIterator[httpx.AsyncClient]:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    """App with no database and no AI configured (ASGITransport doesn't run lifespan)."""
    app.state.sessionmaker = None
    app.state.model_client = None
    app.state.storage = LocalFileStorage(tmp_path / "uploads")
    app.state.computer_use = None
    app.state.qa_manager = QAManager(runner=fake_qa_runner, debounce_ms=100)
    async for c in _client():
        yield c
    await app.state.qa_manager.aclose()


async def fake_qa_runner(
    provider: ComputerUseProvider, scenario: Scenario, run: QARunInfo, emit: Emit
) -> QADoneEvent:
    """run_qa against a fake page: no browser needed."""
    return await run_qa(
        scenario=scenario,
        provider=provider,
        run_page=FakeRunPage(delay_s=0.05),
        guards=Guards(["localhost:8001"], max_steps=15),
        run=run,
        emit=emit,
        model="fake",
    )


@pytest.fixture
def fake_model() -> FakeModelClient:
    return FakeModelClient()


@pytest.fixture
async def ai_client(
    client: httpx.AsyncClient, fake_model: FakeModelClient
) -> AsyncIterator[httpx.AsyncClient]:
    """`client` with the Gemini client swapped for a scripted fake."""
    app.state.model_client = fake_model
    try:
        yield client
    finally:
        app.state.model_client = None


@pytest.fixture(scope="session")
def migrated_db_url() -> Iterator[str]:
    """Run migrations down and up once per session — also proves downgrade works."""
    assert TEST_DB_URL
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", TEST_DB_URL.replace("%", "%%"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield TEST_DB_URL


@pytest.fixture
async def db_client(migrated_db_url: str) -> AsyncIterator[httpx.AsyncClient]:
    """App bound to one connection inside a transaction that is rolled back after the test."""
    engine = create_async_engine(
        migrated_db_url, poolclass=NullPool, connect_args={"options": "-c timezone=UTC"}
    )
    async with engine.connect() as conn:
        trans = await conn.begin()
        app.state.sessionmaker = async_sessionmaker(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            async for c in _client():
                yield c
        finally:
            app.state.sessionmaker = None
            await trans.rollback()
    await engine.dispose()
