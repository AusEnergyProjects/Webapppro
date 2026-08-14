import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  PDFName,
  decodePDFRawStream,
} from "pdf-lib";
import {
  buildTradeQuoteAcceptancePdfSnapshot,
  renderTradeQuoteAcceptancePdf,
  tradeQuoteAcceptancePdfFilename,
} from "../src/lib/trade-quote-acceptance-pdf-server.ts";
import { TRADE_QUOTE_ACCEPTANCE_PDF_VERSION } from "../src/lib/trade-quote-acceptance-pdf.mjs";
import { createTradeQuoteAcceptancePdfBytes } from "../src/lib/trade-quote-acceptance-pdf.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../src/app/api/quote-review/[token]/receipt/route.ts");
const server = read("../src/lib/trade-quote-acceptance-pdf-server.ts");
const decisionServer = read("../src/lib/trade-quote-decision-server.ts");

function compile(source, fileName, mocks) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function fixture() {
  const quote = {
    schemaVersion: "trade-quote-document-v2",
    capturedAt: "2026-08-14T03:00:00.000Z",
    quoteId: "quote-1",
    quoteVersionId: "version-1",
    quoteNumber: "Q-TLJ-X2UBP25W",
    versionNumber: 1,
    work: { id: "work-1", number: "TLJ-X2UBP25W", title: "Energy assessment project" },
    customer: { id: "customer-1", number: "CUS-1", name: "Test 123", email: "test@example.com" },
    site: {
      id: "site-1",
      label: "Home",
      addressLine1: "1 Test Street",
      addressLine2: "",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
      summary: "1 Test Street, Melbourne, VIC, 3000",
    },
    business: {
      name: "Australian Energy Assessments",
      email: "info@ausenergyassessments.com",
      phone: "1300 241 149",
      abn: "12345678901",
      website: "https://ausenergyassessments.com",
      address: "Melbourne VIC",
      themeKey: "emerald_navy",
      borderStyle: "soft",
      logo: null,
      banner: null,
      quoteEmailSubjectTemplate: "",
      quoteEmailIntro: "",
    },
    acceptanceEmail: "test@example.com",
    subtotalCents: 20_000,
    taxCents: 2_000,
    totalCents: 22_000,
    customerMessage: "",
    terms: "Recorded quote terms",
    validUntil: "2026-09-14",
    consentStatement: "I accept this quote.",
    issuedAt: "2026-08-14T02:00:00.000Z",
    items: [],
    choices: [
      {
        id: "choice-1",
        kind: "addon",
        groupKey: "extras",
        name: "Selected extra",
        summary: "",
        recommended: false,
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
        items: [],
      },
    ],
  };
  const stored = {
    clientDecisionId: "ef8fc742-cb3f-4d57-a61c-31908584c21e",
    payloadSha256: "a".repeat(64),
    commercial: {
      reference: "Q-TLJ-X2UBP25W-V1",
      currency: "AUD",
      subtotalCents: 20_000,
      taxCents: 2_000,
      totalCents: 22_000,
      selectedChoiceIds: ["choice-1"],
    },
    receipt: {
      acceptanceId: "acceptance-1",
      decision: "accepted",
      signerName: "Test 123",
      decidedAt: "2026-08-14T03:15:00.000Z",
      consentStatement: "I, Test 123, accept quote Q-TLJ-X2UBP25W version 1 for AUD 220.00, subject to its recorded terms.",
      commercialReference: "Q-TLJ-X2UBP25W-V1",
      invoice: {
        id: "invoice-1",
        number: "INV-Q-TLJ-X2UBP25W-V1",
        status: "issued",
        documentLabel: "Invoice",
        subtotalCents: 20_000,
        taxCents: 2_000,
        totalCents: 22_000,
        dueAt: "2026-08-21",
        issueBlockerCode: "",
      },
      payment: {
        availability: "bank_transfer",
        method: "bank_transfer",
        accountName: "TEST ONLY - DO NOT PAY",
        bsb: "123456",
        accountNumber: "12345678910",
        reference: "TEST ONLY - DO NOT PAY",
        terms: "TEST ENVIRONMENT ONLY. DO NOT MAKE A PAYMENT USING THESE DETAILS.",
        amountDueCents: 22_000,
        currency: "AUD",
        dueAt: "2026-08-21",
      },
    },
  };
  return { quote, stored };
}

