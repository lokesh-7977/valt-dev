# 0005. LangGraph for stateful agent orchestration

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

VALT's AI features are multi-step: call a model, call tools, loop until done, branch on results,
sometimes pause for a human to approve before continuing. These workflows need:

- explicit, inspectable control flow (not a black-box agent loop);
- state that survives across steps and across HTTP requests (multi-turn threads, resume after
  approval);
- streaming of intermediate steps to the UI;
- deterministic tests for the control flow, independent of model output.

## Decision

We will use **LangGraph** as the top-level orchestrator for every AI workflow.

- Each workflow is a `StateGraph` in `valt_api/ai/graphs/<name>.py`, with a typed state
  (`TypedDict` or Pydantic model) and a `build_graph()` function that returns the compiled graph.
- Nodes are small functions that call LangChain models/tools (ADR 0004) or, where role-based
  collaboration fits, a CrewAI crew (ADR 0006).
- **Persistence:** graphs compile with a checkpointer. `thread_id` from the client maps to the
  LangGraph thread, giving multi-turn memory and resumability.
  - Dev/tests: `InMemorySaver`.
  - Production: `langgraph-checkpoint-postgres` (`AsyncPostgresSaver`), opened in the FastAPI
    `lifespan` hook.
- **Human-in-the-loop:** use `interrupt()` inside nodes; the API resumes with `Command(resume=...)`
  on a follow-up request.
- **Streaming:** routers consume `graph.astream(..., stream_mode=["messages", "updates"])` and relay
  events over SSE (ADR 0007).
- We self-host graphs inside FastAPI. LangGraph Platform / LangGraph Server is not adopted.

## Alternatives considered

- **CrewAI as the top-level orchestrator** — good at role-based delegation, but its flow control and
  persistence are less explicit, and it does not integrate with LangChain's streaming. Kept for a
  narrower role (ADR 0006).
- **LangChain `AgentExecutor`** — legacy, single loop, no durable state.
- **Hand-rolled loop** — fine for one agent, but we'd be rebuilding checkpointing, interrupts, and
  streaming.
- **LangGraph Platform** — managed deploys and a built-in API, but a second server next to FastAPI
  and extra cost. Revisit if we outgrow self-hosting.

## Consequences

### Positive

- Control flow is code: reviewable, unit-testable with fake models.
- Durable threads and human approval come from the checkpointer, not custom tables.
- One streaming model for all workflows.

### Negative / risks

- **Introduces Postgres.** The API has no database today; production checkpointing requires one.
  Add a `postgres` service to `docker-compose.yml` and a DB URL to `Settings`.
- Checkpoint state is pickled/serialized graph state; changing a graph's state schema can break
  in-flight threads. Treat state schemas like DB schemas.
- Learning curve for graph/reducer concepts.

### Follow-ups

- ADR for the database (Postgres + pgvector serves checkpoints and vectors) — see ADR 0011.
