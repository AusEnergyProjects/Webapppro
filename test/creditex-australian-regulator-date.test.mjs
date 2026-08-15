import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  australianRegulatorDate,
  matchesAustralianRegulatorClock,
} from "../src/lib/creditex-australian-regulator-date.ts";

test("Australian registry observations use the Sydney regulator calendar day", () => {
  assert.equal(
    australianRegulatorDate("2026-08-08T20:45:00.000Z"),
    "2026-08-09",
  );
  assert.equal(
    australianRegulatorDate("2026-08-08T21:05:00.000Z"),
    "2026-08-09",
  );
  assert.equal(
    australianRegulatorDate(new Date("2026-01-08T20:45:00.000Z")),
    "2026-01-09",
  );
});

test("Australian registry observation dates reject invalid instants", () => {
  assert.throws(
    () => australianRegulatorDate("not-a-date"),
    /valid instant/,
  );
});

test("nightly registry candidates resolve once at Sydney midnight across DST", () => {
  const cases = [
    ["2026-01-08T13:05:00.000Z", 0, 5, true],
    ["2026-01-08T14:05:00.000Z", 0, 5, false],
    ["2026-07-08T13:05:00.000Z", 0, 5, false],
    ["2026-07-08T14:05:00.000Z", 0, 5, true],
    ["2026-04-04T13:05:00.000Z", 0, 5, true],
    ["2026-04-05T14:05:00.000Z", 0, 5, true],
    ["2026-10-03T14:05:00.000Z", 0, 5, true],
    ["2026-10-04T13:05:00.000Z", 0, 5, true],
    ["2026-01-08T13:25:00.000Z", 0, 25, true],
    ["2026-07-08T14:25:00.000Z", 0, 25, true],
    ["2026-01-08T20:25:00.000Z", 7, 25, true],
    ["2026-01-08T21:25:00.000Z", 7, 25, false],
    ["2026-07-08T20:25:00.000Z", 7, 25, false],
    ["2026-07-08T21:25:00.000Z", 7, 25, true],
  ];
  for (const [instant, hour, minute, expected] of cases) {
    assert.equal(
      matchesAustralianRegulatorClock(instant, hour, minute),
      expected,
      instant,
    );
  }
  assert.equal(matchesAustralianRegulatorClock("not-a-date", 0, 5), false);
  assert.equal(matchesAustralianRegulatorClock(Date.now(), 24, 0), false);
});

test("the Worker runs one durable registry maintenance target on the minute schedule", () => {
  const worker = fs.readFileSync(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(worker, /NOTIFICATION_DELIVERY_CRON = "\* \* \* \* \*"/);
  assert.match(worker, /controller\.cron === NOTIFICATION_DELIVERY_CRON/);
  assert.match(worker, /drainCreditexProductRegistryMaintenance\(/);
  assert.match(worker, /creditexAutomaticProductRegistryMaintenanceTargets\(/);
  assert.doesNotMatch(worker, /SRES_REGISTRY_CRON/);
  assert.doesNotMatch(worker, /OFFICIAL_PRODUCT_REGISTRY_CRON/);
  assert.doesNotMatch(worker, /VEU_PRODUCT_REGISTRY_CRON/);
  assert.doesNotMatch(worker, /matchesAustralianRegulatorClock/);
});
