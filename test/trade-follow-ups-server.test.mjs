import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_FOLLOW_UP_SETTINGS, DEFAULT_FOLLOW_UP_TEMPLATES } from "../src/lib/trade-follow-ups.ts";
import {
  followUpConfiguration, saveFollowUpTemplate, deleteFollowUpTemplate, saveFollowUpSettings,
  previewFollowUp, queueManualFollowUp, deliverFollowUp, scanAutomaticFollowUps, drainFollowUps,
} from "../src/lib/trade-follow-ups-server.ts";

const NOW = new Date("2026-09-28T03:00:00.000Z");
const ENABLED = new Date("2026-09-25T03:00:00.000Z");
const ownerAccess = (ownerUid = "owner", changes = {}) => ({ ownerUid, actorUid: ownerUid, actorEmail: "owner@example.test",
  memberId: "member", displayName: "Owner", businessName: "Example Trade", isOwner: true,
  canCreateJobs: true, canManageJobs: true, canAssignJobs: true, jobScope: "team",
  canViewCustomers: true, canManageCustomers: true, canViewQuotes: true, canManageQuotes: true, canSendQuotes: true,
  canViewInvoices: true, canManageInvoices: true, canViewPriceBook: true, canManagePriceBook: true,
  canApplyDiscounts: true, scheduleScope: "team", canRescheduleJobs: true, canManageTeam: true,
  canEditTeamPermissions: true, canViewFieldEvidence: true, canManageFieldEvidence: true,
  canRunReports: true, canSearchCustomers: true, ...changes });

