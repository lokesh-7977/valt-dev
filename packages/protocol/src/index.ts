// Frozen user §2 contract. Do not rename or add types; propose changes in ADR 0016.
// The block below is copied line for line from docs/adr/0016-alt-helper-websocket-protocol.md
// (with `export`). The three lines tagged "§2 + approved addition" carry the only approved
// additions: `v: 1` in hello/welcome and "reopen" in bug_action.
import "./jitless.js";

// ---------- Extension → Helper ----------
export type Hello        = { type: "hello"; payload: { token: string; extVersion: string; v: 1 } };  // §2 + approved addition
export type SetMode      = { type: "set_mode"; payload: { mode: "live" | "paused" } };
export type RunSweep     = { type: "run_sweep"; payload: { target: "localhost" | "dev"; role?: string } };
export type SetRole      = { type: "set_role"; payload: { role: string } };
export type BugAction    = { type: "bug_action"; payload: { bugId: string; action: "ignore" | "expected" | "file_ticket" | "copy_fix_prompt" | "reopen" } };  // §2 + approved addition
export type CapturedSubmit = {
  type: "captured_submit";
  payload: {
    submitId: string; pageUrl: string; route: string;
    form: { selector: string; fields: Array<{ name: string; label: string; type: string; value: string; selector: string }> };
    requests: CapturedRequest[];
    uiAfter: { toasts: string[]; fieldErrors: Array<{ selector: string; text: string }>; url: string };
  };
};
export type CapturedRequest = {
  reqId: string; method: string; url: string; status: number;
  reqHeaders: Record<string,string>;
  reqBody: unknown; resBody: unknown; durationMs: number; initiator: "fetch" | "xhr";
};
// ---------- Helper → Extension ----------
export type Welcome      = { type: "welcome"; payload: { helperVersion: string; project: string; roles: string[]; mode: "live"|"paused"; v: 1 } };  // §2 + approved addition
export type Activity     = { type: "activity"; payload: { agent: string; message: string; progress?: { done: number; total: number } } };
export type BugFound     = { type: "bug_found"; payload: Bug };
export type BugUpdated   = { type: "bug_updated"; payload: { bugId: string; status: "open"|"ignored"|"expected"|"fixed"; ticketUrl?: string } };
export type ContractRes  = { type: "contract_result"; payload: { submitId: string; route: string; rows: ContractRow[]; bugIds: string[] } };
export type RunStats     = { type: "run_stats"; payload: { checks: number; agents: number; durationMs: number; trigger: "save"|"sweep"|"deploy"|"manual_submit" } };
export type FixPrompt    = { type: "fix_prompt"; payload: { bugId: string; text: string } };
export type ErrorMsg     = { type: "error"; payload: { code: string; message: string } };
export type Bug = {
  bugId: string; fingerprint: string; title: string; severity: "critical"|"high"|"medium"|"low";
  layer: "ui"|"api"|"ui_api"|"rule"|"health"; checkCode?: string;
  pageUrl: string; route: string; anchor: { selector: string; fallbackText?: string };
  steps: string[]; expected: string; actual: string;
  evidence: { screenshotUrl?: string; request?: unknown; response?: unknown; highlightKeys?: string[] };
  likelyCause?: { file: string; line?: number; reason: string };
  env: "localhost"|"dev"; status: "open"|"ignored"|"expected"|"fixed"; ticketUrl?: string;
};
export type ContractRow = { field: string; uiValue: string; requestValue: string; responseValue: string; ok: boolean; code?: string };

/** Every message on the wire is wrapped in this envelope. */
export type Envelope<T> = T & { id: string; ts: number };

export type ExtensionToHelper = Hello | SetMode | RunSweep | SetRole | BugAction | CapturedSubmit;
export type HelperToExtension =
  | Welcome
  | Activity
  | BugFound
  | BugUpdated
  | ContractRes
  | RunStats
  | FixPrompt
  | ErrorMsg;

export * from "./constants.js";
export * from "./parse.js";
export * from "./schemas.js";
