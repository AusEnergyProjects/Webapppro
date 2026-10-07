import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { wattzunPortalForPath } from "../src/lib/wattzun-portal-path.ts";

const sharedCode = transformSync(readFileSync(new URL("../src/lib/wattzun-work-context.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
const sharedRecord = { exports: {} };
Function("require", "module", "exports", sharedCode)(id => {
  assert.equal(id, "./wattzun-portal-path.ts"); return { wattzunPortalForPath };
}, sharedRecord, sharedRecord.exports);
const workContext = sharedRecord.exports;

const source = readFileSync(new URL("../src/lib/wattzun-council-context-server.ts", import.meta.url), "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
class WattzunAccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fixture() {
  const council = { id: "council-a", name: "Fixture Council", slug: "fixture-council", state: "VIC", role: "viewer", postcodes: ["3806", "3805"] };
  const report = {
    generatedAt: "2026-10-07T00:00:00Z", mode: "live",
    scope: { councilId: council.id, name: council.name, state: council.state, postcodes: ["3805", "3806"] },
    period: { key: "year", label: "This year", start: "2026-01-01", end: "2026-10-07", timeZone: "Australia/Melbourne" },
    metrics: { completedJobs: null, completedValueCents: null, localJobs: null, outsideJobs: null, unknownLocalityJobs: null,
      localSharePercent: null, registeredLocalBusinesses: 4, attributedEnquiries: null, attributedCompletedJobs: null,
      veecQuantity: null, stcQuantity: null, estimatedTonnesCo2e: null },
    activities: [], postcodes: [], trend: [], campaigns: [],
    dataQuality: { minimumCohort: 5, suppressed: true, suppressedBreakdowns: ["postcodes", "campaigns"], missingInvoice: null,
      missingLocality: null, missingCarbonMethod: true, impactEvidence: "unavailable", impactCoverageJobs: null,
      coverageNote: "Small groups and missing provider evidence are withheld." },
    methodology: ["Figures cover recorded TLink work in the approved area.", "Provider acceptance is not registry issuance."],
  };
  const enquiries = { total: null, suppressed: true, postcodes: [{ postcode: "3805", count: null }, { postcode: "3806", count: null }], trend: [] };
  const requests = [];
  const db = { synthetic: true };
  const access = { db, actorUid: "staff-a", scope: { portal: "council", scopeId: council.id, label: council.name } };
  let accessCalls = 0;
  let onAccess;
  let afterReport;
  const dependencies = {
    "./council-access-server": { requireCouncilAccess: async (request, id) => {
      requests.push({ stage: "access", request, id });
      const index = ++accessCalls;
      return onAccess?.(index) ?? { ok: true, db, identity: { uid: "staff-a" }, council: structuredClone(council) };
    } },
    "./council-reporting-server": { loadCouncilReport: async (database, input, now) => {
      requests.push({ stage: "report", database, input: structuredClone(input), now });
      const value = structuredClone(report); afterReport?.(); return value;
    } },
    "./council-enquiries-server": { loadCouncilEnquiries: async (database, input, now) => {
      requests.push({ stage: "enquiries", database, input: structuredClone(input), now }); return structuredClone(enquiries);
    } },
    "./wattzun-portal-access-server": { WattzunAccessError },
    "./wattzun-work-context": workContext,
  };
  const record = { exports: {} };
  Function("require", "module", "exports", code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id}`); return dependencies[id];
  }, record, record.exports);
  const request = new Request("https://fixture.invalid/api/wattzun/portal?councilId=other&postcodes=3999&start=1900-01-01");
  return { council, report, enquiries, access, requests, db,
    afterReport: callback => { afterReport = callback; }, onAccess: callback => { onAccess = callback; },
    load: (reference = { kind: "council_report", period: "year" }) => record.exports.loadWattzunCouncilContext(request, access, reference) };
}

test("council context uses the selected verified full area and fixed period, not caller filters", async () => {
  const f = fixture();
  const context = await f.load();
  assert.equal(context.title, "Fixture Council: This year");
  assert.equal(f.requests.filter(item => item.stage === "access").length, 2);
  for (const stage of ["report", "enquiries"]) {
    const call = f.requests.find(item => item.stage === stage);
    assert.equal(call.database, f.db);
    assert.deepEqual(call.input, { councilId: "council-a", name: "Fixture Council", state: "VIC", postcodes: ["3805", "3806"], period: "year" });
  }
  assert.equal(f.requests.find(item => item.stage === "report").now, f.requests.find(item => item.stage === "enquiries").now);
  assert.deepEqual(context.facts.permissions, { role: "viewer", canManage: false });
  assert.equal(context.sources.length, 5);
  assert.equal(new Set(context.sources.map(item => item.id)).size, 5);
  assert.ok(context.sources.every(item => item.href === "/council?workspace=reports"));
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength <= 24_000);
  assert.match(context.sourceSha256, /^[a-f0-9]{64}$/);
});

test("protected nulls and cohort flags are retained without recovering hidden values", async () => {
  const f = fixture();
  const context = await f.load();
  assert.deepEqual(context.facts.metrics, f.report.metrics);
  assert.equal(context.facts.enquiries.total, null);
  assert.ok(context.facts.enquiries.postcodes.every(row => row.count === null));
  assert.equal(context.facts.quality.minimumCohort, 5);
  assert.equal(context.facts.quality.suppressed, true);
  assert.deepEqual(context.facts.quality.suppressedBreakdowns, ["postcodes", "campaigns"]);
  assert.deepEqual(context.facts.postcodes, []);
  assert.match(context.limitations.join(" "), /not zero/);
});

test("projection strips unknown customer, account, address and job fields from every aggregate section", async () => {
  const f = fixture();
  const secret = { customerName: "PRIVATE RESIDENT", customerUid: "private-customer-uid", streetAddress: "PRIVATE STREET", jobId: "private-job-id", abn: "private-abn" };
  Object.assign(f.report, secret); Object.assign(f.report.metrics, secret); Object.assign(f.report.dataQuality, secret);
  const row = { key: "3805", label: "Postcode 3805", completedJobs: 8, completedValueCents: 120000,
    localJobs: 0, veecQuantity: null, stcQuantity: null, estimatedTonnesCo2e: null, ...secret };
  f.report.postcodes = [{ ...row, registeredLocalBusinesses: 2 }];
  f.report.activities = [{ ...row, key: "heat-pump", label: "Heat pump" }];
  f.report.trend = [{ ...row, key: "2026-08", label: "August", start: "2026-08-01", end: "2026-08-31" }];
  f.report.campaigns = [{ id: "private-campaign-id", referenceCode: "private-referral-code", name: "Public session", channel: "Information session", enquiries: null, completedJobs: null, completedValueCents: null, ...secret }];
  Object.assign(f.enquiries, secret); Object.assign(f.enquiries.postcodes[0], secret);
  f.enquiries.trend = [{ month: "2026-08", count: null, ...secret }];
  const context = await f.load();
  const serialized = JSON.stringify(context);
  for (const value of [...Object.values(secret), "private-campaign-id", "private-referral-code"]) assert.ok(!serialized.includes(value), value);
  assert.equal(context.facts.postcodes[0].completedJobs, 8);
  assert.equal(context.facts.postcodes[0].localJobs, 0, "A genuine zero stays zero");
  assert.equal(context.facts.campaigns[0].enquiries, null);
});

test("source digest ignores generation time and discarded fields while retaining report dates", async () => {
  const f = fixture(); const first = await f.load();
  f.report.generatedAt = "2026-10-07T00:10:00Z"; f.report.customerName = "discarded";
  const second = await f.load();
  assert.equal(first.sourceSha256, second.sourceSha256);
  assert.notEqual(first.facts.generatedAt, second.facts.generatedAt);
  assert.deepEqual(first.facts.period, second.facts.period);
});

test("source digest covers permissions, area, period, protected values, quality and methodology", async t => {
  for (const [name, change, reference] of [
    ["permission", f => { f.council.role = "editor"; }],
    ["area", f => { f.council.postcodes = ["3805"]; f.report.scope.postcodes = ["3805"]; f.enquiries.postcodes = [{ postcode: "3805", count: null }]; }],
    ["period", f => { f.report.period.key = "quarter"; f.report.period.label = "This quarter"; f.report.period.start = "2026-10-01"; }, { kind: "council_report", period: "quarter" }],
    ["protected value", f => { f.report.metrics.completedJobs = 10; }],
    ["quality", f => { f.report.dataQuality.suppressedBreakdowns.push("finance"); }],
    ["methodology", f => { f.report.methodology.push("An amended definition."); }],
    ["enquiries", f => { f.enquiries.total = 10; f.enquiries.suppressed = false; }],
  ]) await t.test(name, async () => {
    const f = fixture(); const previous = await f.load(); change(f);
    const next = await f.load(reference); assert.notEqual(previous.sourceSha256, next.sourceSha256);
  });
});

test("wrong portal, council or actor cannot load report facts", async t => {
  for (const scenario of ["portal", "council", "actor", "revoked"]) await t.test(scenario, async () => {
    const f = fixture();
    if (scenario === "portal") f.access.scope.portal = "trade";
    else f.onAccess(() => scenario === "revoked" ? { ok: false, response: new Response(null, { status: 403 }) }
      : { ok: true, db: f.db, identity: { uid: scenario === "actor" ? "another-user" : "staff-a" }, council: { ...f.council, id: scenario === "council" ? "another-council" : f.council.id } });
    await assert.rejects(f.load(), error => error instanceof WattzunAccessError && error.status === 403);
    assert.equal(f.requests.filter(item => item.stage !== "access").length, 0);
  });
});

test("revocation, sign-in and council authority changes during loading fail before disclosure", async t => {
  for (const change of ["revocation", "actor", "role", "postcodes", "state", "name"]) await t.test(change, async () => {
    const f = fixture();
    if (change === "revocation" || change === "actor") f.onAccess(index => index === 1 ? undefined : change === "revocation"
      ? { ok: false, response: new Response(null, { status: 403 }) }
      : { ok: true, db: f.db, identity: { uid: "different-user" }, council: f.council });
    else f.afterReport(() => {
      if (change === "role") f.council.role = "owner";
      if (change === "postcodes") f.council.postcodes = ["3805"];
      if (change === "state") f.council.state = "NSW";
      if (change === "name") f.council.name = "Changed Council";
    });
    await assert.rejects(f.load(), error => ["revocation", "actor"].includes(change)
      ? error instanceof WattzunAccessError && error.status === 403
      : error instanceof workContext.WattzunWorkContextError && error.status === 409);
  });
});

test("a demonstration, different area or period cannot become the selected live report", async t => {
  for (const change of ["mode", "council", "state", "postcodes", "period"]) await t.test(change, async () => {
    const f = fixture();
    if (change === "mode") f.report.mode = "demonstration";
    if (change === "council") f.report.scope.councilId = "other-council";
    if (change === "state") f.report.scope.state = "NSW";
    if (change === "postcodes") f.report.scope.postcodes = ["3805"];
    if (change === "period") f.report.period.key = "all";
    await assert.rejects(f.load(), error => error instanceof workContext.WattzunWorkContextError && error.status === 503);
  });
});

test("oversize UTF-8 context fails explicitly without silent truncation", async () => {
  const f = fixture(); f.report.methodology = ["😀".repeat(6000)];
  await assert.rejects(f.load(), error => error instanceof workContext.WattzunWorkContextError && error.status === 413);
  assert.equal(f.report.methodology[0].length, 12000);
});
