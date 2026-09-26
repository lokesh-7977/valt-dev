// ALT isolated-world content script (T19). Bundled as an IIFE into dist/content.js.
//
// - Answers every ContentRequest from the service worker (shapes in shared/messages.ts).
// - Sends `alt:ready` on load, relays MAIN-world errors/dialogs as `alt:page-error`, and — on the
//   developer's own tabs only — reports `alt:page-changed` when forms/fields/links change.
// - Never throws into the page: every handler is wrapped and returns a well-formed response.

import type { ContentEvent, ContentRequest, ContentResponses, HealthFinding, ObserveSnapshot, PageScan } from "../shared/messages.ts";
import { isAltMessage, isContentEvent } from "../shared/messages.ts";
import { routeKey } from "../shared/routes.ts";
import { crawlableLinks, discoverPage } from "./discover.ts";
import { clickElement, fillForm, queryElement, submitForm } from "./fill.ts";
import { keyboardWalk, runHealthChecks } from "./health.ts";
import { beginObservation, snapshot, startMutationTracking, stopMutationTracking } from "./observe.ts";
import { destroyOverlay, setOverlay } from "./overlay.ts";
import { isAltOverlay } from "./selectors.ts";

const PAGE_CHANGE_DEBOUNCE_MS = 800;
const TAKEOVER_EVENT = "alt:content-takeover";
const RELEVANT = "form, input, select, textarea, a[href]";
const PAGE_ERROR_KINDS = new Set(["console_error", "unhandled_rejection", "error", "dialog"]);

type AnyResponse = ContentResponses[keyof ContentResponses];

interface AltGlobal {
  __altContent?: { version: string; teardown: () => void };
}

const VERSION = "1";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isWorkerTab(): boolean {
  try {
    return window.sessionStorage.getItem("__alt_worker") === "1";
  } catch {
    return false;
  }
}

function runtimeAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function send(event: ContentEvent): void {
  if (!runtimeAlive()) return;
  try {
    const p = chrome.runtime.sendMessage(event) as Promise<unknown> | undefined;
    // No listener yet (SW starting) or context invalidated: nothing useful to do.
    if (p && typeof p.catch === "function") p.catch(() => undefined);
  } catch {
    // ignore
  }
}

function emptyScan(): PageScan {
  return {
    url: location.href,
    routeKey: routeKey(location.href),
    title: document.title,
    headings: [],
    nav: [],
    links: [],
    tables: [],
    lists: 0,
    modals: 0,
    isLogin: false,
    loadMs: null,
    forms: [],
    actions: [],
  };
}

function fallbackSnapshot(): ObserveSnapshot {
  return {
    url: location.href,
    formPresent: false,
    clientInvalid: false,
    validationMessages: [],
    messages: [],
    formReset: false,
    quietMs: 0,
    mutations: 0,
    fieldValues: {},
  };
}

/** Map a request to its response. Synchronous: every handler finishes before we reply. */
function handle(req: ContentRequest): AnyResponse {
  switch (req.type) {
    case "alt:ping":
      return { ok: true, url: location.href, routeKey: routeKey(location.href) } satisfies ContentResponses["alt:ping"];
    case "alt:discover":
      try {
        return { ok: true, scan: discoverPage(req.maxActions) } satisfies ContentResponses["alt:discover"];
      } catch {
        return { ok: true, scan: emptyScan() } satisfies ContentResponses["alt:discover"];
      }
    case "alt:click":
      try {
        return clickElement(req.selector) satisfies ContentResponses["alt:click"];
      } catch (e) {
        return { ok: false, error: errorText(e) };
      }
    case "alt:query":
      try {
        return queryElement(req.selector) satisfies ContentResponses["alt:query"];
      } catch {
        return { present: false, visible: false };
      }
    case "alt:fill":
      try {
        return fillForm(req.formSelector, req.fields) satisfies ContentResponses["alt:fill"];
      } catch (e) {
        return { ok: false, reports: [], error: errorText(e) };
      }
    case "alt:observe.begin":
      try {
        beginObservation(req.formSelector, req.fields);
        return { ok: true } satisfies ContentResponses["alt:observe.begin"];
      } catch {
        return { ok: false };
      }
    case "alt:observe.snapshot":
      try {
        return snapshot() satisfies ContentResponses["alt:observe.snapshot"];
      } catch {
        return fallbackSnapshot();
      }
    case "alt:submit":
      try {
        return submitForm(req.formSelector, req.submitSelector, req.times) satisfies ContentResponses["alt:submit"];
      } catch (e) {
        return { ok: false, error: errorText(e) };
      }
    case "alt:health":
      try {
        return runHealthChecks(req.slowPageMs) satisfies ContentResponses["alt:health"];
      } catch {
        return { findings: [] as HealthFinding[], loadMs: null };
      }
    case "alt:keyboard.walk":
      try {
        return keyboardWalk(req.formSelector, req.fields) satisfies ContentResponses["alt:keyboard.walk"];
      } catch (e) {
        return { order: [], issues: [`keyboard walk failed: ${errorText(e)}`] };
      }
    case "alt:overlay.set":
      try {
        setOverlay(req.state);
      } catch {
        // cosmetic only
      }
      return { ok: true } satisfies ContentResponses["alt:overlay.set"];
    case "alt:links":
      try {
        return { links: crawlableLinks() } satisfies ContentResponses["alt:links"];
      } catch {
        return { links: [] };
      }
  }
}

