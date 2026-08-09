import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_CEC_BATTERY_ARTIFACT_CONTRACT,
  CREDITEX_CEC_BATTERY_SOURCE_KEY,
  parseCreditexCecBatteryArtifact,
} from "../src/lib/creditex-cec-battery-parser.ts";
import {
  CREDITEX_CEC_BATTERY_ALL_RECORDS_URL,
  CREDITEX_CEC_BATTERY_CURRENT_RECORDS_URL,
  createCreditexLicensedCecBatteryProductRegistry,
} from "../src/lib/creditex-cec-battery-source.ts";
import {
  CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS,
  creditexCecBatteryConnectorConfigurationIssue,
  creditexAutomaticProductRegistries,
  creditexAutomaticProductRegistry,
} from "../src/lib/creditex-official-product-registry-definitions.ts";

// 2026-08-09 00:00 in Australia/Sydney. This guards the UTC-date boundary
// used by the nightly platform-held registry refresh.
const CAPTURED_AT = "2026-08-08T14:00:00.000Z";

function battery(index, {
  approved = true,
  expiredDate = "2030-10-19",
} = {}) {
  const sequence = String(index + 1).padStart(12, "0");
  return {
    BatteryNumber: `B-${index + 1}`,
    Details: {
      Id: `a1g${sequence}`,
      Model_Number__c: `MODEL-${index + 1}`,
      Series__c: index % 2 === 0 ? "SERIES-A" : null,
      NominalBatteryCapacity: index === 0 ? "10" : 20,
      UsableCapacity: index === 0 ? 9.6 : 18,
      DepthOfDischarge: 90,
      MaxOperatingTemperature: 55,
      MinOperatingTemp: "-20",
      OutdoorUsage: true,
      DCVoltage: 450,
      BatteryChemistry: "LiFePO4",
      RatedDCPower: 5,
    },
    Certificate: {
      Details: {
        SalesforceBatteryCertID: `BAT-${index + 1}`,
        CompliancePathway: "Method 3 Mandatory Requirements",
        CECApprovedDate: "2023-10-19",
        CECExpiredDate: expiredDate,
        CECApproved: approved,
        BrandName: "Example Brand",
        ImporterOrResponsibleSupplier: "Example Supplier Pty Ltd",
        EquipmentCategory: "Pre-assembled Battery System (BS)",
        WarrantyAvailableFrom: "https://example.com/warranty",
      },
    },
  };
}

const CURRENT_BATTERIES = Array.from(
  { length: 1_000 },
  (_, index) => battery(index),
);
const ALL_BATTERIES = [
  ...CURRENT_BATTERIES,
  battery(1_000, { approved: false, expiredDate: "2026-07-01" }),
  battery(1_001, { approved: false, expiredDate: "2030-10-19" }),
];

function listingText(batteries, pretty = false) {
  return JSON.stringify({ Batteries: batteries }, null, pretty ? 2 : 0);
}

function artifactBytes({
  all = ALL_BATTERIES,
  current = CURRENT_BATTERIES,
  capturedAt = CAPTURED_AT,
  pretty = false,
} = {}) {
  return new TextEncoder().encode(JSON.stringify({
    contract: CREDITEX_CEC_BATTERY_ARTIFACT_CONTRACT,
    sourceKey: CREDITEX_CEC_BATTERY_SOURCE_KEY,
    capturedAt,
    allRecordsResponse: listingText(all, pretty),
    currentRecordsResponse: listingText(current, pretty),
  }));
}

function parse(options) {
  return parseCreditexCecBatteryArtifact(
    artifactBytes(options),
    "application/json; charset=utf-8",
  );
}

