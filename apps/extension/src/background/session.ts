import type {
  ActivityEntry,
  ConsoleEvent,
  DiscoveredAction,
  DiscoveredForm,
  DiscoveredPage,
  NetworkEvent,
  NowState,
  PageHealthObservation,
  ReachStep,
  SessionStatus,
  TestCase,
} from "@valt/shared";
import { localToday, planCases } from "../shared/datagen.ts";
import { fnv1a, stableId } from "../shared/hash.ts";
import { buildDescriptor, mergePlan } from "../shared/merge-plan.ts";
import type { HealthFinding, OverlayState, PageScan } from "../shared/messages.ts";
import { isCrawlable, normalizeUrl, routeKey } from "../shared/routes.ts";
import type { Bus } from "./bus.ts";
import { runCase } from "./executor.ts";
import type { Gemini } from "./gemini.ts";
import { isFailedRequest, type NetworkRecorder } from "./network.ts";
import { createQueue, taskKey, type Queue, type Task } from "./queue.ts";
import { emptyState, IDLE_NOW, type Store } from "./store.ts";
import { send, sleep, type WorkerTab } from "./worker-tab.ts";

/**
 * The reactive loop: THINK (what next?) → ACT (visit / click / fill / submit) → OBSERVE →
 * record → next. It keeps going on its own; when there's nothing left it keeps watching the
 * developer's tabs and wakes up when they navigate or the page changes.
 */

export interface Session {
  start(origin: string, url: string): Promise<void>;
  pause(): void;
  resume(): void;
  stop(reason?: string): Promise<void>;
  kick(): void;
  restore(): void;
  isRunning(): boolean;
  origin(): string | null;
  status(): SessionStatus;
  onDeveloperActivity(tabId: number, url: string, reason: "load" | "spa" | "dom"): void;
  onConsole(tabId: number, e: Omit<ConsoleEvent, "tabId">): void;
  onNetwork(e: NetworkEvent): void;
  consoleSince(tabId: number, from: number): ConsoleEvent[];
  trackedTab(tabId: number, url: string): boolean;
  setTabUrl(tabId: number, url: string): void;
  forgetTab(tabId: number): void;
}

const DEV_REVISIT_MS = 5000;
const LINK_CHECK_LIMIT = 25;

