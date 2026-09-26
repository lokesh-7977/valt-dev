import type { DiscoveredAction, DiscoveredField, DiscoveredForm, DiscoveredPage } from "@valt/shared";
import { h, reconcile, show } from "../dom.ts";
import { humanize, pathOf, plural } from "../format.ts";
import { icon } from "../icons.ts";
import type { Model, View } from "../types.ts";
import { badge, chevron, emptyState, sourceBadge } from "./common.ts";

interface RouteGroup {
  routeKey: string;
  pages: DiscoveredPage[];
  forms: DiscoveredForm[];
  actions: DiscoveredAction[];
  depth: number;
  allowDestructive: boolean;
}

function groupRoutes(m: Model): RouteGroup[] {
  const s = m.snapshot;
  if (!s) return [];
  const allow = m.settings?.allowDestructive ?? false;
  const groups = new Map<string, RouteGroup>();
  const get = (rk: string): RouteGroup => {
    let g = groups.get(rk);
    if (!g) {
      g = { routeKey: rk, pages: [], forms: [], actions: [], depth: Number.POSITIVE_INFINITY, allowDestructive: allow };
      groups.set(rk, g);
    }
    return g;
  };
  for (const p of s.pages) {
    const g = get(p.routeKey);
    g.pages.push(p);
    g.depth = Math.min(g.depth, p.depth);
  }
  for (const f of s.forms) get(f.routeKey).forms.push(f);
  for (const a of s.actions) get(a.routeKey).actions.push(a);
  return [...groups.values()].sort((a, b) => a.depth - b.depth || a.routeKey.localeCompare(b.routeKey));
}

function groupSig(g: RouteGroup): string {
  return JSON.stringify([
    g.pages.map((p) => [p.url, p.title, p.isLogin]),
    g.forms.map((f) => [f.id, f.name, f.enrichment, f.category, f.purpose, f.destructive, f.fields.map((x) => [x.key, x.semantic, x.semanticSource])]),
    g.actions.map((a) => [a.id, a.destructive, a.effect?.type ?? null]),
    g.allowDestructive,
  ]);
}

function summaryContent(g: RouteGroup): Element[] {
  const title = g.pages.find((p) => p.title)?.title ?? "";
  const meta = [
    g.pages.length > 1 ? plural(g.pages.length, "page") : null,
    g.forms.length ? plural(g.forms.length, "form") : null,
    g.actions.length ? plural(g.actions.length, "action") : null,
  ].filter(Boolean);
  return [
    h("span", { class: "row-icon" }, icon("file", 18)),
    h(
      "span",
      { class: "row-main" },
      h("span", { class: "row-title mono" }, g.routeKey),
      h("span", { class: "row-sub" }, [title, ...meta].filter(Boolean).join(" · ") || "Not visited yet"),
    ),
    g.pages.some((p) => p.isLogin) ? badge("Login") : h("span"),
    chevron(),
  ];
}

function fieldRow(f: DiscoveredField): HTMLElement {
  return h(
    "li",
    { class: "field-item" },
    h(
      "span",
      { class: "field-name" },
      f.label || f.name || f.key,
      f.required ? h("span", { class: "req", title: "Required" }, h("span", { "aria-hidden": "true" }, " *"), h("span", { class: "sr-only" }, " (required)")) : null,
    ),
    h(
      "span",
      { class: "field-tags" },
      h("span", { class: "mono t-footnote muted" }, f.tag === "input" ? f.type : f.tag),
      badge(humanize(f.semantic)),
      sourceBadge(f.semanticSource),
    ),
  );
}

function formBlock(f: DiscoveredForm): HTMLElement {
  const via = f.reach.length ? `Opened via “${f.reach.map((r) => r.label).join(" › ")}”` : null;
  return h(
    "div",
    { class: "form-block" },
    h(
      "div",
      { class: "form-head" },
      h("span", { class: "form-icon" }, icon("text-cursor", 16)),
      h("span", { class: "form-name" }, f.name || "Untitled form"),
      h("span", { class: "form-badges" }, badge(humanize(f.category)), sourceBadge(f.enrichment)),
    ),
    f.purpose || via
      ? h("p", { class: "t-footnote muted" }, [f.purpose, via, f.inModal ? "In a dialog" : null].filter(Boolean).join(" · "))
      : null,
    f.destructive
      ? h("p", { class: "inline-note tone-warn" }, icon("shield", 14), h("span", null, `Destructive form${f.destructiveReason ? `: ${f.destructiveReason}` : ""}`))
      : null,
    h("ul", { class: "fields", "aria-label": `Fields of ${f.name || "form"}` }, ...f.fields.map(fieldRow)),
  );
}

function actionEffect(a: DiscoveredAction, allow: boolean): { text: string; skipped: boolean } {
  if (a.destructive && !allow) return { text: "Skipped for safety", skipped: true };
  if (a.destructive) return { text: "Destructive · allowed", skipped: false };
  const e = a.effect;
  if (!e) return { text: "Not explored yet", skipped: false };
  if (e.type === "navigated") return { text: `Opens ${e.toRouteKey}`, skipped: false };
  if (e.type === "revealed_form") return { text: "Reveals a form", skipped: false };
  return { text: "No visible change", skipped: false };
}

function body(g: RouteGroup): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (g.pages.length > 1) {
    parts.push(
      h(
        "div",
        { class: "sub-section" },
        h("p", { class: "sub-title" }, "Pages"),
        h("ul", { class: "plain mono t-footnote" }, ...g.pages.map((p) => h("li", { class: "break" }, pathOf(p.url)))),
      ),
    );
  }
  for (const f of g.forms) parts.push(formBlock(f));
  if (g.actions.length) {
    const skipped = g.actions.filter((a) => a.destructive && !g.allowDestructive).length;
    parts.push(
      h(
        "div",
        { class: "sub-section" },
        h("p", { class: "sub-title" }, plural(g.actions.length, "action"), skipped ? ` · ${skipped} skipped for safety` : ""),
        h(
          "ul",
          { class: "actions" },
          ...g.actions.map((a) => {
            const eff = actionEffect(a, g.allowDestructive);
            return h(
              "li",
              { class: "action-item", "data-skipped": eff.skipped ? "true" : null },
              h("span", { class: "action-label" }, a.label || a.selector),
              h(
                "span",
                { class: "action-effect t-footnote" },
                eff.skipped ? icon("shield", 14) : null,
                eff.text,
              ),
            );
          }),
        ),
      ),
    );
  }
  if (!parts.length) parts.push(h("p", { class: "t-footnote muted" }, "No forms or actions found on this route."));
  return parts;
}

export function createMap(): View {
  const list = h("div", { class: "list groups" });
  const empty = emptyState("map", "No pages mapped yet", "ALT maps pages, forms and actions as it explores.");
  const el = h("div", { class: "tab-content" }, empty, list);

  function fill(details: HTMLElement, g: RouteGroup): void {
    const summary = details.querySelector(":scope > summary");
    const bodyEl = details.querySelector(":scope > .group-body");
    summary?.replaceChildren(...summaryContent(g));
    bodyEl?.replaceChildren(...body(g));
  }

  return {
    el,
    render(m: Model) {
      const groups = groupRoutes(m);
      show(empty, groups.length === 0);
      show(list, groups.length > 0);
      reconcile(list, groups, {
        key: (g) => g.routeKey,
        sig: groupSig,
        create: (g) => {
          const d = h("details", { class: "group" }, h("summary", { class: "row-summary" }), h("div", { class: "group-body" }));
          fill(d, g);
          return d;
        },
        update: fill,
      });
    },
  };
}
