import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_VEU_POSTCODE_ROWS,
  CREDITEX_VEU_POSTCODE_SOURCES,
  CREDITEX_VEU_POSTCODE_TABLE_DIGEST,
  CREDITEX_VEU_POSTCODE_TABLE_ROW_COUNT,
  CreditexVeuPostcodeError,
  resolveCreditexVeuPostcode,
} from "../src/lib/creditex-veu-postcode-resolver.ts";

function expectErrorCode(run, expectedCode, expectedField) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof CreditexVeuPostcodeError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.field, expectedField);
    return true;
  });
}

function classification(result) {
  return {
    postcode: result.postcode,
    geography: result.geography,
    gasReticulated: result.gasReticulated,
    climateRegion: result.climateRegion,
    climateZone: result.climateZone,
    locationClass: result.locationClass,
  };
}

test("VEU Table A transcription has exhaustive deterministic integrity", () => {
  assert.equal(CREDITEX_VEU_POSTCODE_TABLE_ROW_COUNT, 719);
  assert.equal(CREDITEX_VEU_POSTCODE_ROWS.length, 719);
  assert.equal(CREDITEX_VEU_POSTCODE_TABLE_DIGEST, "fnv1a64:d1c9342c68ff9c61");
  assert.ok(Object.isFrozen(CREDITEX_VEU_POSTCODE_ROWS));

  const postcodes = CREDITEX_VEU_POSTCODE_ROWS.map((row) => row.postcode);
  assert.equal(new Set(postcodes).size, 719);
  assert.deepEqual(postcodes, [...postcodes].sort());
  assert.equal(postcodes[0], "3000");
  assert.equal(postcodes.at(-1), "3996");

  const observedTupleCounts = {};
  const permittedLocationClasses = new Set([
    "metro_mild",
    "metro_cold",
    "regional_mild",
    "regional_cold",
    "regional_hot",
  ]);

  for (const row of CREDITEX_VEU_POSTCODE_ROWS) {
    assert.ok(Object.isFrozen(row));
    assert.match(row.postcode, /^\d{4}$/u);
    assert.ok(row.geography === "metropolitan" || row.geography === "regional");
    assert.equal(typeof row.gasReticulated, "boolean");
    assert.ok(["mild", "cold", "hot"].includes(row.climateRegion));
    assert.ok(row.climateZone === "4" || row.climateZone === "5");
    assert.ok(permittedLocationClasses.has(row.locationClass));
    assert.notEqual(
      row.geography === "metropolitan" && row.climateRegion === "hot",
      true,
    );

    const tupleKey = [
      row.geography,
      row.gasReticulated ? "1" : "0",
      row.climateRegion,
      row.climateZone,
    ].join("|");
    observedTupleCounts[tupleKey] = (observedTupleCounts[tupleKey] ?? 0) + 1;
  }

  assert.deepEqual(observedTupleCounts, {
    "metropolitan|1|mild|4": 252,
    "metropolitan|1|mild|5": 4,
    "regional|1|mild|4": 49,
    "regional|0|mild|4": 82,
    "regional|0|cold|5": 66,
    "regional|1|cold|5": 17,
    "regional|0|mild|5": 8,
    "regional|0|cold|4": 113,
    "regional|1|cold|4": 49,
    "metropolitan|0|mild|5": 1,
    "metropolitan|1|cold|5": 6,
    "metropolitan|0|cold|5": 2,
    "metropolitan|1|cold|4": 14,
    "regional|0|hot|4": 39,
    "regional|1|hot|4": 8,
    "metropolitan|0|mild|4": 1,
    "metropolitan|0|cold|4": 1,
    "regional|1|mild|5": 7,
  });
});

test("every official row resolves identically under v24 and v25", () => {
  for (const expected of CREDITEX_VEU_POSTCODE_ROWS) {
    const v24 = resolveCreditexVeuPostcode({
      postcode: expected.postcode,
      installationDate: "2026-07-20",
    });
    const v25 = resolveCreditexVeuPostcode({
      postcode: expected.postcode,
      installationDate: "2026-07-21",
    });

    assert.deepEqual(classification(v24), expected);
    assert.deepEqual(classification(v25), expected);
    assert.equal(v24.source.specificationVersion, "v24");
    assert.equal(v25.source.specificationVersion, "v25");
    assert.equal(v24.tableRowCount, 719);
    assert.equal(v25.tableDigest, CREDITEX_VEU_POSTCODE_TABLE_DIGEST);
    assert.equal(v24.isMetropolitan, expected.geography === "metropolitan");
    assert.equal(v24.isRegional, expected.geography === "regional");
  }
});

