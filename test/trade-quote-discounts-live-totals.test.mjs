import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  consolidateTradeQuotePercentDiscountLines,
  normaliseTradeQuoteLineGroup,
  moveTradeQuoteLine,
  overallTradeQuoteDiscountKind,
  OVERALL_FIXED_DISCOUNT_SECTION,
  OVERALL_PERCENT_DISCOUNT_SECTION,
  percentInputToQuantity,
  persistedOverallDiscountUnitPrice,
  quantityToPercentInput,
  tradeQuoteChoiceValidationIssue,
  tradeQuoteLineValidationIssues,
} from "../src/lib/trade-quote.ts";

const clean = (value) => String(value || "").trim().slice(0, 500);
const ui = fs.readFileSync(new URL("../src/components/TradeQuotePanel.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const pdf = fs.readFileSync(new URL("../src/lib/trade-quote-pdf.mjs", import.meta.url), "utf8");
const email = fs.readFileSync(new URL("../src/lib/trade-quote-email.ts", import.meta.url), "utf8");

const product = (unitPrice = "1000.00", taxCode = "gst") => ({
  lineType: "product",
  description: "Installed system",
  quantity: "1",
  unitPrice,
  taxCode,
  sectionHeading: "Included work",
});
const choice = (clientKey, kind, groupKey, name = "Option") => ({
  clientKey,
  kind,
  groupKey,
  name,
  summary: "",
  recommended: false,
  lines: [product()],
});

test("percentage discount is recalculated from positive scope and ignores client price", () => {
  const lines = [product(), {
    lineType: "adjustment",
    description: "25 percent off, Xmas sale",
    quantity: "0.25",
    unitPrice: "-999999.99",
    taxCode: "none",
    sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION,
  }];
  const quote = normaliseTradeQuoteLineGroup(lines, clean);
  assert.deepEqual({ subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents }, {
    subtotalCents: 75_000,
    taxCents: 7_500,
    totalCents: 82_500,
  });
  assert.deepEqual(quote.lines[1], {
    lineType: "adjustment",
    description: "25 percent off, Xmas sale",
    quantityMilli: 250,
    unitPriceCents: -100_000,
    taxCode: "gst",
    subtotalCents: -25_000,
    taxCents: -2_500,
    totalCents: -27_500,
  });
});

test("percentage input preserves blank and decimal editing intermediates", () => {
  for (const value of ["", "1", "12.", "12.5", "12.50"]) {
    const quantity = percentInputToQuantity(value);
    assert.notEqual(quantity, null);
    assert.equal(quantityToPercentInput(quantity), value);
  }
  const quote = normaliseTradeQuoteLineGroup([product(), {
    lineType: "adjustment", description: "Mid-season offer", quantity: percentInputToQuantity("12.5"),
    unitPrice: "0", taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION,
  }], clean);
  assert.equal(quote.totalCents, 96_250);
});

test("fixed discount input preserves decimal editing intermediates", () => {
  assert.match(ui, /line\.unitPrice\.startsWith\("-"\) \? line\.unitPrice\.slice\(1\) : line\.unitPrice/);
  assert.doesNotMatch(ui, /String\(Math\.abs\(Number\(line\.unitPrice\)\) \|\| ""\)/);
});

test("fixed discount is exact including GST and allocates GST proportionally", () => {
  const quote = normaliseTradeQuoteLineGroup([product(), {
    lineType: "adjustment",
    description: "STC x 10, $400 off",
    quantity: "1",
    unitPrice: "400.00",
    taxCode: "none",
    sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION,
  }], clean);
  assert.deepEqual({ subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents }, {
    subtotalCents: 63_636,
    taxCents: 6_364,
    totalCents: 70_000,
  });
  assert.equal(quote.lines[1].totalCents, -40_000);
  assert.equal(quote.lines[1].subtotalCents + quote.lines[1].taxCents, -40_000);
});

test("fixed discount supports mixed GST without trusting a submitted tax choice", () => {
  const quote = normaliseTradeQuoteLineGroup([product("100.00", "gst"), product("100.00", "none"), {
    lineType: "adjustment",
    description: "$21 off refer a friend",
    quantity: "1",
    unitPrice: "21.00",
    taxCode: "none",
    sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION,
  }], clean);
  assert.deepEqual({ subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents }, {
    subtotalCents: 18_000,
    taxCents: 900,
    totalCents: 18_900,
  });
});

test("fixed discount save reload resave keeps the entered incl GST amount", () => {
  const original = normaliseTradeQuoteLineGroup([product(), {
    lineType: "adjustment", description: "STC x 10, $400 off", quantity: "1", unitPrice: "400.00",
    taxCode: "gst", sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION,
  }], clean);
  const saved = original.lines[1];
  assert.equal(saved.unitPriceCents, -36_364);
  assert.equal(saved.totalCents, -40_000);
  assert.equal(persistedOverallDiscountUnitPrice({ ...saved, sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION }), "400.00");
  const reloaded = normaliseTradeQuoteLineGroup([product(), {
    lineType: saved.lineType, description: saved.description, quantity: "1",
    unitPrice: persistedOverallDiscountUnitPrice({ ...saved, sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION }),
    taxCode: saved.taxCode, sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION,
  }], clean);
  assert.equal(reloaded.lines[1].totalCents, -40_000);
  assert.equal(reloaded.totalCents, original.totalCents);
});

test("fixed discount rows apply before the one final percentage without reducing below zero", () => {
  const percent = { lineType: "adjustment", description: "Sale", quantity: "0.25", unitPrice: "0", taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION };
  const fixed = { lineType: "adjustment", description: "Referral", quantity: "1", unitPrice: "50", taxCode: "gst", sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION };
  const stacked = normaliseTradeQuoteLineGroup([product(), fixed, percent], clean);
  assert.deepEqual(stacked.lines.map((line) => line.description), ["Installed system", "Referral", "Sale"]);
  assert.deepEqual(
    { subtotalCents: stacked.subtotalCents, taxCents: stacked.taxCents, totalCents: stacked.totalCents },
    { subtotalCents: 71_591, taxCents: 7_159, totalCents: 78_750 },
  );
  const certificates = normaliseTradeQuoteLineGroup([product(),
    { ...fixed, description: "STC x 10", unitPrice: "400" },
    { ...fixed, description: "VEEC x 5", unitPrice: "250" },
  ], clean);
  assert.deepEqual(certificates.lines.slice(1).map((line) => [line.description, line.totalCents]), [
    ["STC x 10", -40_000],
    ["VEEC x 5", -25_000],
  ]);
  assert.equal(certificates.totalCents, 45_000);
  assert.throws(() => normaliseTradeQuoteLineGroup([product("100", "none"), { ...fixed, unitPrice: "100.01" }], clean), /INVALID_TOTAL/);
  assert.throws(() => normaliseTradeQuoteLineGroup([product("100", "none"),
    { ...fixed, description: "STC", unitPrice: "60" },
    { ...fixed, description: "VEEC", unitPrice: "41" },
  ], clean), /INVALID_TOTAL/);
  assert.throws(() => normaliseTradeQuoteLineGroup([product("100"), { ...percent, quantity: "1" }], clean), /INVALID_TOTAL/);
  const free = normaliseTradeQuoteLineGroup([product("100", "none"), { ...fixed, unitPrice: "100" }], clean);
  assert.equal(free.totalCents, 0);
});

test("screenshot STC line reduces the net basis before the final 10 percent discount", () => {
  const quote = normaliseTradeQuoteLineGroup([
    { ...product("200"), quantity: "6", description: "Call-out" },
    { ...product("-38"), lineType: "adjustment", quantity: "30", description: "STC" },
    { lineType: "adjustment", description: "Final sale", quantity: "percent:10", unitPrice: "0",
      taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION },
  ], clean);
  assert.deepEqual(
    { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents },
    { subtotalCents: 5_400, taxCents: 540, totalCents: 5_940 },
  );
  assert.deepEqual(
    { subtotalCents: quote.lines[2].subtotalCents, taxCents: quote.lines[2].taxCents, totalCents: quote.lines[2].totalCents },
    { subtotalCents: -600, taxCents: -60, totalCents: -660 },
  );
});

test("final percentage uses one rounded incl GST amount and preserves cent parity", () => {
  const percent = { lineType: "adjustment", description: "Final", quantity: "percent:50", unitPrice: "0",
    taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION };
  const edge = normaliseTradeQuoteLineGroup([product("0.05", "gst"), percent], clean);
  assert.equal(edge.lines[1].totalCents, -3);
  assert.equal(edge.lines[1].subtotalCents + edge.lines[1].taxCents, -3);
  assert.equal(edge.totalCents, 3);

  const fixedCent = { lineType: "adjustment", description: "Fixed cent", quantity: "1", unitPrice: "0.01",
    taxCode: "gst", sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION };
  const mixed = normaliseTradeQuoteLineGroup([
    product("0.05", "gst"), product("0.05", "none"), fixedCent, { ...fixedCent, description: "Second cent" }, percent,
  ], clean);
  assert.equal(mixed.lines[4].totalCents, -5);
  assert.equal(mixed.lines[4].subtotalCents + mixed.lines[4].taxCents, -5);
  assert.equal(mixed.totalCents, 4);
});

test("many one-cent fixed discounts allocate cumulatively without making subtotal or GST negative", () => {
  const fixedCents = Array.from({ length: 6 }, (_, index) => ({
    lineType: "adjustment", description: `Fixed cent ${index + 1}`, quantity: "1", unitPrice: "0.01",
    taxCode: "gst", sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION,
  }));
  const quote = normaliseTradeQuoteLineGroup([product("0.05", "gst"), ...fixedCents], clean);
  assert.deepEqual(
    { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents },
    { subtotalCents: 0, taxCents: 0, totalCents: 0 },
  );
  assert.equal(quote.lines.slice(1).reduce((sum, line) => sum + line.totalCents, 0), -6);
  assert.equal(quote.lines.slice(1).reduce((sum, line) => sum + line.subtotalCents, 0), -5);
  assert.equal(quote.lines.slice(1).reduce((sum, line) => sum + line.taxCents, 0), -1);
  assert.ok(quote.lines.every((line) => line.subtotalCents + line.taxCents === line.totalCents));
});

test("legacy multiple percentage rows consolidate deterministically then resave as one final row", () => {
  const legacy = [product(),
    { lineType: "adjustment", description: "Winter", quantityMilli: 100, quantity: "0.1", unitPrice: "0", taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION },
    { lineType: "adjustment", description: "Loyalty", quantityMilli: 150, quantity: "0.15", unitPrice: "0", taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION },
  ];
  const consolidated = consolidateTradeQuotePercentDiscountLines(legacy);
  assert.equal(consolidated.length, 2);
  assert.equal(consolidated.at(-1).quantity, "percent:25");
  assert.equal(consolidated.at(-1).quantityMilli, 250);
  assert.equal(consolidated.at(-1).description, "Winter + Loyalty");
  const saved = normaliseTradeQuoteLineGroup(consolidated, clean);
  const reloaded = normaliseTradeQuoteLineGroup(consolidateTradeQuotePercentDiscountLines([
    product(), { ...consolidated.at(-1), quantity: (saved.lines[1].quantityMilli / 1000).toString() },
  ]), clean);
  assert.equal(saved.totalCents, 82_500);
  assert.equal(reloaded.totalCents, saved.totalCents);
  assert.throws(() => normaliseTradeQuoteLineGroup(legacy, clean), /INVALID_LINES/);
  const oneLegacyMiddle = consolidateTradeQuotePercentDiscountLines([legacy[0], legacy[1], product("200")]);
  assert.equal(overallTradeQuoteDiscountKind(oneLegacyMiddle.at(-1)), "percent");
  assert.throws(() => normaliseTradeQuoteLineGroup([legacy[0], legacy[1], product("200")], clean), /INVALID_LINES/);
});

test("persisted adjustment discriminator round-trips and customer label stays editable", () => {
  const persistedPercent = { lineType: "adjustment", description: "Winter offer", quantityMilli: 150, unitPriceCents: -100_000, taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION };
  const persistedFixed = { ...persistedPercent, sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION };
  assert.equal(overallTradeQuoteDiscountKind(persistedPercent), "percent");
  assert.equal(overallTradeQuoteDiscountKind(persistedFixed), "fixed");
  assert.match(ui, /Overall discount label or details/);
  assert.match(ui, /onChange=\{\(event\) => onChange\("description", event\.target\.value\)\}/);
});

test("UI exposes repeatable fixed rows and one final percentage control", () => {
  assert.match(ui, />\+ Dollar discount<\/button>/);
  assert.doesNotMatch(ui, />\+ Percent discount<\/button>/);
  assert.match(ui, /Add final percentage discount/);
  assert.match(ui, /This applies once to the net included items\. Customer choices and optional extras are unchanged\./);
  assert.match(ui, /consolidateTradeQuotePercentDiscountLines\(current\.items\.map/);
  assert.match(ui, /appendBeforeFinalPercent\(current, line\)/);
  assert.match(ui, /packetLines\(packet, "Included work"\)\.reduce\([\s\S]*?appendBeforeFinalPercent\(next, line\)/);
  assert.match(ui, /readOnly=\{!canApplyDiscounts\}/);
  assert.match(ui, /data-quote-validation-target=\{`base:\$\{finalPercentIndex\}:description`\}/);
  assert.match(ui, /data-quote-validation-target=\{`base:\$\{finalPercentIndex\}:quantity`\}/);
  assert.match(pdf, /filter\(\(item\) => !isFinalPercentDiscount\(item\)\)/);
  assert.match(pdf, /finalPercentDescription.*Final.*on included items ex GST/s);
  assert.match(email, /Final percentage discount on included items ex GST/);
  assert.match(email, /finalPercentDescription.*Final.*discount on included items ex GST/s);
});

test("quote rows retain complete objects when reordered", () => {
  const rows = [
    { ...product(), description: "Call-out", marker: { id: 1 } },
    { ...product(), description: "Heat pump", marker: { id: 2 } },
    { ...product(), description: "STC", marker: { id: 3 } },
  ];
  const moved = moveTradeQuoteLine(rows, 2, 0);
  assert.deepEqual(moved.map((line) => line.description), ["STC", "Call-out", "Heat pump"]);
  assert.equal(moved[0], rows[2]);
  assert.deepEqual(rows.map((line) => line.description), ["Call-out", "Heat pump", "STC"]);
  assert.deepEqual(moveTradeQuoteLine(rows, 0, 99), rows);
});

test("quote and choice rows expose desktop drag and 44px touch reorder controls", () => {
  assert.match(ui, /className="trade-quote-drag-handle" draggable=\{!busy\}/);
  assert.match(ui, /onDragStart=\{\(event\)/);
  assert.match(ui, /onDrop: \(event: DragEvent<HTMLDivElement>\)/);
  assert.match(ui, /title="Move up"/);
  assert.match(ui, /title="Move down"/);
  assert.match(ui, />Up<\/button>/);
  assert.match(ui, />Down<\/button>/);
  assert.doesNotMatch(ui, /â†|↑|↓/);
  assert.match(ui, /moveQuoteLine\("base", fromIndex, toIndex\)/);
  assert.match(ui, /moveQuoteLine\(choice\.clientKey, fromIndex, toIndex\)/);
  assert.match(css, /\.trade-quote-order-controls[^}]*grid-template-columns: repeat\(3, 44px\)/);
  assert.match(css, /\.trade-quote-order-controls button[^}]*height: 44px[^}]*min-height: 44px[^}]*width: 44px/);
});

test("every base and choice row uses one price-book dropdown or an editable custom line", () => {
  const selection = ui.slice(ui.indexOf("const selectPriceBookItem"), ui.indexOf("const isDragTarget"));
  assert.match(ui, /<span>Price book item<\/span><select/);
  assert.match(ui, /<option value="">Custom line<\/option>/);
  assert.match(ui, /priceBookItems\.map\(\(item\) => <option key=\{item\.id\} value=\{item\.id\}>/);
  assert.doesNotMatch(ui, /aria-label=\{`Line \$\{index \+ 1\} type`\}/);
  assert.match(selection, /const item = priceBookItems\.find\(\(candidate\) => candidate\.id === itemId\)/);
  assert.match(selection, /onReplace\(\{[\s\S]*?priceBookItemId: item\.id[\s\S]*?lineType: item\.lineType[\s\S]*?description: item\.description \|\| item\.name[\s\S]*?quantity: "1"[\s\S]*?unitPrice: \(item\.sellPriceCentsExGst \/ 100\)\.toFixed\(2\)[\s\S]*?taxCode: item\.taxCode/);
  assert.match(selection, /onReplace\(\{ \.\.\.line, priceBookItemId: "", jobPacketId: "", jobPacketLineId: "" \}\)/);
  assert.match(ui, /readOnly=\{linked\}/);
  assert.match(ui, /disabled=\{linked \|\| discountLocked\}/);
  assert.match(ui, /replaceBaseLine\(index, replacement\)/);
  assert.match(ui, /replaceChoiceLine\(choice\.clientKey, index, replacement\)/);
});

test("preview keeps one consent control in the sticky footer beside send actions", () => {
  const modal = ui.slice(ui.indexOf('className="crm-invoice-preview-dialog crm-quote-preview-dialog"'));
  const consent = modal.indexOf('className="trade-quote-send-consent"');
  const pdf = modal.indexOf('id="trade-quote-pdf-preview"');
  assert.ok(consent > pdf);
  assert.equal(modal.match(/className="trade-quote-send-consent"/g)?.length, 1);
  assert.match(modal, /className="trade-quote-send-footer"/);
  assert.match(css, /\.trade-quote-send-footer \{[^}]*position: sticky;[^}]*bottom: 0/);
  assert.match(css, /\.trade-quote-send-footer-actions[^}]*display: flex/);
  assert.match(css, /\.trade-quote-send-footer \{ grid-template-columns: 1fr; \}/);
  assert.match(modal, /disabled=\{Boolean\(busy\) \|\| !sendConsent\}/);
  assert.match(modal, /previewGrossSubtotalCents/);
  assert.match(modal, /previewOtherDiscountSubtotalCents/);
  assert.match(modal, /previewFinalPercentSubtotalCents/);
  assert.match(modal, /Review quote PDF/);
  assert.match(modal, /previewPdfRef\.current\?\.scrollIntoView/);
  assert.match(modal, /aria-controls="trade-quote-pdf-preview"/);
  assert.doesNotMatch(modal, /<button type="button" disabled>Review quote securely<\/button>/);
});

test("submit outcome stays visible in the modal and exact API errors can include a request reference", () => {
  const flow = ui.slice(ui.indexOf("async function sendPreviewedQuote"), ui.indexOf("async function addQuoteRecipient"));
  assert.match(flow, /setSendOutcome\(\{ kind: "sending"/);
  assert.match(flow, /setSendOutcome\(outcome\)/);
  assert.match(flow, /setSendOutcome\(\{ kind: "error", message: outcome \}\)/);
  assert.doesNotMatch(flow, /setSendPreview\(null\)/);
  assert.match(ui, /result\.requestId/);
  assert.match(ui, /Reference \$\{reference\}/);
  assert.match(ui, /role=\{sendOutcome\.kind === "error" \|\| sendOutcome\.kind === "attention" \? "alert" : "status"\}/);
});

test("live totals and internal sell margin derive from current editable lines", () => {
  assert.match(ui, /const liveSummary = useMemo\(\(\) => liveQuoteSummary\(lines, priceBookItems\), \[lines, priceBookItems\]\)/);
  assert.match(ui, /<strong aria-live="polite">/);
  assert.match(ui, /money\(liveSummary\.subtotalCents\)[\s\S]*money\(liveSummary\.taxCents\)[\s\S]*money\(liveSummary\.totalCents\)/);
  for (const label of ["<span>Subtotal</span><small>Subtotal ex GST</small>", "GST", "Discount incl GST", "<span>Total</span><small>Total incl GST</small>"]) assert.match(ui, new RegExp(label));
  assert.match(ui, /liveOverallDiscountCents\(lines\)/);
  assert.match(ui, /Live editable scope/);
  assert.match(ui, /money\(liveSummary\.costCentsExGst\)[\s\S]*money\(liveSummary\.subtotalCents\)[\s\S]*money\(liveSummary\.marginCentsExGst\)/);
});

test("malformed lines identify the exact row and field instead of collapsing to Check items", () => {
  const issues = tradeQuoteLineValidationIssues([
    { ...product(), description: "" },
    { ...product(), quantity: "0" },
    { ...product(), unitPrice: "four hundred" },
    { ...product(), taxCode: "maybe" },
  ], clean);
  assert.deepEqual(issues.map(({ lineIndex, field, message }) => ({ lineIndex, field, message })), [
    { lineIndex: 0, field: "description", message: "Quote item 1: add a description." },
    { lineIndex: 1, field: "quantity", message: "Quote item 2: enter a quantity greater than 0 with no more than 3 decimal places." },
    { lineIndex: 2, field: "unitPrice", message: "Quote item 3: enter a price of $0 or more with no more than 2 decimal places." },
    { lineIndex: 3, field: "taxCode", message: "Quote item 4: choose GST 10% or No GST." },
  ]);
});

test("invalid overall discounts identify the editable discount control", () => {
  const percentIssue = tradeQuoteLineValidationIssues([product(), {
    lineType: "adjustment", description: "Invalid sale", quantity: "percent:100", unitPrice: "0",
    taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION,
  }], clean)[0];
  assert.deepEqual(
    { lineIndex: percentIssue.lineIndex, field: percentIssue.field, message: percentIssue.message },
    { lineIndex: 1, field: "quantity", message: "Quote item 2: enter a discount greater than 0% and less than 100%." },
  );

  const fixedIssue = tradeQuoteLineValidationIssues([product("100"), {
    lineType: "adjustment", description: "Excess discount", quantity: "1", unitPrice: "111",
    taxCode: "gst", sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION,
  }], clean)[0];
  assert.deepEqual(
    { lineIndex: fixedIssue.lineIndex, field: fixedIssue.field, message: fixedIssue.message },
    { lineIndex: 1, field: "unitPrice", message: "Quote item 2: reduce the discount so it does not exceed the included quote total." },
  );
});

test("blank choice names and malformed choice groups fail before preview with an exact action", () => {
  assert.deepEqual(tradeQuoteChoiceValidationIssue([
    choice("option-a", "addon", "option-a", ""),
  ], clean), {
    scopeKey: "option-a",
    field: "name",
    code: "INVALID_QUOTE_CHOICES",
    message: "Customer choice: add a clear name.",
  });

  assert.deepEqual(tradeQuoteChoiceValidationIssue([
    choice("only-option", "choose_one", "controls", "Only option"),
  ], clean), {
    scopeKey: "only-option",
    field: "remove",
    code: "INVALID_QUOTE_CHOICES",
    message: "Only option: this choose-one group needs at least 2 choices. Remove it or create the complete group again.",
  });

  assert.deepEqual(tradeQuoteChoiceValidationIssue([
    choice("good", "package", "systems", "Good"),
  ], clean), {
    scopeKey: "good",
    field: "remove",
    code: "INVALID_QUOTE_CHOICES",
    message: "Good: this package needs at least 2 choices. Remove it or create the complete group again.",
  });
});

test("valid package and choose-one groups match the authoritative choice contract", () => {
  const choices = [
    choice("good", "package", "systems", "Good"),
    { ...choice("better", "package", "systems", "Better"), recommended: true },
    choice("wall", "choose_one", "mount", "Wall mounted"),
    choice("floor", "choose_one", "mount", "Floor mounted"),
  ];
  assert.equal(tradeQuoteChoiceValidationIssue(choices, clean), null);
});

test("the pictured saved-item quote remains valid and produces live numbers", () => {
  const picturedLines = [
    { ...product("200.00"), lineType: "labour", description: "Call-out" },
    { ...product("3500.00"), description: "Istore Heatpump" },
    { ...product("1000.00"), lineType: "labour", description: "Kris extra fee" },
    {
      lineType: "adjustment",
      description: "Discount x mas special",
      quantity: percentInputToQuantity("10"),
      unitPrice: "0.00",
      taxCode: "gst",
      sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION,
    },
  ];
  assert.deepEqual(tradeQuoteLineValidationIssues(picturedLines, clean), []);
  const quote = normaliseTradeQuoteLineGroup(picturedLines, clean);
  assert.deepEqual(
    { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents },
    { subtotalCents: 423_000, taxCents: 42_300, totalCents: 465_300 },
  );
});

test("preview click exposes, scrolls to and focuses the exact invalid control", () => {
  const flow = ui.slice(ui.indexOf("function openSendPreview"), ui.indexOf("async function sendPreviewedQuote"));
  assert.match(flow, /if \(quoteValidationIssue\)/);
  assert.match(flow, /data-quote-validation-target/);
  assert.match(flow, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(flow, /focus\(\{ preventScroll: true \}\)/);
  assert.match(flow, /throw new Error\(quoteValidationIssue\.message\)/);
  assert.match(ui, /aria-invalid/);
  assert.match(ui, /className="trade-quote-line-error" role="alert"/);
  assert.match(ui, /tradeQuoteChoiceValidationIssue\(choices, cleanChoiceText\)/);
  assert.match(ui, /className="trade-quote-choice-error" role="alert"/);
  assert.match(ui, /Fix before preview/);
  assert.doesNotMatch(ui, /Check items/);
});

test("send status copy is derived from the authoritative delivery presentation", () => {
  assert.match(ui, /quoteDeliveryOutcome\(issued\.delivery, "Quote saved and issued\."\)/);
  for (const key of ["sending", "accepted", "delivered", "attention"]) {
    assert.match(ui, new RegExp(`presentation\\?\\.key === "${key}"`));
  }
  assert.doesNotMatch(ui, /setMessage\("Quote saved and issued\. The email provider accepted it for delivery/);
});

test("preview confirmation performs one consented exact-version issue and no redundant send", () => {
  const flow = ui.slice(ui.indexOf("async function sendPreviewedQuote"), ui.indexOf("async function addQuoteRecipient"));
  assert.match(flow, /action: "save_draft"/);
  assert.match(flow, /if \(!saved\.draftVersionId\)/);
  assert.match(flow, /action: "issue_quote"[\s\S]*quoteVersionId: saved\.draftVersionId[\s\S]*consentConfirmed: true/);
  assert.doesNotMatch(flow, /action: "send_quote"/);
  assert.match(flow, /quoteDeliveryOutcome\(issued\.delivery/);
});

test("a lost issue response replays the retained exact version before any new save", () => {
  const flow = ui.slice(ui.indexOf("async function sendPreviewedQuote"), ui.indexOf("async function addQuoteRecipient"));
  const replay = flow.indexOf("if (pendingIssueVersionId)");
  const save = flow.indexOf('action: "save_draft"');
  assert.ok(replay >= 0 && replay < save);
  assert.match(flow.slice(replay, save), /quoteVersionId: pendingIssueVersionId[\s\S]*consentConfirmed: true/);
  assert.match(flow, /setPendingIssueVersionId\(saved\.draftVersionId\)/);
  assert.match(flow, /setPendingIssueVersionId\(""\)/);
  assert.match(ui, /result\.quote\?\.editableDraft[\s\S]*version\.id === result\.quote\?\.editableDraft\?\.id/);
});

test("replacement-draft preview uses its own version number while the issued version stays current", () => {
  assert.match(ui, /versionNumber: current\.status === "draft" \? current\.versionNumber : quote\.currentVersionNumber \+ 1/);
  assert.doesNotMatch(ui, /current\.status === "draft" \? quote\.currentVersionNumber/);
});
