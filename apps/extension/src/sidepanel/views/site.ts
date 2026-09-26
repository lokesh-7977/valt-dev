import type { SessionStatus } from "@valt/shared";
import { h, rebuild, type Child } from "../dom.ts";
import { STATUS_SENTENCE, hostOf } from "../format.ts";
import { icon } from "../icons.ts";
import { hasData, isActive, type Ctx, type Model, type View } from "../types.ts";

interface Elsewhere {
  host: string;
  status: SessionStatus;
}

type SiteView =
  | { mode: "loading" }
  | { mode: "nonweb"; elsewhere: Elsewhere | null; disabled: boolean }
  | { mode: "start"; host: string; elsewhere: Elsewhere | null; intro: boolean; destructive: boolean; disabled: boolean }
  | { mode: "enabled"; host: string; status: SessionStatus; running: boolean; elsewhere: Elsewhere | null; destructive: boolean; disabled: boolean };

function siteView(m: Model): SiteView {
  const tab = m.tab;
  const s = m.snapshot;
  const st = m.settings;
  if (!tab || !s || !st) return { mode: "loading" };
  const disabled = m.conn !== "open";
  const active = isActive(s);
  const elsewhere: Elsewhere | null =
    active && s.origin && s.origin !== tab.origin ? { host: hostOf(s.origin), status: s.status } : null;
  if (!tab.web || !tab.origin) return { mode: "nonweb", elsewhere, disabled };
  const destructive = st.allowDestructive;
  if (!st.enabledOrigins.includes(tab.origin)) {
    return { mode: "start", host: tab.host, elsewhere, intro: !hasData(s) && !active, destructive, disabled };
  }
  const here = s.origin === tab.origin || s.origin === null;
  return {
    mode: "enabled",
    host: tab.host,
    status: here ? s.status : "idle",
    running: here && active,
    elsewhere,
    destructive,
    disabled,
  };
}

function sessionControls(ctx: Ctx, status: SessionStatus, disabled: boolean): HTMLElement {
  const paused = status === "paused";
  return h(
    "div",
    { class: "control-row" },
    h(
      "button",
      {
        class: "btn btn-secondary",
        type: "button",
        "data-fk": "toggle",
        disabled,
        onClick: () => ctx.send({ type: paused ? "resume" : "pause" }),
      },
      icon(paused ? "play" : "pause", 16),
      paused ? "Resume" : "Pause",
    ),
    h(
      "button",
      { class: "btn btn-secondary", type: "button", "data-fk": "stop", disabled, onClick: () => ctx.send({ type: "stop" }) },
      icon("stop", 16),
      "Stop",
    ),
  );
}

function destructiveNote(on: boolean): Child {
  if (!on) return null;
  return h(
    "p",
    { class: "inline-note tone-warn" },
    icon("triangle-alert", 16),
    h("span", null, h("strong", null, "Destructive actions allowed. "), "ALT may delete, pay or send. Turn this off in Scope & safety."),
  );
}

function elsewhereBlock(ctx: Ctx, e: Elsewhere, disabled: boolean): HTMLElement {
  return h(
    "div",
    { class: "elsewhere" },
    h(
      "p",
      { class: "t-callout" },
      h("span", { class: "muted" }, "ALT is running on "),
      h("strong", { class: "break" }, e.host),
    ),
    sessionControls(ctx, e.status, disabled),
  );
}

function hostRow(ctx: Ctx, host: string, disabled: boolean): HTMLElement {
  return h(
    "div",
    { class: "host-row" },
    h("span", { class: "host-icon" }, icon("globe", 18)),
    h("h2", { class: "t-headline host-name", id: "site-title" }, host),
    h(
      "button",
      {
        class: "btn btn-ghost btn-compact",
        type: "button",
        "data-fk": "off",
        "aria-label": `Turn off ALT on ${host}`,
        disabled,
        onClick: () => {
          const origin = ctx.model.tab?.origin;
          if (origin) ctx.send({ type: "disable", origin });
        },
      },
      "Turn off",
    ),
  );
}

