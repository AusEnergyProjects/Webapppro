import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { certificateTestDependency } from "./helpers/creditex-training-fixture.mjs";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import { canViewLeads, canManageLeads } from "../src/lib/trade-team-permission-policy.mjs";

function load(path, dependencies) {
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path,
  }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    const value = dependencies[name] || certificateTestDependency(name);
    if (!value) throw new Error(`Unmocked lead dependency: ${name}`);
    return value;
  }, record, record.exports);
  return record.exports;
}
const leadAccess = load("src/lib/trade-lead-access-server.ts", {});

function fixture(t) {
  const { sqlite } = migratedDataforceSqlite();
  t.after(() => sqlite.close());
  const now = new Date().toISOString();
  const insert = (table, input) => {
    const values = {};
    for (const column of sqlite.prepare(`PRAGMA table_info(${table})`).all()) {
      if (column.notnull && column.dflt_value === null) values[column.name] = /INT/i.test(column.type) ? 0 : "";
    }
    Object.assign(values, input);
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`)
      .run(...Object.values(values));
  };
  insert("trade_accounts", { firebase_uid: "owner", email: "owner@example.test", business_name: "Business", abn: "53004085616",
    partner_type: "installer", account_status: "active", verification_status: "approved", verified_abn: "53004085616",
    verification_review_id: "review", verification_reviewed_by_uid: "reviewer", verification_reviewed_at: now, created_at: now, updated_at: now });
  insert("trade_account_verification_reviews", { id: "review", firebase_uid: "owner", abn: "53004085616", business_name: "Business",
    partner_type: "installer", decision: "approved", review_method: "official_abr_lookup", reviewed_by_uid: "reviewer", reviewed_at: now });
  insert("trade_team_members", { id: "owner-member", owner_uid: "owner", member_uid: "owner", email: "owner@example.test", status: "active", created_at: now, updated_at: now });
  insert("trade_team_members", { id: "staff", owner_uid: "owner", member_uid: "staff-uid", email: "staff@example.test", status: "active",
    can_view_leads: 1, can_manage_leads: 1, can_create_jobs: 1, can_manage_jobs: 1, can_view_quotes: 1, can_manage_quotes: 1, can_send_quotes: 1,
    job_scope: "team", schedule_scope: "team", created_at: now, updated_at: now });
  sqlite.exec("CREATE TABLE test_lead_mutations (id text PRIMARY KEY NOT NULL, owner_uid text NOT NULL)");
  let beforeBatch;
  function statement(sql, values = []) {
    return { bind: (...bound) => statement(sql, bound),
      first: async () => sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
      runSync: () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }) };
  }
  const db = { prepare: statement, batch: async statements => {
    beforeBatch?.(); sqlite.exec("BEGIN");
    try { const results = statements.map(value => value.runSync()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const staff = { ownerUid: "owner", actorUid: "staff-uid", memberId: "staff", isOwner: false,
    canViewLeads: true, canManageLeads: true, jobScope: "team", canCreateJobs: true, canViewQuotes: true, canManageQuotes: true };
  return { sqlite, db, insert, staff, setBeforeBatch: callback => { beforeBatch = callback; } };
}

test("Lead grants preserve explicit view versus manage access and reject crew or field logins", () => {
  const view = { isOwner: false, canViewLeads: true, canManageLeads: false };
  assert.equal(canViewLeads(view), true); assert.equal(canManageLeads(view), false);
  assert.equal(canViewLeads({ ...view, canViewLeads: false }), false);
  assert.equal(canManageLeads({ ...view, canManageLeads: true }), true);
  for (const restriction of [{ crewId: "crew" }, { fieldSessionId: "session" }]) {
    assert.equal(canViewLeads({ ...view, ...restriction }), false);
    assert.equal(canManageLeads({ ...view, canManageLeads: true, ...restriction }), false);
  }
});

test("current lead authorization binds actual actor, selected business, current grants and authoritative approval", async t => {
  const f = fixture(t);
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff), true);
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, { ...f.staff, ownerUid: "foreign-business" }), false);
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, { ...f.staff, actorUid: "other-staff" }), false);
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, { ...f.staff, memberId: "other-member" }), false);
  f.sqlite.exec("UPDATE trade_team_members SET can_manage_leads=0 WHERE id='staff'");
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff, "view"), true);
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff, "manage"), false);
  f.sqlite.exec("UPDATE trade_team_members SET can_view_leads=0 WHERE id='staff'");
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff), false);
  f.sqlite.exec("UPDATE trade_team_members SET can_view_leads=1,can_manage_leads=1,status='suspended' WHERE id='staff'");
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff), false);
  f.sqlite.exec("UPDATE trade_team_members SET status='active' WHERE id='staff'; UPDATE trade_accounts SET account_status='suspended'");
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff), false);
  f.sqlite.exec("UPDATE trade_accounts SET account_status='active',verification_status='rejected'");
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff), false);
});

test("lead mutations roll back when staff is revoked or moved into a crew during asynchronous work", async t => {
  const f = fixture(t);
  for (const mutation of ["UPDATE trade_team_members SET can_manage_leads=0 WHERE id='staff'", "UPDATE trade_team_members SET status='suspended' WHERE id='staff'"]) {
    f.sqlite.exec("UPDATE trade_team_members SET can_view_leads=1,can_manage_leads=1,status='active' WHERE id='staff'");
    assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff, "manage"), true);
    f.setBeforeBatch(() => f.sqlite.exec(mutation));
    await assert.rejects(leadAccess.guardedTradeLeadMutationBatch(f.db, f.staff, "manage", [f.db.prepare("INSERT INTO test_lead_mutations VALUES ('mutation','owner')")]), /verified/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM test_lead_mutations").get().n, 0);
  }
  f.setBeforeBatch(undefined);
  f.sqlite.exec("UPDATE trade_team_members SET can_view_leads=1,can_manage_leads=1,status='active' WHERE id='staff'");
  f.insert("trade_crews", { id: "crew", owner_uid: "owner", name: "Crew", lead_member_id: "staff", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  f.insert("trade_crew_members", { owner_uid: "owner", crew_id: "crew", member_id: "staff", created_at: new Date().toISOString() });
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff, "manage"), false);
});

test("quote, handoff and arrival guards recheck their separate permission and team scopes", async t => {
  const f = fixture(t);
  for (const action of ["quote", "quote_products", "public_quote", "arrival", "conversion"]) assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff, action), true);
  f.sqlite.exec("UPDATE trade_team_members SET can_send_quotes=0 WHERE id='staff'");
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff, "quote"), false);
  assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff, "public_quote"), true);
  f.sqlite.exec("UPDATE trade_team_members SET can_send_quotes=1,job_scope='own' WHERE id='staff'");
  for (const action of ["public_quote", "arrival", "conversion"]) assert.equal(await leadAccess.currentTradeLeadAccess(f.db, f.staff, action), false);
  f.sqlite.exec("UPDATE trade_team_members SET job_scope='team' WHERE id='staff'");
  f.setBeforeBatch(() => f.sqlite.exec("UPDATE trade_team_members SET can_send_quotes=0 WHERE id='staff'"));
  await assert.rejects(leadAccess.guardedTradeLeadMutationBatch(f.db, f.staff, "quote", [f.db.prepare("INSERT INTO test_lead_mutations VALUES ('quote','owner')")]), /verified/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM test_lead_mutations").get().n, 0);
});

test("only the saved highest office permission bundle is backfilled, independent of role labels", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE trade_team_members (id text PRIMARY KEY NOT NULL,owner_uid text,member_uid text,status text,role text,
      can_manage_team integer,can_edit_team_permissions integer,job_scope text,schedule_scope text,can_manage_jobs integer,
      can_view_customers integer,can_view_quotes integer,can_manage_quotes integer,updated_at text NOT NULL DEFAULT '2026-10-12T00:00:00.000Z');
      CREATE TABLE trade_crew_members(owner_uid text,member_id text);
      CREATE TABLE public_trade_lead_quote_photo_events(id text); CREATE TABLE trade_work_order_events(id text);`);
    const insert = db.prepare("INSERT INTO trade_team_members (id,owner_uid,member_uid,status,role,can_manage_team,can_edit_team_permissions,job_scope,schedule_scope,can_manage_jobs,can_view_customers,can_view_quotes,can_manage_quotes) VALUES (?,?,?,'active',?,1,1,'team','team',1,1,1,1)");
    for (const id of ["full-office", "custom-limited", "suspended", "crew"]) insert.run(id, "owner", `uid-${id}`, "field");
    insert.run("owner", "owner", "owner", "manager");
    db.exec("UPDATE trade_team_members SET can_view_customers=0 WHERE id='custom-limited'; UPDATE trade_team_members SET status='suspended' WHERE id='suspended'; INSERT INTO trade_crew_members VALUES ('owner','crew')");
    const migration = fs.readFileSync(new URL("../drizzle/0261_trade_team_leads_access.sql", import.meta.url), "utf8");
    for (const sql of migration.split("--> statement-breakpoint")) if (sql.trim()) db.exec(sql);
    for (const id of ["owner", "full-office"]) assert.equal(db.prepare("SELECT can_manage_leads FROM trade_team_members WHERE id=?").get(id).can_manage_leads, 1);
    for (const id of ["custom-limited", "suspended", "crew"]) assert.equal(db.prepare("SELECT can_view_leads FROM trade_team_members WHERE id=?").get(id).can_view_leads, 0);
    for (const id of ["owner", "full-office"]) assert.notEqual(db.prepare("SELECT updated_at FROM trade_team_members WHERE id=?").get(id).updated_at, "2026-10-12T00:00:00.000Z");
    for (const id of ["custom-limited", "suspended", "crew"]) assert.equal(db.prepare("SELECT updated_at FROM trade_team_members WHERE id=?").get(id).updated_at, "2026-10-12T00:00:00.000Z");
    assert.equal(Number(db.prepare("UPDATE trade_team_members SET can_view_leads=0,can_manage_leads=0 WHERE id='full-office' AND updated_at='2026-10-12T00:00:00.000Z'").run().changes), 0,
      "a stale permission editor cannot erase a migrated grant");
    assert.throws(() => db.exec("UPDATE trade_team_members SET can_manage_leads=1 WHERE id='custom-limited'"), /invalid team lead permissions/);
    assert.throws(() => db.exec("UPDATE trade_team_members SET can_view_leads=2 WHERE id='custom-limited'"), /invalid team lead permissions/);
  } finally { db.close(); }
});

