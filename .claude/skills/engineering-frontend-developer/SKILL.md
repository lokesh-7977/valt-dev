---
name: engineering-frontend-developer
description: "Build VALT's web app (apps/web) — Next.js 15 App Router, React 19, TanStack Query, shadcn/ui on Tailwind CSS v4 — including streamed AI chat/run UIs fed by the FastAPI SSE endpoints. Use when adding pages or components, fetching or mutating API data, building forms or data tables, rendering agent runs and approval prompts, fixing hydration/layout/performance issues, or checking accessibility."
metadata:
  version: "2.0.0"
  adapted-from: "PeterHdd/agent-skills engineering-frontend-developer (MIT)"
---

# VALT Frontend Guide (Next.js + TanStack + shadcn/ui + Tailwind)

Decisions behind these rules live in `docs/adr/` (0007–0010). If a change contradicts an accepted
ADR, write a new ADR rather than silently diverging.

## Stack and layout

```
apps/web/src/
  app/                 routes (App Router); layout.tsx mounts <Providers>
  components/
    ui/                shadcn/ui primitives — generated, then owned and edited by us   ADR 0010
    <feature>/         feature components composed from ui/ (chat/, runs/, items/)
    providers.tsx      QueryClientProvider (+ theme provider)                         ADR 0009
  lib/
    api.ts             apiFetch — the ONLY way to call FastAPI                          ADR 0008
    query-client.ts    getQueryClient() for server and browser
    queries/           per-feature key factories + queryOptions + mutation hooks
    use-run.ts         SSE streaming hook for AI runs                                  ADR 0007
    utils.ts           cn()
packages/shared/src/   API types, mirrored from apps/api/src/valt_api/schemas.py
```

## Data decision rules

- **All API calls go through `apiFetch`** (`lib/api.ts`). It picks `API_INTERNAL_URL` on the server
  and `/api/py` in the browser. No raw `fetch` to FastAPI in components; no `axios`.
- **Business and AI logic lives in FastAPI.** Don't add Next route handlers or Server Actions that
  re-implement backend behaviour. Route handlers are only for web-only concerns (auth callbacks,
  OG images).
- **Which data tool:**
  | Need | Use |
  | --- | --- |
  | Static-ish data only a server component renders | `await apiFetch(...)` in the server component |
  | Data a client component reads, refetches, or mutates | TanStack Query (`useQuery` / `useSuspenseQuery`) |
  | Same data needed on first paint *and* on the client | prefetch in the server component + `HydrationBoundary` |
  | Create/update/delete | `useMutation` + `invalidateQueries` |
  | Streamed AI run (tokens, steps, interrupts) | `useRun` hook — **not** a query |
  | Filters, pagination, search | URL search params as source of truth |
  | Local UI state | `useState` / `useReducer`; Context only for a genuinely shared slice |
- Query keys come from the feature's key factory in `lib/queries/<feature>.ts`. Never inline
  `["items"]` arrays in components — invalidation depends on consistent keys.
- Set a default `staleTime` (60s) so hydrated data isn't refetched immediately on mount.
- **Never auto-retry a mutation that starts an AI run** (`retry: false`) — a retry starts a second,
  billed run.
- When a run finishes, update the cache from the `done` event (`setQueryData` or
  `invalidateQueries` on the thread) so lists and detail views agree.
- Types for API payloads come from `@valt/shared`. If you need a new field, change
  `schemas.py` and `packages/shared` together.

## Design system (Apple-grade calm)

- **Source of truth:** `design-system/valt/MASTER.md` has the tokens, type roles, depth, motion,
  component variants, and anti-patterns. Read it before any UI work. If
  `design-system/valt/pages/<page>.md` exists, it overrides MASTER for that page.
- Tokens are implemented in `apps/web/src/app/globals.css` (shadcn variable names). Use the
  utilities: `bg-card`, `text-muted-foreground`, `text-link`, `shadow-card`, `shadow-popover`,
  `material` (translucent bars), `text-display|title-1|title-2|title-3|body|callout|footnote`,
  `ease-standard|out-expo|sheet`.