test("licensed CEC artifact preserves stable identity, official dates and exact capacity fields", () => {
  const records = parse({ pretty: true });
  assert.equal(records.length, 1_002);

  const current = records.find((record) => record.registrationNumber === "B-1");
  assert.ok(current);
  assert.equal(current.sourceRecordKey, "a1g000000000001:B-1:BAT-1");
  assert.equal(current.productKind, "cec_battery");
  assert.equal(current.approvalStatus, "approved");
  assert.equal(current.eligibleFrom, "2023-10-19");
  assert.equal(current.eligibleTo, "2030-10-19");
  assert.equal(current.attributes.nominalBatteryCapacityKwh, 10);
  assert.equal(current.attributes.cecPublishedUsableCapacityKwh, 9.6);
  assert.equal(current.attributes.cecMinimumOperatingTemperatureC, -20);
  assert.equal(current.attributes.cecRatedDcPowerKw, 5);
  assert.equal(current.attributes.pdrsBatteryInverterOutputKw, undefined);
  assert.equal(current.attributes.cecCurrentEndpointMember, true);
  assert.equal(current.attributes.cecHistoricalEligibilityIndeterminate, false);

  const expired = records.find((record) => record.registrationNumber === "B-1001");
  assert.equal(expired?.approvalStatus, "approved");
  assert.equal(expired?.eligibleTo, "2026-07-01");
  assert.equal(expired?.attributes.cecCurrentEndpointMember, false);
  assert.equal(expired?.attributes.cecHistoricalEligibilityIndeterminate, false);

  const indeterminate = records.find(
    (record) => record.registrationNumber === "B-1002",
  );
  assert.equal(indeterminate?.approvalStatus, "not_approved");
  assert.equal(indeterminate?.eligibleTo, "2030-10-19");
  assert.equal(
    indeterminate?.attributes.cecHistoricalEligibilityIndeterminate,
    true,
  );
});

test("licensed CEC parser fails closed on schema, identity, date, subset and count drift", () => {
  const unknownField = structuredClone(ALL_BATTERIES);
  unknownField[0].Details.UnreviewedField = "drift";
  assert.throws(() => parse({ all: unknownField }), /schema changed/);

  const duplicateIdentity = structuredClone(ALL_BATTERIES);
  duplicateIdentity[1] = structuredClone(duplicateIdentity[0]);
  assert.throws(
    () => parse({ all: duplicateIdentity }),
    /duplicate product identity/,
  );

  const invalidDate = structuredClone(ALL_BATTERIES);
  invalidDate[0].Certificate.Details.CECApprovedDate = "2026-02-30";
  assert.throws(() => parse({ all: invalidDate }), /calendar date/);

  const changedCurrent = structuredClone(CURRENT_BATTERIES);
  changedCurrent[0].Details.Model_Number__c = "TAMPERED";
  assert.throws(
    () => parse({ current: changedCurrent }),
    /does not reconcile to all records/,
  );

  const foreignCurrent = structuredClone(CURRENT_BATTERIES);
  foreignCurrent[0] = battery(9_999);
  assert.throws(
    () => parse({ current: foreignCurrent }),
    /does not reconcile to all records/,
  );

  assert.throws(
    () => parse({ current: CURRENT_BATTERIES.slice(0, 999) }),
    /record count is outside its reviewed range/,
  );
});

test("licensed factory calls only the documented all and Current endpoints with platform Basic credentials", async () => {
  const allResponse = listingText(ALL_BATTERIES, true);
  const currentResponse = listingText(CURRENT_BATTERIES, true);
  const calls = [];
  const expectedAuthorization = `Basic ${Buffer.from(
    "platform-user:platform-secret",
  ).toString("base64")}`;
  const definition = createCreditexLicensedCecBatteryProductRegistry({
    username: "platform-user",
    password: "platform-secret",
    licenceReference: "CEC platform data licence 42",
  });

  assert.equal(definition.registryCode, "cec-products");
  assert.equal(definition.sources.length, 1);
  assert.equal(definition.sources[0].productionMode, "automatic");
  assert.equal(definition.sources[0].productKind, "cec_battery");
  assert.equal(creditexAutomaticProductRegistry("cec-products"), undefined);

  const acquired = await definition.fetchSources((url, init) => {
    calls.push({ url, init });
    const body = url === CREDITEX_CEC_BATTERY_CURRENT_RECORDS_URL
      ? currentResponse
      : allResponse;
    return Promise.resolve(new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }));
  });
  assert.deepEqual(
    calls.map(({ url }) => url).sort(),
    [
      CREDITEX_CEC_BATTERY_ALL_RECORDS_URL,
      CREDITEX_CEC_BATTERY_CURRENT_RECORDS_URL,
    ].sort(),
  );
  for (const { init } of calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(new Headers(init.headers).get("authorization"), expectedAuthorization);
  }
  assert.equal(acquired.length, 1);
  const retainedArtifactText = new TextDecoder().decode(acquired[0].bytes);
  assert.doesNotMatch(retainedArtifactText, /platform-secret|platform-user/);
  const retainedArtifact = JSON.parse(retainedArtifactText);
  assert.equal(retainedArtifact.allRecordsResponse, allResponse);
  assert.equal(retainedArtifact.currentRecordsResponse, currentResponse);
  assert.equal(
    definition.sources[0].parse(acquired[0].bytes, acquired[0].contentType).length,
    1_002,
  );
});

