import assert from "node:assert/strict";
import { test } from "node:test";
import type { AltFormPlan, TestExecution } from "@valt/shared";
import { createStore, emptyState, knowledgeKey, trimToFit, type AreaLike } from "./store.ts";

function memArea(): AreaLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys) {
      const ks = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(ks.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    },
  };
}

test("write-through then restore yields the same snapshot", async () => {
  const sessionArea = memArea();
  const localArea = memArea();
  const a = createStore({ sessionArea, localArea, debounceMs: 1 });
  a.replace({ ...emptyState("s1"), origin: "http://localhost:4173", status: "live" });
  a.update((s) => {
    s.activity.push({ id: "1", ts: 1, level: "info", text: "Discovered Dashboard" });
  });
  await a.flush();
  const b = createStore({ sessionArea, localArea });
  await b.restore();
  assert.deepEqual(b.snapshot(), a.snapshot());
  assert.equal(b.state.status, "live");
});

test("settings default to safe values and clamp", async () => {
  const s = createStore({ sessionArea: memArea(), localArea: memArea() });
  assert.equal((await s.getSettings()).allowDestructive, false);
  assert.equal((await s.setSettings({ maxCasesPerForm: 999 })).maxCasesPerForm, 200);
});

test("plan cache is an LRU capped at 200", async () => {
  const localArea = memArea();
  const s = createStore({ sessionArea: memArea(), localArea });
  const plan = { purpose: "p", category: "other", destructive: false, fields: [], context_cases: [] } as AltFormPlan;
  for (let i = 0; i <= 200; i++) await s.putPlan("http://o", `sig${i}`, plan);
  assert.equal(await s.getPlan("http://o", "sig0"), null);
  assert.ok(await s.getPlan("http://o", "sig200"));
  const kn = localArea.data[knowledgeKey("http://o")] as { order: string[] };
  assert.equal(kn.order.length, 200);
});

test("oversize sessions are trimmed below the cap", () => {
  const big = "x".repeat(20_000);
  const exec = (i: number) => ({ id: String(i), caseId: String(i), result: { status: "pass", reason: big } }) as unknown as TestExecution;
  const s = { ...emptyState("s"), executions: Array.from({ length: 200 }, (_, i) => exec(i)) };
  const trimmed = trimToFit(s, 500_000);
  assert.ok(JSON.stringify(trimmed).length < 500_000);
  assert.ok(trimmed.executions.length < 200);
  assert.equal(trimmed.executions.at(-1)?.id, "199", "keeps the newest");
});
