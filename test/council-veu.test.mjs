import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { addressLocalitiesForPostcode } from "../src/lib/address-localities.mjs";
import * as contract from "../src/lib/council-veu.ts";
import { councilVeuBaseline, fetchCouncilVeuSnapshot, loadCouncilVeuSnapshot, validateCouncilVeuControls } from "../src/lib/council-veu-server.ts";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/council-veu/official-activities.json", import.meta.url), "utf8"));
const area = ["3805", "3806", "3977", "3980"];
const scope = { councilId: "ours", name: "Our council", state: "VIC", postcodes: area };
const now = Date.parse("2026-10-05T02:00:00Z");
const evidence = (key = "all") => ({ model: fixture.model, schema: fixture.schema, sourceRefreshedAt: fixture.refreshed, responses: [fixture.responses[key]] });
const dataset = value => value.results[0].result.data.dsr.DS[0];
const changed = change => { const value = JSON.parse(fixture.responses.all); change(value); return JSON.stringify(value); };

function memoryCache() {
  const values = new Map();
  return { values, match: async request => values.get(request.url)?.clone(), put: async (request, response) => { values.set(request.url, response.clone()); } };
}

test("official VEU postcode/activity evidence decodes compressed repeats and reconciles exact published totals", () => {
  const all = contract.parseCouncilVeuResponse(fixture.responses.all, area);
  assert.equal(all.rows.length, 110); assert.deepEqual(all.totals, { activities: 159161, reportedVeecEquivalents: 1378258.6 });
  assert.ok(all.rows.some(row => row.reportedVeecEquivalents === 43.01));
  assert.deepEqual(contract.parseCouncilVeuResponse(fixture.responses.year, area).totals, { activities: 4789, reportedVeecEquivalents: 194563 });
  assert.deepEqual(contract.parseCouncilVeuResponse(fixture.responses.quarter, area), { rows: [], totals: { activities: 0, reportedVeecEquivalents: 0 } });
});

test("incomplete pages, schema drift, malformed masks, duplicate/outside scope groups and totals mismatch are rejected", () => {
  const mutations = [
    value => { dataset(value).IC = false; }, value => { dataset(value).HAD = false; }, value => { dataset(value).RT = []; },
    value => { value.results[0].result.data.descriptor.Select[2].Name = "other"; },
    value => { dataset(value).PH[1].DM1[0].S[2].T = 4; },
    value => { dataset(value).PH[1].DM1[0].R = 1; },
    value => { dataset(value).PH[1].DM1[1].R = 16; },
    value => { dataset(value).PH[1].DM1[1]["Ø"] = 1; },
    value => { dataset(value).PH[1].DM1[0].C[0] = 99999; },
    value => { dataset(value).PH[1].DM1[0].C[3] = 0.5; },
    value => { dataset(value).PH[1].DM1[0].C[2] = -1; },
    value => { dataset(value).PH[1].DM1[0].C[2] = "576 VEECs"; },
    value => { dataset(value).ValueDicts.D1[0] = "2000"; },
    value => { dataset(value).PH[0].DM0[0].C[1] += 1; },
    value => { dataset(value).PH[0].DM0[0].C[0] += 1; },
    value => { dataset(value).PH[1].DM1.push({ R: 15, C: [] }); },
    value => { dataset(value).PH[1].DM1[0].C.push(1); },
  ];
  for (const mutate of mutations) assert.throws(() => contract.parseCouncilVeuResponse(changed(mutate), area));
  assert.throws(() => contract.parseCouncilVeuResponse(fixture.responses.all, area.slice(1)), /postcode/);
});

