import type { AltSettings } from "@valt/shared";
import { h, nextId, setAttr, setText } from "../dom.ts";
import { icon } from "../icons.ts";
import type { Ctx, Model, View } from "../types.ts";

type NumericKey = "maxDepth" | "maxPages" | "maxCasesPerForm" | "paceMs";

// Ranges mirror mergeSettings() in src/shared/settings.ts (the SW clamps again).
const NUMERIC: Array<{ key: NumericKey; label: string; min: number; max: number; step: number; hint: string }> = [
  { key: "maxDepth", label: "Max depth", min: 1, max: 10, step: 1, hint: "Link hops" },
  { key: "maxPages", label: "Max pages", min: 1, max: 500, step: 1, hint: "Per session" },
  { key: "maxCasesPerForm", label: "Cases per form", min: 1, max: 200, step: 1, hint: "Test cases" },
  { key: "paceMs", label: "Pace", min: 0, max: 5000, step: 50, hint: "ms between steps" },
];

interface SwitchHandle {
  row: HTMLElement;
  button: HTMLButtonElement;
  set(on: boolean, disabled: boolean): void;
}

function createSwitch(label: string, hint: string, onToggle: (next: boolean) => void, cls = ""): SwitchHandle {
  const labelId = nextId("sw-label");
  const hintId = nextId("sw-hint");
  const button = h("button", {
    class: `switch ${cls}`.trim(),
    type: "button",
    role: "switch",
    "aria-checked": "false",
    "aria-labelledby": labelId,
    "aria-describedby": hintId,
    onClick: () => onToggle(button.getAttribute("aria-checked") !== "true"),
  });
  button.append(h("span", { class: "switch-thumb", "aria-hidden": "true" }));
  const row = h(
    "div",
    { class: "switch-row" },
    h(
      "div",
      { class: "switch-text" },
      h("span", { class: "field-label", id: labelId }, label),
      h("span", { class: "t-footnote muted", id: hintId }, hint),
    ),
    button,
  );
  return {
    row,
    button,
    set(on, disabled) {
      setAttr(button, "aria-checked", on ? "true" : "false");
      button.disabled = disabled;
    },
  };
}

