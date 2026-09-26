import type {
  AltSettings,
  ConsoleEvent,
  DiscoveredForm,
  ExecutionEvidence,
  InteractionEvent,
  NetworkEvent,
  TestCase,
  TestExecution,
  TestOutcome,
  TestResult,
} from "@valt/shared";
import { NON_SUBMITTING } from "../shared/datagen.ts";
import { stableId } from "../shared/hash.ts";
import type { ObserveSnapshot, OverlayState } from "../shared/messages.ts";
import { classifyOutcome, judge } from "../shared/outcome.ts";
import { classifyDestructive } from "../shared/safety.ts";
import type { NetworkRecorder } from "./network.ts";
import { send, sleep, type WorkerTab } from "./worker-tab.ts";

/**
 * Runs one test case end-to-end in ALT's worker tab:
 *   fresh load → reveal form → fill → submit → observe (across navigations) → verdict.
 * All timing lives here (service-worker timers aren't throttled like background-tab timers).
 */

export interface ExecContext {
  worker: WorkerTab;
  network: NetworkRecorder;
  settings: AltSettings;
  consoleSince(tabId: number, from: number): ConsoleEvent[];
  overlay(state: OverlayState): Promise<void>;
  index: number;
  total: number;
  now?: () => number;
}

const POLL_MS = 150;
const QUIET_MS = 600;
const MIN_SETTLE_MS = 500;
const MAX_SETTLE_MS = 6000;

const isMutating = (e: NetworkEvent) =>
  e.method !== "GET" && e.method !== "HEAD" && e.method !== "OPTIONS" && (e.type === "xmlhttprequest" || e.type === "main_frame" || e.type === "sub_frame" || e.type === "other");

function emptySnapshot(url: string): ObserveSnapshot {
  return { url, formPresent: false, clientInvalid: false, validationMessages: [], messages: [], formReset: false, quietMs: 0, mutations: 0, fieldValues: {} };
}

