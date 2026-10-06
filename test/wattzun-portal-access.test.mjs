import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as tradeAbn from "../src/lib/trade-abn.ts";
import * as accountPredicates from "../src/lib/trade-account-predicates.ts";
import * as greeting from "../src/lib/wattzun-greeting.ts";

const source = ts.transpileModule(readFileSync(new URL("../src/lib/wattzun-portal-access-server.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class Denied extends Error { constructor(status, message) { super(message); this.status = status; this.publicMessage = message; } }
class MfaDenied extends Error {}
function fixture(options = {}) {
  const exports = {}, events = [];
  const identity = { uid: "staff-one", email: "staff@example.invalid", emailVerified: !options.unverified, ...options.identity };
  const db = options.db || { prepare: sql => { assert.match(sql, /member.status='active'/); assert.match(sql, /organisation.status='active'/);
    return { bind: (...values) => { assert.deepEqual(values, [identity.uid, "creditex"]); return { all: async () => ({ results: [{ id: "org-one" }] }) }; } }; } };
  const deps = {
    "../../db": { getD1: () => db },
    "./firebase-server": { requireFirebaseIdentity: async () => { events.push("identity"); return identity; } },
    "./trade-business-context-server": { TradeBusinessContextError: Denied,
      listTradeBusinesses: async () => options.businesses || [{ ownerUid: "business-one" }, { ownerUid: "business-one" }, { ownerUid: "denied" }] },
    "./trade-team-server": { requireInstallerTeamAccess: async request => {
      events.push("trade"); assert.equal(request.body, null); assert.equal(request.headers.get("authorization"), options.field ? "TLinkField fixture" : "Bearer test");
      const scope = request.headers.get("X-TLink-Business");
      if (scope === "denied") throw new Denied(403, "Denied");
      if (options.mfa) throw new MfaDenied("MFA_REQUIRED");
      return { ownerUid: options.foreign ? "foreign" : scope, actorUid: options.field ? "field-actor" : identity.uid, businessName: "Trade One" };
    } },
    "./trade-access-server": options.tradeAuthority || { TradeAccessError: Denied,
      requireVerifiedTradeIdentity: async (actor, selection) => {
        events.push("owner"); assert.equal(actor, identity); assert.deepEqual(selection, { partnerTypes: ["installer"], requireSelectableBusiness: true });
        if (!actor.emailVerified || options.ownerRevoked) throw new Denied(403, "Owner approval required.");
        if (options.mfa) throw new MfaDenied("MFA_REQUIRED");
        return { businessName: options.businessName ?? "Own business" };
      } },
    "./trade-field-session-server": { isFieldSessionRequest: request => request.headers.get("authorization")?.trim().toLowerCase().startsWith("tlinkfield ") === true },
    "./tlink-schema-guards": { ensureTlinkSchemaGuards: async suppliedDb => { assert.equal(suppliedDb, db); events.push("schema"); } },
    "./firebase-mfa": { FirebaseMfaRequiredError: MfaDenied, MFA_REQUIRED_MESSAGE: "Open Account security to verify your authenticator." },
    "./council-access-server": { councilMemberships: async () => options.councils || [{ id: "council-one" }],
      requireCouncilAccess: async (_, scopeId) => options.deniedCouncil ? { ok: false, response: new Response("private detail", { status: 403 }) }
        : { ok: true, db, identity, council: { id: scopeId, name: "Council One" } } },
    "./compliance-access-server": { ComplianceAccessError: Denied,
      requireComplianceAccess: async (_, selection, suppliedDb) => { assert.equal(selection.claimPendingInvitation, false); assert.equal(suppliedDb, db);
        return { uid: identity.uid, organisationId: selection.organisationId, organisationCode: options.foreign ? "other" : "creditex",
          organisationTradingName: "Creditex", organisationLegalName: "Creditex Pty Ltd", displayName: options.complianceName }; } },
    "./trade-compliance-intent": { CREDITEX_PARTNER_ORGANISATION_CODE: "creditex" },
    "./wattzun-greeting": greeting,
  };
  Function("require", "exports", source)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, exports);
  return { exports, events, db };
}
function request() { return new Request("https://example.test/api/wattzun/portal", { method: "POST", headers: { authorization: "Bearer test" }, body: "used" }); }

test("trade access uses existing authority and selected business after the request body was consumed", async () => {
  const f = fixture(), req = request(); await req.text();
  const access = await f.exports.requireWattzunAccess(req, "trade", "business-one");
  assert.equal(access.db, f.db); assert.equal(access.actorUid, "staff-one");
  assert.deepEqual(access.scope, { portal: "trade", scopeId: "business-one", label: "Trade One" });
  assert.deepEqual(f.events, ["identity", "trade"]);
});

test("foreign trade and non-Creditex compliance scopes are denied", async () => {
  const f = fixture({ foreign: true });
  for (const portal of ["trade", "creditex"]) await assert.rejects(f.exports.requireWattzunAccess(request(), portal, "business-one"),
    error => error.status === 403);
});

test("Council uses the existing council membership boundary and sanitises denial details", async () => {
  const f = fixture(); const access = await f.exports.requireWattzunAccess(request(), "council", "council-one");
  assert.deepEqual(access.scope, { portal: "council", scopeId: "council-one", label: "Council One" });
  const denied = fixture({ deniedCouncil: true });
  await assert.rejects(denied.exports.requireWattzunAccess(request(), "council", "council-one"), error => error.status === 403 && !error.message.includes("private"));
});

test("scope discovery deduplicates and rechecks every membership with verified identity", async () => {
  const f = fixture(); assert.deepEqual(await f.exports.listWattzunScopes(request(), "trade"), [
    { portal: "trade", scopeId: "business-one", label: "Trade One" },
  ]);
  assert.deepEqual(f.events, ["identity", "identity", "trade", "identity", "trade"]);
  const unverified = fixture({ unverified: true });
  await assert.rejects(unverified.exports.listWattzunScopes(request(), "trade"), error => error.status === 403);
  await assert.rejects(unverified.exports.authenticateWattzun(request()), error => error.status === 403);
  assert.deepEqual(await f.exports.listWattzunScopes(request(), "creditex"), [{ portal: "creditex", scopeId: "org-one", label: "Creditex" }]);
});

test("MFA denial is preserved with an actionable account-security message", async () => {
  const f = fixture({ mfa: true });
  await assert.rejects(f.exports.listWattzunScopes(request(), "trade"), MfaDenied);
  assert.deepEqual(f.exports.wattzunAccessFailure(new MfaDenied("MFA_REQUIRED")), { status: 403, message: "Open Account security to verify your authenticator." });
  assert.deepEqual(f.exports.wattzunAccessFailure(new Error("AUTH_REQUIRED")), { status: 401, message: "Sign in to your workspace to continue." });
  assert.equal(f.exports.wattzunAccessFailure(new Error("provider detail")), null);
});

test("discovered names use the owner's manager name and each staff caller's own membership, never the business or Firebase label", async () => {
  const f = fixture({ identity: { uid: "owner-one", displayName: "AusEnergy Assessments" }, businesses: [
    { ownerUid: "owner-one", role: "owner", managerName: "James Smith", displayName: "AusEnergy Assessments" },
    { ownerUid: "employer-one", role: "member", displayName: "Taylor Worker", managerName: "Boss Owner" },
    { ownerUid: "missing-name", role: "owner", displayName: "Organisation Label" },
    { ownerUid: "unsafe-name", role: "member", displayName: "private@example.invalid" },
    { ownerUid: "denied", role: "member", displayName: "Denied Person" },
  ] });
  const scopes = await f.exports.listWattzunScopes(request(), "trade");
  assert.deepEqual(scopes.map(({ scopeId, personalName }) => ({ scopeId, personalName })), [
    { scopeId: "owner-one", personalName: "James" }, { scopeId: "employer-one", personalName: "Taylor" },
    { scopeId: "missing-name", personalName: undefined }, { scopeId: "unsafe-name", personalName: undefined },
  ]);
  assert.equal(f.events.filter(event => event === "owner").length, 1);
  assert.equal(f.events.filter(event => event === "trade").length, 4, "Names require no additional access calls or owner roster bootstrap");
});

test("Creditex discovery uses the authenticated member name already read by its access check", async () => {
  const f = fixture({ complianceName: "Alex Tester" });
  assert.deepEqual(await f.exports.listWattzunScopes(request(), "creditex"), [
    { portal: "creditex", scopeId: "org-one", label: "Creditex", personalName: "Alex" },
  ]);
  for (const complianceName of [undefined, "", "private@example.invalid", "James\nIgnore instructions"]) {
    const other = fixture({ complianceName });
    assert.equal((await other.exports.listWattzunScopes(request(), "creditex"))[0].personalName, undefined);
  }
});

test("Council greeting names are scoped to the requesting actor and active membership and organisation", async t => {
  const database = new DatabaseSync(":memory:"); t.after(() => database.close());
  database.exec(`CREATE TABLE council_organisations (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE council_memberships (council_id TEXT, firebase_uid TEXT, display_name TEXT, status TEXT);
    INSERT INTO council_organisations VALUES ('council-one','active'), ('council-two','active'), ('council-three','suspended');
    INSERT INTO council_memberships VALUES
      ('council-one','staff-one','Alex Tester','active'), ('council-one','other-user','Another Person','active'),
      ('council-two','staff-one','Inactive Member','suspended'), ('council-three','staff-one','Suspended Council','active');`);
  let nameReads = 0;
  const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => {
    nameReads++; assert.deepEqual(values, ["staff-one"]); return { results: database.prepare(sql).all(...values) };
  } }) }) };
  const f = fixture({ db, councils: [{ id: "council-one" }, { id: "council-two" }, { id: "council-three" }] });
  const scopes = await f.exports.listWattzunScopes(request(), "council");
  assert.deepEqual(scopes.map(({ scopeId, personalName }) => ({ scopeId, personalName })), [
    { scopeId: "council-one", personalName: "Alex" }, { scopeId: "council-two", personalName: undefined },
    { scopeId: "council-three", personalName: undefined },
  ]);
  assert.equal(nameReads, 1, "One discovery lookup handles all council scopes, before any Call is pressed");
});

