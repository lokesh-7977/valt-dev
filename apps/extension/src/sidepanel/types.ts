import type { AltSettings, SessionSnapshot, SessionStatus } from "@valt/shared";
import type { PanelRequest } from "../shared/messages.ts";

/** The browser tab the panel is looking at (the developer's tab, not ALT's worker tab). */
export interface ActiveTab {
  id: number | null;
  url: string;
  /** `null` for non-web pages (chrome://, file://, new tab…). */
  origin: string | null;
  host: string;
  web: boolean;
}

export type ConnState = "connecting" | "open" | "lost";

export interface Notice {
  tone: "error" | "info";
  text: string;
}

export interface Model {
  conn: ConnState;
  connMessage: string | null;
  snapshot: SessionSnapshot | null;
  settings: AltSettings | null;
  tab: ActiveTab | null;
  notice: Notice | null;
  exporting: boolean;
  exported: string | null;
}

export interface Ctx {
  readonly model: Model;
  send(req: PanelRequest): void;
  enableActiveTab(): void;
  retry(): void;
  exportSession(): void;
  dismissNotice(): void;
}

export interface View {
  el: HTMLElement;
  render(m: Model): void;
}

export const ACTIVE_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>(["live", "paused", "watching"]);

export function isActive(s: SessionSnapshot | null): boolean {
  return s !== null && ACTIVE_STATUSES.has(s.status);
}

export function hasData(s: SessionSnapshot | null): boolean {
  return s !== null && (s.pages.length > 0 || s.cases.length > 0 || s.activity.length > 0 || s.health.length > 0);
}
