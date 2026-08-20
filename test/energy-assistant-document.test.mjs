import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  ENERGY_DOCUMENT_LIMITS,
  analyseElectricityIntervalCsv,
  analyseEnergyCsv,
  analyseEnergyQuoteText,
  analyseLocalEnergyDocument,
} from "../src/lib/energy-assistant-document.ts";

const SOURCE_URL = new URL("../src/lib/energy-assistant-document.ts", import.meta.url);

function localFile(name, bytes, type) {
  const isolated = Uint8Array.from(bytes);
  return {
    name,
    type,
    size: isolated.byteLength,
    arrayBuffer: async () => isolated.buffer,
  };
}

async function textPdf(text, pageCount = 1) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = document.addPage([595, 842]);
    if (text) page.drawText(text, { x: 36, y: 790, size: 9, font, maxWidth: 520, lineHeight: 12 });
  }
  return document.save();
}

function serialised(value) {
  return JSON.stringify(value);
}

const GVG_HEADERS = [
  "ModelReleaseYear",
  "Make",
  "ModelReleaseVersion",
  "Model",
  "Variant",
  "EngineDisplacement",
  "EngineConfiguration",
  "EngineInduction",
  "FwdGearsNo",
  "TransmissionTypeDescription",
  "SideDoorNo",
  "SeatingCapacity",
  "BodyStyle",
  "DrivingWheelsNo",
  "FuelType",
  "CO2EmissionsCombined",
  "CO2EmissionsUrban",
  "CO2EmissionsExtraUrban",
  "FuelConsumptionCombined",
  "FuelConsumptionUrban",
  "FuelConsumptionExtraUrban",
  "EnergyConsumptionWhkm",
  "ElectricRangeKm",
  "AirPollutionStandard",
  "StationaryNoiseData",
  "TestSpeed",
  "IsCurrentModel",
  "ModelEndYear",
  "FuelLifeCycleCO2",
  "AnnualTailpipeCO2",
  "Test Cycle",
  "AnnualFuelCost",
];

