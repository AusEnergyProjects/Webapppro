import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as payload from "../src/lib/admin-notification-delivery-payload.mjs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports);
  return record.exports;
}

function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const migration of ["0012_elite_whizzer", "0013_magenta_vivisector", "0014_lonely_alex_wilder", "0252_admin_notification_bin"]) {
    sql.exec(read(`../drizzle/${migration}.sql`));
  }
  sql.exec(`CREATE TABLE admin_users (firebase_uid TEXT, email TEXT, display_name TEXT, role TEXT, status TEXT);
    INSERT INTO admin_users VALUES ('admin-1', 'admin@example.test', 'Administrator', 'admin', 'active');
    CREATE TABLE admin_audit_log (id TEXT PRIMARY KEY, admin_uid TEXT, action TEXT, entity_type TEXT, entity_id TEXT, summary TEXT, metadata TEXT, created_at TEXT);
    CREATE TABLE submitted_requests (id TEXT PRIMARY KEY, details TEXT);
    INSERT INTO submitted_requests VALUES ('request-1', 'Original submitted customer details');`);
  const state = { role: "admin", authError: "", afterSelection: null };
  const statement = (query, bindings = []) => ({
    bind: (...values) => statement(query, values),
    first: async () => sql.prepare(query).get(...bindings) || null,
    all: async () => {
      const results = sql.prepare(query).all(...bindings);
      if (query.includes("SELECT d.*, n.event_type")) {
        const hook = state.afterSelection; state.afterSelection = null; await hook?.();
      }
      return { results };
    },
    run: async () => ({ success: true, meta: { changes: Number(sql.prepare(query).run(...bindings).changes) } }),
  });
  const db = { prepare: statement, batch: async statements => {
    sql.exec("BEGIN");
    try {
      const results = [];
      for (const item of statements) results.push(await item.run());
      sql.exec("COMMIT"); return results;
    } catch (error) { sql.exec("ROLLBACK"); throw error; }
  } };
  const realAdmin = load("../src/lib/admin-server.ts", {
    "../../db": { getD1: () => db }, "@/lib/firebase-server": {},
    "@/lib/firebase-mfa": { FirebaseMfaRequiredError: class extends Error {} },
    "@/lib/myob-security-audit": {},
  });
  const delivery = load("../src/lib/admin-notification-delivery.ts", {
    "../../db": { getD1: () => db }, "@/lib/admin-notification-delivery-payload.mjs": payload,
  });
  const route = load("../src/app/api/admin/notifications/route.ts", {
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": { ...realAdmin, requireAdminIdentity: async () => {
      if (state.authError) throw new Error(state.authError);
      return { uid: "admin-1", role: state.role };
    } },
    "@/lib/admin-notifications": { ADMIN_NOTIFICATION_CATEGORIES: ["customer", "platform"], ADMIN_NOTIFICATION_PRIORITIES: ["low", "normal", "high", "urgent"], backfillActionableAdminNotifications: async () => {} },
    "@/lib/admin-notification-delivery": { ...delivery, dispatchAdminNotificationDeliveries: async () => ({ attempted: 0 }) },
  });
  const insert = (id, overrides = {}) => {
    const row = { id, event_key: id, event_type: "customer.quick_upgrade_no_match", category: "customer", priority: "high", title: "Quick upgrade request", summary: "Review saved request", entity_type: "trade_opportunity", entity_id: "request-1", requires_action: 1, status: "open", due_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...overrides };
    sql.prepare(`INSERT INTO admin_notifications (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  };
  const patch = (action, id = "notice", extra = {}, origin = "https://example.test") => route.PATCH(new Request("https://example.test/api/admin/notifications", {
    method: "PATCH", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ action, id, ...extra }),
  }));
  const get = async (query = "") => (await route.GET(new Request(`https://example.test/api/admin/notifications${query}`))).json();
  return { sql, db, state, insert, patch, get, delivery, notification: (id = "notice") => sql.prepare("SELECT * FROM admin_notifications WHERE id=?").get(id), ledger: (id = "notice") => sql.prepare("SELECT * FROM admin_notification_deliveries WHERE notification_id=?").get(id) };
}

test("Bin and restore preserve the request, original case status and delivered history", async t => {
  for (const status of ["open", "read", "resolved"]) {
    const f = fixture(t); f.insert("notice", { status, resolution_note: "Existing history" });
    f.sql.exec("UPDATE admin_notification_deliveries SET status='delivered', delivered_at='2026-01-02T00:00:00.000Z', attempts=1");
    const before = f.notification();
    assert.equal((await f.patch("bin")).status, 200);
    const binned = f.notification();
    assert.ok(binned.binned_at); assert.equal(binned.binned_by_uid, "admin-1");
    for (const column of ["status", "read_at", "resolved_at", "resolution_note", "entity_id", "metadata"]) assert.equal(binned[column], before[column]);
    assert.equal(f.ledger().status, "delivered");
    assert.equal((await f.patch("restore")).status, 200);
    assert.equal(f.notification().binned_at, ""); assert.equal(f.notification().binned_by_uid, "");
    assert.equal(f.notification().status, status); assert.equal(f.ledger().status, "delivered");
    assert.equal(f.sql.prepare("SELECT details FROM submitted_requests").get().details, "Original submitted customer details");
    assert.deepEqual(f.sql.prepare("SELECT action FROM admin_audit_log ORDER BY rowid").all().map(row => row.action), ["notification.bin", "notification.restore"]);
  }
});

test("Bin skips outstanding deliveries and restoring never replays them", async t => {
  for (const status of ["pending", "failed", "waiting_for_channel", "skipped"]) {
    const f = fixture(t); f.insert("notice");
    f.sql.prepare("UPDATE admin_notification_deliveries SET status=?, attempts=2").run(status);
    await f.patch("bin"); assert.equal(f.ledger().status, "skipped");
    await f.patch("restore"); assert.equal(f.ledger().status, "skipped"); assert.equal(f.ledger().attempts, 2);
  }
});

test("Bin actions enforce origins, authentication, workflow roles and record existence", async t => {
  const f = fixture(t); f.insert("notice");
  assert.equal((await f.patch("bin", "notice", {}, "https://other.test")).status, 403);
  f.state.authError = "AUTH_REQUIRED"; assert.equal((await f.patch("bin")).status, 401); f.state.authError = "";
  f.state.role = "support";
  assert.equal((await f.patch("bin")).status, 403); assert.equal((await f.patch("restore")).status, 403);
  assert.equal(f.notification().binned_at, "");
  f.state.role = "reviewer"; assert.equal((await f.patch("bin")).status, 200); assert.equal((await f.patch("restore")).status, 200);
  f.state.role = "owner"; assert.equal((await f.patch("bin")).status, 200);
  assert.equal((await f.patch("bin", "missing")).status, 404);
  f.insert("marker", { event_type: "platform.backfill_marker" });
  assert.equal((await f.patch("bin", "marker")).status, 404);
});

test("repeated Bin and restore calls are idempotent and do not duplicate audits", async t => {
  const f = fixture(t); f.insert("notice");
  assert.equal((await (await f.patch("restore")).json()).changed, false);
  await f.patch("bin"); const binnedAt = f.notification().binned_at;
  assert.equal((await (await f.patch("bin")).json()).changed, false);
  assert.equal(f.notification().binned_at, binnedAt);
  await f.patch("restore"); assert.equal((await (await f.patch("restore")).json()).changed, false);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM admin_audit_log").get().n, 2);
});

test("audit failure rolls back Bin and restore together with delivery changes", async t => {
  for (const action of ["bin", "restore"]) {
    const f = fixture(t); f.insert("notice"); if (action === "restore") await f.patch("bin");
    const before = f.notification(); const ledger = f.ledger();
    f.sql.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    assert.equal((await f.patch(action)).status, 500);
    assert.deepEqual(f.notification(), before); assert.deepEqual(f.ledger(), ledger);
  }
});

test("binned cases require restore for edits and remain out of mark-all-read", async t => {
  const f = fixture(t); f.insert("notice"); f.insert("active"); await f.patch("bin");
  for (const action of ["mark_read", "resolve", "reopen", "assign", "set_due", "set_priority", "retry_delivery"]) {
    assert.equal((await f.patch(action)).status, 409, action);
  }
  assert.equal((await f.patch("add_note", "notice", { note: "Retained internal note" })).status, 200);
  await f.patch("mark_all_read");
  assert.equal(f.notification().status, "open"); assert.equal(f.notification("active").status, "read");
});

test("default list and all active metrics exclude Bin while Bin view keeps details and audit", async t => {
  const f = fixture(t); f.insert("notice", { priority: "urgent", assigned_to_uid: "admin-1" }); f.insert("active");
  f.insert("resolved", { status: "resolved" }); f.insert("marker", { event_type: "platform.backfill_marker" });
  await f.patch("bin");
  const active = await f.get();
  assert.deepEqual(active.notifications.map(row => row.id), ["active", "resolved"]);
  assert.equal(active.counts.total, 2); assert.equal(active.counts.unread, 1); assert.equal(active.counts.action_required, 1);
  assert.equal(active.counts.urgent, 0); assert.equal(active.counts.overdue, 1); assert.equal(active.counts.mine, 0); assert.equal(active.counts.binned, 1);
  const bin = await f.get("?queue=bin");
  assert.deepEqual(bin.notifications.map(row => row.id), ["notice"]);
  assert.ok(bin.notifications[0].binnedAt); assert.equal(bin.notifications[0].binnedByUid, "admin-1");
  assert.equal(bin.notifications[0].slaState, "none"); assert.equal(bin.notifications[0].activity[0].action, "notification.bin");
  const sessionSource = read("../src/app/api/admin/session/route.ts");
  const sessionQuery = [...sessionSource.matchAll(/db\.prepare\(`(SELECT COUNT\(\*\) total,[\s\S]*?)`\)/g)].map(match => match[1]).find(query => query.includes("FROM admin_notifications"));
  const metrics = f.sql.prepare(sessionQuery).get();
  assert.equal(metrics.total, 2); assert.equal(metrics.unread, 1); assert.equal(metrics.urgent, 0); assert.equal(metrics.binned, 1);
});

function configureDelivery(t) {
  const original = process.env.AEA_OPS_ALERT_WEBHOOK_URL;
  process.env.AEA_OPS_ALERT_WEBHOOK_URL = "https://alerts.example.test";
  t.after(() => { if (original === undefined) delete process.env.AEA_OPS_ALERT_WEBHOOK_URL; else process.env.AEA_OPS_ALERT_WEBHOOK_URL = original; });
}

test("dispatcher skips Bin even with a forced retry, and rechecks after queue selection", async t => {
  configureDelivery(t);
  const f = fixture(t); f.insert("notice"); let calls = 0;
  const send = () => { calls += 1; return Promise.resolve(new Response("ok")); };
  await f.patch("bin");
  assert.equal((await f.delivery.dispatchAdminNotificationDeliveries({ notificationId: "notice", force: true, fetchImpl: send })).attempted, 0);
  await f.patch("restore");
  f.sql.exec("UPDATE admin_notification_deliveries SET status='pending'");
  f.state.afterSelection = () => f.patch("bin");
  assert.equal((await f.delivery.dispatchAdminNotificationDeliveries({ fetchImpl: send })).attempted, 0);
  assert.equal(calls, 0); assert.equal(f.ledger().status, "skipped");
});

test("an in-flight success is recorded truthfully after Bin and cannot replay after restore", async t => {
  configureDelivery(t);
  const f = fixture(t); f.insert("notice"); let calls = 0;
  const result = await f.delivery.dispatchAdminNotificationDeliveries({ fetchImpl: async () => {
    calls += 1; await f.patch("bin"); return new Response("ok", { status: 202 });
  } });
  assert.ok(f.notification().binned_at);
  assert.equal(f.ledger().status, "delivered"); assert.equal(f.ledger().attempts, 1);
  assert.equal(f.ledger().response_code, 202); assert.ok(f.ledger().delivered_at);
  assert.equal(result.delivered, 1); assert.equal(result.failed, 0);
  await f.patch("restore");
  await f.delivery.dispatchAdminNotificationDeliveries({ force: true, fetchImpl: async () => { calls += 1; return new Response("ok"); } });
  assert.equal(calls, 1); assert.equal(f.ledger().status, "delivered");
});

test("an in-flight failure cannot revive a binned delivery, even after restore", async t => {
  configureDelivery(t);
  for (const restore of [false, true]) {
    const f = fixture(t); f.insert("notice");
    const result = await f.delivery.dispatchAdminNotificationDeliveries({ fetchImpl: async () => {
      await f.patch("bin"); if (restore) await f.patch("restore");
      throw new TypeError("network failed");
    } });
    assert.equal(f.ledger().status, "skipped"); assert.equal(f.ledger().attempts, 0);
    assert.equal(result.delivered, 0); assert.equal(result.failed, 0);
  }
});
