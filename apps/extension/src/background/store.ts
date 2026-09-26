import type {
  ActivityEntry,
  AiStatus,
  AltFormPlan,
  AltSettings,
  DiscoveredAction,
  DiscoveredForm,
  DiscoveredPage,
  NowState,
  PageHealthObservation,
  SessionSnapshot,
  SessionStats,
  SessionStatus,
  TestCase,
  TestExecution,
} from "@valt/shared";
import { DEFAULT_SETTINGS, mergeSettings } from "../shared/settings.ts";
import type { Task } from "./queue.ts";

/**
 * Session state + persistence. MV3 service workers are killed when idle, so every change is
 * written through (debounced) to storage.session and restored on start. Settings and per-origin
 * knowledge (cached Gemini plans) live in storage.local and survive browser restarts.
 */

export interface AreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

export interface SessionState {
  sessionId: string;
  origin: string | null;
  status: SessionStatus;
  startedAt: number | null;
  workerTabId: number | null;
  runSeed: string;
  pages: Record<string, DiscoveredPage>;
  forms: Record<string, DiscoveredForm>;
  actions: Record<string, DiscoveredAction>;
  cases: Record<string, TestCase>;
  executions: TestExecution[];
  health: Record<string, PageHealthObservation>;
  activity: ActivityEntry[];
  now: NowState;
  ai: AiStatus;
  queue: { tasks: Task[]; boosted: string | null };
  executed: string[];
  requests: number;
  /** Case currently running when the SW died — re-queued once on restore. */
  inFlightCaseId: string | null;
  retried: string[];
}

export interface Knowledge {
  plans: Record<string, { plan: AltFormPlan; at: number }>;
  order: string[];
}

export const SESSION_KEY = "alt:session";
export const SETTINGS_KEY = "alt:settings";
export const knowledgeKey = (origin: string) => `alt:knowledge:${origin}`;
export const MAX_PLANS = 200;
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_EXECUTIONS = 600;
export const MAX_ACTIVITY = 300;

export const IDLE_NOW: NowState = {
  phase: "idle",
  label: "Idle",
  formId: null,
  caseIndex: null,
  caseTotal: null,
  detail: null,
};

export function emptyState(sessionId = "none"): SessionState {
  return {
    sessionId,
    origin: null,
    status: "idle",
    startedAt: null,
    workerTabId: null,
    runSeed: sessionId,
    pages: {},
    forms: {},
    actions: {},
    cases: {},
    executions: [],
    health: {},
    activity: [],
    now: { ...IDLE_NOW },
    ai: { state: "unknown", lastLatencyMs: null, lastErrorCode: null, calls: 0 },
    queue: { tasks: [], boosted: null },
    executed: [],
    requests: 0,
    inFlightCaseId: null,
    retried: [],
  };
}

export function statsOf(s: SessionState): SessionStats {
  const forms = Object.values(s.forms);
  const latest = new Map<string, TestExecution>();
  for (const e of s.executions) latest.set(e.caseId, e);
  const results = [...latest.values()].map((e) => e.result.status);
  const count = (st: string) => results.filter((r) => r === st).length;
  return {
    pages: Object.keys(s.pages).length,
    forms: forms.length,
    fields: forms.reduce((n, f) => n + f.fields.length, 0),
    actions: Object.keys(s.actions).length,
    casesPlanned: Object.keys(s.cases).length,
    casesRun: latest.size,
    passed: count("pass"),
    unexpected: count("unexpected"),
    inconclusive: count("inconclusive"),
    skipped: count("skipped"),
    health: Object.keys(s.health).length,
    requests: s.requests,
  };
}

export function toSnapshot(s: SessionState): SessionSnapshot {
  return {
    sessionId: s.sessionId,
    origin: s.origin,
    status: s.status,
    startedAt: s.startedAt,
    workerTabId: s.workerTabId,
    now: s.now,
    stats: statsOf(s),
    ai: s.ai,
    pages: Object.values(s.pages).sort((a, b) => a.discoveredAt - b.discoveredAt),
    forms: Object.values(s.forms),
    actions: Object.values(s.actions),
    cases: Object.values(s.cases).sort((a, b) => a.formId.localeCompare(b.formId) || a.priority - b.priority),
    executions: s.executions,
    health: Object.values(s.health),
    activity: s.activity,
  };
}

