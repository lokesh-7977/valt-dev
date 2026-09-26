import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from valt_api.core.logging import request_id_var
from valt_api.core.responses import ApiErrorResponse, ErrorDetail

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"

_STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
    502: "bad_gateway",
    503: "service_unavailable",
    504: "gateway_timeout",
}


class AppError(Exception):
    """Raise from anywhere in the app to return a well-formed error envelope."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


class NotFoundError(AppError):
    def __init__(self, resource: str) -> None:
        super().__init__(status.HTTP_404_NOT_FOUND, "not_found", f"{resource} not found")


class DatabaseUnavailableError(AppError):
    def __init__(self, message: str = "database is not available") -> None:
        super().__init__(status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable", message)


class PayloadTooLargeError(AppError):
    def __init__(self, max_mb: int) -> None:
        super().__init__(
            status.HTTP_413_CONTENT_TOO_LARGE, "payload_too_large", f"file exceeds {max_mb} MB"
        )


class UnsupportedMediaError(AppError):
    def __init__(self, content_type: str) -> None:
        super().__init__(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            f"unsupported file type: {content_type or 'unknown'}",
        )


# ---- AI errors (provider-agnostic; services/gemini translates SDK errors into these) ----


class AIUnavailableError(AppError):
    def __init__(self, message: str = "AI is not configured (set GEMINI_API_KEY)") -> None:
        super().__init__(status.HTTP_503_SERVICE_UNAVAILABLE, "ai_unavailable", message)


class QAUnavailableError(AppError):
    def __init__(self, message: str = "QA browser is not installed") -> None:
        super().__init__(status.HTTP_503_SERVICE_UNAVAILABLE, "qa_unavailable", message)


class AIRateLimitedError(AppError):
    def __init__(self) -> None:
        super().__init__(
            status.HTTP_429_TOO_MANY_REQUESTS, "ai_rate_limited", "AI quota hit, retry shortly"
        )


class AITimeoutError(AppError):
    def __init__(self) -> None:
        super().__init__(status.HTTP_504_GATEWAY_TIMEOUT, "ai_timeout", "AI request timed out")


class AIUpstreamError(AppError):
    def __init__(self, message: str = "AI provider error, retry shortly") -> None:
        super().__init__(status.HTTP_502_BAD_GATEWAY, "ai_upstream_error", message)


class AIRequestRejectedError(AppError):
    """The provider refused the input (bad file, unsupported schema, too many tokens...)."""

    def __init__(self, message: str = "the AI provider rejected this request") -> None:
        super().__init__(status.HTTP_422_UNPROCESSABLE_CONTENT, "ai_bad_request", message)


class AIBlockedError(AppError):
    def __init__(self) -> None:
        super().__init__(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "ai_blocked",
            "the AI declined to answer (safety filter)",
        )


class AIInvalidOutputError(AppError):
    def __init__(self, message: str = "AI returned an invalid response, try again") -> None:
        super().__init__(status.HTTP_502_BAD_GATEWAY, "ai_invalid_output", message)


def _request_id(request: Request) -> str | None:
    rid: str | None = getattr(request.state, "request_id", None)
    return rid


def _error(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: list[dict[str, Any]] | None = None,
) -> JSONResponse:
    body = ApiErrorResponse(
        error=ErrorDetail(
            code=code, message=message, details=details, request_id=_request_id(request)
        )
    )
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


async def _app_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return _error(request, exc.status_code, exc.code, exc.message, exc.details)


async def _http_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _STATUS_CODES.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) else code.replace("_", " ")
    return _error(request, exc.status_code, code, message)


async def _validation_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    # Keep loc/msg/type only — never echo the submitted input back.
    details = [
        {"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")}
        for e in exc.errors()
    ]
    return _error(
        request,
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "validation_error",
        "invalid request",
        details,
    )


async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error", extra={"request_id": _request_id(request)})
    return _error(
        request, status.HTTP_500_INTERNAL_SERVER_ERROR, "internal_error", "something went wrong"
    )


def install_error_handling(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled_error)

    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        rid = incoming if 0 < len(incoming) <= 128 else uuid.uuid4().hex
        request.state.request_id = rid
        token = request_id_var.set(rid)
        start = time.perf_counter()
        try:
            response = await call_next(request)
            response.headers[REQUEST_ID_HEADER] = rid
            # Path only — query strings can carry user data.
            logger.info(
                "%s %s -> %s (%.0f ms)",
                request.method,
                request.url.path,
                response.status_code,
                (time.perf_counter() - start) * 1000,
            )
            return response
        finally:
            request_id_var.reset(token)
