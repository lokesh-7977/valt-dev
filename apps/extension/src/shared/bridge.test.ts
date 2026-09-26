import { describe, expect, it } from "vitest";
import { checkLabel } from "../ui/checks";
import { isCsMessage, isHookMessage } from "./bridge";

const start = {
  source: "alt-hook",
  kind: "hook:req_start",
  reqId: "r1",
  method: "POST",
  url: "http://localhost:5180/api/invoices",
  headers: { "content-type": "application/json" },
  body: { kind: "text", text: "{}", bytes: 2, cut: false },
  initiator: "fetch",
  t: 1,
};

describe("bridge guards", () => {
  it("accepts well-formed hook messages", () => {
    expect(isHookMessage(start)).toBe(true);
    expect(
      isHookMessage({ source: "alt-hook", kind: "hook:req_end", reqId: "r1", status: 0, body: null, durationMs: 3, t: 2 }),
    ).toBe(true);
    expect(isHookMessage({ source: "alt-hook", kind: "hook:nav", url: "http://localhost/x" })).toBe(true);
    expect(isHookMessage({ ...start, body: { kind: "form", fields: { a: "b" } } })).toBe(true);
  });

  it("rejects a foreign source", () => {
    expect(isHookMessage({ ...start, source: "evil-page" })).toBe(false);
    expect(isHookMessage({ ...start, source: "alt-cs" })).toBe(false);
  });

  it("rejects junk", () => {
    expect(isHookMessage(null)).toBe(false);
    expect(isHookMessage("alt-hook")).toBe(false);
    expect(isHookMessage({ ...start, kind: "hook:unknown" })).toBe(false);
    expect(isHookMessage({ ...start, headers: { a: 1 } })).toBe(false);
    expect(isHookMessage({ ...start, initiator: "beacon" })).toBe(false);
    expect(isHookMessage({ ...start, body: { kind: "text", text: 5 } })).toBe(false);
    expect(isHookMessage({ ...start, t: Number.NaN })).toBe(false);
  });

  it("validates content-script messages", () => {
    expect(isCsMessage({ source: "alt-cs", kind: "cs:mode", mode: "paused" })).toBe(true);
    expect(isCsMessage({ source: "alt-cs", kind: "cs:mode", mode: "off" })).toBe(false);
    expect(isCsMessage({ source: "alt-hook", kind: "cs:mode", mode: "live" })).toBe(false);
  });
});

describe("checkLabel", () => {
  it("names known checks and passes unknown codes through", () => {
    expect(checkLabel("C2")).toBe("C2 Value changed in transit");
    expect(checkLabel("C99")).toBe("C99");
    expect(checkLabel(undefined)).toBe("");
  });
});
