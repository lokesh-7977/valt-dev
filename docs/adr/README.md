# Architecture Decision Records

Each ADR records one architectural decision: the context that forced it, what we chose, and what
that choice costs us. ADRs are immutable once accepted — to change a decision, write a new ADR that
supersedes the old one and update the old one's status line.

Format: lightweight [MADR](https://adr.github.io/madr/). Copy [`template.md`](template.md) to
`NNNN-short-title.md` using the next free number.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-monorepo-with-pnpm-and-turborepo.md) | Monorepo with pnpm workspaces and Turborepo | Accepted |
| [0003](0003-fastapi-as-backend-and-ai-runtime.md) | FastAPI as the backend and AI runtime | Accepted |
| [0004](0004-langchain-as-llm-integration-layer.md) | LangChain as the LLM integration layer | Accepted |
| [0005](0005-langgraph-for-agent-orchestration.md) | LangGraph for stateful agent orchestration | Accepted |
| [0006](0006-crewai-for-role-based-multi-agent-tasks.md) | CrewAI for role-based multi-agent tasks, nested under LangGraph | Accepted |
| [0007](0007-stream-ai-responses-over-sse.md) | Stream AI responses to the browser over SSE | Accepted |
| [0008](0008-nextjs-app-router-with-api-rewrite-proxy.md) | Next.js App Router frontend behind a rewrite proxy | Accepted |
| [0009](0009-tanstack-query-for-server-state.md) | TanStack Query for client-side server state | Accepted |
| [0010](0010-shadcn-ui-with-tailwind-css.md) | shadcn/ui on Tailwind CSS v4 for UI components | Accepted |
| [0011](0011-postgres-with-sqlalchemy-and-alembic.md) | PostgreSQL with SQLAlchemy 2.0 (async) and Alembic | Accepted |
| [0012](0012-deploy-api-to-gcp-cloud-run.md) | Deploy the API to GCP Cloud Run with Cloud SQL | Accepted |
| [0013](0013-standard-api-response-envelope.md) | Standard API response envelope | Accepted |
| [0014](0014-gemini-direct-behind-ai-service.md) | Call Gemini directly (google-genai) behind an AIService layer | Accepted |
| [0015](0015-alt-chrome-extension-as-product-surface.md) | Ship ALT as a Chrome MV3 extension (TypeScript + esbuild) | Accepted |

## How the AI decisions fit together

```
Next.js (TanStack Query + shadcn/ui)
   │  /api/py/*  (rewrite, same origin)          ADR 0008, 0009, 0010
   ▼
FastAPI routers  ──  SSE for streamed runs       ADR 0003, 0007
   │
   ▼
LangGraph graph  (state, branching, checkpoints, human-in-the-loop)   ADR 0005
   ├── nodes call LangChain models / tools / retrievers               ADR 0004
   └── a node may kick off a CrewAI crew for role-based collaboration ADR 0006
```
