# 0010. shadcn/ui on Tailwind CSS v4 for UI components

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

The web app needs accessible, consistent components (dialogs, menus, forms, tables, toasts) and
AI-specific UI (chat transcript, streaming message, step/progress display, approval prompts for
LangGraph interrupts). Tailwind CSS v4 is already set up in `apps/web` (`@tailwindcss/postcss`,
`globals.css`). We want to own and customise component code, not fight a library's theming API.

## Decision

We will use **shadcn/ui** components on **Tailwind CSS v4**.

- Initialise with the shadcn CLI in `apps/web` (`components.json`); components are generated into
  `apps/web/src/components/ui/` and committed. We edit them freely — they are our code.
- `cn()` helper (`clsx` + `tailwind-merge`) in `apps/web/src/lib/utils.ts`.
- Theme tokens (colors, radius) as CSS variables in `globals.css` using Tailwind v4's `@theme`;
  light and dark mode driven by those variables.
- Feature components (e.g. `chat/`, `runs/`) live in `apps/web/src/components/<feature>/` and compose
  `ui/` primitives. Existing components such as `health-card.tsx` move onto shadcn primitives when
  touched.
- Data tables use shadcn's Table with TanStack Table; forms use shadcn's Form primitives (ADR 0009).
- Components stay in `apps/web` while it is the only frontend. If a second app appears, extract them
  to `packages/ui`.

## Alternatives considered

- **MUI / Chakra / Mantine** — runtime styling or their own theming systems, heavier bundles, harder
  to make look custom.
- **Headless UI / Radix alone** — shadcn already builds on Radix and gives styled starting points.
- **Hand-written components** — slow, and accessibility is easy to get wrong.

## Consequences

### Positive

- Accessible primitives (Radix) with full source control.
- Utility-first styling keeps styles next to markup; no CSS-in-JS runtime cost.

### Negative / risks

- Copied components don't auto-update; upstream fixes are pulled manually via the CLI with a diff
  review.
- Tailwind v4 changed config (CSS-first, no `tailwind.config.js` by default); some older shadcn
  examples assume v3 — use the v4-compatible CLI output.
