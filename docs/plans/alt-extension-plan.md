# ALT Chrome Extension (Phase 2 client) — Engineering Plan

**PRD:** docs/product/alt-extension-prd.md · **Date:** 2026-09-26 · **Tasks:** 28

## Approach

We build four new workspace packages and touch nothing in `apps/api` or `packages/shared` (so no
`schemas.py` ⇄ `index.ts` sync is needed):

- `packages/protocol` (`@valt/protocol`): the user's frozen §2 protocol-v1 contract, verbatim, as
  TS types in `src/index.ts` plus zod schemas and golden JSON fixtures. Both sides validate against
  it. The Phase 1 helper builds against these exact names.
- `tools/mock-helper` (`@valt/mock-helper`): a scripted WebSocket helper that `pnpm alt:helper`
  starts.
- `apps/demo-erp` (`@valt/demo-erp`): a minimal Vite + React fixture app with 10 planted UI↔API bugs
  and a strict-CSP page.
- `apps/extension` (`@valt/extension`): the MV3 client.

The extension is a thin pipe with one structural decision: **the service worker owns the single
WebSocket and all session state**. Tabs and the side panel are views that exchange typed runtime
messages with it. Capture runs in two layers. A manifest-declared MAIN-world IIFE hook, which is
exempt from page CSP and runs before page scripts, observes fetch/XHR/history. An isolated-world
content script correlates submits, scrapes the UI, and **redacts in the tab** before anything
reaches the service worker. The shadow-DOM overlay and the side panel both render state pushed by
the service worker.

### Decision: MV3 build tooling
- **Chosen:** Vite 8 + `@crxjs/vite-plugin` 2.7.x. It generates the manifest from TS and
  bundles `*.iife.ts` content scripts as standalone IIFEs, which the CSP-safe MAIN-world hook
  needs. It also handles side-panel HTML and the SW entry.
- **Rejected:** a hand-rolled multi-entry Vite config. Rollup can't emit several IIFE entries in
  one build, so it would need one `vite build` per content script plus a manifest copy step. That
  is more glue to own, for no gain.
- **Switch if:** crxjs mis-bundles the MAIN-world hook (a loader or `import()` appears in
  `dist`) or the side panel. Then fall back to per-entry `vite build --lib` IIFE builds (see T5
  "Done when").

### Decision: UI library for overlay + panel
- **Chosen:** Preact 10 for both. The overlay loads into every localhost page, so the ~4 KB runtime
  keeps parse cost and hook overhead low. Using one library in both surfaces means one set of
  component habits.
- **Rejected:** React 19 + shadcn (as in `apps/web`). That is ~60 KB injected into every host page,
  and Radix portals fight the closed-world shadow root. shadcn sources live in `apps/web` and can't
  be shared without a UI package.
- **Switch if:** the panel grows past about 10 screens or needs complex primitives (combobox,
  virtualized lists). Then move only the panel to React.

### Decision: who owns the WebSocket
- **Chosen:** the extension service worker. Since Chrome 116, WS traffic resets the idle timer,
  and captures must flow even with the panel closed (toasts and badges still need data).
- **Rejected:** the side panel page (dies when the panel closes) and an offscreen document (an extra
  lifecycle and a justification string, not needed on Chrome 116+).
- **Switch if:** the SW-restart E2E (T27) shows dropped messages that reconnect-and-queue can't
  cover. Then move the socket to `chrome.offscreen`.

### Decision: MAIN-world hook injection
- **Chosen:** static manifest `content_scripts` entry with `world: "MAIN"` and
  `run_at: "document_start"` (supported since Chrome 111; the PRD targets 116+). It runs before
  page scripts and is not subject to the page's `script-src`.
- **Rejected:** injecting a `<script src="chrome-extension://…">` tag. On the strict-CSP page,
  `script-src 'self'` blocks it, and it races page scripts.

### Decision: mock helper location
- **Chosen:** `tools/mock-helper`, adding `tools/*` to `pnpm-workspace.yaml`. It is a dev/demo
  tool, not a shipped app. `apps/` is left for deployables and the real helper, which will take
  over `pnpm alt:helper` later.
- **Rejected:** `apps/mock-helper`. It would sit next to the real helper and invite confusion about
  which one the extension talks to.

### Decision: where redaction runs
- **Chosen:** the isolated content script (`src/content/redact.ts`). It is still "in the tab", can
  import tested shared code, and keeps the MAIN-world hook tiny. That matters for the ≤ 1 ms
  overhead and for the smallest possible surface exposed to page interference.
- **Rejected:** redacting inside the MAIN-world hook. It is the same data boundary (the page already
  owns its own traffic), but it means a bigger hook that is harder to keep fail-open.

## Research notes

All checked 2026-09-26. Versions from `registry.npmjs.org/<pkg>/latest` that day.

| Package | Latest | Pin | Why |
|---|---|---|---|
| `@crxjs/vite-plugin` | 3.0.0 (published 2026-09-24, ESM-only) | `~2.7.1` | 2.6.0 added `.iife.ts` standalone bundles, 2.3.0 added manifest MAIN-world scripts, 2.4.0 added Vite 8, and 2.7.1 has been stable for 3 months. 3.0's only break is dropping CJS. Upgrade once 3.0.x has a patch release. https://raw.githubusercontent.com/crxjs/chrome-extension-tools/main/packages/vite-plugin/CHANGELOG.md · https://crxjs.dev/concepts/content/ |
| `vite` | 8.3.1 (engines node `^20.19 \|\| >=22.12`) | `^8.3.1` | crxjs, `@tailwindcss/vite`, `@preact/preset-vite`, and `@vitejs/plugin-react` 6.1.1 all peer on vite 8 |
| `vitest` | 5.0.2 (node `^22.12 \|\| ^24`) | `^4.1.11` | 4.1.11 peers vite `^6\|\|^7\|\|^8` and supports Node 20. That keeps the root `engines` floor at Node 20 instead of 22.12 |
| `zod` | 4.6.5 (already in `apps/web`) | `^4.6.5` | Zod 4's JIT probe calls `new Function("")`, which trips CSP (colinhacks/zod#4461, #5789). `z.config({ jitless: true })` must run before any schema is constructed, and zod never enters the MAIN-world hook |
| `ws` / `@types/ws` | 8.21.3 / 8.18.1 | `^8.21.3` | mock helper server |
| `@playwright/test` | 1.63.0 | `^1.63.0` | Extensions load only in a persistent context with `--disable-extensions-except` + `--load-extension`. `channel: 'chromium'` allows headless. Branded Chrome/Edge removed the side-load flags, so use bundled Chromium. The SW is found via `context.serviceWorkers()` / `waitForEvent('serviceworker')`. https://playwright.dev/docs/chrome-extensions |
| `preact` / `@preact/preset-vite` | 10.29.8 / 2.10.6 (peers vite 2–8, `@babel/core` 7) | `^10.29.8` / `^2.10.6` | |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3 / 4.3.3 (peer vite `^8` ok) | `^4.3.3` | panel only |
| `react` / `@vitejs/plugin-react` | 19.3.0 / 6.1.1 (peer vite `^8`) | `^19.0.0` / `^6.1.1` | demo-erp only |
| `@types/chrome` | 0.3.0 (tagged for ts5.7–6.0) | `^0.3.0` | |
| `typescript` | 7.0.2 latest; repo has 5.9.3 | keep repo `^5.7.2` | typescript-eslint 8.70.1 needs TS `<6.1` |
| `eslint` / `typescript-eslint` | 10.11.0 / 8.70.1 | `^9.39.0` / `^8.70.1` | match `apps/web`'s eslint 9 |
| `happy-dom` | 20.14.5 | `^20.14.5` | Vitest DOM env |
| `tsx` | 4.23.15 (node ≥18) | `^4.23.15` | runs the TS mock helper on Node 20+ |

Platform facts:
- **SW lifetime.** 30 s idle termination. An extension API call resets the timer (Chrome 110+).
  WebSocket send/receive resets it (116+). Sending over a long-lived port keeps it alive (114+), but
  *opening* a port no longer does. → Protocol v1 has no WS ping (§2), so keep-alive is
  `chrome.runtime` traffic: every localhost content script sends a `cs:keepalive` runtime message
  every 20 s, and the panel port sends a 20 s `heartbeat`. Inbound helper traffic (`activity`,
  `run_stats`) also resets the timer. While disconnected, each reconnect attempt calls
  `chrome.runtime.getPlatformInfo()`. A 30 s `chrome.alarms` alarm is the safety net if the worker
  is evicted anyway. https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- **Side panel.** The API needs 114+, `sidePanel.open()` needs 116+ and must be "in response to a
  user action", including "a user gesture on … content script".
  https://developer.chrome.com/docs/extensions/reference/api/sidePanel. Opening from a
  content-script click via `runtime.sendMessage` works **only if `open()` is called synchronously in
  the SW `onMessage` handler (no `await` before it)**. This is community-verified, not in official
  docs: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/d5ky9SiZlqQ. Also set
  `setPanelBehavior({ openPanelOnActionClick: true })`.
- **Content scripts.** The `world` key defaults to `ISOLATED`, and `all_frames` defaults to false
  (top frame only, matching the PRD guardrail).
  https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- **Match patterns.** An omitted port acts as `:*`, so `http://localhost/*` and
  `http://127.0.0.1/*` cover every port.
  https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
- **Storage.** `storage.session` holds 10 MB in memory (1 MB before Chrome 112) and is not exposed
  to content scripts by default. `storage.local` holds 10 MB.
  https://developer.chrome.com/docs/extensions/reference/api/storage → the offline queue gets an 8 MB
  byte budget on top of the 50-item cap.
- **SW termination in tests.** Chrome's guide closes the SW target via CDP `Target.closeTarget` on the
  `service_worker` target.
  https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer.
  Playwright persistent contexts have no `Browser` object, so T23 must spike
  `context.newCDPSession(page)` → `Target.getTargets` / `Target.closeTarget`. The fallback is
  clicking "Stop" on `chrome://serviceworker-internals`. Playwright keeps the same `Worker` object
  across SW restarts.
- **Docs vs repo skills.** `.claude/skills/tech-plan/SKILL.md` says "No test tasks". The conductor
  explicitly asked for qa-engineer E2E tasks, and the PRD metrics can only be measured by E2E, so
  T23–T28 exist. They run under `pnpm e2e`, not `pnpm test`, so the root gate stays fast.

**Contract source:** the user-authored §2 contract, delivered verbatim by the conductor on
2026-09-26 (below, under "Protocol v1"). T6 writes it into `packages/protocol` and T2 quotes it in
ADR 0016, so the repo holds the authoritative copy. The only approved additions are `v: 1` in the
`hello` and `welcome` payloads and `"reopen"` in `bug_action.action`. Anything else the extension
would like is listed under "Proposed protocol additions" for the user to decide on, and is **not**
built.

## AI design

N/A. There are no AI features in the extension (PRD "AI contract: N/A"), so there is no AI
design or eval section. All model calls live in the helper, which is out of scope.

## Performance budget (replaces AI budget math)

| Step | Budget | Basis |
|---|---|---|
| Hook sync work per fetch/XHR | ≤ 1 ms p95 | timestamp, id, header snapshot. Body reads are async on `clone()` and off the call path, and the page gets the **original** promise |
| UI settle after last correlated response | 800 ms | PRD. The capture closes when no new correlated request starts within 800 ms |
| content → SW → WS send | ≤ 20 ms | `runtime.sendMessage` plus a localhost WS frame |
| Mock contract compute + reply | ≤ 20 ms | deterministic diff of ≤ 30 fields |
| SW → panel port → Preact render | ≤ 100 ms | ≤ 30 rows, no virtualization |
| **Extension share** | **≈ 0.94 s ≤ 1.0 s** | PRD extension share |
| **Submit → table with mock** | **≈ 1.0 s ≪ 2.0 s p95** | measured in T27 over 20 submits |
| Idle | no rAF loops, no polling | Observers attach only while ≥ 1 badge exists. Only timers are the 20 s content-script `cs:keepalive` runtime message and the 20 s panel-port heartbeat |

## Protocol v1: the user's frozen §2 contract (verbatim; written to the repo by T6, quoted by ADR 0016)

