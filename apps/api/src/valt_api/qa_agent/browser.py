"""Playwright on its own thread with its own event loop (ADR 0015).

On Windows, `uvicorn --reload` runs a SelectorEventLoop, which cannot spawn Playwright's driver
subprocess. So Chromium lives on a daemon thread that owns a ProactorEventLoop (a plain new loop
elsewhere), and the API loop awaits it through run_coroutine_threadsafe + wrap_future.
Cancelling the awaiting API task cancels the thread-side coroutine too.

Isolation per run: a fresh BrowserContext (no cookies/storage carried over), downloads off, and a
network route that aborts every request to a host outside the allowlist.
"""

import asyncio
import contextlib
import importlib.util
import logging
import sys
import threading
from collections.abc import Callable, Coroutine
from typing import TYPE_CHECKING, Any, TypeVar

from valt_api.core.errors import QAUnavailableError
from valt_api.qa_agent.executor import execute
from valt_api.services.ai.types import ActionCall

if TYPE_CHECKING:
    from playwright.async_api import Browser, BrowserContext, Page, Playwright, Route

logger = logging.getLogger(__name__)

T = TypeVar("T")

SETTLE_MS = 300
LOAD_TIMEOUT_MS = 3000
NAV_TIMEOUT_MS = 10_000


class BrowserSession:
    """One warm Chromium shared by runs; each run gets its own context."""

    def __init__(self, *, headless: bool, width: int, height: int) -> None:
        self.headless = headless
        self.width = width
        self.height = height
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._pw: Playwright | None = None
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()

    async def _call(self, coro: Coroutine[Any, Any, T]) -> T:
        assert self._loop is not None
        return await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(coro, self._loop))

    def _start_thread(self) -> None:
        loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()

        def run() -> None:
            asyncio.set_event_loop(loop)
            try:
                loop.run_forever()
            finally:
                loop.close()

        self._loop = loop
        self._thread = threading.Thread(target=run, name="qa-browser", daemon=True)
        self._thread.start()

    async def ensure_started(self) -> None:
        async with self._lock:
            if self._browser is not None and self._browser.is_connected():
                return
            if importlib.util.find_spec("playwright") is None:
                raise QAUnavailableError("QA agent needs the `qa` extra (Playwright) installed")
            if self._loop is None:
                self._start_thread()
            try:
                await self._call(self._launch())
            except Exception as exc:
                logger.warning("chromium launch failed: %s", exc)
                raise QAUnavailableError(
                    "QA browser failed to start (run `python -m playwright install chromium`)"
                ) from exc
            logger.info("qa browser ready (headless=%s)", self.headless)

    async def _launch(self) -> None:
        from playwright.async_api import async_playwright

        if self._pw is None:
            self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(headless=self.headless)

    async def new_run(self, host_allowed: Callable[[str], bool]) -> "RunPage":
        await self.ensure_started()
        return await self._call(self._new_run(host_allowed))

    async def _new_run(self, host_allowed: Callable[[str], bool]) -> "RunPage":
        assert self._browser is not None
        context = await self._browser.new_context(
            viewport={"width": self.width, "height": self.height},
            accept_downloads=False,
            service_workers="block",
        )
        run = RunPage(self, context)

        async def guard(route: "Route") -> None:
            url = route.request.url
            if url.startswith(("data:", "about:", "blob:")) or host_allowed(url):
                await route.continue_()
            else:
                run.blocked_requests += 1
                logger.info("qa blocked request to non-allowlisted host")
                await route.abort("blockedbyclient")

        await context.route("**/*", guard)
        run.page = await context.new_page()
        run.page.set_default_navigation_timeout(NAV_TIMEOUT_MS)
        return run

    async def aclose(self) -> None:
        if self._loop is None:
            return
        try:
            await asyncio.wait_for(self._call(self._shutdown()), timeout=5)
        except Exception:
            logger.warning("qa browser did not close cleanly")
        self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread is not None:
            await asyncio.to_thread(self._thread.join, 5)
        self._loop = None
        self._thread = None

    async def _shutdown(self) -> None:
        if self._browser is not None:
            await self._browser.close()
            self._browser = None
        if self._pw is not None:
            await self._pw.stop()
            self._pw = None


class RunPage:
    """One run's page. Every method hops onto the browser thread."""

    def __init__(self, session: BrowserSession, context: "BrowserContext") -> None:
        self._session = session
        self._context = context
        self.page: Page | None = None
        self.blocked_requests = 0

    @property
    def _page(self) -> "Page":
        assert self.page is not None
        return self.page

    async def goto(self, url: str) -> None:
        async def go() -> None:
            await self._page.goto(url)
            await self._page.wait_for_timeout(SETTLE_MS)

        await self._session._call(go())

    async def snapshot(self) -> tuple[str, bytes]:
        """(current URL, PNG screenshot of the viewport)."""

        async def shot() -> tuple[str, bytes]:
            return self._page.url, await self._page.screenshot(type="png")

        return await self._session._call(shot())

    async def execute(self, call: ActionCall) -> dict[str, Any]:
        async def run() -> dict[str, Any]:
            page = self._page
            result = await execute(page, call, self._session.width, self._session.height)
            # A slow page is fine: the next screenshot shows whatever state it is in.
            with contextlib.suppress(Exception):
                await page.wait_for_load_state("load", timeout=LOAD_TIMEOUT_MS)
            await page.wait_for_timeout(SETTLE_MS)
            return result

        return await self._session._call(run())

    async def close(self) -> None:
        try:
            await self._session._call(self._context.close())
        except Exception:
            logger.warning("qa context did not close cleanly")
