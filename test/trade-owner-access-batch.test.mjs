import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as abn from "../src/lib/trade-abn.ts";
import * as predicates from "../src/lib/trade-account-predicates.ts";
import * as mfa from "../src/lib/firebase-mfa.ts";
import * as audit from "../src/lib/myob-security-audit.ts";

const compiled = new Map();
function load(relative, dependencies) {
  if (!compiled.has(relative)) compiled.set(relative, ts.transpileModule(
    fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText);
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled.get(relative))(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency ${specifier}`);
    return dependencies[specifier];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function fixture(t, options = {}) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, email TEXT,
    business_name TEXT, abn TEXT, partner_type TEXT, account_status TEXT, verification_status TEXT,
    verified_abn TEXT, verification_review_id TEXT, verification_reviewed_at TEXT, verification_reviewed_by_uid TEXT);
    CREATE TABLE trade_account_verification_reviews (id TEXT PRIMARY KEY, firebase_uid TEXT, abn TEXT,
      business_name TEXT, partner_type TEXT, decision TEXT, review_method TEXT, reviewed_by_uid TEXT, reviewed_at TEXT);
    CREATE TABLE trade_crm_integrations (firebase_uid TEXT, provider TEXT, status TEXT);
    CREATE TABLE trade_crm_accounting_documents (firebase_uid TEXT, provider TEXT);
    CREATE TABLE myob_security_events (id TEXT PRIMARY KEY, actor_uid TEXT, owner_uid TEXT,
      action TEXT, resource_id TEXT, outcome TEXT);
    INSERT INTO trade_accounts VALUES ('owner-one','owner@example.invalid','Fixture trades','51824753556',
      'installer','active','approved','51824753556','review-one','2026-10-06T00:00:00.000Z','reviewer-one');
    INSERT INTO trade_account_verification_reviews VALUES ('review-one','owner-one','51824753556',
      'Fixture trades','installer','approved','official_abr_lookup','reviewer-one','2026-10-06T00:00:00.000Z');`);
  const identity = { uid: "owner-one", email: "owner@example.invalid", emailVerified: true, ...options.identity };
  const calls = [];
  let schemaChecks = 0;
  function statement(sql, values = []) {
    return { sql, values,
      bind: (...parameters) => statement(sql, parameters),
      async first() {
        calls.push({ kind: "first", sql, values });
        return database.prepare(sql).get(...values) || null;
      },
      async run() {
        calls.push({ kind: "run", sql, values });
        return { success: true, meta: { changes: Number(database.prepare(sql).run(...values).changes) } };
      },
    };
  }
  const db = { prepare: statement,
    async batch(statements) {
      calls.push({ kind: "batch", statements: statements.map(({ sql, values }) => ({ sql, values })) });
      if (options.batchError) throw new Error("BATCH_UNAVAILABLE");
      database.exec("BEGIN");
      let results;
      try {
        results = statements.map(item => ({ success: true,
          results: database.prepare(item.sql).all(...item.values), meta: { changes: 0 } }));
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
      return options.batchResult ? options.batchResult(results) : results;
    },
  };
  const policy = load("src/lib/trade-mfa-server.ts", {
    "../../db": { getD1: () => db }, "./firebase-mfa": mfa, "./myob-security-audit": audit,
  });
  const access = load("src/lib/trade-access-server.ts", {
    "../../db": { getD1: () => db }, "./firebase-server": { requireFirebaseIdentity: async () => identity },
    "./creditex-schema-guards": { ensureCreditexSchemaGuards: async () => { schemaChecks += 1; } },
    "./trade-abn": abn, "./trade-account-predicates": predicates, "./trade-mfa-server": policy,
  });
  return { database, identity, calls, policy, access, schemaChecks: () => schemaChecks,
    verify: accessOptions => access.requireVerifiedTradeIdentity(identity, accessOptions),
    events: () => database.prepare("SELECT actor_uid, owner_uid, action, resource_id, outcome FROM myob_security_events").all().map(row => ({ ...row })),
    myob: (status = "connected") => database.prepare("INSERT INTO trade_crm_integrations VALUES ('owner-one','myob',?)").run(status),
  };
}

test("owner access batches exact account and scoped policy reads into one round trip", async t => {
  const f = fixture(t);
  const account = await f.verify({ requireSelectableBusiness: true, partnerTypes: ["installer"] });
  assert.equal(account.firebaseUid, "owner-one");
  assert.equal(account.approvedAbnAccess, true);
  assert.equal(account.identity, f.identity);
  assert.equal(f.schemaChecks(), 1);
  assert.equal(f.calls.length, 1, "two SELECTs share one D1 batch, with no extra first/run RPC");
  assert.equal(f.calls[0].kind, "batch");
  const [accountRead, policyRead] = f.calls[0].statements;
  assert.equal(f.calls[0].statements.length, 2);
  assert.match(accountRead.sql, /^SELECT account\.firebase_uid/);
  assert.ok(accountRead.sql.includes(predicates.approvedTradeReviewPredicate("account")));
  assert.ok(accountRead.sql.includes(predicates.verifiedTradeAccountPredicate("account")));
  assert.deepEqual(accountRead.values, ["owner-one"]);
  assert.equal(policyRead.sql, f.policy.MYOB_MFA_REQUIRED_SQL);
  assert.deepEqual(policyRead.values, ["owner-one", "owner-one"]);
  assert.deepEqual(f.events(), []);
});

test("every invocation reads fresh owner policy and ignores another business and provider", async t => {
  const f = fixture(t);
  f.database.exec("INSERT INTO trade_crm_integrations VALUES ('other-owner','myob','connected'), ('owner-one','xero','connected'); INSERT INTO trade_crm_accounting_documents VALUES ('other-owner','myob');");
  await f.verify();
  f.myob();
  await assert.rejects(f.verify(), { code: "MFA_REQUIRED", status: 403 });
  assert.equal(f.calls.filter(call => call.kind === "batch").length, 2);
  assert.equal(f.schemaChecks(), 2);
  assert.deepEqual(f.events(), [{ actor_uid: "owner-one", owner_uid: "owner-one", action: "access.denied",
    resource_id: "trade-workspace", outcome: "denied" }]);
  f.database.exec("DELETE FROM trade_crm_integrations WHERE firebase_uid='owner-one' AND provider='myob'");
  await f.verify();
  assert.equal(f.calls.filter(call => call.kind === "batch").length, 3);
  assert.equal(f.events().length, 1, "policy absence is read again rather than cached");
});

for (const source of ["connected", "disconnected", "historical"]) {
  test(`batched owner policy requires MFA for ${source} MYOB data`, async t => {
    const f = fixture(t);
    if (source === "historical") f.database.exec("INSERT INTO trade_crm_accounting_documents VALUES ('owner-one','myob')");
    else f.myob(source);
    await assert.rejects(f.verify(), { code: "MFA_REQUIRED" });
    assert.equal(f.events().length, 1);
    assert.deepEqual(f.calls.map(call => call.kind), ["batch", "run"]);
  });
}

for (const secondFactor of ["totp", "phone"]) {
  test(`verified ${secondFactor} keeps one account read and still enforces fresh business approval`, async t => {
    const f = fixture(t, { identity: { secondFactor } });
    f.myob();
    await f.verify();
    assert.deepEqual(f.calls.map(call => call.kind), ["first"]);
    assert.match(f.calls[0].sql, /^SELECT account\.firebase_uid/);
    assert.deepEqual(f.events(), []);
    f.database.exec("UPDATE trade_account_verification_reviews SET decision='rejected'");
    await assert.rejects(f.verify(), { code: "ABN_REVIEW_REQUIRED" });
    assert.deepEqual(f.calls.map(call => call.kind), ["first", "first"]);
  });
}

test("unrecognised second-factor values never bypass the batched policy", async t => {
  const f = fixture(t);
  f.myob();
  for (const secondFactor of [undefined, "", "google.com", true, "true"]) {
    f.identity.secondFactor = secondFactor;
    await assert.rejects(f.verify(), { code: "MFA_REQUIRED" });
  }
  assert.equal(f.calls.filter(call => call.kind === "batch").length, 5);
  assert.equal(f.events().length, 5);
});

test("email verification fails before schema, account or MFA reads", async t => {
  const f = fixture(t, { identity: { emailVerified: false } });
  f.myob();
  await assert.rejects(f.verify(), { code: "EMAIL_VERIFICATION_REQUIRED" });
  assert.equal(f.schemaChecks(), 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.events(), []);
});

const rejectedAccounts = [
  ["missing profile", "DELETE FROM trade_accounts", "PROFILE_REQUIRED"],
  ["inactive account", "UPDATE trade_accounts SET account_status='suspended'", "ACCOUNT_INACTIVE"],
  ["unknown role", "UPDATE trade_accounts SET partner_type='unknown'", "TRADE_ROLE_REQUIRED"],
  ["disallowed role", "UPDATE trade_accounts SET partner_type='supplier'; UPDATE trade_account_verification_reviews SET partner_type='supplier'", "TRADE_ROLE_REQUIRED"],
  ["invalid ABN checksum", "UPDATE trade_accounts SET abn='51824753557'", "ABN_REVIEW_REQUIRED"],
  ["unapproved business", "UPDATE trade_accounts SET verification_status='pending'", "ABN_REVIEW_REQUIRED"],
  ["mismatched verified ABN", "UPDATE trade_accounts SET verified_abn='53004085616'", "ABN_REVIEW_REQUIRED"],
  ["missing review", "DELETE FROM trade_account_verification_reviews", "ABN_REVIEW_REQUIRED"],
  ["review for another owner", "UPDATE trade_account_verification_reviews SET firebase_uid='other-owner'", "ABN_REVIEW_REQUIRED"],
  ["business name changed", "UPDATE trade_accounts SET business_name='Changed business'", "ABN_REVIEW_REQUIRED"],
  ["unofficial review", "UPDATE trade_account_verification_reviews SET review_method='self_declared'", "ABN_REVIEW_REQUIRED"],
  ["reviewer changed", "UPDATE trade_accounts SET verification_reviewed_by_uid='another-reviewer'", "ABN_REVIEW_REQUIRED"],
  ["review timestamp changed", "UPDATE trade_accounts SET verification_reviewed_at='2026-10-07T00:00:00.000Z'", "ABN_REVIEW_REQUIRED"],
];
for (const [label, mutation, code] of rejectedAccounts) {
  test(`${label} retains account error precedence before required MFA and audit`, async t => {
    const f = fixture(t);
    f.myob();
    f.database.exec(mutation);
    await assert.rejects(f.verify({ partnerTypes: ["installer"] }), { code });
    assert.deepEqual(f.calls.map(call => call.kind), ["batch"]);
    assert.deepEqual(f.events(), []);
  });
}

test("revocation is visible on the next invocation without cached owner approval", async t => {
  const f = fixture(t);
  await f.verify();
  f.database.exec("UPDATE trade_accounts SET account_status='suspended'");
  f.myob();
  await assert.rejects(f.verify(), { code: "ACCOUNT_INACTIVE" });
  assert.equal(f.calls.filter(call => call.kind === "batch").length, 2);
  assert.deepEqual(f.events(), []);
});

const invalidBatches = [
  ["missing batch", () => undefined],
  ["non-array batch", () => ({ results: [] })],
  ["missing policy result", rows => rows.slice(0, 1)],
  ["extra result", rows => [...rows, rows[0]]],
  ["failed account read", rows => [{ ...rows[0], success: false }, rows[1]]],
  ["missing account rows", rows => [{ success: true }, rows[1]]],
  ["ambiguous account rows", rows => [{ ...rows[0], results: [...rows[0].results, ...rows[0].results] }, rows[1]]],
  ["failed policy read", rows => [rows[0], { success: false, results: [] }]],
  ["missing policy rows", rows => [rows[0], { success: true }]],
  ["null policy row", rows => [rows[0], { success: true, results: [null] }]],
  ["scalar policy row", rows => [rows[0], { success: true, results: [1] }]],
  ["array policy row", rows => [rows[0], { success: true, results: [[1]] }]],
  ["wrong policy column", rows => [rows[0], { success: true, results: [{ present: 1 }] }]],
  ["zero policy value", rows => [rows[0], { success: true, results: [{ required: 0 }] }]],
  ["string policy value", rows => [rows[0], { success: true, results: [{ required: "1" }] }]],
  ["extra policy columns", rows => [rows[0], { success: true, results: [{ required: 1, other: 1 }] }]],
  ["ambiguous policy rows", rows => [rows[0], { success: true, results: [{ required: 1 }, { required: 1 }] }]],
];
for (const [label, batchResult] of invalidBatches) {
  test(`${label} fails closed without authorizing access`, async t => {
    const f = fixture(t, { batchResult });
    await assert.rejects(f.verify(), { message: "TRADE_ACCESS_UNAVAILABLE" });
    assert.deepEqual(f.events(), []);
  });
}

test("a rejected D1 batch fails closed without audit or access", async t => {
  const f = fixture(t, { batchError: true });
  await assert.rejects(f.verify(), { message: "BATCH_UNAVAILABLE" });
  assert.deepEqual(f.events(), []);
});

test("valid account rejection takes precedence over a returned policy error", async t => {
  const f = fixture(t, { batchResult: rows => [rows[0], { success: false, results: [] }] });
  f.database.exec("UPDATE trade_accounts SET verification_status='pending'");
  await assert.rejects(f.verify(), { code: "ABN_REVIEW_REQUIRED" });
  assert.deepEqual(f.events(), []);
});

test("failure to record the required MFA denial cannot grant owner access", async t => {
  const f = fixture(t);
  f.myob();
  f.database.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON myob_security_events BEGIN SELECT RAISE(ABORT, 'AUDIT_UNAVAILABLE'); END");
  await assert.rejects(f.verify(), /AUDIT_UNAVAILABLE/);
  assert.deepEqual(f.calls.map(call => call.kind), ["batch", "run"]);
  assert.deepEqual(f.events(), []);
});

test("public account projection keeps its existing read-only single-query contract", async t => {
  const f = fixture(t);
  f.myob();
  const account = await f.access.tradeAccountProjection("owner-one");
  assert.equal(account.approvedAbnAccess, true);
  assert.deepEqual(f.calls.map(call => call.kind), ["first"]);
  assert.deepEqual(f.events(), []);
});
