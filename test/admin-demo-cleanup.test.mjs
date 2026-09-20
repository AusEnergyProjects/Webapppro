import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { GOVERNMENT_ACTIVITY_TEMPLATES } from "../src/lib/australian-government-program-catalogue.ts";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const owner = { uid: "owner", role: "owner", authTime: Math.floor(Date.now() / 1000) };
function load(path, dependencies) {
  const compiled = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  Function("require", "module", "exports", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; }, record, record.exports);
  return record.exports;
}

function wrap(sqlite) {
  const statement = (sql, bindings = []) => ({ bind: (...values) => statement(sql, values), first: async () => sqlite.prepare(sql).get(...bindings) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }), run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }) });
  return { prepare: statement, batch: async statements => { sqlite.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
}

function fixture(archivePilot = async () => { throw new Error("Pilot not expected"); }) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE customer_accounts (firebase_uid TEXT PRIMARY KEY, display_name TEXT, is_synthetic INTEGER, account_status TEXT, updated_at TEXT);
    CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_name TEXT, is_synthetic INTEGER, account_status TEXT, availability_status TEXT, verification_status TEXT, updated_at TEXT);
    CREATE TABLE supplier_products (id TEXT PRIMARY KEY, name TEXT, is_synthetic INTEGER, listing_status TEXT, review_status TEXT, updated_at TEXT);
    CREATE TABLE customer_projects (id TEXT PRIMARY KEY, firebase_uid TEXT, opportunity_id TEXT, is_synthetic INTEGER, status TEXT, updated_at TEXT);
    CREATE TABLE trade_opportunities (id TEXT PRIMARY KEY, is_synthetic INTEGER, status TEXT, updated_at TEXT);
    CREATE TABLE trade_opportunity_matches (id TEXT PRIMARY KEY, opportunity_id TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE customer_project_quotes (id TEXT PRIMARY KEY, project_id TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE compliance_pilot_runs (id TEXT PRIMARY KEY, organisation_id TEXT, record_mode TEXT, status TEXT, created_at TEXT, updated_at TEXT, program_code TEXT DEFAULT 'VEU');
    CREATE TABLE admin_audit_log (id TEXT PRIMARY KEY, admin_uid TEXT, action TEXT, entity_type TEXT, entity_id TEXT, summary TEXT, metadata TEXT, created_at TEXT);
    CREATE TABLE immutable_financial_history (id TEXT PRIMARY KEY, amount INTEGER);
    INSERT INTO customer_accounts VALUES ('demo-customer','Synthetic customer',1,'active','v1'),('real-customer','Demo named real customer',0,'active','v1');
    INSERT INTO trade_accounts VALUES ('demo-trade','Synthetic trade',1,'active','open','approved','v1'),('real-trade','Test real trade',0,'active','open','approved','v1');
    INSERT INTO supplier_products VALUES ('demo-product','Synthetic product',1,'published','approved','v1'),('real-product','Demo named real product',0,'published','approved','v1');
    INSERT INTO customer_projects VALUES ('demo-project','demo-customer','demo-opportunity',0,'matching','v1'),('real-project','real-customer','real-opportunity',0,'matching','v1');
    INSERT INTO trade_opportunities VALUES ('demo-opportunity',0,'open','v1'),('real-opportunity',0,'open','v1'),('standalone-demo-opportunity',1,'open','v1');
    INSERT INTO trade_opportunity_matches VALUES ('demo-match','demo-opportunity','interested','v1'),('real-match','real-opportunity','interested','v1');
    INSERT INTO customer_project_quotes VALUES ('demo-quote','demo-project','submitted','v1'),('real-quote','real-project','submitted','v1'),('accepted-demo-quote','demo-project','accepted','v1');
    INSERT INTO immutable_financial_history VALUES ('financial-history',12345);`);
  const database = wrap(sqlite);
  const server = load("../src/lib/admin-demo-cleanup-server.ts", { "./creditex-veu-pilot-server": { archiveCreditexVeuPilot: (...args) => archivePilot(sqlite, ...args) } });
  return { sqlite, database, server, close: () => sqlite.close() };
}

function realPilotFixture() {
  const f = fixture();
  f.sqlite.exec(`ALTER TABLE compliance_pilot_runs ADD COLUMN archived_at TEXT NOT NULL DEFAULT '';
    CREATE TABLE trade_team_members(id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE compliance_pilot_installers(pilot_run_id TEXT,trade_account_uid TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE compliance_pilot_technicians(pilot_run_id TEXT,team_member_id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE trade_crm_customers(id TEXT,record_status TEXT,updated_at TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT,record_status TEXT,updated_at TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,crm_customer_id TEXT,service_site_id TEXT);
    CREATE TABLE compliance_pilot_jobs(pilot_run_id TEXT,work_order_id TEXT,review_status TEXT,updated_at TEXT);
    CREATE TABLE trade_work_orders(source_type TEXT,source_reference TEXT,stage TEXT,record_status TEXT,updated_at TEXT);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE compliance_pilot_events(id TEXT PRIMARY KEY,pilot_run_id TEXT,organisation_id TEXT,event_type TEXT,actor_uid TEXT,summary TEXT,metadata TEXT,created_at TEXT);
    INSERT INTO compliance_pilot_runs VALUES ('pilot','creditex-org','synthetic_test','active','v1','v1','VEU','');
    INSERT INTO compliance_pilot_installers VALUES ('pilot','demo-trade','active','v1');`);
  const contract = load("../src/lib/creditex-veu-pilot-contract.ts", { "./australian-government-program-catalogue": { GOVERNMENT_ACTIVITY_TEMPLATES } });
  const pilot = load("../src/lib/creditex-veu-pilot-server.ts", { "./creditex-veu-pilot-contract": contract });
  return { ...f, pilot };
}

test("preview uses authoritative flags and exact ownership, never demo-looking names", async () => {
  const f = fixture();
  try {
    const preview = await f.server.previewDemoCleanup(f.database, owner);
    assert.match(preview.digest, /^[a-f0-9]{64}$/); assert.equal(preview.total, 8);
    assert.deepEqual(preview.groups.find(group => group.key === "customers").records.map(row => row.id), ["demo-customer"]);
    assert.equal(preview.groups.find(group => group.key === "opportunities").count, 2);
    assert.ok(preview.groups.every(group => group.records.every(row => !row.id.startsWith("real-"))));
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM admin_audit_log").get().n, 0);
  } finally { f.close(); }
});

test("owner and recent authentication are enforced before writes, and stale previews do not apply", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.server.previewDemoCleanup(f.database, { ...owner, role: "admin" }), /Only the platform owner/);
    const preview = await f.server.previewDemoCleanup(f.database, owner);
    await assert.rejects(f.server.archiveDemoCleanup(f.database, { ...owner, authTime: 1 }, preview.digest, new Map()), /Sign out and sign in/);
    f.sqlite.exec("UPDATE supplier_products SET updated_at='v2' WHERE id='demo-product'");
    await assert.rejects(f.server.archiveDemoCleanup(f.database, owner, preview.digest, new Map()), /changed after preview/);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM admin_audit_log").get().n, 0);
  } finally { f.close(); }
});

test("archive closes demo operations with exact receipt counts and preserves real, review and financial history", async () => {
  const f = fixture();
  try {
    const preview = await f.server.previewDemoCleanup(f.database, owner);
    const result = await f.server.archiveDemoCleanup(f.database, owner, preview.digest, new Map());
    assert.equal(result.receipt.completed, true); assert.equal(result.preview.total, 0);
    assert.deepEqual(result.receipt.applied, { customers: 1, trades: 1, products: 1, projects: 1, opportunities: 2, matches: 1, quotes: 1 });
    assert.equal(f.sqlite.prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid='demo-customer'").get().account_status, "closed");
    assert.equal(f.sqlite.prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid='real-customer'").get().account_status, "active");
    assert.equal(f.sqlite.prepare("SELECT verification_status FROM trade_accounts WHERE firebase_uid='demo-trade'").get().verification_status, "approved");
    assert.equal(f.sqlite.prepare("SELECT review_status FROM supplier_products WHERE id='demo-product'").get().review_status, "approved");
    assert.equal(f.sqlite.prepare("SELECT status FROM customer_project_quotes WHERE id='accepted-demo-quote'").get().status, "accepted");
    assert.equal(f.sqlite.prepare("SELECT amount FROM immutable_financial_history").get().amount, 12345);
    const audit = f.sqlite.prepare("SELECT metadata FROM admin_audit_log WHERE action='demo_cleanup.finished'").get();
    assert.equal(JSON.parse(audit.metadata).id, result.receipt.id);
    const repeated = await f.server.archiveDemoCleanup(f.database, owner, result.preview.digest, new Map());
    assert.equal(repeated.receipt.completed, true); assert.ok(Object.values(repeated.receipt.applied).every(count => count === 0));
  } finally { f.close(); }
});

test("shared real project relationships block cleanup instead of modifying real opportunities", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("UPDATE customer_projects SET opportunity_id='demo-opportunity' WHERE id='real-project'");
    await assert.rejects(f.server.previewDemoCleanup(f.database, owner), /shared with an unmarked customer project/);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_opportunities WHERE id='demo-opportunity'").get().status, "open");
  } finally { f.close(); }
});

test("a concurrent live project link blocks every generic update inside its atomic batch", async () => {
  const f = fixture();
  try {
    const preview = await f.server.previewDemoCleanup(f.database, owner);
    const originalBatch = f.database.batch;
    f.database.batch = async statements => {
      f.sqlite.exec("UPDATE customer_projects SET opportunity_id='demo-opportunity',updated_at='v2' WHERE id='real-project'");
      return originalBatch(statements);
    };
    const result = await f.server.archiveDemoCleanup(f.database, owner, preview.digest, new Map());
    assert.equal(result.receipt.completed, false);
    assert.match(result.receipt.error, /shared with an unmarked customer project/);
    assert.ok(Object.values(result.receipt.applied).every(count => count === 0));
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_opportunities WHERE id='demo-opportunity'").get().status, "open");
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_opportunity_matches WHERE id='demo-match'").get().status, "interested");
    assert.equal(f.sqlite.prepare("SELECT status FROM customer_project_quotes WHERE id='demo-quote'").get().status, "submitted");
    assert.equal(f.sqlite.prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid='demo-customer'").get().account_status, "active");
    assert.equal(f.sqlite.prepare("SELECT account_status FROM trade_accounts WHERE firebase_uid='demo-trade'").get().account_status, "active");
  } finally { f.close(); }
});

test("pilot archival requires the owner's real Creditex membership and runs before generic changes", async () => {
  let archived = false;
  const f = fixture(async (sqlite, _db, member, confirmation) => {
    assert.equal(member.organisationId, "creditex-org"); assert.equal(confirmation, "ARCHIVE SYNTHETIC VEU PILOT");
    assert.equal(sqlite.prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid='demo-customer'").get().account_status, "active");
    sqlite.exec("UPDATE compliance_pilot_runs SET status='archived',updated_at='v2' WHERE id='pilot'"); archived = true;
    return { runId: "pilot", archived: true };
  });
  try {
    f.sqlite.exec("INSERT INTO compliance_pilot_runs VALUES ('pilot','creditex-org','synthetic_test','active','v1','v1','VEU')");
    const preview = await f.server.previewDemoCleanup(f.database, owner);
    await assert.rejects(f.server.archiveDemoCleanup(f.database, owner, preview.digest, new Map()), /also have administrator access/);
    const result = await f.server.archiveDemoCleanup(f.database, owner, preview.digest, new Map([["creditex-org", { ...owner, role: "admin", organisationId: "creditex-org" }]]));
    assert.equal(archived, true); assert.deepEqual(result.receipt.archivedPilotIds, ["pilot"]); assert.equal(result.receipt.completed, true);
  } finally { f.close(); }
});

test("pilot helper archives the reviewed exact run even if a newer same-organisation run appears", async () => {
  const f = realPilotFixture();
  try {
    f.sqlite.exec("INSERT INTO compliance_pilot_runs VALUES ('new-unreviewed','creditex-org','synthetic_test','active','v2','v2','VEU','')");
    const result = await f.pilot.archiveCreditexVeuPilot(f.database, { ...owner, role: "admin", organisationId: "creditex-org" }, "ARCHIVE SYNTHETIC VEU PILOT", { id: "pilot", status: "active", updatedAt: "v1" });
    assert.equal(result.runId, "pilot");
    assert.equal(f.sqlite.prepare("SELECT status FROM compliance_pilot_runs WHERE id='pilot'").get().status, "archived");
    assert.equal(f.sqlite.prepare("SELECT status FROM compliance_pilot_runs WHERE id='new-unreviewed'").get().status, "active");
  } finally { f.close(); }
});

test("pilot snapshot changed after selection cannot mutate descendants or create an archival receipt", async () => {
  const f = realPilotFixture();
  try {
    const batch = f.database.batch;
    f.database.batch = async statements => {
      f.sqlite.exec("UPDATE compliance_pilot_runs SET updated_at='concurrent-revision' WHERE id='pilot'");
      return batch(statements);
    };
    await assert.rejects(f.pilot.archiveCreditexVeuPilot(f.database, { ...owner, role: "admin", organisationId: "creditex-org" }, "ARCHIVE SYNTHETIC VEU PILOT", { id: "pilot", status: "active", updatedAt: "v1" }), /changed before archival/);
    assert.equal(f.sqlite.prepare("SELECT status FROM compliance_pilot_runs WHERE id='pilot'").get().status, "active");
    assert.equal(f.sqlite.prepare("SELECT account_status FROM trade_accounts WHERE firebase_uid='demo-trade'").get().account_status, "active");
    assert.equal(f.sqlite.prepare("SELECT status FROM compliance_pilot_installers WHERE pilot_run_id='pilot'").get().status, "active");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_pilot_events").get().n, 0);
  } finally { f.close(); }
});

test("a generic write failure rolls back that batch and reports the already archived pilot truthfully", async () => {
  const f = fixture(async sqlite => { sqlite.exec("UPDATE compliance_pilot_runs SET status='archived' WHERE id='pilot'"); return { runId: "pilot", archived: true }; });
  try {
    f.sqlite.exec("INSERT INTO compliance_pilot_runs VALUES ('pilot','creditex-org','synthetic_test','active','v1','v1','VEU'); CREATE TRIGGER reject_demo_product BEFORE UPDATE ON supplier_products BEGIN SELECT RAISE(ABORT,'blocked'); END;");
    const preview = await f.server.previewDemoCleanup(f.database, owner);
    const result = await f.server.archiveDemoCleanup(f.database, owner, preview.digest, new Map([["creditex-org", { ...owner, role: "admin", organisationId: "creditex-org" }]]));
    assert.equal(result.receipt.completed, false); assert.deepEqual(result.receipt.archivedPilotIds, ["pilot"]);
    assert.equal(result.receipt.remaining.customers, 1); assert.equal(result.receipt.remaining.pilotRuns, 0);
    assert.equal(f.sqlite.prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid='demo-customer'").get().account_status, "active");
    assert.match(result.receipt.error, /did not finish/);
  } finally { f.close(); }
});

test("all cleanup queries execute against the full production migration chain without deleting schema or history", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../drizzle/", import.meta.url);
    for (const name of fs.readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
      for (const statement of fs.readFileSync(new URL(name, directory), "utf8").split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
        try { sqlite.exec(statement); }
        catch (error) {
          const fts = statement.match(/^CREATE VIRTUAL TABLE ([a-z_]+) USING fts5\((.*)\);?$/is);
          if (!error.message.includes("no such module: fts5") || !fts) throw error;
          // This Node SQLite build has no FTS5. Match the existing complete-chain fixture:
          // only its search index gets a plain table; every business table/guard stays real.
          const columns = fts[2].split(",").map(value => value.trim()).filter(value => !value.startsWith("tokenize=")).map(value => `${value.split(/\s+/)[0]} text`);
          sqlite.exec(`CREATE TABLE ${fts[1]} (${columns.join(", ")})`);
        }
      }
    }
    const database = wrap(sqlite);
    const server = load("../src/lib/admin-demo-cleanup-server.ts", { "./creditex-veu-pilot-server": { archiveCreditexVeuPilot: async () => { throw new Error("Unexpected pilot"); } } });
    const preview = await server.previewDemoCleanup(database, owner);
    assert.equal(preview.total, 0);
    const result = await server.archiveDemoCleanup(database, owner, preview.digest, new Map());
    assert.equal(result.receipt.completed, true); assert.equal(result.receipt.historicalRecordsDeleted, false);
  } finally { sqlite.close(); }
});

test("cleanup API rejects another origin before auth and requires owner role", async () => {
  let authChecks = 0;
  const exported = load("../src/app/api/admin/demo-cleanup/route.ts", {
    "../../../../../db": { getD1: () => ({}) },
    "@/lib/admin-server": { adminJson: (body, status = 200) => Response.json(body, { status }), sameOrigin: request => request.headers.get("origin") === new URL(request.url).origin,
      requireAdminIdentity: async (_request, roles) => { authChecks++; assert.deepEqual(roles, ["owner"]); throw new Error("ROLE_REQUIRED"); } },
    "@/lib/compliance-access-server": { ComplianceAccessError: class extends Error {} },
    "@/lib/creditex-schema-guards": {},
    "@/lib/admin-demo-cleanup-server": { DemoCleanupError: class extends Error {} },
  });
  const request = origin => new Request("https://example.test/api/admin/demo-cleanup", { method: "POST", headers: { origin }, body: "{}" });
  assert.equal((await exported.POST(request("https://attacker.test"))).status, 403); assert.equal(authChecks, 0);
  assert.equal((await exported.POST(request("https://example.test"))).status, 403); assert.equal(authChecks, 1);
});
