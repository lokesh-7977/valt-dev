import { h } from "../dom.ts";
import { icon, type IconName } from "../icons.ts";

const EMPTY_ICON: Record<string, IconName> = {
  activity: "activity",
  map: "file",
  tests: "text-cursor",
  health: "shield-check",
};

export function emptyState(kind: string, title: string, text: string): HTMLElement {
  const textEl = h("p", { class: "t-footnote muted empty-text" }, text);
  return h(
    "div",
    { class: "empty" },
    h("span", { class: "empty-icon" }, icon(EMPTY_ICON[kind] ?? "info", 22)),
    h("p", { class: "t-headline" }, title),
    textEl,
  );
}

/** Small neutral badge ("Gemini" / "Heuristic", categories). */
export function badge(text: string, opts: { icon?: IconName; tone?: "neutral" | "ai" | "warn" } = {}): HTMLElement {
  return h(
    "span",
    { class: "badge", "data-tone": opts.tone ?? "neutral" },
    opts.icon ? icon(opts.icon, 12) : null,
    text,
  );
}

export function sourceBadge(source: "heuristic" | "gemini"): HTMLElement {
  return source === "gemini" ? badge("Gemini", { icon: "sparkles", tone: "ai" }) : badge("Heuristic");
}

export function chevron(): SVGSVGElement {
  return icon("chevron-right", 16, "icon chev");
}