- For design decisions not covered by MASTER (a new pattern, chart type, landing structure, UX
  rule), query the `ui-ux-pro-max` skill (`python .claude/skills/ui-ux-pro-max/scripts/search.py
  "<query>" --domain <domain>` or `--stack nextjs` / `--stack shadcn`), then adapt the result to
  MASTER. Never adopt a palette, font, or motion preset that contradicts MASTER without updating it.
- Before delivering UI, run MASTER §9 checklist.

## Component decision rules

- Default to server components. Add `"use client"` only for state, effects, event handlers, browser
  APIs, or TanStack Query hooks — and push the boundary as low in the tree as possible.
- Build UI from `components/ui/` primitives. Add missing ones with
  `pnpm dlx shadcn@latest add <name>` (run in `apps/web`). Never hand-roll a dialog, menu, popover,
  select, or tooltip — Radix handles focus, keyboard, and ARIA.
- Style with Tailwind utilities and the theme tokens (`bg-background`, `text-muted-foreground`,
  `border-border`, …). No hard-coded hex colours or `black/10`-style opacity hacks in new code; they
  break dark mode. Merge classes with `cn()`.
- Variants belong in the component via `cva` (as shadcn does), not in ad-hoc conditional class
  strings at call sites.
- Split a component when it passes ~300 lines or mixes data fetching with presentation.

## AI UI rules

- Chat/run UIs render from `useRun` state: a streaming assistant message (append `token` text), a
  step list (from `step` events), an approval card (from `interrupt`), a final result (`done`), and a
  recoverable error (`error`) with a retry action.
- Always show that something is happening within 300ms of submit (Skeleton or pending step) — first
  tokens can take several seconds.
- Provide a Stop button that aborts the stream (`AbortController`).
- Render model output as text or sanitized Markdown. Never pass model output to
  `dangerouslySetInnerHTML` unsanitized — it's untrusted input.
- Interrupt approvals use `AlertDialog` or an inline `Card` with explicit Approve / Reject buttons
  that resume the run with the same `thread_id`.
- Streaming text lives in an `aria-live="polite"` region so screen readers announce it without
  stealing focus. Don't auto-scroll if the user has scrolled up.

## Accessibility rules

