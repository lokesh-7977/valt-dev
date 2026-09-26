import type { NetworkEvent } from "@valt/shared";

/**
 * Network metadata for the tabs ALT cares about (its worker tab + the developer's tabs on enabled
 * origins), via chrome.webRequest. Survives page navigations, unlike in-page hooks. Bodies are
 * Phase 2's job (NetworkEvent.requestBody/responseBody are reserved for it).
 */

const RING = 500;

export interface NetworkRecorder {
  window(tabId: number, from: number, to: number): NetworkEvent[];
  /** In-flight document/XHR/fetch requests for the tab (used to decide the page has settled). */
  pending(tabId: number): number;
  recent(tabId: number): NetworkEvent[];
  stop(): void;
}

export function createNetworkRecorder(opts: {
  isTracked: (tabId: number, url: string) => boolean;
  excludeUrl: (url: string) => boolean;
  onEvent: (e: NetworkEvent) => void;
}): NetworkRecorder {
  const started = new Map<string, { ts: number; method: string; tabId: number; type: string }>();
  const byTab = new Map<number, NetworkEvent[]>();
  const filter: chrome.webRequest.RequestFilter = { urls: ["<all_urls>"] };

  const record = (e: NetworkEvent) => {
    let list = byTab.get(e.tabId);
    if (!list) byTab.set(e.tabId, (list = []));
    list.push(e);
    if (list.length > RING) list.splice(0, list.length - RING);
    opts.onEvent(e);
  };

  const relevant = (d: { tabId: number; url: string }) => d.tabId >= 0 && !opts.excludeUrl(d.url) && opts.isTracked(d.tabId, d.url);

  const onBefore = (d: chrome.webRequest.OnBeforeRequestDetails) => {
    if (!relevant(d)) return undefined;
    started.set(d.requestId, { ts: d.timeStamp, method: d.method, tabId: d.tabId, type: d.type });
    return undefined;
  };
  const onCompleted = (d: chrome.webRequest.OnCompletedDetails) => {
    const s = started.get(d.requestId);
    if (!s) return;
    started.delete(d.requestId);
    record({
      requestId: d.requestId,
      tabId: d.tabId,
      ts: s.ts,
      url: d.url,
      method: d.method,
      type: d.type,
      status: d.statusCode,
      durationMs: Math.max(0, Math.round(d.timeStamp - s.ts)),
      error: null,
      fromCache: d.fromCache,
    });
  };
  const onError = (d: chrome.webRequest.OnErrorOccurredDetails) => {
    const s = started.get(d.requestId);
    if (!s) return;
    started.delete(d.requestId);
    record({
      requestId: d.requestId,
      tabId: d.tabId,
      ts: s.ts,
      url: d.url,
      method: d.method,
      type: d.type,
      status: 0,
      durationMs: Math.max(0, Math.round(d.timeStamp - s.ts)),
      error: d.error,
      fromCache: d.fromCache,
    });
  };

  chrome.webRequest.onBeforeRequest.addListener(onBefore, filter);
  chrome.webRequest.onCompleted.addListener(onCompleted, filter);
  chrome.webRequest.onErrorOccurred.addListener(onError, filter);

  return {
    window(tabId, from, to) {
      return (byTab.get(tabId) ?? []).filter((e) => e.ts >= from && e.ts <= to);
    },
    recent: (tabId) => (byTab.get(tabId) ?? []).slice(),
    pending(tabId) {
      let n = 0;
      const cutoff = Date.now() - 10_000; // ignore long-polls / hung requests
      for (const s of started.values()) {
        if (s.tabId === tabId && s.ts > cutoff && (s.type === "xmlhttprequest" || s.type === "main_frame")) n++;
      }
      return n;
    },
    stop() {
      chrome.webRequest.onBeforeRequest.removeListener(onBefore);
      chrome.webRequest.onCompleted.removeListener(onCompleted);
      chrome.webRequest.onErrorOccurred.removeListener(onError);
    },
  };
}

/** A request worth a health observation (not ALT's own rejected test submissions). */
export function isFailedRequest(e: NetworkEvent): boolean {
  if (e.error === "net::ERR_ABORTED") return false; // navigation away / cancelled
  if (e.status === 0) return true;
  if (e.status >= 500) return true;
  return e.status >= 400 && e.method === "GET" && e.type !== "main_frame";
}
