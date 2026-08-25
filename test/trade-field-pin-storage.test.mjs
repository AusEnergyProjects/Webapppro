import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
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
