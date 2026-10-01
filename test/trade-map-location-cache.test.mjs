import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { claimTradeMapLocations, saveTradeMapLocations, locateTradeMapRecords, cleanupExpiredTradeMapLocations,
  TradeMapLocationInputError, TRADE_MAP_LOCATION_LEASE_MS } from "../src/lib/trade-map-location-cache.ts";

const NOW = "2026-10-01T00:00:00.000Z";
const VERSION = "gnaf-aug2026";
const later = (ms) => new Date(Date.parse(NOW) + ms).toISOString();
const located = { status: "located", position: { lat: -37.81, lng: 144.96 }, approximate: true, sourceId: "GAVIC123" };
const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const saveCounts = (saved, ignored = 0) => ({ saved, ignored, located: saved, unlocated: 0 });

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(read("../drizzle/0227_trade_map_location_cache.sql"));
  sqlite.exec(read("../drizzle/0228_trade_map_permanent_locations.sql"));
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
    saveTradeMapLocations(db, owner, source, claims.map(c => ({ ...c, result })), { now: NOW, sourceVersion: VERSION, ...options });
  const lookupCalls = [];
  const directory = { version: VERSION, attribution: "G-NAF", resolve: async addresses => {
    lookupCalls.push(addresses); return addresses.map(() => located);
  } };
  const locate = (options = {}, owner = "owner", source = dataset(owner)) =>
    locateTradeMapRecords(db, owner, source, { directory, now: NOW, ...options });
  const cache = () => sqlite.prepare("SELECT * FROM trade_map_location_cache ORDER BY owner_uid,address_key").all();
  return { db, sqlite, queries, add, dataset, claim, save, cache, directory, lookupCalls, locate, close: () => sqlite.close() };
}

test("same-business duplicate addresses and team devices reuse permanent results with source provenance", async () => {
  const f = fixture();
  try {
    const address = "1 Example St, Melbourne, VIC, 3000, Australia";
    f.add("a", address); f.add("b", address, "owner", "second-staff"); f.add("c", address, "other");
    assert.deepEqual(await f.locate({}, "owner", f.dataset("owner", "staff")),
      { processed: 1, located: 1, unlocated: 0, retryAfterMs: 0, complete: true });
    assert.deepEqual(await f.locate({}, "owner", f.dataset("owner", "second-staff")),
      { processed: 0, located: 0, unlocated: 0, retryAfterMs: 0, complete: true });
    assert.equal(f.lookupCalls.length, 1);
    assert.equal(await cleanupExpiredTradeMapLocations(f.db, "2036-10-01T00:00:00.000Z"), 0);
    assert.equal((await f.locate({ now: "2036-10-01T00:00:00.000Z" })).processed, 0);
    const row = f.cache()[0];
    assert.equal(row.provider, "gnaf"); assert.equal(row.expires_at, "");
    assert.equal(row.source_version, VERSION); assert.equal(row.source_id, located.sourceId);
    assert.equal(row.approximate, 1);
    assert.equal((await f.locate({}, "other")).processed, 1, "a different business has independent records and cache scope");
  } finally { f.close(); }
});

test("concurrent devices atomically claim disjoint bounded batches and cannot replay completed leases", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 40; i++) f.add(String(i));
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.claim({ limit: 5 })));
    const claims = responses.flatMap(response => response.claims);
    assert.equal(claims.length, 40);
    assert.equal(new Set(claims.map(claim => claim.addressKey)).size, 40);
    assert.equal(new Set(claims.map(claim => claim.leaseToken)).size, 8);
    assert.deepEqual(await f.locate(), { processed: 0, located: 0, unlocated: 0, retryAfterMs: TRADE_MAP_LOCATION_LEASE_MS, complete: false });
    assert.equal(f.lookupCalls.length, 0);
    assert.deepEqual(await f.save(claims), saveCounts(40));
    assert.deepEqual(await f.save(claims), saveCounts(0, 40));
  } finally { f.close(); }
});

