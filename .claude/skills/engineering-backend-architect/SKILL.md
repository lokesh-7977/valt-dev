---
name: engineering-backend-architect
description: "Design and build VALT's FastAPI backend (apps/api) and its AI layer — LangChain models/tools, LangGraph graphs, CrewAI crews, and SSE streaming of agent runs. Use when adding or changing API endpoints, Pydantic schemas, settings, AI workflows, agent tools, checkpointing, database/migration work, or when debugging blocked event loops, broken streams, or LLM dependency conflicts."
metadata:
  version: "2.0.0"
  adapted-from: "PeterHdd/agent-skills engineering-backend-architect (MIT)"
---

# VALT Backend Guide (FastAPI + LangChain + LangGraph + CrewAI)

Decisions behind these rules live in `docs/adr/` — read the ADR before arguing with a rule. If a
change contradicts an accepted ADR, write a new ADR rather than silently diverging.

## Stack and layout

```
apps/api/src/valt_api/
  main.py        app factory + lifespan (open pools, build graphs)         ADR 0003
  config.py      Settings (pydantic-settings, API_ prefix)
  schemas.py     Pydantic request/response + SSE event models (mirror in packages/shared)
  routers/       HTTP only: validate, call ai/ or services, shape response
  ai/
    llm.py       model factory — LangChain chat model AND CrewAI LLM        ADR 0004, 0006
    tools/       LangChain @tool definitions
    graphs/      LangGraph StateGraphs, one module per workflow             ADR 0005
    crews/       CrewAI crews, each a typed async function                  ADR 0006
```

Import direction: `routers → ai → (llm, tools)`. `ai/` never imports FastAPI. Routers never call
crews directly — only graphs.

## API decision rules

- Every endpoint has a Pydantic request and response model in `schemas.py`, and `response_model=`
  on the route. Mirror the shape in `packages/shared/src/index.ts` in the same PR (ADR 0002).
- All routers mount under `/api`; the browser reaches them as `/api/py/*` via the Next rewrite
  (ADR 0008). Don't add CORS-only paths.
- Inject settings and shared objects with `Annotated[..., Depends(...)]` (see `routers/health.py`).
  Never read `os.environ` outside `config.py`; secrets are `SecretStr` fields on `Settings`.
- Handlers are `async def`. Anything synchronous and slow (CrewAI `kickoff()`, sync SDKs, CPU-heavy
  parsing) goes through `await run_in_threadpool(...)` or its async variant — a blocking call in an
  async route stalls every request on the worker.
- Long-lived clients (DB pool, checkpointer, HTTP clients, compiled graphs) are created once in
  `lifespan` and stored on `app.state`; handlers get them through a dependency.
- Errors: raise `HTTPException` with a stable, user-safe `detail`. Never return provider error text
  or stack traces — they can leak prompts, keys, or internal URLs.
- Use cursor pagination for any list that can grow unbounded; always cap `limit`.
- Version with a URL prefix (`/api/v2/...`) only when a breaking change must coexist with old
  clients; the web app ships with the API, so most changes don't need a version.

## AI decision rules

### Which tool for which job
- **Single model call / structured extraction** → LangChain model from `ai/llm.py` with
  `.with_structured_output(Model)`. No graph needed.
- **Multi-step, tool loop, branching, memory, human approval** → LangGraph graph.
- **Several distinct personas collaborating on one self-contained step** → CrewAI crew, called from
  a LangGraph node. If you can't name at least two roles with different goals, it's not a crew.

### Models
- Always get models from `ai/llm.py` (`get_chat_model()`, `get_crew_llm()`). Never construct
  `ChatOpenAI` / `ChatAnthropic` / `crewai.LLM` inline — provider, model, key, and temperature come
  from `Settings` so both stacks stay on the same model.
- Set explicit `max_tokens` and `timeout` on models used in request paths.
- Prefer `with_structured_output(PydanticModel)` over parsing free text.

### Graphs (LangGraph)
- One workflow per module in `ai/graphs/`, exposing `build_graph(checkpointer, *, model=None)`.
  Accepting `model` makes the graph testable with a fake model.
- State is a `TypedDict`; message lists use `Annotated[list[AnyMessage], add_messages]`.
- Store plain data in state (dicts, primitives, messages) — treat the state schema like a DB schema.
  Renaming or retyping a key breaks in-flight threads saved by the checkpointer.
- Compile with a checkpointer: `InMemorySaver` in dev/tests, `AsyncPostgresSaver` when
  `API_DATABASE_URL` is set. The client's `thread_id` goes in `config["configurable"]["thread_id"]`.
- Human approval uses `interrupt(payload)` in a node and resumes with `Command(resume=value)`.
  Any tool with side effects (sending email, writing data, spending money) must pass through an
  interrupt before it runs.
- Pass `recursion_limit` in the run config (default 25) — an agent/tool loop without a cap is a
  cost incident waiting to happen.

### Crews (CrewAI)
- Each crew is `async def run_<name>_crew(...) -> ResultModel` in `ai/crews/`. The final task sets
  `output_pydantic=ResultModel`; the function returns that model or raises.
- Run with `await crew.kickoff_async(inputs=...)`. Never call `kickoff()` on the event loop.
- Keep crews short: they are not checkpointed internally, so a crash reruns the whole crew.
- Shared tool logic lives in plain functions; expose thin wrappers for LangChain (`@tool` from
  `langchain_core.tools`) and CrewAI (`@tool` from `crewai.tools`) rather than duplicating logic.
- `CREWAI_DISABLE_TELEMETRY=true` in every environment unless the team decides otherwise.

