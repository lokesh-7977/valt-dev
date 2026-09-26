import { h, setAttr, setText } from "../dom.ts";
import { PHASE_LABEL } from "../format.ts";
import { icon } from "../icons.ts";
import type { Ctx, Model, View } from "../types.ts";

/** "Now" card: what ALT is doing this second, with progress and a way to watch it happen. */
export function createNow(ctx: Ctx): View {
  const eyebrow = h("span", { class: "eyebrow" });
  const pulse = h("span", { class: "pulse", "aria-hidden": "true" });
  const label = h("p", { class: "t-title3 now-label" });
  const detail = h("p", { class: "t-callout muted now-detail" });
  const route = h("p", { class: "t-footnote mono muted now-route" });
  const live = h("div", { class: "now-live", "aria-live": "polite", "aria-atomic": "true" }, label, detail);
  const fill = h("span", { class: "progress-fill" });
  const progress = h("div", { class: "progress", role: "progressbar", "aria-label": "Test progress" }, fill);
  const watch = h(
    "button",
    {
      class: "btn btn-ghost btn-compact watch",
      type: "button",
      title: "Show the tab ALT is working in",
      onClick: () => ctx.send({ type: "focus-worker" }),
    },
    icon("eye", 16),
    "Watch ALT",
  );
  const el = h(
    "section",
    { class: "card now", "aria-label": "What ALT is doing now" },
    h("div", { class: "now-head" }, h("span", { class: "now-phase" }, pulse, eyebrow), watch),
    live,
    route,
    progress,
  );

  return {
    el,
    render(m: Model) {
      const s = m.snapshot;
      if (!s) return;
      const n = s.now;
      const status = s.status;
      const phase =
        status === "paused" ? "Paused" : status === "stopped" ? "Stopped" : status === "idle" ? "Idle" : PHASE_LABEL[n.phase];
      setText(eyebrow, phase);
      const working = status === "live" && n.phase !== "idle" && n.phase !== "watching";
      el.dataset.state = working ? "working" : status === "watching" ? "watching" : "still";

      setText(label, n.label || (status === "watching" ? "Watching your changes" : "Nothing running"));
      setText(detail, n.detail ?? "");
      detail.hidden = !n.detail;

      const form = n.formId ? s.forms.find((f) => f.id === n.formId) : undefined;
      setText(route, form ? form.routeKey : "");
      route.hidden = !form;

      const hasCases = n.caseIndex !== null && n.caseTotal !== null && n.caseTotal > 0;
      if (hasCases) {
        const total = n.caseTotal ?? 1;
        const idx = Math.min(total, Math.max(0, n.caseIndex ?? 0));
        progress.dataset.mode = "determinate";
        fill.style.transform = `scaleX(${idx / total})`;
        setAttr(progress, "aria-valuemin", "0");
        setAttr(progress, "aria-valuemax", String(total));
        setAttr(progress, "aria-valuenow", String(idx));
        setAttr(progress, "aria-valuetext", `Case ${idx} of ${total}`);
        progress.hidden = false;
      } else if (working) {
        progress.dataset.mode = "indeterminate";
        fill.style.transform = "";
        setAttr(progress, "aria-valuenow", null);
        setAttr(progress, "aria-valuetext", PHASE_LABEL[n.phase]);
        progress.hidden = false;
      } else {
        progress.hidden = true;
      }

      watch.disabled = m.conn !== "open" || s.workerTabId === null;
    },
  };
}
