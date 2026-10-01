import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/trade-field-session-server.ts", import.meta.url), "utf8");

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
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

function loadServer(database) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/lib/trade-field-session-server.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const mocks = {
    "./trade-crews-server": { applyTradeCrewAccess: async access => access },
    "../../db": { getD1: () => d1(database) },
    "./trade-access-server": { tradeAccountProjection: async () => null },
    "./trade-field-access-policy.mjs": {
      FIELD_ACCESS_LOCK_MS: 900000,
      FIELD_ACCESS_MAX_ATTEMPTS: 5,
      FIELD_SESSION_TTL_MS: 7776000000,
      FIELD_SETUP_PIN_TTL_MS: 604800000,
      fieldAccessAttemptState: () => ({ attempts: 0, locked: false, retryAt: "" }),
      normalizeFieldAccessName: (value) => String(value || "").trim().toLowerCase(),
      validFieldSetupPin: (value) => /^\d{6}$/.test(String(value || "")),
    },
  };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function logoutFixture() {
  const database = new DatabaseSync(":memory:");
  const token = 'test-only-field-session-token-000000000001';
  database.exec(`CREATE TABLE trade_field_sessions (token_hash text UNIQUE, owner_uid text, team_member_id text,
      device_id text, status text, revoked_at text, updated_at text);
    CREATE TABLE trade_mobile_devices (owner_uid text, actor_uid text, member_id text, device_id text,
      status text, push_token text, voip_push_token text, native_call_capable integer, push_token_updated_at text, updated_at text);
    INSERT INTO trade_mobile_devices VALUES
      ('owner','field-member:worker','worker','phone-a','active','message-token','call-token',1,'',''),
      ('owner','field-member:worker','worker','phone-b','active','other-phone-message','other-phone-call',1,'',''),
      ('other-owner','field-member:worker','worker','phone-a','active','other-business-message','other-business-call',1,'',''),
      ('owner','firebase-person','other','phone-c','active','office-message','office-call',1,'','');`);
  database.prepare("INSERT INTO trade_field_sessions VALUES (?,'owner','worker','phone-a','active','','')")
    .run(createHash('sha256').update(token).digest('hex'));
  const request = () => new Request('https://test.invalid/api/field/session', { method: 'DELETE', headers: { Authorization: `TLinkField ${token}` } });
  const device = () => database.prepare("SELECT * FROM trade_mobile_devices WHERE owner_uid='owner' AND device_id='phone-a'").get();
  return { database, server: loadServer(database), request, device };
}

test("PIN logout clears only its session's device tokens and repeated logout cannot erase a later registration", async () => {
  const h = logoutFixture(); await h.server.revokeCurrentFieldSession(h.request());
  assert.equal(h.database.prepare('SELECT status FROM trade_field_sessions').get().status, 'revoked');
  assert.equal(h.device().push_token, ''); assert.equal(h.device().voip_push_token, ''); assert.equal(h.device().native_call_capable, 0);
  assert.equal(h.device().status, 'active', 'sign-out permits a future newly authorised PIN on this phone');
  assert.equal(h.database.prepare("SELECT COUNT(*) count FROM trade_mobile_devices WHERE native_call_capable=1 AND voip_push_token<>''").get().count, 3);
  h.database.exec("UPDATE trade_mobile_devices SET push_token='new-message',voip_push_token='new-call',native_call_capable=1 WHERE owner_uid='owner' AND device_id='phone-a'");
  await h.server.revokeCurrentFieldSession(h.request());
  assert.equal(h.device().voip_push_token, 'new-call');
});

test("PIN logout rolls session revocation back if matching device-token removal fails", async () => {
  const h = logoutFixture();
  h.database.exec("CREATE TRIGGER block_clear BEFORE UPDATE ON trade_mobile_devices BEGIN SELECT RAISE(ABORT,'device clear failed'); END;");
  await assert.rejects(h.server.revokeCurrentFieldSession(h.request()), /device clear failed/);
  assert.equal(h.database.prepare('SELECT status FROM trade_field_sessions').get().status, 'active');
  assert.equal(h.device().voip_push_token, 'call-token');
});

