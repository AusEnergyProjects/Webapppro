import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { Miniflare } from "miniflare";
import * as contract from "../src/lib/council-team.ts";
import * as boundedBody from "../src/lib/bounded-request-body.mjs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const compiled = transformSync(read(path), { loader: "ts", format: "cjs", target: "es2022" }).code;
  const record = { exports: {} };
  Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports);
  return record.exports;
}
const server = load("../src/lib/council-team-server.ts", {});
const invitation = { action: "invite", email: "New.Person@Council.example", displayName: "New person", role: "viewer" };
function request(body, { councilId = "owned", origin = "https://example.test", contentType = "application/json" } = {}) {
  return new Request(`https://example.test/api/council/team?councilId=${councilId}`, { method: body === undefined ? "GET" : "POST",
    headers: { ...(origin === null ? {} : { Origin: origin }), "Content-Type": contentType },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

test("team action contract normalises invitations and rejects privilege/scope injection and oversized fields", () => {
  assert.equal(contract.parseCouncilTeamAction(invitation).email, "new.person@council.example");
  for (const change of [{ councilId: "other" }, { firebase_uid: "victim" }, { status: "active" }, { role: "owner" }, { email: "invalid" }, { email: "x\ny@domain.test" }, { email: `${"x".repeat(250)}@example.test` }, { displayName: "Name\nInjected" }, { displayName: "x".repeat(121) }, { displayName: null }]) {
    assert.throws(() => contract.parseCouncilTeamAction({ ...invitation, ...change }), contract.CouncilTeamInputError);
  }
  for (const value of [null, [], {}, { action: "delete", membershipId: "target" }, { action: "role", membershipId: "target", role: "admin" }, { action: "revoke", membershipId: "../target" }, { action: "restore", membershipId: "target", email: "other@example.test" }]) assert.throws(() => contract.parseCouncilTeamAction(value), contract.CouncilTeamInputError);
});

test("practice team supports invite, roles, revoke and restore without mutating its previous state", () => {
  const initial = contract.createCouncilDemoTeam();
  const invited = contract.applyCouncilDemoTeamAction(initial, contract.parseCouncilTeamAction(invitation));
  assert.equal(initial.members.length, 3); assert.equal(invited.members.length, 4);
  const target = invited.members.at(-1); assert.equal(target.pending, true);
  const promoted = contract.applyCouncilDemoTeamAction(invited, { action: "role", membershipId: target.id, role: "editor" });
  assert.equal(promoted.members.at(-1).role, "editor");
  const revoked = contract.applyCouncilDemoTeamAction(promoted, { action: "revoke", membershipId: target.id });
  assert.equal(revoked.members.at(-1).status, "suspended");
  assert.equal(contract.applyCouncilDemoTeamAction(revoked, { action: "restore", membershipId: target.id }).members.at(-1).status, "active");
  assert.throws(() => contract.applyCouncilDemoTeamAction(initial, { action: "revoke", membershipId: "demo-owner" }), /another owner/);
  assert.throws(() => contract.applyCouncilDemoTeamAction(invited, contract.parseCouncilTeamAction(invitation)), /already/);
});

test("council team routes and atomic permissions execute against Cloudflare D1", async t => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2025-04-01", d1Databases: { DB: "council-team-regression" }, port: 0 });
  try {
    const db = await runtime.getD1Database("DB");
    await db.prepare("CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY)").run();
    await db.prepare("CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,admin_uid TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,summary TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL)").run();
    for (const statement of read("../drizzle/0250_council_workspace.sql").split("--> statement-breakpoint")) if (statement.trim()) await db.prepare(statement).run();
    let identity;
    let beforeBatch;
    const wrapped = { prepare: sql => db.prepare(sql), batch: async statements => {
      if (beforeBatch) { const effect = beforeBatch; beforeBatch = undefined; await effect(); }
      return db.batch(statements);
    } };
    const access = load("../src/lib/council-access-server.ts", {
      "../../db": { getD1: () => wrapped }, "./firebase-server": { requireFirebaseIdentity: async () => { if (!identity) throw new Error("AUTH_REQUIRED"); return identity; } },
    });
    const route = load("../src/app/api/council/team/route.ts", {
      "@/lib/council-access-server": access, "@/lib/council-team": contract, "@/lib/council-team-server": server,
      "@/lib/bounded-request-body.mjs": boundedBody,
    });
    const reset = async () => {
      beforeBatch = undefined; identity = { uid: "owner-uid", email: "owner@council.example", emailVerified: true };
      await db.batch(["council_memberships", "council_organisations", "admin_audit_log"].map(table => db.prepare(`DELETE FROM ${table}`)));
      await db.batch([
        db.prepare("INSERT INTO council_organisations(id,name,slug,state,status,created_at,updated_at) VALUES ('owned','Our council','our-council','VIC','active','2026-10-05','2026-10-05'),('other','Other council','other-council','VIC','active','2026-10-05','2026-10-05')"),
        db.prepare(`INSERT INTO council_memberships(id,council_id,firebase_uid,email,display_name,role,status,invited_by_uid,accepted_at,created_at,updated_at) VALUES
          ('owner','owned','owner-uid','owner@council.example','Owner','owner','active','admin','2026-10-05','2026-10-05','2026-10-05'),
          ('editor','owned','editor-uid','editor@council.example','Editor','editor','active','admin','2026-10-05','2026-10-05','2026-10-05'),
          ('viewer','owned',NULL,'viewer@council.example','Viewer','viewer','active','admin',NULL,'2026-10-05','2026-10-05'),
          ('outsider','other','other-uid','other@council.example','Other','owner','active','admin','2026-10-05','2026-10-05','2026-10-05')`),
      ]);
    };
    const auditCount = async () => (await db.prepare("SELECT COUNT(*) n FROM admin_audit_log").first()).n;
    const member = id => db.prepare("SELECT * FROM council_memberships WHERE id=?").bind(id).first();
    const post = input => route.POST(request(input));

    await t.test("roster is tenant scoped, uncacheable and does not return Firebase UIDs", async () => {
      await reset();
      const response = await route.GET(request()); assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("Vary"), "Authorization");
      const text = await response.text(); const team = JSON.parse(text).team;
      assert.equal(team.members.length, 3); assert.equal(team.canManage, true); assert.equal(team.invitationPath, "/council");
      assert.equal(team.members.find(item => item.id === "owner").isSelf, true);
      assert.equal(team.members.find(item => item.id === "viewer").pending, true);
      assert.doesNotMatch(text, /owner-uid|editor-uid|other@council/);
      assert.equal((await route.GET(request(undefined, { councilId: "other" }))).status, 403);
    });

    await t.test("owner invitation is email-bound and audit is committed with its pending membership", async () => {
      await reset();
      const response = await post(invitation); assert.equal(response.status, 200, await response.clone().text());
      const created = (await response.json()).team.members.find(item => item.email === "new.person@council.example");
      assert.equal(created.pending, true); assert.equal(created.role, "viewer"); assert.equal(created.acceptedAt, null);
      const stored = await member(created.id); assert.equal(stored.firebase_uid, null); assert.equal(stored.invited_by_uid, "owner-uid");
      const audit = await db.prepare("SELECT * FROM admin_audit_log").first();
      assert.equal(audit.admin_uid, "owner-uid"); assert.equal(audit.entity_id, "owned"); assert.equal(audit.action, "council.member_invited");
      assert.equal(JSON.parse(audit.metadata).memberId, created.id);
      assert.equal((await post(invitation)).status, 409); assert.equal(await auditCount(), 1);
      identity = { uid: "new-uid", email: "new.person@council.example", emailVerified: false };
      assert.equal((await route.GET(request())).status, 403); assert.equal((await member(created.id)).firebase_uid, null);
      identity.emailVerified = true; assert.equal((await route.GET(request())).status, 200);
      assert.equal((await member(created.id)).firebase_uid, "new-uid"); assert.ok((await member(created.id)).accepted_at);
    });

    await t.test("authentication and active verified owner role are required for writes", async () => {
      await reset(); identity = null; assert.equal((await route.GET(request())).status, 401);
      for (const [uid, email] of [["editor-uid", "editor@council.example"], ["viewer-uid", "viewer@council.example"]]) {
        identity = { uid, email, emailVerified: true };
        const response = await route.GET(request()); assert.equal(response.status, 200); assert.equal((await response.json()).team.canManage, false);
        assert.equal((await post(invitation)).status, 403);
      }
      identity = { uid: "owner-uid", email: "owner@council.example", emailVerified: true };
      await db.prepare("UPDATE council_memberships SET status='suspended' WHERE id='owner'").run();
      assert.equal((await post(invitation)).status, 403); assert.equal(await auditCount(), 0);
    });

    await t.test("role update, revoke and restore preserve identity and previous-state audit", async () => {
      await reset();
      assert.equal((await post({ action: "role", membershipId: "editor", role: "owner" })).status, 200);
      assert.equal((await member("editor")).role, "owner");
      assert.equal((await post({ action: "revoke", membershipId: "editor" })).status, 200);
      assert.equal((await member("editor")).status, "suspended"); assert.equal((await member("editor")).firebase_uid, "editor-uid");
      assert.equal((await post({ action: "restore", membershipId: "editor" })).status, 200);
      assert.equal((await member("editor")).status, "active"); assert.equal(await auditCount(), 3);
      const rows = (await db.prepare("SELECT metadata FROM admin_audit_log ORDER BY created_at").all()).results.map(row => JSON.parse(row.metadata));
      assert.ok(rows.some(row => row.before.role === "editor" && row.after.role === "owner"));
      assert.ok(rows.some(row => row.before.status === "active" && row.after.status === "suspended"));
    });

    await t.test("self changes, cross-council targets and repeated no-op changes produce no audit or mutation", async () => {
      await reset();
      for (const action of [{ action: "role", membershipId: "owner", role: "viewer" }, { action: "revoke", membershipId: "owner" }, { action: "role", membershipId: "outsider", role: "viewer" }, { action: "revoke", membershipId: "outsider" }, { action: "role", membershipId: "editor", role: "editor" }]) assert.equal((await post(action)).status, 409);
      assert.equal((await member("owner")).role, "owner"); assert.equal((await member("outsider")).status, "active"); assert.equal(await auditCount(), 0);
    });

    await t.test("revoked invitations cannot be accepted or re-created by sharing the link", async () => {
      await reset(); assert.equal((await post({ action: "revoke", membershipId: "viewer" })).status, 200);
      identity = { uid: "viewer-uid", email: "viewer@council.example", emailVerified: true };
      assert.equal((await route.GET(request())).status, 403); assert.equal((await member("viewer")).firebase_uid, null);
      identity = { uid: "uninvited", email: "uninvited@council.example", emailVerified: true };
      assert.equal((await route.GET(request())).status, 403);
    });

    await t.test("owner downgrade, revocation or council suspension between auth and batch fails closed", async () => {
      for (const sql of ["UPDATE council_memberships SET role='editor' WHERE id='owner'", "UPDATE council_memberships SET status='suspended' WHERE id='owner'", "UPDATE council_organisations SET status='suspended' WHERE id='owned'"]) {
        await reset(); beforeBatch = () => db.prepare(sql).run();
        assert.equal((await post(invitation)).status, 403);
        assert.equal((await db.prepare("SELECT COUNT(*) n FROM council_memberships").first()).n, 4); assert.equal(await auditCount(), 0);
      }
    });

    await t.test("competing owners cannot remove each other and leave no accepted owner", async () => {
      await reset(); await db.prepare("UPDATE council_memberships SET role='owner' WHERE id='editor'").run();
      const results = await Promise.all([
        server.changeCouncilTeam(db, "owned", "owner-uid", { action: "revoke", membershipId: "editor" }),
        server.changeCouncilTeam(db, "owned", "editor-uid", { action: "revoke", membershipId: "owner" }),
      ]);
      assert.equal(results.filter(result => result.ok).length, 1);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM council_memberships WHERE council_id='owned' AND role='owner' AND status='active' AND firebase_uid IS NOT NULL").first()).n, 1);
      assert.equal(await auditCount(), 1);
    });

    await t.test("audit and membership rollback together when the mutation fails", async () => {
      await reset();
      await db.prepare("CREATE TRIGGER reject_team_invite BEFORE INSERT ON council_memberships WHEN NEW.email='new.person@council.example' BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
      try { assert.equal((await post(invitation)).status, 503); assert.equal(await auditCount(), 0); assert.equal((await db.prepare("SELECT COUNT(*) n FROM council_memberships").first()).n, 4); }
      finally { await db.prepare("DROP TRIGGER reject_team_invite").run(); }
    });

    await t.test("same-origin, JSON and size boundaries reject malformed writes", async () => {
      await reset();
      for (const origin of [null, "https://hostile.test"]) assert.equal((await route.POST(request(invitation, { origin }))).status, 403);
      assert.equal((await route.GET(request(undefined, { origin: "https://hostile.test" }))).status, 403);
      assert.equal((await route.POST(request(invitation, { contentType: "text/plain" }))).status, 415);
      assert.equal((await post("{" )).status, 400);
      assert.equal((await post("x".repeat(contract.COUNCIL_TEAM_MAX_BODY_BYTES + 1))).status, 413);
      assert.equal((await post({ ...invitation, councilId: "other" })).status, 400);
      assert.equal((await post({ ...invitation, role: "owner" })).status, 400);
      assert.equal(await auditCount(), 0);
    });
  } finally { await runtime.dispose(); }
});
