import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/trade-team-server.ts", import.meta.url), "utf8");

class Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function loadServer(database) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/lib/trade-team-server.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const mocks = {
    "../../db": { getD1: () => ({ prepare: (sql) => new Statement(database, sql) }) },
    "./firebase-server": { requireFirebaseIdentity: async () => { throw new Error("not used"); } },
    "./trade-access-server": {
      requireVerifiedTradeIdentity: async () => { throw new Error("not used"); },
      tradeAccountProjection: async () => null,
    },
    "./creditex-schema-guards": { ensureCreditexSchemaGuards: async () => {} },
    "./tlink-schema-guards": { ensureTlinkSchemaGuards: async () => {} },
    "./trade-team-permission-policy.mjs": { canAssignWithinScope: () => false },
    "./trade-field-session-server": {
      isFieldSessionRequest: () => false,
      requireFieldSessionAccess: async () => { throw new Error("not used"); },
    },
  };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  const permissionColumns = [
    "can_create_jobs", "can_manage_jobs", "can_assign_jobs", "can_view_customers", "can_manage_customers",
    "can_view_quotes", "can_manage_quotes", "can_send_quotes", "can_view_invoices", "can_manage_invoices",
    "can_view_price_book", "can_manage_price_book", "can_apply_discounts", "can_reschedule_jobs",
    "can_manage_team", "can_edit_team_permissions", "can_view_field_evidence", "can_manage_field_evidence",
    "can_run_reports", "can_search_customers",
  ];
  database.exec(`CREATE TABLE trade_team_members (
    id text PRIMARY KEY, owner_uid text NOT NULL, member_uid text NOT NULL, email text NOT NULL,
    display_name text NOT NULL, role text NOT NULL,
    ${permissionColumns.map((column) => `${column} integer NOT NULL`).join(", ")},
    job_scope text NOT NULL, schedule_scope text NOT NULL, status text NOT NULL,
    invited_at text NOT NULL, accepted_at text NOT NULL, last_active_at text NOT NULL,
    created_at text NOT NULL, updated_at text NOT NULL
  )`);
  return { database, permissionColumns };
}

test("owner access bootstrap does not change the member revision when authoritative details already match", async () => {
  const { database, permissionColumns } = fixture();
  const revision = "2026-08-25T00:00:00.000Z";
  database.prepare(`INSERT INTO trade_team_members (
      id, owner_uid, member_uid, email, display_name, role, ${permissionColumns.join(", ")},
      job_scope, schedule_scope, status, invited_at, accepted_at, last_active_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'manager', ${permissionColumns.map(() => "1").join(", ")},
      'team', 'team', 'active', '', ?, ?, ?, ?)`)
    .run("owner-member", "owner-1", "owner-1", "owner@test.invalid", "Owner Business",
      revision, revision, revision, revision);

  const server = loadServer(database);
  const memberId = await server.ensureOwnerTeamMember("owner-1", "owner@test.invalid", "Owner Business");

  assert.equal(memberId, "owner-member");
  assert.equal(database.prepare("SELECT updated_at FROM trade_team_members WHERE id = ?").get(memberId).updated_at, revision);
});

test("owner access bootstrap updates the revision only when authoritative owner details need repair", async () => {
  const { database, permissionColumns } = fixture();
  const revision = "2026-08-25T00:00:00.000Z";
  const permissions = permissionColumns.map((column) => column === "can_manage_team" ? "0" : "1").join(", ");
  database.prepare(`INSERT INTO trade_team_members (
      id, owner_uid, member_uid, email, display_name, role, ${permissionColumns.join(", ")},
      job_scope, schedule_scope, status, invited_at, accepted_at, last_active_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'manager', ${permissions},
      'team', 'team', 'active', '', ?, ?, ?, ?)`)
    .run("owner-member", "owner-1", "owner-1", "owner@test.invalid", "Old Business Name",
      revision, revision, revision, revision);

  const server = loadServer(database);
  await server.ensureOwnerTeamMember("owner-1", "owner@test.invalid", "Owner Business");

  const owner = database.prepare(`SELECT display_name, can_manage_team, updated_at
    FROM trade_team_members WHERE id = 'owner-member'`).get();
  assert.equal(owner.display_name, "Owner Business");
  assert.equal(owner.can_manage_team, 1);
  assert.notEqual(owner.updated_at, revision);
});
