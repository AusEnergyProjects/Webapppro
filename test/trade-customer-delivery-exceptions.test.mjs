import assert from "node:assert/strict";
import test from "node:test";
import { migratedDataforceD1, migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import { customerDeliveryFailureDiagnostic, loadCustomerDeliveryExceptions } from "../src/lib/trade-customer-delivery-exceptions-server.ts";

const now = "2026-10-02T03:00:00.000Z";
const later = "2026-10-02T04:00:00.000Z";
const owner = { ownerUid: "owner", actorUid: "owner", memberId: "owner-member", isOwner: true };

// Node SQLite permits 500 compound terms, but workerd setupSecurity() sets
// SQLITE_LIMIT_COMPOUND_SELECT to 5. Enforce that boundary before executing the real query.
function assertD1CompoundLimit(sql) {
  const compounds = [1];
  const tokens = sql.match(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|[()]|\b(?:UNION|INTERSECT|EXCEPT)\b/gi) || [];
  for (const token of tokens) {
    if (token === "(") compounds.push(1);
    else if (token === ")") compounds.pop();
    else if (/^(?:UNION|INTERSECT|EXCEPT)$/i.test(token)) {
      compounds[compounds.length - 1]++;
      assert.ok(compounds.at(-1) <= 5, "workerd permits at most five terms in each compound SELECT");
    }
  }
}

test("D1 compound-limit guard rejects six terms while accepting materialized groups", () => {
  const five = Array.from({ length: 5 }, (_, index) => `SELECT ${index}`).join(" UNION ALL ");
  assert.doesNotThrow(() => assertD1CompoundLimit(five));
  assert.throws(() => assertD1CompoundLimit(`${five} UNION ALL SELECT 6`), /at most five terms/);
  assert.doesNotThrow(() => assertD1CompoundLimit(`WITH one AS MATERIALIZED (${five}), two AS MATERIALIZED (${five}) SELECT * FROM one UNION ALL SELECT * FROM two`));
  assert.doesNotThrow(() => assertD1CompoundLimit("SELECT 'UNION UNION UNION UNION UNION UNION' /* UNION */"));
});
test("delivery diagnostics classify nested D1 failures without exposing SQL or customer data", () => {
  const secret = "customer@example.test token=private-secret SELECT * FROM invoices";
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error(secret, { cause: new Error("D1_ERROR: no such column: w.customer_email: SQLITE_ERROR") })), { code: "missing_column" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error("D1_ERROR: no such table: trade_follow_up_messages")), { code: "missing_table" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error("D1_ERROR: no such column: private_customer_name")), { code: "missing_column" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error(`D1_ERROR: too many SQL variables ${secret}`)), { code: "sql_variable_limit" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error(`D1_ERROR: not authorized ${secret}`)), { code: "database_authorization" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error(`malformed JSON ${secret}`)), { code: "malformed_json" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error(`D1_TYPE_ERROR: unsupported type ${secret}`)), { code: "database_type" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error(`D1_ERROR: incorrect number of bindings ${secret}`)), { code: "database_binding" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error(`SQLITE_CONSTRAINT: constraint failed ${secret}`)), { code: "database_constraint" });
  assert.deepEqual(customerDeliveryFailureDiagnostic(new Error(secret)), { code: "unexpected_error" });
  assert.deepEqual(customerDeliveryFailureDiagnostic({ message: secret }), { code: "unexpected_error" });
});
function fixture(t) {
  const { sqlite } = migratedDataforceSqlite(); t.after(() => sqlite.close());
  function insert(table, values) {
    const row = { ...values };
    for (const col of sqlite.prepare(`PRAGMA table_info(${table})`).all()) {
      if (col.notnull && col.dflt_value === null && row[col.name] === undefined) row[col.name] = /INT|REAL/.test(col.type) ? 0 : "";
    }
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  }
  insert("trade_team_members", { id: owner.memberId, owner_uid: owner.ownerUid, member_uid: owner.actorUid, display_name: "Owner", status: "active" });
  const prepare = (sql, values = []) => ({ bind: (...args) => prepare(sql, args), all: async () => {
    assertD1CompoundLimit(sql);
    return { results: sqlite.prepare(sql).all(...values) };
  } });
  const db = { prepare };
  const job = (id, values = {}, detail = {}) => {
    insert("trade_work_orders", { id, firebase_uid: "owner", partner_type: "installer", title: `Work ${id}`, work_number: `JOB-${id}`, source_type: "internal", stage: "backlog", created_at: now, updated_at: now, ...values });
    insert("trade_crm_job_details", { id: `details-${id}`, work_order_id: id, firebase_uid: values.firebase_uid || "owner", customer_source: "trade_owned", pipeline_stage: "enquiry", ...detail });
  };
  const quote = id => {
    insert("trade_crm_quotes", { id: `q-${id}`, work_order_id: id, firebase_uid: "owner", quote_number: `QUOTE-${id}`, status: "issued", current_version_number: 1 });
    insert("trade_crm_quote_versions", { id: `v-${id}`, quote_id: `q-${id}`, firebase_uid: "owner", version_number: 1, status: "issued", issued_at: now });
  };
  const delivery = (id, jobId, status = "failed", values = {}) => insert("trade_crm_quote_deliveries", { id, quote_version_id: `v-${jobId}`, work_order_id: jobId, firebase_uid: "owner", channel: "email", recipient_role: "acceptance", status, delivery_generation: 1, idempotency_key: id, created_at: now, updated_at: now, ...values });
  const receipt = (id, status, revision = 1, stamp = now) => insert("trade_work_order_events", { id: `calendar-invite:${id}:${revision}:${stamp}:${crypto.randomUUID()}`, work_order_id: id, firebase_uid: "owner", event_type: `customer_calendar_invite_${status}`, summary: `Booking ${status}`, created_at: stamp });
  const load = (options = {}, access = owner) => loadCustomerDeliveryExceptions(db, access, options);
  return { sqlite, insert, job, quote, delivery, receipt, load };
}