test("revoking field access atomically clears native call delivery only for the named business member", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_team_members (id text, owner_uid text);
    INSERT INTO trade_team_members VALUES ('worker','owner');
    CREATE TABLE trade_field_access_codes (owner_uid text, team_member_id text, status text, updated_at text);
    CREATE TABLE trade_field_sessions (owner_uid text, team_member_id text, status text, revoked_at text, updated_at text);
    CREATE TABLE trade_mobile_devices (owner_uid text, member_id text, status text, push_token text, voip_push_token text,
      native_call_capable integer, push_token_updated_at text, revoked_at text, revoked_by_uid text, updated_at text);
    INSERT INTO trade_field_access_codes VALUES ('owner','worker','active','');
    INSERT INTO trade_field_sessions VALUES ('owner','worker','active','','');
    INSERT INTO trade_mobile_devices VALUES ('owner','worker','active','message-token','call-token',1,'','','',''),
      ('owner','other','active','other-message','other-call',1,'','','',''),
      ('another-owner','worker','active','private-message','private-call',1,'','','','');`);
  await loadServer(database).revokeMemberFieldAccess('owner', 'worker', 'manager');
  assert.deepEqual({ ...database.prepare("SELECT status,push_token,voip_push_token,native_call_capable,revoked_by_uid FROM trade_mobile_devices WHERE owner_uid='owner' AND member_id='worker'").get() },
    { status: 'revoked', push_token: '', voip_push_token: '', native_call_capable: 0, revoked_by_uid: 'manager' });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_mobile_devices WHERE status='active' AND native_call_capable=1 AND voip_push_token<>''").get().count, 2);
  for (const table of ['trade_field_access_codes', 'trade_field_sessions']) assert.equal(database.prepare(`SELECT status FROM ${table}`).get().status, 'revoked');
  await assert.rejects(loadServer(database).revokeMemberFieldAccess('another-owner', 'worker', 'manager'), /MEMBER_NOT_FOUND/);
});

test("field PIN creation stores a pepper-backed hash and the email delivery target", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_team_members (
      id text PRIMARY KEY, owner_uid text NOT NULL, email text NOT NULL, display_name text NOT NULL,
      field_username text NOT NULL, field_username_normalized text NOT NULL, status text NOT NULL
    );
    CREATE TABLE trade_field_access_codes (
      id text PRIMARY KEY, owner_uid text NOT NULL, team_member_id text NOT NULL,
      normalized_name text NOT NULL, pin_salt text NOT NULL, pin_hash text NOT NULL,
      status text NOT NULL, expires_at text NOT NULL, consumed_at text NOT NULL,
      created_by_uid text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
    );
    INSERT INTO trade_team_members VALUES
      ('member-1', 'owner-1', 'worker@example.com', 'Test Worker', 'test1', 'test1', 'active');
  `);
  const previous = process.env.TLINK_FIELD_PIN_PEPPER;
  process.env.TLINK_FIELD_PIN_PEPPER = "test-only-pepper-that-is-longer-than-thirty-two-characters";
  try {
    const server = loadServer(database);
    const setup = await server.issueFieldSetupPin({ ownerUid: "owner-1", actorUid: "owner-1", teamMemberId: "member-1" });
    assert.equal(setup.username, "test1");
    assert.equal(setup.recipientEmail, "worker@example.com");
    assert.match(setup.pin, /^\d{6}$/);
    const stored = database.prepare("SELECT * FROM trade_field_access_codes WHERE id = ?").get(setup.id);
    assert.equal(stored.status, "active");
    assert.equal(stored.normalized_name, "test1");
    assert.match(stored.pin_salt, /^[A-Za-z0-9_-]{16,128}$/);
    assert.match(stored.pin_hash, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(setup.pin));
  } finally {
    if (previous === undefined) delete process.env.TLINK_FIELD_PIN_PEPPER;
    else process.env.TLINK_FIELD_PIN_PEPPER = previous;
  }
});

test("field PIN creation fails closed when the server secret is missing", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_team_members (
      id text PRIMARY KEY, owner_uid text NOT NULL, email text NOT NULL, display_name text NOT NULL,
      field_username text NOT NULL, field_username_normalized text NOT NULL, status text NOT NULL
    );
    CREATE TABLE trade_field_access_codes (
      id text PRIMARY KEY, owner_uid text NOT NULL, team_member_id text NOT NULL,
      normalized_name text NOT NULL, pin_salt text NOT NULL, pin_hash text NOT NULL,
      status text NOT NULL, expires_at text NOT NULL, consumed_at text NOT NULL,
      created_by_uid text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
    );
    INSERT INTO trade_team_members VALUES
      ('member-1', 'owner-1', 'worker@example.com', 'Test Worker', 'test1', 'test1', 'active');
  `);
  const previous = process.env.TLINK_FIELD_PIN_PEPPER;
  delete process.env.TLINK_FIELD_PIN_PEPPER;
  try {
    const server = loadServer(database);
    await assert.rejects(
      server.issueFieldSetupPin({ ownerUid: "owner-1", actorUid: "owner-1", teamMemberId: "member-1" }),
      /FIELD_ACCESS_NOT_CONFIGURED/,
    );
    assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_field_access_codes").get().total, 0);
  } finally {
    if (previous !== undefined) process.env.TLINK_FIELD_PIN_PEPPER = previous;
  }
});
