import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "./bus.ts";

const entry = (text: string) => ({ entry: { id: text, ts: 1, level: "info" as const, text } });

test("typed and wildcard handlers, unsubscribe", () => {
  const bus = createBus({ sessionId: "s1", now: () => 5 });
  const typed: string[] = [];
  const all: string[] = [];
  const off = bus.on("activity", (e) => typed.push(e.payload.entry.text));
  bus.on("*", (e) => all.push(e.type));
  bus.emit("activity", entry("a"));
  bus.emit("session.status", { status: "live" });
  off();
  bus.emit("activity", entry("b"));
  assert.deepEqual(typed, ["a"]);
  assert.deepEqual(all, ["activity", "session.status", "activity"]);
  const [first] = bus.recent();
  assert.equal(first?.sessionId, "s1");
  assert.equal(first?.ts, 5);
});

test("ring buffer is capped", () => {
  const bus = createBus({ sessionId: "s", ringSize: 3 });
  for (let i = 0; i < 5; i++) bus.emit("activity", entry(String(i)));
  assert.deepEqual(
    bus.recent().map((e) => (e.type === "activity" ? e.payload.entry.text : "")),
    ["2", "3", "4"],
  );
});

test("ports get replay then live, and are dropped on disconnect", () => {
  const bus = createBus({ sessionId: "s" });
  bus.emit("activity", entry("old"));
  const got: Array<{ kind: string }> = [];
  let disconnect = () => {};
  bus.attachPort({ postMessage: (m) => got.push(m as { kind: string }), onDisconnect: { addListener: (cb) => (disconnect = cb) } });
  bus.emit("activity", entry("new"));
  disconnect();
  bus.emit("activity", entry("after"));
  assert.deepEqual(got.map((m) => m.kind), ["replay", "event"]);
});

test("a throwing handler does not break emit", () => {
  const bus = createBus({ sessionId: "s" });
  bus.on("*", () => {
    throw new Error("x");
  });
  const orig = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => bus.emit("activity", entry("a")));
  } finally {
    console.warn = orig;
  }
});