test("representative rows cover every official Table A tuple", () => {
  const vectors = [
    ["3000", "metropolitan", true, "mild", "4", "metro_mild"],
    ["3139", "metropolitan", true, "mild", "5", "metro_mild"],
    ["3211", "regional", true, "mild", "4", "regional_mild"],
    ["3213", "regional", false, "mild", "4", "regional_mild"],
    ["3289", "regional", false, "cold", "5", "regional_cold"],
    ["3300", "regional", true, "cold", "5", "regional_cold"],
    ["3301", "regional", false, "mild", "5", "regional_mild"],
    ["3310", "regional", false, "cold", "4", "regional_cold"],
    ["3342", "regional", true, "cold", "4", "regional_cold"],
    ["3430", "metropolitan", false, "mild", "5", "metro_mild"],
    ["3431", "metropolitan", true, "cold", "5", "metro_cold"],
    ["3432", "metropolitan", false, "cold", "5", "metro_cold"],
    ["3441", "metropolitan", true, "cold", "4", "metro_cold"],
    ["3487", "regional", false, "hot", "4", "regional_hot"],
    ["3494", "regional", true, "hot", "4", "regional_hot"],
    ["3758", "metropolitan", false, "mild", "4", "metro_mild"],
    ["3762", "metropolitan", false, "cold", "4", "metro_cold"],
    ["3816", "regional", true, "mild", "5", "regional_mild"],
  ];

  for (const [
    postcode,
    geography,
    gasReticulated,
    climateRegion,
    climateZone,
    locationClass,
  ] of vectors) {
    const result = resolveCreditexVeuPostcode({
      postcode,
      installationDate: "2026-08-08",
    });
    assert.deepEqual(classification(result), {
      postcode,
      geography,
      gasReticulated,
      climateRegion,
      climateZone,
      locationClass,
    });
  }
});

test("installation dates select exact v24 and v25 authority boundaries", () => {
  expectErrorCode(
    () => resolveCreditexVeuPostcode({
      postcode: "3000",
      installationDate: "2026-06-29",
    }),
    "VEU_POSTCODE_DATE_UNSUPPORTED",
    "installationDate",
  );

  const boundaryVectors = [
    ["2026-06-30", "v24"],
    ["2026-07-20", "v24"],
    ["2026-07-21", "v25"],
    ["2026-09-30", "v25"],
  ];
  for (const [installationDate, version] of boundaryVectors) {
    const result = resolveCreditexVeuPostcode({
      postcode: "3000",
      installationDate,
    });
    assert.equal(result.source.specificationVersion, version);
  }

  assert.deepEqual(CREDITEX_VEU_POSTCODE_SOURCES.map((source) => ({
    version: source.specificationVersion,
    from: source.effectiveFrom,
    through: source.effectiveThrough,
    pages: source.sourcePages,
  })), [
    {
      version: "v24",
      from: "2026-06-30",
      through: "2026-07-20",
      pages: "document pages 144-163",
    },
    {
      version: "v25",
      from: "2026-07-21",
      through: null,
      pages: "document pages 145-164",
    },
  ]);
});

test("boundary rows resolve and postcode gaps fail closed without range inference", () => {
  assert.equal(resolveCreditexVeuPostcode({
    postcode: "3000",
    installationDate: "2026-07-21",
  }).postcode, "3000");
  assert.equal(resolveCreditexVeuPostcode({
    postcode: "3996",
    installationDate: "2026-07-21",
  }).postcode, "3996");

  for (const postcode of ["2999", "3005", "3007", "3014", "3208", "3997"]) {
    expectErrorCode(
      () => resolveCreditexVeuPostcode({
        postcode,
        installationDate: "2026-07-21",
      }),
      "VEU_POSTCODE_UNKNOWN",
      "postcode",
    );
  }
});

test("malformed requests, postcodes, and dates fail closed", () => {
  for (const request of [null, undefined, [], "3000"]) {
    expectErrorCode(
      () => resolveCreditexVeuPostcode(request),
      "VEU_POSTCODE_INVALID_REQUEST",
      "request",
    );
  }

  expectErrorCode(
    () => resolveCreditexVeuPostcode({
      postcode: "3000",
      installationDate: "2026-07-21",
      inferred: true,
    }),
    "VEU_POSTCODE_INVALID_REQUEST",
    "request",
  );

  for (const postcode of [3000, "3000 ", " 3000", "300", "03000", "abcd"]) {
    expectErrorCode(
      () => resolveCreditexVeuPostcode({
        postcode,
        installationDate: "2026-07-21",
      }),
      "VEU_POSTCODE_INVALID_POSTCODE",
      "postcode",
    );
  }

  for (const installationDate of [
    20260721,
    "2026-7-21",
    "2026-02-30",
    "not-a-date",
  ]) {
    expectErrorCode(
      () => resolveCreditexVeuPostcode({
        postcode: "3000",
        installationDate,
      }),
      "VEU_POSTCODE_INVALID_INSTALLATION_DATE",
      "installationDate",
    );
  }
});

test("exported authority data and resolutions are immutable", () => {
  const result = resolveCreditexVeuPostcode({
    postcode: "3000",
    installationDate: "2026-07-21",
  });

  assert.ok(Object.isFrozen(CREDITEX_VEU_POSTCODE_SOURCES));
  assert.ok(CREDITEX_VEU_POSTCODE_SOURCES.every(Object.isFrozen));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.source));
  assert.throws(() => {
    CREDITEX_VEU_POSTCODE_ROWS.push(result);
  }, TypeError);
  assert.throws(() => {
    result.geography = "regional";
  }, TypeError);
});
