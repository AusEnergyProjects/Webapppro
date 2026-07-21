import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DatabaseConsoleInputError,
  databaseBindingValue,
  databaseConsoleErrorResponse,
  databaseDeleteConfirmation,
  databaseDeleteStatements,
  databaseInsertStatements,
  databaseOffset,
  databasePageSize,
  databaseTablePolicy,
  isProtectedDatabaseColumn,
  normaliseDatabaseColumn,
  prepareDatabaseInsert,
  prepareDatabaseKey,
  presentDatabaseRow,
  quoteDatabaseIdentifier,
  databaseRowKeyToken,
  sqliteAffinity,
  validateDatabaseInsertForTable,
} from "../src/lib/admin-database-console.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../src/app/api/admin/database/route.ts");
const adminServer = read("../src/lib/admin-server.ts");
const databaseConsoleSource = read("../src/lib/admin-database-console.ts");
const portal = read("../src/components/AdminOperationsPortal.tsx");
const workspace = read("../src/components/AdminDatabaseWorkspace.tsx");
const styles = read("../src/components/AdminDatabaseWorkspace.module.css");

const column = (name, type = "TEXT", overrides = {}) => ({
  name,
  type,
  notNull: false,
  defaultValue: null,
  primaryKeyPosition: 0,
  hidden: 0,
  protected: false,
  ...overrides,
});

test("database identifiers are strictly validated before quoting", () => {
  assert.equal(quoteDatabaseIdentifier("trade_work_orders"), '"trade_work_orders"');
  for (const value of ["trade-work-orders", "jobs; DROP TABLE jobs", 'jobs"', "9jobs", "a".repeat(65)]) {
    assert.throws(() => quoteDatabaseIdentifier(value), DatabaseConsoleInputError);
  }
});

test("table mutation policy is explicit, default-deny and hides database internals", () => {
  for (const name of ["sqlite_schema", "d1_migrations", "_cf_KV", "__internal", "future_migrations", "tlink_product_search_data"]) {
    assert.equal(databaseTablePolicy(name).visible, false, name);
  }
  assert.equal(databaseTablePolicy("tlink_product_search", "CREATE VIRTUAL TABLE tlink_product_search USING fts5(name)").visible, false);
  for (const name of ["workspace_list_views", "trade_team_working_hours", "trade_team_unavailability"]) {
    const policy = databaseTablePolicy(name);
    assert.equal(policy.visible, true);
    assert.equal(policy.canInsert, true);
    assert.equal(policy.canDelete, true);
  }
  for (const name of ["admin_users", "admin_audit_log", "trade_crm_payment_links", "trade_crm_quote_events", "trade_work_orders", "future_application_table"]) {
    const policy = databaseTablePolicy(name);
    assert.equal(policy.visible, true, name);
    assert.equal(policy.canInsert, false, name);
    assert.equal(policy.canDelete, false, name);
  }
});

test("sensitive database columns are identified and redacted", () => {
  for (const name of ["token_hash", "encrypted_credentials", "state_hash", "push_token", "object_key", "refresh_token"]) {
    assert.equal(isProtectedDatabaseColumn(name), true, name);
  }
  assert.equal(isProtectedDatabaseColumn("customer_number"), false);
  const columns = [column("id"), column("token_hash", "TEXT", { protected: true }), column("description")];
  const longValue = "x".repeat(4_100);
  const result = presentDatabaseRow({ id: "row-1", token_hash: "private", description: longValue }, columns);
  assert.equal(result.values.token_hash, "[protected]");
  assert.equal(String(result.values.description).length, 4_003);
  assert.deepEqual(result.clippedColumns, ["description"]);
  const blobs = presentDatabaseRow({ id: "row-2", token_hash: null, description: [1, 2, 3] }, columns);
  assert.equal(blobs.values.description, "[BLOB 3 bytes]");
});

