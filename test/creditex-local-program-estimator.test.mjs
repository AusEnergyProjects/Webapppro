import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_LOCAL_PROGRAM_DEFINITIONS,
  HORIZON_POWER_TOWN_CLASSES,
} from "../src/lib/creditex-local-program-catalogue.ts";
import {
  CreditexLocalEstimateError,
  estimateCreditexLocalProgram,
} from "../src/lib/creditex-local-program-estimator.ts";

function estimate(programCode, activityCode, effectiveDate, inputs) {
  return estimateCreditexLocalProgram({
    programCode,
    activityCode,
    effectiveDate,
    inputs,
  });
}

function assertOutput(result, quantity) {
  assert.equal(result.output.quantity, quantity);
  assert.equal(result.output.unit, "AUD");
  assert.equal(result.certificateActionEnabled, false);
  assert.equal(result.receiptHash.length, 64);
  assert.ok(result.trace.length > 0);
}

test("every declared local activity executes from its governed default vector", () => {
  let activityCount = 0;
  for (const program of CREDITEX_LOCAL_PROGRAM_DEFINITIONS) {
    for (const activity of program.activities) {
      const inputs = Object.fromEntries(activity.inputDefinitions.map((input) => [
        input.key,
        input.key === "legacy_eligibility_confirmed"
          ? "yes"
          : input.defaultValue,
      ]));
      const result = estimate(
        program.programCode,
        activity.activityCode,
        program.effectiveFrom,
        inputs,
      );
      assert.equal(result.programCode, program.programCode);
      assert.equal(result.activityCode, activity.activityCode);
      assert.equal(result.formulaKey, activity.formulaKey);
      activityCount += 1;
    }
  }
  assert.equal(activityCount, 30);
});

test("Queensland solar for renters uses the lower system capacity and lower rebate amount", () => {
  const result = estimate("QLD-SSR", "PV-5-PLUS", "2026-08-08", {
    panel_capacity_kw: "6.6",
    inverter_capacity_kw: "5",
    eligible_cost_aud: "4200",
  });
  assertOutput(result, "3500");
  assert.equal(result.trace[0].output, "5");

  const costLimited = estimate("QLD-SSR", "PV-3-4", "2026-08-08", {
    panel_capacity_kw: "3.3",
    inverter_capacity_kw: "3.5",
    eligible_cost_aud: "2100.50",
  });
  assertOutput(costLimited, "2100.5");
});

test("Queensland solar activity and calculated capacity band must agree", () => {
  assert.throws(
    () => estimate("QLD-SSR", "PV-4-5", "2026-08-08", {
      panel_capacity_kw: "6.6",
      inverter_capacity_kw: "5",
      eligible_cost_aud: "4000",
    }),
    (error) => error instanceof CreditexLocalEstimateError
      && error.code === "LOCAL_INPUT_INVALID",
  );
});

test("Queensland community housing caps eligible GST-exclusive cost per dwelling", () => {
  const result = estimate("QLD-QCHEU", "INSULATION", "2026-08-08", {
    eligible_dwellings: "2",
    eligible_cost_ex_gst_aud: "10000",
  });
  assertOutput(result, "9000");

  assert.throws(
    () => estimate("QLD-QCHEU", "LED", "2026-08-08", {
      eligible_dwellings: "2",
      eligible_cost_ex_gst_aud: "5000",
      primary_upgrade_included: "no",
    }),
    (error) => error instanceof CreditexLocalEstimateError
      && error.code === "LOCAL_ELIGIBILITY_NOT_CONFIRMED",
  );
});

test("Queensland current and grandfathered feed-in tariffs remain separate", () => {
  assertOutput(estimate("QLD-FIT", "REGIONAL", "2026-08-08", {
    eligible_export_kwh: "100",
  }), "6.006");
  assertOutput(estimate("QLD-FIT", "SBS-44C", "2026-08-08", {
    eligible_export_kwh: "100",
    legacy_eligibility_confirmed: "yes",
  }), "44");
  assert.throws(
    () => estimate("QLD-FIT", "SBS-44C", "2026-08-08", {
      eligible_export_kwh: "100",
      legacy_eligibility_confirmed: "no",
    }),
    (error) => error instanceof CreditexLocalEstimateError
      && error.code === "LOCAL_ELIGIBILITY_NOT_CONFIRMED",
  );
});

test("WA battery rebate uses usable capacity, service-area rate and 10 kWh cap", () => {
  assertOutput(estimate("WA-RBS", "SYNERGY-BATTERY", "2026-08-08", {
    usable_capacity_kwh: "7.5",
  }), "975");
  assertOutput(estimate("WA-RBS", "HORIZON-BATTERY", "2026-08-08", {
    usable_capacity_kwh: "20",
  }), "3800");
});

