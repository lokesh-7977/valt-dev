# AI Workflow Hardening — Engineering Plan

**PRD:** none. This plan comes directly from a gap review of the Phase 1 Gemini workflow (2026-09-25). · **Date:** 2026-09-25 · **Tasks:** 15

## Approach
Harden the existing generic Gemini backend (ADR 0014) without restructuring it. The work comes in three parts:
1. Close the security and correctness gaps: the open proxy, the dropped injection guard, silent stream truncation, oversized inline requests, and unbounded client schemas.
2. Make quality and cost measurable with an eval set and one structured log line per model call.
3. Persist AI runs so results survive a refresh and later evals can use real traffic.

All model-call policy (guard, size cap, telemetry, retry feedback, fallback) goes in `AIService`, so routers stay HTTP-only and `GeminiClient` stays the only module that imports the SDK.

### Decision: large attachments
- **Chosen:** cap the total inline bytes per request (default 90 MB, below Gemini's 100 MB inline limit). This is one check in `AIService.build_parts` with a clear `payload_too_large` error.
- **Rejected:** the Gemini Files API. It adds per-file state that expires after 48 h, extra upload latency and a cleanup path, and nothing in v1 needs more than 90 MB.

### Decision: rate limiting
- **Chosen:** an in-process token bucket per client IP plus an instance-wide cap, as a FastAPI dependency. It needs no new dependency and no ADR, and it is enough for the demo (Cloud Run `MAX_INSTANCES=5`, so the effective limit is at most 5× per IP).
- **Rejected:** `slowapi` or Redis-backed limits. That means a new dependency or new infrastructure plus an ADR, and belongs with billing and quotas in Phase 9.

## Research notes
- Inline request data: use the Files API when the total request is over **100 MB**; PDFs are capped at **50 MB**. Files API: 2 GB per file, 48 h retention. https://ai.google.dev/gemini-api/docs/files (checked 2026-09-25)
- Installed `google-genai==2.25.0` (checked in `apps/api/.venv`): `types.Candidate` has `finish_reason`, and the stream yields `GenerateContentResponse` chunks, so the last chunk's `candidates[0].finish_reason` can be read the same way `_text_or_raise` reads it. `AsyncFiles.upload(*, file, config)` exists but is not used (see the decision above).
- `apps/api/src/valt_api/core/logging.py:19` `_JsonFormatter` writes a fixed set of keys and drops `extra=` fields, so T7 must extend it.
- `infra/gcp/config.env.example:13` sets `MAX_INSTANCES=5`, so in-memory limits apply per instance.
- The web client never sends `system` (grep of `apps/web/src`), so gating it in T2 does not break the UI.

## AI design
- **Shape:** unchanged. Each endpoint makes a single model call. Nothing here needs a graph; LangGraph, tools and RAG stay in roadmap Phases 3–6.
- **Context:** user text wrapped in `<user_input>`, files inline. `INPUT_GUARD` is now always present in the system prompt (T1).
- **Limits:**
  - per-IP 10 req/min and instance-wide 60 req/min on AI routes, both configurable (T3)
  - 90 MB of inline attachments (T5)
  - `output_schema` ≤ 16 KB and nesting depth ≤ 10 (T6)
  - at most one structured retry, now with the validation error fed back (T8)
  - at most one fallback-model attempt (T9)
- **Eval:** T14. About 30 cases across `/analyze` (default shape) and `/process` (`extract`, `classify`, `answer`): easy, hard, prompt-injection inside the input and inside an attached text file, and unanswerable cases. Launch bar: 100% schema-valid, 0 injection cases where the model follows the injected instruction, and at least 90% on the deterministic checks.
- **Budget math:** one eval run is about 30 calls × ~2.5k input + ~0.5k output tokens, roughly 75k input and 15k output tokens. Multiply by the current `API_GEMINI_MODEL` price from https://ai.google.dev/gemini-api/docs/pricing when running it. At runtime nothing changes except the fallback path: in the worst case one failed call is followed by one fallback call, at most 2× per request.

## Touch points
| File | Line | What changes |
|------|------|--------------|
| apps/api/src/valt_api/services/ai/service.py | 54, 105, 144 | guard on every system prompt, inline size cap, retry feedback, telemetry, fallback |
| apps/api/src/valt_api/routers/ai.py | 50, 69–86, 104, 121 | reject client `system`, rate-limit dependency, run recording |
| apps/api/src/valt_api/services/gemini/client.py | 100–114 | read the last chunk's `finish_reason` |
| apps/api/src/valt_api/schemas.py | 103 | bound `output_schema`; add run response models |
| apps/api/src/valt_api/config.py | 44–45 | new settings |
| apps/api/src/valt_api/core/errors.py | 530 | `AppError` carries headers (`Retry-After`) |
| apps/api/src/valt_api/core/logging.py | 19 | JSON formatter emits `fields` extras |
| apps/api/src/valt_api/deps.py | 375 | pass fallback model and settings into `AIService` |
| apps/api/src/valt_api/services/storage/local.py | 17 | `purge_older_than` |
| apps/api/src/valt_api/main.py | 268, 95 | lifespan purge task; mount runs router |
| apps/web/src/components/ai/result-blocks.tsx | 12 | confidence labelled as the model's own estimate |
| apps/web/src/lib/errors.ts | 11 | copy for `rate_limited` |
| packages/shared/src/index.ts | 111, 147 | `AiRun` types; `done` event data |

## Tasks

### [ ] T1 — Always apply INPUT_GUARD to the system prompt
- **Owner:** ai-engineer
- **Files:** `apps/api/src/valt_api/prompts/base.py`, `apps/api/src/valt_api/services/ai/service.py`, `apps/api/src/valt_api/routers/ai.py`
- **Change:** Add `with_guard(system: str | None) -> str` in `prompts/base.py`, returning `INPUT_GUARD` alone or `f"{system}\n\n{INPUT_GUARD}"`, without doubling the guard if it is already present. Apply it in `AIService` at the single point where options reach the client (a private `_opts()` used by `text`, `json`, `structured` and `stream`), so both the `merge_options` override path (`service.py:144`) and the free-prompt path (`routers/ai.py:86`) are covered.
- **Done when:** a test using `FakeModelClient` shows `calls[-1].options.system` ends with `INPUT_GUARD` for `/generate` with a prompt only, with a template plus `system`, and for `/process`. `pytest` passes.
- **Depends on:** none

### [ ] T2 — Reject client-supplied `system` unless enabled
- **Owner:** backend-engineer
- **Files:** `apps/api/src/valt_api/config.py`, `apps/api/src/valt_api/routers/ai.py`, `apps/api/.env.example`, `docs/api/conventions.md`
- **Change:** Add a setting `allow_client_system_prompt: bool = False`. When it is false and `payload.system` is set, `_prepare_generate` raises `AppError(422, "system_prompt_disabled", ...)`. Document the code in the error table.
- **Done when:** `/generate` with `system` returns 422 `system_prompt_disabled` by default and 200 when `API_ALLOW_CLIENT_SYSTEM_PROMPT=true`.
- **Depends on:** T1 (same router function)

### [ ] T3 — Rate-limit AI and upload routes
- **Owner:** backend-engineer
- **Files:** `apps/api/src/valt_api/core/rate_limit.py` (new), `apps/api/src/valt_api/core/errors.py`, `apps/api/src/valt_api/config.py`, `apps/api/src/valt_api/routers/ai.py`, `apps/api/src/valt_api/routers/files.py`, `apps/api/.env.example`
- **Change:**
  - Add an optional `headers` field to `AppError`, and have `_app_error` pass it into the `JSONResponse`.
  - Add `rate_limit.py`: an in-memory token bucket keyed by client IP plus a global bucket, with an async-safe dict and pruning of idle keys.
  - Client IP is `request.client.host`, or the entry `trusted_proxy_hops` from the right of `X-Forwarded-For` when that setting is > 0.
  - Settings: `ai_rate_per_minute=10`, `ai_global_rate_per_minute=60`, `trusted_proxy_hops=0`.
  - Add `dependencies=[Depends(ai_rate_limit)]` on the `ai` and `files` routers.
  - Over the limit, raise `AppError(429, "rate_limited", ..., headers={"Retry-After": n})`.
- **Done when:** the 11th `/generate` call inside a minute from one IP returns 429 `rate_limited` with a `Retry-After` header, `/api/v1/health` is never limited, and `pytest` passes (the test fixture resets the buckets).
- **Depends on:** T2 (same router file)

### [ ] T4 — Surface mid-stream safety blocks and truncation
- **Owner:** ai-engineer
- **Files:** `apps/api/src/valt_api/services/gemini/client.py`
- **Change:** In `stream_text` (`client.py:100`), remember `chunk.candidates[0].finish_reason` for each chunk. After the loop, raise `AIBlockedError` if it is in `_BLOCKED`, or `AIInvalidOutputError("AI hit the output token limit before answering")` if it is `MAX_TOKENS`. `stream_tokens` in `core/sse.py` already turns these into an `error` event.
- **Done when:** a unit test that feeds fake SDK chunks (monkeypatching `generate_content_stream`) ending with `SAFETY` produces an `error` event with code `ai_blocked` and no `done`.
- **Depends on:** none

### [ ] T5 — Cap total inline attachment bytes per request
- **Owner:** ai-engineer
- **Files:** `apps/api/src/valt_api/services/ai/service.py`, `apps/api/src/valt_api/core/errors.py`, `apps/api/src/valt_api/config.py`, `apps/api/src/valt_api/deps.py`
- **Change:**
  - Add a setting `max_inline_mb: int = 90`.
  - `AIService.__init__` takes `max_inline_bytes`, passed by `deps.get_ai_service` from settings.
  - `build_parts` (`service.py:54`) adds up `meta.size_bytes` as it reads files and raises `PayloadTooLargeError` with the message "attachments exceed N MB in total" once the total is over the cap.
- **Done when:** 3 uploaded files with the cap set to 1 MB in the test make `/analyze` return 413 `payload_too_large`.
- **Depends on:** T1 (same file)

### [ ] T6 — Bound client `output_schema`
- **Owner:** backend-engineer
- **Files:** `apps/api/src/valt_api/schemas.py`, `packages/shared/src/index.ts`
- **Change:** Add a `field_validator("output_schema")` on `AnalyzeRequest` (`schemas.py:103`) that rejects a schema whose `json.dumps` is over 16 KB or whose nesting depth is over 10. Add a TS doc comment on `AnalyzeRequest.output_schema` stating the limits. No change to the type's shape.
- **Done when:** a deeply nested schema returns 422 `validation_error`, and the existing `/analyze` tests pass.
- **Depends on:** none

### [ ] T7 — One structured telemetry line per model call
- **Owner:** ai-engineer
- **Files:** `apps/api/src/valt_api/core/logging.py`, `apps/api/src/valt_api/services/ai/service.py`
- **Change:**
  - `_JsonFormatter` merges `record.fields` (a dict passed via `extra={"fields": {...}}`) into the entry. The text formatter appends them as `k=v`.
  - `AIService` wraps each client call to log `ai_call` with `op` (text/json/structured/stream), `task` (the template name when known), `model`, `latency_ms`, `input_tokens`, `output_tokens`, `attempt` and `outcome` (`ok` or the error code).
  - For `stream`, log once when the stream ends. Never log prompt text or file names.
- **Done when:** with `API_LOG_JSON=true`, one `/process` call prints exactly one `ai_call` JSON line containing those keys and the request id.
- **Depends on:** T5 (same file)

### [ ] T8 — Feed the validation error back on the structured retry
- **Owner:** ai-engineer
- **Files:** `apps/api/src/valt_api/services/ai/service.py`
- **Change:** In `structured` (`service.py:105`), when attempt 1 fails with a `ValidationError`, append a text part to attempt 2: "Your previous reply did not match the schema: <loc: msg list>. Reply again with JSON that matches it exactly." Use only `loc`, `msg` and `type`, never the input values.
- **Done when:** a `FakeModelClient` with `json_replies=[invalid, valid]` succeeds and `calls[1].parts[-1]` contains the failing field's `loc`.
- **Depends on:** T7 (same file)

### [ ] T9 — Fall back to a second model on rate-limit and upstream errors
- **Owner:** ai-engineer
- **Files:** `apps/api/src/valt_api/config.py`, `apps/api/src/valt_api/deps.py`, `apps/api/src/valt_api/services/ai/service.py`, `apps/api/.env.example`, `infra/gcp/config.env.example`
- **Change:**
  - Add a setting `gemini_fallback_model: str | None = None`.
  - In `AIService`, when a call raises `AIRateLimitedError` or `AIUpstreamError` and a fallback is set, retry once with `options.model = fallback` and log `attempt=2, fallback=true`. Timeouts are not retried, because that would double latency.
  - For `stream`, fall back only if no token has been yielded yet.
  - The response's `model` field reports the model that actually answered.
- **Done when:** a `FakeModelClient` that raises `AIRateLimitedError` only for the default model returns 200 with `model == fallback`, and with no fallback set it still returns 429.
- **Depends on:** T8 (same file)

### [ ] T10 — Label confidence as the model's own estimate
- **Owner:** frontend-engineer
- **Files:** `apps/web/src/components/ai/result-blocks.tsx`
- **Change:** In `ConfidenceMeter` (`result-blocks.tsx:12`), change the label to "Model's confidence" and add a `Tooltip` (existing `components/ui/tooltip.tsx`): "The AI's own estimate. It isn't measured, so check important details."
- **Done when:** `/analyze` results and `/kit` show the new label and tooltip, and `pnpm --filter @valt/web typecheck` passes.
- **Depends on:** none

### [ ] T11 — Add `ai_runs` table, model, and repository
- **Owner:** database-engineer
- **Files:** `apps/api/src/valt_api/db/models/ai_runs.py` (new), `apps/api/src/valt_api/db/models/__init__.py`, `apps/api/src/valt_api/db/repositories/ai_runs.py` (new), `apps/api/migrations/versions/20260925_0002_create_ai_runs.py` (new)
- **Change:**
  - Add `AiRunRow` (`TimestampMixin`) with these columns:
    - `id` UUID primary key
    - `kind` (`analyze`/`process`/`generate`) and `task` (nullable)
    - `status` (`succeeded`/`failed`) and `error_code` (nullable)
    - `model`
    - `input_chars` and `file_count`
    - `output` JSONB (nullable)
    - `input_tokens`, `output_tokens`, `latency_ms`
    - `request_id`
  - Index `(created_at DESC, id DESC)` for keyset pagination.
  - Repository: `create()`, `get()`, and `list(limit, cursor)` following the `repositories/items.py` pattern (flush only).
  - Raw input text is **not** stored (PII); only its length.
- **Done when:** `pnpm db:migrate` then `alembic downgrade -1` both succeed, and the db-marked tests pass with `API_TEST_DATABASE_URL`.
- **Depends on:** none

### [ ] T12 — Record runs and expose `GET /runs`
- **Owner:** backend-engineer
- **Files:** `apps/api/src/valt_api/routers/runs.py` (new), `apps/api/src/valt_api/routers/ai.py`, `apps/api/src/valt_api/main.py`, `apps/api/src/valt_api/schemas.py`, `packages/shared/src/index.ts`, `apps/web/src/lib/api.ts`
- **Change:**
  - After `/analyze`, `/process` and `/generate` succeed or fail, record a run on a fresh session from `app.state.sessionmaker` (committed once). Recording is skipped silently when no DB is configured, and a failed write is logged but never fails the request.
  - Return `run_id: str | None` in `AnalyzeResponse`, `ProcessResponse` and `GenerateResponse`.
  - New `GET /api/v1/runs` (keyset-paginated) and `GET /api/v1/runs/{id}`, using the `AiRun` schema.
  - Mount the new router in `main.py:95`.
  - Mirror the types in `@valt/shared` (`/sync-contract`) and add `listRuns` and `getRun` to `lib/api.ts`.
- **Done when:** with a DB, `/process` returns `run_id` and `GET /runs/{run_id}` returns it. Without a DB, `/process` still returns 200 with `run_id: null`. `pnpm typecheck` passes.
- **Depends on:** T3, T11

### [ ] T13 — Purge expired uploads
- **Owner:** backend-engineer
- **Files:** `apps/api/src/valt_api/services/storage/base.py`, `apps/api/src/valt_api/services/storage/local.py`, `apps/api/src/valt_api/config.py`, `apps/api/src/valt_api/main.py`
- **Change:**
  - Add `purge_older_than(age: timedelta) -> int` to the `FileStorage` protocol and `LocalFileStorage` (it compares `created_at` in the `.json` metadata files).
  - Add the setting `upload_ttl_hours: int = 24`.
  - In `lifespan` (`main.py:268`), start an `asyncio` task that purges every 30 minutes and is cancelled on shutdown.
- **Done when:** a unit test stores a file with a backdated `created_at`, `purge_older_than` removes it and returns 1, and a new file survives.
- **Depends on:** T12 (both edit `main.py`)

### [ ] T14 — Eval set for `/analyze` and `/process`
- **Owner:** ai-engineer
- **Files:** `apps/api/evals/common.py` (new), `apps/api/evals/workflow/cases.jsonl` (new), `apps/api/evals/workflow/run.py` (new), `.gitignore`
- **Change:**
  - Follow the `ai-eval` skill layout with about 30 cases: analyze-default, extract fields, classify, answer (including unanswerable), and prompt injection inside `text` and inside an attached `.txt` file.
  - Scoring is schema validity plus deterministic checks (`contains`, `answerable == false`, injected token absent). Record latency and tokens per case.
  - The runner calls `AIService` directly with the real `GeminiClient`.
  - Add `apps/api/evals/**/results/` to `.gitignore`.
- **Done when:** `cd apps/api && .venv/Scripts/python -m evals.workflow.run` prints a score table and meets the launch bar in "AI design". It never runs in `pnpm test`.
- **Depends on:** T1, T8

### [ ] T15 — User copy for new error codes
- **Owner:** frontend-engineer
- **Files:** `apps/web/src/lib/errors.ts`
- **Change:** Add `BY_CODE` entries for `rate_limited` ("Slow down a little", retryable) and `system_prompt_disabled` (not retryable), and update the `payload_too_large` description to mention the total attachment size.
- **Done when:** `pnpm --filter @valt/web typecheck` passes, and a forced 429 in the UI shows the new copy with Retry.
- **Depends on:** T2, T3

## Order
- **Critical path:** T1 → T5 → T7 → T8 → T9, and T1 → T2 → T3 → T12 → T13.
- **Parallel from the start:** T4, T6, T10, T11 (no shared files).
- **Later:** T14 after T1 and T8; T15 after T3.

## Deferred (not in this plan)
- **Streaming `/analyze` with real progress (gap 12):** partial JSON streaming needs its own UI and contract design. Do it with Phase 3 chat streaming.
- **Multi-turn follow-ups (gap 13):** Phase 3 (threads, history, checkpointing).
- **Result cache (gap 15):** do it after T12, since the cache key can reuse the run table.
- **GCS storage and upload ownership (rest of gap 14):** ownership needs auth (Phase 2). GCS is needed once `MAX_INSTANCES > 1` has to share uploads.
- **Gemini Files API:** only needed once attachments go over 90 MB.

## Risks
- **The limiter is per instance and the IP can be spoofed.** With `trusted_proxy_hops` misconfigured, anyone can set `X-Forwarded-For`. The default of 0 uses the socket IP; set it to 1 on Cloud Run and verify against real traffic. This is not a substitute for auth (Phase 2).
- **The `finish_reason` field may differ across SDK versions.** T4's test pins the behaviour, and the SDK is already pinned `<3`.
- **Recording runs adds DB latency to AI calls.** It is one insert on its own session, and failures are swallowed. Moving it to a background task is possible if p95 latency moves.
- **The fallback model can return a different output quality.** Run the T14 eval against the fallback model before enabling it in production.

## Rollback
Each task is one commit. Revert commits individually. To undo T11, run `alembic downgrade -1` before reverting it. Settings-gated behaviour (T2 client system prompt, T9 fallback) can also be switched off through env vars without a deploy of new code.
