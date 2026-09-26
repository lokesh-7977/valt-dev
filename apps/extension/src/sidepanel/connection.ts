import type { AltSettings, SessionExport, SessionSnapshot } from "@valt/shared";
import { PORT_PANEL, type PanelMessage, type PanelRequest } from "../shared/messages.ts";
import type { ActiveTab, ConnState } from "./types.ts";

export interface ConnectionHandlers {
  onState(snapshot: SessionSnapshot, settings: AltSettings): void;
  onExport(data: SessionExport): void;
  onError(message: string): void;
  onStatus(state: ConnState, message: string | null): void;
}

export interface Connection {
  /** Returns false when there is no open port (the UI then shows the lost state). */
  send(req: PanelRequest): boolean;
  reconnect(): void;
}

const NO_STATE_TIMEOUT_MS = 8000;
/** A port that lived at least this long may be silently reconnected once (SW restarts happen). */
const STABLE_MS = 5000;

function isPanelMessage(m: unknown): m is PanelMessage {
  if (typeof m !== "object" || m === null) return false;
  const kind = (m as { kind?: unknown }).kind;
  return kind === "state" || kind === "export" || kind === "error";
}

/** Owns the `alt:panel` port: connect, route messages, detect loss, retry. */
export function createConnection(h: ConnectionHandlers): Connection {
  let port: chrome.runtime.Port | null = null;
  let openedAt = 0;
  let gotState = false;
  let silentRetryUsed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function lost(message: string): void {
    port = null;
    clearTimeout(timer);
    h.onStatus("lost", message);
  }

  function connect(): void {
    clearTimeout(timer);
    h.onStatus("connecting", null);
    let p: chrome.runtime.Port;
    try {
      p = chrome.runtime.connect({ name: PORT_PANEL });
    } catch {
      lost("ALT's background worker isn't available. Reload the extension, then try again.");
      return;
    }
    port = p;
    openedAt = Date.now();
    gotState = false;

    p.onMessage.addListener((msg: unknown) => {
      if (port !== p || !isPanelMessage(msg)) return;
      if (msg.kind === "state") {
        if (!gotState) {
          gotState = true;
          clearTimeout(timer);
          h.onStatus("open", null);
        }
        if (Date.now() - openedAt >= STABLE_MS) silentRetryUsed = false;
        h.onState(msg.snapshot, msg.settings);
      } else if (msg.kind === "export") {
        h.onExport(msg.data);
      } else {
        h.onError(String(msg.message));
      }
    });

    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // read it so Chrome doesn't log "Unchecked runtime.lastError"
      if (port !== p) return;
      port = null;
      clearTimeout(timer);
      const stable = gotState && Date.now() - openedAt >= STABLE_MS;
      if (stable && !silentRetryUsed) {
        silentRetryUsed = true;
        setTimeout(connect, 400);
        return;
      }
      lost("Lost the connection to ALT's background worker.");
    });

    timer = setTimeout(() => {
      if (port === p && !gotState) h.onStatus("lost", "ALT isn't responding.");
    }, NO_STATE_TIMEOUT_MS);

    send({ type: "snapshot" });
  }

  function send(req: PanelRequest): boolean {
    if (!port) return false;
    try {
      port.postMessage(req);
      return true;
    } catch {
      lost("Lost the connection to ALT's background worker.");
      return false;
    }
  }

  function reconnect(): void {
    const old = port;
    port = null;
    try {
      old?.disconnect();
    } catch {
      /* already gone */
    }
    silentRetryUsed = false;
    connect();
  }

  connect();
  return { send, reconnect };
}

function toActiveTab(t: chrome.tabs.Tab | undefined): ActiveTab {
  const url = t?.url || t?.pendingUrl || "";
  let origin: string | null = null;
  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") {
      origin = u.origin;
      host = u.host;
    }
  } catch {
    /* not a URL we can use */
  }
  return { id: t?.id ?? null, url, origin, host, web: origin !== null };
}

/** Tracks the active tab of the panel's window. */
export function watchActiveTab(onChange: (tab: ActiveTab) => void): void {
  let seq = 0;
  const refresh = (): void => {
    const mine = ++seq;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        if (mine === seq) onChange(toActiveTab(tabs[0]));
      })
      .catch(() => {
        if (mine === seq) onChange(toActiveTab(undefined));
      });
  };
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab.active && (info.url !== undefined || info.status === "complete")) refresh();
  });
  refresh();
}
