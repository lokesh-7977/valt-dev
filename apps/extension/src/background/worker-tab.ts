import type { ContentRequest, ContentResponses } from "../shared/messages.ts";
import { injectTab } from "./injection.ts";

/**
 * ALT's own tab. ALT never drives the tab the developer is using: it works in an inactive tab
 * grouped as "ALT", so the developer keeps working while ALT explores and tests.
 */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function send<T extends ContentRequest["type"]>(
  tabId: number,
  msg: Extract<ContentRequest, { type: T }>,
  timeoutMs = 8000,
): Promise<ContentResponses[T]> {
  return await Promise.race([
    chrome.tabs.sendMessage(tabId, msg) as Promise<ContentResponses[T]>,
    sleep(timeoutMs).then(() => {
      throw new Error(`content timeout: ${msg.type}`);
    }),
  ]);
}

function waitForLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.webNavigation.onCompleted.removeListener(onDone);
      chrome.webNavigation.onErrorOccurred.removeListener(onDone);
      resolve();
    };
    const onDone = (d: { tabId: number; frameId: number }) => {
      if (d.tabId === tabId && d.frameId === 0) finish();
    };
    chrome.webNavigation.onCompleted.addListener(onDone);
    chrome.webNavigation.onErrorOccurred.addListener(onDone);
    setTimeout(finish, timeoutMs);
  });
}

export interface WorkerTab {
  id(): number | null;
  ensure(origin: string): Promise<number>;
  navigate(url: string): Promise<{ ok: boolean; url: string }>;
  back(): Promise<void>;
  reload(): Promise<void>;
  /** Wait until the content script answers (after load or a client-side navigation). */
  ready(timeoutMs?: number): Promise<boolean>;
  focus(): Promise<void>;
  forget(tabId: number): void;
  /** Re-attach to the ALT tab that survived a service-worker restart. */
  adopt(tabId: number): void;
}

export function createWorkerTab(opts: { initialId: number | null; onCreated: (id: number) => void }): WorkerTab {
  let tabId = opts.initialId;
  let creating: Promise<number> | null = null;

  const exists = async (id: number | null): Promise<boolean> => {
    if (id == null) return false;
    try {
      await chrome.tabs.get(id);
      return true;
    } catch {
      return false;
    }
  };

  const markWorker = async (id: number) => {
    // Flag this tab as ALT's: the MAIN-world script neutralises alert/confirm/prompt only here.
    await chrome.scripting.executeScript({
      target: { tabId: id },
      world: "MAIN",
      func: () => {
        try {
          sessionStorage.setItem("__alt_worker", "1");
        } catch {
          // storage blocked: dialogs just won't be neutralised
        }
      },
    });
  };

  const create = async (origin: string): Promise<number> => {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
    const tab = await chrome.tabs.create({ url: `${origin}/`, active: false, ...(win?.id != null ? { windowId: win.id } : {}) });
    const id = tab.id!;
    await waitForLoad(id, 15_000);
    try {
      const groupId = await chrome.tabs.group({ tabIds: [id], ...(win?.id != null ? { createProperties: { windowId: win.id } } : {}) });
      await chrome.tabGroups.update(groupId, { title: "ALT", color: "blue", collapsed: false });
    } catch {
      // tab groups unavailable (e.g. popup window) — not essential
    }
    try {
      await markWorker(id);
      await chrome.tabs.reload(id);
      await waitForLoad(id, 15_000);
    } catch {
      // page not scriptable yet; the next navigate re-injects
    }
    tabId = id;
    opts.onCreated(id);
    return id;
  };

  const api: WorkerTab = {
    id: () => tabId,
    async ensure(origin) {
      if (await exists(tabId)) return tabId!;
      creating ??= create(origin).finally(() => (creating = null));
      return await creating;
    },
    async navigate(url) {
      const id = tabId;
      if (id == null) return { ok: false, url };
      const loaded = waitForLoad(id, 15_000);
      await chrome.tabs.update(id, { url });
      await loaded;
      const ok = await api.ready(5000);
      const tab = await chrome.tabs.get(id).catch(() => null);
      return { ok, url: tab?.url ?? url };
    },
    async back() {
      if (tabId == null) return;
      const loaded = waitForLoad(tabId, 8000);
      await chrome.tabs.goBack(tabId).catch(() => undefined);
      await loaded;
      await api.ready(4000);
    },
    async reload() {
      if (tabId == null) return;
      const loaded = waitForLoad(tabId, 15_000);
      await chrome.tabs.reload(tabId);
      await loaded;
      await api.ready(5000);
    },
    async ready(timeoutMs = 5000) {
      const id = tabId;
      if (id == null) return false;
      const deadline = Date.now() + timeoutMs;
      let injected = false;
      while (Date.now() < deadline) {
        try {
          const r = await send(id, { type: "alt:ping" }, 800);
          if (r?.ok) return true;
        } catch {
          // not ready yet
        }
        if (!injected && Date.now() > deadline - timeoutMs / 2) {
          // Registered scripts missed this document (e.g. first load raced registration).
          injected = true;
          await injectTab(id);
        }
        await sleep(100);
      }
      return false;
    },
    async focus() {
      if (tabId == null) return;
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    },
    forget(id) {
      if (id === tabId) tabId = null;
    },
    adopt(id) {
      tabId = id;
    },
  };
  return api;
}
