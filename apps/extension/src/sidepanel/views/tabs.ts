import { h, setAttr, setText } from "../dom.ts";
import type { Model, View } from "../types.ts";
import { createActivity } from "./activity.ts";
import { createHealth } from "./health.ts";
import { createMap } from "./map.ts";
import { createTests } from "./tests.ts";

type TabId = "activity" | "map" | "tests" | "health";

interface TabDef {
  id: TabId;
  label: string;
  count(m: Model): number | null;
  view: View;
}

const STORAGE_KEY = "alt.panel.tab";

function readTab(): TabId {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "activity" || v === "map" || v === "tests" || v === "health") return v;
  } catch {
    /* storage unavailable */
  }
  return "activity";
}

export function createTabs(): View {
  const defs: TabDef[] = [
    { id: "activity", label: "Activity", count: () => null, view: createActivity() },
    {
      id: "map",
      label: "Map",
      count: (m) => (m.snapshot ? new Set(m.snapshot.pages.map((p) => p.routeKey)).size : null),
      view: createMap(),
    },
    { id: "tests", label: "Tests", count: (m) => m.snapshot?.cases.length ?? null, view: createTests() },
    { id: "health", label: "Health", count: (m) => m.snapshot?.health.length ?? null, view: createHealth() },
  ];

  let selected: TabId = readTab();
  let lastModel: Model | null = null;

  const tabs = new Map<TabId, { button: HTMLButtonElement; count: HTMLElement; panel: HTMLElement }>();
  const tablist = h("div", { class: "tablist", role: "tablist", "aria-label": "Session details" });
  const panels = h("div", { class: "tabpanels" });

  for (const d of defs) {
    const count = h("span", { class: "tab-count" });
    const button = h(
      "button",
      {
        class: "tab",
        type: "button",
        role: "tab",
        id: `tab-${d.id}`,
        "aria-controls": `panel-${d.id}`,
        onClick: () => select(d.id, false),
      },
      h("span", { class: "tab-label" }, d.label),
      count,
    );
    const panel = h(
      "div",
      { class: "tabpanel", role: "tabpanel", id: `panel-${d.id}`, "aria-labelledby": `tab-${d.id}`, tabindex: "0" },
      d.view.el,
    );
    tabs.set(d.id, { button, count, panel });
    tablist.append(button);
    panels.append(panel);
  }

  tablist.addEventListener("keydown", (e) => {
    const order = defs.map((d) => d.id);
    const i = order.indexOf(selected);
    let next: TabId | undefined;
    if (e.key === "ArrowRight") next = order[(i + 1) % order.length];
    else if (e.key === "ArrowLeft") next = order[(i - 1 + order.length) % order.length];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next, true);
  });

  function sync(): void {
    for (const d of defs) {
      const t = tabs.get(d.id);
      if (!t) continue;
      const on = d.id === selected;
      setAttr(t.button, "aria-selected", on ? "true" : "false");
      t.button.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
    }
  }

  function select(id: TabId, focus: boolean): void {
    const changed = id !== selected;
    selected = id;
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    sync();
    if (focus) tabs.get(id)?.button.focus();
    if (changed && lastModel) defs.find((d) => d.id === id)?.view.render(lastModel);
  }

  sync();

  const el = h(
    "section",
    { class: "tabs", "aria-label": "Session details" },
    h("div", { class: "tabbar" }, tablist),
    panels,
  );

  return {
    el,
    render(m: Model) {
      lastModel = m;
      for (const d of defs) {
        const t = tabs.get(d.id);
        if (!t) continue;
        const n = d.count(m);
        setText(t.count, n === null || n === 0 ? "" : String(n));
        t.count.hidden = n === null || n === 0;
        if (d.id === selected) d.view.render(m);
      }
    },
  };
}
