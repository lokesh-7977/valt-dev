import { beforeEach } from "vitest";
import { createChromeFake } from "./chrome-fake";

// A fresh in-memory chrome.* fake for every test.
beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = createChromeFake();
});
