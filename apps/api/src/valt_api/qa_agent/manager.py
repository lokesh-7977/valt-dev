"""One QA run at a time, save-triggered debounce, and SSE fan-out.

- start():   cancels any in-flight run, then starts a new one as a background task.
- schedule_from_save(): cancels the in-flight run at once (its result is stale), then starts a
  new run once saves have been quiet for `debounce_ms`. A burst of saves -> one run.
- subscribe(): one long-lived SSE stream covering every run, so the panel subscribes once and
  save-triggered runs just appear. New subscribers get the current/last run replayed first.

State is in memory on app.state (single process, local dev). Screenshots are never written to disk.
"""

import asyncio
import contextlib
import logging
import uuid
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime

from pydantic import BaseModel

from valt_api.config import Settings
from valt_api.core.responses import ErrorDetail
from valt_api.core.sse import sse_event
from valt_api.qa_agent.agent import Emit, run_qa
from valt_api.qa_agent.browser import BrowserSession
from valt_api.qa_agent.guards import Guards
from valt_api.qa_agent.scenarios import DEFAULT_SCENARIO_ID, Scenario, get_scenario
from valt_api.schemas import QADoneEvent, QARunInfo, QAStopResponse, QATrigger
from valt_api.services.ai.types import ComputerUseProvider

logger = logging.getLogger(__name__)

REPLAY_EVENTS = 40
QUEUE_SIZE = 100
PING_S = 15.0

Runner = Callable[[ComputerUseProvider, Scenario, QARunInfo, Emit], Awaitable[QADoneEvent]]


def browser_runner(browser: BrowserSession, guards: Guards, settings: Settings) -> Runner:
    """The production runner: a fresh browser context per run, driven by run_qa."""

    async def run(
        provider: ComputerUseProvider, scenario: Scenario, info: QARunInfo, emit: Emit
    ) -> QADoneEvent:
        page = await browser.new_run(guards.host_allowed)
        try:
            return await run_qa(
                scenario=scenario,
                provider=provider,
                run_page=page,
                guards=guards,
                run=info,
                emit=emit,
                model=settings.qa_model,
                keep_screenshots=settings.qa_keep_screenshots,
                run_timeout_s=settings.qa_run_timeout_s,
            )
        finally:
            await page.close()

    return run


async def _no_preflight() -> None:
    return None


class QAManager:
    def __init__(
        self,
        *,
        runner: Runner,
        debounce_ms: int,
        preflight: Callable[[], Awaitable[None]] = _no_preflight,
    ) -> None:
        self._runner = runner
        self.debounce_ms = debounce_ms
        # Raises QAUnavailableError when the browser can't start (-> 503 before a run is created).
        self.preflight = preflight
        self._task: asyncio.Task[None] | None = None
        self._current: QARunInfo | None = None
        self._debounce: asyncio.Task[None] | None = None
        self._subs: set[asyncio.Queue[str]] = set()
        self._replay: deque[str] = deque(maxlen=REPLAY_EVENTS)

    @property
    def current(self) -> QARunInfo | None:
        return self._current

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    # ---- events ----

    def emit(self, event: str, data: BaseModel) -> None:
        frame = sse_event(event, data.model_dump(mode="json"))
        self._replay.append(frame)
        for q in self._subs:
            if q.full():  # slow subscriber: drop its oldest event rather than block the run
                q.get_nowait()
            q.put_nowait(frame)

    async def subscribe(self) -> AsyncIterator[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_SIZE)
        for frame in self._replay:
            q.put_nowait(frame)
        self._subs.add(q)
        try:
            yield ": connected\n\n"
            while True:
                try:
                    yield await asyncio.wait_for(q.get(), timeout=PING_S)
                except TimeoutError:
                    yield ": ping\n\n"
        finally:
            self._subs.discard(q)

    # ---- runs ----

    async def start(
        self, provider: ComputerUseProvider, scenario_id: str, trigger: QATrigger
    ) -> QARunInfo:
        scenario = get_scenario(scenario_id)
        await self._cancel_run()
        run = QARunInfo(
            run_id=uuid.uuid4().hex[:12],
            scenario_id=scenario.id,
            trigger=trigger,
            status="running",
            started_at=datetime.now(UTC),
        )
        self._current = run
        self._replay.clear()  # late subscribers replay only this run
        self._task = asyncio.create_task(self._run(provider, scenario, run))
        logger.info("qa run %s started (%s, %s)", run.run_id, scenario.id, trigger)
        return run

    async def _run(self, provider: ComputerUseProvider, scenario: Scenario, run: QARunInfo) -> None:
        try:
            await self._runner(provider, scenario, run, self.emit)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # e.g. the browser died mid-run
            logger.exception("qa run %s crashed", run.run_id)
            code = getattr(exc, "code", "internal_error")
            message = getattr(exc, "message", "the QA run failed")
            self.emit("error", ErrorDetail(code=code, message=message))
            run.status = "error"
            self.emit(
                "done",
                QADoneEvent(
                    run=run.model_copy(),
                    verdict="inconclusive",
                    summary=message,
                    findings=[],
                    steps=0,
                    duration_ms=0,
                ),
            )

    async def _cancel_run(self) -> bool:
        task = self._task
        if task is None or task.done():
            return False
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        return True

    async def stop(self) -> QAStopResponse:
        self._cancel_debounce()
        stopped = await self._cancel_run()
        run_id = self._current.run_id if stopped and self._current else None
        return QAStopResponse(stopped=stopped, run_id=run_id)

    def _cancel_debounce(self) -> None:
        if self._debounce is not None and not self._debounce.done():
            self._debounce.cancel()
        self._debounce = None

    def schedule_from_save(self, provider: ComputerUseProvider, scenario_id: str | None) -> None:
        scenario_id = scenario_id or (
            self._current.scenario_id if self._current else DEFAULT_SCENARIO_ID
        )
        get_scenario(scenario_id)  # 404 now, not after the debounce
        self._cancel_debounce()
        if self._task is not None and not self._task.done():
            self._task.cancel()  # the code changed: this run's result is stale

        async def later() -> None:
            await asyncio.sleep(self.debounce_ms / 1000)
            await self.start(provider, scenario_id, "save")

        self._debounce = asyncio.create_task(later())

    async def aclose(self) -> None:
        self._cancel_debounce()
        await self._cancel_run()
