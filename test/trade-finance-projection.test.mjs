import test from "node:test";
import assert from "node:assert/strict";
import { revenueProjection, revenueProjectionCsvRows } from "../src/lib/trade-finance-projection.ts";
import { resolveReportPeriod } from "../src/lib/trade-business-reports.ts";

function report(overrides = {}) {
  return {
    period: { start: "2026-09-01", end: "2026-09-20", today: "2026-09-20" },
    permissions: { invoices: true },
    current: { invoicedCents: 200000, creditCents: 20000, invoiceCount: 5 },
    ...overrides,
  };
}

test("a current month uses elapsed inclusive days and projects the next 30, 60 and 90 days", () => {
  const period = resolveReportPeriod(new URLSearchParams({ period: "monthly" }), "VIC", new Date("2026-09-20T03:00:00Z"));
  const result = revenueProjection(report({ period }));
  assert.equal(result.available, true);
  assert.equal(result.elapsedDays, 20);
  assert.equal(result.sourceStart, "2026-09-01");
  assert.equal(result.sourceEnd, "2026-09-20");
  assert.equal(result.dailyInvoicedCents, 10000);
  assert.equal(result.startsOn, "2026-09-21");
  assert.deepEqual(result.estimates, [
    { days: 30, endsOn: "2026-10-20", cents: 300000 },
    { days: 60, endsOn: "2026-11-19", cents: 600000 },
    { days: 90, endsOn: "2026-12-19", cents: 900000 },
  ]);
});

test("net invoicing already includes credits and unpaid balances do not increase the projection", () => {
  const input = report({ receivables: { outstandingCents: 900000000, paidCents: 400000000 } });
  const result = revenueProjection(input);
  assert.equal(result.netInvoicedCents, 200000);
  assert.equal(result.estimates[0].cents, 300000);
  assert.deepEqual(result, revenueProjection(report()));
});

test("past periods retain their selected basis while future projections begin tomorrow", () => {
  const result = revenueProjection(report({ period: { start: "2026-08-01", end: "2026-08-31", today: "2026-09-20" } }));
  assert.equal(result.elapsedDays, 31);
  assert.equal(result.estimates[0].cents, 193548);
  assert.equal(result.startsOn, "2026-09-21");
});

test("leap days, year boundaries and one-day periods count complete calendar days", () => {
  const leap = revenueProjection(report({ period: { start: "2024-02-01", end: "2024-02-29", today: "2024-02-29" } }));
  assert.equal(leap.elapsedDays, 29);
  assert.equal(leap.estimates[0].endsOn, "2024-03-30");
  const single = revenueProjection(report({ period: { start: "2026-12-31", end: "2026-12-31", today: "2026-12-31" } }));
  assert.equal(single.elapsedDays, 1);
  assert.equal(single.startsOn, "2027-01-01");
  assert.equal(single.estimates[2].endsOn, "2027-03-31");
});

test("credits-only and fully credited periods retain their real negative or zero pace", () => {
  const negative = revenueProjection(report({ current: { invoicedCents: -20000, creditCents: 20000, invoiceCount: 0 } }));
  assert.equal(negative.available, true);
  assert.equal(negative.estimates[0].cents, -30000);
  const zero = revenueProjection(report({ current: { invoicedCents: 0, creditCents: 20000, invoiceCount: 1 } }));
  assert.equal(zero.available, true);
  assert.equal(zero.estimates[0].cents, 0);
});

test("no activity, incomplete monetary data and absent invoice permission produce no estimates", () => {
  for (const current of [
    { invoicedCents: 0, creditCents: 0, invoiceCount: 0 },
    { invoicedCents: null, creditCents: null, invoiceCount: null },
    { invoicedCents: Infinity, creditCents: 0, invoiceCount: 1 },
    { invoicedCents: 5000, creditCents: -10, invoiceCount: 1 },
  ]) {
    const result = revenueProjection(report({ current }));
    assert.equal(result.available, false);
    assert.equal(result.estimates, undefined);
  }
  const denied = report({ permissions: { invoices: false } });
  assert.equal(revenueProjection(denied).reason, "no_access");
  assert.deepEqual(revenueProjectionCsvRows(denied), []);
});

test("invalid and future source dates cannot turn incomplete history into a forecast", () => {
  for (const period of [
    { start: "2026-02-30", end: "2026-09-20", today: "2026-09-20" },
    { start: "2026-09-21", end: "2026-09-20", today: "2026-09-20" },
    { start: "2026-09-01", end: "2026-09-30", today: "2026-09-20" },
    { start: "2026-10-01", end: "2026-10-31", today: "2026-09-20" },
    { start: "2026-09-01", end: "2026-09-20", today: "invalid" },
  ]) assert.equal(revenueProjection(report({ period })).reason, "invalid_period");
});

test("exports include the selected basis, estimates, and limitations without unpaid balances", () => {
  const rows = revenueProjectionCsvRows(report());
  assert.equal(rows.find(row => row.metric === "Elapsed calendar days").value, 20);
  assert.equal(rows.find(row => row.metric === "Source net invoicing").value, "2000.00");
  const estimates = rows.filter(row => row.metric.startsWith("Next "));
  assert.deepEqual(estimates.map(row => row.value), ["3000.00", "6000.00", "9000.00"]);
  assert.ok(estimates.every(row => row.basis.includes("not cash receipts, profit or guaranteed revenue")));
});
