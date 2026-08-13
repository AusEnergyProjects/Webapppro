import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { calculateTradeQuoteLine, dollarsToCents, normaliseTradeQuoteLines, quantityToMilli } from "../src/lib/trade-quote.ts";
import { calculateQuoteSelection, normaliseQuoteChoices } from "../src/lib/trade-quote-options.ts";
import { tradeQuoteDocumentDisplayTotals } from "../src/lib/trade-quote-document-totals.mjs";
import { contiguousTradeQuoteSections, createTradeQuotePdfBytes } from "../src/lib/trade-quote-pdf.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0050_versioned_trade_quotes.sql");
const optionsMigration = read("../drizzle/0066_optioned_trade_quotes.sql");
const sharingMigration = read("../drizzle/0067_secure_quote_sharing.sql");
const documentMigration = read("../drizzle/0120_trade_business_identity_and_quote_delivery.sql");
const issuedDocumentMigration = read("../drizzle/0123_immutable_issued_pdf_artifacts.sql");
const deliveryOutboxMigration = read("../drizzle/0136_trade_quote_delivery_outbox.sql");
const deliveryRendererMigration = read("../drizzle/0137_trade_quote_delivery_renderer_revision.sql");
const acceptanceInvoiceMigration = read("../drizzle/0138_trade_quote_acceptance_invoice.sql");
const installerRoute = read("../src/app/api/trade-quotes/route.ts");
const customerRoute = read("../src/app/api/customer-trade-quotes/route.ts");
const linkRoute = read("../src/app/api/quote-review/[token]/route.ts");
const installerUi = read("../src/components/TradeQuotePanel.tsx");
const customerUi = read("../src/components/CustomerTradeQuotes.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const styles = read("../src/app/globals.css");
const linkUi = read("../src/components/QuoteLinkReview.tsx");
const commercial = read("../src/lib/trade-commercial-reference.ts");
const documentServer = read("../src/lib/trade-quote-review-server.ts");
const decisionServer = read("../src/lib/trade-quote-decision-server.ts");
const acceptedInvoice = read("../src/lib/trade-accepted-invoice.ts");
const documentEmail = read("../src/lib/trade-quote-email.ts");
const documentPdf = read("../src/lib/trade-quote-pdf.mjs");
const documentPdfRoute = read("../src/app/api/quote-review/[token]/pdf/route.ts");
const issuedDocumentServer = read("../src/lib/trade-quote-issued-pdf-server.ts");
const providerDelivery = read("../src/lib/service-reminder-delivery.ts");
const quoteDeliveryServer = read("../src/lib/trade-quote-delivery-server.ts");
const deliveryWorker = read("../worker/index.ts");

const apply = (db, sql) => {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
};

test("quote decimals convert to bounded integers without floating point money", () => {
  assert.equal(quantityToMilli("1.125"), 1125);
  assert.equal(dollarsToCents("1234.56"), 123456);
  assert.equal(dollarsToCents("-12.34", true), -1234);
  assert.throws(() => quantityToMilli("1.0001"), /INVALID_DECIMAL/);
  assert.throws(() => dollarsToCents("1.001"), /INVALID_DECIMAL/);
});

test("line and quote totals use deterministic half-away rounding in integer cents", () => {
  assert.deepEqual(calculateTradeQuoteLine(333, 100, "gst"), { subtotalCents: 33, taxCents: 3, totalCents: 36 });
  assert.deepEqual(calculateTradeQuoteLine(1000, -1005, "gst"), { subtotalCents: -1005, taxCents: -101, totalCents: -1106 });
  const quote = normaliseTradeQuoteLines([
    { lineType: "product", description: "Battery", quantity: "2", unitPrice: "1000.00", taxCode: "gst" },
    { lineType: "labour", description: "Installation", quantity: "4.5", unitPrice: "120.00", taxCode: "gst" },
    { lineType: "adjustment", description: "Package discount", quantity: "1", unitPrice: "-100.00", taxCode: "gst" },
  ], (value) => String(value));
  assert.deepEqual({ subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents }, { subtotalCents: 244000, taxCents: 24400, totalCents: 268400 });
});

test("the additive migration creates one versioned direct quote model", () => {
  for (const table of ["trade_crm_quotes", "trade_crm_quote_versions", "trade_crm_quote_items", "trade_crm_quote_acceptances"]) {
    assert.equal((schema.match(new RegExp(`sqliteTable\\("${table}"`, "g")) || []).length, 1);
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const index of ["trade_crm_quotes_owner_work_idx", "trade_crm_quote_versions_quote_version_idx", "trade_crm_quote_versions_acceptance_email_idx", "trade_crm_quote_items_version_position_idx", "trade_crm_quote_acceptances_version_idx"]) assert.match(migration, new RegExp(index));
});

test("optioned quotes add immutable choices and exact selection evidence", () => {
  assert.match(schema, /sqliteTable\("trade_crm_quote_choices"/);
  assert.match(optionsMigration, /CREATE TABLE `trade_crm_quote_choices`/);
  for (const column of ["section_heading", "quote_choice_id", "selected_choice_ids_json", "selected_subtotal_cents", "selected_tax_cents", "selected_total_cents", "selection_summary"]) assert.match(optionsMigration, new RegExp(column));
  assert.equal(normaliseQuoteChoices([
    { clientKey: "good", kind: "package", groupKey: "packages", name: "Good", lines: [{}] },
    { clientKey: "better", kind: "package", groupKey: "packages", name: "Better", recommended: true, lines: [{}] },
    { clientKey: "best", kind: "package", groupKey: "packages", name: "Best", lines: [{}] },
  ], (value) => String(value || "")).length, 3);
  const selected = calculateQuoteSelection({ subtotalCents: 10_000, taxCents: 1_000, totalCents: 11_000 }, [
    { id: "good", kind: "package", groupKey: "packages", name: "Good", subtotalCents: 20_000, taxCents: 2_000, totalCents: 22_000 },
    { id: "better", kind: "package", groupKey: "packages", name: "Better", subtotalCents: 30_000, taxCents: 3_000, totalCents: 33_000 },
    { id: "best", kind: "package", groupKey: "packages", name: "Best", subtotalCents: 40_000, taxCents: 4_000, totalCents: 44_000 },
    { id: "surge", kind: "addon", groupKey: "surge", name: "Surge protection", subtotalCents: 5_000, taxCents: 500, totalCents: 5_500 },
  ], ["better", "surge"]);
  assert.deepEqual({ subtotal: selected.subtotalCents, tax: selected.taxCents, total: selected.totalCents }, { subtotal: 45_000, tax: 4_500, total: 49_500 });
});

test("document totals include one default required choice and exclude optional extras", () => {
  const packageOnly = tradeQuoteDocumentDisplayTotals({
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    choices: [
      { id: "good", kind: "package", groupKey: "system", subtotalCents: 20_000, taxCents: 2_000, totalCents: 22_000 },
      { id: "better", kind: "package", groupKey: "system", recommended: true, subtotalCents: 30_000, taxCents: 3_000, totalCents: 33_000 },
      { id: "monitor", kind: "addon", groupKey: "monitor", recommended: true, subtotalCents: 5_000, taxCents: 500, totalCents: 5_500 },
    ],
  });
  assert.deepEqual(
    { choices: packageOnly.selectedChoiceIds, subtotal: packageOnly.subtotalCents, tax: packageOnly.taxCents, total: packageOnly.totalCents },
    { choices: ["better"], subtotal: 30_000, tax: 3_000, total: 33_000 },
  );

  const includedPlusChoice = tradeQuoteDocumentDisplayTotals({
    subtotalCents: 10_000,
    taxCents: 1_000,
    totalCents: 11_000,
    choices: [
      { id: "standard", kind: "package", groupKey: "system", subtotalCents: 20_000, taxCents: 2_000, totalCents: 22_000 },
      { id: "premium", kind: "package", groupKey: "system", recommended: true, subtotalCents: 40_000, taxCents: 4_000, totalCents: 44_000 },
    ],
  });
  assert.deepEqual(
    { choices: includedPlusChoice.selectedChoiceIds, subtotal: includedPlusChoice.subtotalCents, tax: includedPlusChoice.taxCents, total: includedPlusChoice.totalCents },
    { choices: ["premium"], subtotal: 50_000, tax: 5_000, total: 55_000 },
  );

  const groupedDefaults = tradeQuoteDocumentDisplayTotals({
    subtotalCents: 10_000,
    taxCents: 1_000,
    totalCents: 11_000,
    choices: [
      { id: "first-package", kind: "package", groupKey: "system", subtotalCents: 20_000, taxCents: 2_000, totalCents: 22_000 },
      { id: "second-package", kind: "package", groupKey: "system", subtotalCents: 30_000, taxCents: 3_000, totalCents: 33_000 },
      { id: "standard-control", kind: "choose_one", groupKey: "control", subtotalCents: 5_000, taxCents: 500, totalCents: 5_500 },
      { id: "recommended-control", kind: "choose_one", groupKey: "control", recommended: true, subtotalCents: 8_000, taxCents: 800, totalCents: 8_800 },
      { id: "optional-monitor", kind: "addon", groupKey: "monitor", recommended: true, subtotalCents: 4_000, taxCents: 400, totalCents: 4_400 },
    ],
  });
  assert.deepEqual(
    {
      choices: groupedDefaults.selectedChoiceIds,
      subtotal: groupedDefaults.subtotalCents,
      tax: groupedDefaults.taxCents,
      total: groupedDefaults.totalCents,
    },
    {
      choices: ["first-package", "recommended-control"],
      subtotal: 38_000,
      tax: 3_800,
      total: 41_800,
    },
  );
});

test("quote PDF generation falls back to built-in fonts and supports current themes", async () => {
  const bytes = await createTradeQuotePdfBytes({
    schemaVersion: "trade-quote-document-v1",
    capturedAt: "2026-08-04T00:00:00.000Z",
    quoteId: "quote-1",
    quoteVersionId: "version-1",
    quoteNumber: "Q-TLJ-TEST",
    versionNumber: 1,
    work: { id: "work-1", number: "TLJ-TEST", title: "Heat pump installation" },
    customer: { id: "customer-1", number: "CUS-1", name: "Test Customer", email: "test@example.com" },
    site: {
      id: "site-1",
      label: "Primary site",
      addressLine1: "1 Test Street",
      addressLine2: "",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
      summary: "1 Test Street, Melbourne VIC 3000",
    },
    business: {
      name: "Test Electrical",
      email: "office@example.com",
      phone: "0400000000",
      abn: "12345678901",
      website: "https://example.com",
      address: "2 Office Street, Melbourne VIC 3000",
      themeKey: "rose_plum",
      borderStyle: "soft",
      logo: null,
      banner: null,
      quoteEmailSubjectTemplate: "{business_name} sent quote {quote_number}",
      quoteEmailIntro: "Thank you for the opportunity to quote.",
    },
    acceptanceEmail: "test@example.com",
    subtotalCents: 100000,
    taxCents: 10000,
    totalCents: 110000,
    customerMessage: "Thank you for the opportunity to quote.",
    terms: "Installation is subject to safe site access.",
    validUntil: "2026-08-31",
    consentStatement: "I accept this exact quote.",
    issuedAt: "2026-08-04T00:00:00.000Z",
    items: [{
      id: "line-1",
      description: "Heat pump installation",
      quantityMilli: 1000,
      unitPriceCents: 100000,
      subtotalCents: 100000,
      taxCents: 10000,
      totalCents: 110000,
      sectionHeading: "Included work",
    }],
    choices: [],
  });
  assert.ok(bytes.byteLength > 1_000);
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString("ascii"), "%PDF");
});

test("secure quote sharing is revocable, expiring and commercially provider neutral", () => {
  for (const table of ["trade_crm_quote_links", "trade_crm_quote_events", "trade_crm_quote_questions", "trade_crm_quote_deliveries"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(sharingMigration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const evidence of ["token_hash", "encrypted_token", "token_issue", "signer_name", "commercial_reference", "currency"]) assert.match(sharingMigration, new RegExp(evidence));
  assert.doesNotMatch(commercial, /stripe|square|paymentAdapters|accountingAdapters/i);
  assert.match(commercial, /currency: "AUD"/);
  assert.match(commercial, /subtotalCents: Math\.trunc/);
  assert.match(linkRoute, /calculateQuoteSelection/);
  assert.match(linkRoute, /providerNeutralCommercialRecord/);
  assert.match(installerRoute, /SET status = 'revoked', token_hash = '', encrypted_token = ''/);
  const decidedLinkUpdate = linkRoute.slice(
    linkRoute.indexOf("UPDATE trade_crm_quote_links"),
    linkRoute.indexOf("UPDATE trade_crm_job_details"),
  );
  assert.match(decidedLinkUpdate, /SET status = \?, encrypted_token = '', updated_at = \?/);
  assert.match(decidedLinkUpdate, /token_issue = \?[\s\S]*token_hash = \?[\s\S]*status = 'active'/);
  assert.doesNotMatch(decidedLinkUpdate, /SET[\s\S]*token_hash = ''/);
  assert.match(installerRoute, /TLINK_SMS_SENDER_APPROVED !== "true"/);
  assert.match(installerRoute, /status = 'expired', token_hash = '', encrypted_token = ''/);
  assert.match(customerRoute, /account-decision:/);
});

test("installer quote actions preserve direct-customer ownership and immutable issued versions", () => {
  for (const boundary of ["requireInstallerTeamAccess", "canManageQuotes", "assignedJob", "sameOrigin", "d.customer_source IN \\('trade_owned', 'public_lead_released'\\)", "w.firebase_uid = ?"]) assert.match(installerRoute, new RegExp(boundary));
  assert.doesNotMatch(installerRoute, /access\.role|canDispatch\(access\)/);
  assert.match(installerRoute, /action === "save_draft"/);
  assert.match(installerRoute, /current\.status === "issued"/);
  assert.match(installerRoute, /status = 'superseded'/);
  assert.match(installerRoute, /versionNumber = Number\(current\.version_number\) \+ 1/);
  assert.match(installerRoute, /action === "issue_quote"/);
  assert.match(installerRoute, /status = 'issued'/);
  assert.match(installerRoute, /quote_status = 'issued'/);
  assert.match(installerRoute, /INSERT OR IGNORE INTO trade_crm_quote_deliveries[\s\S]*?'queued'/);
  assert.doesNotMatch(installerRoute, /sendServiceReminderProviderMessage/);
  assert.match(quoteDeliveryServer, /sendServiceReminderProviderMessage/);
  assert.match(quoteDeliveryServer, /SET status = 'provider_accepted'/);
  assert.match(deliveryWorker, /drainTradeQuoteDeliveries\(\{ db: getD1\(\) \}\)/);
  assert.doesNotMatch(installerRoute, /quote_status = 'sent'/);
  assert.match(installerRoute, /authorisedEmails/);
  assert.match(installerRoute, /publicLeadQuoteAccessFingerprint/);
  assert.match(installerRoute, /d\.accepted_disclosure_snapshot, d\.accepted_disclosure_sha256, d\.accepted_disclosure_at/);
  const directJobRead = installerRoute.slice(installerRoute.indexOf("async function directJob"), installerRoute.indexOf("async function authorisedEmails"));
  assert.doesNotMatch(directJobRead, /trade_opportunities|trade_opportunity_matches|public_trade_lead_contact_releases|public_trade_lead_quote_preparations/);
  assert.match(installerRoute, /PUBLIC_LEAD_QUOTE_ACCESS_ENDED/);
});

test("issued quote delivery is immutable, branded, attached and retry safe", () => {
  for (const column of [
    "customer_message",
    "document_snapshot_json",
    "recipient_role",
    "subject_snapshot",
    "email_content_sha256",
    "attachment_filename",
    "attachment_sha256",
  ]) assert.match(documentMigration, new RegExp(column));
  for (const boundary of [
    "buildTradeQuoteDocumentSnapshot",
    "document_snapshot_json",
    "parseTradeQuoteDocumentSnapshot",
    "QUOTE_DOCUMENT_INVALID",
    "idempotencyKey",
    "tradeQuoteEmailContentSha256",
    "storeTradeQuoteIssuedPdf",
    "issuedTradeQuotePdf",
  ]) assert.match(installerRoute, new RegExp(boundary));
  for (const column of [
    "recipient_email_sha256",
    "provider_idempotency_key",
    "queued_at",
    "next_attempt_at",
    "lease_expires_at",
    "failure_code",
  ]) assert.match(deliveryOutboxMigration, new RegExp(column));
  assert.match(deliveryRendererMigration, /email_renderer_revision.*DEFAULT 1 NOT NULL/);
  assert.match(schema, /emailRendererRevision: integer\("email_renderer_revision"\)\.notNull\(\)\.default\(1\)/);
  for (const boundary of [
    "status = 'sending'",
    "status = 'failed'",
    "tradeQuotePdfBase64",
    "provider_accepted",
  ]) assert.match(quoteDeliveryServer, new RegExp(boundary));
  const issueBlock = installerRoute.slice(
    installerRoute.indexOf('action === "issue_quote"'),
    installerRoute.indexOf('["replace_link", "revoke_link", "send_quote", "retry_quote_delivery", "answer_question"]'),
  );
  assert.ok(issueBlock.includes("renderQuotePdfOrThrow(documentSnapshot"));
  assert.ok(issueBlock.includes("INSERT INTO trade_crm_quote_links"));
  assert.ok(
    issueBlock.indexOf("renderQuotePdfOrThrow(documentSnapshot") <
      issueBlock.indexOf("INSERT INTO trade_crm_quote_links"),
    "the PDF must render successfully before the issued link is committed",
  );
  assert.match(installerRoute, /QUOTE_PDF_UNAVAILABLE/);
  assert.match(installerRoute, /X-TLink-Request-Id/);
  assert.match(quoteDeliveryServer, /attachments: \[\{/);
  assert.match(quoteDeliveryServer, /replyTo: content\.replyTo/);
  assert.match(quoteDeliveryServer, /idempotencyKey: String\(row\.provider_idempotency_key \|\| row\.idempotency_key\)/);
  assert.match(documentEmail, /tradeQuoteDocumentDisplayTotals/);
  assert.match(documentEmail, /html:/);
  assert.match(documentPdf, /tradeQuoteDocumentDisplayTotals/);
  assert.match(documentPdfRoute, /issuedTradeQuotePdf/);
  assert.doesNotMatch(documentPdfRoute, /renderTradeQuotePdf/);
  assert.match(providerDelivery, /attachments\?: Array<\{ filename: string; content: string; contentType: string \}>/);
  assert.match(providerDelivery, /replyTo\?: string/);
  assert.match(documentServer, /QUOTE_DOCUMENT_SNAPSHOT_INVALID/);
  assert.match(
    documentServer,
    /const snapshot = storedSnapshot\s*\? parseTradeQuoteDocumentSnapshot\(storedSnapshot\)\s*:\s*await buildTradeQuoteDocumentSnapshot/,
  );
  assert.match(
    documentServer,
    /!snapshot \|\|[\s\S]*snapshot\.quoteId !== row\.quote_id[\s\S]*snapshot\.quoteVersionId !== row\.quote_version_id[\s\S]*snapshot\.work\.id !== row\.work_order_id[\s\S]*snapshot\.customer\.id !== row\.crm_customer_id[\s\S]*QUOTE_DOCUMENT_SNAPSHOT_INVALID/,
  );
  assert.match(
    documentServer,
    /options\.requireCurrentTradeAccess[\s\S]*verifiedTradeAccountPredicate\("trade"\)[\s\S]*trade\.account_status = 'active'/,
  );
  assert.match(
    linkRoute,
    /authoriseTradeQuoteDecisionLink\(token, \{\s*requireCurrentTradeAccess: true/,
  );
  assert.match(
    decisionServer,
    /options\.requireCurrentTradeAccess[\s\S]*verifiedTradeAccountPredicate\("trade"\)/,
  );
  for (const evidence of [
    "decision_request_id",
    "decision_payload_sha256",
    "result_invoice_id",
    "invoice_creation_status",
  ]) assert.match(acceptanceInvoiceMigration, new RegExp(evidence));
  for (const durableBoundary of [
    "buildAcceptedInvoiceSnapshot",
    "exactQuoteDecisionReplay",
    "trade_crm_accepted_invoices",
    "decision_payload_sha256",
    "payment_snapshot_json",
  ]) assert.match(`${linkRoute}\n${decisionServer}`, new RegExp(durableBoundary));
  assert.match(acceptanceInvoiceMigration, /CREATE UNIQUE INDEX `trade_crm_quote_acceptances_decision_request_idx`/);
  assert.match(acceptanceInvoiceMigration, /CREATE UNIQUE INDEX `trade_crm_accepted_invoices_acceptance_idx`/);
  assert.match(acceptanceInvoiceMigration, /CREATE UNIQUE INDEX `trade_crm_accepted_invoices_handoff_idx`/);
  assert.match(acceptanceInvoiceMigration, /CREATE UNIQUE INDEX `trade_crm_accepted_invoices_quote_version_idx`/);
  assert.match(acceptedInvoice, /documentLabel: "Invoice"/);
  assert.doesNotMatch(acceptedInvoice, /documentLabel: "Tax Invoice"/);
  assert.match(documentServer, /X-TLink-Request-Id/);
  assert.match(documentPdfRoute, /tradeQuoteTokenErrorResponse\(error, "pdf"\)/);
});

test("issued quote PDFs retain exact bytes and legacy backfill fails closed", () => {
  for (const column of [
    "issued_pdf_object_key",
    "issued_pdf_sha256",
    "issued_pdf_size_bytes",
  ]) {
    assert.match(issuedDocumentMigration, new RegExp(column));
    assert.match(installerRoute, new RegExp(column));
    assert.match(issuedDocumentServer, new RegExp(column));
  }
  assert.match(
    issuedDocumentServer,
    /return \{ kind: "quote", documentId, revision \}/,
  );
  assert.match(
    issuedDocumentServer,
    /readImmutableIssuedPdf\(reference, identity\)/,
  );
  assert.match(
    issuedDocumentServer,
    /SELECT quote_id, version_number[\s\S]*WHERE id = \? AND version_number = \?[\s\S]*const identity = quotePdfIdentity\(row\)[\s\S]*storeImmutableIssuedPdf\(\{\s*\.\.\.identity,/,
  );
  const issueBlock = installerRoute.slice(
    installerRoute.indexOf('action === "issue_quote"'),
    installerRoute.indexOf(
      '["replace_link", "revoke_link", "send_quote", "retry_quote_delivery", "answer_question"]',
    ),
  );
  assert.ok(
    issueBlock.indexOf("storeTradeQuoteIssuedPdf") <
      issueBlock.indexOf("SET status = 'issued'"),
    "exact PDF bytes must be stored before the quote is marked issued",
  );
  assert.match(
    issueBlock,
    /document_snapshot_json = \?, issued_pdf_object_key = \?, issued_pdf_sha256 = \?,[\s\S]*issued_pdf_size_bytes = \?/,
  );
  assert.match(
    issuedDocumentServer,
    /deliveryRows\.results\.length &&[\s\S]*!recordedHashes\.every\([\s\S]*SHA256_PATTERN\.test\(hash\) && hash === legacySha256[\s\S]*QUOTE_ISSUED_PDF_MISMATCH/,
  );
  assert.doesNotMatch(
    issuedDocumentServer,
    /WHERE quote_version_id = \? AND firebase_uid = \?[\s\S]{0,80}attachment_sha256 != ''/,
  );
  assert.match(
    issuedDocumentServer,
    /expectedSha256: deliveryRows\.results\.length \? legacySha256 : undefined/,
  );
  assert.match(
    issuedDocumentServer,
    /status = 'issued'[\s\S]*issued_pdf_object_key = ''[\s\S]*issued_pdf_sha256 = ''[\s\S]*issued_pdf_size_bytes = 0/,
  );
  assert.match(
    issuedDocumentServer,
    /concurrent request may have won the conditional backfill[\s\S]*readVerifiedIssuedPdf\(racedReference, racedIdentity\)/,
  );
  const sendBranch = installerRoute.indexOf('["replace_link", "revoke_link", "send_quote", "retry_quote_delivery", "answer_question"]');
  const sendEmailContent = installerRoute.indexOf("const emailContent = await buildTradeQuoteEmailForRevision", sendBranch);
  const sendPdfBlock = installerRoute.slice(
    sendEmailContent,
    installerRoute.indexOf(
      "const attachmentFilename",
      sendEmailContent,
    ),
  );
  assert.match(sendPdfBlock, /issuedTradeQuotePdf/);
  assert.doesNotMatch(sendPdfBlock, /renderQuotePdfOrThrow/);
});

test("customer decisions require verified matching identity and retain exact acceptance evidence", () => {
  for (const boundary of ["identity.emailVerified", "customer_accounts", "v.acceptance_email = ?", "d.customer_source = 'trade_owned'", "v.status = 'issued'", "v.version_number = q.current_version_number"]) assert.match(customerRoute, new RegExp(boundary));
  for (const evidence of ["customer_firebase_uid", "actor_email", "actor_email_verified", "actor_auth_time", "actor_sign_in_provider", "consent_statement", "selected_choice_ids_json", "selected_total_cents", "selection_summary", "decided_at"]) assert.match(customerRoute, new RegExp(evidence));
  assert.match(customerRoute, /body.consentConfirmed !== true/);
  assert.match(customerRoute, /calculateQuoteSelection/);
  assert.match(customerRoute, /QUOTE_EXPIRED/);
  assert.match(customerRoute, /quote_status = \?/);
  assert.doesNotMatch(customerRoute, /trade_opportunities|customer_project_quotes/);
});

test("quote SQL compiles against its production migration dependencies", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_complex_absorbing_man.sql", "0001_futuristic_frog_thor.sql", "0002_closed_korg.sql", "0004_mixed_chat.sql", "0005_yielding_gideon.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql", "0019_melodic_unus.sql", "0020_lying_stick.sql", "0021_mushy_gamora.sql", "0022_worried_sleepwalker.sql", "0025_dizzy_spot.sql", "0047_customer_service_site_foundation.sql", "0050_versioned_trade_quotes.sql", "0057_customer_property_arrivals.sql", "0058_trade_contact_arrival_handoff.sql", "0064_trade_price_book.sql", "0065_trade_job_packets.sql", "0066_optioned_trade_quotes.sql", "0067_secure_quote_sharing.sql", "0068_accepted_quote_handoff.sql", "0069_ready_jobs_supplier_profiles.sql", "0070_frictionless_team_roster.sql", "0071_job_execution_progress.sql", "0120_trade_business_identity_and_quote_delivery.sql", "0126_public_trade_lead_contact_release.sql", "0127_public_trade_lead_customer_address.sql", "0128_public_plan_quote_preparation.sql", "0132_public_lead_accepted_disclosure.sql"]) apply(db, fs.readFileSync(new URL(file, directory), "utf8"));
  db.exec("ALTER TABLE trade_work_orders ADD service_categories text DEFAULT '[]' NOT NULL");
  apply(db, issuedDocumentMigration.split("--> statement-breakpoint").slice(0, 3).join("--> statement-breakpoint"));
  apply(db, deliveryOutboxMigration);
  apply(db, deliveryRendererMigration);
  apply(db, acceptanceInvoiceMigration);
  for (const [label, source] of [["installer", installerRoute], ["customer", customerRoute], ["secure link", linkRoute]]) {
    const queries = [...source.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1]).filter((sql) => !sql.includes("${"));
    assert.ok(queries.length > 5, `${label} route should expose compiled prepared statements`);
    for (const sql of queries) assert.doesNotThrow(() => db.prepare(sql), `${label} SQL should compile: ${sql.slice(0, 70)}`);
  }
});

test("installer and customer interfaces expose the version and consent contract", () => {
  for (const copy of ["Issued versions are immutable", "Build Good, Better, Best", "Add optional extra", "Add choose-one pair", "Send quote to", "Save as next draft", "Preview and send", "Confirm and submit email", "Internal only", "Quote history", "Retry email"]) assert.match(installerUi, new RegExp(copy));
  const sendFlow = installerUi.slice(installerUi.indexOf("async function sendPreviewedQuote"), installerUi.indexOf("async function addQuoteRecipient"));
  assert.match(sendFlow, /action: "save_draft"/);
  assert.match(sendFlow, /if \(!saved\.draftVersionId\)/);
  assert.match(sendFlow, /action: "issue_quote"[\s\S]*?quoteVersionId: saved\.draftVersionId[\s\S]*?consentConfirmed: true/);
  assert.doesNotMatch(sendFlow, /action: "send_quote"/);
  const replay = sendFlow.indexOf("if (pendingIssueVersionId)");
  const save = sendFlow.indexOf('action: "save_draft"');
  assert.ok(replay >= 0 && replay < save, "a lost issue response must replay the retained exact version before another save");
  assert.match(sendFlow.slice(replay, save), /quoteVersionId: pendingIssueVersionId[\s\S]*?consentConfirmed: true/);
  assert.match(sendFlow, /setPendingIssueVersionId\(saved\.draftVersionId\)/);
  assert.match(sendFlow, /quoteDeliveryOutcome\(issued\.delivery, "Quote saved and issued\."\)/);
  assert.match(installerUi, /tradeQuoteDocumentDisplayTotals\(\{[\s\S]*?groupKey: choice\.groupKey[\s\S]*?recommended: choice\.recommended/);
  assert.match(installerUi, /sendPreview\.displayTotals\.subtotalCents[\s\S]*?sendPreview\.displayTotals\.taxCents[\s\S]*?sendPreview\.displayTotals\.label[\s\S]*?sendPreview\.displayTotals\.totalCents/);
  assert.doesNotMatch(installerUi, /<dl><div><dt>Included before choices<\/dt>[\s\S]*?sendPreview\.base\.totalCents/);
  for (const modalBoundary of [
    "previewTriggerRef",
    "previewDialogRef",
    'event.key === "Escape"',
    'event.key !== "Tab"',
    "event.shiftKey",
    "document.body.style.overflow = \"hidden\"",
    "returnFocus.focus({ preventScroll: true })",
  ]) assert.match(installerUi, new RegExp(modalBoundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(installerUi, /consentConfirmed: true/);
  for (const key of ["sending", "accepted", "delivered", "attention"]) assert.match(installerUi, new RegExp(`presentation\\?\\.key === "${key}"`));
  assert.match(installerUi, /latestDelivery\.presentation\.label/);
  assert.match(installerUi, /const label = cleanDeliveryText\(delivery\?\.presentation\?\.label, 120\)/);
  assert.doesNotMatch(installerUi, /setMessage\("Quote saved and issued\. The email provider accepted it for delivery/);
  assert.doesNotMatch(installerUi, /Issue for customer review/);
  for (const copy of ["Direct customer agreements", "Clear choices, one confirmed total", "Accept selected quote", "verified account evidence", "This version has been superseded", "selectedChoiceIds"]) assert.match(customerUi, new RegExp(copy));
  for (const hidden of ["unitCostCentsExGst", "marginBasisPoints", "markupBasisPoints"]) assert.doesNotMatch(customerUi, new RegExp(hidden));
  assert.match(crm, /<TradeQuotePanel/);
  assert.doesNotMatch(crm, /name="quotedValue"|name="quoteStatus"/);
  assert.match(dashboard, /href="\/account\/quotes"/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.trade-quote-line \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/);
  assert.match(styles, /\.trade-quote-field > span, \.trade-quote-description > span \{[^}]*display: block;/);
  assert.match(styles, /\.trade-quote-send-preview/);
  for (const copy of ["Download PDF", "Ask the trade business", "Type your name to sign", "Calculated and checked again by the server", "Accept for"]) assert.match(linkUi, new RegExp(copy));
  assert.doesNotMatch(linkUi, /window\.print/);
  for (const copy of ["One secure quote link", "Copy link", "Email quote", "Replace link", "Revoke link", "Quote activity"]) assert.match(installerUi, new RegExp(copy));
  assert.match(styles, /@media print/);
});

test("installer quote controls use plain totals and a consistently styled PDF action", () => {
  assert.match(installerUi, /<section className="trade-quote-base"><header><div><strong>Quote items<\/strong>/);
  assert.match(installerUi, /className="trade-quote-totals"><div><span>Subtotal<\/span>[\s\S]*?<span>GST<\/span>[\s\S]*?<span>Total<\/span>/);
  assert.doesNotMatch(installerUi, /Always included|Your base scope|GST on included|Included total/);
  assert.match(installerUi, /className="trade-quote-share-actions"[\s\S]*?<a href=\{quote\.link\.pdfUrl\} target="_blank" rel="noreferrer">Download issued PDF<\/a>/);
  assert.match(styles, /\.trade-quote-share-actions a,[\s\S]*?text-decoration: none/);
  assert.match(installerUi, /line\.sectionHeading/);
});

test("saved quote row order is persisted monotonically and rendered without global section regrouping", () => {
  assert.match(installerRoute, /resolved\.calculated\.lines\.forEach\(\(line, index\) =>/);
  assert.match(installerRoute, /startPosition \+ index/);
  assert.match(installerRoute, /ORDER BY quote_version_id, position/);
  const items = [
    { description: "A first", sectionHeading: "A" },
    { description: "B middle", sectionHeading: "B" },
    { description: "A last", sectionHeading: "A" },
  ];
  const sections = contiguousTradeQuoteSections(items);
  assert.deepEqual(sections.map(({ heading }) => heading), ["A", "B", "A"]);
  assert.deepEqual(sections.flatMap(({ items: rows }) => rows.map(({ description }) => description)), ["A first", "B middle", "A last"]);
  assert.match(documentPdf, /const includedItems = snapshot\.items\?\.filter\(\(item\) => !isFinalPercentDiscount\(item\)\)/);
  assert.match(documentPdf, /const sections = contiguousTradeQuoteSections\(includedItems\)/);
  assert.doesNotMatch(documentPdf, /new Set\([\s\S]*?snapshot\.items\.map/);
});

test("customer quote questions are visible and actionable before quote editing", () => {
  assert.match(installerUi, /question needs/);
  assert.match(installerUi, />Answer<\/button>/);
  const returnedPanel = installerUi.slice(installerUi.indexOf("return <section className=\"trade-quote-panel\">"));
  assert.ok(returnedPanel.indexOf('id="quote-questions"') < returnedPanel.indexOf('className="trade-quote-base"'));
  assert.match(styles, /\.trade-quote-questions\.needs-attention/);
});

test("direct quote copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${installerRoute}\n${customerRoute}\n${linkRoute}\n${installerUi}\n${customerUi}\n${linkUi}`, /[\u2013\u2014]/);
});
