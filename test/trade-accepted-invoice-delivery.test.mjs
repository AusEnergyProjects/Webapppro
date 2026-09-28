import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as pdfLib from "pdf-lib";
import * as layout from "../src/lib/trade-document-pdf-layout.mjs";
import * as accepted from "../src/lib/trade-accepted-invoice.ts";
import * as reminder from "../src/lib/service-reminder-delivery.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function compile(source, modules = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  Function("require", "exports", code)((id) => { assert.ok(id in modules, `Unexpected import ${id}`); return modules[id]; }, exports);
  return exports;
}
const accessSource = read("../src/lib/trade-access-server.ts");
const access = compile(accessSource.slice(accessSource.indexOf("function checkedSqlAlias"), accessSource.indexOf("export async function tradeAccountProjection")));
const pdf = compile(read("../src/lib/trade-accepted-invoice-pdf-server.ts"), { "pdf-lib": pdfLib, "./trade-document-pdf-layout.mjs": layout });
const delivery = compile(read("../src/lib/trade-accepted-invoice-delivery-server.ts"), {
  "./trade-accepted-invoice": accepted, "./trade-access-server": access,
  "./service-reminder-delivery": reminder, "./trade-accepted-invoice-pdf-server": pdf,
});

function d1(database) {
  return { prepare(sql) {
    const statement = database.prepare(sql); let values = [];
    const result = { bind(...args) { values = args; return result; }, async first() { return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values), success: true, meta: {} }; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) }, success: true }; } };
    return result;
  } };
}

