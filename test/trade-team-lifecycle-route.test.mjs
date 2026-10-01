import * as jobCollaboration from "../src/lib/trade-job-collaboration.ts";
import * as teamPresence from "../src/lib/trade-team-presence.ts";
import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";
import assert from "node:assert/strict";
import { certificateTestDependency, installCreditexTrainingFixture } from "./helpers/creditex-training-fixture.mjs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { createHash } from "node:crypto";
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

function loadRoute(database, aborted, currentAccess = managerAccess, { sent = [], deliveryStatus = "sent", beforeBatch } = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/app/api/trade-team/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} }; const databaseBinding = d1(database);
  if (beforeBatch) {
    const batch = databaseBinding.batch;
    databaseBinding.batch = async statements => { beforeBatch(); return batch(statements); };
  }
  const mocks = {
    "@/lib/trade-team-presence": teamPresence,
    "@/lib/trade-job-collaboration": jobCollaboration, "./trade-job-collaboration": jobCollaboration,
    "../../../../db": { getD1: () => databaseBinding },
    "@/lib/admin-server": { mfaErrorResponse, adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum), sameOrigin: () => true },
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => ({ uid: "manager-uid" }) },
    "@/lib/trade-team-invitation-server": {
      TradeTeamInvitationError: class extends Error {},
      acceptTradeTeamInvitation: async () => { throw new Error("Invitation acceptance is outside this lifecycle fixture"); },
      tradeTeamInviteTokenHash: async (token) => createHash("sha256").update(token).digest("base64url"),
    },
    "@/lib/trade-team-invitation-email": {
      sendTradeTeamInvitationEmail: async (input) => {
        const saved = database.prepare("SELECT team_member_id FROM trade_team_invites WHERE id = ?").get(input.inviteId);
        assert.ok(saved, "invitation must be committed before email dispatch");
        assert.equal(database.prepare("SELECT email FROM trade_team_members WHERE id = ?").get(saved.team_member_id).email, input.email);
        sent.push(input);
        return { status: deliveryStatus, message: `Invitation ${deliveryStatus}` };
      },
    },
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
    const dependency = certificateTestDependency(specifier); if (dependency) return dependency;
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  const permissionColumns = ["can_create_jobs", "can_manage_jobs", "can_assign_jobs", "can_view_customers",
    "can_manage_customers", "can_view_quotes", "can_manage_quotes", "can_send_quotes", "can_send_sms", "can_view_invoices",
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
      revoked_by_uid text NOT NULL, updated_at text NOT NULL,
      voip_push_token text NOT NULL DEFAULT '', native_call_capable integer NOT NULL DEFAULT 0);
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
  database.exec(fs.readFileSync(new URL("../drizzle/0219_trade_team_presence.sql", import.meta.url), "utf8"));
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
    INSERT INTO trade_mobile_devices VALUES ('device-1', 'owner-1', 'target-1', 'active', 'push-secret', '', '', '', '2026-08-12T00:00:00.000Z', 'private-voip-token', 1);
    INSERT INTO trade_field_access_codes VALUES ('field-code-1', 'owner-1', 'target-1', 'active', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_field_sessions VALUES ('field-session-1', 'owner-1', 'target-1', 'active', '', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_team_invites VALUES ('invite-1', 'target-1', 'owner-1', 'hash', '2026-09-12T00:00:00.000Z', '', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_team_member_files VALUES ('file-1', 'owner-1', 'target-1', 'active', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_team_member_credentials VALUES ('credential-1', 'owner-1', 'target-1', 'licence', 'Licence', 'L1', 'Issuer', 'VIC', '', 'active', 'file-1', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z');
    INSERT INTO trade_work_orders VALUES ('job-1', 'owner-1', 'target-1');
  `);
  installCreditexTrainingFixture(database, { qualified: false });
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

test("roster shows the selected call status within its business and no online status for inactive people", async () => {
  const database = fixture();
  try {
    database.exec("INSERT INTO trade_team_presence VALUES ('owner-1','target-1','busy','2026-09-30T08:00:00Z'),('other-owner','target-1','offline','2026-09-30T08:00:00Z')");
    const route = loadRoute(database, []);
    const result = await route.GET(new Request("https://test/api/trade-team"));
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.members.find(member => member.id === "target-1").presence, "busy");
    assert.equal(body.members.find(member => member.id === "owner-member").presence, "online");
    database.exec("UPDATE trade_team_members SET status='suspended' WHERE id='target-1'");
    const inactive = await (await route.GET(new Request("https://test/api/trade-team"))).json();
    assert.equal(inactive.members.find(member => member.id === "target-1").presence, null);
  } finally { database.close(); }
});

test("saving canonical personal services independently creates exact training todos without business approval", async () => {
  const database = fixture(); installCreditexTrainingFixture(database, { qualified: false });
  database.exec("ALTER TABLE trade_team_member_files ADD COLUMN category TEXT NOT NULL DEFAULT 'licence'");
  const route = loadRoute(database, []);
  const response = await patch(route, { action: "update_member", memberId: "target-1", capabilities: ["heating-cooling"], expectedUpdatedAt: "2026-08-12T00:00:00.000Z" });
  const saved = await response.json(); assert.equal(response.status, 200, saved.error);
  assert.equal(database.prepare("SELECT capabilities FROM trade_team_members WHERE id='target-1'").get().capabilities, '["heating-cooling"]');
  assert.equal(database.prepare("SELECT capabilities FROM trade_accounts WHERE firebase_uid='owner-1'").get().capabilities, '[]');
  const training = certificateTestDependency('trade-training-server');
  const onboarding = certificateTestDependency('creditex-onboarding-server');
  const loaded = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync('src/app/api/trade-training/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies = { '../../../../db': { getD1: () => d1(database) }, '@/lib/admin-server': { mfaErrorResponse,}, '@/lib/bounded-json-request': {},
    '@/lib/creditex-onboarding-api': { creditexJson: (body, status = 200) => Response.json(body, { status }), creditexApiError: error => Response.json({ code: error.code }, { status: error.status || 503 }) },
    '@/lib/creditex-onboarding-server': onboarding, '@/lib/trade-training-server': training,
    '@/lib/training-questionnaire-store': certificateTestDependency('training-questionnaire-store'),
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => managerAccess } };
  new Function('require', 'module', 'exports', output)(name => { assert.ok(dependencies[name], name); return dependencies[name]; }, loaded, loaded.exports);
  const trainingResponse = await loaded.exports.GET(new Request('https://test/api/trade-training?memberId=target-1'));
  const todo = await trainingResponse.json(); assert.equal(trainingResponse.status, 200);
  assert.ok(todo.modules.some(module => module.id === 'veu-6' && module.serviceCategory === 'heating-cooling' && module.businessServiceEnabled === false && module.status === 'required' && module.assessmentAvailable === true));
  const eligibility = await training.getCertificateActivityEligibility(d1(database), { ownerUid: 'owner-1', actorMemberId: 'manager-1', assignedMemberId: 'target-1', activityTemplateIds: ['veu-6'] });
  assert.equal(eligibility.eligible, false);
  const updatedAt = database.prepare("SELECT updated_at FROM trade_team_members WHERE id='target-1'").get().updated_at;
  const invalid = await patch(route, { action: 'update_member', memberId: 'target-1', capabilities: ['invented-service'], expectedUpdatedAt: updatedAt });
  assert.equal(invalid.status, 400);
  assert.equal(database.prepare("SELECT capabilities FROM trade_team_members WHERE id='target-1'").get().capabilities, '["heating-cooling"]');
  database.close();
});

test("delegated Team add creates an editable unique TLink username without requiring an office login", async () => {
  const database = fixture(); const sent = []; const route = loadRoute(database, [], managerAccess, { sent });
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
  assert.equal(sent.length, 0, "members without an email do not trigger an invitation email");
});

test("adding a member emails the persisted invitation and reissuing preserves access while replacing its token", async () => {
  const database = fixture(); const sent = [];
  try {
    const ownerAccess = { ...managerAccess, isOwner: true, actorUid: "owner-1", memberId: "owner-member" };
    const route = loadRoute(database, [], ownerAccess, { sent });
    const added = await post(route, { action: "add_member", displayName: "Alex Worker", fieldUsername: "Alex Worker",
      email: "Alex@Example.com", permissions: { canViewQuotes: true, canViewInvoices: true, jobScope: "own" } });
    const payload = await added.json();
    assert.equal(added.status, 201, payload.error);
    assert.ok(payload.createdMemberId);
    assert.equal(payload.delivery.status, "sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, "alex@example.com");
    assert.equal(sent[0].businessName, "Installer");
    assert.equal(sent[0].inviteUrl, payload.invite.inviteUrl);
    const original = database.prepare("SELECT * FROM trade_team_invites WHERE team_member_id = ?").get(payload.createdMemberId);
    const originalToken = new URL(sent[0].inviteUrl).searchParams.get("invite");
    assert.equal(original.id, sent[0].inviteId);
    assert.equal(original.token_hash, createHash("sha256").update(originalToken).digest("base64url"));
    const before = database.prepare("SELECT can_view_quotes, can_view_invoices, job_scope, updated_at FROM trade_team_members WHERE id = ?").get(payload.createdMemberId);
    assert.equal(before.can_view_quotes, 1);
    assert.equal(before.can_view_invoices, 1);
    assert.equal(before.job_scope, "own");
    const reissued = await post(route, { action: "reissue_invite", memberId: payload.createdMemberId, expectedUpdatedAt: before.updated_at });
    const fresh = await reissued.json();
    assert.equal(reissued.status, 201, fresh.error);
    assert.equal(sent.length, 2);
    assert.notEqual(sent[1].inviteUrl, sent[0].inviteUrl);
    assert.equal(sent[1].email, "alex@example.com");
    assert.equal(database.prepare("SELECT count(*) count FROM trade_team_invites WHERE team_member_id = ?").get(payload.createdMemberId).count, 1);
    assert.equal(database.prepare("SELECT id FROM trade_team_invites WHERE id = ?").get(original.id), undefined);
    const after = database.prepare("SELECT can_view_quotes, can_view_invoices, job_scope FROM trade_team_members WHERE id = ?").get(payload.createdMemberId);
    assert.deepEqual({ ...after }, { can_view_quotes: 1, can_view_invoices: 1, job_scope: "own" });
    const events = database.prepare("SELECT metadata FROM trade_team_member_events WHERE team_member_id = ? AND event_type = 'member.invitation_email'").all(payload.createdMemberId);
    assert.equal(events.length, 2);
    assert.equal(JSON.parse(events[0].metadata).status, "sent");
    assert.ok(events.every(event => !event.metadata.includes(originalToken)), "audit metadata must not contain the bearer token");
  } finally { database.close(); }
});

for (const invitationState of ["expired", "absent"]) {
  test(`portal re-invite renews an ${invitationState} invitation without recreating the member or changing their records`, async () => {
    const database = fixture(); const sent = [];
    try {
      database.exec(`UPDATE trade_team_members SET member_uid = '', email = 'saved@example.com',
        first_name = 'Saved', last_name = 'Member', display_name = 'Saved Member', phone = '+61400111222',
        field_username = 'Saved Field', field_username_normalized = 'saved field', schedule_colour = 'rose',
        can_view_quotes = 1, can_view_invoices = 1, job_scope = 'own', service_states = '["VIC"]'
        WHERE id = 'target-1';
        UPDATE trade_team_invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 'invite-1';
        INSERT INTO trade_team_member_events VALUES ('historic-event', 'owner-1', 'target-1', 'owner-1',
          'member', 'target-1', 'member.created', '{}', '2026-08-12T00:00:00.000Z');`);
      if (invitationState === "absent") database.exec("DELETE FROM trade_team_invites WHERE id = 'invite-1'");
      const before = database.prepare("SELECT * FROM trade_team_members WHERE id = 'target-1'").get();
      const historyTables = ["trade_work_orders", "trade_team_member_files", "trade_team_member_credentials",
        "trade_mobile_devices", "trade_field_access_codes", "trade_field_sessions"];
      const history = historyTables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
      // A delegated team manager can resend without permission-edit rights or the original form fields.
      const route = loadRoute(database, [], managerAccess, { sent });
      const started = Date.now();
      const response = await post(route, { action: "reissue_invite", memberId: "target-1", expectedUpdatedAt: before.updated_at });
      const payload = await response.json();
      assert.equal(response.status, 201, payload.error);
      assert.equal(payload.invite.memberId, "target-1");
      assert.equal(payload.createdMemberId, undefined);
      assert.equal(payload.invite.expiresInDays, 7);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].email, before.email);
      assert.equal(sent[0].displayName, before.display_name);
      assert.equal(sent[0].inviteUrl, payload.invite.inviteUrl);
      const link = new URL(payload.invite.inviteUrl);
      assert.equal(link.pathname, "/direct-trade/team");
      assert.match(link.searchParams.get("invite"), /^[A-Za-z0-9_-]{43}$/);
      const invites = database.prepare("SELECT * FROM trade_team_invites WHERE team_member_id = 'target-1'").all();
      assert.equal(invites.length, 1);
      assert.notEqual(invites[0].id, "invite-1");
      assert.equal(invites[0].consumed_at, "");
      assert.equal(invites[0].token_hash, createHash("sha256").update(link.searchParams.get("invite")).digest("base64url"));
      assert.equal(database.prepare("SELECT id FROM trade_team_invites WHERE token_hash = 'hash'").get(), undefined);
      assert.ok(Date.parse(invites[0].expires_at) >= started + 7 * 24 * 60 * 60 * 1000);
      assert.ok(Date.parse(invites[0].expires_at) <= Date.now() + 7 * 24 * 60 * 60 * 1000);
      const after = database.prepare("SELECT * FROM trade_team_members WHERE id = 'target-1'").get();
      assert.ok(after.invited_at);
      assert.notEqual(after.updated_at, before.updated_at);
      assert.deepEqual({ ...after, invited_at: before.invited_at, updated_at: before.updated_at }, { ...before });
      assert.equal(database.prepare("SELECT count(*) count FROM trade_team_members").get().count, 3);
      assert.deepEqual(historyTables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()), history);
      assert.ok(database.prepare("SELECT id FROM trade_team_member_events WHERE id = 'historic-event'").get());
      assert.ok(database.prepare("SELECT id FROM trade_team_member_events WHERE team_member_id = 'target-1' AND event_type = 'member.invitation_reissued'").get());
    } finally { database.close(); }
  });
}

for (const denied of [
  { name: "another business's member", sql: "UPDATE trade_team_members SET owner_uid = 'owner-2' WHERE id = 'target-1'", status: 404 },
  { name: "a bound login", sql: "UPDATE trade_team_members SET member_uid = 'already-bound' WHERE id = 'target-1'", status: 409 },
  { name: "suspended access", sql: "UPDATE trade_team_members SET status = 'suspended' WHERE id = 'target-1'", status: 409 },
  { name: "a missing login email", sql: "UPDATE trade_team_members SET email = '' WHERE id = 'target-1'", status: 400 },
  { name: "a stale member revision", expectedUpdatedAt: "2000-01-01T00:00:00.000Z", status: 409 },
  { name: "missing team-management permission", access: { ...managerAccess, canManageTeam: false }, status: 403 },
  { name: "team-management permission revoked after access lookup", sql: "UPDATE trade_team_members SET can_manage_team = 0 WHERE id = 'manager-1'", status: 409 },
]) {
  test(`portal re-invite rejects ${denied.name} without modifying records or sending email`, async () => {
    const database = fixture(); const sent = [];
    try {
      database.exec("UPDATE trade_team_members SET member_uid = '' WHERE id = 'target-1'");
      if (denied.sql) database.exec(denied.sql);
      const tables = ["trade_team_members", "trade_team_invites", "trade_team_member_events"];
      const snapshot = () => tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
      const before = snapshot();
      const route = loadRoute(database, [], denied.access || managerAccess, { sent });
      const response = await post(route, { action: "reissue_invite", memberId: "target-1",
        expectedUpdatedAt: denied.expectedUpdatedAt || "2026-08-12T00:00:00.000Z" });
      const payload = await response.json();
      assert.equal(response.status, denied.status, payload.error);
      assert.equal(payload.ok, false);
      assert.equal(sent.length, 0);
      assert.deepEqual(snapshot(), before);
    } finally { database.close(); }
  });
}

for (const deliveryStatus of ["failed", "unknown"]) {
  test(`invitation email ${deliveryStatus} keeps the member and assigned permissions available for resend`, async () => {
    const database = fixture(); const sent = [];
    try {
      const ownerAccess = { ...managerAccess, isOwner: true, actorUid: "owner-1", memberId: "owner-member" };
      const route = loadRoute(database, [], ownerAccess, { sent, deliveryStatus });
      const response = await post(route, { action: "add_member", displayName: "Email Worker", email: "worker@example.com",
        permissions: { canViewQuotes: true } });
      const payload = await response.json();
      assert.equal(response.status, 201, payload.error);
      assert.equal(payload.delivery.status, deliveryStatus);
      assert.equal(sent.length, 1);
      const member = database.prepare("SELECT status, member_uid, can_view_quotes FROM trade_team_members WHERE id = ?").get(payload.createdMemberId);
      assert.deepEqual({ ...member }, { status: "active", member_uid: "", can_view_quotes: 1 });
      assert.ok(database.prepare("SELECT id FROM trade_team_invites WHERE team_member_id = ? AND consumed_at = ''").get(payload.createdMemberId));
      const event = database.prepare("SELECT metadata FROM trade_team_member_events WHERE team_member_id = ? AND event_type = 'member.invitation_email'").get(payload.createdMemberId);
      assert.equal(JSON.parse(event.metadata).status, deliveryStatus);
    } finally { database.close(); }
  });
}

test("changing a pending member email invalidates its previous invitation without changing access", async () => {
  const database = fixture(); const sent = [];
  try {
    const ownerAccess = { ...managerAccess, isOwner: true, actorUid: "owner-1", memberId: "owner-member" };
    const route = loadRoute(database, [], ownerAccess, { sent });
    const added = await post(route, { action: "add_member", displayName: "Email Worker", email: "old@example.com",
      permissions: { canViewQuotes: true } });
    const payload = await added.json(); assert.equal(added.status, 201, payload.error);
    const revision = database.prepare("SELECT updated_at FROM trade_team_members WHERE id = ?").get(payload.createdMemberId).updated_at;
    const changed = await patch(route, { action: "update_member", memberId: payload.createdMemberId,
      email: "new@example.com", expectedUpdatedAt: revision });
    const changedPayload = await changed.json(); assert.equal(changed.status, 200, changedPayload.error);
    assert.equal(database.prepare("SELECT count(*) count FROM trade_team_invites WHERE team_member_id = ?").get(payload.createdMemberId).count, 0);
    const member = database.prepare("SELECT email, member_uid, can_view_quotes FROM trade_team_members WHERE id = ?").get(payload.createdMemberId);
    assert.deepEqual({ ...member }, { email: "new@example.com", member_uid: "", can_view_quotes: 1 });
    assert.equal(sent.length, 1, "editing an email does not silently resend the prior invitation");
  } finally { database.close(); }
});

test('team service regions validate explicit subsets, preserve omitted values and allow inheritance', async () => {
  const database = fixture(); const route = loadRoute(database, []);
  database.exec(`UPDATE trade_accounts SET service_states='["VIC","NSW"]' WHERE firebase_uid='owner-1'`);
  const currentRevision = () => database.prepare("SELECT updated_at FROM trade_team_members WHERE id='target-1'").get().updated_at;
  const update = serviceStates => patch(route, { action: 'update_member', memberId: 'target-1', serviceStates, expectedUpdatedAt: currentRevision() });
  for (const invalid of [[], ['WA'], ['invalid'], ['VIC', 'vic'], ['VIC', 1], 'VIC']) {
    const response = await update(invalid); assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'MEMBER_SERVICE_STATES_INVALID');
    assert.equal(database.prepare("SELECT service_states FROM trade_team_members WHERE id='target-1'").get().service_states, null);
  }
  let response = await update(['VIC']); let body = await response.json();
  assert.equal(response.status, 200, body.error); assert.deepEqual(body.businessServiceStates, ['NSW', 'VIC']);
  let member = body.members.find(person => person.id === 'target-1');
  assert.deepEqual(member.assignedServiceStates, ['VIC']); assert.deepEqual(member.serviceStates, ['VIC']);
  response = await patch(route, { action: 'update_member', memberId: 'target-1', firstName: 'Updated', expectedUpdatedAt: currentRevision() });
  assert.equal(response.status, 200); assert.equal(database.prepare("SELECT service_states FROM trade_team_members WHERE id='target-1'").get().service_states, '["VIC"]');
  response = await update(null); body = await response.json(); assert.equal(response.status, 200, body.error);
  member = body.members.find(person => person.id === 'target-1');
  assert.equal(member.assignedServiceStates, null); assert.deepEqual(member.serviceStates, ['NSW', 'VIC']);
  const created = await post(route, { action: 'add_member', firstName: 'Vic', lastName: 'Installer', fieldUsername: 'Vic Installer', serviceStates: ['VIC'] });
  const added = await created.json(); assert.equal(created.status, 201, added.error);
  assert.equal(database.prepare('SELECT service_states FROM trade_team_members WHERE id=?').get(added.createdMemberId).service_states, '["VIC"]');
  const owner = body.members.find(person => person.isOwner);
  assert.equal(owner.assignedServiceStates, null); assert.deepEqual(owner.serviceStates, ['NSW', 'VIC']);
  const ownerAttempt = await patch(route, { action: 'update_member', memberId: 'owner-member', serviceStates: ['VIC'], expectedUpdatedAt: owner.updatedAt });
  assert.equal(ownerAttempt.status, 400); assert.equal((await ownerAttempt.json()).code, 'OWNER_SERVICE_STATES_INHERIT');
  assert.throws(() => database.exec(`UPDATE trade_team_members SET service_states='[]' WHERE id='target-1'`), /CHECK constraint failed/);
  database.close();
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
  assert.deepEqual({ ...database.prepare("SELECT voip_push_token, native_call_capable FROM trade_mobile_devices").get() },
    { voip_push_token: "", native_call_capable: 0 });
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
  assert.deepEqual({ ...database.prepare("SELECT voip_push_token, native_call_capable FROM trade_mobile_devices").get() },
    { voip_push_token: "", native_call_capable: 0 });
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

test("SMS access is explicit, owner-grantable, independently revocable and cannot be escalated by a delegated manager", async () => {
  const database = fixture();
  try {
    const memberId = "target-1";
    const change = (route, canSendSms) => patch(route, { action: "update_member", memberId,
      expectedUpdatedAt: database.prepare("SELECT updated_at FROM trade_team_members WHERE id=?").get(memberId).updated_at,
      permissions: { canSendSms } });
    assert.equal(database.prepare("SELECT can_send_sms FROM trade_team_members WHERE id=?").get(memberId).can_send_sms, 0);
    const ownerRoute = loadRoute(database, [], { ...managerAccess, isOwner: true, actorUid: "owner-1", memberId: "owner-member" });
    const enabled = await change(ownerRoute, true); assert.equal(enabled.status, 200, JSON.stringify(await enabled.json()));
    assert.equal(database.prepare("SELECT can_send_sms FROM trade_team_members WHERE id=?").get(memberId).can_send_sms, 1);
    assert.equal((await change(ownerRoute, false)).status, 200);
    assert.equal(database.prepare("SELECT can_send_sms FROM trade_team_members WHERE id=?").get(memberId).can_send_sms, 0);
    database.exec("UPDATE trade_team_members SET can_edit_team_permissions=1 WHERE id='manager-1'");
    const managerRoute = loadRoute(database, [], { ...managerAccess, canEditTeamPermissions: true, canSendSms: false });
    assert.equal((await change(managerRoute, true)).status, 403);
    assert.equal(database.prepare("SELECT can_send_sms FROM trade_team_members WHERE id=?").get(memberId).can_send_sms, 0);
    assert.ok(database.prepare("SELECT metadata FROM trade_team_member_events WHERE team_member_id=?").all(memberId).some(row => JSON.parse(row.metadata).permissionsAfter?.canSendSms === true));
  } finally { database.close(); }
});

test("archiving revokes access, preserves identity and history, and only appears in Archived team", async () => {
  const database = fixture();
  try {
    const aborted = [];
    const route = loadRoute(database, aborted);
    const saved = { ...database.prepare("SELECT * FROM trade_team_members WHERE id='target-1'").get() };
    const history = ["trade_work_orders", "trade_team_member_files", "trade_team_member_credentials"].map(table =>
      ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
    const result = await patch(route, { action: "archive_member", memberId: "target-1", expectedUpdatedAt: saved.updated_at,
      displayName: "Must not rewrite identity", canManageTeam: true, fieldUsername: "must-not-change" });
    const payload = await result.json();
    assert.equal(result.status, 200, payload.error);
    assert.equal(payload.members.some(member => member.id === "target-1"), false);
    const archived = { ...database.prepare("SELECT * FROM trade_team_members WHERE id='target-1'").get() };
    assert.deepEqual(archived, { ...saved, status: "archived", updated_at: archived.updated_at });
    assert.deepEqual({ ...database.prepare("SELECT status,push_token,voip_push_token,native_call_capable FROM trade_mobile_devices").get() },
      { status: "revoked", push_token: "", voip_push_token: "", native_call_capable: 0 });
    assert.equal(database.prepare("SELECT status FROM trade_field_access_codes").get().status, "revoked");
    assert.equal(database.prepare("SELECT status FROM trade_field_sessions").get().status, "revoked");
    assert.ok(database.prepare("SELECT revoked_at FROM trade_field_sessions").get().revoked_at);
    assert.ok(database.prepare("SELECT consumed_at FROM trade_team_invites").get().consumed_at);
    assert.deepEqual(aborted, [{ ownerUid: "owner-1", memberId: "target-1" }]);
    for (const { table, rows } of history) assert.deepEqual(database.prepare(`SELECT * FROM ${table}`).all(), rows);
    assert.equal(database.prepare("SELECT event_type FROM trade_team_member_events").get().event_type, "member.archived");

    // Inactive people remain in the ordinary roster until explicitly archived.
    database.exec("UPDATE trade_team_members SET status='suspended' WHERE id='manager-1'");
    const owner = loadRoute(database, [], { ...managerAccess, actorUid: "owner-1", memberId: "owner-member", isOwner: true });
    const ordinary = await (await owner.GET(new Request("https://test/api/trade-team"))).json();
    assert.equal(ordinary.members.some(member => member.id === "manager-1"), true);
    assert.equal(ordinary.members.some(member => member.id === "target-1"), false);
    const past = await (await owner.GET(new Request("https://test/api/trade-team?status=archived"))).json();
    assert.deepEqual(past.members.map(member => member.id), ["target-1"]);
    assert.equal(past.members[0].fileCount, 1);
    assert.equal(past.members[0].presence, null);
    assert.equal(past.roster.total, 1);
    assert.equal(past.assignees.some(member => member.id === "target-1"), false);
    const filtered = await (await owner.GET(new Request("https://test/api/trade-team?status=archived&search=not-present"))).json();
    assert.equal(filtered.roster.total, 0);
  } finally { database.close(); }
});

test("archived staff cannot be silently reactivated, edited or reinvited", async () => {
  const database = fixture();
  try {
    database.exec("UPDATE trade_team_members SET status='archived', member_uid='' WHERE id='target-1'");
    const sent = []; const route = loadRoute(database, [], managerAccess, { sent });
    const body = { memberId: "target-1", expectedUpdatedAt: "2026-08-12T00:00:00.000Z" };
    for (const action of ["update_member", "archive_member"]) {
      assert.equal((await patch(route, { ...body, action, status: "active", displayName: "Changed" })).status, 409);
    }
    for (const action of ["reissue_invite", "invite_member"]) {
      const response = await post(route, { ...body, action, email: "target-1@test.invalid", displayName: "Changed" });
      assert.equal(response.status, 409, JSON.stringify(await response.json()));
    }
    assert.equal(database.prepare("SELECT status FROM trade_team_members WHERE id='target-1'").get().status, "archived");
    assert.equal(database.prepare("SELECT display_name FROM trade_team_members WHERE id='target-1'").get().display_name, "target-1");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events").get().count, 0);
    assert.equal(sent.length, 0);
  } finally { database.close(); }
});

test("archive enforces revision, owner, self, permission and business boundaries", async () => {
  const database = fixture();
  try {
    const route = loadRoute(database, []);
    const change = (handler, memberId, expectedUpdatedAt = "2026-08-12T00:00:00.000Z") =>
      patch(handler, { action: "archive_member", memberId, expectedUpdatedAt });
    assert.equal((await change(route, "target-1", "stale")).status, 409);
    assert.equal((await change(route, "owner-member")).status, 409);
    assert.equal((await change(route, "manager-1")).status, 403);
    const staff = loadRoute(database, [], { ...managerAccess, canManageTeam: false });
    assert.equal((await change(staff, "target-1")).status, 403);
    const otherBusiness = loadRoute(database, [], { ...managerAccess, ownerUid: "owner-2", isOwner: true });
    assert.equal((await change(otherBusiness, "target-1")).status, 404);
    const crossTenant = await (await otherBusiness.GET(new Request("https://test/api/trade-team?status=archived"))).json();
    assert.deepEqual(crossTenant.members, []);
    assert.equal(database.prepare("SELECT status FROM trade_team_members WHERE id='target-1'").get().status, "active");
    assert.equal(database.prepare("SELECT status FROM trade_mobile_devices").get().status, "active");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events").get().count, 0);
  } finally { database.close(); }
});

test("archive rechecks the manager at commit and rolls back a failed access revocation", async () => {
  for (const failure of ["manager_revoked", "revocation_failure"]) {
    const database = fixture(); const aborted = [];
    try {
      if (failure === "revocation_failure") database.exec(`CREATE TRIGGER fail_device_revocation BEFORE UPDATE ON trade_mobile_devices
        BEGIN SELECT RAISE(ABORT, 'test revocation failure'); END;`);
      const route = loadRoute(database, aborted, managerAccess, { beforeBatch: failure === "manager_revoked"
        ? () => database.exec("UPDATE trade_team_members SET can_manage_team=0 WHERE id='manager-1'") : undefined });
      const result = await patch(route, { action: "archive_member", memberId: "target-1", expectedUpdatedAt: "2026-08-12T00:00:00.000Z" });
      assert.equal(result.status, failure === "manager_revoked" ? 409 : 500);
      assert.equal(database.prepare("SELECT status FROM trade_team_members WHERE id='target-1'").get().status, "active");
      assert.equal(database.prepare("SELECT status FROM trade_mobile_devices").get().status, "active");
      assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events").get().count, 0);
      assert.deepEqual(aborted, []);
    } finally { database.close(); }
  }
});
