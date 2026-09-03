import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEM_DAY_MS, NEM_INTERVAL_MS, NEM_REGIONS, isNemSnapshot, latestNemPoint, nemChartPath, nemTimeLabel, normaliseNemFlows, normaliseNemHistory, parseNemTime } from "../src/lib/nem-wholesale.ts";
import { loadNemSnapshot, NEM_HISTORY_URL, NEM_SUMMARY_URL, runtimeMarketCache } from "../src/lib/nem-wholesale-server.ts";
import { searchPublicSite } from "../src/lib/public-site-search.ts";

const now = Date.parse("2026-09-03T16:20:00Z");
const formatSourceTime = (time) => new Date(time + 10 * 60 * 60 * 1000).toISOString().slice(0, 19);
const row = (overrides = {}) => ({ SETTLEMENTDATE: formatSourceTime(now), REGIONID: "VIC1", RRP: 103.54774, PERIODTYPE: "ACTUAL", ...overrides });
const history = () => ({ "5MIN": NEM_REGIONS.flatMap(({ id }) => Array.from({ length: 576 }, (_, index) => row({ SETTLEMENTDATE: formatSourceTime(now - index * NEM_INTERVAL_MS), REGIONID: id, RRP: index === 0 ? -15 : 100 + index }))) });
const summaryRow = (id, values, time = now) => ({ REGIONID: id, SETTLEMENTDATE: formatSourceTime(time), INTERCONNECTORFLOWS: JSON.stringify(values) });
const sources = async (url, init) => {
  assert.ok(init.signal instanceof AbortSignal);
  if (url === NEM_HISTORY_URL) { assert.equal(init.method, "POST"); assert.deepEqual(JSON.parse(init.body), { timeScale: ["5MIN"] }); return Response.json(history()); }
  assert.equal(url, NEM_SUMMARY_URL);
  return Response.json({ ELEC_NEM_SUMMARY: [] });
};
const memoryCache = () => {
  const entries = new Map();
  return { async match(request) { return entries.get(request.url)?.clone(); }, async put(request, response) { entries.set(request.url, response.clone()); } };
};

test("AEMO timestamps use fixed AEST including daylight saving and permit only valid five-minute intervals", () => {
  assert.equal(parseNemTime("2026-12-01T12:00:00"), Date.parse("2026-12-01T02:00:00Z"));
  assert.equal(nemTimeLabel(Date.parse("2026-12-01T02:00:00Z")), "12:00");
  for (const value of [null, "2026-02-30T12:00:00", "2026-09-04T12:01:00", "2026-09-04T12:00:01", "2026-09-04T12:00:00Z", "garbage"]) assert.equal(parseNemTime(value), null);
});

test("48 hours become exactly 24 hours of five-minute regional readings with honest unit conversion", () => {
  const data = normaliseNemHistory(history(), now);
  assert.equal(data.regions.length, 5);
  for (const region of data.regions) {
    assert.equal(region.points.length, 288);
    assert.equal(region.points[0].time, now - NEM_DAY_MS + NEM_INTERVAL_MS);
    assert.equal(region.points.at(-1).time, now);
    assert.equal(region.points.at(-1).centsPerKwh, -1.5);
    assert.equal(region.points.at(-2).centsPerKwh, 10.1);
  }
  const exact = normaliseNemHistory({ "5MIN": [row()] }, now);
  assert.equal(latestNemPoint(exact.regions.find(({ id }) => id === "VIC1")).centsPerKwh, 10.354774);
});

test("zero is real, missing and malformed prices remain gaps, forecasts and foreign regions are excluded", () => {
  const result = normaliseNemHistory({ "5MIN": [
    row({ REGIONID: "NSW1", RRP: 0 }), row({ RRP: null }), row({ RRP: "100" }),
    row({ REGIONID: "WA1", RRP: 100 }), row({ REGIONID: "QLD1", PERIODTYPE: "FORECAST" }), row({ REGIONID: "SA1", RRP: Infinity }),
  ] }, now);
  assert.equal(latestNemPoint(result.regions[0]).centsPerKwh, 0);
  for (const region of result.regions.slice(1)) assert.equal(latestNemPoint(region), null);
  assert.throws(() => normaliseNemHistory({ "5MIN": [row({ PERIODTYPE: "FORECAST" })] }, now), /No recent/);
});

