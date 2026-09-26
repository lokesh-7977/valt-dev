import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings.ts";

test("destructive actions are off by default", () => {
  assert.equal(DEFAULT_SETTINGS.allowDestructive, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).allowDestructive, false);
});

test("clamps limits and trims the api url", () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { maxCasesPerForm: 999, maxDepth: 0, paceMs: -5, apiBaseUrl: "http://x/" });
  assert.equal(s.maxCasesPerForm, 200);
  assert.equal(s.maxDepth, 1);
  assert.equal(s.paceMs, 0);
  assert.equal(s.apiBaseUrl, "http://x");
});

test("dedupes origins", () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { enabledOrigins: ["http://a", "http://a", "http://b"] });
  assert.deepEqual(s.enabledOrigins, ["http://a", "http://b"]);
});
