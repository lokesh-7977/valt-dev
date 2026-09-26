// Extension-internal messages (chrome.runtime and the panel port). These never go on the
// WebSocket; every kind is prefixed (cs:, sw:, p:) so it can't be mistaken for a §2 type.
import type { Bug, BugAction, CapturedSubmit, ContractRow, RunStats } from "@valt/protocol";

export type Mode = "live" | "paused";
export type ActionKind = BugAction["payload"]["action"];

export type ConnStatus =
  | "no_token"
  | "connecting"
  | "connected"
  | "down"
  | "reconnecting"
  | "pairing_failed"
  | "version_mismatch";

// ---------- content script → service worker ----------
export type CsSubmit = { kind: "cs:submit"; payload: CapturedSubmit["payload"] };
export type CsRoute = { kind: "cs:route"; route: string; url: string };
export type CsOpenPanel = { kind: "cs:open_panel" };
export type CsBugAction = { kind: "cs:bug_action"; bugId: string; action: ActionKind };
export type CsKeepalive = { kind: "cs:keepalive" };
export type CsHello = { kind: "cs:hello"; route: string; url: string };
export type ContentToSw = CsSubmit | CsRoute | CsOpenPanel | CsBugAction | CsKeepalive | CsHello;

// ---------- service worker → content script ----------
export type ActionState = "pending" | "done" | "timeout";
export type SwBugsForRoute = { kind: "sw:bugs_for_route"; route: string; bugs: Bug[] };
export type SwActionState = {
  kind: "sw:action_state";
  bugId: string;
  action: ActionKind;
  state: ActionState;
  /** fix_prompt text, for copy_fix_prompt. */
  text?: string;
};
export type SwFocusBug = { kind: "sw:focus_bug"; bugId: string };
export type SwMode = { kind: "sw:mode"; mode: Mode };
export type SwToast = { kind: "sw:toast"; count: number; route: string };
export type SwToContent = SwBugsForRoute | SwActionState | SwFocusBug | SwMode | SwToast;

// ---------- side panel ⇄ service worker (port "panel") ----------
export type ContractEntry = {
  submitId: string;
  route: string;
  /** Envelope ts of the captured_submit, used to name the entry. */
  ts: number;
  rows: ContractRow[];
  bugIds: string[];
};

export type FeedEntry = {
  id: string;
  ts: number;
  agent: string;
  message: string;
  progress?: { done: number; total: number };
};

export type PanelState = {
  status: ConnStatus;
  everConnected: boolean;
  project: string | null;
  roles: string[];
  role: string | null;
  mode: Mode;
  stats: RunStats["payload"] | null;
  feed: FeedEntry[];
  bugs: Bug[];
  contracts: ContractEntry[];
  pending: Record<string, ActionKind>;
  queue: number;
  queueDropped: boolean;
  tokenHint: string | null;
};

export type PSnapshot = { kind: "p:snapshot"; state: PanelState };
export type PPatch = { kind: "p:patch"; patch: Partial<PanelState> };
export type PActionState = Omit<SwActionState, "kind"> & { kind: "p:action_state" };
export type PNavigate = { kind: "p:navigate"; bugId: string; route: string };
export type SwToPanel = PSnapshot | PPatch | PActionState | PNavigate;

export type PPair = { kind: "p:pair"; token: string };
export type PSetRole = { kind: "p:set_role"; role: string };
export type PSetMode = { kind: "p:set_mode"; mode: Mode };
export type PRunSweep = { kind: "p:run_sweep" };
export type PBugAction = { kind: "p:bug_action"; bugId: string; action: ActionKind };
export type PFocusBug = { kind: "p:focus_bug"; bugId: string };
export type PHeartbeat = { kind: "p:heartbeat" };
export type PanelToSw = PPair | PSetRole | PSetMode | PRunSweep | PBugAction | PFocusBug | PHeartbeat;

export const PANEL_PORT = "panel";
