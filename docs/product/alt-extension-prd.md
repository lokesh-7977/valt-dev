# ALT Chrome Extension (Phase 2 client) — PRD

**Status:** draft · **Owner:** Lokesh Medharametla · **Date:** 2026-09-26 · **Slug:** `alt-extension`

> **Naming.** The product is **ALT**. The source spec and the phase docs in `docs/plans/` call it
> "GhostCrew". That name is retired. The manifest name is "ALT", the in-page host element is
> `<alt-root>`, the page-hook message source is `alt-hook`, the helper prints `ALT token: 4F7K-92QD`,
> demo tickets look like `ALT-12`, and the toast reads "ALT: 3 new issues on /invoices/new".

## Problem

A developer building a form-heavy web app on localhost can't easily see when the UI, the request it
sends, and the API's response disagree. Examples: the form shows a 10% discount but the payload
drops it, the server returns 500 but the UI says "Saved", or a field is sent as a string. Today the
developer finds these bugs by opening DevTools, reading the Network tab payload by payload, and
comparing it against the screen by eye. That only happens when they already suspect a problem, so
many mismatches reach QA or production. When the developer does find one, they still have to copy
the payloads, write repro steps, and file a ticket by hand.

ALT's local helper (built separately) detects these mismatches. What's missing is a way to feed it
the developer's **own** real interactions and to show the results **where the developer is already
looking**: on the page, next to the broken field.

## Users

- **Primary:** a full-stack or frontend developer running their own web app on `localhost` /
  `127.0.0.1` in Chrome, with the ALT helper running on the same machine. They submit forms while
  building and want to catch contract bugs as they go, with no setup beyond pasting a pairing token
  once.
- **Launch-moment user:** the presenter at a hackathon-style demo against **demo-erp** (an invoice
  form with planted UI↔API mismatches), and the audience watching the screen.
