import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { addressLocalitiesForPostcode } from "../src/lib/address-localities.mjs";
import { CER_COMMUNITY_URL, COMMUNITY_METRICS, communityReport, isCommunitySnapshot, parseCerPostcodeCsv } from "../src/lib/council-community.ts";
import { bundledCommunitySnapshot, cerPageContract, fetchCommunitySnapshot, loadCommunitySnapshot, runtimeCommunityCache } from "../src/lib/council-community-server.ts";

const now = Date.parse("2026-10-05T00:00:00Z");
const sourceAsOf = "2026-08-31";
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const metrics = new Map(COMMUNITY_METRICS.map(metric => [metric.id, metric]));
function csv(id, rows = [{ postcode: "3175", value: 1 }, { postcode: "3805", value: 2 }]) {
  const metric = metrics.get(id);
  const dates = [];
  for (let year = metric.historic ? 2011 : 2025, month = metric.historic ? 0 : 6; year < 2026 || month <= 7; month++) {
    if (month === 12) { year++; month = 0; }
    if (year > 2026 || (year === 2026 && month > 7)) break;
    dates.push(`${monthNames[month]} ${year} - ${metric.column}`);
  }
  const headers = ["Small Unit Installation Postcode", ...(metric.historic ? [metric.historic] : []), ...dates, `Total ${metric.column}`];
  const quote = value => String(value).includes(",") ? `"${value}"` : String(value);
  return [headers.join(","), ...rows.map(row => {
    const monthly = Array(dates.length).fill(row.value);
    if (row.blank) monthly[monthly.length - 1] = "";
    const total = row.total ?? row.value * dates.length + (metric.historic ? 10 : 0);
    return [row.postcode, ...(metric.historic ? [10] : []), ...monthly, total].map(quote).join(",");
  })].join("\r\n");
}
const page = `<p>This data is current as at 31 August 2026.</p>${COMMUNITY_METRICS.map(metric => `<a href="/document/${metric.path}">CSV</a>`).join("")}`;
const fetchFixture = async (url, init) => {
  assert.equal(init.redirect, "error");
  if (url === CER_COMMUNITY_URL) return new Response(page, { headers: { "Content-Type": "text/html" } });
  const metric = COMMUNITY_METRICS.find(metric => url === `https://cer.gov.au/document/${metric.path}`);
  assert.ok(metric, "Only official allowlisted URLs may be fetched");
  return new Response(csv(metric.id), { headers: { "Content-Type": "text/csv" } });
};
const fixture = () => fetchCommunitySnapshot({ fetchImpl: fetchFixture, now });
const scope = { councilId: "owned", name: "Owned Council", state: "VIC", postcodes: ["3175"] };
const freshness = { checkedAt: new Date(now).toISOString(), refreshFailed: false, dataOrigin: "cache" };
function memoryCache() {
  let stored;
  return { match: async () => stored?.clone(), put: async (_, response) => { stored = response.clone(); } };
}
function loadRoute(file, dependencies) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const compiledModule = { exports: {} };
  Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

test("CER parser validates and retains all-time totals plus the latest 24 months, without double counting historic totals", () => {
  const parsed = parseCerPostcodeCsv(csv("solarInstallations"), "solarInstallations", sourceAsOf);
  assert.equal(parsed.months.length, 24);
  assert.equal(parsed.months[0], "2024-09");
  assert.equal(parsed.months.at(-1), "2026-08");
  assert.equal(parsed.rows[0].total, 198);
  assert.deepEqual(parsed.rows[0].monthly, Array(24).fill(1));
});

test("quoted thousands, capacity units and source non-breaking spaces are parsed without changing meaning", () => {
  const text = csv("batteryCapacityKwh", [{ postcode: "3175", value: "1,000.125", total: "14,001.750" }]);
  const parsed = parseCerPostcodeCsv(text, "batteryCapacityKwh", sourceAsOf);
  assert.equal(parsed.rows[0].monthly[0], 1000.125);
  assert.equal(parsed.rows[0].total, 14001.75);
  assert.equal(parseCerPostcodeCsv(csv("heatPumpInstallations").replaceAll("Installation Quantity", "Installation\u00a0Quantity"), "heatPumpInstallations", sourceAsOf).rows.length, 2);
});

