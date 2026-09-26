// Correlates a developer's submit with the requests it caused, then sends one cs:submit.
import type { CapturedRequest, CapturedSubmit } from "@valt/protocol";
import type { HookReqEnd, HookReqStart } from "../shared/bridge";
import { CORRELATE_AFTER_MS, CORRELATE_BEFORE_MS, SETTLE_MS } from "../shared/config";
import type { CsSubmit } from "../shared/runtime-messages";
import { isCandidateRequest } from "./filter";
import { redactHeaders, redactUrl, toBody } from "./redact";
import { scrapeAfter, scrapeForm } from "./scrape";

/** GETs only count as part of a submit when they fire soon after it (refetch / stale data, C7). */
const GET_AFTER_MS = 1_500;
const BUFFER_MS = 10_000;
const DUPLICATE_TRIGGER_MS = 300;
const SPA_BUTTON = /save|submit|create|update/i;

type Req = { start: HookReqStart; end?: HookReqEnd };
type Capture = {
  t0: number;
  container: string;
  form: CapturedSubmit["payload"]["form"];
  reqIds: Set<string>;
  lastActivity: number;
  timer: ReturnType<typeof setTimeout> | null;
};

export type CaptureDeps = {
  doc: Document;
  send: (msg: CsSubmit) => void;
  now?: () => number;
  newId?: () => string;
};

export class CapturePipeline {
  paused = false;
  private readonly requests = new Map<string, Req>();
  private readonly active = new Set<Capture>();
  private lastTrigger: { container: string; t: number } | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: CaptureDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  /** Listen for native submits and SPA-style save buttons (capture phase, passive). */
  attach(): () => void {
    const { doc } = this.deps;
    const onSubmit = (e: Event) => {
      if (e.target instanceof Element) this.trigger(e.target);
    };
    const onClick = (e: Event) => {
      const button = e.target instanceof Element ? e.target.closest("button") : null;
      if (!button || button.type === "submit" || button.closest("alt-root")) return;
      const label = `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`;
      if (SPA_BUTTON.test(label)) this.trigger(button);
    };
    doc.addEventListener("submit", onSubmit, { capture: true, passive: true });
    doc.addEventListener("click", onClick, { capture: true, passive: true });
    return () => {
      doc.removeEventListener("submit", onSubmit, { capture: true });
      doc.removeEventListener("click", onClick, { capture: true });
    };
  }

  trigger(el: Element): void {
    if (this.paused) return;
    try {
      const form = scrapeForm(el);
      const t0 = this.now();
      if (this.lastTrigger && this.lastTrigger.container === form.selector && t0 - this.lastTrigger.t < DUPLICATE_TRIGGER_MS) {
        return;
      }
      this.lastTrigger = { container: form.selector, t: t0 };
      const capture: Capture = { t0, container: form.selector, form, reqIds: new Set(), lastActivity: t0, timer: null };
      for (const [id, r] of this.requests) if (this.belongs(capture, r.start)) capture.reqIds.add(id);
      this.active.add(capture);
      this.schedule(capture);
    } catch {
      /* never break the page */
    }
  }

  onReqStart(start: HookReqStart): void {
    if (!isCandidateRequest(start.url, start.method)) return;
    this.requests.set(start.reqId, { start });
    this.prune();
    for (const c of this.active) {
      if (this.belongs(c, start)) {
        c.reqIds.add(start.reqId);
        c.lastActivity = Math.max(c.lastActivity, this.now());
        this.schedule(c);
      }
    }
  }

  onReqEnd(end: HookReqEnd): void {
    const r = this.requests.get(end.reqId);
    if (!r) return;
    r.end = end;
    for (const c of this.active) {
      if (c.reqIds.has(end.reqId)) {
        c.lastActivity = Math.max(c.lastActivity, this.now());
        this.schedule(c);
      }
    }
  }

  private belongs(c: Capture, start: HookReqStart): boolean {
    const dt = start.t - c.t0;
    if (dt < -CORRELATE_BEFORE_MS || dt > CORRELATE_AFTER_MS) return false;
    if (start.method === "GET") return dt >= 0 && dt <= GET_AFTER_MS;
    return true;
  }

  private schedule(c: Capture): void {
    if (c.timer) clearTimeout(c.timer);
    const reqs = [...c.reqIds].map((id) => this.requests.get(id)).filter((r): r is Req => !!r);
    const now = this.now();
    if (reqs.length === 0) {
      // Nothing correlated yet: wait out the correlation window, then drop the trigger.
      const wait = c.t0 + CORRELATE_AFTER_MS - now;
      c.timer = setTimeout(() => (c.reqIds.size ? this.schedule(c) : this.active.delete(c)), Math.max(0, wait));
      return;
    }
    if (reqs.some((r) => !r.end)) return; // an end will reschedule
    const wait = c.lastActivity + SETTLE_MS - now;
    c.timer = setTimeout(() => this.finish(c), Math.max(0, wait));
  }

  private finish(c: Capture): void {
    this.active.delete(c);
    if (this.paused) return;
    try {
      const requests: CapturedRequest[] = [...c.reqIds]
        .map((id) => this.requests.get(id))
        .filter((r): r is Req => !!r)
        .sort((a, b) => a.start.t - b.start.t)
        .map(({ start, end }) => ({
          reqId: start.reqId,
          method: start.method,
          url: redactUrl(new URL(start.url, this.deps.doc.location?.href).href),
          status: end?.status ?? 0,
          reqHeaders: redactHeaders(start.headers),
          reqBody: toBody(start.body),
          resBody: toBody(end?.body ?? null),
          durationMs: end?.durationMs ?? 0,
          initiator: start.initiator,
        }));
      if (requests.length === 0) return;
      const loc = this.deps.doc.location;
      this.deps.send({
        kind: "cs:submit",
        payload: {
          submitId: this.newId(),
          pageUrl: redactUrl(loc?.href ?? ""),
          route: loc?.pathname ?? "/",
          form: c.form,
          requests,
          uiAfter: scrapeAfter(this.deps.doc),
        },
      });
    } catch {
      /* never break the page */
    }
  }

  private prune(): void {
    const cutoff = this.now() - BUFFER_MS;
    for (const [id, r] of this.requests) {
      if (r.start.t < cutoff && ![...this.active].some((c) => c.reqIds.has(id))) this.requests.delete(id);
    }
  }
}
