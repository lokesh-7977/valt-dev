# 0009. TanStack Query for client-side server state

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

Client components need to fetch and mutate API data: lists of threads, run history, settings,
documents to index. Doing this with `useEffect` + `useState` repeats loading/error handling, gives no
caching or deduplication, and makes invalidation after mutations ad hoc. Server components cover the
first render, but anything interactive after that is client-side.

## Decision

We will use **TanStack Query v5** (`@tanstack/react-query`) for all client-side server state.

- One `QueryClient` per browser session, created in a `Providers` client component mounted in
  `app/layout.tsx`. React Query Devtools in development only.
- Query functions call `apiFetch` (ADR 0008); no raw `fetch` in components.
- Query keys come from a key factory per feature (e.g. `threadKeys.list()`,
  `threadKeys.detail(id)`) in `apps/web/src/lib/queries/`, so invalidation is consistent.
- **SSR:** where a page needs data on first paint, the server component prefetches with
  `queryClient.prefetchQuery` and passes it down through `HydrationBoundary`, so the client doesn't
  refetch.
- **Mutations:** `useMutation` with `invalidateQueries` on success; optimistic updates only where the
  UX needs them.
- **Streaming AI output (ADR 0007) is not a query.** Token streams are handled by a dedicated
  streaming hook; when a run finishes, that hook writes the final result into the cache
  (`setQueryData`) or invalidates the thread query.
- Other TanStack libraries (Table for data grids, Form for complex forms) may be adopted as needed —
  they pair well with shadcn/ui (ADR 0010) — without a separate ADR.

## Alternatives considered

- **SWR** — lighter, but weaker mutation and cache-manipulation APIs.
- **Server components + Server Actions only** — fine for simple pages, but awkward for polling,
  optimistic updates, and client-driven refetches.
- **Redux Toolkit Query** — pulls in Redux for no other need.

## Consequences

### Positive

- Caching, deduplication, retries, background refetch, and loading/error states out of the box.
- Clear split: server state in TanStack Query, streamed AI state in the streaming hook, UI state in
  React.

### Negative / risks

- Two data paths (server prefetch and client queries) — keep query keys and fetchers shared so they
  can't diverge.
- Retries on non-idempotent AI endpoints would duplicate runs: set `retry: false` for mutations that
  start runs.
