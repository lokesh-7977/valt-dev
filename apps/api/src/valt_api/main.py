import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from valt_api import __version__
from valt_api.config import get_settings
from valt_api.core.errors import install_error_handling
from valt_api.core.logging import configure_logging
from valt_api.db.session import make_engine, make_sessionmaker
from valt_api.routers import ai, files, health, items
from valt_api.services.ai import ModelClient
from valt_api.services.gemini import GeminiClient
from valt_api.services.storage import LocalFileStorage

logger = logging.getLogger(__name__)

API_V1_PREFIX = "/api/v1"

DESCRIPTION = """
Generic multimodal AI backend (Gemini). Typical flow:

1. `POST /api/v1/upload` each image / audio / PDF → `file_id`
2. `POST /api/v1/analyze` (structured JSON), `/process` (named task), or `/generate[/stream]`
   with `text` and/or `file_ids`

Every JSON response uses the envelope `{success, data, meta}` / `{success: false, error}`.
Streams are SSE (`token`, `done`, `error`).
"""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()

    engine = None
    if settings.database_url:
        engine = make_engine(settings)
        app.state.sessionmaker = make_sessionmaker(engine)
    else:
        logger.warning("API_DATABASE_URL not set — database endpoints will return 503")

    model_client: ModelClient | None = None
    if settings.gemini_api_key:
        model_client = GeminiClient(
            settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_model,
            timeout_s=settings.gemini_timeout_s,
            max_retries=settings.gemini_max_retries,
        )
        logger.info("Gemini ready (model=%s)", settings.gemini_model)
    else:
        logger.warning("GEMINI_API_KEY not set — AI endpoints will return 503")
    app.state.model_client = model_client
    app.state.storage = LocalFileStorage(settings.upload_dir)

    try:
        yield
    finally:
        if model_client is not None:
            await model_client.aclose()
        if engine is not None:
            await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)

    app = FastAPI(
        title="VALT API",
        version=__version__,
        description=DESCRIPTION,
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

    v1 = APIRouter(prefix=API_V1_PREFIX)
    v1.include_router(health.router)
    v1.include_router(files.router)
    v1.include_router(ai.router)
    v1.include_router(items.router)
    app.include_router(v1)

    # Unversioned liveness for infra probes / smoke tests (infra/gcp/deploy.sh).
    app.include_router(health.router, prefix="/api", include_in_schema=False)

    return app


app = create_app()
