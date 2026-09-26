import { h, setText } from "../dom.ts";
import { icon } from "../icons.ts";
import type { Ctx, Model, View } from "../types.ts";

export function createFooter(ctx: Ctx): View {
  const label = h("span", null, "Export JSON");
  const button = h(
    "button",
    { class: "btn btn-secondary btn-compact", type: "button", title: "Export session JSON", onClick: () => ctx.exportSession() },
    icon("download", 16),
    label,
  );
  const status = h("p", { class: "sr-only", role: "status" });
  const el = h(
    "footer",
    { class: "bar bar-bottom" },
    h(
      "p",
      { class: "t-footnote muted footer-note" },
      h("strong", null, "Unexpected"),
      " = observed mismatch, not yet verified.",
    ),
    button,
    status,
  );

  return {
    el,
    render(m: Model) {
      button.disabled = m.conn !== "open" || m.snapshot === null || m.exporting;
      button.setAttribute("aria-busy", m.exporting ? "true" : "false");
      setText(label, m.exporting ? "Exporting…" : "Export JSON");
      setText(status, m.exported ? `Exported ${m.exported}` : "");
    },
  };
}
