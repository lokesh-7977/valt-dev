# 0008. Next.js App Router frontend behind a rewrite proxy

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

The frontend needs server-side rendering for fast first loads, a component model the team knows
(React), and a clean way to reach the FastAPI service without exposing it cross-origin to the
browser.

## Decision

We will use **Next.js 15 with the App Router** and React 19 in `apps/web`, in TypeScript.

- **API access:**
  - Browser → `/api/py/*` → rewritten in `next.config.ts` to `${API_INTERNAL_URL}/api/*`.
    Same-origin, no CORS preflight.
  - Server components → `API_INTERNAL_URL` directly.
  - Both paths go through `apiFetch` in `apps/web/src/lib/api.ts`, which picks the base URL by
    environment.
- **Rendering split:** server components for initial page data and layout; client components
  (`"use client"`) for interactivity, chat, and streamed AI output. Client-side data fetching uses
  TanStack Query (ADR 0009).
- Next.js route handlers are not used as a second backend. Business and AI logic belongs in FastAPI
  (ADR 0003); a route handler is only acceptable for web-only concerns (e.g. auth callbacks).

## Alternatives considered

- **Vite + React SPA** — simpler, but no SSR and we'd need a separate proxy.
- **Remix / React Router v7** — comparable; team familiarity and ecosystem favoured Next.js.
- **Browser calls FastAPI directly** — needs CORS with credentials and exposes the API host.

## Consequences

### Positive

- SSR/streaming React plus a same-origin API path.
- FastAPI stays private behind the web tier in deployments that allow it.

### Negative / risks

- The rewrite adds a hop; long SSE streams (ADR 0007) must be verified not to buffer or time out on
  the chosen host.
- Two fetch paths (server vs browser) must stay in sync; keep them behind `apiFetch`.
- `NEXT_PUBLIC_API_URL` in `.env.example` / `docker-compose.yml` is unused by `api.ts`; remove it or
  document its purpose.