test("only latest undecided quote delivery failures need action; resolved and automatic retry records stay quiet", async t => {
  const f = fixture(t);
  for (const id of ["failed", "resolved", "retry", "uncertain", "decided", "superseded"]) { f.job(id); f.quote(id); f.delivery(`first-${id}`, id); }
  f.delivery("resolved-new", "resolved", "provider_accepted", { delivery_generation: 2, created_at: later });
  f.sqlite.exec("UPDATE trade_crm_quote_deliveries SET next_attempt_at='2026-10-02T05:00:00.000Z' WHERE id='first-retry'");
  f.sqlite.exec("UPDATE trade_crm_quote_deliveries SET status='reconciliation_required' WHERE id='first-uncertain'");
  f.insert("trade_crm_quote_acceptances", { id: "decision", quote_id: "q-decided", quote_version_id: "v-decided", work_order_id: "decided", firebase_uid: "owner", decision: "accepted" });
  f.insert("trade_crm_quote_versions", { id: "superseding", quote_id: "q-superseded", firebase_uid: "owner", version_number: 2, status: "issued", issued_at: later });
  f.sqlite.exec("UPDATE trade_crm_quotes SET current_version_number=2 WHERE id='q-superseded'");
  const result = await f.load();
  assert.equal(result.total, 2); assert.deepEqual(result.items.map(item => item.workOrderId).sort(), ["failed", "uncertain"]);
  const uncertain = result.items.find(item => item.workOrderId === "uncertain");
  assert.equal(uncertain.status, "uncertain"); assert.match(uncertain.message, /Check the outgoing mailbox/);
  assert.equal(uncertain.tab, "quote");
});

