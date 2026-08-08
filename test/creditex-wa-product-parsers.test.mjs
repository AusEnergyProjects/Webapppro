import assert from "node:assert/strict";
import test from "node:test";
import {
  CreditexWaProductSourceError,
  parseWaSupportedSolutionsSource,
} from "../src/lib/creditex-wa-product-parsers.ts";
import {
  WA_HORIZON_POWER_SUPPORTED_SOLUTIONS_CONNECTOR,
  WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE,
} from "../src/lib/creditex-wa-product-sources.ts";

const encoder = new TextEncoder();

function fixtureSource(overrides = {}) {
  return {
    ...WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE,
    minimumRecords: 1,
    maximumRecords: 10,
    ...overrides,
  };
}

function tableRow({
  brand = "ALPHA &amp; ESS",
  manufacturer = "ALPHA ESS CO LTD",
  series = "SMILE",
  model = "SMILE-T10-HV-INV (AS4777-2 2020)",
  generatorProvisional = "",
  generatorFull = "Inverter Inbuilt",
  storageProvisional = "",
  storageFull = "Inverter Inbuilt",
  activationReady = true,
} = {}) {
  const storageFullHtml = activationReady
    ? `<div class="inverter-with-tick"><span class="tick-label">${storageFull}</span><span class="tick-text-for-search">✓</span><span class="tick-icon"><svg><path /></svg></span></div>`
    : storageFull;
  return `<tr>
    <td>${brand}</td>
    <td>${manufacturer}</td>
    <td>${series}</td>
    <td>${model}</td>
    <td>${generatorProvisional}</td>
    <td>${generatorFull}</td>
    <td>${storageProvisional}</td>
    <td>${storageFullHtml}</td>
  </tr>`;
}

function htmlFixture(rows = [tableRow()], snapshot = "6th August 2026") {
  return encoder.encode(`<!doctype html><html><body>
    <p><strong>Last Updated Date:</strong>&nbsp;${snapshot}</p>
    <table id="inverterTable">
      <thead>
        <tr><th colspan="4">HARDWARE</th><th colspan="4">TECHNOLOGY PROVIDER CSIP-AUS CLIENT</th></tr>
        <tr><th rowspan="2">Brand</th><th rowspan="2">Inverter OEM</th><th rowspan="2">Series</th><th rowspan="2">Model</th><th colspan="2">DER - Generator</th><th colspan="2">DER - Storage</th></tr>
        <tr><th>Provisional</th><th>Full Listing</th><th>Provisional</th><th>Full Listing</th></tr>
      </thead>
      <tbody>${rows.join("\n")}</tbody>
    </table>
  </body></html>`);
}

function expectedSourceError(code) {
  return (error) => {
    assert.ok(error instanceof CreditexWaProductSourceError);
    assert.equal(error.code, code);
    return true;
  };
}

test("Synergy HTML parsing maps supported hardware and activation readiness", () => {
  const source = fixtureSource();
  const records = parseWaSupportedSolutionsSource(
    source,
    htmlFixture(),
    "text/html; charset=utf-8",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].brand, "ALPHA & ESS");
  assert.equal(records[0].manufacturer, "ALPHA ESS CO LTD");
  assert.equal(records[0].series, "SMILE");
  assert.equal(records[0].model, "SMILE-T10-HV-INV (AS4777-2 2020)");
  assert.equal(records[0].effectiveSnapshotDate, "2026-08-06");
  assert.equal(records[0].derGeneratorFullListing, "Inverter Inbuilt");
  assert.equal(records[0].derStorageFullListing, "Inverter Inbuilt");
  assert.equal(records[0].derStorageSupported, true);
  assert.equal(records[0].derStorageActivationReady, true);
  assert.match(
    records[0].sourceRecordKey,
    /^wa-synergy-supported-solutions:/,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(records[0].attributes)) < 1_024);
});

test("reviewed headings and table shape fail closed on drift", () => {
  const source = fixtureSource();
  assert.throws(
    () => parseWaSupportedSolutionsSource(
      source,
      encoder.encode(new TextDecoder().decode(htmlFixture()).replace(
        "<th rowspan=\"2\">Brand</th>",
        "<th rowspan=\"2\">Equipment brand</th>",
      )),
      "text/html",
    ),
    expectedSourceError("WA_PRODUCT_SOURCE_SCHEMA_CHANGED"),
  );
  assert.throws(
    () => parseWaSupportedSolutionsSource(
      source,
      encoder.encode(new TextDecoder().decode(htmlFixture()).replace(
        "<td>ALPHA ESS CO LTD</td>",
        "<td>ALPHA ESS CO LTD</td><td>unexpected</td>",
      )),
      "text/html",
    ),
    expectedSourceError("WA_PRODUCT_SOURCE_SCHEMA_CHANGED"),
  );
});

test("snapshot and row-count regressions fail closed", () => {
  const source = fixtureSource();
  assert.throws(
    () => parseWaSupportedSolutionsSource(
      source,
      htmlFixture([tableRow()], "5th August 2026"),
      "text/html",
    ),
    expectedSourceError("WA_PRODUCT_SOURCE_SNAPSHOT_REGRESSION"),
  );
  assert.throws(
    () => parseWaSupportedSolutionsSource(
      source,
      htmlFixture(),
      "text/html",
      { previousRecordCount: 2 },
    ),
    expectedSourceError("WA_PRODUCT_SOURCE_COUNT_REGRESSION"),
  );
});

test("duplicate hardware, wrong media and oversized HTML are rejected", () => {
  const source = fixtureSource();
  assert.throws(
    () => parseWaSupportedSolutionsSource(
      source,
      htmlFixture([tableRow(), tableRow()]),
      "text/html",
    ),
    expectedSourceError("WA_PRODUCT_SOURCE_DUPLICATE"),
  );
  assert.throws(
    () => parseWaSupportedSolutionsSource(source, htmlFixture(), "text/plain"),
    expectedSourceError("WA_PRODUCT_SOURCE_CONTENT_TYPE_CHANGED"),
  );
  assert.throws(
    () => parseWaSupportedSolutionsSource(
      fixtureSource({ maxBytes: 100 }),
      htmlFixture(),
      "text/html",
    ),
    expectedSourceError("WA_PRODUCT_SOURCE_TOO_LARGE"),
  );
});

test("Horizon Power stays a controlled manual connector", () => {
  assert.equal(
    WA_HORIZON_POWER_SUPPORTED_SOLUTIONS_CONNECTOR.productionMode,
    "controlled_manual",
  );
  assert.equal(
    WA_HORIZON_POWER_SUPPORTED_SOLUTIONS_CONNECTOR.automatedSyncAvailable,
    false,
  );
  assert.match(
    WA_HORIZON_POWER_SUPPORTED_SOLUTIONS_CONNECTOR.reason,
    /Cloudflare challenge/,
  );
});

test("live Synergy SSL satisfies the reviewed source contract", {
  skip: process.env.CREDITEX_LIVE_WA_PRODUCTS !== "1",
  timeout: 60_000,
}, async () => {
  const source = WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE;
  const response = await fetch(source.url, {
    headers: { accept: "text/html" },
  });
  assert.equal(response.ok, true, `Synergy SSL returned ${response.status}`);
  const records = parseWaSupportedSolutionsSource(
    source,
    new Uint8Array(await response.arrayBuffer()),
    response.headers.get("content-type") || "",
  );
  assert.equal(records.length, source.verifiedRecordCount);
  assert.ok(records.every(({ attributes }) => (
    Buffer.byteLength(JSON.stringify(attributes)) < 1_024
  )));
});
