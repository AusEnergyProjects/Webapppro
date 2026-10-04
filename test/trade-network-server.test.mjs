import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as contract from "../src/lib/trade-network.ts";
import * as serviceAreaMatching from "../src/lib/trade-service-area-matching.mjs";
import * as australianPostcodes from "../src/lib/australian-postcodes.mjs";
import * as australianDates from "../src/lib/creditex-australian-regulator-date.ts";
import * as accountPredicates from "../src/lib/trade-account-predicates.ts";

const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = compile("../src/lib/trade-network-server.ts");
const accessContract = {};
Function("require", "exports", compile("../src/lib/trade-access-server.ts"))((id) => id === "./trade-account-predicates" ? accountPredicates : {}, accessContract);
const geography = {};
Function("require", "exports", compile("../src/lib/postcode-distance.ts"))(() => ({ default: JSON.parse(fs.readFileSync(new URL("../src/data/postcode-centroids.json", import.meta.url), "utf8")) }), geography);
const owner = (ownerUid = "owner-a", changes = {}) => ({ ownerUid, actorUid: ownerUid, memberId: `${ownerUid}-member`, isOwner: true, canManageJobs: true, jobScope: "team", ...changes });
const input = (changes = {}) => ({ kind: "work", title: "Plumber wanted", trade: "Plumbing", suburb: "Richmond", postcode: "3121", state: "VIC", details: "Install a hot water system", rateCents: 9000, rateUnit: "hour", startsOn: "", endsOn: "", ...changes });
const contact = { name: "Pat", email: "pat@example.com", phone: "0400000000" };
const enquiry = postId => ({ id: crypto.randomUUID(), postId, message: "We can help next week.", contact, confirmSharing: true });
function serverFor(db) {
  const server = {}, dependencies = { "../../db": { getD1: () => db }, "./trade-network": contract, "./trade-access-server": accessContract,
    "./postcode-distance": geography, "./australian-postcodes.mjs": australianPostcodes, "./trade-service-area-matching.mjs": serviceAreaMatching, "./creditex-australian-regulator-date": australianDates };
  Function("require", "exports", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, server);
  return server;
}
function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec(`CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_name TEXT, partner_type TEXT, account_status TEXT, verification_status TEXT,
    abn TEXT, verified_abn TEXT, verification_review_id TEXT, verification_reviewed_at TEXT, verification_reviewed_by_uid TEXT, email TEXT, phone TEXT, address_line_1 TEXT,
    service_states TEXT DEFAULT '["VIC"]',availability_status TEXT DEFAULT 'open',postcode TEXT DEFAULT '3121',service_base_postcode TEXT DEFAULT '3121',service_radius_km INTEGER DEFAULT 50);
    CREATE TABLE trade_account_service_areas (id TEXT PRIMARY KEY,firebase_uid TEXT,position INTEGER,postcode TEXT,radius_km INTEGER,record_status TEXT);
    CREATE TABLE trade_account_verification_reviews (id TEXT PRIMARY KEY, firebase_uid TEXT, abn TEXT, business_name TEXT, partner_type TEXT, decision TEXT, review_method TEXT, reviewed_by_uid TEXT, reviewed_at TEXT);`);
  sql.exec(fs.readFileSync(new URL("../drizzle/0201_trade_network.sql", import.meta.url), "utf8"));
  sql.exec(fs.readFileSync(new URL("../drizzle/0202_trade_network_leads.sql", import.meta.url), "utf8"));
  sql.exec(fs.readFileSync(new URL("../drizzle/0203_trade_network_minimum_rates.sql", import.meta.url), "utf8"));
  function register(key) {
    sql.prepare("INSERT INTO trade_accounts (firebase_uid,business_name,partner_type,account_status,verification_status,abn,verified_abn,verification_review_id,verification_reviewed_at,verification_reviewed_by_uid,email,phone,address_line_1) VALUES (?,?, 'installer','active','approved','51824753556','51824753556',?,'2026-01-01','admin',?,?,?)").run(`owner-${key}`, `Business ${key}`, `review-${key}`, `private-${key}@example.com`, "0411222333", "12 Private Street");
    sql.prepare("INSERT INTO trade_account_verification_reviews VALUES (?,?, '51824753556',?,'installer','approved','official_abr_lookup','admin','2026-01-01')").run(`review-${key}`, `owner-${key}`, `Business ${key}`);
  }
  for (const key of ["a", "b", "c"]) register(key);
  let beforeWrite, transactionQueue = Promise.resolve();
  const db = { prepare(statement) { return { bind(...values) { return {
    async first() { return sql.prepare(statement).get(...values) ?? null; },
    async all() { return { results: sql.prepare(statement).all(...values) }; },
    async run() { if (beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; hook(statement); } return { meta: { changes: Number(sql.prepare(statement).run(...values).changes) } }; },
  }; } }; }, batch(statements) {
    const result = transactionQueue.then(async () => { sql.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec("COMMIT"); return results; } catch (error) { sql.exec("ROLLBACK"); throw error; } });
    transactionQueue = result.catch(() => {}); return result;
  } };
  const server = serverFor(db);
  return { sql, server, register, beforeWrite(hook) { beforeWrite = hook; }, beforeDelivery(hook) { beforeWrite = function pending(statement) { if (statement.startsWith("INSERT INTO trade_network_leads")) hook(); else beforeWrite = pending; }; }, async enable(...keys) { for (const key of keys) await server.setNetworkMembership(owner(`owner-${key}`), true); }, async post(key = "a", data = input()) { return server.saveNetworkPost(owner(`owner-${key}`), crypto.randomUUID(), 0, data); } };
}
test("network is off by default and only an owner can opt in", async t => {
  const h = fixture(t);
  assert.equal((await h.server.listNetwork(owner())).enabled, false);
  await assert.rejects(h.post(), { code: "NETWORK_DISABLED" });
  const manager = owner("owner-a", { isOwner: false, actorUid: "manager" });
  await assert.rejects(h.server.setNetworkMembership(manager, true), { code: "NETWORK_ACCESS_REQUIRED" });
  await h.enable("a");
  assert.equal((await h.server.listNetwork(manager)).enabled, true);
  assert.equal((await h.server.saveNetworkPost(manager, crypto.randomUUID(), 0, input())).businessName, "Business a");
  for (const changes of [{ isOwner: false, jobScope: "own" }, { isOwner: false, canManageJobs: false }, { fieldSessionId: "field" }]) await assert.rejects(h.server.listNetwork(owner("owner-a", changes)), { code: "NETWORK_ACCESS_REQUIRED" });
});
test("feed exposes only allowlisted business and listing fields and enforces ownership", async t => {
  const h = fixture(t); await h.enable("a", "b", "c");
  const post = await h.post("a", { ...input(), ownerUid: "owner-b", customerId: "private" });
  assert.equal((await h.server.listNetwork(owner())).posts.length, 0);
  const view = await h.server.listNetwork(owner("owner-b"));
  assert.equal(view.posts[0].businessName, "Business a");
  assert.doesNotMatch(JSON.stringify(view.posts), /owner-a|private-a|0411222333|Private Street|customerId|ownerUid/);
  await assert.rejects(h.server.saveNetworkPost(owner("owner-b"), post.id, 1, input()), { code: "NETWORK_UNAVAILABLE" });
  await assert.rejects(h.server.changeNetworkPost(owner("owner-b"), "close_post", post.id, 1), { code: "NETWORK_UNAVAILABLE" });
  assert.equal((await h.server.listNetwork(owner("owner-c"))).myPosts.length, 0);
});
test("private enquiry and explicit connection only disclose each party's entered contact", async t => {
  const h = fixture(t); await h.enable("a", "b", "c"); const post = await h.post();
  const request = enquiry(post.id), sent = await h.server.createNetworkEnquiry(owner("owner-b"), request);
  assert.equal(sent.direction, "outgoing"); assert.equal(sent.recipientContact, null);
  assert.deepEqual(sent.senderContact, contact);
  const inbox = (await h.server.listNetwork(owner())).enquiries;
  assert.equal(inbox[0].direction, "incoming"); assert.deepEqual(inbox[0].senderContact, contact);
  assert.equal((await h.server.listNetwork(owner("owner-c"))).enquiries.length, 0);
  await assert.rejects(h.server.changeNetworkEnquiry(owner("owner-c"), "connect", { id: sent.id, expectedRevision: 1, contact, confirmSharing: true }), { code: "NETWORK_UNAVAILABLE" });
  await assert.rejects(h.server.changeNetworkEnquiry(owner("owner-b"), "connect", { id: sent.id, expectedRevision: 1, contact, confirmSharing: true }), { code: "NETWORK_UNAVAILABLE" });
  await assert.rejects(h.server.changeNetworkEnquiry(owner(), "connect", { id: sent.id, expectedRevision: 1, contact }), { code: "NETWORK_INVALID" });
  const shared = { name: "Alex", email: "business@example.com", phone: "" };
  const connected = await h.server.changeNetworkEnquiry(owner(), "connect", { id: sent.id, expectedRevision: 1, contact: shared, confirmSharing: true });
  assert.deepEqual(connected.recipientContact, shared); assert.equal(connected.status, "connected");
  assert.equal((await h.server.createNetworkEnquiry(owner("owner-b"), request)).id, sent.id);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).enquiries[0].recipientContact.email, shared.email);
});
test("opt-out atomically closes listings and blocks new enquiries while retaining private history", async t => {
  const h = fixture(t); await h.enable("a", "b", "c"); const post = await h.post();
  await h.server.createNetworkEnquiry(owner("owner-b"), enquiry(post.id));
  await h.server.setNetworkMembership(owner(), false);
  assert.equal(h.sql.prepare("SELECT status FROM trade_network_posts WHERE id=?").get(post.id).status, "closed");
  assert.equal((await h.server.listNetwork(owner("owner-c"))).posts.length, 0);
  await assert.rejects(h.server.createNetworkEnquiry(owner("owner-c"), enquiry(post.id)), { code: "NETWORK_UNAVAILABLE" });
  assert.equal((await h.server.listNetwork(owner())).enquiries.length, 1);
  await h.enable("a");
  assert.equal((await h.server.listNetwork(owner("owner-c"))).posts.length, 0);
  const renewed = await h.server.changeNetworkPost(owner(), "renew_post", post.id, 2);
  assert.equal(renewed.status, "active");
});
test("write guards reject opt-out and account revocation races", async t => {
  const h = fixture(t); await h.enable("a", "b"); const post = await h.post();
  h.beforeWrite(() => h.sql.prepare("UPDATE trade_network_members SET enabled=0 WHERE owner_uid='owner-a'").run());
  await assert.rejects(h.server.createNetworkEnquiry(owner("owner-b"), enquiry(post.id)), { code: "NETWORK_UNAVAILABLE" });
  await h.enable("a");
  h.beforeWrite(() => h.sql.prepare("UPDATE trade_accounts SET account_status='closed' WHERE firebase_uid='owner-a'").run());
  await assert.rejects(h.server.saveNetworkPost(owner(), post.id, 1, input({ title: "Cannot update" })), { code: "NETWORK_CONFLICT" });
  assert.equal(h.sql.prepare("SELECT title FROM trade_network_posts WHERE id=?").get(post.id).title, "Plumber wanted");
  assert.equal((await h.server.listNetwork(owner("owner-b"))).posts.length, 0);
});
test("review revocation, supplier accounts, invalid ABN and expired posts are unavailable", async t => {
  const h = fixture(t); await h.enable("a", "b"); const post = await h.post();
  h.sql.prepare("UPDATE trade_network_posts SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(post.id);
  assert.equal((await h.server.listNetwork(owner())).myPosts[0].status, "expired");
  assert.equal((await h.server.listNetwork(owner("owner-b"))).posts.length, 0);
  await assert.rejects(h.server.createNetworkEnquiry(owner("owner-b"), enquiry(post.id)), { code: "NETWORK_UNAVAILABLE" });
  for (const statement of ["UPDATE trade_accounts SET partner_type='supplier' WHERE firebase_uid='owner-b'", "UPDATE trade_accounts SET partner_type='installer', abn='00000000000', verified_abn='00000000000' WHERE firebase_uid='owner-b'", "UPDATE trade_accounts SET abn='51824753556',verified_abn='51824753556', verification_review_id='missing' WHERE firebase_uid='owner-b'"]) {
    h.sql.exec(statement); await assert.rejects(h.server.listNetwork(owner("owner-b")), { code: "NETWORK_ACCESS_REQUIRED" });
  }
});
test("post save, close and renew retries are idempotent and stale revisions fail", async t => {
  const h = fixture(t); await h.enable("a"); const id = crypto.randomUUID();
  const post = await h.server.saveNetworkPost(owner(), id, 0, input());
  assert.deepEqual(await h.server.saveNetworkPost(owner(), id, 0, input()), post);
  const changed = await h.server.saveNetworkPost(owner(), id, 1, input({ title: "Updated" }));
  assert.equal(changed.revision, 2);
  assert.deepEqual(await h.server.saveNetworkPost(owner(), id, 1, input({ title: "Updated" })), changed);
  await assert.rejects(h.server.saveNetworkPost(owner(), id, 1, input({ title: "Stale" })), { code: "NETWORK_CONFLICT" });
  h.beforeWrite(() => h.sql.prepare("UPDATE trade_network_posts SET revision=revision+1 WHERE id=?").run(id));
  await assert.rejects(h.server.saveNetworkPost(owner(), id, 2, input()), { code: "NETWORK_CONFLICT" });
  const closed = await h.server.changeNetworkPost(owner(), "close_post", id, 3);
  assert.deepEqual(await h.server.changeNetworkPost(owner(), "close_post", id, 3), closed);
  const renewed = await h.server.changeNetworkPost(owner(), "renew_post", id, 4);
  assert.deepEqual(await h.server.changeNetworkPost(owner(), "renew_post", id, 4), renewed);
  assert.equal(renewed.status, "active");
});
test("enquiries are unique per business and post, cannot target self, and connect guards peer opt-out", async t => {
  const h = fixture(t); await h.enable("a", "b"); const post = await h.post();
  await assert.rejects(h.server.createNetworkEnquiry(owner(), enquiry(post.id)), { code: "NETWORK_UNAVAILABLE" });
  const request = enquiry(post.id), sent = await h.server.createNetworkEnquiry(owner("owner-b"), request);
  assert.equal((await h.server.createNetworkEnquiry(owner("owner-b"), { ...request, id: crypto.randomUUID() })).id, sent.id);
  await assert.rejects(h.server.createNetworkEnquiry(owner("owner-b"), { ...request, message: "Different enquiry" }), { code: "NETWORK_ALREADY_ENQUIRED" });
  h.beforeWrite(() => h.sql.prepare("UPDATE trade_network_members SET enabled=0 WHERE owner_uid='owner-b'").run());
  await assert.rejects(h.server.changeNetworkEnquiry(owner(), "connect", { id: sent.id, expectedRevision: 1, contact, confirmSharing: true }), { code: "NETWORK_CONFLICT" });
  const closed = await h.server.changeNetworkEnquiry(owner(), "close_enquiry", { id: sent.id, expectedRevision: 1 });
  assert.equal(closed.status, "closed"); assert.equal(closed.recipientContact, null);
});
test("listing limits are atomic and literal searches do not broaden the directory", async t => {
  const h = fixture(t); await h.enable("a", "b");
  await h.post("a", input({ title: "100%_special", kind: "available" }));
  for (let i = 1; i < 20; i++) await h.post("a", input({ kind: "available" }));
  await assert.rejects(h.post("a", input({ kind: "available" })), { code: "NETWORK_POST_LIMIT" });
  const found = await h.server.listNetwork(owner("owner-b"), { search: "%_" });
  assert.equal(found.posts.length, 1); assert.equal(found.posts[0].title, "100%_special");
  assert.equal((await h.server.listNetwork(owner("owner-b"), { trade: "Electrical" })).posts.length, 0);
});
test("work publication automatically persists one private lead for matching opted-in available trades", async t => {
  const h = fixture(t); await h.enable("a", "b", "c");
  assert.equal((await h.server.listNetwork(owner("owner-b"))).availability.openToWork, false);
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]);
  await h.server.setNetworkAvailability(owner("owner-c"), true, ["Electrical"]);
  const post = await h.post();
  const rows = h.sql.prepare("SELECT * FROM trade_network_leads").all();
  assert.equal(rows.length, 1); assert.equal(rows[0].recipient_owner_uid, "owner-b"); assert.equal(rows[0].post_id, post.id);
  const inbox = await h.server.listNetwork(owner("owner-b"));
  assert.equal(inbox.leadCount, 1); assert.equal(inbox.leads[0].id, post.id); assert.equal(inbox.leads[0].leadStatus, "new");
  assert.doesNotMatch(JSON.stringify(inbox.leads), /owner-a|private-a|Private Street|0411222333|senderContact|recipientContact/);
  assert.equal((await h.server.listNetwork(owner("owner-c"))).leads.length, 0);
  const notifications = await h.server.listNetworkLeadNotifications(owner("owner-b"));
  assert.equal(notifications[0].id, post.id); assert.match(notifications[0].summary, /Richmond/);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_enquiries").get().count, 0);
});
test("availability is explicit, scoped, catches up existing work and leaving does not silently re-enable it", async t => {
  const h = fixture(t); await h.enable("a", "b"); const post = await h.post();
  await assert.rejects(h.server.setNetworkAvailability(owner("owner-c"), true, ["Plumbing"]), { code: "NETWORK_DISABLED" });
  for (const changes of [{ isOwner: false, jobScope: "own" }, { isOwner: false, canManageJobs: false }, { fieldSessionId: "field" }]) {
    await assert.rejects(h.server.setNetworkAvailability(owner("owner-b", changes), true, ["Plumbing"]), { code: "NETWORK_ACCESS_REQUIRED" });
    assert.deepEqual(await h.server.listNetworkLeadNotifications(owner("owner-b", changes)), []);
  }
  await h.server.setNetworkAvailability(owner("owner-b", { isOwner: false, actorUid: "manager" }), true, ["Plumbing"]);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads[0].id, post.id);
  await h.server.setNetworkMembership(owner("owner-b"), false); await h.enable("b");
  const resumed = await h.server.listNetwork(owner("owner-b"));
  assert.equal(resumed.availability.openToWork, false); assert.equal(resumed.leadCount, 0);
  assert.deepEqual(await h.server.listNetworkLeadNotifications(owner("owner-b")), []);
});
test("all configured service areas qualify and current coverage changes hide stale matches", async t => {
  const h = fixture(t); await h.enable("a", "b");
  h.sql.exec("INSERT INTO trade_account_service_areas VALUES ('first','owner-b',1,'2000',10,'active'),('second','owner-b',2,'3000',10,'active')");
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]); const post = await h.post();
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leadCount, 1);
  h.sql.exec("UPDATE trade_account_service_areas SET record_status='inactive' WHERE id='second'");
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leadCount, 0);
  assert.deepEqual(await h.server.listNetworkLeadNotifications(owner("owner-b")), []);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads WHERE post_id=?").get(post.id).count, 1);
  h.sql.exec("UPDATE trade_account_service_areas SET postcode='bad' WHERE id='first'");
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads.length, 0);
  h.sql.exec("UPDATE trade_account_service_areas SET record_status='inactive' WHERE id='first'");
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leadCount, 1, "no active centres uses the existing legacy base/radius");
});
test("matching stops for paused, wrong-state, opted-out, revoked recipient or withdrawn author", async t => {
  const h = fixture(t); await h.enable("a", "b"); await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]); const post = await h.post();
  for (const [change, restore] of [
    ["UPDATE trade_accounts SET availability_status='paused' WHERE firebase_uid='owner-b'", "UPDATE trade_accounts SET availability_status='limited' WHERE firebase_uid='owner-b'"],
    ["UPDATE trade_accounts SET service_states='[\"NSW\"]' WHERE firebase_uid='owner-b'", "UPDATE trade_accounts SET service_states='[\"VIC\"]' WHERE firebase_uid='owner-b'"],
    ["UPDATE trade_network_members SET open_to_work=0 WHERE owner_uid='owner-b'", "UPDATE trade_network_members SET open_to_work=1 WHERE owner_uid='owner-b'"],
    ["UPDATE trade_network_members SET enabled=0 WHERE owner_uid='owner-a'", "UPDATE trade_network_members SET enabled=1 WHERE owner_uid='owner-a'"],
    ["UPDATE trade_accounts SET verification_review_id='missing' WHERE firebase_uid='owner-a'", "UPDATE trade_accounts SET verification_review_id='review-a' WHERE firebase_uid='owner-a'"],
  ]) {
    h.sql.exec(change); assert.equal((await h.server.listNetwork(owner("owner-b"))).leadCount, 0); assert.deepEqual(await h.server.listNetworkLeadNotifications(owner("owner-b")), []);
    h.sql.exec(restore); assert.equal((await h.server.listNetwork(owner("owner-b"))).leadCount, 1);
  }
  h.sql.exec("UPDATE trade_accounts SET verification_review_id='missing' WHERE firebase_uid='owner-b'");
  assert.deepEqual(await h.server.listNetworkLeadNotifications(owner("owner-b")), []);
  await assert.rejects(h.server.listNetwork(owner("owner-b")), { code: "NETWORK_ACCESS_REQUIRED" });
  h.sql.exec("UPDATE trade_accounts SET verification_review_id='review-b' WHERE firebase_uid='owner-b'");
  await h.server.changeNetworkPost(owner(), "close_post", post.id, post.revision);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads.length, 0);
});
test("post edits update matching recipients without duplicate or resurrected dismissed leads", async t => {
  const h = fixture(t); await h.enable("a", "b", "c");
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]); await h.server.setNetworkAvailability(owner("owner-c"), true, ["Electrical"]);
  const post = await h.post();
  await h.server.setNetworkLeadStatus(owner("owner-b"), post.id, "dismissed");
  await h.server.saveNetworkPost(owner(), post.id, 1, input({ trade: "Electrical" }));
  assert.equal((await h.server.listNetwork(owner("owner-c"))).leadCount, 1);
  await h.server.saveNetworkPost(owner(), post.id, 2, input());
  await h.server.changeNetworkPost(owner(), "renew_post", post.id, 3);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads.length, 0);
  assert.equal((await h.server.listNetwork(owner("owner-c"))).leads.length, 0);
  assert.equal(h.sql.prepare("SELECT status FROM trade_network_leads WHERE post_id=? AND recipient_owner_uid='owner-b'").get(post.id).status, "dismissed");
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads WHERE post_id=?").get(post.id).count, 2);
});
test("enquiry marks only its own matching lead viewed and exact links never return another lead", async t => {
  const h = fixture(t); await h.enable("a", "b", "c"); await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]);
  const first = await h.post(), second = await h.post();
  await assert.rejects(h.server.setNetworkLeadStatus(owner("owner-c"), first.id, "dismissed"), { code: "NETWORK_UNAVAILABLE" });
  const exact = await h.server.listNetwork(owner("owner-b"), { leadPostId: first.id, leadsOffset: 500 });
  assert.deepEqual(exact.leads.map(item => item.id), [first.id]);
  assert.equal((await h.server.listNetwork(owner("owner-b"), { leadPostId: crypto.randomUUID() })).leads.length, 0);
  await h.server.createNetworkEnquiry(owner("owner-b"), enquiry(first.id));
  const inbox = await h.server.listNetwork(owner("owner-b")); assert.equal(inbox.leadCount, 1);
  assert.equal(inbox.leads.find(item => item.id === first.id).leadStatus, "viewed"); assert.equal(inbox.leads.find(item => item.id === second.id).leadStatus, "new");
  await h.server.setNetworkLeadStatus(owner("owner-b"), first.id, "dismissed");
  assert.equal((await h.server.listNetwork(owner("owner-b"), { leadPostId: first.id })).leads.length, 0);
});
test("a changed service-area snapshot blocks queued delivery and read catch-up recovers missed matches", async t => {
  const h = fixture(t); await h.enable("a", "b"); await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]);
  h.sql.exec("INSERT INTO trade_account_service_areas VALUES ('area-b','owner-b',1,'3121',10,'active')");
  h.beforeDelivery(() => h.sql.exec("UPDATE trade_account_service_areas SET postcode='2000' WHERE id='area-b'"));
  const post = await h.post();
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads").get().count, 0);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads.length, 0);
  h.sql.exec("UPDATE trade_account_service_areas SET postcode='3121' WHERE id='area-b'");
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads[0].id, post.id);
});
test("interrupted delivery retries reconcile the saved post instead of duplicating it", async t => {
  const h = fixture(t); await h.enable("a", "b"); await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]);
  const id = crypto.randomUUID();
  h.beforeDelivery(() => { throw new Error("Temporary D1 failure"); });
  await assert.rejects(h.server.saveNetworkPost(owner(), id, 0, input()), /Temporary D1 failure/);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_posts WHERE id=?").get(id).count, 1);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads WHERE post_id=?").get(id).count, 0);
  await h.server.saveNetworkPost(owner(), id, 0, input());
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_posts WHERE id=?").get(id).count, 1);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads WHERE post_id=?").get(id).count, 1);
});
test("unknown or mismatched postcodes cannot publish and missing service coverage cannot enable work leads", async t => {
  const h = fixture(t); await h.enable("a", "b");
  await assert.rejects(h.post("a", input({ postcode: "0000" })), { code: "NETWORK_INVALID" });
  await assert.rejects(h.post("a", input({ postcode: "2000", state: "VIC" })), { code: "NETWORK_INVALID" });
  h.sql.exec("UPDATE trade_accounts SET service_states='[]' WHERE firebase_uid='owner-b'");
  await assert.rejects(h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]), { code: "NETWORK_SERVICE_AREA_REQUIRED" });
  assert.equal(h.sql.prepare("SELECT open_to_work FROM trade_network_members WHERE owner_uid='owner-b'").get().open_to_work, 0);
});
test("publication reaches every matching business beyond the recipient scan and delivery batch sizes", async t => {
  const h = fixture(t); await h.enable("a", "b", "c");
  const recipients = ["b", "c"];
  for (let i = 0; i < 105; i++) { const key = `recipient-${String(i).padStart(3, "0")}`; h.register(key); await h.enable(key); recipients.push(key); }
  for (const key of recipients) await h.server.setNetworkAvailability(owner(`owner-${key}`), true, ["Plumbing"]);
  const id = crypto.randomUUID(); await h.server.saveNetworkPost(owner(), id, 0, input());
  const delivered = h.sql.prepare("SELECT recipient_owner_uid FROM trade_network_leads WHERE post_id=? ORDER BY recipient_owner_uid").all(id).map(row => row.recipient_owner_uid);
  assert.equal(delivered.length, 107); assert.deepEqual(delivered, recipients.map(key => `owner-${key}`).sort());
  await h.server.saveNetworkPost(owner(), id, 0, input());
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads WHERE post_id=?").get(id).count, 107);
  await h.server.setNetworkLeadStatus(owner("owner-b"), id, "dismissed");
  await h.server.saveNetworkPost(owner(), id, 1, input({ title: "Updated work" }));
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads WHERE post_id=? AND post_revision=2").get(id).count, 107);
  assert.equal(h.sql.prepare("SELECT status FROM trade_network_leads WHERE post_id=? AND recipient_owner_uid='owner-b'").get(id).status, "dismissed");
});