test("customer-role quote receipts follow the latest send rather than an older retry generation", async t => {
  const f = fixture(t); f.job("roles"); f.quote("roles");
  f.delivery("original-primary", "roles", "failed", { recipient_role: "primary_customer", delivery_generation: 4 });
  assert.equal((await f.load()).total, 1, "the current primary customer role is included");
  f.delivery("replacement-contact", "roles", "provider_accepted", { recipient_role: "authorised_contact", delivery_generation: 1, created_at: later });
  assert.equal((await f.load()).total, 0, "a later replacement send supersedes an older retry chain");
  const newest = "2026-10-02T05:00:00.000Z";
  f.delivery("contact-uncertain", "roles", "reconciliation_required", { recipient_role: "authorised_contact", delivery_generation: 2, created_at: newest });
  f.delivery("business-copy", "roles", "provider_accepted", { recipient_role: "business_copy", delivery_generation: 9, created_at: "2026-10-02T06:00:00.000Z" });
  const result = await f.load(); assert.equal(result.total, 1); assert.equal(result.items[0].id, "quote:contact-uncertain");
  assert.equal(result.items[0].status, "uncertain", "a business copy never clears uncertain customer delivery");
});

test("quiet Lost excludes sales emails while unsent invoice and cancellation obligations remain", async t => {
  const f = fixture(t); f.job("lost", { stage: "cancelled" }, { pipeline_stage: "lost", crm_customer_id: "original" }); f.quote("lost"); f.delivery("lost-quote", "lost");
  f.insert("trade_crm_quick_invoices", { id: "invoice", work_order_id: "lost", firebase_uid: "owner", crm_customer_id: "original", invoice_number: "INV-1", status: "issued", delivery_status: "reconciliation_required", updated_at: now });
  f.insert("trade_crm_appointments", { id: "lost", work_order_id: "lost", firebase_uid: "owner", status: "cancelled", revision: 2 }); f.receipt("lost", "failed", 2);
  let result = await f.load(); assert.equal(result.total, 2); assert.deepEqual(result.items.map(item => item.label).sort(), ["Booking email", "Invoice email"]);
  f.sqlite.exec("UPDATE trade_crm_job_details SET crm_customer_id='replacement'");
  result = await f.load(); assert.deepEqual(result.items.map(item => item.label), ["Booking email"], "the original customer's invoice is not a replacement-customer action");
  assert.equal(f.sqlite.prepare("SELECT delivery_status FROM trade_crm_quick_invoices WHERE id='invoice'").get().delivery_status, "reconciliation_required", "historical financial delivery is preserved");
  f.sqlite.exec("UPDATE trade_crm_job_details SET crm_customer_id='original'");
  assert.equal((await f.load()).total, 2, "current lost-job invoice obligations remain visible");
  f.sqlite.exec("UPDATE trade_crm_quick_invoices SET status='void'"); f.receipt("lost", "accepted", 2, later);
  result = await f.load(); assert.equal(result.total, 0);
});

test("booking receipt is tied to the current appointment revision and ignores older or vague historical failures", async t => {
  const f = fixture(t); f.job("booking");
  f.insert("trade_crm_appointments", { id: "booking", work_order_id: "booking", firebase_uid: "owner", status: "scheduled", revision: 2 });
  f.receipt("booking", "failed", 1);
  f.insert("trade_work_order_events", { id: "old-unbound-event", work_order_id: "booking", firebase_uid: "owner", event_type: "customer_calendar_invite_failed", summary: "Old failed send", created_at: later });
  assert.equal((await f.load()).total, 0);
  f.receipt("booking", "reconciliation_required", 2);
  let result = await f.load(); assert.equal(result.total, 1); assert.equal(result.items[0].status, "uncertain");
  f.receipt("booking", "accepted", 2, later); assert.equal((await f.load()).total, 0);
  f.sqlite.exec("UPDATE trade_crm_appointments SET revision=3"); f.receipt("booking", "unavailable", 3);
  result = await f.load(); assert.equal(result.items[0].status, "blocked");
});

test("follow-up failures resolve only against the same template and frozen job context", async t => {
  const f = fixture(t); f.job("follow", {}, { crm_customer_id: "customer" });
  f.insert("trade_crm_customers", { id: "customer", firebase_uid: "owner", email: "customer@example.test" });
  const values = { owner_uid: "owner", work_order_id: "follow", recipient: "customer@example.test", template_id: "general-follow-up", context_json: '{"templateKind":"general"}', status: "failed", next_attempt_at: "", created_at: now, updated_at: now };
  f.insert("trade_follow_up_messages", { id: "failed", event_key: "failed", ...values });
  assert.equal((await f.load()).total, 1);
  f.insert("trade_follow_up_messages", { ...values, id: "accepted", event_key: "accepted", status: "accepted", created_at: later });
  assert.equal((await f.load()).total, 0);
  f.insert("trade_follow_up_messages", { ...values, id: "other", event_key: "other", template_id: "another", status: "uncertain" });
  assert.equal((await f.load()).total, 1);
  f.sqlite.exec("UPDATE trade_crm_job_details SET pipeline_stage='lost'"); assert.equal((await f.load()).total, 0);
});

