import type { OverlayState } from "../shared/messages.ts";
import { OVERLAY_ATTR, queryOne } from "./selectors.ts";

/**
 * ALT's in-page overlay: the worker pill ("ALT · Testing Create invoice · case 3/24" plus a detail
 * line), an outline around the field being worked on, and the small "ALT watching" pill on
 * developer tabs.
 *
 * - Closed shadow root, so page CSS/JS can't reach in and discovery/health never see its contents.
 * - `pointer-events: none`, `inert`, `aria-hidden`: it never takes clicks, focus or screen-reader
 *   attention, and never changes what `elementFromPoint` returns.
 * - MASTER tokens: #0071E3 as the single accent, grayscale surfaces, system font stack, 12px radius on
 *   the highlight, fully rounded pill, --ease-out-expo / --ease-standard motion, reduced motion honoured.
 * - Styles come from a constructed stylesheet (not an inline <style>) so strict page CSPs don't block them.
 */

const CSS_TEXT = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --accent: #0071E3;
  --surface: rgba(255, 255, 255, 0.86);
  --surface-solid: #FFFFFF;
  --fg: #1D1D1F;
  --muted: #6E6E73;
  --hairline: rgba(0, 0, 0, 0.06);
  --shadow: 0 4px 12px rgb(0 0 0 / .08), 0 16px 48px rgb(0 0 0 / .12);
  --ease-standard: cubic-bezier(0.25, 0.1, 0.25, 1);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  pointer-events: none;
}
@media (prefers-color-scheme: dark) {
  .root {
    --surface: rgba(28, 28, 30, 0.86);
    --surface-solid: #1C1C1E;
    --fg: #F5F5F7;
    --muted: #86868B;
    --hairline: #38383A;
  }
}
.pill {
  position: fixed;
  right: 16px;
  bottom: 16px;
  max-width: min(440px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--surface-solid);
  color: var(--fg);
  box-shadow: var(--shadow);
  border: 1px solid var(--hairline);
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 250ms var(--ease-out-expo), transform 250ms var(--ease-out-expo);
}
@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .pill {
    background: var(--surface);
    -webkit-backdrop-filter: blur(20px) saturate(1.5);
    backdrop-filter: blur(20px) saturate(1.5);
  }
}
.pill.detailed { border-radius: 22px; padding: 10px 18px; }
.pill.on { opacity: 1; transform: none; }
.line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent);
}
.brand { flex: none; font-size: 13px; line-height: 1.38; font-weight: 600; letter-spacing: 0; }
.text {
  min-width: 0;
  font-size: 13px;
  line-height: 1.38;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail {
  padding-left: 16px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.38;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail:empty { display: none; }
.highlight {
  position: fixed;
  left: 0;
  top: 0;
  border: 2px solid var(--accent);
  border-radius: 12px;
  box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.25);
  opacity: 0;
  transition: opacity 150ms var(--ease-standard), transform 250ms var(--ease-standard);
}
.highlight.on { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .pill { transform: none; transition: opacity 150ms linear; }
  .highlight { transition: opacity 150ms linear; }
}
`;

interface OverlayDom {
  host: HTMLElement;
  pill: HTMLElement;
  text: HTMLElement;
  detail: HTMLElement;
  highlight: HTMLElement;
}

let dom: OverlayDom | null = null;
let mode: OverlayState["mode"] = "hidden";
let highlighted: Element | null = null;
let listening = false;

function el(tag: string, cls: string, parent: Node): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

function setImportant(e: HTMLElement, props: Record<string, string>): void {
  for (const [k, v] of Object.entries(props)) e.style.setProperty(k, v, "important");
}

function ensureDom(): OverlayDom {
  if (dom) {
    if (!dom.host.isConnected) document.documentElement.appendChild(dom.host);
    return dom;
  }
  const host = document.createElement("div");
  host.setAttribute(OVERLAY_ATTR, "");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  // Zero-size fixed host: never causes overflow, never intercepts pointer events.
  setImportant(host, {
    all: "initial",
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    overflow: "visible",
    "pointer-events": "none",
    "z-index": "2147483647",
    display: "block",
  });
  const shadow = host.attachShadow({ mode: "closed" });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS_TEXT);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    shadow.appendChild(style);
  }
  const root = el("div", "root", shadow);
  const highlight = el("div", "highlight", root);
  const pill = el("div", "pill", root);
  const line = el("div", "line", pill);
  el("span", "dot", line);
  const brand = el("span", "brand", line);
  brand.textContent = "ALT";
  const text = el("span", "text", line);
  const detail = el("div", "detail", pill);
  document.documentElement.appendChild(host);
  dom = { host, pill, text, detail, highlight };
  return dom;
}

function positionHighlight(): void {
  if (!dom) return;
  const target = highlighted;
  if (!target || !target.isConnected || mode !== "worker") {
    dom.highlight.classList.remove("on");
    return;
  }
  const r = target.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) {
    dom.highlight.classList.remove("on");
    return;
  }
  const pad = 4;
  dom.highlight.style.width = `${Math.round(r.width + pad * 2)}px`;
  dom.highlight.style.height = `${Math.round(r.height + pad * 2)}px`;
  dom.highlight.style.transform = `translate(${Math.round(r.left - pad)}px, ${Math.round(r.top - pad)}px)`;
  dom.highlight.classList.add("on");
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("scroll", positionHighlight, { capture: true, passive: true });
  window.addEventListener("resize", positionHighlight, { passive: true });
}

function unlisten(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener("scroll", positionHighlight, { capture: true });
  window.removeEventListener("resize", positionHighlight);
}

function showPill(d: OverlayDom, text: string, detail: string): void {
  d.text.textContent = text;
  d.detail.textContent = detail;
  d.pill.classList.toggle("detailed", Boolean(detail));
  if (!d.pill.classList.contains("on")) {
    void d.pill.offsetWidth; // commit the start state so the entrance transition runs
    d.pill.classList.add("on");
  }
}

/** Strip a leading "ALT ·" so the brand label isn't doubled. */
function body(text: string): string {
  return text.replace(/^\s*ALT\b\s*[·:|-]?\s*/i, "").trim();
}

export function overlayMode(): OverlayState["mode"] {
  return mode;
}

export function setOverlay(state: OverlayState): void {
  mode = state.mode;
  if (state.mode === "hidden") {
    highlighted = null;
    unlisten();
    if (dom) {
      dom.host.remove();
      dom = null;
    }
    return;
  }
  const d = ensureDom();
  if (state.mode === "watching") {
    highlighted = null;
    unlisten();
    positionHighlight();
    showPill(d, body(state.text) || "watching", "");
    return;
  }
  showPill(d, body(state.text), state.detail ?? "");
  highlighted = state.highlightSelector ? queryOne(state.highlightSelector) : null;
  listen();
  positionHighlight();
}

/** Outline the element ALT is working on (worker mode only). */
export function highlightElement(target: Element | null): void {
  if (mode !== "worker") return;
  highlighted = target;
  positionHighlight();
}

export function destroyOverlay(): void {
  setOverlay({ mode: "hidden" });
}
