import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as contract from "../src/lib/trade-member-engagement.ts";

const { emptyMemberEngagement, parseMemberEngagement } = contract;
const value = { ...emptyMemberEngagement, engagementType: "employee", rateBasis: "hourly", rateAmount: "42.50", paymentMethod: "bank_transfer", paymentFrequency: "fortnightly", bankAccountName: "Test Person", bankBsb: "123-456", bankAccountNumber: "12345678", superFundName: "Test Fund", superUsi: "TEST-USI", superMemberNumber: "TEST-MEMBER" };
const owner = { isOwner: true, ownerUid: "business-a", actorUid: "business-a", memberId: "owner-a" };
function load(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  Function("require", "module", "exports", code)(id => { if (!(id in dependencies)) throw new Error(`Missing test dependency ${id}`); return dependencies[id]; }, result, result.exports);
  return result.exports;
}
const encryption = load("../src/lib/trade-integration-crypto.ts", {
  "cloudflare:workers": { env: { CRM_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } },
  "@/lib/trade-integration-state": { calendarIntegrationState() {} },
});
function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT,abn TEXT,address_line_1 TEXT,suburb TEXT,address_state TEXT,postcode TEXT);
    INSERT INTO trade_accounts VALUES('business-a','Business A','73675233557','1 Example St','Melbourne','VIC','3000'),('business-b','Business B','other','','','','');
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT NOT NULL,member_uid TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(owner_uid,id));
    INSERT INTO trade_team_members VALUES('owner-a','business-a','business-a','active'),('staff-a','business-a','person-a','active'),('owner-b','business-b','business-b','active'),('staff-b','business-b','person-b','active');
    CREATE TABLE trade_team_member_files(id TEXT PRIMARY KEY);
    CREATE TABLE trade_team_member_events(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,actor_uid TEXT,entity_type TEXT,entity_id TEXT,event_type TEXT,metadata TEXT,created_at TEXT);`);
  database.exec(fs.readFileSync(new URL("../drizzle/0235_trade_member_engagement.sql", import.meta.url), "utf8"));
  function statement(sql, bindings = []) {
    return { bind(...values) { return statement(sql, values); }, async first() { return database.prepare(sql).get(...bindings) || null; }, async all() { return { results: database.prepare(sql).all(...bindings) }; }, async run() { return { meta: { changes: Number(database.prepare(sql).run(...bindings).changes) } }; } };
  }
  const db = { prepare: statement, async batch(statements) { database.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec("COMMIT"); return results; } catch (error) { database.exec("ROLLBACK"); throw error; } } };
  const server = load("../src/lib/trade-member-engagement-server.ts", { "../../db": { getD1: () => db }, "./trade-integration-crypto": encryption, "./trade-member-engagement": contract });
  return { database, db, server };
}

test("engagement type remains separate from pay basis and sensitive values validate without echoing input", () => {
  assert.equal(parseMemberEngagement(value).bankBsb, "123456");
  assert.equal(parseMemberEngagement({ ...value, engagementType: "employee", rateBasis: "per_job" }).rateBasis, "per_job");
  assert.equal(parseMemberEngagement({ ...value, engagementType: "contractor", rateBasis: "hourly" }).engagementType, "contractor");
  for (const changed of [{ rateAmount: "0" }, { rateAmount: "-1" }, { rateAmount: "1.001" }, { rateBasis: "" }, { bankBsb: "123" }, { bankAccountNumber: "secret-invalid-value" }, { startDate: "2026-02-30" }, { engagementType: "invented" }, { tfn: "sensitive-do-not-store" }]) {
    assert.throws(() => parseMemberEngagement({ ...value, ...changed }), error => error.status === 400 && !/secret-invalid-value|sensitive-do-not-store/.test(error.message));
  }
});

test("private records encrypt at rest and survive owner-scoped read with metadata-only audit", async () => {
  const f = fixture();
  try {
    const saved = await f.server.saveMemberEngagement(owner, { memberId: "staff-a", revision: 0, details: value }, f.db);
    assert.equal(saved.revision, 1);
    const stored = f.database.prepare("SELECT * FROM trade_member_engagement").get();
    assert.match(stored.encrypted_payload, /^v1\./);
    assert.doesNotMatch(JSON.stringify(stored), /42\.50|12345678|Test Person|TEST-MEMBER/);
    const read = await f.server.readMemberEngagement(owner, "staff-a", f.db);
    assert.equal(read.details.bankAccountNumber, "12345678");
    assert.equal(read.details.rateAmount, "42.50");
    assert.equal(read.readOnly, false);
    assert.equal(read.business.businessName, 'Business A'); assert.equal(read.business.abn, '73675233557');
    assert.equal(read.business.address, '1 Example St, Melbourne, VIC, 3000');
    const audit = f.database.prepare("SELECT metadata FROM trade_team_member_events").all();
    assert.doesNotMatch(JSON.stringify(audit), /42\.50|12345678|Test Person|TEST-MEMBER/);
    assert.equal(f.database.prepare("SELECT count(*) count FROM trade_team_member_events WHERE event_type='engagement.saved'").get().count, 1);
  } finally { f.database.close(); }
});

test("manager, staff, spoofed owner and cross-business member identifiers cannot read or write pay records", async () => {
  const f = fixture();
  try {
    await f.server.saveMemberEngagement(owner, { memberId: "staff-a", revision: 0, details: value }, f.db);
    for (const actor of [{ ...owner, isOwner: false, canManageTeam: true }, { ...owner, isOwner: false, canManageTeam: false }, { ...owner, actorUid: "person-a" }]) {
      await assert.rejects(f.server.readMemberEngagement(actor, "staff-a", f.db), error => error.status === 403);
      await assert.rejects(f.server.saveMemberEngagement(actor, { memberId: "staff-a", revision: 1, details: value }, f.db), error => error.status === 403);
    }
    await assert.rejects(f.server.readMemberEngagement(owner, "staff-b", f.db), error => error.status === 404);
    await assert.rejects(f.server.saveMemberEngagement(owner, { memberId: "staff-b", revision: 0, details: value }, f.db), error => error.status === 404);
    f.database.prepare("UPDATE trade_team_members SET status='suspended' WHERE id='owner-a'").run();
    await assert.rejects(f.server.readMemberEngagement(owner, "staff-a", f.db), error => error.status === 404);
  } finally { f.database.close(); }
});

test("revision conflicts and archive transitions preserve saved pay without duplicate audit success", async () => {
  const f = fixture();
  try {
    await f.server.saveMemberEngagement(owner, { memberId: "staff-a", revision: 0, details: value }, f.db);
    await assert.rejects(f.server.saveMemberEngagement(owner, { memberId: "staff-a", revision: 0, details: { ...value, rateAmount: "99" } }, f.db), error => error.status === 409);
    const saved = await f.server.saveMemberEngagement(owner, { memberId: "staff-a", revision: 1, details: { ...value, rateAmount: "45" } }, f.db);
    assert.equal(saved.revision, 2);
    assert.equal(saved.details.rateAmount, "45.00");
    assert.equal(f.database.prepare("SELECT count(*) count FROM trade_team_member_events WHERE event_type='engagement.saved'").get().count, 2);
    f.database.prepare("UPDATE trade_team_members SET status='archived' WHERE id='staff-a'").run();
    assert.equal((await f.server.readMemberEngagement(owner, "staff-a", f.db)).readOnly, true);
    await assert.rejects(f.server.saveMemberEngagement(owner, { memberId: "staff-a", revision: 2, details: value }, f.db), error => error.status === 409);
    await assert.rejects(f.server.saveMemberEngagement(owner, { memberId: "owner-a", revision: 1, details: value }, f.db), error => error.status === 409);
  } finally { f.database.close(); }
});

test("copied ciphertext cannot be opened under another member or business", async () => {
  const f = fixture();
  try {
    await f.server.saveMemberEngagement(owner, { memberId: "staff-a", revision: 0, details: value }, f.db);
    f.database.prepare("UPDATE trade_member_engagement SET member_id='owner-a' WHERE member_id='staff-a'").run();
    await assert.rejects(f.server.readMemberEngagement(owner, "owner-a", f.db), error => error.status === 500);
  } finally { f.database.close(); }
});

test("revocation between access lookup and record read cannot disclose the encrypted record", async () => {
  const f = fixture();
  try {
    await f.server.saveMemberEngagement(owner, { memberId: "staff-a", revision: 0, details: value }, f.db);
    const guarded = { ...f.db, prepare(sql) { if (sql.includes("LEFT JOIN trade_member_engagement")) f.database.prepare("UPDATE trade_team_members SET status='suspended' WHERE id='owner-a'").run(); return f.db.prepare(sql); } };
    await assert.rejects(f.server.readMemberEngagement(owner, "staff-a", guarded), error => error.status === 404);
  } finally { f.database.close(); }
});
