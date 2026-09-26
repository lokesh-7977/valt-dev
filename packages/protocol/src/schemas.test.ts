import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  EXTENSION_TO_HELPER_TYPES,
  HELPER_TO_EXTENSION_TYPES,
  isTruncated,
  parseExtensionMessage,
  parseHelperMessage,
  truncatedMarker,
} from "./index.js";

const fixturesDir = fileURLToPath(new URL("../fixtures/messages/", import.meta.url));
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({
    name: f.replace(/\.json$/, ""),
    data: JSON.parse(readFileSync(fixturesDir + f, "utf8")) as {
      type: string;
      payload: Record<string, unknown>;
    },
  }));

const parserFor = (type: string) =>
  EXTENSION_TO_HELPER_TYPES.includes(type) ? parseExtensionMessage : parseHelperMessage;

describe("golden fixtures", () => {
  it("has one fixture per §2 message plus bug_action_reopen", () => {
    expect(fixtures).toHaveLength(15);
    const types = new Set(fixtures.map((f) => f.data.type));
    expect([...types].sort()).toEqual(
      [...EXTENSION_TO_HELPER_TYPES, ...HELPER_TO_EXTENSION_TYPES].sort(),
    );
  });

  it.each(fixtures)("$name parses ok in its direction", ({ data }) => {
    const result = parserFor(data.type)(JSON.stringify(data));
    expect(result.ok).toBe(true);
  });

  it.each(fixtures)("$name with a required payload field deleted is invalid", ({ data }) => {
    const [firstKey] = Object.keys(data.payload);
    const payload = { ...data.payload };
    delete payload[firstKey!];
    const result = parserFor(data.type)(JSON.stringify({ ...data, payload }));
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("parse", () => {
  it("returns unknown_type for ping (not in v1)", () => {
    const raw = '{"type":"ping","id":"x","ts":1,"payload":{}}';
    expect(parseHelperMessage(raw)).toEqual({ ok: false, reason: "unknown_type", type: "ping" });
    expect(parseExtensionMessage(raw)).toEqual({ ok: false, reason: "unknown_type", type: "ping" });
  });

  it("returns json for malformed input", () => {
    expect(parseHelperMessage("not json")).toEqual({ ok: false, reason: "json" });
  });

  it("accepts copy_fix_prompt and reopen, rejects fix_prompt as an action", () => {
    const action = (a: string) =>
      JSON.stringify({ type: "bug_action", id: "1", ts: 1, payload: { bugId: "b", action: a } });
    expect(parseExtensionMessage(action("copy_fix_prompt")).ok).toBe(true);
    expect(parseExtensionMessage(action("reopen")).ok).toBe(true);
    expect(parseExtensionMessage(action("fix_prompt"))).toMatchObject({ reason: "invalid" });
  });

  it("rejects a welcome without v", () => {
    const welcome = JSON.parse(readFileSync(fixturesDir + "welcome.json", "utf8"));
    delete welcome.payload.v;
    expect(parseHelperMessage(JSON.stringify(welcome))).toMatchObject({ reason: "invalid" });
  });

  it("detects the truncation marker", () => {
    expect(isTruncated("abc" + truncatedMarker(71680))).toBe(true);
    expect(isTruncated("abc")).toBe(false);
  });
});

describe("zod jitless", () => {
  it("sets zod's global jitless flag", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("never calls Function while building and using schemas", async () => {
    vi.resetModules();
    const spy = vi.spyOn(globalThis, "Function");
    const mod = await import("./index.js");
    mod.parseHelperMessage(readFileSync(fixturesDir + "bug_found.json", "utf8"));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("§2 conformance", () => {
  const adr = readFileSync(
    fileURLToPath(new URL("../../../docs/adr/0016-alt-helper-websocket-protocol.md", import.meta.url)),
    "utf8",
  );
  const block = adr.match(/```ts\n([\s\S]*?)\n```/)![1]!.split("\n");
  const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8")
    .split("\n")
    .map((l) => l.replace(/^export /, ""));
  const TAG = "  // §2 + approved addition";

  it("copies every §2 line verbatim except the three tagged additions", () => {
    const tagged = source.filter((l) => l.endsWith(TAG));
    expect(tagged).toHaveLength(3);
    for (const line of block) {
      if (/^type (Hello|Welcome|BugAction) /.test(line)) continue;
      expect(source).toContain(line);
    }
  });

  it("tagged lines differ only by v: 1 / reopen", () => {
    const find = (name: string) => source.find((l) => l.startsWith(`type ${name} `))!;
    const orig = (name: string) => block.find((l) => l.startsWith(`type ${name} `))!;
    expect(find("Hello")).toBe(
      orig("Hello").replace("extVersion: string }", "extVersion: string; v: 1 }") + TAG,
    );
    expect(find("Welcome")).toBe(
      orig("Welcome").replace('mode: "live"|"paused" }', 'mode: "live"|"paused"; v: 1 }') + TAG,
    );
    expect(find("BugAction")).toBe(
      orig("BugAction").replace('"copy_fix_prompt" }', '"copy_fix_prompt" | "reopen" }') + TAG,
    );
  });
});
