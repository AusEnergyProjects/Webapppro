import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const permissions = ["can_create_jobs", "can_manage_jobs", "can_assign_jobs", "can_view_customers",
  "can_manage_customers", "can_view_quotes", "can_manage_quotes", "can_send_quotes", "can_send_sms",
  "can_view_invoices", "can_manage_invoices", "can_view_price_book", "can_manage_price_book",
  "can_apply_discounts", "can_reschedule_jobs", "can_manage_team", "can_edit_team_permissions",
  "can_view_field_evidence", "can_manage_field_evidence", "can_run_reports", "can_search_customers"];

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return { success: true, meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } }; }
}

function fixture(t, options = {}) {
  const database = new DatabaseSync(":memory:"); t.after(() => database.close());
  database.exec(`CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, email TEXT NOT NULL,
    business_name TEXT NOT NULL, partner_type TEXT NOT NULL DEFAULT 'installer', account_status TEXT NOT NULL DEFAULT 'active',
    abn TEXT NOT NULL, verified_abn TEXT NOT NULL, verification_status TEXT NOT NULL DEFAULT 'approved',
    verification_review_id TEXT NOT NULL, verification_reviewed_at TEXT NOT NULL, verification_reviewed_by_uid TEXT NOT NULL);
    CREATE TABLE trade_account_verification_reviews (id TEXT PRIMARY KEY, firebase_uid TEXT NOT NULL,
      abn TEXT NOT NULL, business_name TEXT NOT NULL, partner_type TEXT NOT NULL DEFAULT 'installer',
      decision TEXT NOT NULL DEFAULT 'approved', review_method TEXT NOT NULL DEFAULT 'official_abr_lookup',
      reviewed_at TEXT NOT NULL, reviewed_by_uid TEXT NOT NULL);
    CREATE TABLE trade_team_members (id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, member_uid TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'field',
      status TEXT NOT NULL DEFAULT 'active', ${permissions.map(column => `${column} INTEGER NOT NULL DEFAULT 0`).join(",")},
      job_scope TEXT NOT NULL DEFAULT 'own', schedule_scope TEXT NOT NULL DEFAULT 'own',
      accepted_at TEXT NOT NULL DEFAULT '', invited_at TEXT NOT NULL DEFAULT '', last_active_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '');`);
  database.exec(fs.readFileSync(new URL("../drizzle/0230_trade_manager_name.sql", import.meta.url), "utf8"));
  const identity = { uid: "person-1", email: "person@example.invalid", emailVerified: true,
    authTime: 1, signInProvider: "password", ...options.identity };
  const calls = { mfa: [], schema: [] };
  const db = { prepare: sql => new Statement(database, sql) };
  const cache = new Map();
  function load(relative) {
    const resolved = path.resolve(root, relative);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const source = fs.readFileSync(resolved, "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: relative }).outputText;
    const moduleRecord = { exports: {} }; cache.set(resolved, moduleRecord);
    const dependencies = {
      "../../db": { getD1: () => db },
      "./firebase-server": { requireFirebaseIdentity: async () => {
        if (options.authError) throw new Error("AUTH_REQUIRED"); return identity;
      } },
      "./creditex-schema-guards": { ensureCreditexSchemaGuards: async () => calls.schema.push("creditex") },
      "./tlink-schema-guards": { ensureTlinkSchemaGuards: async () => calls.schema.push("tlink") },
      "./trade-mfa-server": { requireTradeMyobSecondFactor: async (actor, ownerUid, actorUid) => {
        calls.mfa.push({ actor, ownerUid, actorUid });
        if (options.mfaOwner === ownerUid && !actor?.secondFactor) throw Object.assign(new Error("MFA_REQUIRED"), { code: "MFA_REQUIRED" });
      } },
      "./trade-team-permission-policy.mjs": { canAssignWithinScope: () => false },
      "./trade-field-session-server": {
        isFieldSessionRequest: request => request.headers.get("Authorization")?.startsWith("TLinkField ") || false,
        requireFieldSessionAccess: async () => ({ ownerUid: "business-a", actorUid: "field-person", memberId: "field-member" }),
      },
      "@/lib/admin-server": { adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } }), mfaErrorResponse: () => null },
    };
    const require = specifier => {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      if (specifier === "@/lib/firebase-server") return dependencies["./firebase-server"];
      if (specifier.startsWith("@/")) return load(`src/${specifier.slice(2)}.ts`);
      if (specifier.startsWith("./")) return load(path.relative(root, path.resolve(path.dirname(resolved), `${specifier}.ts`)));
      throw new Error(`Unexpected business-context dependency: ${specifier}`);
    };
    new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
    return moduleRecord.exports;
  }
  let serial = 0;
  function owner(uid, name = uid) {
    const review = `review-${++serial}`; const reviewedAt = "2026-09-29T00:00:00.000Z";
    database.prepare(`INSERT INTO trade_accounts (firebase_uid,email,business_name,abn,verified_abn,verification_review_id,verification_reviewed_at,verification_reviewed_by_uid)
      VALUES (?, ?, ?, '51824753556','51824753556',?,?,'reviewer')`).run(uid, `${uid}@example.invalid`, name, review, reviewedAt);
    database.prepare(`INSERT INTO trade_account_verification_reviews (id,firebase_uid,abn,business_name,reviewed_at,reviewed_by_uid)
      VALUES (?,?,'51824753556',?,?,'reviewer')`).run(review, uid, name, reviewedAt);
  }
  function member(id, ownerUid, uid = identity.uid, values = {}) {
    database.prepare(`INSERT INTO trade_team_members (id,owner_uid,member_uid,email,display_name,can_view_quotes,can_manage_jobs)
      VALUES (?,?,?,?,?,1,1)`).run(id, ownerUid, uid, `${uid}@example.invalid`, `${id} name`);
    for (const [key, value] of Object.entries(values)) {
      assert.ok([...permissions, "status", "accepted_at", "job_scope"].includes(key));
      database.prepare(`UPDATE trade_team_members SET ${key}=? WHERE id=?`).run(value, id);
    }
  }
  function request(business, field = false) {
    const headers = { Authorization: field ? "TLinkField fixture" : "Bearer fixture" };
    if (business !== undefined) headers["X-TLink-Business"] = business;
    return new Request("https://test.invalid/api/trade-team", { headers });
  }
  return { database, identity, calls, owner, member, request,
    context: load("src/lib/trade-business-context-server.ts"),
    teams: load("src/lib/trade-team-server.ts"), route: load("src/app/api/trade-businesses/route.ts") };
}

