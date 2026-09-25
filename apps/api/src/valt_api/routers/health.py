from fastapi import APIRouter, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from valt_api import __version__
from valt_api.core.errors import DatabaseUnavailableError
from valt_api.core.responses import ERROR_RESPONSES, ApiResponse, ok
from valt_api.db.session import SessionDep
from valt_api.deps import SettingsDep
from valt_api.schemas import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=ApiResponse[HealthResponse])
async def health(settings: SettingsDep, request: Request) -> ApiResponse[HealthResponse]:
    """Liveness: the process is up. Never calls dependencies; `ai` reports configuration only."""
    ai_ready = getattr(request.app.state, "model_client", None) is not None
    return ok(
        HealthResponse(
            service=settings.service_name,
            version=__version__,
            ai="configured" if ai_ready else "not_configured",
        )
    )


@router.get(
    "/health/ready", response_model=ApiResponse[ReadinessResponse], responses=ERROR_RESPONSES
)
async def ready(session: SessionDep) -> ApiResponse[ReadinessResponse]:
    """Readiness: dependencies (Postgres) are reachable."""
    try:
        await session.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError) as exc:
        raise DatabaseUnavailableError() from exc
    return ok(ReadinessResponse())
