import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { Miniflare } from "miniflare";
import * as routing from "../src/lib/aea-trade-routing.mjs";
import * as consent from "../src/lib/public-plan-enquiry.mjs";
import * as postcodes from "../src/lib/australian-postcodes.mjs";
import * as services from "../src/lib/energy-service-catalogue.mjs";
import { certificateTestDependency, installOpportunityConsentFixtureSchema, installVerifiedTradeLeadFixture } from "./helpers/creditex-training-fixture.mjs";

const routeSource = fs.readFileSync(new URL("../src/app/api/admin/opportunities/route.ts", import.meta.url), "utf8");
const matchesSource = fs.readFileSync(new URL("../src/app/api/admin/opportunities/matches/route.ts", import.meta.url), "utf8");
const now = "2026-10-04T02:00:00.000Z";

function harness() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE trade_opportunities (
    id TEXT PRIMARY KEY, title TEXT, project_type TEXT, postcode TEXT, state TEXT, service_categories TEXT,
    priority TEXT, timing TEXT, summary TEXT, status TEXT, source_reference TEXT, contact_limit INTEGER,
    maximum_connected_installers INTEGER, is_synthetic INTEGER, expires_at TEXT, expired_at TEXT,
    created_by_uid TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_name TEXT, partner_type TEXT,
      capabilities TEXT, service_states TEXT, address_state TEXT, postcode TEXT, service_base_postcode TEXT,
      service_radius_km INTEGER, availability_status TEXT);
    CREATE TABLE trade_account_service_areas (firebase_uid TEXT, postcode TEXT, radius_km INTEGER, record_status TEXT);
    CREATE TABLE trade_opportunity_matches (id TEXT PRIMARY KEY, opportunity_id TEXT, firebase_uid TEXT, status TEXT,
      admin_note TEXT, partner_note TEXT, matched_categories TEXT, distance_metres INTEGER, allocation_rank INTEGER,
      match_source TEXT, contact_attempt_count INTEGER, last_contact_at TEXT, connected_at TEXT,
      matched_by_uid TEXT, matched_at TEXT, updated_at TEXT, UNIQUE(opportunity_id, firebase_uid));
    CREATE TABLE trade_opportunity_notification_deliveries (match_id TEXT, status TEXT, sent_at TEXT, delivered_at TEXT);
    INSERT INTO trade_opportunities VALUES
      ('current','Assessment and solar','Home','3000','VIC','["assessment","solar"]','standard','planning','Scope','open','ref-current',10,3,0,'2099-01-01','','admin','${now}','${now}'),
      ('other','Other household','Home','3000','VIC','["assessment","solar"]','standard','planning','Other','open','ref-other',10,3,0,'2099-01-01','','admin','${now}','${now}');
    INSERT INTO trade_accounts VALUES
      ('solar-trade','Solar Pty Ltd','installer','["solar"]','["VIC"]','VIC','3000','3000',30,'open'),
      ('other-trade','Other Pty Ltd','installer','["solar"]','["VIC"]','VIC','3000','3000',30,'open');`);
  installOpportunityConsentFixtureSchema(sqlite);
  installVerifiedTradeLeadFixture(sqlite);
  sqlite.prepare(`INSERT INTO public_trade_lead_contact_releases
    (id, opportunity_id, source_reference, postcode, status, withdrawn_at, granted_at, notice_version, consent_purpose, disclosed_fields, customer_email)
    VALUES ('release-current','current','ref-current','3000','active','',?,?,?,?, 'customer@example.test')`)
    .run(now, consent.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, consent.PUBLIC_PLAN_CONSENT_PURPOSE,
      JSON.stringify(["customer_email", "postcode", "service_categories"]));
  const sideEffects = [];
  let beforeWrite;
  const d1 = {
    prepare(sql) {
      const statement = values => ({
        bind: (...next) => statement(next),
        first: async () => sqlite.prepare(sql).get(...values) || null,
        all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
        run: async () => {
          if (beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; hook(sql); }
          const result = sqlite.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      });
      return statement([]);
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
  const json = (payload, status = 200) => Response.json(payload, { status });
  const dependencies = {
    db: { getD1: () => d1 },
    "aea-trade-routing.mjs": routing,
    "public-plan-enquiry.mjs": consent,
    "australian-postcodes.mjs": postcodes,
    "energy-service-catalogue.mjs": services,
    "admin-server": { sameOrigin: () => true, requireAdminIdentity: async () => ({ uid: "admin", role: "owner" }),
      adminJson: json, adminError: error => { throw error; }, cleanAdminText: value => String(value || "").trim(),
      parseJsonList: value => JSON.parse(value || "[]"), writeAdminAudit: async (...args) => sideEffects.push(["audit", ...args]) },
    "opportunity-server": { DEFAULT_CONTACT_LIMIT: 10, DEFAULT_CONNECTED_INSTALLERS: 3,
      expireStaleOpportunities: async () => {}, opportunityExpiry: () => "2099-01-01",
      canonicalMarketplaceState: value => String(value).toUpperCase(), qualifyingServiceArea: () => ({ distanceKm: 2 }),
      syncMarketplaceEnquiries: async (...args) => sideEffects.push(["sync", ...args.slice(1)]) },
    "direct-trade-entitlements-server": { accountHasFeature: async () => true },
    "keyset-pagination": { decodeKeysetCursor: () => null, encodeKeysetCursor: () => "", keysetAfter: () => { throw new Error("No cursor expected"); } },
    "fts-search": { ftsPrefixQuery: value => value },
    "route-performance": { routeTimer: () => ({ databases: promises => Promise.all(promises) }), performanceJson: payload => json(payload) },
  };
  function load(source) {
    const exports = {};
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "exports", compiled)(specifier => {
      const key = specifier.split("/").at(-1);
      const dependency = dependencies[key] || certificateTestDependency(key);
      assert.ok(dependency, `Unexpected dependency ${specifier}`);
      return dependency;
    }, exports);
    return exports;
  }
  return { sqlite, d1, sideEffects, route: load(routeSource), matches: load(matchesSource),
    beforeWrite: hook => { beforeWrite = hook; } };
}

function request(method, body) {
  return new Request("https://example.test/api/admin/opportunities", {
    method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

test("admin list projects exact current consent per opportunity without cross-household correlation", async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  const response = await h.route.GET(request("GET"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.opportunities.find(row => row.id === "current").allQualifiedConsent, true);
  assert.equal(payload.opportunities.find(row => row.id === "other").allQualifiedConsent, false);
});

test("manual assignment executes its real SQL bindings for a qualified trade and the exact enquiry", async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  const response = await h.matches.POST(request("POST", { opportunityId: "current", firebaseUid: "solar-trade", adminNote: "Manual recovery" }));
  assert.equal(response.status, 200);
  const rows = h.sqlite.prepare("SELECT * FROM trade_opportunity_matches").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].opportunity_id, "current");
  assert.equal(rows[0].firebase_uid, "solar-trade");
  assert.equal(rows[0].matched_categories, '["solar"]');
  assert.equal(rows[0].admin_note, "Manual recovery");
  assert.equal(rows[0].distance_metres, 2000);
  assert.equal(rows[0].matched_by_uid, "admin");
  assert.equal(rows[0].status, "offered");
  assert.equal(h.sideEffects.filter(item => item[0] === "sync").length, 1);
});

test("manual assignment rejects stale, mismatched and withdrawn all-qualified receipts", async t => {
  const mutations = [
    ["legacy receipt", "UPDATE public_trade_lead_contact_releases SET notice_version=?,consent_purpose=?", [consent.AEA_RESTRICTED_PUBLIC_PLAN_CONSENT_NOTICE_VERSION, consent.AEA_RESTRICTED_PUBLIC_PLAN_CONSENT_PURPOSE]],
    ["wrong purpose", "UPDATE public_trade_lead_contact_releases SET consent_purpose='different'", []],
    ["wrong opportunity", "UPDATE public_trade_lead_contact_releases SET opportunity_id='other'", []],
    ["wrong source", "UPDATE public_trade_lead_contact_releases SET source_reference='ref-other'", []],
    ["wrong postcode", "UPDATE public_trade_lead_contact_releases SET postcode='2000'", []],
    ["withdrawn", "UPDATE public_trade_lead_contact_releases SET withdrawn_at=?", [now]],
    ["inactive", "UPDATE public_trade_lead_contact_releases SET status='withdrawn'", []],
    ["invalid date", "UPDATE public_trade_lead_contact_releases SET granted_at='invalid'", []],
    ["missing disclosure", "UPDATE public_trade_lead_contact_releases SET disclosed_fields='[\"customer_email\"]'", []],
    ["duplicate disclosure", "UPDATE public_trade_lead_contact_releases SET disclosed_fields='[\"customer_email\",\"postcode\",\"service_categories\",\"postcode\"]'", []],
  ];
  for (const [label, sql, bindings] of mutations) {
    const h = harness(); t.after(() => h.sqlite.close()); h.sqlite.prepare(sql).run(...bindings);
    const response = await h.matches.POST(request("POST", { opportunityId: "current", firebaseUid: "solar-trade" }));
    assert.equal(response.status, 409, label);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) total FROM trade_opportunity_matches").get().total, 0, label);
    assert.deepEqual(h.sideEffects, [], label);
  }
});

test("manual assignment rechecks consent after the initial read before committing", async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  h.beforeWrite(sql => { assert.match(sql, /INSERT INTO trade_opportunity_matches/); h.sqlite.exec("UPDATE public_trade_lead_contact_releases SET status='withdrawn'"); });
  const response = await h.matches.POST(request("POST", { opportunityId: "current", firebaseUid: "solar-trade" }));
  assert.equal(response.status, 409);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) total FROM trade_opportunity_matches").get().total, 0);
  assert.deepEqual(h.sideEffects, []);
});

test("admin can pause and reopen an assessment enquiry only under its current all-qualified consent", async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  for (const status of ["paused", "open"]) {
    const response = await h.route.PATCH(request("PATCH", { id: "current", status }));
    assert.equal(response.status, 200, status);
    assert.equal(h.sqlite.prepare("SELECT status FROM trade_opportunities WHERE id='current'").get().status, status);
  }
  h.sqlite.exec("UPDATE public_trade_lead_contact_releases SET status='withdrawn'");
  assert.equal((await h.route.PATCH(request("PATCH", { id: "current", status: "paused" }))).status, 409);
  assert.equal(h.sqlite.prepare("SELECT status FROM trade_opportunities WHERE id='current'").get().status, "open");
});

test("assignment status changes recheck consent and keep other households and trades untouched", async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  assert.equal((await h.matches.POST(request("POST", { opportunityId: "current", firebaseUid: "solar-trade" }))).status, 200);
  const id = h.sqlite.prepare("SELECT id FROM trade_opportunity_matches").get().id;
  assert.equal((await h.matches.PATCH(request("PATCH", { id, status: "interested" }))).status, 200);
  h.beforeWrite(sql => { assert.match(sql, /UPDATE trade_opportunity_matches/); h.sqlite.exec("UPDATE public_trade_lead_contact_releases SET status='withdrawn'"); });
  assert.equal((await h.matches.PATCH(request("PATCH", { id, status: "connected" }))).status, 409);
  assert.equal(h.sqlite.prepare("SELECT status FROM trade_opportunity_matches WHERE id=?").get(id).status, "interested");
  assert.equal((await h.matches.PATCH(request("PATCH", { id, status: "closed" }))).status, 200);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) total FROM trade_opportunity_matches WHERE opportunity_id='other' OR firebase_uid='other-trade'").get().total, 0);
});

test("assignment updates reject an authoritative business review revoked after preflight", async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  assert.equal((await h.matches.POST(request("POST", { opportunityId: "current", firebaseUid: "solar-trade" }))).status, 200);
  const id = h.sqlite.prepare("SELECT id FROM trade_opportunity_matches").get().id;
  h.beforeWrite(sql => {
    assert.match(sql, /UPDATE trade_opportunity_matches/);
    h.sqlite.exec("DELETE FROM trade_account_verification_reviews WHERE firebase_uid='solar-trade'");
  });
  assert.equal((await h.matches.PATCH(request("PATCH", { id, status: "interested" }))).status, 409);
  assert.equal(h.sqlite.prepare("SELECT status FROM trade_opportunity_matches WHERE id=?").get(id).status, "offered");
});

test("Cloudflare D1 executes admin list, manual assignment and status SQL within runtime limits", async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };',
    compatibilityDate: "2026-05-22", d1Databases: { DB: "admin-open-market-depth-check" } });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("DB");
  const schema = h.sqlite.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  for (const row of schema.filter(row => row.type === "table")) await db.prepare(row.sql).run();
  for (const table of schema.filter(row => row.type === "table")) {
    const identifier = `"${table.name.replaceAll('"', '""')}"`;
    for (const row of h.sqlite.prepare(`SELECT * FROM ${identifier}`).all()) {
      const columns = Object.keys(row).map(name => `"${name.replaceAll('"', '""')}"`).join(",");
      await db.prepare(`INSERT INTO ${identifier} (${columns}) VALUES (${Object.keys(row).map(() => "?").join(",")})`)
        .bind(...Object.values(row)).run();
    }
  }
  for (const row of schema.filter(row => row.type !== "table")) await db.prepare(row.sql).run();
  h.d1.prepare = sql => db.prepare(sql);
  h.d1.batch = statements => db.batch(statements);
  const list = await h.route.GET(request("GET"));
  assert.equal(list.status, 200);
  assert.equal((await list.json()).opportunities.find(row => row.id === "current").allQualifiedConsent, true);
  assert.equal((await h.matches.POST(request("POST", { opportunityId: "current", firebaseUid: "solar-trade" }))).status, 200);
  const match = await db.prepare("SELECT id FROM trade_opportunity_matches").first();
  assert.equal((await h.matches.PATCH(request("PATCH", { id: match.id, status: "interested" }))).status, 200);
  assert.equal((await h.matches.PATCH(request("PATCH", { id: match.id, status: "connected" }))).status, 200);
  assert.equal((await h.route.PATCH(request("PATCH", { id: "current", status: "paused" }))).status, 200);
  assert.equal((await h.route.PATCH(request("PATCH", { id: "current", status: "open" }))).status, 200);
  await db.prepare("UPDATE public_trade_lead_contact_releases SET withdrawn_at=?").bind(now).run();
  assert.equal((await h.matches.POST(request("POST", { opportunityId: "current", firebaseUid: "other-trade" }))).status, 409);
  assert.equal((await h.route.PATCH(request("PATCH", { id: "current", status: "paused" }))).status, 409);
});
