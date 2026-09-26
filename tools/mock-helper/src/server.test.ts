import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockHelper } from "./server.js";
import { TestClient } from "./test-client.js";

let helper: MockHelper;
let port: number;
const clients: TestClient[] = [];

const open = async () => {
  const c = await TestClient.open(port);
  clients.push(c);
  return c;
};

beforeEach(async () => {
  helper = new MockHelper({ port: 0 });
  port = await helper.start();
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await helper.stop();
});

describe("mock helper core", () => {
  it("answers hello with welcome v:1 and streams activity", async () => {
    const c = await open();
    c.hello();
    await c.waitFor(() => c.of("welcome").length === 1);
    expect(c.of("welcome")[0]!.payload).toMatchObject({ v: 1, project: "demo-erp" });
    await new Promise((r) => setTimeout(r, 1200));
    expect(c.of("activity").length).toBeGreaterThanOrEqual(2);
    expect(c.invalid).toEqual([]);
  });

  it("rejects a wrong token in strict mode with auth_failed, then closes", async () => {
    helper.config.strict_token = "4F7K-92QD";
    const c = await open();
    c.hello("WRONG");
    await c.waitFor(() => c.closed);
    expect(c.of("error")[0]!.payload).toMatchObject({ code: "auth_failed" });
    expect(c.of("welcome")).toHaveLength(0);
  });

  it("logs and ignores unknown types like ping without replying", async () => {
    helper.config.activity = false;
    const c = await open();
    c.hello();
    await c.waitFor(() => c.of("welcome").length === 1);
    c.send("ping", {});
    await new Promise((r) => setTimeout(r, 200));
    expect(c.frames.map((f) => f.type)).toEqual(["welcome"]);
    expect(c.closed).toBe(false);
    expect(helper.log.list()).toContainEqual(expect.objectContaining({ type: "ping" }));
  });

  it("answers malformed JSON with bad_message and stays up", async () => {
    const c = await open();
    c.hello();
    await c.waitFor(() => c.of("welcome").length === 1);
    c.sendRaw("not json");
    await c.waitFor(() => c.of("error").length === 1);
    expect(c.of("error")[0]!.payload).toMatchObject({ code: "bad_message" });
    const c2 = await open();
    c2.hello();
    await c2.waitFor(() => c2.of("welcome").length === 1);
  });

  it("closes a socket whose first message is not hello", async () => {
    const c = await open();
    c.send("set_mode", { mode: "paused" });
    await c.waitFor(() => c.closed);
    expect(c.of("error")[0]!.payload).toMatchObject({ code: "bad_message" });
  });

  it("can announce a different protocol version", async () => {
    helper.config.v = 2;
    const c = await open();
    c.hello();
    await c.waitFor(() => c.of("welcome").length === 1);
    expect(c.of("welcome")[0]!.payload.v).toBe(2);
  });
});