test("blank cells remain unknown and source totals are never reconstructed from missing observations", async () => {
  const snapshot = await fixture();
  const solar = snapshot.datasets.find(dataset => dataset.id === "solarInstallations");
  Object.assign(solar, parseCerPostcodeCsv(csv("solarInstallations", [{ postcode: "3175", value: 1, blank: true }]), "solarInstallations", sourceAsOf));
  assert.equal(solar.rows[0].monthly.at(-1), null);
  assert.equal(communityReport(snapshot, scope, "year", freshness, now).totals.solarInstallations, null);
  assert.equal(communityReport(snapshot, scope, "all", freshness, now).totals.solarInstallations, 198);
});

test("duplicate postcodes, missing months, schema drift, malformed numbers and material total errors reject a refresh", () => {
  const valid = csv("batteryInstallations");
  for (const invalid of [
    valid + "\r\n" + valid.split("\r\n")[1],
    valid.replace("Aug 2025", "Sep 2025"), valid.replace("Installation Quantity", "kWh"),
    valid.replace("3175,1", "3175,-1"), valid.replace("3175,1", "3175,NaN"),
    csv("batteryInstallations", [{ postcode: "3175", value: 1, total: 15 }]),
    csv("batteryInstallations", [{ postcode: "3175", value: 0.5 }]),
    csv("batteryCapacityKwh", [{ postcode: "3175", value: 1, total: 14.5 }]),
  ]) assert.throws(() => parseCerPostcodeCsv(invalid, invalid.includes("kWh") && !invalid.includes("Installation Quantity") ? "batteryCapacityKwh" : "batteryInstallations", sourceAsOf));
  assert.throws(() => parseCerPostcodeCsv(valid, "batteryInstallations", "2026-09-30"), /coverage/);
});

test("capacity reconciliation accepts only the bounded sum of independently rounded monthly values", () => {
  assert.doesNotThrow(() => parseCerPostcodeCsv(csv("solarCapacityKw", [{ postcode: "3175", value: 1, total: 198.026 }]), "solarCapacityKw", sourceAsOf));
  assert.throws(() => parseCerPostcodeCsv(csv("solarCapacityKw", [{ postcode: "3175", value: 1, total: 198.2 }]), "solarCapacityKw", sourceAsOf), /reconcile/);
});

test("scope projection excludes other postcodes and never spreads a national snapshot into the response", async () => {
  const snapshot = await fixture();
  const report = communityReport(snapshot, { ...scope, postcodes: ["3175", "3175"] }, "quarter", { ...freshness, snapshot, secret: "must not leak" }, now);
  assert.deepEqual(report.scope.postcodes, ["3175"]);
  assert.equal(report.totals.solarInstallations, 3);
  assert.equal(report.period.startMonth, "2026-06");
  assert.equal(report.period.endMonth, "2026-08");
  assert.equal(report.trend.length, 3);
  assert.equal(JSON.stringify(report).includes("3805"), false);
  assert.equal("snapshot" in report, false); assert.equal("secret" in report, false);
  assert.ok(report.sources.some(source => source.id === "veu" && source.status === "separate_report"));
  assert.equal("estimatedTonnesCo2e" in report.totals, false);
});

test("unknown postcodes and empty scopes remain unavailable, with explicit metric coverage", async () => {
  const snapshot = await fixture();
  const report = communityReport(snapshot, { ...scope, postcodes: ["3175", "3998"] }, "year", freshness, now);
  assert.equal(report.totals.solarInstallations, null);
  assert.deepEqual(report.coverage.solarInstallations, { availablePostcodes: 1, requestedPostcodes: 2 });
  assert.ok(report.trend.every(point => point.values.batteryInstallations === null));
  assert.equal(communityReport(snapshot, { ...scope, postcodes: [] }, "all", freshness, now).totals.solarInstallations, null);
});

