import type {
  ActionKind,
  DiscoveredAction,
  DiscoveredField,
  DiscoveredForm,
  DiscoveredLink,
  DiscoveredTable,
  FieldOption,
  FormCategory,
} from "@valt/shared";
import { stableId } from "../shared/hash.ts";
import type { PageScan } from "../shared/messages.ts";
import { isCrawlable, normalizeUrl, routeKey } from "../shared/routes.ts";
import { classifyDestructive } from "../shared/safety.ts";
import { classifyField, normaliseWords } from "../shared/semantics.ts";
import { navigationLoadMs } from "./health.ts";
import { accessibleLabel, accessibleName, collapse, nearbyContext, radioGroupLabel, textOf } from "./labels.ts";
import type { FieldElement } from "./selectors.ts";
import {
  FIELD_SELECTOR,
  cssSelectorFor,
  fieldKey,
  isAltOverlay,
  isDisabled,
  isFieldElement,
  isFieldVisible,
  isVisible,
  queryAllDeep,
} from "./selectors.ts";

/**
 * Page discovery: what can ALT see and do on this page right now? Only visible forms are
 * reported; a form revealed later (modal, tab) is found by a later scan and diffed by the SW.
 */

const MAX_LINKS = 500;
const MAX_TABLES = 20;
const MAX_HEADINGS = 30;
const DIALOG_SELECTOR = "dialog, [role=dialog], [role=alertdialog]";
const NAV_SELECTOR = "nav, header, [role=navigation]";

// --------------------------------------------------------------- fields ----

/** A field or a radio group (one field per group). */
interface FieldUnit {
  el: FieldElement;
  radios: HTMLInputElement[] | null;
}

function attr(el: Element, name: string): string | null {
  const v = el.getAttribute(name);
  return v === null || v === "" ? null : v;
}