test("follow-up actions require the current active recipient and invoice customer without rewriting history", async t => {
  const f = fixture(t); f.job("follow", {}, { crm_customer_id: "original" });
  f.insert("trade_crm_customers", { id: "original", firebase_uid: "owner", customer_number: "C-ORIGINAL", email: "  Original@Example.test  " });
  f.insert("trade_crm_customers", { id: "replacement", firebase_uid: "owner", customer_number: "C-REPLACEMENT", email: "replacement@example.test" });
  const values = { owner_uid: "owner", work_order_id: "follow", recipient: "original@example.test", template_id: "general-follow-up",
    context_json: '{"templateKind":"general"}', status: "uncertain", next_attempt_at: "", created_at: now, updated_at: now };
  f.insert("trade_follow_up_messages", { ...values, id: "original-failed", event_key: "original-failed" });
  f.insert("trade_follow_up_messages", { ...values, id: "replacement-accepted", event_key: "replacement-accepted", recipient: "replacement@example.test", status: "accepted", created_at: later });
  assert.equal((await f.load()).total, 1, "another recipient's later send does not resolve this customer's uncertain send");
  f.sqlite.exec("UPDATE trade_crm_job_details SET crm_customer_id='replacement'");
  assert.equal((await f.load()).total, 0, "old-recipient failures do not open the new customer's email composer");
  f.insert("trade_follow_up_messages", { ...values, id: "replacement-failed", event_key: "replacement-failed", recipient: "replacement@example.test", template_id: "new-template" });
  assert.equal((await f.load()).total, 1, "the replacement customer's own exception remains visible");
  f.insert("trade_crm_quick_invoices", { id: "original-invoice", work_order_id: "follow", firebase_uid: "owner", crm_customer_id: "original", invoice_number: "INV-O", status: "issued", delivery_status: "provider_accepted" });
  f.insert("trade_follow_up_messages", { ...values, id: "invoice-failed", event_key: "invoice-failed", recipient: "replacement@example.test", template_id: "invoice-template",
    context_json: '{"templateKind":"invoice","invoiceId":"original-invoice"}' });
  assert.equal((await f.load()).total, 1, "a matching email cannot make an old customer's invoice current");
  f.sqlite.exec("UPDATE trade_crm_customers SET record_status='archived' WHERE id='replacement'");
  assert.equal((await f.load()).total, 0, "inactive customer contacts are not email actions");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_follow_up_messages").get().count, 4);
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_follow_up_messages WHERE id='original-failed'").get().status, "uncertain");
});

test("projection scopes every row, redacts protected jobs and preserves bounded paging", async t => {
  const f = fixture(t);
  for (let i = 0; i < 13; i++) {
    const id = `job-${i}`; f.job(id);
    if (i % 2 === 0) { f.quote(id); f.delivery(id, id); }
    else {
      f.insert("trade_crm_appointments", { id, work_order_id: id, firebase_uid: "owner", status: "scheduled", revision: 1 });
      f.receipt(id, "failed");
    }
  }
  for (const [id, work, details] of [["private", { source_type: "opportunity" }, {}], ["internal-private", {}, { customer_source: "platform_private" }], ["bin", { record_status: "archived" }, {}], ["foreign", { firebase_uid: "foreign" }, {}]]) {
    f.job(id, work, details); f.quote(id); f.delivery(id, id);
  }
  assert.equal((await f.load({}, { ...owner, memberId: "missing", isOwner: false })).total, 0);
  const first = await f.load(); assert.equal(first.total, 13); assert.equal(first.items.length, 10); assert.equal(first.hasNext, true);
  const second = await f.load({ page: 2 }); assert.equal(second.total, 13); assert.equal(second.items.length, 3); assert.equal(second.hasNext, false);
  assert.deepEqual(first.items.map(item => item.label), [...Array(7).fill("Quote email"), ...Array(3).fill("Booking email")], "global ordering crosses commercial and operational groups before paging");
  assert.ok(second.items.every(item => item.label === "Booking email"));
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 13);
  assert.equal((await f.load({ workOrderId: "job-1" })).total, 1);
  assert.equal((await f.load({ workOrderId: "foreign" })).total, 0);
});