test("Power BI numeric strings decode only inside typed decimal cells and still reconcile", () => {
  for (const encoded of ["576", "576.0", "5.76e2"]) {
    const response = changed(value => {
      dataset(value).PH[1].DM1[0].C[2] = encoded;
      dataset(value).PH[0].DM0[0].C[0] = "1378258.6";
    });
    assert.deepEqual(contract.parseCouncilVeuResponse(response, area).totals, { activities: 159161, reportedVeecEquivalents: 1378258.6 });
  }
  for (const encoded of ["", " ", " 576", "576 ", "0x240", "0576", "NaN", "Infinity", "1e309", "-1", "1000000000001", "577"]) {
    assert.throws(() => contract.parseCouncilVeuResponse(changed(value => { dataset(value).PH[1].DM1[0].C[2] = encoded; }), area), encoded);
  }
  assert.throws(() => contract.parseCouncilVeuResponse(changed(value => {
    dataset(value).PH[1].DM1[0].C[3] = String(dataset(value).PH[1].DM1[0].C[3]);
  }), area), /activity count/);
});

test("the official 72-postcode response preserves precision strings and reconciles the full history", () => {
  const large = JSON.parse(fs.readFileSync(new URL("./fixtures/council-veu/official-activities-72-postcodes.json", import.meta.url), "utf8"));
  const parsed = contract.parseCouncilVeuResponse(large.response, large.postcodes);
  assert.equal(large.postcodes.length, 72);
  assert.equal(parsed.rows.length, 1701);
  assert.deepEqual(parsed.totals, { activities: 606390, reportedVeecEquivalents: 6299643.38 });
  assert.equal(parsed.rows.find(row => row.postcode === "3190" && row.activity === "13 - Double glazed window").reportedVeecEquivalents, 29.509999999999998);
  assert.equal(parsed.rows.find(row => row.postcode === "3192" && row.activity === "13 - Double glazed window").reportedVeecEquivalents, 43.019999999999996);
});

test("unreported VEEC groups remain unavailable instead of being silently counted as zero", () => {
  const partial = contract.parseCouncilVeuResponse(changed(value => {
    dataset(value).PH[1].DM1[0].C[2] = null;
    dataset(value).PH[0].DM0[0].C[0] -= 576;
  }), area);
  assert.equal(partial.totals.activities, 159161); assert.equal(partial.totals.reportedVeecEquivalents, null);
});

test("calendar periods follow Melbourne and query only approved aggregate activity with exclusive end date", () => {
  assert.deepEqual(contract.councilVeuPeriod("quarter", new Date("2026-09-30T14:30:00Z")), { key: "quarter", label: "This calendar quarter", startDate: "2026-10-01", endDate: "2026-10-01", dateBasis: "activity_date" });
  const period = contract.councilVeuPeriod("year", new Date(now));
  const query = contract.councilVeuQuery(area, period);
  assert.equal(query.Query.Where[0].Condition.In.Values[0][0].Literal.Value, "'Approved'");
  assert.deepEqual(query.Query.Where.slice(2).map(item => [item.Condition.Comparison.ComparisonKind, item.Condition.Comparison.Right.Literal.Value]), [[2, "datetime'2026-01-01T00:00:00'"], [3, "datetime'2026-10-06T00:00:00'"]]);
  assert.equal(contract.councilVeuQuery(area, contract.councilVeuPeriod("all")).Query.Where.length, 2);
  assert.doesNotMatch(JSON.stringify(query), /ABN|Owner__c|Creator|Customer|Address__c|Name__c/);
  for (const postcodes of [[], ["3805'"], Array.from({ length: 101 }, () => "3805")]) assert.throws(() => contract.councilVeuQuery(postcodes, period));
});

test("official model identity, approved filter, displayed aggregation and source field types are enforced", () => {
  validateCouncilVeuControls(fixture.model, fixture.schema);
  const badModel = JSON.parse(fixture.model); badModel.models[0].id++;
  assert.throws(() => validateCouncilVeuControls(JSON.stringify(badModel), fixture.schema));
  for (const change of [
    page => { page.content.filterConfig.filters.at(-1).isLockedInViewMode = false; },
    page => { page.content.filterConfig.filters.at(-1).filter.Where[0].Condition.In.Values[0][0].Literal.Value = "'Pending'"; },
    page => { page.visualContainers[0].content.visual.query.queryState.Values.projections[2].queryRef = "Count(Fact_Activity.VEECs__c)"; },
  ]) {
    const model = JSON.parse(fixture.model), document = JSON.parse(model.exploration.explorationContent.explorationDocument);
    change(document.pages.pages[0]); model.exploration.explorationContent.explorationDocument = JSON.stringify(document);
    assert.throws(() => validateCouncilVeuControls(JSON.stringify(model), fixture.schema));
  }
  const schema = JSON.parse(fixture.schema); schema.schemas[0].schema.Entities[0].Properties.find(item => item.Name === "VEECs__c").DataType = 1;
  assert.throws(() => validateCouncilVeuControls(fixture.model, JSON.stringify(schema)));
});

