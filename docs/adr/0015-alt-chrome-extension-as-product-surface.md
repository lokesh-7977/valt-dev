# 0015. Ship ALT as a Chrome MV3 extension built with TypeScript and esbuild

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** ALT team (Phase 1 lead)

## Context

ALT is an autonomous QA teammate. The hackathon brief asks for an AI that "thinks, verifies, and
acts continuously in the background as the user works". The three phase specs
(`docs/plans/PHASE_1_AUTONOMOUS_WEBSITE_EXPLORER.md`, `PHASE_2_…`, `PHASE_3_…`) all put the
experience inside the developer's browser: discovering the app, filling and submitting forms,
in-page popups, and a side panel. The repo had no extension. It had a Next.js shell (`apps/web`)
and a FastAPI + Gemini backend (`apps/api`, ADR 0003, 0014).

ALT has to see and drive any web app the developer runs. That rules out anything outside the
browser (the web app, a CLI crawler), because those can't reach the developer's authenticated
session or share their browser. Three developers build the phases in parallel, so the
extension needs module boundaries they can own separately.

## Decision

We will build ALT as a Manifest V3 Chrome extension in `apps/extension`:

- **Tooling:** TypeScript bundled by esbuild (`scripts/build.mjs`) into `dist/`, loaded unpacked.
  There is no UI framework. The side panel is plain DOM, because it is small and must load
  instantly. Pure logic is unit-tested with `node --test`. The real extension is tested
  end-to-end with Playwright's Chromium (branded Chrome no longer honours `--load-extension`).
- **Runtime split:** the service worker is the orchestrator (session, frontier, test queue,
  persistence, Gemini calls). An isolated-world content script does DOM discovery, filling,
  submitting, observing and page-health checks. A MAIN-world script captures console errors and
  unhandled rejections, and neutralises dialogs in ALT's worker tab. `chrome.webRequest`
  provides network metadata.
- **Background worker tab:** ALT acts in its own tab (in an "ALT" tab group), never in the tab the
  developer is using. The developer's tabs are observed passively: route changes and DOM changes
  re-prioritise ALT's queue.
- **Scoped injection:** content scripts are registered dynamically only for origins the
  developer enables (`chrome.scripting.registerContentScripts`).
- **Intelligence:** heuristics come first, so testing starts with no model latency. Gemini is
  called once per form, and the result is cached by form signature. The call goes through the
  existing `POST /api/v1/process` with task `alt_form_plan` (ADR 0014). If the API is down,
  ALT keeps testing on heuristics only.
- **Contract:** the Phase 1 observation types live in `packages/shared/src/alt.ts`, so Phases 2 and 3
  consume them without importing extension internals.

## Alternatives considered

- **Plasmo / WXT / CRXJS + React**: faster scaffolding, but another framework and toolchain to
  debug on the day, for a UI of about four views.
- **Playwright/CDP crawler driven from the API**: it runs outside the developer's browser, so it
  can't reuse their session or coexist with their work. That contradicts the product.
- **Testing in the developer's active tab**: ALT would fight the developer for the page. A
  dedicated worker tab lets the developer keep working.
- **Static `<all_urls>` content scripts**: simpler, but it would wrap `fetch` and `console` on
  every site the developer visits.

## Consequences

### Positive

- One install gives the whole experience. Phase 2 subscribes to the event bus. Phase 3 extends
  the side panel and adds an in-page popup, and neither needs a rewrite of Phase 1.
- The loop is fast: deterministic discovery and data generation, one Flash call per form, and
  plan caching.

### Negative / risks

- MV3 service workers can be suspended. Session state is written through to
  `chrome.storage.session` and restored.
- The extension requests broad host permissions (`<all_urls>`), which is acceptable for a
  developer tool but would need review for store publication.
- Background tabs are throttled. Waits use DOM-settle detection rather than
  animation frames.
- Network bodies aren't captured in Phase 1 (webRequest gives metadata only). Phase 2 owns body
  capture.

### Follow-ups

- Phase 2: an evidence-capture extension (request/response bodies) and analyzers on the bus.
- Phase 3: the popup, and the side-panel bug views and controls built on the Phase 1 panel.