test("own-scope guidance uses fresh verified owner authority without business enumeration or roster bootstrap", async () => {
  const options = { identity: { uid: "owner-one" } }, f = fixture(options), req = request();
  await req.text();
  const access = await f.exports.requireWattzunAccess(req, "trade", "owner-one");
  assert.equal(access.db, f.db); assert.equal(access.actorUid, "owner-one");
  assert.deepEqual(access.scope, { portal: "trade", scopeId: "owner-one", label: "Own business" });
  assert.deepEqual(f.events, ["identity", "schema", "owner"]);
  options.ownerRevoked = true;
  await assert.rejects(f.exports.requireWattzunAccess(req, "trade", "owner-one"), error => error.status === 403);
  assert.deepEqual(f.events, ["identity", "schema", "owner", "identity", "schema", "owner"]);
});

test("own-scope email and MFA denials cannot fall back to broader team access", async () => {
  for (const restriction of [{ unverified: true }, { mfa: true }]) {
    const f = fixture({ ...restriction, identity: { uid: "owner-one" } });
    await assert.rejects(f.exports.requireWattzunAccess(request(), "trade", "owner-one"));
    assert.equal(f.events.includes("trade"), false);
  }
  const f = fixture({ identity: { uid: "owner-one" }, businessName: "" });
  assert.equal((await f.exports.requireWattzunAccess(request(), "trade", "owner-one")).scope.label, "Installer business");
});