- **Transport:** `ws://127.0.0.1:7777/ws`.
- **Envelope:** `{ "type": string, "id": string, "ts": number, "payload": {...} }`. The extension
  sets `id` = `crypto.randomUUID()` and `ts` = `Date.now()`.
- **Handshake:** the first message must be `hello`.
- **Types and validation:** types live in `packages/protocol/src/index.ts`, with zod schemas used on
  both sides. An unknown `type` is ignored and logged.
- **Screenshots:** served over HTTP at `http://127.0.0.1:7777/assets/...`, never base64.

```ts
// ---------- Extension → Helper ----------
type Hello        = { type: "hello"; payload: { token: string; extVersion: string } };
type SetMode      = { type: "set_mode"; payload: { mode: "live" | "paused" } };
type RunSweep     = { type: "run_sweep"; payload: { target: "localhost" | "dev"; role?: string } };
type SetRole      = { type: "set_role"; payload: { role: string } };
type BugAction    = { type: "bug_action"; payload: { bugId: string; action: "ignore" | "expected" | "file_ticket" | "copy_fix_prompt" } };
type CapturedSubmit = {
  type: "captured_submit";
  payload: {
    submitId: string; pageUrl: string; route: string;
    form: { selector: string; fields: Array<{ name: string; label: string; type: string; value: string; selector: string }> };
    requests: CapturedRequest[];
    uiAfter: { toasts: string[]; fieldErrors: Array<{ selector: string; text: string }>; url: string };
  };
};
type CapturedRequest = {
  reqId: string; method: string; url: string; status: number;
  reqHeaders: Record<string,string>;
  reqBody: unknown; resBody: unknown; durationMs: number; initiator: "fetch" | "xhr";
};
// ---------- Helper → Extension ----------
type Welcome      = { type: "welcome"; payload: { helperVersion: string; project: string; roles: string[]; mode: "live"|"paused" } };
type Activity     = { type: "activity"; payload: { agent: string; message: string; progress?: { done: number; total: number } } };
type BugFound     = { type: "bug_found"; payload: Bug };
type BugUpdated   = { type: "bug_updated"; payload: { bugId: string; status: "open"|"ignored"|"expected"|"fixed"; ticketUrl?: string } };
type ContractRes  = { type: "contract_result"; payload: { submitId: string; route: string; rows: ContractRow[]; bugIds: string[] } };
type RunStats     = { type: "run_stats"; payload: { checks: number; agents: number; durationMs: number; trigger: "save"|"sweep"|"deploy"|"manual_submit" } };
type FixPrompt    = { type: "fix_prompt"; payload: { bugId: string; text: string } };
type ErrorMsg     = { type: "error"; payload: { code: string; message: string } };
type Bug = {
  bugId: string; fingerprint: string; title: string; severity: "critical"|"high"|"medium"|"low";
  layer: "ui"|"api"|"ui_api"|"rule"|"health"; checkCode?: string;
  pageUrl: string; route: string; anchor: { selector: string; fallbackText?: string };
  steps: string[]; expected: string; actual: string;
  evidence: { screenshotUrl?: string; request?: unknown; response?: unknown; highlightKeys?: string[] };
  likelyCause?: { file: string; line?: number; reason: string };
  env: "localhost"|"dev"; status: "open"|"ignored"|"expected"|"fixed"; ticketUrl?: string;
};
type ContractRow = { field: string; uiValue: string; requestValue: string; responseValue: string; ok: boolean; code?: string };
```

**Approved additions (the only ones):**
- `v: 1` in the `hello` and `welcome` payloads. If `welcome.payload.v !== 1` (including missing),
  the persistent "Update helper: this extension needs protocol v1" banner appears.
- `"reopen"` in `bug_action.payload.action` (decision 2). The helper answers with
  `bug_updated{status:"open"}`.

**There are no other WS message types.** In particular, none of these exist: `ack`, `ping`/`pong`,
`capture`, `contract`, `stats`, `bug`, `sweep`, `set_live`.

### How the extension meets PRD behaviour inside §2 (no new messages)

| Need | How, using §2 only |
|---|---|
| Wrong token (S1) | The helper sends `error{code:"auth_failed"}` then closes, and the extension shows "Pairing failed…". Codes are strings; the extension treats `auth_failed` as pairing failure and every other code as logged only. |
| Version mismatch (S9) | `welcome.payload.v !== 1` → banner, and no further sends except reconnecting every 10 s. |
| Action timeout 10 s (S6) | Client-side. Pending `{bugId, action}` resolves on `bug_updated` for that `bugId` (ignore / expected / reopen / file_ticket via `ticketUrl`) or on `fix_prompt` for that `bugId` (copy_fix_prompt). Otherwise it times out at 10 s. Only one pending action per bug is allowed (buttons are disabled while pending), so `bugId` is an unambiguous correlation key. |
| Ticket link text "ALT-12 ↗" (S6) | Derived from `ticketUrl` with `/[A-Z][A-Z0-9]+-\d+/`, falling back to "Ticket ↗". The link opens only if the scheme is `http(s)`. |
| Pause (S9) | Extension-local kill switch (nothing is captured or sent while paused), plus `set_mode{mode:"paused"}` to the helper. After `welcome`, if `welcome.payload.mode` differs from the extension's persisted mode, the extension sends `set_mode` with its own mode (the extension's switch wins). |
| Role selector (S7) | Lists `welcome.payload.roles`. The current role is the last role picked this session (stored in `storage.session`), else `roles[0]`. It is re-sent with `set_role` after each `welcome`. |
| Full sweep (S7) | `run_sweep{target:"localhost", role}`. The extension never sends `"dev"` in v1. Feedback is the following `activity` and `bug_found` messages; there is no ack. |
| Exactly-once queued submits (S9) | Queue key = `submitId`. An item leaves the queue only when a `contract_result` with that `submitId` arrives. The store dedupes `contract_result` by `submitId`, so a resend after a helper restart never creates two entries. |
| Contract entry name "route · time" (S3) | `contract_result` has no timestamp, so the SW keeps `submitId → envelope ts` of the `captured_submit` and names the entry with that. |
| Mismatch hover "C2 Value changed in transit" (S3) | `row.code` plus an extension-side title map (`apps/extension/src/ui/checks.ts`, C1–C12 titles from `docs/plans/PHASE_2_UI_API_INTELLIGENCE_ENGINE.md:176-359`). |
| Truncated body marker (S4) | There is no flag field in `CapturedRequest`, so a body over 64 KB is sent as a **string**: the first 65,536 characters followed by `"…[truncated: <N> bytes]"`. The panel detects that suffix and shows a "truncated" chip. |
| Response headers | Not in §2. Only `reqHeaders` are sent, redacted. |
| Network error | `status: 0` (a number, per §2) and `resBody: null`. |
| SPA Save with no `<form>` | `form.selector` = the closest `form`, else the closest `[data-testid]` ancestor, else `"body"`. |
| Screenshot origin (S5) | Render only if `new URL(evidence.screenshotUrl).origin === "http://127.0.0.1:7777"` and the path starts with `/assets/`. |
| Keep-alive | Not a WS concern. `cs:keepalive` runtime messages from content scripts and the panel-port heartbeat do this (see Research notes). |

Ignore = hidden for the helper session, and Mark expected = persistent by fingerprint. Both are
helper-side (decision 6); the extension only renders `status`. There is no destructive-actions
message (decision 3).

### Proposed protocol additions (for the user to decide on; NOT built)

1. **`role` in the `welcome` payload.** Today the extension can't know the helper's current role
   after a restart; it re-sends its own choice instead.
2. **Helper-originated heartbeat.** `activity` is frequent while the helper is working, but an idle
   helper sends nothing. Without a heartbeat, an idle, panel-closed, no-localhost-tab session can
   let the SW sleep. The alarm reconnects within ≤ 30 s. That is invisible for captures (a content
   script wakes the SW) but can delay live bug pushes by up to 30 s.
3. **`truncated?: boolean` on `CapturedRequest`**, to replace the in-band string marker.
4. **Response headers** (`resHeaders`) on `CapturedRequest`, if the helper wants C10/C12 checks
   that depend on them.

## Touch points

Existing files modified. Everything else is new.

| File | Line | What changes |
|---|---|---|
| pnpm-workspace.yaml | 1–3 | add `"tools/*"` |
| package.json | 6–19 | `dev` scoped to web+api; add `alt:helper`, `mock`, `alt:dev`, `demo:erp`, `e2e` (T3); `e2e:rehearse` (T28) |
| package.json | 25–27 | `engines.node` → `>=20.19` (Vite 8 floor) |
| turbo.json | 6–26 | add `e2e` task (`dependsOn: ["build", "^build"]`, `cache: false`) |
| .gitignore | 1–8 | `test-results/`, `playwright-report/`, `playwright/.cache/`, `tools/mock-helper/.logs/` |
| docs/adr/README.md | 27 | index rows for 0015 and 0016 |
| apps/web/src/app/globals.css | 23–108 | **read only**: token values copied into the extension's `tokens.css` |

**Not touched:** `apps/api/**`, `packages/shared/**`, `apps/web/**`. No contract sync is needed.

## Tasks

### [x] T1 — Write ADR 0015: Chrome extension toolchain
- **Owner:** devops-engineer
- **Stories:** enables all. Records open-question-4 and 5(a) decisions.
- **Files:** create `docs/adr/0015-chrome-extension-toolchain.md`; modify `docs/adr/README.md` (index row after line 27).
- **Change:** use `docs/adr/template.md` and the `/adr` skill. Decision: Vite 8 + `@crxjs/vite-plugin` ~2.7.1 (MAIN-world hook as `*.iife.ts`); Preact 10 for overlay and panel; Tailwind v4 via `@tailwindcss/vite` in the panel only, with hand-written CSS in the overlay shadow root; zod 4 in jitless mode (never in the MAIN world); Vitest 4 + happy-dom; Playwright 1.63 persistent context with bundled Chromium (`channel: 'chromium'`, headless); Chrome 116+ minimum. **Scoped deviations for the extension surface only:** (1) a four-level severity palette (red/orange/yellow/gray, each with a C/H/M/L letter) beside the one blue accent, versus MASTER.md §1.2 and §2; (2) the 20 px in-page badge has a 24 px hit area, not 44 px, because it must sit beside host fields without covering them (WCAG 2.2 target-size minimum is 24 px); (3) no shadcn, which scopes ADR 0010 to `apps/web`. Alternatives: the manual multi-entry Vite build, React 19 + shadcn. Record the research dates from this plan.
- **Done when:** the ADR file exists with Status "Accepted" and all template sections, and the README index row links to it (`grep -n 0015 docs/adr/README.md` prints one row).
- **Depends on:** none

### [x] T2 — Write ADR 0016: helper↔extension WebSocket protocol v1
- **Owner:** frontend-engineer
- **Stories:** 1, 9, 10. Records open-question-2, 3, 5(b) decisions.
- **Files:** create `docs/adr/0016-alt-helper-websocket-protocol.md`; modify `docs/adr/README.md`.
- **Change:**
  - **Decision:** quote the user's §2 contract **verbatim**: the transport, the envelope `{type, id, ts, payload}`, "first message must be `hello`", the full TS block from this plan's "Protocol v1" section, the screenshot rule `http://127.0.0.1:7777/assets/...` (never base64), and "unknown `type` ignored + logged".
  - Then list the only two approved additions (`v: 1` in the `hello`/`welcome` payloads; `"reopen"` in `bug_action.action`), and state explicitly that no other WS types exist (no `ack`, `ping`/`pong`, …).
  - Record how the PRD behaviours map onto §2 (copy the "How the extension meets PRD behaviour inside §2" table) and the "Proposed protocol additions", marked *not accepted*.
  - The localhost-only bind and token pairing via `hello`/`welcome` are recorded, with wrong token → `error{code:"auth_failed"}` then close.
  - **Why not SSE (ADR 0007):** the channel is bidirectional (`captured_submit`, `bug_action`, `set_mode`, `set_role`, `run_sweep` go up while `activity`/`bug_found`/… come down), it is not browser↔FastAPI, and it doesn't pass through the Next rewrite. ADR 0007 stays in force for its scope, and this ADR does not supersede it.
  - Record decisions 3 (no destructive-actions toggle) and 6 (Ignore = session, Expected = persistent, helper-owned).
  - **Out of scope, owned by the Phase 1 owner:** the ADR for the Node helper calling Gemini outside ADR 0003/0014.
