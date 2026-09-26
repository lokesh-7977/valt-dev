import type { HealthKind, PageHealthObservation } from "@valt/shared";
import { h, reconcile, setText, show } from "../dom.ts";
import { HEALTH_ICON, HEALTH_LABEL, SEVERITY_LABEL, SEVERITY_RANK } from "../format.ts";
import { icon } from "../icons.ts";
import type { Model, View } from "../types.ts";
import { emptyState } from "./common.ts";

interface KindGroup {
  kind: HealthKind;
  items: PageHealthObservation[];
  rank: number;
}

function groupByKind(items: readonly PageHealthObservation[]): KindGroup[] {
  const map = new Map<HealthKind, KindGroup>();
  for (const o of items) {
    let g = map.get(o.kind);
    if (!g) {
      g = { kind: o.kind, items: [], rank: 0 };
      map.set(o.kind, g);
    }
    g.items.push(o);
    g.rank = Math.max(g.rank, SEVERITY_RANK[o.severity]);
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.lastSeenAt - a.lastSeenAt);
  }
  return [...map.values()].sort((a, b) => b.rank - a.rank || b.items.length - a.items.length);
}

function item(o: PageHealthObservation): HTMLElement {
  return h(
    "li",
    { class: "health-item" },
    h(
      "div",
      { class: "health-top" },
      h("p", { class: "health-msg break" }, o.message),
      h("span", { class: "sev", "data-sev": o.severity }, h("span", { class: "sev-mark", "aria-hidden": "true" }), SEVERITY_LABEL[o.severity]),
    ),
    h(
      "p",
      { class: "t-footnote muted" },
      h("span", { class: "mono break" }, o.routeKey),
      o.count > 1 ? ` · seen ${o.count}×` : null,
    ),
    o.selector ? h("p", { class: "t-footnote mono muted break" }, o.selector) : null,
    o.evidence ? h("p", { class: "t-footnote muted break" }, o.evidence) : null,
  );
}

export function createHealth(): View {
  const list = h("div", { class: "groups" });
  const empty = emptyState("health", "No health issues", "ALT checks every page for console errors, broken links and images, layout and accessibility problems.");
  const el = h("div", { class: "tab-content" }, empty, list);

  return {
    el,
    render(m: Model) {
      const groups = groupByKind(m.snapshot?.health ?? []);
      show(empty, groups.length === 0);
      show(list, groups.length > 0);
      reconcile(list, groups, {
        key: (g) => g.kind,
        create: (g) => {
          const count = h("span", { class: "count-badge" });
          const sec = h(
            "section",
            { class: "health-group", "aria-label": HEALTH_LABEL[g.kind] },
            h(
              "h3",
              { class: "health-head" },
              h("span", { class: "row-icon" }, icon(HEALTH_ICON[g.kind], 18)),
              h("span", { class: "health-kind" }, HEALTH_LABEL[g.kind]),
              count,
            ),
            h("ul", { class: "list" }),
          );
          fill(sec, g);
          return sec;
        },
        update: fill,
      });
    },
  };

  function fill(sec: HTMLElement, g: KindGroup): void {
    const count = sec.querySelector(".count-badge");
    if (count) setText(count, String(g.items.length));
    const ul = sec.querySelector<HTMLElement>(":scope > ul");
    if (!ul) return;
    reconcile(ul, g.items, {
      key: (o) => o.id,
      sig: (o) => `${o.count}|${o.severity}|${o.message}|${o.selector ?? ""}|${o.evidence ?? ""}`,
      create: item,
    });
  }
}
