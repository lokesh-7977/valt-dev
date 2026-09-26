import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { mockBehavior } from "./actions.js";
import { handleControl } from "./control.js";
import { ReceivedLog } from "./log.js";
import { defaultConfig, Session, type Behavior, type MockConfig } from "./session.js";

export type MockHelperOptions = {
  port?: number;
  /** Write received frames to tools/mock-helper/.logs/received.jsonl. */
  logToDisk?: boolean;
  /** Defaults to the scripted mock behaviour (contract, sweep, actions). */
  behavior?: Behavior;
};

const ASSETS_DIR = fileURLToPath(new URL("../assets/", import.meta.url));

/** Screenshots are served over HTTP, never sent as base64 over the socket (§2). */
function serveAsset(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const match = /^\/assets\/([\w\-/]+\.png)$/.exec(url.pathname);
  const readable = req.method === "GET" || req.method === "HEAD";
  if (!readable || !match || match[1]!.includes("..")) return false;
  void readFile(ASSETS_DIR + match[1])
    .then((png) => {
      res.setHeader("content-type", "image/png");
      res.end(png);
    })
    .catch(() => {
      res.statusCode = 404;
      res.end();
    });
  return true;
}

/** The ALT mock helper: a WebSocket on 127.0.0.1:<port>/ws plus a mock-only control API. */
export class MockHelper {
  readonly log: ReceivedLog;
  readonly config: MockConfig = defaultConfig();
  readonly sessions = new Set<Session>();
  /** Per-process state shared by behavior modules (dedupe, expected fingerprints, …). */
  readonly state = new Map<string, unknown>();
  private readonly server: Server;
  private readonly wss: WebSocketServer;

  constructor(private readonly options: MockHelperOptions = {}) {
    this.log = new ReceivedLog(options.logToDisk ?? false);
    this.server = createServer((req, res) => {
      void handleControl(this, req, res).then((handled) => {
        if (handled || serveAsset(req, res)) return;
        res.statusCode = 404;
        res.end();
      });
    });
    const behavior = options.behavior ?? mockBehavior(this);
    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });
    this.wss.on("connection", (socket) => {
      const session = new Session(socket, this.config, this.log, behavior);
      this.sessions.add(session);
      socket.on("close", () => this.sessions.delete(session));
    });
  }

  /** Bind to 127.0.0.1 only. Resolves with the bound port. */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port ?? 7777, "127.0.0.1", () =>
        resolve((this.server.address() as AddressInfo).port),
      );
    });
  }

  stop(): Promise<void> {
    for (const client of this.wss.clients) client.terminate();
    return new Promise((resolve) => this.wss.close(() => this.server.close(() => resolve())));
  }

  reset(): void {
    this.log.clear();
    this.state.clear();
    Object.assign(this.config, defaultConfig());
    delete this.config.strict_token;
  }
}