test("minimum rates are private, nullable, bounded and preserved for omitted units and stale clients", async t => {
  const h = fixture(t); await h.enable("a", "b");
  assert.deepEqual((await h.server.listNetwork(owner("owner-b"))).availability.minimumRates, { hour: null, day: null, job: null });
  const minimums = { hour: 9500, day: 75_000, job: 120_000 };
  assert.deepEqual((await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], minimums)).availability.minimumRates, minimums);
  assert.deepEqual((await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"])).availability.minimumRates, minimums);
  assert.deepEqual((await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], { hour: null })).availability.minimumRates, { ...minimums, hour: null });
  h.beforeWrite(() => h.sql.exec("UPDATE trade_network_members SET minimum_day_cents=80000 WHERE owner_uid='owner-b'"));
  assert.deepEqual((await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"])).availability.minimumRates, { hour: null, day: 80_000, job: 120_000 }, "a stale client must not overwrite a concurrently saved minimum");
  await h.post("b", input({ kind: "available" }));
  const other = await h.server.listNetwork(owner());
  assert.deepEqual(other.availability.minimumRates, { hour: null, day: null, job: null });
  assert.doesNotMatch(JSON.stringify(other.posts), /minimum|9500|75000|80000|120000/);
  for (const rate of [0, -1, 1.5, 100_000_001]) {
    await assert.rejects(h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], { job: rate }), { code: "NETWORK_INVALID" });
    assert.throws(() => h.sql.prepare("UPDATE trade_network_members SET minimum_job_cents=? WHERE owner_uid='owner-b'").run(rate), /CHECK constraint failed/);
  }
  await h.server.setNetworkMembership(owner("owner-b"), false); await h.enable("b");
  assert.deepEqual((await h.server.listNetwork(owner("owner-b"))).availability.minimumRates, { hour: null, day: 80_000, job: 120_000 });
});

