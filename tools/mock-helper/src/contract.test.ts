import type { CapturedSubmit } from "@valt/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContract } from "./contract.js";
import { MockHelper } from "./server.js";
import { TestClient } from "./test-client.js";

const submit = (id: string, reqBody: Record<string, unknown>): CapturedSubmit["payload"] => ({
  submitId: id,
  pageUrl: "http://localhost:5180/invoices/new",
  route: "/invoices/new",
  form: {
    selector: "form[data-testid=invoice-form]",
    fields: [
      { name: "customer", label: "Customer", type: "text", value: "Acme", selector: "[data-testid=customer]" },
      { name: "quantity", label: "Quantity", type: "number", value: "3", selector: "[data-testid=quantity]" },
      { name: "discount", label: "Discount %", type: "number", value: "10", selector: "[data-testid=discount]" },
    ],
  },
  requests: [
    {
      reqId: "r1",
      method: "POST",
      url: "http://localhost:5180/api/invoices",
      status: 201,
      reqHeaders: {},
      reqBody,
      resBody: { id: "inv_1", ...reqBody },
      durationMs: 10,
      initiator: "fetch",
    },
  ],
  uiAfter: { toasts: ["Saved invoice"], fieldErrors: [], url: "http://localhost:5180/invoices/new" },
});

describe("buildContract", () => {
  it("flags a dropped field as C1 and anchors the bug there", () => {
    const { rows, bug } = buildContract(submit("s1", { customer: "Acme", quantity: 3 }));
    expect(rows.find((r) => r.field === "discount")).toMatchObject({ ok: false, code: "C1" });
    expect(rows.find((r) => r.field === "customer")).toMatchObject({ ok: true });
    expect(bug).toMatchObject({ layer: "ui_api", checkCode: "C1", anchor: { selector: "[data-testid=discount]" } });
    expect(bug?.evidence.highlightKeys).toEqual(["discount"]);
  });

  it("flags a number sent as a string as C2", () => {
    const { rows } = buildContract(submit("s2", { customer: "Acme", quantity: "3", discount: 10 }));
    expect(rows.find((r) => r.field === "quantity")).toMatchObject({ ok: false, code: "C2" });
    expect(rows.find((r) => r.field === "discount")).toMatchObject({ ok: true });
  });

  it("adds a C4 status row when the server failed but the toast says saved", () => {
    const s = submit("s3", { customer: "Acme", quantity: 3, discount: 10 });
    s.requests[0]!.status = 500;
    const { rows, bug } = buildContract(s);
    expect(rows.at(-1)).toMatchObject({ field: "status", ok: false, code: "C4", responseValue: "500" });
    expect(bug?.checkCode).toBe("C4");
  });
});

describe("captured_submit over the socket", () => {
  let helper: MockHelper;
  let client: TestClient;

  beforeEach(async () => {
    helper = new MockHelper({ port: 0 });
    helper.config.activity = false;
    client = await TestClient.open(await helper.start());
    client.hello();
    await client.waitFor(() => client.of("welcome").length === 1);
  });

  afterEach(async () => {
    client.close();
    await helper.stop();
  });

  it("emits one bug_found then a contract_result listing it", async () => {
    client.send("captured_submit", submit("s1", { customer: "Acme", quantity: 3 }));
    await client.waitFor(() => client.of("contract_result").length === 1);
    expect(client.of("bug_found")).toHaveLength(1);
    const bug = client.of("bug_found")[0]!.payload;
    expect(bug.anchor).toEqual({ selector: "[data-testid=discount]" });
    expect(client.of("contract_result")[0]!.payload.bugIds).toEqual([bug.bugId]);
    expect(client.invalid).toEqual([]);
  });

  it("dedupes a resent submitId", async () => {
    client.send("captured_submit", submit("dup", { customer: "Acme", quantity: 3 }));
    client.send("captured_submit", submit("dup", { customer: "Acme", quantity: 3 }));
    await new Promise((r) => setTimeout(r, 200));
    expect(client.of("contract_result")).toHaveLength(1);
  });
});
