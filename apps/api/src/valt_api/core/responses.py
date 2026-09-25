"""Standard API response envelope (docs/api/conventions.md).

Success: {"success": true,  "data": <T>, "meta": {...} | null}
Error:   {"success": false, "error": {"code", "message", "details", "request_id"}}
"""

from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PageMeta(BaseModel):
    limit: int
    next_cursor: str | None = Field(
        default=None, description="Pass as ?cursor= to fetch the next page; null on the last page."
    )


class ApiResponse(BaseModel, Generic[T]):
    success: Literal[True] = True
    data: T
    meta: PageMeta | None = None


class ErrorDetail(BaseModel):
    code: str = Field(description="Stable machine-readable code, e.g. not_found, validation_error.")
    message: str = Field(description="Human-readable, safe to show to users.")
    details: list[dict[str, Any]] | None = None
    request_id: str | None = None


class ApiErrorResponse(BaseModel):
    success: Literal[False] = False
    error: ErrorDetail


def ok(data: T, meta: PageMeta | None = None) -> ApiResponse[T]:
    return ApiResponse[T](data=data, meta=meta)


# Documented on routes via `responses=` so OpenAPI shows the error shape.
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    404: {"model": ApiErrorResponse, "description": "Not found"},
    422: {"model": ApiErrorResponse, "description": "Validation error"},
    503: {"model": ApiErrorResponse, "description": "Dependency unavailable"},
}
