// MAIN-world observer for fetch, XHR and SPA navigation. Runs before page scripts.
//
// Rules (PRD story 11): the page always gets the ORIGINAL fetch promise and the original XHR
// behaviour; every wrapper fails open to the original call; bodies are read from clones,
// asynchronously, off the call path; event streams are never read. Keep this file free of
// dependencies other than ../shared/bridge (it ships in the IIFE).
import {
  HOOK_SOURCE,
  isCsMessage,
  type BodySnapshot,
  type HookMessage,
  type HookReqEnd,
  type HookReqStart,
} from "../shared/bridge";

export const BODY_LIMIT = 65536;
const RING_SIZE = 512;

type HookWindow = Window & typeof globalThis;
type Post = (msg: HookMessage) => void;

export type HookHandle = {
  uninstall: () => void;
  /** p50/p95 of the synchronous overhead added per call, in ms. */
  perf: () => { p50: number; p95: number; n: number };
  setPaused: (paused: boolean) => void;
};

const READABLE_TYPE = /json|text\/|form-urlencoded|xml|graphql/i;

function headersToRecord(h: HeadersInit | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  try {
    if (typeof (h as Headers).forEach === "function" && !Array.isArray(h)) {
      (h as Headers).forEach((v, k) => (out[k.toLowerCase()] = v));
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) if (k) out[k.toLowerCase()] = String(v);
    } else {
      for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
    }
  } catch {
    /* fail open */
  }
  return out;
}

function textSnapshot(text: string, bytes = text.length): BodySnapshot {
  const cut = text.length > BODY_LIMIT;
  return { kind: "text", text: cut ? text.slice(0, BODY_LIMIT) : text, bytes, cut };
}

/** Snapshot a request body synchronously and cheaply. Unknown/binary bodies return null. */
function snapshotBody(body: unknown, win: HookWindow): BodySnapshot | null {
  if (body == null) return null;
  if (typeof body === "string") return textSnapshot(body);
  if (win.URLSearchParams && body instanceof win.URLSearchParams) {
    return { kind: "form", fields: Object.fromEntries(body.entries()) };
  }
  if (win.FormData && body instanceof win.FormData) {
    const fields: Record<string, string> = {};
    body.forEach((v, k) => (fields[k] = typeof v === "string" ? v : "[file]"));
    return { kind: "form", fields };
  }
  return null;
}

/** Read up to BODY_LIMIT chars from a response clone, then cancel the clone's stream. */
async function readResponse(res: Response): Promise<BodySnapshot | null> {
  const type = res.headers.get("content-type") ?? "";
  if (/event-stream/i.test(type) || !READABLE_TYPE.test(type)) return null;
  const declared = Number(res.headers.get("content-length") ?? "") || 0;
  const clone = res.clone();
  const reader = clone.body?.getReader();
  if (!reader) {
    const text = await clone.text();
    return textSnapshot(text, Math.max(declared, text.length));
  }
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (text.length > BODY_LIMIT) {
      void reader.cancel().catch(() => {});
      return { kind: "text", text: text.slice(0, BODY_LIMIT), bytes: Math.max(declared, bytes), cut: true };
    }
  }
  text += decoder.decode();
  return { kind: "text", text, bytes, cut: false };
}

