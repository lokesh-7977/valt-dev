import type { HealthKind } from "@valt/shared";
import type { HealthFinding, KeyboardWalk } from "../shared/messages.ts";
import { accessibleLabel, accessibleName, collapse } from "./labels.ts";
import type { FieldElement } from "./selectors.ts";
import {
  FIELD_SELECTOR,
  cssSelectorFor,
  describeElement,
  isAltOverlay,
  isDisabled,
  isFieldElement,
  isVisible,
  queryAllDeep,
  queryOne,
  queryScoped,
} from "./selectors.ts";

/**
 * Page-health checks (layout, labelling, markup, timing, keyboard). Read-only: nothing here
 * moves focus, scrolls, or waits — except `keyboardWalk`, which the SW calls in the worker tab.
 */

const MAX_PER_KIND = 5;
const MAX_OVERLAP_SAMPLES = 100;
const MAX_CUTOFF_SAMPLES = 50;
const MAX_SCAN_ELEMENTS = 5000;

const INTERACTIVE_SELECTOR =
  "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=checkbox], [tabindex]:not([tabindex='-1'])";

/** Page load time from navigation timing (loadEventEnd, else duration); null until known. */
export function navigationLoadMs(): number | null {
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!entry) return null;
  const ms = entry.loadEventEnd > 0 ? entry.loadEventEnd : entry.duration;
  return ms > 0 ? Math.round(ms) : null;
}

class Findings {
  readonly list: HealthFinding[] = [];
  private readonly counts = new Map<HealthKind, number>();

  full(kind: HealthKind): boolean {
    return (this.counts.get(kind) ?? 0) >= MAX_PER_KIND;
  }

  add(f: HealthFinding): void {
    if (this.full(f.kind)) return;
    this.counts.set(f.kind, (this.counts.get(f.kind) ?? 0) + 1);
    this.list.push({ ...f, message: collapse(f.message, 300), evidence: f.evidence ? collapse(f.evidence, 500) : null });
  }
}

function selectorOf(el: Element): string | null {
  try {
    return cssSelectorFor(el);
  } catch {
    return null;
  }
}

function isRelated(a: Element, b: Element): boolean {
  if (a === b || a.contains(b) || b.contains(a)) return true;
  // Clicking a control's label activates the control.
  const labels = isFieldElement(a) ? Array.from(a.labels ?? []) : [];
  return labels.some((l) => l === b || l.contains(b));
}

function inFixedLayer(el: Element): boolean {
  let cur: Element | null = el;
  for (let i = 0; cur && i < 6; i++) {
    const pos = getComputedStyle(cur).position;
    if (pos === "fixed" || pos === "sticky") return true;
    cur = cur.parentElement;
  }
  return false;
}

// ---------------------------------------------------------------- layout ----

function checkBrokenImages(f: Findings): void {
  for (const img of queryAllDeep("img") as HTMLImageElement[]) {
    if (f.full("broken_image")) return;
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src || !img.complete || img.naturalWidth !== 0) continue;
    f.add({
      kind: "broken_image",
      severity: "medium",
      selector: selectorOf(img),
      message: `Image failed to load${img.alt ? ` ("${collapse(img.alt, 60)}")` : ""}`,
      evidence: src,
    });
  }
}

