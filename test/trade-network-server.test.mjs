import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as contract from "../src/lib/trade-network.ts";
import * as serviceAreaMatching from "../src/lib/trade-service-area-matching.mjs";
import * as australianPostcodes from "../src/lib/australian-postcodes.mjs";

const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = compile("../src/lib/trade-network-server.ts");
const accessContract = {};
Function("require", "exports", compile("../src/lib/trade-access-server.ts"))(() => ({}), accessContract);
const geography = {};
Function("require", "exports", compile("../src/lib/postcode-distance.ts"))(() => ({ default: JSON.parse(fs.readFileSync(new URL("../src/data/postcode-centroids.json", import.meta.url), "utf8")) }), geography);
const owner = (ownerUid = "owner-a", changes = {}) => ({ ownerUid, actorUid: ownerUid, memberId: `${ownerUid}-member`, isOwner: true, canManageJobs: true, jobScope: "team", ...changes });
const input = (changes = {}) => ({ kind: "work", title: "Plumber wanted", trade: "Plumbing", suburb: "Richmond", postcode: "3121", state: "VIC", details: "Install a hot water system", rateCents: 9000, rateUnit: "hour", startsOn: "", endsOn: "", ...changes });
const contact = { name: "Pat", email: "pat@example.com", phone: "0400000000" };
const enquiry = postId => ({ id: crypto.randomUUID(), postId, message: "We can help next week.", contact, confirmSharing: true });
function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec(`CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_name TEXT, partner_type TEXT, account_status TEXT, verification_status TEXT,
    abn TEXT, verified_abn TEXT, verification_review_id TEXT, verification_reviewed_at TEXT, verification_reviewed_by_uid TEXT, email TEXT, phone TEXT, address_line_1 TEXT,
    service_states TEXT DEFAULT '["VIC"]',availability_status TEXT DEFAULT 'open',postcode TEXT DEFAULT '3121',service_base_postcode TEXT DEFAULT '3121',service_radius_km INTEGER DEFAULT 50);
    CREATE TABLE trade_account_service_areas (id TEXT PRIMARY KEY,firebase_uid TEXT,position INTEGER,postcode TEXT,radius_km INTEGER,record_status TEXT);
    CREATE TABLE trade_account_verification_reviews (id TEXT PRIMARY KEY, firebase_uid TEXT, abn TEXT, business_name TEXT, partner_type TEXT, decision TEXT, review_method TEXT, reviewed_by_uid TEXT, reviewed_at TEXT);`);
  sql.exec(fs.readFileSync(new URL("../drizzle/0201_trade_network.sql", import.meta.url), "utf8"));
  sql.exec(fs.readFileSync(new URL("../drizzle/0202_trade_network_leads.sql", import.meta.url), "utf8"));
  function register(key) {
    sql.prepare("INSERT INTO trade_accounts (firebase_uid,business_name,partner_type,account_status,verification_status,abn,verified_abn,verification_review_id,verification_reviewed_at,verification_reviewed_by_uid,email,phone,address_line_1) VALUES (?,?, 'installer','active','approved','51824753556','51824753556',?,'2026-01-01','admin',?,?,?)").run(`owner-${key}`, `Business ${key}`, `review-${key}`, `private-${key}@example.com`, "0411222333", "12 Private Street");
    sql.prepare("INSERT INTO trade_account_verification_reviews VALUES (?,?, '51824753556',?,'installer','approved','official_abr_lookup','admin','2026-01-01')").run(`review-${key}`, `owner-${key}`, `Business ${key}`);
  }
  for (const key of ["a", "b", "c"]) register(key);
  let beforeWrite;
  const db = { prepare(statement) { return { bind(...values) { return {
    async first() { return sql.prepare(statement).get(...values) ?? null; },
    async all() { return { results: sql.prepare(statement).all(...values) }; },
    async run() { if (beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; hook(statement); } return { meta: { changes: Number(sql.prepare(statement).run(...values).changes) } }; },
  }; } }; }, async batch(statements) { sql.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec("COMMIT"); return results; } catch (error) { sql.exec("ROLLBACK"); throw error; } } };
  const server = {}, dependencies = { "../../db": { getD1: () => db }, "./trade-network": contract, "./trade-access-server": accessContract,
    "./postcode-distance": geography, "./australian-postcodes.mjs": australianPostcodes, "./trade-service-area-matching.mjs": serviceAreaMatching };
  Function("require", "exports", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, server);
  return { sql, server, register, beforeWrite(hook) { beforeWrite = hook; }, async enable(...keys) { for (const key of keys) await server.setNetworkMembership(owner(`owner-${key}`), true); }, async post(key = "a", data = input()) { return server.saveNetworkPost(owner(`owner-${key}`), crypto.randomUUID(), 0, data); } };
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
  await h.post("a", input({ title: "100%_special" }));
  for (let i = 1; i < 20; i++) await h.post();
  await assert.rejects(h.post(), { code: "NETWORK_POST_LIMIT" });
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
  h.beforeWrite(() => h.beforeWrite(() => h.sql.exec("UPDATE trade_account_service_areas SET postcode='2000' WHERE id='area-b'")));
  const post = await h.post();
  assert.equal(h.sql.prepare("SELECT COUNT(*) count FROM trade_network_leads").get().count, 0);
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads.length, 0);
  h.sql.exec("UPDATE trade_account_service_areas SET postcode='3121' WHERE id='area-b'");
  assert.equal((await h.server.listNetwork(owner("owner-b"))).leads[0].id, post.id);
});
test("interrupted delivery retries reconcile the saved post instead of duplicating it", async t => {
  const h = fixture(t); await h.enable("a", "b"); await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]);
  const id = crypto.randomUUID();
  h.beforeWrite(() => h.beforeWrite(() => { throw new Error("Temporary D1 failure"); }));
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
test("received-lead pagination keeps all matches and exact notifications can open beyond page one", async t => {
  const h = fixture(t); h.register("d"); await h.enable("a", "b", "c", "d");
  await h.server.setNetworkAvailability(owner("owner-b"), true, ["Plumbing"]);
  const ids = [];
  for (const key of ["a", "c", "d"]) for (let i = 0; i < 20; i++) ids.push((await h.post(key, input({ title: `Work ${key}-${i}` }))).id);
  const first = await h.server.listNetwork(owner("owner-b")), second = await h.server.listNetwork(owner("owner-b"), { leadsOffset: 50 });
  assert.equal(first.leads.length, 50); assert.equal(first.leadsHasMore, true); assert.equal(first.leadCount, 60);
  assert.equal(second.leads.length, 10); assert.equal(second.leadsHasMore, false); assert.equal(second.leadCount, 60);
  assert.equal(new Set([...first.leads, ...second.leads].map(lead => lead.id)).size, 60);
  const exact = await h.server.listNetwork(owner("owner-b"), { leadPostId: ids[0] });
  assert.deepEqual(exact.leads.map(lead => lead.id), [ids[0]]);
  assert.equal((await h.server.listNetworkLeadNotifications(owner("owner-b"))).length, 50);
});
