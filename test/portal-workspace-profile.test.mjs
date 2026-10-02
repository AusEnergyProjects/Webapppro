import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)((key) => {
    assert.ok(key in dependencies, `Unexpected dependency ${key}`); return dependencies[key];
  }, result, result.exports);
  return result.exports;
}
const branding = load("../src/lib/trade-business-branding.ts");
const pure = load("../src/lib/portal-workspace-profile.ts", { "./trade-business-branding": branding });
let currentActor;
const server = load("../src/lib/portal-workspace-profile-server.ts", {
  "./portal-workspace-profile": pure,
  "./admin-server": { requireAdminIdentity: async () => { if (!currentActor) throw new Error("ADMIN_REQUIRED"); return currentActor; } },
  "./compliance-access-server": { requireComplianceAccess: async () => { if (!currentActor) throw new Error("COMPLIANCE_ACCESS_REQUIRED"); return currentActor; } },
});
const actor = { workspace: "creditex", tenantId: "org-a", memberId: "member-a", uid: "user-a", displayName: "Verified Name" };
const profile = { displayName: "Preferred Name", themeKey: "indigo_orchid", colourMode: "night" };
function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec(`CREATE TABLE admin_users(id TEXT PRIMARY KEY,firebase_uid TEXT,status TEXT,display_name TEXT,role TEXT);
    CREATE TABLE compliance_organisations(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE compliance_users(id TEXT PRIMARY KEY,organisation_id TEXT,firebase_uid TEXT,status TEXT,display_name TEXT,role TEXT);
    INSERT INTO compliance_organisations VALUES ('org-a','active'),('org-b','active');
    INSERT INTO compliance_users VALUES ('member-a','org-a','user-a','active','Verified Name','admin'),('member-b','org-b','user-a','active','Other Name','reviewer');
    INSERT INTO admin_users VALUES ('admin-a','user-a','active','Admin Name','owner');`);
  sql.exec(fs.readFileSync(new URL("../drizzle/0238_portal_workspace_profiles.sql", import.meta.url), "utf8"));
  const prepare = (query, values = []) => ({ bind: (...next) => prepare(query, next), first: async () => sql.prepare(query).get(...values) || null,
    run: async () => { const result = sql.prepare(query).run(...values); return { meta: { changes: Number(result.changes) } }; } });
  return { sql, db: { prepare } };
}

test("profile accepts only personal preferences, valid palettes and bounded names", () => {
  assert.deepEqual(pure.portalProfileInput(profile), profile);
  for (const input of [null, [], { ...profile, role: "owner" }, { ...profile, organisationId: "other" }, { ...profile, displayName: "" },
    { ...profile, displayName: "n".repeat(121) }, { ...profile, displayName: "Name\nIdentity" }, { ...profile, themeKey: "url(javascript:)" }, { ...profile, colourMode: "custom" }]) assert.equal(pure.portalProfileInput(input), null);
});

test("profile authority derives membership and tenant from verified access, ignoring client tenant claims", async (t) => {
  const { db } = fixture(t);
  currentActor = { uid: "user-a", membershipId: "member-a", organisationId: "org-a", displayName: "Verified Name" };
  assert.deepEqual(await server.requirePortalProfileActor(new Request("https://example.invalid/api/portal-workspace-profile?workspace=creditex&organisationId=org-b"), db), actor);
  currentActor = { uid: "user-a", adminId: "admin-a", displayName: "Admin Name" };
  assert.deepEqual(await server.requirePortalProfileActor(new Request("https://example.invalid/?workspace=admin&memberId=other"), db), {
    workspace: "admin", tenantId: "operations", memberId: "admin-a", uid: "user-a", displayName: "Admin Name",
  });
  await assert.rejects(server.requirePortalProfileActor(new Request("https://example.invalid/?workspace=trade"), db), /PORTAL_WORKSPACE_INVALID/);
  currentActor = null;
  await assert.rejects(server.requirePortalProfileActor(new Request("https://example.invalid/?workspace=admin"), db), /ADMIN_REQUIRED/);
});

test("preferences isolate each workspace and membership, including same user across organisations", async (t) => {
  const { db } = fixture(t);
  assert.equal((await server.loadPortalProfile(db, actor)).displayName, "Verified Name");
  await server.savePortalProfile(db, actor, profile);
  assert.deepEqual(await server.loadPortalProfile(db, actor), profile);
  const other = { ...actor, tenantId: "org-b", memberId: "member-b", displayName: "Other Name" };
  assert.equal((await server.loadPortalProfile(db, other)).themeKey, "emerald_navy");
  assert.equal((await server.loadPortalProfile(db, { workspace: "admin", tenantId: "operations", memberId: "admin-a", uid: "user-a", displayName: "Admin Name" })).colourMode, "day");
  await assert.rejects(server.loadPortalProfile(db, { ...actor, tenantId: "org-b" }), /PORTAL_ACCESS_CHANGED/);
});

test("personal display label never mutates authoritative compliance identity, roles or owner confirmation name", async (t) => {
  const { db, sql } = fixture(t);
  await server.savePortalProfile(db, actor, profile);
  assert.deepEqual({ ...sql.prepare("SELECT display_name,role,organisation_id FROM compliance_users WHERE id='member-a'").get() }, {
    display_name: "Verified Name", role: "admin", organisation_id: "org-a",
  });
});

test("membership revocation or organisation suspension between authentication and persistence blocks the write", async (t) => {
  const { db, sql } = fixture(t);
  await server.savePortalProfile(db, actor, profile);
  sql.exec("UPDATE compliance_users SET status='revoked' WHERE id='member-a'");
  await assert.rejects(server.savePortalProfile(db, actor, { ...profile, displayName: "After revocation" }), /PORTAL_ACCESS_CHANGED/);
  await assert.rejects(server.loadPortalProfile(db, actor), /PORTAL_ACCESS_CHANGED/);
  sql.exec("UPDATE compliance_users SET status='active' WHERE id='member-a'; UPDATE compliance_organisations SET status='suspended' WHERE id='org-a'");
  await assert.rejects(server.savePortalProfile(db, actor, profile), /PORTAL_ACCESS_CHANGED/);
  assert.equal(sql.prepare("SELECT display_name FROM portal_workspace_profiles").get().display_name, profile.displayName);
});

test("suspended administrator cannot read or change personal profile through stale identity", async (t) => {
  const { db, sql } = fixture(t);
  const admin = { workspace: "admin", tenantId: "operations", memberId: "admin-a", uid: "user-a", displayName: "Admin Name" };
  await server.savePortalProfile(db, admin, profile);
  sql.exec("UPDATE admin_users SET status='suspended' WHERE id='admin-a'");
  await assert.rejects(server.loadPortalProfile(db, admin), /PORTAL_ACCESS_CHANGED/);
  await assert.rejects(server.savePortalProfile(db, admin, profile), /PORTAL_ACCESS_CHANGED/);
});
