import type { SessionSnapshot } from "@valt/shared";
import { h, setAttr, setText } from "../dom.ts";
import { icon } from "../icons.ts";
import type { Model, View } from "../types.ts";

interface Stat {
  key: string;
  label: string;
  value(s: SessionSnapshot): string;
  alert?(s: SessionSnapshot): boolean;
}

const STATS: Stat[] = [
  { key: "pages", label: "Pages", value: (s) => String(s.stats.pages) },
  { key: "forms", label: "Forms", value: (s) => String(s.stats.forms) },
  { key: "actions", label: "Actions", value: (s) => String(s.stats.actions) },
  { key: "cases", label: "Cases run", value: (s) => `${s.stats.casesRun}/${s.stats.casesPlanned}` },
  { key: "unexpected", label: "Unexpected", value: (s) => String(s.stats.unexpected), alert: (s) => s.stats.unexpected > 0 },
  { key: "health", label: "Health issues", value: (s) => String(s.stats.health) },
];

export function createStats(): View {
  const cells = STATS.map((stat) => {
    const value = h("span", { class: "stat-value" });
    const li = h(
      "li",
      { class: "stat" },
      h("span", { class: "stat-top" }, value, stat.alert ? icon("triangle-alert", 14, "icon stat-flag") : null),
      h("span", { class: "stat-label" }, stat.label),
    );
    return { stat, li, value };
  });
  const el = h("section", { class: "card stats-card", "aria-label": "Session totals" }, h("ul", { class: "stats" }, ...cells.map((c) => c.li)));

  return {
    el,
    render(m: Model) {
      const s = m.snapshot;
      if (!s) return;
      for (const c of cells) {
        setText(c.value, c.stat.value(s));
        setAttr(c.li, "data-alert", c.stat.alert?.(s) ? "true" : null);
      }
    },
  };
}
