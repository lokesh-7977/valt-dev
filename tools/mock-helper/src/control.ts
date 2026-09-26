import type { IncomingMessage, ServerResponse } from "node:http";
import type { MockHelper } from "./server.js";

// Mock-only control API on the helper port. Tests drive the mock through these endpoints.

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString("utf8")));
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });

export type ControlRoute = (helper: MockHelper, body: Record<string, unknown>) => unknown;

/** Extra POST routes registered by behavior modules (e.g. /__mock/emit). */
export const extraRoutes = new Map<string, ControlRoute>();

/** Returns true when the request was a control request and has been answered. */
export async function handleControl(
  helper: MockHelper,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/__mock/")) return false;

  if (req.method === "GET" && url.pathname === "/__mock/received") {
    json(res, 200, helper.log.list());
    return true;
  }
  if (req.method === "POST" && url.pathname === "/__mock/reset") {
    helper.reset();
    json(res, 200, { ok: true });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/__mock/config") {
    const body = await readJson(req);
    const cfg = helper.config;
    if (typeof body.strict_token === "string") cfg.strict_token = body.strict_token;
    if (body.strict_token === null) delete cfg.strict_token;
    if (typeof body.v === "number") cfg.v = body.v;
    if (typeof body.activity === "boolean") cfg.activity = body.activity;
    if (typeof body.activity_ms === "number") cfg.activity_ms = body.activity_ms;
    if (typeof body.stats_ms === "number") cfg.stats_ms = body.stats_ms;
    if (typeof body.mute_actions === "boolean") cfg.mute_actions = body.mute_actions;
    json(res, 200, cfg);
    return true;
  }
  const route = req.method === "POST" ? extraRoutes.get(url.pathname) : undefined;
  if (route) {
    json(res, 200, route(helper, await readJson(req)) ?? { ok: true });
    return true;
  }
  json(res, 404, { error: "unknown control route" });
  return true;
}