test("automatic matches compare the exact offered unit inclusively without price conversions", async t => {
  const h = fixture(t); h.register("d"); await h.enable("a", "b", "c", "d");
  const minima = { hour: 9500, day: 80_000, job: 120_000 };
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], minima);
  await h.server.setNetworkAvailability(owner("owner-c"), true, ["Plumbing"], { hour: 100_000_000, day: null, job: null });
  const expected = []; let published = 0;
  for (const rateUnit of ["hour", "day", "job"]) for (const difference of [-1, 0, 1]) {
    const post = await h.post(published++ < 5 ? "a" : "d", input({ rateUnit, rateCents: minima[rateUnit] + difference }));
    if (difference >= 0) expected.push(post.id);
  }
  const cheapDay = await h.post("d", input({ rateUnit: "day", rateCents: 1 }));
  const view = await h.server.listNetwork(owner("owner-b"));
  assert.deepEqual(view.leads.map(lead => lead.id).sort(), expected.sort());
  assert.equal(view.leadCount, 6); assert.equal(view.posts.length, 10, "browse includes all offered rates");
  const unfilteredUnits = await h.server.listNetwork(owner("owner-c"));
  assert.equal(unfilteredUnits.leads.length, 7); assert.ok(unfilteredUnits.leads.some(lead => lead.id === cheapDay.id));
  assert.ok(unfilteredUnits.leads.every(lead => lead.rateUnit !== "hour"), "hour minimum never converts to a day or job minimum");
});