test("freshness separates source age, checking failures and fetch time", async () => {
  const snapshot = await fixture();
  assert.equal(communityReport(snapshot, scope, "year", freshness, now).stale, false);
  assert.equal(communityReport(snapshot, scope, "year", { ...freshness, refreshFailed: true }, now).stale, true);
  assert.equal(communityReport(snapshot, scope, "year", freshness, now + 76 * 86400_000).stale, true);
});

test("catalogue discovery rejects changed links, impossible dates and future publications", () => {
  assert.deepEqual(cerPageContract(page, now).urls, COMMUNITY_METRICS.map(metric => `https://cer.gov.au/document/${metric.path}`));
  assert.throws(() => cerPageContract(page.replace("/document/sgu-solar-installations", "https://attacker.test/document/sgu-solar-installations"), now), /catalogue/);
  assert.throws(() => cerPageContract(page.replace("31 August", "31 September"), now), /date/);
  assert.throws(() => cerPageContract(page.replace("31 August", "30 December"), now), /date/);
  assert.throws(() => cerPageContract(page.replace("31 August", "30 August"), now), /incomplete/);
});

test("source capture retains SHA256 for every raw file and accepts Windows-1252 CSV spaces", async () => {
  const snapshot = await fetchCommunitySnapshot({ now, fetchImpl: async (url, init) => {
    if (!url.includes("swh-air-source")) return fetchFixture(url, init);
    const bytes = new TextEncoder().encode(csv("heatPumpInstallations"));
    for (let index = 0; index < bytes.length; index++) if (bytes[index] === 32) bytes[index] = 160;
    return new Response(bytes, { headers: { "Content-Type": "text/csv; charset=UTF-8" } });
  } });
  assert.ok(isCommunitySnapshot(snapshot));
  assert.ok(snapshot.datasets.every(dataset => /^[a-f0-9]{64}$/.test(dataset.sha256)));
  assert.equal(isCommunitySnapshot({ ...snapshot, datasets: [...snapshot.datasets.slice(0, 5), snapshot.datasets[0]] }), false);
  assert.equal(isCommunitySnapshot({ ...snapshot, sourceAsOf: "2026-02-31" }), false);
});

test("a failed or oversized source rejects the whole candidate, including bodies without length headers", async () => {
  await assert.rejects(fetchCommunitySnapshot({ now, fetchImpl: async (url, init) => url.includes("swh-solar") ? new Response("oops", { status: 500 }) : fetchFixture(url, init) }));
  await assert.rejects(fetchCommunitySnapshot({ now, fetchImpl: async () => new Response("x".repeat(1_000_001), { headers: { "Content-Type": "text/html" } }) }), /size/);
  await assert.rejects(fetchCommunitySnapshot({ now, fetchImpl: async () => new Response("", { headers: { "Content-Type": "text/html", "Content-Length": "1000001" } }) }), /size/);
  await assert.rejects(fetchCommunitySnapshot({ now, fetchImpl: async () => new Response("", { status: 302, headers: { Location: "https://attacker.test" } }) }), /unavailable/);
});

test("source deadline aborts a stalled upstream request", async () => {
  let aborted = false;
  await assert.rejects(fetchCommunitySnapshot({ now, timeoutMs: 5, fetchImpl: async (_, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); })) }), /aborted/);
  assert.equal(aborted, true);
});

test("named cache avoids disabled caches.default and fresh data makes no upstream calls", async () => {
  const cache = memoryCache();
  assert.equal(await runtimeCommunityCache({ get default() { throw new Error("Do not use default"); }, open: async name => { assert.equal(name, "aea-council-community-v1"); return cache; } }), cache);
  const baseline = await fixture();
  const loaded = await loadCommunitySnapshot({ baseline, now, cache, fetchImpl: async () => assert.fail("No refresh due") });
  assert.equal(loaded.dataOrigin, "baseline");
});

