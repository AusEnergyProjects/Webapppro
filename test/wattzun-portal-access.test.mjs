import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/lib/wattzun-portal-access-server.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class Denied extends Error { constructor(status, message) { super(message); this.status = status; this.publicMessage = message; } }
class MfaDenied extends Error {}
function fixture(options = {}) {
  const exports = {}, events = [];
  const identity = { uid: "staff-one", emailVerified: !options.unverified };
  const db = { prepare: sql => { assert.match(sql, /member.status='active'/); assert.match(sql, /organisation.status='active'/);
    return { bind: (...values) => { assert.deepEqual(values, [identity.uid, "creditex"]); return { all: async () => ({ results: [{ id: "org-one" }] }) }; } }; } };
  const deps = {
    "../../db": { getD1: () => db },
    "./firebase-server": { requireFirebaseIdentity: async () => { events.push("identity"); return identity; } },
    "./trade-business-context-server": { TradeBusinessContextError: Denied,
      listTradeBusinesses: async () => [{ ownerUid: "business-one" }, { ownerUid: "business-one" }, { ownerUid: "denied" }] },
    "./trade-team-server": { requireInstallerTeamAccess: async request => {
      events.push("trade"); assert.equal(request.body, null); assert.equal(request.headers.get("authorization"), "Bearer test");
      const scope = request.headers.get("X-TLink-Business");
      if (scope === "denied") throw new Denied(403, "Denied");
      if (options.mfa) throw new MfaDenied("MFA_REQUIRED");
      return { ownerUid: options.foreign ? "foreign" : scope, actorUid: identity.uid, businessName: "Trade One" };
    } },
    "./trade-access-server": { TradeAccessError: Denied },
    "./firebase-mfa": { FirebaseMfaRequiredError: MfaDenied, MFA_REQUIRED_MESSAGE: "Open Account security to verify your authenticator." },
    "./council-access-server": { councilMemberships: async () => [{ id: "council-one" }],
      requireCouncilAccess: async (_, scopeId) => options.deniedCouncil ? { ok: false, response: new Response("private detail", { status: 403 }) }
        : { ok: true, db, identity, council: { id: scopeId, name: "Council One" } } },
    "./compliance-access-server": { ComplianceAccessError: Denied,
      requireComplianceAccess: async (_, selection, suppliedDb) => { assert.equal(selection.claimPendingInvitation, false); assert.equal(suppliedDb, db);
        return { uid: identity.uid, organisationId: selection.organisationId, organisationCode: options.foreign ? "other" : "creditex",
          organisationTradingName: "Creditex", organisationLegalName: "Creditex Pty Ltd" }; } },
    "./trade-compliance-intent": { CREDITEX_PARTNER_ORGANISATION_CODE: "creditex" },
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
  assert.deepEqual(f.events, ["trade"]);
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
  assert.deepEqual(f.events, ["identity", "trade", "trade"]);
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
