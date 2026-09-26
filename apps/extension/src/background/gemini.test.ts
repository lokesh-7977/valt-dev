import assert from "node:assert/strict";
import { test } from "node:test";
import type { AltFormDescriptor, AltFormPlan } from "@valt/shared";
import { createGemini, type PlanCache } from "./gemini.ts";

const plan: AltFormPlan = { purpose: "Create invoice", category: "create", destructive: false, fields: [{ key: "q", semantic: "quantity", happy_value: "5", unique: false }], context_cases: [] };
const desc = { page: { url: "u", title: "t", headings: [], nav: [] }, form: { id: "f", submit_label: null, fields: [] } } as AltFormDescriptor;
const on = { apiBaseUrl: "http://api", useGemini: true };

function memCache(): PlanCache {
  const m = new Map<string, AltFormPlan>();
  return {
    getPlan: async (o, s) => m.get(`${o}|${s}`) ?? null,
    putPlan: async (o, s, p) => void m.set(`${o}|${s}`, p),
  };
}

function reply(status: number, body: unknown) {
  return async () => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
}

test("success is cached: second call makes no request", async () => {
  let calls = 0;
  const g = createGemini({ cache: memCache(), fetch: async () => (calls++, reply(200, { success: true, data: { output: plan } })()) });
  assert.deepEqual(await g.planForm("o", "sig", desc, on), plan);
  assert.deepEqual(await g.planForm("o", "sig", desc, on), plan);
  assert.equal(calls, 1);
  assert.equal(g.status().state, "online");
});

test("concurrent calls for one signature share a request", async () => {
  let calls = 0;
  const g = createGemini({ cache: memCache(), fetch: async () => (calls++, reply(200, { success: true, data: { output: plan } })()) });
  await Promise.all([g.planForm("o", "s", desc, on), g.planForm("o", "s", desc, on)]);
  assert.equal(calls, 1);
});

test("timeout → null and offline, then backs off", async () => {
  let calls = 0;
  const g = createGemini({
    cache: memCache(),
    timeoutMs: 20,
    fetch: (_u, init) =>
      new Promise((_r, reject) => {
        calls++;
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
  });
  assert.equal(await g.planForm("o", "a", desc, on), null);
  assert.equal(g.status().state, "offline");
  assert.equal(g.status().lastErrorCode, "timeout");
  assert.equal(await g.planForm("o", "b", desc, on), null);
  assert.equal(calls, 1, "backoff: no second request");
});

test("503 ai_unavailable and malformed output → null", async () => {
  const g1 = createGemini({ cache: memCache(), fetch: reply(503, { success: false, error: { code: "ai_unavailable" } }) });
  assert.equal(await g1.planForm("o", "s", desc, on), null);
  assert.equal(g1.status().lastErrorCode, "ai_unavailable");
  const g2 = createGemini({ cache: memCache(), fetch: reply(200, { success: true, data: { output: "not a plan" } }) });
  assert.equal(await g2.planForm("o", "s", desc, on), null);
  assert.equal(g2.status().lastErrorCode, "bad_shape");
});

test("useGemini=false makes no request", async () => {
  let calls = 0;
  const g = createGemini({ cache: memCache(), fetch: async () => (calls++, reply(200, {})()) });
  assert.equal(await g.planForm("o", "s", desc, { ...on, useGemini: false }), null);
  assert.equal(calls, 0);
  assert.equal(g.status({ useGemini: false }).state, "disabled");
});
