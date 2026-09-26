import type { LabelSource } from "@valt/shared";
import { FIELD_SELECTOR, fieldContainer, isAltOverlay, isVisible } from "./selectors.ts";

/**
 * Human-facing names for fields, buttons and links, plus a short "nearby context" string for
 * field understanding. Pure DOM reads; never mutates the page.
 */

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SELECT", "TEXTAREA", "OPTION", "INPUT"]);

export function collapse(s: string | null | undefined, max = 200): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

interface TextOptions {
  /** Skip elements that are not rendered (hidden error placeholders, closed panels). */
  visibleOnly?: boolean;
  /** Include img alt / svg title (accessible-name style). */
  media?: boolean;
  /** Elements to leave out (e.g. the label inside a field container). */
  exclude?: Set<Element>;
}

/** Text content without form-control values, scripts, aria-hidden subtrees or the ALT overlay. */
export function textOf(node: Node, opts: TextOptions = {}, max = 300): string {
  let out = "";
  const visit = (n: Node): void => {
    if (out.length > max * 2) return;
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n as Text).data + " ";
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (SKIP_TAGS.has(el.tagName) || isAltOverlay(el)) return;
    if (opts.exclude?.has(el)) return;
    if (el.getAttribute("aria-hidden") === "true") return;
    if (el instanceof HTMLElement && el.hidden) return;
    if (opts.visibleOnly && !isVisible(el)) return;
    if (opts.media) {
      if (el.tagName === "IMG") {
        out += (el.getAttribute("alt") ?? "") + " ";
        return;
      }
      if (el.tagName.toLowerCase() === "svg") {
        const t = el.getAttribute("aria-label") ?? el.querySelector("title")?.textContent ?? "";
        out += t + " ";
        return;
      }
    } else if (el.tagName.toLowerCase() === "svg") {
      return;
    }
    for (const c of Array.from(el.childNodes)) visit(c);
  };
  visit(node);
  return collapse(out, max);
}

function idrefText(el: Element, attr: string): string {
  const ids = (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean);
  const root = el.getRootNode() as Document | ShadowRoot;
  return collapse(
    ids
      .map((id) => root.getElementById?.(id) ?? document.getElementById(id))
      .filter((e): e is HTMLElement => e !== null)
      .map((e) => textOf(e, { media: true }))
      .join(" "),
  );
}

/** Accessible name for buttons, links and other controls (simplified accname). */
export function accessibleName(el: Element): string {
  const byRef = idrefText(el, "aria-labelledby");
  if (byRef) return byRef;
  const aria = collapse(el.getAttribute("aria-label"));
  if (aria) return aria;
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    if (t === "image") return collapse(el.alt || el.value);
    if (t === "submit" || t === "button" || t === "reset") {
      return collapse(el.value || (t === "submit" ? "Submit" : t === "reset" ? "Reset" : ""));
    }
  }
  const text = textOf(el, { media: true }, 120);
  if (text) return text;
  return collapse(el.getAttribute("title"), 120);
}

/** Text immediately before `el` (previous siblings, then up to 3 ancestor levels). */
function precedingText(el: Element): string {
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 3; depth++) {
    let sib: Node | null = cur.previousSibling;
    while (sib) {
      if (sib.nodeType === Node.TEXT_NODE) {
        const t = collapse((sib as Text).data, 80);
        if (t) return t;
      } else if (sib.nodeType === Node.ELEMENT_NODE) {
        const s = sib as Element;
        if (s.matches(FIELD_SELECTOR) || s.querySelector(FIELD_SELECTOR)) return "";
        const t = textOf(s, { visibleOnly: true }, 80);
        if (t) return t.length <= 80 ? t : "";
      }
      sib = sib.previousSibling;
    }
    const parent: Element | null = cur.parentElement;
    if (!parent || parent.tagName === "FORM" || parent.tagName === "BODY") break;
    cur = parent;
  }
  return "";
}

function humanise(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

export interface FieldLabel {
  label: string;
  labelSource: LabelSource;
}

/** Label of a field, in priority order label-for → wrapping label → aria → placeholder → title → text → name. */
export function accessibleLabel(el: Element): FieldLabel {
  const labels =
    el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
      ? Array.from(el.labels ?? [])
      : [];
  const forLabel = labels.find((l) => l.htmlFor && l.htmlFor === el.id);
  if (forLabel) {
    const t = textOf(forLabel);
    if (t) return { label: t, labelSource: "label-for" };
  }
  for (const l of labels) {
    if (l === forLabel) continue;
    const t = textOf(l);
    if (t) return { label: t, labelSource: "label-wrap" };
  }
  const byRef = idrefText(el, "aria-labelledby");
  if (byRef) return { label: byRef, labelSource: "aria-labelledby" };
  const aria = collapse(el.getAttribute("aria-label"));
  if (aria) return { label: aria, labelSource: "aria-label" };
  const placeholder = collapse(el.getAttribute("placeholder"));
  if (placeholder) return { label: placeholder, labelSource: "placeholder" };
  const title = collapse(el.getAttribute("title"));
  if (title) return { label: title, labelSource: "title" };
  const before = precedingText(el);
  if (before) return { label: before, labelSource: "text" };
  const name = el.getAttribute("name");
  if (name && humanise(name)) return { label: humanise(name), labelSource: "name" };
  return { label: "", labelSource: "none" };
}

/** Label for a radio group: fieldset legend / radiogroup name, else the group's preceding text. */
export function radioGroupLabel(radios: HTMLInputElement[]): FieldLabel {
  const first = radios[0];
  if (!first) return { label: "", labelSource: "none" };
  const group = first.closest("[role=radiogroup]");
  if (group) {
    const byRef = idrefText(group, "aria-labelledby");
    if (byRef) return { label: byRef, labelSource: "aria-labelledby" };
    const aria = collapse(group.getAttribute("aria-label"));
    if (aria) return { label: aria, labelSource: "aria-label" };
  }
  const legend = first.closest("fieldset")?.querySelector("legend");
  if (legend) {
    const t = textOf(legend);
    if (t) return { label: t, labelSource: "label-wrap" };
  }
  // Text before the first radio's own label/wrapper.
  const anchor = first.labels?.[0] && first.labels[0].contains(first) ? first.labels[0] : first;
  const before = precedingText(anchor);
  if (before) return { label: before, labelSource: "text" };
  if (first.name) return { label: humanise(first.name), labelSource: "name" };
  return { label: "", labelSource: "none" };
}

/** ≤200 chars of helpful surrounding text: aria-describedby, hints in the field wrapper, title. */
export function nearbyContext(el: Element, label: FieldLabel): string | null {
  const parts: string[] = [];
  const described = idrefText(el, "aria-describedby");
  if (described) parts.push(described);
  const container = fieldContainer(el);
  if (container) {
    const exclude = new Set<Element>();
    const labels =
      el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
        ? Array.from(el.labels ?? [])
        : [];
    for (const l of labels) exclude.add(l);
    const t = textOf(container, { visibleOnly: true, exclude });
    if (t && t !== label.label) parts.push(t);
  }
  const title = collapse(el.getAttribute("title"));
  if (title && label.labelSource !== "title") parts.push(title);
  const unique = Array.from(new Set(parts.map((p) => collapse(p)).filter(Boolean)));
  const out = collapse(unique.join(" · "), 200);
  return out || null;
}
