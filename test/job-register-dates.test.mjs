import assert from "node:assert/strict";
import test from "node:test";
import { jobCreationDate, jobCreationDayStart } from "../src/lib/job-register-dates.ts";

test("created dates and Australian day boundaries agree across UTC midnight", () => {
  assert.equal(jobCreationDate("2026-09-20T14:30:00Z"), "21 Sept 2026");
  assert.equal(jobCreationDayStart("2026-09-21"), "2026-09-20T14:00:00.000Z");
  assert.equal(jobCreationDayStart("2026-09-21", true), "2026-09-21T14:00:00.000Z");
  assert.equal(jobCreationDate(""), "Not recorded");
  assert.equal(jobCreationDate("invalid"), "Not recorded");
});

test("created-date ranges include the full 23-hour and 25-hour daylight-saving days", () => {
  for (const [day, hours] of [["2026-10-04", 23], ["2026-04-05", 25]]) {
    assert.equal((Date.parse(jobCreationDayStart(day, true)) - Date.parse(jobCreationDayStart(day))) / 3_600_000, hours);
  }
  assert.throws(() => jobCreationDayStart("2026-02-30"), /valid creation date/);
  assert.throws(() => jobCreationDayStart("not a date"), /valid creation date/);
});