test("changing minimums suppresses old leads, counts, notifications and exact links while browse and enquiry remain available", async t => {
  const h = fixture(t); await h.enable("a", "b");
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]); const post = await h.post();
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leadCount, 1);
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], { hour: 9001 });
  const filtered = await h.server.listNetwork(owner("owner-b"), { leadPostId: post.id });
  assert.deepEqual(filtered.leads, []); assert.equal(filtered.leadCount, 0); assert.equal(filtered.posts[0].id, post.id);
  assert.deepEqual(await h.server.listNetworkLeadNotifications(owner("owner-b")), []);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads").get().count, 1, "history is retained");
  const sent = await h.server.createNetworkEnquiry(owner("owner-b"), enquiry(post.id));
  assert.equal(sent.postId, post.id, "manual enquiry is independent of the automatic lead minimum");
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], { hour: 9000 });
  const eligible = await h.server.listNetwork(owner("owner-b"));
  assert.equal(eligible.leads[0].leadStatus, "viewed"); assert.equal(eligible.leadCount, 0);
  await h.server.setNetworkLeadStatus(owner("owner-b"), post.id, "dismissed");
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], { hour: null });
  await h.server.changeNetworkPost(owner(), "renew_post", post.id, 1);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads.length, 0, "clearing minimums or renewing never resurrects dismissal");
});

