import type { SessionStatus } from "@valt/shared";
import { h, setAttr, setText } from "../dom.ts";
import { STATUS_LABEL, duration } from "../format.ts";
import { altMark, icon, type IconName } from "../icons.ts";
import type { Model, View } from "../types.ts";

type PillState = SessionStatus | "connecting" | "lost";

const PILL_LABEL: Record<PillState, string> = {
  ...STATUS_LABEL,
  connecting: "Connecting",
  lost: "Offline",
};

const PILL_ICON: Partial<Record<PillState, IconName>> = {
  watching: "eye",
  paused: "pause",
  stopped: "stop",
  lost: "circle-x",
};

interface AiView {
  state: "online" | "offline" | "off" | "unknown";
  text: string;
  title: string;
}

function aiView(m: Model): AiView | null {
  const s = m.snapshot;
  if (!s || !m.settings) return null;
  if (!m.settings.useGemini || s.ai.state === "disabled") {
    return { state: "off", text: "Heuristics only", title: "Gemini is turned off. ALT plans tests with heuristics." };
  }
  if (s.ai.state === "offline") {
    const code = s.ai.lastErrorCode ? ` (${s.ai.lastErrorCode})` : "";
    return {
      state: "offline",
      text: "Heuristics only",
      title: `Gemini is unavailable${code}. ALT keeps testing with heuristics.`,
    };
  }
  if (s.ai.state === "online") {
    const lat = s.ai.lastLatencyMs !== null ? ` · ${duration(s.ai.lastLatencyMs)}` : "";
    return { state: "online", text: `Gemini online${lat}`, title: `Gemini online. ${s.ai.calls} calls this session.` };
  }
  return { state: "unknown", text: "Gemini standby", title: "Gemini is enabled and will be called when ALT plans a form." };
}

export function createHeader(): View {
  const pillIcon = h("span", { class: "pill-icon", "aria-hidden": "true" });
  const pillText = h("span", { class: "pill-text" });
  const pill = h(
    "span",
    { class: "status-pill", "data-status": "connecting" },
    h("span", { class: "sr-only" }, "Status: "),
    pillIcon,
    pillText,
  );
  const aiDot = h("span", { class: "ai-dot", "aria-hidden": "true" });
  const aiText = h("span", { class: "ai-text" });
  const ai = h("span", { class: "ai", "data-ai": "unknown", hidden: true }, aiDot, aiText);
  const el = h(
    "header",
    { class: "bar bar-top" },
    h("div", { class: "brand" }, altMark(22), h("span", { class: "wordmark" }, "ALT")),
    pill,
    ai,
  );

  let lastPill: PillState | null = null;

  return {
    el,
    render(m) {
      const state: PillState =
        m.conn === "lost" ? "lost" : m.conn === "connecting" && !m.snapshot ? "connecting" : (m.snapshot?.status ?? "connecting");
      if (state !== lastPill) {
        lastPill = state;
        pill.dataset.status = state;
        const name = PILL_ICON[state];
        pillIcon.replaceChildren(name ? icon(name, 12, "icon") : h("span", { class: "dot" }));
        setText(pillText, PILL_LABEL[state]);
      }

      const v = aiView(m);
      ai.hidden = v === null;
      if (v) {
        ai.dataset.ai = v.state;
        setText(aiText, v.text);
        setAttr(ai, "title", v.title);
      }
    },
  };
}