test("captured baselines are valid and reports keep source totals, missing areas and installer uncertainty explicit", async () => {
  const baseline = await councilVeuBaseline(); assert.equal(baseline.length, 3); assert.ok(baseline.every(contract.isCouncilVeuSnapshot));
  const snapshot = baseline.find(item => item.period.key === "all");
  const report = contract.councilVeuReport(snapshot, scope, { checkedAt: snapshot.fetchedAt, refreshFailed: false, dataOrigin: "baseline" }, now);
  assert.equal(report.totals.activities, 159161); assert.equal(report.totals.estimatedLifetimeTonnesCo2e, 1378258.6);
  assert.equal(report.coverage.installerLocality, "unavailable");
  assert.equal(report.postcodes.reduce((sum, row) => sum + row.activities, 0), report.totals.activities);
  assert.equal(report.activities.reduce((sum, row) => sum + row.activities, 0), report.totals.activities);
  assert.match(report.notes.join(" "), /Never add/); assert.match(report.notes.join(" "), /not measured emissions or annual/);
  const partial = contract.councilVeuReport(snapshot, { ...scope, postcodes: ["3805", "3999"] }, { checkedAt: snapshot.fetchedAt, refreshFailed: false, dataOrigin: "baseline" }, now);
  assert.equal(partial.totals.activities, null); assert.equal(partial.postcodes.find(item => item.postcode === "3999").activities, null);
  assert.equal(partial.coverage.availablePostcodes, 1);
  const bad = structuredClone(snapshot); bad.rows[0].activities++;
  assert.equal(contract.isCouncilVeuSnapshot(bad), false);
  const badPeriod = structuredClone(baseline.find(item => item.period.key === "year")); badPeriod.period.startDate = "2026-02-01";
  assert.equal(contract.isCouncilVeuSnapshot(badPeriod), false);
});

test("source acquisition retains four integrity hashes and refuses future source refresh timestamps", async () => {
  let query;
  const snapshot = await fetchCouncilVeuSnapshot(area, "all", { now, loadEvidence: async (_fetch, commands) => { query = commands[0]; return evidence(); } });
  assert.deepEqual(snapshot.totals, { activities: 159161, reportedVeecEquivalents: 1378258.6 });
  assert.ok(Object.values(snapshot.provenance).every(hash => /^[a-f0-9]{64}$/.test(hash)));
  assert.equal(query.Query.Where.length, 2);
  await assert.rejects(fetchCouncilVeuSnapshot(area, "all", { now, loadEvidence: async () => ({ ...evidence(), sourceRefreshedAt: { local: "", utc: "2099-01-01T00:00:00Z" } }) }), /snapshot/);
});