async function fixture(t, options = {}) {
  const database = new DatabaseSync(":memory:"); t.after(() => database.close());
  database.exec(`CREATE TABLE trade_crm_quote_acceptances (id text PRIMARY KEY, quote_link_id text, token_issue integer,
    firebase_uid text, quote_id text, quote_version_id text, work_order_id text, crm_customer_id text, decision text);
    CREATE TABLE trade_crm_quote_links (id text PRIMARY KEY, quote_id text, quote_version_id text, work_order_id text,
      firebase_uid text, crm_customer_id text, token_issue integer, status text);
    CREATE TABLE trade_crm_quote_versions (id text PRIMARY KEY, quote_id text, firebase_uid text, acceptance_email text, document_snapshot_json text);
    CREATE TABLE trade_work_orders (id text PRIMARY KEY, firebase_uid text, source_type text, record_status text);
    CREATE TABLE trade_crm_job_details (work_order_id text, firebase_uid text, crm_customer_id text, customer_source text,
      accepted_disclosure_sha256 text, accepted_disclosure_snapshot text, invoiced_value_cents integer, paid_value_cents integer, invoice_status text);
    CREATE TABLE trade_crm_customers (id text PRIMARY KEY, firebase_uid text, email text, record_status text);
    CREATE TABLE trade_crm_customer_contacts (customer_id text, firebase_uid text, email text, record_status text);
    CREATE TABLE trade_crm_quick_invoices (firebase_uid text, work_order_id text, status text);
    CREATE TABLE trade_crm_accounting_documents (firebase_uid text, work_order_id text, document_type text, status text, commercial_handoff_id text);
    CREATE TABLE trade_crm_quote_deliveries (firebase_uid text, crm_customer_id text, channel text, status text);
    CREATE TABLE trade_email_submissions (owner_uid text, request_key text, status text, provider text, provider_message_id text, PRIMARY KEY(owner_uid, request_key));
    CREATE TABLE trade_accounts (firebase_uid text PRIMARY KEY, business_name text, partner_type text, account_status text,
      verification_status text, abn text, verified_abn text, verification_review_id text, verification_reviewed_at text, verification_reviewed_by_uid text,
      invoice_payment_account_name text, invoice_payment_bsb text, invoice_payment_account_number text);
    CREATE TABLE trade_account_verification_reviews (id text, firebase_uid text, business_name text, partner_type text, abn text,
      decision text, review_method text, reviewed_by_uid text, reviewed_at text);`);
  database.exec(read("../drizzle/0138_trade_quote_acceptance_invoice.sql").replaceAll("--> statement-breakpoint", ""));
  database.exec(read("../drizzle/0205_accepted_invoice_email_delivery.sql").replaceAll("--> statement-breakpoint", ""));
  const now = new Date();
  const built = await accepted.buildAcceptedInvoiceSnapshot({ invoiceId: "invoice-1", invoiceNumber: "INV-001", acceptanceId: "accept-1",
    commercialHandoffId: "handoff-1", quoteId: "quote-1", quoteVersionId: "version-1", workOrderId: "work-1", firebaseUid: "owner-1", crmCustomerId: "customer-1",
    issuedAt: now.toISOString(), dueAt: new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10),
    scope: [ { lineId: "product", lineType: "product", section: "Included", description: "Solar system", quantityMilli: 1000, subtotalCents: 10000, taxCents: 1000, totalCents: 11000 },
      { lineId: "credit", lineType: "adjustment", section: "Credit", description: "Certificate credit", quantityMilli: 1000, subtotalCents: -1000, taxCents: -100, totalCents: -1100 } ],
    totals: { subtotalCents: 9000, taxCents: 900, totalCents: 9900 },
    business: { name: "Example Trade", email: "business@example.com", phone: "0400000000", abn: "51824753556", address: "Melbourne" },
    customer: { name: "Customer", email: "primary@example.com", number: "C001", phone: "" },
    site: { label: "Site", addressLine1: "1 Main St", addressLine2: "", suburb: "Melbourne", state: "VIC", postcode: "3000", summary: "1 Main St, Melbourne" },
    work: { number: "W001", title: "Solar installation" }, payment: { accountName: "Example Trade", bsb: "123-456", accountNumber: "123456789", reference: "INV-001", terms: "Pay within seven days." },
    ...options.input });
  database.prepare(`INSERT INTO trade_crm_accepted_invoices (id, acceptance_id, commercial_handoff_id, quote_id, quote_version_id, work_order_id,
    firebase_uid, crm_customer_id, invoice_number, source_snapshot_sha256, document_snapshot_json, subtotal_cents, tax_cents, total_cents,
    due_at, status, issue_blocker_code, payment_snapshot_json, created_at, updated_at) VALUES
    ('invoice-1','accept-1','handoff-1','quote-1','version-1','work-1','owner-1','customer-1','INV-001',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(built.sourceSnapshotSha256, built.documentSnapshotJson, built.subtotalCents, built.taxCents, built.totalCents,
      built.dueAt, built.status, built.issueBlockerCode, built.paymentSnapshotJson, now.toISOString(), now.toISOString());
  database.exec(`INSERT INTO trade_crm_quote_acceptances (id,quote_link_id,token_issue,firebase_uid,quote_id,quote_version_id,work_order_id,crm_customer_id,decision,result_invoice_id)
    VALUES ('accept-1','link-1',1,'owner-1','quote-1','version-1','work-1','customer-1','accepted','invoice-1');
    INSERT INTO trade_crm_quote_links VALUES ('link-1','quote-1','version-1','work-1','owner-1','customer-1',1,'accepted');
    INSERT INTO trade_work_orders VALUES ('work-1','owner-1','direct','active');
    INSERT INTO trade_crm_job_details VALUES ('work-1','owner-1','customer-1','trade_owned','','{}',9900,0,'issued');
    INSERT INTO trade_crm_customers VALUES ('customer-1','owner-1','primary@example.com','active');
    INSERT INTO trade_crm_customer_contacts VALUES ('customer-1','owner-1','accepted@example.com','active');
    INSERT INTO trade_accounts VALUES ('owner-1','Example Trade','installer','active','approved','51824753556','51824753556','review-1','2026-09-01','admin','Example Trade','123-456','123456789');
    INSERT INTO trade_account_verification_reviews VALUES ('review-1','owner-1','Example Trade','installer','51824753556','approved','official_abr_lookup','admin','2026-09-01');`);
  database.prepare("INSERT INTO trade_crm_quote_versions VALUES ('version-1','quote-1','owner-1','accepted@example.com',?)")
    .run(JSON.stringify({ quoteId: "quote-1", quoteVersionId: "version-1", acceptanceEmail: "accepted@example.com" }));
  const db = d1(database), sent = [], rendered = [], stored = new Map();
  const setJournal = (status, messageId = "") => database.prepare("INSERT OR REPLACE INTO trade_email_submissions VALUES ('owner-1','accepted-invoice:invoice-1:email:1',?,'google',?)").run(status, messageId);
  const services = {
    async renderPdf(snapshot) { rendered.push(snapshot); return new TextEncoder().encode("%PDF-accepted-invoice"); },
    async storePdf(id, bytes) { const reference = { objectKey: `pdf/${id}`, sha256: "a".repeat(64), sizeBytes: bytes.length }; stored.set(reference.objectKey, bytes); return reference; },
    async readPdf(_id, reference) { const bytes = stored.get(reference.objectKey); if (!bytes) throw new Error("ISSUED_PDF_UNAVAILABLE"); return bytes; },
    async sendEmail(owner, message, beforeSend) { await beforeSend(); assert.equal(owner, "owner-1"); sent.push(message); setJournal("accepted", "message-1"); return { provider: "google", providerMessageId: "message-1" }; },
  };
  const queue = () => delivery.acceptedInvoiceEmailDispatch(db, "invoice-1", now.toISOString()).run();
  const drain = (overrides = {}) => delivery.drainAcceptedInvoiceEmails({ db, now, services, ...overrides });
  const row = () => database.prepare("SELECT * FROM trade_crm_accepted_invoice_deliveries WHERE invoice_id='invoice-1'").get();
  return { database, db, built, now, services, sent, rendered, stored, setJournal, queue, drain, row };
}

test("acceptance queues once transactionally and rollback cannot leave an orphan delivery", async (t) => {
  const h = await fixture(t);
  h.database.exec("BEGIN"); await h.queue(); h.database.exec("ROLLBACK"); assert.equal(h.row(), undefined);
  await h.queue(); await h.queue(); assert.equal(h.row().status, "queued");
  assert.equal(h.database.prepare("SELECT COUNT(*) count FROM trade_crm_accepted_invoice_deliveries").get().count, 1);
});

test("automatic email uses the accepted alternate contact and always attaches the exact frozen invoice PDF", async (t) => {
  const h = await fixture(t); await h.queue(); await h.drain(); await h.drain();
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].recipient, "accepted@example.com");
  assert.equal(h.sent[0].idempotencyKey, "accepted-invoice:invoice-1:email:1");
  assert.equal(h.sent[0].attachments.length, 1); assert.equal(h.sent[0].attachments[0].filename, "INV-001.pdf");
  assert.equal(Buffer.from(h.sent[0].attachments[0].content, "base64").toString(), "%PDF-accepted-invoice");
  assert.equal(h.rendered[0].lines[1].totalCents, -1100); assert.equal(h.rendered[0].totals.totalCents, 9900);
  assert.equal(h.row().status, "provider_accepted"); assert.equal(h.row().provider_message_id, "message-1");
  assert.equal(await delivery.acceptedInvoiceEmailStatus(h.db, "another-owner", "invoice-1"), null);
});

test("attention-required invoices do not enqueue an additional payment request", async (t) => {
  const h = await fixture(t, { input: { issueBlockerCode: "ACCEPTED_INVOICE_CONFLICT" } });
  await h.queue(); await h.drain(); assert.equal(h.row(), undefined); assert.equal(h.sent.length, 0);
});

for (const [name, sql] of [
  ["owner revoked", "UPDATE trade_accounts SET account_status='suspended'"],
  ["approval removed", "DELETE FROM trade_account_verification_reviews"],
  ["cross-tenant customer", "UPDATE trade_crm_customers SET firebase_uid='other'"],
  ["recipient removed", "DELETE FROM trade_crm_customer_contacts"],
  ["recipient changed", "UPDATE trade_crm_quote_versions SET acceptance_email='other@example.com'"],
  ["bank missing", "UPDATE trade_accounts SET invoice_payment_bsb=''"],
  ["bank changed", "UPDATE trade_accounts SET invoice_payment_account_number='different'"],
  ["already paid", "UPDATE trade_crm_job_details SET paid_value_cents=9900"],
  ["quick invoice conflict", "INSERT INTO trade_crm_quick_invoices VALUES ('owner-1','work-1','issued')"],
  ["accounting conflict", "INSERT INTO trade_crm_accounting_documents VALUES ('owner-1','work-1','invoice','issued','other-handoff')"],
  ["email complaint", "INSERT INTO trade_crm_quote_deliveries VALUES ('owner-1','customer-1','email','complained')"],
]) test(`${name} blocks automatic delivery before any provider request`, async (t) => {
  const h = await fixture(t); await h.queue(); h.database.exec(sql); await h.drain();
  assert.equal(h.sent.length, 0); assert.equal(h.row().status, "failed"); assert.equal(h.row().next_attempt_at, "");
});

test("an export of this exact accepted invoice does not look like a second invoice conflict", async (t) => {
  const h = await fixture(t); await h.queue();
  h.database.exec("INSERT INTO trade_crm_accounting_documents VALUES ('owner-1','work-1','invoice','issued','handoff-1')");
  await h.drain(); assert.equal(h.sent.length, 1);
});

for (const status of ["exported", "overdue"]) test(`unpaid ${status} accounting status still sends the accepted invoice`, async (t) => {
  const h = await fixture(t); await h.queue();
  h.database.prepare("UPDATE trade_crm_job_details SET invoice_status=?").run(status);
  await h.drain(); assert.equal(h.sent.length, 1);
});

for (const validHash of [true, false]) test(`public-lead delivery requires a matching disclosure checksum (${validHash})`, async (t) => {
  const h = await fixture(t); await h.queue();
  const snapshot = JSON.stringify({ contract: "tlink-public-lead-accepted-disclosure-v1", customer: { email: "accepted@example.com" } });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  const hash = Buffer.from(digest).toString("hex");
  h.database.exec("UPDATE trade_work_orders SET source_type='public_lead'; UPDATE trade_crm_customers SET email='accepted@example.com'");
  h.database.prepare("UPDATE trade_crm_job_details SET customer_source='public_lead_released',accepted_disclosure_snapshot=?,accepted_disclosure_sha256=?").run(snapshot, validHash ? hash : "f".repeat(64));
  await h.drain(); assert.equal(h.sent.length, validHash ? 1 : 0);
});

test("concurrent drains lease the invoice once", async (t) => {
  const h = await fixture(t); await h.queue();
  await Promise.all([h.drain(), h.drain()]); assert.equal(h.sent.length, 1); assert.equal(h.row().attempts, 1);
});

test("a definite rejection retries with the same immutable PDF and provider request identity", async (t) => {
  const h = await fixture(t); await h.queue(); const send = h.services.sendEmail;
  h.services.sendEmail = async () => { h.setJournal("failed"); throw new reminder.ReminderProviderDeliveryError("definite_failure", "EMAIL_SEND_REJECTED"); };
  await h.drain(); assert.equal(h.row().status, "failed"); assert.ok(h.row().next_attempt_at);
  h.services.sendEmail = send; await h.drain({ now: new Date(h.now.getTime() + 6 * 60_000) });
  assert.equal(h.sent.length, 1); assert.equal(h.rendered.length, 1); assert.equal(h.row().status, "provider_accepted");
});

for (const state of ["accepted", "uncertain", "sending"]) test(`expired lease reconciles ${state} transport proof without sending twice`, async (t) => {
  const h = await fixture(t); await h.queue(); h.setJournal(state, state === "accepted" ? "recovered-message" : "");
  h.database.prepare("UPDATE trade_crm_accepted_invoice_deliveries SET status='sending',attempts=1,lease_token='old',lease_expires_at=?")
    .run(new Date(h.now.getTime() - 60_000).toISOString());
  await h.drain(); assert.equal(h.sent.length, 0);
  assert.equal(h.row().status, state === "accepted" ? "provider_accepted" : "reconciliation_required");
});

test("uncertain submission requires reconciliation, never a blind automatic retry", async (t) => {
  const h = await fixture(t); await h.queue();
  h.services.sendEmail = async () => { h.setJournal("uncertain"); throw new reminder.ReminderProviderDeliveryError("indeterminate", "EMAIL_SEND_UNCERTAIN"); };
  await h.drain(); assert.equal(h.row().status, "reconciliation_required"); assert.equal(h.row().next_attempt_at, "");
  await h.drain({ now: new Date(h.now.getTime() + 86400000) }); assert.equal(h.row().attempts, 1);
});

test("the final failed attempt stops retrying", async (t) => {
  const h = await fixture(t); await h.queue(); h.database.exec("UPDATE trade_crm_accepted_invoice_deliveries SET attempts=4");
  h.services.renderPdf = async () => { throw new Error("PDF_RENDER_UNAVAILABLE"); };
  await h.drain(); assert.equal(h.row().attempts, 5); assert.equal(h.row().next_attempt_at, "");
});

test("owner retry revalidates a definite failure and requeues its existing PDF identity", async (t) => {
  const h = await fixture(t); await h.queue(); h.setJournal("failed");
  h.database.exec("UPDATE trade_crm_accepted_invoice_deliveries SET status='failed',attempts=5,next_attempt_at=''");
  await assert.rejects(delivery.retryAcceptedInvoiceEmail(h.db, "other-owner", "invoice-1"), /RETRY_UNAVAILABLE/);
  const queued = await delivery.retryAcceptedInvoiceEmail(h.db, "owner-1", "invoice-1");
  assert.equal(queued.status, "queued"); assert.equal(h.row().attempts, 0);
  await h.drain({ now: new Date(queued.queuedAt) }); assert.equal(h.sent.length, 1);
});

for (const state of ["accepted", "sending", "uncertain"]) test(`owner retry refuses ${state} provider proof even if outbox says failed`, async (t) => {
  const h = await fixture(t); await h.queue(); h.setJournal(state, state === "accepted" ? "known-message" : "");
  h.database.exec("UPDATE trade_crm_accepted_invoice_deliveries SET status='failed'");
  await assert.rejects(delivery.retryAcceptedInvoiceEmail(h.db, "owner-1", "invoice-1"), /RETRY_UNAVAILABLE/);
  assert.equal(h.sent.length, 0);
});

test("owner retry cannot bypass withdrawn recipient access", async (t) => {
  const h = await fixture(t); await h.queue(); h.setJournal("failed");
  h.database.exec("UPDATE trade_crm_accepted_invoice_deliveries SET status='failed'; DELETE FROM trade_crm_customer_contacts");
  await assert.rejects(delivery.retryAcceptedInvoiceEmail(h.db, "owner-1", "invoice-1"), /ACCESS_ENDED/);
});

test("accepted invoice PDF renders signed credits and exact totals as a standalone invoice", async (t) => {
  const h = await fixture(t);
  const snapshot = structuredClone(h.built.documentSnapshot); snapshot.customer.name = "José"; snapshot.lines[0].description = "Insulation 162.5 m²";
  const bytes = await pdf.renderAcceptedInvoicePdf(snapshot);
  const document = await pdfLib.PDFDocument.load(bytes);
  assert.equal(document.getTitle(), "Invoice INV-001"); assert.equal(document.getPage(0).getSize().width.toFixed(2), "595.28");
  const output = document.getPages().flatMap((page) => {
    const contents = page.node.Contents(); const streams = contents instanceof pdfLib.PDFArray ? contents.asArray() : [contents];
    return streams.map((stream) => Buffer.from(pdfLib.decodePDFRawStream(document.context.lookup(stream)).decode()).toString("latin1"));
  }).join("\n");
  for (const amount of ["-$11.00", "$99.00", "$9.00"]) assert.ok(output.includes(Buffer.from(amount).toString("hex").toUpperCase()), amount);
  for (const value of ["José", "Insulation 162.5 m²"]) assert.ok(output.includes(Buffer.from(value, "latin1").toString("hex").toUpperCase()), value);
  assert.equal(pdf.acceptedInvoicePdfFilename(h.built.documentSnapshot), "INV-001.pdf");
});
