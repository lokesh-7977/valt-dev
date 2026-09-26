import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockHelper } from "./server.js";
import { plantedBugs } from "./sweep.js";
import { TestClient } from "./test-client.js";

let helper: MockHelper;
let port: number;
let client: TestClient;

const post = (path: string, body: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  helper = new MockHelper({ port: 0 });
  helper.config.activity = false;
  port = await helper.start();
  client = await TestClient.open(port);
  client.hello();
  await client.waitFor(() => client.of("welcome").length === 1);
});

afterEach(async () => {
  client.close();
  await helper.stop();
});

const bugA = plantedBugs[0]!.bug;

describe("run_sweep", () => {
  it("emits exactly 6 bug_found within 6 s", async () => {
    client.send("run_sweep", { target: "localhost", role: "clerk" });
    await client.waitFor(() => client.of("bug_found").length === 6, 6000);
    await client.waitFor(() => client.of("run_stats").some((s) => s.payload.trigger === "sweep"));
    expect(client.invalid).toEqual([]);
  }, 8000);

  it("does not re-emit a fingerprint marked expected", async () => {
    await post("/__mock/emit", { bugs: [bugA] });
    await client.waitFor(() => client.of("bug_found").length === 1);
    client.send("bug_action", { bugId: bugA.bugId, action: "expected" });
    await client.waitFor(() => client.of("bug_updated").length === 1);
    client.send("run_sweep", { target: "localhost" });
    await client.waitFor(() => client.of("run_stats").some((s) => s.payload.trigger === "sweep"), 6000);
    const ids = client.of("bug_found").map((f) => f.payload.bugId);
    expect(ids.filter((id) => id === bugA.bugId)).toHaveLength(1);
    expect(client.of("bug_found")).toHaveLength(1 + 5);
  }, 8000);
});

describe("bug_action", () => {
  beforeEach(async () => {
    await post("/__mock/emit", { bugs: [bugA] });
    await client.waitFor(() => client.of("bug_found").length === 1);
  });

  it.each([
    ["ignore", "ignored"],
    ["expected", "expected"],
    ["reopen", "open"],
  ])("%s → bug_updated %s", async (action, status) => {
    client.send("bug_action", { bugId: bugA.bugId, action });
    await client.waitFor(() => client.of("bug_updated").length === 1);
    expect(client.of("bug_updated")[0]!.payload).toEqual({ bugId: bugA.bugId, status });
  });

  it("file_ticket → bug_updated with an incrementing ALT ticket url", async () => {
    client.send("bug_action", { bugId: bugA.bugId, action: "file_ticket" });
    client.send("bug_action", { bugId: bugA.bugId, action: "file_ticket" });
    await client.waitFor(() => client.of("bug_updated").length === 2);
    expect(client.of("bug_updated").map((u) => u.payload.ticketUrl)).toEqual([
      "https://linear.app/alt/issue/ALT-12",
      "https://linear.app/alt/issue/ALT-13",
    ]);
  });

  it("copy_fix_prompt → fix_prompt naming the likely cause", async () => {
    client.send("bug_action", { bugId: bugA.bugId, action: "copy_fix_prompt" });
    await client.waitFor(() => client.of("fix_prompt").length === 1);
    expect(client.of("fix_prompt")[0]!.payload.text).toContain("invoice-new.tsx:34");
  });

  it("mute_actions suppresses replies", async () => {
    await post("/__mock/config", { mute_actions: true });
    client.send("bug_action", { bugId: bugA.bugId, action: "ignore" });
    await new Promise((r) => setTimeout(r, 300));
    expect(client.of("bug_updated")).toHaveLength(0);
  });
});

describe("control endpoints", () => {
  it("/__mock/emit of 2 bugs yields 2 bug_found", async () => {
    await post("/__mock/emit", { bugs: [plantedBugs[1]!.bug, plantedBugs[2]!.bug] });
    await client.waitFor(() => client.of("bug_found").length === 2);
    expect(client.invalid).toEqual([]);
  });

  it("/__mock/garbage sends malformed frames and pings", async () => {
    await post("/__mock/garbage", { n: 3 });
    await client.waitFor(() => client.invalid.length === 6);
  });

  it("serves the screenshot asset", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/assets/screenshots/invoice-new.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await fetch(`http://127.0.0.1:${port}/assets/../src/main.ts`)).status).toBe(404);
  });
});
