import test from "node:test";
import assert from "node:assert/strict";
import { mapQuoteCoverageQuantity, mapQuoteApplyCoverage, mapQuoteMeasuredContext, mapQuoteLine, mapQuoteKind, mapQuoteUnitMatches } from "../src/lib/trade-map-quote.ts";
import { normalisePriceBookInput, priceBookCoverageMilli } from "../src/lib/trade-price-book.ts";
import { normaliseTradeQuoteLineGroup } from "../src/lib/trade-quote.ts";

const clean = (value, length) => String(value ?? "").trim().slice(0, length);
const product = { name: "Insulation", itemType: "material", unitLabel: "roll", supplierCost: "65", sellPrice: "95", taxCode: "gst" };

test("pack coverage is explicitly optional and restricted to physical stock units", () => {
  assert.equal(Object.hasOwn(normalisePriceBookInput(product, clean), "coverageM2PerUnitMilli"), false);
  assert.equal(normalisePriceBookInput({ ...product, category: "Insulation" }, clean).coverageM2PerUnitMilli, undefined);
  assert.equal(normalisePriceBookInput({ ...product, coverageM2PerUnit: "20.125" }, clean).coverageM2PerUnitMilli, 20125);
  assert.equal(normalisePriceBookInput({ ...product, coverageM2PerUnit: null }, clean).coverageM2PerUnitMilli, null);
  for (const unitLabel of ["roll", "pack", "bag", "each"]) assert.equal(normalisePriceBookInput({ ...product, unitLabel, coverageM2PerUnit: 20 }, clean).coverageM2PerUnitMilli, 20000);
  for (const value of [0, -1, 1000000, 0.0001, NaN, Infinity, "20sqm", true, {}, []]) assert.throws(() => priceBookCoverageMilli(value), /INVALID_PRICE_BOOK_COVERAGE/);
  for (const change of [{ itemType: "labour" }, { itemType: "call_out" }, { unitLabel: "square_metre" }, { unitLabel: "metre" }, { unitLabel: "hour" }, { solarPanel: { watts: 440, widthM: 1.134, lengthM: 1.762 } }]) {
    assert.throws(() => normalisePriceBookInput({ ...product, coverageM2PerUnit: 20, ...change }, clean), /INVALID_PRICE_BOOK_COVERAGE_UNIT/);
  }
});

test("coverage rounds whole packs up, including exact decimal and waste boundaries", () => {
  assert.equal(mapQuoteCoverageQuantity(229.5, 20), 12);
  assert.equal(mapQuoteCoverageQuantity(229.5, 20, 10), 13);
  assert.equal(mapQuoteCoverageQuantity(240, 20), 12);
  assert.equal(mapQuoteCoverageQuantity(240.001, 20), 13);
  assert.equal(mapQuoteCoverageQuantity(0.3, 0.1), 3, "floating point errors must not add an extra pack");
  assert.equal(mapQuoteCoverageQuantity(1, 0.01, 0.01), 101);
  assert.equal(mapQuoteCoverageQuantity(10, 20, 100), 1);
  for (const waste of [-1, 100.01, NaN, Infinity, 0.001]) assert.throws(() => mapQuoteCoverageQuantity(229.5, 20, waste));
  assert.throws(() => mapQuoteCoverageQuantity(999999, 0.001), /too many packs/);
});

test("manual billable quantity and saved waste retain the original customer measurement", () => {
  const measured = mapQuoteLine({ kind: "area", quantity: 229.5 });
  const calculated = mapQuoteApplyCoverage(measured, 20, 10);
  assert.equal(calculated.quantity, "13");
  assert.equal(mapQuoteKind(calculated.sectionHeading), "area");
  assert.equal(mapQuoteUnitMatches("area", "roll", calculated.sectionHeading), true);
  assert.deepEqual(mapQuoteMeasuredContext(calculated.sectionHeading), { kind: "area", quantity: 229.5, itemPricing: true, wastePercent: 10 });
  const manuallyAdjusted = { ...calculated, quantity: "14", unitPrice: "95" };
  const totals = normaliseTradeQuoteLineGroup([manuallyAdjusted], clean);
  assert.equal(totals.subtotalCents, 133000);
  assert.equal(totals.lines[0].quantityMilli, 14000, "billing and stock use the chosen whole unit count");
  assert.equal(mapQuoteMeasuredContext(manuallyAdjusted.sectionHeading).quantity, 229.5);
  assert.equal(mapQuoteApplyCoverage(manuallyAdjusted, 20, 0).quantity, "12", "recalculate is deliberate");
  assert.equal(measured.quantity, "229.5");
  assert.throws(() => mapQuoteApplyCoverage(mapQuoteLine({ kind: "distance", quantity: 10 }), 20));
  assert.equal(mapQuoteMeasuredContext("Map estimate: roof area 229.5 m² (priced by item; waste 101%)"), null);
});
