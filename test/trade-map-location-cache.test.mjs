import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { claimTradeMapLocations, saveTradeMapLocations, cleanupExpiredTradeMapLocations,
  parseTradeMapLocationResults, TradeMapLocationInputError, TRADE_MAP_LOCATION_LEASE_MS,
  TRADE_MAP_LOCATION_TTL_MS } from "../src/lib/trade-map-location-cache.ts";

const NOW = "2026-10-01T00:00:00.000Z";
const later = (ms) => new Date(Date.parse(NOW) + ms).toISOString();
const located = { status: "located", position: { lat: -37.81, lng: 144.96 }, approximate: false };
const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(read("../drizzle/0227_trade_map_location_cache.sql"));
  sqlite.exec(`CREATE TABLE records(id text PRIMARY KEY, owner_uid text, member_id text, address text, archived integer DEFAULT 0);
    CREATE INDEX records_owner_idx ON records(owner_uid,archived,member_id)`);
  const queries = [];
  const statement = (sql, values = []) => ({
    bind: (...bindings) => statement(sql, bindings),
    first: async () => { queries.push({ sql, values }); return sqlite.prepare(sql).get(...values) ?? null; },
    all: async () => { queries.push({ sql, values }); return { results: sqlite.prepare(sql).all(...values), success: true, meta: {} }; },
    run: async () => { queries.push({ sql, values }); const value = sqlite.prepare(sql).run(...values); return { results: [], success: true, meta: { changes: Number(value.changes) } }; },
  });
  const db = { prepare: statement };
  const add = (id, address = `${id} Example St, Melbourne, VIC, 3000, Australia`, owner = "owner", member = "staff") => {
    sqlite.prepare("INSERT INTO records(id,address,owner_uid,member_id) VALUES (?,?,?,?)").run(id, address, owner, member);
  };
  const dataset = (owner = "owner", member = "") => ({
    sql: `SELECT id,'customer' kind,id title,id reference,address,lower(trim(address)) address_key,'' detail,'customer' category
      FROM records WHERE owner_uid=? AND archived=0 ${member ? "AND member_id=?" : ""}`,
    bindings: [owner, ...(member ? [member] : [])],
  });
  const claim = (options = {}, owner = "owner", source = dataset(owner)) => claimTradeMapLocations(db, owner, source, { now: NOW, ...options });
  const save = (claims, result = located, options = {}, owner = "owner", source = dataset(owner)) =>
    saveTradeMapLocations(db, owner, source, claims.map(c => ({ ...c, result })), { now: NOW, ...options });
  const cache = () => sqlite.prepare("SELECT * FROM trade_map_location_cache ORDER BY owner_uid,address_key").all();
  return { db, sqlite, queries, add, dataset, claim, save, cache, close: () => sqlite.close() };
}

test("same-business duplicate addresses share a durable result; another business cannot reuse it", async () => {
  const f = fixture();
  try {
    f.add("a", "1 Example St, Melbourne, VIC, 3000, Australia");
    f.add("b", "1 Example St, Melbourne, VIC, 3000, Australia");
    f.add("c", "1 Example St, Melbourne, VIC, 3000, Australia", "other");
    const first = await f.claim();
    assert.equal(first.claims.length, 1);
    assert.deepEqual(await f.save(first.claims), { saved: 1, ignored: 0 });
    assert.deepEqual(await f.claim(), { claims: [], retryAfterMs: 0 });
    assert.deepEqual(await f.save(first.claims), { saved: 0, ignored: 1 }, "a completed lease cannot replay");
    assert.equal((await f.claim({}, "other")).claims.length, 1);
    assert.equal(f.cache().filter(row => row.status === "located").length, 1);
  } finally { f.close(); }
});

test("concurrent browsers atomically claim disjoint bounded batches", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 40; i++) f.add(String(i));
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.claim({ limit: 5 })));
    const claims = responses.flatMap(response => response.claims);
    assert.equal(claims.length, 40);
    assert.equal(new Set(claims.map(claim => claim.addressKey)).size, 40);
    assert.equal(new Set(claims.map(claim => claim.leaseToken)).size, 8);
    assert.deepEqual(await f.claim(), { claims: [], retryAfterMs: TRADE_MAP_LOCATION_LEASE_MS });
  } finally { f.close(); }
});

