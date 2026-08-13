import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { creditTotals, invoiceBalance } from "../src/lib/trade-invoice-balance.ts";
import {
  moveInvoiceLine,
  moveInvoiceLineTo,
} from "../src/lib/trade-invoice-line-reorder.ts";
import {
  normaliseQuickInvoiceDocumentSnapshot,
  quickInvoiceTotals,
} from "../src/lib/trade-quick-invoice.ts";
import {
  resolveInvoiceBannerCropPixels,
  resolveInvoiceBusinessNameLayout,
} from "../src/lib/trade-quick-invoice-pdf.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0076_invoice_corrections_credits.sql");
const quickInvoiceMigration = read("../drizzle/0075_guided_quick_invoices.sql");
const invoiceDocumentMigration = read("../drizzle/0122_trade_invoice_documents.sql");
const immutablePdfMigration = read("../drizzle/0123_immutable_issued_pdf_artifacts.sql");
const route = read("../src/app/api/trade-quick-invoices/route.ts");
const panel = read("../src/components/TradeQuickInvoicePanel.tsx");
const invoiceServer = read("../src/lib/trade-quick-invoice-server.ts");
const invoicePdf = read("../src/lib/trade-quick-invoice-pdf.mjs");
const pdfRoute = read("../src/app/api/trade-quick-invoices/[invoiceId]/pdf/route.ts");
const apply = (db, sql) => { for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement); };
const applyQuickInvoicePdfMigration = (db) => {
  for (const statement of immutablePdfMigration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter((item) => item.includes("trade_crm_quick_invoice"))) {
    db.exec(statement);
  }
};

test("invoice balances retain exact cents and reject over-allocation", () => {
  assert.deepEqual(invoiceBalance({ totalCents: 11000, creditedCents: 2200, paidCents: 3000 }), {
    originalCents: 11000, creditedCents: 2200, netCents: 8800, paidCents: 3000, outstandingCents: 5800,
  });
  assert.deepEqual(creditTotals(2000, "gst"), { subtotalCents: 2000, taxCents: 200, totalCents: 2200 });
  assert.deepEqual(creditTotals(2000, "none"), { subtotalCents: 2000, taxCents: 0, totalCents: 2000 });
  assert.throws(() => invoiceBalance({ totalCents: 1000, creditedCents: 600, paidCents: 500 }), /INVOICE_BALANCE_EXCEEDED/);
});

test("draft invoice line ordering preserves each line and its entered values", () => {
  const lines = [
    { id: "line-a", description: "Assessment", amount: "165.00", taxCode: "gst" },
    { id: "line-b", description: "Report", amount: "85.50", taxCode: "none" },
    { id: "line-c", description: "Travel", amount: "24.00", taxCode: "gst" },
  ];

  const movedDown = moveInvoiceLine(lines, "line-a", 1);
  assert.deepEqual(movedDown.map((line) => line.id), ["line-b", "line-a", "line-c"]);
  assert.strictEqual(movedDown[1], lines[0]);
  assert.deepEqual(movedDown[1], {
    id: "line-a",
    description: "Assessment",
    amount: "165.00",
    taxCode: "gst",
  });

  const droppedAtEnd = moveInvoiceLineTo(movedDown, "line-b", "line-c");
  assert.deepEqual(droppedAtEnd.map((line) => line.id), ["line-a", "line-c", "line-b"]);
  assert.strictEqual(droppedAtEnd[2], lines[1]);
  const droppedAtStart = moveInvoiceLineTo(droppedAtEnd, "line-b", "line-a");
  assert.deepEqual(droppedAtStart.map((line) => line.id), ["line-b", "line-a", "line-c"]);
  assert.deepEqual(lines.map((line) => line.id), ["line-a", "line-b", "line-c"]);

  assert.deepEqual(
    moveInvoiceLine(lines, "line-a", -1).map((line) => line.id),
    ["line-a", "line-b", "line-c"],
  );
  assert.deepEqual(
    moveInvoiceLine(lines, "line-c", 1).map((line) => line.id),
    ["line-a", "line-b", "line-c"],
  );
});

