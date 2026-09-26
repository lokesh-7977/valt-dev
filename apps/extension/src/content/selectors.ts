/**
 * Stable CSS selectors, visibility, and DOM traversal helpers for the isolated-world content
 * script. Selectors must resolve to the same element on a fresh load of the same page, so they
 * prefer author-chosen hooks (id, name, data-testid, aria-label, href) over structural paths.
 *
 * Elements inside open shadow roots get a `host >>> inner` selector; resolve those with
 * `queryOne` / `queryAll` (plain `document.querySelector` does not understand `>>>`).
 */

export const OVERLAY_ATTR = "data-alt-overlay";

export const FIELD_SELECTOR = "input, select, textarea";

/** Input types that are never data fields. */
const NON_FIELD_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

export function isAltOverlay(node: Node | null | undefined): boolean {
  if (!node) return false;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return false;
  // The overlay lives in a closed shadow root, so only its host is reachable from the page tree.
  const root = el.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : null;
  return el.closest(`[${OVERLAY_ATTR}]`) !== null || (host !== null && host.closest(`[${OVERLAY_ATTR}]`) !== null);
}

export type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function isFieldElement(el: Element): el is FieldElement {
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !NON_FIELD_TYPES.has(el.type.toLowerCase());
}

export function isDisabled(el: Element): boolean {
  try {
    return el.matches(":disabled");
  } catch {
    return false;
  }
}

/** Rendered, not display:none / visibility:hidden, and has a box. Opacity is ignored on purpose. */
export function isVisible(el: Element | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  if (typeof el.checkVisibility === "function") {
    if (!el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/** Field visibility: small custom-styled checkboxes/radios count as visible when their label is. */
export function isFieldVisible(el: FieldElement): boolean {
  if (isVisible(el)) return true;
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    const labels = el.labels ? Array.from(el.labels) : [];
    return labels.some((l) => isVisible(l));
  }
  return false;
}

// ---------------------------------------------------------------- selectors ----

const GENERATED_PREFIX =
  /^(radix|headlessui|mui|react-select|react-aria|downshift|rc-|ember|ext-gen|yui|ng-|mat-|cdk-|el-|__|tippy-)/i;

/** Framework-generated ids change between loads, so they make bad selectors and keys. */
function looksGenerated(id: string): boolean {
  if (!id || id.length > 64 || /\s/.test(id)) return true;
  if (id.startsWith(":")) return true; // React useId (":r1:")
  if (/\d{4,}/.test(id)) return true;
  if (GENERATED_PREFIX.test(id)) return true;
  // Random-looking runs: 8+ hex chars, or a 6+ char suffix mixing letters and digits.
  const hex = id.match(/[0-9a-f]{8,}/i)?.[0];
  if (hex && /\d/.test(hex) && /[a-f]/i.test(hex)) return true;
  const suffix = id.match(/[-_]([a-z0-9]{6,})$/i)?.[1];
  return Boolean(suffix && /\d/.test(suffix) && /[a-z]/i.test(suffix));
}

type QueryRoot = Document | ShadowRoot | Element;

function uniqueIn(root: QueryRoot, sel: string, el: Element): boolean {
  try {
    const all = root.querySelectorAll(sel);
    return all.length === 1 && all[0] === el;
  } catch {
    return false;
  }
}

function attrSel(tag: string, attr: string, value: string): string {
  return `${tag}[${attr}="${CSS.escape(value)}"]`;
}

/** `tag:nth-of-type(n)` chain up to an ancestor with a stable id (or the root). */
function pathSelector(el: Element, root: Document | ShadowRoot): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    const id = cur.id;
    if (cur !== el && id && !looksGenerated(id) && uniqueIn(root, `#${CSS.escape(id)}`, cur)) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const parentEl: Element | null = cur.parentElement;
    if (!parentEl) {
      parts.unshift(tag);
      break;
    }
    if (tag === "body" || tag === "html") {
      parts.unshift(tag);
      break;
    }
    let index = 1;
    let sib = cur.previousElementSibling;
    while (sib) {
      if (sib.tagName === cur.tagName) index++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${tag}:nth-of-type(${index})`);
    cur = parentEl;
  }
  return parts.join(" > ");
}

function selectorInRoot(el: Element, root: Document | ShadowRoot): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id;
  if (id && !looksGenerated(id)) {
    const sel = `#${CSS.escape(id)}`;
    if (uniqueIn(root, sel, el)) return sel;
  }
  const name = el.getAttribute("name");
  if (name) {
    const sel = attrSel(tag, "name", name);
    if (uniqueIn(root, sel, el)) return sel;
    // Same name in several forms: scope by the owning form when that is stable.
    const form = (el as HTMLInputElement).form;
    if (form && form.id && !looksGenerated(form.id)) {
      const scoped = `#${CSS.escape(form.id)} ${sel}`;
      if (uniqueIn(root, scoped, el)) return scoped;
    }
  }
  for (const attr of ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa"]) {
    const v = el.getAttribute(attr);
    if (v) {
      const sel = `[${attr}="${CSS.escape(v)}"]`;
      if (uniqueIn(root, sel, el)) return sel;
    }
  }
  const aria = el.getAttribute("aria-label");
  if (aria) {
    const sel = attrSel(tag, "aria-label", aria);
    if (uniqueIn(root, sel, el)) return sel;
  }
  // The submit button of a form with a stable id: `#invoice-form button[type="submit"]`.
  const owner = (el as HTMLButtonElement).form;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if ((tag === "button" || tag === "input") && type === "submit" && owner && owner.id && !looksGenerated(owner.id)) {
    const scoped = `#${CSS.escape(owner.id)} ${tag}[type="submit"]`;
    if (uniqueIn(root, scoped, el)) return scoped;
  }
  if (tag === "a") {
    const href = el.getAttribute("href");
    if (href && href !== "#" && !href.startsWith("javascript:")) {
      const sel = attrSel("a", "href", href);
      if (uniqueIn(root, sel, el)) return sel;
    }
  }
  return pathSelector(el, root);
}

/** A selector that matches exactly `el` (verified), stable across fresh loads where possible. */
export function cssSelectorFor(el: Element): string {
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    return `${cssSelectorFor(root.host)} >>> ${selectorInRoot(el, root)}`;
  }
  return selectorInRoot(el, document);
}