- **Done when:** the file exists with Status "Accepted" and contains the §2 TS block byte-for-byte (compare with this plan: `node -e` extracting the ```ts block from both files and asserting they are equal). There is also a README index row for 0016. T6 later checks `packages/protocol/src/index.ts` against this block.
- **Depends on:** T1 (same README table; avoid conflicting edits)

### [x] T3 — Wire root workspace, scripts, turbo, and ignores
- **Owner:** devops-engineer
- **Stories:** 1 (start command), 10
- **Files:** modify `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `.gitignore`.
- **Change:**
  - Add `"tools/*"` to workspace packages.
  - Root scripts: `"dev": "turbo run dev --filter=@valt/web --filter=@valt/api"` (keeps today's behavior), `"alt:helper": "pnpm --filter @valt/mock-helper start"`, `"mock": "pnpm alt:helper"`, `"alt:dev": "turbo run dev --filter=@valt/extension --filter=@valt/demo-erp"`, `"demo:erp": "pnpm --filter @valt/demo-erp dev"`, `"e2e": "turbo run e2e"`.
  - Set `engines.node` to `>=20.19`.
  - turbo: `"e2e": {"dependsOn": ["build", "^build"], "cache": false, "outputs": []}`.
  - `.gitignore` entries per Touch points.
- **Done when:** `pnpm install` succeeds; `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` are all green (no new packages yet); `pnpm dev` still starts only web and api.
- **Depends on:** none

### [x] T4 — Scaffold `@valt/protocol`, `@valt/mock-helper`, `@valt/demo-erp` packages
- **Owner:** devops-engineer
- **Stories:** enables 3–11
- **Files:**
  - Create `packages/protocol/{package.json,tsconfig.json,eslint.config.mjs,vitest.config.ts,src/index.ts}`.
  - Create `tools/mock-helper/{package.json,tsconfig.json,eslint.config.mjs,vitest.config.ts,src/main.ts}`.
  - Create `apps/demo-erp/{package.json,tsconfig.json,eslint.config.mjs,vite.config.ts,vitest.config.ts,index.html,src/main.tsx}`.
- **Change:**
  - Each package extends `packages/tsconfig/base.json` and has scripts `lint` (`eslint .`), `typecheck` (`tsc --noEmit`), and `test` (`vitest run --passWithNoTests`).
  - `@valt/protocol` is source-only like `@valt/shared` (`"main": "./src/index.ts"`, `exports`) with dep `zod ^4.6.5`.
  - mock-helper deps: `ws`, `@valt/protocol: workspace:*`; devDeps `tsx`, `@types/ws`. `start` = `tsx src/main.ts`.
  - demo-erp: `react`, `react-dom`, `@vitejs/plugin-react`, `vite ^8.3.1`. Scripts `dev` = `vite --port 5180 --strictPort`, `build` = `vite build`, `preview` = `vite preview --port 5180 --strictPort`. devDep `@valt/protocol: workspace:*`.
  - ESLint 9 flat config with `typescript-eslint` recommended (5 lines each).
  - Versions per Research notes.
- **Done when:** `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` are green repo-wide; `pnpm --filter @valt/demo-erp build` emits `apps/demo-erp/dist/index.html`; `pnpm alt:helper` starts and exits 0 (placeholder main logs "ALT mock helper placeholder").
- **Depends on:** T3

### [x] T5 — Scaffold the MV3 extension build (`@valt/extension`)
- **Owner:** devops-engineer
- **Stories:** enables 1–12
- **Files:**
  - Create `apps/extension/{package.json,tsconfig.json,eslint.config.mjs,vite.config.ts,vitest.config.ts,manifest.config.ts}` and `apps/extension/public/icons/{icon-16.png,icon-48.png,icon-128.png}`.
  - Create placeholder entries `apps/extension/src/background/index.ts`, `apps/extension/src/hook/page-hook.iife.ts`, `apps/extension/src/content/index.ts`, `apps/extension/src/panel/{index.html,main.tsx,styles.css}`, and `apps/extension/test/setup.ts`.
- **Change:**
  - `manifest.config.ts` (crxjs `defineManifest`): `manifest_version: 3`, `name: "ALT"`, `minimum_chrome_version: "116"`, `permissions: ["storage","sidePanel","alarms"]`, `host_permissions: ["http://localhost/*","http://127.0.0.1/*"]`, `background: {service_worker: "src/background/index.ts", type: "module"}`, `side_panel: {default_path: "src/panel/index.html"}`, `action: {default_title: "ALT"}`, icons.
  - `content_scripts`: (a) `{js: ["src/hook/page-hook.iife.ts"], matches: [localhost, 127.0.0.1], run_at: "document_start", world: "MAIN"}` and (b) `{js: ["src/content/index.ts"], matches: same, run_at: "document_start"}`. `all_frames` stays at its default of false.
  - Plugins: `crx`, `@preact/preset-vite`, and `@tailwindcss/vite` (the panel CSS does `@import "tailwindcss"`).
  - `vitest.config.ts`: happy-dom env and `test/setup.ts` without the crx plugin.
  - Scripts: `dev` = `vite build --watch --mode development`, `build` = `vite build`, `lint`, `typecheck`, `test`.
  - devDeps: `@valt/demo-erp`, `@valt/mock-helper` (`workspace:*`, so turbo `^build` builds demo-erp before e2e); deps `@valt/protocol`, `preact`.
- **Done when:**
  - `pnpm --filter @valt/extension build` writes `apps/extension/dist/manifest.json` with a content script entry having `"world": "MAIN"`.
  - The emitted hook file in `dist` contains no `import(` and no `chrome.runtime.getURL`. Verify with `node -e` reading the manifest, then `grep -c "import(" <hook file>` → 0. If either check fails, apply the rejected-option fallback from the Approach and note it in ADR 0015.
  - Root `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` are green.
  - MANUAL: `chrome://extensions` → Load unpacked `apps/extension/dist` loads with no errors, and clicking the toolbar icon opens an empty side panel.
- **Depends on:** T3, T4

### [x] T6 — Write the frozen §2 contract into `@valt/protocol`: types, zod schemas, golden fixtures
- **Owner:** frontend-engineer
- **Stories:** 1, 3, 5, 6, 7, 9, 10
- **Files:**
  - Create `packages/protocol/src/{jitless.ts,constants.ts,schemas.ts,parse.ts,schemas.test.ts}`.
  - Create `packages/protocol/fixtures/messages/{hello,set_mode,run_sweep,set_role,bug_action,bug_action_reopen,captured_submit,welcome,activity,bug_found,bug_updated,contract_result,run_stats,fix_prompt,error}.json`.
  - Modify `packages/protocol/src/index.ts`.
- **Change:**
  1. **`index.ts`** first does `import "./jitless.js"`, then declares the §2 types **verbatim**. That means `Hello`, `SetMode`, `RunSweep`, `SetRole`, `BugAction`, `CapturedSubmit`, `CapturedRequest`, `Welcome`, `Activity`, `BugFound`, `BugUpdated`, `ContractRes`, `RunStats`, `FixPrompt`, `ErrorMsg`, `Bug`, `ContractRow`, with only the two approved additions:
     - `Hello.payload.v: 1` and `Welcome.payload.v: 1`
     - `BugAction.payload.action` gains `"reopen"`
     - It also exports `Envelope<T> = T & { id: string; ts: number }`, the unions `ExtensionToHelper` / `HelperToExtension`, and re-exports schemas, parse, and constants.
     - The block is copied line for line (with `export`). The three lines changed by approved additions each end with `// §2 + approved addition`.
     - A header comment says: "Frozen user §2 contract. Do not rename or add types; propose changes in ADR 0016."
  2. **`jitless.ts`:** `z.config({ jitless: true })`.
  3. **`constants.ts`:** `PROTOCOL_VERSION = 1`, `DEFAULT_WS_URL = "ws://127.0.0.1:7777/ws"`, `HELPER_HTTP_ORIGIN = "http://127.0.0.1:7777"`, `ASSETS_PATH = "/assets/"`, `REDACTED = "[redacted]"`, `BODY_LIMIT_CHARS = 65536`, `truncatedMarker(n) => "…[truncated: " + n + " bytes]"`, `AUTH_FAILED = "auth_failed"`.
  4. **`schemas.ts`:** one zod schema per message, envelope-wrapped (`type` literal, `id: z.string()`, `ts: z.number()`, `payload`), with `z.discriminatedUnion("type", …)` for each direction. Add a type-level equality assertion (`type _Eq<A,B> = …`, one per message) that `z.infer<typeof Schema>` equals `Envelope<Type>` from `index.ts`. `tsc` then fails if the zod schemas drift from the verbatim types.
  5. **`parse.ts`:** `parseHelperMessage(raw: string)` / `parseExtensionMessage(raw: string)` return `{ok: true, msg} | {ok: false, reason: "json" | "unknown_type" | "invalid", type?: string}` and never throw. `unknown_type` is the "ignored + logged" path.
  6. **Fixtures:** one golden JSON per message (full envelope), using demo-erp values:
     - `captured_submit` with `initiator: "fetch"`, a `[redacted]` `authorization` header, and one truncated `resBody` string ending in the marker
     - `bug_found` with every optional field filled
     - `bug_action_reopen`
     - `error` with `code: "auth_failed"`
     - `welcome` with `v: 1`
- **Done when:** `pnpm --filter @valt/protocol typecheck` is green (this includes the drift assertions), and `pnpm --filter @valt/protocol test` passes with:
  - every fixture parsing `ok` in its direction
  - a copy of each fixture with one required payload field deleted returning `invalid`
  - `{"type":"ping","id":"x","ts":1,"payload":{}}` returning `unknown_type` (proves `ping` is not in v1)
  - `"not json"` returning `json`
  - `bug_action` with `copy_fix_prompt` and with `reopen` accepted, and with `fix_prompt` rejected
  - a `welcome` without `v` returning `invalid`
  - `globalThis.Function` never called during schema construction (spy)
  - a conformance test reads the §2 block from `docs/adr/0016-alt-helper-websocket-protocol.md` and `src/index.ts`: every line of the block appears verbatim in `index.ts` (ignoring a leading `export `), except exactly the three lines tagged `// §2 + approved addition` (`Hello`, `Welcome`, `BugAction`), which must differ only by `v: 1` / `| "reopen"`
- **Depends on:** T2, T4

### [x] T7 — Build demo-erp shell: invoice form, list route, toast, mock API
- **Owner:** frontend-engineer
- **Stories:** 3, 8, 10, 11
- **Files:**
  - Create `apps/demo-erp/src/{app.tsx,router.tsx,styles.css}`, `apps/demo-erp/src/routes/{invoice-new.tsx,invoice-list.tsx}`, `apps/demo-erp/src/components/toast.tsx`, `apps/demo-erp/src/lib/api.ts`, and `apps/demo-erp/server/mock-api.ts`.
  - Modify `apps/demo-erp/vite.config.ts` and `apps/demo-erp/src/main.tsx`.
- **Change:**
  - A roughly 30-line pushState router, with links between `/invoices/new` and `/invoices`, supporting back/forward.
  - `/invoices/new`: a native `<form>` with labelled fields (customer, email, quantity, unit_price, discount %, due_date, notes, and a `card_number` field for the redaction test). Every field has a stable `data-testid` and `name`. A computed `<output data-testid="total">` shows the total. There is a native **Submit** button (`type=submit`) and a separate SPA **Save** button (`type=button`, fetch in JS).
  - Toast region `role="status"`.
  - `server/mock-api.ts` is a Vite plugin registering the same middleware in `configureServer` and `configurePreviewServer`:
    - `POST /api/invoices` and `GET /api/invoices`
    - probe endpoints for story 11: `GET /api/probe/json`, `GET /api/probe/stream` (chunked text, 5 chunks at 100 ms), `GET /api/probe/slow` (2 s, for abort), `GET /api/probe/error` (500)
    - requests carry `Authorization: Bearer demo` and `Cookie` so the redaction test has something to redact
  - Bugs are **not** planted yet; the API echoes truthfully.
- **Done when:** `pnpm --filter @valt/demo-erp build` and `pnpm --filter @valt/demo-erp typecheck` are green; `pnpm --filter @valt/demo-erp preview` serves `http://localhost:5180/invoices/new`; `curl -s -X POST localhost:5180/api/invoices -H "content-type: application/json" -d "{}"` returns JSON; `curl -N localhost:5180/api/probe/stream` prints 5 chunks.
- **Depends on:** T4

### [x] T8 — Plant 10 UI↔API bugs in demo-erp and write `fixtures/bugs.json`
- **Owner:** frontend-engineer
- **Stories:** 5, 7, 10 (anchoring-accuracy metric)
- **Files:** create `apps/demo-erp/fixtures/bugs.json` and `apps/demo-erp/fixtures/bugs.test.ts`; modify `apps/demo-erp/src/routes/invoice-new.tsx`, `apps/demo-erp/src/routes/invoice-list.tsx`, and `apps/demo-erp/server/mock-api.ts`.
- **Change:**
  - Plant 10 deterministic bugs, covering at least: C1 discount dropped from the payload while the UI shows 10%; C2 quantity sent as a string; C2 unit_price rounded; C3 unexpected field in the response; C4 the server returns 500 but the toast says "Saved"; C5 silent failure; C6 response total not reflected in `<output>`; C8 server rejects a due_date that the client accepted; C10 stack trace in the error response; plus one on `/invoices` (list total mismatch).
  - At least 8 anchors target `[data-testid=…]` elements. At least 1 anchor has a deliberately stale `anchor.selector` and resolves through `anchor.fallbackText` (label text). Exactly 1 anchor targets a non-existent element, to exercise the toast fallback.
  - `bugs.json` = `[{ "expect": {"testid": string | null}, "sweep": boolean, "bug": Bug }]` with 10 entries.
    - Each `bug` uses the exact §2 `Bug` shape: `bugId`, `fingerprint`, `title`, `severity`, `layer` (`ui`/`api`/`ui_api`/`rule`/`health`), `checkCode`, `pageUrl` (`http://localhost:5180/...`), `route`, `anchor{selector, fallbackText?}`, `steps`, `expected`, `actual`, `evidence{screenshotUrl?: "http://127.0.0.1:7777/assets/screenshots/invoice-new.png", request?, response?, highlightKeys?}`, `likelyCause?{file, line?, reason}`, `env: "localhost"`, `status: "open"`.
    - Severities span C/H/M/L.
    - 6 entries have `"sweep": true` for the `run_sweep` replay.
- **Done when:** `pnpm --filter @valt/demo-erp test` passes with:
  - every `bug` parsing with `@valt/protocol`'s `Bug` schema (strict: no extra keys)
  - exactly 10 entries and exactly 6 with `sweep: true`
  - every non-null `expect.testid` present in the route source (read the TSX and assert the string appears)
- **Depends on:** T6, T7

### [x] T9 — Add the strict-CSP test page to demo-erp
- **Owner:** frontend-engineer
- **Stories:** 11
- **Files:** create `apps/demo-erp/csp-strict.html` and `apps/demo-erp/src/csp-strict.ts`; modify `apps/demo-erp/vite.config.ts` (second `build.rollupOptions.input`) and `apps/demo-erp/server/mock-api.ts` (response header).
- **Change:**
  - A plain TS page (no React, no inline script or style) with one form that POSTs JSON via fetch, plus one field anchored by a planted bug.
  - The middleware sets `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'` on `/csp-strict.html`, and `img-src` is left at `'self'`. Note in the file header that ALT screenshots from `127.0.0.1:7777` **will** be blocked here; that is expected, and the card shows "Screenshot blocked by page policy".
- **Done when:** after `pnpm --filter @valt/demo-erp build && pnpm --filter @valt/demo-erp preview`, `curl -sI localhost:5180/csp-strict.html` shows the CSP header, and opening it in Chrome shows 0 CSP violations in the console with no extension loaded (MANUAL, automated in T25).
- **Depends on:** T7

### [x] T10 — Mock helper core: WS server, pairing, `activity`/`run_stats` timers, control API
- **Owner:** frontend-engineer
- **Stories:** 1, 2, 9, 10
- **Files:** create `tools/mock-helper/src/{server.ts,session.ts,log.ts,control.ts,server.test.ts}`; modify `tools/mock-helper/src/main.ts`.
- **Change:**
  - An `http.createServer` bound to **127.0.0.1:7777** only, with `ws` `WebSocketServer({ server, path: "/ws" })`.
  - Every outbound message is an envelope `{type, id: randomUUID(), ts: Date.now(), payload}` built from `@valt/protocol` types.
  - Every inbound frame is parsed with `parseExtensionMessage`. `unknown_type` is logged and ignored. `invalid`/`json` is logged and answered with `error{code:"bad_message"}`. A first message that is not `hello` gets `error{code:"bad_message"}` and the socket is closed.
  - `hello` (any token by default) → `welcome{v:1, helperVersion:"mock-1.0.0", project:"demo-erp", roles:["admin","clerk","viewer"], mode:"live"}`.
  - Controlled by the control API:
    - strict-token mode → `error{code:"auth_failed", message:"Invalid pairing token"}`, then close
    - version override → `welcome.v:2`
  - After `welcome`: `activity{agent, message, progress:{done:n,total:32}}` every 500 ms (cycling agents), and `run_stats{checks, agents, durationMs, trigger:"manual_submit"}` every 10 s.
  - `set_mode{paused}` stops nothing mock-side but is logged.
  - `log.ts`: every received envelope is appended to an in-memory list and to `tools/mock-helper/.logs/received.jsonl`.
  - Control API (mock-only, same port):
    - `GET /__mock/received` returns the list
    - `POST /__mock/reset` clears state
    - `POST /__mock/config` with `{strict_token?: string, v?: number, activity?: boolean, activity_ms?: number}`
  - On startup print `ALT token: 4F7K-92QD` and `ALT mock helper on ws://127.0.0.1:7777/ws`.
- **Done when:**
  - `pnpm --filter @valt/mock-helper test` passes a test that starts the server on an ephemeral port and checks:
    - a `ws` client `hello` → `welcome` with `v:1`
    - ≥ 2 `activity` envelopes within 1.2 s
    - every outbound frame validates with `parseHelperMessage`
    - strict mode + wrong token → `error{code:"auth_failed"}` and then the socket closes
    - `{"type":"ping",…}` is logged and ignored (no reply, socket open)
    - malformed JSON → `error{code:"bad_message"}` with the server still up
  - `pnpm alt:helper` prints the token line and keeps running.
  - `curl -s localhost:7777/__mock/received` returns `[]`.
- **Depends on:** T6

### [x] T11 — Mock helper behavior: `contract_result`, `run_sweep`, `bug_action`, `/assets` screenshots
- **Owner:** frontend-engineer
- **Stories:** 3, 5, 6, 7, 10
- **Files:** create `tools/mock-helper/src/{contract.ts,sweep.ts,actions.ts,contract.test.ts,actions.test.ts}` and `tools/mock-helper/assets/screenshots/invoice-new.png`; modify `tools/mock-helper/src/session.ts`.
- **Change:**
  - **`captured_submit`:** dedupe by `submitId` in memory. Build `ContractRow`s by joining `form.fields[].name` with the last request's `reqBody` and `resBody` keys (string-coerced into `uiValue`/`requestValue`/`responseValue`):
    - missing in the request → `ok:false, code:"C1"`
    - changed value or type → `ok:false, code:"C2"`
    - response `status` ≥ 400 while a `uiAfter.toasts` entry matches /saved|success/i → an extra `status` row with `ok:false, code:"C4"`
    - otherwise `ok:true`
  - For the first mismatch, emit one `bug_found` (`layer:"ui_api"`, `checkCode` = the row code, `anchor.selector` = that field's `selector`, `evidence.highlightKeys` = [field], `evidence.screenshotUrl` = `http://127.0.0.1:7777/assets/screenshots/invoice-new.png`, `env:"localhost"`, `status:"open"`, `pageUrl`/`route` from the submit).
  - Then send `contract_result{submitId, route, rows, bugIds:[that bugId]}` and `run_stats{trigger:"manual_submit"}`.
  - **`run_sweep`:** a burst of `activity`, then the 6 `sweep: true` bugs from `apps/demo-erp/fixtures/bugs.json` (relative import) as `bug_found`, about 800 ms apart (~5 s total), then `run_stats{trigger:"sweep"}`. Suppress fingerprints marked expected.
  - **`bug_action`:**
    - `ignore` → `bug_updated{bugId, status:"ignored"}`
    - `expected` → `bug_updated{status:"expected"}` and remember the fingerprint for the session
    - `reopen` → `bug_updated{status:"open"}`
    - `file_ticket` → after 600 ms, `bug_updated{status:"open", ticketUrl:"https://linear.app/alt/issue/ALT-12"}` (number increments)
    - `copy_fix_prompt` → `fix_prompt{bugId, text:"Fix <title> in <likelyCause.file>:<line> …"}`
  - More control endpoints in `tools/mock-helper/src/control.ts`:
    - `POST /__mock/config {mute_actions:true}` stops `bug_action` replies, for the 10 s client-side timeout test
    - `POST /__mock/emit {bugs: Bug[]}` sends each bug as `bug_found`, for the anchoring metric
    - `POST /__mock/garbage {n}` sends n malformed frames and n `{"type":"ping",…}` envelopes, for robustness
  - `set_role` and `set_mode` are logged only.
  - `GET /assets/*` serves from `tools/mock-helper/assets` with `content-type: image/png`.
- **Done when:** `pnpm --filter @valt/mock-helper test` covers:
  - a `captured_submit` with a dropped `discount` yields a `C1` row, exactly one `bug_found` anchored at that field's selector, and a `contract_result` whose `bugIds` contains it
  - the same `submitId` sent twice yields one `contract_result`
  - `run_sweep` emits exactly 6 `bug_found` within 6 s
  - `expected` then `run_sweep` doesn't re-emit that fingerprint
  - each action returns the documented message
  - `mute_actions` suppresses replies
  - `/__mock/emit` of 2 bugs yields 2 `bug_found`
  - every emitted frame (except `/__mock/garbage` output) validates with `parseHelperMessage`

  Also `curl -sI localhost:7777/assets/screenshots/invoice-new.png` returns 200.
- **Depends on:** T8, T10

### [x] T12 — Extension internals: runtime message types, config, severity/check tokens, chrome fake
- **Owner:** frontend-engineer
- **Stories:** 1, 3, 5, 12
- **Files:**
  - Create `apps/extension/src/shared/{runtime-messages.ts,bridge.ts,config.ts}`, `apps/extension/src/ui/{severity.ts,checks.ts,tokens.css}`, `apps/extension/test/chrome-fake.ts`, and `apps/extension/src/shared/bridge.test.ts`.
  - Modify `apps/extension/test/setup.ts`.
- **Change:** these are **extension-internal** messages only (never on the WebSocket), and all internal kinds are prefixed so they can't be confused with §2 types.
  - `bridge.ts`: hook↔content `window.postMessage` shapes with `source: "alt-hook" | "alt-cs"` and hand-written type guards (no zod, since this is shared with the MAIN world). Kinds: `hook:req_start`, `hook:req_end`, `hook:nav`, `hook:perf`, `cs:mode`.
  - `runtime-messages.ts`:
    - content→SW: `cs:submit` (carries a `CapturedSubmit["payload"]`), `cs:route`, `cs:open_panel`, `cs:bug_action`, `cs:keepalive`
    - SW→content: `sw:bugs_for_route`, `sw:action_state`, `sw:focus_bug`, `sw:mode`, `sw:toast`
    - panel⇄SW port: `p:snapshot`, `p:patch`, `p:pair`, `p:set_role`, `p:set_mode`, `p:run_sweep`, `p:bug_action`, `p:focus_bug`, `p:heartbeat`
  - `config.ts`: `HELPER_START_COMMAND = "pnpm alt:helper"`, `FEED_CAP = 200`, `QUEUE_CAP = 50`, `QUEUE_BYTES = 8_000_000`, `ACTION_TIMEOUT_MS = 10_000`, `SETTLE_MS = 800`, `KEEPALIVE_MS = 20_000`, `RECONNECT_MAX_MS = 2_000`, `EXT_VERSION` (from the manifest version).
  - `severity.ts`: `{critical: {label: "C", name: "Critical"}, high: "H", medium: "M", low: "L"}`.
  - `checks.ts`: C1–C12 titles from `docs/plans/PHASE_2_UI_API_INTELLIGENCE_ENGINE.md:176-359` ("C1 Missing field", "C2 Value changed in transit", …) and `checkLabel(code?)`, falling back to the raw code.
  - `tokens.css`: MASTER tokens copied from `apps/web/src/app/globals.css:23-108` (light, and dark via `prefers-color-scheme`), plus severity vars:
    - `--sev-critical`: `--destructive`
    - `--sev-high`: `--warning`
    - `--sev-medium`: `#8A6A00` light / `#FFD60A` dark (check ≥ 4.5:1 and record the ratio in a comment)
    - `--sev-low`: `--muted-foreground`
  - `chrome-fake.ts`: an in-memory `chrome.storage.{local,session}`, `runtime.{onMessage,sendMessage,connect,getPlatformInfo}`, `tabs`, `windows`, `action.setBadgeText/getBadgeText`, `sidePanel`, and `alarms`, installed on `globalThis` in `setup.ts`.
- **Done when:** `pnpm --filter @valt/extension test` passes bridge guard tests (they accept valid shapes and reject a foreign `source` and extra junk) and a `checks.ts` test (`checkLabel("C2")` → "C2 Value changed in transit"; unknown → the code). Typecheck is green.
- **Depends on:** T5, T6

### [x] T13 — MAIN-world page hook for fetch, XHR, and SPA navigation
- **Owner:** frontend-engineer
- **Stories:** 3, 8, 11
- **Files:** create `apps/extension/src/hook/hook-core.ts` and `apps/extension/src/hook/hook-core.test.ts`; modify `apps/extension/src/hook/page-hook.iife.ts`.
- **Change:**
  - Wrap `window.fetch` so it returns **the original promise object**. Clone the `Request` body only for non-GET requests, before delegating. On resolve, `response.clone()` is read asynchronously only when content-type is JSON/text/form and not `text/event-stream`. Reads stop at 64 KB (reader `cancel()` after the limit), and the hook posts `{bodyText, bytesSeen, cut: boolean}`. The content script turns that into the §2 in-band truncated string (T14).
  - Record `initiator: "fetch" | "xhr"`, `reqId`, `method`, `url`, `status` (0 on network error), request headers, and `durationMs`, which are the fields `CapturedRequest` needs.
  - Patch `XMLHttpRequest.prototype.open/send/setRequestHeader` and observe via `addEventListener("loadend")`. Never assign `onreadystatechange`/`onload`, and read the body only for `responseType` `""`/`"text"`/`"json"`.
  - Patch `history.pushState`/`replaceState` and listen to `popstate`, then post `hook:nav`.
  - Every wrapper body is in `try/catch` and fails open to the original call.
  - Sync overhead is recorded with `performance.now()` in a 512-slot ring, and `hook:perf` returns p50/p95.
  - When `cs:mode` is `paused`, wrappers skip all capture work.
  - The IIFE imports only `hook-core.ts` and `../shared/bridge.ts`.
- **Done when:** `pnpm --filter @valt/extension test` (happy-dom, stubbed `fetch`/`XMLHttpRequest`) proves:
  - the returned fetch promise `===` the original's
  - a rejected fetch rejects identically and posts `status: 0`
  - `AbortController` abort propagates `AbortError`
  - an SSE response body is never cloned or read
  - a >64 KB body is posted with `cut:true`
  - an XHR `onload` set by the page still fires once, and XHR posts `initiator:"xhr"`
  - a throwing hook internal leaves fetch working
  - p95 of recorded overhead over 200 synthetic calls is < 1 ms

  After `pnpm --filter @valt/extension build`, the hook bundle in `dist` still has no `import(`.
- **Depends on:** T12

### [x] T14 — Redaction, truncation, and traffic filter
- **Owner:** frontend-engineer
- **Stories:** 3, 4
- **Files:** create `apps/extension/src/content/{redact.ts,redact.test.ts,filter.ts,filter.test.ts}`.
- **Change:**
  - `redactHeaders` (for `reqHeaders`): `authorization`, `cookie`, `x-api-key` (case-insensitive) → `"[redacted]"`.
  - `redactBody` (for `reqBody`/`resBody`): recursive over JSON objects/arrays, URL-encoded and FormData-derived objects. Keys matching `/pass|token|secret|otp|cvv|card/i` → `"[redacted]"`; `File` → `"[file]"`. The same rule applies to URL query params in `url`.
  - `redactField` (for `form.fields[]`): `type=password`, or `name`/`label` matching → `value: "[redacted]"`.
  - `toBody(bodyText, bytesSeen, cut)`: parse JSON when possible. If `cut`, return a **string** made of the first 65,536 chars + `truncatedMarker(bytesSeen)` from `@valt/protocol` (§2 has no flag field). Redaction runs before truncation for parseable bodies; for cut bodies, redact `"key":"value"` pairs by regex on the raw prefix.
  - `filter.ts` `isCandidateRequest(url, method)`: false for the helper origin `127.0.0.1:7777`, HMR paths (`/@vite/`, `/@react-refresh`, `__webpack_hmr`, `/_next/webpack-hmr`, `.hot-update.`, `sockjs-node`), static asset extensions, and non-`http(s)` schemes.
- **Done when:** `pnpm --filter @valt/extension test` shows table-driven cases:
  - the three PRD headers redacted in any case
  - `password`, `newPass`, `api_token`, `clientSecret`, `otpCode`, `cvv`, `card_number` redacted in JSON, form-encoded, and a cut raw prefix
  - `customer`, `discount`, `quantity` unchanged
  - nested arrays handled
  - a 70 KB body becomes a string ending with `…[truncated: 71680 bytes]`
  - HMR/static/helper URLs rejected and `POST /api/invoices` accepted
- **Depends on:** T12

### [x] T15 — Content-script capture pipeline: submit detection, correlation, UI scrape → `captured_submit` payload
- **Owner:** frontend-engineer
- **Stories:** 3, 4, 9, 11
- **Files:** create `apps/extension/src/content/{capture.ts,scrape.ts,capture.test.ts}`; modify `apps/extension/src/content/index.ts`.
- **Change:**
  - Listen to `submit` (capture phase, passive) and to clicks on `button:not([type=submit])` whose text or aria-label matches `/save|submit|create|update/i` (the SPA Save heuristic).
  - `scrape.form(trigger)` → `form: {selector, fields}`:
    - `selector` is the closest `form`, else the closest `[data-testid]`, else `"body"`
    - each field is `{name, label, type, value, selector}`, taken from controls and `<output>` elements. `name` = `name || id || label`, `type` = input type / `"select"` / `"textarea"` / `"output"`, the selector prefers `[data-testid]` then `[name]` then `#id`, and `value` is always a string (redacted).
  - Correlate candidate requests (T14 filter) that start within 50 ms before to 2 s after the trigger. The window closes 800 ms after the last `hook:req_end` with no new start.
  - `scrape.after()` → `uiAfter: {toasts, fieldErrors: [{selector, text}], url}` from `role=status|alert` / `aria-live`, `aria-invalid` + `aria-describedby`, and `location.href`.
  - Build `CapturedRequest[]` (`reqId`, `method`, `url`, `status`, `reqHeaders`, `reqBody`, `resBody`, `durationMs`, `initiator`), redacted and truncated per T14.
  - Send `runtime.sendMessage({kind:"cs:submit", payload: {submitId: crypto.randomUUID(), pageUrl: location.href, route: location.pathname, form, requests, uiAfter}})`. The payload is typed as `CapturedSubmit["payload"]`, so the SW only wraps it in the envelope.
  - A trigger with 0 correlated requests sends nothing.
  - Accept bridge messages only if `event.source === window` and the guard passes.
  - When `sw:mode` is `paused`, forward `cs:mode` to the hook and send nothing.
  - Send `cs:route` on load and on every `hook:nav`, and `cs:keepalive` every 20 s while the tab is visible (`document.visibilityState`).
- **Done when:** `pnpm --filter @valt/extension test` (happy-dom, fake bridge events, chrome fake) shows:
  - native submit plus one POST → exactly one `cs:submit` whose payload validates against `@valt/protocol`'s `CapturedSubmit` payload schema, with redacted `authorization` and `card_number`
  - SPA Save click → one submit with a `form.selector` of `"body"` or `[data-testid=…]` when there is no form
  - two requests 300 ms apart → one submit containing both, sent ≥ 800 ms after the last end (fake timers)
  - a GET for `/@vite/client` during the window is excluded
  - paused → 0 `cs:submit` messages
  - a spoofed message from another `source` is ignored
  - `cs:keepalive` fires every 20 s of fake time
- **Depends on:** T13, T14

### [ ] T16 — Service-worker connection manager: pairing, reconnect, keep-alive, version check
- **Owner:** frontend-engineer
- **Stories:** 1, 9
- **Files:** create `apps/extension/src/background/{connection.ts,connection.test.ts}`.
- **Change:**
  - A state machine with `status: "no_token" | "connecting" | "connected" | "down" | "reconnecting" | "pairing_failed" | "version_mismatch"`, plus `everConnected` (red "down" before the first success, amber "reconnecting" after).
  - Read the token from `chrome.storage.local.alt_token`, open `new WebSocket(DEFAULT_WS_URL)`, and send `hello{token, extVersion: EXT_VERSION, v:1}` as the **first** frame.
  - `welcome.payload.v !== 1` → `version_mismatch` (send nothing else; retry every 10 s).
  - `error{code:"auth_failed"}` (and the close that follows) → `pairing_failed`, no retry until the token changes. Any other `error` code is logged, and the status is unchanged.
  - `close`/`error` without a preceding `auth_failed` → `reconnecting`, reached synchronously in the close handler (the PRD asks for ≤ 2 s). Backoff is 250 ms → 500 ms → 1 s → 2 s (cap) with ±20% jitter, and each attempt calls `chrome.runtime.getPlatformInfo()` to reset the SW idle timer.
  - A `chrome.alarms` "alt-keepalive" every 30 s restarts the loop if the SW was evicted.
  - **No WS ping** (not in §2). Keep-alive comes from `cs:keepalive`/`p:heartbeat` runtime traffic (T15, T20) plus inbound helper frames.
  - `send(msg)` wraps the payload in the envelope (`id: crypto.randomUUID()`, `ts: Date.now()`), validates it with the protocol schema in dev builds, and returns false when not connected.
  - Inbound frames go through `parseHelperMessage`. `unknown_type` → `console.debug` + `dropped.unknown_type++` (ignored + logged per §2). `json`/`invalid` → `dropped.*++`. Nothing throws.
- **Done when:** `pnpm --filter @valt/extension test` with a fake `WebSocket` class and fake timers proves:
  - the first frame sent is `hello` with `v:1` and `extVersion`
  - `welcome` → `connected` with the project `"demo-erp"`
  - `error{code:"auth_failed"}` + close → `pairing_failed` and no further connects
  - a server close → `reconnecting` in the same tick, with reconnection ≤ 2.5 s of fake time after the server is available
  - `welcome{v:2}` and a `welcome` missing `v` → `version_mismatch`
  - 100 malformed frames and 10 `{"type":"ping"}` frames → still `connected`, `dropped.json === 100`, `dropped.unknown_type === 10`
  - `getPlatformInfo` is called on each attempt
  - no frame with a type outside §2 is ever sent (a spy checks every `send` against `ExtensionToHelper`)
- **Depends on:** T12

### [ ] T17 — SW store, offline queue, routing, toolbar badge, panel opening
- **Owner:** frontend-engineer
- **Stories:** 2, 3, 6, 7, 8, 9
- **Files:** create `apps/extension/src/background/{store.ts,store.test.ts,queue.ts,queue.test.ts,router.ts,router.test.ts,badge.ts}`; modify `apps/extension/src/background/index.ts`.
- **Change:**
  - **`store.ts`** holds `project`, `roles`, `role` (the last picked this session, else `roles[0]`), `mode` (persisted in `storage.local`, so the kill switch survives a restart), the latest `run_stats`, a feed ring of `activity` (cap 200, oldest dropped, each entry stamped with the envelope `ts`), bugs by `bugId`, contracts by `submitId` (dedupe, newest first, cap 100, named with the `captured_submit` envelope `ts` kept in `submitTs[submitId]`), `pendingActions[bugId]`, `status`, `dropped` counters, and `queueDropped`. Everything except `mode` and the token persists to `chrome.storage.session` (debounced 100 ms) and rehydrates on SW start. It emits `p:patch`.
  - **On `welcome`:** store `project`/`roles`. If `welcome.mode !== store.mode`, send `set_mode{mode: store.mode}`. If the user picked a role this session, send `set_role{role}`. Then flush the queue.
  - **`queue.ts`:** `cs:submit` payloads that arrive while not connected are appended with their envelope `ts` (cap 50 and 8 MB; the oldest is dropped and sets `queueDropped`). The queue is persisted in `storage.session`. On connect, flush in order as `captured_submit` with at most 10 in flight. An item is removed only when a `contract_result` with its `submitId` arrives, and the store dedupes by `submitId`.
  - **`router.ts`:**
    - `cs:submit` → drop if `mode === "paused"`, else send `captured_submit` or queue it
    - `cs:bug_action` / `p:bug_action` → if `pendingActions[bugId]` already exists, reject (the UI disables buttons). Otherwise send `bug_action{bugId, action}` and set a 10 s timer. It resolves on `bug_updated` (same `bugId`, for ignore/expected/reopen/file_ticket) or `fix_prompt` (same `bugId`, for copy_fix_prompt). On timeout, emit `sw:action_state{bugId, state:"timeout"}`.
    - `bug_found` → store, then push `sw:bugs_for_route` to every tab whose recorded route equals `bug.route`. New bugs per route are grouped over 1 s into one `sw:toast{count, route}`.
    - `bug_updated` → update `status`/`ticketUrl` and resolve the pending action. `fix_prompt` → resolve and forward the text to the requesting tab or panel. `contract_result` → store and dequeue. `run_stats` / `activity` → store.
    - `cs:open_panel` → **synchronously** `chrome.sidePanel.open({tabId: sender.tab.id})` as the first statement in the `onMessage` listener, with no `await` before it.
    - `cs:keepalive` → no-op; receipt resets the idle timer.
    - Panel port: `p:snapshot` on connect, `p:patch` after. `p:pair` writes the token and reconnects. `p:set_mode` stores the mode, broadcasts `sw:mode` to tabs, and sends `set_mode`. `p:set_role` → `set_role`. `p:run_sweep` → `run_sweep{target:"localhost", role}`. `p:focus_bug` → `tabs.update(active)` + `windows.update(focused)` + `sw:focus_bug`, or reply `{navigate: route}`. `p:heartbeat` → no-op.
  - **`badge.ts`:** on bug changes, `tabs.onActivated`, and `cs:route`, call `chrome.action.setBadgeText({tabId, text: count || ""})` where count = open critical+high bugs whose `route` equals that tab's route.
  - **`index.ts`:** wire it all and call `setPanelBehavior({openPanelOnActionClick: true})`.
- **Done when:** `pnpm --filter @valt/extension test` (chrome fake plus a fake connection) proves:
  - 250 `activity` → feed length 200 with the oldest gone
  - rehydration from `storage.session` equals the pre-restart state
  - 55 submits while down → queue 50 with `queueDropped:true`; after `welcome`, 50 `captured_submit` are sent, and exactly 50 contract entries follow even when the fake helper replays 5 duplicate `contract_result`
  - paused → a submit is neither sent nor queued
  - `welcome{mode:"live"}` while the store is paused → `set_mode{paused}` is sent
  - an action with no reply → `timeout` at 10 s; a second action on the same `bugId` while pending is rejected
  - `sidePanel.open` is called before any awaited promise in the `cs:open_panel` handler (the fake records call order)
  - badge text for a tab on `/invoices/new` counts only open critical+high bugs on that route
  - every sent frame's `type` is in §2
- **Depends on:** T15, T16

### [ ] T18 — Overlay root, anchor resolution, badges, positioning, Alt+G
- **Owner:** frontend-engineer
- **Stories:** 5, 7, 8, 11, 12
- **Files:** create `apps/extension/src/overlay/{root.ts,anchor.ts,anchor.test.ts,positioner.ts,positioner.test.ts,badges.tsx,overlay.css}`; modify `apps/extension/src/content/index.ts`.
- **Change:**
  - **`root.ts`:** define an `<alt-root>` element appended to `document.documentElement` with an **open** shadow root (Playwright pierces open roots). Host style is `all: initial; position: fixed; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none`. `overlay.css` and `tokens.css` are inlined via `?inline` into a `<style>` in the shadow root. No page styles are touched.
  - **`anchor.ts`:** `resolve(bug.anchor)` tries `querySelector(anchor.selector)` in try/catch, and is visible only if its rect is non-zero. If that fails, it matches `anchor.fallbackText` against the trimmed text of `label, button, legend, th, [aria-label]` and maps a label to its control. It returns `{el} | {fallback: "toast"}`.
  - **`badges.tsx`:** a 20 px Preact badge per anchored element (grouped count when there are several bugs) with a severity color, letter, `aria-label` "3 ALT issues, highest High", and `button` semantics. It pulses once when new, and under reduced motion it only fades.
  - **`positioner.ts`:** reposition on scroll (capture, passive), `resize`, a `ResizeObserver` on anchored elements, and a `MutationObserver` on `body` (debounced to the next rAF). Observers exist only while ≥ 1 badge is shown, and there is no continuous rAF loop.
  - On `sw:bugs_for_route` or `hook:nav`, re-render: badges for other routes disappear, and unresolved bugs go to the toast queue (T19).
  - `keydown` Alt+G (capture phase, ignored inside editable fields) toggles `hidden` on the host.
- **Done when:** `pnpm --filter @valt/extension test` proves:
  - resolve by selector; by `fallbackText` via a label → input; `{fallback:"toast"}` when both fail; an invalid selector doesn't throw
  - two bugs on one element → one badge with count 2
  - after a simulated scroll/resize, the badge is within 4 px of `rect.right + 4 / rect.top`
  - Alt+G toggles `hidden`; with 0 badges no observers are attached (spy)
  - the host doesn't change any `document.body` computed style (snapshot before/after)
- **Depends on:** T17

### [ ] T19 — Overlay bug card, toasts, and in-page actions
- **Owner:** frontend-engineer
- **Stories:** 5, 6, 7, 11, 12
- **Files:** create `apps/extension/src/overlay/{card.tsx,json-view.tsx,toast.tsx,actions.ts,ticket.ts,card.test.tsx}`; modify `apps/extension/src/overlay/badges.tsx` and `apps/extension/src/content/index.ts`.
- **Change:**
  - **`card.tsx`** (`role="dialog"`, focus trapped, Esc closes and returns focus to the badge) shows:
    - `title`
    - severity and `layer` chips with text (`ui`/`api`/`ui_api`/`rule`/`health`)
    - `checkCode` via `checkLabel`
    - `expected` vs `actual` and ordered `steps`
    - collapsible `evidence.request` / `evidence.response` (`json-view.tsx` renders **text nodes only** and highlights `evidence.highlightKeys`)
    - `evidence.screenshotUrl` only if its origin is `http://127.0.0.1:7777` and its path starts with `/assets/`, with `onerror` → "Screenshot blocked by page policy"
    - `likelyCause` as `file:line — reason`
  - No `dangerouslySetInnerHTML` anywhere.
  - **`ticket.ts`:** `ticketLabel(ticketUrl)` returns the `/[A-Z][A-Z0-9]+-\d+/` match + " ↗" or "Ticket ↗". It returns a link only for `http(s)`.
  - **Buttons** (all send `cs:bug_action` and are disabled while pending):
    - **File ticket**: a spinner until `bug_updated` with `ticketUrl`, then the `ALT-12 ↗` link (`target=_blank rel=noopener`)
    - **Mark expected** / **Ignore** remove the badge when `bug_updated` arrives with that status
    - **Copy fix prompt** sends `copy_fix_prompt`. On `fix_prompt` it calls `navigator.clipboard.writeText` and shows "Copied" for 2 s. If the write fails (activation expired), it shows a read-only textarea + "Copy" button.
    - On `sw:action_state` timeout the button returns to idle with "Helper didn't respond. Try again."
  - **`toast.tsx`** (bottom-right, `role="status"`): "ALT: N new issues on /route". Click → `runtime.sendMessage({kind:"cs:open_panel"})` directly in the handler. Anchor-fallback bugs also toast.
  - The card has an opaque `--card` background and its own `color-scheme`.
- **Done when:** `pnpm --filter @valt/extension test` renders the card from each `bug_found` fixture and each `apps/demo-erp/fixtures/bugs.json` bug and proves:
  - Esc closes and restores focus; Tab stays within the card
  - a `title` of `<img src=x onerror=alert(1)>` renders as literal text
  - a `ticketUrl` of `javascript:alert(1)` renders as text, not a link
  - `ticketLabel("https://linear.app/alt/issue/ALT-12")` === "ALT-12 ↗"
  - a screenshot from another origin, or not under `/assets/`, isn't rendered
  - timeout copy appears after the fake 10 s
  - a toast click sends `cs:open_panel` synchronously

  `grep -rn dangerouslySetInnerHTML apps/extension/src` returns nothing.
- **Depends on:** T18

### [ ] T20 — Side panel shell: port client, header, banners, Settings
- **Owner:** frontend-engineer
- **Stories:** 1, 2, 7, 9, 12
- **Files:** create `apps/extension/src/panel/{app.tsx,state.ts,components/header.tsx,components/banners.tsx,components/settings.tsx,panel.test.tsx}`; modify `apps/extension/src/panel/{main.tsx,styles.css,index.html}`.
- **Change:**
  - **`state.ts`:** `chrome.runtime.connect({name:"panel"})` receives `p:snapshot`/`p:patch` into a Preact signal store, reconnects the port on disconnect, and sends `p:heartbeat` every 20 s.
  - **Header:**
    - a status dot with text label (green "Connected · demo-erp" from `welcome.project`, amber "Reconnecting…", red "Not connected")
    - a stats line from `run_stats`: "42 checks · 7 agents · 4.8s" (`durationMs / 1000`, one decimal) in `text-title-3 tabular-nums`
    - a role `<select>` listing exactly `welcome.roles`, which sends `p:set_role` and updates the header immediately
    - a Live/Paused toggle (`aria-pressed`, header text "Paused" when paused) → `p:set_mode`
    - an "N queued" / "N queued · oldest dropped" counter
    - a **Full sweep** button → `p:run_sweep`
  - **`banners.tsx`:**
    - `down` & !everConnected: "Helper not running. Start it with: `pnpm alt:helper`" plus a Copy button
    - `pairing_failed`: "Pairing failed. Check the token printed by the helper."
    - `version_mismatch`: a persistent "Update helper: this extension needs protocol v1"
  - **`settings.tsx`:** a labelled token input (`type=password`, masked as `••••-92QD` once saved) with Save → `p:pair`, and the trust copy "ALT only reads pages on localhost and 127.0.0.1. Nothing else is visible to it."
  - Tabs: Feed / Contract / Bugs / Settings (`role=tablist`, arrow keys). Light/dark via tokens. 44 px controls, visible focus.
- **Done when:** `pnpm --filter @valt/extension test` renders `app.tsx` from snapshots and shows:
  - each status displays the exact PRD copy
  - Copy puts `pnpm alt:helper` on a clipboard spy
  - the role select lists exactly `roles`
  - `run_stats{checks:42, agents:7, durationMs:4800}` renders "42 checks · 7 agents · 4.8s"
  - Paused shows "Paused"
  - `queue: 50, queueDropped: true` shows "50 queued · oldest dropped"
  - every control is reachable with Tab

  MANUAL: load unpacked, paste the token printed by `pnpm alt:helper`, and the dot turns green with "demo-erp".
- **Depends on:** T17

### [ ] T21 — Side panel Feed and Contract views
- **Owner:** frontend-engineer
- **Stories:** 2, 3, 4
- **Files:** create `apps/extension/src/panel/components/{feed.tsx,contract.tsx,views.test.tsx}`; modify `apps/extension/src/panel/app.tsx`.
- **Change:**
  - **Feed:** newest-first list of ≤ 200 `activity` entries with an `agent` chip, `message`, and a progress label "14/32" from `progress.done/total`, inside `aria-live="polite"`. It is not virtualized.
  - **Contract:** a picker of this session's entries named "`/invoices/new` · 14:03:22" (from `submitTs`), and a table Field | UI | Request | Response from `uiValue`/`requestValue`/`responseValue`.
    - `ok:false` rows use the `--destructive` tint plus ❌ with `title`/`aria-label` = `checkLabel(row.code)`, e.g. "C2 Value changed in transit".
    - `ok:true` rows show ✅.
    - `[redacted]` values render verbatim.
    - A cell whose value ends with the protocol truncation marker shows a "truncated" chip.
  - When a new `contract_result` arrives, switch to Contract unless the current tab is Settings.
- **Done when:** `pnpm --filter @valt/extension test` shows:
  - the 201st activity is not rendered
  - progress renders "14/32"
  - the `contract_result` fixture renders one row per `rows[]` entry with ❌/✅ and the `checkLabel` title
  - a new contract switches from Feed but not from Settings
  - the picker switches tables
  - a marker-suffixed value shows the "truncated" chip
- **Depends on:** T20

### [ ] T22 — Side panel Bugs list: filters, reopen, tickets, focus-in-tab
- **Owner:** frontend-engineer
- **Stories:** 6, 7, 8
- **Files:** create `apps/extension/src/panel/components/{bugs.tsx,bugs.test.tsx}`; modify `apps/extension/src/panel/app.tsx` and `apps/extension/src/content/index.ts` (handle `sw:focus_bug`: `scrollIntoView({block:"center"})` then open the card).
- **Change:**
  - An inset-grouped list sorted by severity, with a severity filter (C/H/M/L chips with text) and a status filter (open / ignored / expected / fixed, default open).
  - Each row shows the letter badge, `title`, `route`, and `checkCode`, plus the `ticketLabel(ticketUrl)` link when present.
  - A **Reopen** button appears only on `ignored`/`expected` rows (decision 2) and sends `p:bug_action{bugId, action:"reopen"}`.
  - Row click → `p:focus_bug`. On `{navigate: route}` it shows "Navigate to /invoices/new to see this pin".
- **Done when:** `pnpm --filter @valt/extension test` shows:
  - status filter "ignored" lists only ignored bugs
  - Reopen appears only on ignored/expected and sends `reopen`
  - severity filter H hides others
  - the ticket link renders for `https:` only
  - a `navigate` reply shows the exact copy
  - rows are keyboard-operable
- **Depends on:** T20, T19

### [ ] T23 — E2E harness: Playwright with the unpacked extension, mock-helper process, demo-erp preview
- **Owner:** qa-engineer
- **Stories:** enables 1–12 and metrics
- **Files:** create `apps/extension/playwright.config.ts`, `apps/extension/e2e/fixtures.ts`, `apps/extension/e2e/helpers/{mock.ts,sw.ts,panel.ts}`, and `apps/extension/e2e/smoke.spec.ts`; modify `apps/extension/package.json` (devDep `@playwright/test ^1.63.0`, scripts `e2e` = `playwright test`, `e2e:install` = `playwright install chromium`).
- **Change:**
  - Config: `workers: 1`, `fullyParallel: false` (one mock on port 7777). `webServer` = demo-erp `preview` on 5180.
  - Fixtures:
    - `context`: `chromium.launchPersistentContext(tmpDir, {channel: "chromium", args: ["--disable-extensions-except=<dist>", "--load-extension=<dist>"]})`
    - `extensionId` from `serviceWorkers()[0].url().split("/")[2]`
    - `plainContext` with no extension
  - `mock.ts`: spawn `node --import tsx tools/mock-helper/src/main.ts` as a direct child (killable on Windows), with `start/stop/restart`, `received()`, `reset()`, and `config()` via `/__mock/*`.
  - `panel.ts`: open `chrome-extension://<id>/src/panel/index.html` as a tab (Playwright can't drive the real side panel) and pair via Settings.
  - `sw.ts` `stopServiceWorker(context)`: spike `context.newCDPSession(page)` → `Target.getTargets` → `Target.closeTarget` on the extension `service_worker` target. If unsupported, navigate a page to `chrome://serviceworker-internals` and click the extension's Stop. Record which one works in a comment.
  - `smoke.spec.ts`: SW present, panel pairs, dot connected.
- **Done when:** `pnpm --filter @valt/extension e2e:install` once, then `pnpm e2e` (turbo builds extension and demo-erp first) passes `smoke.spec.ts` headless on Windows, and `sw.ts` has a passing self-test (the SW URL reappears after a stop and a panel message).
- **Depends on:** T9, T11, T20

### [ ] T24 — E2E: pairing, reconnect after browser restart, live feed, mock script
- **Owner:** qa-engineer
- **Stories:** 1, 2, 10
- **Files:** create `apps/extension/e2e/{pairing.spec.ts,feed.spec.ts,mock-helper.spec.ts}`.
- **Change / Done when:** `pnpm e2e` passes:
  - **Story 1:**
    - token save → dot "Connected · demo-erp" within 2 s, and the first received envelope in `mock.received()` is `hello` with `v:1`
    - strict mock + wrong token → `error{code:"auth_failed"}`, the exact pairing-failed copy, dot red
    - relaunch the persistent context on the same `userDataDir` → auto-connect without re-entry, token masked
    - with the mock stopped: "Helper not running. Start it with: pnpm alt:helper", and Copy puts that string on the clipboard
  - **Story 2:**
    - an activity row appears within 1 s of its envelope `ts`
    - progress label present
    - stats line matches `/^\d+ checks · \d+ agents · [\d.]+s$/`
    - with `mock.config({activity_ms: 20})`, the feed holds exactly 200
    - close and reopen the panel tab → the same last 200 and all bugs
  - **Story 10:**
    - the mock accepts any token by default
    - `activity` roughly every 500 ms; `run_stats` every 10 s (±1 s)
    - `run_sweep` yields 6 `bug_found` within 6 s
    - `file_ticket` → `bug_updated.ticketUrl` rendered as "ALT-12 ↗"
    - every envelope in `mock.received()` has a `type` from §2 (hello, set_mode, run_sweep, set_role, bug_action, captured_submit) and non-empty `id` and numeric `ts`
- **Depends on:** T21, T22, T23

### [ ] T25 — E2E: contract capture, redaction, and host-app safety (incl. strict CSP, hook overhead)
- **Owner:** qa-engineer
- **Stories:** 3, 4, 11
- **Files:** create `apps/extension/e2e/{contract.spec.ts,redaction.spec.ts,host-app.spec.ts,csp.spec.ts}`.
- **Change / Done when:** `pnpm e2e` passes:
  - **Story 3:**
    - native Submit and SPA Save each create one Contract entry named "/invoices/new · HH:MM:SS" with Field | UI | Request | Response rows
    - the discount row is ❌ with title "C1 Missing field"
    - the picker shows earlier submits
    - loading the page, navigation, and helper traffic produce 0 `captured_submit` in `mock.received()`
  - **Story 4:**
    - in `mock.received()`, every `captured_submit.payload.requests[].reqHeaders` has `authorization`, `cookie`, `x-api-key` = `[redacted]`
    - `form.fields[name=card_number].value` and `reqBody.card_number` = `[redacted]`, while `customer`/`discount` are intact
    - the Contract table shows `[redacted]`
    - a 70 KB `notes` body arrives as a string ending with `…[truncated: ` and the table shows the "truncated" chip
  - **Story 11:**
    - `host-app.spec.ts` runs the same demo-erp checks (form submit toast, list navigation, `/api/probe/json`, the stream chunk count, abort → `AbortError`, `/api/probe/error` → 500) in `plainContext` and the extension context, asserts identical results, and finds 0 `pageerror` events or console errors mentioning `chrome-extension://` or `alt-`
    - `csp.spec.ts` on `/csp-strict.html` gets a Contract entry, a pinned badge, 0 `securitypolicyviolation` events (via `addInitScript`), and 0 "Refused to" console messages
    - hook p95 read via the bridge `hook:perf` after ≥ 200 fetches is ≤ 1 ms
- **Depends on:** T21, T23

### [ ] T26 — E2E: pins, anchoring accuracy, bug actions, Full sweep, SPA navigation, keyboard/theme
- **Owner:** qa-engineer
- **Stories:** 5, 6, 7, 8, 12
- **Files:** create `apps/extension/e2e/{pins.spec.ts,anchoring.spec.ts,actions.spec.ts,sweep.spec.ts,navigation.spec.ts,a11y.spec.ts}`.
- **Change / Done when:** `pnpm e2e` passes:
  - **Story 5:**
    - after a submit, a badge appears within 2 s of the `bug_found` beside `[data-testid=discount]`
    - after scroll, viewport resize, and an inserted banner, the badge is within 4 px of `rect.right+4`
    - two bugs on one field → count 2
    - the card shows every field and Esc closes it
    - Alt+G hides and shows `alt-root`
    - the card is readable with `body{background:#000}` injected
  - **Anchoring metric:** send all 10 `fixtures/bugs.json` bugs as `bug_found` (mock control `POST /__mock/emit`, from T11) and assert ≥ 9 resolve to `expect.testid`. The one designed to fail shows as a toast plus a Bugs entry, and the Bugs list count = 10.
  - **Story 6:**
    - File ticket spinner → "ALT-12 ↗", also in the Bugs list
    - Mark expected → the badge is gone ≤ 1 s, and stays gone after reload and after `run_sweep`
    - Ignore → gone ≤ 1 s
    - Copy fix prompt → the log has `bug_action{action:"copy_fix_prompt"}`, the clipboard equals the `fix_prompt.text`, and "Copied" shows for about 2 s
    - `mute_actions` → "Helper didn't respond. Try again." at about 10 s
    - status filters show ignored/expected; Reopen → the log has `action:"reopen"` and the bug is back to open
  - **Story 7:**
    - picking a role updates the header, and the log has `set_role`
    - Full sweep → the log has `run_sweep{target:"localhost"}`, a Feed row within 1 s, and 6 bugs in about 5 s, with badges only in the tab on the matching route (a second tab on `/invoices` shows only its own)
    - toast "ALT: N new issues on /invoices/new", and clicking it produces no page error (the panel open itself is MANUAL; unit-proven in T17)
    - toolbar badge via `serviceWorker.evaluate(() => chrome.action.getBadgeText({tabId}))` equals the open C+H count and updates on tab switch and route change
  - **Story 8:** pushState, back, and forward → the new route's badges within 500 ms and the old ones gone. A Bugs-list click focuses the tab, scrolls, and opens the card. A different route shows "Navigate to /invoices/new to see this pin". Filters work.
  - **Story 12:** dark `emulateMedia` → panel background `#000000`. Severity chips carry a letter or text. A keyboard-only pass reaches every panel control and card button, and focus is visible.
- **Depends on:** T19, T22, T23

### [ ] T27 — E2E: pause, helper restart with queue, SW restart, protocol mismatch, latency metric
- **Owner:** qa-engineer
- **Stories:** 9; metrics Submit→Contract, Recovery
- **Files:** create `apps/extension/e2e/{resilience.spec.ts,latency.spec.ts}`.
- **Change / Done when:** `pnpm e2e` passes:
  - **Story 9:**
    - **Pause:** Paused → header "Paused", the log has `set_mode{mode:"paused"}`, and a submit adds 0 `captured_submit`.
    - **Helper killed:** `mock.stop()` → amber "Reconnecting…" ≤ 2 s, with 0 `dialog` events. 55 submits → "50 queued · oldest dropped". `mock.start()` → connected ≤ 10 s after the port accepts. The first frame after reconnect is `hello`. Exactly 50 new Contract entries, the log has 50 distinct `submitId`s, and pre-restart bugs and feed are still shown.
    - **SW restart:** `stopServiceWorker()` while connected → connected again ≤ 10 s, with bugs and feed intact.
    - **Mismatch:** `mock.config({v:2})` + restart → the persistent banner text is exact.
    - **Garbage:** `POST /__mock/garbage {n:20}` (from T11: 20 malformed + 20 `{"type":"ping",…}`) → the panel stays connected with no visible error.
  - **Latency metric:** 20 scripted submits. The last correlated response time comes from the bridge `hook:req_end` (`Date.now()`), and the render time from a `MutationObserver` in the panel tab. Assert p95 ≤ 2000 ms, and write p50/p95 to `test-results/latency.json`.
- **Depends on:** T24, T25

### [ ] T28 — Demo runbook, rehearsal command, and manual checklist
- **Owner:** qa-engineer
- **Stories:** 10; metrics Demo readiness, Idle cost, demand signal
- **Files:** create `apps/extension/README.md` and `apps/extension/e2e/dod.spec.ts`; modify `apps/extension/package.json` (script `e2e:rehearse` = `playwright test e2e/dod.spec.ts --repeat-each=5`) and root `package.json` (`"e2e:rehearse": "pnpm --filter @valt/extension e2e:rehearse"`).
- **Change:**
  - `dod.spec.ts` runs the §9 DoD path end to end in one test: pair, submit, table, pin, file ticket, sweep, SPA nav, pause, helper restart with queue.
  - The README covers:
    - build and load unpacked
    - `pnpm alt:helper`, `pnpm demo:erp`, pasting the token
    - the stage script
    - fallback if the real helper fails (the mock is the default)
  - **MANUAL checklist**, each paired with its automated proxy:
    - (a) side panel opens on toast click, proxy T17 unit test
    - (b) idle CPU ≤ 1% in Chrome Task Manager over 60 s with the panel open, connected, no badges; proxy: T18 "no observers without badges" plus CDP `Performance.getMetrics` `TaskDuration` delta ≤ 0.6 s over 60 s on the demo tab, added to `dod.spec.ts`
    - (c) kill the SW from `chrome://serviceworker-internals`, proxy T27
    - (d) the post-demo demand signal: count installs by ≥ 3 outside developers within 2 weeks, tracked by the owner and not a launch gate
- **Done when:** `pnpm e2e:rehearse` passes 5/5 headless on Windows, the README exists with the manual checklist, and one MANUAL rehearsal in headed Chrome 116+ against `pnpm alt:helper` has been completed and recorded (date, Chrome version) in the README.
- **Depends on:** T26, T27

## Story → task traceability

| PRD item | Tasks | Verified by |
|---|---|---|
| S1 Pair once, auto-reconnect, "helper not running" + Copy | T3, T10, T16, T17, T20 | T16 unit, T20 unit, T24 E2E |
| S2 Live feed, stats line, 200 cap, reopen persists | T10, T17, T20, T21 | T17/T21 unit, T24 E2E |
| S3 Contract table on submit, picker, filtering of noise | T7, T11, T13, T14, T15, T21 | T15/T21 unit, T25 E2E |
| S4 Redaction in tab, truncation marker | T14, T15, T21 | T14 unit, T25 E2E (mock log) |
| S5 Pinned badge, card, positioning, fallback, Alt+G, host styles | T8, T18, T19 | T18/T19 unit, T26 E2E |
| S6 File/Expected/Ignore/Copy, 10 s timeout, status filter | T11, T17, T19, T22 | T17/T19/T22 unit, T26 E2E |
| S7 Role, Full sweep, per-route badges, toast→panel, toolbar badge | T11, T17, T18, T19, T20 | T17 unit, T26 E2E, T28 MANUAL (panel open) |
| S8 SPA nav follows, list→focus, filters | T13, T17, T18, T22 | T22 unit, T26 E2E |
| S9 Pause, reconnect, queue 50, version banner, malformed skip | T6, T16, T17, T20 | T16/T17 unit, T27 E2E |
| S10 Mock helper script | T3, T8, T10, T11 | T10/T11 unit, T24 E2E, T28 |
| S11 No breakage, strict CSP, ≤ 1 ms, fetch/XHR semantics, idle CPU | T9, T13, T15, T18 | T13 unit, T25 E2E, T28 MANUAL + proxy |
| S12 Theme, severity labels, keyboard | T12, T19, T20 | T19/T20 unit, T26 E2E |
| Metric: Submit→Contract ≤ 2.0 s p95 | T15, T17, T21 | T27 `latency.spec.ts` |
| Metric: Zero host-app breakage | T13, T18 | T25 `host-app.spec.ts` |
| Metric: Hook overhead ≤ 1 ms p95 | T13 | T13 unit, T25 E2E |
| Metric: Anchoring ≥ 9/10 | T8, T18 | T26 `anchoring.spec.ts` |
| Metric: Recovery ≤ 10 s, 100% of ≤ 50 queued | T16, T17 | T27 |
| Metric: Idle ≤ 1% CPU | T16, T18 | T28 MANUAL + CDP proxy |
| Metric: Demo readiness 5× | all | T28 `e2e:rehearse` |
| Metric: Post-demo demand (not a gate) | T28 README | owner-tracked |
| Frozen §2 contract conformance (no non-§2 WS types; exact names) | T2, T6, T10, T11, T16, T17 | T6 typecheck drift assertions + fixtures, T10/T11 outbound validation, T16/T17 send-type spies, T24 `received()` type check |
| Decisions 1–6 | T1, T2, T3, T6, T11, T12, T20, T22 | ADRs 0015/0016 |

## Order

```
T1 ─▶ T2 ─▶ T6 ─┬─▶ T8 ─┐
T3 ─▶ T4 ─┬─────┤       ├─▶ T11 ─┐
          │     └─▶ T10 ┘        │
          ├─▶ T7 ─┬─▶ T8         │
          │       └─▶ T9 ────────┤
          └─▶ T5 ─▶ T12 ─┬─▶ T13 ─┐
                         ├─▶ T14 ─┴─▶ T15 ─┐
                         └─▶ T16 ──────────┴─▶ T17 ─┬─▶ T18 ─▶ T19 ─┐
                                                    └─▶ T20 ─┬─▶ T21 │
                                                             └─▶ T22 ◀┘
T23 (needs T9, T11, T20) ─▶ T24, T25 (parallel) ─▶ T27 ; T26 (needs T19, T22, T23) ─▶ T28 (needs T26, T27)
```

**Critical path:** T3 → T4 → T5 → T12 → T13 → T15 → T17 → T18 → T19 → T22 → T26 → T28 (12 tasks).
T1 → T2 → T6 must finish before T12 but runs alongside T3–T5.

**Parallel sets** (no shared files, dependencies satisfied):
- Wave A: T1 ∥ T3
- Wave B: T2 ∥ T4
- Wave C: T5 ∥ T6 ∥ T7
- Wave D: T8 ∥ T9 ∥ T10 ∥ T12
- Wave E: T11 ∥ T13 ∥ T14 ∥ T16
- Wave F: T15
- Wave G: T17
- Wave H: T18 ∥ T20
- Wave I: T19 ∥ T21 ∥ T23
- Wave J: T22 ∥ T25
- Wave K: T24 ∥ T26
- Wave L: T27
- Wave M: T28

Mock helper and demo-erp (T7–T11) run fully in parallel with the extension track (T12–T22).

## Risks

- **Contract drift between the extension and the Phase 1 helper.** *Mitigation:* the §2 types
  live verbatim in `packages/protocol/src/index.ts`, and a type-level assertion in T6 fails
  `tsc` if the zod schemas diverge from them. Golden fixtures in
  `packages/protocol/fixtures/messages` are the shared test vectors the real helper must pass. The
  extension's send path is spied to prove it never emits a non-§2 `type` (T16/T17), and ADR 0016
  forbids renames without a new ADR.
- **§2 has no helper heartbeat.** An idle helper, a closed panel, and no open localhost tab can let
  the SW sleep and drop the socket. *Mitigation:* content-script `cs:keepalive` and the panel
  `p:heartbeat` runtime messages, a 30 s alarm that reconnects, and state in `storage.session`.
  The worst case is a ≤ 30 s delay for live bug pushes with no tab open, which isn't user-visible.
  Proposed addition 2 would remove it.
- **In-band truncation marker** (§2 has no `truncated` flag). A helper that parses `resBody` as
  JSON sees a string for cut bodies. *Mitigation:* the marker format is a protocol constant and in
  the golden fixture, and proposed addition 3 replaces it.
- **MAIN-world hook breaks a host app or leaks CSP violations.** *Mitigation:* the original
  promise is returned, all wrappers fail open, `addEventListener` is used instead of handler
  assignment, SSE is never cloned, zod never ships in the MAIN world, and T5 has a build-output
  check for `import(`. T25 runs parity plus CSP checks.
- **Zod 4 CSP probe.** `new Function` in extension pages logs violations. *Mitigation:* `jitless`
  is imported first in `@valt/protocol` and a T6 unit test spies on `Function`.
- **Toast → side panel open loses the user gesture.** *Mitigation:* `sidePanel.open` is called
  synchronously in `onMessage` (T17 unit-tested call order). If Chrome rejects it, the fallback is
  the toolbar badge and the copy "Click the ALT icon to open the panel". This is MANUAL-verified in
  T28 because Playwright can't observe the side panel.
- **Clipboard write after an async helper reply** loses transient activation (~5 s). *Mitigation:*
  the mock replies in < 100 ms, and the textarea + second-click fallback is in T19.
- **SW eviction during quiet periods.** *Mitigation:* inbound WS frames (Chrome 116+),
  `cs:keepalive`/`p:heartbeat` runtime traffic, API-call resets during reconnect, a 30 s alarm
  safety net, state in `storage.session`, and a T27 SW-kill test.
- **Queue flush overwhelms the real helper.** *Mitigation:* at most 10 in flight, removal only on
  `contract_result`, and dedupe by `submitId` on both sides.
- **`storage.session` 10 MB cap.** 50 captures × multiple 64 KB bodies could exceed it.
  *Mitigation:* an 8 MB queue byte budget that drops the oldest and shows "oldest dropped".
- **crxjs** is the main third-party build risk (3.0 released 2 days ago). *Mitigation:* pin ~2.7.1,
  with a T5 output check and a documented manual-build fallback.
- **Screenshots on pages with a restrictive `img-src`** are blocked by page CSP. *Mitigation:* a
  visible "Screenshot blocked by page policy" message. The PRD's strict-CSP requirement covers
  capture and badges, not screenshots.
- **Playwright can't drive the real side panel or Chrome Task Manager.** *Mitigation:* the panel is
  tested as a tab page (same code), and idle CPU uses a CDP proxy plus MANUAL.

## Rollback

All work is additive and lives in new directories: `packages/protocol`, `tools/mock-helper`,
`apps/demo-erp`, `apps/extension`. To roll back, revert the feature branch or merge commit. That
also restores `pnpm-workspace.yaml`, root `package.json`, `turbo.json`, and `.gitignore`, and
`pnpm install` returns the lockfile. ADRs 0015/0016 are not deleted. If the decision is reversed,
mark them "Deprecated" in a follow-up. Users remove the unpacked extension in `chrome://extensions`.
No `apps/api`, database, or deploy surface is involved, so there is no data or infra rollback.

## Out of scope (from PRD "Not in v1" and conductor decisions)

- Dev/staging origins and per-origin permission (T11 in PRD numbering).
- The real-helper swap and contract smoke test (PRD T13).
- Desktop notifications.
- Virtualized feed.
- iframes.
- CSP/fetch hardening beyond the strict-CSP page.
- Full WCAG audit.
- Layer and route filters.
- Firefox, Edge, Safari, and the Web Store.
- Undo beyond `reopen`.
- Console capture.
- Destructive-actions toggle (decision 3).
- **ADR for the Node helper calling Gemini:** owned by the Phase 1 helper owner.
- CI workflow for the new packages: there is no `ci.yml` today. A devops follow-up should run
  `pnpm lint typecheck test build` plus `pnpm e2e` (with `playwright install chromium`).
