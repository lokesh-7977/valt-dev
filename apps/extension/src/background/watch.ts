import type { Session } from "./session.ts";

/**
 * Passive observation of the developer's own tabs. ALT never acts in them; it just notices where
 * the developer is working (page loads, SPA route changes, DOM changes such as HMR reloads) and
 * re-prioritises its own queue so it tests what the developer is looking at.
 */
export function watchDeveloperTabs(session: Session, workerTabId: () => number | null): void {
  const onLoad = (d: { tabId: number; frameId: number; url: string }) => {
    if (d.frameId !== 0 || d.tabId === workerTabId()) return;
    session.onDeveloperActivity(d.tabId, d.url, "load");
  };
  const onSpa = (d: { tabId: number; frameId: number; url: string }) => {
    if (d.frameId !== 0) return;
    if (d.tabId === workerTabId()) {
      session.setTabUrl(d.tabId, d.url);
      return;
    }
    session.onDeveloperActivity(d.tabId, d.url, "spa");
  };
  chrome.webNavigation.onCompleted.addListener(onLoad);
  chrome.webNavigation.onHistoryStateUpdated.addListener(onSpa);
  chrome.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId === 0) session.setTabUrl(d.tabId, d.url);
  });
}
