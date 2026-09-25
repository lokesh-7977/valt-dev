import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from valt_api import __version__
from valt_api.config import get_settings
from valt_api.core.errors import install_error_handling
from valt_api.db.session import make_engine, make_sessionmaker
from valt_api.routers import health, items

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    engine = None
    if settings.database_url:
        engine = make_engine(settings)
        app.state.sessionmaker = make_sessionmaker(engine)
    else:
        logger.warning("API_DATABASE_URL not set — database endpoints will return 503")
    try:
        yield
    finally:
        if engine is not None:
            await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="VALT API",
        version=__version__,
        docs_url="/docs",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    install_error_handling(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    app.include_router(health.router, prefix="/api")
    app.include_router(items.router, prefix="/api")

    return app


app = create_app()
