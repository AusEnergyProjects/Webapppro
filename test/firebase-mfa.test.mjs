import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as mfa from "../src/lib/firebase-mfa.ts";
import * as audit from "../src/lib/myob-security-audit.ts";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

test("MFA accepts only a recognised second factor, not verified email, Google sign-in or a client flag", () => {
  for (const identity of [undefined, null, {}, { emailVerified: true }, { signInProvider: "google.com" }, { mfa: true }, { secondFactor: true }, { secondFactor: "google.com" }]) {
    assert.throws(() => mfa.requireSecondFactor(identity), { code: "MFA_REQUIRED", status: 403, setupUrl: "/direct-trade/security" });
  }
  for (const secondFactor of ["totp", "phone"]) assert.doesNotThrow(() => mfa.requireSecondFactor({ secondFactor }));
});

test("second-factor parsing ignores unsupported and misplaced claims", () => {
  for (const value of [undefined, null, "totp", true, {}, { sign_in_provider: "google.com" }, { secondFactor: "totp" }, { sign_in_second_factor: true }, { sign_in_second_factor: "unknown" }]) {
    assert.equal(mfa.firebaseSecondFactorClaim(value), "");
  }
  assert.equal(mfa.firebaseSecondFactorClaim({ sign_in_second_factor: "totp" }), "totp");
});

test("Firebase identity uses the second-factor claim from the verified token only", async () => {
  let payload = { sub: "owner", email: "owner@example.invalid", email_verified: true, firebase: { sign_in_provider: "google.com" }, secondFactor: "totp" };
  let verified = 0;
  const server = load("src/lib/firebase-server.ts", {
    "./firebase-mfa.ts": mfa,
    jose: {
      createRemoteJWKSet: () => "trusted-keys",
      errors: {},
      jwtVerify: async (token, keys, options) => {
        verified += 1;
        assert.equal(token, "signed-test-token"); assert.equal(keys, "trusted-keys");
        assert.deepEqual(options, { issuer: "https://securetoken.google.com/australian-energy-assessments", audience: "australian-energy-assessments", algorithms: ["RS256"] });
        return { payload };
      },
    },
  });
  const request = new Request("https://test.invalid", { headers: { Authorization: "Bearer signed-test-token", "X-MFA": "totp" } });
  assert.equal((await server.requireFirebaseIdentity(request)).secondFactor, "");
  payload = { ...payload, firebase: { ...payload.firebase, sign_in_second_factor: "totp" } };
  assert.equal((await server.requireFirebaseIdentity(request)).secondFactor, "totp");
  assert.equal(verified, 2);
  await assert.rejects(server.requireFirebaseIdentity(new Request("https://test.invalid")), { code: "AUTH_REQUIRED" });
});

test("MYOB owner policy protects current and historical data without gating another business or provider", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE trade_crm_integrations (firebase_uid TEXT, provider TEXT, status TEXT); CREATE TABLE trade_crm_accounting_documents (firebase_uid TEXT, provider TEXT); CREATE TABLE trade_crm_oauth_states (id TEXT PRIMARY KEY);");
  database.exec(read("drizzle/0186_myob_security_events.sql"));
  database.exec("INSERT INTO trade_crm_integrations VALUES ('myob-owner','myob','connected'), ('xero-owner','xero','connected'), ('disconnected-owner','myob','disconnected'); INSERT INTO trade_crm_accounting_documents VALUES ('historic-owner','myob');");
  const server = load("src/lib/trade-mfa-server.ts", {
    "../../db": { getD1: () => ({ prepare: (sql) => ({ bind: (...params) => ({ first: async () => database.prepare(sql).get(...params), run: async () => database.prepare(sql).run(...params) }) }) }) },
    "./firebase-mfa": mfa,
    "./myob-security-audit": audit,
  });
  try {
    for (const owner of ["myob-owner", "disconnected-owner", "historic-owner"]) {
      await assert.rejects(server.requireTradeMyobSecondFactor({ uid: "staff", emailVerified: true }, owner), { code: "MFA_REQUIRED" });
      await assert.rejects(server.requireTradeMyobSecondFactor(undefined, owner, "field-member:synthetic-staff"), { code: "MFA_REQUIRED" }, "PIN-only field sessions cannot read MYOB-derived records");
      await server.requireTradeMyobSecondFactor({ uid: "staff", secondFactor: "totp" }, owner);
    }
    await server.requireTradeMyobSecondFactor({ uid: "xero-owner" }, "xero-owner");
    await server.requireTradeMyobSecondFactor(undefined, "unconnected-business");
    const events = database.prepare("SELECT actor_uid, owner_uid, action, resource_id, outcome FROM myob_security_events").all();
    assert.equal(events.length, 6);
    assert.ok(events.every((event) => event.action === "access.denied" && event.outcome === "denied" && event.resource_id === "trade-workspace"));
    assert.equal(events.filter((event) => event.actor_uid === "field-member:synthetic-staff").length, 3);
  } finally { database.close(); }
});

test("team access applies the policy to the employer owner rather than the staff identity", async () => {
  const guarded = [];
  const identity = { uid: "staff", email: "staff@example.invalid", emailVerified: true };
  const server = load("src/lib/trade-team-server.ts", {
    "../../db": { getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => ({ id: "member", owner_uid: "myob-owner" }), run: async () => ({}) }) }) }) },
    "./firebase-server": { requireFirebaseIdentity: async () => identity },
    "./trade-access-server": { tradeAccountProjection: async (uid) => uid === "staff" ? null : { partnerType: "installer", approvedAbnAccess: true } },
    "./creditex-schema-guards": { ensureCreditexSchemaGuards: async () => {} },
    "./tlink-schema-guards": { ensureTlinkSchemaGuards: async () => {} },
    "./trade-team-permission-policy.mjs": {},
    "./trade-field-session-server": { isFieldSessionRequest: (request) => request.headers.has("X-Field"), requireFieldSessionAccess: async () => ({ ownerUid: "myob-owner" }) },
    "./trade-mfa-server": { requireTradeMyobSecondFactor: async (actor, ownerUid) => { guarded.push({ actor, ownerUid }); mfa.requireSecondFactor(actor); } },
  });
  await assert.rejects(server.requireInstallerTeamAccess(new Request("https://test.invalid")), { code: "MFA_REQUIRED" });
  assert.equal(guarded[0].ownerUid, "myob-owner"); assert.equal(guarded[0].actor, identity);
  identity.secondFactor = "totp";
  assert.equal((await server.requireInstallerTeamAccess(new Request("https://test.invalid"))).identity, identity);
  await assert.rejects(server.requireInstallerTeamAccess(new Request("https://test.invalid", { headers: { "X-Field": "yes" } })), { code: "MFA_REQUIRED" });
  assert.equal(guarded.at(-1).actor, undefined);
});
