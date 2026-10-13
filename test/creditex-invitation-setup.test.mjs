import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as permissions from "../src/lib/creditex-permissions.ts";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", output)(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    return dependencies[specifier];
  }, record, record.exports);
  return record.exports;
}
const partner = { CREDITEX_PARTNER_ORGANISATION_CODE: "CREDITEX-AU" };
// Exercise the canonical role and verified-identity predicates without calling unrelated providers.
const compliance = load("../src/lib/compliance-access-server.ts", {
  "../../db": {}, "./firebase-server": {}, "./creditex-schema-guards": {}, "./firebase-mfa": {},
  "./myob-security-audit": {}, "./trade-compliance-intent": partner,
  "./creditex-named-owner-server": {}, "./creditex-permissions": permissions,
});
const setup = load("../src/lib/creditex-invitation-setup-server.ts", {
  "./compliance-access-server": compliance, "./trade-compliance-intent": partner,
});
const id = "1fe1be51-6bc8-4b6d-8f5a-1812a12bbdab";
const time = "2026-10-13T00:00:00.000Z";
const expiresAt = "2026-10-20T00:00:00.000Z";

function fixture(t) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(time) });
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE compliance_organisations (id TEXT PRIMARY KEY, organisation_code TEXT, status TEXT, legal_name TEXT, trading_name TEXT);
    CREATE TABLE compliance_invitations (id TEXT PRIMARY KEY, organisation_id TEXT, email TEXT, display_name TEXT, role TEXT, status TEXT,
      expires_at TEXT, claimed_by_uid TEXT, claimed_at TEXT, permissions_json TEXT, phone TEXT);
    INSERT INTO compliance_organisations VALUES ('org','CREDITEX-AU','active','Creditex Pty Ltd','Creditex'),
      ('foreign','OTHER','active','Other Pty Ltd','Other');
    INSERT INTO compliance_invitations VALUES ('${id}','org','person@example.com','Alex Person','admin','pending','${expiresAt}','','','["team_access"]','0400000000');`);
  const calls = [];
  function prepared(sql, values = []) {
    return {
      bind: (...bindings) => prepared(sql, bindings),
      first: async () => {
        calls.push({ sql, values });
        assert.match(sql.trim(), /^SELECT\b/i, "setup must never claim access or write an account");
        sqlite.exec("PRAGMA query_only=ON");
        return sqlite.prepare(sql).get(...values) || null;
      },
    };
  }
  return { sqlite, database: { prepare: prepared }, calls,
    change(sql) { sqlite.exec("PRAGMA query_only=OFF"); sqlite.exec(sql); } };
}

test("an eligible random invitation exposes only account setup details and performs no writes", async t => {
  const f = fixture(t);
  assert.deepEqual(await setup.loadCreditexInvitationSetup(f.database, id), {
    email: "person@example.com", displayName: "Alex Person", workspaceName: "Creditex", expiresAt,
  });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].values, [id, time, "CREDITEX-AU"]);
  assert.equal(f.sqlite.prepare("SELECT status FROM compliance_invitations").get().status, "pending");
  assert.deepEqual(await setup.loadCreditexInvitationSetup(f.database, id.toUpperCase()), {
    email: "person@example.com", displayName: "Alex Person", workspaceName: "Creditex", expiresAt,
  });
});

test("predictable, non-random, missing, oversized and injection references never query invitation data", async t => {
  const f = fixture(t);
  for (const reference of [null, undefined, [], {}, "", "invite_creditex_aea_info", "invite", `${id} `,
    id.replace("-4b6d-", "-1b6d-"), id.replace("-4b6d-", "-5b6d-"), id.replace("-8f5a-", "-0f5a-"),
    `${id}' OR 1=1 --`, "a".repeat(100_000)]) {
    assert.equal(await setup.loadCreditexInvitationSetup(f.database, reference), null);
  }
  assert.equal(f.calls.length, 0);
});

test("invalid current state, foreign organisation and invalid role share the unavailable result", async t => {
  const f = fixture(t);
  const resets = `UPDATE compliance_invitations SET organisation_id='org',role='admin',status='pending',expires_at='${expiresAt}',claimed_by_uid='',claimed_at='';
    UPDATE compliance_organisations SET status='active' WHERE id='org';`;
  for (const condition of ["status='revoked'", "status='claimed'", "status='expired'", "claimed_by_uid='user'", `claimed_at='${time}'`,
    `expires_at='${time}'`, "expires_at='2026-10-12T00:00:00.000Z'", "expires_at='not-a-date'", "role='owner'", "organisation_id='foreign'"]) {
    f.change(`${resets} UPDATE compliance_invitations SET ${condition};`);
    assert.equal(await setup.loadCreditexInvitationSetup(f.database, id), null, condition);
  }
  f.change(`${resets} UPDATE compliance_organisations SET status='suspended' WHERE id='org';`);
  assert.equal(await setup.loadCreditexInvitationSetup(f.database, id), null);
  assert.equal(await setup.loadCreditexInvitationSetup(f.database, "00000000-0000-4000-8000-000000000000"), null);
});