test("an interrupted batch resumes after its lease; expired tokens cannot overwrite its replacement", async () => {
  const f = fixture();
  try {
    f.add("a");
    const first = await f.claim(), now = later(TRADE_MAP_LOCATION_LEASE_MS);
    assert.deepEqual(await f.save(first.claims, located, { now }), saveCounts(0, 1));
    const next = await f.claim({ now });
    assert.equal(next.claims.length, 1);
    assert.notEqual(next.claims[0].leaseToken, first.claims[0].leaseToken);
    assert.deepEqual(await f.save(first.claims, located, { now }), saveCounts(0, 1));
    assert.deepEqual(await f.save(next.claims, located, { now }), saveCounts(1));
  } finally { f.close(); }
});

test("migration retains legacy Google provenance and expiry; G-NAF never inherits or extends Google coordinates", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(read("../drizzle/0227_trade_map_location_cache.sql"));
    sqlite.prepare(`INSERT INTO trade_map_location_cache(owner_uid,address_key,address,status,lat,lng,checked_at,expires_at)
      VALUES('owner','legacy','Legacy','located',-37.8,144.9,?,?)`).run(NOW, later(29 * 86400000));
    sqlite.exec(read("../drizzle/0228_trade_map_permanent_locations.sql"));
    const row = sqlite.prepare("SELECT * FROM trade_map_location_cache").get();
    assert.equal(row.provider, "google"); assert.equal(row.source_version, ""); assert.equal(row.source_id, "");
    assert.equal(row.expires_at, later(29 * 86400000));
    assert.throws(() => sqlite.exec("UPDATE trade_map_location_cache SET provider='gnaf',expires_at=''"), /CHECK constraint failed/);
    assert.throws(() => sqlite.exec("UPDATE trade_map_location_cache SET expires_at=''"), /CHECK constraint failed/);
  } finally { sqlite.close(); }
  const f = fixture();
  try {
    f.add("a"); f.add("b", undefined, "other");
    f.sqlite.prepare(`INSERT INTO trade_map_location_cache(owner_uid,address_key,address,provider,status,lat,lng,checked_at,expires_at)
      SELECT owner_uid,lower(trim(address)),address,'google','located',-37.8,144.9,?,? FROM records`).run(NOW, later(29 * 86400000));
    assert.equal(await cleanupExpiredTradeMapLocations(f.db, later(29 * 86400000 - 1)), 0);
    assert.equal(await cleanupExpiredTradeMapLocations(f.db, later(29 * 86400000)), 2);
    for (const value of f.cache()) {
      assert.equal(value.provider, "google"); assert.equal(value.lat, null); assert.equal(value.lng, null);
      assert.equal(value.expires_at, ""); assert.equal(value.checked_at, "");
    }
    const purge = f.queries.find(q => q.sql.includes("SET status='pending', lat=NULL"));
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${purge.sql}`).all(...purge.values).map(row => row.detail).join("\n");
    assert.match(plan, /trade_map_location_cache_expiry_idx/);
    assert.equal((await f.locate()).processed, 1);
    assert.equal(f.cache().find(row => row.owner_uid === "owner").provider, "gnaf");
  } finally { f.close(); }
});

test("unexpired Google cache entries are freshly resolved using the owned directory", async () => {
  const f = fixture();
  try {
    f.add("a");
    f.sqlite.prepare(`INSERT INTO trade_map_location_cache(owner_uid,address_key,address,provider,status,lat,lng,checked_at,expires_at)
      SELECT owner_uid,lower(trim(address)),address,'google','located',-35,150,?,? FROM records`).run(NOW, later(29 * 86400000));
    assert.equal((await f.locate()).located, 1);
    assert.equal(f.lookupCalls.length, 1);
    assert.equal(f.cache()[0].lat, located.position.lat);
    assert.equal(f.cache()[0].source_id, located.sourceId);
  } finally { f.close(); }
});

test("staff scope, owner identity, archive and address changes are rechecked before a save", async () => {
  const f = fixture();
  try {
    f.add("a"); f.add("b", undefined, "owner", "someone-else"); f.add("c", undefined, "other");
    const staff = f.dataset("owner", "staff"), first = await f.claim({}, "owner", staff);
    assert.equal(first.claims.length, 1);
    assert.deepEqual(await f.save(first.claims, located, {}, "other"), saveCounts(0, 1));
    f.sqlite.prepare("UPDATE records SET member_id='someone-else' WHERE id='a'").run();
    assert.deepEqual(await f.save(first.claims, located, {}, "owner", staff), saveCounts(0, 1));
    f.sqlite.prepare("UPDATE records SET archived=1 WHERE id='a'").run();
    assert.deepEqual(await f.save(first.claims), saveCounts(0, 1));
    f.sqlite.prepare("UPDATE records SET archived=0,address='2 New St, Melbourne VIC 3000' WHERE id='a'").run();
    assert.deepEqual(await f.save(first.claims), saveCounts(0, 1));
    const next = await f.claim();
    assert.equal(next.claims.length, 2);
    assert.ok(next.claims.some(claim => claim.address.startsWith("2 New St")));
  } finally { f.close(); }
});

test("malformed trusted-directory results reject the entire batch before any database update", async () => {
  const f = fixture();
  try {
    f.add("a"); f.add("b");
    const { claims } = await f.claim();
    for (const bad of [null, {}, { ...located, position: { lat: NaN, lng: 144 } },
      { ...located, position: { lat: 51, lng: 0 } }, { ...located, approximate: "false" },
      { ...located, sourceId: "" }, { status: "unlocated", reason: "quota" }, { status: "error", reason: "zero_results" }]) {
      await assert.rejects(saveTradeMapLocations(f.db, "owner", f.dataset(), [
        { ...claims[0], result: located }, { ...claims[1], result: bad },
      ], { now: NOW, sourceVersion: VERSION }), TradeMapLocationInputError);
    }
    assert.ok(f.cache().every(row => row.status === "pending"));
    await assert.rejects(f.save([]), TradeMapLocationInputError);
    await assert.rejects(f.save(Array(201).fill(claims[0])), TradeMapLocationInputError);
    await assert.rejects(f.save(Array(2).fill(claims[0])), TradeMapLocationInputError);
    await assert.rejects(f.save(claims, located, { sourceVersion: "" }), TradeMapLocationInputError);
    for (const limit of [0, 201, 0.5, NaN, Infinity]) await assert.rejects(f.claim({ limit }), TradeMapLocationInputError);
  } finally { f.close(); }
});

test("directory errors and malformed batches release their exact lease without persisting false missing addresses", async () => {
  const f = fixture();
  try {
    f.add("a"); f.add("b");
    const otherDevice = await f.claim({ limit: 1 });
    const failure = new Error("Directory shard missing");
    await assert.rejects(f.locate({ directory: { ...f.directory, resolve: async () => { throw failure; } } }), failure);
    let rows = f.cache();
    assert.ok(rows.every(row => row.status === "pending" && row.lat === null && row.expires_at === ""));
    assert.equal(rows.filter(row => row.lease_token).length, 1, "another device's in-flight lease stays intact");
    assert.equal(rows.find(row => row.lease_token)?.lease_token, otherDevice.claims[0].leaseToken);
    await assert.rejects(f.locate({ directory: { ...f.directory, resolve: async () => [] } }), TradeMapLocationInputError);
    assert.equal((await f.locate()).processed, 1, "failed work is available for immediate deliberate retry");
    rows = f.cache();
    assert.equal(rows.filter(row => row.status === "located").length, 1);
  } finally { f.close(); }
});

test("an edit while a batch resolves cannot save stale coordinates or stall progress", async () => {
  const f = fixture();
  try {
    f.add("a");
    const result = await f.locate({ directory: { ...f.directory, resolve: async () => {
      f.sqlite.exec("UPDATE records SET address='2 New St Melbourne VIC 3000'"); return [located];
    } } });
    assert.deepEqual(result, { processed: 1, located: 0, unlocated: 0, retryAfterMs: 0, complete: false });
    assert.equal((await f.locate()).located, 1);
  } finally { f.close(); }
});

test("confirmed missing and ambiguous addresses persist and are not retried on each reopening", async () => {
  const f = fixture();
  try {
    f.add("a"); f.add("b");
    const result = await f.locate({ directory: { ...f.directory, resolve: async () => [
      { status: "unlocated", reason: "zero_results" }, { status: "unlocated", reason: "ambiguous" },
    ] } });
    assert.deepEqual(result, { processed: 2, located: 0, unlocated: 2, retryAfterMs: 0, complete: true });
    assert.equal((await f.locate({ now: "2036-10-01T00:00:00.000Z" })).processed, 0);
    assert.deepEqual(f.cache().map(row => row.reason).sort(), ["ambiguous", "zero_results"]);
    assert.ok(f.cache().every(row => row.provider === "gnaf" && row.expires_at === "" && row.source_version === VERSION));
  } finally { f.close(); }
});

test("100,000 synthetic records use bounded claims and one authorised batch update with indexed cache lookups", async context => {
  const f = fixture();
  try {
    f.sqlite.exec(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<100000)
      INSERT INTO records(id,address,owner_uid,member_id) SELECT n,n||' Example St Melbourne VIC 3000','owner','staff' FROM numbers`);
    const started = performance.now(), claimed = await f.claim({ limit: 200 });
    assert.equal(claimed.claims.length, 200);
    assert.ok(JSON.stringify(claimed).length < 50000);
    const beforeSave = f.queries.length;
    assert.deepEqual(await f.save(claimed.claims), saveCounts(200));
    assert.equal(f.queries.length - beforeSave, 1, "authorise the 100,000-record dataset only once per save batch");
    const second = await f.claim({ limit: 200 });
    assert.equal(second.claims.length, 200);
    assert.equal(new Set([...claimed.claims, ...second.claims].map(c => c.addressKey)).size, 400);
    const query = f.queries.find(q => q.sql.includes("INSERT INTO trade_map_location_cache"));
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values).map(row => row.detail).join("\n");
    assert.match(plan, /records_owner_idx/); assert.match(plan, /sqlite_autoindex_trade_map_location_cache_1/);
    context.diagnostic(`100,000 synthetic row claim/save/next claim: ${(performance.now() - started).toFixed(1)} ms. No external address calls.`);
  } finally { f.close(); }
});

test("reopening a fully cached 100,000-record business makes zero directory lookups even years later", async context => {
  const f = fixture();
  try {
    f.sqlite.exec(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<100000)
      INSERT INTO records(id,address,owner_uid,member_id) SELECT n,n||' Example St Melbourne VIC 3000','owner','staff' FROM numbers`);
    f.sqlite.prepare(`INSERT INTO trade_map_location_cache(owner_uid,address_key,address,provider,source_version,source_id,status,lat,lng,checked_at)
      SELECT owner_uid,lower(trim(address)),address,'gnaf',?,'GAVIC'||id,'located',-37.81,144.96,? FROM records`).run(VERSION, NOW);
    const start = performance.now();
    assert.deepEqual(await f.locate({ now: "2036-10-01T00:00:00.000Z" }),
      { processed: 0, located: 0, unlocated: 0, retryAfterMs: 0, complete: true });
    assert.equal(f.lookupCalls.length, 0);
    context.diagnostic(`Fully cached 100,000-row reopening: ${(performance.now() - start).toFixed(1)} ms; zero directory/provider calls.`);
  } finally { f.close(); }
});
