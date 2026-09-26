import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BugSchema } from "@valt/protocol";
import { describe, expect, it } from "vitest";
import bugs from "./bugs.json" with { type: "json" };

const source = ["../src/routes/invoice-new.tsx", "../src/routes/invoice-list.tsx"]
  .map((p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8"))
  .join("\n");

describe("planted bugs fixture", () => {
  it("has exactly 10 bugs, 6 of them in the sweep", () => {
    expect(bugs).toHaveLength(10);
    expect(bugs.filter((b) => b.sweep)).toHaveLength(6);
  });

  it.each(bugs)("$bug.bugId matches the §2 Bug shape with no extra keys", ({ bug }) => {
    const result = BugSchema.strict().safeParse(bug);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(bugs.filter((b) => b.expect.testid !== null))(
    "$bug.bugId expects data-testid $expect.testid that exists in the route source",
    ({ expect: e }) => {
      expect(source).toMatch(new RegExp(`(data-testid|testid)=?[{"]?.*${e.testid}`));
    },
  );

  it("covers every severity and exactly one unresolvable anchor", () => {
    expect(new Set(bugs.map((b) => b.bug.severity))).toEqual(
      new Set(["critical", "high", "medium", "low"]),
    );
    expect(bugs.filter((b) => b.expect.testid === null)).toHaveLength(1);
    const testidAnchors = bugs.filter(
      (b) => b.expect.testid !== null && b.bug.anchor.selector.startsWith("[data-testid="),
    );
    expect(testidAnchors.length).toBeGreaterThanOrEqual(8);
    // One anchor is deliberately stale and must resolve through its fallbackText.
    expect(
      bugs.filter((b) => b.expect.testid !== null && !b.bug.anchor.selector.includes(b.expect.testid)),
    ).toHaveLength(1);
  });
});