test("an interrupted batch resumes after its lease; expired tokens cannot overwrite its replacement", async () => {
  const f = fixture();
  try {
    f.add("a");
    const first = await f.claim();
    const now = later(TRADE_MAP_LOCATION_LEASE_MS);
    assert.deepEqual(await f.save(first.claims, located, { now }), { saved: 0, ignored: 1 });
    const next = await f.claim({ now });
    assert.equal(next.claims.length, 1);
    assert.notEqual(next.claims[0].leaseToken, first.claims[0].leaseToken);
    assert.deepEqual(await f.save(first.claims, located, { now }), { saved: 0, ignored: 1 });
    assert.deepEqual(await f.save(next.claims, located, { now }), { saved: 1, ignored: 0 });
  } finally { f.close(); }
});

test("Google coordinates expire before 30 days and are physically cleared across businesses", async () => {
  const f = fixture();
  try {
    f.add("a"); f.add("b", undefined, "other");
    await f.save((await f.claim()).claims);
    await f.save((await f.claim({}, "other")).claims, located, {}, "other");
    assert.ok(TRADE_MAP_LOCATION_TTL_MS < 30 * 24 * 60 * 60 * 1000);
    assert.equal(await cleanupExpiredTradeMapLocations(f.db, later(TRADE_MAP_LOCATION_TTL_MS - 1)), 0);
    assert.equal(await cleanupExpiredTradeMapLocations(f.db, later(TRADE_MAP_LOCATION_TTL_MS)), 2);
    for (const value of f.cache()) {
      assert.equal(value.lat, null); assert.equal(value.lng, null); assert.equal(value.status, "pending");
      assert.equal(value.expires_at, ""); assert.equal(value.checked_at, "");
    }
    assert.equal((await f.claim({ now: later(TRADE_MAP_LOCATION_TTL_MS) })).claims.length, 1);
  } finally { f.close(); }
});

test("staff scope, owner identity, archive and address changes are rechecked before a save", async () => {
  const f = fixture();
  try {
    f.add("a"); f.add("b", undefined, "owner", "someone-else"); f.add("c", undefined, "other");
    const staff = f.dataset("owner", "staff");
    const first = await f.claim({}, "owner", staff);
    assert.equal(first.claims.length, 1);
    assert.deepEqual(await f.save(first.claims, located, {}, "other"), { saved: 0, ignored: 1 });
    f.sqlite.prepare("UPDATE records SET member_id='someone-else' WHERE id='a'").run();
    assert.deepEqual(await f.save(first.claims, located, {}, "owner", staff), { saved: 0, ignored: 1 });
    f.sqlite.prepare("UPDATE records SET archived=1 WHERE id='a'").run();
    assert.deepEqual(await f.save(first.claims), { saved: 0, ignored: 1 });
    f.sqlite.prepare("UPDATE records SET archived=0,address='2 New St, Melbourne VIC 3000' WHERE id='a'").run();
    assert.deepEqual(await f.save(first.claims), { saved: 0, ignored: 1 });
    const next = await f.claim();
    assert.equal(next.claims.length, 2);
    assert.ok(next.claims.some(claim => claim.address.startsWith("2 New St")));
  } finally { f.close(); }
});

test("a malformed result rejects the entire batch before any database update", async () => {
  const f = fixture();
  try {
    f.add("a"); f.add("b");
    const { claims } = await f.claim();
    for (const bad of [null, {}, { status: "located", position: { lat: NaN, lng: 144 }, approximate: false },
      { status: "located", position: { lat: 51, lng: 0 }, approximate: false },
      { status: "located", position: { lat: -37, lng: 144 }, approximate: "false" },
      { status: "unlocated", reason: "quota" }, { status: "error", reason: "zero_results" }]) {
      await assert.rejects(saveTradeMapLocations(f.db, "owner", f.dataset(), [
        { ...claims[0], result: located }, { ...claims[1], result: bad },
      ], { now: NOW }), TradeMapLocationInputError);
    }
    assert.ok(f.cache().every(row => row.status === "pending"));
    assert.throws(() => parseTradeMapLocationResults([]), TradeMapLocationInputError);
    assert.throws(() => parseTradeMapLocationResults(Array(21).fill({ ...claims[0], result: located })), TradeMapLocationInputError);
    assert.throws(() => parseTradeMapLocationResults(Array(2).fill({ ...claims[0], result: located })), TradeMapLocationInputError);
    await assert.rejects(f.claim({ limit: 21 }), TradeMapLocationInputError);
  } finally { f.close(); }
});