function checkHorizontalOverflow(f: Findings): void {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  if (doc.scrollWidth <= vw + 1) return;
  const offenders: Array<{ el: Element; width: number; depth: number }> = [];
  const all = document.body ? document.body.getElementsByTagName("*") : [];
  const n = Math.min(all.length, MAX_SCAN_ELEMENTS);
  for (let i = 0; i < n; i++) {
    const el = all[i];
    if (!el || isAltOverlay(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.right + window.scrollX <= vw + 1) continue;
    let depth = 0;
    for (let p = el.parentElement; p; p = p.parentElement) depth++;
    offenders.push({ el, width: Math.round(r.width), depth });
  }
  offenders.sort((a, b) => b.width - a.width || a.depth - b.depth);
  // Blocks stretched by a wide child are as wide as the child, so width alone can't find the cause.
  // Rank intrinsic causes: explicit min-width beyond the viewport, intrinsically sized elements,
  // then elements wider than their own parent. Table internals roll up to their table.
  const TABLE_PARTS = /^(TR|TD|TH|THEAD|TBODY|TFOOT|COL|COLGROUP|CAPTION)$/;
  const INTRINSIC = /^(TABLE|IMG|PRE|VIDEO|CANVAS|IFRAME|SVG|svg)$/;
  const cause = (o: { el: Element; width: number; depth: number }): number => {
    if (TABLE_PARTS.test(o.el.tagName)) return 0;
    const minWidth = Number.parseFloat(getComputedStyle(o.el).minWidth);
    if (Number.isFinite(minWidth) && minWidth > vw) return 3;
    if (INTRINSIC.test(o.el.tagName)) return 2;
    const parent = o.el.parentElement;
    if (parent && o.width > parent.clientWidth + 1) return 1;
    return 0;
  };
  const scored = offenders.slice(0, 200).map((o) => ({ o, score: cause(o) }));
  const culprit =
    scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || b.o.depth - a.o.depth)[0]?.o ??
    offenders.filter((o) => !TABLE_PARTS.test(o.el.tagName)).sort((a, b) => b.depth - a.depth)[0];
  const evidence = [culprit, ...offenders.filter((o) => o !== culprit).slice(0, 2)].filter(
    (o): o is { el: Element; width: number; depth: number } => o !== undefined,
  );
  f.add({
    kind: "horizontal_overflow",
    severity: "medium",
    selector: culprit ? selectorOf(culprit.el) : null,
    message: `Page scrolls horizontally: content is ${doc.scrollWidth}px wide in a ${vw}px viewport${culprit ? ` (widest element: ${describeElement(culprit.el)}, ${culprit.width}px)` : ""}`,
    evidence: evidence.length ? evidence.map((o) => `${describeElement(o.el)} (${o.width}px)`).join(", ") : null,
  });
}

function checkOverlaps(f: Findings): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let samples = 0;
  for (const el of queryAllDeep(INTERACTIVE_SELECTOR)) {
    if (samples >= MAX_OVERLAP_SAMPLES || f.full("overlapping_elements")) return;
    if (isDisabled(el) || !isVisible(el)) continue;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) continue;
    samples++;
    const root = el.getRootNode() as Document | ShadowRoot;
    const hit = (root.elementFromPoint ? root.elementFromPoint(cx, cy) : document.elementFromPoint(cx, cy)) ?? null;
    if (!hit || isAltOverlay(hit) || isRelated(el, hit)) continue;
    // Legitimate covers: an open dialog over the page, fixed/sticky bars the page scrolled under.
    if (hit.closest("dialog, [role=dialog], [role=alertdialog], [aria-modal=true]") && !el.closest("dialog, [role=dialog], [role=alertdialog]")) continue;
    if (inFixedLayer(hit)) continue;
    const name = accessibleName(el);
    f.add({
      kind: "overlapping_elements",
      severity: "medium",
      selector: selectorOf(el),
      message: `${name ? `"${collapse(name, 60)}"` : describeElement(el)} is covered by another element at its centre`,
      evidence: `covered by ${describeElement(hit)}${hit.textContent?.trim() ? ` ("${collapse(hit.textContent, 40)}")` : ""}`,
    });
  }
}

function hasOwnText(el: Element): boolean {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === Node.TEXT_NODE && (c as Text).data.trim()) return true;
  }
  return false;
}

