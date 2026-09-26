import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyOutcome, judge, type OutcomeEvidence } from "./outcome.ts";

const U = "http://localhost:4173/invoices/new";
const base: OutcomeEvidence = {
  clientInvalid: false,
  validationMessages: [],
  messages: [],
  urlBefore: U,
  urlAfter: U,
  formReset: false,
  mutatingRequests: [],
  consoleErrors: [],
};
const post = (status: number) => [{ method: "POST", url: "http://localhost:4173/api/invoices", status }];

test("negative quantity accepted with 201 + success toast is unexpected", () => {
  const out = classifyOutcome({ ...base, mutatingRequests: post(201), messages: [{ text: "Invoice saved successfully", tone: "success" }], formReset: true });
  assert.equal(out, "accepted");
  assert.equal(judge({ expectation: "reject", kind: "negative", title: "" }, out).status, "unexpected");
});

test("native invalid without a request is a client rejection → pass for required_empty", () => {
  const out = classifyOutcome({ ...base, clientInvalid: true });
  assert.equal(out, "rejected_client");
  assert.equal(judge({ expectation: "reject", kind: "required_empty", title: "" }, out).status, "pass");
});

test("inline field errors without a request are a client rejection", () => {
  const out = classifyOutcome({ ...base, validationMessages: [{ fieldKey: "q", message: "Quantity is required", source: "text" }] });
  assert.equal(out, "rejected_client");
});

test("4xx and error toast is a server rejection; accepting valid data would then be unexpected", () => {
  const out = classifyOutcome({ ...base, mutatingRequests: post(422), messages: [{ text: "Due date must be after", tone: "error" }] });
  assert.equal(out, "rejected_server");
  assert.equal(judge({ expectation: "reject", kind: "invalid_date", title: "" }, out).status, "pass");
  assert.equal(judge({ expectation: "accept", kind: "happy", title: "" }, out).status, "unexpected");
});

test("5xx is always unexpected", () => {
  const out = classifyOutcome({ ...base, mutatingRequests: post(500) });
  assert.equal(out, "server_error");
  for (const expectation of ["accept", "reject", "observe"] as const) {
    assert.equal(judge({ expectation, kind: "sql_injection", title: "" }, out).status, "unexpected");
  }
});

test("classic form post that redirects counts as navigated/accepted", () => {
  const out = classifyOutcome({ ...base, mutatingRequests: post(303), urlAfter: "http://localhost:4173/products?created=1" });
  assert.equal(out, "navigated");
  assert.equal(judge({ expectation: "accept", kind: "happy", title: "" }, out).status, "pass");
});

test("nothing happened → inconclusive; blocked → skipped", () => {
  const out = classifyOutcome(base);
  assert.equal(out, "no_response");
  assert.equal(judge({ expectation: "reject", kind: "negative", title: "" }, out).status, "inconclusive");
  assert.equal(judge({ expectation: "observe", kind: "reload_after_fill", title: "" }, out).status, "pass");
  const blocked = classifyOutcome({ ...base, blockedUnsafe: true });
  assert.equal(judge({ expectation: "accept", kind: "happy", title: "" }, blocked).status, "skipped");
});

test("observe cases flag console errors", () => {
  const r = judge({ expectation: "observe", kind: "back_after_submit", title: "" }, "navigated", {
    consoleErrors: [{ ts: 1, tabId: 1, kind: "console_error", message: "boom", stack: null, url: U }],
  });
  assert.equal(r.status, "unexpected");
});

test("failed network (status 0) with no feedback is no_response", () => {
  assert.equal(classifyOutcome({ ...base, mutatingRequests: post(0) }), "no_response");
});
