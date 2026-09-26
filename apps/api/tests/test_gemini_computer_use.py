"""GeminiComputerUseSession with a stubbed SDK client (no network), plus one opt-in live check."""

import os
from typing import Any

import pytest
from google.genai import types

from valt_api.services.ai.types import ActionOutcome
from valt_api.services.gemini import GeminiClient
from valt_api.services.gemini.computer_use import (
    GeminiComputerUseSession,
    function_response,
    parse_reply,
    prune_screenshots,
)

PNG = b"\x89PNG\r\n\x1a\nfake"


def model_turn(*parts: types.Part) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=list(parts)))],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=100, candidates_token_count=20, total_token_count=120
        ),
    )


def fc(name: str, **args: Any) -> types.Part:
    return types.Part(function_call=types.FunctionCall(id=f"id-{name}", name=name, args=args))


class StubModels:
    def __init__(self, replies: list[types.GenerateContentResponse]) -> None:
        self.replies = replies
        self.contents: list[list[types.Content]] = []

    async def generate_content(self, *, model: str, contents: Any, config: Any) -> Any:
        self.contents.append(list(contents))
        return self.replies.pop(0)


class StubClient:
    def __init__(self, replies: list[types.GenerateContentResponse]) -> None:
        self.models = StubModels(replies)
        self.aio = self


def session(stub: StubClient, keep: int = 3) -> GeminiComputerUseSession:
    return GeminiComputerUseSession(
        stub,  # type: ignore[arg-type]
        model="m",
        system="sys",
        goal="goal",
        screenshot_png=PNG,
        url="http://localhost:8001/",
        keep_screenshots=keep,
    )


def test_parse_calls_intent_and_safety() -> None:
    resp = model_turn(
        types.Part(text="thinking...", thought=True),
        fc("click", x=10, y=20, intent="Click the email field"),
        fc(
            "type",
            text="a",
            intent="Type",
            safety_decision={"decision": "require_confirmation", "explanation": "risky"},
        ),
    )
    reply = parse_reply(resp)
    assert [c.name for c in reply.calls] == ["click", "type"]
    assert reply.calls[0].args == {"x": 10, "y": 20}
    assert reply.calls[0].intent == "Click the email field"
    assert reply.safety == {"decision": "require_confirmation", "explanation": "risky"}
    assert reply.text is None
    assert reply.usage is not None and reply.usage.total_tokens == 120


def test_parse_final_text() -> None:
    reply = parse_reply(model_turn(types.Part(text="VERDICT: BUG\nSUMMARY: x")))
    assert reply.calls == [] and reply.text == "VERDICT: BUG\nSUMMARY: x"


def test_function_response_carries_url_and_image() -> None:
    fr = function_response(
        ActionOutcome(
            call_id="id-click", name="click", url="http://x/", screenshot_png=PNG, result={}
        )
    )
    assert fr.id == "id-click" and fr.name == "click"
    assert fr.response == {"url": "http://x/"}
    assert fr.parts and fr.parts[0].inline_data
    assert fr.parts[0].inline_data.data == PNG
    assert fr.parts[0].inline_data.mime_type == "image/png"


async def test_session_prunes_to_keep_screenshots() -> None:
    stub = StubClient([model_turn(fc("click", x=1, y=1)) for _ in range(5)])
    s = session(stub, keep=3)
    await s.next([])
    for _ in range(4):
        await s.next([ActionOutcome("id-click", "click", "http://localhost:8001/", PNG, {})])
    history = stub.models.contents[-1]
    images = 0
    for content in history:
        for part in content.parts or []:
            if part.inline_data is not None:
                images += 1
            if part.function_response is not None and part.function_response.parts:
                images += 1
    assert images == 3
    # URLs of pruned responses remain
    frs = [p.function_response for c in history for p in c.parts or [] if p.function_response]
    assert len(frs) == 4 and all(fr.response and fr.response["url"] for fr in frs)
    # the model's own turns are kept for thought signatures
    assert sum(1 for c in history if c.role == "model") == 4


def test_prune_keeps_opening_text() -> None:
    history = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text="goal"),
                types.Part.from_bytes(data=PNG, mime_type="image/png"),
            ],
        )
    ]
    prune_screenshots(history, keep=0)
    assert [p.text for p in history[0].parts or []] == ["goal"]


@pytest.mark.skipif(not os.environ.get("GEMINI_API_KEY"), reason="needs GEMINI_API_KEY")
async def test_live_computer_use_returns_a_call() -> None:
    """Smoke test: gemini-3.8-flash answers a computer-use turn with at least one action."""
    import base64

    # 1x1 white PNG is enough for the model to decide to act.
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    )
    client = GeminiClient(os.environ["GEMINI_API_KEY"], model="gemini-3.8-flash")
    try:
        s = client.computer_use_session(
            system="You are a QA tester operating a browser.",
            goal="Open http://localhost:8001/ in the browser.",
            screenshot_png=png,
            url="about:blank",
            model=os.environ.get("API_QA_MODEL", "gemini-3.8-flash"),
            keep_screenshots=3,
        )
        reply = await s.next([])
        assert reply.calls, reply.text
    finally:
        await client.aclose()
