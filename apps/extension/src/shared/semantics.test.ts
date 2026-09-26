import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyField } from "./semantics.ts";

test("understands common business fields", () => {
  const inv = classifyField({ label: "Invoice number", name: "invoiceNumber", type: "text" });
  assert.equal(inv.semantic, "identifier");
  assert.equal(inv.unique, true);
  assert.equal(classifyField({ label: "Qty", type: "number" }).semantic, "quantity");
  assert.equal(classifyField({ label: "Unit price (₹)", name: "unitPrice", type: "number" }).semantic, "currency_amount");
  assert.equal(classifyField({ label: "GSTIN", type: "text" }).semantic, "gstin");
  assert.equal(classifyField({ label: "PAN", type: "text" }).semantic, "pan");
  assert.equal(classifyField({ label: "Contact", type: "email" }).semantic, "email");
  assert.equal(classifyField({ label: "Reach me", autocomplete: "tel" }).semantic, "phone");
  assert.equal(
    classifyField({ label: "Customer", tag: "select", options: [{ value: "1", label: "Acme" }] }).semantic,
    "select_entity",
  );
  assert.equal(classifyField({ label: "Discount (%)", type: "number" }).semantic, "percentage");
  assert.equal(classifyField({ label: "Invoice date", type: "date" }).semantic, "date");
  assert.equal(classifyField({ label: "Date of birth", type: "date" }).semantic, "birth_date");
  assert.equal(classifyField({ label: "Notes", tag: "textarea" }).semantic, "description");
  assert.equal(classifyField({ label: "Stock", type: "number" }).semantic, "integer");
  assert.equal(classifyField({ label: "Name", type: "text" }).semantic, "person_name");
  assert.equal(classifyField({ label: "Company name", type: "text" }).semantic, "company");
  assert.equal(classifyField({ label: "Phone", type: "tel" }).semantic, "phone");
  assert.equal(classifyField({ label: "PIN code", type: "text" }).semantic, "postal_code");
});

test("signup email is unique, contact email is not", () => {
  assert.equal(classifyField({ label: "Email", type: "email", context: "Create account" }).unique, true);
  assert.equal(classifyField({ label: "Email", type: "email", context: "Contact us" }).unique, false);
});