// Minimal persisted contracts for the real server queries. Only transport and access
// boundaries are injected; candidate selection, joins, mutation and deduplication run as SQL.
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_name TEXT);
    CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT DEFAULT 'installer',record_status TEXT DEFAULT 'active',source_type TEXT DEFAULT 'internal',title TEXT,work_number TEXT,stage TEXT DEFAULT 'scheduled',assignee_member_id TEXT DEFAULT 'member');
    CREATE TABLE trade_crm_job_details (work_order_id TEXT PRIMARY KEY,firebase_uid TEXT,crm_customer_id TEXT,service_site_id TEXT,customer_source TEXT DEFAULT 'trade_owned',invoice_status TEXT DEFAULT 'not_started',invoiced_value_cents INTEGER DEFAULT 0,paid_value_cents INTEGER DEFAULT 0,accepted_disclosure_sha256 TEXT DEFAULT '',accepted_disclosure_snapshot TEXT DEFAULT '');
    CREATE TABLE trade_crm_customers (id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT DEFAULT 'active',first_name TEXT,last_name TEXT,business_name TEXT DEFAULT '',email TEXT);
    CREATE TABLE trade_crm_service_sites (id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT DEFAULT 'active',address_line_1 TEXT,address_line_2 TEXT DEFAULT '',suburb TEXT,address_state TEXT,postcode TEXT);
    CREATE TABLE trade_crm_quote_deliveries (firebase_uid TEXT,crm_customer_id TEXT,channel TEXT DEFAULT 'email',status TEXT);
    CREATE TABLE trade_crm_photo_request_deliveries (firebase_uid TEXT,crm_customer_id TEXT,channel TEXT DEFAULT 'email',status TEXT);
    CREATE TABLE trade_crm_appointments (id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,status TEXT DEFAULT 'scheduled',starts_at TEXT,ends_at TEXT DEFAULT '',assignee_member_id TEXT DEFAULT 'member');
    CREATE TABLE trade_crm_quick_invoices (id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,invoice_number TEXT,due_at TEXT,total_cents INTEGER,status TEXT DEFAULT 'issued',sent_at TEXT DEFAULT '2026-09-26T03:00:00.000Z',provider_message_id TEXT DEFAULT 'provider-id',delivery_status TEXT DEFAULT 'provider_accepted',document_snapshot_json TEXT DEFAULT '{}',created_at TEXT DEFAULT '2026-09-25T03:00:00.000Z');
    CREATE TABLE trade_crm_quick_invoice_credits (invoice_id TEXT,firebase_uid TEXT,status TEXT DEFAULT 'issued',total_cents INTEGER);
    CREATE TABLE trade_crm_accepted_invoices (id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,invoice_number TEXT,due_at TEXT,total_cents INTEGER,status TEXT DEFAULT 'issued',issue_blocker_code TEXT DEFAULT '',commercial_handoff_id TEXT,acceptance_id TEXT,quote_id TEXT,quote_version_id TEXT,document_snapshot_json TEXT DEFAULT '{}',created_at TEXT DEFAULT '2026-09-25T03:00:00.000Z');
    CREATE TABLE trade_crm_accepted_invoice_deliveries (invoice_id TEXT,firebase_uid TEXT,status TEXT,recipient_email TEXT,quote_link_id TEXT);
    CREATE TABLE trade_crm_commercial_handovers (id TEXT PRIMARY KEY,acceptance_id TEXT,quote_id TEXT,quote_version_id TEXT,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,status TEXT);
    CREATE TABLE trade_crm_quote_acceptances (id TEXT PRIMARY KEY,quote_id TEXT,quote_version_id TEXT,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,decision TEXT,result_invoice_id TEXT,invoice_creation_status TEXT,quote_link_id TEXT,token_issue INTEGER);
    CREATE TABLE trade_crm_quote_links (id TEXT PRIMARY KEY,quote_id TEXT,quote_version_id TEXT,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,status TEXT,token_issue INTEGER);
    CREATE TABLE trade_crm_quote_versions (id TEXT PRIMARY KEY,quote_id TEXT,firebase_uid TEXT,acceptance_email TEXT,document_snapshot_json TEXT);
    CREATE TABLE trade_crm_accounting_documents (firebase_uid TEXT,work_order_id TEXT,document_type TEXT DEFAULT 'invoice',commercial_handoff_id TEXT DEFAULT '',commercial_reference TEXT,amount_cents INTEGER,paid_amount_cents INTEGER DEFAULT 0,due_at TEXT,status TEXT DEFAULT 'issued',last_synced_at TEXT);
    CREATE TABLE trade_email_submissions (owner_uid TEXT,request_key TEXT,status TEXT,PRIMARY KEY(owner_uid,request_key));
  `);
  sqlite.exec(fs.readFileSync(new URL("../drizzle/0206_trade_email_follow_ups.sql", import.meta.url), "utf8"));
  const prepare = (sql, values = []) => ({
    bind: (...bindings) => prepare(sql, bindings),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  });
  const db = { prepare, batch: async items => {
    sqlite.exec("BEGIN");
    try { const out = []; for (const item of items) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  const sends = [];
  const services = {
    ownerAccess: async owner => ownerAccess(owner, { actorUid: "system:follow-up" }),
    // Deliberately broad mock: server-side SQL still has to enforce tenant/job scope.
    recipient: async () => "alex@example.test",
    send: async (owner, actor, message, beforeSend) => {
      insert("trade_email_submissions", { owner_uid: owner, request_key: message.idempotencyKey, status: "failed" });
      await beforeSend();
      sends.push({ owner, actor, ...message });
      sqlite.prepare("UPDATE trade_email_submissions SET status='accepted' WHERE owner_uid=? AND request_key=?").run(owner, message.idempotencyKey);
      return { providerMessageId: "synthetic-only" };
    },
  };
  function job(id = "job", owner = "owner") {
    sqlite.prepare("INSERT OR IGNORE INTO trade_accounts VALUES (?,?)").run(owner, `${owner} Trade`);
    insert("trade_crm_customers", { id: `${id}-customer`, firebase_uid: owner, first_name: "Alex", last_name: "Example", email: "alex@example.test" });
    insert("trade_crm_service_sites", { id: `${id}-site`, firebase_uid: owner, address_line_1: "12 Example Street", suburb: "Melbourne", address_state: "VIC", postcode: "3000" });
    insert("trade_work_orders", { id, firebase_uid: owner, title: "Roof repair", work_number: `TLJ-${id}` });
    insert("trade_crm_job_details", { work_order_id: id, firebase_uid: owner, crm_customer_id: `${id}-customer`, service_site_id: `${id}-site` });
  }
  function appointment(id = "visit", work = "job", changes = {}) {
    insert("trade_crm_appointments", { id, work_order_id: work, firebase_uid: "owner", starts_at: "2026-09-29T09:00", ends_at: "2026-09-29T10:00", ...changes });
  }
  function quick(id = "invoice", work = "job", changes = {}) {
    const row = { id, work_order_id: work, firebase_uid: "owner", crm_customer_id: `${work}-customer`, invoice_number: `INV-${id}`, due_at: "2026-09-27", total_cents: 11000,
      document_snapshot_json: JSON.stringify({ schemaVersion: "trade-quick-invoice-document-v1", customer: { email: "alex@example.test" } }), ...changes };
    insert("trade_crm_quick_invoices", row);
    sqlite.prepare("UPDATE trade_crm_job_details SET invoice_status='issued',invoiced_value_cents=? WHERE work_order_id=?").run(row.total_cents, work);
  }
  function accepted(id = "accepted-invoice", work = "job", changes = {}) {
    const quote = `quote-${id}`, version = `version-${id}`, link = `link-${id}`, acceptance = `accept-${id}`, handoff = `handoff-${id}`;
    const identity = { firebase_uid: "owner", work_order_id: work, crm_customer_id: `${work}-customer`, quote_id: quote, quote_version_id: version };
    insert("trade_crm_accepted_invoices", { id, ...identity, invoice_number: `INV-${id}`, due_at: "2026-09-27", total_cents: 11000,
      commercial_handoff_id: handoff, acceptance_id: acceptance, ...changes });
    insert("trade_crm_quote_acceptances", { id: acceptance, ...identity, decision: "accepted", result_invoice_id: id, invoice_creation_status: "issued", quote_link_id: link, token_issue: 1 });
    insert("trade_crm_quote_links", { id: link, ...identity, status: "accepted", token_issue: 1 });
    insert("trade_crm_commercial_handovers", { id: handoff, ...identity, acceptance_id: acceptance, status: "accepted" });
    insert("trade_crm_quote_versions", { id: version, quote_id: quote, firebase_uid: "owner", acceptance_email: "alex@example.test", document_snapshot_json: JSON.stringify({ acceptanceEmail: "alex@example.test", quoteId: quote, quoteVersionId: version }) });
    insert("trade_crm_accepted_invoice_deliveries", { invoice_id: id, firebase_uid: "owner", status: "provider_accepted", recipient_email: "alex@example.test", quote_link_id: link });
    sqlite.prepare("UPDATE trade_crm_job_details SET invoice_status='issued',invoiced_value_cents=11000 WHERE work_order_id=?").run(work);
  }
  const rows = () => sqlite.prepare("SELECT * FROM trade_follow_up_messages ORDER BY created_at,id").all();
  const preview = (work = "job", template = "general-follow-up", options = {}) => previewFollowUp(db, services, ownerAccess(), work, template, options);
  const manual = async (changes = {}) => {
    const draft = await preview();
    const input = { workOrderId: "job", templateId: "general-follow-up", requestId: "manual-request-123456", subject: draft.subject, body: draft.body, contextHash: draft.contextHash, ...changes };
    return { id: await queueManualFollowUp(db, services, ownerAccess(), input), input };
  };
  job();
  return { sqlite, db, insert, services, sends, job, appointment, quick, accepted, rows, preview, manual };
}

test("configuration defaults off and custom templates stay business scoped", async t => {
  const f = fixture(t);
  assert.equal((await followUpConfiguration(f.db, "owner")).settings.invoiceEnabled, false);
  assert.equal((await followUpConfiguration(f.db, "owner")).settings.appointmentEnabled, false);
  await saveFollowUpTemplate(f.db, "owner", { id: "private", name: "Private", kind: "general", subject: "Private", body: "Private message" });
  assert.ok((await followUpConfiguration(f.db, "owner")).templates.some(t => t.id === "private"));
  assert.ok(!(await followUpConfiguration(f.db, "other")).templates.some(t => t.id === "private"));
  await deleteFollowUpTemplate(f.db, "owner", "private");
  assert.ok(!(await followUpConfiguration(f.db, "owner")).templates.some(t => t.id === "private"));
});

test("preview prefills customer and job without sending", async t => {
  const f = fixture(t), draft = await f.preview();
  assert.equal(draft.recipient, "alex@example.test");
  assert.match(draft.body, /Alex Example/);
  assert.match(draft.body, /TLJ-job/);
  assert.deepEqual(draft.missing, []);
  assert.equal(f.sends.length, 0);
  assert.equal(f.rows().length, 0);
});

test("job context excludes other businesses, protected jobs and unassigned own scope", async t => {
  const f = fixture(t);
  f.job("other-job", "other");
  await assert.rejects(f.preview("other-job"), /EMAIL_RECIPIENT_UNAVAILABLE/);
  f.sqlite.exec("UPDATE trade_work_orders SET source_type='opportunity' WHERE id='job'");
  await assert.rejects(f.preview(), /EMAIL_RECIPIENT_UNAVAILABLE/);
  f.sqlite.exec("UPDATE trade_work_orders SET source_type='internal',assignee_member_id='other-member' WHERE id='job'");
  await assert.rejects(previewFollowUp(f.db, f.services, ownerAccess("owner", { isOwner: false, jobScope: "own" }), "job", "general-follow-up"), /EMAIL_RECIPIENT_UNAVAILABLE/);
});

test("manual send replays one request without duplicate transport and rejects edited replay", async t => {
  const f = fixture(t), { id, input } = await f.manual();
  assert.equal(await deliverFollowUp(f.db, f.services, id, ownerAccess()), "accepted");
  assert.equal(await queueManualFollowUp(f.db, f.services, ownerAccess(), input), id);
  assert.equal(await deliverFollowUp(f.db, f.services, id, ownerAccess()), "accepted");
  assert.equal(f.sends.length, 1);
  assert.equal(f.rows().length, 1);
  await assert.rejects(queueManualFollowUp(f.db, f.services, ownerAccess(), { ...input, body: "Changed message" }), /EMAIL_REQUEST_CONFLICT/);
});

test("concurrent changed manual request cannot silently win the same request key", async t => {
  const f = fixture(t), draft = await f.preview();
  const input = { workOrderId: "job", templateId: "general-follow-up", requestId: "concurrent-request-123456", subject: draft.subject, body: draft.body, contextHash: draft.contextHash };
  const result = await Promise.allSettled([
    queueManualFollowUp(f.db, f.services, ownerAccess(), input),
    queueManualFollowUp(f.db, f.services, ownerAccess(), { ...input, body: "A different approved message" }),
  ]);
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
  assert.match(result.find(r => r.status === "rejected").reason.message, /EMAIL_REQUEST_CONFLICT/);
  assert.equal(f.rows().length, 1);
});

test("changed context stops a queued message before transport", async t => {
  const f = fixture(t), { id } = await f.manual();
  f.sqlite.exec("UPDATE trade_work_orders SET title='Changed job' WHERE id='job'");
  assert.equal(await deliverFollowUp(f.db, f.services, id, ownerAccess()), "cancelled");
  assert.equal(f.sends.length, 0);
});

test("preview context is checked again when queuing", async t => {
  const f = fixture(t), draft = await f.preview();
  f.sqlite.exec("UPDATE trade_crm_customers SET first_name='New' WHERE id='job-customer'");
  await assert.rejects(queueManualFollowUp(f.db, f.services, ownerAccess(), { workOrderId: "job", templateId: "general-follow-up", requestId: "changed-context-123456", subject: draft.subject, body: draft.body, contextHash: draft.contextHash }), /FOLLOW_UP_CONTEXT_CHANGED/);
  assert.equal(f.rows().length, 0);
});

test("each recorded quote or photo email opt-out suppresses preview", async t => {
  const f = fixture(t);
  for (const table of ["trade_crm_quote_deliveries", "trade_crm_photo_request_deliveries"]) {
    f.insert(table, { firebase_uid: "owner", crm_customer_id: "job-customer", status: "opted_out" });
    await assert.rejects(f.preview(), /FOLLOW_UP_OPTED_OUT/, table);
    f.sqlite.exec(`DELETE FROM ${table}`);
  }
});

test("quick-invoice email opt-out also stops general follow-up", async t => {
  const f = fixture(t);
  f.quick("invoice", "job", { delivery_status: "opted_out" });
  await assert.rejects(f.preview(), /FOLLOW_UP_OPTED_OUT/);
});

test("appointment preview respects own schedule scope and resolves local time", async t => {
  const f = fixture(t);
  f.appointment("other-visit", "job", { assignee_member_id: "other-member" });
  const access = ownerAccess("owner", { isOwner: false, scheduleScope: "own" });
  const blocked = await previewFollowUp(f.db, f.services, access, "job", "appointment-reminder", { now: NOW });
  assert.ok(blocked.missing.includes("An upcoming appointment"));
  f.appointment("own-visit");
  const own = await previewFollowUp(f.db, f.services, access, "job", "appointment-reminder", { now: NOW });
  assert.equal(own.context.appointmentId, "own-visit");
  assert.match(own.body, /9:00/);
  assert.match(own.body, /29 September 2026/);
});

test("automation remains dormant until owner enables it and one appointment sends once", async t => {
  const f = fixture(t);
  f.appointment();
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  await drainFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 0);
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true }, ENABLED);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 1);
  await drainFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows()[0].status, "accepted");
  const later = new Date(NOW.getTime() + 10 * 60_000);
  await scanAutomaticFollowUps(f.db, f.services, later);
  await drainFollowUps(f.db, f.services, later);
  assert.equal(f.sends.length, 1);
});

test("switching automation off cancels work queued before the switch", async t => {
  const f = fixture(t);
  f.appointment();
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true }, ENABLED);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 1);
  await saveFollowUpSettings(f.db, "owner", DEFAULT_FOLLOW_UP_SETTINGS, NOW);
  await drainFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows()[0].status, "cancelled");
  assert.equal(f.sends.length, 0);
});

test("cancelled appointment is never emailed and rescheduled appointment gets fresh context", async t => {
  const f = fixture(t);
  f.appointment();
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true }, ENABLED);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  f.sqlite.exec("UPDATE trade_crm_appointments SET status='cancelled'");
  await drainFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows()[0].status, "cancelled");
  assert.equal(f.sends.length, 0);
  f.sqlite.exec("UPDATE trade_crm_appointments SET status='scheduled',starts_at='2026-09-29T10:00',ends_at='2026-09-29T11:00'");
  const later = new Date(NOW.getTime() + 10 * 60_000);
  await scanAutomaticFollowUps(f.db, f.services, later);
  await drainFollowUps(f.db, f.services, later);
  assert.equal(f.rows().length, 2);
  assert.equal(f.sends.length, 1);
  assert.match(f.sends[0].body, /10:00/);
});

test("editing active template bumps revision and changing its active kind is rejected", async t => {
  const f = fixture(t), template = DEFAULT_FOLLOW_UP_TEMPLATES.find(t => t.id === "appointment-reminder");
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true }, ENABLED);
  const before = (await followUpConfiguration(f.db, "owner")).revision;
  await saveFollowUpTemplate(f.db, "owner", { ...template, body: `${template.body}\nPlease bring your access key.` });
  assert.ok((await followUpConfiguration(f.db, "owner")).revision > before);
  await assert.rejects(saveFollowUpTemplate(f.db, "owner", { ...template, kind: "general" }));
  await assert.rejects(deleteFollowUpTemplate(f.db, "owner", template.id), /FOLLOW_UP_TEMPLATE_IN_USE/);
});

test("invoice preview calculates outstanding from current recorded payment", async t => {
  const f = fixture(t);
  f.quick();
  f.sqlite.exec("UPDATE trade_crm_job_details SET paid_value_cents=3000,invoice_status='part_paid'");
  const draft = await f.preview("job", "overdue-invoice", { now: NOW });
  assert.equal(draft.context.invoiceReady, true);
  assert.equal(draft.context.fields.invoice_amount, "$80.00");
  assert.match(draft.body, /INV-invoice/);
});

test("paid, void and fully credited invoices cannot generate reminders", async t => {
  const f = fixture(t);
  f.quick();
  for (const status of ["paid", "void", "credited"]) {
    f.sqlite.prepare("UPDATE trade_crm_job_details SET invoice_status=?").run(status);
    assert.equal((await f.preview("job", "overdue-invoice", { now: NOW })).context.invoiceReady, false, status);
  }
  f.sqlite.exec("UPDATE trade_crm_job_details SET invoice_status='issued',paid_value_cents=11000");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW })).context.invoiceReady, false);
});

test("issued credits reduce balance without double counting payments", async t => {
  const f = fixture(t);
  f.quick();
  f.insert("trade_crm_quick_invoice_credits", { invoice_id: "invoice", firebase_uid: "owner", total_cents: 2000 });
  f.sqlite.exec("UPDATE trade_crm_quick_invoices SET status='part_credited'; UPDATE trade_crm_job_details SET invoiced_value_cents=9000,paid_value_cents=3000,invoice_status='part_credited'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW })).context.fields.invoice_amount, "$60.00");
});

test("accounting payment state suppresses stale, mismatched and paid automatic invoices", async t => {
  const f = fixture(t);
  f.quick();
  f.insert("trade_crm_accounting_documents", { firebase_uid: "owner", work_order_id: "job", commercial_reference: "INV-invoice", amount_cents: 11000, paid_amount_cents: 3000, due_at: "2026-09-27", last_synced_at: NOW.toISOString(), status: "part_paid" });
  f.sqlite.exec("UPDATE trade_crm_job_details SET paid_value_cents=3000,invoice_status='part_paid'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.fields.invoice_amount, "$80.00");
  f.sqlite.exec("UPDATE trade_crm_accounting_documents SET last_synced_at='2026-09-20T00:00:00.000Z'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
  f.sqlite.prepare("UPDATE trade_crm_accounting_documents SET last_synced_at=?,commercial_reference='WRONG'").run(NOW.toISOString());
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
  f.sqlite.exec("UPDATE trade_crm_accounting_documents SET commercial_reference='INV-invoice',paid_amount_cents=11000,status='paid'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
});

test("overdue automatic reminder sends once and paying after queue prevents send", async t => {
  const f = fixture(t);
  f.quick();
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, invoiceEnabled: true }, ENABLED);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 1);
  f.sqlite.exec("UPDATE trade_crm_job_details SET paid_value_cents=11000,invoice_status='paid'");
  await drainFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows()[0].status, "cancelled");
  assert.equal(f.sends.length, 0);
});

test("automatic overdue reminder uses the invoice's original recipient", async t => {
  const f = fixture(t);
  f.quick("invoice", "job", { document_snapshot_json: JSON.stringify({ customer: { email: "former-contact@example.test" } }) });
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
});

test("completed job progress is independent of whether the customer invoice still needs chasing", async t => {
  const f = fixture(t);
  f.quick();
  f.sqlite.exec("UPDATE trade_work_orders SET stage='completed'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, true);
  f.sqlite.exec("UPDATE trade_crm_job_details SET invoice_status='paid',paid_value_cents=11000");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
  assert.equal(f.sqlite.prepare("SELECT stage FROM trade_work_orders WHERE id='job'").get().stage, "completed");
});

test("accepted invoice requires a matching accepted quote-link and acceptance chain", async t => {
  const f = fixture(t);
  f.accepted();
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, true);
  f.sqlite.exec("UPDATE trade_crm_quote_links SET status='revoked'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
  f.sqlite.exec("UPDATE trade_crm_quote_links SET status='accepted'; UPDATE trade_crm_quote_acceptances SET result_invoice_id='other-invoice'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
});

test("accepted invoice paid balance and changed original recipient stop automatic chasing", async t => {
  const f = fixture(t);
  f.accepted();
  f.sqlite.exec("UPDATE trade_crm_job_details SET paid_value_cents=11000,invoice_status='paid'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
  f.sqlite.exec("UPDATE trade_crm_job_details SET paid_value_cents=0,invoice_status='issued'; UPDATE trade_crm_accepted_invoice_deliveries SET recipient_email='former@example.test'");
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
});

test("two competing issued invoice sources are not guessed between", async t => {
  const f = fixture(t);
  f.accepted();
  f.quick();
  assert.equal((await f.preview("job", "overdue-invoice", { now: NOW, automatic: true })).context.invoiceReady, false);
});

test("uncertain transport is not retried by the background drain", async t => {
  const f = fixture(t), { id } = await f.manual();
  let calls = 0;
  f.services.send = async (owner, actor, message, beforeSend) => {
    await beforeSend(); calls++;
    f.insert("trade_email_submissions", { owner_uid: owner, request_key: message.idempotencyKey, status: "uncertain" });
    throw new Error("Synthetic transport timeout");
  };
  assert.equal(await deliverFollowUp(f.db, f.services, id, ownerAccess()), "uncertain");
  assert.equal(await deliverFollowUp(f.db, f.services, id, ownerAccess()), "uncertain");
  await drainFollowUps(f.db, f.services, new Date(Date.now() + 600_000));
  assert.equal(calls, 1);
});

test("custom hours-before appointment timing waits for its chosen window", async t => {
  const f = fixture(t);
  f.appointment("visit", "job", { starts_at: "2026-09-28T18:00", ends_at: "2026-09-28T19:00" });
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true,
    appointmentTiming: { amount: 2, unit: "hours", direction: "before" } }, ENABLED);
  // NOW is 13:00 Melbourne, five hours before this appointment.
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 0);
  const due = new Date("2026-09-28T06:15:00.000Z");
  await scanAutomaticFollowUps(f.db, f.services, due);
  await drainFollowUps(f.db, f.services, due);
  assert.equal(f.rows().length, 1);
  assert.equal(f.sends.length, 1);
});

test("custom after-appointment timing includes a past appointment only after its offset", async t => {
  const f = fixture(t);
  f.appointment("visit", "job", { starts_at: "2026-09-28T14:00", ends_at: "2026-09-28T15:00" });
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true,
    appointmentTemplateId: "appointment-follow-up", appointmentTiming: { amount: 2, unit: "hours", direction: "after" } }, ENABLED);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 0);
  const early = new Date("2026-09-28T05:00:00.000Z");
  await scanAutomaticFollowUps(f.db, f.services, early);
  assert.equal(f.rows().length, 0);
  const due = new Date("2026-09-28T06:15:00.000Z");
  await scanAutomaticFollowUps(f.db, f.services, due);
  await drainFollowUps(f.db, f.services, due);
  assert.equal(f.rows().length, 1);
  assert.equal(f.sends.length, 1);
  assert.ok((await f.preview("job", "appointment-reminder", { now: due })).missing.includes("An upcoming appointment"));
});

test("week-before invoice timing can remind ahead of the due date", async t => {
  const f = fixture(t);
  f.quick("invoice", "job", { due_at: "2026-10-04" });
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, invoiceEnabled: true,
    invoiceTiming: { amount: 1, unit: "weeks", direction: "before" } }, ENABLED);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  await drainFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 1);
  assert.equal(f.sends.length, 1);
});

test("after-visit automation includes completed visits but excludes cancelled and no-show", async t => {
  const f = fixture(t);
  f.appointment("completed", "job", { starts_at: "2026-09-28T09:00", ends_at: "2026-09-28T10:00", status: "completed" });
  f.appointment("cancelled", "job", { starts_at: "2026-09-28T09:00", status: "cancelled" });
  f.appointment("no-show", "job", { starts_at: "2026-09-28T09:00", status: "no_show" });
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true,
    appointmentTemplateId: "appointment-follow-up", appointmentTiming: { amount: 2, unit: "hours", direction: "after" } }, ENABLED);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  await drainFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 1);
  assert.match(f.rows()[0].event_key, /^appointment:completed:/);
  assert.equal(f.sends.length, 1);
  assert.match(f.sends[0].body, /Following up on our visit/);
});

test("manual after-visit template uses the latest past visit while reminder stays future", async t => {
  const f = fixture(t);
  f.appointment("older", "job", { starts_at: "2026-09-26T09:00", status: "completed" });
  f.appointment("latest", "job", { starts_at: "2026-09-28T09:00", status: "completed" });
  f.appointment("future", "job", { starts_at: "2026-09-29T09:00" });
  const after = await f.preview("job", "appointment-follow-up", { now: NOW });
  assert.equal(after.context.appointmentId, "latest");
  assert.equal(after.pastAppointment, true);
  assert.deepEqual(after.missing, []);
  const before = await f.preview("job", "appointment-reminder", { now: NOW });
  assert.equal(before.context.appointmentId, "future");
  assert.equal(before.pastAppointment, false);
});

test("enabling reminders never sends the backlog whose trigger already passed", async t => {
  const f = fixture(t);
  f.quick();
  f.appointment();
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true, invoiceEnabled: true }, NOW);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  await drainFollowUps(f.db, f.services, NOW);
  // Both default reminders triggered at 9 am Melbourne, four hours before enablement.
  assert.equal(f.rows().length, 0);
  assert.equal(f.sends.length, 0);
});

test("invoice date-only timing uses 9 am in the service site's timezone", async t => {
  const f = fixture(t);
  f.quick();
  f.sqlite.exec("UPDATE trade_crm_service_sites SET address_state='WA'");
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, invoiceEnabled: true }, ENABLED);
  const before = new Date("2026-09-28T00:30:00.000Z"); // 08:30 Perth, one day after invoice due date.
  await scanAutomaticFollowUps(f.db, f.services, before);
  assert.equal(f.rows().length, 0);
  const after = new Date("2026-09-28T01:05:00.000Z");
  await scanAutomaticFollowUps(f.db, f.services, after);
  await drainFollowUps(f.db, f.services, after);
  assert.equal(f.sends.length, 1);
});

test("bounded keyset scans progress past ineligible early candidates", async t => {
  const f = fixture(t);
  for (let i = 0; i < 22; i++) {
    const id = `visit-${String(i).padStart(2, "0")}`;
    f.appointment(id, "job", { starts_at: i < 20 ? "2026-10-20T09:00" : "2026-09-29T09:00" });
  }
  await saveFollowUpSettings(f.db, "owner", { ...DEFAULT_FOLLOW_UP_SETTINGS, appointmentEnabled: true }, ENABLED);
  await scanAutomaticFollowUps(f.db, f.services, NOW);
  assert.equal(f.rows().length, 0);
  await scanAutomaticFollowUps(f.db, f.services, new Date(NOW.getTime() + 6 * 60_000));
  assert.equal(f.rows().length, 2);
  assert.ok(f.rows().every(row => /visit-2[01]:/.test(row.event_key)));
});

test("custom after-visit templates use past visits without a built-in ID", async t => {
  const f=fixture(t);
  f.appointment("done", "job", {starts_at:"2026-09-27T12:00",status:"completed"});
  await saveFollowUpTemplate(f.db,"owner",{id:"custom-after",name:"After our visit",kind:"appointment_after",subject:"Your visit",body:"Hi {customer_first_name}, thanks for your visit on {appointment_date}."});
  const draft=await f.preview("job","custom-after",{now:NOW});
  assert.deepEqual(draft.missing,[]);assert.equal(draft.context.appointmentId,"done");assert.match(draft.body,/Hi Alex,/);
});

test("manual custom subject always keeps job reference and remains replayable",async t=>{
  const f=fixture(t),draft=await f.preview();
  const input={workOrderId:"job",templateId:"general-follow-up",requestId:"reference-request-123456",subject:"Your custom message",body:draft.body,contextHash:draft.contextHash};
  const id=await queueManualFollowUp(f.db,f.services,ownerAccess(),input);
  assert.equal(f.rows()[0].subject,"[TLJ-job] Your custom message");
  assert.equal(await queueManualFollowUp(f.db,f.services,ownerAccess(),input),id);
  await deliverFollowUp(f.db,f.services,id,ownerAccess());assert.equal(f.sends[0].subject,"[TLJ-job] Your custom message");
});

test("already queued legacy subjects retain exact replay after reference rollout",async t=>{
  const f=fixture(t),{id,input}=await f.manual();
  const oldSubject="Legacy subject without a reference";
  f.sqlite.prepare("UPDATE trade_follow_up_messages SET subject=? WHERE id=?").run(oldSubject,id);
  assert.equal(await queueManualFollowUp(f.db,f.services,ownerAccess(),{...input,subject:oldSubject}),id);
  assert.equal(f.rows()[0].subject,oldSubject);
});
