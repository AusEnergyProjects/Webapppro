import assert from "node:assert/strict";
import test from "node:test";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import { loadTradeQuoteIndex } from "../src/lib/trade-crm-quote-index-server.ts";

const now = "2026-10-02T03:00:00.000Z";
const owner = { ownerUid: "owner", memberId: "owner-member", isOwner: true, jobScope: "team", canViewQuotes: true };
function fixture(t) {
  const { sqlite } = migratedDataforceSqlite(); t.after(() => sqlite.close());
  function insert(table, values) {
    const row = { ...values };
    for (const col of sqlite.prepare(`PRAGMA table_info(${table})`).all()) {
      if (col.notnull && col.dflt_value === null && row[col.name] === undefined) row[col.name] = /INT|REAL/.test(col.type) ? 0 : "";
    }
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  }
  const prepare = (sql, values = []) => ({ bind: (...args) => prepare(sql, args), all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  const db = { prepare };
  const job = (id, values = {}, detail = {}) => {
    insert("trade_work_orders", { id, firebase_uid: "owner", partner_type: "installer", title: `Work ${id}`, work_number: `JOB-${id}`, source_type: "internal", stage: "backlog", created_at: now, updated_at: now, ...values });
    insert("trade_crm_job_details", { id: `details-${id}`, work_order_id: id, firebase_uid: values.firebase_uid || "owner", customer_source: "trade_owned", pipeline_stage: "enquiry", ...detail });
  };
  const quote = (id, status = "draft", values = {}) => {
    insert("trade_crm_quotes", { id: `q-${id}`, work_order_id: id, firebase_uid: "owner", quote_number: `QUOTE-${id}`, status, current_version_number: 1, updated_at: now });
    insert("trade_crm_quote_versions", { id: `v-${id}`, quote_id: `q-${id}`, firebase_uid: "owner", version_number: 1, status, total_cents: 11000, issued_at: status === "draft" ? "" : now, updated_at: now, ...values });
  };
  const index = (params = {}, access = owner) => loadTradeQuoteIndex(db, access, new URLSearchParams(params));
  return { sqlite, insert, job, quote, index };
}

test("four quote cohorts use real quote activity and exclude unrelated jobs and the Bin", async t => {
  const f = fixture(t);
  for (const id of ["draft", "issued", "accepted", "declined"]) { f.job(id); f.quote(id, id === "draft" ? "draft" : "issued"); }
  for (const decision of ["accepted", "declined"]) f.insert("trade_crm_quote_acceptances", { id: `a-${decision}`, quote_id: `q-${decision}`, quote_version_id: `v-${decision}`, work_order_id: decision, firebase_uid: "owner", decision, decided_at: now, selected_total_cents: 22000 });
  f.job("quick", { source_reference: "quick-quote:request-id" });
  f.job("explicit", {}, { pipeline_stage: "quoting" });
  f.job("ordinary"); f.job("finished", { stage: "completed" });
  f.job("lost", { stage: "cancelled" }, { pipeline_stage: "lost" });
  f.job("cancelled", { stage: "cancelled" }); f.quote("cancelled");
  f.job("bin", { record_status: "archived" }, { pipeline_stage: "lost" }); f.quote("bin");
  f.job("stale-fields", {}, { quote_status: "accepted", quoted_value_cents: 999999 });
  const preparing = await f.index();
  assert.deepEqual(preparing.counts, { preparing: 3, awaiting: 1, accepted: 1, history: 3 });
  assert.deepEqual(preparing.items.map(item => item.id).sort(), ["draft", "explicit", "quick"]);
  const waiting = await f.index({ view: "awaiting" }); assert.deepEqual(waiting.items.map(item => item.id), ["issued"]);
  assert.equal(waiting.items[0].status, "issued");
  const accepted = await f.index({ view: "accepted" }); assert.equal(accepted.items[0].totalCents, 22000);
  const history = await f.index({ view: "history" }); assert.deepEqual(history.items.map(item => item.status).sort(), ["cancelled", "declined", "lost"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0, "listing never schedules, follows up or changes records");
});

test("replacement drafts retain the latest issued version decision and customer delivery", async t => {
  const f = fixture(t); f.job("replace"); f.quote("replace", "issued");
  f.insert("trade_crm_quote_versions", { id: "draft-2", quote_id: "q-replace", firebase_uid: "owner", version_number: 2, status: "draft", total_cents: 22000, updated_at: now });
  for (const [id, status, generation, role] of [["first", "delivered", 1, "acceptance"], ["retry", "reconciliation_required", 2, "acceptance"], ["copy", "delivered", 3, "business_copy"]]) {
    f.insert("trade_crm_quote_deliveries", { id, quote_version_id: "v-replace", work_order_id: "replace", firebase_uid: "owner", channel: "email", recipient_role: role, status, delivery_generation: generation, idempotency_key: id, created_at: now });
  }
  let item = (await f.index()).items[0];
  assert.equal(item.versionNumber, 2); assert.equal(item.totalCents, 22000);
  assert.equal(item.latestIssued.versionNumber, 1); assert.equal(item.latestIssued.status, "issued");
  assert.equal(item.delivery.status, "reconciliation_required"); assert.equal(item.delivery.label, "Check outgoing mailbox");
  f.insert("trade_crm_quote_acceptances", { id: "decision", quote_id: "q-replace", quote_version_id: "v-replace", work_order_id: "replace", firebase_uid: "owner", decision: "accepted", selected_total_cents: 16500, decided_at: now });
  item = (await f.index({ view: "accepted" })).items[0];
  assert.equal(item.versionNumber, 1); assert.equal(item.totalCents, 16500); assert.equal(item.latestIssued.status, "accepted");
  assert.equal((await f.index()).items.length, 0, "a stale replacement draft cannot hide acceptance");
});

test("issued-version changes do not inherit old decisions or delivery receipts", async t => {
  const f = fixture(t); f.job("revised"); f.quote("revised", "declined");
  f.insert("trade_crm_quote_acceptances", { id: "decline", quote_id: "q-revised", quote_version_id: "v-revised", work_order_id: "revised", firebase_uid: "owner", decision: "declined", decided_at: now });
  f.insert("trade_crm_quote_deliveries", { id: "old", quote_version_id: "v-revised", work_order_id: "revised", firebase_uid: "owner", channel: "email", recipient_role: "acceptance", status: "delivered", idempotency_key: "old" });
  f.insert("trade_crm_quote_versions", { id: "new", quote_id: "q-revised", firebase_uid: "owner", version_number: 2, status: "issued", total_cents: 33000, issued_at: now });
  f.sqlite.exec("UPDATE trade_crm_quotes SET current_version_number=2 WHERE id='q-revised'");
  const item = (await f.index({ view: "awaiting" })).items[0];
  assert.equal(item.status, "issued"); assert.equal(item.versionNumber, 2); assert.equal(item.latestIssued.versionNumber, 2); assert.equal(item.delivery, null);
});

test("quote totals include default required choices and accepted zero totals remain exact", async t => {
  const f = fixture(t); f.job("choices"); f.quote("choices");
  for (const [id, kind, recommended, total, position] of [["basic", "package", 0, 11000, 1], ["better", "package", 1, 22000, 2], ["extra", "addon", 1, 5500, 3]]) {
    f.insert("trade_crm_quote_choices", { id, quote_version_id: "v-choices", firebase_uid: "owner", choice_key: id, choice_kind: kind, group_key: "main", recommended, total_cents: total, position });
  }
  let item = (await f.index()).items[0]; assert.equal(item.totalCents, 33000); assert.equal(item.hasChoices, true);
  f.insert("trade_crm_quote_acceptances", { id: "zero", quote_id: "q-choices", quote_version_id: "v-choices", work_order_id: "choices", firebase_uid: "owner", decision: "accepted", selected_total_cents: 0 });
  item = (await f.index({ view: "accepted" })).items[0]; assert.equal(item.totalCents, 0);
});

test("owner, assignment, crew and quote permission apply to counts and rows", async t => {
  const f = fixture(t);
  for (const id of ["own", "visit", "crew", "other"]) { f.job(id); f.quote(id); }
  f.job("foreign", { firebase_uid: "another", source_reference: "quick-quote:foreign" });
  f.sqlite.exec("UPDATE trade_work_orders SET assignee_member_id='staff' WHERE id='own'; UPDATE trade_work_orders SET assignee_member_id='worker' WHERE id='crew'");
  f.insert("trade_crm_appointments", { id: "visit", firebase_uid: "owner", work_order_id: "visit", assignee_member_id: "staff", status: "completed" });
  for (const id of ["lead", "worker"]) {
    f.insert("trade_team_members", { id, owner_uid: "owner", member_uid: id, email: `${id}@example.test`, status: "active" });
  }
  f.insert("trade_crews", { id: "crew", owner_uid: "owner", lead_member_id: "lead", name: "Subcontractor crew" });
  for (const id of ["lead", "worker"]) {
    f.insert("trade_crew_members", { owner_uid: "owner", crew_id: "crew", member_id: id });
  }
  const staff = { ...owner, memberId: "staff", isOwner: false, jobScope: "own" };
  const staffResult = await f.index({}, staff); assert.equal(staffResult.counts.preparing, 2); assert.deepEqual(staffResult.items.map(item => item.id).sort(), ["own", "visit"]);
  const leadResult = await f.index({}, { ...staff, memberId: "lead" }); assert.deepEqual(leadResult.items.map(item => item.id), ["crew"]); assert.equal(leadResult.counts.preparing, 1);
  f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='worker'");
  assert.equal((await f.index({}, { ...staff, memberId: "lead" })).items.length, 0);
  assert.equal((await f.index()).counts.preparing, 4);
  await assert.rejects(f.index({}, { ...staff, canViewQuotes: false }), /QUOTE_VIEW_REQUIRED/);
});

test("protected customer details never appear in search, rows or totals from another owner", async t => {
  const f = fixture(t);
  f.insert("trade_crm_customers", { id: "customer", firebase_uid: "owner", first_name: "Secret", last_name: "Person" });
  f.job("private", { source_type: "opportunity", title: "Secret address", source_reference: "quick-quote:private" }, { crm_customer_id: "customer" });
  let result = await f.index({ search: "secret" }); assert.equal(result.pagination.total, 0);
  result = await f.index(); assert.equal(result.items[0].title, "Protected job"); assert.equal(result.items[0].customerName, "");
  f.insert("trade_crm_quotes", { id: "wrong-owner", work_order_id: "private", firebase_uid: "foreign", quote_number: "foreign quote" });
  assert.equal((await f.index()).items[0].quoteNumber, "");
});

test("search, counts and stable cursors share filters without broadening on wildcard or view changes", async t => {
  const f = fixture(t);
  for (let i = 0; i < 28; i++) { const id = `page-${String(i).padStart(2, "0")}`; f.job(id); f.quote(id); }
  f.job("waiting"); f.quote("waiting", "issued");
  const first = await f.index({ search: "QUOTE-page" });
  assert.equal(first.pagination.total, 28); assert.equal(first.items.length, 25); assert.equal(first.counts.awaiting, 0); assert.equal(first.pagination.hasNext, true);
  const second = await f.index({ search: "QUOTE-page", page: "2", cursor: first.pagination.nextCursor });
  assert.equal(second.pagination.total, 28); assert.equal(second.items.length, 3); assert.equal(second.pagination.hasNext, false);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 28);
  await assert.rejects(f.index({ view: "awaiting", page: "2", cursor: first.pagination.nextCursor }), /INVALID_CURSOR/);
  await assert.rejects(f.index({ search: "changed", page: "2", cursor: first.pagination.nextCursor }), /INVALID_CURSOR/);
  await assert.rejects(f.index({ page: "2" }), /INVALID_CURSOR/);
  await assert.rejects(f.index({ view: "unknown" }), /INVALID_QUOTE_VIEW/);
  assert.equal((await f.index({ search: "%" })).pagination.total, 0);
});

test("a quote for the previous customer is history and never actionable for the replacement customer", async t => {
  const f = fixture(t); f.job("reassigned", {}, { crm_customer_id: "replacement" }); f.quote("reassigned", "accepted");
  f.insert("trade_crm_customers", { id: "replacement", firebase_uid: "owner", first_name: "Replacement", last_name: "Customer" });
  f.sqlite.exec("UPDATE trade_crm_quotes SET crm_customer_id='original' WHERE id='q-reassigned'");
  f.insert("trade_crm_quote_acceptances", { id: "original-acceptance", quote_id: "q-reassigned", quote_version_id: "v-reassigned", work_order_id: "reassigned", firebase_uid: "owner", crm_customer_id: "original", decision: "accepted", selected_total_cents: 12345 });
  assert.equal((await f.index({ view: "accepted" })).items.length, 0);
  assert.equal((await f.index({ view: "awaiting" })).items.length, 0);
  let item = (await f.index({ view: "history" })).items[0]; assert.equal(item.status, "customer_changed"); assert.equal(item.customerName, "");
  assert.equal((await f.index({ view: "history", search: "Replacement" })).pagination.total, 0);
  f.sqlite.exec("UPDATE trade_crm_quotes SET crm_customer_id='replacement' WHERE id='q-reassigned'");
  assert.equal((await f.index({ view: "accepted" })).items.length, 0, "stale accepted version status cannot substitute for a matching customer decision");
  item = (await f.index({ view: "history" })).items[0]; assert.equal(item.status, "decision_missing");
});
