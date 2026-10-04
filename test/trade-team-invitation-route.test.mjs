import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import ts from "typescript";
import * as accountPredicates from "../src/lib/trade-account-predicates.ts";

const token = "a".repeat(43);
const tokenHash = createHash("sha256").update(token).digest("base64url");
const invitedEmail = "katja@example.invalid";
const identity = { uid: "katja-uid", email: invitedEmail, emailVerified: true,
  authTime: Math.floor(Date.now() / 1000), signInProvider: "password" };

function loadModule(path, dependencies) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected invitation test dependency: ${name}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

// Execute the production ABN checksum and authoritative approval-review predicate.
const tradeAccess = loadModule("../src/lib/trade-access-server.ts", {
  "../../db": {}, "./firebase-server": {}, "./creditex-schema-guards": {},
  "./trade-abn": {}, "./trade-mfa-server": {}, "./trade-account-predicates": accountPredicates,
});

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

function fixture(t, options = {}) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE trade_accounts (
      firebase_uid TEXT PRIMARY KEY, business_name TEXT NOT NULL, partner_type TEXT NOT NULL,
      account_status TEXT NOT NULL, abn TEXT NOT NULL, verified_abn TEXT NOT NULL,
      verification_status TEXT NOT NULL, verification_review_id TEXT NOT NULL,
      verification_reviewed_at TEXT NOT NULL, verification_reviewed_by_uid TEXT NOT NULL
    );
    CREATE TABLE trade_account_verification_reviews (
      id TEXT PRIMARY KEY, firebase_uid TEXT NOT NULL, abn TEXT NOT NULL, business_name TEXT NOT NULL,
      partner_type TEXT NOT NULL, decision TEXT NOT NULL, review_method TEXT NOT NULL,
      reviewed_by_uid TEXT NOT NULL, reviewed_at TEXT NOT NULL
    );
    CREATE TABLE trade_team_members (
      id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, member_uid TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      accepted_at TEXT NOT NULL DEFAULT '', last_active_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '2026-09-01T00:00:00.000Z',
      can_manage_jobs INTEGER NOT NULL DEFAULT 1, can_view_quotes INTEGER NOT NULL DEFAULT 1,
      can_manage_quotes INTEGER NOT NULL DEFAULT 0, can_manage_team INTEGER NOT NULL DEFAULT 0,
      can_edit_team_permissions INTEGER NOT NULL DEFAULT 0, job_scope TEXT NOT NULL DEFAULT 'own'
    );
    CREATE TABLE trade_team_invites (
      id TEXT PRIMARY KEY, team_member_id TEXT NOT NULL, owner_uid TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, consumed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '2026-09-01T00:00:00.000Z'
    );
    CREATE TABLE trade_team_member_events (
      id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, team_member_id TEXT NOT NULL,
      actor_uid TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO trade_accounts VALUES ('owner-1', 'Test Trade Pty Ltd', 'installer', 'active',
      '51824753556', '51824753556', 'approved', 'review-1', '2026-09-01T00:00:00.000Z', 'reviewer-1');
    INSERT INTO trade_account_verification_reviews VALUES ('review-1', 'owner-1', '51824753556',
      'Test Trade Pty Ltd', 'installer', 'approved', 'official_abr_lookup', 'reviewer-1', '2026-09-01T00:00:00.000Z');
  `);
  database.prepare(`INSERT INTO trade_team_members (id, owner_uid, email, display_name)
    VALUES ('member-1', 'owner-1', ?, 'Katja')`).run(invitedEmail);
  database.prepare(`INSERT INTO trade_team_invites (id, team_member_id, owner_uid, token_hash, expires_at)
    VALUES ('invite-1', 'member-1', 'owner-1', ?, ?)`).run(tokenHash, new Date(Date.now() + 86400000).toISOString());
  const mfaCalls = [];
  const databaseBinding = {
    prepare: (sql) => new Statement(database, sql),
    async batch(statements) {
      options.beforeBatch?.(database);
      database.exec("BEGIN");
      try {
        const result = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return result;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  };
  const mfa = { requireTradeMyobSecondFactor: async (...args) => {
    mfaCalls.push(args); if (options.mfaError) throw options.mfaError;
  } };
  const helper = loadModule("../src/lib/trade-team-invitation-server.ts", {
    "../../db": { getD1: () => databaseBinding },
    "./trade-access-server": tradeAccess, "@/lib/trade-access-server": tradeAccess,
    "./trade-mfa-server": mfa, "@/lib/trade-mfa-server": mfa,
  });
  const member = () => database.prepare("SELECT * FROM trade_team_members WHERE id = 'member-1'").get();
  const invite = () => database.prepare("SELECT * FROM trade_team_invites WHERE id = 'invite-1'").get();
  return { database, helper, member, invite, mfaCalls };
}

test("valid public invitation exposes only the invited name, email, business and expiry", async (t) => {
  const { helper, invite } = fixture(t);
  assert.deepEqual(await helper.inspectTradeTeamInvitation(token), {
    email: invitedEmail, displayName: "Katja", businessName: "Test Trade Pty Ltd", expiresAt: invite().expires_at,
  });
});

test("random or malformed invitation tokens disclose no invitation", async (t) => {
  const { helper } = fixture(t);
  for (const value of ["", "short", "b".repeat(43), "a".repeat(301)]) {
    await assert.rejects(helper.inspectTradeTeamInvitation(value), { message: "INVITATION_INVALID" });
  }
});

test("new unverified password account cannot bind a member or consume the invitation", async (t) => {
  const { helper, member, invite, mfaCalls } = fixture(t);
  const originalMember = member(); const originalInvite = invite();
  await assert.rejects(helper.acceptTradeTeamInvitation(token, { ...identity, emailVerified: false }), { message: "EMAIL_VERIFICATION_REQUIRED" });
  assert.deepEqual(member(), originalMember); assert.deepEqual(invite(), originalInvite);
  assert.equal(mfaCalls.length, 0);
});

test("verified invite acceptance binds the identity once and preserves assigned permissions", async (t) => {
  const { helper, member, invite, mfaCalls } = fixture(t);
  const before = member();
  await helper.acceptTradeTeamInvitation(token, identity);
  const after = member();
  assert.equal(after.member_uid, identity.uid);
  assert.equal(after.status, "active");
  assert.ok(after.accepted_at); assert.ok(invite().consumed_at);
  for (const key of ["can_manage_jobs", "can_view_quotes", "can_manage_quotes", "can_manage_team", "can_edit_team_permissions", "job_scope"]) {
    assert.equal(after[key], before[key], key);
  }
  assert.equal(mfaCalls.length, 1);
  assert.equal(mfaCalls[0][0].uid, identity.uid); assert.equal(mfaCalls[0][1], "owner-1");
});

test("a different verified email cannot claim an invitation", async (t) => {
  const { helper, member, invite } = fixture(t);
  await assert.rejects(helper.acceptTradeTeamInvitation(token, { ...identity, email: "other@example.invalid" }), { message: "INVITATION_EMAIL_MISMATCH" });
  assert.equal(member().member_uid, ""); assert.equal(invite().consumed_at, "");
});

for (const [name, change] of [
  ["expired", "UPDATE trade_team_invites SET expires_at = '2000-01-01T00:00:00.000Z'"],
  ["revoked", "UPDATE trade_team_invites SET consumed_at = '2026-09-01T00:00:00.000Z'"],
  ["suspended", "UPDATE trade_team_members SET status = 'suspended'"],
  ["removed", "DELETE FROM trade_team_invites"],
]) {
  test(`${name} unclaimed invitation is rejected without activating a member`, async (t) => {
    const { helper, database, member } = fixture(t); database.exec(change);
    const before = member();
    await assert.rejects(helper.inspectTradeTeamInvitation(token), { message: "INVITATION_INVALID" });
    await assert.rejects(helper.acceptTradeTeamInvitation(token, identity), { message: "INVITATION_INVALID" });
    assert.deepEqual(member(), before);
  });
}

for (const [name, change] of [
  ["inactive owner", "UPDATE trade_accounts SET account_status = 'suspended'"],
  ["unapproved owner", "UPDATE trade_accounts SET verification_status = 'pending'"],
  ["invalid ABN", "UPDATE trade_accounts SET abn = '11111111111', verified_abn = '11111111111'"],
  ["missing authoritative review", "DELETE FROM trade_account_verification_reviews"],
  ["mismatched review", "UPDATE trade_account_verification_reviews SET business_name = 'Other company'"],
  ["supplier account", "UPDATE trade_accounts SET partner_type = 'supplier'; UPDATE trade_account_verification_reviews SET partner_type = 'supplier'"],
]) {
  test(`${name} prevents invitation acceptance`, async (t) => {
    const { helper, database, member, invite } = fixture(t); database.exec(change);
    await assert.rejects(helper.acceptTradeTeamInvitation(token, identity), { message: "ABN_REVIEW_REQUIRED" });
    assert.equal(member().member_uid, ""); assert.equal(invite().consumed_at, "");
  });
}

test("an identity may join another team without changing its existing membership", async (t) => {
  const { helper, database, member, invite } = fixture(t);
  database.prepare(`INSERT INTO trade_team_members (id, owner_uid, member_uid, email, display_name)
    VALUES ('another-member', 'owner-2', ?, ?, 'Katja elsewhere')`).run(identity.uid, invitedEmail);
  const original = database.prepare("SELECT * FROM trade_team_members WHERE id='another-member'").get();
  assert.deepEqual(await helper.acceptTradeTeamInvitation(token, identity), { ownerUid: "owner-1", businessName: "Test Trade Pty Ltd" });
  assert.equal(member().member_uid, identity.uid); assert.ok(invite().consumed_at);
  assert.deepEqual(database.prepare("SELECT * FROM trade_team_members WHERE id='another-member'").get(), original);
});

test("an existing business owner login may join a different business as staff", async (t) => {
  const { helper, database, member, invite } = fixture(t);
  database.exec(`INSERT INTO trade_accounts SELECT 'katja-uid', business_name, partner_type, account_status,
    abn, verified_abn, verification_status, verification_review_id, verification_reviewed_at,
    verification_reviewed_by_uid FROM trade_accounts WHERE firebase_uid = 'owner-1'`);
  await helper.acceptTradeTeamInvitation(token, identity);
  assert.equal(member().member_uid, identity.uid); assert.ok(invite().consumed_at);
  assert.equal(member().can_manage_team, 0);
  assert.ok(database.prepare("SELECT 1 FROM trade_accounts WHERE firebase_uid = ?").get(identity.uid));
});

test("a second active membership within the same business is rejected", async (t) => {
  const { helper, database, member, invite } = fixture(t);
  database.prepare(`INSERT INTO trade_team_members (id, owner_uid, member_uid, email, display_name)
    VALUES ('duplicate-member', 'owner-1', ?, 'other-address@example.invalid', 'Existing member')`).run(identity.uid);
  await assert.rejects(helper.acceptTradeTeamInvitation(token, identity), { message: "INVITATION_TEAM_CONFLICT" });
  assert.equal(member().member_uid, ""); assert.equal(invite().consumed_at, "");
});

test("a required MFA challenge leaves a fresh invitation unconsumed", async (t) => {
  const mfaError = Object.assign(new Error("MFA_REQUIRED"), { code: "MFA_REQUIRED", status: 403 });
  const { helper, member, invite } = fixture(t, { mfaError });
  await assert.rejects(helper.acceptTradeTeamInvitation(token, identity), (error) => error === mfaError);
  assert.equal(member().member_uid, ""); assert.equal(invite().consumed_at, "");
});

function legacyAccepted(database) {
  database.prepare(`UPDATE trade_team_members SET member_uid = ?, accepted_at = '2026-09-01T00:00:00.000Z'`).run(identity.uid);
  database.exec(`UPDATE trade_team_invites SET consumed_at = '2026-09-01T00:00:00.000Z', expires_at = '2026-09-02T00:00:00.000Z'`);
}

test("legacy consumed invitation can resume verification only for its exact bound identity", async (t) => {
  const { helper, database } = fixture(t); legacyAccepted(database);
  const metadata = await helper.inspectTradeTeamInvitation(token, { ...identity, emailVerified: false });
  assert.equal(metadata.email, invitedEmail);
  await assert.rejects(helper.inspectTradeTeamInvitation(token), { message: "INVITATION_INVALID" });
  await assert.rejects(helper.inspectTradeTeamInvitation(token, { ...identity, uid: "another-uid" }), { message: "INVITATION_INVALID" });
  await assert.rejects(helper.inspectTradeTeamInvitation(token, { ...identity, email: "another@example.invalid" }), { message: "INVITATION_INVALID" });
});

test("legacy accepted member must still verify the email before reopening access", async (t) => {
  const { helper, database, member, invite } = fixture(t); legacyAccepted(database);
  const beforeMember = member(); const beforeInvite = invite();
  await assert.rejects(helper.acceptTradeTeamInvitation(token, { ...identity, emailVerified: false }), { message: "EMAIL_VERIFICATION_REQUIRED" });
  assert.deepEqual(member(), beforeMember); assert.deepEqual(invite(), beforeInvite);
});

test("verified bound member can resume an expired consumed invitation idempotently", async (t) => {
  const { helper, database, member, invite, mfaCalls } = fixture(t); legacyAccepted(database);
  const beforeMember = member(); const beforeInvite = invite();
  await helper.acceptTradeTeamInvitation(token, identity);
  assert.deepEqual(member(), beforeMember); assert.deepEqual(invite(), beforeInvite);
  assert.equal(mfaCalls.length, 1);
});

test("consumed-link recovery never reactivates a suspended member", async (t) => {
  const { helper, database, member } = fixture(t); legacyAccepted(database);
  database.exec("UPDATE trade_team_members SET status = 'suspended'");
  await assert.rejects(helper.inspectTradeTeamInvitation(token, identity), { message: "INVITATION_INVALID" });
  await assert.rejects(helper.acceptTradeTeamInvitation(token, identity), { message: "INVITATION_INVALID" });
  assert.equal(member().status, "suspended");
});

test("consumed-link recovery still enforces current owner approval and MFA", async (t) => {
  const locked = fixture(t, { mfaError: new Error("MFA_REQUIRED") }); legacyAccepted(locked.database);
  await assert.rejects(locked.helper.acceptTradeTeamInvitation(token, identity), { message: "MFA_REQUIRED" });
  const suspended = fixture(t); legacyAccepted(suspended.database);
  suspended.database.exec("UPDATE trade_accounts SET account_status = 'suspended'");
  await assert.rejects(suspended.helper.acceptTradeTeamInvitation(token, identity), { message: "ABN_REVIEW_REQUIRED" });
});

for (const [name, change] of [
  ["member email changes", "UPDATE trade_team_members SET email = 'changed@example.invalid'"],
  ["member is suspended", "UPDATE trade_team_members SET status = 'suspended'"],
  ["owner loses approval", "UPDATE trade_accounts SET account_status = 'suspended'"],
  ["invitation is replaced", "DELETE FROM trade_team_invites"],
  ["invitation expires", "UPDATE trade_team_invites SET expires_at = '2000-01-01T00:00:00.000Z'"],
  ["another identity claims the member", "UPDATE trade_team_members SET member_uid = 'another-uid'"],
  ["identity acquires duplicate membership in this business", `INSERT INTO trade_team_members (id, owner_uid, member_uid, email, display_name)
    VALUES ('racing-member', 'owner-1', 'katja-uid', 'different@example.invalid', 'Duplicate member')`],
]) {
  test(`acceptance rejects a concurrent change when ${name}`, async (t) => {
    const { helper, database, member, invite } = fixture(t, { beforeBatch: (db) => db.exec(change) });
    await assert.rejects(helper.acceptTradeTeamInvitation(token, identity), { message: "INVITATION_CONFLICT" });
    assert.notEqual(member().member_uid, identity.uid);
    assert.equal(invite()?.consumed_at || "", "");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM trade_team_members WHERE id = 'member-1' AND member_uid = ?").get(identity.uid).count, 0);
  });
}

test("acceptance preserves permissions changed by the business during signup", async (t) => {
  const { helper, member } = fixture(t, { beforeBatch: (db) => db.exec("UPDATE trade_team_members SET can_manage_jobs = 0, can_view_quotes = 0, job_scope = 'team'") });
  await helper.acceptTradeTeamInvitation(token, identity);
  assert.equal(member().member_uid, identity.uid); assert.equal(member().can_manage_jobs, 0);
  assert.equal(member().can_view_quotes, 0); assert.equal(member().job_scope, "team");
});