test("completed report exceptions follow only the currently issued report and clear after accepted email", async t => {
  const f = fixture(t); f.job("assessment", { stage: "completed" });
  f.insert("trade_rental_inspections", { id: "inspection", work_order_id: "assessment", firebase_uid: "owner", inspection_number: "INS-1", status: "issued",
    template_key: "vic-rental-minimum-standards", template_version: 1, rules_effective_from: "2026-01-01", module_selection_snapshot: '["minimum_standards"]',
    issued_report_id: "report-current", issued_at: now, created_at: now, updated_at: now });
  const event = (id, report, eventType, stamp, metadata = {}) => f.insert("trade_rental_inspection_events", { id, inspection_id: "inspection", report_id: report,
    firebase_uid: "owner", event_type: eventType, metadata: JSON.stringify(metadata), created_at: stamp });
  event("old", "report-old", "report_email_failed", now); assert.equal((await f.load()).total, 0);
  event("current", "report-current", "report_email_failed", now, { outcome: "indeterminate" });
  let result = await f.load(); assert.equal(result.total, 1); assert.equal(result.items[0].status, "uncertain"); assert.equal(result.items[0].tab, "files");
  event("accepted", "report-current", "report_email_accepted", later); result = await f.load(); assert.equal(result.total, 0);
});

test("accepted invoice failures respect retries and replacement commercial documents", async t => {
  const f = fixture(t); f.job("accepted", {}, { crm_customer_id: "customer" });
  const hash = "a".repeat(64), payment = { available: 0, method: "unavailable" };
  const snapshot = { schemaVersion: "trade-accepted-invoice-v1", invoice: { id: "accepted-invoice", number: "INV-A", documentLabel: "Invoice", currency: "AUD", dueAt: "2026-10-12" },
    source: { snapshotSha256: hash }, totals: { subtotalCents: 10000, taxCents: 1000, totalCents: 11000 }, payment };
  f.insert("trade_crm_accepted_invoices", { id: "accepted-invoice", acceptance_id: "acceptance", commercial_handoff_id: "handoff", quote_id: "quote", quote_version_id: "version",
    work_order_id: "accepted", firebase_uid: "owner", crm_customer_id: "customer", invoice_number: "INV-A", source_snapshot_sha256: hash,
    document_snapshot_json: JSON.stringify(snapshot), payment_snapshot_json: JSON.stringify(payment), subtotal_cents: 10000, tax_cents: 1000, total_cents: 11000,
    due_at: "2026-10-12", created_at: now, updated_at: now });
  f.insert("trade_crm_accepted_invoice_deliveries", { invoice_id: "accepted-invoice", firebase_uid: "owner", idempotency_key: "accepted-email", status: "failed", created_at: now, updated_at: now });
  assert.equal((await f.load()).total, 1);
  f.sqlite.exec("UPDATE trade_crm_accepted_invoice_deliveries SET next_attempt_at='2026-10-02T05:00:00.000Z'"); assert.equal((await f.load()).total, 0);
  f.sqlite.exec("UPDATE trade_crm_accepted_invoice_deliveries SET status='reconciliation_required',next_attempt_at=''"); assert.equal((await f.load()).items[0].status, "uncertain");
  f.sqlite.exec("UPDATE trade_crm_job_details SET crm_customer_id='replacement'");
  assert.equal((await f.load()).total, 0, "accepted invoice failures are not reassigned to the job's replacement customer");
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_crm_accepted_invoice_deliveries").get().status, "reconciliation_required");
  f.sqlite.exec("UPDATE trade_crm_job_details SET crm_customer_id='customer'; UPDATE trade_work_orders SET stage='cancelled'");
  assert.equal((await f.load()).total, 1, "a cancelled job retains its current customer's invoice obligation");
  f.insert("trade_crm_quick_invoices", { id: "replacement", work_order_id: "accepted", firebase_uid: "owner", invoice_number: "INV-2", status: "issued", delivery_status: "provider_accepted" });
  assert.equal((await f.load()).total, 0);
});