test("conflicting duplicate readings fail closed while consistent duplicates do not change the value", () => {
  const result = normaliseNemHistory({ "5MIN": [row(), row(), row({RRP:200}), row(), row({REGIONID:"NSW1"})] }, now);
  assert.equal(latestNemPoint(result.regions.find(({id})=>id === "VIC1")), null);
  const consistent = normaliseNemHistory({ "5MIN": [row(), row()] }, now);
  assert.equal(latestNemPoint(consistent.regions.find(({id})=>id === "VIC1")).centsPerKwh, 10.354774);
  assert.throws(() => normaliseNemHistory({ "5MIN": [row(), row({RRP:200})] }, now), /No recent/);
});

test("current interval-end may be five minutes ahead but future forecasts and very old feeds cannot look current", () => {
  const current = normaliseNemHistory({ "5MIN": [row({SETTLEMENTDATE:formatSourceTime(now + NEM_INTERVAL_MS)})] }, now);
  assert.equal(current.windowEnd, now + NEM_INTERVAL_MS);
  assert.throws(() => normaliseNemHistory({ "5MIN": [row({SETTLEMENTDATE:formatSourceTime(now + 2 * NEM_INTERVAL_MS)})] }, now));
  assert.throws(() => normaliseNemHistory({ "5MIN": [row({SETTLEMENTDATE:formatSourceTime(now - 2 * NEM_DAY_MS)})] }, now));
  assert.throws(() => normaliseNemHistory({ "5MIN": Array(10001).fill(row()) }, now));
});

test("chart paths use true time positions and break rather than interpolate across absent observations", () => {
  assert.equal(nemChartPath([{time:0,centsPerKwh:0},{time:5,centsPerKwh:-2},{time:10,centsPerKwh:null},{time:15,centsPerKwh:3}], (time)=>time, (value)=>value), "M0.00,0.00 L5.00,-2.00  M15.00,3.00");
});

test("interconnector values are deduplicated and negative values reverse the official north/west-positive direction", () => {
  const flow = {name:"T-V-MNSP1",value:-296.12};
  const result = normaliseNemFlows({ELEC_NEM_SUMMARY:[summaryRow("TAS1",[flow]),summaryRow("VIC1",[flow])]}, now);
  assert.deepEqual(result, [{id:"T-V-MNSP1",from:"VIC1",to:"TAS1",mw:296.12,time:now}]);
  assert.equal(normaliseNemFlows({ELEC_NEM_SUMMARY:[summaryRow("NSW1",[flow])]}, now).length, 0);
});

test("flow contradictions and malformed data are unavailable rather than invented zeros", () => {
  assert.deepEqual(normaliseNemFlows({ELEC_NEM_SUMMARY:[summaryRow("TAS1",[{name:"T-V-MNSP1",value:100}]),summaryRow("VIC1",[{name:"T-V-MNSP1",value:200}])]}, now), []);
  assert.deepEqual(normaliseNemFlows({ELEC_NEM_SUMMARY:[summaryRow("VIC1",[{name:"unknown",value:100}]),{...summaryRow("VIC1",[]),INTERCONNECTORFLOWS:"bad"}]}, now), []);
  assert.deepEqual(normaliseNemFlows(null, now), []);
});

test("upstream data becomes a bounded validated public snapshot", async () => {
  const result = await loadNemSnapshot({fetchImpl:sources,now});
  assert.ok(isNemSnapshot(result));
  assert.equal(result.refreshFailed,false);
  assert.equal(result.fetchedAt,now);
  assert.ok(JSON.stringify(result).length < 100_000);
  assert.ok(!isNemSnapshot({...result,regions:[...result.regions.slice(0,4),result.regions[0]]}));
  assert.ok(!isNemSnapshot({...result,regions:[]}));
});

test("Sites opens an isolated named cache without touching the disabled default cache", async () => {
  const namedCache = { match: async () => undefined, put: async () => {} };
  const storage = {
    get default() { throw new Error("Disabled in namespaced Workers"); },
    open: async (name) => { assert.equal(name, "aea-nem-wholesale-v1"); return namedCache; },
  };
  assert.equal(await runtimeMarketCache(storage), namedCache);
  assert.equal(await runtimeMarketCache(undefined), undefined);
});

