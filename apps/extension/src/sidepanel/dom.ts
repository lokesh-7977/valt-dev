// Tiny DOM toolkit for the side panel: element factory, idempotent setters, and a keyed list
// reconciler so frequent state pushes never reset scroll position, open disclosures or focus.

export type Child = Node | string | number | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Record<string, AttrValue | ((e: Event) => void)>;

/** `h("button", {class: "btn", onClick: fn, disabled: true}, "Label")`. Text children are never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
        continue;
      }
      if (v === false || v === null || v === undefined) continue;
      if (k === "class") el.className = String(v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export function show(el: HTMLElement, visible: boolean): void {
  if (el.hidden === visible) el.hidden = !visible;
}

let uid = 0;
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * Replace a container's children, then put focus back on the element with the same `data-fk`
 * (focus key) if focus was inside. Used for small cards whose structure changes with state.
 */
export function rebuild(container: HTMLElement, children: readonly Child[]): void {
  const active = document.activeElement;
  const fk = active instanceof HTMLElement && container.contains(active) ? active.dataset.fk : undefined;
  const hadFocus = active instanceof HTMLElement && container.contains(active);
  container.replaceChildren();
  append(container, children);
  if (!hadFocus) return;
  const target =
    (fk ? container.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`) : null) ??
    container.querySelector<HTMLElement>("[data-fk]:not(:disabled)");
  target?.focus();
}

interface Entry {
  el: HTMLElement;
  sig: string | null;
}

const registry = new WeakMap<HTMLElement, Map<string, Entry>>();

export interface ReconcileOptions<T> {
  key(item: T): string;
  create(item: T): HTMLElement;
  /** Change signature. Omit to call `update` on every pass (for containers with nested lists). */
  sig?(item: T): string;
  /** Patch the existing element in place. Without it, a changed item is re-created. */
  update?(el: HTMLElement, item: T): void;
}

/** Keyed, order-preserving list diff. Existing elements are kept (and patched), never rebuilt wholesale. */
export function reconcile<T>(parent: HTMLElement, items: readonly T[], opts: ReconcileOptions<T>): void {
  const prev = registry.get(parent) ?? new Map<string, Entry>();
  const next = new Map<string, Entry>();
  let cursor: ChildNode | null = parent.firstChild;

  for (const item of items) {
    const k = opts.key(item);
    if (next.has(k)) continue;
    const s = opts.sig ? opts.sig(item) : null;
    let entry = prev.get(k);
    if (!entry) {
      entry = { el: opts.create(item), sig: s };
    } else if (s === null || entry.sig !== s) {
      if (opts.update) {
        opts.update(entry.el, item);
        entry.sig = s;
      } else {
        const old = entry.el;
        const fresh = opts.create(item);
        if (cursor === old) cursor = fresh;
        old.replaceWith(fresh);
        entry = { el: fresh, sig: s };
      }
    }
    next.set(k, entry);
    if (entry.el === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(entry.el, cursor);
  }

  for (const [k, e] of prev) if (!next.has(k)) e.el.remove();
  registry.set(parent, next);
}
