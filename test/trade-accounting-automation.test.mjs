import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  acceptedInvoiceAccountingDispatch, accountingAutomationStatus, drainAccountingDispatches,
} from "../src/lib/trade-accounting-automation.ts";
import { queueAccountingDispatch, withAccountingDispatch } from "../src/lib/trade-accounting-automation-dispatch.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = "2026-09-28T03:00:00.000Z";
const later = (minutes) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function fixture(t, { historical = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(read("../drizzle/0020_lying_stick.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.exec(read("../drizzle/0181_accounting_export_defaults.sql"));
  sqlite.exec("CREATE TABLE trade_crm_accepted_invoices (id TEXT PRIMARY KEY, firebase_uid TEXT, work_order_id TEXT, status TEXT)");
  if (historical) sqlite.exec("INSERT INTO trade_crm_accepted_invoices VALUES ('old', 'owner', 'old-job', 'issued')");
  sqlite.exec(read("../drizzle/0204_accepted_invoice_accounting_automation.sql"));
  const prepare = (sql, values = []) => ({
    bind: (...bindings) => prepare(sql, bindings),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  });
  const db = { prepare, batch: async (items) => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const item of items) results.push(await item.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const invoice = (id = "invoice", owner = "owner", work = "job", status = "issued") => sqlite.prepare(
    "INSERT INTO trade_crm_accepted_invoices VALUES (?, ?, ?, ?)").run(id, owner, work, status);
  const connect = (provider = "xero", owner = "owner", sync = NOW, status = "connected", file = "company") => {
    const id = `${owner}-${provider}`;
    sqlite.prepare(`INSERT INTO trade_crm_integrations
      (id, firebase_uid, provider, status, external_account_id, default_account_reference,
       encrypted_credentials, last_sync_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'income', 'synthetic-unused', ?, ?, ?)`)
      .run(id, owner, provider, status, file, sync, NOW, NOW);
    return id;
  };
  const queue = (id = "invoice") => acceptedInvoiceAccountingDispatch(db, id, NOW).run();
  const row = (id = "invoice") => sqlite.prepare("SELECT * FROM trade_crm_accounting_dispatches WHERE invoice_id = ?").get(id);
  const drain = (exportInvoice, options = {}) => drainAccountingDispatches({ db, now: NOW, exportInvoice, ...options });
  return { sqlite, db, invoice, connect, queue, row, drain };
}

test("migration never queues historical invoices or grants existing MYOB connections automatic MFA authority", (t) => {
  const f = fixture(t, { historical: true }); f.connect("myob");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS total FROM trade_crm_accounting_dispatches").get().total, 0);
  assert.equal(f.sqlite.prepare("SELECT invoice_sync_mfa_verified_at AS grant FROM trade_crm_integrations").get().grant, "");
});

test("acceptance queues only its issued invoice and its owner's most recently used connected accounting company", async (t) => {
  const f = fixture(t);
  f.connect("xero", "owner", later(-10)); f.connect("myob", "owner", later(-5));
  f.connect("quickbooks", "owner", NOW, "disconnected"); f.connect("xero", "other", later(20));
  f.connect("google_calendar", "owner", later(20));
  f.invoice(); f.invoice("blocked", "owner", "blocked-job", "attention_required");
  f.invoice("unconnected", "unconnected-owner", "unconnected-job");
  for (const id of ["invoice", "blocked", "unconnected", "missing"]) await f.queue(id);
  const queued = f.row();
  assert.equal(queued.provider, "myob"); assert.equal(queued.connection_id, "owner-myob");
  assert.equal(queued.firebase_uid, "owner"); assert.equal(queued.external_account_id, "company");
  assert.equal(queued.account_reference, "income"); assert.equal(queued.status, "pending");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS total FROM trade_crm_accounting_dispatches").get().total, 1);
});

test("duplicate acceptance cannot retarget an invoice after its provider, company or mapping changes", async (t) => {
  const f = fixture(t); f.connect(); f.invoice(); await f.queue(); const original = f.row();
  f.sqlite.exec("UPDATE trade_crm_integrations SET external_account_id = 'different', default_account_reference = 'new-income'");
  f.connect("quickbooks", "owner", later(1)); await f.queue();
  assert.deepEqual(f.row(), original);
});

test("queue insertion participates in the acceptance transaction and rolls back with it", async (t) => {
  const f = fixture(t); f.connect();
  await assert.rejects(f.db.batch([
    f.db.prepare("INSERT INTO trade_crm_accepted_invoices VALUES ('invoice', 'owner', 'job', 'issued')"),
    acceptedInvoiceAccountingDispatch(f.db, "invoice", NOW),
    f.db.prepare("INSERT INTO trade_crm_accepted_invoices VALUES ('invoice', 'owner', 'job', 'issued')"),
  ]), /UNIQUE/);
  assert.equal(f.row(), undefined);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS total FROM trade_crm_accepted_invoices").get().total, 0);
});

test("concurrent drains claim an accepted invoice once", async (t) => {
  const f = fixture(t); f.connect(); f.invoice(); await f.queue();
  const entered = deferred(); const finish = deferred(); let calls = 0;
  const exportInvoice = async () => { calls++; entered.resolve(); await finish.promise; };
  const first = f.drain(exportInvoice); const second = f.drain(exportInvoice);
  await entered.promise; assert.equal(calls, 1); finish.resolve(); await Promise.all([first, second]);
  assert.equal(f.row().status, "synced"); assert.equal(f.row().attempts, 1);
  await f.drain(exportInvoice, { now: later(60) }); assert.equal(calls, 1);
});

test("expired leases recover and a stale worker cannot overwrite the replacement worker's result", async (t) => {
  const f = fixture(t); f.connect(); f.invoice(); await f.queue();
  const entered = deferred(); const finish = deferred();
  const first = f.drain(async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  await f.drain(async () => { throw new Error("PROVIDER_REQUEST_FAILED"); }, { now: later(11) });
  const replacement = f.row();
  assert.equal(replacement.status, "retry"); assert.equal(replacement.attempts, 2);
  finish.resolve(); await first;
  assert.deepEqual(f.row(), replacement);
});

test("transient failures back off and stop after eight attempts", async (t) => {
  const f = fixture(t); f.connect(); f.invoice(); await f.queue(); let calls = 0;
  const fail = async () => { calls++; throw new Error("PROVIDER_REQUEST_FAILED"); };
  await f.drain(fail);
  assert.equal(f.row().next_attempt_at, later(2)); assert.equal(f.row().status, "retry");
  await f.drain(fail, { now: later(1) }); assert.equal(calls, 1);
  for (let i = 1; i < 8; i++) await f.drain(fail, { now: f.row().next_attempt_at });
  assert.equal(f.row().attempts, 8); assert.equal(f.row().status, "needs_attention");
  await f.drain(fail, { now: later(24 * 60) }); assert.equal(calls, 8);
});

test("expired eighth-attempt leases stop before provider access while live leases and final retries remain safe", async (t) => {
  const f = fixture(t); f.connect();
  for (const id of ["exhausted", "last-retry", "still-running"]) {
    f.invoice(id, "owner", `${id}-job`); await f.queue(id);
  }
  f.sqlite.prepare(`UPDATE trade_crm_accounting_dispatches
    SET status = 'processing', attempts = 8, lease_token = 'old-lease', lease_expires_at = ?`).run(NOW);
  f.sqlite.exec("UPDATE trade_crm_accounting_dispatches SET attempts = 7 WHERE invoice_id = 'last-retry'");
  f.sqlite.prepare("UPDATE trade_crm_accounting_dispatches SET lease_expires_at = ? WHERE invoice_id = 'still-running'").run(later(1));
  const seen = [];
  await f.drain(async (row) => { seen.push(row.invoice_id); }, { invoiceId: "exhausted" });
  assert.deepEqual(seen, []);
  assert.equal(f.row("exhausted").status, "needs_attention");
  assert.equal(f.row("exhausted").last_error, "ACCOUNTING_RETRY_LIMIT");
  assert.equal(f.row("exhausted").attempts, 8);
  assert.equal(f.row("exhausted").lease_token, "");
  assert.equal(f.row("exhausted").lease_expires_at, "");
  assert.equal(f.row("last-retry").status, "processing");
  assert.equal(f.row("still-running").status, "processing");
  await f.drain(async (row) => { seen.push(row.invoice_id); });
  assert.deepEqual(seen, ["last-retry"]);
  assert.equal(f.row("last-retry").status, "synced");
  assert.equal(f.row("last-retry").attempts, 8);
  assert.equal(f.row("still-running").status, "processing");
  await f.drain(async (row) => { seen.push(row.invoice_id); }, { now: later(1) });
  assert.deepEqual(seen, ["last-retry"]);
  assert.equal(f.row("still-running").status, "needs_attention");
  assert.equal(f.row("still-running").last_error, "ACCOUNTING_RETRY_LIMIT");
});

test("setup and security failures stop until acted on while unknown error details stay private", async (t) => {
  const f = fixture(t); f.connect();
  for (const [index, code] of ["MFA_REQUIRED", "XERO_ACCOUNT_REQUIRED", "ACCOUNTING_COMPANY_FILE_MISMATCH", "ACCOUNT_INACTIVE"].entries()) {
    const id = `invoice-${index}`; f.invoice(id, "owner", `job-${index}`); await f.queue(id);
    await f.drain(async () => { throw new Error(code); }, { invoiceId: id });
    assert.equal(f.row(id).status, "needs_attention"); assert.equal(f.row(id).last_error, code);
  }
  f.invoice("private", "owner", "private-job"); await f.queue("private");
  await f.drain(async () => { throw new Error("Customer secret@example.test private-access-token"); }, { invoiceId: "private" });
  assert.equal(f.row("private").last_error, "ACCOUNTING_TEMPORARY_FAILURE");
  assert.equal(f.row("private").status, "retry");
});

test("drains are bounded, exact-invoice dispatch is scoped, and status cannot cross owners or jobs", async (t) => {
  const f = fixture(t); f.connect();
  for (let i = 0; i < 7; i++) { f.invoice(`invoice-${i}`, "owner", `job-${i}`); await f.queue(`invoice-${i}`); }
  const seen = [];
  await f.drain(async (row) => { seen.push(row.invoice_id); }, { invoiceId: "invoice-6" });
  assert.deepEqual(seen, ["invoice-6"]);
  await f.drain(async (row) => { seen.push(row.invoice_id); }); assert.equal(seen.length, 6);
  assert.equal((await accountingAutomationStatus(f.db, "owner", "job-6")).status, "synced");
  assert.equal(await accountingAutomationStatus(f.db, "other-owner", "job-6"), null);
  assert.equal(await accountingAutomationStatus(f.db, "owner", "missing-job"), null);
});

test("internal dispatch header is stripped and starts background work only for successful responses", async () => {
  const pending = []; const seen = []; const errors = [];
  const context = { waitUntil: (promise) => pending.push(promise), drain: async (id) => { seen.push(id); }, onError: (error) => errors.push(error) };
  const response = queueAccountingDispatch(withAccountingDispatch(Response.json({ ok: true }, { status: 201 }), "invoice"), context);
  assert.equal(response.status, 201); assert.equal(response.headers.has("X-TLink-Accounting-Dispatch"), false);
  assert.deepEqual(await response.json(), { ok: true }); await Promise.all(pending); assert.deepEqual(seen, ["invoice"]);
  const failed = queueAccountingDispatch(new Response("failed", { status: 500, headers: { "X-TLink-Accounting-Dispatch": "private-invoice" } }), context);
  assert.equal(failed.headers.has("X-TLink-Accounting-Dispatch"), false); assert.equal(pending.length, 1);
  const missing = new Response("no dispatch"); assert.equal(queueAccountingDispatch(missing, context), missing);
  assert.equal(withAccountingDispatch(new Response("failed", { status: 400 }), "invoice").headers.has("X-TLink-Accounting-Dispatch"), false);
  const failure = new Error("background failure");
  queueAccountingDispatch(withAccountingDispatch(Response.json({ ok: true }), "retry"), { ...context, drain: async () => { throw failure; } });
  await Promise.all(pending); assert.deepEqual(errors, [failure]);
});
