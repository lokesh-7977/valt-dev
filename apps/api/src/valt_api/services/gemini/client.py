"""Gemini implementation of ModelClient (google-genai SDK, async).

The only module that imports the Gemini SDK. It turns provider-neutral inputs into Gemini
`Part`s and turns every SDK failure into one of the AppError subclasses in core/errors.py,
so endpoints never see a raw provider exception.
"""

import json
import logging
from collections.abc import AsyncIterator, Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from valt_api.core.errors import (
    AIBlockedError,
    AIInvalidOutputError,
    AIRateLimitedError,
    AIRequestRejectedError,
    AITimeoutError,
    AIUnavailableError,
    AIUpstreamError,
    AppError,
)
from valt_api.services.ai.types import (
    ComputerUseSession,
    GenerationOptions,
    InputPart,
    JsonResult,
    Media,
    TextResult,
    Usage,
)

logger = logging.getLogger(__name__)

_BLOCKED = {
    types.FinishReason.SAFETY,
    types.FinishReason.BLOCKLIST,
    types.FinishReason.PROHIBITED_CONTENT,
    types.FinishReason.SPII,
    types.FinishReason.RECITATION,
    types.FinishReason.IMAGE_SAFETY,
}


class GeminiClient:
    def __init__(
        self, api_key: str, *, model: str, timeout_s: float = 90.0, max_retries: int = 2
    ) -> None:
        self._model = model
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=int(timeout_s * 1000),
                retry_options=types.HttpRetryOptions(attempts=max_retries + 1),
            ),
        )

    @property
    def default_model(self) -> str:
        return self._model

    async def aclose(self) -> None:
        await self._client.aio.aclose()

    def computer_use_session(
        self,
        *,
        system: str,
        goal: str,
        screenshot_png: bytes,
        url: str,
        model: str,
        keep_screenshots: int,
    ) -> ComputerUseSession:
        # Imported here: computer_use.py reuses this module's error mapping.
        from valt_api.services.gemini.computer_use import GeminiComputerUseSession

        return GeminiComputerUseSession(
            self._client,
            model=model,
            system=system,
            goal=goal,
            screenshot_png=screenshot_png,
            url=url,
            keep_screenshots=keep_screenshots,
        )

    async def generate_text(
        self, parts: Sequence[InputPart], options: GenerationOptions
    ) -> TextResult:
        model = options.model or self._model
        with _translate_errors():
            resp = await self._client.aio.models.generate_content(
                model=model, contents=_content(parts), config=_config(options)
            )
        return TextResult(text=_text_or_raise(resp), model=model, usage=_usage(resp))

    async def generate_json(
        self, parts: Sequence[InputPart], options: GenerationOptions, json_schema: dict[str, Any]
    ) -> JsonResult:
        model = options.model or self._model
        config = _config(
            options, response_mime_type="application/json", response_json_schema=json_schema
        )
        with _translate_errors():
            resp = await self._client.aio.models.generate_content(
                model=model, contents=_content(parts), config=config
            )
        text = _text_or_raise(resp)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AIInvalidOutputError("AI returned malformed JSON, try again") from exc
        if not isinstance(data, dict | list):
            raise AIInvalidOutputError()
        return JsonResult(data=data, model=model, usage=_usage(resp))

    async def stream_text(
        self, parts: Sequence[InputPart], options: GenerationOptions
    ) -> AsyncIterator[str]:
        model = options.model or self._model
        with _translate_errors():
            stream = await self._client.aio.models.generate_content_stream(
                model=model, contents=_content(parts), config=_config(options)
            )
            async for chunk in stream:
                feedback = chunk.prompt_feedback
                if feedback is not None and feedback.block_reason:
                    raise AIBlockedError()
                if chunk.text:
                    yield chunk.text


def _content(parts: Sequence[InputPart]) -> types.Content:
    return types.Content(
        role="user",
        parts=[
            types.Part.from_bytes(data=p.data, mime_type=p.mime_type)
            if isinstance(p, Media)
            else types.Part.from_text(text=p)
            for p in parts
        ],
    )


def _config(options: GenerationOptions, **extra: Any) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=options.system,
        temperature=options.temperature,
        max_output_tokens=options.max_output_tokens,
        # No SDK-driven tool loop; add tools explicitly per call when a feature needs them.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        **extra,
    )


def _text_or_raise(resp: types.GenerateContentResponse) -> str:
    feedback = resp.prompt_feedback
    if feedback is not None and feedback.block_reason:
        raise AIBlockedError()
    text = resp.text
    if text:
        return text
    reason = resp.candidates[0].finish_reason if resp.candidates else None
    if reason in _BLOCKED:
        raise AIBlockedError()
    if reason == types.FinishReason.MAX_TOKENS:
        raise AIInvalidOutputError("AI hit the output token limit before answering")
    raise AIInvalidOutputError("AI returned an empty response, try again")


def _usage(resp: types.GenerateContentResponse) -> Usage | None:
    u = resp.usage_metadata
    if u is None:
        return None
    return Usage(
        input_tokens=u.prompt_token_count,
        output_tokens=u.candidates_token_count,
        total_tokens=u.total_token_count,
    )


@contextmanager
def _translate_errors() -> Iterator[None]:
    """Map SDK/network failures to stable API error codes. Provider messages are logged, not
    returned — they can echo prompt content."""
    try:
        yield
    except AppError:
        raise
    except genai_errors.ClientError as exc:
        if exc.code == 429:
            raise AIRateLimitedError() from exc
        if exc.code in (401, 403) or "API_KEY_INVALID" in str(exc.details):
            logger.error("gemini rejected credentials (%s): %s", exc.code, exc.message)
            raise AIUnavailableError("AI provider rejected the API key") from exc
        logger.warning("gemini rejected request (%s): %s", exc.code, exc.message)
        raise AIRequestRejectedError() from exc
    except genai_errors.APIError as exc:
        logger.warning("gemini server error (%s): %s", exc.code, exc.message)
        raise AIUpstreamError() from exc
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise AITimeoutError() from exc
    except Exception as exc:
        logger.exception("gemini call failed")
        raise AIUpstreamError() from exc
