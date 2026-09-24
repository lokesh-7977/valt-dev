from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from valt_api import __version__
from valt_api.config import get_settings
from valt_api.routers import health, items


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup: open DB pools, caches, etc.
    yield
    # Shutdown: close them again.


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="VALT API",
        version=__version__,
        docs_url="/docs",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api")
    app.include_router(items.router, prefix="/api")

    return app


app = create_app()
