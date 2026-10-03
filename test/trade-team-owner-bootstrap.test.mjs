import * as jobCollaboration from "../src/lib/trade-job-collaboration.ts";
import * as firebaseMfa from "../src/lib/firebase-mfa.ts";
import * as myobSecurityAudit from "../src/lib/myob-security-audit.ts";
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

function loadServer(database, overrides = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/lib/trade-team-server.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const mocks = {
    "./trade-crews-server": { applyTradeCrewAccess: async access => access },
    "@/lib/trade-job-collaboration": jobCollaboration, "./trade-job-collaboration": jobCollaboration,
    "./firebase-mfa": firebaseMfa,
    "./myob-security-audit": myobSecurityAudit,
    "../../db": { getD1: () => ({ prepare: (sql) => new Statement(database, sql) }) },
    "./firebase-server": { requireFirebaseIdentity: async () => { throw new Error("not used"); } },
    "./trade-access-server": {
      requireVerifiedTradeIdentity: async () => { throw new Error("not used"); },
      tradeAccountProjection: async () => null,
    },
    "./creditex-schema-guards": { ensureCreditexSchemaGuards: async () => {} },
    "./tlink-schema-guards": { ensureTlinkSchemaGuards: async () => {} },
    "./trade-team-permission-policy.mjs": { canAssignWithinScope: () => false },
    "./trade-business-context-server": {},
    "./trade-field-session-server": {
      isFieldSessionRequest: () => false,
      requireFieldSessionAccess: async () => { throw new Error("not used"); },
    },
    ...overrides,
  };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier === "./trade-mfa-server") {
      const loaded = { exports: {} };
      const mfaSource = fs.readFileSync(new URL("../src/lib/trade-mfa-server.ts", import.meta.url), "utf8");
      const compiled = ts.transpileModule(mfaSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
      return loaded.exports;
    }
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
    "can_manage_forms", "can_receive_customer_qa_notifications", "can_run_reports", "can_search_customers",
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
  const permissions = permissionColumns.map((column) => ["can_manage_team", "can_manage_forms", "can_receive_customer_qa_notifications"].includes(column) ? "0" : "1").join(", ");
  database.prepare(`INSERT INTO trade_team_members (
      id, owner_uid, member_uid, email, display_name, role, ${permissionColumns.join(", ")},
      job_scope, schedule_scope, status, invited_at, accepted_at, last_active_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'manager', ${permissions},
      'team', 'team', 'active', '', ?, ?, ?, ?)`)
    .run("owner-member", "owner-1", "owner-1", "owner@test.invalid", "Old Business Name",
      revision, revision, revision, revision);

  const server = loadServer(database);
  await server.ensureOwnerTeamMember("owner-1", "owner@test.invalid", "Owner Business");

  const owner = database.prepare(`SELECT display_name, can_manage_team, can_manage_forms, can_receive_customer_qa_notifications, updated_at
    FROM trade_team_members WHERE id = 'owner-member'`).get();
  assert.equal(owner.display_name, "Owner Business");
  assert.equal(owner.can_manage_team, 1);
  assert.equal(owner.can_manage_forms, 1);
  assert.equal(owner.can_receive_customer_qa_notifications, 1);
  assert.notEqual(owner.updated_at, revision);
});

test("new owner membership receives explicit form authoring without relying on a preset", async () => {
  const { database } = fixture();
  try {
    const memberId = await loadServer(database).ensureOwnerTeamMember("owner-1", "owner@test.invalid", "Owner Business");
    const row = database.prepare("SELECT member_uid,can_manage_forms,can_receive_customer_qa_notifications,status FROM trade_team_members WHERE id=?").get(memberId);
    assert.deepEqual({ ...row }, { member_uid: "owner-1", can_manage_forms: 1, can_receive_customer_qa_notifications: 1, status: "active" });
  } finally { database.close(); }
});


test("office team access reads the current Q&A notification grant without deriving it from other permissions", async () => {
  const { database } = fixture();
  try {
    database.exec("ALTER TABLE trade_team_members ADD can_send_sms INTEGER NOT NULL DEFAULT 0; CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT); INSERT INTO trade_accounts VALUES ('owner-1','Business');");
    await loadServer(database).ensureOwnerTeamMember("owner-1", "owner@test.invalid", "Business");
    database.exec("UPDATE trade_team_members SET id='staff',member_uid='staff-uid',can_receive_customer_qa_notifications=0");
    const server = loadServer(database, {
      "./firebase-server": { requireFirebaseIdentity: async () => ({ uid: "staff-uid", email: "staff@example.test", emailVerified: true }) },
      "./trade-access-server": { tradeAccountProjection: async () => ({ partnerType: "installer", approvedAbnAccess: true }) },
      "./trade-business-context-server": { selectTradeBusiness: async () => ({ role: "member", ownerUid: "owner-1", memberId: "staff" }) },
      "./trade-mfa-server": { requireTradeMyobSecondFactor: async () => {} },
    });
    const request = new Request("https://test/api/trade-team");
    for (const flag of [0, 1, 0]) {
      database.prepare("UPDATE trade_team_members SET can_receive_customer_qa_notifications=? WHERE id='staff'").run(flag);
      const access = await server.requireInstallerTeamAccess(request);
      assert.equal(access.canReceiveCustomerQaNotifications, Boolean(flag));
      assert.equal(access.isOwner, false);
      assert.equal(access.canViewQuotes, true);
    }
  } finally { database.close(); }
});
