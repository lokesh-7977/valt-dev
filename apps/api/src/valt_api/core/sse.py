"""Server-Sent Events (ADR 0007). Events: token, done, error — see docs/api/conventions.md."""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi.responses import StreamingResponse

from valt_api.core.errors import AppError
from valt_api.core.responses import ErrorDetail

logger = logging.getLogger(__name__)


def sse_event(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_tokens(
    tokens: AsyncIterator[str], *, done: dict[str, Any], request_id: str | None
) -> AsyncIterator[str]:
    """token* → done, or token* → error. Errors after headers are sent can only be events."""
    try:
        async for text in tokens:
            yield sse_event("token", {"text": text})
        yield sse_event("done", done)
    except AppError as exc:
        err = ErrorDetail(code=exc.code, message=exc.message, request_id=request_id)
        yield sse_event("error", err.model_dump(mode="json"))
    except Exception:
        logger.exception("stream failed")
        err = ErrorDetail(
            code="internal_error", message="something went wrong", request_id=request_id
        )
        yield sse_event("error", err.model_dump(mode="json"))


def sse_response(events: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
