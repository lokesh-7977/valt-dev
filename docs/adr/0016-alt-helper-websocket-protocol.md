# 0016. Talk to the ALT helper over a localhost WebSocket (protocol v1)

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** VALT team

## Context

ALT is split in two (PRD `docs/product/alt-extension-prd.md`):

- **Phase 1, the helper:** a local Node service (crawler, form fuzzer, contract checker, Gemini,
  Linear), built in parallel by another owner.
- **Phase 2, the Chrome extension:** a thin client that captures the developer's own submits and
  renders what the helper finds.

The two sides must be built independently and meet only at a frozen contract. The channel is
bidirectional: the extension sends captures and user actions up (`captured_submit`,
`bug_action`, `set_mode`, `set_role`, `run_sweep`) while the helper streams activity, bugs,
contract tables and stats down. Both ends run on the developer's machine.

ADR 0007 chose SSE for browser ↔ FastAPI AI runs through the Next.js rewrite. This channel is not
browser ↔ FastAPI, does not pass through the rewrite, and is not one-directional.

## Decision

We will use a **WebSocket on `ws://127.0.0.1:7777/ws`** with the user's frozen §2 contract,
quoted verbatim below. The types live in `packages/protocol/src/index.ts` (`@valt/protocol`),
with zod schemas used on both sides and golden JSON fixtures in
`packages/protocol/fixtures/messages/` that the real helper must pass.

- **Transport:** `ws://127.0.0.1:7777/ws`. The helper binds to `127.0.0.1` only.
- **Envelope:** `{ "type": string, "id": string, "ts": number, "payload": {...} }`.
- **Handshake:** the first message must be `hello`. It carries the pairing token the helper prints
  on start (`ALT token: 4F7K-92QD`); the user pastes it once in the extension's Settings.
- **Validation:** every message is validated with zod on both sides. An unknown `type` is ignored
  and logged, never a crash.
- **Screenshots:** served over HTTP at `http://127.0.0.1:7777/assets/...`, never base64 over the
  WebSocket.

### §2 contract (verbatim)

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

### Approved additions (the only ones)

- `v: 1` in the `hello` and `welcome` payloads. If `welcome.payload.v !== 1` (including missing),
  the extension shows a persistent "Update helper: this extension needs protocol v1" banner.
- `"reopen"` in `bug_action.payload.action`. The helper answers with `bug_updated{status:"open"}`.

**There are no other WS message types.** In particular, none of these exist: `ack`, `ping`/`pong`,
`capture`, `contract`, `stats`, `bug`, `sweep`, `set_live`. Renaming or adding a type needs a new
ADR that supersedes this one.

### How PRD behaviour maps onto §2 (no new messages)

| Need | How, using §2 only |
|---|---|
| Wrong token | The helper sends `error{code:"auth_failed"}` then closes. The extension treats `auth_failed` as pairing failure; every other code is logged only. |
| Version mismatch | `welcome.payload.v !== 1` → banner; no further sends except reconnecting every 10 s. |
| Action timeout (10 s) | Client-side. A pending `{bugId, action}` resolves on `bug_updated` for that `bugId`, or on `fix_prompt` for that `bugId` (`copy_fix_prompt`). One pending action per bug, so `bugId` is the correlation key. |
| Ticket link text | Derived from `ticketUrl` with `/[A-Z][A-Z0-9]+-\d+/`, falling back to "Ticket ↗"; links only for `http(s)`. |
| Pause | Extension-local kill switch plus `set_mode{mode:"paused"}`. After `welcome`, if `welcome.payload.mode` differs, the extension re-sends its own mode. |
| Role | Lists `welcome.payload.roles`; the chosen role is re-sent with `set_role` after each `welcome`. |
| Full sweep | `run_sweep{target:"localhost", role}`. v1 never sends `"dev"`. |
| Exactly-once queued submits | Queue key = `submitId`, removed only when a `contract_result` with that `submitId` arrives; both sides dedupe by `submitId`. |
| Contract entry time | The `captured_submit` envelope `ts`, kept by the extension per `submitId`. |
| Truncated body | A body over 64 KB is sent as a string: the first 65,536 characters + `"…[truncated: <N> bytes]"`. |
| Network error | `status: 0`, `resBody: null`. |
| Keep-alive | Not a WS concern: extension-internal `chrome.runtime` traffic keeps the service worker alive. |

Other recorded decisions:

- **Ignore** hides a bug for the current helper session; **Mark expected** is remembered by
  fingerprint across runs. Both are helper-side; the extension only renders `status`.
- **No destructive-actions toggle** in the protocol; it is helper configuration.
- Wire names are **snake_case message types with camelCase payload keys**, as in §2. This differs
  from the VALT API's conventions on purpose: it is a separate contract.

### Proposed additions (not accepted; for a future ADR)

1. `role` in the `welcome` payload, so the extension learns the helper's current role after a
   restart.
2. A helper-originated heartbeat, so an idle helper keeps the service worker awake.
3. `truncated?: boolean` on `CapturedRequest`, replacing the in-band marker.
4. `resHeaders` on `CapturedRequest`, if the helper needs response-header checks.

## Alternatives considered

- **SSE (ADR 0007) plus HTTP POSTs for upstream** — two channels to authenticate and order, and
  an extension service worker cannot hold an `EventSource`-style stream more reliably than a
  WebSocket (Chrome 116+ resets the worker idle timer on WebSocket traffic).
- **Chrome native messaging** — needs a per-OS host manifest install step; too heavy for a
  localhost dev tool and a demo.
- **Helper drives its own Playwright browser only** — never sees the developer's own submits,
  which is the core moment.

## Consequences

### Positive

- The extension and helper are built and tested independently against the same fixtures.
- Localhost-only bind plus token pairing keeps other local pages from driving the helper.

### Negative / risks

- No heartbeat in v1: an idle helper with no open panel or localhost tab can let the worker sleep;
  a 30 s alarm reconnects.
- The in-band truncation marker means a helper parsing `resBody` sees a string for cut bodies.

### Follow-ups

- **Out of scope, owned by the Phase 1 owner:** the ADR for the Node helper calling Gemini outside
  ADR 0003/0014.
- Decide the proposed additions before protocol v2.