export function installHook(win: HookWindow, post?: Post): HookHandle {
  const send: Post =
    post ??
    ((msg) => {
      try {
        win.postMessage(msg, "*");
      } catch {
        /* fail open */
      }
    });
  let paused = false;
  let seq = 0;
  const prefix = Math.random().toString(36).slice(2, 8);
  const nextId = () => `${prefix}-${++seq}`;

  const ring = new Float64Array(RING_SIZE);
  let ringCount = 0;
  const measure = (t0: number) => {
    ring[ringCount++ % RING_SIZE] = win.performance.now() - t0;
  };

  // ---------- fetch ----------
  const origFetch = win.fetch;
  function altFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const promise = origFetch.call(this ?? win, input, init);
    if (paused) return promise;
    const t0 = win.performance.now();
    try {
      const isRequest = typeof win.Request === "function" && input instanceof win.Request;
      const method = String(init?.method ?? (isRequest ? (input as Request).method : "GET")).toUpperCase();
      const url = isRequest ? (input as Request).url : String(input);
      const headers = {
        ...(isRequest ? headersToRecord((input as Request).headers) : {}),
        ...headersToRecord(init?.headers),
      };
      const reqId = nextId();
      const t = Date.now();
      const base = { source: HOOK_SOURCE, kind: "hook:req_start", reqId, method, url, headers, initiator: "fetch", t } as const;

      let started: Promise<void>;
      if (init?.body != null || method === "GET" || method === "HEAD") {
        send({ ...base, body: snapshotBody(init?.body, win) } satisfies HookReqStart);
        started = Promise.resolve();
      } else if (isRequest) {
        // Request objects: read a clone's body; the original still goes to the page untouched.
        started = (input as Request)
          .clone()
          .text()
          .then((text) => send({ ...base, body: text ? textSnapshot(text) : null }))
          .catch(() => send({ ...base, body: null }));
      } else {
        send({ ...base, body: null });
        started = Promise.resolve();
      }

      const end = (status: number, body: BodySnapshot | null) =>
        void started.then(() =>
          send({
            source: HOOK_SOURCE,
            kind: "hook:req_end",
            reqId,
            status,
            body,
            durationMs: Date.now() - t,
            t: Date.now(),
          } satisfies HookReqEnd),
        );

      promise.then(
        (res) => {
          readResponse(res)
            .catch(() => null)
            .then((body) => end(res.status, body));
        },
        () => end(0, null),
      );
    } catch {
      /* fail open */
    } finally {
      measure(t0);
    }
    return promise;
  }
  win.fetch = altFetch as typeof win.fetch;

  // ---------- XMLHttpRequest ----------
  type XhrInfo = { method: string; url: string; headers: Record<string, string> };
  const xhrInfo = new WeakMap<XMLHttpRequest, XhrInfo>();
  const proto = win.XMLHttpRequest?.prototype;
  const origOpen = proto?.open;
  const origSetHeader = proto?.setRequestHeader;
  const origSend = proto?.send;

  if (proto && origOpen && origSetHeader && origSend) {
    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      try {
        xhrInfo.set(this, { method: String(method).toUpperCase(), url: new URL(String(url), win.location.href).href, headers: {} });
      } catch {
        /* fail open */
      }
      return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof proto.open;

    proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      try {
        const info = xhrInfo.get(this);
        if (info) info.headers[name.toLowerCase()] = value;
      } catch {
        /* fail open */
      }
      return origSetHeader.call(this, name, value);
    };

    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (!paused) {
        const t0 = win.performance.now();
        try {
          const info = xhrInfo.get(this);
          if (info) {
            const reqId = nextId();
            const t = Date.now();
            send({
              source: HOOK_SOURCE,
              kind: "hook:req_start",
              reqId,
              method: info.method,
              url: info.url,
              headers: { ...info.headers },
              body: snapshotBody(body, win),
              initiator: "xhr",
              t,
            });
            this.addEventListener("loadend", () => {
              try {
                let snap: BodySnapshot | null = null;
                if (this.responseType === "" || this.responseType === "text") {
                  snap = this.responseText ? textSnapshot(this.responseText) : null;
                } else if (this.responseType === "json" && this.response != null) {
                  snap = textSnapshot(JSON.stringify(this.response));
                }
                send({
                  source: HOOK_SOURCE,
                  kind: "hook:req_end",
                  reqId,
                  status: this.status,
                  body: snap,
                  durationMs: Date.now() - t,
                  t: Date.now(),
                });
              } catch {
                /* fail open */
              }
            });
          }
        } catch {
          /* fail open */
        } finally {
          measure(t0);
        }
      }
      return origSend.call(this, body);
    };
  }

  // ---------- SPA navigation ----------
  const origPush = win.history.pushState;
  const origReplace = win.history.replaceState;
  const nav = () => {
    try {
      send({ source: HOOK_SOURCE, kind: "hook:nav", url: win.location.href });
    } catch {
      /* fail open */
    }
  };
  win.history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
    const r = origPush.apply(this, args);
    nav();
    return r;
  };
  win.history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
    const r = origReplace.apply(this, args);
    nav();
    return r;
  };
  win.addEventListener("popstate", nav);

  const perf = () => {
    const n = Math.min(ringCount, RING_SIZE);
    const sorted = Array.from(ring.subarray(0, n)).sort((a, b) => a - b);
    const at = (q: number) => (n ? sorted[Math.min(n - 1, Math.floor(q * n))]! : 0);
    return { p50: at(0.5), p95: at(0.95), n };
  };

  // ---------- messages from the content script ----------
  const onMessage = (e: MessageEvent) => {
    if (e.source !== win || !isCsMessage(e.data)) return;
    if (e.data.kind === "cs:mode") paused = e.data.mode === "paused";
    else send({ source: HOOK_SOURCE, kind: "hook:perf", ...perf() });
  };
  win.addEventListener("message", onMessage);

  return {
    perf,
    setPaused: (p) => (paused = p),
    uninstall: () => {
      win.fetch = origFetch;
      if (proto && origOpen && origSetHeader && origSend) {
        proto.open = origOpen;
        proto.setRequestHeader = origSetHeader;
        proto.send = origSend;
      }
      win.history.pushState = origPush;
      win.history.replaceState = origReplace;
      win.removeEventListener("popstate", nav);
      win.removeEventListener("message", onMessage);
    },
  };
}