export function createSession(deps: {
  bus: Bus;
  store: Store;
  worker: WorkerTab;
  network: () => NetworkRecorder;
  gemini: Gemini;
  enableOrigin: (origin: string) => Promise<void>;
  fetch: typeof fetch;
}): Session {
  const { bus, store, worker, gemini } = deps;
  let queue: Queue = createQueue();
  let running = false;
  let actSeq = 0;
  const consoleLog = new Map<number, ConsoleEvent[]>();
  const tabUrls = new Map<number, string>();
  const lastDevVisit = new Map<string, number>();
  const checkedLinks = new Set<string>();

  const st = () => store.state;
  const settingsP = () => store.getSettings();

  // ---------- helpers ----------

  const persistQueue = () => store.update((s) => (s.queue = queue.serialize()));

  const activity = (level: ActivityEntry["level"], text: string, ref?: ActivityEntry["ref"]) => {
    const entry: ActivityEntry = { id: `${Date.now().toString(36)}${(actSeq++).toString(36)}`, ts: Date.now(), level, text, ...(ref ? { ref } : {}) };
    store.update((s) => {
      s.activity.push(entry);
      if (s.activity.length > 300) s.activity.splice(0, s.activity.length - 300);
    });
    bus.emit("activity", { entry });
  };

  const setNow = (now: Partial<NowState> & Pick<NowState, "phase" | "label">) =>
    store.update((s) => (s.now = { formId: null, caseIndex: null, caseTotal: null, detail: null, ...now }));

  const setStatus = (status: SessionStatus) => {
    if (st().status === status) return;
    store.update((s) => (s.status = status));
    bus.emit("session.status", { status });
  };

  const overlay = async (state: OverlayState) => {
    const id = worker.id();
    if (id == null) return;
    await send(id, { type: "alt:overlay.set", state }, 1500).catch(() => undefined);
  };

  const push = (t: Task) => {
    const added = queue.push(t);
    if (added) persistQueue();
    return added;
  };

  const addHealth = (f: HealthFinding | Omit<PageHealthObservation, "id" | "firstSeenAt" | "lastSeenAt" | "count">, rk: string, url: string) => {
    const id = stableId(f.kind, rk, f.selector ?? f.message);
    const existing = st().health[id];
    const now = Date.now();
    if (existing) {
      store.update((s) => {
        const h = s.health[id];
        if (h) {
          h.count += 1;
          h.lastSeenAt = now;
        }
      });
      return;
    }
    const observation: PageHealthObservation = {
      id,
      kind: f.kind,
      severity: f.severity,
      routeKey: rk,
      url,
      message: f.message,
      selector: f.selector,
      evidence: f.evidence,
      firstSeenAt: now,
      lastSeenAt: now,
      count: 1,
    };
    store.update((s) => (s.health[id] = observation));
    bus.emit("health.observed", { observation });
  };

  const casesOf = (formId: string): TestCase[] =>
    Object.values(st().cases)
      .filter((c) => c.formId === formId)
      .sort((a, b) => a.priority - b.priority);

  const executedSet = () => new Set(st().executed);

  /** Let client-rendered pages finish rendering before discovery. */
  const waitQuiet = async (tabId: number, quietMs = 300, maxMs = 2500) => {
    await send(tabId, { type: "alt:observe.begin", formSelector: null, fields: [] }, 1500).catch(() => undefined);
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await sleep(120);
      const s = await send(tabId, { type: "alt:observe.snapshot" }, 1500).catch(() => null);
      if (s && s.quietMs >= quietMs && Date.now() - t0 >= 200) return;
    }
  };

  // ---------- forms & cases ----------

  const registerForm = async (form: DiscoveredForm, page: Pick<DiscoveredPage, "url" | "title" | "headings" | "nav">, reach: ReachStep[]) => {
    if (st().forms[form.id]) return false;
    const settings = await settingsP();
    const f: DiscoveredForm = { ...form, reach };
    const cases = planCases(f, settings, { today: localToday(), runSeed: st().runSeed });
    store.update((s) => {
      s.forms[f.id] = f;
      for (const c of cases) s.cases[c.id] = c;
    });
    bus.emit("form.discovered", { form: f });
    activity("success", `Found ${f.purpose || f.name} form · ${f.fields.length} fields${f.inModal ? " (in a dialog)" : ""}`, { type: "form", id: f.id });
    if (f.destructive && !settings.allowDestructive) {
      activity("warn", `Won't submit "${f.purpose}" — ${f.destructiveReason ?? "destructive"} (allow destructive actions to test it)`, { type: "form", id: f.id });
    }
    bus.emit("cases.planned", { formId: f.id, cases });
    activity("working", `Generated ${cases.length} test cases for ${f.purpose}`, { type: "form", id: f.id });
    for (const c of cases) push({ kind: "test", caseId: c.id, routeKey: f.routeKey, priority: c.priority });
    void enrich(f.id, page);
    return true;
  };

  const enrich = async (formId: string, page: Pick<DiscoveredPage, "url" | "title" | "headings" | "nav">) => {
    const settings = await settingsP();
    const origin = st().origin;
    const form = st().forms[formId];
    if (!origin || !form || !settings.useGemini) {
      store.update((s) => (s.ai = gemini.status(settings)));
      return;
    }
    const sessionId = st().sessionId;
    const plan = await gemini.planForm(origin, form.id, buildDescriptor(page, form), settings);
    store.update((s) => (s.ai = gemini.status(settings)));
    if (!plan || st().sessionId !== sessionId) return;
    const current = st().forms[formId];
    if (!current) return;
    const before = casesOf(formId);
    const merged = mergePlan(current, before, plan, settings, executedSet());
    const keep = new Set(merged.cases.map((c) => c.id));
    store.update((s) => {
      s.forms[formId] = merged.form;
      for (const c of before) if (!keep.has(c.id)) delete s.cases[c.id];
      for (const c of merged.cases) s.cases[c.id] = c;
    });
    queue.removeWhere((t) => t.kind === "test" && !keep.has(t.caseId));
    const done = executedSet();
    for (const c of merged.cases) if (!done.has(c.id)) push({ kind: "test", caseId: c.id, routeKey: current.routeKey, priority: c.priority });
    bus.emit("form.enriched", { form: merged.form, plan });
    bus.emit("cases.planned", { formId, cases: merged.cases });
    const added = merged.cases.filter((c) => c.source === "gemini").length;
    const ms = st().ai.lastLatencyMs;
    activity(
      "success",
      `Gemini understood "${merged.form.purpose}"${added ? ` · +${added} business case${added > 1 ? "s" : ""}` : ""}${ms ? ` · ${(ms / 1000).toFixed(1)}s` : ""}`,
      { type: "form", id: formId },
    );
    if (merged.form.destructive && !current.destructive) activity("warn", `Gemini flagged "${merged.form.purpose}" as destructive — submits skipped`);
  };

  // ---------- tasks ----------

  const visit = async (t: Extract<Task, { kind: "visit" }>) => {
    const settings = await settingsP();
    const origin = st().origin!;
    const known = st().pages[t.routeKey];
    if (!known && Object.keys(st().pages).length >= settings.maxPages) return;
    const tabId = await worker.ensure(origin);
    store.update((s) => (s.workerTabId = tabId));
    setNow({ phase: "discovering", label: `Discovering ${t.routeKey}`, detail: t.url });
    const nav = await worker.navigate(t.url);
    if (!nav.ok) {
      activity("warn", `Couldn't load ${t.routeKey}`);
      return;
    }
    await overlay({ mode: "worker", text: `ALT · Discovering ${t.routeKey}` });
    await waitQuiet(tabId);
    const res = await send(tabId, { type: "alt:discover", maxActions: settings.maxActionsPerPage }, 8000).catch(() => null);
    if (!res?.ok) {
      activity("warn", `Couldn't read ${t.routeKey}`);
      return;
    }
    const scan: PageScan = res.scan;
    const rk = scan.routeKey;
    const isNew = !st().pages[rk];
    const page: DiscoveredPage = {
      url: scan.url,
      routeKey: rk,
      title: scan.title,
      headings: scan.headings,
      nav: scan.nav,
      links: scan.links,
      tables: scan.tables,
      lists: scan.lists,
      modals: scan.modals,
      isLogin: scan.isLogin,
      loadMs: scan.loadMs,
      formIds: scan.forms.map((f) => f.id),
      actionIds: scan.actions.map((a) => a.id),
      depth: known?.depth ?? t.depth,
      source: known?.source ?? t.source,
      discoveredAt: known?.discoveredAt ?? Date.now(),
    };
    store.update((s) => (s.pages[rk] = page));
    bus.emit("navigation", { navigation: { ts: Date.now(), source: "worker", tabId, url: scan.url, routeKey: rk, kind: "load" } });
    if (isNew) {
      bus.emit("page.discovered", { page });
      const bits = [scan.forms.length && `${scan.forms.length} form${scan.forms.length > 1 ? "s" : ""}`, scan.tables.length && `${scan.tables.length} table${scan.tables.length > 1 ? "s" : ""}`, scan.actions.length && `${scan.actions.length} actions`].filter(Boolean);
      activity("success", `Discovered ${scan.headings[0] || scan.title || rk} (${rk})${bits.length ? ` · ${bits.join(", ")}` : ""}`, { type: "page", id: rk });
    }

    for (const a of scan.actions) {
      if (!st().actions[a.id]) {
        store.update((s) => (s.actions[a.id] = a));
        bus.emit("action.discovered", { action: a });
      }
    }
    for (const f of scan.forms) await registerForm(f, page, []);

    // Crawl: same-origin, non-destructive links, one visit per logical route.
    if (page.depth < settings.maxDepth) {
      for (const l of scan.links) {
        if (!l.crawlable || l.destructive || !l.routeKey) continue;
        if (st().pages[l.routeKey] || queue.has(`visit:${l.routeKey}`)) continue;
        if (Object.keys(st().pages).length + queue.list().filter((q) => q.kind === "visit").length >= settings.maxPages) break;
        const url = normalizeUrl(l.href, scan.url);
        if (url) push({ kind: "visit", url, routeKey: l.routeKey, depth: page.depth + 1, source: "link" });
      }
    }

    // Page health (deterministic, in-page).
    const health = await send(tabId, { type: "alt:health", slowPageMs: settings.slowPageMs }, 8000).catch(() => null);
    for (const f of health?.findings ?? []) addHealth(f, rk, scan.url);
    // Console errors that fired while this page loaded.
    for (const c of consoleSince(tabId, nav.ok ? Date.now() - 15_000 : 0)) {
      if (c.kind === "console_error" || c.kind === "unhandled_rejection" || c.kind === "error") {
        if (routeKey(c.url) === rk) addHealth({ kind: c.kind === "console_error" ? "console_error" : "unhandled_rejection", severity: "high", selector: null, message: c.message.slice(0, 300), evidence: c.stack }, rk, c.url);
      }
    }

    if (isNew && settings.maxActionsPerPage > 0 && scan.actions.some((a) => !a.destructive && a.kind !== "submit")) {
      push({ kind: "explore_actions", routeKey: rk, url: scan.url });
    }
    if (isNew) {
      const urls = scan.links.filter((l) => l.crawlable && !l.destructive).map((l) => normalizeUrl(l.href, scan.url)).filter((u): u is string => Boolean(u));
      if (urls.length) push({ kind: "check_links", routeKey: rk, urls });
    }
  };

  const exploreActions = async (t: Extract<Task, { kind: "explore_actions" }>) => {
    const settings = await settingsP();
    const page = st().pages[t.routeKey];
    if (!page) return;
    const tabId = await worker.ensure(st().origin!);
    const actions = page.actionIds
      .map((id) => st().actions[id])
      .filter((a): a is DiscoveredAction => Boolean(a) && !a!.destructive && a!.kind !== "submit")
      .slice(0, settings.maxActionsPerPage);
    const skipped = page.actionIds.map((id) => st().actions[id]).filter((a) => a?.destructive);
    if (skipped.length) activity("info", `Skipped ${skipped.length} destructive action${skipped.length > 1 ? "s" : ""} on ${t.routeKey} (${skipped.map((a) => `"${a!.label}"`).slice(0, 3).join(", ")})`);
    for (const [i, a] of actions.entries()) {
      if (st().status !== "live") return;
      setNow({ phase: "exploring", label: `Exploring actions on ${t.routeKey}`, detail: `Clicking "${a.label}"`, caseIndex: i + 1, caseTotal: actions.length });
      const nav = await worker.navigate(page.url);
      if (!nav.ok) continue;
      await waitQuiet(tabId, 250, 1500);
      await overlay({ mode: "worker", text: `ALT · Exploring ${t.routeKey}`, detail: `Clicking "${a.label}"`, highlightSelector: a.selector });
      const before = new Set(page.formIds);
      const clicked = await send(tabId, { type: "alt:click", selector: a.selector }).catch(() => ({ ok: false }));
      if (!clicked.ok) continue;
      await sleep(300);
      const ready = await worker.ready(3000);
      if (!ready) continue;
      await waitQuiet(tabId, 250, 2000);
      const ping = await send(tabId, { type: "alt:ping" }).catch(() => null);
      const nowRk = ping ? ping.routeKey : routeKey(page.url);
      let effect: DiscoveredAction["effect"] = { type: "none" };
      if (ping && nowRk !== t.routeKey) {
        effect = { type: "navigated", toRouteKey: nowRk };
        if (!st().pages[nowRk] && !queue.has(`visit:${nowRk}`) && page.depth < settings.maxDepth) {
          push({ kind: "visit", url: ping.url, routeKey: nowRk, depth: page.depth + 1, source: "action" });
          activity("info", `"${a.label}" leads to ${nowRk}`, { type: "page", id: t.routeKey });
        }
      } else {
        const res = await send(tabId, { type: "alt:discover", maxActions: 0 }, 8000).catch(() => null);
        for (const f of res?.scan.forms ?? []) {
          if (before.has(f.id)) continue;
          const reached = { ...f, inModal: true };
          if (await registerForm(reached, page, [{ kind: "click", selector: a.selector, label: a.label }])) {
            effect = { type: "revealed_form", formId: f.id };
            activity("success", `Clicked "${a.label}" → revealed ${f.purpose || "a"} form`, { type: "form", id: f.id });
          }
        }
      }
      store.update((s) => {
        const act = s.actions[a.id];
        if (act) act.effect = effect;
      });
      bus.emit("action.discovered", { action: { ...a, effect } });
    }
  };

  const checkLinks = async (t: Extract<Task, { kind: "check_links" }>) => {
    const todo = t.urls.filter((u) => !checkedLinks.has(u) && !st().pages[routeKey(u)]).slice(0, LINK_CHECK_LIMIT);
    for (const u of todo) checkedLinks.add(u);
    await Promise.all(
      todo.map(async (u) => {
        try {
          let r = await deps.fetch(u, { method: "HEAD", credentials: "include", redirect: "follow" });
          if (r.status === 405 || r.status === 501) r = await deps.fetch(u, { method: "GET", credentials: "include", redirect: "follow" });
          if (r.status >= 400) {
            addHealth({ kind: "broken_link", severity: r.status >= 500 ? "high" : "medium", selector: `a[href="${new URL(u).pathname}"]`, message: `Link to ${new URL(u).pathname} returns ${r.status}`, evidence: u }, t.routeKey, st().pages[t.routeKey]?.url ?? u);
          }
        } catch {
          addHealth({ kind: "broken_link", severity: "medium", selector: null, message: `Link to ${u} could not be fetched`, evidence: u }, t.routeKey, u);
        }
      }),
    );
  };

  const test = async (t: Extract<Task, { kind: "test" }>) => {
    const tc = st().cases[t.caseId];
    const form = tc ? st().forms[tc.formId] : undefined;
    if (!tc || !form || st().executed.includes(tc.id)) return;
    const settings = await settingsP();
    const all = casesOf(form.id);
    const index = all.findIndex((c) => c.id === tc.id) + 1;
    const total = all.length;
    await worker.ensure(st().origin!);
    setNow({ phase: "testing", label: `Testing ${form.purpose}`, formId: form.id, caseIndex: index, caseTotal: total, detail: tc.title });
    bus.emit("test.started", { testCase: tc, index, total });
    store.update((s) => (s.inFlightCaseId = tc.id));
    const exec = await runCase(tc, form, {
      worker,
      network: deps.network(),
      settings,
      consoleSince,
      overlay,
      index,
      total,
    });
    store.update((s) => {
      s.executions.push(exec);
      if (!s.executed.includes(tc.id)) s.executed.push(tc.id);
      s.inFlightCaseId = null;
    });
    bus.emit("test.executed", { execution: exec });
    const r = exec.result;
    const icon = r.status === "pass" ? "✓" : r.status === "unexpected" ? "⚠" : "·";
    activity(
      r.status === "unexpected" ? "warn" : r.status === "pass" ? "info" : "info",
      `${icon} ${tc.title} — ${r.status === "unexpected" ? `Unexpected: ${r.reason}` : r.reason}`,
      { type: "case", id: tc.id },
    );
  };

  // ---------- loop ----------

  const runTask = async (t: Task) => {
    switch (t.kind) {
      case "visit":
        return await visit(t);
      case "explore_actions":
        return await exploreActions(t);
      case "check_links":
        return await checkLinks(t);
      case "test":
        return await test(t);
    }
  };

  const loop = async () => {
    if (running) return;
    running = true;
    try {
      while (st().status === "live") {
        const task = queue.pop();
        persistQueue();
        if (!task) {
          setStatus("watching");
          setNow({ phase: "watching", label: "Caught up · watching for your changes" });
          const s = st();
          await overlay({ mode: "worker", text: `ALT · Caught up · ${Object.keys(s.pages).length} pages · ${s.executed.length} tests`, detail: "Watching for your changes" });
          activity("success", `Caught up: ${Object.keys(s.pages).length} pages, ${Object.keys(s.forms).length} forms, ${s.executed.length} tests run. Watching for changes…`);
          break;
        }
        try {
          await runTask(task);
        } catch (err) {
          activity("warn", `ALT hit a problem on ${taskKey(task)}: ${(err as Error)?.message ?? String(err)}`);
          store.update((s) => (s.inFlightCaseId = null));
        }
        const { paceMs } = await settingsP();
        if (paceMs > 0) await sleep(paceMs);
      }
    } finally {
      running = false;
    }
  };

  const kick = () => {
    if (st().status === "live" && !running) void loop();
  };

  function consoleSince(tabId: number, from: number): ConsoleEvent[] {
    return (consoleLog.get(tabId) ?? []).filter((c) => c.ts >= from);
  }

  return {
    async start(origin, url) {
      await deps.enableOrigin(origin);
      const cur = st();
      if (cur.origin === origin && (cur.status === "live" || cur.status === "watching" || cur.status === "paused")) {
        setStatus("live");
        kick();
        return;
      }
      const settings = await settingsP();
      const sessionId = `${Date.now().toString(36)}-${fnv1a(String(Math.random()))}`;
      const prevWorker = cur.origin === origin ? cur.workerTabId : null;
      store.replace({ ...emptyState(sessionId), origin, status: "live", startedAt: Date.now(), workerTabId: prevWorker, ai: gemini.status(settings) });
      bus.setSessionId(sessionId);
      queue = createQueue();
      checkedLinks.clear();
      push({ kind: "visit", url: `${origin}/`, routeKey: "/", depth: 0, source: "start" });
      const rk = routeKey(url);
      if (rk !== "/" && isCrawlable(url, origin)) push({ kind: "visit", url, routeKey: rk, depth: 0, source: "developer" });
      bus.emit("session.started", { origin, settings });
      bus.emit("session.status", { status: "live" });
      activity("working", `ALT started on ${new URL(origin).host} — exploring on its own in the ALT tab`);
      if (settings.useGemini) activity("info", `Gemini enrichment via ${settings.apiBaseUrl}`);
      kick();
    },
    pause() {
      if (st().status === "live" || st().status === "watching") {
        setStatus("paused");
        setNow({ phase: "idle", label: "Paused" });
        activity("info", "Paused by you");
      }
    },
    resume() {
      if (st().status === "paused" || st().status === "watching") {
        setStatus("live");
        activity("working", "Resumed");
        kick();
      }
    },
    async stop(reason = "Stopped by you") {
      if (st().status === "idle" || st().status === "stopped") return;
      setStatus("stopped");
      queue = createQueue();
      persistQueue();
      store.update((s) => (s.now = { ...IDLE_NOW, label: "Stopped" }));
      await overlay({ mode: "hidden" });
      bus.emit("session.stopped", { reason });
      activity("info", reason);
    },
    kick,
    restore() {
      const s = st();
      queue = createQueue(s.queue);
      bus.setSessionId(s.sessionId);
      if (s.inFlightCaseId && !s.retried.includes(s.inFlightCaseId)) {
        const tc = s.cases[s.inFlightCaseId];
        if (tc) push({ kind: "test", caseId: tc.id, routeKey: tc.routeKey, priority: tc.priority });
        store.update((x) => {
          x.retried.push(x.inFlightCaseId!);
          x.inFlightCaseId = null;
        });
        activity("warn", "Service worker restarted — resuming the interrupted test");
      }
      if (s.status === "live") kick();
    },
    isRunning: () => running,
    origin: () => st().origin,
    status: () => st().status,
    onDeveloperActivity(tabId, url, reason) {
      const s = st();
      if (!s.origin || tabId === worker.id() || s.status === "stopped" || s.status === "idle") return;
      if (!url.startsWith(s.origin + "/") && url !== s.origin) return;
      tabUrls.set(tabId, url);
      const rk = routeKey(url);
      bus.emit("navigation", { navigation: { ts: Date.now(), source: "developer", tabId, url, routeKey: rk, kind: reason === "load" ? "load" : "spa" } });
      void send(tabId, { type: "alt:overlay.set", state: { mode: "watching", text: `ALT watching · ${Object.keys(s.pages).length} pages · ${s.executed.length} tests` } }, 1500).catch(() => undefined);
      const last = lastDevVisit.get(rk) ?? 0;
      if (Date.now() - last < DEV_REVISIT_MS) return;
      lastDevVisit.set(rk, Date.now());
      queue.boost(rk);
      queue.removeWhere((t) => t.kind === "visit" && t.routeKey === rk);
      push({ kind: "visit", url, routeKey: rk, depth: s.pages[rk]?.depth ?? 0, source: "developer" });
      activity(
        "working",
        reason === "dom" ? `You changed ${rk} — ALT is re-checking it` : `You opened ${rk} — ALT is prioritising it`,
        { type: "page", id: rk },
      );
      if (s.status === "watching") setStatus("live");
      kick();
    },
    onConsole(tabId, e) {
      let list = consoleLog.get(tabId);
      if (!list) consoleLog.set(tabId, (list = []));
      list.push({ ...e, tabId });
      if (list.length > 300) list.splice(0, list.length - 300);
      // Developer-tab errors are health observations right away (the worker's are attributed per visit/test).
      if (tabId !== worker.id() && e.kind !== "dialog" && st().origin && e.url.startsWith(st().origin!)) {
        addHealth({ kind: e.kind === "console_error" ? "console_error" : "unhandled_rejection", severity: "high", selector: null, message: e.message.slice(0, 300), evidence: e.stack }, routeKey(e.url), e.url);
      }
    },
    onNetwork(e) {
      store.update((s) => (s.requests += 1));
      void settingsP().then((settings) => {
        const pageUrl = tabUrls.get(e.tabId) ?? e.url;
        const rk = routeKey(pageUrl);
        if (isFailedRequest(e)) {
          addHealth({ kind: "failed_request", severity: e.status >= 500 || e.status === 0 ? "high" : "medium", selector: null, message: `${e.method} ${new URL(e.url).pathname} → ${e.status || e.error}`, evidence: e.url }, rk, pageUrl);
        }
        if ((e.type === "xmlhttprequest" || e.type === "main_frame") && e.durationMs > settings.slowRequestMs) {
          addHealth({ kind: "slow_request", severity: "medium", selector: null, message: `${e.method} ${new URL(e.url).pathname} took ${(e.durationMs / 1000).toFixed(1)}s`, evidence: e.url }, rk, pageUrl);
        }
      });
    },
    consoleSince,
    trackedTab(tabId, url) {
      const origin = st().origin;
      if (!origin || st().status === "stopped" || st().status === "idle") return false;
      if (tabId === worker.id()) return true;
      const pageUrl = tabUrls.get(tabId) ?? url;
      return pageUrl.startsWith(origin);
    },
    setTabUrl(tabId, url) {
      tabUrls.set(tabId, url);
    },
    forgetTab(tabId) {
      tabUrls.delete(tabId);
      consoleLog.delete(tabId);
    },
  };
}