test("invoice correction migration preserves the initial snapshot and creates bounded ledgers", () => {
  const db = new DatabaseSync(":memory:");
  apply(db, quickInvoiceMigration);
  db.exec(`CREATE TABLE trade_crm_payment_links (
    id text PRIMARY KEY, work_order_id text, firebase_uid text, commercial_reference text, purpose text,
    provider text, provider_payment_id text, paid_amount_cents integer, paid_at text, status text
  )`);
  db.prepare(`INSERT INTO trade_crm_quick_invoices
    (id, work_order_id, firebase_uid, crm_customer_id, invoice_number, due_at, consent_confirmed_at, created_by_uid, created_at, updated_at,
     line_items_json, subtotal_cents, tax_cents, total_cents)
    VALUES ('invoice-1', 'job-1', 'owner-1', 'customer-1', 'INV-TLJ-1', '2026-08-01', '2026-07-19', 'owner-1', '2026-07-19', '2026-07-19', '[]', 10000, 1000, 11000)`).run();
  apply(db, migration);
  const columns = db.prepare("PRAGMA table_info(trade_crm_quick_invoices)").all().map((row) => row.name);
  assert.ok(columns.includes("revision"));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM trade_crm_quick_invoice_revisions").get().count, 1);
  for (const table of ["trade_crm_quick_invoice_revisions", "trade_crm_quick_invoice_credits", "trade_crm_invoice_payment_allocations"]) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  }
});

test("draft correction and issued credit are explicit guarded actions", () => {
  assert.match(route, /action === "correct_draft"/);
  assert.match(route, /expectedRevision/);
  assert.match(route, /INSERT INTO trade_crm_quick_invoice_revisions/);
  assert.match(route, /action === "issue_credit"/);
  assert.match(route, /trade_crm_quick_invoice_credits/);
  assert.doesNotMatch(route, /payment_activity|trade_crm_payment_links/);
  assert.doesNotMatch(route, /trade_crm_invoice_payment_allocations/);
  assert.match(route, /accounting_activity/);
  assert.match(migration, /trade_crm_invoice_payment_allocations/);
  assert.match(panel, /Correct this draft before sending/);
  assert.match(panel, /Issue a credit/);
  assert.match(panel, /outstandingCents/);
});

