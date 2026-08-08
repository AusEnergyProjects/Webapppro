import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  CreditexOfficialProductSourceError,
  parseOfficialProductSource,
} from "../src/lib/creditex-official-product-parsers.ts";
import {
  CER_CEC_PRODUCT_SOURCES,
  GEMS_PRODUCT_SOURCES,
  LICENCE_REQUIRED_PRODUCT_CONNECTORS,
  OFFICIAL_PRODUCT_SOURCES,
} from "../src/lib/creditex-official-product-sources.ts";

const encoder = new TextEncoder();

function fixtureSource(source) {
  return {
    ...source,
    minimumRecords: 1,
    maximumRecords: 10,
  };
}

function ckanFixtureSource(source) {
  return fixtureSource({
    ...source,
    url:
      `https://data.gov.au/data/api/3/action/datastore_search?resource_id=${source.resourceId}&limit=10000`,
    format: "ckan_datastore_json",
    expectedContentTypes: ["application/json"],
  });
}

function csvCell(value) {
  return /[",\r\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

function csvFixture(source, values) {
  return csvRowsFixture(source, [values]);
}

function csvRowsFixture(source, rows) {
  return encoder.encode(
    `${source.expectedFields.join(",")}\r\n${rows.map((values) => (
      values.map(csvCell).join(",")
    )).join("\r\n")}\r\n`,
  );
}

function expectedSourceError(code) {
  return (error) => {
    assert.ok(error instanceof CreditexOfficialProductSourceError);
    assert.equal(error.code, code);
    return true;
  };
}

function ckanRecord(source, overrides = {}) {
  return Object.fromEntries(source.expectedFields.map((fieldName) => [
    fieldName,
    overrides[fieldName] ?? null,
  ]));
}

function ckanFixture(source, records, fieldNames = source.expectedFields) {
  return encoder.encode(JSON.stringify({
    success: true,
    result: {
      resource_id: source.resourceId,
      total: records.length,
      fields: fieldNames.map((id) => ({ id, type: "text" })),
      records,
    },
  }));
}

test("official sources preserve registry and licence boundaries", () => {
  assert.equal(CER_CEC_PRODUCT_SOURCES.length, 3);
  assert.equal(GEMS_PRODUCT_SOURCES.length, 11);
  assert.equal(OFFICIAL_PRODUCT_SOURCES.length, 14);
  assert.deepEqual(
    new Set(CER_CEC_PRODUCT_SOURCES.map(({ registryCode }) => registryCode)),
    new Set(["cer-cec-products"]),
  );
  assert.ok(CER_CEC_PRODUCT_SOURCES.every((source) => (
    source.productionMode === "controlled_manual"
    && source.licence.status === "permission_required"
    && source.licence.identifier === "PERMISSION-REQUIRED"
    && source.licence.identifier !== "CC-BY-4.0"
  )));
  assert.ok(GEMS_PRODUCT_SOURCES.every((source) => (
    source.productionMode === "public_official"
    && source.licence.status === "confirmed_open"
    && source.licence.identifier === "CC-BY-3.0-AU"
    && source.format === "csv"
    && source.url === `https://data.gov.au/data/datastore/dump/${source.resourceId}?format=csv`
    && source.expectedContentTypes.includes("application/octet-stream")
    && source.maxBytes <= 8_000_000
  )));
  assert.deepEqual(
    new Set(GEMS_PRODUCT_SOURCES.map(({ registryCode }) => registryCode)),
    new Set(["gems-products"]),
  );
  assert.ok(LICENCE_REQUIRED_PRODUCT_CONNECTORS.length >= 3);
  assert.ok(
    LICENCE_REQUIRED_PRODUCT_CONNECTORS.every((connector) => (
      connector.productionMode === "licence_required"
      && connector.callable === false
    )),
  );
});

test("CER CEC CSV parsing preserves exact raw fields and maps effective dates", () => {
  const source = fixtureSource(CER_CEC_PRODUCT_SOURCES[0]);
  const records = parseOfficialProductSource(
    source,
    csvFixture(source, [
      "Example, Solar Pty Ltd",
      "PV-440N (IEC 61215-2021)",
      "7/8/2026",
      "07/08/2029",
      "Yes",
    ]),
    "text/csv; charset=UTF-8",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].manufacturer, "Example, Solar Pty Ltd");
  assert.equal(records[0].model, "PV-440N (IEC 61215-2021)");
  assert.equal(records[0].eligibleFrom, "2026-08-07");
  assert.equal(records[0].eligibleTo, "2029-08-07");
  assert.equal(records[0].approvalStatus, "Approved");
  assert.equal(records[0].availableInAustralia, true);
  assert.equal(records[0].attributes.ratedPowerW, null);
  assert.equal(records[0].attributes.fireTested, true);
  assert.equal(records[0].attributes.sourceFieldCount, 5);
  assert.ok(Buffer.byteLength(JSON.stringify(records[0].attributes)) < 4_096);
  assert.match(records[0].sourceRecordKey, /^cer-cec-approved-pv-modules:/);
});

test("formula-critical inverter, battery and GEMS air-conditioner values are numeric", () => {
  const inverterSource = fixtureSource(CER_CEC_PRODUCT_SOURCES[1]);
  const inverter = parseOfficialProductSource(
    inverterSource,
    csvFixture(inverterSource, [
      "Example Inverters Pty Ltd",
      "Example Series",
      "INV-10",
      "9.999",
      "08/08/2026",
      "08/08/2029",
    ]),
    "text/csv",
  )[0];
  assert.equal(inverter.attributes.ratedAcOutputKw, 9.999);

  const batterySource = fixtureSource(CER_CEC_PRODUCT_SOURCES[2]);
  const battery = parseOfficialProductSource(
    batterySource,
    csvFixture(batterySource, [
      "Example Batteries Pty Ltd",
      "Example",
      "Stack",
      "BAT-4",
      "11.52",
      "10.36",
      "08/08/2026",
      "08/08/2029",
    ]),
    "text/csv",
  )[0];
  assert.equal(battery.attributes.nominalCapacityKwh, 11.52);
  assert.equal(battery.attributes.usableCapacityKwh, 10.36);
  assert.equal(battery.attributes.ratedAcPowerKw, null);
  assert.equal(battery.attributes.ratedDcPowerKw, null);

  const airConditionerSource = ckanFixtureSource(GEMS_PRODUCT_SOURCES[0]);
  const airConditionerRecord = ckanRecord(airConditionerSource, {
    _id: 7,
    Brand: "Example Air",
    Model_No: "AC-71",
    "Family Name": null,
    Sold_in: "Australia",
    Submit_ID: "7001",
    SubmitStatus: "Approved",
    ExpDate: "2030-08-08",
    GrandDate: "2026-08-08",
    "Availability Status": "Available",
    "Registration Number": "ZAC7001",
    "Rated Total Cool Capacity W": "7100.0",
    "Rated cooling power input kW": "2.297",
    "Rated Heating Capacity watts": "8000.0",
    "Rated AEER": "3.0903",
    "Rated ACOP": "3.1904",
    "Residential TCSPF_cold": "4.01",
    "Residential tcec_cold": "466.0",
    "Residential HSPF_cold": "3.436",
    "Residential thec_cold": "3072.0",
  });
  const airConditioner = parseOfficialProductSource(
    airConditionerSource,
    ckanFixture(airConditionerSource, [airConditionerRecord]),
    "application/json",
  )[0];
  assert.equal(airConditioner.attributes.ratedCoolingCapacityKw, 7.1);
  assert.equal(airConditioner.attributes.ratedCoolingInputKw, 2.297);
  assert.equal(airConditioner.attributes.ratedHeatingCapacityKw, 8);
  assert.equal(airConditioner.attributes.aeeR, 3.0903);
  assert.equal(airConditioner.attributes.acop, 3.1904);
  assert.equal(airConditioner.attributes.residentialTcspfCold, 4.01);
  assert.equal(
    airConditioner.attributes.residentialCoolingEnergyColdKwh,
    466,
  );
});

test("direct VEU and NSW GEMS product classes expose normalized formula inputs", () => {
  const sourceFor = (productKind) => {
    const source = GEMS_PRODUCT_SOURCES.find((candidate) => (
      candidate.productKind === productKind
    ));
    assert.ok(source, `missing controlled source for ${productKind}`);
    return ckanFixtureSource(source);
  };
  const parseOne = (source, overrides) => parseOfficialProductSource(
    source,
    ckanFixture(source, [ckanRecord(source, overrides)]),
    "application/json",
  )[0];

  const refrigeratorSource = sourceFor("household_refrigerator_freezer");
  const refrigerator = parseOne(refrigeratorSource, {
    _id: 1,
    Brand: "Example Refrigeration",
    "Model No": "RF-500",
    "Family Name": "RF Family",
    Sold_in: "Australia",
    Submit_ID: "10001",
    SubmitStatus: "Approved",
    ExpDate: "2031-08-08",
    GrandDate: "2026-08-08",
    "Availability Status": "Available",
    "Registration Number": null,
    "Labelled energy consumption (kWh/year)": "315.5",
    Star2009: "4.5",
    SRI2009: "42.1",
    Group: "5B",
    Designation: "Refrigerator/Freezer",
    CompartType: "Fresh Food,Freezer",
    "Tot Vol": "500",
    "FF Vol": "350",
    "FZ Vol": "150",
    "Adjusted volume": "612.4",
  });
  assert.equal(refrigerator.attributes.labelledEnergyConsumptionKwhPerYear, 315.5);
  assert.equal(refrigerator.attributes.totalVolumeLitres, 500);
  assert.equal(refrigerator.attributes.refrigeratorGroup, "5B");
  assert.equal(
    refrigerator.attributes.refrigeratorDesignation,
    "Refrigerator/Freezer",
  );
  assert.equal(refrigerator.attributes.compartmentTypes, "Fresh Food,Freezer");
  assert.equal(refrigerator.registrationNumber, null);
  assert.match(
    refrigerator.sourceRecordKey,
    /^gems-household-refrigerators-freezers:5:10001\|21:Example Refrigeration\|6:RF-500$/,
  );

  const televisionSource = sourceFor("television");
  const television = parseOne(televisionSource, {
    _id: 2,
    Submit_ID: "10002",
    Brand_Reg: "Example Vision",
    Model_No: "TV-65",
    "Family Name": "Vision Family",
    SoldIn: "Australia,New Zealand",
    SubmitStatus: "Approved",
    ExpDate: "2031-08-08",
    GrandDate: "2026-08-08",
    "Availability Status": "Available",
    "Registration Number": "ATV10002",
    "Labelled energy consumption (kWh/year)": "188.3",
    Star2: "5",
    "Star Rating Index": "51.2",
    Avg_mode_power: "120.4",
    screensize: "165",
    Screen_Area: "7160",
  });
  assert.equal(television.attributes.averageModePowerW, 120.4);
  assert.equal(television.availableInAustralia, true);

  const dryerSource = sourceFor("clothes_dryer");
  const dryer = parseOne(dryerSource, {
    _id: 3,
    Brand: "Example Laundry",
    "Model No": "DR-9",
    "Family Name": "Dryer Family",
    Sold_in: "Australia",
    Submit_ID: "10003",
    SubmitStatus: "Approved",
    ExpDate: "2031-08-08",
    GrandDate: "2026-08-08",
    "Availability Status": "Available",
    "Registration Number": "ADR10003",
    Cap: "9",
    Combination: "No",
    "Labelled energy consumption (kWh/year)": "148.7",
    "New Star": "8",
    "New SRI": "81.3",
    "Prog Time": "205",
    Type: "Heat pump",
  });
  assert.equal(dryer.attributes.capacityKg, 9);
  assert.equal(dryer.attributes.dryerType, "Heat pump");
  assert.equal(dryer.attributes.isCombinationWasherDryer, false);
  assert.equal(dryer.attributes.isStandaloneClothesDryer, true);

  const poolPumpSource = sourceFor("pool_pump");
  const poolPump = parseOne(poolPumpSource, {
    _id: 4,
    Brand: "Example Pool",
    Model: "PP-VS-1",
    Available: "Australia",
    "Pool Pump Type": "Variable-speed",
    "Nameplate Input Power": "1350",
    "Input Power": "1120",
    High: "1120",
    Low: "180",
    "Star Rating Index": "67.4",
    "Star Rating": "6",
    "Weighted Energy Factor": "9.25",
    "Daily Run Time": "8",
    "Labelled energy consumption (kWh/year)": "934.6",
    "Date Available Until": "2031-08-08",
    "Registration Number": "APP10004",
    "Record ID": "10004",
  });
  assert.equal(poolPump.attributes.weightedEnergyFactor, 9.25);
  assert.equal(poolPump.attributes.maximumTestedInputW, 1120);
  assert.equal(poolPump.approvalStatus, "Approved");

  const motorSource = sourceFor("electric_motor");
  const motor = parseOne(motorSource, {
    _id: 5,
    Brand: "Example Motors",
    "Model No": "MTR-75",
    "Family Name": "Motor Family",
    Sold_in: "Australia",
    Submit_ID: "10005",
    SubmitStatus: "Approved",
    ExpDate: "2031-08-08",
    GrandDate: "2026-08-08",
    "Availability Status": "Available",
    "Registration Number": "AMT10005",
    kWatt: "75",
    Eff50: "94.4",
    Eff75: "95.1",
    EffFL: "95.3",
    NumPls: "4",
    Torque_FL: "398",
    High_eff_compl: "Yes - 2018 High Efficiency Level",
    High_eff_load: "Both",
    MEPS_Applic: "Yes - 2018 MEPS Level",
    MEPS_compl_load: "75",
  });
  assert.equal(motor.attributes.ratedOutputKw, 75);
  assert.equal(motor.attributes.highEfficiencyCompliant, true);
  assert.equal(motor.attributes.highEfficiencyAt75Percent, true);
  assert.equal(motor.attributes.highEfficiencyAt100Percent, true);
  assert.equal(motor.attributes.mepsCompliantAt75Percent, true);
  assert.equal(motor.attributes.mepsCompliantAt100Percent, false);

  const cabinetSource = sourceFor("commercial_refrigerator");
  const cabinet = parseOne(cabinetSource, {
    _id: 6,
    Brand: "Example Cabinets",
    "Model No": "CAB-12",
    "Family Name": "Cabinet Family",
    Sold_in: "Australia",
    Submit_ID: "10006",
    SubmitStatus: "Approved",
    ExpDate: "2031-08-08",
    GrandDate: "2026-08-08",
    "Availability Status": "Available",
    "Registration Number": "ACR10006",
    high_efficiency: "Yes",
    "Total Energy Consumption(kWh/24h)": "4.85",
    "Energy Efficiency Index": "68.2",
    "Efficiency (kWh/24h/m2)": "2.1",
    total_dis_area: "2.3",
    "Net Volume": "620",
    "Product Class Number": "12",
    "Star Rating": "5",
    "Cabinet Type": "Integral",
    "Duty Type": "Heavy duty",
  });
  assert.equal(cabinet.attributes.totalEnergyConsumptionKwhPer24h, 4.85);
  assert.equal(cabinet.attributes.highEfficiency, true);

  const chillerSource = sourceFor("chiller");
  const chiller = parseOne(chillerSource, {
    _id: 7,
    Submit_ID: "10007",
    Brand_Reg: "Example Chillers",
    Model_No: "CH-500",
    "Family Name": "Chiller Family",
    SoldIn: "Australia",
    standard_rating: "Yes",
    condenser_type: "Air cooled",
    cooling_capacity: "500",
    Decl_COP: "3.45",
    Decl_IPLV: "5.88",
    ExpDate: "2031-08-08",
    GrandDate: "2026-08-08",
    SubmitStatus: "Approved",
    "Availability Status": "Available",
    "Registration Basis": "Single model",
    "Registration Number": "ACH10007",
  });
  assert.equal(chiller.attributes.ratedCoolingCapacityKw, 500);
  assert.equal(chiller.attributes.declaredIplv, 5.88);
  assert.equal(chiller.attributes.standardRating, true);
});

test("CSV schema drift and count regression fail closed", () => {
  const source = fixtureSource(CER_CEC_PRODUCT_SOURCES[0]);
  const body = csvFixture(source, [
    "Example Solar Pty Ltd",
    "PV-440N",
    "07/08/2026",
    "07/08/2029",
    "Yes",
  ]);
  assert.throws(
    () => parseOfficialProductSource(
      source,
      encoder.encode(new TextDecoder().decode(body).replace(
        "Licensee/Certificate Holder",
        "Manufacturer",
      )),
      "text/csv",
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED"),
  );
  assert.throws(
    () => parseOfficialProductSource(
      source,
      body,
      "text/csv",
      { previousRecordCount: 2 },
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_COUNT_REGRESSION"),
  );
});

test("GEMS CKAN parsing preserves primitive values and stable registration identity", () => {
  const source = ckanFixtureSource(GEMS_PRODUCT_SOURCES[1]);
  const record = ckanRecord(source, {
    _id: 41,
    Brand: "Rheem",
    "Model No": "250L Example",
    "Family Name": null,
    Sold_in: "Australia,New Zealand",
    Submit_ID: "123456",
    SubmitStatus: "Approved",
    ExpDate: "2030-12-31",
    GrandDate: "2026-08-07",
    "Availability Status": "Available",
    "Registration Number": "AHW1234",
  });
  const records = parseOfficialProductSource(
    source,
    ckanFixture(source, [record]),
    "application/json; charset=utf-8",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].brand, "Rheem");
  assert.equal(records[0].model, "250L Example");
  assert.equal(records[0].registrationNumber, "AHW1234");
  assert.equal(records[0].approvalStatus, "Approved");
  assert.equal(records[0].eligibleFrom, "2026-08-07");
  assert.equal(records[0].eligibleTo, "2030-12-31");
  assert.equal(records[0].availableInAustralia, true);
  assert.equal(records[0].attributes.sourceFieldCount, source.expectedFields.length);
  assert.ok(Buffer.byteLength(JSON.stringify(records[0].attributes)) < 4_096);
  assert.match(
    records[0].sourceRecordKey,
    /^gems-electric-water-heaters:6:123456\|7:AHW1234\|5:Rheem\|12:250L Example$/,
  );
});

test("identical CKAN datastore duplicates collapse without using volatile row ids", () => {
  const source = ckanFixtureSource(GEMS_PRODUCT_SOURCES[0]);
  const first = ckanRecord(source, {
    _id: 100,
    Brand: "Example Air",
    Model_No: "AC-100",
    Sold_in: "Australia",
    Submit_ID: "1000",
    SubmitStatus: "Approved",
    ExpDate: "2030-01-01",
    "Availability Status": "Available",
    "Registration Number": "AAC1000",
  });
  const duplicate = { ...first, _id: 101 };
  const records = parseOfficialProductSource(
    source,
    ckanFixture(source, [first, duplicate]),
    "application/json",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].attributes.duplicateDatastoreRowCount, 2);

  const conflict = { ...duplicate, Refrigerant: "R32" };
  assert.throws(
    () => parseOfficialProductSource(
      source,
      ckanFixture(source, [first, conflict]),
      "application/json",
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_DUPLICATE"),
  );
});

test("official CKAN CSV dumps reconcile only exact datastore duplicates", () => {
  const source = fixtureSource(GEMS_PRODUCT_SOURCES[0]);
  const first = ckanRecord(source, {
    _id: 100,
    Brand: "Example Air",
    Model_No: "AC-100",
    Sold_in: "Australia",
    Submit_ID: "1000",
    SubmitStatus: "Approved",
    ExpDate: "2030-01-01",
    "Availability Status": "Available",
    "Registration Number": "AAC1000",
  });
  const duplicate = { ...first, _id: 101 };
  const values = (record) => source.expectedFields.map((fieldName) => (
    record[fieldName] === null ? "" : String(record[fieldName])
  ));
  const records = parseOfficialProductSource(
    source,
    csvRowsFixture(source, [values(first), values(duplicate)]),
    "application/octet-stream",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].attributes.duplicateDatastoreRowCount, 2);

  const conflict = { ...duplicate, Refrigerant: "R32" };
  assert.throws(
    () => parseOfficialProductSource(
      source,
      csvRowsFixture(source, [values(first), values(conflict)]),
      "application/octet-stream",
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_DUPLICATE"),
  );
});

test("largest reviewed GEMS CSV shape parses inside a 48 MiB old-space ceiling", () => {
  const parserUrl = new URL(
    "../src/lib/creditex-official-product-parsers.ts",
    import.meta.url,
  ).href;
  const sourcesUrl = new URL(
    "../src/lib/creditex-official-product-sources.ts",
    import.meta.url,
  ).href;
  const script = `
    import { parseOfficialProductSource } from ${JSON.stringify(parserUrl)};
    import { GEMS_PRODUCT_SOURCES } from ${JSON.stringify(sourcesUrl)};
    const source = GEMS_PRODUCT_SOURCES.find((candidate) => (
      candidate.sourceKey === "gems-air-conditioners"
    ));
    if (!source) throw new Error("missing air-conditioner source");
    const positions = new Map(source.expectedFields.map((field, index) => [field, index]));
    const filler = "x".repeat(720);
    const lines = [];
    for (let index = 0; index < 6_000; index += 1) {
      const values = new Array(source.expectedFields.length).fill("");
      const set = (field, value) => { values[positions.get(field)] = value; };
      set("_id", String(index + 1));
      set("Submit_ID", String(100_000 + index));
      set("Registration Number", "REG-" + index);
      set("Brand", "Memory Test");
      set("Model_No", "AC-" + index);
      set("Sold_in", "Australia");
      set("SubmitStatus", "Approved");
      set("GrandDate", "2026-08-08");
      set("ExpDate", "2031-08-08");
      set("Availability Status", "Available");
      set("Product Website", filler);
      lines.push(values.join(","));
    }
    let csv = source.expectedFields.join(",") + "\\r\\n" + lines.join("\\r\\n") + "\\r\\n";
    lines.length = 0;
    const bytes = new TextEncoder().encode(csv);
    csv = "";
    globalThis.gc?.();
    const records = parseOfficialProductSource(source, bytes, "application/octet-stream");
    console.log(JSON.stringify({ byteLength: bytes.byteLength, recordCount: records.length }));
  `;
  const result = spawnSync(process.execPath, [
    "--max-old-space-size=48",
    "--expose-gc",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    script,
  ], {
    encoding: "utf8",
    maxBuffer: 1_000_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const measurement = JSON.parse(result.stdout.trim());
  assert.equal(measurement.recordCount, 6_000);
  assert.ok(measurement.byteLength > 5_000_000);
  assert.ok(measurement.byteLength <= GEMS_PRODUCT_SOURCES[0].maxBytes);
});

test("CKAN field drift, partial pagination and non-primitive attributes fail closed", () => {
  const source = ckanFixtureSource(GEMS_PRODUCT_SOURCES[2]);
  const record = ckanRecord(source, {
    _id: 1,
    Submit_ID: "9001",
    SubmitStatus: "Approved",
    Sold_in: "Australia",
    Brand: "Example",
    "Model Number": "GW-20",
    "Expiry Date": "2031-01-01",
    "Availability Status": "Available",
    "Registration Number": "AGW0001",
  });
  const driftedFields = [...source.expectedFields];
  driftedFields[1] = "Submission_ID";
  assert.throws(
    () => parseOfficialProductSource(
      source,
      ckanFixture(source, [record], driftedFields),
      "application/json",
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED"),
  );

  const partial = JSON.parse(new TextDecoder().decode(ckanFixture(source, [record])));
  partial.result.total = 2;
  assert.throws(
    () => parseOfficialProductSource(
      source,
      encoder.encode(JSON.stringify(partial)),
      "application/json",
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_INCOMPLETE"),
  );

  const invalidRecord = { ...record, Brand: { unsafe: "nested" } };
  assert.throws(
    () => parseOfficialProductSource(
      source,
      ckanFixture(source, [invalidRecord]),
      "application/json",
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_FIELD_INVALID"),
  );
});

test("wrong media type and malformed CSV are rejected before import", () => {
  const source = fixtureSource(CER_CEC_PRODUCT_SOURCES[2]);
  assert.throws(
    () => parseOfficialProductSource(source, encoder.encode("{}"), "text/html"),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_CONTENT_TYPE_CHANGED"),
  );
  assert.throws(
    () => parseOfficialProductSource(
      source,
      encoder.encode(`${source.expectedFields.join(",")}\n"unterminated`),
      "text/csv",
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_CSV_MALFORMED"),
  );
  assert.throws(
    () => parseOfficialProductSource(
      source,
      encoder.encode(`${source.expectedFields.join(",")}\n"unsafe\0value"`),
      "text/csv",
    ),
    expectedSourceError("OFFICIAL_PRODUCT_SOURCE_CSV_MALFORMED"),
  );
});

test("live official feeds satisfy their controlled schemas and record floors", {
  skip: process.env.CREDITEX_LIVE_OFFICIAL_PRODUCTS !== "1",
  timeout: 180_000,
}, async () => {
  for (const source of OFFICIAL_PRODUCT_SOURCES) {
    const response = await fetch(source.url, {
      headers: { accept: source.expectedContentTypes.join(", ") },
    });
    assert.equal(response.ok, true, `${source.sourceKey} returned ${response.status}`);
    const records = parseOfficialProductSource(
      source,
      new Uint8Array(await response.arrayBuffer()),
      response.headers.get("content-type") || "",
    );
    assert.equal(records.length, source.verifiedUniqueRecordCount);
    assert.ok(
      records.every(({ attributes }) => (
        Buffer.byteLength(JSON.stringify(attributes)) < 4_096
      )),
      `${source.sourceKey} exceeded the per-record D1 attribute budget`,
    );
  }
});

test("all official GEMS CSV dumps normalize identically to their CKAN JSON records", {
  skip: process.env.CREDITEX_LIVE_OFFICIAL_REGISTRY !== "1",
  timeout: 180_000,
}, async () => {
  for (const source of GEMS_PRODUCT_SOURCES) {
    const jsonSource = {
      ...source,
      url:
        `https://data.gov.au/data/api/3/action/datastore_search?resource_id=${source.resourceId}&limit=10000`,
      format: "ckan_datastore_json",
      expectedContentTypes: ["application/json"],
      maxBytes: 100_000_000,
    };
    const jsonResponse = await fetch(jsonSource.url);
    assert.equal(jsonResponse.ok, true, `${source.sourceKey} JSON reference failed`);
    const jsonRecords = parseOfficialProductSource(
      jsonSource,
      new Uint8Array(await jsonResponse.arrayBuffer()),
      jsonResponse.headers.get("content-type") || "",
    );
    const csvResponse = await fetch(source.url);
    assert.equal(csvResponse.ok, true, `${source.sourceKey} CSV dump failed`);
    const csvRecords = parseOfficialProductSource(
      source,
      new Uint8Array(await csvResponse.arrayBuffer()),
      csvResponse.headers.get("content-type") || "",
    );
    const byIdentity = (left, right) => (
      left.sourceRecordKey.localeCompare(right.sourceRecordKey)
    );
    assert.equal(csvRecords.length, source.verifiedUniqueRecordCount);
    assert.equal(jsonRecords.length, source.verifiedUniqueRecordCount);
    assert.deepEqual(
      [...csvRecords].sort(byIdentity),
      [...jsonRecords].sort(byIdentity),
      `${source.sourceKey} CSV normalization diverged from CKAN JSON`,
    );
  }
});
