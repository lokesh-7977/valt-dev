import type {
  AltEvent,
  AltSettings,
  DiscoveredAction,
  DiscoveredForm,
  DiscoveredPage,
  FieldMessage,
  HealthKind,
  PageMessage,
  SessionExport,
  SessionSnapshot,
} from "@valt/shared";

/**
 * Typed runtime messages between the three ALT contexts:
 *   service worker ⇄ content script   chrome.tabs.sendMessage / chrome.runtime.sendMessage
 *   service worker ⇄ side panel        chrome.runtime ports (PORT_PANEL, PORT_EVENTS)
 */

export const PORT_EVENTS = "alt:events";
export const PORT_PANEL = "alt:panel";

// ---------- SW → content (request/response) ----------

/** What the content script can see of a page; the SW adds depth/source/ids. */
export type PageScan = Omit<
  DiscoveredPage,
  "depth" | "source" | "discoveredAt" | "formIds" | "actionIds"
> & {
  forms: DiscoveredForm[];
  actions: DiscoveredAction[];
};

export interface FillField {
  key: string;
  selector: string;
  value: string;
}

export interface FillReport {
  key: string;
  requested: string;
  applied: string;
  /** The browser changed the value (e.g. "abc" in type=number, "2026-02-31" in type=date). */
  sanitized: boolean;
  ok: boolean;
  error?: string;
}

export interface ObserveSnapshot {
  url: string;
  formPresent: boolean;
  /** A native `invalid` event fired since observe.begin (browser blocked submission). */
  clientInvalid: boolean;
  validationMessages: FieldMessage[];
  /** Alerts / status / toasts that appeared or changed since observe.begin. */
  messages: PageMessage[];
  /** All fields of the form are back to empty/default after having been filled. */
  formReset: boolean;
  /** ms since the last DOM mutation (computed in-page, so no cross-clock issues). */
  quietMs: number;
  mutations: number;
  fieldValues: Record<string, string>;
}

export interface HealthFinding {
  kind: HealthKind;
  severity: "high" | "medium" | "low";
  selector: string | null;
  message: string;
  evidence: string | null;
}

export interface KeyboardWalk {
  order: Array<{ key: string | null; selector: string; tabbable: boolean }>;
  issues: string[];
}

export type OverlayState =
  | { mode: "hidden" }
  | { mode: "watching"; text: string }
  | { mode: "worker"; text: string; detail?: string; highlightSelector?: string | null };

export type ContentRequest =
  | { type: "alt:ping" }
  | { type: "alt:discover"; maxActions: number }
  | { type: "alt:click"; selector: string }
  | { type: "alt:query"; selector: string }
  | { type: "alt:fill"; formSelector: string; fields: FillField[] }
  | { type: "alt:observe.begin"; formSelector: string | null; fields: Array<{ key: string; selector: string }> }
  | { type: "alt:observe.snapshot" }
  | { type: "alt:submit"; formSelector: string; submitSelector: string | null; times: 1 | 2 }
  | { type: "alt:health"; slowPageMs: number }
  | { type: "alt:keyboard.walk"; formSelector: string; fields: Array<{ key: string; selector: string }> }
  | { type: "alt:overlay.set"; state: OverlayState }
  | { type: "alt:links"; };

export interface ContentResponses {
  "alt:ping": { ok: true; url: string; routeKey: string };
  "alt:discover": { ok: true; scan: PageScan };
  "alt:click": { ok: boolean; error?: string };
  "alt:query": { present: boolean; visible: boolean };
  "alt:fill": { ok: boolean; reports: FillReport[]; error?: string };
  "alt:observe.begin": { ok: boolean };
  "alt:observe.snapshot": ObserveSnapshot;
  "alt:submit": { ok: boolean; error?: string };
  "alt:health": { findings: HealthFinding[]; loadMs: number | null };
  "alt:keyboard.walk": KeyboardWalk;
  "alt:overlay.set": { ok: true };
  "alt:links": { links: string[] };
}

export type ContentResponse<T extends ContentRequest["type"]> = ContentResponses[T];

// ---------- content → SW (fire-and-forget) ----------

export type ContentEvent =
  | { type: "alt:ready"; url: string; routeKey: string }
  | { type: "alt:page-changed"; url: string; routeKey: string; reason: "dom" | "popstate" }
  | {
      type: "alt:page-error";
      kind: "console_error" | "unhandled_rejection" | "error" | "dialog";
      message: string;
      stack: string | null;
      url: string;
      ts: number;
    };

// ---------- panel ⇄ SW (PORT_PANEL) ----------

export type PanelRequest =
  | { type: "enable"; origin: string; url: string; tabId: number | null }
  | { type: "disable"; origin: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "settings.update"; patch: Partial<AltSettings> }
  | { type: "snapshot" }
  | { type: "export" }
  | { type: "focus-worker" };

export type PanelMessage =
  | { kind: "state"; snapshot: SessionSnapshot; settings: AltSettings }
  | { kind: "export"; data: SessionExport }
  | { kind: "error"; message: string };

// ---------- event stream (PORT_EVENTS) — Phase 2/3 subscribe here ----------

export type EventsMessage = { kind: "replay"; events: AltEvent[] } | { kind: "event"; event: AltEvent };

const CONTENT_EVENT_TYPES = new Set(["alt:ready", "alt:page-changed", "alt:page-error"]);

export function isContentEvent(m: unknown): m is ContentEvent {
  return typeof m === "object" && m !== null && CONTENT_EVENT_TYPES.has((m as { type?: string }).type ?? "");
}

export function isAltMessage(m: unknown): m is ContentRequest | ContentEvent {
  const t = typeof m === "object" && m !== null ? (m as { type?: unknown }).type : undefined;
  return typeof t === "string" && t.startsWith("alt:");
}
