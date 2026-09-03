import test from "node:test";
import assert from "node:assert/strict";
import {
  GAS_MARKETS,
  dollarsPerGjToCentsPerKwh,
  gasChartPath,
  gasMarketForRegion,
  gasPointAt,
  isGasSnapshot,
  normaliseDwgmGas,
  normaliseSttmGas,
} from "../src/lib/gas-wholesale.ts";
import { GAS_DWGM_URL, GAS_STTM_URL, loadGasSnapshot, runtimeGasCache } from "../src/lib/gas-wholesale-server.ts";

const now = Date.parse("2026-09-03T16:20:00Z");
const sttmHeader = "GAS_DATE,HUB_DESCRIPTION,EX_ANTE_PRICE,EX_ANTE_TJ,EX_POST_PRICE,EX_POST_TJ,PERIODTYPE";
const dwgmHeader = "DATETIME,INTERVAL_NO,TRANSMISSION_ID,PRICE,DEMAND,PERIODTYPE";
const sttm = (extra = []) => [
  sttmHeader,
  "2026/09/02 00:00:00,Sydney,9.5,240,9.4,241,ACTUAL",
  "2026/09/03 00:00:00,Sydney,10,251,,,ACTUAL",
  "2026/09/03 00:00:00,Brisbane,11,48,,,ACTUAL",
  "2026/09/03 00:00:00,Adelaide,12,59,,,ACTUAL",
  "2026/09/04 00:00:00,Sydney,99,250,,,FORECAST",
  ...extra,
].join("\n");
const dwgm = (extra = []) => [
  dwgmHeader,
  "2026/09/03 06:00:00,1,280570,9.8,561.65,ACTUAL",
  "2026/09/03 10:00:00,2,280574,9.56,561.65,ACTUAL",
  "2026/09/03 14:00:00,3,280578,9.8,561.65,ACTUAL",
  "2026/09/03 18:00:00,4,280582,9.6,561.65,ACTUAL",
  "2026/09/03 22:00:00,5,280584,9.6,561.65,ACTUAL",
  "2026/09/04 06:00:00,1,280600,99,560,FORECAST",
  ...extra,
].join("\n");
const sources = async (url, init) => {
  assert.equal(init.method, "GET");
  assert.ok(init.signal instanceof AbortSignal);
  assert.match(init.headers.Accept, /application\/octet-stream/);
  if (url === GAS_STTM_URL) return new Response(sttm(), { headers: { "Content-Type": "application/octet-stream" } });
  assert.equal(url, GAS_DWGM_URL);
  return new Response(dwgm(), { headers: { "Content-Type": "application/octet-stream" } });
};
const memoryCache = () => {
  const entries = new Map();
  return { async match(request) { return entries.get(request.url)?.clone(); }, async put(request, response) { entries.set(request.url, response.clone()); } };
};

test("STTM actual daily ex-ante prices map to their nearby NEM regions without treating blank ex-post cells as zero", () => {
  const regions = normaliseSttmGas(sttm(), now);
  assert.equal(regions.length, 3);
  const sydney = regions.find(({ id }) => id === "NSW1");
  assert.equal(sydney.points.length, 2);
  assert.equal(sydney.points.at(-1).time, Date.parse("2026-09-02T20:00:00Z"));
  assert.equal(sydney.points.at(-1).validUntil, Date.parse("2026-09-03T20:00:00Z"));
  assert.equal(sydney.points.at(-1).dollarsPerGj, 10);
  assert.ok(Math.abs(sydney.points.at(-1).centsPerKwh - 3.6) < 1e-9);
  assert.equal(sydney.points.at(-1).basis, "daily-ex-ante");
  assert.equal(regions.find(({ id }) => id === "QLD1").points.at(-1).dollarsPerGj, 11);
  assert.equal(regions.find(({ id }) => id === "SA1").points.at(-1).dollarsPerGj, 12);
  assert.ok(Math.abs(dollarsPerGjToCentsPerKwh(10) - 3.6) < 1e-9);
});

