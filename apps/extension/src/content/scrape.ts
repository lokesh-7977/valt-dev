// DOM reading for captures: the form snapshot before submit, and the UI after it settles.
import type { CapturedSubmit } from "@valt/protocol";
import { redactField } from "./redact";

type Payload = CapturedSubmit["payload"];
type Field = Payload["form"]["fields"][number];

const OWN_HOST = "alt-root";
const GENERATED_ID = /\d{4,}|:r\d+:|__/;
const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "file"]);

const cssEscape = (s: string) =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, (c) => `\\${c}`);
const attrValue = (s: string) => (/^\w+$/.test(s) ? s : JSON.stringify(s));

const unique = (doc: Document, sel: string, el: Element) => {
  try {
    return el.matches(sel) && doc.querySelectorAll(sel).length === 1;
  } catch {
    return false;
  }
};

/** Short CSS path (max 4 levels) using :nth-of-type. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== "HTML" && parts.length < 4) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    const sameTag = parent ? [...parent.children].filter((c) => c.tagName === cur!.tagName) : [];
    parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(" > ");
}

/** Stable selector, by priority: data-testid, non-generated #id, [name], CSS path. */
export function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  const testId = el.getAttribute("data-testid");
  if (testId) {
    const s = `[data-testid=${attrValue(testId)}]`;
    if (unique(doc, s, el)) return s;
  }
  if (el.id && !GENERATED_ID.test(el.id)) {
    const s = `#${cssEscape(el.id)}`;
    if (unique(doc, s, el)) return s;
  }
  const name = el.getAttribute("name");
  if (name) {
    const s = `${el.tagName.toLowerCase()}[name=${attrValue(name)}]`;
    if (unique(doc, s, el)) return s;
  }
  return cssPath(el);
}

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** Label resolution: <label for>, aria-label, aria-labelledby, wrapping label, preceding text. */
export function resolveLabel(el: Element): string {
  const doc = el.ownerDocument;
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    const l = labels[0]!;
    // Prefer a text-only child (e.g. <span>Label</span>) over the whole label, which may include
    // the control's own text.
    const own = [...l.childNodes]
      .filter((n) => n !== el && !(n instanceof Element && n.matches("input,select,textarea,output")))
      .map((n) => (n.textContent ?? "").trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (own) return own;
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const t = labelledBy
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id)))
      .join(" ")
      .trim();
    if (t) return t;
  }
  const wrap = el.closest("label");
  if (wrap && text(wrap)) return text(wrap);
  // Nearest preceding text, skipping labels and controls that belong to other fields.
  let prev = el.previousElementSibling;
  while (prev) {
    const ownsControl = prev.matches("label, input, select, textarea, output, button") ||
      prev.querySelector("input, select, textarea, output, button");
    if (!ownsControl && text(prev)) return text(prev);
    prev = prev.previousElementSibling;
  }
  return "";
}

function fieldValue(el: Element): string {
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return String(el.checked);
    return el.value;
  }
  if (el instanceof HTMLSelectElement) return el.value;
  if (el instanceof HTMLTextAreaElement) return el.value;
  return text(el);
}

function fieldType(el: Element): string {
  if (el instanceof HTMLInputElement) return el.type || "text";
  return el.tagName.toLowerCase();
}

/** The container a submit belongs to: its form, else its closest data-testid ancestor, else body. */
export function formContainer(trigger: Element): { el: Element; selector: string } {
  const form = trigger.closest("form");
  if (form) return { el: form, selector: buildSelector(form) };
  const tagged = trigger.parentElement?.closest("[data-testid]");
  if (tagged) return { el: tagged, selector: buildSelector(tagged) };
  const body = trigger.ownerDocument.body;
  return { el: body, selector: "body" };
}

/** Snapshot the form fields before the app mutates them. Values are redacted here. */
export function scrapeForm(trigger: Element): Payload["form"] {
  const { el: container, selector } = formContainer(trigger);
  const fields: Field[] = [];
  for (const el of container.querySelectorAll("input, select, textarea, output")) {
    if (el.closest(OWN_HOST)) continue;
    const type = fieldType(el);
    if (SKIP_TYPES.has(type)) continue;
    const label = resolveLabel(el);
    const name = el.getAttribute("name") || el.id || el.getAttribute("data-testid") || label;
    if (!name) continue;
    fields.push(redactField({ name, label, type, value: fieldValue(el), selector: buildSelector(el) }));
  }
  return { selector, fields };
}

const TOASTS =
  "[role=status], [role=alert], [aria-live], .toast, .Toastify, .chakra-alert, .ant-message, [data-sonner-toast]";

/** The UI after the submit settled: toasts, field errors, current URL. */
export function scrapeAfter(doc: Document): Payload["uiAfter"] {
  const toasts = new Set<string>();
  for (const el of doc.querySelectorAll(TOASTS)) {
    if (el.closest(OWN_HOST)) continue;
    const t = text(el);
    if (t) toasts.add(t);
  }
  const fieldErrors: Payload["uiAfter"]["fieldErrors"] = [];
  const seen = new Set<Element>();
  for (const el of doc.querySelectorAll("[aria-invalid=true]")) {
    for (const id of (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
      const target = doc.getElementById(id);
      if (target && text(target) && !seen.has(target)) {
        seen.add(target);
        fieldErrors.push({ selector: buildSelector(el), text: text(target) });
      }
    }
  }
  for (const el of doc.querySelectorAll(".error, .invalid-feedback, .field-error")) {
    if (seen.has(el) || !text(el) || el.closest(OWN_HOST)) continue;
    seen.add(el);
    fieldErrors.push({ selector: buildSelector(el), text: text(el) });
  }
  return { toasts: [...toasts], fieldErrors, url: doc.location?.href ?? "" };
}