test("lowering a minimum reconciles missed leads and price edits reevaluate every recipient without duplicates", async t => {
  const h = fixture(t); await h.enable("a", "b", "c");
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], { hour: 9000 });
  await h.server.setNetworkAvailability(owner("owner-c"), true, ["Plumbing"], { hour: 10_000 });
  const post = await h.post();
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads").get().count, 1);
  await h.server.saveNetworkPost(owner(), post.id, 1, input({ rateCents: 8999 }));
  for (const key of ["b", "c"]) assert.equal((await h.server.listNetwork(owner(`owner-${key}`))).leadCount, 0);
  await h.server.setNetworkAvailability(owner("owner-c"), true, ["Plumbing"], { hour: 8999 });
  assert.equal((await h.server.listNetwork(owner("owner-c"))).leadCount, 1);
  await h.server.saveNetworkPost(owner(), post.id, 2, input({ rateCents: 10_000 }));
  for (const key of ["b", "c"]) assert.equal((await h.server.listNetwork(owner(`owner-${key}`))).leadCount, 1);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads").get().count, 2);
  await h.server.saveNetworkPost(owner(), post.id, 3, input({ rateCents: 1, rateUnit: "job" }));
  for (const key of ["b", "c"]) assert.equal((await h.server.listNetwork(owner(`owner-${key}`))).leadCount, 1, "changing to an unfiltered price unit qualifies");
});