function csvValue(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function gvgCsv(vehicles, headers = GVG_HEADERS) {
  const rows = vehicles.map((vehicle) => headers.map((header) => csvValue(vehicle[header] ?? "")).join(","));
  return [headers.map(csvValue).join(","), ...rows].join("\r\n");
}

function gvgVehicle(overrides = {}) {
  return {
    ModelReleaseYear: "2026",
    Make: "Hyundai",
    Model: "Elexio",
    Variant: "Base",
    FuelType: "Pure Electric",
    EnergyConsumptionWhkm: "177",
    ElectricRangeKm: "562",
    IsCurrentModel: "Yes",
    "Test Cycle": "WLTP (4-Phase)",
    AnnualFuelCost: "743",
    ...overrides,
  };
}

test("quote extraction is neutral, structured and redacts known identifier patterns", () => {
  const summary = analyseEnergyQuoteText(`
    Solar PV and battery installation for 42 Example Street
    NMI 63056789012 Account number ACC-998877
    Contact owner@example.com or 0412 345 678
    Supply and install 6.6 kW solar array, 5 kW inverter and 10 kWh usable battery.
    Total $14,900 including GST. STC rebate discount $2,450.
    Product warranty 10 years. Switchboard upgrade and roof repairs excluded.
  `);

  assert.deepEqual(summary.topics.slice(0, 2), ["solar-pv", "battery"]);
  assert.ok(summary.metrics.some((metric) => metric.value === "6.6" && metric.unit.toLowerCase() === "kw"));
  assert.ok(summary.amounts.some((amount) => amount.label === "total" && amount.amount === "$14,900"));
  assert.ok(summary.amounts.some((amount) => amount.label === "discount-or-rebate" && amount.amount === "$2,450"));
  assert.ok(summary.rebateOrCertificateClaims.length > 0);
  assert.ok(summary.warranties.length > 0);
  assert.ok(summary.exclusions.length > 0);
  assert.match(summary.missingEvidence.join(" "), /usable storage|network connection|certificate quantity/i);

  const output = serialised(summary);
  for (const secret of ["63056789012", "ACC-998877", "owner@example.com", "0412 345 678", "42 Example Street"]) {
    assert.doesNotMatch(output, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(output, /\b(?:best|recommend(?:ed|ation)?|rank(?:ed|ing)?|endors(?:e|ed|ement)|market-leading)\b/i);
});

test("quote extraction records missing evidence instead of inventing it", () => {
  const summary = analyseEnergyQuoteText("Supply and install reverse cycle air conditioning. Price on acceptance. Subject to site inspection and variations.");
  assert.ok(summary.topics.includes("heating-cooling"));
  assert.match(summary.missingEvidence.join(" "), /itemised total including GST/i);
  assert.match(summary.missingEvidence.join(" "), /room-by-room design load/i);
  assert.match(summary.missingEvidence.join(" "), /warranty terms/i);
  assert.equal(summary.metrics.length, 0);
  assert.equal(summary.amounts.length, 0);
});

test("text PDF analysis stays local and produces a bounded quote summary", async () => {
  const bytes = await textPdf("Quote for John James. Heat pump hot water supply and installation for John James. 270 L tank. Total $4,250 including GST. 7 year warranty. Existing unit disposal excluded.");
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden in this test");
  };
  try {
    const result = await analyseLocalEnergyDocument(localFile("quote.pdf", bytes, "application/pdf"));
    assert.equal(result.ok, true);
    assert.equal(result.kind, "quote-pdf");
    assert.equal(result.privacy.processing, "local-only");
    assert.equal(result.privacy.rawContentRetained, false);
    assert.equal(result.privacy.automaticRedaction, "bounded-patterns-only");
    assert.equal(result.privacy.freeTextMayContainPersonalInformation, true);
    assert.equal(result.privacy.automaticallyShared, false);
    assert.equal(result.privacy.leadSharing, "structured-summary-explicit-selection-required");
    assert.equal("identifiersRemoved" in result.privacy, false);
    assert.ok(result.summary.scope.some((line) => /John James/.test(line)));
    assert.ok(result.summary.topics.includes("hot-water-heat-pump"));
    assert.equal(result.summary.pageCount, 1);
    assert.equal(fetchCalls, 0);
    assert.doesNotMatch(serialised(result), /rawText|rawBytes|fileName/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("PDF failures distinguish image-only, encrypted, malformed, page-limit and file-limit cases", async () => {
  const blank = await textPdf("");
  const scanned = await analyseLocalEnergyDocument(localFile("scan.pdf", blank, "application/pdf"));
  assert.deepEqual(scanned.ok ? null : scanned.code, "PDF_IMAGE_ONLY");

  const encryptedBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >> endobj\n%%EOF");
  const encrypted = await analyseLocalEnergyDocument(localFile("locked.pdf", encryptedBytes, "application/pdf"));
  assert.deepEqual(encrypted.ok ? null : encrypted.code, "PDF_ENCRYPTED");

  const malformedBytes = new TextEncoder().encode("%PDF-1.7\nthis is not a valid PDF\n%%EOF");
  const malformed = await analyseLocalEnergyDocument(localFile("broken.pdf", malformedBytes, "application/pdf"));
  assert.deepEqual(malformed.ok ? null : malformed.code, "PDF_MALFORMED");

  const tooManyPages = await textPdf("This quote has sufficient selectable text for extraction and local review.", ENERGY_DOCUMENT_LIMITS.maxPdfPages + 1);
  const pageLimited = await analyseLocalEnergyDocument(localFile("long.pdf", tooManyPages, "application/pdf"));
  assert.deepEqual(pageLimited.ok ? null : pageLimited.code, "PDF_PAGE_LIMIT");

  const oversized = await analyseLocalEnergyDocument({
    name: "huge.pdf",
    type: "application/pdf",
    size: ENERGY_DOCUMENT_LIMITS.maxFileBytes + 1,
    arrayBuffer: async () => { throw new Error("must not read oversized files"); },
  });
  assert.deepEqual(oversized.ok ? null : oversized.code, "FILE_TOO_LARGE");
});

test("PDF extracted-text bounds stop pathological local documents", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  for (let index = 0; index < 3_100; index += 1) {
    page.drawText(`Solar quote ${"A".repeat(90)}`, { x: 36, y: 790, size: 5, font });
  }
  const bytes = await document.save({ useObjectStreams: false });
  const result = await analyseLocalEnergyDocument(localFile("text-bomb.pdf", bytes, "application/pdf"));
  assert.deepEqual(result.ok ? null : result.code, "PDF_TEXT_LIMIT");
});

test("current Green Vehicle Guide CSV headers are detected before interval parsing", async () => {
  const csv = gvgCsv([
    gvgVehicle(),
    gvgVehicle({
      ModelReleaseYear: "2025",
      Variant: "Elite",
      EnergyConsumptionWhkm: "182",
      ElectricRangeKm: "546",
      AnnualFuelCost: "$764",
    }),
  ]);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden in this test");
  };
  try {
    const direct = analyseEnergyCsv(csv);
    assert.equal(direct.ok, true);
    assert.equal(direct.kind, "vehicle-comparison-csv");
    assert.equal(direct.summary.documentKind, "green-vehicle-guide-comparison");
    assert.equal(direct.summary.vehicleCount, 2);
    assert.equal(direct.summary.sameTestCycle, true);
    assert.deepEqual(direct.summary.testCycles, ["WLTP (4-Phase)"]);
    assert.deepEqual(direct.summary.vehicles[0], {
      year: 2026,
      make: "Hyundai",
      model: "Elexio",
      variant: "Base",
      energyConsumptionWhPerKm: 177,
      electricRangeKm: 562,
      currentModelInFile: true,
      testCycle: "WLTP (4-Phase)",
      annualFuelCostAud: 743,
    });
    assert.equal(direct.summary.vehicles[1].annualFuelCostAud, 764);
    assert.match(direct.summary.comparisonBoundary, /supplied Green Vehicle Guide CSV/i);
    assert.match(direct.summary.comparisonBoundary, /not checked online/i);
    assert.match(direct.summary.annualFuelCostBoundary, /inputs.*not included/i);

    const local = await analyseLocalEnergyDocument(localFile("GVG-SearchResults.csv", new TextEncoder().encode(csv), "text/csv"));
    assert.equal(local.ok, true);
    assert.equal(local.kind, "vehicle-comparison-csv");
    assert.equal(local.privacy.processing, "local-only");
    assert.equal(local.privacy.rawContentRetained, false);
    assert.equal(fetchCalls, 0);
    assert.doesNotMatch(serialised(local), /rawText|rawBytes|fileName|ModelReleaseVersion/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("GVG comparison excludes invalid and conflicting rows instead of guessing", () => {
  const result = analyseEnergyCsv(gvgCsv([
    gvgVehicle(),
    gvgVehicle({ EnergyConsumptionWhkm: "199" }),
    gvgVehicle({ Model: "Atto 3", Make: "BYD", Variant: "Extended", EnergyConsumptionWhkm: "160", ElectricRangeKm: "480" }),
    gvgVehicle({ Model: "Seal", Make: "BYD", Variant: "Premium", IsCurrentModel: "Maybe", EnergyConsumptionWhkm: "165", ElectricRangeKm: "570" }),
    gvgVehicle({ Model: "MG4", Make: "MG", Variant: "Long Range", EnergyConsumptionWhkm: "N/A", ElectricRangeKm: "530" }),
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "vehicle-comparison-csv");
  assert.equal(result.summary.vehicleCount, 1);
  assert.equal(result.summary.vehicles[0].model, "Atto 3");
  assert.equal(result.summary.excludedRowCount, 4);
  assert.match(result.summary.ambiguities.join(" "), /conflicting rows.*Elexio/i);
  assert.match(result.summary.ambiguities.join(" "), /current-model flag/i);
  assert.match(result.summary.ambiguities.join(" "), /Wh\/km/i);
});

test("GVG comparison flags mixed test cycles and does not claim direct comparability", () => {
  const result = analyseEnergyCsv(gvgCsv([
    gvgVehicle({ Make: "BYD", Model: "Seal", Variant: "Premium", EnergyConsumptionWhkm: "165", ElectricRangeKm: "570" }),
    gvgVehicle({ Make: "MG", Model: "MG4", Variant: "Long Range", EnergyConsumptionWhkm: "170", ElectricRangeKm: "530", "Test Cycle": "NEDC" }),
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "vehicle-comparison-csv");
  assert.equal(result.summary.sameTestCycle, false);
  assert.deepEqual(result.summary.testCycles, ["WLTP (4-Phase)", "NEDC"]);
  assert.match(result.summary.ambiguities[0], /Mixed laboratory test cycles/i);
  assert.match(result.summary.ambiguities[0], /should not be ranked as directly comparable/i);
});

test("partial GVG exports and all-invalid GVG rows fail closed", () => {
  const partialHeaders = GVG_HEADERS.filter((header) => header !== "Test Cycle");
  const partial = analyseEnergyCsv(gvgCsv([gvgVehicle()], partialHeaders));
  assert.deepEqual(partial.ok ? null : partial.code, "CSV_UNSUPPORTED_SCHEMA");
  assert.match(partial.message, /Test Cycle|fresh CSV export/i);

  const invalid = analyseEnergyCsv(gvgCsv([
    gvgVehicle({ EnergyConsumptionWhkm: "", ElectricRangeKm: "", IsCurrentModel: "Unknown" }),
  ]));
  assert.deepEqual(invalid.ok ? null : invalid.code, "CSV_NO_VALID_ROWS");
});

test("duplicate identical GVG rows are deduplicated and private extra columns are not returned", () => {
  const headers = [...GVG_HEADERS, "NMI", "Account Reference"];
  const vehicle = gvgVehicle({ NMI: "SECRET-NMI-123", "Account Reference": "SECRET-ACCOUNT-456" });
  const result = analyseEnergyCsv(gvgCsv([vehicle, vehicle], headers));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "vehicle-comparison-csv");
  assert.equal(result.summary.vehicleCount, 1);
  assert.equal(result.summary.excludedRowCount, 1);
  assert.match(result.summary.ambiguities.join(" "), /duplicate row/i);
  assert.doesNotMatch(serialised(result), /SECRET-NMI-123|SECRET-ACCOUNT-456|NMI|Account Reference/);
});

test("Green Vehicle Guide PDFs direct the user to the CSV export instead of quote analysis", async () => {
  const bytes = await textPdf("Vehicle comparison results. Annual fuel cost. Energy consumption. Electric range. Test Cycle. Download as CSV for exact vehicle data.");
  const result = await analyseLocalEnergyDocument(localFile("GVG-results.pdf", bytes, "application/pdf"));
  assert.deepEqual(result.ok ? null : result.code, "GVG_PDF_REQUIRES_CSV");
  assert.match(result.message, /Download the same results as CSV from GVG/i);
  assert.match(result.message, /not uploaded or stored/i);
});

test("plain interval CSV proves only explicitly labelled energy columns", () => {
  const rows = ["timestamp,Grid Import (kWh),Grid Export (kWh),NMI,Account Number"];
  const start = Date.UTC(2026, 0, 1);
  for (let index = 0; index < 96; index += 1) {
    const stamp = new Date(start + index * 30 * 60_000);
    const date = stamp.toISOString().slice(0, 10);
    const time = stamp.toISOString().slice(11, 16);
    const hour = stamp.getUTCHours();
    const imported = hour >= 17 && hour < 21 ? 1 : hour >= 9 && hour < 15 ? 0.2 : 0.4;
    const exported = hour >= 10 && hour < 14 ? 0.3 : 0;
    rows.push(`${date} ${time},${imported},${exported},SECRET-NMI-123,SECRET-ACCOUNT-456`);
  }
  const result = analyseElectricityIntervalCsv(rows.join("\n"));
  assert.equal(result.ok, true);
  assert.equal(result.summary.format, "header-csv");
  assert.equal(result.summary.intervalMinutes, 30);
  assert.equal(result.summary.period.observedDays, 2);
  assert.equal(result.summary.semantics.import, "proven-kwh");
  assert.equal(result.summary.semantics.export, "proven-kwh");
  assert.ok(result.summary.totals.importKwh > 0);
  assert.ok(result.summary.totals.exportKwh > 0);
  assert.equal(result.summary.loadShape.busiestAverageInterval, "17:00");
  assert.match(result.summary.loadShape.tariffBoundary, /not retailer peak/i);
  assert.doesNotMatch(serialised(result), /SECRET-NMI-123|SECRET-ACCOUNT-456/);
});

test("plain CSV reports ambiguous units and channels without guessed totals", () => {
  const result = analyseElectricityIntervalCsv([
    "timestamp,Consumption,Export kW,NMI",
    "2026-02-01 00:00,1.2,0,SECRET12345",
    "2026-02-01 00:30,1.4,0,SECRET12345",
  ].join("\n"));
  assert.equal(result.ok, true);
  assert.equal(result.summary.semantics.import, "not-provided");
  assert.equal(result.summary.semantics.export, "not-provided");
  assert.deepEqual(result.summary.totals, {});
  assert.match(result.summary.ambiguities.join(" "), /do not declare Wh, kWh or MWh|No column declared/i);
  assert.match(result.summary.questions.join(" "), /Which single column is grid import energy/i);
});

test("duplicate interval timestamps suppress totals rather than double-counting", () => {
  const result = analyseElectricityIntervalCsv([
    "timestamp,Grid Import (kWh)",
    "2026-02-01 00:00,1.2",
    "2026-02-01 00:00,1.4",
    "2026-02-01 00:30,1.1",
  ].join("\n"));
  assert.equal(result.ok, true);
  assert.equal(result.summary.semantics.import, "ambiguous");
  assert.deepEqual(result.summary.totals, {});
  assert.match(result.summary.ambiguities.join(" "), /duplicate timestamp/i);
});

function nem12Fixture() {
  const rows = ["100,NEM12,202608200000,FROM,TO"];
  const nmi = "63056789012";
  rows.push(`200,${nmi},,GENERAL,E1,,METER-SECRET,KWH,30`);
  for (let day = 1; day <= 7; day += 1) {
    rows.push(["300", `202608${String(day).padStart(2, "0")}`, ...new Array(48).fill("1"), "A"].join(","));
  }
  rows.push(`200,${nmi},,EXPORT,B1,,METER-SECRET,KWH,30`);
  for (let day = 1; day <= 7; day += 1) {
    rows.push(["300", `202608${String(day).padStart(2, "0")}`, ...new Array(48).fill("0.25"), "A"].join(","));
  }
  rows.push("900");
  return rows.join("\n");
}

test("NEM12 analysis uses declared channel semantics and never returns NMI or meter identifiers", () => {
  const result = analyseElectricityIntervalCsv(nem12Fixture());
  assert.equal(result.ok, true);
  assert.equal(result.summary.format, "NEM12");
  assert.equal(result.summary.period.observedDays, 7);
  assert.equal(result.summary.intervalMinutes, 30);
  assert.equal(result.summary.semantics.import, "proven-kwh");
  assert.equal(result.summary.semantics.export, "proven-kwh");
  assert.equal(result.summary.totals.importKwh, 336);
  assert.equal(result.summary.totals.exportKwh, 84);
  assert.equal(result.summary.quality.actualPercent, 100);
  const output = serialised(result);
  assert.doesNotMatch(output, /63056789012|METER-SECRET|GENERAL|EXPORT,B1/);
  assert.doesNotMatch(output, /"nmi"|"account"|"registerId"/i);
});

test("CSV validation rejects malformed, unsupported and over-row-bound inputs", () => {
  const malformed = analyseElectricityIntervalCsv('timestamp,import_kwh\n"2026-01-01 00:00,1');
  assert.deepEqual(malformed.ok ? null : malformed.code, "CSV_MALFORMED");

  const unsupported = analyseElectricityIntervalCsv("date,value\n2026-01-01,1");
  assert.deepEqual(unsupported.ok ? null : unsupported.code, "CSV_UNSUPPORTED_SCHEMA");

  const tooManyColumns = `${new Array(ENERGY_DOCUMENT_LIMITS.maxCsvColumns + 1).fill("column").join(",")}\n${new Array(ENERGY_DOCUMENT_LIMITS.maxCsvColumns + 1).fill("1").join(",")}`;
  const columnBounded = analyseElectricityIntervalCsv(tooManyColumns);
  assert.deepEqual(columnBounded.ok ? null : columnBounded.code, "CSV_MALFORMED");

  const overBound = `timestamp,import_kwh\n${new Array(ENERGY_DOCUMENT_LIMITS.maxCsvRows + 1).fill("2026-01-01 00:00,1").join("\n")}`;
  const bounded = analyseElectricityIntervalCsv(overBound);
  assert.deepEqual(bounded.ok ? null : bounded.code, "CSV_ROW_LIMIT");
});

test("document analyser source has no network or persistence operations", async () => {
  const source = await readFile(SOURCE_URL, "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|caches\.open/i);
  assert.match(source, /useWorkerFetch:\s*false/);
  assert.match(source, /rawContentRetained:\s*false/);
  assert.match(source, /automaticRedaction:\s*"bounded-patterns-only"/);
  assert.match(source, /freeTextMayContainPersonalInformation:\s*true/);
  assert.match(source, /leadSharing:\s*"structured-summary-explicit-selection-required"/);
});
