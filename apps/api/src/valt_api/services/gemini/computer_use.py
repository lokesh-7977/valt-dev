"""Gemini Computer Use session (ADR 0014 boundary, ADR 0015).

Keeps the conversation history, sends each action's result back as a FunctionResponse carrying
the page URL and a fresh screenshot, and turns the model's function calls into neutral
ActionCalls. Only the newest `keep_screenshots` images stay in the history to bound tokens.
"""

import logging
from collections.abc import Sequence
from typing import Any

from google import genai
from google.genai import types

from valt_api.core.errors import AIBlockedError, AIInvalidOutputError
from valt_api.services.ai.types import (
    ActionCall,
    ActionOutcome,
    ComputerUseReply,
)
from valt_api.services.gemini.client import _BLOCKED, _translate_errors, _usage

logger = logging.getLogger(__name__)

PNG = "image/png"


class GeminiComputerUseSession:
    def __init__(
        self,
        client: genai.Client,
        *,
        model: str,
        system: str,
        goal: str,
        screenshot_png: bytes,
        url: str,
        keep_screenshots: int,
    ) -> None:
        self._client = client
        self._model = model
        self._keep = max(1, keep_screenshots)
        self._history: list[types.Content] = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text=f"{goal}\n\nCurrent URL: {url}"),
                    types.Part.from_bytes(data=screenshot_png, mime_type=PNG),
                ],
            )
        ]
        self._config = types.GenerateContentConfig(
            system_instruction=system,
            tools=[
                types.Tool(
                    computer_use=types.ComputerUse(
                        environment=types.Environment.ENVIRONMENT_BROWSER,
                        enable_prompt_injection_detection=True,
                    )
                )
            ],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            # Low thinking keeps each step at ~2-5 s; the task is short and visual.
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
        )

    @property
    def history(self) -> list[types.Content]:
        return self._history

    async def next(self, outcomes: Sequence[ActionOutcome]) -> ComputerUseReply:
        if outcomes:
            self._history.append(
                types.Content(
                    role="user",
                    parts=[types.Part(function_response=function_response(o)) for o in outcomes],
                )
            )
        prune_screenshots(self._history, self._keep)
        contents: list[types.ContentUnion] = [*self._history]
        with _translate_errors():
            resp = await self._client.aio.models.generate_content(
                model=self._model, contents=contents, config=self._config
            )
        reply = parse_reply(resp)
        # Keep the model turn verbatim (it carries thought signatures the API expects back).
        content = resp.candidates[0].content if resp.candidates else None
        if content is not None:
            self._history.append(content)
        u = reply.usage
        logger.info(
            "computer_use step: calls=%d in=%s out=%s",
            len(reply.calls),
            u.input_tokens if u else None,
            u.output_tokens if u else None,
        )
        return reply


def function_response(o: ActionOutcome) -> types.FunctionResponse:
    response: dict[str, Any] = {"url": o.url, **o.result}
    if o.safety_ack:
        response["safety_acknowledgement"] = "true"
    parts = (
        [
            types.FunctionResponsePart(
                inline_data=types.FunctionResponseBlob(mime_type=PNG, data=o.screenshot_png)
            )
        ]
        if o.screenshot_png
        else None
    )
    return types.FunctionResponse(id=o.call_id, name=o.name, response=response, parts=parts)


def prune_screenshots(history: list[types.Content], keep: int) -> None:
    """Drop all but the newest `keep` screenshots. Text/URL results stay."""
    seen = 0
    for content in reversed(history):
        if content.role != "user" or not content.parts:
            continue
        kept: list[types.Part] = []
        for part in reversed(content.parts):
            fr = part.function_response
            if fr is not None and fr.parts:
                seen += 1
                if seen > keep:
                    fr.parts = None
            elif part.inline_data is not None:
                seen += 1
                if seen > keep:
                    continue  # the opening screenshot; its text part stays
            kept.append(part)
        content.parts = list(reversed(kept))


def parse_reply(resp: types.GenerateContentResponse) -> ComputerUseReply:
    feedback = resp.prompt_feedback
    if feedback is not None and feedback.block_reason:
        raise AIBlockedError()
    if not resp.candidates:
        raise AIInvalidOutputError("AI returned an empty response, try again")
    candidate = resp.candidates[0]
    parts = candidate.content.parts if candidate.content and candidate.content.parts else []
    if not parts and candidate.finish_reason in _BLOCKED:
        raise AIBlockedError()

    calls: list[ActionCall] = []
    texts: list[str] = []
    safety: dict[str, Any] | None = None
    for part in parts:
        fc = part.function_call
        if fc is not None and fc.name:
            args = dict(fc.args or {})
            decision = args.pop("safety_decision", None)
            if isinstance(decision, dict):
                safety = decision
            intent = args.pop("intent", None)
            calls.append(
                ActionCall(
                    id=fc.id,
                    name=fc.name,
                    args=args,
                    intent=str(intent) if intent is not None else None,
                )
            )
        elif part.text and not part.thought:
            texts.append(part.text)
    return ComputerUseReply(
        calls=calls,
        text="\n".join(texts) or None,
        safety=safety,
        usage=_usage(resp),
    )