function checkCutOffText(f: Findings): void {
  const all = document.body ? document.body.getElementsByTagName("*") : [];
  const n = Math.min(all.length, MAX_SCAN_ELEMENTS);
  let samples = 0;
  for (let i = 0; i < n && samples < MAX_CUTOFF_SAMPLES; i++) {
    const el = all[i];
    if (!el || f.full("cut_off_text") || isAltOverlay(el)) continue;
    if (!(el instanceof HTMLElement) || el.clientWidth <= 0) continue;
    if (el.scrollWidth <= el.clientWidth + 1 || !hasOwnText(el)) continue;
    const style = getComputedStyle(el);
    if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
    samples++;
    if (style.textOverflow === "ellipsis" || !isVisible(el)) continue;
    const interactive = el.matches("button, a, label, [role=button], [role=tab]");
    const full = collapse(el.textContent, 120);
    f.add({
      kind: "cut_off_text",
      severity: interactive ? "medium" : "low",
      selector: selectorOf(el),
      message: `Text is clipped without an ellipsis: "${full}"`,
      evidence: `scrollWidth ${el.scrollWidth}px > clientWidth ${el.clientWidth}px`,
    });
  }
}

// ------------------------------------------------------ labelling / markup ----

function checkLabels(f: Findings): void {
  const seenRadio = new Set<string>();
  for (const el of queryAllDeep(FIELD_SELECTOR)) {
    if (f.full("missing_label")) break;
    if (!isFieldElement(el) || !isVisible(el) || isDisabled(el)) continue;
    if (el instanceof HTMLInputElement && el.type === "radio") {
      if (seenRadio.has(el.name)) continue;
      seenRadio.add(el.name);
    }
    const { label, labelSource } = accessibleLabel(el);
    if (labelSource !== "none" && labelSource !== "placeholder" && labelSource !== "name") continue;
    f.add({
      kind: "missing_label",
      severity: "medium",
      selector: selectorOf(el),
      message:
        labelSource === "placeholder"
          ? `Field is labelled only by its placeholder ("${collapse(label, 60)}")`
          : `Field has no accessible label (${describeElement(el)})`,
      evidence: labelSource === "none" ? null : `${labelSource}: ${label}`,
    });
  }
  for (const el of queryAllDeep("button, [role=button], input[type=button], input[type=submit], input[type=reset]")) {
    if (f.full("unclear_button")) break;
    if (!isVisible(el)) continue;
    const name = accessibleName(el);
    if (name && /[\p{L}\p{N}]/u.test(name)) continue;
    f.add({
      kind: "unclear_button",
      severity: "medium",
      selector: selectorOf(el),
      message: name ? `Button name "${name}" does not say what it does` : "Button has no accessible name (icon-only, no aria-label)",
      evidence: describeElement(el),
    });
  }
  for (const img of queryAllDeep("img") as HTMLImageElement[]) {
    if (f.full("missing_alt")) break;
    if (img.hasAttribute("alt") || img.getAttribute("role") === "presentation" || img.getAttribute("aria-hidden") === "true") continue;
    if (img.hasAttribute("aria-label") || img.hasAttribute("aria-labelledby")) continue;
    f.add({
      kind: "missing_alt",
      severity: "low",
      selector: selectorOf(img),
      message: "Image has no alt attribute",
      evidence: img.currentSrc || img.getAttribute("src"),
    });
  }
}

function checkDocument(f: Findings): void {
  if (!document.documentElement.getAttribute("lang")?.trim()) {
    f.add({ kind: "missing_lang", severity: "low", selector: "html", message: "The <html> element has no lang attribute", evidence: null });
  }
  if (!document.title.trim()) {
    f.add({ kind: "missing_title", severity: "low", selector: null, message: "The page has no <title>", evidence: null });
  }
  const ids = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll("[id]"))) {
    if (isAltOverlay(el) || !el.id) continue;
    ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  }
  for (const [id, count] of ids) {
    if (count < 2 || f.full("duplicate_id")) continue;
    f.add({
      kind: "duplicate_id",
      severity: "low",
      selector: `[id="${CSS.escape(id)}"]`,
      message: `id "${id}" is used ${count} times`,
      evidence: `${count} elements`,
    });
  }
}

