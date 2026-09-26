import type { FieldMessage, PageMessage } from "@valt/shared";
import type { ObserveSnapshot } from "../shared/messages.ts";
import { defaultValue, lastFill, readValue } from "./fill.ts";
import { accessibleLabel, collapse, textOf } from "./labels.ts";
import type { FieldElement } from "./selectors.ts";
import {
  FIELD_SELECTOR,
  fieldContainer,
  fieldKey,
  isAltOverlay,
  isFieldElement,
  isVisible,
  queryAllDeep,
  queryOne,
  queryScoped,
} from "./selectors.ts";

/**
 * What happened after ALT acted: validation, toasts/alerts, form reset, DOM activity.
 *
 * Event-driven only. The service worker owns time: it polls `snapshot()` and decides when the page
 * has settled from `quietMs`. Background tabs throttle page timers, so this module never schedules
 * anything itself.
 */

const MESSAGE_SELECTOR = [
  "[role=alert]",
  "[role=status]",
  "[role=alertdialog]",
  "[aria-live]:not([aria-live=off])",
  "output",
  ".toast",
  ".alert",
  ".notification",
  ".snackbar",
  ".flash",
  "[class*=toast]",
  "[class*=Toast]",
  "[class*=alert]",
  "[class*=notification]",
  "[class*=snackbar]",
  "[class*=flash]",
  "[data-sonner-toast]",
].join(", ");

const FIELD_ERROR_SELECTOR =
  ".field-error, .invalid-feedback, .error-message, .form-error, .help-block.error, [class*=error], [class*=Error], [role=alert]";

const MAX_MESSAGE_TEXT = 300;

const SUCCESS_RE = /\b(saved|created|success|successful|successfully|updated|added|thank|thanks|done|sent|welcome)\b/i;
const ERROR_RE =
  /\b(error|errors|fail|failed|failure|invalid|required|must|cannot|can't|could not|couldn't|not allowed|already exists|denied|unable|wrong|exception|sqlstate)\b/i;

// ------------------------------------------------------ mutation tracking ----

let lastMutationAt = typeof performance !== "undefined" ? performance.now() : 0;
let mutations = 0;
let tracker: MutationObserver | null = null;

function onMutations(records: MutationRecord[]): void {
  let relevant = 0;
  for (const r of records) {
    if (isAltOverlay(r.target)) continue;
    if (r.type === "childList") {
      const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
      if (nodes.length > 0 && nodes.every((n) => isAltOverlay(n) || (n instanceof Element && n.hasAttribute("data-alt-overlay")))) continue;
    }
    relevant++;
  }
  if (relevant > 0) {
    lastMutationAt = performance.now();
    mutations += relevant;
  }
}

/** Start the always-on DOM activity tracker (called once at content-script start). */
export function startMutationTracking(): void {
  if (tracker) return;
  lastMutationAt = performance.now();
  tracker = new MutationObserver(onMutations);
  tracker.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
}

export function stopMutationTracking(): void {
  tracker?.disconnect();
  tracker = null;
  endObservation();
}

// ------------------------------------------------------------ observation ----

interface Observation {
  formSelector: string | null;
  fields: Array<{ key: string; selector: string }>;
  /** Visible message elements and their text when observation began. */
  baseline: Map<Element, string>;
  clientInvalid: boolean;
  invalid: Array<{ el: Element; message: string }>;
  mutationsAtStart: number;
  onInvalid: (e: Event) => void;
}

let current: Observation | null = null;

function visibleMessages(): Array<{ el: Element; text: string }> {
  const out: Array<{ el: Element; text: string }> = [];
  const seenText = new Set<string>();
  for (const el of queryAllDeep(MESSAGE_SELECTOR)) {
    if (!isVisible(el) || el.matches(FIELD_SELECTOR)) continue;
    const text = textOf(el, { visibleOnly: true }, MAX_MESSAGE_TEXT + 1);
    if (!text || text.length > MAX_MESSAGE_TEXT) continue; // big live regions are layouts, not messages
    if (seenText.has(text)) continue; // nested candidates (".alert" inside "[role=alert]")
    seenText.add(text);
    out.push({ el, text });
  }
  return out;
}

