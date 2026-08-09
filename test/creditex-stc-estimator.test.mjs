import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CREDITEX_STC_ESTIMATE_CONTRACT,
  CREDITEX_STC_TECHNOLOGIES,
  CREDITEX_STC_ZONE_RATINGS,
  CreditexStcEstimateError,
  estimateCreditexStcs,
} from "../src/lib/creditex-stc-estimator.ts";
import {
  creditexRepeatRegisteredWaterHeaterQuote,
  estimateCreditexSresQuote,
} from "../src/lib/creditex-sres-calculator-estimator.ts";
import {
  MAXIMUM_CREDITEX_JSON_BYTES,
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "../src/lib/bounded-json-request.ts";

const routeSource = fs.readFileSync(
  new URL("../src/app/api/creditex/stc-estimates/route.ts", import.meta.url),
  "utf8",
);

function expectedError(code) {
  return (error) => {
    assert.ok(error instanceof CreditexStcEstimateError);
    assert.equal(error.code, code);
    return true;
  };
}

test("small generation STCs use exact zone ratings, deeming years and final floor", () => {
  const estimate = estimateCreditexStcs({
    technology: "solar_pv",
    installationDate: "2026-08-02",
    ratedCapacityKw: "6.6",
    zoneRating: "1.382",
  });
  assert.equal(estimate.schemaVersion, CREDITEX_STC_ESTIMATE_CONTRACT);
  assert.deepEqual(estimate.output, { quantity: "45", unit: "STC" });
  assert.equal(estimate.trace[0].output, "9.1212");
  assert.equal(estimate.trace[1].output, "45.606");
  assert.equal(estimate.trace[2].operation, "round down once at the final entitlement step");
  assert.equal(estimate.status, "estimate_only_registry_reconciliation_required");
  assert.equal(estimate.certificateActionEnabled, false);
  assert.match(estimate.receiptHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    estimate.receiptHash,
    estimateCreditexStcs({
      zoneRating: "1.382",
      ratedCapacityKw: "6.600",
      installationDate: "2026-08-02",
      technology: "solar_pv",
    }).receiptHash,
  );
});

test("wind and hydro STCs use statutory resource hours and controlled one-or-maximum periods", () => {
  const wind = estimateCreditexStcs({
    technology: "small_wind",
    installationDate: "2026-08-02",
    ratedCapacityKw: "6",
    resourceAvailability: "default",
    deemingYears: "5",
  });
  assert.deepEqual(wind.output, { quantity: "57", unit: "STC" });
  assert.equal(wind.trace[0].output, "11.4");
  assert.match(wind.trace[0].operation, /0\.00095/);
  assert.match(wind.formulaVersion, /Regulations 2001 compilation 90/);

  const hydro = estimateCreditexStcs({
    technology: "small_hydro",
    installationDate: "2026-08-02",
    ratedCapacityKw: "6.4",
    resourceAvailability: "default",
    deemingYears: "5",
  });
  assert.deepEqual(hydro.output, { quantity: "121", unit: "STC" });
  assert.equal(hydro.trace[0].output, "24.32");

  const minimum = estimateCreditexStcs({
    technology: "small_wind",
    installationDate: "2026-08-02",
    ratedCapacityKw: "0.3",
    resourceAvailability: "default",
    deemingYears: "5",
  });
  assert.equal(minimum.trace[0].output, "0.57");
  assert.equal(minimum.trace[1].output, "2.85");
  assert.deepEqual(minimum.output, { quantity: "2", unit: "STC" });

  const oneYearMinimum = estimateCreditexStcs({
    technology: "small_wind",
    installationDate: "2026-08-02",
    ratedCapacityKw: "0.3",
    resourceAvailability: "default",
    deemingYears: "1",
  });
  assert.equal(oneYearMinimum.trace[2].output, "1");
  assert.deepEqual(oneYearMinimum.output, { quantity: "1", unit: "STC" });
});

test("registered water-heater STCs apply the installation-year factor before final floor", () => {
  const estimate = estimateCreditexStcs({
    technology: "air_source_heat_pump",
    installationDate: "2026-07-22",
    registeredTenYearStcs: "43",
  });
  assert.deepEqual(estimate.output, { quantity: "21", unit: "STC" });
  assert.equal(estimate.trace[0].operation, "multiply by 0.5 for an installation in 2026");

  const finalYear = estimateCreditexStcs({
    technology: "solar_water_heater",
    installationDate: "2030-01-01",
    registeredTenYearStcs: "43",
  });
  assert.deepEqual(finalYear.output, { quantity: "4", unit: "STC" });

  const largeRegisteredSystem = estimateCreditexStcs({
    technology: "solar_water_heater",
    installationDate: "2026-08-02",
    registeredTenYearStcs: "3740",
  });
  assert.deepEqual(
    largeRegisteredSystem.output,
    { quantity: "1870", unit: "STC" },
  );
});

test("registered water-heater quote totals retain an explicit per-system result", () => {
  const perUnit = estimateCreditexStcs({
    technology: "air_source_heat_pump",
    installationDate: "2026-07-22",
    registeredTenYearStcs: "43",
  });
  const repeated = creditexRepeatRegisteredWaterHeaterQuote({
    ...perUnit,
    resolution: {
      brand: "Exact Brand",
      model: "Exact Model",
    },
    resolvedReceiptHash: `sha256:${"b".repeat(64)}`,
  }, "2");

  assert.deepEqual(repeated.perUnitOutput, { quantity: "21", unit: "STC" });
  assert.deepEqual(repeated.output, { quantity: "42", unit: "STC" });
  assert.equal(repeated.unitQuantity, "2");
  assert.equal(repeated.inputSnapshot.unitQuantity, "2");
  assert.equal(repeated.resolution.perUnitStcs, "21");
  assert.equal(repeated.resolution.totalStcs, "42");
  assert.ok(repeated.trace.some(({ key }) => key === "multi_unit_total"));
  assert.match(repeated.receiptHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(repeated.resolvedReceiptHash, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(repeated.receiptHash, perUnit.receiptHash);

  for (const quantity of ["0", "11", "1.5", 2]) {
    assert.throws(
      () => creditexRepeatRegisteredWaterHeaterQuote(perUnit, quantity),
      expectedError("STC_REQUEST_INVALID"),
    );
  }
});

test("solar battery STCs apply current date factors, capacity bands and the 50 kWh claim cap", () => {
  const postMay = estimateCreditexStcs({
    technology: "solar_battery",
    certificationDate: "2026-05-01",
    claimScope: "new_system",
    nominalCapacityKwh: "70",
    usableCapacityKwh: "60",
  });
  assert.deepEqual(postMay.output, { quantity: "174", unit: "STC" });
  assert.equal(postMay.trace[0].output, "50");
  assert.equal(postMay.trace[1].output, "14");
  assert.equal(postMay.trace[2].output, "8.4");
  assert.equal(postMay.trace[3].output, "3.3");
  assert.match(postMay.trace[4].operation, /6\.8/);

  const officialExample = estimateCreditexStcs({
    technology: "solar_battery",
    certificationDate: "2026-05-01",
    claimScope: "new_system",
    nominalCapacityKwh: "40",
    usableCapacityKwh: "40",
  });
  assert.deepEqual(officialExample.output, { quantity: "164", unit: "STC" });

  const preMay = estimateCreditexStcs({
    technology: "solar_battery",
    certificationDate: "2026-04-30",
    claimScope: "new_system",
    nominalCapacityKwh: "50",
    usableCapacityKwh: "50",
  });
  assert.deepEqual(preMay.output, { quantity: "420", unit: "STC" });
  assert.match(preMay.trace[1].operation, /before 1 May 2026/);
  assert.match(preMay.trace[2].operation, /8\.4/);
});

test("STC estimates reject unsupported dates, free-form factors, invalid eligibility and numeric coercion", () => {
  assert.deepEqual(CREDITEX_STC_TECHNOLOGIES, [
    "solar_pv",
    "small_wind",
    "small_hydro",
    "solar_water_heater",
    "air_source_heat_pump",
    "solar_battery",
  ]);
  assert.deepEqual(CREDITEX_STC_ZONE_RATINGS, [
    "1.622",
    "1.536",
    "1.382",
    "1.185",
  ]);
  assert.throws(
    () => estimateCreditexStcs({
      technology: "solar_pv",
      installationDate: "2025-12-31",
      ratedCapacityKw: "6.6",
      zoneRating: "1.382",
    }),
    expectedError("STC_DATE_UNSUPPORTED"),
  );
  assert.throws(
    () => estimateCreditexStcs({
      technology: "solar_pv",
      installationDate: "2026-01-01",
      ratedCapacityKw: 6.6,
      zoneRating: "1.382",
    }),
    expectedError("STC_VALUE_INVALID"),
  );
  assert.throws(
    () => estimateCreditexStcs({
      technology: "small_wind",
      installationDate: "2030-01-01",
      ratedCapacityKw: "6",
      resourceAvailability: "default",
      deemingYears: "5",
    }),
    expectedError("STC_VALUE_INVALID"),
  );
  assert.throws(
    () => estimateCreditexStcs({
      technology: "small_hydro",
      installationDate: "2026-01-01",
      ratedCapacityKw: "6.4",
      resourceAvailability: "site_assessed",
      resourceHoursPerYear: "8760",
      deemingYears: "5",
    }),
    expectedError("STC_SYSTEM_INELIGIBLE"),
  );
  assert.throws(
    () => estimateCreditexStcs({
      technology: "small_wind",
      installationDate: "2026-01-01",
      ratedCapacityKw: "6",
      resourceAvailability: "default",
      resourceHoursPerYear: "2001",
      deemingYears: "5",
    }),
    expectedError("STC_REQUEST_INVALID"),
  );
  assert.throws(
    () => estimateCreditexStcs({
      technology: "solar_pv",
      installationDate: "2026-01-01",
      ratedCapacityKw: "6.6",
      zoneRating: "1.4",
    }),
    expectedError("STC_VALUE_INVALID"),
  );
  assert.throws(
    () => estimateCreditexStcs({
      technology: "solar_battery",
      certificationDate: "2026-06-01",
      claimScope: "new_system",
      nominalCapacityKwh: "4.9",
      usableCapacityKwh: "4.5",
    }),
    expectedError("STC_SYSTEM_INELIGIBLE"),
  );
  assert.throws(
    () => estimateCreditexStcs({
      technology: "solar_pv",
      installationDate: "2026-01-01",
      ratedCapacityKw: "6.6",
      zoneRating: "1.382",
      certificateQuantity: "999",
    }),
    expectedError("STC_REQUEST_INVALID"),
  );
});

test("quote estimates calculate PV, wind and hydro from date, postcode and capacity", async () => {
  const databaseIsNotUsedForArithmeticOnlyQuotes = {};
  const pv = await estimateCreditexSresQuote(
    databaseIsNotUsedForArithmeticOnlyQuotes,
    {
      estimatePurpose: "quote",
      technology: "solar_pv",
      installationDate: "2026-08-17",
      postcode: "3000",
      ratedCapacityKw: "6.6",
    },
  );
  assert.deepEqual(pv.output, { quantity: "39", unit: "STC" });
  assert.equal(pv.resolution.zoneRating, "1.185");
  assert.equal(pv.inputSnapshot.zoneRating, "1.185");
  assert.equal(pv.estimatePurpose, "quote");
  assert.equal(pv.eligibilityConfirmed, false);
  assert.equal(pv.certificateActionEnabled, false);
  assert.match(pv.eligibilityWarning, /Quote estimate only/);

  const wind = await estimateCreditexSresQuote(
    databaseIsNotUsedForArithmeticOnlyQuotes,
    {
      estimatePurpose: "quote",
      technology: "small_wind",
      installationDate: "2027-03-10",
      postcode: "3000",
      ratedCapacityKw: "6",
    },
  );
  assert.deepEqual(wind.output, { quantity: "45", unit: "STC" });
  assert.equal(wind.inputSnapshot.deemingYears, "4");
  assert.equal(wind.inputSnapshot.resourceHoursPerYear, "2000");
  assert.equal(wind.resolution.postcodeUsedInArithmetic, false);

  const hydro = await estimateCreditexSresQuote(
    databaseIsNotUsedForArithmeticOnlyQuotes,
    {
      estimatePurpose: "quote",
      technology: "small_hydro",
      installationDate: "2030-12-31",
      postcode: "3000",
      ratedCapacityKw: "6.4",
    },
  );
  assert.deepEqual(hydro.output, { quantity: "24", unit: "STC" });
  assert.equal(hydro.inputSnapshot.deemingYears, "1");
  assert.equal(hydro.inputSnapshot.resourceHoursPerYear, "4000");
});

test("quote estimates reject malformed and out-of-horizon dates without consulting product data", async () => {
  for (const installationDate of ["17-08-2026", "2025-12-31", "2031-01-01"]) {
    await assert.rejects(
      estimateCreditexSresQuote({}, {
        estimatePurpose: "quote",
        technology: "solar_pv",
        installationDate,
        postcode: "3000",
        ratedCapacityKw: "6.6",
      }),
      expectedError("STC_DATE_UNSUPPORTED"),
    );
  }
});

test("battery quote estimates use published inputs and identify missing minimum inputs", async () => {
  const estimate = await estimateCreditexSresQuote({}, {
    estimatePurpose: "quote",
    technology: "solar_battery",
    certificationDate: "2027-07-01",
    nominalCapacityKwh: "20",
    usableCapacityKwh: "18",
  });
  assert.deepEqual(estimate.output, { quantity: "85", unit: "STC" });
  assert.equal(estimate.eligibilityConfirmed, false);
  assert.equal(estimate.certificateActionEnabled, false);

  await assert.rejects(
    estimateCreditexSresQuote({}, {
      estimatePurpose: "quote",
      technology: "solar_battery",
      certificationDate: "2027-07-01",
      nominalCapacityKwh: "20",
      usableCapacityKwh: "",
    }),
    (error) => expectedError("STC_REQUEST_INVALID")(error)
      && /nominal capacity and usable capacity/.test(error.message),
  );
});

test("bounded JSON reading rejects oversized bodies even when Content-Length is missing or false", async () => {
  const oversizedBody = JSON.stringify({
    value: "x".repeat(MAXIMUM_CREDITEX_JSON_BYTES),
  });
  for (const headers of [
    { "content-type": "application/json" },
    { "content-type": "application/json", "content-length": "1" },
  ]) {
    await assert.rejects(
      readBoundedJsonRequest(new Request(
        "https://compare.ausenergyassessments.com/api/creditex/stc-estimates",
        {
          method: "POST",
          headers,
          body: oversizedBody,
        },
      )),
      (error) => {
        assert.ok(error instanceof BoundedJsonRequestError);
        assert.equal(error.code, "REQUEST_TOO_LARGE");
        assert.equal(error.status, 413);
        return true;
      },
    );
  }

  const parsed = await readBoundedJsonRequest(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/stc-estimates",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ technology: "solar_pv" }),
    },
  ));
  assert.deepEqual(parsed, { technology: "solar_pv" });
});

test("the protected estimate route is same-origin, authenticated, bounded and non-mutating", () => {
  assert.match(routeSource, /if \(!sameOrigin\(request\)\)/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
  assert.match(routeSource, /readBoundedJsonRequest\(/);
  assert.match(routeSource, /MAXIMUM_CREDITEX_JSON_BYTES/);
  assert.match(
    routeSource,
    /requireCreditexCalculatorAccess\(request, database, \{\s*allowPublicQuote: estimatePurpose === "quote",\s*\}\)/,
  );
  assert.match(routeSource, /estimateCreditexStcsFromRegistry\(database, body\)/);
  assert.match(routeSource, /estimatePurpose === "quote"/);
  assert.match(routeSource, /estimateCreditexSresQuote\(database, body\)/);
  assert.doesNotMatch(routeSource, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(
    routeSource,
    /INSERT INTO|UPDATE\s+compliance_|DELETE FROM|fetch\(["'`]https:/,
  );
});
