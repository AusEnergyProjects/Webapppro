import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SMS_AUTOMATION_RULES } from "../src/lib/trade-sms-automation.ts";
import { readSmsAutomationSettings, saveSmsAutomationSettings, scanSmsAutomations } from "../src/lib/trade-sms-automation-server.ts";

const NOW = new Date("2026-09-29T00:00:00.000Z"), ENABLED = new Date("2026-09-20T00:00:00.000Z");
const actor = (ownerUid = "owner", extra = {}) => ({ ownerUid, actorUid: "system:sms-automation", memberId: "", businessName: "Example Trade", displayName: "Automatic SMS", isOwner: true, canSendSms: true, ...extra });
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE trade_sms_automation_rules (owner_uid TEXT,kind TEXT,enabled INTEGER,delay_hours INTEGER,body TEXT,review_url TEXT,revision INTEGER,enabled_at TEXT,updated_at TEXT,next_scan_at TEXT DEFAULT '',scan_cursor TEXT DEFAULT '',PRIMARY KEY(owner_uid,kind));
    CREATE TABLE trade_sms_automation_events(id TEXT PRIMARY KEY,owner_uid TEXT,rule_kind TEXT,rule_revision INTEGER,work_order_id TEXT,customer_id TEXT,appointment_id TEXT,appointment_start TEXT,event_key TEXT UNIQUE,due_at TEXT,status TEXT,reason TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_sms_connections(firebase_uid TEXT,status TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT DEFAULT 'installer',record_status TEXT DEFAULT 'active',stage TEXT DEFAULT 'scheduled',source_type TEXT DEFAULT 'internal',work_number TEXT,title TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,service_site_id TEXT,customer_source TEXT DEFAULT 'trade_owned');
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT DEFAULT 'active',first_name TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT DEFAULT 'active',address_state TEXT);
    CREATE TABLE trade_crm_appointments(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,starts_at TEXT,status TEXT DEFAULT 'scheduled',completed_at TEXT DEFAULT '');
    CREATE TABLE trade_dataforce_sources(firebase_uid TEXT,work_order_id TEXT);`);
  const prepare = (sql, values = []) => ({ bind: (...args) => prepare(sql, args), first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }) });
  const db = { prepare, batch: async statements => { sqlite.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  const sends = [], calls = [];
  const services = { ownerAccess: async uid => actor(uid), send: async (...args) => { calls.push(args); sends.push(args); return { status: "queued" }; } };
  function job(id = "job", ownerUid = "owner", options = {}) {
    insert("trade_work_orders", { id, firebase_uid: ownerUid, work_number: `JOB-${id}`, title: "Installation", ...(options.work || {}) });
    insert("trade_crm_job_details", { work_order_id: id, firebase_uid: ownerUid, crm_customer_id: `${id}-customer`, service_site_id: `${id}-site`, ...(options.details || {}) });
    insert("trade_crm_customers", { id: `${id}-customer`, firebase_uid: ownerUid, first_name: "Alex" });
    insert("trade_crm_service_sites", { id: `${id}-site`, firebase_uid: ownerUid, address_state: options.state || "VIC" });
    insert("trade_crm_appointments", { id: `${id}-visit`, work_order_id: id, firebase_uid: ownerUid, starts_at: "2026-09-30T10:00", ...(options.visit || {}) });
  }
  async function enable(kinds = ["appointment_reminder"], ownerUid = "owner", now = ENABLED) {
    if (!sqlite.prepare("SELECT 1 FROM trade_sms_connections WHERE firebase_uid=?").get(ownerUid)) insert("trade_sms_connections", { firebase_uid: ownerUid, status: "connected" });
    return saveSmsAutomationSettings(actor(ownerUid), DEFAULT_SMS_AUTOMATION_RULES.map(rule => ({ ...rule, enabled: kinds.includes(rule.kind), reviewUrl: rule.kind === "review_request" ? "https://example.test/review" : "" })), db, now);
  }
  const events = () => sqlite.prepare("SELECT * FROM trade_sms_automation_events ORDER BY created_at,id").all();
  return { sqlite, db, insert, services, sends, calls, job, enable, events };
}
test("settings are owner-scoped, default off, and reject staff mutation or access", async t => {
  const f = fixture(t); assert.ok((await readSmsAutomationSettings(actor(), f.db)).rules.every(rule => !rule.enabled));
  await f.enable(); assert.ok((await readSmsAutomationSettings(actor("other"), f.db)).rules.every(rule => !rule.enabled));
  await assert.rejects(() => readSmsAutomationSettings(actor("owner", { isOwner: false }), f.db), /SMS_OWNER_REQUIRED/);
  await assert.rejects(() => saveSmsAutomationSettings(actor("owner", { isOwner: false }), [], f.db), /SMS_OWNER_REQUIRED/);
});
test("enabling requires a connection while offline disabled drafts can be saved", async t => {
  const f = fixture(t), rules = structuredClone(DEFAULT_SMS_AUTOMATION_RULES);
  await saveSmsAutomationSettings(actor(), rules, f.db, ENABLED);
  rules[0].enabled = true; await assert.rejects(() => saveSmsAutomationSettings(actor(), rules, f.db, NOW), /SMS_CONNECTION_REQUIRED/);
});
test("timing edits and reenabling set a new start time, body edits preserve existing future schedule", async t => {
  const f = fixture(t); let data = await f.enable(); data.rules[0].body += " Thank you.";
  data = await saveSmsAutomationSettings(actor(), data.rules, f.db, NOW); assert.equal(data.rules[0].enabledAt, ENABLED.toISOString());
  data.rules[0].delayHours = 48; data = await saveSmsAutomationSettings(actor(), data.rules, f.db, NOW); assert.equal(data.rules[0].enabledAt, NOW.toISOString());
  data.rules[0].enabled = false; data = await saveSmsAutomationSettings(actor(), data.rules, f.db, NOW); assert.equal(data.rules[0].enabledAt, "");
});
test("due reminder uses authoritative job/customer and remains single-use across concurrent scans and template edits", async t => {
  const f = fixture(t); f.job(); await f.enable();
  await Promise.all([scanSmsAutomations(f.db, f.services, NOW), scanSmsAutomations(f.db, f.services, NOW)]);
  assert.equal(f.sends.length, 1); assert.equal(f.events()[0].status, "sent");
  assert.equal(f.sends[0][1], "job-customer"); assert.equal(f.sends[0][4], "job"); assert.equal(f.sends[0][5], "service"); assert.match(f.sends[0][3], /^sms-auto-/);
  const data = await readSmsAutomationSettings(actor(), f.db); data.rules[0].body = "Hi {customer_first_name}, see you soon.";
  await saveSmsAutomationSettings(actor(), data.rules, f.db, NOW); await scanSmsAutomations(f.db, f.services, NOW); assert.equal(f.sends.length, 1);
});

test("every SMS automation excludes imported original visits but allows new visits and ignores foreign source claims", async t => {
  for (const kind of ["appointment_reminder", "appointment_follow_up", "review_request"]) {
    const f = fixture(t);
    const past = kind !== "appointment_reminder";
    const visit = past
      ? { starts_at: "2026-09-22T10:00", status: "completed", completed_at: "2026-09-22T01:00:00Z" }
      : { starts_at: "2026-09-30T10:00", status: "scheduled", completed_at: "" };
    f.job("imported", "owner", { visit: { ...visit, id: "imported:visit" } });
    f.insert("trade_dataforce_sources", { firebase_uid: "owner", work_order_id: "imported" });
    f.insert("trade_crm_appointments", { ...visit, id: "new-tlink-visit", work_order_id: "imported", firebase_uid: "owner" });
    f.job("normal", "owner", { visit: { ...visit, id: "normal:visit" } });
    f.insert("trade_dataforce_sources", { firebase_uid: "other", work_order_id: "normal" });
    f.job("foreign", "other", { visit: { ...visit, id: "foreign:visit" } });
    await f.enable([kind]);
    await scanSmsAutomations(f.db, f.services, NOW);
    assert.deepEqual(f.events().map(event => event.appointment_id).sort(), ["new-tlink-visit", "normal:visit"], kind);
    assert.deepEqual(f.calls.map(args => args[6].appointmentId).sort(), ["new-tlink-visit", "normal:visit"], "only injected synthetic transport is called");
    f.sqlite.prepare("UPDATE trade_crm_appointments SET starts_at=? WHERE id='imported:visit'")
      .run(past ? "2026-09-22T10:05" : "2026-09-30T10:05");
    await scanSmsAutomations(f.db, f.services, new Date(NOW.getTime() + 6 * 60_000));
    assert.equal(f.events().length, 2, "editing the original imported visit must never enable automatic outreach");
    assert.equal(f.calls.length, 2);
  }
});
test("separate follow-up and review rules both send once and reviews request marketing consent", async t => {
  const f = fixture(t); f.job("past", "owner", { visit: { starts_at: "2026-09-22T10:00", status: "completed", completed_at: "2026-09-22T01:00:00Z" } });
  await f.enable(["appointment_follow_up", "review_request"]); await scanSmsAutomations(f.db, f.services, NOW);
  assert.equal(f.sends.length, 2); assert.deepEqual(f.sends.map(args => args[5]).sort(), ["marketing", "service"]);
  assert.equal(new Set(f.events().map(event => event.event_key)).size, 2);
});
test("service permission does not authorize review requests and STOP remains a final-send block", async t => {
  const f = fixture(t); f.job("past", "owner", { visit: { starts_at: "2026-09-22T10:00", status: "completed", completed_at: "2026-09-22T01:00:00Z" } });
  await f.enable(["appointment_follow_up", "review_request"]);
  f.services.send = async (...args) => { if (args[5] === "marketing") throw new Error("SMS_MARKETING_CONSENT_REQUIRED"); throw new Error("SMS_OPTED_OUT"); };
  await scanSmsAutomations(f.db, f.services, NOW); assert.equal(f.sends.length, 0);
  assert.deepEqual(f.events().map(event => event.reason).sort(), ["SMS_MARKETING_CONSENT_REQUIRED", "SMS_OPTED_OUT"]);
});
test("private, cancelled, cross-tenant and unconfirmed-completion visits never become send candidates", async t => {
  const f = fixture(t); f.job("private", "owner", { details: { customer_source: "platform_private" } });
  f.job("cancelled", "owner", { visit: { status: "cancelled" } }); f.job("foreign", "other");
  f.job("unconfirmed", "owner", { visit: { starts_at: "2026-09-22T10:00", status: "completed", completed_at: "" } });
  f.job("noshow", "owner", { visit: { starts_at: "2026-09-22T10:00", status: "no_show" } });
  await f.enable(["appointment_reminder", "appointment_follow_up"]); await scanSmsAutomations(f.db, f.services, NOW); assert.equal(f.sends.length, 0);
});
test("new enablement and late historical times do not cause a catchup burst", async t => {
  const f = fixture(t); f.job("old", "owner", { visit: { starts_at: "2026-09-29T09:00" } });
  await f.enable(["appointment_reminder"], "owner", new Date(NOW.getTime() - 60000));
  await scanSmsAutomations(f.db, f.services, NOW); assert.equal(f.sends.length, 0);
});
test("revoked businesses cannot be scanned and last-moment rule changes stop transport", async t => {
  const f = fixture(t); f.job(); await f.enable();
  f.services.ownerAccess = async () => { throw new Error("SMS_JOB_ACCESS_REQUIRED"); };
  await scanSmsAutomations(f.db, f.services, NOW); assert.equal(f.events().length, 0);
  f.services.ownerAccess = async uid => actor(uid); f.services.send = async () => { throw new Error("SMS_AUTOMATION_CHANGED"); };
  await scanSmsAutomations(f.db, f.services, new Date(NOW.getTime() + 61000)); assert.equal(f.events()[0].status, "blocked");
});
test("unknown delivery and interrupted reservations never automatically replay", async t => {
  const f = fixture(t); f.job(); await f.enable(); let calls = 0;
  f.services.send = async () => { calls++; throw new Error("provider timed out"); };
  await scanSmsAutomations(f.db, f.services, NOW); await scanSmsAutomations(f.db, f.services, new Date(NOW.getTime() + 61000));
  assert.equal(calls, 1); assert.equal(f.events()[0].status, "unknown");
  f.sqlite.prepare("UPDATE trade_sms_automation_events SET status='reserved',updated_at=?").run(ENABLED.toISOString());
  await scanSmsAutomations(f.db, f.services, new Date(NOW.getTime() + 360000)); assert.equal(calls, 1); assert.equal(f.events()[0].reason, "SMS_SEND_INTERRUPTED");
});
test("keyset scanning progresses past forty ineligible candidates without starving a later eligible job", async t => {
  const f = fixture(t); for (let index = 0; index < 41; index++) f.job(`a${String(index).padStart(2, "0")}`, "owner", { state: "" });
  // Empty state falls back in fixture; make the invalid-state boundary explicit in persisted rows.
  f.sqlite.exec("UPDATE trade_crm_service_sites SET address_state='UNKNOWN'"); f.job("z-eligible"); await f.enable();
  await scanSmsAutomations(f.db, f.services, NOW); assert.equal(f.sends.length, 0);
  await scanSmsAutomations(f.db, f.services, new Date(NOW.getTime() + 61000)); assert.equal(f.sends.length, 1); assert.equal(f.sends[0][4], "z-eligible");
});
test("one scan is bounded to eight sends and the next scan continues", async t => {
  const f = fixture(t); for (let index = 0; index < 12; index++) f.job(`job-${String(index).padStart(2, "0")}`);
  await f.enable(); await scanSmsAutomations(f.db, f.services, NOW); assert.equal(f.sends.length, 8);
  await scanSmsAutomations(f.db, f.services, new Date(NOW.getTime() + 61000)); assert.equal(f.sends.length, 12);
});