test("business choices include eligible own business and memberships, dedupe own row, exclude other people", async t => {
  const f = fixture(t); f.owner(f.identity.uid, "Own company"); f.owner("business-a", "Employer"); f.owner("other", "Unrelated");
  f.member("own-member", f.identity.uid); f.member("staff-a", "business-a"); f.member("other-staff", "other", "someone-else");
  assert.deepEqual((await f.context.listTradeBusinesses(f.identity)).map(business => ({ ...business })), [
    { ownerUid: f.identity.uid, businessName: "Own company", role: "owner", memberId: "own-member", displayName: "Own company" },
    { ownerUid: "business-a", businessName: "Employer", role: "member", memberId: "staff-a", displayName: "staff-a name" },
  ]);
});

test("manager name is available only on the owner's choice while member and business display names remain unchanged", async t => {
  const f = fixture(t); f.owner(f.identity.uid, "Own company"); f.owner("business-a", "Employer");
  f.member("staff-a", "business-a");
  f.database.prepare("UPDATE trade_accounts SET manager_name=? WHERE firebase_uid=?").run("James Morris", f.identity.uid);
  f.database.prepare("UPDATE trade_accounts SET manager_name=? WHERE firebase_uid=?").run("Employer manager", "business-a");
  const [owner, member] = await f.context.listTradeBusinesses(f.identity);
  assert.equal(owner.managerName, "James Morris");
  assert.equal(owner.displayName, "Own company");
  assert.equal(owner.businessName, "Own company");
  assert.equal(Object.hasOwn(member, "managerName"), false);
  assert.equal(member.displayName, "staff-a name");
  assert.equal(member.businessName, "Employer");
});