/** Resolve a selector produced by `cssSelectorFor` (supports `>>>` into open shadow roots). */
export function queryAll(selector: string, scope: ParentNode = document): Element[] {
  const parts = selector.split(/\s*>>>\s*/);
  let roots: ParentNode[] = [scope];
  let found: Element[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    found = [];
    for (const r of roots) {
      try {
        found.push(...Array.from(r.querySelectorAll(part)));
      } catch {
        return [];
      }
    }
    if (i < parts.length - 1) {
      roots = found.map((e) => e.shadowRoot).filter((s): s is ShadowRoot => s !== null);
    }
  }
  return found;
}

export function queryOne(selector: string | null | undefined, scope: ParentNode = document): Element | null {
  if (!selector) return null;
  return queryAll(selector, scope)[0] ?? null;
}

/** Resolve within `scope` first, then the whole document. */
export function queryScoped(selector: string, scope: Element | null): Element[] {
  if (scope) {
    const inScope = queryAll(selector, scope);
    if (inScope.length) return inScope;
  }
  return queryAll(selector, document);
}

/** All open shadow roots under `root` (recursive). */
export function openShadowRoots(root: Document | ShadowRoot = document): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const visit = (r: Document | ShadowRoot): void => {
    const walker = document.createTreeWalker(r, NodeFilter.SHOW_ELEMENT);
    let n = walker.nextNode();
    while (n) {
      const sr = (n as Element).shadowRoot;
      if (sr && !isAltOverlay(n)) {
        out.push(sr);
        visit(sr);
      }
      n = walker.nextNode();
    }
  };
  visit(root);
  return out;
}

/** querySelectorAll across the document and every open shadow root; the ALT overlay is excluded. */
export function queryAllDeep(selector: string, root: Document | ShadowRoot = document): Element[] {
  const out: Element[] = [];
  const roots: Array<Document | ShadowRoot> = [root, ...openShadowRoots(root)];
  for (const r of roots) {
    try {
      for (const el of Array.from(r.querySelectorAll(selector))) {
        if (!isAltOverlay(el)) out.push(el);
      }
    } catch {
      // invalid selector
    }
  }
  return out;
}

// ------------------------------------------------------------------- keys ----

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Field key: name, else id, else label slug, else `field_<index>`. Callers de-duplicate. */
export function fieldKey(el: Element, index: number, label?: string | null): string {
  const name = el.getAttribute("name");
  if (name && name.trim()) return name.trim();
  const id = el.id;
  if (id && id.trim() && !looksGenerated(id)) return id.trim();
  const s = label ? slug(label) : "";
  if (s) return s;
  if (id && id.trim()) return id.trim();
  return `field_${index}`;
}

/**
 * The wrapper that belongs to exactly one field (e.g. `.field` holding label, control, hint and
 * error text). Stops below the form. Null when the field shares its parent with other fields.
 */
export function fieldContainer(el: Element): Element | null {
  const radioName = el instanceof HTMLInputElement && el.type === "radio" ? el.name : null;
  let best: Element | null = null;
  let cur = el.parentElement;
  for (let depth = 0; cur && depth < 4; depth++) {
    const tag = cur.tagName;
    if (tag === "FORM" || tag === "BODY" || tag === "HTML" || cur.matches("dialog, [role=dialog]")) break;
    const fields = Array.from(cur.querySelectorAll(FIELD_SELECTOR)).filter(isFieldElement);
    const others = fields.filter(
      (f) => f !== el && !(radioName && f instanceof HTMLInputElement && f.type === "radio" && f.name === radioName),
    );
    if (others.length > 0) break;
    best = cur;
    cur = cur.parentElement;
  }
  return best;
}

export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
  return `${tag}${id}${cls}`;
}
