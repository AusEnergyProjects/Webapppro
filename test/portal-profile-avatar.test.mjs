import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
function load(name, dependencies = {}) {
  const output = ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  Function("require", "module", "exports", output)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, result, result.exports);
  return result.exports;
}
const branding = load("src/lib/trade-business-branding.ts");
const profile = load("src/lib/portal-workspace-profile.ts", { "./trade-business-branding": branding });
const profiles = load("src/lib/portal-workspace-profile-server.ts", { "./portal-workspace-profile": profile, "./admin-server": {}, "./compliance-access-server": {} });
const image = load("src/lib/private-image-evidence.ts");
const media = load("src/lib/trade-message-media.ts", { "./private-image-evidence": image });
const permissions = load("src/lib/creditex-permissions.ts");
const api = load("src/lib/portal-profile-avatar-server.ts", { "./portal-workspace-profile-server": profiles, "./trade-message-media": media, "./creditex-permissions": permissions });
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW3sAAAAASUVORK5CYII=", "base64"));
const actor = (workspace = "creditex", memberId = "a", tenantId = workspace === "admin" ? "operations" : "org-a") => ({ workspace, tenantId, memberId, uid: `uid-${memberId}`, displayName: `Member ${memberId}` });
function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec(`CREATE TABLE compliance_users(id TEXT PRIMARY KEY,organisation_id TEXT,firebase_uid TEXT,status TEXT,display_name TEXT,role TEXT,permissions_json TEXT);
    CREATE TABLE compliance_organisations(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE admin_users(id TEXT PRIMARY KEY,firebase_uid TEXT,status TEXT,display_name TEXT,role TEXT);
    INSERT INTO compliance_organisations VALUES('org-a','active'),('org-b','active');
    INSERT INTO compliance_users VALUES('a','org-a','uid-a','active','Member a','admin',NULL),('b','org-a','uid-b','active','Member b','reviewer',NULL),('foreign','org-b','uid-foreign','active','Foreign','admin',NULL);
    INSERT INTO admin_users VALUES('a','uid-a','active','Admin a','admin'),('b','uid-b','active','Admin b','reviewer');`);
  sql.exec(read("drizzle/0238_portal_workspace_profiles.sql")); sql.exec(read("drizzle/0240_portal_profile_avatars.sql"));
  let beforeWrite;
  const statement = (query, values = []) => ({ bind: (...next) => statement(query, next), first: async () => sql.prepare(query).get(...values) || null,
    run: async () => { if (beforeWrite) { const action = beforeWrite; beforeWrite = null; action(); } return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; } });
  const stored = new Map();
  const bucket = { put: async (key, value) => stored.set(key, value), get: async key => stored.has(key) ? { body: stored.get(key) } : null, delete: async key => stored.delete(key) };
  return { sql, db: { prepare: statement }, bucket, stored, beforeWrite: action => { beforeWrite = action; } };
}
const upload = (f, who = actor(), bytes = png, contentType = "image/png") => api.savePortalAvatar(f.db, f.bucket, who, { bytes, contentType });

test("portal photos are private to active members of the exact workspace and organisation", async t => {
  const f = fixture(t), saved = await upload(f);
  assert.equal((await api.readPortalAvatar(f.db, actor("creditex", "b"), "a")).avatar_revision, saved.revision);
  assert.equal(await api.readPortalAvatar(f.db, actor("creditex", "foreign", "org-b"), "a"), null);
  assert.equal(await api.readPortalAvatar(f.db, actor("admin", "b"), "a"), null);
  assert.equal(await api.readPortalAvatar(f.db, { ...actor(), uid: "wrong" }), null);
  f.sql.exec("UPDATE compliance_users SET permissions_json='[]' WHERE id='b'");
  assert.equal(await api.readPortalAvatar(f.db, actor("creditex", "b"), "a"), null);
  f.sql.exec("UPDATE compliance_users SET status='revoked' WHERE id='a'");
  assert.equal(await api.readPortalAvatar(f.db, actor(), "a"), null);
  assert.equal(await api.readPortalAvatar(f.db, actor("creditex", "b"), "a"), null);
});

for (const workspace of ["admin", "creditex"]) test(`${workspace} photo replacement removes old bytes and preserves personal settings and authoritative identity`, async t => {
  const f = fixture(t), who = actor(workspace);
  const preferences = { displayName: "Preferred", themeKey: "violet_sunset", colourMode: "night" };
  await profiles.savePortalProfile(f.db, who, preferences);
  const first = await upload(f, who), second = await upload(f, who);
  assert.notEqual(first.revision, second.revision); assert.equal(f.stored.size, 1);
  assert.equal(await api.readPortalAvatar(f.db, who, "a", first.revision), null);
  assert.deepEqual(await profiles.loadPortalProfile(f.db, who), preferences);
  await profiles.savePortalProfile(f.db, who, { ...preferences, colourMode: "day" });
  assert.equal((await api.readPortalAvatar(f.db, who)).avatar_revision, second.revision);
  assert.equal(f.sql.prepare(`SELECT display_name FROM ${workspace === "admin" ? "admin_users" : "compliance_users"} WHERE id='a'`).get().display_name, workspace === "admin" ? "Admin a" : "Member a");
  await assert.rejects(api.removePortalAvatar(f.db, f.bucket, who, first.revision), /changed/);
  await api.removePortalAvatar(f.db, f.bucket, who, second.revision);
  assert.equal(f.stored.size, 0); assert.equal((await api.readPortalAvatar(f.db, who)).avatar_revision, "");
});

