import assert from "node:assert/strict";
import test from "node:test";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import { changeJobSalesOutcome, loadJobSalesOutcomes } from "../src/lib/trade-job-sales-outcome-server.ts";

const now = "2026-10-02T03:00:00.000Z";
const owner = { ownerUid: "owner", actorUid: "owner", memberId: "owner-member", isOwner: true, canManageJobs: true, jobScope: "team" };
function fixture(t) {
  const { sqlite } = migratedDataforceSqlite(); t.after(() => sqlite.close());
  function insert(table, values) {
    const row = { ...values };
    for (const col of sqlite.prepare(`PRAGMA table_info(${table})`).all()) {
      if (col.notnull && col.dflt_value === null && row[col.name] === undefined) row[col.name] = /INT|REAL/.test(col.type) ? 0 : "";
    }
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  }
  let beforeBatch;
  const prepare = (sql, values = []) => ({ bind: (...args) => prepare(sql, args),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  });
  const db = { prepare, batch: async statements => {
    beforeBatch?.(); beforeBatch = undefined;
    sqlite.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  insert("trade_team_members", { id: "owner-member", owner_uid: "owner", member_uid: "owner", email: "owner@example.test", status: "active", job_scope: "team", can_manage_jobs: 1 });
  insert("trade_work_orders", { id: "job", firebase_uid: "owner", partner_type: "installer", title: "Quote opportunity", work_number: "TLJ-1", revision: 1, stage: "backlog", created_at: now, updated_at: now });
  insert("trade_crm_job_details", { id: "detail", work_order_id: "job", firebase_uid: "owner", pipeline_stage: "quoting", quote_status: "issued", invoice_status: "not_started", created_at: now, updated_at: now });
  const capabilities = async (access = owner) => (await loadJobSalesOutcomes(db, access, ["job"])).job;
  const change = (changes = {}, access = owner) => changeJobSalesOutcome(db, access, { action: "mark_job_lost", workOrderId: "job", expectedRevision: 1, ...changes }, now);
  return { sqlite, insert, db, capabilities, change, race: callback => { beforeBatch = callback; } };
}

test("mark lost preserves records, stops only unsent messages, audits actor/reason and explicitly reopens without reviving tokens", async t => {
  const f = fixture(t);
  f.insert("trade_crm_quotes", { id: "quote", firebase_uid: "owner", work_order_id: "job", quote_number: "Q-1", status: "issued" });
  f.insert("trade_crm_quote_links", { id: "link", firebase_uid: "owner", work_order_id: "job", quote_id: "quote", quote_version_id: "version", token_hash: "immutable-hash", status: "active", expires_at: "2026-11-01" });
  for (const status of ["queued", "failed", "accepted", "uncertain"]) f.insert("trade_follow_up_messages", { id: status, owner_uid: "owner", work_order_id: "job", event_key: status, status, context_json: "{}" });
  f.insert("trade_work_order_tasks", { id: "task", work_order_id: "job", firebase_uid: "owner", title: "Sales follow-up" });
  assert.deepEqual(await f.capabilities(), { canMarkLost: true, canReopen: false });
  assert.deepEqual(await f.change({ reason: "Customer chose another offer" }), { revision: 2 });
  const job = f.sqlite.prepare("SELECT stage,record_status FROM trade_work_orders WHERE id='job'").get();
  assert.deepEqual({ ...job }, { stage: "cancelled", record_status: "active" });
  assert.equal(f.sqlite.prepare("SELECT pipeline_stage FROM trade_crm_job_details").get().pipeline_stage, "lost");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks").get().count, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_crm_quotes").get().status, "issued");
  assert.deepEqual(f.sqlite.prepare("SELECT status FROM trade_follow_up_messages ORDER BY id").all().map(row => row.status), ["accepted", "cancelled", "cancelled", "uncertain"]);
  const link = f.sqlite.prepare("SELECT status,token_hash FROM trade_crm_quote_links").get();
  assert.deepEqual({ ...link }, { status: "revoked", token_hash: "immutable-hash" });
  assert.match(f.sqlite.prepare("SELECT summary FROM trade_work_order_events WHERE event_type='job_marked_lost'").get().summary, /owner.*Customer chose another offer/);
  assert.deepEqual(await f.capabilities(), { canMarkLost: false, canReopen: true, lostReason: "Customer chose another offer", lostAt: now });
  await f.change({ action: "reopen_lost_job", expectedRevision: 2 });
  assert.equal(f.sqlite.prepare("SELECT stage FROM trade_work_orders").get().stage, "backlog");
  assert.equal(f.sqlite.prepare("SELECT pipeline_stage FROM trade_crm_job_details").get().pipeline_stage, "enquiry");
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_crm_quote_links").get().status, "revoked");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_follow_up_messages WHERE status='cancelled'").get().count, 2);
  assert.deepEqual(await f.capabilities(), { canMarkLost: true, canReopen: false }, "reopened job does not retain a current lost reason");
});