test("failed refresh retains last good snapshot and caches a bounded retry cooldown", async () => {
  const baseline = await fixture(); const cache = memoryCache(); let calls = 0;
  const failed = async () => { calls++; throw new Error("offline"); };
  const refreshAt = now + 13 * 60 * 60_000;
  const first = await loadCommunitySnapshot({ baseline, cache, now: refreshAt, fetchImpl: failed });
  assert.deepEqual(first.snapshot, baseline); assert.equal(first.refreshFailed, true); assert.equal(calls, 1);
  const again = await loadCommunitySnapshot({ baseline, cache, now: refreshAt + 30 * 60_000, fetchImpl: failed });
  assert.equal(again.refreshFailed, true); assert.equal(calls, 1); assert.equal(again.dataOrigin, "cache");
});

test("successful refresh accepts official downward corrections and caches the complete snapshot", async () => {
  const baseline = await fixture(); const cache = memoryCache();
  for (const dataset of baseline.datasets) for (const row of dataset.rows) { row.total *= 2; row.monthly = row.monthly.map(value => value * 2); }
  const freshAt = now + 13 * 60 * 60_000;
  const fresh = await loadCommunitySnapshot({ baseline, cache, now: freshAt, fetchImpl: fetchFixture });
  assert.equal(fresh.dataOrigin, "live"); assert.equal(fresh.refreshFailed, false);
  assert.equal(fresh.snapshot.datasets[0].rows[0].total, 198);
  const cached = await loadCommunitySnapshot({ baseline, cache, now: freshAt + 1000, fetchImpl: async () => assert.fail("Fresh cache") });
  assert.deepEqual(cached.snapshot, fresh.snapshot); assert.equal(cached.dataOrigin, "cache");
});

test("shipped baseline is real, structurally validated and contains only aggregate source fields", async () => {
  const snapshot = await bundledCommunitySnapshot();
  assert.ok(isCommunitySnapshot(snapshot)); assert.equal(snapshot.sourceAsOf, "2026-08-31");
  for (const dataset of snapshot.datasets) {
    assert.ok(dataset.rows.length > 2400);
    assert.deepEqual(Object.keys(dataset.rows[0]).sort(), ["monthly", "postcode", "total"]);
  }
  assert.equal(snapshot.datasets.find(dataset => dataset.id === "solarInstallations").rows.reduce((sum, row) => sum + row.total, 0), 4532178);
  assert.equal(snapshot.datasets.find(dataset => dataset.id === "batteryInstallations").rows.reduce((sum, row) => sum + row.total, 0), 510949);
});

test("the default lazy baseline keeps official CER reporting available when the upstream refresh fails", async () => {
  let downloads = 0;
  const loaded = await loadCommunitySnapshot({ now: Date.parse("2026-10-06T00:00:00Z"),
    fetchImpl: async () => { downloads++; throw new Error("Source unavailable"); } });
  assert.equal(downloads, 1);
  assert.equal(loaded.dataOrigin, "baseline");
  assert.equal(loaded.refreshFailed, true);
  assert.equal(loaded.snapshot.sourceAsOf, "2026-08-31");
  const report = communityReport(loaded.snapshot, { ...scope, postcodes: ["3805", "3806", "3977", "3980"] }, "year", loaded);
  assert.equal(report.totals.solarInstallations, 2656);
  assert.equal(report.totals.batteryInstallations, 4482);
  assert.equal(report.stale, true);
});

test("authenticated route rechecks authority and uses only the latest approved postcode scope", async () => {
  const snapshot = await fixture(); let calls = 0; let deny = false;
  const access = async () => {
    calls++;
    if (deny && calls % 2 === 0) return { ok: false, response: Response.json({ error: "revoked" }, { status: 403 }) };
    return { ok: true, council: { id: "owned", name: "Council", state: "VIC", postcodes: calls % 2 ? ["3175", "3805"] : ["3175"] } };
  };
  const route = loadRoute("../src/app/api/council/community/route.ts", {
    "@/lib/council-access-server": { requireCouncilAccess: access }, "@/lib/council-community": { communityReport },
    "@/lib/council-community-server": { runtimeCommunityCache: async () => undefined, loadCommunitySnapshot: async () => ({ snapshot, ...freshness }) },
  });
  const req = () => new Request("https://example.test/api/council/community?councilId=owned&period=year");
  const response = await route.GET(req()); const result = await response.json();
  assert.deepEqual(result.report.scope.postcodes, ["3175"]); assert.equal(result.report.totals.solarInstallations, 12);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("Vary"), "Authorization");
  deny = true; assert.equal((await route.GET(req())).status, 403);
});