test("booking documents require a current activity binding and latest receipt", async t => {
  const f = fixture(t); f.job("documents");
  f.insert("trade_crm_appointments", { id: "appointment", work_order_id: "documents", firebase_uid: "owner", status: "scheduled" });
  const hash = "a".repeat(64), bindings = '[{"activityTemplateId":"activity","variantId":""}]';
  const document = { work_order_id: "documents", appointment_id: "appointment", firebase_uid: "owner", recipient_email_sha256: hash,
    activity_bindings: bindings, document_ids: '["document"]', document_sha256_set: JSON.stringify([hash]), pack_sha256: hash,
    delivery_generation: 1, status: "failed", failed_at: now, created_at: now, updated_at: now };
  f.insert("trade_activity_customer_document_deliveries", { ...document, id: "first-doc", idempotency_key: "first-doc" });
  assert.equal((await f.load()).total, 0, "a removed activity does not create a current delivery task");
  const snapshot = { contract: "tlink-creditex-job-intent-v1", program: { templateId: "program", programCode: "VEU" },
    activity: { templateId: "activity", serviceCategory: "electrical", variantId: "" }, siteJurisdiction: "VIC", catalogueReviewedOn: "2026-10-01" };
  f.insert("trade_work_order_compliance_intents", { id: "intent", work_order_id: "documents", installer_uid: "owner", compliance_organisation_id: "org",
    program_template_id: "program", activity_template_id: "activity", program_code: "VEU", service_category: "electrical", site_jurisdiction: "VIC",
    catalogue_reviewed_on: "2026-10-01", intent_snapshot: JSON.stringify(snapshot), intent_snapshot_sha256: hash, created_at: now, updated_at: now });
  assert.equal((await f.load()).items[0].label, "Booking documents");
  f.insert("trade_activity_customer_document_deliveries", { ...document, id: "accepted-doc", idempotency_key: "accepted-doc", delivery_generation: 2,
    status: "provider_accepted", provider_message_id: "provider-doc", accepted_at: later, failed_at: "", created_at: later, updated_at: later });
  assert.equal((await f.load()).total, 0);
});

function staff(f, id, permissions = {}) {
  f.insert('trade_team_members', { id, owner_uid: 'owner', member_uid: `uid-${id}`, display_name: id, status: 'active',
    job_scope: 'team', schedule_scope: 'team', can_view_quotes: 0, can_send_quotes: 0, can_view_invoices: 0,
    can_manage_invoices: 0, can_view_customers: 0, can_reschedule_jobs: 0, ...permissions });
  return { ownerUid: 'owner', memberId: id, actorUid: `uid-${id}`, isOwner: false };
}

