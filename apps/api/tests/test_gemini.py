"""GeminiClient mapping logic, plus one live smoke test (runs only with GEMINI_API_KEY set)."""

import os

import pytest
from google.genai import errors as genai_errors
from google.genai import types

from valt_api.core.errors import (
    AIBlockedError,
    AIInvalidOutputError,
    AIRateLimitedError,
    AIRequestRejectedError,
    AIUnavailableError,
    AIUpstreamError,
)
from valt_api.services.ai import GenerationOptions
from valt_api.services.gemini import GeminiClient
from valt_api.services.gemini.client import _text_or_raise, _translate_errors


def _api_error(cls: type[genai_errors.APIError], code: int) -> genai_errors.APIError:
    return cls(code, {"error": {"code": code, "message": "provider detail", "status": "X"}})


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (_api_error(genai_errors.ClientError, 429), AIRateLimitedError),
        (_api_error(genai_errors.ClientError, 403), AIUnavailableError),
        (_api_error(genai_errors.ClientError, 400), AIRequestRejectedError),
        (
            genai_errors.ClientError(
                400,
                {
                    "error": {
                        "code": 400,
                        "message": "bad key",
                        "details": [{"reason": "API_KEY_INVALID"}],
                    }
                },
            ),
            AIUnavailableError,
        ),
        (_api_error(genai_errors.ServerError, 503), AIUpstreamError),
        (RuntimeError("boom"), AIUpstreamError),
    ],
)
def test_sdk_errors_are_translated(exc: Exception, expected: type[Exception]) -> None:
    with pytest.raises(expected), _translate_errors():
        raise exc


def test_prompt_block_raises_blocked() -> None:
    resp = types.GenerateContentResponse(
        prompt_feedback=types.GenerateContentResponsePromptFeedback(
            block_reason=types.BlockedReason.SAFETY
        )
    )
    with pytest.raises(AIBlockedError):
        _text_or_raise(resp)


def test_empty_response_raises_invalid_output() -> None:
    resp = types.GenerateContentResponse(
        candidates=[types.Candidate(finish_reason=types.FinishReason.MAX_TOKENS)]
    )
    with pytest.raises(AIInvalidOutputError):
        _text_or_raise(resp)


@pytest.mark.skipif(not os.environ.get("GEMINI_API_KEY"), reason="GEMINI_API_KEY not set")
async def test_live_gemini_smoke() -> None:
    client = GeminiClient(
        os.environ["GEMINI_API_KEY"], model=os.environ.get("API_GEMINI_MODEL", "gemini-3.8-flash")
    )
    try:
        res = await client.generate_text(["Reply with the single word: pong"], GenerationOptions())
        assert "pong" in res.text.lower()
        data = await client.generate_json(
            ["Return ok=true"],
            GenerationOptions(),
            {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]},
        )
        assert data.data == {"ok": True}
        chunks = [c async for c in client.stream_text(["Count 1 to 5"], GenerationOptions())]
        assert chunks
    finally:
        await client.aclose()
