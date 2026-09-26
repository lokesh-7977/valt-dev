"""Provider-neutral AI types. Nothing here imports a model SDK.

Endpoints and domain code talk to `AIService`; `AIService` talks to a `ModelClient`
(GeminiClient in production, a fake in tests). Swapping providers means one new client class.
"""

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any, Generic, Protocol, TypeVar

from pydantic import BaseModel

# MIME types Gemini accepts inline. Uploads outside this set get a 415.
SUPPORTED_MIME_TYPES: frozenset[str] = frozenset(
    {
        # images
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/heic",
        "image/heif",
        # audio
        "audio/wav",
        "audio/x-wav",
        "audio/mp3",
        "audio/mpeg",
        "audio/aac",
        "audio/ogg",
        "audio/flac",
        "audio/aiff",
        "audio/webm",
        # documents
        "application/pdf",
        "text/plain",
        "text/markdown",
        "text/csv",
        "text/html",
        # video (short clips work inline)
        "video/mp4",
        "video/webm",
        "video/quicktime",
    }
)


@dataclass(frozen=True, slots=True)
class Media:
    """A binary input (image, audio, PDF, ...) sent inline to the model."""

    data: bytes
    mime_type: str
    name: str | None = None


# One piece of model input: plain text or a media blob. A prompt is a list of these.
InputPart = str | Media


@dataclass(frozen=True, slots=True)
class GenerationOptions:
    system: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    model: str | None = None  # None → the client's default model


@dataclass(frozen=True, slots=True)
class Usage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class TextResult:
    text: str
    model: str
    usage: Usage | None = None


@dataclass(frozen=True, slots=True)
class JsonResult:
    data: dict[str, Any] | list[Any]
    model: str
    usage: Usage | None = None


M = TypeVar("M", bound=BaseModel)


@dataclass(frozen=True, slots=True)
class StructuredResult(Generic[M]):
    value: M
    model: str
    usage: Usage | None = None


class ModelClient(Protocol):
    """What AIService needs from a model provider."""

    @property
    def default_model(self) -> str: ...

    async def generate_text(
        self, parts: Sequence[InputPart], options: GenerationOptions
    ) -> TextResult: ...

    async def generate_json(
        self, parts: Sequence[InputPart], options: GenerationOptions, json_schema: dict[str, Any]
    ) -> JsonResult: ...

    def stream_text(
        self, parts: Sequence[InputPart], options: GenerationOptions
    ) -> AsyncIterator[str]: ...

    async def aclose(self) -> None: ...


# ---- Computer use (live QA agent, ADR 0015) ----


@dataclass(frozen=True, slots=True)
class ActionCall:
    """One UI action the model asked for (click, type, navigate, ...).

    `args` excludes `intent` and `safety_decision`; coordinates are normalised to 0-1000.
    """

    id: str | None
    name: str
    args: dict[str, Any]
    intent: str | None = None


@dataclass(frozen=True, slots=True)
class ActionOutcome:
    """What happened when we executed an ActionCall, sent back to the model."""

    call_id: str | None
    name: str
    url: str
    screenshot_png: bytes | None
    result: dict[str, Any]
    safety_ack: bool = False


@dataclass(frozen=True, slots=True)
class ComputerUseReply:
    calls: list[ActionCall]
    text: str | None
    safety: dict[str, Any] | None  # e.g. {"decision": "require_confirmation", "explanation": ...}
    usage: Usage | None = None


class ComputerUseSession(Protocol):
    """A multi-turn computer-use conversation. `next([])` sends the opening turn."""

    async def next(self, outcomes: Sequence[ActionOutcome]) -> ComputerUseReply: ...


class ComputerUseProvider(Protocol):
    def computer_use_session(
        self,
        *,
        system: str,
        goal: str,
        screenshot_png: bytes,
        url: str,
        model: str,
        keep_screenshots: int,
    ) -> ComputerUseSession: ...
