import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as community from "../src/lib/council-community.ts";

const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function load(relative, dependencies, environment = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const code = transformSync(source, { loader: "tsx", format: "cjs", target: "es2022", jsx: "automatic" }).code;
  const record = { exports: {} };
  Function("require", "module", "exports", ...Object.keys(environment), code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, record, record.exports, ...Object.values(environment));
  return record.exports;
}
const primitives = load("../src/components/council/CouncilPrimitives.tsx", { "react/jsx-runtime": jsx, "./CouncilWorkspace.module.css": css });
function component(environment) {
  return load("../src/components/council/CouncilCommunity.tsx", { react: React, "react/jsx-runtime": jsx,
    "@/lib/council-community": community, "./CouncilPrimitives": primitives,
    "./CouncilCommunity.module.css": css, "./CouncilWorkspace.module.css": css }, environment);
}
const postcodes = Array.from({ length: 73 }, (_, index) => String(3000 + index));
function reportFixture() {
  const snapshot = { version: 1, sourceAsOf: "2026-08-31", fetchedAt: "2026-10-05T00:00:00Z",
    sourcePage: { url: community.CER_COMMUNITY_URL, sha256: "a".repeat(64) },
    datasets: community.COMMUNITY_METRICS.map(metric => ({ id: metric.id, url: `https://cer.gov.au/document/${metric.path}`, sha256: "b".repeat(64),
      months: ["2026-07", "2026-08"], rows: postcodes.map((postcode, index) => {
        const unavailable = metric.id === "solarHotWaterInstallations" || (index === 72 && ["solarInstallations", "solarCapacityKw", "heatPumpInstallations"].includes(metric.id));
        const value = metric.id === "solarInstallations" ? 12 : metric.id === "solarCapacityKw" ? 1000 : metric.id === "heatPumpInstallations" ? 2 : 0;
        const july = metric.id === "solarInstallations" ? 1 : unavailable ? null : value / 2;
        const august = unavailable ? null : metric.id === "solarInstallations" ? 2 : value / 2;
        return { postcode, total: unavailable ? null : value, monthly: [july, august] };
      }) })) };
  return community.communityReport(snapshot, { councilId: "fixture", name: "Snapshot Council", state: "VIC", postcodes }, "all",
    { checkedAt: "2026-10-05T00:00:00Z", refreshFailed: false, dataOrigin: "baseline" }, Date.parse("2026-10-05T00:00:00Z"));
}
const plain = html => html.replace(/<[^>]*>/g, " ").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
const card = (html, label) => [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map(match => match[0]).find(value => value.includes(label));
function render(report, compact = false) {
  const { CouncilCommunity } = component();
  return renderToStaticMarkup(React.createElement(CouncilCommunity, { state: { report, loading: false, error: "" }, period: "all", compact,
    onPeriodChange() {}, onRefresh() {} }));
}

test("compact community cards retain known subtotals with visible 72 of 73 postcode coverage", () => {
  const report = reportFixture();
  assert.equal(report.reportedTotals.solarInstallations, 864);
  assert.equal(report.totals.solarInstallations, null);
  const html = render(report, true);
  const solar = plain(card(html, "Solar systems installed"));
  assert.match(solar, /864/);
  assert.match(solar, /Recorded subtotal\s*·\s*72 of 73 postcodes/);
  assert.match(plain(html), /Postcode coverage/);
  assert.match(plain(html), /3072/);
  assert.doesNotMatch(html, /Installation momentum/);
});

test("real zeros are shown as zero with complete coverage while unavailable figures remain unknown", () => {
  const report = reportFixture(), html = render(report, true);
  const batteries = plain(card(html, "Batteries installed"));
  assert.match(batteries, /Batteries installed 0 /);
  assert.match(batteries, /All 73 postcodes/);
  const missing = plain(card(html, "Solar water heaters"));
  assert.match(missing, /Not available/);
  assert.match(missing, /No published figures for 73 postcodes/);
  assert.doesNotMatch(missing, /Solar water heaters 0 /);
  report.reportedTotals.solarCapacityKw = null;
  report.coverage.solarCapacityKw.availablePostcodes = 0;
  report.postcodes.forEach(row => { row.values.solarCapacityKw = null; });
  const unavailableHtml = render(report, true), unavailableCapacity = plain(unavailableHtml);
  assert.doesNotMatch(unavailableCapacity, /Not available MW(?:h)?/);
  assert.doesNotMatch(plain(card(unavailableHtml, "Solar systems installed")), /MW of solar capacity/);
});

test("expanded community reporting identifies missing postcodes separately for each metric", () => {
  const html = render(reportFixture()), visible = plain(html);
  const coverage = html.match(/<details\b[^>]*>[\s\S]*?<summary[^>]*>Postcode coverage[\s\S]*?<\/details>/)?.[0];
  assert.ok(coverage, "Coverage can be expanded without leaving the report");
  assert.match(plain(coverage), /Solar systems installed/);
  assert.match(plain(coverage), /3072/);
  assert.match(visible, /Installer details are not available/);
  assert.match(visible, /not.*council-attributed/);
});

test("installation momentum displays reported monthly subtotals with each month's coverage", () => {
  const report = reportFixture();
  const july = report.trend.find(point => point.month === "2026-07");
  const august = report.trend.find(point => point.month === "2026-08");
  assert.equal(july.reportedValues.solarInstallations, 73);
  assert.equal(august.reportedValues.solarInstallations, 144);
  assert.equal(august.values.solarInstallations, null);
  const html = render(report);
  const trend = html.match(/<div class="trend">([\s\S]*?)<\/div><p/)?.[1];
  assert.ok(trend, "Published monthly series is rendered");
  const visible = plain(trend);
  assert.match(visible, /73[\s\S]*Jul 2026[\s\S]*73\s*\/\s*73/);
  assert.match(visible, /144[\s\S]*Aug 2026[\s\S]*72\s*\/\s*73/);
});

function parseCsv(text) {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).map(line => {
    const result = []; let value = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (line[i] === "," && !quoted) { result.push(value); value = ""; }
      else value += line[i];
    }
    result.push(value); return result;
  });
}