/** Keep the serialized session under the storage quota by dropping the oldest detail. */
export function trimToFit(s: SessionState, maxBytes = MAX_BYTES): SessionState {
  let out = s;
  const size = () => JSON.stringify(out).length;
  if (out.executions.length > MAX_EXECUTIONS) out = { ...out, executions: out.executions.slice(-MAX_EXECUTIONS) };
  if (out.activity.length > MAX_ACTIVITY) out = { ...out, activity: out.activity.slice(-MAX_ACTIVITY) };
  let guard = 0;
  while (size() > maxBytes && guard++ < 20) {
    if (out.executions.length > 10) {
      out = { ...out, executions: out.executions.slice(Math.ceil(out.executions.length / 2)) };
    } else if (out.activity.length > 20) {
      out = { ...out, activity: out.activity.slice(-20) };
    } else {
      const health = Object.values(out.health).slice(-Math.ceil(Object.keys(out.health).length / 2));
      out = { ...out, health: Object.fromEntries(health.map((h) => [h.id, h])), executions: [] };
    }
  }
  return out;
}

export interface Store {
  state: SessionState;
  /** Apply a change and schedule a debounced write-through. */
  update(mutate: (s: SessionState) => void): void;
  replace(next: SessionState): void;
  snapshot(): SessionSnapshot;
  flush(): Promise<void>;
  restore(): Promise<SessionState | null>;
  getSettings(): Promise<AltSettings>;
  setSettings(patch: Partial<AltSettings>): Promise<AltSettings>;
  getPlan(origin: string, signature: string): Promise<AltFormPlan | null>;
  putPlan(origin: string, signature: string, plan: AltFormPlan): Promise<void>;
  onChange(cb: () => void): () => void;
}

export function createStore(opts: {
  sessionArea: AreaLike;
  localArea: AreaLike;
  debounceMs?: number;
  now?: () => number;
  maxBytes?: number;
}): Store {
  const debounceMs = opts.debounceMs ?? 250;
  const now = opts.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settingsCache: AltSettings | null = null;
  const listeners = new Set<() => void>();

  const persist = async () => {
    timer = null;
    store.state = trimToFit(store.state, opts.maxBytes);
    await opts.sessionArea.set({ [SESSION_KEY]: store.state });
  };

  const notify = () => {
    for (const cb of listeners) {
      try {
        cb();
      } catch {
        // listener errors never break the loop
      }
    }
  };

  const store: Store = {
    state: emptyState(),
    update(mutate) {
      mutate(store.state);
      notify();
      if (timer === null) timer = setTimeout(() => void persist(), debounceMs);
    },
    replace(next) {
      store.state = next;
      notify();
      if (timer === null) timer = setTimeout(() => void persist(), debounceMs);
    },
    snapshot: () => toSnapshot(store.state),
    async flush() {
      if (timer !== null) clearTimeout(timer);
      await persist();
    },
    async restore() {
      const got = await opts.sessionArea.get(SESSION_KEY);
      const saved = got[SESSION_KEY] as SessionState | undefined;
      if (!saved || typeof saved !== "object" || !saved.sessionId) return null;
      store.state = { ...emptyState(saved.sessionId), ...saved };
      return store.state;
    },
    async getSettings() {
      if (settingsCache) return settingsCache;
      const got = await opts.localArea.get(SETTINGS_KEY);
      settingsCache = mergeSettings(DEFAULT_SETTINGS, (got[SETTINGS_KEY] as Partial<AltSettings>) ?? {});
      return settingsCache;
    },
    async setSettings(patch) {
      const next = mergeSettings(await store.getSettings(), patch);
      settingsCache = next;
      await opts.localArea.set({ [SETTINGS_KEY]: next });
      notify();
      return next;
    },
    async getPlan(origin, signature) {
      const k = knowledgeKey(origin);
      const kn = ((await opts.localArea.get(k))[k] as Knowledge | undefined) ?? null;
      return kn?.plans[signature]?.plan ?? null;
    },
    async putPlan(origin, signature, plan) {
      const k = knowledgeKey(origin);
      const kn: Knowledge = ((await opts.localArea.get(k))[k] as Knowledge | undefined) ?? { plans: {}, order: [] };
      kn.plans[signature] = { plan, at: now() };
      kn.order = [...kn.order.filter((s) => s !== signature), signature];
      while (kn.order.length > MAX_PLANS) {
        const evict = kn.order.shift();
        if (evict) delete kn.plans[evict];
      }
      await opts.localArea.set({ [k]: kn });
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return store;
}