test("a concurrently raised minimum blocks queued delivery and later catch-up honors the latest value", async t => {
  const h = fixture(t); await h.enable("a", "b");
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], { hour: 9000 });
  h.beforeDelivery(() => h.sql.exec("UPDATE trade_network_members SET minimum_hour_cents=9001 WHERE owner_uid='owner-b'"));
  const post = await h.post();
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads").get().count, 0);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leadCount, 0);
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"], { hour: 9000 });
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads[0].id, post.id);
});

test("new and edited work and availability posts require a positive price and explicit unit", async t => {
  const h = fixture(t); await h.enable("a");
  for (const kind of ["work", "available"]) {
    const post = await h.post("a", input({ kind }));
    for (const change of [{ rateCents: null }, { rateCents: undefined }, { rateCents: 0 }, { rateCents: -1 }, { rateUnit: undefined }, { rateUnit: null }]) {
      await assert.rejects(h.post("a", input({ kind, ...change })), { code: "NETWORK_INVALID" });
      await assert.rejects(h.server.saveNetworkPost(owner(), post.id, 1, input({ kind, ...change })), { code: "NETWORK_INVALID" });
    }
    assert.equal(h.sql.prepare("SELECT revision FROM trade_network_posts WHERE id=?").get(post.id).revision, 1);
  }
});

