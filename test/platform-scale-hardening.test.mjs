import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0044_flimsy_omega_flight.sql");
const performance = read("../src/lib/route-performance.ts");
const performanceRoute = read("../src/app/api/admin/performance/route.ts");
const lookupRoute = read("../src/app/api/admin/lookups/route.ts");
const lookupUi = read("../src/components/SearchableLookup.tsx");
const styles = read("../src/app/globals.css");
const paginationUi = read("../src/components/WorkspaceListControls.tsx");

const pagedRoutes = [
  "../src/app/api/admin/accounts/route.ts",
  "../src/app/api/admin/directory/route.ts",
  "../src/app/api/admin/opportunities/route.ts",
  "../src/app/api/admin/products/route.ts",
  "../src/app/api/supplier-products/route.ts",
  "../src/app/api/trade-purchasing/route.ts",
  "../src/app/api/trade-crm/route.ts",
].map(read);

test("performance telemetry is privacy safe and available to operations roles", () => {
  assert.match(migration, /CREATE TABLE `api_performance_samples`/);
  assert.match(performance, /Server-Timing/);
  assert.match(performance, /X-TLink-Response-Time/);
  assert.match(performance, /db_duration_ms/);
  assert.doesNotMatch(performance, /email|phone|address|postcode|search[_ ]?term|request\.url/i);
  assert.match(performanceRoute, /requireAdminIdentity/);
  assert.match(performanceRoute, /p50Ms/);
  assert.match(performanceRoute, /p95Ms/);
});

test("all large business datasets use keyset pagination with guarded navigation", () => {
  for (const route of pagedRoutes) {
    assert.match(route, /decodeKeysetCursor/);
    assert.match(route, /keysetAfter/);
    assert.doesNotMatch(route, /LIMIT \? OFFSET \?/);
  }
  assert.match(paginationUi, /controlsBusy/);
  assert.match(paginationUi, /900/);
  assert.match(paginationUi, /hasNext/);
});

test("large selectors use bounded authenticated server lookups", () => {
  assert.match(lookupRoute, /requireAdminIdentity/);
  assert.match(lookupRoute, /LIMIT 25/);
  assert.match(lookupRoute, /installer|opportunity|customer|product/);
  assert.match(lookupUi, /role="combobox"/);
  assert.match(lookupUi, /role="listbox"/);
  assert.match(lookupUi, /aria-activedescendant/);
});

test("D1 full text indexes cover products, accounts, customers and opportunities", () => {
  for (const table of [
    "tlink_product_search",
    "tlink_account_search",
    "tlink_customer_search",
    "tlink_opportunity_search",
    "tlink_crm_customer_search",
  ]) {
    assert.match(migration, new RegExp(`CREATE VIRTUAL TABLE ${table} USING fts5`));
    assert.match(migration, new RegExp(`CREATE TRIGGER ${table}_insert`));
    assert.match(migration, new RegExp(`CREATE TRIGGER ${table}_update`));
    assert.match(migration, new RegExp(`CREATE TRIGGER ${table}_delete`));
  }
});

test("dense dashboards share the responsive TLink table foundation", () => {
  assert.match(styles, /:is\(\.tlink-data-table, \.crm-record-table, \.purchasing-order-list\)/);
  assert.match(styles, /position: sticky/);
  assert.match(styles, /scrollbar-width: thin/);
  assert.match(styles, /text-overflow: ellipsis/);
});