test("shared cache avoids repeated upstream calls and serves labelled last-good data only for a bounded time", async () => {
  const cache = memoryCache();
  const cacheKey = new Request("https://example.com/api/wholesale-electricity/cache-v1");
  const original = await loadNemSnapshot({fetchImpl:sources,now,cache,cacheKey});
  let calls = 0;
  const failing = async () => { calls++; throw new Error("offline"); };
  assert.deepEqual(await loadNemSnapshot({fetchImpl:failing,now:now+30_000,cache,cacheKey}), original);
  assert.equal(calls,0);
  const stale = await loadNemSnapshot({fetchImpl:failing,now:now+120_000,cache,cacheKey});
  assert.equal(stale.refreshFailed,true);
  assert.equal(stale.fetchedAt,now);
  assert.equal(calls,2);
  await assert.rejects(loadNemSnapshot({fetchImpl:failing,now:now+3_600_001,cache,cacheKey}), /offline/);
});

test("an optional flow failure leaves valid prices available; price failure without cache is an error", async () => {
  const result = await loadNemSnapshot({now,fetchImpl:async (url,init)=>url === NEM_SUMMARY_URL ? new Response("",{status:503}) : sources(url,init)});
  assert.deepEqual(result.flows,[]);
  assert.equal(latestNemPoint(result.regions[0]).centsPerKwh,-1.5);
  await assert.rejects(loadNemSnapshot({now,fetchImpl:async()=>new Response("",{status:503})}), /HTTP 503/);
  await assert.rejects(loadNemSnapshot({now,fetchImpl:async()=>Response.json({bad:true})}), /Invalid AEMO/);
  await assert.rejects(loadNemSnapshot({now,fetchImpl:async()=>new Response("",{headers:{"Content-Length":"3000000"}})}), /size limit/);
});

test("page discovery, consumer explanations and accessible interaction are present without adding market code to the header", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const page = read("src/app/wholesale-electricity/page.tsx");
  const component = read("src/components/WholesaleElectricity.tsx");
  const nav = read("src/components/ResponsiveSiteNav.tsx");
  assert.match(page,/What is energy worth right now\?/);
  assert.match(page,/not the rates on your household bills/);
  assert.match(page,/Western Australia and the Northern Territory are outside the NEM/);
  assert.match(page,/Reverse-cycle heat pump/);
  assert.match(page,/0\.7 to 1\.3 kWh/);
  assert.doesNotMatch(page,/About the readings and units|<details/);
  assert.doesNotMatch(component,/AEMO|Retrieved|sourceNote/);
  assert.match(page,/Market data:.*href=\{NEM_SOURCE_URL\}.*>AEMO<\/a>/);
  assert.match(component,/type="range"/);
  assert.match(component,/aria-valuetext=/);
  assert.match(component,/fetch\("\/api\/wholesale-gas"/);
  assert.match(component,/strokeDasharray: "8 6"/);
  assert.match(component,/Gas comparison is not available for Tasmania/);
  assert.match(component,/onPointerMove=\{selectPoint\}/);
  assert.match(component,/Update delayed/);
  assert.match(component,/Gaps are left blank/);
  assert.match(component,/document\.hidden/);
  assert.match(component,/clearInterval\(interval\)/);
  assert.match(component,/setTimeout\(abortRequest, 15_000\)/);
  assert.match(component,/setNow\(Date\.now\(\)\);\s*if \(running/);
  assert.match(nav,/\["\/wholesale-electricity", "Live wholesale prices"\]/);
  assert.doesNotMatch(nav,/import.*WholesaleElectricity/);
  assert.match(read("src/app/sitemap.ts"),/"\/wholesale-electricity"/);
  assert.equal(searchPublicSite("aemo wholesale")[0].path,"/wholesale-electricity");
});

test("desktop shortcuts, restored copy and centred plan heading meet the requested layout", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const nav = read("src/components/ResponsiveSiteNav.tsx");
  for (const label of ["Electricity compare","Gas compare","Rebate calculator"]) assert.ok(nav.includes(`label: "${label}"`));
  const css = read("src/app/globals.css");
  assert.match(css,/\.site-nav-shortcut \{ display: none; \}/);
  assert.match(css,/@media \(min-width: 1181px\) \{\s*\.site-nav-shortcut \{[^}]*display: flex;/);
  assert.match(css,/\.start-hero aside strong \{[^}]*text-align: center;/);
  const home = read("src/components/GettingStarted.tsx");
  assert.match(home,/<strong>Building your home plan<\/strong>/);
  assert.match(home,/Already know what you need\?/);
  assert.doesNotMatch(home,/About three minutes/);
});
