import type { AltSettings } from "@valt/shared";

export const DEFAULT_SETTINGS: AltSettings = {
  enabledOrigins: [],
  allowDestructive: false,
  maxDepth: 4,
  maxPages: 50,
  maxCasesPerForm: 40,
  maxActionsPerPage: 15,
  slowPageMs: 3000,
  slowRequestMs: 1500,
  apiBaseUrl: "http://localhost:8000",
  useGemini: true,
  paceMs: 250,
};

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(hi, Math.max(lo, v));
}

/** Merge a partial update into settings, clamping every limit to a safe range. */
export function mergeSettings(base: AltSettings, patch: Partial<AltSettings> = {}): AltSettings {
  const next = { ...base, ...patch };
  return {
    enabledOrigins: Array.from(new Set((next.enabledOrigins ?? []).filter((o) => typeof o === "string" && o))),
    allowDestructive: next.allowDestructive === true,
    maxDepth: clamp(next.maxDepth, 1, 10, DEFAULT_SETTINGS.maxDepth),
    maxPages: clamp(next.maxPages, 1, 500, DEFAULT_SETTINGS.maxPages),
    maxCasesPerForm: clamp(next.maxCasesPerForm, 1, 200, DEFAULT_SETTINGS.maxCasesPerForm),
    maxActionsPerPage: clamp(next.maxActionsPerPage, 0, 50, DEFAULT_SETTINGS.maxActionsPerPage),
    slowPageMs: clamp(next.slowPageMs, 200, 60_000, DEFAULT_SETTINGS.slowPageMs),
    slowRequestMs: clamp(next.slowRequestMs, 100, 60_000, DEFAULT_SETTINGS.slowRequestMs),
    apiBaseUrl: String(next.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).trim().replace(/\/+$/, ""),
    useGemini: next.useGemini !== false,
    paceMs: clamp(next.paceMs, 0, 5000, DEFAULT_SETTINGS.paceMs),
  };
}
