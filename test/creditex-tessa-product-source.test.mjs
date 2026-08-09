import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_TESSA_PRODUCT_EXPORT_HEADER,
  parseCreditexTessaAcceptedProductCsv,
} from "../src/lib/creditex-tessa-product-parser.ts";
import {
  CREDITEX_TESSA_ACCEPTED_PRODUCTS_PAGE_URL,
  CREDITEX_TESSA_PRODUCT_LIST_INFORMATION_URL,
  CREDITEX_TESSA_PRODUCT_REGISTRY,
  CREDITEX_TESSA_WATER_HEATER_EXPORT_FIELDS,
  CREDITEX_TESSA_WATER_HEATER_EXPORT_QUERY,
  CREDITEX_TESSA_WATER_HEATER_EXPORT_URL,
} from "../src/lib/creditex-tessa-product-source.ts";

function product(index, overrides = {}) {
  const solar = index % 2 === 1;
  return {
    ...Object.fromEntries(
      CREDITEX_TESSA_PRODUCT_EXPORT_HEADER.map((header) => [header, ""]),
    ),
    "Accepted Product ID": `ACC${String(index + 1).padStart(7, "0")}`,
    "Product Type": solar
      ? "Water Heater - Solar (Electric Boosted)"
      : "Water Heater - Heat Pump",
    "Method(s)": "HEER",
    "Activity Definition": solar ? "D18, D20" : "D17, D19",
    "Effective From": "01-07-2026",
    Brand: index === 0 ? "Exact Brand & Co" : `Brand ${index}`,
    "Model Number": index === 0 ? "MODEL / 001" : `MODEL-${index}`,
    "AS/NZS4234 version": "2021",
    "Zone 3 System Size": "Small",
    "Zone 3 Peak Load (MJ/day)\u00a0": "42",
    "Zone 3 Annual Energy Savings %": "70.5",
    "Zone 3 Bs (GJ/year)\u00a0": "1.25",
    "Zone 3 Be (GJ/year)": "0",
    "Zone 5 System Size\u00a0": solar ? "" : "Medium",
    "Zone 5 Peak Load (MJ/day)\u00a0": solar ? "" : "60",
    "Zone 5 Annual Energy Savings %\u00a0": solar ? "" : "65",
    "Zone 5 Bs (GJ/year)\u00a0": solar ? "" : "2.5",
    "Zone 5 Be (GJ/year)": solar ? "" : "0.4",
    "No. of hot water tank(s) ": "1",
    "Tank Model Number\u00a0": `TANK-${index}`,
    "Tank Size (L)\u00a0": "300",
    "System Type": solar ? "Solar" : "Integrated",
    "Refrigerant type (GWP)": solar ? "" : "R290 (3)",
    Status: "Active",
    ...overrides,
  };
}

