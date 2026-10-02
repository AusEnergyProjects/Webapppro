import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { CREDITEX_PERMISSIONS, creditexRolePermissions, creditexAllowedPermissions, setCreditexPermission, resolveCreditexPermissions, hasCreditexPermission, creditexPermissionSql } from "../src/lib/creditex-permissions.ts";
import { canEditCreditexFieldMasters } from "../src/lib/creditex-field-master-access.ts";

test("action dependencies are added by the editor and fail closed in stored grants", () => {
  const selected = setCreditexPermission("admin", [], "corrections", true);
  assert.deepEqual(new Set(selected), new Set(["jobs", "audit", "corrections"]));
  assert.deepEqual(setCreditexPermission("admin", selected, "jobs", false), []);
  assert.deepEqual(resolveCreditexPermissions("admin", ["messages_send", "tasks_complete"]), []);
  assert.equal(creditexAllowedPermissions("reviewer").includes("team_details"), true);
  assert.equal(creditexRolePermissions("reviewer").includes("team_details"), false);
});

test("granular migration preserves existing implied actions once without widening revoked tools", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  for (const table of ["compliance_users", "compliance_invitations"]) {
    db.exec(`CREATE TABLE ${table}(id TEXT,role TEXT,permissions_json TEXT)`);
    const insert = db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`);
    insert.run("legacy-default", "admin", null);
    insert.run("legacy-limited", "reviewer", '["jobs","audit","messages"]');
    insert.run("empty", "admin", "[]");
    insert.run("unknown", "admin", '["jobs","unknown"]');
    insert.run("admin", "admin", '["jobs","audit","tasks","team_access"]');
  }
  db.exec(readFileSync(new URL("../drizzle/0244_creditex_granular_permissions.sql", import.meta.url), "utf8"));
  for (const table of ["compliance_users", "compliance_invitations"]) {
    const get = id => db.prepare(`SELECT permissions_json FROM ${table} WHERE id=?`).get(id).permissions_json;
    assert.equal(get("legacy-default"), null);
    assert.deepEqual(JSON.parse(get("empty")), []);
    assert.deepEqual(JSON.parse(get("unknown")), ["jobs", "unknown"]);
    const grants = resolveCreditexPermissions("reviewer", get("legacy-limited"));
    assert.equal(grants.includes("corrections"), true);
    assert.equal(grants.includes("messages_send"), true);
    assert.equal(grants.includes("customer_calls"), false);
    assert.equal(grants.includes("forms_publish"), false);
    assert.equal(grants.includes("team_details"), false);
    const admin = resolveCreditexPermissions("admin", get("admin"));
    for (const key of ["job_lifecycle", "payouts", "tasks_create", "tasks_assign", "tasks_edit", "tasks_complete", "tasks_team", "team_details"]) assert.ok(admin.includes(key), key);
    const revoked = admin.filter(key => key !== "tasks_complete");
    db.prepare(`UPDATE ${table} SET permissions_json=? WHERE id='admin'`).run(JSON.stringify(revoked));
    assert.equal(resolveCreditexPermissions("admin", get("admin")).includes("tasks_complete"), false);
  }
});


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