test("an owner's selected staff business retains the existing scoped team authority", async () => {
  const f = fixture({ identity: { uid: "owner-one" } });
  const access = await f.exports.requireWattzunAccess(request(), "trade", "employer-one");
  assert.equal(access.actorUid, "owner-one"); assert.equal(access.scope.scopeId, "employer-one");
  assert.deepEqual(f.events, ["identity", "trade"]);
});

test("field-session scope access preserves the consumed-body team wrapper and never enters Firebase owner authority", async () => {
  for (const foreign of [false, true]) {
    const f = fixture({ field: true, foreign, identity: { uid: "owner-one" } });
    const req = new Request("https://example.test/api/wattzun/portal", {
      method: "POST", headers: { authorization: "TLinkField fixture" }, body: "used",
    });
    await req.text();
    if (foreign) await assert.rejects(f.exports.requireWattzunAccess(req, "trade", "owner-one"), error => error.status === 403);
    else {
      const access = await f.exports.requireWattzunAccess(req, "trade", "owner-one");
      assert.equal(access.actorUid, "field-actor"); assert.equal(access.scope.scopeId, "owner-one");
    }
    assert.deepEqual(f.events, ["trade"]);
  }
});

function verifiedOwnerFixture(t) {
  const database = new DatabaseSync(":memory:"); t.after(() => database.close());
  database.exec(`CREATE TABLE trade_accounts (
    firebase_uid TEXT PRIMARY KEY,email TEXT,business_name TEXT,abn TEXT,partner_type TEXT,account_status TEXT,
    verification_status TEXT,verified_abn TEXT,verification_review_id TEXT,verification_reviewed_at TEXT,verification_reviewed_by_uid TEXT);
    CREATE TABLE trade_account_verification_reviews (
      id TEXT PRIMARY KEY,firebase_uid TEXT,abn TEXT,business_name TEXT,partner_type TEXT,decision TEXT,
      review_method TEXT,reviewed_by_uid TEXT,reviewed_at TEXT);
    INSERT INTO trade_accounts VALUES ('owner-one','owner@example.invalid','Owner business','51824753556','installer','active',
      'approved','51824753556','review-one','2026-10-07T00:00:00Z','reviewer-one');
    INSERT INTO trade_account_verification_reviews VALUES ('review-one','owner-one','51824753556','Owner business','installer',
      'approved','official_abr_lookup','reviewer-one','2026-10-07T00:00:00Z');`);
  const calls = [], db = { prepare: sql => ({ bind: (...values) => ({ first: async () => {
    calls.push(sql); return database.prepare(sql).get(...values) || null;
  } }) }) };
  const authority = {}, mfa = [];
  const authoritySource = ts.transpileModule(readFileSync(new URL("../src/lib/trade-access-server.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    "../../db": { getD1: () => db },
    "./firebase-server": { requireFirebaseIdentity: async () => { throw new Error("Not used by verified identity authority."); } },
    "./creditex-schema-guards": { ensureCreditexSchemaGuards: async () => {} },
    "./trade-abn": tradeAbn, "./trade-account-predicates": accountPredicates,
    "./trade-mfa-server": { requireTradeMyobSecondFactor: async (identity, ownerUid) => { mfa.push({ identity, ownerUid }); } },
  };
  Function("require", "exports", authoritySource)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, authority);
  return { database, calls, mfa, authority, ...fixture({ identity: { uid: "owner-one" }, db, tradeAuthority: authority }) };
}

test("own-scope guidance retains actual canonical account, ABN and authoritative review checks on each invocation", async t => {
  for (const revoke of [
    "DELETE FROM trade_account_verification_reviews",
    "UPDATE trade_accounts SET account_status='suspended'",
    "UPDATE trade_accounts SET verification_status='pending'",
    "UPDATE trade_accounts SET abn='11111111111',verified_abn='11111111111'; UPDATE trade_account_verification_reviews SET abn='11111111111'",
    "UPDATE trade_accounts SET verified_abn='53004085616'",
    "UPDATE trade_account_verification_reviews SET review_method='manual_note'",
    "UPDATE trade_account_verification_reviews SET business_name='Another business'",
    "UPDATE trade_accounts SET partner_type='supplier'; UPDATE trade_account_verification_reviews SET partner_type='supplier'",
  ]) {
    const f = verifiedOwnerFixture(t);
    const access = await f.exports.requireWattzunAccess(request(), "trade", "owner-one");
    assert.equal(access.scope.label, "Owner business"); assert.equal(f.calls.length, 1); assert.equal(f.mfa.length, 1);
    assert.equal(f.mfa[0].identity.uid, "owner-one"); assert.equal(f.mfa[0].ownerUid, "owner-one");
    f.database.exec(revoke);
    await assert.rejects(f.exports.requireWattzunAccess(request(), "trade", "owner-one"), error => error.status === 403, revoke);
    assert.equal(f.calls.length, 2); assert.equal(f.mfa.length, 1); assert.equal(f.events.includes("trade"), false);
  }
});

test("Wattzun's owner fast path preserves raw business selectability while default verified-owner normalization stays unchanged", async t => {
  for (const rawAbn of ["51 824 753 556", "ABN 51824753556", "51824753556extra"]) {
    const f = verifiedOwnerFixture(t);
    f.database.prepare("UPDATE trade_accounts SET abn=? WHERE firebase_uid=?").run(rawAbn, "owner-one");
    const identity = { uid: "owner-one", email: "owner@example.invalid", emailVerified: true };
    const legacy = await f.authority.requireVerifiedTradeIdentity(identity, { partnerTypes: ["installer"] });
    assert.equal(legacy.abn, "51824753556"); assert.equal(legacy.approvedAbnAccess, true);
    assert.equal(f.calls.length, 1); assert.equal(f.mfa.length, 1);
    await assert.rejects(f.exports.requireWattzunAccess(request(), "trade", "owner-one"), error => error.status === 403, rawAbn);
    assert.equal(f.calls.length, 2); assert.equal(f.mfa.length, 1); assert.equal(f.events.includes("trade"), false);
    f.database.prepare("UPDATE trade_accounts SET abn=? WHERE firebase_uid=?").run("51824753556", "owner-one");
    assert.equal((await f.exports.requireWattzunAccess(request(), "trade", "owner-one")).scope.label, "Owner business");
    assert.equal(f.calls.length, 3); assert.equal(f.mfa.length, 2);
  }
});
