// End-to-end: load the built ALT extension into Chromium, point it at the Acme Ledger demo, and
// check that it autonomously discovers, fills, submits and observes — without anyone clicking.
//   pnpm --filter @valt/extension e2e      (builds first)
// Needs Playwright's Chromium (`pnpm --filter @valt/extension exec playwright install chromium`).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const PORT = Number(process.env.DEMO_PORT || 4173);
const ORIGIN = `http://localhost:${PORT}`;
const TIMEOUT_MS = 240_000;

let server;
let context;
let sw;
let userDir;
let baseline;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const demo = async (path, init) => (await fetch(`${ORIGIN}${path}`, init)).json();

async function waitFor(fn, what, timeoutMs = TIMEOUT_MS) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

before(async () => {
  server = spawn(process.execPath, [join(here, "..", "..", "demo-erp", "server.mjs")], {
    env: { ...process.env, DEMO_PORT: String(PORT), PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`${ORIGIN}/`).then((r) => r.ok).catch(() => false)), "demo server", 15_000);
  await fetch(`${ORIGIN}/__demo/reset`, { method: "POST" });
  baseline = await demo("/__demo/state");

  userDir = mkdtempSync(join(tmpdir(), "alt-e2e-"));
  context = await chromium.launchPersistentContext(userDir, {
    channel: "chromium",
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
});

after(async () => {
  await context?.close().catch(() => undefined);
  server?.kill();
  if (userDir) rmSync(userDir, { recursive: true, force: true });
});

test("ALT explores and tests the demo app on its own", { timeout: TIMEOUT_MS + 60_000 }, async () => {
  // The developer is working in their own tab.
  const dev = await context.newPage();
  await dev.goto(`${ORIGIN}/`);

  // Enabling ALT is the only thing the developer does.
  const t0 = Date.now();
  await sw.evaluate(
    ({ origin }) => globalThis.__alt.enable(origin, { useGemini: false, maxCasesPerForm: 12, paceMs: 0, maxDepth: 3 }),
    { origin: ORIGIN },
  );

  // First autonomous action should come fast (no model on the critical path).
  const firstPage = await waitFor(
    async () => (await sw.evaluate(() => globalThis.__alt.snapshot())).pages.length > 0 && Date.now(),
    "first discovered page",
    30_000,
  );
  const firstActionMs = firstPage - t0;

  // Meanwhile the developer moves on to another page; ALT should notice.
  await waitFor(async () => (await sw.evaluate(() => globalThis.__alt.snapshot())).pages.length >= 3, "3 pages", 90_000);
  await dev.goto(`${ORIGIN}/payments`);

  const snap = await waitFor(async () => {
    const s = await sw.evaluate(() => globalThis.__alt.snapshot());
    return s.status === "watching" && s.stats.casesRun > 0 ? s : null;
  }, "ALT to finish its sweep");
  const events = await sw.evaluate(() => globalThis.__alt.events());
  const after = await demo("/__demo/state");

  // Keep the evidence for humans (and the final report).
  writeFileSync(join(here, "last-run.json"), JSON.stringify({ firstActionMs, snapshot: snap, events: events.length, demo: after }, null, 2));

  const routes = snap.pages.map((p) => p.routeKey).sort();
  console.log(`ALT: first page in ${firstActionMs} ms; routes: ${routes.join(" ")}`);
  console.log(`ALT: ${snap.stats.forms} forms, ${snap.stats.casesRun}/${snap.stats.casesPlanned} cases, ${snap.stats.unexpected} unexpected, ${snap.stats.health} health`);

  // 1. Pages, with dynamic routes collapsed.
  assert.ok(new Set(routes).size >= 6, `≥6 routes, got ${routes}`);
  assert.ok(routes.includes("/invoices/:id"), "collapses /invoices/1,2,3 → /invoices/:id");

  // 2. The invoice form and its fields.
  const inv = snap.forms.find((f) => f.routeKey === "/invoices/new");
  assert.ok(inv, "invoice form discovered");
  for (const k of ["customerId", "invoiceNumber", "quantity", "unitPrice", "discount", "invoiceDate", "dueDate"]) {
    assert.ok(inv.fields.some((f) => f.key === k), `invoice field ${k}`);
  }
  assert.equal(inv.fields.find((f) => f.key === "quantity").semantic, "quantity");

  // 3. ALT filled and submitted the happy path itself → a real invoice was created.
  assert.ok(after.counts.invoices > baseline.counts.invoices, "happy-path invoice created by ALT");
  const happy = snap.executions.find((e) => e.formId === inv.id && e.kind === "happy");
  assert.equal(happy?.result.status, "pass", `happy path: ${happy?.result.reason}`);

  // 4. The deliberate bug: negative quantity is accepted → observed as unexpected.
  const neg = snap.executions.find((e) => e.formId === inv.id && e.kind === "negative" && e.fieldKey === "quantity");
  assert.ok(neg, "negative quantity case executed");
  assert.equal(neg.result.status, "unexpected", neg.result.reason);
  assert.ok(neg.evidence.mutatingRequests.some((r) => r.method === "POST" && r.status === 201), "POST /api/invoices → 201 in evidence");

  // 5. Safety: nothing destructive happened.
  for (const [k, v] of Object.entries(after.destructive)) assert.equal(v, 0, `destructive endpoint ${k} was hit`);

  // 6. Page health.
  const kinds = new Set(snap.health.map((h) => h.kind));
  for (const k of ["broken_image", "console_error", "horizontal_overflow"]) assert.ok(kinds.has(k), `health ${k}; got ${[...kinds]}`);

  // 7. Contract: every test.executed event is self-describing.
  const executed = events.filter((e) => e.type === "test.executed");
  assert.ok(executed.length > 0);
  for (const e of executed) {
    const x = e.payload.execution;
    for (const k of ["caseId", "formId", "kind", "steps", "outcome"]) assert.ok(k in x, `execution.${k}`);
    assert.ok(Array.isArray(x.evidence.network), "evidence.network");
    assert.ok(typeof x.result.status === "string", "result.status");
  }

  // 8. ALT reacted to the developer's navigation.
  assert.ok(
    events.some((e) => e.type === "navigation" && e.payload.navigation.source === "developer"),
    "developer navigation observed",
  );

  // 9. The worker tab shows ALT at work.
  const workerTabs = [];
  for (const p of context.pages()) {
    if (p === dev || !p.url().startsWith(ORIGIN)) continue;
    const isWorker = await p.evaluate(() => sessionStorage.getItem("__alt_worker") === "1").catch(() => false);
    if (isWorker) workerTabs.push(p);
  }
  assert.equal(workerTabs.length, 1, "exactly one ALT worker tab");
  assert.ok(await workerTabs[0].evaluate(() => Boolean(document.querySelector("[data-alt-overlay]"))), "overlay in worker tab");
});
