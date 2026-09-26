import { describe, expect, it } from "vitest";
import { isCandidateRequest } from "./filter";

describe("isCandidateRequest", () => {
  it.each([
    "http://localhost:5180/@vite/client",
    "http://localhost:5180/@react-refresh",
    "http://localhost:3000/_next/webpack-hmr",
    "http://localhost:3000/_next/static/chunks/main.js",
    "http://localhost:8080/__webpack_hmr",
    "http://localhost:8080/main.abc.hot-update.json",
    "http://localhost:8080/sockjs-node/info",
    "http://localhost:5180/assets/logo.png",
    "http://localhost:5180/assets/index.css",
    "http://localhost:5180/fonts/a.woff2",
    "http://127.0.0.1:7777/assets/screenshots/invoice-new.png",
    "ws://localhost:5180/",
    "data:text/plain,hi",
  ])("rejects %s", (url) => {
    expect(isCandidateRequest(url, "GET")).toBe(false);
  });

  it.each([
    ["http://localhost:5180/api/invoices", "POST"],
    ["http://localhost:5180/api/invoices", "GET"],
    ["/api/invoices", "PUT"],
  ])("accepts %s %s", (url, method) => {
    expect(isCandidateRequest(url, method)).toBe(true);
  });
});
