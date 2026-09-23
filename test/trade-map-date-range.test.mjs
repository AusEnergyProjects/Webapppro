import test from "node:test";
import assert from "node:assert/strict";
import { defaultTradeMapDateRange } from "../src/lib/trade-map-date-range.ts";

test("map defaults include the past seven days and the coming calendar month", () => {
  assert.deepEqual(defaultTradeMapDateRange(new Date(2026, 8, 23, 0, 5)), { from: "2026-09-16", to: "2026-10-23" });
  assert.deepEqual(defaultTradeMapDateRange(new Date(2026, 8, 23, 23, 55)), { from: "2026-09-16", to: "2026-10-23" });
});

test("month ends clamp to the next month's last day including leap years", () => {
  assert.deepEqual(defaultTradeMapDateRange(new Date(2026, 0, 31)), { from: "2026-01-24", to: "2026-02-28" });
  assert.deepEqual(defaultTradeMapDateRange(new Date(2028, 0, 31)), { from: "2028-01-24", to: "2028-02-29" });
});

test("date windows cross calendar years without rolling the end into an extra month", () => {
  assert.deepEqual(defaultTradeMapDateRange(new Date(2026, 11, 31)), { from: "2026-12-24", to: "2027-01-31" });
  assert.deepEqual(defaultTradeMapDateRange(new Date(2027, 0, 3)), { from: "2026-12-27", to: "2027-02-03" });
});
