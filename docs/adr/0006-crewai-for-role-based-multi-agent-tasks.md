# 0006. CrewAI for role-based multi-agent tasks, nested under LangGraph

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

Some VALT tasks are naturally described as a team of specialists — e.g. a researcher gathers
material, an analyst evaluates it, a writer produces the output. CrewAI models exactly this: agents
with a role, goal, and backstory, tasks with expected outputs, and sequential or hierarchical
processes. Expressing the same thing directly in LangGraph means hand-writing each agent's prompt,
delegation, and handoff.

CrewAI and LangGraph overlap, though. Using both without a clear boundary produces two orchestration
models, two places state lives, and two ways to stream progress.

## Decision

We will use **CrewAI** for self-contained, role-based collaboration steps, and **only as a node
inside a LangGraph graph** (ADR 0005). LangGraph remains the sole top-level orchestrator.

- Crews live in `valt_api/ai/crews/<name>.py`, each exposing a function like
  `run_research_crew(inputs) -> ResultModel`.
- A LangGraph node calls the crew, writes its result into graph state, and the graph continues.
  Routers never call crews directly.
- Crew outputs are typed: tasks set `output_pydantic=` so the node gets a Pydantic model, not free
  text.
- Crews run with `kickoff_async()` (or `run_in_threadpool` around `kickoff()`) so they don't block
  the FastAPI event loop.
- Tool logic lives in plain functions under `valt_api/ai/tools/`, exposed through thin wrappers for
  LangChain (`langchain_core.tools.tool`) and CrewAI (`crewai.tools.tool`), so the logic is not
  duplicated between the two stacks.
- **Use CrewAI when** a step needs several distinct personas collaborating or delegating.
  **Use plain LangGraph nodes when** it's a single model call, a tool loop, or anything needing
  fine-grained streaming, interrupts, or checkpointing mid-step.

## Alternatives considered

- **CrewAI only** — loses LangGraph's checkpointing, interrupts, and token streaming.
- **LangGraph only** — workable (supervisor / multi-agent graph patterns), but role-based crews take
  more code. Remains the fallback if CrewAI's cost outweighs its value.
- **CrewAI Flows as the orchestrator** — a second orchestration model competing with LangGraph.

## Consequences

### Positive

- Role-based workflows are short and readable.
- Clear boundary: one orchestrator, crews are black-box steps with typed inputs and outputs.

### Negative / risks

- **A crew is opaque to LangGraph.** No checkpoint or `interrupt()` inside a crew run; if the
  process dies mid-crew the whole step reruns. Keep crews short.
- **Coarse streaming.** Token-level streaming from inside a crew is not surfaced through
  `graph.astream`; the UI shows "crew running" and then the result, plus any step callbacks we
  forward.
- **Second LLM client stack.** CrewAI calls models through its own `LLM` class (LiteLLM), not
  LangChain's `BaseChatModel`. The model factory in `ai/llm.py` must also produce a CrewAI `LLM` from
  the same `Settings` so both paths use the same provider, model, and key.
- **Heavy dependency tree.** CrewAI pins many packages and can conflict with LangChain versions.
  Pin versions, and adopt a lockfile (e.g. `uv lock`) for `apps/api`.
- CrewAI sends anonymous telemetry by default; set `CREWAI_DISABLE_TELEMETRY=true` in
  `.env.example` unless we decide otherwise.
