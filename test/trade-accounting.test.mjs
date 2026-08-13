import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  accountingContactReference,
  accountingReference,
  accountingStatus,
  assertQuickInvoiceAccountingEligibility,
  centsFromProvider,
  quickBooksFailureDetail,
  requireAccountingJobAccess,
} from "../src/lib/trade-accounting.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0022_worried_sleepwalker.sql");
const route = read("../src/app/api/trade-accounting/route.ts");
const providerExport = read("../src/lib/trade-accounting-export.ts");
const schema = read("../db/schema.ts");
const providerSettings = read("../src/lib/trade-integrations-server.ts");

function apply(database, sql) {
  sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean)
    .forEach((statement) => database.exec(statement));
}

test("accounting ledger migration creates one invoice per installer job", () => {
  const database = new DatabaseSync(":memory:");
  apply(database, migration);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'trade_crm_accounting_%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_accounting_documents", "trade_crm_accounting_events"]);
  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  assert.ok(indexes.includes("trade_crm_accounting_documents_job_type_idx"));
  assert.ok(indexes.includes("trade_crm_accounting_events_document_idx"));
  database.prepare(`INSERT INTO trade_crm_accounting_documents
    (id, work_order_id, firebase_uid, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("one", "job-one", "installer", "xero", "now", "now");
  database.prepare(`INSERT INTO trade_crm_accounting_documents
    (id, work_order_id, firebase_uid, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("two", "job-two", "installer", "xero", "now", "now");
  database.close();
});

test("provider references are deterministic and fit provider limits", () => {
  assert.equal(accountingReference("JOB 123 / north", 13), "AEA-JOB-123-N");
  assert.equal(accountingContactReference("CUS-000123", 15), "AEACUS000123");
  assert.equal(accountingReference("***", 13), "AEA");
});

test("Xero, MYOB and QuickBooks statuses map into the simple CRM invoice states", () => {
  assert.equal(accountingStatus("xero", "DRAFT", 10000, 0, ""), "draft");
  assert.equal(accountingStatus("xero", "AUTHORISED", 10000, 0, "2026-01-01", "2026-01-02"), "overdue");
  assert.equal(accountingStatus("xero", "AUTHORISED", 10000, 2500, ""), "part_paid");
  assert.equal(accountingStatus("xero", "PAID", 10000, 10000, ""), "paid");
  assert.equal(accountingStatus("myob", "Open", 10000, 0, ""), "issued");
  assert.equal(accountingStatus("myob", "Closed", 10000, 10000, ""), "paid");
  assert.equal(accountingStatus("myob", "Credit", 10000, 0, ""), "void");
  assert.equal(accountingStatus("quickbooks", "DRAFT", 10000, 0, ""), "draft");
  assert.equal(accountingStatus("quickbooks", "DRAFT", 10000, 10000, ""), "paid");
  assert.equal(centsFromProvider("123.455"), 12346);
});

test("server blocks protected jobs before provider export", () => {
  assert.match(route, /row\.source_type !== "internal"/);
  assert.match(route, /row\.customer_source !== "trade_owned"/);
  assert.match(route, /DIRECT_CUSTOMER_REQUIRED/);
  assert.match(route, /Australian Energy Assessments protected customer details cannot be sent to an accounting provider/);
});

test("exports are drafts, do not email, and refresh provider totals", () => {
  assert.match(providerExport, /Status: "DRAFT"/);
  assert.match(providerExport, /InvoiceDeliveryStatus: "Nothing"/);
  assert.match(providerExport, /IsTaxInclusive: false/);
  assert.match(providerExport, /DiscountLineDetail/);
  assert.match(route, /"Idempotency-Key": identity\.xeroIdempotencyKey/);
  assert.match(route, /requestid=\$\{requestId\}/);
  assert.match(route, /Invoices\//);
  assert.match(route, /Sale\/Invoice\/Service\//);
  assert.match(route, /paid_value_cents = MAX\(paid_value_cents, \?\)/);
  assert.match(route, /trade_crm_accounting_events/);
  assert.match(route, /EXPORT_IN_PROGRESS/);
  assert.match(route, /updated_at < \?/);
});

test("accounting access is owner-scoped, permission-aware and assigned-job bounded", async () => {
  let assignmentChecks = 0;
  const manager = { ownerUid: "owner", isOwner: false, canViewInvoices: true, canManageInvoices: true };
  assert.equal(await requireAccountingJobAccess(manager, "job", false, async () => { assignmentChecks += 1; }), "owner");
  assert.equal(await requireAccountingJobAccess(manager, "job", true, async () => { assignmentChecks += 1; }), "owner");
  assert.equal(assignmentChecks, 2);
  let deniedDownstreamCalls = 0;
  await assert.rejects(() => requireAccountingJobAccess(
    { ownerUid: "owner", isOwner: false, canViewInvoices: false, canManageInvoices: false },
    "job",
    true,
    async () => { deniedDownstreamCalls += 1; },
  ), /ACCOUNTING_ACCESS_REQUIRED/);
  await assert.rejects(() => requireAccountingJobAccess(manager, "other-job", false, async () => {
    deniedDownstreamCalls += 1;
    throw new Error("JOB_NOT_ASSIGNED");
  }), /JOB_NOT_ASSIGNED/);
  assert.equal(deniedDownstreamCalls, 1);
  assert.match(route, /requireInstallerTeamAccess\(request\)/);
  assert.match(route, /assignedJob\(access, workOrderId\)/);
  assert.match(route, /directJob\(ownerUid, workOrderId, source\)/);
  assert.doesNotMatch(route, /requireInstallerOperations/);
});

test("mutable or unsuccessfully delivered quick invoice drafts stop before provider access", () => {
  assert.throws(() => assertQuickInvoiceAccountingEligibility("draft", "queued"), /QUICK_INVOICE_NOT_ISSUED/);
  assert.throws(() => assertQuickInvoiceAccountingEligibility("issued", "reconciliation_required"), /QUICK_INVOICE_NOT_ISSUED/);
  assert.doesNotThrow(() => assertQuickInvoiceAccountingEligibility("issued", "provider_accepted"));
  assert.doesNotThrow(() => assertQuickInvoiceAccountingEligibility("issued", "delivered"));
  assert.ok(route.indexOf("directJob(ownerUid, workOrderId, source)") < route.indexOf("exportInvoice(ownerUid"));
});

test("MYOB requests only the scopes required for invoice sync", () => {
  assert.match(providerSettings, /"sme-sales"/);
  assert.match(providerSettings, /"sme-contacts-customer"/);
  assert.match(providerSettings, /"sme-general-ledger"/);
});

test("MYOB supports SSO and the default passwordless AccountRight company file without collecting credentials", () => {
  assert.equal(Buffer.from("Administrator:").toString("base64"), "QWRtaW5pc3RyYXRvcjo=");
  assert.match(route, /const MYOB_DEFAULT_COMPANY_FILE_TOKEN = btoa\("Administrator:"\);/);
  assert.match(route, /const first = await request\(\);/);
  assert.match(route, /const fallback = await request\(MYOB_DEFAULT_COMPANY_FILE_TOKEN\);/);
  assert.match(route, /companyFileToken \? \{ "x-myobapi-cftoken": companyFileToken \} : \{\}/);
  assert.match(route, /response\.status === 401 \|\| \(response\.status === 403/);
  assert.match(route, /detail\.includes\("accessdenied"\)/);
  assert.match(route, /MYOB_COMPANY_FILE_PASSWORD_UNSUPPORTED/);
  assert.match(route, /TLink does not collect company-file usernames or passwords/);
  assert.doesNotMatch(route, /company_file_(?:username|password)/);
});

test("accounting storage and copy do not retain provider payloads or prohibited dash characters", () => {
  const documentBlock = schema.match(/tradeCrmAccountingDocuments[\s\S]*?\]\);/)?.[0] || "";
  const eventBlock = schema.match(/tradeCrmAccountingEvents[\s\S]*?\]\);/)?.[0] || "";
  assert.doesNotMatch(`${documentBlock}${eventBlock}`, /raw_payload|access_token|refresh_token/);
  assert.doesNotMatch(route, /[\u2013\u2014]/);
});

test("QuickBooks failures retain bounded support identifiers without storing provider payloads", () => {
  assert.equal(
    quickBooksFailureDetail(400, "trace-123/unsafe", { Fault: { Error: [{ code: "6240", type: "ValidationFault", Detail: "Customer private data" }] } }),
    "provider=quickbooks; status=400; intuit_tid=trace-123unsafe; code=6240; type=ValidationFault",
  );
  assert.equal(quickBooksFailureDetail(999, "", null), "provider=quickbooks; status=0");
  assert.match(route, /response\.headers\.get\("intuit_tid"\)/);
  assert.match(route, /accountingErrorDetail\(error\)/);
});
