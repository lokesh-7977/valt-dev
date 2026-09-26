import type { AltSettings, SessionExport } from "@valt/shared";
import {
  isContentEvent,
  PORT_EVENTS,
  PORT_PANEL,
  type ContentEvent,
  type PanelMessage,
  type PanelRequest,
} from "../shared/messages.ts";
import { originOf } from "../shared/routes.ts";
import { createBus } from "./bus.ts";
import { createGemini } from "./gemini.ts";
import { disableOrigin, enableOrigin, reconcile } from "./injection.ts";
import { createNetworkRecorder, type NetworkRecorder } from "./network.ts";
import { createSession } from "./session.ts";
import { createStore } from "./store.ts";
import { watchDeveloperTabs } from "./watch.ts";
import { createWorkerTab } from "./worker-tab.ts";

/**
 * ALT service worker: the orchestrator. All listeners are registered synchronously at top level
 * (MV3 requirement); state is restored from storage before the loop resumes.
 */

const store = createStore({ sessionArea: chrome.storage.session, localArea: chrome.storage.local });
const bus = createBus({ sessionId: "none" });
const worker = createWorkerTab({
  initialId: null,
  onCreated: (id) => store.update((s) => (s.workerTabId = id)),
});
const gemini = createGemini({
  fetch: (url, init) => fetch(url, init),
  cache: store,
  onStatus: (ai) => store.update((s) => (s.ai = ai)),
});

let apiBase = "http://localhost:8000";
let network: NetworkRecorder | null = null;

const session = createSession({
  bus,
  store,
  worker,
  network: () => network!,
  gemini,
  enableOrigin,
  fetch: (input, init) => fetch(input, init),
});

network = createNetworkRecorder({
  isTracked: (tabId, url) => session.trackedTab(tabId, url),
  excludeUrl: (url) => url.startsWith(apiBase),
  onEvent: (e) => session.onNetwork(e),
});

watchDeveloperTabs(session, () => worker.id());

// ---------- content scripts → SW ----------

chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  if (!isContentEvent(msg)) return undefined;
  const tabId = sender.tab?.id;
  if (tabId == null) return undefined;
  handleContentEvent(tabId, msg);
  return undefined;
});

function handleContentEvent(tabId: number, msg: ContentEvent): void {
  switch (msg.type) {
    case "alt:ready":
      session.setTabUrl(tabId, msg.url);
      return;
    case "alt:page-changed":
      if (tabId !== worker.id()) session.onDeveloperActivity(tabId, msg.url, "dom");
      return;
    case "alt:page-error":
      session.onConsole(tabId, { ts: msg.ts || Date.now(), kind: msg.kind, message: msg.message, stack: msg.stack, url: msg.url });
      return;
  }
}

// ---------- panel & event ports ----------

const panelPorts = new Set<chrome.runtime.Port>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;

async function pushState(): Promise<void> {
  pushTimer = null;
  if (panelPorts.size === 0) return;
  const msg: PanelMessage = { kind: "state", snapshot: store.snapshot(), settings: await store.getSettings() };
  for (const p of panelPorts) {
    try {
      p.postMessage(msg);
    } catch {
      panelPorts.delete(p);
    }
  }
}

store.onChange(() => {
  if (pushTimer === null && panelPorts.size > 0) pushTimer = setTimeout(() => void pushState(), 300);
});

async function exportSession(): Promise<SessionExport> {
  return { contractVersion: 1, exportedAt: Date.now(), settings: await store.getSettings(), snapshot: store.snapshot(), events: bus.recent() };
}

async function enable(origin: string, url: string, patch: Partial<AltSettings> = {}): Promise<void> {
  const s = await store.getSettings();
  await store.setSettings({ ...patch, enabledOrigins: [...s.enabledOrigins.filter((o) => o !== origin), origin] });
  await session.start(origin, url);
}

async function handlePanel(port: chrome.runtime.Port, req: PanelRequest): Promise<void> {
  await booted;
  switch (req.type) {
    case "enable": {
      const origin = originOf(req.url) ?? req.origin;
      await enable(origin, req.url);
      break;
    }
    case "disable": {
      if (session.origin() === req.origin) await session.stop("ALT disabled on this site");
      const s = await store.getSettings();
      await store.setSettings({ enabledOrigins: s.enabledOrigins.filter((o) => o !== req.origin) });
      await disableOrigin(req.origin);
      break;
    }
    case "pause":
      session.pause();
      break;
    case "resume":
      session.resume();
      break;
    case "stop":
      await session.stop();
      break;
    case "settings.update":
      await store.setSettings(req.patch);
      break;
    case "export":
      port.postMessage({ kind: "export", data: await exportSession() } satisfies PanelMessage);
      return;
    case "focus-worker":
      await worker.focus();
      return;
    case "snapshot":
      break;
  }
  await pushState();
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_EVENTS) {
    bus.attachPort(port);
    return;
  }
  if (port.name !== PORT_PANEL) return;
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
  port.onMessage.addListener((req: PanelRequest) => {
    void handlePanel(port, req).catch((err: unknown) => {
      port.postMessage({ kind: "error", message: (err as Error)?.message ?? String(err) } satisfies PanelMessage);
    });
  });
  void pushState();
});

// ---------- lifecycle ----------

chrome.tabs.onRemoved.addListener((tabId) => {
  worker.forget(tabId);
  session.forgetTab(tabId);
  if (store.state.workerTabId === tabId) store.update((s) => (s.workerTabId = null));
});

chrome.alarms.create("alt-tick", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "alt-tick") session.kick();
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

const booted = (async () => {
  const settings = await store.getSettings();
  apiBase = settings.apiBaseUrl;
  store.onChange(() => void store.getSettings().then((s) => (apiBase = s.apiBaseUrl)));
  await reconcile(settings.enabledOrigins).catch(() => undefined);
  const restored = await store.restore();
  if (restored) {
    if (restored.workerTabId != null) {
      const alive = await chrome.tabs.get(restored.workerTabId).then(() => true).catch(() => false);
      // Adopt the existing ALT tab instead of opening another.
      if (alive) worker.adopt(restored.workerTabId);
    }
    session.restore();
  }
})();

// ---------- test & integration hook ----------

/**
 * `globalThis.__alt` — used by the E2E suite and available to Phase 2/3 code running in this
 * service worker: `__alt.bus.on("test.executed", ...)`.
 */
const api = {
  bus,
  async enable(origin: string, patch: Partial<AltSettings> = {}) {
    await booted;
    await enable(origin, `${origin}/`, patch);
  },
  snapshot: () => store.snapshot(),
  events: () => bus.recent(),
  settings: () => store.getSettings(),
  exportSession,
  pause: () => session.pause(),
  resume: () => session.resume(),
  stop: () => session.stop(),
};
(globalThis as unknown as { __alt: typeof api }).__alt = api;