test("legacy null and zero prices stay browsable with private history but never deliver leads or renew until priced", async t => {
  const h = fixture(t); await h.enable("a", "b");
  const legacyPosts = [];
  for (const rateCents of [null, 0]) for (const kind of ["work", "available"]) {
    const post = await h.post("a", input({ kind })); legacyPosts.push(post);
    h.sql.prepare("UPDATE trade_network_posts SET rate_cents=? WHERE id=?").run(rateCents, post.id);
  }
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads").get().count, 0);
  const view = await h.server.listNetwork(owner("owner-b")); assert.equal(view.posts.length, 4); assert.equal(view.leadCount, 0);
  assert.deepEqual(await h.server.listNetworkLeadNotifications(owner("owner-b")), []);
  for (const post of legacyPosts) {
    assert.equal((await h.server.listNetwork(owner("owner-b"), { leadPostId: post.id })).leads.length, 0);
    await assert.rejects(h.server.changeNetworkPost(owner(), "renew_post", post.id, 1), { code: "NETWORK_INVALID" });
    assert.equal((await h.server.createNetworkEnquiry(owner("owner-b"), enquiry(post.id))).postId, post.id);
  }
  const first = legacyPosts[0];
  const closed = await h.server.changeNetworkPost(owner(), "close_post", first.id, 1);
  const priced = await h.server.saveNetworkPost(owner(), first.id, closed.revision, input({ rateCents: 1 }));
  await h.server.changeNetworkPost(owner(), "renew_post", first.id, priced.revision);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads[0].id, first.id);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).enquiries.length, 4);
  h.sql.prepare("UPDATE trade_network_posts SET rate_cents=0 WHERE id=?").run(first.id);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leadCount, 0, "legacy zero also suppresses a previously delivered row");
  assert.deepEqual(await h.server.listNetworkLeadNotifications(owner("owner-b")), []);
});
test("received-lead pagination keeps all matches and exact notifications can open beyond page one", async t => {
  const h = fixture(t); const publishers = Array.from({ length: 12 }, (_, i) => `publisher-${i}`);
  for (const key of publishers) h.register(key);
  await h.enable("b", ...publishers);
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]);
  const ids = [];
  for (const key of publishers) for (let i = 0; i < 5; i++) ids.push((await h.post(key, input({ title: `Work ${key}-${i}` }))).id);
  const first = await h.server.listNetwork(owner("owner-b")), second = await h.server.listNetwork(owner("owner-b"), { leadsOffset: 50 });
  assert.equal(first.leads.length, 50); assert.equal(first.leadsHasMore, true); assert.equal(first.leadCount, 60);
  assert.equal(second.leads.length, 10); assert.equal(second.leadsHasMore, false); assert.equal(second.leadCount, 60);
  assert.equal(new Set([...first.leads, ...second.leads].map(lead => lead.id)).size, 60);
  const exact = await h.server.listNetwork(owner("owner-b"), { leadPostId: ids[0] });
  assert.deepEqual(exact.leads.map(lead => lead.id), [ids[0]]);
  assert.equal((await h.server.listNetworkLeadNotifications(owner("owner-b"))).length, 50);
});

test("five daily work publications are shared by all business staff and retries, edits and availability posts consume nothing extra", async t => {
  const h = fixture(t); await h.enable("a", "b");
  const posts = [];
  for (let i = 0; i < 5; i++) posts.push(await h.server.saveNetworkPost(owner("owner-a", i % 2 ? { isOwner: false, actorUid: "manager" } : {}), crypto.randomUUID(), 0, input()));
  const allowance = (await h.server.listNetwork(owner())).workPostAllowance;
  assert.equal(allowance.limit, 5); assert.equal(allowance.remaining, 0); assert.equal(allowance.timeZone, "Australia/Sydney");
  await assert.rejects(h.post(), { code: "NETWORK_DAILY_WORK_LIMIT", status: 409 });
  const first = posts[0];
  assert.equal((await h.server.saveNetworkPost(owner(), first.id, 0, input())).id, first.id, "successful retry remains usable when allowance is exhausted");
  await h.server.saveNetworkPost(owner(), first.id, 1, input({ title: "Updated work" }));
  const availability = await h.post("a", input({ kind: "available" }));
  await h.server.changeNetworkPost(owner(), "renew_post", availability.id, 1);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_work_publications").get().count, 5);
  await assert.rejects(h.server.saveNetworkPost(owner(), availability.id, 2, input()), { code: "NETWORK_DAILY_WORK_LIMIT" });
  const closed = await h.server.changeNetworkPost(owner(), "close_post", first.id, 2);
  await assert.rejects(h.server.changeNetworkPost(owner(), "renew_post", first.id, closed.revision), { code: "NETWORK_DAILY_WORK_LIMIT" });
  await h.post("b"); assert.equal((await h.server.listNetwork(owner("owner-b"))).workPostAllowance.remaining, 4);
  await h.server.setNetworkMembership(owner(), false);
  assert.equal((await h.server.listNetwork(owner())).workPostAllowance.remaining, 0, "disabled membership retains business allowance metadata");
});

