# 0015. Drive a sandboxed Playwright browser with Gemini Computer Use for the live QA agent

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** VALT team (hackathon backend + AI)

## Context

Phase 3 ("Sentinel" live QA agent) opens the app the user is building in a real browser, uses it
like a person (click, type, submit) and reports what breaks. It must react to every save, stream each
step to the UI, and stay inside the app under test. Gemini's Computer Use tool returns UI actions
(`click`, `type`, `navigate`, ...) with normalised coordinates; something has to execute them and
screenshot the result.

Constraints: Windows dev machines, where `uvicorn --reload` runs a `SelectorEventLoop` that cannot
spawn subprocesses (Playwright needs one); psycopg needs the Selector loop; a ~75 minute build budget;
the page under test is user-authored and therefore untrusted input to the model.

## Decision

We will:

1. Use **Playwright (Python, Chromium)** as the browser driver, in a new optional `qa` extra
   (`playwright>=1.63,<1.64`). It is imported lazily, so the API boots without it and the `/qa`
   endpoints return `503 qa_unavailable`.
2. Run Playwright **async on a dedicated daemon thread that owns its own `ProactorEventLoop`** (a plain
   new loop off Windows). The API loop talks to it through `run_coroutine_threadsafe` + `wrap_future`.
   This works under any loop uvicorn picks.
3. Implement the computer-use loop as a **plain async loop** (`qa_agent/agent.py`), not a LangGraph
   graph. This is a scoped exception to ADR 0005: one model, one tool, a linear path, no resume, and
   "stop" means cancel. Checkpointing screenshots every step would add cost and nothing else.
4. Keep the Gemini call inside `services/gemini/computer_use.py` (ADR 0014 boundary) behind
   provider-neutral session types in `services/ai/types.py`.
5. Treat the QA agent as **local/dev only**. The Cloud Run image does not install the `qa` extra.

## Alternatives considered

- **Async Playwright on the uvicorn loop** — fails with `NotImplementedError` under `--reload` on Windows.
- **Sync Playwright via `asyncio.to_thread`** — Playwright objects are not thread-safe and the pool
  hops threads.
- **A worker process speaking JSON over a pipe** — more isolated, more code; kept as the fallback.
- **LangGraph `StateGraph` for the loop** — needed only if a human must resume after a
  `require_confirmation` safety decision; today that ends the run instead.

## Consequences

### Positive

- Works on Windows dev boxes regardless of uvicorn mode; the DB stack keeps its Selector loop.
- Loop, guards and executor are unit-testable with fakes (no key, no browser).
- Additive: the feature can be removed by unmounting one router.

### Negative / risks

- A new ~150 MB browser download for developers who run the QA agent.
- The page under test can attempt prompt injection. Mitigated by a network-level host allowlist,
  `enable_prompt_injection_detection`, a secret-typing stop, a step cap, a run timeout, and never
  auto-acknowledging `require_confirmation`.
- Not available in the deployed API.

### Follow-ups

- Move the loop into LangGraph if human approval-and-resume becomes a requirement.
- Ship the `qa` extra (and a browser) in a separate image if the agent must run in the cloud.