test("SQLite metadata and values use bounded affinity-aware conversion", () => {
  assert.deepEqual(normaliseDatabaseColumn({ name: "weekday", type: "integer", notnull: 1, dflt_value: "0", pk: 0, hidden: 0 }), {
    name: "weekday", type: "INTEGER", notNull: true, defaultValue: "0", primaryKeyPosition: 0, hidden: 0, protected: false,
  });
  assert.equal(sqliteAffinity("varchar(80)"), "text");
  assert.equal(sqliteAffinity("integer"), "integer");
  assert.equal(sqliteAffinity("double"), "real");
  assert.equal(sqliteAffinity("boolean"), "numeric");
  assert.equal(databaseBindingValue(column("enabled", "INTEGER"), true), 1);
  assert.equal(databaseBindingValue(column("weekday", "INTEGER"), "6"), 6);
  assert.equal(databaseBindingValue(column("price", "REAL"), "12.5"), 12.5);
  assert.throws(() => databaseBindingValue(column("weekday", "INTEGER"), "1.2"), /whole number/);
  assert.throws(() => databaseBindingValue(column("payload", "BLOB"), "abc"), /BLOB/);
  assert.throws(() => databaseBindingValue(column("required", "TEXT", { notNull: true }), null), /cannot be null/);
});