const INTRO: Array<[string, string]> = [
  ["Explores", "Follows links and safe buttons to map every page and form."],
  ["Tests", "Plans edge cases per field and runs them in a background tab."],
  ["Reports", "Flags what behaves unexpectedly, with the evidence to check it."],
];

function build(v: SiteView, ctx: Ctx): Child[] {
  switch (v.mode) {
    case "loading":
      return [h("span", { class: "skel skel-title" }), h("span", { class: "skel skel-button" })];

    case "nonweb":
      return [
        v.elsewhere ? elsewhereBlock(ctx, v.elsewhere, v.disabled) : null,
        h(
          "div",
          { class: "empty-inline" },
          h("span", { class: "host-icon" }, icon("globe", 18)),
          h(
            "div",
            null,
            h("h2", { class: "t-headline", id: "site-title" }, v.elsewhere ? "This tab isn't a web app" : "Open your app to start"),
            h(
              "p",
              { class: "t-footnote muted" },
              "ALT tests web apps served over http or https. Open your dev or staging app in this tab.",
            ),
          ),
        ),
      ];

    case "start":
      return [
        v.elsewhere ? elsewhereBlock(ctx, v.elsewhere, v.disabled) : null,
        h("h2", { class: "t-title3 balance", id: "site-title" }, "Start ALT on ", h("span", { class: "break" }, v.host)),
        v.intro
          ? h(
              "ol",
              { class: "intro" },
              ...INTRO.map(([title, text], i) =>
                h(
                  "li",
                  null,
                  h("span", { class: "intro-num", "aria-hidden": "true" }, String(i + 1)),
                  h("span", null, h("strong", null, `${title}. `), h("span", { class: "muted" }, text)),
                ),
              ),
            )
          : h("p", { class: "t-callout muted" }, "ALT explores this app in a background tab while you keep working."),
        h(
          "button",
          {
            class: "btn btn-primary btn-pill btn-block",
            type: "button",
            "data-fk": "start",
            disabled: v.disabled,
            onClick: () => ctx.enableActiveTab(),
          },
          icon("play", 16),
          v.elsewhere ? "Start ALT here" : "Start ALT",
        ),
        v.destructive
          ? destructiveNote(true)
          : h(
              "p",
              { class: "inline-note" },
              icon("shield-check", 16),
              h(
                "span",
                null,
                "Stays on this site and fills forms with test data. Never deletes, pays or sends unless you allow it. Use on dev or staging.",
              ),
            ),
      ];

    case "enabled": {
      const inactive = !v.running;
      return [
        v.elsewhere ? elsewhereBlock(ctx, v.elsewhere, v.disabled) : null,
        hostRow(ctx, v.host, v.disabled),
        h("p", { class: "t-callout muted" }, v.elsewhere ? "Enabled. ALT is busy on another site." : STATUS_SENTENCE[v.status]),
        inactive
          ? h(
              "button",
              {
                class: v.elsewhere ? "btn btn-secondary btn-block" : "btn btn-primary btn-pill btn-block",
                type: "button",
                "data-fk": "start",
                disabled: v.disabled,
                onClick: () => ctx.enableActiveTab(),
              },
              icon("play", 16),
              v.elsewhere ? "Start ALT here" : v.status === "stopped" ? "Start again" : "Start ALT",
            )
          : sessionControls(ctx, v.status, v.disabled),
        destructiveNote(v.destructive),
      ];
    }
  }
}

export function createSite(ctx: Ctx): View {
  const el = h("section", { class: "card site", "aria-labelledby": "site-title" });
  let last = "";
  return {
    el,
    render(m) {
      const v = siteView(m);
      const sig = JSON.stringify(v);
      if (sig === last) return;
      last = sig;
      rebuild(el, build(v, ctx));
    },
  };
}
