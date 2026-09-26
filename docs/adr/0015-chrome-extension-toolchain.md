# 0015. Build the ALT Chrome extension with Vite, crxjs and Preact

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** VALT team

## Context

ALT (PRD: `docs/product/alt-extension-prd.md`, plan: `docs/plans/alt-extension-plan.md`) is a
Manifest V3 Chrome extension that captures a developer's own form submits and API traffic on
`localhost`, sends them to a local helper, and renders bugs as in-page pins plus a side panel.
It ships alongside three supporting workspace packages: `@valt/protocol`, `@valt/mock-helper`
and the `@valt/demo-erp` fixture app.

Constraints that shape the toolchain:

- The page hook must run in the page's **MAIN world** at `document_start`, before page scripts,
  and must keep working on pages with a strict Content-Security-Policy. It therefore has to be a
  single self-contained classic script (no `import()`, no loader, no `chrome.runtime.getURL`).
- The in-page overlay is injected into every localhost page, so its runtime must be tiny.
- The side panel is a normal extension page; it may use a component library and Tailwind.
- The extension is a separate surface from `apps/web`: it cannot use Next.js, and shadcn/Radix
  portals fight a shadow root.
- Zod 4 probes JIT support with `new Function("")`, which trips CSP in extension pages
  (colinhacks/zod#4461, #5789).
- Target browser: Chrome 116+, loaded unpacked. Research date for all versions: 2026-09-26.

## Decision

We will build the extension with:

- **Vite 8 + `@crxjs/vite-plugin` ~2.7.1.** The manifest is authored in TS (`defineManifest`).
  The MAIN-world hook is a `*.iife.ts` content script, which crxjs bundles as a standalone IIFE
  (2.6.0+), declared in the manifest with `world: "MAIN"` (2.3.0+). crxjs 3.0.0 (published
  2026-09-24, ESM-only) is held back until it has a patch release.
- **Preact 10** for both the in-page overlay (in an open shadow root under `<alt-root>`) and the
  side panel. No React in content scripts.
- **Tailwind CSS v4 via `@tailwindcss/vite` in the side panel only.** The overlay uses hand-written
  CSS inlined into its shadow root.
- **zod 4 in jitless mode** (`z.config({ jitless: true })` imported first by `@valt/protocol`);
  zod never enters the MAIN-world hook.
- **Vitest 4.1.x + happy-dom** for unit tests (Vitest 5 needs Node 22.12; this keeps the repo
  floor at Node `>=20.19`, which Vite 8 requires).
- **Playwright 1.63** for end-to-end tests, using a persistent context with bundled Chromium
  (`channel: "chromium"`, headless) and `--load-extension`. E2E runs under `pnpm e2e`, not
  `pnpm test`.
- **ESLint 9 flat config + typescript-eslint** in each new package, matching `apps/web`'s ESLint 9.

### Scoped design-system deviations (extension surface only)

`design-system/valt/MASTER.md` stays in force for `apps/web`. For the extension only:

1. **Four-level severity palette** beside the one blue accent: critical = red (`--destructive`),
   high = orange (`--warning`), medium = yellow (dark-text variant for contrast), low = gray
   (`--muted-foreground`). Every use carries a letter label (C/H/M/L) or text, never color alone.
2. **20 px in-page badge with a 24 px hit area**, not 44 px, because it must sit beside host form
   fields without covering them (WCAG 2.2 target-size minimum is 24 px). Side-panel controls keep
   44 px.
3. **No shadcn/ui in the extension.** ADR 0010 is scoped to `apps/web`.

## Alternatives considered

- **Hand-rolled multi-entry Vite config** — Rollup can't emit several IIFE entries in one build,
  so it needs one `vite build --lib` per content script plus a manifest copy step. Kept as the
  documented fallback if crxjs mis-bundles the hook (an `import(` appears in the built hook).
- **React 19 + shadcn (as in `apps/web`)** — about 60 KB injected into every host page, and Radix
  portals escape the shadow root. The panel can move to React later if it outgrows Preact.
- **Injecting the hook with a `<script src="chrome-extension://…">` tag** — blocked by
  `script-src 'self'` on strict-CSP pages and races page scripts.
- **Vitest 5** — requires Node 22.12+, forcing a repo-wide engines bump for no gain.

## Consequences

### Positive

- One build produces the manifest, service worker, both content scripts and the side panel.
- The MAIN-world hook is CSP-exempt and runs before page scripts.
- Small overlay runtime keeps host-page cost low (PRD story 11: ≤ 1 ms per request).

### Negative / risks

- crxjs is the main third-party build risk; pinned to ~2.7.1 with a build-output check.
- Two UI stacks in the repo (React in `apps/web`, Preact in the extension).
- Playwright can't drive the real side panel; it is tested as a tab page.

### Follow-ups

- Upgrade to crxjs 3.x once it has a patch release.
- CI workflow for the new packages (`pnpm lint typecheck test build` + `pnpm e2e`).
