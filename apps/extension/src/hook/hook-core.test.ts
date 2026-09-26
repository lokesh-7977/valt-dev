import { afterEach, describe, expect, it, vi } from "vitest";
import type { HookMessage, HookReqEnd, HookReqStart } from "../shared/bridge";
import { installHook, type HookHandle } from "./hook-core";

type W = Window & typeof globalThis;
const win = window as W;

let handle: HookHandle | null = null;
const realFetch = win.fetch;
const realXhr = win.XMLHttpRequest;

afterEach(() => {
  handle?.uninstall();
  handle = null;
  win.fetch = realFetch;
  win.XMLHttpRequest = realXhr;
});

function install(fetchImpl: typeof fetch, post?: (m: HookMessage) => void) {
  const posted: HookMessage[] = [];
  win.fetch = fetchImpl;
  handle = installHook(win, post ?? ((m) => posted.push(m)));
  return posted;
}

const ends = (posted: HookMessage[]) => posted.filter((m): m is HookReqEnd => m.kind === "hook:req_end");
const starts = (posted: HookMessage[]) => posted.filter((m): m is HookReqStart => m.kind === "hook:req_start");
const flush = () => new Promise((r) => setTimeout(r, 20));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetch wrapper", () => {
  it("returns the original promise object and captures the exchange", async () => {
    let original: Promise<Response> | null = null;
    const posted = install(((..._args: unknown[]) => {
      original = Promise.resolve(jsonResponse({ id: "inv_1" }, 201));
      return original;
    }) as typeof fetch);
    const returned = win.fetch("/api/invoices", {
      method: "POST",
      headers: { authorization: "Bearer demo" },
      body: JSON.stringify({ customer: "Acme" }),
    });
    expect(returned).toBe(original);
    expect((await returned).status).toBe(201);
    await flush();
    expect(starts(posted)[0]).toMatchObject({
      method: "POST",
      initiator: "fetch",
      headers: { authorization: "Bearer demo" },
      body: { kind: "text", text: '{"customer":"Acme"}', cut: false },
    });
    expect(ends(posted)[0]).toMatchObject({ status: 201, body: { kind: "text", text: '{"id":"inv_1"}' } });
  });

  it("rejects identically and posts status 0 on a network error", async () => {
    const err = new TypeError("Failed to fetch");
    const posted = install((() => Promise.reject(err)) as typeof fetch);
    await expect(win.fetch("/api/x")).rejects.toBe(err);
    await flush();
    expect(ends(posted)[0]).toMatchObject({ status: 0, body: null });
  });

  it("propagates AbortError from an aborted request", async () => {
    install(((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as typeof fetch);
    const ctrl = new AbortController();
    const p = win.fetch("/api/probe/slow", { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never clones or reads an event-stream response", async () => {
    const res = new Response("data: hi\n\n", { headers: { "content-type": "text/event-stream" } });
    const clone = vi.spyOn(res, "clone");
    const posted = install((() => Promise.resolve(res)) as typeof fetch);
    await win.fetch("/api/stream");
    await flush();
    expect(clone).not.toHaveBeenCalled();
    expect(ends(posted)[0]).toMatchObject({ body: null });
  });

  it("cuts bodies over 64 KB", async () => {
    const big = "x".repeat(70 * 1024);
    const posted = install((() => Promise.resolve(new Response(big, { headers: { "content-type": "text/plain" } }))) as typeof fetch);
    await win.fetch("/api/big");
    await flush();
    const body = ends(posted)[0]!.body;
    expect(body).toMatchObject({ kind: "text", cut: true });
    expect(body && body.kind === "text" && body.text.length).toBe(65536);
  });

  it("keeps fetch working when a hook internal throws", async () => {
    install(
      (() => Promise.resolve(jsonResponse({ ok: true }))) as typeof fetch,
      () => {
        throw new Error("boom");
      },
    );
    const res = await win.fetch("/api/probe/json", { method: "POST", body: "{}" });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("skips all capture work while paused", async () => {
    const posted = install((() => Promise.resolve(jsonResponse({}))) as typeof fetch);
    handle!.setPaused(true);
    await win.fetch("/api/x");
    await flush();
    expect(posted).toEqual([]);
  });

  it("adds under 1 ms p95 of synchronous overhead", async () => {
    install((() => Promise.resolve(jsonResponse({ ok: true }))) as typeof fetch);
    for (let i = 0; i < 200; i++) await win.fetch("/api/probe/json", { method: "POST", body: '{"a":1}' });
    const perf = handle!.perf();
    expect(perf.n).toBe(200);
    expect(perf.p95).toBeLessThan(1);
  });
});

describe("XHR wrapper", () => {
  class FakeXhr extends EventTarget {
    status = 0;
    responseType: XMLHttpRequestResponseType = "";
    responseText = "";
    response: unknown = null;
    onload: (() => void) | null = null;
    open(_m: string, _u: string) {}
    setRequestHeader(_n: string, _v: string) {}
    send(_b?: unknown) {
      setTimeout(() => {
        this.status = 200;
        this.responseText = '{"ok":true}';
        this.onload?.();
        this.dispatchEvent(new Event("loadend"));
      }, 0);
    }
  }

  it("observes via loadend, leaves the page's onload intact, and posts initiator xhr", async () => {
    win.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const posted = install(realFetch);
    const xhr = new win.XMLHttpRequest();
    const onload = vi.fn();
    xhr.onload = onload;
    xhr.open("POST", "/api/invoices");
    xhr.setRequestHeader("Authorization", "Bearer demo");
    xhr.send('{"customer":"Acme"}');
    await flush();
    expect(onload).toHaveBeenCalledTimes(1);
    expect(starts(posted)[0]).toMatchObject({
      initiator: "xhr",
      method: "POST",
      headers: { authorization: "Bearer demo" },
      body: { kind: "text", text: '{"customer":"Acme"}' },
    });
    expect(ends(posted)[0]).toMatchObject({ status: 200, body: { kind: "text", text: '{"ok":true}' } });
  });
});

describe("navigation", () => {
  it("posts hook:nav on pushState, replaceState and popstate", () => {
    const posted = install(realFetch);
    win.history.pushState(null, "", "/invoices");
    win.history.replaceState(null, "", "/invoices/new");
    win.dispatchEvent(new PopStateEvent("popstate"));
    expect(posted.filter((m) => m.kind === "hook:nav")).toHaveLength(3);
  });
});