test("official CSV distinguishes reported subtotals, full-area totals and missing postcode coverage", async () => {
  const blobs = [], anchors = [], timers = [], revoked = [];
  const api = component({ URL: { createObjectURL: blob => { blobs.push(blob); return "blob:community-report"; }, revokeObjectURL: url => revoked.push(url) },
    document: { createElement: type => { assert.equal(type, "a"); const anchor = { clicks: 0, click() { this.clicks++; } }; anchors.push(anchor); return anchor; } },
    setTimeout: callback => timers.push(callback) });
  api.downloadCommunityReport(reportFixture());
  assert.equal(anchors[0].clicks, 1);
  assert.equal(anchors[0].download, "council-community-installations-2026-08-31.csv");
  assert.equal(blobs[0].type, "text/csv;charset=utf-8");
  const csv = await blobs[0].text(), rows = parseCsv(csv);
  const subtotal = rows.find(row => row[0] === "Reported subtotal"), fullArea = rows.find(row => row[0] === "Full-area total");
  assert.ok(subtotal); assert.ok(fullArea);
  assert.equal(subtotal[1], "864"); assert.equal(fullArea[1], "Not available");
  assert.equal(subtotal[5], "0"); assert.equal(fullArea[5], "0");
  assert.equal(subtotal[4], "Not available");
  const available = rows.find(row => row[0] === "Postcodes with published figures");
  const requested = rows.find(row => row[0] === "Requested postcodes");
  const missing = rows.find(row => row[0] === "Missing or incomplete postcodes");
  assert.equal(available[1], "72"); assert.equal(requested[1], "73"); assert.equal(missing[1], "3072");
  assert.equal(available[4], "0"); assert.equal(missing[4], postcodes.join(" "));
  assert.equal(available[5], "73"); assert.equal(missing[5], "");
  assert.deepEqual(rows.find(row => row[0] === "3072").slice(1), ["Not available", "Not available", "Not available", "Not available", "0", "0"]);
  const monthHeader = rows.find(row => row[0] === "Month (reported subtotal)");
  assert.equal(monthHeader[2], "Solar systems installed postcode coverage");
  assert.deepEqual(rows.find(row => row[0] === "2026-07").slice(1, 3), ["73", "73/73"]);
  assert.deepEqual(rows.find(row => row[0] === "2026-08").slice(1, 3), ["144", "72/73"]);
  assert.deepEqual(rows.find(row => row[0] === "2025-09").slice(1, 3), ["Not available", "0/73"]);
  timers.forEach(callback => callback());
  assert.deepEqual(revoked, ["blob:community-report"]);
});
