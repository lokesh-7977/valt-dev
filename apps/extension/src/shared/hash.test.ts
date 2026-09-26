import assert from "node:assert/strict";
import { test } from "node:test";
import { fnv1a, stableId } from "./hash.ts";

test("fnv1a matches reference vectors", () => {
  assert.equal(fnv1a(""), "811c9dc5");
  assert.equal(fnv1a("a"), "e40c292c");
  assert.equal(fnv1a("foobar"), "bf9cf968");
});

test("stableId separates parts", () => {
  assert.notEqual(stableId("a", "bc"), stableId("ab", "c"));
  assert.equal(stableId("x", 1, null), stableId("x", "1", ""));
});
