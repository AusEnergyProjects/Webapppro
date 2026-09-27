import test from "node:test";
import assert from "node:assert/strict";
import { mapQuoteMeasurement, mapQuoteLine, mapQuoteKind, mapQuoteUnitMatches, canApplyMapQuoteIntent, isMapQuoteJob } from "../src/lib/trade-map-quote.ts";
import { normaliseTradeQuoteLineGroup, tradeQuoteLineValidationIssues } from "../src/lib/trade-quote.ts";

test("map quantities keep useful precision and reject unusable measurements", () => {
  assert.deepEqual(mapQuoteMeasurement("area", 162.543), { kind: "area", quantity: 162.5 });
  assert.deepEqual(mapQuoteMeasurement("distance", 1.723), { kind: "distance", quantity: 1.72 });
  assert.deepEqual(mapQuoteMeasurement("solar", 18), { kind: "solar", quantity: 18 });
  for (const kind of ["area", "distance", "solar"]) {
    for (const value of [NaN, Infinity, -1, 0, 1_000_000]) assert.equal(mapQuoteMeasurement(kind, value), null);
  }
  assert.equal(mapQuoteMeasurement("solar", 1.5), null);
  assert.equal(mapQuoteMeasurement("area", 0.001), null);
  assert.equal(mapQuoteMeasurement("unknown", 10), null);
});

test("map line requires deliberate pricing and uses the ordinary quote totals", () => {
  const line = mapQuoteLine({ kind: "area", quantity: 162.5 });
  assert.equal(line.unitPrice, "");
  assert.equal(mapQuoteKind(line.sectionHeading), "area");
  assert.equal(tradeQuoteLineValidationIssues([line], String, false)[0].field, "unitPrice");
  const totals = normaliseTradeQuoteLineGroup([{ ...line, unitPrice: "20.00" }], String);
  assert.equal(totals.subtotalCents, 325000);
  assert.equal(totals.taxCents, 32500);
  assert.equal(totals.totalCents, 357500);
  assert.equal(mapQuoteLine({ kind: "solar", quantity: 18 }).quantity, "1");
  assert.equal(mapQuoteKind("Included work"), null);
  assert.throws(() => mapQuoteLine({ kind: "distance", quantity: 0 }));
});

test("solar design count is separate from its single system price", () => {
  const line = mapQuoteLine({ kind: "solar", quantity: 12 });
  assert.equal(line.sectionHeading, "Solar system (12 panels)");
  assert.equal(mapQuoteKind(line.sectionHeading), "solar");
  assert.equal(mapQuoteKind("Map concept: solar panels"), "solar");
  assert.equal(mapQuoteLine({ kind: "solar", quantity: 1 }).sectionHeading, "Solar system (1 panel)");
  const totals = normaliseTradeQuoteLineGroup([{ ...line, unitPrice: "5000.00" }], String);
  assert.equal(totals.subtotalCents, 500000);
  assert.equal(totals.taxCents, 50000);
  assert.equal(totals.totalCents, 550000);
  for (const unit of ["system", "job", "per system"]) assert.equal(mapQuoteUnitMatches("solar", unit, line.sectionHeading), true);
  for (const unit of ["panel", "each", "ea", "kW", "pack"]) assert.equal(mapQuoteUnitMatches("solar", unit, line.sectionHeading), false);
});

test("map import is bound to the chosen account, job and once-only intent", () => {
  const intent = { id: "once-1", ownerUid: "account-1", workOrderId: "job-1", measurement: { kind: "solar", quantity: 18 } };
  const context = { ownerUid: "account-1", workOrderId: "job-1", canManage: true, consumedId: "" };
  assert.equal(canApplyMapQuoteIntent(intent, context), true);
  for (const change of [{ ownerUid: "account-2" }, { workOrderId: "job-2" }, { canManage: false }, { consumedId: "once-1" }]) {
    assert.equal(canApplyMapQuoteIntent(intent, { ...context, ...change }), false);
  }
  assert.equal(canApplyMapQuoteIntent({ ...intent, measurement: { kind: "solar", quantity: 1.1 } }, context), false);
});

test("price-book units cannot turn a pack price into a square metre or metre rate", () => {
  for (const unit of ["m²", "M2", "sqm", "per square metre"]) assert.equal(mapQuoteUnitMatches("area", unit), true);
  for (const unit of ["pack", "roll", "ea", "m", "job"]) assert.equal(mapQuoteUnitMatches("area", unit), false);
  for (const unit of ["m", "metres", "per linear metre"]) assert.equal(mapQuoteUnitMatches("distance", unit), true);
  for (const unit of ["each", "panel", "ea"]) assert.equal(mapQuoteUnitMatches("solar", unit), true);
  assert.equal(mapQuoteUnitMatches("solar", "kW"), false);
});

test("quote picker accepts only owner-released, linked and quotable job records", () => {
  const job = { id: "job-1", workNumber: "TLJ-1", title: "Roof", customerDisplayName: "Customer", customerSource: "trade_owned", sourceType: "direct",
    crmCustomerId: "customer-1", serviceSiteId: "site-1", quoteStatus: "not_started", jobRegister: { streetAddress: "1 Example Road", suburb: "Melbourne", state: "VIC", postcode: "3000" } };
  assert.equal(isMapQuoteJob(job), true);
  assert.equal(isMapQuoteJob({ ...job, customerSource: "public_lead_released", sourceType: "public_lead" }), true);
  for (const change of [{ customerSource: "platform_private" }, { sourceType: "opportunity" }, { crmCustomerId: "" }, { serviceSiteId: "" }, { quoteStatus: "restricted" }, { jobRegister: null }]) {
    assert.equal(isMapQuoteJob({ ...job, ...change }), false);
  }
  for (const value of [null, undefined, 123, {}, "job-1"]) assert.equal(isMapQuoteJob(value), false);
});
