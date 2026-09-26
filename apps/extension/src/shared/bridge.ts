// Messages between the MAIN-world page hook and the isolated content script, sent with
// window.postMessage. The hook imports this file, so it must stay dependency-free (no zod).

export const HOOK_SOURCE = "alt-hook";
export const CS_SOURCE = "alt-cs";

/** A request or response body as the hook saw it. The content script redacts and truncates it. */
export type BodySnapshot =
  | { kind: "text"; text: string; bytes: number; cut: boolean }
  | { kind: "form"; fields: Record<string, string> };

export type HookReqStart = {
  source: typeof HOOK_SOURCE;
  kind: "hook:req_start";
  reqId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: BodySnapshot | null;
  initiator: "fetch" | "xhr";
  /** Date.now() when the page made the call. */
  t: number;
};

export type HookReqEnd = {
  source: typeof HOOK_SOURCE;
  kind: "hook:req_end";
  reqId: string;
  /** 0 on network error. */
  status: number;
  body: BodySnapshot | null;
  durationMs: number;
  t: number;
};

export type HookNav = { source: typeof HOOK_SOURCE; kind: "hook:nav"; url: string };

export type HookPerf = {
  source: typeof HOOK_SOURCE;
  kind: "hook:perf";
  p50: number;
  p95: number;
  n: number;
};

export type HookMessage = HookReqStart | HookReqEnd | HookNav | HookPerf;

export type CsMode = { source: typeof CS_SOURCE; kind: "cs:mode"; mode: "live" | "paused" };
export type CsPerfQuery = { source: typeof CS_SOURCE; kind: "cs:perf_query" };
export type CsMessage = CsMode | CsPerfQuery;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStrMap = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every(isStr);

function isBody(v: unknown): v is BodySnapshot | null {
  if (v === null) return true;
  if (!isRecord(v)) return false;
  if (v.kind === "text") return isStr(v.text) && isNum(v.bytes) && typeof v.cut === "boolean";
  if (v.kind === "form") return isStrMap(v.fields);
  return false;
}

/** Accepts only well-formed hook messages. Anything else posted on the page is ignored. */
export function isHookMessage(v: unknown): v is HookMessage {
  if (!isRecord(v) || v.source !== HOOK_SOURCE) return false;
  switch (v.kind) {
    case "hook:req_start":
      return (
        isStr(v.reqId) &&
        isStr(v.method) &&
        isStr(v.url) &&
        isStrMap(v.headers) &&
        isBody(v.body) &&
        (v.initiator === "fetch" || v.initiator === "xhr") &&
        isNum(v.t)
      );
    case "hook:req_end":
      return isStr(v.reqId) && isNum(v.status) && isBody(v.body) && isNum(v.durationMs) && isNum(v.t);
    case "hook:nav":
      return isStr(v.url);
    case "hook:perf":
      return isNum(v.p50) && isNum(v.p95) && isNum(v.n);
    default:
      return false;
  }
}

export function isCsMessage(v: unknown): v is CsMessage {
  if (!isRecord(v) || v.source !== CS_SOURCE) return false;
  if (v.kind === "cs:mode") return v.mode === "live" || v.mode === "paused";
  return v.kind === "cs:perf_query";
}
