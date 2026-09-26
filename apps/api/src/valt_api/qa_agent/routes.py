"""Live QA agent endpoints, mounted under /api/v1/qa (ADR 0016).

Starting a run returns at once (202); progress arrives on GET /qa/events (SSE: step, interrupt,
done, error). The editor calls POST /qa/save-hook on every save.
"""

from fastapi import APIRouter, status
from fastapi.responses import StreamingResponse

from valt_api.core.responses import AI_ERROR_RESPONSES, ApiErrorResponse, ApiResponse, ok
from valt_api.core.sse import sse_response
from valt_api.deps import ComputerUseDep, QAManagerDep
from valt_api.qa_agent.scenarios import SCENARIOS
from valt_api.schemas import (
    QARunInfo,
    QARunRequest,
    QASaveHookRequest,
    QASaveHookResponse,
    QAScenario,
    QAStopResponse,
)

router = APIRouter(
    prefix="/qa",
    tags=["qa"],
    responses={
        **AI_ERROR_RESPONSES,
        503: {"model": ApiErrorResponse, "description": "ai_unavailable or qa_unavailable"},
    },
)


@router.get("/scenarios", response_model=ApiResponse[list[QAScenario]])
async def list_scenarios() -> ApiResponse[list[QAScenario]]:
    return ok(
        [
            QAScenario(id=s.id, title=s.title, goal=s.goal, start_url=s.start_url)
            for s in SCENARIOS.values()
        ]
    )


@router.post("/runs", status_code=status.HTTP_202_ACCEPTED, response_model=ApiResponse[QARunInfo])
async def start_run(
    payload: QARunRequest, provider: ComputerUseDep, manager: QAManagerDep
) -> ApiResponse[QARunInfo]:
    """Start a run now. Cancels any run in flight."""
    await manager.preflight()
    return ok(await manager.start(provider, payload.scenario_id, "manual"))


@router.post("/runs/stop", response_model=ApiResponse[QAStopResponse])
async def stop_run(manager: QAManagerDep) -> ApiResponse[QAStopResponse]:
    return ok(await manager.stop())


@router.post(
    "/save-hook",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ApiResponse[QASaveHookResponse],
)
async def save_hook(
    payload: QASaveHookRequest, provider: ComputerUseDep, manager: QAManagerDep
) -> ApiResponse[QASaveHookResponse]:
    """Called on every save. Cancels the in-flight run; a new one starts after the debounce."""
    await manager.preflight()
    manager.schedule_from_save(provider, payload.scenario_id)
    return ok(QASaveHookResponse(scheduled=True, debounce_ms=manager.debounce_ms))


@router.get("/events", response_class=StreamingResponse)
async def events(manager: QAManagerDep) -> StreamingResponse:
    """Long-lived SSE stream of every run: replays the current run, then live events."""
    return sse_response(manager.subscribe())