export async function runCase(tc: TestCase, form: DiscoveredForm, ctx: ExecContext): Promise<TestExecution> {
  const now = ctx.now ?? Date.now;
  const startedAt = now();
  const steps: InteractionEvent[] = [];
  const notes: string[] = [];
  const step = (e: Omit<InteractionEvent, "ts">) => steps.push({ ts: now(), ...e });
  const fieldSel = form.fields.map((f) => ({ key: f.key, selector: f.selector }));
  const tabId = ctx.worker.id();
  let urlBefore = form.pageUrl;
  let snap = emptySnapshot(form.pageUrl);
  let submitAt = startedAt;
  let blocked = false;

  const finish = (outcome: TestOutcome, result: TestResult, extra: Partial<ExecutionEvidence> = {}): TestExecution => {
    const end = now();
    const network = tabId != null ? ctx.network.window(tabId, submitAt - 50, end) : [];
    const consoleErrors = tabId != null ? ctx.consoleSince(tabId, submitAt).filter((c) => c.kind !== "dialog") : [];
    const dialogs = tabId != null ? ctx.consoleSince(tabId, submitAt).filter((c) => c.kind === "dialog") : [];
    for (const d of dialogs) notes.push(`Dialog auto-dismissed: ${d.message}`);
    return {
      id: stableId(tc.id, startedAt),
      caseId: tc.id,
      formId: form.id,
      routeKey: form.routeKey,
      kind: tc.kind,
      title: tc.title,
      fieldKey: tc.fieldKey,
      values: tc.values,
      expectation: tc.expectation,
      startedAt,
      finishedAt: end,
      steps,
      evidence: {
        urlBefore,
        urlAfter: snap.url,
        clientInvalid: snap.clientInvalid,
        validationMessages: snap.validationMessages,
        messages: snap.messages,
        formReset: snap.formReset,
        network,
        mutatingRequests: network.filter(isMutating),
        consoleErrors,
        fieldValuesAfter: Object.keys(snap.fieldValues).length ? snap.fieldValues : null,
        notes,
        ...extra,
      },
      outcome,
      result,
    };
  };

  const fail = (reason: string) => finish("no_response", { status: "error", reason });

  // 1. Safety gate — nothing destructive is clicked or submitted unless the developer allowed it.
  const submitting = !NON_SUBMITTING.has(tc.kind);
  if (!ctx.settings.allowDestructive) {
    const risky = form.reach.find((r) => classifyDestructive({ text: r.label }).destructive);
    if ((submitting && form.destructive) || risky) {
      blocked = true;
      notes.push(risky ? `Reach step "${risky.label}" is destructive` : `Form is destructive: ${form.destructiveReason ?? "irreversible"}`);
      return finish("blocked_unsafe", judge(tc, "blocked_unsafe"));
    }
  }
  if (tabId == null) return fail("ALT worker tab is not available");

  const settle = async (): Promise<void> => {
    const t0 = now();
    let lastOk = emptySnapshot(snap.url);
    while (now() - t0 < MAX_SETTLE_MS) {
      await sleep(POLL_MS);
      try {
        const s = await send(tabId, { type: "alt:observe.snapshot" }, 1500);
        lastOk = s;
        const quiet = s.quietMs >= QUIET_MS && ctx.network.pending(tabId) === 0;
        if (quiet && now() - t0 >= MIN_SETTLE_MS) break;
      } catch {
        // The page is navigating; wait for the new document's content script.
        await ctx.worker.ready(5000);
      }
    }
    snap = lastOk;
  };

  const overlay = (detail: string, highlight: string | null = null) =>
    ctx.overlay({
      mode: "worker",
      text: `ALT · Testing ${form.purpose} · case ${ctx.index}/${ctx.total}`,
      detail,
      highlightSelector: highlight,
    }).catch(() => undefined);

  // 2. Fresh page, then reveal the form (e.g. click "New customer").
  const nav = await ctx.worker.navigate(form.pageUrl);
  step({ type: "navigate", detail: form.pageUrl, ok: nav.ok });
  if (!nav.ok) return fail(`Could not load ${form.pageUrl}`);
  urlBefore = nav.url;
  for (const r of form.reach) {
    const res = await send(tabId, { type: "alt:click", selector: r.selector }).catch((e: Error) => ({ ok: false, error: e.message }));
    step({ type: "reach", selector: r.selector, detail: r.label, ok: res.ok });
    await sleep(250);
  }
  let present = false;
  for (let i = 0; i < 20 && !present; i++) {
    present = (await send(tabId, { type: "alt:query", selector: form.selector }).catch(() => ({ present: false }))).present;
    if (!present) await sleep(150);
  }
  if (!present) return fail(`Form ${form.selector} not found on ${form.routeKey}`);

  const target = form.fields.find((f) => f.key === tc.fieldKey);
  await overlay(target ? `${target.label || target.key} = ${JSON.stringify(tc.values[target.key] ?? "").slice(0, 60)}` : tc.title, target?.selector ?? null);

  // 3. Keyboard navigation needs no data.
  if (tc.kind === "keyboard_navigation") {
    const walk = await send(tabId, { type: "alt:keyboard.walk", formSelector: form.selector, fields: fieldSel }).catch(() => null);
    step({ type: "keyboard", detail: walk ? `${walk.order.length} focusable fields` : "failed", ok: Boolean(walk) });
    if (!walk) return fail("Keyboard walk failed");
    notes.push(...walk.issues);
    submitAt = now();
    return finish(
      "no_response",
      walk.issues.length
        ? { status: "unexpected", reason: walk.issues[0] ?? "Keyboard order problem" }
        : { status: "pass", reason: `Tab order reaches all ${walk.order.length} fields in visual order` },
    );
  }

  // 4. Fill.
  await send(tabId, { type: "alt:observe.begin", formSelector: form.selector, fields: fieldSel }).catch(() => undefined);
  const fill = await send(tabId, {
    type: "alt:fill",
    formSelector: form.selector,
    fields: form.fields.filter((f) => f.key in tc.values && f.type !== "file").map((f) => ({ key: f.key, selector: f.selector, value: tc.values[f.key] ?? "" })),
  }).catch((e: Error) => ({ ok: false, reports: [], error: e.message }));
  for (const r of fill.reports) step({ type: "fill", fieldKey: r.key, value: r.requested, applied: r.applied, ok: r.ok, ...(r.error ? { detail: r.error } : {}) });
  if (!fill.ok && fill.reports.length === 0) return fail(`Fill failed: ${fill.error ?? "unknown"}`);
  const targetReport = fill.reports.find((r) => r.key === tc.fieldKey);
  if (targetReport?.sanitized && tc.kind !== "happy") {
    notes.push(`Browser changed ${targetReport.key} from ${JSON.stringify(targetReport.requested)} to ${JSON.stringify(targetReport.applied)}`);
    submitAt = now();
    return finish("no_response", { status: "skipped", reason: "The browser sanitised the test value, so the app never sees it" });
  }

  // 5. Reload after fill: does the page survive, and what happens to the typed data?
  if (tc.kind === "reload_after_fill") {
    submitAt = now();
    await ctx.worker.reload();
    step({ type: "reload", ok: true });
    await send(tabId, { type: "alt:observe.begin", formSelector: form.selector, fields: fieldSel }).catch(() => undefined);
    await settle();
    const kept = Object.values(snap.fieldValues).filter((v) => v !== "").length;
    notes.push(kept > 0 ? `${kept} field value(s) restored after reload` : "Form data was cleared by reload");
    return finish("no_response", judge(tc, "no_response", { consoleErrors: ctx.consoleSince(tabId, submitAt).filter((c) => c.kind !== "dialog") }));
  }

  // 6. Submit — ALT presses the button, not the developer.
  submitAt = now();
  await overlay(`Submitting · ${tc.title}`, form.submit?.selector ?? null);
  const times = tc.kind === "double_submit" ? 2 : 1;
  const sub = await send(tabId, { type: "alt:submit", formSelector: form.selector, submitSelector: form.submit?.selector ?? null, times }).catch(() => ({
    ok: true, // navigation tore down the content script mid-reply: the submit happened
  }));
  step({ type: "submit", selector: form.submit?.selector ?? form.selector, detail: times === 2 ? "double click" : undefined, ok: sub.ok });
  await settle();
  step({ type: "observe", detail: `${snap.messages.length} message(s), ${snap.validationMessages.length} validation`, ok: true });

  const end = now();
  const network = ctx.network.window(tabId, submitAt - 50, end);
  const mutating = network.filter(isMutating);
  const consoleErrors = ctx.consoleSince(tabId, submitAt).filter((c) => c.kind !== "dialog");
  const evidence = {
    blockedUnsafe: blocked,
    clientInvalid: snap.clientInvalid,
    validationMessages: snap.validationMessages,
    messages: snap.messages,
    urlBefore,
    urlAfter: snap.url,
    formReset: snap.formReset,
    mutatingRequests: mutating,
    consoleErrors,
  };
  const outcome = classifyOutcome(evidence);

  // 7. Interaction variants.
  if (tc.kind === "double_submit") {
    const ok = mutating.filter((r) => r.status >= 200 && r.status < 400);
    const same = new Map<string, number>();
    for (const r of ok) same.set(`${r.method} ${r.url}`, (same.get(`${r.method} ${r.url}`) ?? 0) + 1);
    const dup = [...same.entries()].find(([, n]) => n > 1);
    return finish(
      outcome,
      dup
        ? { status: "unexpected", reason: `One double-click sent ${dup[1]} successful ${dup[0].split(" ")[0]} requests (possible duplicate records)` }
        : outcome === "server_error"
          ? judge(tc, outcome)
          : { status: "pass", reason: `Double-click produced ${ok.length} successful submission(s)` },
    );
  }

  if (tc.kind === "back_after_submit") {
    const backAt = now();
    await ctx.worker.back();
    step({ type: "back", ok: true });
    await send(tabId, { type: "alt:observe.begin", formSelector: form.selector, fields: fieldSel }).catch(() => undefined);
    await settle();
    const resent = ctx.network.window(tabId, backAt, now()).filter(isMutating);
    const errs = ctx.consoleSince(tabId, backAt).filter((c) => c.kind !== "dialog");
    notes.push(`After Back: ${snap.url}`);
    const result: TestResult =
      resent.length > 0
        ? { status: "unexpected", reason: `Browser Back re-sent ${resent.length} mutating request(s)` }
        : errs.length > 0
          ? { status: "unexpected", reason: `${errs.length} console error(s) after Back` }
          : outcome === "server_error"
            ? judge(tc, outcome)
            : { status: "pass", reason: "Back after submit left the app consistent" };
    return finish(outcome, result);
  }

  return finish(outcome, judge(tc, outcome, evidence));
}
