import { randomUUID } from "node:crypto";
import {
  AUTH_FAILED,
  parseExtensionMessage,
  type Envelope,
  type ExtensionToHelper,
  type HelperToExtension,
} from "@valt/protocol";
import type { WebSocket } from "ws";
import type { ReceivedLog } from "./log.js";

export type MockConfig = {
  /** When set, `hello` must carry exactly this token or the socket gets `auth_failed`. */
  strict_token?: string;
  /** Protocol version announced in `welcome` (override to test the mismatch banner). */
  v: number;
  activity: boolean;
  activity_ms: number;
  stats_ms: number;
  /** Stop replying to `bug_action` (client-side timeout tests). */
  mute_actions: boolean;
};

export const defaultConfig = (): MockConfig => ({
  v: 1,
  activity: true,
  activity_ms: 500,
  stats_ms: 10_000,
  mute_actions: false,
});

/** Handlers for authenticated messages; filled in by the behavior modules. */
export type Behavior = (session: Session, msg: Envelope<ExtensionToHelper>) => void;

const AGENTS = ["crawler", "contract", "fuzzer", "verifier", "reporter", "rules", "health"];
const MESSAGES = [
  "Walking /invoices/new",
  "Comparing UI fields with POST /api/invoices",
  "Fuzzing quantity with boundary values",
  "Re-checking a suspected mismatch",
  "Drafting a bug report",
  "Evaluating business rules on due_date",
  "Probing /api/probe/json",
];

export class Session {
  private authed = false;
  private timers: NodeJS.Timeout[] = [];
  private tick = 0;

  constructor(
    readonly socket: WebSocket,
    private readonly config: MockConfig,
    private readonly log: ReceivedLog,
    private readonly behavior: Behavior,
  ) {
    socket.on("message", (data) => this.onFrame(String(data)));
    socket.on("close", () => this.stopTimers());
  }

  send(msg: HelperToExtension): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    const envelope: Envelope<HelperToExtension> = { ...msg, id: randomUUID(), ts: Date.now() };
    this.socket.send(JSON.stringify(envelope));
  }

  sendRaw(frame: string): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(frame);
  }

  get cfg(): MockConfig {
    return this.config;
  }

  private onFrame(raw: string): void {
    try {
      this.log.add(JSON.parse(raw));
    } catch {
      this.log.add({ unparsed: raw.slice(0, 200) });
    }
    const result = parseExtensionMessage(raw);
    if (!result.ok) {
      if (result.reason === "unknown_type") {
        console.log(`[mock] ignored unknown type ${result.type ?? "?"}`);
        return;
      }
      console.log(`[mock] bad frame (${result.reason})`);
      this.send({ type: "error", payload: { code: "bad_message", message: "Malformed message" } });
      if (!this.authed) this.socket.close();
      return;
    }
    const msg = result.msg;
    if (!this.authed) {
      if (msg.type !== "hello") {
        this.send({ type: "error", payload: { code: "bad_message", message: "Send hello first" } });
        this.socket.close();
        return;
      }
      this.onHello(msg.payload.token);
      return;
    }
    if (msg.type === "hello") return;
    if (msg.type === "set_mode" || msg.type === "set_role") {
      console.log(`[mock] ${msg.type} ${JSON.stringify(msg.payload)}`);
    }
    this.behavior(this, msg);
  }

  private onHello(token: string): void {
    if (this.config.strict_token !== undefined && token !== this.config.strict_token) {
      this.send({ type: "error", payload: { code: AUTH_FAILED, message: "Invalid pairing token" } });
      this.socket.close();
      return;
    }
    this.authed = true;
    this.send({
      type: "welcome",
      payload: {
        helperVersion: "mock-1.0.0",
        project: "demo-erp",
        roles: ["admin", "clerk", "viewer"],
        mode: "live",
        // A version override lets tests exercise the "Update helper" banner.
        v: this.config.v as 1,
      },
    });
    this.startTimers();
  }

  private startTimers(): void {
    if (this.config.activity) {
      this.timers.push(setInterval(() => this.sendActivity(), this.config.activity_ms));
    }
    this.timers.push(setInterval(() => this.sendStats("manual_submit"), this.config.stats_ms));
  }

  private stopTimers(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  sendActivity(message?: string): void {
    const i = this.tick++;
    this.send({
      type: "activity",
      payload: {
        agent: AGENTS[i % AGENTS.length]!,
        message: message ?? MESSAGES[i % MESSAGES.length]!,
        progress: { done: (i % 32) + 1, total: 32 },
      },
    });
  }

  sendStats(trigger: "save" | "sweep" | "deploy" | "manual_submit"): void {
    this.send({
      type: "run_stats",
      payload: { checks: 30 + (this.tick % 30), agents: 7, durationMs: 3000 + (this.tick % 20) * 100, trigger },
    });
  }
}
