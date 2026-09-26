import http.server
import os
import threading
from typing import Any

import pytest

from valt_api.qa_agent.executor import denorm, execute, normalize_keys
from valt_api.services.ai.types import ActionCall

W, H = 1440, 900


class Recorder:
    def __init__(self, calls: list[tuple[Any, ...]], prefix: str) -> None:
        self._calls = calls
        self._prefix = prefix

    def __getattr__(self, name: str) -> Any:
        async def method(*args: Any) -> None:
            self._calls.append((f"{self._prefix}{name}", *args))

        return method


class FakePage:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self.mouse = Recorder(self.calls, "mouse.")
        self.keyboard = Recorder(self.calls, "keyboard.")

    async def goto(self, url: str) -> None:
        self.calls.append(("goto", url))

    async def go_back(self) -> None:
        self.calls.append(("go_back",))

    async def wait_for_timeout(self, timeout: float) -> None:
        self.calls.append(("wait", timeout))


async def run(name: str, **args: Any) -> tuple[dict[str, Any], list[tuple[Any, ...]]]:
    page = FakePage()
    result = await execute(page, ActionCall(id="1", name=name, args=args), W, H)
    return result, page.calls


@pytest.mark.parametrize(
    ("v", "size", "px"),
    [(0, W, 0), (500, W, 720), (999, W, 1438), (1000, W, 1439), (1200, H, 899), (-5, H, 0)],
)
def test_denorm(v: int, size: int, px: int) -> None:
    assert denorm(v, size) == px


@pytest.mark.parametrize("name", ["click", "click_at"])
async def test_click(name: str) -> None:
    result, calls = await run(name, x=500, y=500)
    assert result == {}
    assert calls == [("mouse.click", 720, 450)]


async def test_double_click() -> None:
    _, calls = await run("double_click", x=0, y=1000)
    assert calls == [("mouse.dblclick", 0, 899)]


async def test_type_3x_clears_and_does_not_press_enter() -> None:
    _, calls = await run("type", x=100, y=200, text="hi")
    assert calls == [
        ("mouse.click", 144, 180),
        ("keyboard.press", "ControlOrMeta+A"),
        ("keyboard.press", "Delete"),
        ("keyboard.type", "hi"),
    ]


async def test_type_text_at_legacy_presses_enter_by_default() -> None:
    _, calls = await run("type_text_at", x=100, y=200, text="hi", clear_before_typing=False)
    assert calls == [
        ("mouse.click", 144, 180),
        ("keyboard.type", "hi"),
        ("keyboard.press", "Enter"),
    ]


async def test_type_without_coordinates_types_into_focus() -> None:
    _, calls = await run("type", text="", press_enter=True, clear_before_typing=False)
    assert calls == [("keyboard.type", ""), ("keyboard.press", "Enter")]


@pytest.mark.parametrize("name", ["navigate", "open_web_browser_at"])
async def test_navigate(name: str) -> None:
    _, calls = await run(name, url="http://localhost:8001/")
    assert calls == [("goto", "http://localhost:8001/")]


@pytest.mark.parametrize("name", ["scroll", "scroll_document"])
async def test_scroll(name: str) -> None:
    _, calls = await run(name, direction="down")
    assert calls == [("mouse.wheel", 0, 600)]


async def test_scroll_at_moves_first() -> None:
    _, calls = await run("scroll_at", x=500, y=500, direction="up", magnitude=500)
    assert calls == [("mouse.move", 720, 450), ("mouse.wheel", 0, -450)]


@pytest.mark.parametrize(
    ("name", "args", "key"),
    [
        ("press_key", {"key": "enter"}, "Enter"),
        ("hotkey", {"keys": ["control", "a"]}, "Control+a"),
        ("key_combination", {"keys": "control+shift+t"}, "Control+Shift+t"),
    ],
)
async def test_keys(name: str, args: dict[str, Any], key: str) -> None:
    _, calls = await run(name, **args)
    assert calls == [("keyboard.press", key)]


async def test_wait_is_capped() -> None:
    _, calls = await run("wait", seconds=60)
    assert calls == [("wait", 5000)]
    _, calls = await run("wait_5_seconds")
    assert calls == [("wait", 5000)]


async def test_go_back() -> None:
    _, calls = await run("go_back")
    assert calls == [("go_back",)]


async def test_unknown_action() -> None:
    result, calls = await run("drag_and_drop", x=1, y=1)
    assert result == {"error": "unsupported_action"}
    assert calls == []


async def test_bad_arguments_do_not_raise() -> None:
    result, _ = await run("click")
    assert result["error"].startswith("invalid_arguments")


def test_normalize_keys() -> None:
    assert normalize_keys("ctrl + c") == "Control+c"


# ---- real browser (opt-in) ----


@pytest.mark.browser
@pytest.mark.skipif(os.environ.get("QA_BROWSER_TESTS") != "1", reason="set QA_BROWSER_TESTS=1")
async def test_browser_session_under_selector_loop() -> None:
    """Chromium starts from the test's (Selector, on Windows) loop, screenshots an allowlisted
    page, and aborts a request to a non-allowlisted host."""
    from valt_api.qa_agent.browser import BrowserSession
    from valt_api.qa_agent.guards import Guards

    page_html = b"<html><body><h1>ok</h1><img src='http://127.0.0.1:8002/x.png'></body></html>"

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(page_html)

        def log_message(self, *args: Any) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8001), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    session = BrowserSession(headless=True, width=800, height=600)
    try:
        guards = Guards(["127.0.0.1:8001"], max_steps=5)
        run_page = await session.new_run(guards.host_allowed)
        await run_page.goto("http://127.0.0.1:8001/")
        url, png = await run_page.snapshot()
        assert url == "http://127.0.0.1:8001/"
        assert png.startswith(b"\x89PNG")
        assert run_page.blocked_requests >= 1
        await run_page.close()
    finally:
        await session.aclose()
        server.shutdown()