test("platform-held CEC credentials activate the licensed registry without a trade credential", () => {
  const environment = {
    [CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS.username]: "platform-user",
    [CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS.password]: "platform-secret",
    [CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS.licenceReference]:
      "CEC platform data licence 42",
  };
  assert.deepEqual(
    creditexAutomaticProductRegistries().map(({ registryCode }) => registryCode),
    ["gems-products", "nsw-tessa-products", "veu-approved-products"],
  );
  assert.deepEqual(
    creditexAutomaticProductRegistries(environment).map(
      ({ registryCode }) => registryCode,
    ),
    [
      "gems-products",
      "nsw-tessa-products",
      "veu-approved-products",
      "cec-products",
    ],
  );
  const licensed = creditexAutomaticProductRegistry(
    "cec-products",
    environment,
  );
  assert.equal(licensed?.registryCode, "cec-products");
  assert.equal(licensed?.sources[0].productionMode, "automatic");
  const partialEnvironment = {
    [CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS.username]: "platform-user",
  };
  assert.equal(
    creditexAutomaticProductRegistry("gems-products", partialEnvironment)?.registryCode,
    "gems-products",
  );
  assert.equal(
    creditexAutomaticProductRegistry(
      "veu-approved-products",
      partialEnvironment,
    )?.registryCode,
    "veu-approved-products",
  );
  assert.equal(
    creditexAutomaticProductRegistry(
      "nsw-tessa-products",
      partialEnvironment,
    )?.registryCode,
    "nsw-tessa-products",
  );
  assert.deepEqual(
    creditexAutomaticProductRegistries(partialEnvironment).map(
      ({ registryCode }) => registryCode,
    ),
    ["gems-products", "nsw-tessa-products", "veu-approved-products"],
  );
  const issue = creditexCecBatteryConnectorConfigurationIssue(
    partialEnvironment,
  );
  assert.match(issue, /configuration is incomplete/);
  assert.match(issue, /CREDITEX_CEC_BATTERY_API_USERNAME/);
  assert.match(issue, /CREDITEX_CEC_BATTERY_API_PASSWORD/);
  assert.match(issue, /CREDITEX_CEC_BATTERY_LICENCE_REFERENCE/);
  assert.equal(
    creditexCecBatteryConnectorConfigurationIssue(environment),
    null,
  );
});

test("licensed factory rejects unusable credentials without disclosing their values", () => {
  assert.throws(
    () => createCreditexLicensedCecBatteryProductRegistry(undefined),
    (error) => error instanceof Error
      && /username is not configured/.test(error.message)
      && !error.message.includes("undefined"),
  );
  assert.throws(
    () => createCreditexLicensedCecBatteryProductRegistry({
      username: "platform-user",
      password: "do-not-leak\nsecret",
      licenceReference: "CEC platform licence",
    }),
    (error) => error instanceof Error
      && /password contains unsupported characters/.test(error.message)
      && !error.message.includes("do-not-leak"),
  );
});

test("licensed acquisition fails closed on redirect, content type, byte limit and non-round-trippable UTF-8", async () => {
  const definition = createCreditexLicensedCecBatteryProductRegistry({
    username: "platform-user",
    password: "platform-secret",
    licenceReference: "CEC platform data licence 42",
  });
  const cases = [
    {
      response: () => new Response(null, {
        status: 302,
        headers: { Location: "https://example.com/not-official" },
      }),
      expected: /redirected unexpectedly/,
    },
    {
      response: () => new Response("{}", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
      expected: /unexpected content type/,
    },
    {
      response: () => new Response("{}", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "25000001",
        },
      }),
      expected: /exceeded its byte limit/,
    },
    {
      response: () => new Response(
        new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
      expected: /unsupported byte representation/,
    },
  ];
  for (const { response, expected } of cases) {
    await assert.rejects(
      () => definition.fetchSources(() => Promise.resolve(response())),
      (error) => error instanceof Error
        && expected.test(error.message)
        && !error.message.includes("platform-secret"),
    );
  }
});
