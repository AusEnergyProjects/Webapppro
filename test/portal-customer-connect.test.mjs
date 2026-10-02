import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { customerEmailHref, customerPhoneHref } from "../src/lib/portal-customer-connect.ts";
import * as permissions from '../src/lib/creditex-permissions.ts';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, require) {
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
  return loaded.exports;
}
class AccessError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE admin_users(id TEXT PRIMARY KEY,firebase_uid TEXT,role TEXT,status TEXT);
    CREATE TABLE compliance_organisations(id TEXT PRIMARY KEY,organisation_code TEXT,status TEXT);
    CREATE TABLE compliance_users(id TEXT PRIMARY KEY,organisation_id TEXT,firebase_uid TEXT,role TEXT,status TEXT,permissions_json TEXT);
    CREATE TABLE compliance_case_assignments(organisation_id TEXT,case_id TEXT,compliance_user_id TEXT,status TEXT);
    CREATE TABLE compliance_cases(id TEXT PRIMARY KEY,organisation_id TEXT,installer_uid TEXT,work_order_id TEXT,compliance_intent_id TEXT);
    CREATE TABLE trade_work_order_compliance_intents(id TEXT PRIMARY KEY,compliance_organisation_id TEXT,installer_uid TEXT,work_order_id TEXT,compliance_case_id TEXT,status TEXT,intent_snapshot TEXT,registry_activity_code TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,source_type TEXT,record_status TEXT,work_number TEXT,title TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,customer_source TEXT,crm_customer_id TEXT,service_site_id TEXT);
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT,first_name TEXT,last_name TEXT,business_name TEXT,email TEXT,phone TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT PRIMARY KEY,firebase_uid TEXT,customer_id TEXT,record_status TEXT,address_line_1 TEXT,suburb TEXT,address_state TEXT,postcode TEXT);
    CREATE TABLE trade_accounts(firebase_uid TEXT,business_name TEXT);
    INSERT INTO compliance_organisations VALUES('creditex','creditex','active'),('foreign','different','active');
    INSERT INTO compliance_users VALUES('member','creditex','user','auditor','active',NULL),('manager','creditex','manager-uid','admin','active',NULL),('foreign-member','foreign','foreign-user','admin','active',NULL);
    INSERT INTO admin_users VALUES('admin','platform-user','owner','active'),('support','support-user','support','active');`);
  const db = { prepare(sql) { return { bind(...values) { return { first: async () => sqlite.prepare(sql).get(...values) || null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) }; } }; } };
  const api = load("src/lib/portal-customer-connect-server.ts", name => {
    if (name.includes("trade-compliance-intent")) return { CREDITEX_PARTNER_ORGANISATION_CODE: "creditex" };
    if (name.includes("creditex-job-audit-server")) return { CreditexJobAuditError: AccessError };
    if (name.includes('creditex-permissions')) return permissions;
    throw Error(name);
  });
  const actor = { kind: "compliance", memberId: "member", uid: "user", organisationId: "creditex", role: "admin", name: "User" };
  function add(id, { org = "creditex", caseId = "", assigned = false } = {}) {
    sqlite.prepare("INSERT INTO trade_work_orders VALUES(?,?,'installer','internal','active',?,?)").run(id, `owner-${id}`, `JOB-${id}`, `Work ${id}`);
    sqlite.prepare("INSERT INTO trade_accounts VALUES(?,?)").run(`owner-${id}`, `Installer ${id}`);
    sqlite.prepare("INSERT INTO trade_crm_customers VALUES(?,?,'active',?,'Example','',?,'0400000000')").run(id, `owner-${id}`, id, `${id}@example.test`);
    sqlite.prepare("INSERT INTO trade_crm_service_sites VALUES(?,?,?,'active','12 Sample Street','Melbourne','VIC','3000')").run(id, `owner-${id}`, id);
    sqlite.prepare("INSERT INTO trade_crm_job_details VALUES(?,?,'trade_owned',?,?)").run(id, `owner-${id}`, id, id);
    sqlite.prepare("INSERT INTO trade_work_order_compliance_intents VALUES(?,?,?,?,?,'planned','{}','45')").run(id, org, `owner-${id}`, id, caseId);
    if (caseId) {
      sqlite.prepare("INSERT INTO compliance_cases VALUES(?,?,?,?,?)").run(caseId, org, `owner-${id}`, id, id);
      if (assigned) sqlite.prepare("INSERT INTO compliance_case_assignments VALUES(?,?,?,'assigned')").run(org, caseId, "member");
    }
  }
  return { sqlite, db, api, actor, add, list: (params = "", who = actor) => api.loadPortalConnectCustomers(db, who, new URLSearchParams(params)) };
}

test("customer list enforces actual role, organisation and linked-case assignment", async t => {
  const f = fixture(t); f.add("planned"); f.add("assigned", { caseId: "c1", assigned: true }); f.add("other", { caseId: "c2" }); f.add("foreign", { org: "foreign" });
  assert.deepEqual((await f.list()).customers.map(row => row.id), ["assigned", "planned"]);
  assert.ok((await f.list()).customers.every(row => row.headsetAllowed));
  assert.equal((await f.list("", { ...f.actor, memberId: "manager", uid: "manager-uid" })).customers.length, 3);
  assert.equal((await f.list("search=foreign")).customers.length, 0);
});
test("current membership revocation and reassignment remove contacts", async t => {
  const f = fixture(t); f.add("assigned", { caseId: "c1", assigned: true });
  f.sqlite.exec("UPDATE compliance_case_assignments SET status='removed'");
  assert.equal((await f.list()).customers.length, 0);
  f.sqlite.exec("UPDATE compliance_users SET status='suspended' WHERE id='member'");
  await assert.rejects(f.list(), error => error.status === 403);
});
test("inactive job, customer, site and superseded intents never expose contacts", async t => {
  const f = fixture(t); for (const id of ["work", "customer", "site", "intent", "valid"]) f.add(id);
  f.sqlite.exec("UPDATE trade_work_orders SET record_status='archived' WHERE id='work'; UPDATE trade_crm_customers SET record_status='archived' WHERE id='customer'; UPDATE trade_crm_service_sites SET record_status='archived' WHERE id='site'; UPDATE trade_work_order_compliance_intents SET status='superseded' WHERE id='intent';");
  assert.deepEqual((await f.list()).customers.map(row => row.id), ["valid"]);
});
test("broken case and cross-owner customer links fail closed", async t => {
  const f = fixture(t); f.add("broken", { caseId: "c1", assigned: true }); f.add("cross-owner");
  f.sqlite.exec("UPDATE compliance_cases SET compliance_intent_id='unrelated'; UPDATE trade_crm_customers SET firebase_uid='someone-else' WHERE id='cross-owner'");
  assert.equal((await f.list()).customers.length, 0);
});
test("platform admin contact access does not manufacture headset authority", async t => {
  const f = fixture(t); f.add("job", { caseId: "c1" });
  const actor = { ...f.actor, kind: "admin", memberId: "admin", uid: "platform-user" };
  assert.equal((await f.list("", actor)).customers[0].headsetAllowed, false);
  f.sqlite.exec("INSERT INTO compliance_users VALUES('real-membership','creditex','platform-user','auditor','active',NULL)");
  assert.equal((await f.list("", actor)).customers[0].headsetAllowed, false);
  f.sqlite.exec("INSERT INTO compliance_case_assignments VALUES('creditex','c1','real-membership','assigned')");
  assert.equal((await f.list("", actor)).customers[0].headsetAllowed, true);
  await assert.rejects(f.list("", { ...actor, memberId: "support", uid: "support-user" }), error => error.status === 403);
});
test("search is literal and paging is stable with bounded results", async t => {
  const f = fixture(t); for (let i = 0; i < 32; i++) f.add(`job${String(i).padStart(2,"0")}`);
  const first = await f.list(); const second = await f.list("page=2");
  assert.equal(first.customers.length, 30); assert.equal(first.hasNext, true); assert.equal(second.customers.length, 2);
  assert.equal(new Set([...first.customers, ...second.customers].map(row => row.id)).size, 32);
  assert.equal((await f.list("search=%25")).customers.length, 0);
  assert.equal((await f.list("search=job31")).customers[0].id, "job31");
});
test("contact links reject header injection, arbitrary schemes and invalid numbers", () => {
  assert.equal(customerEmailHref("customer@example.test"), "mailto:customer%40example.test");
  assert.equal(customerEmailHref("customer@example.test\r\nBcc:x@y.test"), "");
  assert.equal(customerPhoneHref("+61 (400) 000-000"), "tel:+61400000000");
  assert.equal(customerPhoneHref("javascript:alert(1)"), "");
});
