from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from valt_api.config import Settings
from valt_api.core.errors import DatabaseUnavailableError


def make_engine(settings: Settings) -> AsyncEngine:
    if not settings.database_url:
        raise ValueError("API_DATABASE_URL is not set")
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
        echo=settings.db_echo,
        # Timestamps leave the API in UTC regardless of the server's timezone.
        connect_args={"options": "-c timezone=UTC"},
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """One session per request. Endpoints that write call `await session.commit()` once."""
    sessionmaker: async_sessionmaker[AsyncSession] | None = getattr(
        request.app.state, "sessionmaker", None
    )
    if sessionmaker is None:
        raise DatabaseUnavailableError("database is not configured (set API_DATABASE_URL)")
    async with sessionmaker() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
