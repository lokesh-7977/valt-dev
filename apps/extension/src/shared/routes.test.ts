import assert from "node:assert/strict";
import { test } from "node:test";
import { isCrawlable, normalizeUrl, originOf, routeKey } from "./routes.ts";

const O = "http://localhost:4173";

test("routeKey collapses record ids", () => {
  assert.equal(routeKey(`${O}/invoices/12`), "/invoices/:id");
  assert.equal(routeKey(`${O}/invoices/13/`), "/invoices/:id");
  assert.equal(routeKey(`${O}/users/3f2504e0-4f89-11d3-9a0c-0305e82c3301/edit`), "/users/:id/edit");
  assert.equal(routeKey(`${O}/orders/INV-0042`), "/orders/:id");
  assert.equal(routeKey(`${O}/blobs/a3f9c2e81b7d4c55`), "/blobs/:id");
  assert.equal(routeKey(`${O}/invoices/new`), "/invoices/new");
  assert.equal(routeKey(`${O}/`), "/");
  assert.equal(routeKey(`${O}/settings/team?x=1#h`), "/settings/team");
});

test("isCrawlable accepts same-origin pages only", () => {
  assert.equal(isCrawlable("/customers", O), true);
  assert.equal(isCrawlable(`${O}/invoices/1`, O), true);
  assert.equal(isCrawlable("mailto:a@b.c", O), false);
  assert.equal(isCrawlable("tel:123", O), false);
  assert.equal(isCrawlable("javascript:void(0)", O), false);
  assert.equal(isCrawlable("#top", O), false);
  assert.equal(isCrawlable("/report.pdf", O), false);
  assert.equal(isCrawlable("https://example.com/x", O), false);
  assert.equal(isCrawlable("/x", O, { download: true }), false);
  assert.equal(isCrawlable(`${O}/a#sec`, O, { currentUrl: `${O}/a` }), false);
});

test("helpers", () => {
  assert.equal(originOf(`${O}/x?y`), O);
  assert.equal(originOf("chrome://extensions"), null);
  assert.equal(normalizeUrl("/a#b", `${O}/z`), `${O}/a`);
});