test("quota errors release leases, pause further batches and retry without storing a false missing address", async () => {
  const f = fixture();
  try {
    f.add("a"); f.add("b");
    const first = await f.claim({ limit: 1 });
    await f.save(first.claims, { status: "error", reason: "quota" });
    assert.equal(f.cache()[0].status, "error");
    assert.equal(f.cache()[0].expires_at, "");
    assert.equal(f.cache()[0].lease_token, "");
    assert.deepEqual(await f.claim(), { claims: [], retryAfterMs: 15 * 60 * 1000 });
    const next = await f.claim({ now: later(15 * 60 * 1000) });
    assert.equal(next.claims.length, 2);
    await f.save(next.claims, located, { now: later(15 * 60 * 1000) });
    assert.ok(f.cache().every(row => row.status === "located"));
  } finally { f.close(); }
});

test("confirmed unlocated addresses are reused without charging for every map reopening", async () => {
  const f = fixture();
  try {
    f.add("a");
    await f.save((await f.claim()).claims, { status: "unlocated", reason: "zero_results" });
    assert.deepEqual(await f.claim(), { claims: [], retryAfterMs: 0 });
    const row = f.cache()[0];
    assert.equal(row.status, "unlocated"); assert.equal(row.lat, null); assert.equal(row.reason, "zero_results");
  } finally { f.close(); }
});

test("50,000 records use a bounded claim and one authorized batch update with indexed cache lookups", async context => {
  const f = fixture();
  try {
    f.sqlite.exec("BEGIN");
    for (let i = 0; i < 50_000; i++) f.add(String(i).padStart(6, "0"));
    f.sqlite.exec("COMMIT");
    const started = performance.now();
    const claimed = await f.claim({ limit: 20 });
    assert.equal(claimed.claims.length, 20);
    assert.ok(JSON.stringify(claimed).length < 8000);
    const beforeSave = f.queries.length;
    assert.deepEqual(await f.save(claimed.claims), { saved: 20, ignored: 0 });
    assert.equal(f.queries.length - beforeSave, 1, "authorize the 50,000-record dataset only once per save batch");
    const second = await f.claim({ limit: 20 });
    assert.equal(second.claims.length, 20);
    assert.equal(new Set([...claimed.claims, ...second.claims].map(c => c.addressKey)).size, 40);
    const claimSql = f.queries.find(q => q.sql.includes("INSERT INTO trade_map_location_cache"));
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${claimSql.sql}`).all(...claimSql.values).map(row => row.detail).join("\n");
    assert.match(plan, /records_owner_idx/);
    assert.match(plan, /sqlite_autoindex_trade_map_location_cache_1/);
    context.diagnostic(`50,000-row claim, atomic save and next claim completed in ${(performance.now() - started).toFixed(1)} ms locally.`);
  } finally { f.close(); }
});

test("reopening a fully cached 50,000-record business claims nothing and expiry cleanup uses its index", async context => {
  const f = fixture();
  try {
    f.sqlite.exec("BEGIN");
    for (let i = 0; i < 50_000; i++) f.add(String(i).padStart(6, "0"));
    f.sqlite.prepare(`INSERT INTO trade_map_location_cache(owner_uid,address_key,address,status,lat,lng,checked_at,expires_at)
      SELECT owner_uid,lower(trim(address)),address,'located',-37.81,144.96,?,? FROM records`).run(NOW, later(TRADE_MAP_LOCATION_TTL_MS));
    f.sqlite.exec("COMMIT");
    const start = performance.now();
    assert.deepEqual(await f.claim(), { claims: [], retryAfterMs: 0 });
    const purge = f.queries.find(q => q.sql.includes("SET status='pending', lat=NULL"));
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${purge.sql}`).all(...purge.values).map(row => row.detail).join("\n");
    assert.match(plan, /trade_map_location_cache_expiry_idx/);
    context.diagnostic(`Fully cached 50,000-row reopening completed in ${(performance.now() - start).toFixed(1)} ms locally with zero claims.`);
  } finally { f.close(); }
});
