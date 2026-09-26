// The single WebSocket to the helper, owned by the service worker (ADR 0016).
import {
  AUTH_FAILED,
  DEFAULT_WS_URL,
  ExtensionToHelperSchema,
  parseHelperMessage,
  PROTOCOL_VERSION,
  type Envelope,
  type ExtensionToHelper,
  type HelperToExtension,
} from "@valt/protocol";
import {
  EXT_VERSION,
  KEEPALIVE_ALARM,
  RECONNECT_MAX_MS,
  STORAGE_TOKEN,
  VERSION_RETRY_MS,
} from "../shared/config";
import type { ConnStatus } from "../shared/runtime-messages";

const BACKOFF_MS = [250, 500, 1_000, RECONNECT_MAX_MS];

export type ConnectionEvents = {
  onMessage: (msg: Envelope<HelperToExtension>) => void;
  onStatus: (status: ConnStatus, everConnected: boolean) => void;
};

export type ConnectionOptions = {
  url?: string;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
  /** Validate every outgoing frame against the protocol schema (dev builds and tests). */
  validate?: boolean;
};

export class Connection {
  status: ConnStatus = "no_token";
  everConnected = false;
  readonly dropped = { json: 0, invalid: 0, unknown_type: 0 };
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private authFailed = false;
  private token: string | null = null;
  private readonly url: string;
  private readonly WS: typeof WebSocket;
  private readonly random: () => number;
  private readonly validate: boolean;

  constructor(
    private readonly events: ConnectionEvents,
    opts: ConnectionOptions = {},
  ) {
    this.url = opts.url ?? DEFAULT_WS_URL;
    this.WS = opts.WebSocketImpl ?? WebSocket;
    this.random = opts.random ?? Math.random;
    this.validate = opts.validate ?? Boolean(import.meta.env?.DEV);
  }

  /** Read the token and connect. Also installs the 30 s keep-alive alarm (safety net). */
  async start(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_TOKEN);
    this.token = typeof stored[STORAGE_TOKEN] === "string" ? (stored[STORAGE_TOKEN] as string) : null;
    void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
    if (!this.token) return this.setStatus("no_token");
    this.connect();
  }

  /** Called by the keep-alive alarm: restart the loop if the worker was evicted. */
  wake(): void {
    const idle = !this.ws && !this.timer;
    if (idle && this.token && !this.authFailed) this.connect();
  }

  async setToken(token: string): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_TOKEN]: token });
    this.token = token;
    this.authFailed = false;
    this.attempt = 0;
    this.teardown();
    this.connect();
  }

  get connected(): boolean {
    return this.status === "connected";
  }

  /** Wrap in the §2 envelope and send. Returns false when not connected. */
  send(msg: ExtensionToHelper): boolean {
    if (!this.connected && msg.type !== "hello") return false;
    const ws = this.ws;
    if (!ws || ws.readyState !== this.WS.OPEN) return false;
    const envelope: Envelope<ExtensionToHelper> = { ...msg, id: crypto.randomUUID(), ts: Date.now() };
    if (this.validate) ExtensionToHelperSchema.parse(envelope);
    ws.send(JSON.stringify(envelope));
    return true;
  }

  private connect(): void {
    this.clearTimer();
    if (!this.token) return this.setStatus("no_token");
    // Any extension API call resets the service worker's idle timer while we retry.
    void chrome.runtime.getPlatformInfo().catch(() => undefined);
    if (this.status !== "version_mismatch") this.setStatus(this.everConnected ? "reconnecting" : "connecting");
    let ws: WebSocket;
    try {
      ws = new this.WS(this.url);
    } catch {
      return this.onClosed();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: "hello", payload: { token: this.token ?? "", extVersion: EXT_VERSION, v: PROTOCOL_VERSION } });
    };
    ws.onmessage = (e: MessageEvent) => this.onFrame(String(e.data));
    ws.onclose = () => {
      if (this.ws === ws) this.onClosed();
    };
    ws.onerror = () => undefined; // close follows
  }

  private onFrame(raw: string): void {
    const result = parseHelperMessage(raw);
    if (!result.ok) {
      if (result.reason === "invalid" && result.type === "welcome") return this.onVersionMismatch();
      this.dropped[result.reason]++;
      if (result.reason === "unknown_type") console.debug(`[ALT] ignored unknown message type ${result.type}`);
      return;
    }
    const msg = result.msg;
    if (msg.type === "welcome") {
      if (msg.payload.v !== PROTOCOL_VERSION) return this.onVersionMismatch();
      this.attempt = 0;
      this.everConnected = true;
      this.setStatus("connected");
    } else if (msg.type === "error") {
      if (msg.payload.code === AUTH_FAILED) {
        this.authFailed = true;
        this.setStatus("pairing_failed");
        return;
      }
      console.debug(`[ALT] helper error ${msg.payload.code}`);
    }
    this.events.onMessage(msg);
  }

  private onVersionMismatch(): void {
    this.setStatus("version_mismatch");
    this.teardown();
    this.timer = setTimeout(() => this.connect(), VERSION_RETRY_MS);
  }

  private onClosed(): void {
    this.ws = null;
    if (this.authFailed) return this.setStatus("pairing_failed");
    if (this.status === "version_mismatch") {
      if (!this.timer) this.timer = setTimeout(() => this.connect(), VERSION_RETRY_MS);
      return;
    }
    this.setStatus(this.everConnected ? "reconnecting" : "down");
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt++;
    const jitter = 1 + (this.random() * 0.4 - 0.2);
    this.clearTimer();
    this.timer = setTimeout(() => this.connect(), Math.round(base * jitter));
  }

  private teardown(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(status: ConnStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus(status, this.everConnected);
  }
}