test('office and finance staff see only the delivery categories their current grants can resolve', async t => {
  const f = fixture(t); f.job('job'); f.quote('job'); f.delivery('quote', 'job');
  f.insert('trade_crm_quick_invoices', { id: 'invoice', work_order_id: 'job', firebase_uid: 'owner', invoice_number: 'INV-1', status: 'issued', delivery_status: 'failed' });
  f.insert('trade_crm_appointments', { id: 'job', work_order_id: 'job', firebase_uid: 'owner', status: 'scheduled', revision: 1 }); f.receipt('job', 'failed');
  const finance = staff(f, 'finance', { can_view_invoices: 1, can_manage_invoices: 1 });
  const office = staff(f, 'office', { can_view_quotes: 1, can_send_quotes: 1, can_view_customers: 1, can_reschedule_jobs: 1 });
  const readOnly = staff(f, 'read-only', { can_view_quotes: 1, can_view_invoices: 1 });
  assert.deepEqual((await f.load({}, finance)).items.map(i => i.tab), ['invoice']);
  assert.deepEqual((await f.load({}, office)).items.map(i => i.tab).sort(), ['quote', 'schedule']);
  assert.equal((await f.load({}, readOnly)).total, 0);
  assert.equal((await f.load()).total, 3);
  f.sqlite.exec("UPDATE trade_team_members SET can_manage_invoices=0 WHERE id='finance'");
  assert.equal((await f.load({}, { ...finance, canManageInvoices: true })).total, 0, 'cached grants cannot survive a current revocation');
  f.sqlite.exec("UPDATE trade_team_members SET status='inactive' WHERE id='office'");
  assert.equal((await f.load({}, office)).total, 0);
  assert.equal((await f.load({}, { ...finance, actorUid: 'foreign-login', isOwner: true })).total, 0, 'actor identity and claimed owner flags cannot impersonate a member');
});

test('assigned-only staff include current visit collaboration and lose access when reassigned', async t => {
  const f = fixture(t); const finance = staff(f, 'finance', { job_scope: 'own', can_view_invoices: 1, can_manage_invoices: 1 });
  for (const id of ['own', 'visit', 'other', 'private', 'foreign']) {
    f.job(id, { assignee_member_id: id === 'own' ? finance.memberId : '', ...(id === 'foreign' ? { firebase_uid: 'foreign' } : {}), ...(id === 'private' ? { source_type: 'opportunity' } : {}) });
    f.insert('trade_crm_quick_invoices', { id, work_order_id: id, firebase_uid: 'owner', invoice_number: `INV-${id}`, status: 'issued', delivery_status: 'failed' });
  }
  f.insert('trade_crm_appointments', { id: 'visit', work_order_id: 'visit', firebase_uid: 'owner', assignee_member_id: finance.memberId, status: 'scheduled' });
  assert.deepEqual((await f.load({}, finance)).items.map(i => i.workOrderId).sort(), ['own', 'visit']);
  assert.equal((await f.load({ workOrderId: 'other' }, finance)).total, 0);
  f.sqlite.exec("UPDATE trade_work_orders SET assignee_member_id='' WHERE id='own'; UPDATE trade_crm_appointments SET status='cancelled' WHERE id='visit'");
  assert.equal((await f.load({}, finance)).total, 0);
});

test('crew assignment masks stale finance grants and own schedule grants cannot expose another booking', async t => {
  const f = fixture(t); const member = staff(f, 'staff', { can_view_invoices: 1, can_manage_invoices: 1, can_view_customers: 1, can_reschedule_jobs: 1, schedule_scope: 'own' });
  f.job('job', { assignee_member_id: member.memberId });
  f.insert('trade_crm_quick_invoices', { id: 'invoice', work_order_id: 'job', firebase_uid: 'owner', invoice_number: 'INV-1', status: 'issued', delivery_status: 'failed' });
  f.insert('trade_crm_appointments', { id: 'job', work_order_id: 'job', firebase_uid: 'owner', assignee_member_id: 'other', status: 'scheduled', revision: 1 }); f.receipt('job', 'failed');
  assert.deepEqual((await f.load({}, member)).items.map(i => i.tab), ['invoice']);
  f.sqlite.exec("UPDATE trade_crm_appointments SET assignee_member_id='staff'");
  assert.equal((await f.load({}, member)).total, 2);
  f.insert('trade_crews', { id: 'crew', owner_uid: 'owner', name: 'Subcontractor', lead_member_id: member.memberId });
  f.insert('trade_crew_members', { owner_uid: 'owner', crew_id: 'crew', member_id: member.memberId });
  assert.equal((await f.load({}, member)).total, 0, 'joining a crew immediately removes commercial access without relying on cached flags');
});

test('Cloudflare D1 accepts the complete live-grant exception query', async t => {
  const f = await migratedDataforceD1(); t.after(() => f.close());
  assert.deepEqual(await loadCustomerDeliveryExceptions(f.db, owner), { items: [], total: 0, page: 1, hasNext: false });
});
