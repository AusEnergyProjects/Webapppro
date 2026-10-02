import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { CREDITEX_PERMISSIONS, creditexRolePermissions, resolveCreditexPermissions, hasCreditexPermission, creditexPermissionSql } from "../src/lib/creditex-permissions.ts";
import { canEditCreditexFieldMasters } from "../src/lib/creditex-field-master-access.ts";

test("legacy role defaults preserve authority while an empty custom set grants no tools", () => {
  for (const role of ["admin", "reviewer", "case_manager", "auditor"]) {
    assert.deepEqual(resolveCreditexPermissions(role, null), creditexRolePermissions(role));
    assert.deepEqual(resolveCreditexPermissions(role, []), []);
    assert.deepEqual(resolveCreditexPermissions(role, "[]"), []);
  }
  assert.equal(hasCreditexPermission({ role: "reviewer", permissions: ["jobs"] }, "jobs"), true);
  assert.equal(hasCreditexPermission({ role: "reviewer", permissions: ["jobs"] }, "audit"), false);
  assert.equal(hasCreditexPermission({ role: "reviewer", permissions: ["team_access"] }, "team_access"), false);
  assert.deepEqual(resolveCreditexPermissions("unknown", CREDITEX_PERMISSIONS), []);
});

test("malformed or unrecognised persisted permissions fail closed", () => {
  for (const value of ["", "{", "{}", "null", 1, false, ["jobs", "root"], ["jobs", 4]]) {
    assert.deepEqual(resolveCreditexPermissions("admin", value), [], JSON.stringify(value));
  }
});

test("live SQL permission guards match role and custom permissions for every capability", t => {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec("CREATE TABLE compliance_users(role TEXT,permissions_json TEXT)");
  for (const role of ["admin", "reviewer", "case_manager", "auditor", "other"]) {
    for (const stored of [null, "[]", JSON.stringify(CREDITEX_PERMISSIONS), '["jobs","tasks"]', '["forms","team_access"]', '["jobs","unrecognised"]']) {
      sql.prepare("DELETE FROM compliance_users").run(); sql.prepare("INSERT INTO compliance_users VALUES(?,?)").run(role, stored);
      for (const key of CREDITEX_PERMISSIONS) {
        const row = sql.prepare(`SELECT ${creditexPermissionSql(key)} allowed FROM compliance_users member`).get();
        assert.equal(Boolean(row.allowed), resolveCreditexPermissions(role, stored).includes(key), `${role}/${stored}/${key}`);
      }
    }
  }
  assert.throws(() => creditexPermissionSql("jobs", "member;DROP TABLE compliance_users"));
});

test("form edit permission is an additional gate, never a substitute for named identity or role", () => {
  const person = { email: "jane.smith@example.com", displayName: "Jane Smith", role: "reviewer", organisationCode: "CREDITEX-AU" };
  assert.equal(canEditCreditexFieldMasters(person), true);
  assert.equal(canEditCreditexFieldMasters({ ...person, permissions: [] }), false);
  assert.equal(canEditCreditexFieldMasters({ ...person, permissions: ["forms"] }), true);
  assert.equal(canEditCreditexFieldMasters({ ...person, role: "auditor", permissions: ["forms"] }), false);
  assert.equal(canEditCreditexFieldMasters({ ...person, email: "office@example.com", permissions: ["forms"] }), false);
});

test("capability migration validates arrays and preserves legacy role defaults", t => {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec("CREATE TABLE compliance_users(id TEXT); CREATE TABLE compliance_invitations(id TEXT); INSERT INTO compliance_users VALUES('old'); INSERT INTO compliance_invitations VALUES('old');");
  sql.exec(readFileSync(new URL("../drizzle/0241_creditex_member_permissions.sql", import.meta.url), "utf8"));
  for (const table of ["compliance_users", "compliance_invitations"]) {
    assert.equal(sql.prepare(`SELECT permissions_json FROM ${table}`).get().permissions_json, null);
    assert.throws(() => sql.prepare(`UPDATE ${table} SET permissions_json=?`).run("{}"), /CHECK/);
    assert.throws(() => sql.prepare(`UPDATE ${table} SET permissions_json=?`).run("broken"));
    sql.prepare(`UPDATE ${table} SET permissions_json=?`).run("[]");
    assert.equal(sql.prepare(`SELECT permissions_json FROM ${table}`).get().permissions_json, "[]");
  }
});
