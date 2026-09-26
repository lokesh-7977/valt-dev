// A controllable WebSocket stand-in for service-worker tests.
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  /** When false, new sockets fail to connect (helper down). */
  static serverUp = true;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      if (FakeWebSocket.serverUp) {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.(new Event("open"));
      } else {
        this.readyState = FakeWebSocket.CLOSED;
        this.onerror?.(new Event("error"));
        this.onclose?.(new CloseEvent("close"));
      }
    });
  }

  static reset(): void {
    FakeWebSocket.instances = [];
    FakeWebSocket.serverUp = true;
  }

  static get last(): FakeWebSocket {
    return FakeWebSocket.instances.at(-1)!;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  get sentTypes(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { type: string }).type);
  }

  /** Deliver a frame from the "server". */
  receive(data: unknown): void {
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: raw }));
  }

  /** Server-side close. */
  serverClose(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  close(): void {
    this.serverClose();
  }
}

let seq = 0;
export const env = (type: string, payload: unknown) => ({ type, id: `s-${++seq}`, ts: Date.now(), payload });
export const welcome = (over: Record<string, unknown> = {}) =>
  env("welcome", { helperVersion: "mock-1.0.0", project: "demo-erp", roles: ["admin", "clerk", "viewer"], mode: "live", v: 1, ...over });
