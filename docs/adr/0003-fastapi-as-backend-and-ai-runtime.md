# 0003. FastAPI as the backend and AI runtime

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

VALT's core features are AI workflows built on LangChain, LangGraph, and CrewAI. All three are
Python-first; LangChain.js and LangGraph.js exist but lag the Python versions, and CrewAI has no JS
equivalent. The AI code therefore runs in Python, and needs an HTTP layer that:

- is async, because LLM calls are long, I/O-bound waits;
- can stream partial output (tokens, agent steps) to the browser;
- validates request/response shapes and publishes a schema the frontend can consume.

## Decision

We will use **FastAPI** (`apps/api`) as the single backend, hosting both ordinary CRUD endpoints and
all AI workflows. Conventions:

- App factory in `valt_api/main.py`; routers under `valt_api/routers/`, all mounted at `/api`.
- Configuration via `pydantic-settings` (`valt_api/config.py`, `API_` env prefix). LLM provider keys
  are added as `Settings` fields and passed explicitly to model constructors — AI code never reads
  `os.environ` directly.
- Request/response models in Pydantic v2 (`valt_api/schemas.py`), which also drive `/openapi.json`.
- AI code lives in its own package, kept separate from HTTP concerns:

  ```
  valt_api/ai/
    llm.py       model factory (ADR 0004)
    tools/       LangChain tools
    graphs/      LangGraph graphs (ADR 0005)
    crews/       CrewAI crews (ADR 0006)
  ```

  Routers call into `ai/`; `ai/` never imports FastAPI.
- Long-lived clients (checkpointer DB pool, vector store, HTTP clients) are opened in the `lifespan`
  hook in `main.py`, not per request.

## Alternatives considered

- **Next.js route handlers + LangChain.js** — one language, but loses CrewAI and trails the Python
  LangGraph feature set.
- **Django / DRF** — sync-first; async and streaming are bolted on.
- **Flask** — no native async or schema generation.

## Consequences

### Positive

- First-class access to the Python AI ecosystem.
- Native async and `StreamingResponse` fit LLM latency and streaming (ADR 0007).
- OpenAPI docs at `/docs` for free.

### Negative / risks

- Two languages to maintain; types cross the boundary via OpenAPI.
- CrewAI and some LangChain integrations are synchronous. Calling them directly in an `async def`
  route blocks the event loop — use their async variants or `run_in_threadpool`.
- Multi-minute agent runs don't fit a request/response cycle forever. When runs exceed what an SSE
  connection can reasonably hold, move them to a background worker (separate ADR).
