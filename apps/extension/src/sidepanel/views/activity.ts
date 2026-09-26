import type { ActivityEntry } from "@valt/shared";
import { h, reconcile, show } from "../dom.ts";
import { clock } from "../format.ts";
import { icon, type IconName } from "../icons.ts";
import type { Model, View } from "../types.ts";
import { emptyState } from "./common.ts";

const LIMIT = 300;

const LEVEL: Record<ActivityEntry["level"], { icon: IconName; label: string }> = {
  info: { icon: "info", label: "Info" },
  success: { icon: "circle-check", label: "Done" },
  working: { icon: "activity", label: "Working" },
  warn: { icon: "triangle-alert", label: "Warning" },
};

export function createActivity(): View {
  const list = h("ol", { class: "list activity", "aria-label": "Activity, newest first" });
  const empty = emptyState("activity", "Nothing yet", "ALT's activity streams in here as it explores and tests.");
  const el = h("div", { class: "tab-content" }, empty, list);
  let primed = false;

  function create(a: ActivityEntry): HTMLElement {
    const lv = LEVEL[a.level];
    const li = h(
      "li",
      { class: "act", "data-level": a.level },
      h("span", { class: "act-icon" }, icon(lv.icon, 16)),
      h("p", { class: "act-text" }, h("span", { class: "sr-only" }, `${lv.label}: `), a.text),
      h("time", { class: "act-time", datetime: new Date(a.ts).toISOString() }, clock(a.ts)),
    );
    if (primed) {
      li.classList.add("enter");
      li.addEventListener("animationend", () => li.classList.remove("enter"), { once: true });
    }
    return li;
  }

  return {
    el,
    render(m: Model) {
      const items = [...(m.snapshot?.activity ?? [])].sort((a, b) => b.ts - a.ts).slice(0, LIMIT);
      show(empty, items.length === 0);
      show(list, items.length > 0);
      reconcile(list, items, { key: (a) => a.id, sig: (a) => a.text, create });
      primed = true;
    },
  };
}