- Every interactive element is reachable and operable by keyboard with a visible focus ring (shadcn
  primitives provide `focus-visible` styles — don't remove them).
- Every input has a `<Label htmlFor>`; errors are linked with `aria-describedby` (shadcn form
  primitives do this — use them).
- Never convey state by colour alone; pair with text or an icon (e.g. run status badges).
- Modals and popovers trap focus and return it to the trigger on close (Radix does; custom overlays
  must too).
- Target zero WCAG 2.1 AA violations from axe on new pages.

## SSR, hydration, and Next.js rules

- Hydration "text content does not match": remove `Date.now()`, `Math.random()`,
  `toLocaleString()` and `typeof window` branches from render; compute in `useEffect` instead.
- Hydration "structure mismatch": fix invalid nesting (`<div>` inside `<p>`), or load the
  client-only widget with `dynamic(() => import(...), { ssr: false })` from a client component.
- Create the `QueryClient` per request on the server and once in the browser (`getQueryClient()`);
  a module-level client on the server leaks data between users.
- Wrap slow server sections in `<Suspense fallback={<Skeleton />}>` at meaningful boundaries
  (sidebar, main panel), not around every component.
- Don't read cookies or session in client components; pass what they need as props.

## CSS debugging (symptom → fix)

- **Flex child overflows**: `min-w-0` (row) / `min-h-0` (column) on the child.
- **Grid column blown out by content**: `grid-cols-[minmax(0,1fr)_...]` instead of `1fr`.
- **`sticky` doesn't stick**: an ancestor has `overflow-hidden/auto`; also needs `top-*`.
- **`z-index` ignored**: needs a positioned element; check ancestors for `transform`,
  `opacity < 1`, `filter` creating a stacking context. Radix portals render at `<body>`, so a dialog
  under a header is usually a portal/`z-50` issue, not your container.
- **Ellipsis not working**: `truncate` (single line) or `line-clamp-N` (multi-line); parent flex
  items also need `min-w-0`.
- **Container query ignored**: ancestor needs `@container`; the element can't query itself.

## Performance rules

- Initial JS for a route should stay under ~200 KB gzipped. Heavy, below-the-fold, or rarely used
  client components load with `next/dynamic`.
- Use `next/image` with explicit `width`/`height` (or `fill` + sized parent); `priority` only on the
  LCP image.
- Use `next/font` for fonts — no layout shift, no external request.
- Keep providers and `"use client"` boundaries low; a client `layout.tsx` makes the whole subtree
  client-rendered.
- LCP > 2.5s, INP > 200ms, or CLS > 0.1 on a key page is a bug. Profile before optimizing:
  React DevTools Profiler for re-renders, Performance tab for long tasks.

## Self-verification protocol

After any frontend change, from the repo root:
1. `pnpm --filter @valt/web typecheck` and `pnpm --filter @valt/web lint` pass.
2. `pnpm --filter @valt/web build` succeeds; then
   `bash .claude/skills/engineering-frontend-developer/scripts/check_bundle.sh apps/web/.next/static`
   flags nothing unexpected.
3. Run `pnpm dev`, open the page, and check: no console errors or hydration warnings; works at
   320px, 768px, 1280px with no horizontal scroll; light and dark mode both readable.
4. Tab through the new UI with the keyboard only.
5. For streamed features: tokens appear incrementally through `/api/py/...`; Stop aborts; an
   interrupt can be approved and the run resumes; a killed API shows the error state, not a
   blank screen.
6. No hard-coded API URLs, no raw `fetch` to FastAPI, no untyped `any` for API data.

## Failure recovery

- **Query refetches on every mount / after hydration**: missing `staleTime`, or server and client
  use different query keys. Use the shared `queryOptions` on both sides.
- **"No QueryClient set"**: component rendered outside `<Providers>`, or a server component calls a
  hook. Move the hook into a client component.
- **Data leaks between users in SSR**: a module-level `QueryClient` on the server. Use
  `getQueryClient()`.
- **Stream shows nothing, then everything**: buffering between FastAPI and the browser. Test
  `curl -N` against `:8000` then `:3000/api/py`; check Next `compress`, proxy buffering, and
  `X-Accel-Buffering`.
- **shadcn component looks unstyled**: `globals.css` is missing the theme variables or the
  `@theme inline` mapping that shadcn init adds; re-run `shadcn init` and merge.
- **Dark mode partially broken**: hard-coded colours in older components (e.g. `border-black/10`).
  Replace with tokens.

## References

- [TanStack Query](references/tanstack-query.md) — query client, providers, key factories,
  prefetch + hydrate, mutations.
- [Streaming runs](references/streaming-runs.md) — `useRun` SSE hook, event types, chat UI wiring,
  interrupt approval.
- [shadcn/ui](references/shadcn-ui.md) — setup on Tailwind v4, theming, `cn`, forms, DataTable with
  TanStack Table, migrating existing components.
- [TypeScript patterns](references/typescript-patterns.md) — discriminated unions, branded IDs,
  utility types. (Its API-client section is superseded by `lib/api.ts`.)
- [CSS patterns](references/css-patterns.md) — Grid, container queries, `:has()`, view transitions.
  Prefer Tailwind utilities; drop to CSS in `globals.css` only for what utilities can't express.

## Scripts

- `scripts/check_bundle.sh [--threshold KB] <dir>` — JS/CSS file sizes and oversized files in a
  build output directory (use `apps/web/.next/static`).