test("work renewal and live availability conversion count once while invalid requests and transactional failure consume no allowance", async t => {
  const h = fixture(t); await h.enable("a");
  await assert.rejects(h.post("a", input({ rateCents: null })), { code: "NETWORK_INVALID" });
  const id = crypto.randomUUID();
  h.beforeWrite(() => h.beforeWrite(() => { throw new Error("Failed to persist publication event"); }));
  await assert.rejects(h.server.saveNetworkPost(owner(), id, 0, input()), /Failed to persist publication event/);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_posts").get().count, 0);
  assert.equal((await h.server.listNetwork(owner())).workPostAllowance.remaining, 5);
  const post = await h.server.saveNetworkPost(owner(), id, 0, input());
  await h.server.changeNetworkPost(owner(), "renew_post", post.id, 1);
  await h.server.changeNetworkPost(owner(), "renew_post", post.id, 1);
  assert.equal((await h.server.listNetwork(owner())).workPostAllowance.remaining, 3);
  const available = await h.post("a", input({ kind: "available" }));
  await h.server.saveNetworkPost(owner(), available.id, 1, input());
  await h.server.saveNetworkPost(owner(), available.id, 1, input());
  assert.equal((await h.server.listNetwork(owner())).workPostAllowance.remaining, 2);
  const closed = await h.server.changeNetworkPost(owner(), "close_post", available.id, 2);
  await h.server.saveNetworkPost(owner(), available.id, closed.revision, input({ title: "Edit closed work" }));
  assert.equal((await h.server.listNetwork(owner())).workPostAllowance.remaining, 2);
});

test("concurrent work submissions and identical retries cannot overspend the daily business allowance", async t => {
  const h = fixture(t); await h.enable("a");
  for (let i = 0; i < 4; i++) await h.post();
  const results = await Promise.allSettled([h.post(), h.post(), h.post()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason.code === "NETWORK_DAILY_WORK_LIMIT"));
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_posts").get().count, 5);
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_work_publications").get().count, 5);
  await h.enable("b"); const id = crypto.randomUUID();
  const same = await Promise.all([h.server.saveNetworkPost(owner("owner-b"), id, 0, input()), h.server.saveNetworkPost(owner("owner-b"), id, 0, input())]);
  assert.equal(same[0].id, same[1].id); assert.equal((await h.server.listNetwork(owner("owner-b"))).workPostAllowance.remaining, 4);
});

test("the work allowance resets at Sydney midnight in standard time and daylight saving", async t => {
  const h = fixture(t); t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-27T13:59:59.000Z") }); await h.enable("a");
  for (let i = 0; i < 5; i++) await h.post();
  let allowance = (await h.server.listNetwork(owner())).workPostAllowance;
  assert.equal(allowance.day, "2026-09-27"); assert.equal(allowance.remaining, 0);
  t.mock.timers.setTime(Date.parse("2026-09-27T14:00:00.000Z"));
  allowance = (await h.server.listNetwork(owner())).workPostAllowance;
  assert.equal(allowance.day, "2026-09-28"); assert.equal(allowance.remaining, 5); await h.post();
  t.mock.timers.setTime(Date.parse("2026-10-04T12:59:59.000Z"));
  for (let i = 0; i < 5; i++) await h.post();
  assert.equal((await h.server.listNetwork(owner())).workPostAllowance.remaining, 0);
  t.mock.timers.setTime(Date.parse("2026-10-04T13:00:00.000Z"));
  allowance = (await h.server.listNetwork(owner())).workPostAllowance;
  assert.equal(allowance.day, "2026-10-05"); assert.equal(allowance.remaining, 5); await h.post();
});

test("D1 batches atomically cap concurrent publications and roll back both post and allowance on failure", async t => {
  const h = fixture(t), { Miniflare } = await import("miniflare");
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };', compatibilityDate: "2025-04-01", d1Databases: { DB: "network-publication-limit-regression" }, port: 0 });
  t.after(() => runtime.dispose()); const db = await runtime.getD1Database("DB");
  const tables = h.sql.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const table of tables) {
    await db.prepare(table.sql).run();
    for (const row of h.sql.prepare(`SELECT * FROM ${table.name}`).all()) {
      const columns = Object.keys(row);
      await db.prepare(`INSERT INTO ${table.name} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...Object.values(row)).run();
    }
  }
  const server = serverFor(db); await server.setNetworkMembership(owner(), true);
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => server.saveNetworkPost(owner(), crypto.randomUUID(), 0, input())));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 5);
  assert.ok(attempts.filter(result => result.status === "rejected").every(result => result.reason.code === "NETWORK_DAILY_WORK_LIMIT"));
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM trade_network_posts").first()).count, 5);
  assert.equal((await server.listNetwork(owner())).workPostAllowance.remaining, 0);
  await server.setNetworkMembership(owner("owner-b"), true);
  let failPublication = true;
  const failing = serverFor({ prepare: statement => db.prepare(statement), batch: statements => {
    if (failPublication) { failPublication = false; return db.batch([...statements, db.prepare("SELECT * FROM deliberately_missing_network_test_table")]); }
    return db.batch(statements);
  } });
  const id = crypto.randomUUID();
  await assert.rejects(failing.saveNetworkPost(owner("owner-b"), id, 0, input()), /deliberately_missing_network_test_table/);
  assert.equal(await db.prepare("SELECT id FROM trade_network_posts WHERE id=?").bind(id).first(), null);
  assert.equal((await server.listNetwork(owner("owner-b"))).workPostAllowance.remaining, 5);
  await failing.saveNetworkPost(owner("owner-b"), id, 0, input());
  assert.equal((await server.listNetwork(owner("owner-b"))).workPostAllowance.remaining, 4);
});
