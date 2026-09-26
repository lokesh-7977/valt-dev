import { parseHelperMessage } from "@valt/protocol";
import { WebSocket } from "ws";

/** A small ws client for mock-helper tests: records every frame, validates each one. */
export class TestClient {
  readonly frames: Array<{ type: string; payload: Record<string, unknown> }> = [];
  readonly invalid: string[] = [];
  closed = false;
  private readonly ws: WebSocket;
  private seq = 0;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      const raw = String(data);
      const parsed = parseHelperMessage(raw);
      if (!parsed.ok) this.invalid.push(raw);
      try {
        this.frames.push(JSON.parse(raw) as { type: string; payload: Record<string, unknown> });
      } catch {
        /* recorded in invalid */
      }
    });
    ws.on("close", () => (this.closed = true));
  }

  static open(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.once("open", () => resolve(new TestClient(ws)));
      ws.once("error", reject);
    });
  }

  send(type: string, payload: unknown): void {
    this.ws.send(JSON.stringify({ type, id: `t-${++this.seq}`, ts: Date.now(), payload }));
  }

  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  hello(token = "any-token"): void {
    this.send("hello", { token, extVersion: "0.1.0", v: 1 });
  }

  of(type: string) {
    return this.frames.filter((f) => f.type === type);
  }

  async waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  close(): void {
    this.ws.close();
  }
}