test("staff quote product reads use the selected business and recheck quote access before serialization", async t => {
  const f = fixture(t);
  f.insert("installer_product_lists", { id: "owned-list", firebase_uid: "owner", name: "Business list", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  f.insert("installer_product_lists", { id: "foreign-list", firebase_uid: "foreign-business", name: "Foreign list", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  let access = { ...f.staff };
  let revoke = false;
  const route = load("src/app/api/product-selections/route.ts", {
    "../../../../db": { getD1: () => f.db },
    "@/lib/admin-server": { sameOrigin: () => true, adminJson: (value, status = 200) => Response.json(value, { status }), mfaErrorResponse: () => null },
    "@/lib/admin-notifications": {},
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access, canManageLeads },
    "@/lib/trade-lead-access-server": { ...leadAccess, currentTradeLeadAccess: async (...args) => {
      if (revoke) f.sqlite.exec("UPDATE trade_team_members SET can_send_quotes=0,can_manage_quotes=0 WHERE id='staff'");
      return leadAccess.currentTradeLeadAccess(...args);
    } },
  });
  const request = new Request("https://test/api/product-selections");
  const response = await route.GET(request); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).lists.map(value => value.id), ["owned-list"]);
  access = { ...f.staff, canManageLeads: false }; assert.equal((await route.GET(request)).status, 403);
  access = { ...f.staff, ownerUid: "foreign-business" }; assert.equal((await route.GET(request)).status, 403);
  access = { ...f.staff }; revoke = true; assert.equal((await route.GET(request)).status, 403);
});
