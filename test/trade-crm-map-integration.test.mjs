import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tradeMapQuery } from "../src/lib/trade-map-contract.ts";

const ui = fs.readFileSync(new URL("../src/components/InstallerCrmWorkspace.tsx", import.meta.url), "utf8");

test("map queries preserve register filters while removing list pagination and cursors", () => {
  const filters = "search=Taylor&state=VIC&postcode=3000&service=insulation&operationalStatus=imported&scheduledFromUtc=2026-10-01T00%3A00%3A00Z&filter=all";
  const first = tradeMapQuery("jobs", new URLSearchParams(`${filters}&mode=index&resource=jobs&page=1&pageSize=25&total=0&sort=name`), 3);
  const last = tradeMapQuery("jobs", new URLSearchParams(`${filters}&mode=index&resource=jobs&page=2000&pageSize=100&cursor=opaque`), 3);
  assert.deepEqual(first, last);
  assert.deepEqual(first, { resource: "jobs", revision: 3, filters: { search: "Taylor", state: "VIC", postcode: "3000", service: "insulation", operationalStatus: "imported", scheduledFromUtc: "2026-10-01T00:00:00Z", filter: "all" } });
});

test("customer map filters remain independent of the current customer page", () => {
  const params = new URLSearchParams("page=2000&pageSize=25&businessName=Example&email=a%40example.test&createdFromUtc=2026-01-01&street=&cursor=old");
  assert.deepEqual(tradeMapQuery("customers", params).filters, { businessName: "Example", email: "a@example.test", createdFromUtc: "2026-01-01" });
  assert.equal(params.get("page"), "2000", "constructing a map query must not mutate the list state");
});

test("all map layouts use their independent dataset and retain focused-record navigation", () => {
  assert.match(ui, /const usesJobIndex = !mapWorkspace && jobLayout === "list"/);
  assert.match(ui, /mapWorkspace \|\| customerLayout === "map"/);
  assert.match(ui, /jobLayout === "list" && <WorkspaceListControls page=\{jobPagination\.page\}/);
  assert.match(ui, /customerLayout === "list" && <WorkspaceListControls page=\{customerPagination\.page\}/);
  assert.match(ui, /query=\{jobMapQuery\} onOpenRecord=\{\(record\) => openFocusedJob\(record.id\)\}/);
  assert.match(ui, /query=\{customerMapQuery\} onOpenRecord=\{\(record\) => setSelectedCustomerId\(record.id\)\}/);
  assert.match(ui, /query=\{view === "jobs" \? jobMapQuery : customerMapQuery\}/);
  assert.doesNotMatch(ui, /Map shows this page|jobMapRecords|customerMapRecords/);
});

test("customer map entry clears selection and never offers bulk actions for hidden rows", () => {
  assert.match(ui, /setSelectedCustomerIds\(\[\]\); setCustomerActionId\(""\); setCustomerLayout\("map"\)/);
  assert.match(ui, /customerLayout === "list" && selectedCustomerIds.length > 0 && <div className="crm-bulk-actions"/);
});

test("location retention runs on the configured daily schedule and health maintenance", () => {
  const worker = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  const config = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /15 20 \* \* \*/);
  assert.match(worker, /url.pathname === "\/api\/health"[\s\S]*?cleanupExpiredTradeMapLocations\(database\)/);
  assert.match(worker, /controller.cron === DAILY_MAINTENANCE_CRON[\s\S]*?cleanupExpiredTradeMapLocations\(db\)/);
});
