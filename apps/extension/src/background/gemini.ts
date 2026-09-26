import type { AiStatus, AltFormDescriptor, AltFormPlan, AltSettings } from "@valt/shared";
import { localToday } from "../shared/datagen.ts";
import { isFormPlan } from "../shared/merge-plan.ts";

/**
 * Gemini enrichment through the VALT API (`POST /api/v1/process`, task `alt_form_plan`).
 * Never on the critical path and never throws: the loop keeps testing on heuristics, and a plan
 * arriving later only upgrades cases that haven't run yet. One call per unique form signature,
 * cached per origin; at most one call in flight.
 */

export interface PlanCache {
  getPlan(origin: string, signature: string): Promise<AltFormPlan | null>;
  putPlan(origin: string, signature: string, plan: AltFormPlan): Promise<void>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json" | "headers">>;

export interface Gemini {
  planForm(
    origin: string,
    signature: string,
    descriptor: AltFormDescriptor,
    settings: Pick<AltSettings, "apiBaseUrl" | "useGemini">,
  ): Promise<AltFormPlan | null>;
  status(settings?: Pick<AltSettings, "useGemini">): AiStatus;
}

export const TIMEOUT_MS = 20_000; // below the 30 s MV3 fetch limit
export const BACKOFF_MS = 60_000;

export function createGemini(opts: {
  fetch: FetchLike;
  cache: PlanCache;
  now?: () => number;
  timeoutMs?: number;
  onStatus?: (s: AiStatus) => void;
}): Gemini {
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const inflight = new Map<string, Promise<AltFormPlan | null>>();
  let chain: Promise<unknown> = Promise.resolve();
  let offlineUntil = 0;
  const st: AiStatus = { state: "unknown", lastLatencyMs: null, lastErrorCode: null, calls: 0 };

  const set = (patch: Partial<AiStatus>) => {
    Object.assign(st, patch);
    opts.onStatus?.({ ...st });
  };

  const fail = (code: string, backoffMs = BACKOFF_MS): null => {
    offlineUntil = now() + backoffMs;
    set({ state: "offline", lastErrorCode: code });
    return null;
  };

  const call = async (descriptor: AltFormDescriptor, apiBaseUrl: string): Promise<AltFormPlan | null> => {
    if (now() < offlineUntil) return null;
    const started = now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    set({ calls: st.calls + 1 });
    try {
      const res = await opts.fetch(`${apiBaseUrl}/api/v1/process`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "alt_form_plan", variables: { today: localToday() }, text: JSON.stringify(descriptor) }),
        signal: ctrl.signal,
      });
      const body = (await res.json().catch(() => null)) as
        | { success: true; data: { output: unknown } }
        | { success: false; error: { code: string } }
        | null;
      if (!res.ok || !body || body.success !== true) {
        const code = body && body.success === false ? body.error.code : `http_${res.status}`;
        const retryAfter = Number(res.headers?.get?.("retry-after"));
        return fail(code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS);
      }
      const plan = body.data.output;
      if (!isFormPlan(plan)) return fail("bad_shape");
      set({ state: "online", lastLatencyMs: now() - started, lastErrorCode: null });
      return plan;
    } catch (err) {
      return fail((err as { name?: string })?.name === "AbortError" ? "timeout" : "network_error");
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async planForm(origin, signature, descriptor, settings) {
      if (!settings.useGemini) {
        set({ state: "disabled" });
        return null;
      }
      try {
        const cached = await opts.cache.getPlan(origin, signature);
        if (cached) return cached;
      } catch {
        // cache unavailable — fall through to the API
      }
      const key = `${origin}|${signature}`;
      const existing = inflight.get(key);
      if (existing) return await existing;
      // Serialise: one call in flight at a time.
      const p = chain.then(() => call(descriptor, settings.apiBaseUrl)).then(async (plan) => {
        if (plan) await opts.cache.putPlan(origin, signature, plan).catch(() => undefined);
        return plan;
      });
      chain = p.catch(() => null);
      inflight.set(key, p);
      try {
        return await p;
      } finally {
        inflight.delete(key);
      }
    },
    status(settings) {
      if (settings && !settings.useGemini) return { ...st, state: "disabled" };
      return { ...st };
    },
  };
}