test("WA DEBS applies Synergy's bands and fails closed above the daily cap", () => {
  assertOutput(estimate("WA-DEBS", "BUYBACK", "2026-08-08", {
    service_area: "synergy",
    horizon_town: "Broome",
    peak_export_kwh: "5",
    off_peak_export_kwh: "15",
  }), "0.8");
  assert.throws(
    () => estimate("WA-DEBS", "BUYBACK", "2026-08-08", {
      service_area: "synergy",
      horizon_town: "Broome",
      peak_export_kwh: "25",
      off_peak_export_kwh: "30",
    }),
    (error) => error instanceof CreditexLocalEstimateError
      && error.code === "LOCAL_INTERVAL_ALLOCATION_REQUIRED",
  );
});

test("WA DEBS and Buyback Bonus resolve every Horizon town from the current table", () => {
  for (const town of Object.keys(HORIZON_POWER_TOWN_CLASSES)) {
    const result = estimate("WA-DEBS", "BUYBACK", "2026-08-08", {
      service_area: "horizon",
      horizon_town: town,
      peak_export_kwh: "1",
      off_peak_export_kwh: "1",
    });
    assert.equal(result.trace.length, 3);
  }
  assertOutput(estimate("WA-DEBS", "BUYBACK", "2026-08-08", {
    service_area: "horizon",
    horizon_town: "Broome",
    peak_export_kwh: "5",
    off_peak_export_kwh: "15",
  }), "0.95");
  assertOutput(estimate("WA-HORIZON-BUYBACK", "EXPORT", "2026-12-01", {
    horizon_town: "Broome",
    peak_export_kwh: "5",
    off_peak_export_kwh: "15",
  }), "2.113");
  assertOutput(estimate("WA-HORIZON-BUYBACK", "EXPORT", "2026-08-08", {
    horizon_town: "Broome",
    peak_export_kwh: "5",
    off_peak_export_kwh: "15",
  }), "0.95");
});

test("Synergy Battery Rewards caps one event at installed capacity", () => {
  assertOutput(estimate(
    "WA-BATTERY-REWARDS",
    "ACTIVATION-EVENT",
    "2026-08-08",
    {
      event_export_kwh: "12",
      installed_battery_capacity_kwh: "10",
    },
  ), "7");
});

test("Tasmanian audit grant and feed-in tariff use their current source-pinned caps and rates", () => {
  assertOutput(estimate("TAS-POWERSMART", "AUDIT", "2026-08-08", {
    eligible_cost_aud: "1500",
  }), "1000");
  assertOutput(estimate("TAS-FIT", "EXPORT", "2026-08-08", {
    eligible_export_kwh: "100",
  }), "9.276");
});

test("NT multi-dwelling and feed-in estimates preserve exact decimal arithmetic", () => {
  assertOutput(estimate("NT-SMD", "SHARED-PV", "2026-08-08", {
    eligible_dwellings: "10",
    eligible_cost_ex_gst_aud: "120000",
  }), "60000");
  assertOutput(estimate("NT-FIT", "EXPORT", "2026-08-08", {
    peak_export_kwh: "10",
    off_peak_export_kwh: "20",
  }), "3.732");
});

test("effective dates, unexpected inputs and numeric representations fail closed", () => {
  assert.throws(
    () => estimate("TAS-FIT", "EXPORT", "2025-08-08", {
      eligible_export_kwh: "100",
    }),
    (error) => error instanceof CreditexLocalEstimateError
      && error.code === "LOCAL_EFFECTIVE_DATE_UNSUPPORTED",
  );
  assert.throws(
    () => estimate("TAS-FIT", "EXPORT", "2026-08-08", {
      eligible_export_kwh: "100",
      invented_rate: "1",
    }),
    (error) => error instanceof CreditexLocalEstimateError
      && error.code === "LOCAL_ESTIMATE_INVALID",
  );
  assert.throws(
    () => estimate("TAS-FIT", "EXPORT", "2026-08-08", {
      eligible_export_kwh: "1e2",
    }),
    (error) => error instanceof CreditexLocalEstimateError
      && error.code === "LOCAL_INPUT_INVALID",
  );
});

test("identical source, input and output data produces the same receipt", () => {
  const request = {
    programCode: "NT-FIT",
    activityCode: "EXPORT",
    effectiveDate: "2026-08-08",
    inputs: {
      peak_export_kwh: "10.0",
      off_peak_export_kwh: "20.00",
    },
  };
  const first = estimateCreditexLocalProgram(request);
  const second = estimateCreditexLocalProgram(request);
  assert.equal(first.receiptHash, second.receiptHash);
  assert.equal(first.inputHash, second.inputHash);
  assert.equal(first.traceHash, second.traceHash);
});