test("membership enumeration excludes revoked, unapproved, inactive, supplier and fabricated approvals", async t => {
  const f = fixture(t);
  for (const name of ["valid", "revoked", "pending", "inactive", "supplier", "unreviewed"]) { f.owner(name); f.member(`member-${name}`, name); }
  f.database.exec(`UPDATE trade_team_members SET status='suspended' WHERE owner_uid='revoked';
    UPDATE trade_accounts SET verification_status='pending' WHERE firebase_uid='pending';
    UPDATE trade_accounts SET account_status='suspended' WHERE firebase_uid='inactive';
    UPDATE trade_accounts SET partner_type='supplier' WHERE firebase_uid='supplier';
    UPDATE trade_account_verification_reviews SET partner_type='supplier' WHERE firebase_uid='supplier';
    DELETE FROM trade_account_verification_reviews WHERE firebase_uid='unreviewed'`);
  assert.deepEqual((await f.context.listTradeBusinesses(f.identity)).map(b => b.ownerUid), ["valid"]);
});

test("multiple eligible businesses require an explicit choice instead of latest acceptance", async t => {
  const f = fixture(t); f.owner("business-a"); f.owner("business-b");
  f.member("member-a", "business-a", f.identity.uid, { accepted_at: "2026-09-01" });
  f.member("member-b", "business-b", f.identity.uid, { accepted_at: "2026-09-29" });
  await assert.rejects(f.teams.requireInstallerTeamAccess(f.request()), { code: "BUSINESS_SELECTION_REQUIRED", status: 409 });
  assert.equal(f.calls.mfa.length, 0);
});

test("owner and staff permissions remain separate for the same identity", async t => {
  const f = fixture(t); f.owner(f.identity.uid, "Own company"); f.owner("business-a", "Employer");
  f.member("staff-a", "business-a", f.identity.uid, { can_manage_jobs: 0 });
  const staff = await f.teams.requireInstallerTeamAccess(f.request("business-a"));
  assert.equal(staff.ownerUid, "business-a"); assert.equal(staff.actorUid, f.identity.uid);
  assert.equal(staff.isOwner, false); assert.equal(staff.memberId, "staff-a"); assert.equal(staff.businessName, "Employer");
  assert.equal(staff.canManageJobs, false); assert.equal(staff.canManageTeam, false); assert.equal(staff.canViewQuotes, true);
  const owner = await f.teams.requireInstallerTeamAccess(f.request(f.identity.uid));
  assert.equal(owner.ownerUid, f.identity.uid); assert.equal(owner.isOwner, true);
  assert.equal(owner.canManageJobs, true); assert.equal(owner.canManageTeam, true);
  assert.notEqual(owner.memberId, staff.memberId);
  assert.equal(f.database.prepare("SELECT can_manage_team FROM trade_team_members WHERE id='staff-a'").get().can_manage_team, 0);
});

test("explicitly chosen membership uses that business's current permissions and MFA", async t => {
  const f = fixture(t, { mfaOwner: "business-b" }); f.owner("business-a"); f.owner("business-b");
  f.member("staff-a", "business-a"); f.member("staff-b", "business-b", f.identity.uid, { can_manage_jobs: 0 });
  assert.equal((await f.teams.requireInstallerTeamAccess(f.request("business-a"))).memberId, "staff-a");
  await assert.rejects(f.teams.requireInstallerTeamAccess(f.request("business-b")), { code: "MFA_REQUIRED" });
  assert.equal(f.calls.mfa.at(-1).ownerUid, "business-b");
  f.identity.secondFactor = "totp";
  const access = await f.teams.requireInstallerTeamAccess(f.request("business-b"));
  assert.equal(access.canManageJobs, false); assert.equal(access.memberId, "staff-b");
});

