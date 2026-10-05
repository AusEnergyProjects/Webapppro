import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as community from "../src/lib/council-community.ts";
import * as veu from "../src/lib/council-veu.ts";
import { councilReportPeriod } from "../src/lib/council-reporting.ts";

const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function load(path, dependencies) {
  const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "tsx", format: "cjs", target: "es2022", jsx: "automatic" }).code;
  const record = { exports: {} };
  Function("require", "module", "exports", code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, record, record.exports);
  return record.exports;
}
const primitives = load("../src/components/council/CouncilPrimitives.tsx", { "react/jsx-runtime": jsx, "./CouncilWorkspace.module.css": css });
const { CouncilPostcodeDetails } = load("../src/components/council/CouncilPostcodeDetails.tsx", {
  "react/jsx-runtime": jsx, "@/lib/council-community": community, "./CouncilPrimitives": primitives, "./CouncilPostcodeDetails.module.css": css,
});
const plain = html => html.replace(/<[^>]*>/g, " ").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
const scope = { councilId: "fixture", name: "Fixture council", state: "VIC", postcodes: ["3805", "3806"] };
function fixtures() {
  const fetchedAt = "2026-10-05T00:00:00Z";
  const rows = [
    { postcode: "3805", activity: "Heat pump hot water", activities: 24, reportedVeecEquivalents: 240.5 },
    { postcode: "3805", activity: "Heating and cooling", activities: 8, reportedVeecEquivalents: 120 },
    { postcode: "3806", activity: "Other postcode only", activities: 900, reportedVeecEquivalents: 10000 },
  ];
  const veuReport = veu.councilVeuReport({ version: 1, postcodes: scope.postcodes, period: veu.councilVeuPeriod("year", new Date(fetchedAt)), rows,
    totals: { activities: 932, reportedVeecEquivalents: 10360.5 }, fetchedAt, sourceRefreshedAt: "2026-10-04T18:00:00Z",
    provenance: { responseSha256: "a".repeat(64), querySha256: "b".repeat(64), modelSha256: "c".repeat(64), schemaSha256: "d".repeat(64) } },
  scope, { checkedAt: fetchedAt, refreshFailed: false, dataOrigin: "cache" }, Date.parse(fetchedAt));
  const values = Object.fromEntries(community.COMMUNITY_METRICS.map(metric => [metric.id, 0]));
  const communityReport = { scope, period: { key: "year", label: "Latest 12 published months", startMonth: "2025-09", endMonth: "2026-08" }, sourceAsOf: "2026-08-31",
    checkedAt: fetchedAt, stale: false, refreshFailed: false,
    postcodes: [{ postcode: "3805", values: { ...values, solarInstallations: 123, solarCapacityKw: 4500.5, solarHotWaterInstallations: null } },
      { postcode: "3806", values: { ...values, solarInstallations: 9999 } }] };
  const report = { mode: "live", scope, generatedAt: fetchedAt,
    period: { key: "year", label: "This year", start: "2026-01-01", end: "2026-10-05", timeZone: "Australia/Melbourne" },
    postcodes: [{ key: "3805", completedJobs: 7, completedValueCents: 1200000, localJobs: 5, registeredLocalBusinesses: 2, veecQuantity: 45, stcQuantity: null, estimatedTonnesCo2e: 45 }],
    map: { cells: [{ postcode: "3805", completedJobs: 7, registeredLocalBusinesses: 2 }, { postcode: "3806", completedJobs: 0, registeredLocalBusinesses: 0 }] },
    dataQuality: { suppressed: false, suppressedBreakdowns: [] }, enquiries: { suppressed: false, postcodes: [{ postcode: "3805", count: 6 }] } };
  return { report, sources: { veu: { report: veuReport, loading: false, error: "" }, community: { report: communityReport, loading: false, error: "" } } };
}
function render(fixture, postcode = "3805") { return renderToStaticMarkup(React.createElement(CouncilPostcodeDetails, { ...fixture, postcode })); }