test("STTM forecasts, unknown hubs, malformed values and conflicting duplicates cannot become current prices", () => {
  const regions = normaliseSttmGas(sttm([
    "2026/09/03 00:00:00,Sydney,10.1,251,,,ACTUAL",
    "2026/09/03 00:00:00,Perth,7,20,,,ACTUAL",
    "2026/09/03 00:00:00,Brisbane,,48,,,ACTUAL",
  ]), now);
  assert.equal(regions.find(({ id }) => id === "NSW1").points.length, 1);
  assert.equal(regions.find(({ id }) => id === "QLD1").points.length, 1);
  assert.throws(() => normaliseSttmGas([sttmHeader, "2026/09/04 00:00:00,Sydney,10,250,,,FORECAST"].join("\n"), now), /No recent/);
  assert.throws(() => normaliseSttmGas("wrong,headers\n1,2", now), /headers/);
});

test("DWGM actual schedules retain native timestamps and reject forecast or duplicate contradictions", () => {
  const region = normaliseDwgmGas(dwgm(), now);
  assert.equal(region.id, "VIC1");
  assert.equal(region.points.length, 5);
  assert.equal(region.points.at(-1).time, Date.parse("2026-09-03T12:00:00Z"));
  assert.equal(region.points.at(-1).validUntil, Date.parse("2026-09-03T20:00:00Z"));
  assert.equal(region.points.at(-1).centsPerKwh, 3.456);
  assert.equal(region.points.at(-1).basis, "schedule");
  const conflict = normaliseDwgmGas(dwgm(["2026/09/03 22:00:00,5,280584,10.6,561.65,ACTUAL"]), now);
  assert.equal(conflict.points.length, 4);
});

test("DWGM rejects non-standard and mismatched schedule timestamps", () => {
  const region = normaliseDwgmGas(dwgm([
    "2026/09/03 23:17:45,99,280599,1,561.65,ACTUAL",
    "2026/09/03 10:00:00,1,280574,1,561.65,ACTUAL",
    "2026/09/03 14:01:00,3,280578,1,561.65,ACTUAL",
  ]), now);
  assert.equal(region.points.length, 5);
  assert.equal(region.points.some(({ dollarsPerGj }) => dollarsPerGj === 1), false);
});

test("gas market mapping is explicit and Tasmania remains unavailable", () => {
  assert.equal(gasMarketForRegion("NSW1").label, "Sydney gas");
  assert.equal(gasMarketForRegion("QLD1").label, "Brisbane gas");
  assert.equal(gasMarketForRegion("VIC1").label, "Victorian gas");
  assert.equal(gasMarketForRegion("SA1").label, "Adelaide gas");
  assert.equal(gasMarketForRegion("TAS1"), null);
});

test("gas values use step paths and applicable-price lookup rather than invented five-minute interpolation", () => {
  const points = [
    { time: 0, validUntil: 10, dollarsPerGj: 5, centsPerKwh: 2, basis: "schedule" },
    { time: 10, validUntil: 20, dollarsPerGj: 7.5, centsPerKwh: 3, basis: "schedule" },
  ];
  assert.equal(gasPointAt(points, 9), points[0]);
  assert.equal(gasPointAt(points, 10), points[1]);
  assert.equal(gasPointAt(points, 20), null);
  assert.equal(gasPointAt(points, -1), null);
  assert.equal(gasChartPath(points, 5, 15, (value) => value, (value) => value), "M5.00,2.00 L10.00,2.00 L10.00,3.00 L15.00,3.00");
  assert.equal(gasChartPath(points, 20, 30, (value) => value, (value) => value), "");
});

