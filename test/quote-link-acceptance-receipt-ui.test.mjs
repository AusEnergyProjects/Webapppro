import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isPayableQuoteDecisionInvoice } from "../src/lib/trade-quote-receipt.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const ui = read("../src/components/QuoteLinkReview.tsx");
const page = read("../src/app/quote-review/[token]/page.tsx");
const css = read("../src/app/globals.css");

function executableDecisionIdFactory() {
  const expression = ui.match(
    /export const getOrCreateQuoteDecisionId: DecisionIdFactory = ([\s\S]*?);\r?\n\r?\nconst money/,
  )?.[1];
  assert.ok(expression, "decision id helper must remain executable in isolation");
  return Function(`"use strict"; return (${expression});`)();
}

test("one UUID is retained for an exact decision retry", () => {
  const getOrCreate = executableDecisionIdFactory();
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const storageKey = "quote-review:decision:link-1:version-1";
  let creations = 0;
  const createId = () => {
    creations += 1;
    return "ef8fc742-cb3f-4d57-a61c-31908584c21e";
  };

  assert.equal(
    getOrCreate(storage, storageKey, createId),
    "ef8fc742-cb3f-4d57-a61c-31908584c21e",
  );
  assert.equal(creations, 1, "the first decision creates one request id");
  assert.equal(
    getOrCreate(storage, storageKey, () => {
      creations += 1;
      return "c7831b35-32af-4e12-9ded-0fef40dbbd8f";
    }),
    "ef8fc742-cb3f-4d57-a61c-31908584c21e",
  );
  assert.equal(creations, 1, "retry must not mint a second request id");

  values.set(storageKey, "not-a-uuid");
  assert.equal(
    getOrCreate(storage, storageKey, () => "c7831b35-32af-4e12-9ded-0fef40dbbd8f"),
    "c7831b35-32af-4e12-9ded-0fef40dbbd8f",
    "invalid session state must be replaced with a valid UUID",
  );
});

test("public quote decisions use the durable replay contract", () => {
  assert.match(
    ui,
    /`quote-review:decision:\$\{quote\.linkId\}:\$\{quote\.quoteVersionId\}`/,
  );
  assert.match(ui, /window\.sessionStorage/);
  assert.match(ui, /clientDecisionId,/);
  assert.match(ui, /if \(result\.receipt\)/, "GET must reopen a decided receipt");
  assert.match(ui, /setReceipt\(result\.receipt\)/, "POST must show the canonical receipt");
  assert.match(ui, /Boolean\(busy\)/, "both decision buttons remain disabled in flight");
  assert.match(ui, /Retry acceptance for/);
  assert.match(ui, /Retry decline/);
  assert.match(ui, /controller\.abort\(\), 30_000/);
  assert.match(ui, /Retry to confirm whether it was received/);
});

test("accepted receipt is simple and reveals bank details only when complete", () => {
  const receiptUi = ui.slice(
    ui.indexOf("function QuoteDecisionReceiptView"),
    ui.indexOf("function clamp"),
  );
  assert.match(receiptUi, /<h1>Quote accepted<\/h1>/);
  assert.match(receiptUi, /invoice\.number/);
  assert.match(receiptUi, /money\(invoice\.totalCents\)/);
  assert.match(receiptUi, /displayDate\(invoice\.dueAt\)/);
  assert.match(receiptUi, /payment\.availability === "bank_transfer"/);
  assert.match(receiptUi, /payment\.accountName && payment\.bsb && payment\.accountNumber/);
  assert.match(receiptUi, /Payment details are being prepared/);
  assert.match(receiptUi, /Customer PDF record/);
  assert.match(receiptUi, /Save acceptance PDF/);
  assert.match(receiptUi, /href=\{receiptPdfUrl\}/);
  assert.match(receiptUi, /download/);
  assert.doesNotMatch(
    receiptUi,
    /Stripe|Square|Tax Invoice|payment received|paid in full/i,
  );
});

test("a reconciliation record never presents a second invoice or amount due", () => {
  assert.equal(isPayableQuoteDecisionInvoice({ status: "issued" }), true);
  assert.equal(isPayableQuoteDecisionInvoice({ status: "attention_required" }), false);
  assert.equal(isPayableQuoteDecisionInvoice(null), false);

  const receiptUi = ui.slice(
    ui.indexOf("function QuoteDecisionReceiptView"),
    ui.indexOf("function clamp"),
  );
  assert.match(receiptUi, /invoice && payableInvoice/);
  assert.match(receiptUi, /invoice\?\.status === "attention_required"/);
  assert.match(receiptUi, /The trade business is confirming the existing invoice/);
  assert.match(receiptUi, /Do not make another payment/);
});

test("quote links are private, uncached and responsive", () => {
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /export const revalidate = 0/);
  assert.match(page, /export const fetchCache = "force-no-store"/);
  assert.match(page, /index: false/);
  assert.match(page, /follow: false/);
  assert.match(page, /noarchive: true/);
  assert.match(page, /nocache: true/);
  assert.match(page, /referrer: "no-referrer"/);
  assert.match(css, /\.quote-link-receipt \{/);
  assert.match(css, /\.quote-link-bank-transfer \{/);
  assert.match(css, /\.quote-link-receipt-download \{/);
  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*?\.quote-link-receipt \{[^}]*min-height: 100vh/,
  );
  assert.match(
    css,
    /\.quote-link-bank-transfer dl, \.quote-link-receipt-declined dl \{ grid-template-columns: 1fr; \}/,
  );
  assert.match(
    css,
    /\.quote-link-receipt-download \{ align-items: stretch; flex-direction: column; \}/,
  );
});
