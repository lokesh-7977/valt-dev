"""Application-level AI operations. Endpoints and domain code call this, never the SDK.

Typical domain usage:

    prepared = await ai.prepare(get_prompt("my_task"), variables={...}, text=..., file_ids=[...])
    result = await ai.structured(prepared.parts, MyOutput, prepared.options)  # -> MyOutput
"""

import dataclasses
import logging
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from valt_api.core.errors import AIInvalidOutputError
from valt_api.prompts.base import PromptTemplate
from valt_api.services.ai.types import (
    GenerationOptions,
    InputPart,
    JsonResult,
    M,
    Media,
    ModelClient,
    StructuredResult,
    TextResult,
)
from valt_api.services.storage.base import FileStorage

logger = logging.getLogger(__name__)

_STRUCTURED_ATTEMPTS = 2  # one retry when the model's JSON doesn't fit the schema


@dataclass(frozen=True, slots=True)
class Prepared:
    parts: list[InputPart]
    options: GenerationOptions
    template: PromptTemplate | None = None


class AIService:
    def __init__(self, client: ModelClient, storage: FileStorage) -> None:
        self._client = client
        self._storage = storage

    @property
    def default_model(self) -> str:
        return self._client.default_model

    # ---- input assembly ----

    async def build_parts(
        self,
        *,
        instruction: str | None = None,
        text: str | None = None,
        file_ids: Sequence[str] = (),
    ) -> list[InputPart]:
        """Instruction first, then user text (tagged as data), then files in the given order."""
        parts: list[InputPart] = []
        if instruction and instruction.strip():
            parts.append(instruction.strip())
        if text:
            parts.append(f"<user_input>\n{text}\n</user_input>")
        for file_id in file_ids:
            meta, data = await self._storage.read(file_id)
            parts.append(Media(data=data, mime_type=meta.content_type, name=meta.filename))
        return parts

    async def prepare(
        self,
        template: PromptTemplate,
        *,
        variables: Mapping[str, str] | None = None,
        text: str | None = None,
        file_ids: Sequence[str] = (),
        overrides: GenerationOptions | None = None,
    ) -> Prepared:
        parts = await self.build_parts(
            instruction=template.render(variables or {}), text=text, file_ids=file_ids
        )
        options = GenerationOptions(system=template.system_prompt, temperature=template.temperature)
        if overrides is not None:
            options = merge_options(options, overrides)
        return Prepared(parts=parts, options=options, template=template)

    # ---- model calls ----

    async def text(
        self, parts: Sequence[InputPart], options: GenerationOptions | None = None
    ) -> TextResult:
        return await self._client.generate_text(parts, options or GenerationOptions())

    async def json(
        self,
        parts: Sequence[InputPart],
        json_schema: dict[str, Any],
        options: GenerationOptions | None = None,
    ) -> JsonResult:
        """Free-form JSON matching a caller-supplied JSON Schema."""
        return await self._client.generate_json(parts, options or GenerationOptions(), json_schema)

    async def structured(
        self,
        parts: Sequence[InputPart],
        output_model: type[M],
        options: GenerationOptions | None = None,
    ) -> StructuredResult[M]:
        """JSON output validated into a Pydantic model."""
        schema = output_model.model_json_schema()
        last_error: Exception | None = None
        for attempt in range(1, _STRUCTURED_ATTEMPTS + 1):
            try:
                res = await self._client.generate_json(
                    parts, options or GenerationOptions(), schema
                )
                value = output_model.model_validate(res.data)
                return StructuredResult(value=value, model=res.model, usage=res.usage)
            except (ValidationError, AIInvalidOutputError) as exc:
                last_error = exc
                logger.warning(
                    "structured output invalid for %s (attempt %d): %s",
                    output_model.__name__,
                    attempt,
                    type(exc).__name__,
                )
        raise AIInvalidOutputError() from last_error

    def stream(
        self, parts: Sequence[InputPart], options: GenerationOptions | None = None
    ) -> AsyncIterator[str]:
        return self._client.stream_text(parts, options or GenerationOptions())

    async def run(self, prepared: Prepared) -> TextResult | StructuredResult[BaseModel]:
        """Run a prepared template: structured if it declares an output model, else text."""
        template = prepared.template
        if template is not None and template.output_model is not None:
            return await self.structured(prepared.parts, template.output_model, prepared.options)
        return await self.text(prepared.parts, prepared.options)


def merge_options(base: GenerationOptions, overrides: GenerationOptions) -> GenerationOptions:
    """Fields set (non-None) in `overrides` win."""
    changes = {
        f.name: getattr(overrides, f.name)
        for f in dataclasses.fields(overrides)
        if getattr(overrides, f.name) is not None
    }
    return dataclasses.replace(base, **changes)
