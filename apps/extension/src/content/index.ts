// ALT isolated-world content script: bridges the page hook to the service worker.
import { CS_SOURCE, isHookMessage, type CsMessage } from "../shared/bridge";
import { KEEPALIVE_MS } from "../shared/config";
import type { ContentToSw, Mode, SwToContent } from "../shared/runtime-messages";
import { CapturePipeline } from "./capture";

const sendToSw = (msg: ContentToSw): Promise<unknown> => {
  try {
    return chrome.runtime.sendMessage(msg).catch(() => undefined);
  } catch {
    // Extension reloaded or context invalidated: stay silent, never break the page.
    return Promise.resolve(undefined);
  }
};

const toHook = (msg: CsMessage) => window.postMessage(msg, "*");

export function startContent(): void {
  const pipeline = new CapturePipeline({ doc: document, send: (m) => void sendToSw(m) });
  pipeline.attach();

  const setMode = (mode: Mode) => {
    pipeline.paused = mode === "paused";
    toHook({ source: CS_SOURCE, kind: "cs:mode", mode });
  };

  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window || !isHookMessage(e.data)) return;
    const msg = e.data;
    if (msg.kind === "hook:req_start") pipeline.onReqStart(msg);
    else if (msg.kind === "hook:req_end") pipeline.onReqEnd(msg);
    else if (msg.kind === "hook:nav") void sendToSw({ kind: "cs:route", route: location.pathname, url: location.href });
    else if (msg.kind === "hook:perf") document.documentElement.dataset.altHookP95 = String(msg.p95);
  });

  chrome.runtime.onMessage.addListener((msg: SwToContent) => {
    if (msg?.kind === "sw:mode") setMode(msg.mode);
    contentHandlers.forEach((h) => h(msg));
  });

  void sendToSw({ kind: "cs:hello", route: location.pathname, url: location.href }).then((res) => {
    const mode = (res as { mode?: Mode } | undefined)?.mode;
    if (mode) setMode(mode);
  });

  setInterval(() => {
    if (document.visibilityState === "visible") void sendToSw({ kind: "cs:keepalive" });
  }, KEEPALIVE_MS);
}

/** Other content modules (overlay) subscribe to SW messages here. */
export const contentHandlers = new Set<(msg: SwToContent) => void>();

if (typeof chrome !== "undefined" && chrome.runtime?.id && !import.meta.env?.VITEST) {
  startContent();
}
