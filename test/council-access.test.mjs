import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { canonicalAustralianState, residentialStateFromPostcode } from "../src/lib/australian-postcodes.mjs";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../src/lib/bounded-request-body.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const compiled = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports);
  return record.exports;
}

function wrap(sqlite) {
  const calls = { batches: [], individual: [] };
  const statement = (sql, bindings = []) => ({
    sql, bindings,
    bind: (...values) => statement(sql, values),
    first: async () => { calls.individual.push(sql); return sqlite.prepare(sql).get(...bindings) || null; },
    all: async () => { calls.individual.push(sql); return { results: sqlite.prepare(sql).all(...bindings) }; },
    run: async () => { calls.individual.push(sql); return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }; },
    execute: () => {
      const query = sqlite.prepare(sql);
      return /^\s*SELECT\b/i.test(sql) ? { success: true, results: query.all(...bindings), meta: { changes: 0 } }
        : { success: true, results: [], meta: { changes: Number(query.run(...bindings).changes) } };
    },
  });
  return { prepare: statement, calls, batch: async (statements) => {
    calls.batches.push(statements.map(({ sql, bindings }) => ({ sql, bindings })));
    sqlite.exec("BEGIN");
    try { const results = statements.map(item => item.execute()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY);
    CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY, actor_uid TEXT, action TEXT, council_id TEXT, metadata TEXT);`);
  for (const statement of read("../drizzle/0250_council_workspace.sql").split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
  const db = wrap(sqlite);
  let identity = { uid: "staff-1", email: "staff@council.example", emailVerified: true, authTime: 1, signInProvider: "password" };
  let appAdmin = false;
  const auth = { requireFirebaseIdentity: async () => { if (!identity) throw new Error("AUTH_REQUIRED"); return identity; } };
  const server = load("../src/lib/council-access-server.ts", { "../../db": { getD1: () => db }, "./firebase-server": auth });
  const admin = {
    requireAdminIdentity: async (_request, roles) => { assert.deepEqual(roles, ["owner", "admin"]); if (!appAdmin) throw new Error("ADMIN_REQUIRED"); if (appAdmin === "mfa") throw new Error("MFA_REQUIRED"); return { uid: "app-admin", role: "admin" }; },
    sameOrigin: (request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin,
    adminError: (error) => Response.json({ ok: false, error: error.message }, { status: error.message === "ADMIN_REQUIRED" ? 403 : 500 }),
    adminAuditStatement: (database, actor, action, _type, councilId, _summary, metadata) => database.prepare("INSERT INTO admin_audit_log VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), actor.uid, action, councilId, JSON.stringify(metadata)),
  };
  const route = load("../src/app/api/admin/councils/route.ts", {
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": admin,
    "@/lib/council-access-server": server,
    "@/lib/australian-postcodes.mjs": { canonicalAustralianState, residentialStateFromPostcode },
    "@/lib/bounded-request-body.mjs": { readBoundedRequestText, RequestBodyTooLargeError },
  });
  const accessRoute = load("../src/app/api/council/access/route.ts", {
    "../../../../../db": { getD1: () => db }, "@/lib/firebase-server": auth,
    "@/lib/admin-server": admin, "@/lib/council-access-server": server,
  });
  function council(id = "council-1", email = "staff@council.example") {
    sqlite.prepare("INSERT INTO council_organisations VALUES (?,?,?,'VIC','active','2026-09-23','2026-09-23')").run(id, id, id);
    sqlite.prepare(`INSERT INTO council_memberships(id,council_id,email,role,status,invited_by_uid,created_at,updated_at)
      VALUES (?,?,?,'owner','active','admin','2026-09-23','2026-09-23')`).run(`member-${id}`, id, email);
    sqlite.prepare("INSERT INTO council_postcodes VALUES (?,'VIC','3175','admin','2026-09-23')").run(id);
  }
  return { sqlite, db, server, route, accessRoute, council, setIdentity: (value) => { identity = value; }, identity: () => identity, setAdmin: (value) => { appAdmin = value; }, close: () => sqlite.close() };
}

const get = (councilId = "") => new Request(`https://example.test/api/council/access${councilId ? `?councilId=${councilId}` : ""}`);
const post = (body, origin = "https://example.test") => new Request("https://example.test/api/admin/councils", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const create = { action: "create", name: "Council One", slug: "council-one", state: "VIC", postcodes: ["3175", "3977"], email: "owner@council.example" };

test("fresh schema has no demonstration accounts and enforces campaign tenant and postcode state integrity", () => {
  const f = fixture();
  try {
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_organisations").get().n, 0);
    f.council(); f.council("council-2", "other@council.example");
    assert.throws(() => f.sqlite.exec("INSERT INTO council_postcodes VALUES ('council-1','NSW','2000','admin','now')"), /FOREIGN KEY/);
    f.sqlite.exec("INSERT INTO trade_opportunities VALUES ('opportunity-1'); INSERT INTO council_campaigns (id,council_id,code,title,kind,audience,created_at,updated_at) VALUES ('campaign-1','council-1','code1','Upgrade campaign','campaign','everyone','now','now')");
    assert.throws(() => f.sqlite.exec("INSERT INTO council_attributions VALUES ('opportunity-1','campaign-1','council-2','now','explicit_referral')"), /FOREIGN KEY/);
    f.sqlite.exec("INSERT INTO council_attributions VALUES ('opportunity-1','campaign-1','council-1','now','explicit_referral')");
    assert.throws(() => f.sqlite.exec("INSERT INTO council_attributions VALUES ('opportunity-1','campaign-1','council-1','later','explicit_referral')"), /UNIQUE/);
  } finally { f.close(); }
});

test("council login requires authenticated and verified identity and a pre-existing invitation", async () => {
  const f = fixture();
  try {
    f.setIdentity(null);
    assert.equal((await f.server.requireCouncilAccess(get())).response.status, 401);
    f.setIdentity({ uid: "staff-1", email: "staff@council.example", emailVerified: false }); f.council();
    assert.equal((await f.server.requireCouncilAccess(get())).response.status, 403);
    assert.equal(f.sqlite.prepare("SELECT firebase_uid FROM council_memberships").get().firebase_uid, null);
    f.setIdentity({ uid: "unknown", email: "unknown@council.example", emailVerified: true });
    assert.equal((await f.server.requireCouncilAccess(get())).response.status, 403);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_memberships").get().n, 1);
  } finally { f.close(); }
});

test("verified invitation is claimed once, reread and cannot be rebound to another Firebase UID", async () => {
  const f = fixture();
  try {
    f.council();
    const result = await f.server.requireCouncilAccess(get());
    assert.equal(result.ok, true);
    assert.deepEqual(result.council, { id: "council-1", name: "council-1", slug: "council-1", state: "VIC", role: "owner", postcodes: ["3175"] });
    assert.equal(f.sqlite.prepare("SELECT firebase_uid FROM council_memberships").get().firebase_uid, "staff-1");
    f.setIdentity({ ...f.identity(), uid: "different-uid" });
    assert.equal((await f.server.requireCouncilAccess(get())).response.status, 403);
    assert.equal(f.sqlite.prepare("SELECT firebase_uid FROM council_memberships").get().firebase_uid, "staff-1");
  } finally { f.close(); }
});

test("membership claims and scoped reads use one ordered batch with verified identity parameters", async () => {
  const f = fixture();
  try {
    f.council("council-z"); f.council("council-a"); f.council("foreign", "other@council.example");
    f.sqlite.exec("INSERT INTO council_postcodes VALUES ('council-a','VIC','3805','admin','now'),('council-a','VIC','3000','admin','now'),('foreign','VIC','3999','admin','now')");
    const scopes = await f.server.councilMemberships(f.db, f.identity());
    assert.deepEqual(scopes.map(({ id, postcodes }) => ({ id, postcodes })), [
      { id: "council-a", postcodes: ["3000", "3175", "3805"] }, { id: "council-z", postcodes: ["3175"] },
    ]);
    assert.equal(f.db.calls.batches.length, 1);
    assert.deepEqual(f.db.calls.individual, []);
    const [claim, memberships, postcodes] = f.db.calls.batches[0];
    assert.equal(f.db.calls.batches[0].length, 3);
    assert.match(claim.sql, /^UPDATE council_memberships\b/);
    assert.match(memberships.sql, /^SELECT c\.id, c\.name, c\.slug, c\.state, m\.role/);
    assert.match(postcodes.sql, /^SELECT p\.council_id, p\.postcode/);
    assert.deepEqual(claim.bindings, ["staff-1", claim.bindings[1], claim.bindings[1], "staff@council.example", "staff-1"]);
    assert.equal(new Date(claim.bindings[1]).toISOString(), claim.bindings[1]);
    assert.deepEqual(memberships.bindings, ["staff-1"]); assert.deepEqual(postcodes.bindings, ["staff-1"]);
    assert.equal(f.sqlite.prepare("SELECT firebase_uid FROM council_memberships WHERE council_id='foreign'").get().firebase_uid, null);
    // Every fresh call still observes current authorisation rather than caching the first result.
    f.sqlite.exec("UPDATE council_memberships SET status='suspended' WHERE council_id='council-a'");
    assert.deepEqual((await f.server.councilMemberships(f.db, f.identity())).map(scope => scope.id), ["council-z"]);
    assert.equal(f.db.calls.batches.length, 2);
  } finally { f.close(); }
});

for (const [name, breakRead] of [
  ["membership", "ALTER TABLE council_organisations RENAME COLUMN name TO unavailable_name"],
  ["postcode", "DROP TABLE council_postcodes"],
]) test(`failed ${name} read rolls back the invitation claim and releases no access`, async () => {
  const f = fixture();
  try {
    f.council(); f.sqlite.exec(breakRead);
    const access = await f.server.requireCouncilAccess(get());
    assert.equal(access.ok, false); assert.equal(access.response.status, 503);
    assert.equal((await access.response.json()).code, "COUNCIL_UNAVAILABLE");
    const member = f.sqlite.prepare("SELECT firebase_uid, accepted_at FROM council_memberships").get();
    assert.equal(member.firebase_uid, null); assert.equal(member.accepted_at, null);
    assert.equal(f.db.calls.batches.length, 1);
  } finally { f.close(); }
});

for (const index of [0, 1, 2]) test(`unsuccessful batch result ${index} fails closed even when rows are present`, async () => {
  const f = fixture();
  try {
    f.council();
    const batch = f.db.batch;
    f.db.batch = async statements => {
      const results = await batch(statements); results[index].success = false; return results;
    };
    const access = await f.server.requireCouncilAccess(get());
    assert.equal(access.ok, false); assert.equal(access.response.status, 503);
    assert.equal((await access.response.json()).code, "COUNCIL_UNAVAILABLE");
  } finally { f.close(); }
});

test("an incomplete batch response fails closed", async () => {
  const f = fixture();
  try {
    f.council(); const batch = f.db.batch;
    f.db.batch = async statements => (await batch(statements)).slice(0, 2);
    const access = await f.server.requireCouncilAccess(get());
    assert.equal(access.ok, false); assert.equal(access.response.status, 503);
  } finally { f.close(); }
});

test("cross-council requests and client postcode claims do not change authoritative reporting scope", async () => {
  const f = fixture();
  try {
    f.council(); f.council("council-2", "other@council.example");
    const denied = await f.server.requireCouncilAccess(get("council-2"));
    assert.equal(denied.response.status, 403);
    assert.equal(JSON.stringify(await denied.response.json()).includes("other@"), false);
    const allowed = await f.server.requireCouncilAccess(new Request("https://example.test/api/council/report?councilId=council-1&postcodes=2000"));
    assert.deepEqual(allowed.council.postcodes, ["3175"]);
    f.sqlite.exec("UPDATE council_memberships SET role='viewer' WHERE council_id='council-1'");
    assert.equal((await f.server.requireCouncilAccess(get())).council.role, "viewer");
  } finally { f.close(); }
});

test("competing identities cannot both claim the same invited email", async () => {
  const f = fixture();
  try {
    f.council();
    const [first, second] = await Promise.all([
      f.server.councilMemberships(f.db, { ...f.identity(), uid: "first-uid" }),
      f.server.councilMemberships(f.db, { ...f.identity(), uid: "second-uid" }),
    ]);
    assert.equal(first.length + second.length, 1);
    assert.equal(f.sqlite.prepare("SELECT firebase_uid FROM council_memberships").get().firebase_uid, "first-uid");
  } finally { f.close(); }
});

test("suspended council or membership loses access immediately, and pending revoked invites stay unbound", async () => {
  const f = fixture();
  try {
    f.council();
    f.sqlite.exec("UPDATE council_memberships SET status='suspended'");
    assert.equal((await f.server.requireCouncilAccess(get())).response.status, 403);
    assert.equal(f.sqlite.prepare("SELECT firebase_uid FROM council_memberships").get().firebase_uid, null);
    f.sqlite.exec("UPDATE council_memberships SET status='active'");
    assert.equal((await f.server.requireCouncilAccess(get())).ok, true);
    f.sqlite.exec("UPDATE council_organisations SET status='suspended'");
    assert.equal((await f.server.requireCouncilAccess(get())).response.status, 403);
    f.sqlite.exec("UPDATE council_organisations SET status='active'; UPDATE council_memberships SET status='suspended'");
    assert.equal((await f.server.requireCouncilAccess(get())).response.status, 403);
  } finally { f.close(); }
});

test("multiple council memberships require explicit selection", async () => {
  const f = fixture();
  try {
    f.council(); f.council("council-2");
    const denied = await f.server.requireCouncilAccess(get());
    assert.equal((await denied.response.json()).code, "COUNCIL_SELECTION_REQUIRED");
    assert.equal((await f.server.requireCouncilAccess(get("council-2"))).council.id, "council-2");
  } finally { f.close(); }
});

test("council owner has no app admin provisioning access; real app administrators can provision without council membership", async () => {
  const f = fixture();
  try {
    f.council();
    const access = await (await f.accessRoute.GET(get())).json();
    assert.equal(access.canProvision, false); assert.equal(access.councils.length, 1);
    assert.equal((await f.route.POST(post(create))).status, 403);
    assert.equal((await f.route.GET(get())).status, 403);
    f.setAdmin(true);
    assert.equal((await (await f.accessRoute.GET(get())).json()).canProvision, true);
    assert.equal((await f.route.POST(post(create, "https://hostile.test"))).status, 403);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_organisations").get().n, 1);
  } finally { f.close(); }
});

test("admin provisioning validates state, creates only council rows, and audits every authority change", async () => {
  const f = fixture();
  try {
    f.setAdmin(true);
    assert.equal((await f.route.POST(post({ ...create, postcodes: ["2000"] }))).status, 400);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_organisations").get().n, 0);
    const response = await f.route.POST(post(create));
    assert.equal(response.status, 201);
    const { councilId } = await response.json();
    const member = f.sqlite.prepare("SELECT * FROM council_memberships").get();
    assert.equal(member.firebase_uid, null); assert.equal(member.role, "owner");
    assert.equal((await f.route.POST(post(create))).status, 409);
    assert.equal((await f.route.POST(post({ action: "member", councilId, membershipId: member.id, role: "viewer", status: "suspended" }))).status, 200);
    assert.equal((await f.route.POST(post({ action: "scope", councilId, postcodes: ["3175"] }))).status, 200);
    assert.equal((await f.route.POST(post({ action: "update", councilId, name: "New name", status: "suspended" }))).status, 200);
    assert.equal((await f.route.POST(post({ action: "invite", councilId, email: "editor@council.example", role: "editor" }))).status, 200);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_log").get().n, 5);
    const list = await (await f.route.GET(get())).json();
    assert.deepEqual(list.councils[0].postcodes, ["3175"]);
    assert.equal(list.councils[0].members.length, 2);
    assert.equal(JSON.stringify(list).includes("firebase_uid"), false);
    assert.equal(JSON.stringify(list).includes("app-admin"), false);
  } finally { f.close(); }
});

test("provisioning MFA requirement is explicit without authorising administration or blocking existing council membership", async () => {
  const f = fixture();
  try {
    f.council(); f.setAdmin("mfa");
    const response = await f.accessRoute.GET(get());
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.canProvision, false);
    assert.equal(payload.adminMfaRequired, true);
    assert.equal(payload.councils.length, 1);
    f.setAdmin(true);
    const verified = await (await f.accessRoute.GET(get())).json();
    assert.equal(verified.canProvision, true);
    assert.equal(verified.adminMfaRequired, false);
  } finally { f.close(); }
});

test("scope approval requires exact pending request ownership and updates the approval audit atomically", async () => {
  const f = fixture();
  try {
    f.setAdmin(true); f.council(); f.council("council-2", "other@council.example");
    f.sqlite.exec(`INSERT INTO council_scope_requests (id,council_id,postcodes_json,requested_by_uid,created_at)
      VALUES ('scope-1','council-1','["3977"]','staff-1','now')`);
    assert.equal((await f.route.POST(post({ action: "scope", councilId: "council-2", postcodes: ["3977"], requestId: "scope-1" }))).status, 404);
    assert.equal((await f.route.POST(post({ action: "scope", councilId: "council-1", postcodes: ["3175"], requestId: "scope-1" }))).status, 400);
    assert.equal((await f.route.POST(post({ action: "scope", councilId: "council-1", postcodes: ["3175", "3977"], requestId: "scope-1" }))).status, 200);
    const request = f.sqlite.prepare("SELECT status,reviewed_by_uid FROM council_scope_requests").get();
    assert.equal(request.status, "approved"); assert.equal(request.reviewed_by_uid, "app-admin");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_log").get().n, 1);
  } finally { f.close(); }
});

test("oversized or malformed management bodies cannot create a council", async () => {
  const f = fixture();
  try {
    f.setAdmin(true);
    assert.equal((await f.route.POST(post([]))).status, 400);
    assert.equal((await f.route.POST(post({ ...create, name: "a".repeat(17000) }))).status, 413);
    assert.equal((await f.route.POST(post({ ...create, role: "admin" }))).status, 400);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_organisations").get().n, 0);
  } finally { f.close(); }
});

test("an audit write failure rolls back council provisioning and scope changes", async () => {
  const f = fixture();
  try {
    f.setAdmin(true); f.council();
    f.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    assert.equal((await f.route.POST(post(create))).status, 500);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_organisations").get().n, 1);
    assert.equal((await f.route.POST(post({ action: "scope", councilId: "council-1", postcodes: ["3977"] }))).status, 500);
    assert.deepEqual(f.sqlite.prepare("SELECT postcode FROM council_postcodes").all().map((row) => row.postcode), ["3175"]);
  } finally { f.close(); }
});