test("postcode activity breakdowns use only their source groups and preserve unknown versus zero", async () => {
  const baseline = await councilVeuBaseline(), snapshot = baseline.find(item => item.period.key === "all");
  const freshness = { checkedAt: snapshot.fetchedAt, refreshFailed: false, dataOrigin: "baseline" };
  const report = contract.councilVeuReport(snapshot, scope, freshness, now);
  for (const postcode of report.postcodes) {
    const rows = snapshot.rows.filter(row => row.postcode === postcode.postcode);
    assert.equal(postcode.activityBreakdown.length, rows.length);
    assert.equal(postcode.activityBreakdown.reduce((sum, row) => sum + row.activities, 0), postcode.activities);
    assert.ok(Math.abs(postcode.activityBreakdown.reduce((sum, row) => sum + row.estimatedLifetimeTonnesCo2e, 0) - postcode.estimatedLifetimeTonnesCo2e) < 0.00001);
    for (const activity of postcode.activityBreakdown) {
      const source = rows.find(row => row.activity === activity.activity);
      assert.equal(activity.activities, source.activities);
      assert.ok(Math.abs(activity.estimatedLifetimeTonnesCo2e - source.reportedVeecEquivalents) < 0.00001);
    }
  }
  const incomplete = structuredClone(snapshot);
  incomplete.rows[0].reportedVeecEquivalents = null; incomplete.totals.reportedVeecEquivalents = null;
  const partial = contract.councilVeuReport(incomplete, { ...scope, postcodes: [...area, "3999"] }, freshness, now);
  assert.equal(partial.postcodes.find(row => row.postcode === "3999").activityBreakdown, null);
  const affected = partial.postcodes.find(row => row.postcode === incomplete.rows[0].postcode).activityBreakdown.find(row => row.activity === incomplete.rows[0].activity);
  assert.equal(affected.activities, incomplete.rows[0].activities);
  assert.equal(affected.estimatedLifetimeTonnesCo2e, null);
  const empty = contract.councilVeuReport(baseline.find(item => item.period.key === "quarter"), scope, freshness, now);
  assert.ok(empty.postcodes.every(row => row.activities === 0 && row.activityBreakdown.length === 0));
});

test("daily cache avoids repeat downloads, retains last good on failure and accepts reconciled downward corrections", async () => {
  const cache = memoryCache(); let calls = 0;
  const loadEvidence = async () => { calls++; return evidence(); };
  const first = await loadCouncilVeuSnapshot(area, "all", { now, cache, baseline: [], loadEvidence });
  assert.equal(first.dataOrigin, "live"); assert.equal(calls, 1);
  const again = await loadCouncilVeuSnapshot([...area].reverse(), "all", { now: now + 1000, cache, baseline: [], loadEvidence });
  assert.equal(again.dataOrigin, "cache"); assert.equal(calls, 1);
  const failed = await loadCouncilVeuSnapshot(area, "all", { now: now + 86400_001, cache, baseline: [], loadEvidence: async () => { calls++; throw new Error("offline"); } });
  assert.equal(failed.refreshFailed, true); assert.equal(failed.snapshot.provenance.responseSha256, first.snapshot.provenance.responseSha256);
  const report = contract.councilVeuReport(failed.snapshot, scope, failed, now + 86400_001); assert.equal(report.source.stale, true);
  const failedAgain = await loadCouncilVeuSnapshot(area, "all", { now: now + 86400_002, cache, baseline: [], loadEvidence });
  assert.equal(failedAgain.refreshFailed, true); assert.equal(calls, 2);
  const corrected = changed(value => { dataset(value).PH[1].DM1[0].C[2] -= 1; dataset(value).PH[0].DM0[0].C[0] -= 1; });
  const accepted = await loadCouncilVeuSnapshot(area, "all", { now: now + 90_001_000, cache, baseline: [], loadEvidence: async () => ({ ...evidence(), responses: [corrected] }) });
  assert.equal(accepted.refreshFailed, false); assert.equal(accepted.snapshot.totals.reportedVeecEquivalents, first.snapshot.totals.reportedVeecEquivalents - 1);
});

test("forged or different-scope cached snapshots never become council data; absent source data is an error", async () => {
  const cache = memoryCache();
  await loadCouncilVeuSnapshot(area, "all", { now, cache, baseline: [], loadEvidence: async () => evidence() });
  const [key, response] = [...cache.values][0], bad = await response.json(); bad.snapshot.rows[0].activities += 100;
  cache.values.set(key, Response.json(bad));
  await assert.rejects(loadCouncilVeuSnapshot(area, "all", { now: now + 1000, cache, baseline: [], loadEvidence: async () => { throw new Error("offline"); } }), /offline/);
  await assert.rejects(loadCouncilVeuSnapshot(["3805"], "all", { now, cache, baseline: [], loadEvidence: async () => evidence() }), /postcode/);
});

