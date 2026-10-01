import assert from "node:assert/strict";
import test from "node:test";
import { isTradeMapDatasetResponse, tradeMapQueryUrl, tradeMapViewportUrl, waitForTradeMapRetry } from "../src/lib/trade-map-client.ts";

const located = { status: "located", position: { lat: -37.81, lng: 144.96 }, approximate: false };
const claim = index => ({ addressKey: `address-${index}`, address: `${index + 1} Smith Street, Melbourne VIC 3000, Australia`, leaseToken: `lease-${index}` });
const dataset = () => ({ resource: "customers", total: 50_000, mapped: 40_000, approximate: 500, pending: 9_000, unmapped: 1_000, inViewport: 20_000, listTotal: 30_000, bounds: { north: -37, south: -38, east: 145, west: 144 }, markers: [{ id: "cell-1", count: 20_000, position: located.position, bounds: { north: -37, south: -38, east: 145, west: 144 }, category: "customer", approximate: false }], items: [], page: 1, pageSize: 50, hasMore: true });

test("map queries keep filters stable and exclude register pagination and untrusted map controls", () => {
  const left = tradeMapQueryUrl({ resource: "customers", filters: { search: "Smith & Co", state: "VIC", page: "20", pageSize: "25", mode: "index", resource: "jobs", north: "88" } });
  const right = tradeMapQueryUrl({ resource: "customers", filters: { state: "VIC", search: "Smith & Co" } });
  assert.equal(left, right);
  const url = new URL(tradeMapViewportUrl(left, { bounds: { north: -37.1234567, south: -38, east: 145, west: 144 }, page: 3, addressKey: "3 Smith St & unit 2", locationStatus: "located" }), "https://example.test");
  assert.equal(url.searchParams.get("page"), null);
  assert.equal(url.searchParams.get("pageSize"), null);
  assert.equal(url.searchParams.get("resource"), "customers");
  assert.equal(url.searchParams.get("mapPage"), "3");
  assert.equal(url.searchParams.get("north"), "-37.12346");
  assert.equal(url.searchParams.get("mapAddressKey"), "3 Smith St & unit 2");
  assert.equal(url.searchParams.get("mapLocationStatus"), "located");
});

test("50,000-record summaries are accepted without permitting 50,000 DOM records or markers", () => {
  assert.equal(isTradeMapDatasetResponse(dataset()), true);
  assert.equal(isTradeMapDatasetResponse({ ...dataset(), markers: Array(401).fill(dataset().markers[0]) }), false);
  assert.equal(isTradeMapDatasetResponse({ ...dataset(), items: Array(51).fill({}) }), false);
  assert.equal(isTradeMapDatasetResponse({ ...dataset(), pending: -1 }), false);
  assert.equal(isTradeMapDatasetResponse({ ...dataset(), bounds: { north: -40, south: -30, east: 145, west: 144 } }), false);
  assert.equal(isTradeMapDatasetResponse({ ...dataset(), markers: [{ ...dataset().markers[0], position: { lat: Infinity, lng: 144 } }] }), false);
  assert.equal(isTradeMapDatasetResponse({ ...dataset(), markers: [{ ...dataset().markers[0], category: "made-up-status" }] }), false);
  const item = { id: "1", kind: "customer", title: "A Customer", reference: "CUS-1", detail: "2 linked jobs", address: claim(0).address, addressKey: "address-0", position: located.position, locationStatus: "located" };
  assert.equal(isTradeMapDatasetResponse({ ...dataset(), items: [item] }), true);
  assert.equal(isTradeMapDatasetResponse({ ...dataset(), items: [{ ...item, locationStatus: "invented" }] }), false);
});

test("cancelled retry waits finish promptly", async () => { const stop = new AbortController(); const waiting = waitForTradeMapRetry(60000, stop.signal); stop.abort(); await waiting; });