test("one eligible business remains compatible with clients sending no selector", async t => {
  const f = fixture(t); f.owner("business-a"); f.member("staff-a", "business-a");
  assert.equal((await f.teams.requireInstallerTeamAccess(f.request())).ownerUid, "business-a");
});

test("unrelated or stale selectors cannot fall back to another business", async t => {
  const f = fixture(t); f.owner("business-a"); f.owner("unrelated"); f.member("staff-a", "business-a");
  f.member("other-staff", "unrelated", "someone-else");
  for (const requested of ["unrelated", "missing", "", "business-a,business-b"]) {
    await assert.rejects(f.teams.requireInstallerTeamAccess(f.request(requested)), { code: "BUSINESS_ACCESS_REQUIRED", status: 403 });
  }
  f.database.exec("UPDATE trade_team_members SET status='suspended' WHERE id='staff-a'");
  await assert.rejects(f.teams.requireInstallerTeamAccess(f.request("business-a")), { code: "BUSINESS_ACCESS_REQUIRED" });
});

test("membership and owner approval are revalidated on every request", async t => {
  const f = fixture(t); f.owner("business-a"); f.member("staff-a", "business-a");
  await f.teams.requireInstallerTeamAccess(f.request("business-a"));
  f.database.exec("DELETE FROM trade_account_verification_reviews WHERE firebase_uid='business-a'");
  await assert.rejects(f.teams.requireInstallerTeamAccess(f.request("business-a")), { code: "BUSINESS_ACCESS_REQUIRED" });
});

test("field PIN sessions stay locked to their issued business", async t => {
  const f = fixture(t);
  assert.equal((await f.teams.requireInstallerTeamAccess(f.request(undefined, true))).ownerUid, "business-a");
  assert.equal((await f.teams.requireInstallerTeamAccess(f.request("business-a", true))).ownerUid, "business-a");
  await assert.rejects(f.teams.requireInstallerTeamAccess(f.request("business-b", true)), { code: "BUSINESS_ACCESS_REQUIRED" });
});

test("businesses endpoint requires verified authentication and lists no private record data", async t => {
  const f = fixture(t); f.owner("business-a"); f.member("staff-a", "business-a");
  const response = await f.route.GET(f.request()); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(result.requiresSelection, false); assert.equal(result.businesses.length, 1);
  assert.deepEqual(Object.keys(result.businesses[0]).sort(), ["businessName", "displayName", "memberId", "ownerUid", "role"]);
  f.identity.emailVerified = false;
  assert.equal((await f.route.GET(f.request())).status, 403);
  const unauthenticated = fixture(t, { authError: true });
  assert.equal((await unauthenticated.route.GET(unauthenticated.request())).status, 401);
});

test("business list reports selection required and allows empty onboarding accounts", async t => {
  const f = fixture(t); assert.deepEqual(await (await f.route.GET(f.request())).json(), { ok: true, businesses: [], requiresSelection: false });
  f.owner("business-a"); f.owner("business-b"); f.member("staff-a", "business-a"); f.member("staff-b", "business-b");
  const payload = await (await f.route.GET(f.request())).json();
  assert.equal(payload.requiresSelection, true); assert.equal(payload.businesses.length, 2);
});

test("duplicate active memberships within one business fail instead of picking arbitrary permissions", async t => {
  const f = fixture(t); f.owner("business-a"); f.member("staff-a", "business-a"); f.member("staff-duplicate", "business-a", f.identity.uid, { can_manage_jobs: 0 });
  await assert.rejects(f.teams.requireInstallerTeamAccess(f.request("business-a")), { code: "BUSINESS_ACCESS_REQUIRED" });
});