test("authenticated route denies unauthorised and cross-origin requests before loading data; caller postcode overrides fail", async () => {
  const route = loadRoute("../src/app/api/council/community/route.ts", {
    "@/lib/council-access-server": { requireCouncilAccess: async () => ({ ok: false, response: new Response(null, { status: 403 }) }) },
    "@/lib/council-community": { communityReport },
    "@/lib/council-community-server": { loadCommunitySnapshot: async () => assert.fail("Denied before data load"), runtimeCommunityCache: async () => undefined },
  });
  assert.equal((await route.GET(new Request("https://example.test/api/council/community?councilId=other"))).status, 403);
  assert.equal((await route.GET(new Request("https://example.test/api/council/community", { headers: { Origin: "https://attacker.test" } }))).status, 403);
  for (const query of ["postcodes=3805", "period=bad", "period=year&period=all"]) assert.equal((await route.GET(new Request(`https://example.test/api/council/community?${query}`))).status, 400);
});

test("public demo route serves saved public aggregates only, with bounded valid VIC postcodes", async () => {
  const baseline = await bundledCommunitySnapshot();
  const route = loadRoute("../src/app/api/council/community/demo/route.ts", {
    "@/lib/address-localities.mjs": { addressLocalitiesForPostcode }, "@/lib/council-community": { communityReport },
    "@/lib/council-community-server": { bundledCommunitySnapshot: async () => baseline },
  });
  const get = query => route.GET(new Request(`https://example.test/api/council/community/demo?${query}`));
  const body = await (await get("postcodes=3805,3806&period=year")).json();
  assert.deepEqual(body.report.scope.postcodes, ["3805", "3806"]); assert.equal(body.report.dataOrigin, "baseline");
  assert.ok(body.report.totals.solarInstallations > 0); assert.equal(JSON.stringify(body).includes('"rows"'), false);
  for (const query of ["postcodes=2000", "postcodes=3001", "postcodes=3998", "postcodes=3175,", `postcodes=${Array(101).fill("3175").join(",")}`, "postcodes=3175&councilId=other", "postcodes=3175&period=day"]) assert.equal((await get(query)).status, 400, query);
});

test("public community demo accepts the full 100-postcode profile scope and rejects 101 before loading evidence", async () => {
  const postcodes = Array.from({ length: 1000 }, (_, index) => String(3000 + index))
    .filter(postcode => addressLocalitiesForPostcode(postcode)?.localities.some(locality => locality.state === "VIC")).slice(0, 101);
  assert.equal(postcodes.length, 101); assert.equal(new Set(postcodes).size, 101);
  const baseline = await bundledCommunitySnapshot(); let baselineLoads = 0;
  const route = loadRoute("../src/app/api/council/community/demo/route.ts", {
    "@/lib/address-localities.mjs": { addressLocalitiesForPostcode }, "@/lib/council-community": { communityReport },
    "@/lib/council-community-server": { bundledCommunitySnapshot: async () => { baselineLoads++; return baseline; } },
  });
  const get = area => route.GET(new Request(`https://example.test/api/council/community/demo?postcodes=${area.join(",")}&period=year`));
  const response = await get(postcodes.slice(0, 100));
  assert.equal(response.status, 200);
  const { report } = await response.json();
  assert.deepEqual(report.scope.postcodes, postcodes.slice(0, 100)); assert.equal(report.postcodes.length, 100);
  assert.equal(report.dataOrigin, "baseline"); assert.equal(baselineLoads, 1);
  assert.equal((await get(postcodes)).status, 400); assert.equal(baselineLoads, 1);
});