### Streaming (ADR 0007)
- Runs are `POST /api/<feature>/runs` returning `StreamingResponse(media_type="text/event-stream")`.
- Only emit the event vocabulary in ADR 0007: `token`, `step`, `interrupt`, `done`, `error`. Each
  payload is a Pydantic model in `schemas.py`, mirrored in `packages/shared`.
- Source events from `graph.astream(..., stream_mode=["messages", "updates"])`. `messages` → `token`;
  `updates` → `step`; an `__interrupt__` key in an update → `interrupt`.
- Headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Send a `: ping` comment every ~15s
  on long runs so proxies don't close idle connections.
- Catch exceptions inside the generator and emit `error` — once headers are sent you can't change the
  status code.

### AI security
- Retrieved documents, tool outputs, web pages, and user uploads are **untrusted input**. They can
  contain instructions ("ignore previous instructions…"). Never let them choose which tool runs with
  side effects without an interrupt, and never place secrets in any prompt.
- Tools get the narrowest capability possible: read-only DB roles, allow-listed URLs, scoped IDs
  taken from the authenticated user, not from model output.
- Rate-limit run endpoints per user (tighter than CRUD: ~5–10 runs/min) and log token usage per run.
- Validate model output with Pydantic before acting on it.

## Data and persistence rules

Postgres + async SQLAlchemy 2.0 + Alembic + pgvector (ADR 0011). Detailed rules and code live in the
`postgres-sqlalchemy` skill — load it for any model, migration, or query work. Summary:
- One Postgres instance serves checkpoints, app tables, and vectors (pgvector) until load proves
  otherwise. Add it to `docker-compose.yml` and `API_DATABASE_URL` to `Settings`.
- Every schema change ships as a migration. Adding a column: nullable or with a default. Renaming:
  expand → dual-write → migrate reads → drop. Large-table indexes: `CREATE INDEX CONCURRENTLY`.
- Constraints (NOT NULL, UNIQUE, FK, CHECK) live in the database, not only in Pydantic.
- Parameterized queries only — never format user or model output into SQL.
- Run `EXPLAIN ANALYZE` on new query paths against realistic data; no sequential scans on tables
  that will exceed ~10k rows.
- Use `scripts/analyze_schema.py <file.sql>` to spot tables missing primary keys or indexes.

## Reliability rules

- Health: keep `/api/health` as liveness. When a DB exists, add `/api/health/ready` that checks it.
  `scripts/check_api_health.sh http://localhost:8000` probes both.
- Wrap LLM provider calls with retries on 429/5xx with jittered backoff (LangChain models accept
  `max_retries`). Do not retry `POST .../runs` from the client — a retry starts a second run.
- Cache only deterministic, non-personal results (e.g. embeddings of a document by content hash);
  set a TTL and an invalidation rule before adding the cache.
- Pin `langchain*`, `langgraph*`, and `crewai` versions in `pyproject.toml`. Upgrade them together in
  a dedicated PR and run the full test suite.

## Self-verification protocol

After any backend change, from the repo root:
1. `pnpm --filter @valt/api lint` (ruff) and `pnpm --filter @valt/api typecheck` (mypy strict) pass.
2. `pnpm --filter @valt/api test` passes. New endpoints have tests for success, invalid input (422),
   and not-found/forbidden paths.
3. New graphs have a test that runs the graph with a fake model and asserts the path through nodes —
   no real LLM calls in tests.
4. Streaming endpoints: `curl -N -X POST localhost:8000/api/<feature>/runs -H 'content-type: application/json' -d '{...}'`
   prints events incrementally, not all at the end. Repeat through `localhost:3000/api/py/...` to
   confirm the Next rewrite doesn't buffer.
5. `packages/shared/src/index.ts` matches any schema you changed.
6. No secrets, keys, or `.env` values in code, logs, prompts, or test fixtures.

## Failure recovery

- **Whole API stalls during a run**: something sync is running on the event loop — CrewAI
  `kickoff()`, a sync SDK call, `time.sleep`. Move to `kickoff_async` / `run_in_threadpool`.
- **Stream arrives all at once**: a proxy or compression layer is buffering. Check headers above,
  Next's `compress` setting, and any nginx in front. Test FastAPI directly with `curl -N` first.
- **`app.state` has no attribute `<graph>` in tests**: `httpx.ASGITransport` doesn't run `lifespan`.
  Set `app.state.<graph>` in the test fixture (see `references/ai-patterns.md`).
- **Old threads crash after a deploy**: the graph state schema changed. Make new keys optional with
  defaults; never rename keys in place.
- **`pip` resolver conflict after adding crewai/langchain**: pin both to known-compatible versions,
  upgrade together, and commit a lockfile (`uv lock`).
- **Agent loops until `GraphRecursionError`**: the model keeps calling tools. Tighten the tool
  descriptions, return clearer tool errors, and lower `recursion_limit`.
- **Provider 429s under load**: add backoff, lower concurrency per user, and check whether a crew is
  fanning out more calls than expected (each agent step is at least one LLM call).

## References

- [FastAPI patterns](references/fastapi-patterns.md) — settings, routers, dependencies, lifespan,
  errors, tests in this repo's style.
- [AI patterns](references/ai-patterns.md) — model factory, tools, LangGraph graph with
  checkpointer and interrupt, CrewAI crew as a node, SSE run endpoint, fake-model tests.

## Scripts

- `scripts/check_api_health.sh <base-url>` — probes health endpoints (status, latency, content
  type only; never reads bodies).
- `scripts/analyze_schema.py <file.sql>` — tables, PKs, FKs, and missing indexes from DDL.
