import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildQuoteInvoiceTemplate } from "../src/lib/trade-quote-invoice-template.ts";

const source = {
  quoteId: "quote-1",
  quoteVersionId: "version-3",
  quoteNumber: "Q-TLJ-123",
  versionNumber: 3,
  status: "issued",
  terms: "  Payment due on completion.  ",
};

const item = (overrides = {}) => ({
  position: 1,
  quoteChoiceId: "",
  description: "Hot-water heat pump",
  quantityMilli: 1000,
  taxCode: "gst",
  subtotalCents: 20_000,
  taxCents: 2_000,
  totalCents: 22_000,
  ...overrides,
});

test("latest quote defaults become an exact quick-invoice template", () => {
  const result = buildQuoteInvoiceTemplate(source, [
    item({ quantityMilli: 2000 }),
    item({ position: 2, description: "Quote discount", subtotalCents: -1_000, taxCents: -100, totalCents: -1_100 }),
    item({ position: 3, quoteChoiceId: "choice-basic", description: "Basic tank", subtotalCents: 4_000, taxCents: 400, totalCents: 4_400 }),
    item({ position: 4, quoteChoiceId: "choice-best", description: "Recommended tank", subtotalCents: 5_000, taxCents: 500, totalCents: 5_500 }),
    item({ position: 5, quoteChoiceId: "addon-1", description: "Optional monitoring", subtotalCents: 1_000, taxCents: 100, totalCents: 1_100 }),
  ], [
    { id: "choice-basic", position: 1, kind: "choose_one", groupKey: "tank", recommended: false },
    { id: "choice-best", position: 2, kind: "choose_one", groupKey: "tank", recommended: true },
    { id: "addon-1", position: 3, kind: "addon", groupKey: "addon-1", recommended: true },
  ]);

  assert.ok(result);
  assert.equal(result.quoteVersionId, "version-3");
  assert.equal(result.terms, "Payment due on completion.");
  assert.equal(result.discountCents, 1_000);
  assert.equal(result.totalCents, 26_400);
  assert.deepEqual(result.lines, [
    { description: "Hot-water heat pump (2 quoted)", unitPriceCentsExGst: 20_000, taxCode: "gst", priceBookItemId: "" },
    { description: "Recommended tank", unitPriceCentsExGst: 5_000, taxCode: "gst", priceBookItemId: "" },
  ]);
});

test("large quote line sets compact without changing the quoted total", () => {
  const items = Array.from({ length: 9 }, (_, index) => item({
    position: index + 1,
    description: `Quoted item ${index + 1}`,
    subtotalCents: 1_000,
    taxCents: 100,
    totalCents: 1_100,
  }));
  const result = buildQuoteInvoiceTemplate(source, items, []);
  assert.ok(result);
  assert.deepEqual(result.lines, [
    { description: "Q-TLJ-123 quoted work", unitPriceCentsExGst: 9_000, taxCode: "gst", priceBookItemId: "" },
  ]);
  assert.equal(result.totalCents, 9_900);
});

test("conversion refuses to silently change a mixed-tax quoted total", () => {
  const result = buildQuoteInvoiceTemplate(source, [
    item({ subtotalCents: 100, taxCents: 10, totalCents: 110 }),
    item({ position: 2, taxCode: "none", subtotalCents: 100, taxCents: 0, totalCents: 100 }),
    item({ position: 3, description: "Taxable discount", subtotalCents: -5, taxCents: -1, totalCents: -6 }),
  ], []);
  assert.equal(result, null);
});

test("invoice API and mobile editor prefer the current quote without allowing duplicates", () => {
  const route = fs.readFileSync(new URL("../src/app/api/trade-quick-invoices/route.ts", import.meta.url), "utf8");
  const mobile = fs.readFileSync(new URL("../mobile/src/components/field-commercial-workspace.tsx", import.meta.url), "utf8");
  assert.match(route, /version\.version_number = quote\.current_version_number/);
  assert.match(route, /const quoteTemplate = row \|\| acceptedRow[\s\S]*\? null/);
  assert.match(route, /action === "create_draft" \|\| action === "create_from_quote"/);
  assert.match(route, /if \(await acceptedInvoiceRow\(access\.ownerUid, workOrderId\)\)/);
  assert.match(route, /if \(await invoiceRow\(access\.ownerUid, "work_order_id", workOrderId\)\)/);
  assert.match(route, /quoteVersionId[\s\S]*QUOTE_INVOICE_SOURCE_CHANGED/);
  assert.match(mobile, /Using latest quote/);
  assert.match(mobile, /Start a blank invoice instead/);
  assert.match(mobile, /action: invoice \? 'correct_draft' : createFromQuote \? 'create_from_quote' : 'create_draft'/);
});