test("independent sources become a bounded validated gas snapshot", async () => {
  const snapshot = await loadGasSnapshot({ fetchImpl: sources, now });
  assert.ok(isGasSnapshot(snapshot));
  assert.equal(snapshot.regions.length, GAS_MARKETS.length);
  assert.equal(snapshot.refreshFailed, false);
  assert.deepEqual(snapshot.failedSources, []);
  assert.ok(JSON.stringify(snapshot).length < 20_000);
  assert.ok(!isGasSnapshot({ ...snapshot, regions: [...snapshot.regions.slice(0, 3), snapshot.regions[0]] }));
  assert.ok(!isGasSnapshot({ ...snapshot, regions: snapshot.regions.map((region) => ({ ...region, points: region.points.map((point) => ({ ...point, centsPerKwh: point.centsPerKwh + 1 })) })) }));
  assert.ok(!isGasSnapshot({ ...snapshot, regions: snapshot.regions.map((region) => region.id === "VIC1" ? { ...region, points: region.points.map((point) => ({ ...point, basis: "daily-ex-ante" })) } : region) }));
});

test("one gas source may fail without hiding valid data from the other source", async () => {
  const onlyVictoria = await loadGasSnapshot({ now, fetchImpl: async (url, init) => url === GAS_STTM_URL ? new Response("", { status: 503 }) : sources(url, init) });
  assert.equal(onlyVictoria.refreshFailed, true);
  assert.deepEqual(onlyVictoria.failedSources, ["sttm"]);
  assert.equal(onlyVictoria.regions.find(({ id }) => id === "VIC1").points.length, 5);
  assert.ok(onlyVictoria.regions.filter(({ id }) => id !== "VIC1").every(({ points }) => points.length === 0));
  await assert.rejects(loadGasSnapshot({ now, fetchImpl: async () => new Response("", { status: 503 }) }), /HTTP 503/);

  const cache = memoryCache();
  const cacheKey = new Request("https://example.com/api/wholesale-gas/partial-cache-v1");
  await loadGasSnapshot({ now, fetchImpl: sources, cache, cacheKey });
  const partial = await loadGasSnapshot({ now: now + 6 * 60_000, cache, cacheKey, fetchImpl: async (url, init) => url === GAS_STTM_URL ? new Response("", { status: 503 }) : sources(url, init) });
  assert.ok(partial.regions.filter(({ id }) => id !== "VIC1").every(({ points }) => points.length === 0));
  assert.equal(partial.fetchedAt, now + 6 * 60_000);
});

test("gas source responses are type and size bounded", async () => {
  await assert.rejects(loadGasSnapshot({ now, fetchImpl: async () => new Response(sttm(), { headers: { "Content-Type": "text/html" } }) }), /content type/);
  await assert.rejects(loadGasSnapshot({ now, fetchImpl: async () => new Response("", { headers: { "Content-Length": "500001" } }) }), /size limit/);
});

test("Sites uses a separate named gas cache and serves bounded last-good data", async () => {
  const namedCache = { match: async () => undefined, put: async () => {} };
  const storage = { get default() { throw new Error("Disabled in namespaced Workers"); }, open: async (name) => { assert.equal(name, "aea-gas-wholesale-v1"); return namedCache; } };
  assert.equal(await runtimeGasCache(storage), namedCache);
  assert.equal(await runtimeGasCache(undefined), undefined);

  const cache = memoryCache();
  const cacheKey = new Request("https://example.com/api/wholesale-gas/cache-v1");
  const original = await loadGasSnapshot({ fetchImpl: sources, now, cache, cacheKey });
  let calls = 0;
  const failing = async () => { calls += 1; throw new Error("offline"); };
  assert.deepEqual(await loadGasSnapshot({ fetchImpl: failing, now: now + 60_000, cache, cacheKey }), original);
  assert.equal(calls, 0);
  const stale = await loadGasSnapshot({ fetchImpl: failing, now: now + 6 * 60_000, cache, cacheKey });
  assert.equal(stale.refreshFailed, true);
  assert.deepEqual(stale.failedSources, ["sttm", "dwgm"]);
  assert.equal(calls, 2);
  await assert.rejects(loadGasSnapshot({ fetchImpl: failing, now: now + 36 * 60 * 60_000 + 1, cache, cacheKey }), /offline/);
});
