import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyDestructive } from "./safety.ts";

test("flags destructive labels with a reason", () => {
  for (const text of ["Delete account", "Pay now", "Refund", "Sign out", "Send invite", "Log out", "Remove"]) {
    const v = classifyDestructive({ text });
    assert.equal(v.destructive, true, text);
    assert.ok(v.reason, text);
  }
});

test("leaves ordinary actions alone", () => {
  for (const text of ["Save", "Search", "New customer", "Edit", "Save invoice and continue", "View reports", "Next"]) {
    assert.equal(classifyDestructive({ text }).destructive, false, text);
  }
});

test("uses ids, urls, methods and context", () => {
  assert.equal(classifyDestructive({ id: "deleteAccount" }).destructive, true);
  assert.equal(classifyDestructive({ text: "Go", href: "/logout" }).destructive, true);
  assert.equal(classifyDestructive({ text: "OK", formAction: "/api/invoices/3/delete" }).destructive, true);
  assert.equal(classifyDestructive({ text: "Confirm", method: "delete" }).destructive, true);
  assert.equal(classifyDestructive({ text: "Confirm", context: "Danger zone" }).destructive, true);
  assert.equal(classifyDestructive({ text: "Open", href: "/customers/2" }).destructive, false);
});