test("correctable draft invoices expose touch arrows and desktop drag ordering", () => {
  const correctionStart = panel.indexOf(
    "canManageInvoice && invoice.canCorrect && <details",
  );
  const creditStart = panel.indexOf(
    "canManageInvoice && canApplyDiscounts",
    correctionStart,
  );
  assert.ok(correctionStart >= 0 && creditStart > correctionStart);
  const correctionUi = panel.slice(correctionStart, creditStart);

  assert.match(correctionUi, /draftLines\.map\(\(line, index\)/);
  assert.match(correctionUi, /draggable aria-label=/);
  assert.match(correctionUi, /onDragStart=/);
  assert.match(correctionUi, /onDragOver=/);
  assert.match(correctionUi, /onDrop=/);
  assert.match(correctionUi, /title="Move up"/);
  assert.match(correctionUi, /disabled=\{index === 0\}/);
  assert.match(correctionUi, /title="Move down"/);
  assert.match(correctionUi, /disabled=\{index === draftLines\.length - 1\}/);
  assert.match(correctionUi, /minWidth: "44px", minHeight: "44px"/);
  assert.match(correctionUi, /moveDraftLine\(line, -1\)/);
  assert.match(correctionUi, /moveDraftLine\(line, 1\)/);
  assert.equal(panel.match(/draggable aria-label=/g)?.length, 1);

  const correctionAction = panel.slice(
    panel.indexOf("async function correctDraft"),
    panel.indexOf("async function issueCredit"),
  );
  assert.match(correctionAction, /draftLines\.map\(\(line\) => \(\{/);
  assert.match(correctionAction, /request\("correct_draft", \{ expectedRevision: invoice\.revision, lines/);
  assert.match(route, /current\.status !== "draft"/);
  assert.match(route, /line_items_json = \?,/);
  assert.match(route, /INSERT INTO trade_crm_quick_invoice_revisions/);
});

test("invoice discounts retain deterministic cents across taxable and GST-free lines", () => {
  assert.deepEqual(
    quickInvoiceTotals(
      [
        {
          subtotalCents: 10_000,
          taxCents: 1_000,
          totalCents: 11_000,
          taxCode: "gst",
        },
        {
          subtotalCents: 10_000,
          taxCents: 0,
          totalCents: 10_000,
          taxCode: "none",
        },
      ],
      3_001,
    ),
    {
      subtotalCents: 20_000,
      discountCents: 3_001,
      taxableDiscountCents: 1_501,
      gstFreeDiscountCents: 1_500,
      taxCents: 850,
      totalCents: 17_849,
    },
  );
  assert.throws(
    () =>
      quickInvoiceTotals(
        [{
          subtotalCents: 10_000,
          taxCents: 1_000,
          totalCents: 11_000,
          taxCode: "gst",
        }],
        10_000,
      ),
    /INVALID_QUICK_INVOICE/,
  );
});

test("invoice totals retain authoritative per-line GST rounding", () => {
  const lines = [
    {
      subtotalCents: 5,
      taxCents: 1,
      totalCents: 6,
      taxCode: "gst",
    },
    {
      subtotalCents: 5,
      taxCents: 1,
      totalCents: 6,
      taxCode: "gst",
    },
  ];
  assert.deepEqual(quickInvoiceTotals(lines), {
    subtotalCents: 10,
    discountCents: 0,
    taxableDiscountCents: 0,
    gstFreeDiscountCents: 0,
    taxCents: 2,
    totalCents: 12,
  });
  assert.deepEqual(quickInvoiceTotals(lines, 5), {
    subtotalCents: 10,
    discountCents: 5,
    taxableDiscountCents: 5,
    gstFreeDiscountCents: 0,
    taxCents: 1,
    totalCents: 6,
  });
});

test("invoice snapshots reject contradictory line tax and total amounts", () => {
  const snapshot = {
    schemaVersion: "trade-quick-invoice-document-v1",
    capturedAt: "2026-08-05T00:00:00.000Z",
    invoiceId: "invoice-1",
    invoiceNumber: "INV-TLJ-1",
    revision: 1,
    currency: "AUD",
    dueAt: "2026-08-12",
    issuedAt: "",
    business: {
      name: "Example Electrical",
      phone: "",
      email: "",
      abn: "",
      website: "",
      address: "",
      themeKey: "emerald_navy",
      borderStyle: "soft",
      logo: null,
      banner: null,
      bannerCrop: {
        xBasisPoints: 0,
        yBasisPoints: 0,
        widthBasisPoints: 10_000,
        heightBasisPoints: 10_000,
      },
    },
    payment: {
      accountName: "",
      bsb: "",
      accountNumber: "",
      reference: "",
      terms: "",
    },
    customer: {
      id: "customer-1",
      number: "CUS-1",
      name: "Test Customer",
      email: "customer@example.com",
      phone: "",
    },
    site: {
      id: "site-1",
      label: "Home",
      addressLine1: "1 Test Street",
      addressLine2: "",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
      summary: "1 Test Street, Melbourne VIC 3000",
    },
    work: {
      id: "job-1",
      number: "TLJ-1",
      title: "Test installation",
    },
    lines: [{
      lineId: "line-1",
      priceBookItemId: "",
      priceRevision: 0,
      description: "Installation",
      quantity: 1,
      unitPriceCentsExGst: 100,
      taxCode: "gst",
      subtotalCents: 100,
      taxCents: 10,
      totalCents: 110,
    }],
    subtotalCents: 100,
    discountCents: 0,
    taxCents: 10,
    totalCents: 110,
  };
  assert.ok(normaliseQuickInvoiceDocumentSnapshot(snapshot));

  const inconsistentTotal = structuredClone(snapshot);
  inconsistentTotal.lines[0].totalCents = 999;
  assert.equal(normaliseQuickInvoiceDocumentSnapshot(inconsistentTotal), null);

  const nonGstTax = structuredClone(snapshot);
  nonGstTax.lines[0].taxCode = "none";
  assert.equal(normaliseQuickInvoiceDocumentSnapshot(nonGstTax), null);
});

test("invoice document migration snapshots every issued revision", () => {
  const db = new DatabaseSync(":memory:");
  apply(db, quickInvoiceMigration);
  db.exec(`CREATE TABLE trade_crm_payment_links (
    id text PRIMARY KEY, work_order_id text, firebase_uid text, commercial_reference text, purpose text,
    provider text, provider_payment_id text, paid_amount_cents integer, paid_at text, status text
  )`);
  apply(db, migration);
  apply(db, invoiceDocumentMigration);
  applyQuickInvoicePdfMigration(db);
  for (const table of [
    "trade_crm_quick_invoices",
    "trade_crm_quick_invoice_revisions",
  ]) {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name);
    assert.ok(columns.includes("discount_cents"));
    assert.ok(columns.includes("document_snapshot_json"));
    assert.ok(columns.includes("issued_pdf_object_key"));
    assert.ok(columns.includes("issued_pdf_sha256"));
    assert.ok(columns.includes("issued_pdf_size_bytes"));
  }
});

test("invoice PDF uses a full-width 5:1 crop within the saved source bounds", () => {
  assert.deepEqual(
    resolveInvoiceBannerCropPixels(
      { width: 1_000, height: 1_000 },
      {
        xBasisPoints: 0,
        yBasisPoints: 0,
        widthBasisPoints: 10_000,
        heightBasisPoints: 10_000,
      },
    ),
    { x: 0, y: 400, width: 1_000, height: 200 },
  );
  assert.deepEqual(
    resolveInvoiceBannerCropPixels(
      { width: 2_000, height: 1_000 },
      {
        xBasisPoints: 1_000,
        yBasisPoints: 2_000,
        widthBasisPoints: 8_000,
        heightBasisPoints: 5_000,
      },
    ),
    { x: 200, y: 290, width: 1_600, height: 320 },
  );
});

test("invoice PDF bounds a long business name before the INVOICE title", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const name =
    "Mikes Electrical and Solar Installations and Maintenance Services Pty Ltd";
  const availableWidth = 328;
  const layout = resolveInvoiceBusinessNameLayout(
    font,
    name,
    availableWidth,
  );
  assert.ok(layout.lines.length >= 1 && layout.lines.length <= 2);
  assert.ok(layout.size >= 11 && layout.size <= 19);
  assert.equal(layout.lines.join(" "), name);
  for (const line of layout.lines) {
    assert.ok(
      font.widthOfTextAtSize(line, layout.size) <= availableWidth,
      `${line} exceeded the bounded invoice identity width`,
    );
  }
});

test("invoice PDF and delivery reuse the immutable owner-scoped document snapshot", () => {
  assert.match(invoiceDocumentMigration, /document_snapshot_json/);
  assert.match(invoiceServer, /document_business_name/);
  assert.match(invoiceServer, /document_phone/);
  assert.match(invoiceServer, /document_email/);
  assert.match(invoiceServer, /document_snapshot_json/);
  assert.match(
    invoiceServer,
    /options\.forceDraftRefresh && row\.status !== "draft"/,
  );
  assert.match(invoiceServer, /attachments:[\s\S]*contentType: "application\/pdf"/);
  assert.match(
    invoiceServer,
    /replyTo: validEmail\(snapshot\.business\.email\) \|\| undefined/,
  );
  assert.match(pdfRoute, /requireInstallerTeamAccess/);
  assert.match(pdfRoute, /access\.ownerUid/);
  assert.match(pdfRoute, /issuedQuickInvoicePdf/);
  assert.doesNotMatch(pdfRoute, /renderTradeQuickInvoicePdf/);
  assert.match(pdfRoute, /Content-Disposition/);
  assert.match(
    invoiceServer,
    /readImmutableIssuedPdf\([\s\S]*kind: "invoice",[\s\S]*documentId: invoiceId,[\s\S]*revision: snapshot\.revision/,
  );
  assert.match(panel, /Download invoice PDF/);
  assert.match(panel, /Discount \(ex GST\)/);
  assert.doesNotMatch(panel, /including GST/);
  assert.match(invoicePdf, /Discount \(ex GST\)/);
  assert.match(panel, /invoice\.document\.payment\.accountName/);
});
