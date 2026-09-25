# 0013. Standard API response envelope

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

The API returned bare resources on success and FastAPI's default `{"detail": ...}` on errors, with a
different shape for validation errors (a list of Pydantic errors that echoes submitted input).
Clients had to special-case each. Lists need a place for pagination cursors, and support needs a
correlation id to find a failed request in logs.

## Decision

Every JSON response under `/api` uses one envelope (full spec: `docs/api/conventions.md`):

- success: `{ "success": true, "data": T, "meta": PageMeta | null }`
- error: `{ "success": false, "error": { "code", "message", "details", "request_id" } }`

Implemented by `ApiResponse[T]` / `ApiErrorResponse` (`core/responses.py`), exception handlers
for `AppError`, `HTTPException`, `RequestValidationError`, and unhandled exceptions
(`core/errors.py`), and a request-id middleware (`X-Request-ID`). Validation details keep only
`loc`/`msg`/`type`, never input values. The web client (`apiFetch`) unwraps `data` and throws a
typed `ApiError`. SSE streams (ADR 0007) are exempt: they use their own event format with the same
error shape.

## Alternatives considered

- **Bare resources + RFC 9457 problem+json errors** — standard, but no slot for list metadata
  without headers, and two different shapes to parse.
- **FastAPI defaults** — inconsistent error shapes and echoing of submitted input.
- **Pagination via `Link` headers** — awkward through the Next.js proxy and in TanStack Query.

## Consequences

### Positive

- One parser on the client, with branching on a stable `code`.
- Request ids tie user reports to logs.
- OpenAPI documents the error shape on every route (`ERROR_RESPONSES`).

### Negative / risks

- Slightly larger payloads, plus one unwrap step in every client.
- Generic `ApiResponse[T]` models add OpenAPI schema names (`ApiResponse_Item_`).
- External consumers expecting plain REST need the conventions doc.
