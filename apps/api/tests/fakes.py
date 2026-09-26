"""Scripted stand-in for GeminiClient. Tests set replies/errors and inspect `calls`."""

import asyncio
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

from valt_api.services.ai import (
    ActionCall,
    ActionOutcome,
    ComputerUseReply,
    GenerationOptions,
    InputPart,
    JsonResult,
    TextResult,
    Usage,
)

VALID_ANALYSIS = {
    "summary": "A short summary.",
    "key_points": ["one", "two"],
    "entities": [{"name": "Acme", "type": "organization"}],
    "sentiment": "neutral",
    "recommended_actions": ["Do the first thing"],
    "confidence": 0.9,
}


@dataclass
class Call:
    kind: str
    parts: list[InputPart]
    options: GenerationOptions
    json_schema: dict[str, Any] | None = None


@dataclass
class FakeModelClient:
    text_reply: str = "hello world"
    # Popped in order; the last one repeats. An Exception entry is raised.
    json_replies: list[Any] = field(default_factory=lambda: [VALID_ANALYSIS])
    stream_chunks: list[str] = field(default_factory=lambda: ["hel", "lo"])
    stream_error: Exception | None = None
    error: Exception | None = None
    calls: list[Call] = field(default_factory=list)

    @property
    def default_model(self) -> str:
        return "fake-model"

    async def generate_text(
        self, parts: Sequence[InputPart], options: GenerationOptions
    ) -> TextResult:
        self.calls.append(Call("text", list(parts), options))
        if self.error:
            raise self.error
        return TextResult(self.text_reply, options.model or "fake-model", Usage(1, 2, 3))

    async def generate_json(
        self, parts: Sequence[InputPart], options: GenerationOptions, json_schema: dict[str, Any]
    ) -> JsonResult:
        self.calls.append(Call("json", list(parts), options, json_schema))
        if self.error:
            raise self.error
        reply = self.json_replies.pop(0) if len(self.json_replies) > 1 else self.json_replies[0]
        if isinstance(reply, Exception):
            raise reply
        return JsonResult(reply, options.model or "fake-model", Usage(1, 2, 3))

    async def stream_text(
        self, parts: Sequence[InputPart], options: GenerationOptions
    ) -> AsyncIterator[str]:
        self.calls.append(Call("stream", list(parts), options))
        for chunk in self.stream_chunks:
            yield chunk
        if self.stream_error:
            raise self.stream_error

    async def aclose(self) -> None:
        return None


# ---- Live QA agent ----

PNG_BYTES = b"\x89PNG\r\n\x1a\nfake"


@dataclass
class FakeComputerUseSession:
    # Popped in order; an Exception entry is raised. Empty list -> a PASS report.
    replies: list[Any]
    received: list[list[ActionOutcome]] = field(default_factory=list)

    async def next(self, outcomes: Sequence[ActionOutcome]) -> ComputerUseReply:
        self.received.append(list(outcomes))
        reply = (
            self.replies.pop(0)
            if self.replies
            else ComputerUseReply(calls=[], text="VERDICT: PASS\nSUMMARY: ok", safety=None)
        )
        if isinstance(reply, Exception):
            raise reply
        assert isinstance(reply, ComputerUseReply)
        return reply


@dataclass
class FakeComputerUse:
    replies: list[Any] = field(default_factory=list)
    sessions: list[FakeComputerUseSession] = field(default_factory=list)

    def computer_use_session(
        self,
        *,
        system: str,
        goal: str,
        screenshot_png: bytes,
        url: str,
        model: str,
        keep_screenshots: int,
    ) -> FakeComputerUseSession:
        session = FakeComputerUseSession(list(self.replies))
        self.sessions.append(session)
        return session


@dataclass
class FakeRunPage:
    url: str = "http://localhost:8001/"
    executed: list[ActionCall] = field(default_factory=list)
    delay_s: float = 0.0
    closed: bool = False

    async def goto(self, url: str) -> None:
        self.url = url

    async def snapshot(self) -> tuple[str, bytes]:
        return self.url, PNG_BYTES

    async def execute(self, call: ActionCall) -> dict[str, Any]:
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        self.executed.append(call)
        return {}

    async def close(self) -> None:
        self.closed = True


def action(name: str, intent: str = "do it", **args: Any) -> ActionCall:
    return ActionCall(id=f"id-{name}", name=name, args=dict(args), intent=intent)


def reply(*calls: ActionCall, text: str | None = None, safety: Any = None) -> ComputerUseReply:
    return ComputerUseReply(calls=list(calls), text=text, safety=safety, usage=Usage(10, 2, 12))
