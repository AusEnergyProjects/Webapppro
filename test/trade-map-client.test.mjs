import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isTradeMapClaimsResponse, isTradeMapDatasetResponse, resolveTradeMapClaims, tradeMapQueryUrl, tradeMapViewportUrl, waitForTradeMapRetry } from "../src/lib/trade-map-client.ts";

const located = { status: "located", position: { lat: -37.81, lng: 144.96 }, approximate: false };
const claim = index => ({ addressKey: `address-${index}`, address: `${index + 1} Smith Street, Melbourne VIC 3000, Australia`, leaseToken: `lease-${index}` });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
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

test("lookup claim responses are bounded and accept oversized source addresses for local rejection", () => {
  assert.equal(isTradeMapClaimsResponse({ claims: [claim(0)], retryAfterMs: 0 }), true);
  assert.equal(isTradeMapClaimsResponse({ claims: [ { ...claim(0), address: "a".repeat(700) } ], retryAfterMs: 120_000 }), true);
  assert.equal(isTradeMapClaimsResponse({ claims: Array.from({ length: 21 }, (_, index) => claim(index)), retryAfterMs: 0 }), false);
  assert.equal(isTradeMapClaimsResponse({ claims: [ { ...claim(0), leaseToken: "" } ], retryAfterMs: 0 }), false);
  assert.equal(isTradeMapClaimsResponse({ claims: [], retryAfterMs: -1 }), false);
});

test("a batch resolves at most two addresses concurrently and returns only lease-bound results", async () => {
  let active = 0;
  let peak = 0;
  const inputs = [];
  const claims = Array.from({ length: 10 }, (_, index) => claim(index));
  const result = await resolveTradeMapClaims(claims, async address => {
    inputs.push(address); active += 1; peak = Math.max(peak, active);
    await tick(); active -= 1; return located;
  }, new AbortController().signal);
  assert.equal(peak, 2);
  assert.equal(result.error, null);
  assert.equal(result.results.length, 10);
  assert.deepEqual(inputs.sort(), claims.map(item => item.address).sort(), "only address strings reach the provider");
  assert.deepEqual(result.results.map(item => item.addressKey).sort(), claims.map(item => item.addressKey).sort());
  assert.ok(result.results.every(item => Object.keys(item).sort().join(",") === "addressKey,leaseToken,result"));
});

test("a provider quota failure stops additional lookup starts and remains an error result", async () => {
  let calls = 0;
  const result = await resolveTradeMapClaims(Array.from({ length: 10 }, (_, index) => claim(index)), async () => {
    calls += 1; return { status: "error", reason: "quota" };
  }, new AbortController().signal);
  assert.equal(calls, 2);
  assert.equal(result.error, "quota");
  assert.ok(result.results.every(item => item.result.status === "error"));
});

test("cancellation stops new work while retaining completed results for persistence", async () => {
  const controller = new AbortController();
  const resolvers = [];
  let calls = 0;
  const task = resolveTradeMapClaims(Array.from({ length: 10 }, (_, index) => claim(index)), () => { calls += 1; return new Promise(resolve => resolvers.push(resolve)); }, controller.signal);
  await tick();
  resolvers[0](located);
  await tick();
  controller.abort();
  const result = await task;
  assert.equal(calls, 3, "only the replacement of the completed lookup began before pause");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].addressKey, "address-0");
  assert.equal(result.error, null);
  resolvers.forEach(resolve => resolve(located));
  await tick();
  assert.equal(calls, 3);
});

test("cancelled batches never call Google, invalid addresses are resolved locally, and stalled lookups time out", async () => {
  let calls = 0;
  const stopped = new AbortController(); stopped.abort();
  assert.deepEqual(await resolveTradeMapClaims([claim(0)], async () => { calls += 1; return located; }, stopped.signal), { results: [], error: null });
  const invalid = await resolveTradeMapClaims([{ ...claim(0), address: "a".repeat(700) }], async () => { calls += 1; return located; }, new AbortController().signal);
  assert.equal(invalid.results[0].result.reason, "invalid_address");
  assert.equal(calls, 0);
  const timeout = await resolveTradeMapClaims([claim(0)], () => new Promise(() => {}), new AbortController().signal, 5);
  assert.equal(timeout.error, "unavailable");
  const wait = new AbortController();
  const retry = waitForTradeMapRetry(60_000, wait.signal); wait.abort(); await retry;
});

test("opening a map never starts paid lookup work without the explicit start control", () => {
  const ui = readFileSync(new URL("../src/components/TradeRecordMap.tsx", import.meta.url), "utf8");
  assert.match(ui, /\[lookupState, setLookupState\] = useState\(\{ scope, enabled: false \}\)/);
  assert.match(ui, /runtime\.ownerUid !== businessOwnerUid \|\| !lookupEnabled\) return;/);
  assert.match(ui, /if \(lookupState\.scope !== scope\) setLookupState\(\{ scope, enabled: false \}\)/);
  assert.match(ui, /Start locating addresses/);
  assert.match(ui, /Pause lookups/);
  assert.match(ui, /Google Maps lookup charges may apply/);
});
