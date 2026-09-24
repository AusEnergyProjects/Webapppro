import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as firebaseMfa from "../src/lib/firebase-mfa.ts";
import * as namedOwner from "../src/lib/creditex-named-owner-server.ts";
import * as myobSecurityAudit from "../src/lib/myob-security-audit.ts";
import * as pure from "../src/lib/creditex-audit-calls.ts";

function load(file, dependencies) {
  const output = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports);
  return record.exports;
}
const access = load("../src/lib/compliance-access-server.ts", {
  "../../db": {}, "./firebase-server": {}, "./creditex-schema-guards": {},
  "./firebase-mfa": firebaseMfa, "./myob-security-audit": myobSecurityAudit,
  "./creditex-named-owner-server": namedOwner,
  "./trade-compliance-intent": { CREDITEX_PARTNER_ORGANISATION_CODE: "CREDITEX-AU" },
});
const server = load("../src/lib/creditex-audit-call-target-server.ts", {
  "./compliance-access-server": access,
  "./trade-compliance-intent": { CREDITEX_PARTNER_ORGANISATION_CODE: "CREDITEX-AU" },
  "./creditex-audit-calls": pure,
});
const actor = { organisationId: "org", membershipId: "member", uid: "auditor", role: "auditor" };
function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE compliance_organisations(id TEXT PRIMARY KEY, organisation_code TEXT, status TEXT);
    CREATE TABLE compliance_users(id TEXT PRIMARY KEY, organisation_id TEXT, firebase_uid TEXT, role TEXT, status TEXT);
    CREATE TABLE compliance_cases(id TEXT PRIMARY KEY, organisation_id TEXT, installer_uid TEXT, work_order_id TEXT);
    CREATE TABLE compliance_case_assignments(case_id TEXT, organisation_id TEXT, compliance_user_id TEXT, status TEXT);
    CREATE TABLE trade_work_order_compliance_intents(id TEXT PRIMARY KEY, compliance_organisation_id TEXT, installer_uid TEXT, work_order_id TEXT, compliance_case_id TEXT, status TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT, source_type TEXT, record_status TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT, firebase_uid TEXT, customer_source TEXT, crm_customer_id TEXT, service_site_id TEXT);
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY, firebase_uid TEXT, phone TEXT, record_status TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT PRIMARY KEY, firebase_uid TEXT, customer_id TEXT, record_status TEXT);
    INSERT INTO compliance_organisations VALUES ('org','CREDITEX-AU','active'),('other-org','OTHER','active');
    INSERT INTO compliance_users VALUES ('member','org','auditor','auditor','active'),('other-member','other-org','other-user','admin','active');
    INSERT INTO compliance_cases VALUES ('case','org','installer','job'),('other-case','other-org','installer','job');
    INSERT INTO compliance_case_assignments VALUES ('case','org','member','assigned');
    INSERT INTO trade_work_order_compliance_intents VALUES ('intent','org','installer','job','','planned'),('other-intent','other-org','installer','job','','planned');
    INSERT INTO trade_work_orders VALUES ('job','installer','installer','internal','active');
    INSERT INTO trade_crm_job_details VALUES ('job','installer','trade_owned','customer','site');
    INSERT INTO trade_crm_customers VALUES ('customer','installer','0412 345 678','active'),('other-customer','other-owner','0412 345 678','active');
    INSERT INTO trade_crm_service_sites VALUES ('site','installer','customer','active');
  `);
  const statement = (text, values = []) => ({
    bind: (...bindings) => statement(text, bindings),
    first: async () => sql.prepare(text).get(...values) || null,
  });
  return { sql, db: { prepare: statement }, close: () => sql.close() };
}
const forbidden = (error) => error instanceof access.ComplianceAccessError && error.status === 404;

test("assigned auditor can call the saved direct customer through a case or pre-case job", async (t) => {
  const f = fixture(); t.after(f.close);
  for (const target of [{ caseId: "case" }, { jobIntentId: "intent" }]) {
    const result = await server.loadAuditCallTarget(f.db, actor, target);
    assert.equal(result.customerPhone, "+61412345678");
    assert.equal(result.canCall, true);
    assert.equal(result.workOrderId, "job");
  }
});
test("rejects ambiguous, absent and oversized targets without loading a phone", async (t) => {
  const f = fixture(); t.after(f.close);
  for (const target of [{}, { caseId: "case", jobIntentId: "intent" }, { caseId: "x".repeat(181) }]) {
    await assert.rejects(server.loadAuditCallTarget(f.db, actor, target), (error) => error.status === 400);
  }
});
test("same customer phone never grants access to another organisation's job or case", async (t) => {
  const f = fixture(); t.after(f.close);
  await assert.rejects(server.loadAuditCallTarget(f.db, actor, { caseId: "other-case" }), forbidden);
  await assert.rejects(server.loadAuditCallTarget(f.db, actor, { jobIntentId: "other-intent" }), forbidden);
});
test("live membership and role prevail over stale admin claims", async (t) => {
  const f = fixture(); t.after(f.close);
  f.sql.exec("DELETE FROM compliance_case_assignments");
  await assert.rejects(server.loadAuditCallTarget(f.db, { ...actor, role: "admin" }, { caseId: "case" }), forbidden);
  f.sql.exec("UPDATE compliance_users SET role='admin' WHERE id='member'");
  assert.equal((await server.loadAuditCallTarget(f.db, actor, { caseId: "case" })).canCall, true);
  f.sql.exec("UPDATE compliance_users SET status='revoked' WHERE id='member'");
  await assert.rejects(server.loadAuditCallTarget(f.db, actor, { caseId: "case" }), forbidden);
});
test("linked-job entry cannot bypass a formal case assignment or a mismatched graph", async (t) => {
  const f = fixture(); t.after(f.close);
  f.sql.exec("UPDATE trade_work_order_compliance_intents SET compliance_case_id='case',status='case_linked' WHERE id='intent'");
  assert.equal((await server.loadAuditCallTarget(f.db, actor, { jobIntentId: "intent" })).caseId, "case");
  f.sql.exec("UPDATE compliance_case_assignments SET status='released'");
  await assert.rejects(server.loadAuditCallTarget(f.db, actor, { jobIntentId: "intent" }), forbidden);
  f.sql.exec("UPDATE compliance_users SET role='admin' WHERE id='member'; UPDATE trade_work_order_compliance_intents SET compliance_case_id='other-case' WHERE id='intent'");
  await assert.rejects(server.loadAuditCallTarget(f.db, actor, { jobIntentId: "intent" }), forbidden);
});
test("inactive, protected and cross-owner customer graphs cannot be dialled", async (t) => {
  for (const change of [
    "UPDATE trade_crm_customers SET record_status='binned' WHERE id='customer'",
    "UPDATE trade_work_orders SET record_status='binned'",
    "UPDATE trade_crm_service_sites SET record_status='binned'",
    "UPDATE trade_work_order_compliance_intents SET status='superseded' WHERE id='intent'",
    "UPDATE trade_crm_job_details SET customer_source='aea_protected'",
    "UPDATE trade_crm_job_details SET crm_customer_id='other-customer'",
    "UPDATE trade_crm_service_sites SET customer_id='other-customer'",
    "UPDATE trade_work_orders SET source_type='opportunity'",
  ]) {
    await t.test(change, async (t) => {
      const f = fixture(); t.after(f.close); f.sql.exec(change);
      const result = await server.loadAuditCallTarget(f.db, actor, { jobIntentId: "intent" });
      assert.equal(result.canCall, false); assert.equal(result.customerPhone, "");
    });
  }
});
test("provider continuation rechecks membership, assignment and the original number", async (t) => {
  const f = fixture(); t.after(f.close);
  const binding = { organisationId: "org", memberId: "member", uid: "auditor", caseId: "case", jobIntentId: "", customerPhone: "+61412345678" };
  assert.equal((await server.assertStoredAuditCallTarget(f.db, binding)).customerPhone, binding.customerPhone);
  f.sql.exec("UPDATE trade_crm_customers SET phone='0499999999' WHERE id='customer'");
  await assert.rejects(server.assertStoredAuditCallTarget(f.db, binding), (error) => error.code === "CREDITEX_CALL_TARGET_CHANGED");
  f.sql.exec("UPDATE compliance_case_assignments SET status='released'");
  await assert.rejects(server.assertStoredAuditCallTarget(f.db, binding), forbidden);
});
test("invalid Australian destinations stay unavailable and retained records remain readable", async (t) => {
  const f = fixture(); t.after(f.close);
  for (const phone of ["+12025550123", "1900123456", "", "+611300123456"]) {
    f.sql.prepare("UPDATE trade_crm_customers SET phone=? WHERE id='customer'").run(phone);
    const result = await server.loadAuditCallTarget(f.db, actor, { caseId: "case" });
    assert.equal(result.canCall, false); assert.equal(result.caseId, "case");
  }
});
