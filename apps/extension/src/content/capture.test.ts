import { CapturedSubmitPayloadSchema } from "@valt/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChrome } from "../../test/chrome-fake";
import type { HookReqEnd, HookReqStart } from "../shared/bridge";
import type { CsSubmit } from "../shared/runtime-messages";
import { CapturePipeline } from "./capture";
import { buildSelector, resolveLabel } from "./scrape";

const FORM = `
  <form data-testid="invoice-form">
    <label for="customer"><span>Customer</span><input id="customer" name="customer" data-testid="customer" value="Acme"></label>
    <label for="discount"><span>Discount %</span><input id="discount" name="discount" type="number" data-testid="discount" value="10"></label>
    <label for="card_number"><span>Card number</span><input id="card_number" name="card_number" data-testid="card_number" value="4111111111111111"></label>
    <output data-testid="total">270.00</output>
    <button type="submit" data-testid="submit">Submit</button>
  </form>
  <div role="status" data-testid="toast"></div>`;

let sent: CsSubmit[];
let pipeline: CapturePipeline;
let detach: () => void;
let reqSeq = 0;

const start = (over: Partial<HookReqStart> = {}): HookReqStart => ({
  source: "alt-hook",
  kind: "hook:req_start",
  reqId: `r${++reqSeq}`,
  method: "POST",
  url: "http://localhost:5180/api/invoices",
  headers: { "content-type": "application/json", authorization: "Bearer demo" },
  body: { kind: "text", text: '{"customer":"Acme","card_number":"4111111111111111"}', bytes: 50, cut: false },
  initiator: "fetch",
  t: Date.now(),
  ...over,
});
const end = (s: HookReqStart, over: Partial<HookReqEnd> = {}): HookReqEnd => ({
  source: "alt-hook",
  kind: "hook:req_end",
  reqId: s.reqId,
  status: 201,
  body: { kind: "text", text: '{"id":"inv_1","total":300}', bytes: 26, cut: false },
  durationMs: 40,
  t: Date.now(),
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-09-26T10:00:00Z") });
  document.body.innerHTML = FORM;
  sent = [];
  pipeline = new CapturePipeline({ doc: document, send: (m) => sent.push(m) });
  detach = pipeline.attach();
});

afterEach(() => {
  detach();
  vi.useRealTimers();
});

const submitForm = () =>
  document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

