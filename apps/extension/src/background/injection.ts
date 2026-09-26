import { fnv1a } from "../shared/hash.ts";

/**
 * ALT only runs on origins the developer enabled. Content scripts are registered per origin
 * (match patterns are port-specific), so the MAIN-world hooks never touch other sites.
 */

const ids = (origin: string) => {
  const h = fnv1a(origin);
  return { main: `alt-main-${h}`, content: `alt-content-${h}` };
};

function scriptsFor(origin: string): chrome.scripting.RegisteredContentScript[] {
  const { main, content } = ids(origin);
  const matches = [`${origin}/*`];
  return [
    { id: main, js: ["main-world.js"], matches, runAt: "document_start", world: "MAIN", allFrames: false, persistAcrossSessions: true },
    { id: content, js: ["content.js"], matches, runAt: "document_idle", allFrames: false, persistAcrossSessions: true },
  ];
}

export async function enableOrigin(origin: string): Promise<void> {
  const wanted = scriptsFor(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: wanted.map((s) => s.id) });
  const have = new Set(existing.map((s) => s.id));
  const toUpdate = wanted.filter((s) => have.has(s.id));
  const toAdd = wanted.filter((s) => !have.has(s.id));
  if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
  if (toAdd.length) await chrome.scripting.registerContentScripts(toAdd);
  await injectOpenTabs(origin);
}

/** Tabs that were already open before enabling get the scripts now (no reload needed). */
export async function injectOpenTabs(origin: string): Promise<void> {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  await Promise.all(tabs.map((t) => (t.id != null ? injectTab(t.id) : Promise.resolve())));
}

export async function injectTab(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["main-world.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    // Tab closed, discarded or not scriptable (e.g. chrome:// error page).
  }
}

export async function disableOrigin(origin: string): Promise<void> {
  const { main, content } = ids(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [main, content] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
}

/** On SW start: make registrations match the enabled origins exactly. */
export async function reconcile(enabledOrigins: string[]): Promise<void> {
  const all = await chrome.scripting.getRegisteredContentScripts();
  const wanted = new Set(enabledOrigins.flatMap((o) => Object.values(ids(o))));
  const stale = all.filter((s) => s.id.startsWith("alt-") && !wanted.has(s.id)).map((s) => s.id);
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  for (const o of enabledOrigins) {
    const { main, content } = ids(o);
    const have = new Set(all.map((s) => s.id));
    if (!have.has(main) || !have.has(content)) await enableOrigin(o);
  }
}