function init(): () => void {
  const cleanups: Array<() => void> = [];

  startMutationTracking();
  cleanups.push(stopMutationTracking);

  // ---- SW requests ----
  const onMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: AnyResponse) => void,
  ): boolean => {
    if (!isAltMessage(message) || isContentEvent(message)) return false;
    if (sender.id !== undefined && sender.id !== chrome.runtime.id) return false;
    let response: AnyResponse;
    try {
      response = handle(message as ContentRequest);
    } catch (e) {
      // Unknown request type or unexpected failure: answer rather than leave the SW hanging.
      response = { ok: false, error: errorText(e) } as AnyResponse;
    }
    try {
      sendResponse(response);
    } catch {
      // port closed (page navigating away)
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  cleanups.push(() => chrome.runtime.onMessage.removeListener(onMessage));

  // ---- MAIN-world relay ----
  const onWindowMessage = (event: MessageEvent): void => {
    if (event.source !== window) return;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null || (data as { __alt?: unknown }).__alt !== 1) return;
    const d = data as { kind?: unknown; message?: unknown; stack?: unknown; ts?: unknown };
    if (typeof d.kind !== "string" || !PAGE_ERROR_KINDS.has(d.kind)) return;
    send({
      type: "alt:page-error",
      kind: d.kind as "console_error" | "unhandled_rejection" | "error" | "dialog",
      message: String(d.message ?? "").slice(0, 500),
      stack: typeof d.stack === "string" ? d.stack.slice(0, 2000) : null,
      url: location.href,
      ts: typeof d.ts === "number" && Number.isFinite(d.ts) ? d.ts : Date.now(),
    });
  };
  window.addEventListener("message", onWindowMessage);
  cleanups.push(() => window.removeEventListener("message", onWindowMessage));

  // ---- developer tabs: report structural page changes (debounced) ----
  if (!isWorkerTab()) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reason: "dom" | "popstate" = "dom";
    const flush = (): void => {
      timer = null;
      const r = reason;
      reason = "dom";
      send({ type: "alt:page-changed", url: location.href, routeKey: routeKey(location.href), reason: r });
    };
    const schedule = (why: "dom" | "popstate"): void => {
      if (why === "popstate") reason = "popstate";
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, PAGE_CHANGE_DEBOUNCE_MS);
    };
    const touches = (n: Node): boolean => {
      if (!(n instanceof Element) || isAltOverlay(n)) return false;
      try {
        return n.matches(RELEVANT) || n.querySelector(RELEVANT) !== null;
      } catch {
        return false;
      }
    };
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") {
          if (Array.from(r.addedNodes).some(touches) || Array.from(r.removedNodes).some(touches)) {
            schedule("dom");
            return;
          }
        } else if (r.type === "attributes" && touches(r.target)) {
          // A modal/tab panel holding a form was shown or hidden.
          schedule("dom");
          return;
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "open", "aria-hidden"],
    });
    const onPopState = (): void => schedule("popstate");
    window.addEventListener("popstate", onPopState);
    cleanups.push(() => {
      observer.disconnect();
      window.removeEventListener("popstate", onPopState);
      if (timer !== null) clearTimeout(timer);
    });
  }

  cleanups.push(destroyOverlay);

  send({ type: "alt:ready", url: location.href, routeKey: routeKey(location.href) });

  return () => {
    for (const c of cleanups.reverse()) {
      try {
        c();
      } catch {
        // ignore
      }
    }
  };
}

(() => {
  const g = window as Window & AltGlobal;
  try {
    if (g.__altContent) return; // already injected in this world
    // An orphaned copy from before an extension reload lives in a different world; tell it to stop.
    document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));
    const teardown = init();
    g.__altContent = { version: VERSION, teardown };
    const onTakeover = (): void => {
      if (runtimeAlive()) return; // a live copy never yields
      document.removeEventListener(TAKEOVER_EVENT, onTakeover);
      teardown();
      delete g.__altContent;
    };
    document.addEventListener(TAKEOVER_EVENT, onTakeover);
  } catch {
    // never throw into the page
  }
})();
