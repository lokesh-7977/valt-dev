import assert from "node:assert/strict";
import { test } from "node:test";
import { createQueue, taskKey, type Task } from "./queue.ts";

const visit = (routeKey: string, depth: number, source: "link" | "developer" = "link"): Task => ({ kind: "visit", url: `http://x${routeKey}`, routeKey, depth, source });
const tst = (caseId: string, routeKey: string, priority: number): Task => ({ kind: "test", caseId, routeKey, priority });

test("discovery before tests, tests by priority, exploration and link checks last", () => {
  const q = createQueue();
  q.push({ kind: "check_links", routeKey: "/", urls: [] });
  q.push({ kind: "explore_actions", routeKey: "/", url: "http://x/" });
  q.push(tst("neg", "/a", 10));
  q.push(tst("happy", "/a", 0));
  q.push(visit("/b", 2));
  q.push(visit("/c", 1));
  assert.deepEqual(
    [...Array(6)].map(() => taskKey(q.pop()!)),
    ["visit:/c", "visit:/b", "test:happy", "test:neg", "explore:/", "links:/"],
  );
  assert.equal(q.pop(), undefined);
});

test("dedupes by key", () => {
  const q = createQueue();
  assert.equal(q.push(visit("/a", 1)), true);
  assert.equal(q.push(visit("/a", 3)), false);
  assert.equal(q.size(), 1);
});

test("boost moves a route's work to the front", () => {
  const q = createQueue();
  q.push(visit("/z", 1));
  q.push(tst("t1", "/a", 5));
  q.push(tst("t2", "/invoices/new", 50));
  q.boost("/invoices/new");
  assert.equal(taskKey(q.pop()!), "test:t2");
  assert.equal(taskKey(q.pop()!), "visit:/z");
});

test("developer visits outrank link visits; removeWhere; round-trip", () => {
  const q = createQueue();
  q.push(visit("/a", 0));
  q.push(visit("/dev", 3, "developer"));
  q.push(tst("t", "/a", 1));
  assert.equal(q.removeWhere((t) => t.kind === "test"), 1);
  const copy = createQueue(q.serialize());
  assert.deepEqual(copy.list(), q.list());
  assert.equal(taskKey(copy.pop()!), "visit:/dev");
});
