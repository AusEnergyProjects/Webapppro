import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports);
  return record.exports;
}
const portals = load("../src/lib/tlink-portals.ts");
const predicates = load("../src/lib/trade-account-predicates.ts");
const myob = load("../src/lib/myob-security-audit.ts");
const mfa = load("../src/lib/trade-mfa-server.ts", {
  "../../db": {}, "./firebase-mfa": {}, "./myob-security-audit": myob,
});
const server = load("../src/lib/tlink-portal-access-server.ts", {
  "./admin-server": { ADMIN_ROLES: ["owner", "admin", "reviewer", "support"] },
  "./compliance-access-server": { isComplianceRole: value => ["admin", "case_manager", "reviewer", "auditor"].includes(value) },
  "./council-access-server": { isCouncilRole: value => ["owner", "editor", "viewer"].includes(value) },
  "./trade-account-predicates": predicates, "./trade-mfa-server": mfa,
  "./myob-security-audit": myob, "./trade-compliance-intent": { CREDITEX_PARTNER_ORGANISATION_CODE: "creditex" },
  "./tlink-portals": portals,
});
const identity = { uid: "actor", email: "person@example.test", emailVerified: true, authTime: 1, signInProvider: "password" };

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_name TEXT, abn TEXT, partner_type TEXT,
      account_status TEXT, verification_status TEXT, verified_abn TEXT, verification_review_id TEXT,
      verification_reviewed_at TEXT, verification_reviewed_by_uid TEXT);
    CREATE TABLE trade_account_verification_reviews(id TEXT, firebase_uid TEXT, abn TEXT, business_name TEXT,
      partner_type TEXT, decision TEXT, review_method TEXT, reviewed_by_uid TEXT, reviewed_at TEXT);
    CREATE TABLE trade_team_members(owner_uid TEXT, member_uid TEXT, status TEXT);
    CREATE TABLE trade_crm_integrations(firebase_uid TEXT, provider TEXT);
    CREATE TABLE trade_crm_accounting_documents(firebase_uid TEXT, provider TEXT);
    CREATE TABLE admin_users(firebase_uid TEXT, email TEXT, role TEXT, status TEXT);
    CREATE TABLE compliance_organisations(id TEXT, organisation_code TEXT, status TEXT);
    CREATE TABLE compliance_users(id TEXT, organisation_id TEXT, firebase_uid TEXT, email TEXT, role TEXT, status TEXT, created_at TEXT);
    CREATE TABLE compliance_invitations(id TEXT, organisation_id TEXT, email TEXT, role TEXT, status TEXT, expires_at TEXT, created_at TEXT);
    CREATE TABLE council_organisations(id TEXT, status TEXT);
    CREATE TABLE council_memberships(council_id TEXT, firebase_uid TEXT, email TEXT, role TEXT, status TEXT);
    INSERT INTO compliance_organisations VALUES ('org', 'creditex', 'active');
    INSERT INTO council_organisations VALUES ('council', 'active');
  `);
  const prepared = (sql, values = []) => ({
    bind: (...bindings) => prepared(sql, bindings),
    first: async () => { assert.match(sql.trim(), /^SELECT\b/i); return sqlite.prepare(sql).get(...values) || null; },
    all: async () => { assert.match(sql.trim(), /^SELECT\b/i); return { results: sqlite.prepare(sql).all(...values) }; },
  });
  const db = { prepare: prepared };
  const seed = sql => { sqlite.exec("PRAGMA query_only=OFF"); sqlite.exec(sql); };
  const get = async (who = identity) => {
    sqlite.exec("PRAGMA query_only=ON");
    return Object.fromEntries((await server.tlinkPortalAvailability(db, who)).map(item => [item.id, item]));
  };
  const trade = (owner = "actor") => seed(`
    INSERT INTO trade_accounts VALUES ('${owner}', 'Approved business', '51824753556', 'installer', 'active', 'approved',
      '51824753556', 'review-${owner}', '2026-10-05', 'reviewer');
    INSERT INTO trade_account_verification_reviews VALUES ('review-${owner}', '${owner}', '51824753556', 'Approved business',
      'installer', 'approved', 'official_abr_lookup', 'reviewer', '2026-10-05');
  `);
  return { sqlite, db, seed, get, trade, close: () => sqlite.close() };
}

test("portal choices have a fixed TLink default and only supported destinations", () => {
  assert.deepEqual(portals.TLINK_PORTALS.map(item => [item.id, item.href]), [
    ["trade", "/direct-trade/dashboard"], ["admin", "/operations/control-centre"],
    ["creditex", "/creditex/compliance"], ["council", "/council"],
  ]);
});

test("a new signed-in user can start trade setup without gaining privileged portals", async () => {
  const f = fixture();
  try {
    const result = await f.get();
    assert.deepEqual(result.trade, { id: "trade", status: "setup", available: true });
    for (const id of ["admin", "creditex", "council"]) assert.deepEqual(result[id], { id, status: "no_access", available: false });
    assert.equal((await f.get({ ...identity, email: "info@ausenergyassessments.com" })).admin.available, false);
  } finally { f.close(); }
});

test("read-only enumeration recognizes active access across all four portals without exposing records", async () => {
  const f = fixture();
  try {
    f.trade();
    f.seed(`INSERT INTO admin_users VALUES ('actor','person@example.test','owner','active');
      INSERT INTO compliance_users VALUES ('member','org','actor','person@example.test','reviewer','active','2026-10-05');
      INSERT INTO council_memberships VALUES ('council','actor','person@example.test','editor','active');`);
    const result = await f.get();
    for (const item of Object.values(result)) {
      assert.equal(item.status, "ready"); assert.equal(item.available, true);
      assert.deepEqual(Object.keys(item).sort(), ["available", "id", "status"]);
    }
    assert.doesNotMatch(JSON.stringify(result), /person@|actor|business|org|reviewer/);
  } finally { f.close(); }
});

test("trade approval needs the exact current authoritative ABN review", async () => {
  const f = fixture();
  try {
    f.trade(); assert.equal((await f.get()).trade.status, "ready");
    f.seed("UPDATE trade_accounts SET business_name='Changed business'");
    assert.equal((await f.get()).trade.status, "setup");
    f.seed("UPDATE trade_accounts SET business_name='Approved business', abn='12345678901', verified_abn='12345678901'; UPDATE trade_account_verification_reviews SET abn='12345678901'");
    assert.equal((await f.get()).trade.status, "setup");
    f.seed("UPDATE trade_accounts SET account_status='suspended'");
    assert.equal((await f.get()).trade.available, false);
  } finally { f.close(); }
});

test("active trade team membership works without an owned business and is immediately revocable", async () => {
  const f = fixture();
  try {
    f.trade("owner"); f.seed("INSERT INTO trade_team_members VALUES ('owner','actor','active')");
    assert.equal((await f.get()).trade.status, "ready");
    f.seed("UPDATE trade_team_members SET status='suspended'");
    assert.equal((await f.get()).trade.status, "setup");
    f.seed("UPDATE trade_team_members SET status='active'; INSERT INTO trade_team_members VALUES ('owner','actor','active')");
    assert.equal((await f.get()).trade.available, false);
  } finally { f.close(); }
});

test("MYOB gates preserve MFA and permit a separately available trade business", async () => {
  const f = fixture();
  try {
    f.trade(); f.seed("INSERT INTO trade_crm_accounting_documents VALUES ('actor','myob'); INSERT INTO admin_users VALUES ('actor','person@example.test','owner','active'); INSERT INTO compliance_users VALUES ('member','org','actor','person@example.test','reviewer','active','2026-10-05')");
    const gated = await f.get();
    for (const id of ["trade", "admin", "creditex", "council"]) assert.equal(gated[id].status, "verify_mfa");
    const verified = await f.get({ ...identity, secondFactor: "totp" });
    for (const id of ["trade", "admin", "creditex"]) assert.equal(verified[id].status, "ready");
    assert.equal(verified.council.status, "setup");
    f.trade("other"); f.seed("INSERT INTO trade_team_members VALUES ('other','actor','active')");
    assert.equal((await f.get()).trade.status, "ready");
  } finally { f.close(); }
});

test("pending invitations are advertised to the verified email without claiming them", async () => {
  const f = fixture();
  try {
    f.seed(`INSERT INTO council_memberships VALUES ('council',NULL,'person@example.test','owner','active');
      INSERT INTO compliance_invitations VALUES ('invite','org','person@example.test','reviewer','pending','2099-01-01','2026-10-05');
      INSERT INTO admin_users VALUES ('pending:invite','person@example.test','admin','active');`);
    const result = await f.get();
    assert.equal(result.council.status, "invitation"); assert.equal(result.creditex.status, "invitation"); assert.equal(result.admin.status, "ready");
    assert.equal(f.sqlite.prepare("SELECT firebase_uid FROM council_memberships").get().firebase_uid, null);
    assert.equal(f.sqlite.prepare("SELECT status FROM compliance_invitations").get().status, "pending");
    assert.equal(f.sqlite.prepare("SELECT firebase_uid FROM admin_users").get().firebase_uid, "pending:invite");
    const unverified = await f.get({ ...identity, emailVerified: false });
    assert.equal(unverified.trade.status, "verify_email");
    for (const id of ["admin", "creditex", "council"]) assert.equal(unverified[id].available, false);
  } finally { f.close(); }
});

test("bound access requires verification but cannot be claimed through another UID's email", async () => {
  const f = fixture();
  try {
    f.seed(`INSERT INTO admin_users VALUES ('actor','person@example.test','admin','active');
      INSERT INTO compliance_users VALUES ('member','org','actor','person@example.test','reviewer','active','2026-10-05');
      INSERT INTO council_memberships VALUES ('council','actor','person@example.test','editor','active');`);
    const unverified = await f.get({ ...identity, emailVerified: false });
    for (const id of ["admin", "creditex", "council"]) assert.equal(unverified[id].status, "verify_email");
    const stolen = await f.get({ ...identity, uid: "different" });
    for (const id of ["admin", "creditex", "council"]) assert.equal(stolen[id].available, false);
    f.seed("UPDATE compliance_users SET email='different@example.test'");
    assert.equal((await f.get()).creditex.available, false);
  } finally { f.close(); }
});

test("suspension, expired invitations, wrong organisation and invalid roles cannot advertise access", async () => {
  const f = fixture();
  try {
    f.seed(`INSERT INTO admin_users VALUES ('actor','person@example.test','owner','suspended');
      INSERT INTO council_memberships VALUES ('council','actor','person@example.test','editor','active');
      UPDATE council_organisations SET status='suspended';
      INSERT INTO compliance_invitations VALUES ('invite','org','person@example.test','reviewer','pending','2000-01-01','2000-01-01');`);
    const result = await f.get();
    for (const id of ["admin", "creditex", "council"]) assert.equal(result[id].available, false);
    f.seed("UPDATE compliance_invitations SET expires_at='2099-01-01'; UPDATE compliance_organisations SET organisation_code='different'");
    assert.equal((await f.get()).creditex.available, false);
    f.seed("UPDATE council_organisations SET status='active'; UPDATE council_memberships SET role='superuser'; UPDATE admin_users SET status='active', role='superuser'");
    assert.equal((await f.get()).council.available, false); assert.equal((await f.get()).admin.available, false);
  } finally { f.close(); }
});

test("ambiguous compliance memberships and invitations do not claim readiness", async () => {
  const f = fixture();
  try {
    f.seed(`INSERT INTO compliance_invitations VALUES ('one','org','person@example.test','reviewer','pending','2099-01-01','2026-10-05');
      INSERT INTO compliance_invitations VALUES ('two','org','person@example.test','reviewer','pending','2099-01-01','2026-10-05');`);
    assert.equal((await f.get()).creditex.available, false);
    f.seed(`INSERT INTO compliance_users VALUES ('one','org','actor','person@example.test','reviewer','active','2026-10-05');
      INSERT INTO compliance_users VALUES ('two','org','actor','person@example.test','reviewer','active','2026-10-05');`);
    assert.equal((await f.get()).creditex.available, false);
  } finally { f.close(); }
});

test("only owner and admin operations roles can reach council provisioning without a membership", async () => {
  const f = fixture();
  try {
    f.seed("INSERT INTO admin_users VALUES ('actor','person@example.test','reviewer','active')");
    assert.equal((await f.get()).council.available, false);
    f.seed("UPDATE admin_users SET role='admin'");
    assert.equal((await f.get()).council.status, "setup");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM council_memberships").get().n, 0);
  } finally { f.close(); }
});

test("portal route requires Firebase authentication and never caches or leaks provider failures", async () => {
  let signedIn = false, fail = false, called = 0;
  const route = load("../src/app/api/tlink/portals/route.ts", {
    "../../../../../db": { getD1: () => ({}) },
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => { if (!signedIn) throw new Error("AUTH_REQUIRED"); return identity; } },
    "@/lib/tlink-portal-access-server": { tlinkPortalAvailability: async () => { called++; if (fail) throw new Error("private provider data"); return [{ id: "trade", status: "setup", available: true }]; } },
  });
  const request = new Request("https://example.test/api/tlink/portals", { headers: { "X-TLink-Business": "different" } });
  const denied = await route.GET(request);
  assert.equal(denied.status, 401); assert.equal(called, 0); assert.equal(denied.headers.get("cache-control"), "no-store");
  signedIn = true;
  const allowed = await route.GET(request);
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await allowed.json(), { ok: true, portals: [{ id: "trade", status: "setup", available: true }] });
  fail = true;
  const unavailable = await route.GET(request);
  assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /private provider/);
});