describe("capture pipeline", () => {
  it("native submit + one POST → exactly one valid, redacted cs:submit", () => {
    submitForm();
    const s = start();
    pipeline.onReqStart(s);
    vi.advanceTimersByTime(40);
    (document.querySelector("[role=status]") as HTMLElement).textContent = "Saved invoice";
    pipeline.onReqEnd(end(s));
    vi.advanceTimersByTime(799);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    const payload = sent[0]!.payload;
    expect(CapturedSubmitPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.form.selector).toBe('[data-testid="invoice-form"]');
    expect(payload.requests[0]!.reqHeaders.authorization).toBe("[redacted]");
    expect(payload.requests[0]!.reqBody).toEqual({ customer: "Acme", card_number: "[redacted]" });
    expect(payload.form.fields.find((f) => f.name === "card_number")!.value).toBe("[redacted]");
    expect(payload.form.fields.find((f) => f.name === "discount")).toMatchObject({
      label: "Discount %",
      type: "number",
      value: "10",
      selector: "[data-testid=discount]",
    });
    expect(payload.form.fields.find((f) => f.type === "output")).toMatchObject({ name: "total", value: "270.00" });
    expect(payload.uiAfter.toasts).toEqual(["Saved invoice"]);
    expect(payload.route).toBe(location.pathname);
  });

  it("SPA Save outside a form → one submit scoped to the data-testid container or body", () => {
    document.body.innerHTML = `<div data-testid="quick"><input name="qty" value="2"><button type="button">Save</button></div>`;
    (document.querySelector("button") as HTMLButtonElement).click();
    const s = start();
    pipeline.onReqStart(s);
    pipeline.onReqEnd(end(s));
    vi.advanceTimersByTime(800);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.form.selector).toBe("[data-testid=quick]");
    expect(sent[0]!.payload.form.fields.map((f) => f.name)).toEqual(["qty"]);
  });

  it("two requests 300 ms apart → one submit with both, ≥ 800 ms after the last end", () => {
    submitForm();
    const a = start();
    pipeline.onReqStart(a);
    vi.advanceTimersByTime(100);
    pipeline.onReqEnd(end(a));
    vi.advanceTimersByTime(200);
    const b = start({ method: "PUT" });
    pipeline.onReqStart(b);
    vi.advanceTimersByTime(50);
    pipeline.onReqEnd(end(b));
    vi.advanceTimersByTime(799);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.requests.map((r) => r.method)).toEqual(["POST", "PUT"]);
  });

  it("excludes /@vite/client and helper traffic from the window", () => {
    submitForm();
    const vite = start({ method: "GET", url: "http://localhost:5180/@vite/client" });
    const helper = start({ url: "http://127.0.0.1:7777/assets/x.png", method: "GET" });
    const post = start();
    [vite, helper, post].forEach((s) => pipeline.onReqStart(s));
    [vite, helper, post].forEach((s) => pipeline.onReqEnd(end(s)));
    vi.advanceTimersByTime(800);
    expect(sent[0]!.payload.requests).toHaveLength(1);
    expect(sent[0]!.payload.requests[0]!.url).toBe("http://localhost:5180/api/invoices");
  });

  it("sends nothing while paused", () => {
    pipeline.paused = true;
    submitForm();
    const s = start();
    pipeline.onReqStart(s);
    pipeline.onReqEnd(end(s));
    vi.advanceTimersByTime(3000);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for a trigger with no correlated requests", () => {
    submitForm();
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(0);
  });

  it("truncates a large response to the protocol marker", () => {
    submitForm();
    const s = start();
    pipeline.onReqStart(s);
    pipeline.onReqEnd(end(s, { body: { kind: "text", text: "x".repeat(65536), bytes: 71680, cut: true } }));
    vi.advanceTimersByTime(800);
    expect(String(sent[0]!.payload.requests[0]!.resBody).endsWith("…[truncated: 71680 bytes]")).toBe(true);
  });
});

describe("content script wiring", () => {
  it("ignores spoofed bridge messages and sends keepalive every 20 s", async () => {
    const { startContent } = await import("./index");
    const chrome = fakeChrome();
    const got: unknown[] = [];
    chrome.runtime.onMessage.addListener((m: never) => void got.push(m));
    startContent();
    // A page script posting a fake hook message with the wrong source is ignored.
    window.dispatchEvent(new MessageEvent("message", { data: { source: "evil", kind: "hook:nav", url: "x" }, source: window }));
    await vi.advanceTimersByTimeAsync(0);
    const kinds = () => got.map((m) => (m as { kind: string }).kind);
    expect(kinds()).toEqual(["cs:hello"]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(kinds().filter((k) => k === "cs:keepalive")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(kinds().filter((k) => k === "cs:keepalive")).toHaveLength(2);
  });
});

describe("selectors and labels", () => {
  it("prefers data-testid, then non-generated id, then name, then a short path", () => {
    document.body.innerHTML = `
      <input data-testid="a"><input id="stable"><input id=":r12:" name="n1"><div><span></span><span></span></div>`;
    const [a, b, c] = document.querySelectorAll("input");
    expect(buildSelector(a!)).toBe("[data-testid=a]");
    expect(buildSelector(b!)).toBe("#stable");
    expect(buildSelector(c!)).toBe("input[name=n1]");
    expect(buildSelector(document.querySelectorAll("span")[1]!)).toBe("body > div > span:nth-of-type(2)");
  });

  it("resolves labels from for=, aria-label, wrapping label, and preceding text", () => {
    document.body.innerHTML = `
      <label for="x">Email</label><input id="x">
      <input aria-label="Phone">
      <label>Zip <input></label>
      <div><span>City</span><input></div>`;
    const inputs = document.querySelectorAll("input");
    expect([...inputs].map(resolveLabel)).toEqual(["Email", "Phone", "Zip", "City"]);
  });
});
