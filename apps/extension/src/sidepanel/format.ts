import type {
  Expectation,
  HealthKind,
  NowState,
  SessionStatus,
  TestCaseKind,
  TestOutcome,
} from "@valt/shared";
import type { IconName } from "./icons.ts";

export function hostOf(origin: string | null | undefined): string {
  if (!origin) return "";
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function clock(ts: number): string {
  return timeFmt.format(new Date(ts));
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function humanize(s: string): string {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Show test values safely and legibly: empty, whitespace-only and very long values are described. */
export function describeValue(v: string, max = 64): { text: string; note: string | null; empty: boolean } {
  if (v === "") return { text: "empty", note: null, empty: true };
  if (v.trim() === "") return { text: `${v.length} ${v.length === 1 ? "space" : "spaces"}`, note: null, empty: true };
  const chars = [...v];
  if (chars.length > max) {
    return { text: `${chars.slice(0, max).join("")}…`, note: `${chars.length.toLocaleString()} chars`, empty: false };
  }
  return { text: v, note: null, empty: false };
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  live: "Live",
  paused: "Paused",
  watching: "Watching",
  idle: "Idle",
  stopped: "Stopped",
};

export const STATUS_SENTENCE: Record<SessionStatus, string> = {
  live: "Exploring and testing in a background tab.",
  watching: "Caught up. Reacting to your changes as you work.",
  paused: "Paused. Resume to pick up where ALT left off.",
  idle: "Ready. Start ALT to explore this app.",
  stopped: "Stopped. Start again to re-explore this app.",
};

export const PHASE_LABEL: Record<NowState["phase"], string> = {
  discovering: "Discovering pages",
  exploring: "Exploring actions",
  planning: "Planning tests",
  testing: "Testing",
  watching: "Watching your changes",
  idle: "Idle",
};

const KIND_LABEL: Partial<Record<TestCaseKind, string>> = {
  happy: "Happy path",
  html_injection: "HTML injection",
  sql_injection: "SQL injection",
  rtl: "Right-to-left text",
  max_length: "At max length",
  over_max_length: "Over max length",
  decimal_for_integer: "Decimal for integer",
  reload_after_fill: "Reload after fill",
  back_after_submit: "Back after submit",
  context: "Business rule",
};

export function caseKindLabel(kind: TestCaseKind): string {
  return KIND_LABEL[kind] ?? humanize(kind);
}

export const EXPECT_LABEL: Record<Expectation, string> = {
  accept: "Should be accepted",
  reject: "Should be rejected",
  observe: "Observe only",
};

export const OUTCOME_LABEL: Record<TestOutcome, string> = {
  accepted: "Accepted",
  navigated: "Accepted and navigated",
  rejected_client: "Blocked by browser validation",
  rejected_server: "Rejected by the server",
  server_error: "Server error",
  no_response: "No visible response",
  blocked_unsafe: "Blocked for safety",
};

export const HEALTH_LABEL: Record<HealthKind, string> = {
  console_error: "Console errors",
  unhandled_rejection: "Unhandled rejections",
  failed_request: "Failed requests",
  broken_link: "Broken links",
  broken_image: "Broken images",
  slow_page: "Slow pages",
  slow_request: "Slow requests",
  horizontal_overflow: "Horizontal overflow",
  overlapping_elements: "Overlapping elements",
  cut_off_text: "Cut-off text",
  missing_label: "Missing labels",
  unclear_button: "Unclear buttons",
  missing_alt: "Missing alt text",
  missing_lang: "Missing page language",
  missing_title: "Missing page title",
  duplicate_id: "Duplicate ids",
  keyboard_order: "Keyboard order",
};

export const HEALTH_ICON: Record<HealthKind, IconName> = {
  console_error: "terminal",
  unhandled_rejection: "terminal",
  failed_request: "wifi",
  broken_link: "unlink",
  broken_image: "image-off",
  slow_page: "timer",
  slow_request: "timer",
  horizontal_overflow: "move-horizontal",
  overlapping_elements: "layers",
  cut_off_text: "text",
  missing_label: "tag",
  unclear_button: "mouse-pointer",
  missing_alt: "image-off",
  missing_lang: "globe",
  missing_title: "file",
  duplicate_id: "hash",
  keyboard_order: "keyboard",
};

export const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const;
export const SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

/** `alt-session-localhost-4173-20260926-140231.json` */
export function exportFileName(origin: string | null, ts: number): string {
  const host = (hostOf(origin) || "session").replace(/[^a-z0-9.-]+/gi, "-");
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `alt-session-${host}-${stamp}.json`;
}