function csvField(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csvBytes(rows) {
  const csv = [
    CREDITEX_TESSA_PRODUCT_EXPORT_HEADER,
    ...rows.map((row) => (
      CREDITEX_TESSA_PRODUCT_EXPORT_HEADER.map((header) => row[header])
    )),
  ].map((row) => row.map(csvField).join(",")).join("\r\n");
  return new TextEncoder().encode(csv);
}

function fixtureRows() {
  const rows = Array.from({ length: 500 }, (_, index) => product(index));
  rows[497] = product(497, {
    Status: "Cancelled",
    "Effective From": "01-01-2024",
    "Effective To": "30-06-2026",
  });
  rows[498] = product(498, {
    Status: "Cancelled",
    "Effective From": "",
    "Effective To": "",
  });
  return rows;
}

test("TESSA CSV parser preserves exact accepted identity, status, dates and governed metrics", () => {
  const records = parseCreditexTessaAcceptedProductCsv(
    csvBytes(fixtureRows()),
    "text/csv; charset=utf-8",
  );
  assert.equal(records.length, 500);
  assert.equal(records[0].sourceRecordKey, "ACC0000001");
  assert.equal(records[0].brand, "Exact Brand & Co");
  assert.equal(records[0].model, "MODEL / 001");
  assert.equal(records[0].productKind, "nsw_heat_pump_water_heater");
  assert.equal(records[0].eligibleFrom, "2026-07-01");
  assert.equal(records[0].eligibleTo, "");
  assert.equal(records[0].attributes.tessaAcceptedActivities, "D17,D19");
  assert.equal(records[0].attributes.zone3BsGjPerYear, 1.25);
  assert.equal(records[0].attributes.zone3BeGjPerYear, 0);
  assert.equal(records[1].productKind, "nsw_solar_water_heater");

  const historical = records.find(({ sourceRecordKey }) => (
    sourceRecordKey === "ACC0000498"
  ));
  assert.equal(historical.approvalStatus, "approved");
  assert.equal(historical.eligibleFrom, "2024-01-01");
  assert.equal(historical.eligibleTo, "2026-06-30");
  assert.equal(historical.attributes.tessaOfficialStatus, "Cancelled");

  const undatedCancelled = records.find(({ sourceRecordKey }) => (
    sourceRecordKey === "ACC0000499"
  ));
  assert.equal(undatedCancelled.approvalStatus, "not_approved");
  assert.equal(undatedCancelled.eligibleFrom, "");
  assert.equal(undatedCancelled.eligibleTo, "");
  assert.equal(undatedCancelled.availableInAustralia, false);
  assert.equal(undatedCancelled.attributes.tessaOfficialStatus, "Cancelled");
});

test("TESSA CSV parser fails closed on schema, activity, date and identity drift", () => {
  const rows = fixtureRows();
  const invalidActivity = structuredClone(rows);
  invalidActivity[0]["Activity Definition"] = "D17, D21";
  assert.throws(
    () => parseCreditexTessaAcceptedProductCsv(
      csvBytes(invalidActivity),
      "text/csv",
    ),
    /unsupported activity set/,
  );

  const invalidDate = structuredClone(rows);
  invalidDate[0]["Effective From"] = "31-02-2026";
  assert.throws(
    () => parseCreditexTessaAcceptedProductCsv(csvBytes(invalidDate), "text/csv"),
    /calendar date/,
  );

  const duplicate = structuredClone(rows);
  duplicate[1]["Accepted Product ID"] = duplicate[0]["Accepted Product ID"];
  assert.throws(
    () => parseCreditexTessaAcceptedProductCsv(csvBytes(duplicate), "text/csv"),
    /duplicate Accepted Product ID/,
  );

  const changedHeader = csvBytes(rows);
  const changedHeaderText = new TextDecoder().decode(changedHeader)
    .replace("Accepted Product ID", "Accepted product id");
  assert.throws(
    () => parseCreditexTessaAcceptedProductCsv(
      new TextEncoder().encode(changedHeaderText),
      "text/csv",
    ),
    /header schema changed/,
  );

  assert.throws(
    () => parseCreditexTessaAcceptedProductCsv(csvBytes(rows), "text/html"),
    /content type changed/,
  );
});

test("TESSA definition uses only the official supported CSV export contract", () => {
  assert.equal(CREDITEX_TESSA_PRODUCT_REGISTRY.registryCode, "nsw-tessa-products");
  assert.equal(CREDITEX_TESSA_PRODUCT_REGISTRY.sources.length, 1);
  const [source] = CREDITEX_TESSA_PRODUCT_REGISTRY.sources;
  assert.equal(source.productionMode, "automatic");
  assert.deepEqual(source.productKinds, [
    "nsw_heat_pump_water_heater",
    "nsw_solar_water_heater",
  ]);
  assert.equal(source.url, CREDITEX_TESSA_WATER_HEATER_EXPORT_URL);
  assert.equal(new URL(source.url).origin, new URL(
    CREDITEX_TESSA_ACCEPTED_PRODUCTS_PAGE_URL,
  ).origin);
  assert.match(source.url, /sn_customerservice_accepted_products_list\.do\?CSV/);
  const exportUrl = new URL(source.url);
  assert.equal(
    exportUrl.searchParams.get("sysparm_query"),
    CREDITEX_TESSA_WATER_HEATER_EXPORT_QUERY,
  );
  assert.equal(
    exportUrl.searchParams.get("sysparm_fields"),
    CREDITEX_TESSA_WATER_HEATER_EXPORT_FIELDS.join(","),
  );
  assert.match(source.licence, /all rights reserved/);
  assert.ok(source.licence.includes(CREDITEX_TESSA_PRODUCT_LIST_INFORMATION_URL));
});

test("live TESSA export matches the reviewed CSV contract", {
  skip: process.env.CREDITEX_LIVE_TESSA_PRODUCTS !== "1",
}, async () => {
  const response = await fetch(CREDITEX_TESSA_WATER_HEATER_EXPORT_URL, {
    redirect: "manual",
    headers: { Accept: "text/csv" },
  });
  assert.equal(response.status, 200);
  const records = parseCreditexTessaAcceptedProductCsv(
    new Uint8Array(await response.arrayBuffer()),
    response.headers.get("content-type") || "",
  );
  assert.ok(records.length >= 500);
  assert.ok(records.some((record) => (
    record.attributes.tessaOfficialStatus === "Active"
  )));
  assert.ok(records.some((record) => (
    record.attributes.tessaOfficialStatus === "Cancelled"
  )));
});