test("the default lazy VEU baseline retains dated matching-scope evidence after an upstream failure", async () => {
  let downloads = 0;
  const loaded = await loadCouncilVeuSnapshot(area, "year", { now: Date.parse("2026-10-06T00:00:00Z"),
    loadEvidence: async () => { downloads++; throw new Error("Source unavailable"); } });
  assert.equal(downloads, 1);
  assert.equal(loaded.dataOrigin, "baseline");
  assert.equal(loaded.refreshFailed, true);
  assert.deepEqual(loaded.snapshot.totals, { activities: 4789, reportedVeecEquivalents: 194563 });
  assert.equal(loaded.snapshot.sourceRefreshedAt, "2026-10-03T18:06:32.000Z");
});

function routeFixture() {
  let accessCalls = 0, downloads = 0, next;
  let council = { id: "ours", name: "Our council", state: "VIC", postcodes: area, role: "viewer" };
  const source = fs.readFileSync(new URL("../src/app/api/council/veu/route.ts", import.meta.url), "utf8");
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const dependencies = {
    "@/lib/council-access-server": { requireCouncilAccess: async (_request, id) => {
      accessCalls++; if (id !== "ours") return { ok: false, response: Response.json({ ok: false }, { status: 403 }) };
      if (next && accessCalls > 1) return next;
      return { ok: true, council, identity: { uid: "viewer" } };
    } },
    "@/lib/council-veu": contract,
    "@/lib/council-veu-server": { runtimeCouncilVeuCache: async () => undefined, loadCouncilVeuSnapshot: async postcodes => {
      downloads++; assert.deepEqual(postcodes, area);
      const snapshot = (await councilVeuBaseline()).find(item => item.period.key === "all");
      return { snapshot, checkedAt: snapshot.fetchedAt, refreshFailed: false, dataOrigin: "baseline" };
    } },
  };
  const loaded = { exports: {} };
  Function("require", "module", "exports", code)(key => { assert.ok(Object.hasOwn(dependencies, key)); return dependencies[key]; }, loaded, loaded.exports);
  return { route: loaded.exports, downloads: () => downloads, setCouncil: value => { council = value; }, setNext: value => { next = value; } };
}
const request = (query = "councilId=ours&period=all", origin) => new Request(`https://example.test/api/council/veu?${query}`, { headers: origin ? { Origin: origin } : {} });

test("VEU endpoint derives full scope from membership, rejects client filters and rechecks access after source load", async () => {
  const good = routeFixture(); const response = await good.route.GET(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await response.json()).report.scope.councilId, "ours"); assert.equal(good.downloads(), 1);
  for (const query of ["councilId=other", "councilId=ours&postcodes=3805", "councilId=ours&period=month", "councilId=ours&period=all&period=year"]) {
    const fixture = routeFixture(); assert.ok([400, 403].includes((await fixture.route.GET(request(query))).status)); assert.equal(fixture.downloads(), 0);
  }
  const origin = routeFixture(); assert.equal((await origin.route.GET(request(undefined, "https://hostile.test"))).status, 403); assert.equal(origin.downloads(), 0);
  const revoked = routeFixture(); revoked.setNext({ ok: false, response: Response.json({ ok: false }, { status: 403 }) }); assert.equal((await revoked.route.GET(request())).status, 403);
  const changedArea = routeFixture(); changedArea.setNext({ ok: true, council: { ...scope, id: "ours", postcodes: ["3805"], role: "viewer" } }); assert.equal((await changedArea.route.GET(request())).status, 409);
  const nonVic = routeFixture(); nonVic.setCouncil({ id: "ours", state: "NSW", postcodes: ["2000"] }); assert.equal((await nonVic.route.GET(request())).status, 400); assert.equal(nonVic.downloads(), 0);
});

async function demoRouteFixture(at = now) {
  const baseline = await councilVeuBaseline();
  let baselineLoads = 0;
  const source = fs.readFileSync(new URL("../src/app/api/council/veu/demo/route.ts", import.meta.url), "utf8");
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const dependencies = {
    "@/lib/address-localities.mjs": { addressLocalitiesForPostcode },
    "@/lib/council-veu": contract,
    "@/lib/council-veu-server": { councilVeuBaseline: async () => { baselineLoads++; return baseline; } },
  };
  const loaded = { exports: {} };
  class Clock extends Date { static now() { return at; } }
  Function("require", "module", "exports", "Date", code)(key => { assert.ok(Object.hasOwn(dependencies, key)); return dependencies[key]; }, loaded, loaded.exports, Clock);
  return { route: loaded.exports, baselineLoads: () => baselineLoads };
}

