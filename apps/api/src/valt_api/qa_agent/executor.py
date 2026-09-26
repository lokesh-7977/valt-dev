"""Translate Computer Use actions into Playwright calls.

Accepts the Gemini 3.x action names (click, type, navigate, ...) and the 2.5 legacy aliases
(click_at, type_text_at, ...). The model's coordinates are normalised to a 0-1000 grid (some docs
say 0-999); `denorm` is correct for either and clamps to the viewport.

Returns the dict sent back to the model as the function result: {} on success, {"error": ...}
otherwise. Never raises for a bad action, so one odd call cannot crash a run.
"""

import logging
from typing import Any, Protocol

from valt_api.services.ai.types import ActionCall

logger = logging.getLogger(__name__)

SCROLL_PX = 600
MAX_WAIT_MS = 5000

_KEY_NAMES = {
    "control": "Control",
    "ctrl": "Control",
    "shift": "Shift",
    "alt": "Alt",
    "meta": "Meta",
    "cmd": "Meta",
    "command": "Meta",
    "enter": "Enter",
    "return": "Enter",
    "tab": "Tab",
    "escape": "Escape",
    "esc": "Escape",
    "backspace": "Backspace",
    "delete": "Delete",
    "space": "Space",
    "pageup": "PageUp",
    "pagedown": "PageDown",
    "arrowup": "ArrowUp",
    "arrowdown": "ArrowDown",
    "arrowleft": "ArrowLeft",
    "arrowright": "ArrowRight",
    "home": "Home",
    "end": "End",
}


class MouseLike(Protocol):
    async def click(self, x: float, y: float) -> None: ...
    async def dblclick(self, x: float, y: float) -> None: ...
    async def move(self, x: float, y: float) -> None: ...
    async def wheel(self, delta_x: float, delta_y: float) -> None: ...


class KeyboardLike(Protocol):
    async def type(self, text: str) -> None: ...
    async def press(self, key: str) -> None: ...


class PageLike(Protocol):
    """The subset of playwright.async_api.Page the executor uses."""

    @property
    def mouse(self) -> MouseLike: ...
    @property
    def keyboard(self) -> KeyboardLike: ...
    async def goto(self, url: str) -> Any: ...
    async def go_back(self) -> Any: ...
    async def wait_for_timeout(self, timeout: float) -> None: ...


def denorm(value: Any, size: int) -> int:
    """0-1000 grid -> pixels, clamped to [0, size - 1]."""
    return max(0, min(int(float(value) / 1000 * size), size - 1))


def normalize_keys(keys: Any) -> str:
    """'control+a' / ['Control', 'a'] -> 'Control+a' (Playwright key syntax)."""
    items = keys if isinstance(keys, list) else str(keys).replace(" ", "").split("+")
    return "+".join(_KEY_NAMES.get(str(k).lower(), str(k)) for k in items if str(k))


async def execute(page: PageLike, call: ActionCall, width: int, height: int) -> dict[str, Any]:
    try:
        return await _dispatch(page, call, width, height)
    except (KeyError, TypeError, ValueError) as exc:
        return {"error": f"invalid_arguments: {type(exc).__name__}"}
    except Exception as exc:  # Playwright errors (timeouts, detached frames, ...)
        logger.info("qa action %s failed: %s", call.name, type(exc).__name__)
        return {"error": f"action_failed: {type(exc).__name__}"}


async def _dispatch(page: PageLike, call: ActionCall, w: int, h: int) -> dict[str, Any]:
    a = call.args
    name = call.name

    def xy() -> tuple[int, int]:
        return denorm(a["x"], w), denorm(a["y"], h)

    if name in ("click", "click_at"):
        await page.mouse.click(*xy())
    elif name in ("double_click", "double_click_at"):
        await page.mouse.dblclick(*xy())
    elif name in ("hover", "hover_at", "move"):
        await page.mouse.move(*xy())
    elif name in ("type", "type_text_at"):
        if "x" in a and "y" in a:
            await page.mouse.click(*xy())
        if a.get("clear_before_typing", True) is not False:
            await page.keyboard.press("ControlOrMeta+A")
            await page.keyboard.press("Delete")
        await page.keyboard.type(str(a.get("text", "")))
        # 2.5's type_text_at presses Enter by default; 3.x's type does not.
        if a.get("press_enter", name == "type_text_at"):
            await page.keyboard.press("Enter")
    elif name in ("navigate", "open_web_browser_at", "go_to"):
        await page.goto(str(a["url"]))
    elif name in ("scroll", "scroll_at", "scroll_document"):
        if "x" in a and "y" in a:
            await page.mouse.move(*xy())
        direction = str(a.get("direction", "down")).lower()
        magnitude = a.get("magnitude")
        px = denorm(magnitude, h) if magnitude is not None else SCROLL_PX
        dx, dy = {"up": (0, -px), "down": (0, px), "left": (-px, 0), "right": (px, 0)}[direction]
        await page.mouse.wheel(dx, dy)
    elif name in ("press_key", "hotkey", "key_combination"):
        await page.keyboard.press(normalize_keys(a.get("keys", a.get("key", ""))))
    elif name in ("wait", "wait_5_seconds"):
        seconds = float(a.get("seconds", 5))
        await page.wait_for_timeout(min(seconds * 1000, MAX_WAIT_MS))
    elif name == "go_back":
        await page.go_back()
    elif name == "open_web_browser":
        pass  # the browser is already open
    else:
        return {"error": "unsupported_action"}
    return {}