function toneOf(el: Element, text: string): PageMessage["tone"] {
  const classes = (typeof el.className === "string" ? el.className : "").toLowerCase().split(/\s+/);
  const clsTone = classes.some((c) => /(error|danger|fail|invalid|negative|destructive)/.test(c))
    ? "error"
    : classes.some((c) => /(success|positive|saved|confirmed)/.test(c))
      ? "success"
      : null;
  const ok = SUCCESS_RE.test(text);
  const bad = ERROR_RE.test(text);
  if (bad && !ok) return "error";
  if (ok && !bad) return "success";
  if (ok && bad) return clsTone ?? "error";
  if (clsTone) return clsTone;
  if (el.getAttribute("role") === "alert" || el.getAttribute("role") === "alertdialog") return "error";
  return "neutral";
}

export function beginObservation(formSelector: string | null, fields: Array<{ key: string; selector: string }>): void {
  endObservation();
  const baseline = new Map<Element, string>();
  for (const m of visibleMessages()) baseline.set(m.el, m.text);
  const obs: Observation = {
    formSelector,
    fields,
    baseline,
    clientInvalid: false,
    invalid: [],
    mutationsAtStart: mutations,
    onInvalid: (e: Event) => {
      obs.clientInvalid = true;
      const t = e.target;
      if (t instanceof Element && isFieldElement(t)) {
        obs.invalid.push({ el: t, message: collapse((t as FieldElement).validationMessage, 200) });
      }
    },
  };
  document.addEventListener("invalid", obs.onInvalid, true);
  current = obs;
}

export function endObservation(): void {
  if (current) document.removeEventListener("invalid", current.onInvalid, true);
  current = null;
}

// -------------------------------------------------------------- snapshot ----

interface TrackedField {
  key: string;
  els: Element[];
}

function trackedFields(root: Element | null): TrackedField[] {
  if (current && current.fields.length) {
    return current.fields.map((f) => ({ key: f.key, els: queryScoped(f.selector, root) }));
  }
  // No observation in this document (e.g. after a full navigation): derive from the form or page.
  const scope: ParentNode = root ?? document;
  const out: TrackedField[] = [];
  const radios = new Map<string, TrackedField>();
  let i = 0;
  for (const el of Array.from(scope.querySelectorAll(FIELD_SELECTOR))) {
    if (!isFieldElement(el) || isAltOverlay(el)) continue;
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      const g = radios.get(el.name);
      if (g) {
        g.els.push(el);
        continue;
      }
      const t = { key: el.name, els: [el as Element] };
      radios.set(el.name, t);
      out.push(t);
      continue;
    }
    out.push({ key: fieldKey(el, i++, accessibleLabel(el).label), els: [el] });
  }
  return out;
}

function idrefTexts(el: Element, attr: string): string {
  const ids = (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean);
  return collapse(
    ids
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => e !== null && isVisible(e))
      .map((e) => textOf(e))
      .join(" "),
  );
}

/** Visible error text that belongs to a field: #<id>-error or error elements in its wrapper. */
function nearbyErrorText(el: Element): string {
  if (el.id) {
    const byId = document.getElementById(`${el.id}-error`);
    if (byId && isVisible(byId)) {
      const t = textOf(byId);
      if (t) return t;
    }
  }
  const container = fieldContainer(el);
  if (!container) return "";
  for (const e of Array.from(container.querySelectorAll(FIELD_ERROR_SELECTOR))) {
    if (e.matches(FIELD_SELECTOR) || !isVisible(e)) continue;
    const t = textOf(e, { visibleOnly: true }, 200);
    if (t) return t;
  }
  return "";
}