test("public VEU demo serves only retained official aggregates and never labels unknown areas zero", async () => {
  const fixture = await demoRouteFixture();
  const get = query => fixture.route.GET(new Request(`https://example.test/api/council/veu/demo?${query}`));
  const response = await get(`postcodes=${area.join(",")}&period=year`);
  const { report } = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(report.scope.postcodes, area); assert.equal(report.scope.councilId, "public-demo");
  assert.equal(report.source.dataOrigin, "baseline"); assert.equal(report.totals.activities, 4789);
  assert.equal(report.totals.estimatedLifetimeTonnesCo2e, 194563); assert.equal(report.coverage.installerLocality, "unavailable");
  assert.equal(JSON.stringify(report).includes('"rows"'), false);
  const partial = await (await get("postcodes=3805,3175&period=year")).json();
  assert.equal(partial.report.totals.activities, null); assert.equal(partial.report.coverage.availablePostcodes, 1);
  assert.equal(partial.report.postcodes.find(row => row.postcode === "3175").activities, null);
  const old = await demoRouteFixture(now + 4 * 86400_000);
  const oldReport = await (await old.route.GET(new Request("https://example.test/api/council/veu/demo?postcodes=3805&period=year"))).json();
  assert.equal(oldReport.report.source.stale, true);
});

test("public VEU demo rejects unbounded or non-Victorian scope and does not relabel a past quarter or year", async () => {
  const fixture = await demoRouteFixture();
  const get = query => fixture.route.GET(new Request(`https://example.test/api/council/veu/demo?${query}`));
  for (const query of ["", "postcodes=2000", "postcodes=3001", "postcodes=3998", "postcodes=3805,", `postcodes=${Array(101).fill("3805").join(",")}`,
    "postcodes=3805&councilId=other", "postcodes=3805&period=day", "postcodes=3805&period=all&period=year", "postcodes=3805&postcodes=3806"]) {
    assert.equal((await get(query)).status, 400, query);
  }
  const foreign = new Request("https://example.test/api/council/veu/demo?postcodes=3805", { headers: { Origin: "https://hostile.test" } });
  assert.equal((await fixture.route.GET(foreign)).status, 403); assert.equal(fixture.baselineLoads(), 0);
  const future = await demoRouteFixture(Date.parse("2027-01-02T02:00:00Z"));
  for (const period of ["quarter", "year"]) assert.equal((await future.route.GET(new Request(`https://example.test/api/council/veu/demo?postcodes=3805&period=${period}`))).status, 503);
  assert.equal((await future.route.GET(new Request("https://example.test/api/council/veu/demo?postcodes=3805&period=all"))).status, 200);
});

test("public VEU demo accepts the full 100-postcode profile scope and rejects 101 before loading evidence", async () => {
  const postcodes = Array.from({ length: 1000 }, (_, index) => String(3000 + index))
    .filter(postcode => addressLocalitiesForPostcode(postcode)?.localities.some(locality => locality.state === "VIC")).slice(0, 101);
  assert.equal(postcodes.length, 101); assert.equal(new Set(postcodes).size, 101);
  const fixture = await demoRouteFixture();
  const get = area => fixture.route.GET(new Request(`https://example.test/api/council/veu/demo?postcodes=${area.join(",")}&period=year`));
  const response = await get(postcodes.slice(0, 100));
  assert.equal(response.status, 200);
  const { report } = await response.json();
  assert.deepEqual(report.scope.postcodes, postcodes.slice(0, 100)); assert.equal(report.postcodes.length, 100);
  assert.equal(report.source.dataOrigin, "baseline"); assert.equal(report.totals.activities, null);
  assert.equal(fixture.baselineLoads(), 1);
  assert.equal((await get(postcodes)).status, 400); assert.equal(fixture.baselineLoads(), 1);
});