test("completed sales visits remain eligible but live visits and performed trade visits are protected", async t => {
  const f = fixture(t);
  f.insert("trade_crm_appointments", { id: "visit", work_order_id: "job", firebase_uid: "owner", appointment_type: "site_visit", status: "completed" });
  for (const kind of ["site_visit", "phone_call", "quote_review"]) {
    f.sqlite.prepare("UPDATE trade_crm_appointments SET appointment_type=?").run(kind);
    assert.equal((await f.capabilities()).canMarkLost, true, kind);
  }
  f.sqlite.exec("UPDATE trade_crm_appointments SET status='scheduled'");
  await assert.rejects(f.change(), /Cancel or review the active visit/);
  f.sqlite.exec("UPDATE trade_crm_appointments SET status='completed',appointment_type='installation'");
  await assert.rejects(f.change(), /recorded work/);
});

test("commercial, work, evidence and send-in-progress records block loss independently of stale CRM stage", async t => {
  const f = fixture(t);
  const cases = [
    ["UPDATE trade_crm_job_details SET quote_status='accepted'", "UPDATE trade_crm_job_details SET quote_status='issued'"],
    ["UPDATE trade_crm_job_details SET pipeline_stage='approved'", "UPDATE trade_crm_job_details SET pipeline_stage='quoting'"],
    ["UPDATE trade_crm_job_details SET invoiced_value_cents=100", "UPDATE trade_crm_job_details SET invoiced_value_cents=0"],
    ["UPDATE trade_work_orders SET stage='in_progress'", "UPDATE trade_work_orders SET stage='backlog'"],
  ];
  for (const [add, remove] of cases) { f.sqlite.exec(add); assert.equal((await f.capabilities()).canMarkLost, false); await assert.rejects(f.change()); f.sqlite.exec(remove); }
  for (const [table, values] of [
    ["trade_crm_quote_acceptances", { id: "accepted", decision: "accepted" }],
    ["trade_crm_quick_invoices", { id: "invoice", invoice_number: "I-1", status: "draft" }],
    ["trade_job_forms", { id: "form", answers: '{"result":"saved"}', status: "draft" }],
    ["trade_crm_signoffs", { id: "signoff" }],
    ["trade_crm_job_media", { id: "proof", category: "after" }],
    ["trade_crm_quote_deliveries", { id: "delivery", idempotency_key: "sending", status: "sending" }],
  ]) {
    f.insert(table, { firebase_uid: "owner", work_order_id: "job", ...values });
    assert.equal((await f.capabilities()).canMarkLost, false, table); await assert.rejects(f.change());
    f.sqlite.exec(`DELETE FROM ${table}`);
  }
  assert.equal((await f.capabilities()).canMarkLost, true);
});

test("sales changes enforce current owner, manager assignment and crew restrictions", async t => {
  const f = fixture(t);
  f.insert("trade_team_members", { id: "manager", owner_uid: "owner", member_uid: "staff", email: "staff@example.test", status: "active", can_manage_jobs: 1, job_scope: "own" });
  const staff = { ...owner, isOwner: false, actorUid: "staff", memberId: "manager", jobScope: "own" };
  assert.equal((await f.capabilities(staff)).canMarkLost, false);
  await assert.rejects(f.change({}, staff), /access/);
  f.sqlite.exec("UPDATE trade_work_orders SET assignee_member_id='manager'");
  assert.equal((await f.capabilities(staff)).canMarkLost, true);
  f.insert("trade_crews", { id: "crew", owner_uid: "owner", lead_member_id: "manager", name: "Crew" });
  f.insert("trade_crew_members", { owner_uid: "owner", crew_id: "crew", member_id: "manager" });
  assert.equal((await f.capabilities(staff)).canMarkLost, false);
  await assert.rejects(f.change({}, staff), /access/);
  await assert.rejects(f.change({}, { ...owner, ownerUid: "foreign" }), /JOB_NOT_FOUND/);
});

test("atomic guard rolls back archive, audit and link revocation when authority or business facts change after preflight", async t => {
  const f = fixture(t);
  const races = [
    ["UPDATE trade_team_members SET status='inactive'", "UPDATE trade_team_members SET status='active'"],
    ["UPDATE trade_crm_job_details SET quote_status='accepted'", "UPDATE trade_crm_job_details SET quote_status='issued'"],
    ["UPDATE trade_crm_job_details SET invoiced_value_cents=100", "UPDATE trade_crm_job_details SET invoiced_value_cents=0"],
    ["UPDATE trade_work_orders SET revision=2", "UPDATE trade_work_orders SET revision=1"],
  ];
  for (const [race, reset] of races) {
    f.race(() => f.sqlite.exec(race)); await assert.rejects(f.change(), /ONLINE_MUTATION_CONFLICT/);
    assert.equal(f.sqlite.prepare("SELECT stage FROM trade_work_orders").get().stage, "backlog");
    assert.equal(f.sqlite.prepare("SELECT pipeline_stage FROM trade_crm_job_details").get().pipeline_stage, "quoting");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
    f.sqlite.exec(reset);
  }
  await assert.rejects(f.change({ expectedRevision: 0 }), /REVISION_CONFLICT/);
  await assert.rejects(f.change({ expectedRevision: 2 }), /REVISION_CONFLICT/);
});
