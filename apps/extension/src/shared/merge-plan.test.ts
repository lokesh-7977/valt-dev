import assert from "node:assert/strict";
import { test } from "node:test";
import type { AltFormPlan } from "@valt/shared";
import { planCases } from "./datagen.ts";
import { field, invoiceForm } from "./fixtures.ts";
import { buildDescriptor, isFormPlan, mergePlan } from "./merge-plan.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

const page = { url: "http://localhost:4173/invoices/new", title: "New invoice", headings: ["Create invoice"], nav: ["Dashboard", "Invoices"] };
const pctx = { today: "2026-09-26", runSeed: "r1" };

function plan(over: Partial<AltFormPlan> = {}): AltFormPlan {
  return {
    purpose: "Create invoice",
    category: "create",
    destructive: false,
    fields: [
      { key: "customerId", semantic: "select_entity", happy_value: "cust_101", unique: false },
      { key: "quantity", semantic: "quantity", happy_value: "7", unique: false },
      { key: "notes", semantic: "description", happy_value: "Net 30. Thank you!", unique: false },
      { key: "ghost", semantic: "email", happy_value: "x@y.z", unique: true },
    ],
    context_cases: [
      { title: "Due date before invoice date", rationale: "Due must follow issue", expect: "reject", field_key: "dueDate", overrides: [{ key: "dueDate", value: "2026-09-20" }, { key: "evil", value: "1" }] },
      { title: "Only unknown overrides", rationale: "", expect: "reject", field_key: null, overrides: [{ key: "nope", value: "1" }] },
    ],
    ...over,
  };
}

test("merges valid values, ignores unknown keys and constraint-breaking values", () => {
  const form = invoiceForm();
  const cases = planCases(form, DEFAULT_SETTINGS, pctx);
  const r = mergePlan(form, cases, plan(), DEFAULT_SETTINGS);
  assert.equal(r.form.enrichment, "gemini");
  assert.ok(!r.form.fields.some((f) => f.key === "ghost"));
  // "cust_101" is not a real option → heuristic value kept.
  const happy = r.cases.find((c) => c.kind === "happy")!;
  assert.equal(happy.values.customerId, "1");
  assert.equal(happy.values.quantity, "7");
  assert.equal(happy.values.notes, "Net 30. Thank you!");
  // The negative-quantity case keeps its mutation.
  assert.equal(r.cases.find((c) => c.kind === "negative" && c.fieldKey === "quantity")!.values.quantity, "-5");
  const ctx = r.cases.find((c) => c.kind === "context")!;
  assert.equal(ctx.source, "gemini");
  assert.equal(ctx.values.dueDate, "2026-09-20");
  assert.ok(!("evil" in ctx.values));
  assert.equal(r.cases.filter((c) => c.kind === "context").length, 1);
});

test("the model can raise but never clear the destructive flag", () => {
  const form = invoiceForm({ destructive: true, destructiveReason: "deletes data" });
  const r = mergePlan(form, [], plan({ destructive: false }), DEFAULT_SETTINGS);
  assert.equal(r.form.destructive, true);
  const r2 = mergePlan(invoiceForm(), planCases(invoiceForm(), DEFAULT_SETTINGS, pctx), plan({ destructive: true }), DEFAULT_SETTINGS);
  assert.equal(r2.form.destructive, true);
  assert.ok(r2.cases.every((c) => c.kind === "reload_after_fill" || c.kind === "keyboard_navigation"));
});

test("executed cases are never rewritten", () => {
  const form = invoiceForm();
  const cases = planCases(form, DEFAULT_SETTINGS, pctx);
  const happy = cases[0]!;
  const r = mergePlan(form, cases, plan(), DEFAULT_SETTINGS, new Set([happy.id]));
  assert.deepEqual(r.cases.find((c) => c.id === happy.id), happy);
});

test("descriptor stays small for big forms", () => {
  const big = invoiceForm({
    fields: Array.from({ length: 60 }, (_, i) =>
      field({ key: `f${i}`, label: "L".repeat(500), context: "C".repeat(1000), options: Array.from({ length: 80 }, (_, j) => ({ value: `v${j}`, label: `Option ${j}` })) }),
    ),
  });
  assert.ok(JSON.stringify(buildDescriptor(page, big)).length < 16_000);
  assert.ok(JSON.stringify(buildDescriptor(page, invoiceForm())).length < 16_000);
});

test("shape guard", () => {
  assert.equal(isFormPlan(plan()), true);
  assert.equal(isFormPlan({ fields: [{ nokey: 1 }] }), false);
  assert.equal(isFormPlan("x"), false);
});