test("all canonical Creditex roles are eligible and legal name is the workspace fallback", async t => {
  const f = fixture(t);
  f.change("UPDATE compliance_organisations SET trading_name='' WHERE id='org'");
  for (const role of compliance.COMPLIANCE_ROLES) {
    f.change(`UPDATE compliance_invitations SET role='${role}'`);
    assert.equal((await setup.loadCreditexInvitationSetup(f.database, id)).workspaceName, "Creditex Pty Ltd");
  }
});

function routeHarness(f, limit = { allowed: true }, fail = false) {
  const keys = [];
  const route = load("../src/app/api/creditex/invitation/route.ts", {
    "../../../../../db": { getD1: () => f.database },
    "@/lib/lead-rate-limit.mjs": { createSharedLeadRateLimiter: configuration => {
      assert.equal(configuration.limit, 20); assert.equal(configuration.windowMs, 60_000);
      return { check: async key => { keys.push(key); return limit; } };
    } },
    "@/lib/creditex-invitation-setup-server": { loadCreditexInvitationSetup: fail ? async () => { throw new Error("private database detail"); } : setup.loadCreditexInvitationSetup },
  });
  return { route, keys };
}
const request = (reference = id, headers) => new Request(`https://example.com/api/creditex/invitation?invite=${reference}`, { headers });

test("public preflight JSON has private no-store, no-referrer and no executable content", async t => {
  const f = fixture(t); const { route, keys } = routeHarness(f);
  const response = await route.GET(request(id, { "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "spoofed-ip" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, invitation: { email: "person@example.com", displayName: "Alex Person", workspaceName: "Creditex", expiresAt } });
  assert.deepEqual(keys, ["creditex-invitation-setup:ip:192.0.2.1"]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("bad, duplicated, cross-origin and unavailable invitation references reveal one generic denial", async t => {
  const f = fixture(t); const { route } = routeHarness(f); let expected;
  for (const value of [request("invite"), request(`${id}&invite=${id}`), request(id, { origin: "https://foreign.example" }),
    new Request("https://example.com/api/creditex/invitation"), request("00000000-0000-4000-8000-000000000000")]) {
    const response = await route.GET(value); assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.ok, false); assert.equal(body.code, "CREDITEX_INVITATION_UNAVAILABLE");
    if (expected) assert.deepEqual(body, expected); else expected = body;
    assert.doesNotMatch(JSON.stringify(body), /person@example|Alex Person|Creditex Pty|phone|role|permissions/);
  }
  f.change("UPDATE compliance_invitations SET status='revoked'");
  assert.deepEqual(await (await route.GET(request())).json(), expected);
});

test("rate limits and limiter/database outages fail closed without exposing private errors", async t => {
  const f = fixture(t);
  const limited = routeHarness(f, { allowed: false, retryAfterSeconds: 35 });
  const response = await limited.route.GET(request(id, { "x-forwarded-for": "attacker-controlled" }));
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "35");
  assert.equal((await response.json()).code, "CREDITEX_INVITATION_RATE_LIMITED");
  assert.deepEqual(limited.keys, ["creditex-invitation-setup:ip:unknown"]);
  assert.equal(f.calls.length, 0);
  for (const harness of [routeHarness(f, { allowed: false, unavailable: true }), routeHarness(f, { allowed: true }, true)]) {
    const unavailable = await harness.route.GET(request());
    assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get("retry-after"), "60");
    const body = await unavailable.json();
    assert.equal(body.code, "CREDITEX_INVITATION_SETUP_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(body), /database|person@example/);
  }
});

test("setup details cannot substitute for the verified-email membership gate", async t => {
  const f = fixture(t); await setup.loadCreditexInvitationSetup(f.database, id);
  const identity = { uid: "new-user", email: "person@example.com", emailVerified: false };
  assert.equal(await compliance.claimPendingComplianceInvitation(identity, f.database), false);
  assert.throws(() => compliance.assertActiveComplianceMembership(identity, null), error => error.code === "EMAIL_VERIFICATION_REQUIRED");
  assert.throws(() => compliance.assertActiveComplianceMembership({ ...identity, emailVerified: true }, null), error => error.code === "COMPLIANCE_ACCESS_REQUIRED");
  assert.equal(f.calls.length, 1, "unverified identity does not query or claim an invitation");
  assert.equal(f.sqlite.prepare("SELECT status FROM compliance_invitations").get().status, "pending");
});