test("revocation during upload aborts persistence and removes the newly staged private photo", async t => {
  const f = fixture(t);
  f.beforeWrite(() => f.sql.exec("UPDATE compliance_users SET status='revoked' WHERE id='a'"));
  await assert.rejects(upload(f), /access changed/);
  assert.equal(f.stored.size, 0); assert.equal(f.sql.prepare("SELECT count(*) total FROM portal_workspace_profiles").get().total, 0);
});

test("concurrent photo replacement rejects stale writers without deleting the newer photo", async t => {
  const f = fixture(t); await upload(f);
  f.beforeWrite(() => f.sql.exec("UPDATE portal_workspace_profiles SET avatar_revision='newer' WHERE member_id='a'"));
  await assert.rejects(upload(f), /changed/);
  assert.equal(f.stored.size, 1);
  assert.equal(f.sql.prepare("SELECT avatar_revision FROM portal_workspace_profiles").get().avatar_revision, "newer");
});

test("photos validate actual bytes, reject remote URLs and oversized request streams", async t => {
  const f = fixture(t);
  for (const [bytes, type] of [[new TextEncoder().encode("https://tracker.invalid/me.png"), "image/png"], [png, "image/svg+xml"], [new Uint8Array(3 * 1024 * 1024 + 1), "image/png"]]) await assert.rejects(upload(f, actor(), bytes, type), /valid JPEG or PNG/);
  assert.equal(f.stored.size, 0);
  const request = new Request("https://example.invalid", { method: "POST", body: new Uint8Array(3 * 1024 * 1024 + 1), duplex: "half" });
  await assert.rejects(api.readPortalAvatarUpload(request), error => error.status === 413);
  assert.deepEqual(await api.readPortalAvatarUpload(new Request("https://example.invalid", { method: "POST", body: png })), png);
});

test("avatar route rejects cross-origin writes and rechecks access after retrieving private storage", async t => {
  const f = fixture(t); let accesses = 0, denied = false;
  const route = load("src/app/api/portal-profile-avatar/route.ts", {
    "../../../../db": { getD1: () => f.db },
    "@/lib/admin-server": { sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin,
      adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } }), mfaErrorResponse: () => null, adminError: () => Response.json({ ok: false }, { status: 401 }) },
    "@/lib/compliance-access-server": { ComplianceAccessError: class extends Error {} },
    "@/lib/customer-project-evidence-bucket": { getCustomerProjectEvidenceBucket: () => f.bucket },
    "@/lib/portal-workspace-profile-server": { ...profiles, requirePortalProfileActor: async () => { accesses++; if (denied) throw Error("AUTH_REQUIRED"); return actor(); } },
    "@/lib/portal-profile-avatar-server": api,
  });
  const base = "https://example.invalid/api/portal-profile-avatar?workspace=creditex";
  assert.equal((await route.POST(new Request(base, { method: "POST", headers: { origin: "https://foreign.invalid" }, body: png }))).status, 403);
  assert.equal(accesses, 0);
  denied = true; assert.equal((await route.GET(new Request(`${base}&metadata=1`))).status, 401); denied = false;
  const saved = await route.POST(new Request(`${base}&memberId=foreign`, { method: "POST", headers: { "content-type": "image/png" }, body: png }));
  assert.equal(saved.status, 200); assert.equal((await saved.json()).memberId, "a", "client member claims cannot target another member");
  const metadata = await (await route.GET(new Request(`${base}&metadata=1`))).json();
  assert.ok(metadata.revision); assert.equal("avatar_object_key" in metadata, false);
  const imageResponse = await route.GET(new Request(`${base}&memberId=a&revision=${metadata.revision}`));
  assert.equal(imageResponse.status, 200); assert.equal(imageResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(imageResponse.headers.get("x-content-type-options"), "nosniff");
  const originalGet = f.bucket.get;
  f.bucket.get = async key => { const result = await originalGet(key); f.sql.exec("UPDATE compliance_users SET status='revoked' WHERE id='a'"); return result; };
  assert.equal((await route.GET(new Request(`${base}&memberId=a&revision=${metadata.revision}`))).status, 404);
});
