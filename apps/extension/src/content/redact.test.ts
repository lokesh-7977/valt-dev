import { describe, expect, it } from "vitest";
import { redactBody, redactField, redactHeaders, redactRaw, redactUrl, toBody } from "./redact";

const SECRETS = ["password", "newPass", "api_token", "clientSecret", "otpCode", "cvv", "card_number"];
const PLAIN = { customer: "Acme", discount: 10, quantity: 3 };

describe("redactHeaders", () => {
  it.each(["Authorization", "authorization", "COOKIE", "X-Api-Key", "x-api-key"])("redacts %s", (h) => {
    expect(redactHeaders({ [h]: "secret", "content-type": "application/json" })).toEqual({
      [h]: "[redacted]",
      "content-type": "application/json",
    });
  });
});

describe("redactBody (JSON)", () => {
  it.each(SECRETS)("redacts %s and leaves plain fields", (key) => {
    expect(redactBody({ ...PLAIN, [key]: "s3cr3t" })).toEqual({ ...PLAIN, [key]: "[redacted]" });
  });

  it("handles nested objects and arrays", () => {
    expect(redactBody({ lines: [{ sku: "A", card: "4111" }], auth: { token: "t", user: "u" } })).toEqual({
      lines: [{ sku: "A", card: "[redacted]" }],
      auth: { token: "[redacted]", user: "u" },
    });
  });
});

describe("form-encoded and raw text", () => {
  it.each(SECRETS)("redacts %s in a form snapshot", (key) => {
    expect(toBody({ kind: "form", fields: { customer: "Acme", [key]: "s3cr3t" } })).toEqual({
      customer: "Acme",
      [key]: "[redacted]",
    });
  });

  it.each(SECRETS)("redacts %s in a urlencoded string", (key) => {
    const out = redactRaw(`customer=Acme&${key}=s3cr3t&discount=10`);
    expect(out).toContain("customer=Acme");
    expect(out).toContain("discount=10");
    expect(out).not.toContain("s3cr3t");
  });

  it.each(SECRETS)("redacts %s in a cut raw JSON prefix", (key) => {
    const out = toBody({ kind: "text", text: `{"customer":"Acme","${key}":"s3cr3t","notes":"xx`, bytes: 99999, cut: true });
    expect(out).toContain('"customer":"Acme"');
    expect(out).not.toContain("s3cr3t");
  });

  it("redacts secret query params", () => {
    expect(redactUrl("http://localhost:5180/api?token=abc&page=2")).toBe(
      "http://localhost:5180/api?token=%5Bredacted%5D&page=2",
    );
  });
});

describe("redactField", () => {
  it("redacts password inputs and secret names or labels", () => {
    const base = { name: "x", label: "X", type: "text", value: "v", selector: "#x" };
    expect(redactField({ ...base, type: "password" }).value).toBe("[redacted]");
    expect(redactField({ ...base, name: "card_number" }).value).toBe("[redacted]");
    expect(redactField({ ...base, label: "One-time token" }).value).toBe("[redacted]");
    expect(redactField({ ...base, name: "customer", label: "Customer" }).value).toBe("v");
  });
});

describe("toBody truncation", () => {
  it("turns a cut 70 KB body into a string ending with the marker", () => {
    const text = "x".repeat(65536);
    const out = toBody({ kind: "text", text, bytes: 71680, cut: true }) as string;
    expect(typeof out).toBe("string");
    expect(out.endsWith("…[truncated: 71680 bytes]")).toBe(true);
    expect(out.length).toBe(65536 + "…[truncated: 71680 bytes]".length);
  });

  it("parses and redacts whole JSON bodies", () => {
    expect(toBody({ kind: "text", text: '{"password":"p","customer":"Acme"}', bytes: 34, cut: false })).toEqual({
      password: "[redacted]",
      customer: "Acme",
    });
  });
});