// -------------------------------------------------------------- keyboard ----

interface Rect {
  top: number;
  left: number;
  height: number;
}

/** Visual reading order: rows (tops within half a row height), then left to right. */
function visualOrder<T>(items: Array<{ item: T; rect: Rect }>): T[] {
  const sorted = [...items].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  const rows: Array<Array<{ item: T; rect: Rect }>> = [];
  let rowTop = Number.NEGATIVE_INFINITY;
  let rowHeight = 0;
  for (const it of sorted) {
    const current = rows[rows.length - 1];
    if (!current || it.rect.top > rowTop + Math.max(rowHeight / 2, 4)) {
      rows.push([it]);
      rowTop = Math.round(it.rect.top);
      rowHeight = it.rect.height;
    } else {
      current.push(it);
    }
  }
  return rows.flatMap((r) => r.sort((a, b) => a.rect.left - b.rect.left).map((x) => x.item));
}

function tabIndexOf(el: Element): number {
  return el instanceof HTMLElement ? el.tabIndex : -1;
}

/** Sequential focus navigation order: positive tabindex ascending first, then DOM order. */
function sequentialOrder<T extends { el: Element; domIndex: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = tabIndexOf(a.el);
    const tb = tabIndexOf(b.el);
    const pa = ta > 0 ? ta : Number.MAX_SAFE_INTEGER;
    const pb = tb > 0 ? tb : Number.MAX_SAFE_INTEGER;
    return pa - pb || a.domIndex - b.domIndex;
  });
}

function domCompare(a: Element, b: Element): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function checkKeyboardOrder(f: Findings): void {
  for (const el of Array.from(document.querySelectorAll("[tabindex]"))) {
    if (f.full("keyboard_order")) return;
    if (isAltOverlay(el) || tabIndexOf(el) <= 0 || !isVisible(el)) continue;
    f.add({
      kind: "keyboard_order",
      severity: "low",
      selector: selectorOf(el),
      message: `Positive tabindex (${tabIndexOf(el)}) overrides the natural focus order`,
      evidence: describeElement(el),
    });
  }
  // Per visible form: does Tab order follow the visual order? (No focus() here — read-only.)
  for (const form of queryAllDeep("form") as HTMLFormElement[]) {
    if (f.full("keyboard_order")) return;
    if (!isVisible(form)) continue;
    const controls = Array.from(form.elements)
      .filter((e) => e.matches(`${FIELD_SELECTOR}, button`) && isVisible(e) && !isDisabled(e) && tabIndexOf(e) >= 0)
      .sort(domCompare)
      .map((el, domIndex) => ({ el, domIndex }));
    if (controls.length < 2) continue;
    const tab = sequentialOrder(controls).map((c) => c.el);
    const visual = visualOrder(controls.map((c) => ({ item: c.el, rect: c.el.getBoundingClientRect() })));
    const firstDiff = tab.findIndex((el, i) => visual[i] !== el);
    if (firstDiff < 0) continue;
    const name = (el: Element | undefined): string => (el ? accessibleLabel(el).label || accessibleName(el) || describeElement(el) : "?");
    f.add({
      kind: "keyboard_order",
      severity: "medium",
      selector: selectorOf(form),
      message: `Tab order differs from visual order in a form: after "${name(tab[firstDiff - 1])}" Tab goes to "${name(tab[firstDiff])}" but "${name(visual[firstDiff])}" comes next on screen`,
      evidence: `tab: ${tab.slice(0, 8).map(name).join(" → ")}`,
    });
  }
}

// ------------------------------------------------------------------- run ----

