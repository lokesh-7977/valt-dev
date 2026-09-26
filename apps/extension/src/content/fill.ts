import type { FillField, FillReport } from "../shared/messages.ts";
import { highlightElement, overlayMode } from "./overlay.ts";
import type { FieldElement } from "./selectors.ts";
import { isDisabled, isVisible, queryOne, queryScoped } from "./selectors.ts";

/**
 * Framework-safe filling and submitting. Values go through the native prototype setters so
 * React/Vue/Angular controlled inputs notice them, followed by input/change/blur events.
 * Submitting clicks the real button (or requestSubmit()) — never form.submit(), which would skip
 * validation and submit handlers.
 */

interface FilledEntry {
  key: string;
  selector: string;
  el: Element;
  /** Value before ALT touched it (what a reset form returns to). */
  initial: string;
  applied: string;
}

interface FillMemory {
  formSelector: string;
  entries: FilledEntry[];
}

let memory: FillMemory | null = null;

/** What ALT filled last (for `formReset` detection in observe.ts). */
export function lastFill(): FillMemory | null {
  return memory;
}

export function clearFillMemory(): void {
  memory = null;
}

const TRUE_WORDS = /^(true|1|on|yes|checked)$/i;

function nativeSetter(el: FieldElement): ((v: string) => void) | null {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  const set = desc?.set;
  return set ? (v: string) => set.call(el, v) : null;
}

function fire(el: Element, type: string, init: EventInit = {}): void {
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true, ...init }));
}

function fireInput(el: Element, data: string): void {
  let ev: Event;
  try {
    ev = new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText", data });
  } catch {
    ev = new Event("input", { bubbles: true, composed: true });
  }
  el.dispatchEvent(ev);
}

function focusEl(el: HTMLElement): void {
  let fired = false;
  const onFocus = (): void => {
    fired = true;
  };
  el.addEventListener("focus", onFocus, { once: true });
  try {
    el.focus({ preventScroll: true });
  } catch {
    // ignore
  }
  el.removeEventListener("focus", onFocus);
  // Unfocused windows (background tabs) may not dispatch focus events; frameworks still expect them.
  if (!fired) {
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
  }
}

function blurEl(el: HTMLElement): void {
  let fired = false;
  const onBlur = (): void => {
    fired = true;
  };
  el.addEventListener("blur", onBlur, { once: true });
  try {
    el.blur();
  } catch {
    // ignore
  }
  el.removeEventListener("blur", onBlur);
  if (!fired) {
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  }
}

/** Current value as ALT reports it: checkbox "true"/"false", radio group the checked value. */
export function readValue(els: Element[]): string {
  const first = els[0];
  if (!first) return "";
  if (first instanceof HTMLInputElement && first.type === "radio") {
    const checked = els.find((e): e is HTMLInputElement => e instanceof HTMLInputElement && e.checked);
    return checked ? checked.value : "";
  }
  if (first instanceof HTMLInputElement && first.type === "checkbox") return String(first.checked);
  if (first instanceof HTMLSelectElement && first.multiple) {
    return Array.from(first.selectedOptions)
      .map((o) => o.value)
      .join(",");
  }
  if (first instanceof HTMLInputElement || first instanceof HTMLSelectElement || first instanceof HTMLTextAreaElement) {
    return first.value;
  }
  return first.textContent ?? "";
}

/** The value a reset would restore (defaultValue / defaultChecked / defaultSelected). */
export function defaultValue(els: Element[]): string {
  const first = els[0];
  if (!first) return "";
  if (first instanceof HTMLInputElement && first.type === "radio") {
    const def = els.find((e): e is HTMLInputElement => e instanceof HTMLInputElement && e.defaultChecked);
    return def ? def.value : "";
  }
  if (first instanceof HTMLInputElement && first.type === "checkbox") return String(first.defaultChecked);
  if (first instanceof HTMLSelectElement) {
    const opts = Array.from(first.options);
    if (first.multiple) {
      return opts
        .filter((o) => o.defaultSelected)
        .map((o) => o.value)
        .join(",");
    }
    const def = opts.find((o) => o.defaultSelected) ?? (first.size <= 1 ? opts[0] : undefined);
    return def ? def.value : "";
  }
  if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) return first.defaultValue;
  return "";
}

function fillRadio(radios: HTMLInputElement[], value: string): { applied: string; matched: boolean } {
  const lower = value.trim().toLowerCase();
  const target =
    radios.find((r) => r.value === value) ??
    radios.find((r) => (r.labels?.[0]?.textContent ?? "").trim().toLowerCase() === lower) ??
    null;
  if (target && !target.disabled) {
    focusEl(target);
    if (!target.checked) target.click();
    if (!target.checked) {
      // A handler cancelled the click; set it directly so the case still runs as planned.
      target.checked = true;
      fire(target, "input");
      fire(target, "change");
    }
    blurEl(target);
  }
  return { applied: readValue(radios), matched: target !== null };
}