test("selected postcode shows scoped official breakdowns, source dates and TLink evidence separately", () => {
  const html = render(fixtures()), text = plain(html);
  assert.match(html, /aria-label="Postcode 3805 data breakdown"/);
  assert.match(text, /Approved activities 32/);
  assert.match(text, /360\.5 tonnes CO₂-e/);
  assert.match(text, /Heat pump hot water 24 activities 240\.5 lifetime t CO₂-e/);
  assert.match(text, /Heating and cooling 8 activities 120 lifetime t CO₂-e/);
  assert.doesNotMatch(text, /Other postcode only|9,999/);
  assert.match(text, /Solar systems installed 123/);
  assert.match(text, /Solar capacity installed 4,500\.5 kW/);
  assert.match(text, /Batteries installed 0/);
  assert.match(text, /Solar water heaters installed Not available/);
  assert.match(text, /1 Jan 2026 to 5 Oct 2026/);
  assert.match(text, /Sep 2025 to Aug 2026/);
  assert.match(text, /Source refreshed 5 Oct 2026/);
  assert.match(text, /Data through 31 Aug 2026/);
  assert.match(text, /Recorded in TLink.*Completed jobs 7.*Work value, excluding GST \$12,000/);
  assert.match(text, /Community enquiries 6/);
  assert.match(text, /include all recorded sources in this postcode.*not all council-attributed/);
  assert.doesNotMatch(text, /Council-referred enquiries/);
  assert.match(text, /Accepted VEEC quantity 45.*Accepted STC quantity Not available/);
  assert.match(text, /Do not add these totals together/);
});

test("privacy-null and absent TLink rows remain distinct from known public zero values", () => {
  const fixture = fixtures();
  fixture.report.postcodes = [];
  fixture.report.map.cells[0].completedJobs = null;
  fixture.report.dataQuality.suppressedBreakdowns = ["postcodes"];
  fixture.report.enquiries.postcodes[0].count = null; fixture.report.enquiries.suppressed = true;
  const text = plain(render(fixture));
  assert.match(text, /Completed jobs Protected/);
  assert.match(text, /Registered local businesses 2/);
  assert.match(text, /Work value, excluding GST Protected/);
  assert.match(text, /Community enquiries Protected/);
  assert.match(text, /Approved activities 32/);
  assert.match(text, /Batteries installed 0/);
  const second = plain(render(fixture, "3806"));
  assert.match(second, /Completed jobs 0/);
  assert.match(second, /Registered local businesses 0/);
});

test("missing source, loading source and known empty activity breakdown do not pretend to contain data", () => {
  const fixture = fixtures();
  fixture.sources.veu = { report: null, loading: true, error: "" };
  fixture.sources.community = { report: null, loading: false, error: "Source is unavailable" };
  const html = render(fixture), text = plain(html);
  assert.match(html, /role="status"/);
  assert.match(text, /Loading VEU postcode data/);
  assert.match(text, /Published installation data is not available/);
  assert.doesNotMatch(text, /Approved activities 0/);
  assert.match(plain(render({ report: fixture.report })), /VEU data is not available/);
  const empty = fixtures();
  Object.assign(empty.sources.veu.report.postcodes[0], { activities: 0, estimatedLifetimeTonnesCo2e: 0, activityBreakdown: [] });
  assert.match(plain(render(empty)), /Approved activities 0.*No approved activities recorded in this period/);
  empty.sources.veu.report.postcodes[0].activityBreakdown = null;
  assert.match(plain(render(empty)), /An activity breakdown is not available/);
});

test("postcode detail rejects foreign scope and retains warnings on a dated source", () => {
  const fixture = fixtures();
  assert.equal(render(fixture, "3999"), "");
  fixture.sources.veu.report.source.stale = true;
  fixture.sources.community.report.refreshFailed = true;
  assert.match(plain(render(fixture)), /Showing the last verified snapshot.*Showing the last verified publication/);
  fixture.sources.veu.report.scope = { ...scope, councilId: "other-council" };
  fixture.sources.community.report.scope = { ...scope, councilId: "other-council" };
  const text = plain(render(fixture));
  assert.doesNotMatch(text, /Approved activities 32|Solar systems installed 123/);
  assert.match(text, /VEU data is not available/);
  fixture.report.mode = "demonstration";
  fixture.sources.veu.report.scope.councilId = "public-demo";
  assert.match(plain(render(fixture)), /Approved activities 32/);
});

test("TLink date labels retain local calendar boundaries and use the council timezone for instants", () => {
  const fixture = fixtures();
  fixture.report.period = councilReportPeriod("year", "VIC", new Date("2026-10-04T13:30:00Z"));
  assert.equal(fixture.report.period.start, "2026-01-01");
  assert.equal(fixture.report.period.end, "2026-10-05");
  assert.equal(fixture.report.period.startUtc, "2025-12-31T13:00:00.000Z");
  fixture.report.generatedAt = "2026-10-04T13:30:00Z";
  assert.match(plain(render(fixture)), /Recorded in TLink This year · 1 Jan 2026 to 5 Oct 2026 · Report generated 5 Oct 2026/);
  fixture.report.period = councilReportPeriod("year", "WA", new Date("2026-10-04T13:30:00Z"));
  assert.match(plain(render(fixture)), /Recorded in TLink This year · 1 Jan 2026 to 4 Oct 2026 · Report generated 4 Oct 2026/);
});