- **Explicitly NOT for:** QA teams testing shared dev, staging, or production URLs (deferred, see
  Not in v1); non-developers filing bug reports (Jam's audience); production monitoring or session
  replay of real end users (Sentry's and LogRocket's audience); Firefox, Safari, or Edge users.

## Goal

A developer who submits a form on localhost sees, within about 2 seconds and without opening
DevTools, a UI | Request | Response table and a badge pinned on the broken field. They can then
file, dismiss, or get a fix prompt for the bug in one click.

## What the extension is (and is not)

- It is a **thin client**. It (a) captures the developer's own form submits and the API traffic
  they trigger in localhost tabs and sends them, redacted, to the helper for contract checking,
  (b) renders what the helper streams back: live agent activity, bugs pinned in the page, contract
  tables, and run stats, and (c) sends the developer's actions back: Ignore, Mark expected, File
  ticket, Copy fix prompt, Full sweep, Live/Paused, and Role switch.
- It talks to the helper **only** through the frozen protocol-v1 WebSocket contract (user spec §2:
  `ws://127.0.0.1:7777/ws`, token-paired `hello`/`welcome`, typed JSON messages validated on both
  sides, screenshots over local HTTP and never inline). The user's §2 contract is a fixed
  requirement. This PRD adds no new messages. Open questions 2 and 3 propose changes for the user
  to decide on *before* the freeze.
- A **mock helper** replays a scripted demo. The extension can then be built and shipped without
  the real helper, and the mock is also the demo-day fallback.

## AI contract

**N/A. The extension makes no model calls and contains no test logic.** Every AI step (Gemini field
mapping, contract reasoning, fix-prompt generation, verification) runs in the helper, which is out
of scope here. The extension treats all helper output, including AI-written text, as untrusted data
to render (see Trust & privacy).

## Evidence

All accessed 2026-09-26.

**Platform constraints (primary sources)**
- MV3 extension service workers stop after 30s of inactivity. Extension API calls reset the timer
  (Chrome 110+). Sending or receiving WebSocket messages resets it (Chrome 116+). Sending messages
  over long-lived ports keeps the worker alive (Chrome 114+). → Chrome 116+ is the minimum, and the
  keep-alive design in spec §5.6 is needed. —
  https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- The Side Panel API needs Chrome 114+. An extension can open the panel from a user gesture,
  including "a user interaction on an extension page or content script, such as clicking a
  button". → Clicking the in-page toast is allowed to open the panel. —
  https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- MAIN-world scripts share the page's execution environment, and the page's JavaScript can
  interfere with them. → The fetch/XHR hook must be defensive and must never change how the page
  behaves. — https://developer.chrome.com/docs/extensions/reference/api/scripting
- Using `chrome.debugger` makes Chrome show a "started debugging this browser" infobar. Only a
  command-line switch or enterprise force-install suppresses it. → This is why spec §5.1 rules out
  CDP capture. — https://developer.chrome.com/docs/extensions/reference/api/debugger ·
  https://issues.chromium.org/issues/40141220
- Chrome recommends optional permissions requested at runtime to improve onboarding compared with
  install-time warnings. → This supports localhost-only install permissions and per-origin opt-in
  later. — https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings

**Comparable tools**
- **Jam** is a Chrome extension that captures console logs, network requests, user actions, and
  device info into a shareable bug report, and sends it to Linear, Jira, GitHub, and other
  trackers. It has a free tier and paid tiers. Third-party reviews report $15/mo Pro; pricing is
  not verified on Jam's own page. It is built for *reporting* a bug a human already saw. It does
  not detect bugs. — https://chromewebstore.google.com/detail/jam/iohjgamcilhbgmhbnllfolmkmmekfmci ·
  https://jam.dev/blog/why-sharing-network-logs-is-important-when-you-reporting-a-bug/ ·
  https://makerstack.co/reviews/jam-dev-review/
- **Sentry Session Replay** captures only URL, method, status, and body *sizes* for fetch/XHR by
  default. Headers and bodies need a per-URL opt-in (`networkDetailAllowUrls`). Bodies are cut at
  150,000 characters and PII-sanitized server-side by key and value. → This is prior art for
  "metadata by default, bodies by opt-in, key-based redaction". —
  https://docs.sentry.io/platforms/javascript/session-replay/configuration/
- **LogRocket** has a `requestSanitizer`/`responseSanitizer` that redacts headers and bodies at
  capture time without affecting the real request. An official plugin masks body fields by field
  name. → This is prior art for ALT's field-name-regex redaction in the tab. —
  https://docs.logrocket.com/reference/network ·
  https://github.com/LogRocket/logrocket-fuzzy-search-sanitizer
- **Replay.io** records the browser runtime deterministically for time-travel debugging, including
  a network monitor. It fetches request/response bodies during replay, not during recording. It is
  after-the-fact debugging, not live detection. — https://docs.replay.io/basics/time-travel/how-does-time-travel-work ·
  https://docs.replay.io/basics/getting-started/record-your-app
- **Pact** (contract testing) is "a code-first tool" and contracts come from automated consumer
  tests the developer writes. → The existing way to catch UI↔API drift costs test-writing effort.
  ALT's pitch is zero-setup detection from real interactions. — https://docs.pact.io/
- **Takeaway:** none of the tools reviewed compares the value *displayed in the UI* with the request
  and response. They capture traffic for a human to read. ALT's differentiator is the three-way
  table plus an in-page pin. This is based on the feature pages above, not a full market scan.

**Demand**
- Postman's State of the API reports name recurring API problems that include lack of visibility
  and insufficient testing. This is secondhand and gives no figure for UI↔API mismatches
  specifically. — https://nordicapis.com/a-deep-dive-into-the-state-of-the-api-2025/ ·
  https://www.postman.com/state-of-api/2025/
- **Honest gap:** I found no quantitative source for how often UI↔API contract mismatches reach QA
  or production, or how long developers spend finding them. The problem is **plausible, not
  verified**. v1 is a demo, so the demo itself is the first demand test (see Success metrics).

**Naming**
- The npm package `alt` exists: a Flux library, v0.18.6, about 9,444 downloads/week
  (2026-09-18 to 09-24), with **no CLI bin**. `npx alt` would install an unrelated library and fail
  to run anything. `alt-helper` and `@valt/alt-helper` were unregistered at the time of checking.
  Ownership of the `@valt` npm scope is unverified. — https://registry.npmjs.org/alt/latest ·
  https://api.npmjs.org/downloads/point/last-week/alt

## Approach chosen

- **Shape:** no AI in this component. It is a thin MV3 client that captures via a page-world
  fetch/XHR hook, renders in-page pins in a shadow DOM plus a side panel, and talks to the helper
  over the §2 contract. The user fixed this shape. The alternatives below record why it's right.
- **Alternatives rejected:**
  - *DevTools-panel extension* (reads the Network panel through the DevTools API): full traffic
    fidelity with no page hook, but only while DevTools is open. It can't pin bugs on the page by
    itself, and it brings back the "open DevTools" step ALT exists to remove.
  - *CDP capture via `chrome.debugger`*: the best capture fidelity, no MAIN-world risk, and it sees
    iframes. Lost because the "started debugging this browser" infobar appears on every tab, which
    hurts trust and looks broken in a demo.
  - *No extension (helper-only, headed Playwright browser with injected overlays)*: the simplest to
    build, but it never sees the developer's *own* submits in their real browser session. It only
    covers the autonomous sweep, so the core "I just submitted, show me" moment disappears.

## Success metrics

The v1 baseline is "no tool". The developer inspects DevTools by hand. Targets are measured on the
demo-erp + mock-helper end-to-end suite unless noted.

- **Submit → Contract table:** ≤ 2.0s p95 from the last correlated response to the table render,
  measured over 20 scripted submits with the mock helper. With the real helper, the extension's own
  share is ≤ 1.0s (the 800ms UI-settle scrape plus ≤ 200ms transport and render). Anything above
  that belongs to the helper's budget.
- **Zero host-app breakage:** demo-erp's own end-to-end checks give identical pass/fail results with
  and without the extension loaded, and the extension causes 0 uncaught page-console errors across
  the suite.
- **Hook overhead:** ≤ 1ms p95 added per fetch/XHR, measured by the hook's own timing over ≥ 200
  requests.
- **Anchoring accuracy:** ≥ 9 of the 10 planted demo-erp bugs pin to the intended element. The rest
  fall back to a corner toast plus a panel entry, and none are silently dropped.
- **Recovery:** after the helper is killed and restarted, the panel reconnects within 10s of the
  helper accepting connections, and 100% of submits queued while it was down (up to 50) produce
  contract results. No submit is lost or duplicated.
- **Idle cost:** ≤ 1% CPU for the extension (Chrome Task Manager, 60s average) with the panel open,
  the helper connected, and no bugs visible.
- **Demo readiness:** 5 back-to-back rehearsals of the full §9 DoD script complete with no manual
  intervention other than the scripted helper restart.
- **Post-demo demand signal (not a launch gate):** number of developers who install it unpacked and
  use it on their own localhost app within 2 weeks of the demo. Target: ≥ 3 people outside the team
  for the idea to warrant continuing past v1.

## v1 scope

Minimum browser: **Chrome 116+**, loaded unpacked. Every item in the user's §9 Definition of Done is
covered: DoD1 → stories 1–2, DoD2 → 3–5, DoD3 → 6, DoD4 → 7–8, DoD5 → 9.

| # | Story | Acceptance criteria |
|---|-------|---------------------|
| 1 | As a developer, I can pair the extension with my running helper once, so it connects automatically after that. | - Settings has a token field. After I paste the token the helper printed (e.g. `4F7K-92QD`) and save, the header's connection dot turns green and shows the project name from the helper within 2s.<br>- A wrong token shows "Pairing failed. Check the token printed by the helper." and the dot stays red.<br>- After a Chrome restart, the panel reconnects with no re-entry. The token is still in Settings, masked.<br>- With no helper running, the panel shows "Helper not running. Start it with: `<command>`" and a Copy button that puts the command on the clipboard. |
| 2 | As a developer, I can watch what ALT's agents are doing live, so I trust it's working. | - Each activity message appears in the Feed within 1s of arrival, with an agent chip and, when present, a progress label like "14/32".<br>- The header shows the latest run stats as one large line in the format "42 checks · 7 agents · 4.8s" and updates when new stats arrive.<br>- Closing and reopening the side panel in the same browser session shows the last 200 activity entries and all current bugs.<br>- The Feed never holds more than 200 entries. The oldest are dropped first. |
| 3 | As a developer, when I submit a form on my localhost app, I see a UI \| Request \| Response table for that submit, so I can spot mismatches without DevTools. | - On demo-erp, submitting the invoice form (native submit or the SPA Save button) produces a new Contract entry named after the route and time.<br>- The panel switches to the Contract view (unless I'm in Settings) and shows Field \| UI \| Request \| Response rows within 2.0s p95 of the last response.<br>- Mismatched rows are red with ❌. Hovering ❌ shows the check code (e.g. "C2 Value changed in transit"). Matching rows show ✅.<br>- I can choose any earlier submit from this browser session from a picker and see its table.<br>- Page loads, static assets, hot-reload traffic, and the helper's own traffic never create Contract entries. |
| 4 | As a developer, I know my secrets never leave the tab, so I can use ALT on an app that has a login. | - In the mock helper's received-message log, `Authorization`, `Cookie`, and `X-API-Key` header values read `[redacted]` for every captured request.<br>- Body fields whose key contains password, pass, token, secret, otp, cvv, or card (any case) read `[redacted]` in the log. Other fields are unchanged.<br>- The same fields show `[redacted]` in the Contract table and bug cards.<br>- Bodies over 64KB arrive truncated, with a visible "truncated" marker. |
| 5 | As a developer, I see a bug pinned on the exact field that's broken, so I know where to look. | - Within 2s of the helper reporting a bug for the current route, a 20px badge colored and labeled by severity appears next to the anchored element. It pulses once when new; with reduced motion it fades only.<br>- Several bugs on one element show one badge with a count.<br>- Clicking the badge opens a card with the title, severity/layer chips, check code, expected vs actual, steps, collapsible request/response JSON with the relevant keys highlighted, a screenshot if provided, and likely cause "file:line" if provided. Esc closes it.<br>- After I scroll, resize, or the page changes layout, each badge is back beside its element (within 4px) by the next animation frame after the change settles.<br>- If the element can't be found, ALT uses the fallback text. If that fails too, the bug appears in a bottom-right toast and in the Bugs list, and is never silently dropped.<br>- Alt+G hides or shows all ALT overlays on the page.<br>- The host page's own styles and layout are unchanged, and the card is readable on white and on dark backgrounds. |
| 6 | As a developer, I can act on a bug in one click: file it, mark it expected, ignore it, or copy a fix prompt. | - **File ticket:** the button shows a spinner, then becomes a link such as "ALT-12 ↗" that opens the ticket URL in a new tab. The link also appears in the Bugs list.<br>- **Mark expected:** the badge and the Open list entry disappear within 1s. The bug does not come back after a page reload or a later Full sweep in the same helper session.<br>- **Ignore:** the badge and the Open list entry disappear within 1s.<br>- **Copy fix prompt:** the clipboard contains the helper's fix-prompt text for that bug, and the button shows "Copied" for 2s.<br>- If the helper doesn't confirm an action within 10s, the button goes back to idle and shows "Helper didn't respond. Try again."<br>- Ignored and expected bugs stay visible in the Bugs list under a status filter. |
| 7 | As a developer, I can switch the test role and start a Full sweep, so ALT tests the whole app as that user. | - The role selector lists exactly the roles the helper announced. Picking one updates the header right away.<br>- Clicking Full sweep shows new Feed activity within 1s.<br>- With the mock helper, 6 bugs arrive over about 5s. Each bug appears as a badge only in tabs whose current route matches it, and as an entry in the Bugs list.<br>- A bottom-right toast such as "ALT: 3 new issues on /invoices/new" appears on the page. Clicking it opens the side panel.<br>- The toolbar icon badge shows the number of open critical and high bugs for the active tab's route. It updates when I switch tabs or routes. |
| 8 | As a developer, when I navigate within my single-page app, the right bugs follow me. | - After a client-side navigation (link click, back, forward) to a route with open bugs, its badges appear within 500ms, and badges for the previous route are gone.<br>- Clicking a bug in the Bugs list focuses its tab, scrolls the anchored element into view, and opens its card. If the tab is on another route, the list says "Navigate to /invoices/new to see this pin".<br>- The Bugs list filters by severity and by status (open / ignored / expected / fixed). |
| 9 | As a developer, I can pause ALT, and if the helper restarts mid-session, nothing is lost. | - While **Paused** (header toggle), my submits send nothing to the helper (confirmed in the mock helper's log), and the header clearly reads "Paused".<br>- When the helper stops, the dot turns amber and reads "Reconnecting…" within 2s. The panel doesn't crash or show repeated error dialogs.<br>- Submits made while disconnected show as "N queued" in the header, up to 50. Past 50 the oldest are dropped and the header says "oldest dropped".<br>- When the helper is back, the connection is restored within 10s with no user action. Every queued submit yields exactly one Contract entry, and bugs and activity from before the restart are still shown.<br>- If the helper speaks a different protocol version, a persistent "Update helper: this extension needs protocol v1" banner appears. Malformed or unknown messages are skipped, and nothing crashes. |
| 10 | As a demo presenter, I can run a scripted mock helper, so the demo works even if the real helper isn't ready or breaks on stage. | - Started with one command, the mock accepts any pairing token, sends activity every 500ms and run stats every 10s, and answers Full sweep with 6 of the 10 planted demo-erp bugs over 5s.<br>- A real invoice submit on demo-erp gets a Contract table with its mismatches and one UI↔API bug pinned on the first mismatched field.<br>- File ticket on the mock returns an `ALT-12`-style link, and the other actions return a status update.<br>- The full §9 DoD script passes end to end against the mock. |
| 11 | As a developer, ALT never breaks or slows my app, so I can leave it on. | - demo-erp's own checks pass the same with and without the extension, with 0 page-console errors caused by ALT.<br>- On a test page with a strict Content-Security-Policy (no inline scripts), capture and badges still work and the page logs no CSP violations caused by ALT.<br>- Added time per fetch/XHR is ≤ 1ms p95.<br>- Pages keep their original fetch/XHR behavior (responses, streaming, abort, errors) with the extension on.<br>- The extension uses ≤ 1% CPU when idle with no bugs visible. |
| 12 | As a developer, the panel is easy to read in my theme. | - The panel follows the system light/dark setting. The same severity colors are used in the panel, badges, and cards, always with a text or icon label.<br>- All panel controls and card buttons can be reached and used by keyboard (Tab/Enter/Esc), with visible focus. |

**Scope guardrails (v1):**
- **Localhost only.** The extension can read and capture only `localhost` and `127.0.0.1` (any
  port). It asks for no other site access at install or at runtime. Full sweep always targets
  localhost.
- **Top-level page only.** Forms and requests inside iframes are not captured, and bugs anchored
  inside iframes use the toast/panel fallback.

## Trust & privacy

- **Why redaction matters even though the helper is local:** the helper may send captured payloads
  on to a cloud model (Gemini) for reasoning. So "local" doesn't mean the data stays on the machine.
  Redaction happens **in the tab, before anything reaches the extension's background process or
  the helper** (story 4).
- **Least access:** localhost-only site access at install. No broad host access, no debugger
  permission, and no infobar. The trust promise in the Settings copy: "ALT only reads pages on
  localhost and 127.0.0.1. Nothing else is visible to it."
- **Per-origin opt-in** is how non-localhost origins will work later: a runtime prompt per origin,
  modeled on Sentry's allow-list. It is Not in v1 because v1 has no non-localhost origins.
- **Kill switch:** Paused stops all capture right away (story 9). Alt+G hides all overlays.
- **What is stored, and for how long:** the pairing token and settings are kept on this device
  until changed. Bugs and the last 200 activity entries are kept only for the browser session and
  cleared when Chrome closes. Captured payloads are not kept by the extension after they're sent,
  apart from the up-to-50 offline queue, which is also session-only.
- **Untrusted helper content:** all helper text (titles, steps, AI fix prompts, JSON) is shown as
  plain text and never run as markup or script. Links open only if they are http(s). Screenshots
  load only from the local helper address. This limits prompt-injected content from the host app
  (which flows through the helper's model) to text on screen.
- **Human in the loop:** File ticket (which publishes to Linear) happens only on an explicit click,
  once per click. The extension never files anything automatically.

## Failure behaviour

| Situation | What the user sees | What they can do |
|---|---|---|
| Helper not running at panel open | Red dot, "Helper not running. Start it with: `<command>`" | Copy the command, run it, and the panel connects automatically |
| Helper dies mid-session | Amber "Reconnecting…", "N queued" counter | Nothing. It recovers on its own. They can Pause if they don't want queued submits sent |
| Wrong or expired token | "Pairing failed. Check the token printed by the helper." | Paste the new token in Settings |
| Protocol version mismatch | Persistent "Update helper: this extension needs protocol v1" banner | Update the helper or extension |
| Malformed or unknown helper message | Nothing in the UI. It is counted and logged for debugging | Nothing needed |
| Bug anchor not found | Bottom-right toast plus a Bugs list entry | Click the toast to open the panel |
| Helper doesn't confirm an action in 10s | Button resets, "Helper didn't respond. Try again." | Retry |
| Host page overrides fetch/XHR or has strict CSP | Capture degrades (fewer Contract entries). The page is never broken | Report it. Hardening beyond the strict-CSP test page is deferred |

## Relationship to existing phase docs

`docs/plans/PHASE_1_AUTONOMOUS_WEBSITE_EXPLORER.md`, `PHASE_2_UI_API_INTELLIGENCE_ENGINE.md`, and
`PHASE_3_VERIFICATION_DEVELOPER_EXPERIENCE.md` describe the same product under the name "GhostCrew".
They split it by **capability** across three developers. The user's spec splits it by **process
boundary**: helper (their "Phase 1") vs extension (this PRD, their "Phase 2"). Those files are not
edited. Where they conflict with this PRD, **the user's §2 contract and scope win**.

**This PRD covers, from those docs:**
- Their Phase 2 §3 (Network/API evidence) and part of §2 (UI evidence: toasts, field errors, and
  the resulting URL), but **only for the developer's own submits**. Traffic from autonomous runs is
  captured by the helper.
- Their Phase 3 §5–7 (in-page popup and bug actions), §8 (evidence, shown inside the card), §9–11
  (side panel, live activity, open bugs, contract view), §12 (Live/Paused, Full sweep, Role
  selector), and §19 (the large run-stats line).
- Their Phase 1 §13 (making autonomous activity visible). The extension renders it; the helper
  produces it.
- Everything else in those docs (discovery, fuzzing, C1–C12 evaluation, replay, business rules,
  Gemini, verification, Linear, dedup, auto-close) belongs to the helper and is out of scope.

**Conflicts, resolved in favor of the user's spec:**
1. Their Phase 1 says the product "enter[s] a web application through the Chrome extension" and
   fills and submits forms there. **Here the extension never drives the page.** Autonomous
   interaction is the helper's job, in its own browser.
2. Their Phase 3 §12 has an "Allow destructive actions" toggle. It is **not in protocol v1**, so it
   is not in this PRD (open question 3).
3. Their Phase 3 §7 has a separate "View Evidence" action and §6 lists "reproduction status". Here
   evidence is inline in the card, and there is no reproduction-status field in the v1 Bug shape.
4. Their Phase 3 §3 distinguishes Bug / Expected / **Flaky**. The v1 bug statuses are open,
   ignored, expected, and fixed. There is no "flaky" status.
5. Their Phase 3 §8 shows console information. The extension captures no console output in v1.
6. "Copy fix prompt" is new. It is not in the phase docs.

**Conflicts with the VALT repo, for engineering to handle through ADRs:** protocol-v1 streams over a
bidirectional WebSocket, while ADR 0007 standardizes SSE for browser streaming. The Node helper
calling Gemini sits outside ADR 0003/0014, which make FastAPI plus AIService the AI runtime. Adding
an extension app and a shared protocol package fits ADR 0002 (monorepo). The severity palette
needs four status colors, while `design-system/valt/MASTER.md` defines three status colors and one
accent (open question 5).

## Not in v1

- **Dev/staging URL support (T11)**: runtime per-origin permission, capture on https origins, and
  the "dev" option for Full sweep. *Why deferred:* the demo and the core value are on localhost.
  This adds a permission flow and a new trust surface. *Pull forward when* a real user asks to use
  ALT on a shared dev environment.
- **Swap to the real helper plus contract smoke test (T13)**: a separate follow-up, gated on the
  teammate's helper passing the shared protocol-v1 validation. *Why:* v1's done-ness can't depend on
  another team's timeline, and DoD allows "mock or real". *Pull forward when* the real helper can
  answer `hello`. Both sides still share one contract definition from day one, so the swap should
  be configuration only.
- **Chrome desktop notifications for critical bugs**, and the notification toggle in Settings.
  *Why:* the developer is looking at the page already, and the in-page toast and toolbar badge
  cover it. OS notifications can also be blocked by Focus/Do-Not-Disturb during a demo. *Pull
  forward when* sweeps run in the background (for example on file save) while the developer is
  elsewhere.
- **Virtualized feed.** *Why:* the feed is capped at 200 entries, which renders fine without it.
  *Pull forward when* the cap is raised or measured scroll performance fails.
- **iframe support** (capture and anchoring inside frames; part of T12). *Why:* demo-erp has no
  iframes, and frame support multiplies hook and anchoring edge cases. *Pull forward when* a target
  app puts forms in iframes.
- **Hardening past the strict-CSP test page** (apps that wrap or replace fetch themselves, service
  worker-served APIs, WebSocket/GraphQL-subscription capture) and a full WCAG accessibility audit.
  v1 keeps keyboard operability and the strict-CSP check.
- **Bugs filters by layer and by route.** v1 keeps severity and status. *Why:* with about 10 bugs,
  two filters are enough. *Pull forward* at more than about 30 bugs per project.
- **Firefox, Edge, and Safari; Chrome Web Store listing.** v1 is Chrome 116+, loaded unpacked.
- **Undo for Mark expected / Ignore.** It is not possible in protocol v1 (open question 2).
- **Capturing console errors or non-form actions** (clicks that trigger API calls without a
  form-like submit), beyond the SPA Save-button heuristic.

## Assumptions

- **Ignore vs Mark expected:** assumed that *Ignore* hides the bug for the current helper session,
  while *Mark expected* is remembered by fingerprint across runs, as their Phase 3 §3 describes. The
  helper owns this. If Ignore is also permanent, the two buttons become redundant and one should be
  cut.
- **The helper can take 50 queued submits at once after reconnect** without timeouts. If not, the
  flush must be paced, which is invisible to the user but affects the DoD5 timing.
- **The ≈2s target applies to the mock helper.** A real helper that calls a model for field mapping
  may be slower. The extension's share is ≤ 1.0s, and the helper owns the rest.
- **demo-erp's anchors are stable** (test ids or names on fields). If planted bugs sit on elements
  with generated ids and no labels, anchoring accuracy drops below the 9/10 target.
- **Presenter's machine:** Chrome 116+ with no enterprise policy blocking unpacked extensions or
  local WebSocket connections.
- **Screenshots:** the helper serves them from its local address, and they load in the card without
  extra permission because they come from 127.0.0.1.

## Open questions

1. **Helper start command.** `npx alt` resolves to the unrelated npm `alt` Flux library (about 9.4k
   downloads/week, no CLI), so it would fail. Proposal: `npx @valt/alt-helper`. That name is free,
   but we must own the `@valt` npm scope, which is unverified. For the demo, use an in-repo command
   such as `pnpm alt:helper` so nothing needs publishing. *Blocks:* the copy in the story 1
   "Start helper" message. *Needed by:* the panel header/settings work (T5).
2. **Add a `reopen` bug action to protocol v1 before the freeze?** Without it, a mistaken "Mark
   expected" is permanent from the extension's side. *Blocks:* undo in story 6. *Needed by:* the
   protocol freeze (T1).
3. **Destructive-actions toggle** (their Phase 3 §12): helper-side config, a protocol-v1 message, or
   dropped? *Blocks:* whether the panel shows it. *Needed by:* the protocol freeze (T1).
4. **Four-level severity palette vs the design system's three status colors plus one accent.**
   Proposal: critical = destructive red, high = warning orange, medium = a yellow, and low = neutral
   gray, each with a letter label. *Needed by:* overlay work (T8).
5. **ADR ownership:** who writes the ADR(s) for the WebSocket helper protocol (ADR 0007) and the
   Node helper's Gemini use (ADR 0003/0014)? *Needed by:* before `/tech-plan` completes.

## Risks

- **Real-helper integration slips or diverges from protocol v1.** Impact: the demo shows only
  scripted data. Mitigation: a shared contract definition validated on both sides, the mock as the
  official fallback, and T13 as a short, separate follow-up.
- **The MAIN-world hook breaks or slows a host app** (the page can interfere with MAIN-world
  scripts, per Chrome docs). Impact: developers uninstall, and trust is lost on stage. Mitigation:
  keep original fetch/XHR behavior, fail open (capture off, page untouched), and run the story 11
  checks in the end-to-end suite.
- **The SPA submit heuristic misses or misattributes requests** on apps unlike demo-erp. Impact:
  empty or wrong contract tables. Mitigation: accepted for v1, because it's tuned to demo-erp.
  Measure the miss rate on the first two real apps before widening scope.
- **MV3 service-worker shutdown drops the connection** during quiet periods. Impact: a missed
  bug or stale panel. Mitigation: Chrome 116+ WebSocket keep-alive plus the §5.6 keep-alive, and
  story 9's reconnect-and-queue behavior.
- **Weak demand evidence.** Impact: v1 impresses at the demo, but nobody uses it on real apps.
  Mitigation: the post-demo metric (≥ 3 outside developers on their own apps within 2 weeks) as the
  go/no-go signal for work past v1.
- **Alt+G conflicts** with host-app shortcuts, and on macOS Option+G types "©". Impact: minor.
  Mitigation: accepted for v1. Make it configurable if it's reported.