function validationMessages(root: Element | null, fields: TrackedField[]): FieldMessage[] {
  const out: FieldMessage[] = [];
  const seen = new Set<string>();
  const add = (m: FieldMessage): void => {
    const k = `${m.fieldKey ?? ""}\u0000${m.message}`;
    if (!m.message || seen.has(k)) return;
    seen.add(k);
    out.push(m);
  };
  const keyOf = new Map<Element, string>();
  for (const f of fields) for (const e of f.els) keyOf.set(e, f.key);

  const form = root instanceof HTMLFormElement ? root : null;
  const validates = form ? !form.noValidate : false;

  // 1. Native constraint validation.
  if (current) {
    for (const inv of current.invalid) add({ fieldKey: keyOf.get(inv.el) ?? null, message: inv.message, source: "native" });
  }
  if (validates) {
    for (const f of fields) {
      for (const e of f.els) {
        if (!isFieldElement(e)) continue;
        const fe = e as FieldElement;
        if (fe.willValidate && !fe.validity.valid && fe.validationMessage) {
          add({ fieldKey: f.key, message: collapse(fe.validationMessage, 200), source: "native" });
          break;
        }
      }
    }
  }

  // 2. aria-invalid fields (tracked ones plus any in the form/page).
  const scope: ParentNode = root ?? document;
  const ariaInvalid = new Set<Element>(Array.from(scope.querySelectorAll("[aria-invalid=true]")).filter((e) => !isAltOverlay(e)));
  for (const f of fields) for (const e of f.els) if (e.getAttribute("aria-invalid") === "true") ariaInvalid.add(e);
  for (const e of ariaInvalid) {
    const message =
      idrefTexts(e, "aria-errormessage") || idrefTexts(e, "aria-describedby") || nearbyErrorText(e) || "Marked invalid (aria-invalid)";
    add({ fieldKey: keyOf.get(e) ?? (isFieldElement(e) ? fieldKey(e, 0, null) : null), message: collapse(message, 200), source: "aria-invalid" });
  }

  // 3. Visible error text next to fields.
  for (const f of fields) {
    const e = f.els[0];
    if (!e || ariaInvalid.has(e)) continue;
    const t = nearbyErrorText(e);
    if (t) add({ fieldKey: f.key, message: collapse(t, 200), source: "text" });
  }
  return out;
}

function isResetNow(): boolean {
  const mem = lastFill();
  if (!mem || mem.entries.length === 0) return false;
  const root = queryOne(mem.formSelector);
  if (!root || !isVisible(root)) return false;
  let changed = false;
  for (const entry of mem.entries) {
    if (entry.applied !== entry.initial) changed = true;
    const els = queryScoped(entry.selector, root);
    if (els.length === 0) return false;
    const now = readValue(els);
    if (now !== defaultValue(els) && now !== entry.initial) return false;
  }
  return changed;
}

export function snapshot(): ObserveSnapshot {
  const formSelector = current?.formSelector ?? lastFill()?.formSelector ?? null;
  const root = formSelector ? queryOne(formSelector) : null;
  const fields = trackedFields(root);

  const messages: PageMessage[] = [];
  for (const m of visibleMessages()) {
    if (current && current.baseline.get(m.el) === m.text) continue;
    messages.push({ text: m.text, tone: toneOf(m.el, m.text) });
  }

  const fieldValues: Record<string, string> = {};
  for (const f of fields) {
    if (f.els.length === 0) continue;
    try {
      fieldValues[f.key] = readValue(f.els);
    } catch {
      // ignore
    }
  }

  let formReset = false;
  try {
    formReset = isResetNow();
  } catch {
    formReset = false;
  }

  return {
    url: location.href,
    formPresent: root !== null && isVisible(root),
    clientInvalid: current?.clientInvalid ?? false,
    validationMessages: validationMessages(root, fields),
    messages,
    formReset,
    quietMs: Math.max(0, Math.round(performance.now() - lastMutationAt)),
    mutations: mutations - (current?.mutationsAtStart ?? 0),
    fieldValues,
  };
}
