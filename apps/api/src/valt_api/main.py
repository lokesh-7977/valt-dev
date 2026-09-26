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
from valt_api.qa_agent import routes as qa_routes
from valt_api.qa_agent.browser import BrowserSession
from valt_api.qa_agent.guards import Guards
from valt_api.qa_agent.manager import QAManager, browser_runner
from valt_api.routers import ai, files, health, items
from valt_api.services.ai import ComputerUseProvider, ModelClient
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
    computer_use: ComputerUseProvider | None = None
    if settings.gemini_api_key:
        gemini = GeminiClient(
            settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_model,
            timeout_s=settings.gemini_timeout_s,
            max_retries=settings.gemini_max_retries,
        )
        model_client = computer_use = gemini
        logger.info("Gemini ready (model=%s)", settings.gemini_model)
    else:
        logger.warning("GEMINI_API_KEY not set — AI endpoints will return 503")
    app.state.model_client = model_client
    app.state.computer_use = computer_use
    app.state.storage = LocalFileStorage(settings.upload_dir)

    # Live QA agent (ADR 0016). Chromium starts lazily on the first run.
    browser = BrowserSession(
        headless=settings.qa_headless,
        width=settings.qa_screen_width,
        height=settings.qa_screen_height,
    )
    guards = Guards(
        settings.qa_allowed_hosts,
        settings.qa_max_steps,
        # Never let the agent type our own key into a page.
        [settings.gemini_api_key.get_secret_value()] if settings.gemini_api_key else [],
    )
    qa_manager = QAManager(
        runner=browser_runner(browser, guards, settings),
        debounce_ms=settings.qa_debounce_ms,
        preflight=browser.ensure_started,
    )
    app.state.qa_manager = qa_manager

    try:
        yield
    finally:
        await qa_manager.aclose()
        await browser.aclose()
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
    v1.include_router(qa_routes.router)
    app.include_router(v1)

    # Unversioned liveness for infra probes / smoke tests (infra/gcp/deploy.sh).
    app.include_router(health.router, prefix="/api", include_in_schema=False)

    return app


app = create_app()
