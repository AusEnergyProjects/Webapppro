import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as contract from "../src/lib/trade-network.ts";

const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = compile("../src/lib/trade-network-server.ts");
const accessContract = {};
Function("require", "exports", compile("../src/lib/trade-access-server.ts"))(() => ({}), accessContract);
const owner = (ownerUid = "owner-a", changes = {}) => ({ ownerUid, actorUid: ownerUid, memberId: `${ownerUid}-member`, isOwner: true, canManageJobs: true, jobScope: "team", ...changes });
const input = (changes = {}) => ({ kind: "work", title: "Plumber wanted", trade: "Plumbing", suburb: "Richmond", postcode: "3121", state: "VIC", details: "Install a hot water system", rateCents: 9000, rateUnit: "hour", startsOn: "", endsOn: "", ...changes });
const contact = { name: "Pat", email: "pat@example.com", phone: "0400000000" };
const enquiry = postId => ({ id: crypto.randomUUID(), postId, message: "We can help next week.", contact, confirmSharing: true });
function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec(`CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_name TEXT, partner_type TEXT, account_status TEXT, verification_status TEXT,
    abn TEXT, verified_abn TEXT, verification_review_id TEXT, verification_reviewed_at TEXT, verification_reviewed_by_uid TEXT, email TEXT, phone TEXT, address_line_1 TEXT);
    CREATE TABLE trade_account_verification_reviews (id TEXT PRIMARY KEY, firebase_uid TEXT, abn TEXT, business_name TEXT, partner_type TEXT, decision TEXT, review_method TEXT, reviewed_by_uid TEXT, reviewed_at TEXT);`);
  sql.exec(fs.readFileSync(new URL("../drizzle/0201_trade_network.sql", import.meta.url), "utf8"));
  for (const key of ["a", "b", "c"]) {
    sql.prepare("INSERT INTO trade_accounts VALUES (?,?, 'installer','active','approved','51824753556','51824753556',?,'2026-01-01','admin',?,?,?)").run(`owner-${key}`, `Business ${key}`, `review-${key}`, `private-${key}@example.com`, "0411222333", "12 Private Street");
    sql.prepare("INSERT INTO trade_account_verification_reviews VALUES (?,?, '51824753556',?,'installer','approved','official_abr_lookup','admin','2026-01-01')").run(`review-${key}`, `owner-${key}`, `Business ${key}`);
  }
  let beforeWrite;
  const db = { prepare(statement) { return { bind(...values) { return {
    async first() { return sql.prepare(statement).get(...values) ?? null; },
    async all() { return { results: sql.prepare(statement).all(...values) }; },
    async run() { if (beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; hook(); } return { meta: { changes: Number(sql.prepare(statement).run(...values).changes) } }; },
  }; } }; }, async batch(statements) { sql.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec("COMMIT"); return results; } catch (error) { sql.exec("ROLLBACK"); throw error; } } };
  const server = {}, dependencies = { "../../db": { getD1: () => db }, "./trade-network": contract, "./trade-access-server": accessContract };
  Function("require", "exports", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, server);
  return { sql, server, beforeWrite(hook) { beforeWrite = hook; }, async enable(...keys) { for (const key of keys) await server.setNetworkMembership(owner(`owner-${key}`), true); }, async post(key = "a", data = input()) { return server.saveNetworkPost(owner(`owner-${key}`), crypto.randomUUID(), 0, data); } };
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
