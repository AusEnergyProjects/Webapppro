import { TRADE_MAP_PREPARATION_SCHEMA_GUARDS } from "../src/lib/trade-map-preparation-schema.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { tradeMapAddressSql } from "../src/lib/trade-map-dataset-server.ts";
import { JOB_REGISTER_CUSTOMER_CONTEXT_SQL } from "../src/lib/trade-crm-job-register.ts";
import { locateTradeMapRecords } from "../src/lib/trade-map-location-cache.ts";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-01T05:00:00.000Z");
// Use the production access predicate without importing Cloudflare/Firebase runtime bindings.
const accessAst = ts.createSourceFile("access.ts", read("../src/lib/trade-account-predicates.ts"), ts.ScriptTarget.Latest, true);
const predicateSource = accessAst.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["checkedSqlAlias", "validAbnSqlPredicate", "approvedTradeReviewPredicate", "verifiedTradeAccountPredicate"].includes(node.name?.text));
const transpile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const predicate = new Function("exports", `${transpile(predicateSource.map(node => node.getText()).join("\n"))}; return verifiedTradeAccountPredicate;`)({});
const moduleAst = ts.createSourceFile("queue.ts", read("../src/lib/trade-map-preparation.ts"), ts.ScriptTarget.Latest, true);
const source = transpile(moduleAst.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText()).join("\n"));
const dependencies = { tradeMapAddressSql, JOB_REGISTER_CUSTOMER_CONTEXT_SQL, verifiedTradeAccountPredicate: predicate, locateTradeMapRecords };
const queue = new Function("exports", ...Object.keys(dependencies), `${source}; return exports;`)({}, ...Object.values(dependencies));

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE trade_accounts(firebase_uid text PRIMARY KEY,business_name text,partner_type text,
    account_status text DEFAULT 'active',verification_status text DEFAULT 'approved',abn text DEFAULT '51824753556',
    verified_abn text DEFAULT '51824753556',verification_review_id text,verification_reviewed_at text DEFAULT '2026-01-01',
    verification_reviewed_by_uid text DEFAULT 'admin');
    CREATE TABLE trade_account_verification_reviews(id text,firebase_uid text,abn text,business_name text,partner_type text,
      decision text,review_method text,reviewed_by_uid text,reviewed_at text);
    CREATE TABLE trade_crm_customers(id text PRIMARY KEY,firebase_uid text,address_line_1 text,address_line_2 text DEFAULT '',
      suburb text DEFAULT 'Melbourne',address_state text DEFAULT 'VIC',postcode text DEFAULT '3000',record_status text DEFAULT 'active',first_name text DEFAULT '');
    CREATE TABLE trade_crm_service_sites(id text PRIMARY KEY,firebase_uid text,address_line_1 text,address_line_2 text DEFAULT '',
      suburb text DEFAULT 'Melbourne',address_state text DEFAULT 'VIC',postcode text DEFAULT '3000',record_status text DEFAULT 'active');
    CREATE TABLE trade_work_orders(id text PRIMARY KEY,firebase_uid text,partner_type text DEFAULT 'installer',record_status text DEFAULT 'active',source_type text DEFAULT 'internal');
    CREATE TABLE trade_crm_job_details(id text PRIMARY KEY,firebase_uid text,work_order_id text,service_site_id text,customer_source text DEFAULT 'internal');`);
  sqlite.exec(read("../drizzle/0227_trade_map_location_cache.sql"));
  sqlite.exec(read("../drizzle/0228_trade_map_permanent_locations.sql"));
  sqlite.exec(read("../drizzle/0229_trade_map_preparation.sql"));
  for (const definition of TRADE_MAP_PREPARATION_SCHEMA_GUARDS) sqlite.exec(definition.sql);
  const statement = (sql, values = []) => ({
    bind: (...bindings) => statement(sql, bindings),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values), success: true, meta: {} }),
    run: async () => ({ results: [], success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  });
  const db = { prepare: statement };
  for (const owner of ["owner", "other"]) {
    sqlite.prepare(`INSERT INTO trade_accounts(firebase_uid,business_name,partner_type,verification_review_id) VALUES(?,?,'installer',?)`).run(owner, owner, owner);
    sqlite.prepare(`INSERT INTO trade_account_verification_reviews VALUES(?,?,'51824753556',?,'installer','approved','official_abr_lookup','admin','2026-01-01')`).run(owner, owner, owner);
  }
  const add = (id, owner = "owner", address = `${id} Example Street`) => sqlite.prepare(`INSERT INTO trade_crm_customers(id,firebase_uid,address_line_1) VALUES(?,?,?)`).run(id, owner, address);
  const addJob = (id, owner, address, source = "internal") => {
    sqlite.prepare(`INSERT INTO trade_crm_service_sites(id,firebase_uid,address_line_1) VALUES(?,?,?)`).run(id, owner, address);
    sqlite.prepare(`INSERT INTO trade_work_orders(id,firebase_uid,source_type) VALUES(?,?,?)`).run(id, owner, source);
    sqlite.prepare(`INSERT INTO trade_crm_job_details(id,firebase_uid,work_order_id,service_site_id) VALUES(?,?,?,?)`).run(id, owner, id, id);
  };
  let time = NOW;
  const calls = [];
  const directory = { version: "gnaf-test", attribution: "G-NAF", resolve: async addresses => {
    calls.push(addresses); return addresses.map(() => ({ status: "located", position: { lat: -37.8, lng: 145 }, approximate: false, sourceId: "GA-test" }));
  } };
  const drain = options => queue.drainTradeMapPreparation({ db, getDirectory: async () => directory, now: () => new Date(time), ...options });
  const state = (owner = "owner") => sqlite.prepare("SELECT * FROM trade_map_preparation WHERE owner_uid=?").get(owner);
  const cache = () => sqlite.prepare("SELECT * FROM trade_map_location_cache ORDER BY owner_uid,address_key").all();
  return { sqlite, db, add, addJob, calls, directory, drain, state, cache, advance: ms => { time += ms; }, close: () => sqlite.close() };
}

test("imports enqueue durably and a later cron finishes bounded batches without a browser", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 261; i++) f.add(String(i));
    assert.equal(f.state().requested_revision, 261);
    assert.deepEqual(await f.drain({ ownerUid: "owner" }), { processed: 100, completed: 0, failed: 0 });
    assert.equal(f.cache().filter(row => row.status === "located").length, 100);
    assert.deepEqual(await f.drain({ maxBatches: 20 }), { processed: 161, completed: 1, failed: 0 });
    assert.equal(f.state().completed_revision, 261);
    assert.deepEqual(await f.drain({ maxBatches: 20 }), { processed: 0, completed: 0, failed: 0 });
    assert.deepEqual(f.calls.map(addresses => addresses.length), [100, 100, 61]);
    assert.ok(f.cache().every(row => row.provider === "gnaf" && row.expires_at === ""));
  } finally { f.close(); }
});

test("business projection shares customer/job addresses and excludes other tenants, archived and protected jobs", async () => {
  const f = fixture();
  try {
    f.add("1"); f.add("2", "other"); f.addJob("job", "owner", "1 Example Street");
    f.addJob("protected", "owner", "88 Protected Street", "opportunity");
    f.add("archived"); f.sqlite.exec("UPDATE trade_crm_customers SET record_status='archived' WHERE id='archived'");
    const result = await f.drain({ ownerUid: "owner", maxBatches: 20 });
    assert.equal(result.processed, 1);
    assert.equal(f.calls.flat().length, 1);
    assert.equal(f.cache()[0].owner_uid, "owner");
    assert.equal(f.state("other").completed_revision, 0);
    assert.equal((await f.drain({ ownerUid: "other" })).processed, 1);
  } finally { f.close(); }
});

test("concurrent device kicks cannot claim the same business, and a crashed lease resumes", async () => {
  const f = fixture();
  try {
    f.add("1");
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const original = f.directory.resolve;
    f.directory.resolve = async addresses => { entered(); await blocked; return original(addresses); };
    const first = f.drain({ ownerUid: "owner" });
    await started;
    assert.equal((await f.drain({ ownerUid: "owner" })).processed, 0);
    release(); await first;
    assert.equal(f.calls.length, 1);
    f.add("2");
    f.sqlite.prepare("UPDATE trade_map_preparation SET lease_token='crashed',lease_expires_at=?").run(new Date(NOW + 120_000).toISOString());
    assert.equal((await f.drain()).processed, 0);
    f.advance(120_001);
    assert.equal((await f.drain()).processed, 1);
  } finally { f.close(); }
});

test("an edit while resolving is not overwritten and its new durable revision is completed later", async () => {
  const f = fixture();
  try {
    f.add("1");
    const original = f.directory.resolve;
    f.directory.resolve = async addresses => {
      f.sqlite.exec("UPDATE trade_crm_customers SET address_line_1='2 New Street' WHERE id='1'");
      return original(addresses);
    };
    await f.drain();
    assert.ok(f.state().requested_revision > f.state().completed_revision);
    assert.equal(f.cache().filter(row => row.status === "located").length, 0);
    f.directory.resolve = original;
    await f.drain();
    assert.equal(f.state().requested_revision, f.state().completed_revision);
    assert.equal(f.cache().find(row => row.status === "located").address, "2 New Street, Melbourne, VIC, 3000, Australia");
  } finally { f.close(); }
});

test("directory failures back off durably and map reads do not reset failures or mark addresses missing", async () => {
  const f = fixture();
  try {
    f.add("1");
    assert.equal((await f.drain({ getDirectory: async () => { throw new Error("storage unavailable"); } })).failed, 1);
    const after = f.state();
    assert.equal(after.failures, 1);
    assert.equal(after.last_error, "directory_processing_failed");
    assert.equal(f.cache().length, 0);
    await queue.enqueueTradeMapPreparation(f.db, "owner", new Date(NOW).toISOString());
    assert.equal(f.state().next_attempt_at, after.next_attempt_at);
    assert.equal((await f.drain()).processed, 0);
    f.advance(5_000);
    assert.equal((await f.drain()).processed, 1);
    assert.equal(f.state().failures, 0);
  } finally { f.close(); }
});

test("revoked, invalid ABN and unauthorised review accounts cannot be prepared", async () => {
  for (const mutation of ["account_status='suspended'", "abn='11111111111',verified_abn='11111111111'", "verification_review_id='missing'"]) {
    const f = fixture();
    try {
      f.add("1"); f.sqlite.exec(`UPDATE trade_accounts SET ${mutation} WHERE firebase_uid='owner'`);
      assert.equal((await f.drain()).processed, 0);
      assert.equal(f.calls.length, 0);
    } finally { f.close(); }
  }
});

test("revocation while matching prevents saving business coordinates", async () => {
  const f = fixture();
  try {
    f.add("1"); const original = f.directory.resolve;
    f.directory.resolve = addresses => {
      f.sqlite.exec("UPDATE trade_accounts SET account_status='suspended' WHERE firebase_uid='owner'");
      return original(addresses);
    };
    await f.drain();
    assert.equal(f.cache().filter(row => row.status === "located").length, 0);
  } finally { f.close(); }
});

test("non-address edits do not enqueue work, address and restored records do", async () => {
  const f = fixture();
  try {
    f.add("1"); await f.drain();
    const completed = f.state().completed_revision;
    f.sqlite.exec("UPDATE trade_crm_customers SET first_name='Jane' WHERE id='1'");
    assert.equal(f.state().requested_revision, completed);
    f.sqlite.exec("UPDATE trade_crm_customers SET address_line_1=address_line_1 WHERE id='1'");
    assert.equal(f.state().requested_revision, completed);
    f.sqlite.exec("UPDATE trade_crm_customers SET record_status='archived' WHERE id='1'");
    f.sqlite.exec("UPDATE trade_crm_customers SET record_status='active' WHERE id='1'");
    assert.equal(f.state().requested_revision, completed + 2);
    await f.drain(); assert.equal(f.calls.length, 1, "restored unchanged locations are reused");
  } finally { f.close(); }
});

test("private dispatch header is removed and work remains outside the map response", async () => {
  const tasks = [], owners = [];
  const response = queue.withTradeMapPreparation(Response.json({ pending: 1 }), "verified-owner");
  const visible = queue.queueTradeMapPreparation(response, {
    waitUntil: promise => tasks.push(promise), drain: async owner => owners.push(owner), onError: assert.fail,
  });
  assert.equal(visible.headers.get(queue.TRADE_MAP_PREPARATION_HEADER), null);
  assert.deepEqual(await visible.json(), { pending: 1 });
  await Promise.all(tasks); assert.deepEqual(owners, ["verified-owner"]);
});
