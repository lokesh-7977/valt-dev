"""Scripted stand-in for GeminiClient. Tests set replies/errors and inspect `calls`."""

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

from valt_api.services.ai import GenerationOptions, InputPart, JsonResult, TextResult, Usage

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
