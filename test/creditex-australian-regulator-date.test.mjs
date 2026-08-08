import assert from "node:assert/strict";
import test from "node:test";
import { australianRegulatorDate } from "../src/lib/creditex-australian-regulator-date.ts";

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