test("insert preparation applies only server-owned ID and timestamp defaults", () => {
  const columns = [
    column("id", "TEXT", { notNull: true, primaryKeyPosition: 1 }),
    column("owner_uid", "TEXT", { notNull: true }),
    column("reason", "TEXT", { notNull: true, defaultValue: "'Unavailable'" }),
    column("created_at", "TEXT", { notNull: true }),
    column("updated_at", "TEXT", { notNull: true }),
  ];
  const prepared = prepareDatabaseInsert(columns, { owner_uid: "owner-1" });
  assert.match(String(prepared.values.id), /^[0-9a-f-]{36}$/);
  assert.match(String(prepared.values.created_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(prepared.values.created_at, prepared.values.updated_at);
  assert.equal("reason" in prepared.values, false);
  assert.throws(() => prepareDatabaseInsert(columns, {}), /owner_uid is required/);
  assert.throws(() => prepareDatabaseInsert(columns, { owner_uid: "owner", unknown: "value" }), /not a column/);
  const spoofed = prepareDatabaseInsert(columns, { owner_uid: "owner", id: "caller-id", created_at: "old", updated_at: "old" });
  assert.notEqual(spoofed.values.id, "caller-id");
  assert.notEqual(spoofed.values.created_at, "old");
  assert.equal(spoofed.values.created_at, spoofed.values.updated_at);
});

test("D1 mutation builders keep row changes and privacy-safe audits in one ordered batch", () => {
  function fakeDatabase() {
    const calls = [];
    return {
      calls,
      db: {
        prepare(sql) {
          const call = { sql, bindings: [] };
          calls.push(call);
          return { bind(...bindings) { call.bindings = bindings; return this; } };
        },
      },
    };
  }
  const columns = [
    column("id", "TEXT", { notNull: true, primaryKeyPosition: 1 }),
    column("owner_uid", "TEXT", { notNull: true }),
    column("updated_at", "TEXT", { notNull: true }),
  ];
  const prepared = prepareDatabaseInsert(columns, { owner_uid: "owner-private" });
  const insertCapture = fakeDatabase();
  const inserts = databaseInsertStatements(insertCapture.db, "admin-1", "workspace_list_views", columns, prepared);
  assert.equal(inserts.length, 2);
  assert.match(insertCapture.calls[0].sql, /INSERT INTO "workspace_list_views"/);
  assert.match(insertCapture.calls[1].sql, /INSERT INTO admin_audit_log/);
  assert.equal(insertCapture.calls[1].bindings[2], "database.row_insert");
  assert.match(insertCapture.calls[1].bindings[3], /^workspace_list_views:[0-9a-f]{8}$/);
  assert.doesNotMatch(String(insertCapture.calls[1].bindings[5]), /owner-private/);

  const deleteCapture = fakeDatabase();
  const deletes = databaseDeleteStatements(deleteCapture.db, "admin-1", "workspace_list_views", ["id"], ["row-1"]);
  assert.equal(deletes.length, 2);
  assert.match(deleteCapture.calls[0].sql, /WHERE EXISTS \(SELECT 1 FROM "workspace_list_views" WHERE "id" = \?\)/);
  assert.equal(deleteCapture.calls[0].bindings.at(-1), "row-1");
  assert.equal(deleteCapture.calls[0].bindings[2], "database.row_delete");
  assert.match(deleteCapture.calls[0].bindings[3], /^workspace_list_views:[0-9a-f]{8}$/);
  assert.match(deleteCapture.calls[1].sql, /DELETE FROM "workspace_list_views" WHERE "id" = \?/);
  assert.deepEqual(deleteCapture.calls[1].bindings, ["row-1"]);
});

test("mutable tables retain their domain-specific insert rules", () => {
  assert.doesNotThrow(() => validateDatabaseInsertForTable("trade_team_working_hours", {
    owner_uid: "owner", team_member_id: "member", weekday: 1, start_minute: 480, end_minute: 1020, is_available: 1,
  }));
  assert.throws(() => validateDatabaseInsertForTable("trade_team_working_hours", {
    owner_uid: "owner", team_member_id: "member", weekday: 8, start_minute: 480, end_minute: 1020,
  }), /weekday/);
  assert.throws(() => validateDatabaseInsertForTable("trade_team_working_hours", {
    owner_uid: "owner", team_member_id: "member", weekday: 1, start_minute: 1020, end_minute: 480,
  }), /start_minute before end_minute/);
  assert.doesNotThrow(() => validateDatabaseInsertForTable("trade_team_unavailability", {
    owner_uid: "owner", team_member_id: "member", created_by_uid: "owner", starts_at: "2026-07-21T09:00:00Z", ends_at: "2026-07-21T10:00:00Z",
  }));
  assert.throws(() => validateDatabaseInsertForTable("trade_team_unavailability", {
    owner_uid: "owner", team_member_id: "member", created_by_uid: "owner", starts_at: "later", ends_at: "earlier",
  }), /valid dates/);
  assert.doesNotThrow(() => validateDatabaseInsertForTable("workspace_list_views", {
    owner_uid: "owner", owner_scope: "trade", view_key: "installer-jobs", preferences: "{}",
  }));
  assert.doesNotThrow(() => validateDatabaseInsertForTable("workspace_list_views", {
    owner_uid: "owner", owner_scope: "trade", view_key: "installer-jobs",
  }));
  assert.throws(() => validateDatabaseInsertForTable("workspace_list_views", {
    owner_uid: "owner", owner_scope: "trade", view_key: "installer-jobs", preferences: "[]",
  }), /JSON object/);
  assert.throws(() => validateDatabaseInsertForTable("workspace_list_views", {
    owner_uid: "owner", owner_scope: "unknown", view_key: "installer-jobs", preferences: "{}",
  }), /supported admin or trade list view/);
  assert.throws(() => validateDatabaseInsertForTable("workspace_list_views", {
    owner_uid: "owner", owner_scope: "trade:named:installer-jobs", view_key: "my jobs", preferences: "{}",
  }), /Create named views in their product workspace/);
});

test("deletion requires the exact complete primary key, including composites", () => {
  const columns = [
    column("tenant", "TEXT", { notNull: true, primaryKeyPosition: 1 }),
    column("id", "INTEGER", { notNull: true, primaryKeyPosition: 2 }),
    column("value"),
  ];
  assert.deepEqual(prepareDatabaseKey(columns, { id: "7", tenant: "owner" }).bindings, ["owner", 7]);
  assert.throws(() => prepareDatabaseKey(columns, { id: 7 }), /complete primary key/);
  assert.throws(() => prepareDatabaseKey(columns, { id: 7, tenant: "owner", extra: "x" }), /complete primary key/);
  assert.throws(() => prepareDatabaseKey([column("value")], {}), /no primary key/);
  assert.equal(databaseRowKeyToken("records", ["tenant", "id"], ["owner", 7]), databaseRowKeyToken("records", ["tenant", "id"], ["owner", 7]));
  assert.notEqual(databaseRowKeyToken("records", ["tenant", "id"], ["owner", 7]), databaseRowKeyToken("records", ["tenant", "id"], ["owner", 8]));
  assert.match(databaseDeleteConfirmation("records", ["tenant", "id"], ["owner", 7]), /^DELETE records [0-9a-f]{8}$/);
});

test("pagination and database errors stay bounded and user-safe", () => {
  assert.equal(databasePageSize("100"), 100);
  assert.equal(databasePageSize("500"), 25);
  assert.equal(databaseOffset("10000"), 10_000);
  assert.equal(databaseOffset("10001"), 0);
  assert.deepEqual(databaseConsoleErrorResponse(new Error("FOREIGN KEY constraint failed")), {
    status: 409,
    message: "This row is still referenced by other records. Remove those links through their normal workflow first.",
  });
  assert.equal(databaseConsoleErrorResponse(new Error("unexpected")), null);
});

test("the edge route is owner-only, bounded, bound-value based and atomically audited", () => {
  assert.match(route, /export const runtime = "edge"/);
  for (const method of ["GET", "POST", "DELETE"]) assert.match(route, new RegExp(`export async function ${method}`));
  assert.equal((route.match(/sameOrigin\(request\)/g) || []).length, 3);
  assert.equal((route.match(/requireAdminIdentity\(request, \["owner"\]\)/g) || []).length, 3);
  assert.match(route, /PRAGMA table_list/);
  assert.match(route, /PRAGMA table_xinfo/);
  assert.match(route, /DATABASE_MAX_BODY_LENGTH/);
  assert.match(route, /requireRecentOwnerAuthentication\(admin\.authTime\)/);
  assert.match(route, /body\.confirmation !== `ADD \$\{entry\.name\}`/);
  assert.match(route, /body\.confirmation !== expectedConfirmation/);
  assert.match(route, /db\.batch\(databaseInsertStatements/);
  assert.match(route, /db\.batch\(databaseDeleteStatements/);
  assert.match(databaseConsoleSource, /"database\.row_insert" \| "database\.row_delete"/);
  assert.match(databaseConsoleSource, /WHERE EXISTS \(SELECT 1 FROM \$\{identifier\} WHERE \$\{existsPredicate\}\)/);
  assert.match(adminServer, /adminAuditStatement/);
  assert.doesNotMatch(route, /\.exec\(/);
  assert.doesNotMatch(route, /body\.(sql|query|where|orderBy)/);
});

test("the operations portal mounts a lazy owner-only database workspace", () => {
  assert.match(portal, /"database" \| "access"/);
  assert.match(portal, /session\.role === "owner"/);
  assert.match(portal, /<span>16<\/span>Database/);
  assert.match(portal, /tab === "database" && session\.role === "owner" && <AdminDatabaseWorkspace api=\{api\} setStatus=\{setStatus\}/);
  assert.doesNotMatch(portal.slice(portal.indexOf("const loadWorkspace"), portal.indexOf("const loadSession")), /\/api\/admin\/database/);
  assert.match(workspace, /Raw SQL, bulk changes and schema controls are not exposed/);
  assert.match(workspace, /deleteTarget\.deleteConfirmation/);
  assert.match(workspace, /ADD \{detail\.name\}/);
  assert.match(workspace, /loadGeneration\.current/);
  assert.match(workspace, /role="dialog"/);
  assert.match(styles, /overflow: auto/);
  assert.match(styles, /max-width: 100%/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});
