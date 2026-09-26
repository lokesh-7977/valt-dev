# ALT: your autonomous QA teammate (Chrome extension)

Open your web app and turn ALT on. From then on it works in its own background tab while you keep
working:

- It discovers your pages, forms and actions.
- It works out what each field means and generates test data.
- It fills and submits your forms, including invalid and edge-case data.
- It records what the app did with each submission.

You never press "Run tests" or "Submit". This is Phase 1 (Autonomous Website Explorer) of
the ALT product. The architecture is recorded in
[ADR 0015](../../docs/adr/0015-alt-chrome-extension-as-product-surface.md), and the plan is in
[docs/plans/alt-phase-1-explorer-plan.md](../../docs/plans/alt-phase-1-explorer-plan.md).

```
Developer keeps working ─────────────────────────────────────────────────▶
            │ (navigations, DOM/HMR changes re-prioritise ALT)
            ▼
ALT tab:  discover ─▶ understand ─▶ generate ─▶ fill ─▶ submit ─▶ observe ─▶ record ─▶ next …
                          ▲
                          └── Gemini enriches each new form once (async, cached)
```

## Run it

Requires Chrome 116+ and Node ≥ 22.18.

```bash
pnpm install
pnpm ext:build            # → apps/extension/dist
pnpm demo                 # demo ERP "Acme Ledger" on http://localhost:4173 (optional)
pnpm api:dev              # optional: Gemini enrichment (needs GEMINI_API_KEY in .env)
```