export function runHealthChecks(slowPageMs: number): { findings: HealthFinding[]; loadMs: number | null } {
  const f = new Findings();
  const checks: Array<(f: Findings) => void> = [
    checkBrokenImages,
    checkHorizontalOverflow,
    checkOverlaps,
    checkCutOffText,
    checkLabels,
    checkDocument,
    checkKeyboardOrder,
  ];
  for (const check of checks) {
    try {
      check(f);
    } catch {
      // one failing check must not hide the others
    }
  }
  let loadMs: number | null = null;
  try {
    loadMs = navigationLoadMs();
  } catch {
    loadMs = null;
  }
  if (loadMs !== null && loadMs > slowPageMs) {
    f.add({
      kind: "slow_page",
      severity: loadMs > slowPageMs * 2 ? "high" : "medium",
      selector: null,
      message: `Page took ${loadMs} ms to load (threshold ${slowPageMs} ms)`,
      evidence: `${loadMs} ms`,
    });
  }
  return { findings: f.list, loadMs };
}

/**
 * Keyboard walk over a form's fields: sequential focus order, whether each field is reachable
 * with Tab (focus() really lands on it), and order problems. Restores the previous focus.
 */
export function keyboardWalk(formSelector: string, fields: Array<{ key: string; selector: string }>): KeyboardWalk {
  const root = queryOne(formSelector);
  const previous = document.activeElement;
  const items: Array<{ key: string; selector: string; el: Element; domIndex: number; tabbable: boolean; required: boolean }> = [];
  const issues: string[] = [];
  const missing: string[] = [];
  for (const field of fields) {
    const matches = queryScoped(field.selector, root);
    // Radio group: the checked radio (or the first) is the group's tab stop.
    const el =
      matches.find((m) => m instanceof HTMLInputElement && m.type === "radio" && m.checked) ?? matches[0] ?? null;
    if (!el) {
      missing.push(field.key);
      continue;
    }
    items.push({ key: field.key, selector: field.selector, el, domIndex: 0, tabbable: false, required: isFieldElement(el) && (el as FieldElement).required });
  }
  items.sort((a, b) => domCompare(a.el, b.el)).forEach((it, i) => (it.domIndex = i));

  try {
    for (const it of items) {
      const el = it.el;
      if (isDisabled(el) || !isVisible(el) || tabIndexOf(el) < 0 || !(el instanceof HTMLElement)) continue;
      el.focus({ preventScroll: true });
      const active = el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).activeElement : document.activeElement;
      it.tabbable = active === el;
    }
  } finally {
    try {
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } catch {
      // ignore
    }
  }

  const tabbable = items.filter((it) => it.tabbable);
  const ordered = sequentialOrder(tabbable);
  const order = [
    ...ordered.map((it) => ({ key: it.key, selector: it.selector, tabbable: true })),
    ...items.filter((it) => !it.tabbable).map((it) => ({ key: it.key, selector: it.selector, tabbable: false })),
  ];

  for (const it of items) {
    const ti = tabIndexOf(it.el);
    if (ti > 0) issues.push(`"${it.key}" has a positive tabindex (${ti}), which overrides the natural focus order`);
    if (!it.tabbable && it.required) issues.push(`Required field "${it.key}" cannot be reached with the Tab key`);
    else if (!it.tabbable && isVisible(it.el) && !isDisabled(it.el)) issues.push(`Field "${it.key}" cannot be reached with the Tab key`);
  }
  if (ordered.length >= 2) {
    const visual = visualOrder(ordered.map((it) => ({ item: it, rect: it.el.getBoundingClientRect() })));
    const i = ordered.findIndex((it, idx) => visual[idx] !== it);
    if (i >= 0) {
      issues.push(
        `Focus order differs from visual order: Tab goes ${ordered.map((x) => x.key).join(" → ")}, screen reads ${visual.map((x) => x.key).join(" → ")}`,
      );
    }
  }
  for (const key of missing) issues.push(`Field "${key}" was not found on the page`);
  return { order, issues };
}
