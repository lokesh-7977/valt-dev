import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, happyValue, planCases, sampleFromPattern } from "./datagen.ts";
import { field, invoiceForm } from "./fixtures.ts";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings.ts";

const ctx = { today: "2026-09-26", seed: "s", seq: 0, locale: "IN" as const };

test("happy values honour constraints", () => {
  const q = Number(happyValue(field({ key: "q", type: "number", min: "1", max: "1000", step: "1", semantic: "quantity" }), ctx));
  assert.ok(Number.isInteger(q) && q >= 1 && q <= 1000);
  assert.ok(happyValue(field({ key: "t", maxLength: 5, semantic: "company" }), ctx).length <= 5);
  const sel = field({
    key: "c",
    tag: "select",
    semantic: "select_entity",
    options: [
      { value: "", label: "Select…" },
      { value: "7", label: "Acme" },
    ],
  });
  assert.equal(happyValue(sel, ctx), "7");
  assert.equal(happyValue(field({ key: "d", type: "date", label: "Invoice date", semantic: "date" }), ctx), "2026-09-26");
  assert.ok(happyValue(field({ key: "due", type: "date", label: "Due date", semantic: "date" }), ctx) > "2026-09-26");
  assert.match(happyValue(field({ key: "e", type: "email", semantic: "email" }), ctx), /@example\.com$/);
  const pat = field({ key: "p", pattern: "[A-Z]{3}-\\d{4}", semantic: "identifier" });
  assert.match(happyValue(pat, ctx), /^[A-Z]{3}-\d{4}$/);
  const gst = field({ key: "g", semantic: "gstin", pattern: "[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}" });
  assert.match(happyValue(gst, ctx), /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);
  const u = field({ key: "n", semantic: "identifier", unique: true, placeholder: "INV-0001" });
  const a = happyValue(u, ctx);
  assert.match(a, /^INV-\d{4}$/);
  assert.notEqual(a, happyValue(u, { ...ctx, seq: 1 }));
});

test("pattern sampler", () => {
  assert.match(sampleFromPattern("\\d{6}") ?? "", /^\d{6}$/);
  assert.equal(sampleFromPattern("(a|b)"), null);
  assert.equal(addDays("2026-09-26", 30), "2026-10-26");
});

test("planCases: prioritised, bounded, deduped", () => {
  const settings = mergeSettings(DEFAULT_SETTINGS, { maxCasesPerForm: 12 });
  const cases = planCases(invoiceForm(), settings, { today: "2026-09-26", runSeed: "r1" });
  assert.equal(cases[0]?.kind, "happy");
  assert.equal(cases[0]?.expectation, "accept");
  assert.ok(cases.length <= 12);
  const neg = cases.find((c) => c.kind === "negative" && c.fieldKey === "quantity");
  assert.ok(neg, "negative quantity within the first 12");
  assert.equal(neg.expectation, "reject");
  assert.equal(neg.values.quantity, "-5");
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
});

test("planCases: full plan covers the spec's case families", () => {
  const cases = planCases(invoiceForm(), DEFAULT_SETTINGS, { today: "2026-09-26", runSeed: "r1" });
  const kinds = new Set(cases.map((c) => c.kind));
  for (const k of ["required_empty", "below_min", "above_max", "decimal_for_integer", "duplicate", "double_submit", "keyboard_navigation", "invalid_date", "unicode", "sql_injection"]) {
    assert.ok(kinds.has(k as never), k);
  }
  assert.ok(!cases.some((c) => c.kind === "wrong_type" && c.fieldKey === "quantity"), "no wrong_type on type=number");
  const specialFields = new Set(cases.filter((c) => c.category === "special").map((c) => c.fieldKey));
  assert.ok(specialFields.size <= 2);
  // Each submitting case gets its own invoice number, except the deliberate duplicate.
  const happy = cases.find((c) => c.kind === "happy")!;
  const dup = cases.find((c) => c.kind === "duplicate")!;
  const neg = cases.find((c) => c.kind === "negative")!;
  assert.equal(dup.values.invoiceNumber, happy.values.invoiceNumber);
  assert.notEqual(neg.values.invoiceNumber, happy.values.invoiceNumber);
  const due = cases.find((c) => c.kind === "invalid_date" && c.fieldKey === "dueDate")!;
  assert.ok(due.values.dueDate! < due.values.invoiceDate!);
});

test("planCases: destructive forms yield no submitting case by default", () => {
  const form = invoiceForm({ destructive: true, destructiveReason: "deletes data" });
  const cases = planCases(form, DEFAULT_SETTINGS, { today: "2026-09-26", runSeed: "r1" });
  assert.ok(cases.length > 0);
  assert.ok(cases.every((c) => c.kind === "reload_after_fill" || c.kind === "keyboard_navigation"));
  const allowed = planCases(form, mergeSettings(DEFAULT_SETTINGS, { allowDestructive: true }), { today: "2026-09-26", runSeed: "r1" });
  assert.equal(allowed[0]?.kind, "happy");
});
