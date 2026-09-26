import { h, rebuild } from "../dom.ts";
import { icon } from "../icons.ts";
import type { Ctx, Model, View } from "../types.ts";

/** Full-panel states before the first snapshot: connecting (skeleton) and lost (error + retry). */
export function createStateCard(ctx: Ctx): View {
  const el = h("section", { class: "state-host" });
  let last = "";

  return {
    el,
    render(m: Model) {
      const sig = `${m.conn}|${m.connMessage ?? ""}`;
      if (sig === last) return;
      last = sig;
      if (m.conn === "lost") {
        rebuild(el, [
          h(
            "div",
            { class: "card state-card", role: "alert" },
            h("span", { class: "state-icon" }, icon("circle-x", 24)),
            h("h2", { class: "t-headline" }, "Can't reach ALT"),
            h(
              "p",
              { class: "t-callout muted" },
              m.connMessage ?? "Lost the connection to ALT's background worker.",
              " This can happen right after the extension reloads.",
            ),
            h(
              "button",
              { class: "btn btn-primary btn-block", type: "button", "data-fk": "retry", onClick: () => ctx.retry() },
              icon("refresh", 16),
              "Try again",
            ),
          ),
        ]);
      } else {
        rebuild(el, [
          h(
            "div",
            { class: "card skeleton-card", "aria-busy": "true" },
            h("p", { class: "t-callout muted", role: "status" }, "Connecting to ALT…"),
            h("span", { class: "skel skel-title" }),
            h("span", { class: "skel skel-line" }),
            h("span", { class: "skel skel-line short" }),
            h("span", { class: "skel skel-button" }),
          ),
          h(
            "div",
            { class: "card skeleton-card", "aria-hidden": "true" },
            h("span", { class: "skel skel-line" }),
            h("span", { class: "skel skel-line short" }),
          ),
        ]);
      }
    },
  };
}

/** Inline banner: a lost connection while we still have data, or an error the SW reported. */
export function createBanner(ctx: Ctx): View {
  const el = h("div", { class: "banner-host" });
  let last = "";

  return {
    el,
    render(m: Model) {
      const lostWithData = m.conn === "lost" && m.snapshot !== null;
      const reconnecting = m.conn === "connecting" && m.snapshot !== null;
      const sig = lostWithData ? `lost|${m.connMessage}` : reconnecting ? "reconnecting" : m.notice ? `n|${m.notice.text}` : "";
      if (sig === last) return;
      last = sig;
      if (lostWithData) {
        rebuild(el, [
          h(
            "div",
            { class: "banner", role: "alert" },
            h("span", { class: "banner-icon tone-error" }, icon("circle-x", 18)),
            h(
              "p",
              { class: "banner-text" },
              h("strong", null, "Disconnected. "),
              "Showing the last known state; controls are paused until ALT reconnects.",
            ),
            h(
              "button",
              { class: "btn btn-secondary btn-compact", type: "button", "data-fk": "retry", onClick: () => ctx.retry() },
              "Retry",
            ),
          ),
        ]);
      } else if (reconnecting) {
        rebuild(el, [
          h(
            "div",
            { class: "banner", role: "status" },
            h("span", { class: "banner-icon" }, icon("refresh", 18)),
            h("p", { class: "banner-text" }, "Reconnecting to ALT…"),
          ),
        ]);
      } else if (m.notice) {
        const tone = m.notice.tone;
        rebuild(el, [
          h(
            "div",
            { class: "banner", role: tone === "error" ? "alert" : "status" },
            h("span", { class: `banner-icon tone-${tone}` }, icon(tone === "error" ? "triangle-alert" : "info", 18)),
            h("p", { class: "banner-text" }, m.notice.text),
            h(
              "button",
              {
                class: "btn btn-ghost btn-icon",
                type: "button",
                "aria-label": "Dismiss message",
                "data-fk": "dismiss",
                onClick: () => ctx.dismissNotice(),
              },
              icon("x", 16),
            ),
          ),
        ]);
      } else {
        el.replaceChildren();
      }
    },
  };
}