function fillOne(els: Element[], value: string): { applied: string; sanitized: boolean; error?: string } {
  const el = els[0];
  if (!el) return { applied: "", sanitized: false, error: "field not found" };
  if (el instanceof HTMLInputElement && el.type === "radio") {
    const radios = els.filter((e): e is HTMLInputElement => e instanceof HTMLInputElement && e.type === "radio");
    const { applied, matched } = fillRadio(radios, value);
    return { applied, sanitized: !matched || applied !== value, ...(matched ? {} : { error: "no radio option matches" }) };
  }
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
    return { applied: "", sanitized: false, error: "not a form field" };
  }
  if (isDisabled(el)) return { applied: readValue(els), sanitized: true, error: "field is disabled" };
  if (el instanceof HTMLInputElement && el.type === "file") {
    return { applied: el.value, sanitized: true, error: "file inputs cannot be filled" };
  }

  focusEl(el);
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    const want = TRUE_WORDS.test(value.trim());
    if (el.checked !== want) el.click();
    if (el.checked !== want) {
      el.checked = want;
      fire(el, "input");
      fire(el, "change");
    }
    blurEl(el);
    const applied = String(el.checked);
    return { applied, sanitized: applied !== String(want) };
  }

  if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options);
    const lower = value.trim().toLowerCase();
    const option =
      opts.find((o) => o.value === value) ?? opts.find((o) => (o.label || o.text).trim().toLowerCase() === lower) ?? null;
    const setter = nativeSetter(el);
    const next = option ? option.value : value;
    if (setter) setter(next);
    else el.value = next;
    fireInput(el, next);
    fire(el, "change");
    blurEl(el);
    const applied = el.value;
    // Matched by visible text counts as honoured; otherwise the browser kept another option.
    return { applied, sanitized: option === null || applied !== option.value };
  }

  const setter = nativeSetter(el);
  if (setter) setter(value);
  else el.value = value;
  fireInput(el, value);
  fire(el, "change");
  blurEl(el);
  const applied = el.value;
  return { applied, sanitized: applied !== value };
}

export function fillForm(formSelector: string, fields: FillField[]): { ok: boolean; reports: FillReport[]; error?: string } {
  const root = queryOne(formSelector);
  if (!root) return { ok: false, reports: [], error: `form not found: ${formSelector}` };
  const reports: FillReport[] = [];
  const entries: FilledEntry[] = [];
  const worker = overlayMode() === "worker";
  for (const field of fields) {
    try {
      const els = queryScoped(field.selector, root);
      const first = els[0];
      if (!first) {
        reports.push({ key: field.key, requested: field.value, applied: "", sanitized: false, ok: false, error: "field not found" });
        continue;
      }
      if (worker) {
        try {
          first.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch {
          // ignore
        }
        highlightElement(first);
      }
      const initial = defaultValue(els);
      const res = fillOne(els, field.value);
      entries.push({ key: field.key, selector: field.selector, el: first, initial, applied: res.applied });
      reports.push({
        key: field.key,
        requested: field.value,
        applied: res.applied,
        sanitized: res.sanitized,
        ok: res.error === undefined,
        ...(res.error ? { error: res.error } : {}),
      });
    } catch (e) {
      reports.push({
        key: field.key,
        requested: field.value,
        applied: "",
        sanitized: false,
        ok: false,
        error: e instanceof Error ? e.message : "fill failed",
      });
    }
  }
  memory = { formSelector, entries };
  return { ok: reports.every((r) => r.ok), reports };
}

export function submitForm(formSelector: string, submitSelector: string | null, times: 1 | 2): { ok: boolean; error?: string } {
  const root = queryOne(formSelector);
  const form = root instanceof HTMLFormElement ? root : null;
  const button = submitSelector ? (queryScoped(submitSelector, root)[0] ?? null) : null;
  if (submitSelector && !button && !form) return { ok: false, error: `submit control not found: ${submitSelector}` };
  if (!root && !button) return { ok: false, error: `form not found: ${formSelector}` };

  if (button instanceof HTMLElement) {
    if (isDisabled(button) || button.getAttribute("aria-disabled") === "true") {
      return { ok: false, error: "submit_disabled" };
    }
    highlightElement(button);
    // Synchronous clicks: times=2 is a real double-click race (no await between them).
    button.click();
    if (times === 2) button.click();
    return { ok: true };
  }
  if (form) {
    if (typeof form.requestSubmit !== "function") return { ok: false, error: "requestSubmit unsupported" };
    form.requestSubmit();
    if (times === 2) form.requestSubmit();
    return { ok: true };
  }
  return { ok: false, error: "no submit control for this form" };
}

/** Click an element (reach steps, action exploration). Refuses hidden or disabled targets. */
export function clickElement(selector: string): { ok: boolean; error?: string } {
  const target = queryOne(selector);
  if (!(target instanceof HTMLElement)) return { ok: false, error: `not found: ${selector}` };
  if (isDisabled(target) || target.getAttribute("aria-disabled") === "true") return { ok: false, error: "element is disabled" };
  if (!isVisible(target)) return { ok: false, error: "element is not visible" };
  if (overlayMode() === "worker") {
    try {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      // ignore
    }
    highlightElement(target);
  }
  target.click();
  return { ok: true };
}

export function queryElement(selector: string): { present: boolean; visible: boolean } {
  const target = queryOne(selector);
  return { present: target !== null, visible: target !== null && isVisible(target) };
}