function intAttr(el: Element, name: string): number | null {
  const v = el.getAttribute(name);
  if (v === null || v.trim() === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fieldUnits(controls: Element[]): FieldUnit[] {
  const units: FieldUnit[] = [];
  const radioGroups = new Map<string, FieldUnit>();
  for (const c of controls) {
    if (!isFieldElement(c) || isAltOverlay(c) || isDisabled(c) || !isFieldVisible(c)) continue;
    if (c instanceof HTMLInputElement && c.type === "radio" && c.name) {
      const existing = radioGroups.get(c.name);
      if (existing?.radios) {
        existing.radios.push(c);
        continue;
      }
      const unit: FieldUnit = { el: c, radios: [c] };
      radioGroups.set(c.name, unit);
      units.push(unit);
      continue;
    }
    units.push({ el: c, radios: null });
  }
  return units;
}

function selectOptions(el: HTMLSelectElement): FieldOption[] {
  return Array.from(el.options)
    .filter((o) => !o.disabled && o.value !== "")
    .map((o) => ({ value: o.value, label: collapse(o.label || o.text, 120) }));
}

function buildField(unit: FieldUnit, index: number, formContext: string): DiscoveredField {
  const el = unit.el;
  const tag = el.tagName.toLowerCase() as DiscoveredField["tag"];
  const isRadio = unit.radios !== null;
  const label = isRadio ? radioGroupLabel(unit.radios ?? []) : accessibleLabel(el);
  const type =
    el instanceof HTMLSelectElement ? (el.multiple ? "select-multiple" : "select") : el instanceof HTMLTextAreaElement ? "textarea" : el.type.toLowerCase();
  let options: FieldOption[] | null = null;
  if (el instanceof HTMLSelectElement) options = selectOptions(el);
  else if (isRadio) {
    options = (unit.radios ?? []).map((r) => ({
      value: r.value,
      label: collapse(r.labels?.[0] ? textOf(r.labels[0]) : r.value, 120) || r.value,
    }));
  } else if (el instanceof HTMLInputElement && el.list) {
    options = Array.from(el.list.querySelectorAll("option")).map((o) => ({
      value: o.value,
      label: collapse(o.label || o.text || o.value, 120),
    }));
  }
  const context = isRadio ? null : nearbyContext(el, label);
  const name = attr(el, "name");
  const verdict = classifyField({
    label: label.label,
    name,
    id: el.id || null,
    placeholder: attr(el, "placeholder"),
    autocomplete: attr(el, "autocomplete"),
    type,
    tag,
    inputMode: attr(el, "inputmode"),
    options,
    context: [formContext, context].filter(Boolean).join(" "),
  });
  const selector =
    isRadio && name ? `input[type="radio"][name="${CSS.escape(name)}"]` : cssSelectorFor(el);
  const required = isRadio ? (unit.radios ?? []).some((r) => r.required) : el.required;
  return {
    key: fieldKey(el, index, label.label),
    selector,
    tag,
    type: isRadio ? "radio" : type,
    name,
    label: label.label,
    labelSource: label.labelSource,
    placeholder: attr(el, "placeholder"),
    autocomplete: attr(el, "autocomplete"),
    inputMode: attr(el, "inputmode"),
    required,
    readOnly: el instanceof HTMLSelectElement ? false : el.readOnly,
    min: attr(el, "min"),
    max: attr(el, "max"),
    step: attr(el, "step"),
    minLength: intAttr(el, "minlength"),
    maxLength: intAttr(el, "maxlength"),
    pattern: attr(el, "pattern"),
    options,
    context,
    semantic: verdict.semantic,
    semanticSource: "heuristic",
    unique: verdict.unique,
  };
}

function dedupeKeys(fields: DiscoveredField[]): void {
  const seen = new Map<string, number>();
  for (const f of fields) {
    const n = seen.get(f.key) ?? 0;
    seen.set(f.key, n + 1);
    if (n > 0) {
      let candidate = `${f.key}_${n + 1}`;
      while (seen.has(candidate)) candidate = `${candidate}_`;
      seen.set(candidate, 1);
      f.key = candidate;
    }
  }
}

// ---------------------------------------------------------------- forms ----

const SUBMIT_WORDS = /\b(save|create|add|submit|send|ok|confirm|continue|next|apply|update|sign ?in|log ?in|sign ?up|register|invite|pay|search|done|finish)\b/i;
const CANCEL_WORDS = /\b(cancel|close|dismiss|back|reset|clear)\b|^[×x✕]$/i;

function buttonsIn(root: Element, form: HTMLFormElement | null): HTMLElement[] {
  const set = new Set<HTMLElement>();
  const pool = form ? Array.from(form.elements) : Array.from(root.querySelectorAll("button, input"));
  for (const b of pool) {
    if (b instanceof HTMLButtonElement || (b instanceof HTMLInputElement && ["submit", "image", "button"].includes(b.type))) {
      if (!form && b.closest("form")) continue;
      if (isVisible(b) && !isAltOverlay(b)) set.add(b);
    }
  }
  return Array.from(set);
}

function findSubmit(root: Element, form: HTMLFormElement | null): HTMLElement | null {
  const buttons = buttonsIn(root, form);
  const typed = buttons.find(
    (b) => (b instanceof HTMLButtonElement && b.type === "submit") || (b instanceof HTMLInputElement && (b.type === "submit" || b.type === "image")),
  );
  if (typed) return typed;
  if (form) return buttons[buttons.length - 1] ?? null;
  // Orphan group in a dialog: the button that reads like a primary action.
  const primary = buttons.find((b) => SUBMIT_WORDS.test(accessibleName(b)) && !CANCEL_WORDS.test(accessibleName(b)));
  if (primary) return primary;
  const notCancel = buttons.filter((b) => !CANCEL_WORDS.test(accessibleName(b)));
  return notCancel[notCancel.length - 1] ?? null;
}

function headingIn(root: Element): string {
  const h = Array.from(root.querySelectorAll("h1, h2, h3, h4")).find((e) => isVisible(e));
  return h ? textOf(h, {}, 120) : "";
}

/** Form heading: legend, aria name, heading inside, the dialog's title, or the nearest preceding heading. */
function formHeading(root: Element): string {
  const legend = root.querySelector("fieldset > legend");
  if (legend && root.querySelectorAll("fieldset").length === 1) {
    const t = textOf(legend, {}, 120);
    if (t) return t;
  }
  const byRef = root.getAttribute("aria-labelledby") ? accessibleName(root) : "";
  if (byRef) return byRef;
  const aria = collapse(root.getAttribute("aria-label"), 120);
  if (aria) return aria;
  const inside = headingIn(root);
  if (inside) return inside;
  const dialog = root.closest(DIALOG_SELECTOR);
  if (dialog && dialog !== root) {
    const name = dialog.getAttribute("aria-labelledby") || dialog.getAttribute("aria-label") ? accessibleName(dialog) : "";
    if (name && name.length <= 120) return name;
    const h = headingIn(dialog);
    if (h) return h;
  }
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
  let best: Element | null = null;
  for (const h of headings) {
    if (root.contains(h) || isAltOverlay(h) || !isVisible(h)) continue;
    if (h.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
  }
  return best ? textOf(best, {}, 120) : "";
}

function formCategory(fields: DiscoveredField[], submitLabel: string, heading: string, root: Element): FormCategory {
  const text = normaliseWords(`${heading} ${submitLabel}`);
  const submit = normaliseWords(submitLabel);
  const passwords = fields.filter((f) => f.type === "password").length;
  if (/\b(sign ?up|register|create (an )?account|join)\b/.test(text) && passwords > 0) return "signup";
  if (passwords > 0 && fields.length <= 3) return "login";
  if (passwords >= 2) return "signup";
  if (root.getAttribute("role") === "search" || (fields.length > 0 && fields.every((f) => f.semantic === "search" || f.type === "search"))) {
    return "search";
  }
  if (fields.some((f) => f.semantic === "card_number")) return "payment";
  if (/\binvite\b/.test(text)) return "invite";
  if (/\b(contact|get in touch|message us|feedback|support)\b/.test(text)) return "contact";
  if (/\b(settings|profile|preferences|account)\b/.test(text)) return "settings";
  if (/\b(filter|apply filters?)\b/.test(submit)) return "filter";
  if (/\b(update|save changes|edit)\b/.test(submit)) return "edit";
  if (/\b(create|add|save|new|submit)\b/.test(submit)) return "create";
  return "other";
}

function humaniseId(s: string | null): string {
  if (!s) return "";
  return normaliseWords(s).replace(/^./, (c) => c.toUpperCase());
}

function buildForm(root: Element, form: HTMLFormElement | null, controls: Element[], rk: string): DiscoveredForm | null {
  const units = fieldUnits(controls);
  if (units.length === 0) return null;
  const heading = formHeading(root);
  const submitEl = findSubmit(root, form);
  const submitLabel = submitEl ? accessibleName(submitEl) : "";
  const formContext = `${heading} ${submitLabel}`;
  const fields = units.map((u, i) => buildField(u, i, formContext));
  dedupeKeys(fields);

  const method = form ? (form.getAttribute("method") ?? "").toUpperCase() || null : null;
  const rawAction = form?.getAttribute("action") ?? null;
  const action = rawAction === null ? null : normalizeUrl(rawAction, location.href) ?? rawAction;
  const verdict = classifyDestructive({
    text: submitLabel,
    ariaLabel: submitEl?.getAttribute("aria-label") ?? null,
    title: submitEl?.getAttribute("title") ?? null,
    name: submitEl?.getAttribute("name") ?? null,
    id: submitEl?.id || null,
    formAction: submitEl?.getAttribute("formaction") ?? rawAction,
    method: submitEl?.getAttribute("formmethod") ?? method,
    context: heading,
  });
  const category = formCategory(fields, submitLabel, heading, root);
  const sortedKeys = fields.map((f) => f.key).sort();
  return {
    id: stableId(rk, sortedKeys.join(","), submitLabel),
    routeKey: rk,
    pageUrl: location.href,
    selector: cssSelectorFor(root),
    name: heading || humaniseId(root.getAttribute("name") || root.id) || submitLabel || "Form",
    fields,
    submit: submitEl ? { selector: cssSelectorFor(submitEl), label: submitLabel } : null,
    method,
    action,
    novalidate: form ? form.hasAttribute("novalidate") || Boolean(submitEl?.hasAttribute("formnovalidate")) : false,
    inModal: root.closest(DIALOG_SELECTOR) !== null || root.closest("[aria-modal=true]") !== null,
    reach: [],
    category,
    purpose: heading || submitLabel,
    isLogin: category === "login",
    destructive: verdict.destructive,
    destructiveReason: verdict.reason,
    enrichment: "heuristic",
  };
}

export function discoverForms(rk = routeKey(location.href)): DiscoveredForm[] {
  const out: DiscoveredForm[] = [];
  const seen = new Set<string>();
  const push = (f: DiscoveredForm | null): void => {
    if (f && !seen.has(f.id)) {
      seen.add(f.id);
      out.push(f);
    }
  };
  for (const form of queryAllDeep("form") as HTMLFormElement[]) {
    try {
      push(buildForm(form, form, Array.from(form.elements), rk));
    } catch {
      // one malformed form must not hide the others
    }
  }
  // Orphan field groups in visible dialogs (fields without a <form>, plus a button).
  for (const dialog of queryAllDeep(DIALOG_SELECTOR)) {
    try {
      if (!isVisible(dialog)) continue;
      const controls = Array.from(dialog.querySelectorAll(FIELD_SELECTOR)).filter((c) => !c.closest("form"));
      if (controls.length === 0 || buttonsIn(dialog, null).length === 0) continue;
      push(buildForm(dialog, null, controls, rk));
    } catch {
      // ignore
    }
  }
  return out;
}

// -------------------------------------------------------------- actions ----

const ACTION_SELECTOR = "button, [role=button], [role=tab], a, input[type=button], input[type=submit]";

function isModalTrigger(el: Element): boolean {
  const popup = el.getAttribute("aria-haspopup");
  if (popup && popup !== "false") return true;
  if (el.hasAttribute("aria-controls")) return true;
  return Array.from(el.attributes).some((a) => /^data-.*(toggle|target)/i.test(a.name));
}

export function discoverActions(maxActions: number, rk: string, excluded: Set<Element>): DiscoveredAction[] {
  if (maxActions <= 0) return [];
  const actions: Array<DiscoveredAction & { order: number }> = [];
  const seenSelectors = new Set<string>();
  const origin = location.origin;
  let order = 0;
  for (const el of queryAllDeep(ACTION_SELECTOR)) {
    try {
      if (excluded.has(el) || el.closest("form") || !isVisible(el) || isDisabled(el)) continue;
      if (el.getAttribute("aria-disabled") === "true") continue;
      let kind: ActionKind = "button";
      let href: string | null = null;
      if (el.tagName === "A") {
        href = el.getAttribute("href");
        if (href !== null) {
          if (isCrawlable(href, origin, { download: el.hasAttribute("download"), currentUrl: location.href })) continue;
          const trimmed = href.trim();
          const inPage = trimmed === "" || trimmed.startsWith("#") || /^javascript:/i.test(trimmed);
          if (!inPage) continue; // other origins, mailto:, downloads — never clicked
          if (/^#!?\//.test(trimmed)) kind = "navigate"; // hash-router route
        } else if (!el.hasAttribute("role") && !el.hasAttribute("onclick") && !el.hasAttribute("tabindex")) {
          continue; // placeholder anchor with no behaviour
        }
      }
      if (el instanceof HTMLInputElement && el.type === "submit") kind = "submit";
      if (el instanceof HTMLButtonElement && el.type === "submit" && el.form) kind = "submit";
      if (kind !== "navigate" && isModalTrigger(el)) kind = "open_modal";
      const label = accessibleName(el) || collapse(el.getAttribute("title")) || "";
      const selector = cssSelectorFor(el);
      if (seenSelectors.has(selector)) continue;
      seenSelectors.add(selector);
      const verdict = classifyDestructive({
        text: label,
        ariaLabel: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
        id: el.id || null,
        name: el.getAttribute("name"),
        href,
      });
      actions.push({
        id: stableId(rk, selector, label),
        routeKey: rk,
        selector,
        label: label || `Unlabelled ${el.tagName.toLowerCase()}`,
        kind,
        destructive: verdict.destructive,
        destructiveReason: verdict.reason,
        order: order++,
      });
    } catch {
      // ignore this element
    }
  }
  // Revealing actions first (they find hidden forms), destructive last; DOM order otherwise.
  const rank = (a: DiscoveredAction): number =>
    (a.destructive ? 10 : 0) + (a.kind === "open_modal" ? 0 : a.kind === "button" ? 1 : a.kind === "navigate" ? 2 : 3);
  return actions
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order)
    .slice(0, maxActions)
    .map(({ order: _order, ...a }) => a);
}

// ---------------------------------------------------------------- links ----

export function discoverLinks(): DiscoveredLink[] {
  const out: DiscoveredLink[] = [];
  const origin = location.origin;
  for (const a of queryAllDeep("a[href]") as HTMLAnchorElement[]) {
    if (out.length >= MAX_LINKS) break;
    try {
      const raw = a.getAttribute("href") ?? "";
      const crawlable = isCrawlable(raw, origin, { download: a.hasAttribute("download"), currentUrl: location.href });
      const normalized = crawlable ? normalizeUrl(raw, location.href) : null;
      const text = accessibleName(a);
      out.push({
        href: normalized ?? a.href,
        text,
        routeKey: normalized ? routeKey(normalized) : null,
        crawlable,
        inNav: a.closest(NAV_SELECTOR) !== null,
        destructive: classifyDestructive({
          text,
          ariaLabel: a.getAttribute("aria-label"),
          title: a.getAttribute("title"),
          id: a.id || null,
          href: raw,
        }).destructive,
      });
    } catch {
      // ignore
    }
  }
  return out;
}

/** Crawlable, normalised, de-duplicated hrefs (for `alt:links`). */
export function crawlableLinks(): string[] {
  return Array.from(new Set(discoverLinks().filter((l) => l.crawlable).map((l) => l.href)));
}

// --------------------------------------------------------------- tables ----

function discoverTables(): DiscoveredTable[] {
  const out: DiscoveredTable[] = [];
  for (const t of queryAllDeep("table") as HTMLTableElement[]) {
    if (out.length >= MAX_TABLES) break;
    if (!isVisible(t)) continue;
    try {
      const headRow = t.tHead?.rows[0] ?? t.rows[0];
      const headers = headRow
        ? Array.from(headRow.cells)
            .filter((c) => c.tagName === "TH")
            .map((c) => textOf(c, {}, 80))
        : [];
      const bodyRows = t.tBodies.length
        ? Array.from(t.tBodies).flatMap((b) => Array.from(b.rows))
        : Array.from(t.rows).slice(headers.length ? 1 : 0);
      const caption = t.caption ? textOf(t.caption, {}, 120) : collapse(t.getAttribute("aria-label"), 120);
      out.push({
        selector: cssSelectorFor(t),
        caption: caption || null,
        headers,
        rowCount: bodyRows.filter((r) => !r.hidden).length,
      });
    } catch {
      // ignore
    }
  }
  return out;
}

// ----------------------------------------------------------------- page ----

export function discoverPage(maxActions: number): PageScan {
  const url = location.href;
  const rk = routeKey(url);
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  const forms = safe(() => discoverForms(rk), []);
  // Orphan-group submit buttons are the form's submit, not a separate action.
  const excluded = new Set<Element>();
  for (const f of forms) {
    if (f.submit) {
      const el = safe(() => document.querySelector(f.submit?.selector ?? ""), null);
      if (el) excluded.add(el);
    }
  }
  const headings = safe(
    () =>
      queryAllDeep("h1, h2, h3")
        .filter((h) => isVisible(h))
        .map((h) => textOf(h, {}, 120))
        .filter(Boolean)
        .slice(0, MAX_HEADINGS),
    [],
  );
  const nav = safe(
    () =>
      Array.from(
        new Set(
          queryAllDeep(`${NAV_SELECTOR.split(", ").map((s) => `${s} a[href]`).join(", ")}`)
            .map((a) => accessibleName(a))
            .filter(Boolean),
        ),
      ).slice(0, 50),
    [],
  );
  const lists = safe(
    () =>
      queryAllDeep("ul, ol, [role=list]").filter(
        (l) => !l.closest(NAV_SELECTOR) && isVisible(l) && l.querySelectorAll(":scope > li, :scope > [role=listitem]").length >= 2,
      ).length,
    0,
  );
  const modals = safe(
    () => queryAllDeep(`${DIALOG_SELECTOR}, [aria-modal=true]`).filter((d) => isVisible(d)).length,
    0,
  );
  return {
    url,
    routeKey: rk,
    title: document.title,
    headings,
    nav,
    links: safe(discoverLinks, []),
    tables: safe(discoverTables, []),
    lists,
    modals,
    isLogin: forms.some((f) => f.isLogin),
    loadMs: safe(navigationLoadMs, null),
    forms,
    actions: safe(() => discoverActions(maxActions, rk, excluded), []),
  };
}
