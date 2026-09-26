// ALT side panel (T31/T32). Plain DOM + TypeScript. Renders the latest `state` pushed by the service
// worker over the `alt:panel` port and sends PanelRequests back. Updates are coalesced per frame
// and applied with keyed diffs so scroll position, open rows and focus survive frequent pushes.
import type { SessionExport } from "@valt/shared";
import type { PanelRequest } from "../shared/messages.ts";
import { createConnection, watchActiveTab } from "./connection.ts";
import { h, show } from "./dom.ts";
import { exportFileName } from "./format.ts";
import { hasData, isActive, type Ctx, type Model } from "./types.ts";
import { createFooter } from "./views/footer.ts";
import { createHeader } from "./views/header.ts";
import { createNow } from "./views/now.ts";
import { createScope } from "./views/scope.ts";
import { createSite } from "./views/site.ts";
import { createStats } from "./views/stats.ts";
import { createBanner, createStateCard } from "./views/states.ts";
import { createTabs } from "./views/tabs.ts";

const EXPORT_TIMEOUT_MS = 15_000;
const NOTICE_MS = 10_000;

const model: Model = {
  conn: "connecting",
  connMessage: null,
  snapshot: null,
  settings: null,
  tab: null,
  notice: null,
  exporting: false,
  exported: null,
};

let frame = 0;
function schedule(): void {
  if (frame) return;
  const run = (): void => {
    frame = 0;
    render();
  };
  frame = document.hidden ? window.setTimeout(run, 50) : requestAnimationFrame(run);
}

function update(patch: Partial<Model>): void {
  Object.assign(model, patch);
  schedule();
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notify(tone: "error" | "info", text: string): void {
  clearTimeout(noticeTimer);
  update({ notice: { tone, text } });
  noticeTimer = setTimeout(() => update({ notice: null }), NOTICE_MS);
}

let exportTimer: ReturnType<typeof setTimeout> | undefined;

function download(data: SessionExport): void {
  const name = exportFileName(data.snapshot.origin, data.exportedAt || Date.now());
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = h("a", { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  update({ exporting: false, exported: name });
}

const connection = createConnection({
  onState(snapshot, settings) {
    update({ snapshot, settings, conn: "open", connMessage: null });
  },
  onExport(data) {
    clearTimeout(exportTimer);
    download(data);
  },
  onError(message) {
    if (model.exporting) {
      clearTimeout(exportTimer);
      model.exporting = false;
    }
    notify("error", message);
  },
  onStatus(conn, message) {
    update({ conn, connMessage: message });
  },
});

const ctx: Ctx = {
  model,
  send(req: PanelRequest) {
    if (!connection.send(req)) update({ conn: "lost", connMessage: "Lost the connection to ALT's background worker." });
  },
  enableActiveTab() {
    const tab = model.tab;
    if (!tab?.web || !tab.origin) return;
    ctx.send({ type: "enable", origin: tab.origin, url: tab.url, tabId: tab.id });
  },
  retry() {
    connection.reconnect();
  },
  exportSession() {
    if (model.exporting || model.conn !== "open") return;
    update({ exporting: true, exported: null });
    ctx.send({ type: "export" });
    clearTimeout(exportTimer);
    exportTimer = setTimeout(() => {
      if (!model.exporting) return;
      model.exporting = false;
      notify("error", "Export timed out. Try again in a moment.");
    }, EXPORT_TIMEOUT_MS);
  },
  dismissNotice() {
    clearTimeout(noticeTimer);
    update({ notice: null });
  },
};

// ---------- layout ----------

const header = createHeader();
const banner = createBanner(ctx);
const stateCard = createStateCard(ctx);
const site = createSite(ctx);
const scope = createScope(ctx);
const now = createNow(ctx);
const stats = createStats();
const tabs = createTabs();
const footer = createFooter(ctx);

const main = h("main", { class: "main", id: "main" }, banner.el, stateCard.el, site.el, now.el, stats.el, scope.el, tabs.el);
const root = document.getElementById("app") ?? document.body.appendChild(h("div", { id: "app" }));
root.replaceChildren(header.el, main, footer.el);

function render(): void {
  const m = model;
  const ready = m.snapshot !== null && m.settings !== null;
  const active = isActive(m.snapshot);
  const data = hasData(m.snapshot);

  header.render(m);
  banner.render(m);

  show(stateCard.el, !ready);
  if (!ready) stateCard.render(m);

  show(site.el, ready);
  show(scope.el, ready && (m.tab?.web === true || active));
  show(now.el, ready && (active || data));
  show(stats.el, ready && (active || data));
  show(tabs.el, ready && (active || data));
  if (ready) {
    site.render(m);
    if (!scope.el.hidden) scope.render(m);
    if (!now.el.hidden) now.render(m);
    if (!stats.el.hidden) stats.render(m);
    if (!tabs.el.hidden) tabs.render(m);
  }
  footer.render(m);
  document.documentElement.dataset.status = m.snapshot?.status ?? "none";
}

watchActiveTab((tab) => update({ tab }));
render();
