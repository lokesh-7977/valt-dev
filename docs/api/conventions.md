# API Conventions

Every endpoint under `/api` follows these rules. Decision: [ADR 0013](../adr/0013-standard-api-response-envelope.md).
Implementation: `apps/api/src/valt_api/core/responses.py` and `core/errors.py`. TypeScript mirror:
`packages/shared/src/index.ts`, and the client in `apps/web/src/lib/api.ts`.

## Response envelope

### Success

```json
{
  "success": true,
  "data": { "id": 42, "name": "Quarterly plan", "description": null,
            "created_at": "2026-09-25T09:12:03.120Z", "updated_at": "2026-09-25T09:12:03.120Z" },
  "meta": null
}
```

### Success, paginated list

```json
{
  "success": true,
  "data": [ { "id": 42, "...": "..." }, { "id": 41, "...": "..." } ],
  "meta": { "limit": 2, "next_cursor": "41" }
}
```

Fetch the next page with `?cursor=<next_cursor>`. `next_cursor: null` means the last page.
Lists are keyset-paginated (never offset), newest first, `limit` 1–100 (default 20).

### Error

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "invalid request",
    "details": [ { "loc": ["body", "name"], "msg": "Value error, must not be blank", "type": "value_error" } ],
    "request_id": "9f1c2e7a4b0d4c3e8a51b2f6d7e9a0c1"
  }
}
```

- `code` is stable and machine-readable. Clients branch on it, never on `message`.
- `message` is safe to show to users. It never contains stack traces, SQL, provider errors, or
  submitted values.
- `details` is present for validation errors (`loc`, `msg`, `type`). Input values are never echoed.
- `request_id` matches the `X-Request-ID` response header. Quote it in bug reports and search it in logs.

### No content

`DELETE` returns `204` with an empty body.

## Status codes and error codes

| HTTP | `code` | When |
| --- | --- | --- |
| 200 | – | read / update succeeded |
| 201 | – | created (body = the new resource) |
| 204 | – | deleted |
| 400 | `bad_request` | malformed request not caught by validation |
| 401 | `unauthorized` | missing/invalid credentials (Phase 2) |
| 403 | `forbidden` | authenticated but not allowed |
| 404 | `not_found` | resource doesn't exist *or* isn't visible to the caller |
| 409 | `conflict` | uniqueness / state conflict |
| 422 | `validation_error` | body/query/path failed validation |
| 429 | `rate_limited` | quota or rate limit hit (Phase 9); `Retry-After` header set |
| 500 | `internal_error` | unexpected failure (logged with request id) |
| 503 | `database_unavailable` / `service_unavailable` | dependency down or not configured |

Raise `AppError(status, code, message)` (or a subclass such as `NotFoundError`) anywhere in the app.
The handlers build the envelope.

## Resource conventions

- Plural nouns: `/api/items`, `/api/threads/{id}/messages`.
- `GET` list · `POST` create · `GET /{id}` read · `PATCH /{id}` partial update · `DELETE /{id}`.
- JSON fields in `snake_case`. Timestamps are ISO-8601 UTC. IDs are integers for internal tables
  and UUIDs for shareable resources (threads, documents).
- `PATCH` only changes fields present in the body.
- Every write endpoint commits exactly once. Repositories only flush.
- Request and response models live in `schemas.py`, mirrored in `packages/shared` (`/sync-contract`).

## Streaming endpoints (Phase 3+)

AI runs (`POST /api/<feature>/runs`) return `text/event-stream`, not the envelope. Events are
`token`, `step`, `interrupt`, `done`, `error` (ADR 0007). The `error` event's data has the same
shape as `error` above.

## Headers

| Header | Direction | Purpose |
| --- | --- | --- |
| `X-Request-ID` | both | correlation id. Sent back on every response; accepted if the client provides one (≤128 chars) |
| `Retry-After` | response | with 429/503 when retrying makes sense |
| `Authorization: Bearer …` | request | Phase 2 |
