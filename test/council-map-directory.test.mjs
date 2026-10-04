import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { transformSync } from "esbuild";
import { postcodeCoordinate } from "../src/lib/postcode-distance.ts";
import { verifiedTradeAccountPredicate } from "../src/lib/trade-account-predicates.ts";
import { savedEnergyServiceIds } from "../src/lib/energy-service-catalogue.mjs";
import { isValidAbn } from "../src/lib/trade-abn.ts";

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
const directory = load("../src/lib/council-map-directory-server.ts", {
  "./postcode-distance": { postcodeCoordinate }, "./energy-service-catalogue.mjs": { savedEnergyServiceIds },
  "./trade-account-predicates": { verifiedTradeAccountPredicate },
});

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = read("../db/schema.ts");
  for (const name of ["trade_accounts", "trade_account_verification_reviews"]) {
    const start = schema.indexOf(`sqliteTable("${name}", {`);
    const block = schema.slice(start, schema.indexOf("}, (table)", start));
    const columns = [...block.matchAll(/(text|integer|real)\("([a-z_0-9]+)"/g)];
    sqlite.exec(`CREATE TABLE ${name} (${columns.map(([, type, key]) => `${key} ${type === "text" ? "TEXT DEFAULT ''" : "INTEGER DEFAULT 0"}`).join(",")})`);
  }
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY);");
  for (const statement of read("../drizzle/0250_council_workspace.sql").split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
  sqlite.exec(`INSERT INTO council_organisations VALUES ('owned','Owned Council','owned-council','VIC','active','now','now'),('other','Other Council','other-council','VIC','active','now','now');
    INSERT INTO council_postcodes VALUES ('owned','VIC','3175','admin','now'),('other','VIC','3805','admin','now');
    INSERT INTO council_memberships(id,council_id,firebase_uid,email,role,status,invited_by_uid,created_at,updated_at)
      VALUES ('member','owned','member-uid','member@example.test','viewer','active','admin','now','now');`);
  const insert = (table, values) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  let abn = 51000000000;
  let beforeDirectoryRead = null;
  let afterDirectoryRead = null;
  const account = (id, overrides = {}) => {
    while (!isValidAbn(String(++abn))) {}
    const values = { firebase_uid: id, abn: String(abn), verified_abn: String(abn), business_name: `${id} Electrical`,
      suburb: "Dandenong", postcode: "3175", address_state: "VIC", partner_type: "installer", account_status: "active",
      verification_status: "approved", verification_review_id: `review-${id}`, verification_reviewed_at: "2026-09-01",
      verification_reviewed_by_uid: "reviewer", capabilities: '["hot-water","solar","private-credential","solar"]',
      business_website: "https://example.test/business", address_line_1: "PRIVATE STREET", phone: "PRIVATE PHONE", email: "PRIVATE EMAIL",
      contact_name: "PRIVATE CONTACT", ...overrides };
    insert("trade_accounts", values);
    insert("trade_account_verification_reviews", { id: `review-${id}`, firebase_uid: id, abn: String(abn),
      business_name: values.business_name, partner_type: values.partner_type, decision: "approved", review_method: "official_abr_lookup",
      reviewed_at: "2026-09-01", reviewed_by_uid: "reviewer" });
  };
  const statement = (sql, bindings = []) => ({
    bind: (...values) => statement(sql, values), first: async () => sqlite.prepare(sql).get(...bindings) || null,
    all: async () => {
      const isDirectory = sql.includes("COUNT(*) OVER() total_count");
      if (isDirectory) { const hook = beforeDirectoryRead; beforeDirectoryRead = null; hook?.(); }
      const results = sqlite.prepare(sql).all(...bindings);
      if (isDirectory) { const hook = afterDirectoryRead; afterDirectoryRead = null; hook?.(); }
      return { results };
    },
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }),
  });
  const db = { prepare: statement };
  let identity = { uid: "member-uid", email: "member@example.test", emailVerified: true };
  const access = load("../src/lib/council-access-server.ts", {
    "../../db": { getD1: () => db }, "./firebase-server": { requireFirebaseIdentity: async () => { if (!identity) throw new Error("AUTH_REQUIRED"); return identity; } },
  });
  const route = load("../src/app/api/council/map/route.ts", {
    "@/lib/council-access-server": access, "@/lib/council-map-directory-server": directory,
    "@/lib/trade-map-configuration": { tradeMapConfiguration: () => ({ configured: true, apiKey: "public-browser-key", mapId: "owned-map-id" }) },
  });
  return { sqlite, db, account, route, setIdentity: value => { identity = value; },
    beforeDirectoryRead: hook => { beforeDirectoryRead = hook; }, afterDirectoryRead: hook => { afterDirectoryRead = hook; }, close: () => sqlite.close() };
}
const request = (councilId = "owned", origin) => new Request(`https://example.test/api/council/map?councilId=${councilId}`, { headers: origin ? { Origin: origin } : {} });

