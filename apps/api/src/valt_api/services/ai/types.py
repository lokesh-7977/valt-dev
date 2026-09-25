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
