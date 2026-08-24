import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/app/api/trade-team/route.ts", import.meta.url), "utf8");

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async run() { return this.runSync(); }
}

function d1(database) {
  return {
    prepare: (sql) => new Statement(database, sql),
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const managerAccess = {
  ownerUid: "owner-1", actorUid: "manager-uid", memberId: "manager-1", businessName: "Installer",
  displayName: "Delegated Manager", isOwner: false, canManageTeam: true, canEditTeamPermissions: false,
  canCreateJobs: false, canManageJobs: false, canAssignJobs: false, jobScope: "team",
  canViewCustomers: false, canManageCustomers: false, canViewQuotes: false, canManageQuotes: false,
  canSendQuotes: false, canViewInvoices: false, canManageInvoices: false, canViewPriceBook: false,
  canManagePriceBook: false, canApplyDiscounts: false, scheduleScope: "team", canRescheduleJobs: false,
  canViewFieldEvidence: false, canManageFieldEvidence: false, canRunReports: false, canSearchCustomers: false,
};

function loadRoute(database, aborted, currentAccess = managerAccess) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/app/api/trade-team/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} }; const databaseBinding = d1(database);
  const mocks = {
    "../../../../db": { getD1: () => databaseBinding },
    "@/lib/admin-server": { adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum), sameOrigin: () => true },
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => ({ uid: "manager-uid" }) },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => currentAccess,
      canManageTeam: (value) => value.isOwner || value.canManageTeam,
      canAssignJob: () => false, assignedJob: async () => { throw new Error("not used"); } },
    "@/lib/trade-team-sync-server": { guardedOnlineChildMutationBatch: async () => {}, guardedOnlineJobMutationBatch: async () => {},
      jobSyncChangeStatements: () => [], nextJobRevision: (value) => Number(value) + 1 },
    "@/lib/trade-mobile-device-revocation": { abortMemberDeviceUploads: async (ownerUid, memberId) => aborted.push({ ownerUid, memberId }) },
    "@/lib/trade-team-lifecycle-policy.mjs": { memberLifecycleDecision: (access, target) => {
      if (target.memberUid === access.ownerUid) return { allowed: false, reason: "owner_protected" };
      if (target.memberId === access.memberId || target.memberUid === access.actorUid) return { allowed: false, reason: "self_protected" };
      return { allowed: true };
    } },
    "@/lib/trade-field-access-policy.mjs": {
      normalizeFieldAccessName: (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU").slice(0, 160),
    },
    "@/lib/trade-rental-schema-guards": {
      ensureTradeRentalSchemaGuards: async () => {},
    },
    "@/lib/trade-rental-assignment-server": {
      isRentalInspectionAssignmentConflict: () => false,
      rentalInspectionAssignmentStatements: () => [],
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
  const permissionColumns = ["can_create_jobs", "can_manage_jobs", "can_assign_jobs", "can_view_customers",
    "can_manage_customers", "can_view_quotes", "can_manage_quotes", "can_send_quotes", "can_view_invoices",
    "can_manage_invoices", "can_view_price_book", "can_manage_price_book", "can_apply_discounts",
    "can_reschedule_jobs", "can_manage_team", "can_edit_team_permissions", "can_view_field_evidence",
    "can_manage_field_evidence", "can_run_reports", "can_search_customers"];
  database.exec(`
    CREATE TABLE trade_team_members (
      id text PRIMARY KEY, owner_uid text NOT NULL, member_uid text NOT NULL, email text NOT NULL,
      display_name text NOT NULL, first_name text NOT NULL, last_name text NOT NULL, phone text NOT NULL,
      field_username text NOT NULL DEFAULT '', field_username_normalized text NOT NULL DEFAULT '',
      schedule_colour text NOT NULL DEFAULT 'emerald', capabilities text NOT NULL, role text NOT NULL, ${permissionColumns.map((column) => `${column} integer NOT NULL DEFAULT 0`).join(", ")},
      job_scope text NOT NULL, schedule_scope text NOT NULL, status text NOT NULL,
      invited_at text NOT NULL, accepted_at text NOT NULL, last_active_at text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_team_invites (id text PRIMARY KEY, team_member_id text NOT NULL, owner_uid text NOT NULL,
      token_hash text NOT NULL, expires_at text NOT NULL, consumed_at text NOT NULL, created_at text NOT NULL);
    CREATE TABLE trade_mobile_devices (id text PRIMARY KEY, owner_uid text NOT NULL, member_id text NOT NULL,
      status text NOT NULL, push_token text NOT NULL, push_token_updated_at text NOT NULL, revoked_at text NOT NULL,
      revoked_by_uid text NOT NULL, updated_at text NOT NULL);
    CREATE TABLE trade_field_access_codes (id text PRIMARY KEY, owner_uid text NOT NULL, team_member_id text NOT NULL,
      status text NOT NULL, updated_at text NOT NULL);
    CREATE TABLE trade_field_sessions (id text PRIMARY KEY, owner_uid text NOT NULL, team_member_id text NOT NULL,
      status text NOT NULL, revoked_at text NOT NULL, updated_at text NOT NULL);
    CREATE TABLE trade_team_member_files (id text PRIMARY KEY, owner_uid text NOT NULL, team_member_id text NOT NULL,
      status text NOT NULL, created_at text NOT NULL);
    CREATE TABLE trade_team_member_credentials (id text PRIMARY KEY, owner_uid text NOT NULL, team_member_id text NOT NULL,
      credential_type text NOT NULL, name text NOT NULL, credential_number text NOT NULL, issuer text NOT NULL,
      jurisdiction text NOT NULL, expires_at text NOT NULL, status text NOT NULL, file_id text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL);
    CREATE TABLE trade_team_member_events (id text PRIMARY KEY, owner_uid text NOT NULL, team_member_id text NOT NULL,
      actor_uid text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, event_type text NOT NULL,
      metadata text NOT NULL, created_at text NOT NULL);
    CREATE TABLE trade_accounts (firebase_uid text PRIMARY KEY, capabilities text NOT NULL);
    CREATE TABLE trade_work_orders (id text PRIMARY KEY, firebase_uid text NOT NULL, assignee_member_id text NOT NULL);
  `);
  const columns = permissionColumns.join(", ");
  const zeros = permissionColumns.map(() => "0").join(", ");
  const insertMember = (id, memberUid, status, updatedAt, manageTeam = 0) => {
    const values = permissionColumns.map((column) => column === "can_manage_team" ? manageTeam : 0).join(", ");
    database.exec(`INSERT INTO trade_team_members
      (id, owner_uid, member_uid, email, display_name, first_name, last_name, phone, capabilities, role,
       ${columns}, job_scope, schedule_scope, status, invited_at, accepted_at, last_active_at, created_at, updated_at)
      VALUES ('${id}', 'owner-1', '${memberUid}', '${id}@test.invalid', '${id}', '', '', '', '[]', 'field',
       ${values || zeros}, 'team', 'team', '${status}', '', '', '', '2026-08-12T00:00:00.000Z', '${updatedAt}')`);
  };
  insertMember("owner-member", "owner-1", "active", "2026-08-12T00:00:00.000Z", 1);
  insertMember("manager-1", "manager-uid", "active", "2026-08-12T00:00:00.000Z", 1);
  insertMember("target-1", "target-uid", "active", "2026-08-12T00:00:00.000Z");
  database.exec(`
    INSERT INTO trade_accounts VALUES ('owner-1', '[]');
    INSERT INTO trade_mobile_devices VALUES ('device-1', 'owner-1', 'target-1', 'active', 'push-secret', '', '', '', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_field_access_codes VALUES ('field-code-1', 'owner-1', 'target-1', 'active', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_field_sessions VALUES ('field-session-1', 'owner-1', 'target-1', 'active', '', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_team_invites VALUES ('invite-1', 'target-1', 'owner-1', 'hash', '2026-09-12T00:00:00.000Z', '', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_team_member_files VALUES ('file-1', 'owner-1', 'target-1', 'active', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_team_member_credentials VALUES ('credential-1', 'owner-1', 'target-1', 'licence', 'Licence', 'L1', 'Issuer', 'VIC', '', 'active', 'file-1', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_work_orders VALUES ('job-1', 'owner-1', 'target-1');
  `);
  return database;
}

async function patch(route, body) {
  return route.PATCH(new Request("https://test/api/trade-team", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

async function post(route, body) {
  return route.POST(new Request("https://test/api/trade-team", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

test("delegated Team add creates an editable unique TLink username without requiring an office login", async () => {
  const database = fixture(); const route = loadRoute(database, []);
  const response = await post(route, { action: "add_member", firstName: "Jane", lastName: "Worker",
    displayName: "Jane Worker", fieldUsername: "Jane Field", phone: "0412 111 222" });
  const payload = await response.json();
  assert.equal(response.status, 201, payload.error);
  assert.equal(payload.ok, true);
  const created = database.prepare(`SELECT email, field_username, field_username_normalized, status
    FROM trade_team_members WHERE id = ?`).get(payload.createdMemberId);
  assert.equal(created.email, "");
  assert.equal(created.field_username, "Jane Field");
  assert.equal(created.field_username_normalized, "jane field");
  assert.equal(created.status, "active");
});

test("delegated Team PATCH lifecycle is stale-safe, bounded, destructive only on suspension, and retains history", async () => {
  const database = fixture(); const aborted = []; const route = loadRoute(database, aborted);
  const stale = await patch(route, { action: "update_member", memberId: "target-1", status: "suspended",
    expectedUpdatedAt: "2026-08-11T00:00:00.000Z" });
  assert.equal(stale.status, 409);
  assert.equal(database.prepare("SELECT status FROM trade_team_members WHERE id='target-1'").get().status, "active");
  assert.equal(database.prepare("SELECT status FROM trade_mobile_devices").get().status, "active");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events").get().count, 0);

  const self = await patch(route, { action: "update_member", memberId: "manager-1", status: "suspended",
    expectedUpdatedAt: "2026-08-12T00:00:00.000Z" });
  assert.equal(self.status, 403);
  const owner = await patch(route, { action: "update_member", memberId: "owner-member", status: "suspended",
    expectedUpdatedAt: "2026-08-12T00:00:00.000Z" });
  assert.equal(owner.status, 409);

  const suspended = await patch(route, { action: "update_member", memberId: "target-1", status: "suspended",
    expectedUpdatedAt: "2026-08-12T00:00:00.000Z" });
  assert.equal(suspended.status, 200);
  const suspendedAt = database.prepare("SELECT updated_at FROM trade_team_members WHERE id='target-1'").get().updated_at;
  assert.equal(database.prepare("SELECT status FROM trade_team_members WHERE id='target-1'").get().status, "suspended");
  assert.equal(database.prepare("SELECT status FROM trade_mobile_devices").get().status, "revoked");
  assert.equal(database.prepare("SELECT push_token FROM trade_mobile_devices").get().push_token, "");
  assert.equal(database.prepare("SELECT status FROM trade_field_access_codes").get().status, "revoked");
  assert.equal(database.prepare("SELECT status FROM trade_field_sessions").get().status, "revoked");
  assert.notEqual(database.prepare("SELECT revoked_at FROM trade_field_sessions").get().revoked_at, "");
  assert.notEqual(database.prepare("SELECT consumed_at FROM trade_team_invites").get().consumed_at, "");
  assert.deepEqual(aborted, [{ ownerUid: "owner-1", memberId: "target-1" }]);

  const reactivated = await patch(route, { action: "update_member", memberId: "target-1", status: "active", expectedUpdatedAt: suspendedAt });
  assert.equal(reactivated.status, 200);
  assert.equal(database.prepare("SELECT status FROM trade_team_members WHERE id='target-1'").get().status, "active");
  assert.equal(database.prepare("SELECT status FROM trade_mobile_devices").get().status, "revoked");
  assert.equal(database.prepare("SELECT push_token FROM trade_mobile_devices").get().push_token, "");
  assert.equal(database.prepare("SELECT status FROM trade_field_access_codes").get().status, "revoked");
  assert.equal(database.prepare("SELECT status FROM trade_field_sessions").get().status, "revoked");
  assert.notEqual(database.prepare("SELECT consumed_at FROM trade_team_invites").get().consumed_at, "");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_orders WHERE id='job-1'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_files WHERE id='file-1'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_credentials WHERE id='credential-1'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events WHERE team_member_id='target-1'").get().count, 2);

  const profileRevision = database.prepare("SELECT updated_at FROM trade_team_members WHERE id='target-1'").get().updated_at;
  const normalisedPhone = await patch(route, { action: "update_member", memberId: "target-1", phone: "0412 345 678", expectedUpdatedAt: profileRevision });
  assert.equal(normalisedPhone.status, 200);
  assert.equal(database.prepare("SELECT phone FROM trade_team_members WHERE id='target-1'").get().phone, "+61412345678");
  const phoneRevision = database.prepare("SELECT updated_at FROM trade_team_members WHERE id='target-1'").get().updated_at;
  const rejectedPhone = await patch(route, { action: "update_member", memberId: "target-1", phone: "0412 call me", expectedUpdatedAt: phoneRevision });
  assert.equal(rejectedPhone.status, 400);
  assert.equal(database.prepare("SELECT phone, updated_at FROM trade_team_members WHERE id='target-1'").get().phone, "+61412345678");
  assert.equal(database.prepare("SELECT updated_at FROM trade_team_members WHERE id='target-1'").get().updated_at, phoneRevision);

  database.exec("UPDATE trade_field_access_codes SET status = 'active' WHERE id = 'field-code-1'");
  const renamed = await patch(route, { action: "update_member", memberId: "target-1", fieldUsername: "John Smith",
    expectedUpdatedAt: phoneRevision });
  assert.equal(renamed.status, 200);
  const username = database.prepare("SELECT field_username, field_username_normalized FROM trade_team_members WHERE id='target-1'").get();
  assert.equal(username.field_username, "John Smith");
  assert.equal(username.field_username_normalized, "john smith");
  assert.equal(database.prepare("SELECT status FROM trade_field_access_codes WHERE id='field-code-1'").get().status, "revoked");
});

test("the owner can set their own TLink username while owner lifecycle and permissions stay protected", async () => {
  const database = fixture();
  const ownerAccess = {
    ...managerAccess,
    actorUid: "owner-1",
    memberId: "owner-member",
    displayName: "Owner",
    isOwner: true,
    canEditTeamPermissions: true,
  };
  const route = loadRoute(database, [], ownerAccess);
  const saved = await patch(route, {
    action: "update_member",
    memberId: "owner-member",
    fieldUsername: "James",
    expectedUpdatedAt: "2026-08-12T00:00:00.000Z",
  });
  const savedPayload = await saved.json();
  assert.equal(saved.status, 200, savedPayload.error);
  const owner = database.prepare(`SELECT field_username, field_username_normalized, status, updated_at
    FROM trade_team_members WHERE id = 'owner-member'`).get();
  assert.equal(owner.field_username, "James");
  assert.equal(owner.field_username_normalized, "james");
  assert.equal(owner.status, "active");

  const suspended = await patch(route, {
    action: "update_member",
    memberId: "owner-member",
    status: "suspended",
    expectedUpdatedAt: owner.updated_at,
  });
  assert.equal(suspended.status, 409);
  assert.equal(database.prepare("SELECT status FROM trade_team_members WHERE id='owner-member'").get().status, "active");

  const permissions = await patch(route, {
    action: "update_member",
    memberId: "owner-member",
    canManageTeam: false,
    expectedUpdatedAt: owner.updated_at,
  });
  assert.equal(permissions.status, 403);
  assert.equal(database.prepare("SELECT can_manage_team FROM trade_team_members WHERE id='owner-member'").get().can_manage_team, 1);
});
