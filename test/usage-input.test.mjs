import test from "node:test";
import assert from "node:assert/strict";
import {
  annualiseElectricityUsage,
  annualiseUsage,
  electricityReferenceMonthShares,
  usageForPeriod,
} from "../src/lib/electricity/usage-input.ts";

test("bill usage periods convert to the same canonical annual kWh", () => {
  assert.equal(annualiseUsage(1250, "quarterly"), 5000);
  assert.equal(annualiseUsage(5000 / 12, "monthly"), 5000);
  assert.equal(annualiseUsage(5000, "annual"), 5000);
});

test("canonical annual kWh is displayed in the selected bill period", () => {
  assert.equal(usageForPeriod("5000", "quarterly"), "1250");
  assert.equal(usageForPeriod("5000", "monthly"), "416.67");
  assert.equal(usageForPeriod("5000", "annual"), "5000");
  assert.equal(usageForPeriod("", "quarterly"), "");
});

test("annual electricity evidence is retained without seasonal adjustment", () => {
  assert.deepEqual(annualiseElectricityUsage({ usageKwh: 5000, mode: "annual" }), {
    ok: true, annualKwh: 5000, billDays: null, profileShare: 1, profileAreas: [], source: "annual",
  });
});

test("dated bill usage uses a bounded distributor seasonal profile", () => {
  const summer = annualiseElectricityUsage({ usageKwh: 1000, mode: "bill", billStart: "2025-01-01", billEnd: "2025-01-31", distributor: "Energex", postcode: "4000" });
  const winter = annualiseElectricityUsage({ usageKwh: 1000, mode: "bill", billStart: "2025-07-01", billEnd: "2025-07-31", distributor: "Ausgrid", postcode: "2000" });
  assert.equal(summer.ok, true);
  assert.equal(winter.ok, true);
  if (summer.ok && winter.ok) {
    assert.equal(summer.billDays, 31);
    assert.equal(summer.profileAreas[0], "ENERGEX");
    assert.equal(winter.profileAreas[0], "ENERGYAUST");
    assert.ok(summer.annualKwh > 0);
    assert.ok(winter.annualKwh > 0);
  }
});

test("reference profiles stay normalized and bounded against volatile residual load", () => {
  for (const distributor of ["CitiPower", "Ausgrid", "Energex", "TasNetworks"]) {
    const { shares } = electricityReferenceMonthShares(distributor, "3000");
    assert.ok(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 1) < 1e-10);
    shares.forEach((share, month) => {
      const calendar = new Date(Date.UTC(2025, month + 1, 0)).getUTCDate() / 365;
      assert.ok(share >= calendar * 0.85);
      assert.ok(share <= calendar * 1.22);
    });
  }
});

test("invalid electricity bill periods are rejected", () => {
  assert.equal(annualiseElectricityUsage({ usageKwh: 1000, mode: "bill", billStart: "2025-03-14", billEnd: "2025-03-07" }).ok, false);
  assert.equal(annualiseElectricityUsage({ usageKwh: 1000, mode: "bill", billStart: "2025-03-01", billEnd: "2025-03-05" }).ok, false);
});
