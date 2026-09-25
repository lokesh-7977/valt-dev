import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

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
    422: "validation_error",
    429: "rate_limited",
    503: "service_unavailable",
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
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = rid
        return response