function decodedPageContent(pdf) {
  const operators = pdf.getPages().map((page) => {
    const contents = page.node.lookup(PDFName.of("Contents"));
    const streams = contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index))
      : [contents];
    return streams
      .filter((stream) => stream instanceof PDFRawStream)
      .map((stream) =>
        Buffer.from(decodePDFRawStream(stream).getBytes()).toString("latin1"),
      )
      .join("\n");
  }).join("\n");
  return [...operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)]
    .map((match) => Buffer.from(match[1], "hex").toString("latin1"))
    .join("\n");
}

test("accepted quote receipt is built only from the stored accepted version and reconciled totals", () => {
  const { quote, stored } = fixture();
  const snapshot = buildTradeQuoteAcceptancePdfSnapshot(quote, stored);
  assert.equal(snapshot.schemaVersion, TRADE_QUOTE_ACCEPTANCE_PDF_VERSION);
  assert.equal(snapshot.quote.number, "Q-TLJ-X2UBP25W");
  assert.equal(snapshot.quote.versionNumber, 1);
  assert.deepEqual(snapshot.quote.selectedChoiceNames, ["Selected extra"]);
  assert.equal(snapshot.invoice.number, "INV-Q-TLJ-X2UBP25W-V1");
  assert.equal(snapshot.invoice.totalCents, 22_000);
  assert.equal(snapshot.payment.amountDueCents, 22_000);
  assert.match(snapshot.acceptance.statement, /accept quote Q-TLJ-X2UBP25W version 1/);
  assert.match(snapshot.environmentNotice, /TEST ENVIRONMENT ONLY/);

  const mismatchedTotal = structuredClone(stored);
  mismatchedTotal.receipt.invoice.totalCents = 21_999;
  assert.throws(
    () => buildTradeQuoteAcceptancePdfSnapshot(quote, mismatchedTotal),
    /QUOTE_ACCEPTANCE_PDF_INVALID/,
  );

  const wrongVersionChoice = structuredClone(stored);
  wrongVersionChoice.commercial.selectedChoiceIds = ["choice-from-another-version"];
  assert.throws(
    () => buildTradeQuoteAcceptancePdfSnapshot(quote, wrongVersionChoice),
    /QUOTE_ACCEPTANCE_PDF_INVALID/,
  );

  const declined = structuredClone(stored);
  declined.receipt.decision = "declined";
  assert.throws(
    () => buildTradeQuoteAcceptancePdfSnapshot(quote, declined),
    /QUOTE_ACCEPTANCE_PDF_INVALID/,
  );
});

test("pending or reconciliation receipts redact bank fields and payable amounts", () => {
  const { quote, stored } = fixture();
  stored.receipt.invoice.status = "attention_required";
  stored.receipt.payment = {
    availability: "not_configured",
    method: "none",
    accountName: "must not escape",
    bsb: "999999",
    accountNumber: "private",
    reference: "private",
    terms: "private",
    amountDueCents: 0,
    currency: "AUD",
    dueAt: "2026-08-21",
  };
  const snapshot = buildTradeQuoteAcceptancePdfSnapshot(quote, stored);
  assert.equal(snapshot.payment.accountName, "");
  assert.equal(snapshot.payment.bsb, "");
  assert.equal(snapshot.payment.accountNumber, "");
  assert.equal(snapshot.payment.reference, "");
  assert.equal(snapshot.payment.terms, "");
  assert.equal(snapshot.payment.amountDueCents, 0);
  assert.equal(snapshot.environmentNotice, "");
});