1. In `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose
   `apps/extension/dist`.
2. Open your app, for example http://localhost:4173.
3. Click the ALT toolbar icon to open the side panel, then click **Start ALT on localhost:4173**.

ALT opens an **ALT** tab group and starts working. Click **Watch ALT** to see it fill and submit
forms. Keep using your own tab: when you open a page, ALT tests that page next, and when the DOM
changes (for example an HMR reload after you save code), ALT re-checks it.

Without the API, ALT runs on heuristics only, and the panel shows "Heuristics only". With the API,
each new form gets one `alt_form_plan` Gemini call. That call adds semantic field types,
realistic values and business-context cases such as "Due date before invoice date". The result
is cached per origin.

## 3-minute demo script

1. `pnpm demo`, `pnpm api:dev`, then load the extension and open http://localhost:4173.
2. Open the side panel and click **Start ALT**. Say: *"That's the last thing I click."*
3. Activity starts streaming:
   - "Discovered Dashboard"
   - "Found Create invoice form · 8 fields"
   - "Generated 36 test cases"
   - "Gemini understood 'Create invoice' · +3 business cases"
4. Click **Watch ALT**. The worker tab shows the pill *"ALT · Testing Create invoice · case 3/36"*
   while it fills quantity `-5` and submits.
5. Go back to your own tab and open `/customers`. ALT prioritises it, clicks **New customer**,
   and tests the modal form.
6. In **Tests**, open *"Quantity = -5 (negative)"*. It shows **Unexpected (unverified)**, the
   evidence `POST /api/invoices → 201`, and the success message. Also look at the double-submit
   finding.
7. In **Health**, show the broken image, console error, 500 on `/api/notifications`, horizontal
   overflow, missing label, cut-off button text and overlapping badge.
8. Point out what ALT never did: Pay, Refund, Delete account, Send invite and Sign out were skipped
   for safety.

## Safety

- **Destructive actions are off by default** (`allowDestructive: false`). Submits and clicks
  classified as delete, pay, refund, send, invite, logout, reset and similar are never executed.
  Classification uses the label, id, URL, method and context, and Gemini can raise the flag but
  never clear it.
- In the ALT tab, `confirm()` returns `false` (cancel), and `alert`/`prompt` never block.
- ALT only runs on origins you enabled. Content scripts are registered per origin; nothing
  is injected elsewhere.
- It stays on the same origin, visits each logical route once (`/invoices/12` becomes
  `/invoices/:id`), and is bounded by depth, page, case and action limits
  (see **Scope & safety** in the panel).
- It submits real data. Use it on dev or staging, never on production.

## What it produces (the Phase 1 contract)

All types live in [`packages/shared/src/alt.ts`](../../packages/shared/src/alt.ts):
`DiscoveredPage`, `DiscoveredForm`, `DiscoveredField`, `DiscoveredAction`, `TestCase`,
`TestExecution` (steps, evidence, outcome, result), `NetworkEvent`, `ConsoleEvent`,
`NavigationEvent`, `PageHealthObservation`, `SessionSnapshot`, `SessionExport` and the `AltEvent`
stream:

| Event | Payload | Emitted when |
| --- | --- | --- |
| `session.started` / `session.status` / `session.stopped` | origin, settings / status / reason | lifecycle |
| `page.discovered` | `DiscoveredPage` | first visit of a logical route |
| `navigation` | `NavigationEvent` (`source: worker \| developer`) | any page load or SPA route change |
| `form.discovered` / `form.enriched` | `DiscoveredForm` (+ `AltFormPlan`) | new form signature / Gemini plan merged |
| `action.discovered` | `DiscoveredAction` (+ `effect` after a safe click) | buttons, modal openers, nav actions |
| `cases.planned` | `TestCase[]` | heuristic plan, then again after enrichment |
| `test.started` | case, index, total | before each case |
| **`test.executed`** | **`TestExecution`** | **after each case. This is Phase 2's primary input.** |
| `health.observed` | `PageHealthObservation` | first sighting of each health issue |
| `activity` | `ActivityEntry` | human-readable progress |

`TestResult.status === "unexpected"` means ALT observed a mismatch with the case's expectation,
for example invalid data that was accepted. It is **not a verified bug**.

## Integrating Phases 2 and 3

**Phase 2 (UI ↔ API intelligence)** has three ways to consume Phase 1:

- **In the service worker:** the bus is exposed as `globalThis.__alt.bus`, and inside the extension
  as the `bus` in `background/index.ts`.
  ```ts
  __alt.bus.on("test.executed", ({ payload: { execution } }) => analyse(execution));
  ```
  Each execution carries the values entered, the fill report (requested vs applied), the
  validation and page messages, the mutating requests in the case window, console errors and URLs.
- **From any extension page:** connect with `chrome.runtime.connect({ name: "alt:events" })`.
  The port receives `{kind: "replay", events}` and then `{kind: "event", event}` for each event.
- **Offline:** use **Export session** in the side panel. It writes a `SessionExport` JSON
  (`contractVersion: 1`) with the snapshot and the last 2,000 events.

`NetworkEvent.requestBody` and `responseBody` are reserved for Phase 2. Phase 1 records
metadata only (method, URL, status, timing) through `chrome.webRequest`.

**Phase 3 (verification and developer experience)** can do the following:

- Re-run any case: `TestCase` holds the complete values, and `DiscoveredForm.reach` holds the steps
  that reveal the form.
- Anchor popups to elements using `DiscoveredField.selector` and `DiscoveredForm.selector`.
- Extend the side panel in `src/sidepanel/`. It renders purely from `SessionSnapshot` over the
  `alt:panel` port.

## Code map

```
src/shared/       pure logic, unit-tested with node --test
  routes.ts         route keys (/invoices/:id), crawlability
  safety.ts         destructive classifier
  semantics.ts      field understanding (heuristics)
  datagen.ts        happy values + case planning (negative, boundary, special, interaction)
  outcome.ts        evidence → outcome → verdict
  merge-plan.ts     Gemini descriptor + safe merge
  messages.ts       SW ⇄ content ⇄ panel message contract
src/content/      in-page: discovery, filling, observation, health, overlay (+ MAIN-world hooks)
src/background/   service worker: session loop, queue, executor, worker tab, network, Gemini, store, bus
src/sidepanel/    the ALT panel
e2e/              Playwright end-to-end run against apps/demo-erp
```

## Tests

```bash
pnpm --filter @valt/extension test        # unit tests (node --test, native TS)
pnpm --filter @valt/extension typecheck
pnpm --filter @valt/extension e2e         # builds, launches Chromium with ALT, runs against the demo
```

The E2E test uses Playwright's Chromium, because branded Chrome no longer honours
`--load-extension`. Install it once with
`pnpm --filter @valt/extension exec playwright install chromium`. Each run writes its evidence to
`e2e/last-run.json`.