test("automatic directory includes only approved active real installer businesses in approved council postcodes", async () => {
  const f = fixture();
  try {
    f.account("local"); f.account("outside", { postcode: "3805" }); f.account("wrong-state", { address_state: "NSW" });
    f.account("synthetic", { is_synthetic: 1 }); f.account("supplier", { partner_type: "supplier" });
    f.account("suspended", { account_status: "suspended" }); f.account("pending", { verification_status: "under_review" });
    f.account("unreviewed"); f.sqlite.exec("DELETE FROM trade_account_verification_reviews WHERE firebase_uid='unreviewed'");
    f.account("mismatched"); f.sqlite.exec("UPDATE trade_accounts SET verified_abn='00000000000' WHERE firebase_uid='mismatched'");
    const result = await directory.councilMapDirectory(f.db, "owned", "member-uid");
    assert.deepEqual(result.trades.map(trade => trade.name), ["local Electrical"]);
    assert.equal(result.coverage.totalMatchingListings, 1);
    assert.equal(result.trades[0].postcode, "3175");
    assert.deepEqual(result.trades[0].position, { lat: postcodeCoordinate("3175")[0], lng: postcodeCoordinate("3175")[1] });
    assert.deepEqual(result.trades[0].capabilities, ["hot-water", "solar"]);
  } finally { f.close(); }
});

test("map route denies unauthenticated, unverified, other-council and revoked memberships before exposing settings", async () => {
  const f = fixture();
  try {
    f.account("local");
    assert.equal((await f.route.GET(request("other"))).status, 403);
    assert.equal((await f.route.GET(request("owned", "https://hostile.test"))).status, 403);
    f.setIdentity(null); const denied = await f.route.GET(request());
    assert.equal(denied.status, 401); assert.equal((await denied.text()).includes("public-browser-key"), false);
    f.setIdentity({ uid: "member-uid", email: "member@example.test", emailVerified: false });
    assert.equal((await f.route.GET(request())).status, 403);
    f.setIdentity({ uid: "member-uid", email: "member@example.test", emailVerified: true });
    const response = await f.route.GET(request()); assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("Vary"), "Authorization");
    f.sqlite.exec("UPDATE council_memberships SET status='suspended'");
    assert.equal((await f.route.GET(request())).status, 403);
  } finally { f.close(); }
});

test("directory projection never exposes account identifiers, contacts, street addresses or certificate/customer details", async () => {
  const f = fixture();
  try {
    f.account("private-owner-uid", { business_name: "Local Electrical" });
    const first = await directory.councilMapDirectory(f.db, "owned", "member-uid");
    const repeated = await directory.councilMapDirectory(f.db, "owned", "member-uid");
    const item = first.trades[0];
    assert.deepEqual(Object.keys(item).sort(), ["id", "name", "suburb", "postcode", "state", "capabilities", "website", "position"].sort());
    assert.match(item.id, /^business-[a-f0-9]{64}$/); assert.equal(item.id, repeated.trades[0].id);
    const body = JSON.stringify(item);
    for (const privateValue of ["PRIVATE STREET", "PRIVATE PHONE", "PRIVATE EMAIL", "PRIVATE CONTACT", "private-owner-uid", '"firebase_uid"', '"abn"', '"customer"']) assert.equal(body.includes(privateValue), false);
    assert.notEqual(item.id, "private-owner-uid");
    f.sqlite.exec("INSERT INTO council_postcodes VALUES ('other','VIC','3175','admin','now')");
    f.sqlite.exec(`INSERT INTO council_memberships(id,council_id,firebase_uid,email,role,status,invited_by_uid,created_at,updated_at)
      VALUES ('other-member','other','other-member-uid','other@example.test','viewer','active','admin','now','now')`);
    assert.notEqual((await directory.councilMapDirectory(f.db, "other", "other-member-uid")).trades[0].id, item.id);
  } finally { f.close(); }
});