test("accepted quote receipt PDF is stable, downloadable and visibly versioned", async () => {
  const { quote, stored } = fixture();
  const snapshot = buildTradeQuoteAcceptancePdfSnapshot(quote, stored);
  assert.equal(
    tradeQuoteAcceptancePdfFilename(snapshot),
    "INV-Q-TLJ-X2UBP25W-V1-acceptance-record.pdf",
  );
  const bytes = await renderTradeQuoteAcceptancePdf(snapshot);
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString("ascii"), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPage(0).getSize().width.toFixed(2), "595.28");
  assert.ok(pdf.getPageCount() >= 2, "signed acceptance evidence is preserved separately");
  assert.match(pdf.getTitle() || "", /Q-TLJ-X2UBP25W-V1/);
  assert.match(pdf.getKeywords() || "", new RegExp(TRADE_QUOTE_ACCEPTANCE_PDF_VERSION));
  const content = decodedPageContent(pdf);
  for (const expected of [
    "QUOTE ACCEPTANCE RECEIPT",
    "INV-Q-TLJ-X2UBP25W-V1",
    "TEST ENVIRONMENT ONLY",
    "SIGNED ACCEPTANCE",
    "ACCEPTED SCOPE",
    "Server-prepared customer record",
  ]) {
    assert.match(content, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("accepted quote receipt PDF preserves the complete maximum-length payment identity", async () => {
  const { quote, stored } = fixture();
  const accountTokens = Array.from({ length: 16 }, (_value, index) => `ACCOUNT${String(index + 1).padStart(2, "0")}`);
  const referenceTokens = Array.from({ length: 18 }, (_value, index) => `REF${String(index + 1).padStart(2, "0")}`);
  stored.receipt.payment.accountName = accountTokens.join(" ");
  stored.receipt.payment.reference = referenceTokens.join(" ");
  const bytes = await renderTradeQuoteAcceptancePdf(
    buildTradeQuoteAcceptancePdfSnapshot(quote, stored),
  );
  const content = decodedPageContent(await PDFDocument.load(bytes));
  for (const token of [...accountTokens, ...referenceTokens]) {
    assert.match(content, new RegExp(token));
  }
});

test("embedded fonts preserve supported names and replace unsupported glyphs without aborting", async () => {
  const { quote, stored } = fixture();
  quote.customer.name = "Jos\u00e9 \ud83d\ude80 \u674e";
  stored.receipt.signerName = "Jos\u00e9 \ud83d\ude80 \u674e";
  stored.receipt.consentStatement =
    "I, Jos\u00e9 \ud83d\ude80 \u674e, accept the exact recorded quote.";
  const snapshot = buildTradeQuoteAcceptancePdfSnapshot(quote, stored);
  const bytes = await createTradeQuoteAcceptancePdfBytes(snapshot, {
    regular: new Uint8Array(
      fs.readFileSync(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url)),
    ),
    bold: new Uint8Array(
      fs.readFileSync(new URL("../public/fonts/LiberationSans-Bold.ttf", import.meta.url)),
    ),
  });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString("ascii"), "%PDF-");
});

test("decision-link authorization rejects invalid and expired tokens before receipt data is read", async () => {
  function loadAuthoriser(row, hash = "active-hash") {
    return compile(decisionServer, "src/lib/trade-quote-decision-server.ts", {
      "../../db": {
        getD1: () => ({
          prepare: () => ({
            bind: () => ({ first: async () => row }),
          }),
        }),
      },
      "@/lib/trade-access-server": {
        verifiedTradeAccountPredicate: () => "1 = 1",
      },
      "@/lib/trade-quote-links": {
        splitQuoteLinkToken: () => ({ linkId: "link-1", secret: "redacted" }),
        hashQuoteLinkSecret: async () => hash,
      },
    }).authoriseTradeQuoteDecisionLink;
  }
  const baseRow = {
    id: "link-1",
    quote_id: "quote-1",
    quote_version_id: "version-1",
    work_order_id: "work-1",
    firebase_uid: "owner-1",
    crm_customer_id: "customer-1",
    token_issue: 1,
    token_hash: "active-hash",
    status: "accepted",
    expires_at: "2999-01-01T00:00:00.000Z",
    version_number: 1,
    current_version_number: 1,
    document_snapshot_json: "{}",
    invoice_payment_account_name: "",
    invoice_payment_bsb: "",
    invoice_payment_account_number: "",
    invoice_payment_reference: "",
    invoice_default_terms: "",
  };
  await assert.rejects(
    () => loadAuthoriser(baseRow, "wrong-hash")("link-1.redacted"),
    /QUOTE_LINK_NOT_FOUND/,
  );
  await assert.rejects(
    () =>
      loadAuthoriser({
        ...baseRow,
        expires_at: "2020-01-01T00:00:00.000Z",
      })("link-1.redacted"),
    /QUOTE_LINK_EXPIRED/,
  );
});

test("receipt endpoint is accepted-only and returns the stable PDF attachment for that exact link", async () => {
  const request = new Request(
    "https://compare.ausenergyassessments.com/api/quote-review/link-1.redacted/receipt",
  );
  const context = { params: Promise.resolve({ token: "link-1.redacted" }) };
  const adminJson = (body, status = 200) => Response.json(body, { status });
  function load(status) {
    return compile(route, "src/app/api/quote-review/[token]/receipt/route.ts", {
      "@/lib/admin-server": { adminJson },
      "@/lib/trade-quote-decision-server": {
        authoriseTradeQuoteDecisionLink: async () => ({
          status,
          id: "link-1",
        }),
        storedQuoteDecision: async () => ({
          receipt: { decision: "accepted" },
        }),
      },
      "@/lib/trade-quote-review-server": {
        quoteDocumentSnapshotForAuthorisedLink: async () => ({
          quoteVersionId: "version-1",
        }),
        tradeQuoteTokenErrorResponse: (error) =>
          adminJson({ ok: false, error: error.message }, 500),
      },
      "@/lib/trade-quote-acceptance-pdf-server": {
        buildTradeQuoteAcceptancePdfSnapshot: () => ({
          quote: { number: "Q-1", versionNumber: 1 },
          invoice: { number: "INV-Q-1-V1" },
        }),
        renderTradeQuoteAcceptancePdf: async () =>
          new TextEncoder().encode("%PDF-1.7\n"),
        tradeQuoteAcceptancePdfFilename: () =>
          "INV-Q-1-V1-acceptance-record.pdf",
      },
    }).GET;
  }

  const activeResponse = await load("active")(request, context);
  assert.equal(activeResponse.status, 409);
  assert.match(
    (await activeResponse.json()).error,
    /Accept this quote before saving its acceptance PDF/,
  );

  const acceptedResponse = await load("accepted")(request, context);
  assert.equal(acceptedResponse.status, 200);
  assert.equal(acceptedResponse.headers.get("content-type"), "application/pdf");
  assert.equal(
    acceptedResponse.headers.get("content-disposition"),
    'attachment; filename="INV-Q-1-V1-acceptance-record.pdf"',
  );
  assert.equal(
    Buffer.from(await acceptedResponse.arrayBuffer())
      .subarray(0, 5)
      .toString("ascii"),
    "%PDF-",
  );
});

test("receipt endpoint reauthorises the token and never accepts client totals or invoice data", () => {
  for (const boundary of [
    "authoriseTradeQuoteDecisionLink",
    'link.status !== "accepted"',
    "storedQuoteDecision(link)",
    "quoteDocumentSnapshotForAuthorisedLink(link)",
    "buildTradeQuoteAcceptancePdfSnapshot(quote, stored)",
  ]) {
    assert.match(route, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(route, /request\.json|searchParams|get\("total|get\("invoice/i);
  assert.match(route, /"Content-Type": "application\/pdf"/);
  assert.match(route, /"Content-Disposition": `attachment;/);
  assert.match(route, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(route, /"Content-Security-Policy": "default-src 'none'; sandbox"/);
  assert.match(route, /"Cross-Origin-Resource-Policy": "same-origin"/);
  assert.match(route, /"Referrer-Policy": "no-referrer"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
  assert.match(route, /tradeQuoteTokenErrorResponse\(error, "acceptance receipt pdf"\)/);
  assert.match(route, /Accept this quote before saving its acceptance PDF/);
  assert.match(route, /This acceptance PDF could not be verified/);
  assert.doesNotMatch(server, /Request|URLSearchParams|FormData/);
  assert.match(decisionServer, /splitQuoteLinkToken\(token\)/);
  assert.match(decisionServer, /hashQuoteLinkSecret\(secret\) !== row\.token_hash/);
  assert.match(decisionServer, /String\(row\.expires_at\) <= now/);
  assert.match(decisionServer, /throw new Error\("QUOTE_LINK_EXPIRED"\)/);
});
