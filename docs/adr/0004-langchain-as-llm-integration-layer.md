# 0004. LangChain as the LLM integration layer

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

The backend needs to talk to LLMs, define tools the models can call, load and split documents,
embed them, and query a vector store. Writing directly against one provider's SDK couples every
feature to that provider and means re-implementing tool-calling schemas, retries, structured output,
and retrieval plumbing.

## Decision

We will use **LangChain** (`langchain-core` plus per-provider `langchain-<provider>` packages) as the
integration layer for models, prompts, tools, structured output, and retrieval.

- **Models:** one factory in `valt_api/ai/llm.py` returns a `BaseChatModel` configured from
  `Settings` (provider, model name, temperature, API key). Features ask the factory for a model;
  they never construct provider classes themselves. Swapping provider or model is a config change.
- **Tools:** defined with `@tool` / `StructuredTool` in `valt_api/ai/tools/`, with Pydantic arg
  schemas, so the same tool works in plain chains and LangGraph nodes.
- **Structured output:** `model.with_structured_output(PydanticModel)` rather than parsing free text.
- **Retrieval:** LangChain loaders, splitters, embeddings, and vector-store retrievers.
- **Scope:** LangChain supplies building blocks. Multi-step control flow is LangGraph's job
  (ADR 0005) — we do not use legacy `AgentExecutor` or long LCEL pipelines for agent logic.
- **Dependencies:** install `langchain` (for `init_chat_model`), `langchain-core`, and only the
  specific integration packages we use, not the `langchain-community` catch-all, unless an
  integration exists only there.

## Alternatives considered

- **Provider SDK directly** — least abstraction, but locks features to one vendor and duplicates
  tool/retrieval plumbing.
- **LlamaIndex** — strong for retrieval, weaker fit with LangGraph, and a second abstraction layer.
- **LiteLLM alone** — unifies model calls but not tools, retrieval, or structured output.

## Consequences

### Positive

- Provider-agnostic model access; one place to change models.
- Shared tool and retriever abstractions across chains, LangGraph, and (via adapters) CrewAI.
- Optional tracing via LangSmith by setting `LANGSMITH_TRACING` / `LANGSMITH_API_KEY`.

### Negative / risks

- LangChain releases often and has broken APIs between minors. Pin versions in `pyproject.toml` and
  upgrade deliberately.
- Abstractions can hide provider-specific features (prompt caching, reasoning controls). Pass them
  through the model factory rather than bypassing it ad hoc.

### Follow-ups

- Choose the default LLM provider and model; record in `Settings` and `.env.example`.
- Choose a vector store (e.g. pgvector, which would reuse the Postgres needed by ADR 0005).