test("approval, business geography and council scope changes remove listings on the next read", async () => {
  const f = fixture();
  try {
    f.account("local");
    f.sqlite.exec("UPDATE trade_account_verification_reviews SET decision='rejected'");
    assert.equal((await directory.councilMapDirectory(f.db, "owned", "member-uid")).trades.length, 0);
    f.sqlite.exec("UPDATE trade_account_verification_reviews SET decision='approved'; UPDATE trade_accounts SET postcode='3805'");
    assert.equal((await directory.councilMapDirectory(f.db, "owned", "member-uid")).trades.length, 0);
    f.sqlite.exec("UPDATE trade_accounts SET postcode='3175'; DELETE FROM council_postcodes WHERE council_id='owned'");
    assert.equal((await directory.councilMapDirectory(f.db, "owned", "member-uid")).trades.length, 0);
    f.sqlite.exec("INSERT INTO council_postcodes VALUES ('owned','VIC','3175','admin','now'); UPDATE council_organisations SET status='suspended' WHERE id='owned'");
    assert.equal((await directory.councilMapDirectory(f.db, "owned", "member-uid")).trades.length, 0);
    assert.equal((await f.route.GET(request())).status, 403);
  } finally { f.close(); }
});

test("missing centroids remain listed without an invented pin and unsafe websites are omitted", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("INSERT INTO council_postcodes VALUES ('owned','VIC','3010','admin','now')");
    f.account("no-centroid", { postcode: "3010", business_website: "javascript:alert(1)", capabilities: "invalid-json" });
    f.account("credentials-url", { business_website: "https://private:password@example.test/" });
    const result = await directory.councilMapDirectory(f.db, "owned", "member-uid");
    assert.equal(result.coverage.unlocatedTrades, 1);
    assert.equal(result.trades.find(item => item.postcode === "3010").position, null);
    assert.deepEqual(result.trades.find(item => item.postcode === "3010").capabilities, []);
    assert.ok(result.trades.every(item => item.website === null));
  } finally { f.close(); }
});

test("directory bound is honest about totals and empty councils stay empty", async () => {
  const f = fixture();
  try {
    assert.deepEqual((await directory.councilMapDirectory(f.db, "owned", "member-uid")).trades, []);
    for (let index = 0; index < 501; index++) f.account(`business-${String(index).padStart(4, "0")}`);
    const result = await directory.councilMapDirectory(f.db, "owned", "member-uid");
    assert.equal(result.trades.length, 500); assert.equal(result.coverage.totalMatchingListings, 501);
    assert.equal(result.coverage.truncated, true); assert.equal(result.coverage.limit, 500);
  } finally { f.close(); }
});

test("directory failures return a generic unavailable response without leaking database details", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("DROP TABLE trade_accounts");
    const response = await f.route.GET(request());
    assert.equal(response.status, 503); assert.equal((await response.text()).includes("trade_accounts"), false);
  } finally { f.close(); }
});

test("directory SQL requires the current actor's active membership in the same council", async () => {
  const f = fixture();
  try {
    f.account("local");
    assert.equal((await directory.councilMapDirectory(f.db, "owned", "other-actor")).trades.length, 0);
    f.beforeDirectoryRead(() => f.sqlite.exec("UPDATE council_memberships SET status='suspended' WHERE id='member'"));
    assert.equal((await directory.councilMapDirectory(f.db, "owned", "member-uid")).trades.length, 0);
  } finally { f.close(); }
});

test("map reads cannot expose listings after revocation while the directory query is awaiting", async () => {
  for (const moment of ["beforeDirectoryRead", "afterDirectoryRead"]) {
    const f = fixture();
    try {
      f.account("private-listing");
      f[moment](() => f.sqlite.exec("UPDATE council_memberships SET status='suspended' WHERE id='member'"));
      const response = await f.route.GET(request());
      assert.equal(response.status, 403, moment);
      assert.doesNotMatch(await response.text(), /private-listing|public-browser-key|owned-map-id/);
    } finally { f.close(); }
  }
});

test("map reads reject a changed reporting area before returning former scope listings", async () => {
  const f = fixture();
  try {
    f.account("private-listing");
    f.afterDirectoryRead(() => f.sqlite.exec("DELETE FROM council_postcodes WHERE council_id='owned'"));
    const response = await f.route.GET(request());
    assert.equal(response.status, 409);
    assert.doesNotMatch(await response.text(), /private-listing|public-browser-key/);
  } finally { f.close(); }
});