export function createScope(ctx: Ctx): View {
  let current: AltSettings | null = null;
  const patch = (p: Partial<AltSettings>): void => ctx.send({ type: "settings.update", patch: p });

  // ---- destructive switch with an inline confirmation ----
  const confirmText = h("p", { class: "t-callout" });
  const cancelBtn = h("button", { class: "btn btn-secondary", type: "button" }, "Cancel");
  const allowBtn = h("button", { class: "btn btn-destructive", type: "button" }, "Allow");
  const confirmId = nextId("confirm");
  const confirmBox = h(
    "div",
    { class: "confirm", role: "group", "aria-labelledby": confirmId, hidden: true },
    h("div", { class: "confirm-head", id: confirmId }, icon("triangle-alert", 18), h("strong", null, "Allow destructive actions?")),
    confirmText,
    h("div", { class: "control-row" }, cancelBtn, allowBtn),
  );

  const destructive = createSwitch(
    "Allow destructive actions",
    "Delete, pay, send and log-out buttons. Off keeps ALT safe.",
    (next) => {
      if (!next) {
        patch({ allowDestructive: false });
        return;
      }
      const origin = ctx.model.tab?.web ? ctx.model.tab.origin : ctx.model.snapshot?.origin;
      setText(confirmText, `ALT may delete, pay or send on ${origin ?? "enabled sites"}. Use only on dev/staging.`);
      confirmBox.hidden = false;
      cancelBtn.focus();
    },
    "switch-warn",
  );

  const closeConfirm = (): void => {
    confirmBox.hidden = true;
    destructive.button.focus();
  };
  cancelBtn.addEventListener("click", closeConfirm);
  allowBtn.addEventListener("click", () => {
    patch({ allowDestructive: true });
    closeConfirm();
  });
  confirmBox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeConfirm();
    }
  });

  const gemini = createSwitch("Use Gemini", "Enrich test plans through the VALT API. Heuristics always run.", (next) =>
    patch({ useGemini: next }),
  );

  // ---- numeric + URL fields (committed on change, never overwritten while focused) ----
  const inputs = new Map<NumericKey, HTMLInputElement>();
  const numericFields = NUMERIC.map((f) => {
    const id = nextId(`f-${f.key}`);
    const hintId = `${id}-hint`;
    const input = h("input", {
      id,
      class: "input",
      type: "number",
      inputmode: "numeric",
      min: f.min,
      max: f.max,
      step: f.step,
      "aria-describedby": hintId,
    });
    input.addEventListener("change", () => {
      const n = Number(input.value);
      if (input.value.trim() === "" || !Number.isFinite(n)) {
        if (current) input.value = String(current[f.key]);
        return;
      }
      const v = Math.min(f.max, Math.max(f.min, Math.round(n)));
      input.value = String(v);
      patch({ [f.key]: v });
    });
    inputs.set(f.key, input);
    return h(
      "div",
      { class: "field" },
      h("label", { class: "field-label", for: id }, f.label),
      input,
      h("span", { class: "t-footnote muted", id: hintId }, f.hint),
    );
  });

  const apiId = nextId("f-api");
  const apiInput = h("input", {
    id: apiId,
    class: "input mono-input",
    type: "url",
    spellcheck: "false",
    autocomplete: "off",
    "aria-describedby": `${apiId}-hint`,
  });
  apiInput.addEventListener("change", () => {
    const v = apiInput.value.trim();
    if (!/^https?:\/\/\S+$/i.test(v)) {
      if (current) apiInput.value = current.apiBaseUrl;
      return;
    }
    patch({ apiBaseUrl: v });
  });

  const summaryMeta = h("span", { class: "t-footnote muted" });
  const details = h(
    "details",
    { class: "disclosure" },
    h(
      "summary",
      { class: "disclosure-summary" },
      h("span", { class: "disclosure-icon" }, icon("shield", 18)),
      h("span", { class: "disclosure-text" }, h("span", { class: "t-headline" }, "Scope & safety"), summaryMeta),
      icon("chevron-right", 16, "icon chev"),
    ),
    h(
      "div",
      { class: "disclosure-body" },
      destructive.row,
      confirmBox,
      h("div", { class: "field-grid" }, ...numericFields),
      h(
        "div",
        { class: "field" },
        h("label", { class: "field-label", for: apiId }, "API base URL"),
        apiInput,
        h("span", { class: "t-footnote muted", id: `${apiId}-hint` }, "Where ALT reaches the VALT API for Gemini."),
      ),
      gemini.row,
    ),
  );
  const el = h("section", { class: "card card-flush", "aria-label": "Scope and safety settings" }, details);

  return {
    el,
    render(m: Model) {
      const st = m.settings;
      if (!st) return;
      current = st;
      const disabled = m.conn !== "open";
      destructive.set(st.allowDestructive, disabled);
      gemini.set(st.useGemini, disabled);
      if (st.allowDestructive && !confirmBox.hidden) confirmBox.hidden = true;
      allowBtn.disabled = disabled;
      for (const f of NUMERIC) {
        const input = inputs.get(f.key);
        if (!input) continue;
        input.disabled = disabled;
        if (document.activeElement !== input) {
          const v = String(st[f.key]);
          if (input.value !== v) input.value = v;
        }
      }
      apiInput.disabled = disabled;
      if (document.activeElement !== apiInput && apiInput.value !== st.apiBaseUrl) apiInput.value = st.apiBaseUrl;
      setText(
        summaryMeta,
        `Depth ${st.maxDepth} · ${st.maxPages} pages · ${st.allowDestructive ? "Destructive allowed" : "Safe mode"}`,
      );
      setAttr(el, "data-destructive", st.allowDestructive ? "true" : null);
    },
  };
}
