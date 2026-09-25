# 0007. Stream AI responses to the browser over SSE

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

LLM responses take seconds; agent runs take longer. Waiting for a full JSON response makes the UI
feel broken. The browser needs tokens and step updates as they happen. Traffic is one-directional
(server → client) for the duration of a run; user input arrives as new requests (new message,
resume after interrupt).

Browser calls go through the Next.js rewrite `/api/py/*` → FastAPI (ADR 0008).

## Decision

We will stream AI runs as **Server-Sent Events** from FastAPI.

- Endpoint pattern: `POST /api/<feature>/runs` with the input and `thread_id`, responding
  `text/event-stream` via `StreamingResponse`.
- The router iterates `graph.astream(...)` (ADR 0005) and maps LangGraph events to a small, typed
  event vocabulary:

  | event | data |
  | --- | --- |
  | `token` | text delta from the model |
  | `step` | node started/finished, crew started/finished |
  | `interrupt` | payload the UI must answer before resuming |
  | `done` | final structured result |
  | `error` | message safe to show the user |

  Event payload shapes are Pydantic models in `schemas.py` and mirrored in `@valt/shared`.
- The client reads the stream with `fetch` + `ReadableStream` (not `EventSource`, which only supports
  GET), in a hook in `apps/web/src/lib/`.
- Set `Cache-Control: no-cache` and `X-Accel-Buffering: no`; verify the Next.js rewrite does not
  buffer the stream in production.

## Alternatives considered

- **WebSockets** — bidirectional, but we don't need it; harder to proxy through the Next rewrite
  and needs its own auth/reconnect handling.
- **Polling a run status endpoint** — simple, but no token streaming and needs server-side run
  storage.
- **Vercel AI SDK data-stream protocol** — nice client hooks, but ties our event format to another
  library; can be adopted later by emitting its protocol from FastAPI if wanted.

## Consequences

### Positive

- Plain HTTP; works through the existing rewrite and same-origin setup, no CORS.
- One event vocabulary for all AI features, so UI streaming components are reusable.

### Negative / risks

- Long connections: proxies and serverless hosts may cut idle streams. Send periodic keep-alive
  comments (`: ping`).
- A dropped connection loses in-flight tokens. The checkpointer keeps graph state, so the client
  can refetch the thread, but mid-token output is not replayed.
