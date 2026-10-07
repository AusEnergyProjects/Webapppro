import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { Miniflare } from "miniflare";
import * as portal from "../src/lib/portal-team-workspace.ts";
import * as boundedBody from "../src/lib/bounded-request-body.mjs";

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
const contract = load("../src/lib/council-connect.ts", { "./portal-team-workspace": portal });
const server = load("../src/lib/council-connect-server.ts", { "./portal-team-workspace": portal, "./council-connect": contract });
const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const message = (index = 1, recipientId = "editor", body = "Can we review next week's information session?") => ({ action: "send", id: uuid(index), recipientId, body });
function request(body, { councilId = "owned", origin = "https://example.test", contentType = "application/json", peerId, before, search } = {}) {
  const url = new URL("https://example.test/api/council/connect");
  for (const [key, value] of Object.entries({ councilId, peerId, before, search })) if (value !== undefined) url.searchParams.set(key, value);
  return new Request(url, { method: body === undefined ? "GET" : "POST", headers: { ...(origin === null ? {} : { Origin: origin }), "Content-Type": contentType }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
}

test("Council message contract validates content, request identity and precise action fields", () => {
  assert.equal(contract.parseCouncilConnectAction(message(1, "editor", " Hello\nthere ")).body, "Hello\nthere");
  for (const value of [null, [], {}, { ...message(), councilId: "other" }, { ...message(), senderId: "someone" }, { ...message(), id: "bad" }, { ...message(), recipientId: "../other" }, { ...message(), body: " " }, { ...message(), body: "x".repeat(4001) }, { ...message(), body: "a\u0000b" }, { action: "read", peerId: "editor", messageId: uuid(1), readAt: "tomorrow" }, { action: "delete", peerId: "editor", messageId: uuid(1) }]) assert.throws(() => contract.parseCouncilConnectAction(value), portal.PortalTeamError);
  assert.deepEqual(contract.councilConnectCursor(`2026-10-07T00:00:00.000Z|${uuid(1)}`), { createdAt: "2026-10-07T00:00:00.000Z", id: uuid(1) });
  for (const value of ["bad", `2026-02-30T00:00:00.000Z|${uuid(1)}`, `2026-10-07T00:00:00.000Z|${uuid(1)}|ignored`]) assert.throws(() => contract.councilConnectCursor(value), portal.PortalTeamError);
});

test("conversation refresh merges overlapping pages without duplicating messages", () => {
  const a = { id: uuid(1), body: "one", createdAt: "2026-10-07T00:00:00.000Z" };
  const b = { id: uuid(2), body: "two", createdAt: a.createdAt };
  const c = { id: uuid(3), body: "three", createdAt: "2026-10-07T00:00:01.000Z" };
  assert.deepEqual(contract.mergeCouncilConnectMessages([a, b], [b, c]), [a, b, c]);
});

test("Council Connect route and tenant permissions execute against Cloudflare D1", async t => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2025-04-01", d1Databases: { DB: "council-connect-regression" }, port: 0 });
  try {
    const db = await runtime.getD1Database("DB");
    await db.prepare("CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY)").run();
    for (const path of ["../drizzle/0250_council_workspace.sql", "../drizzle/0255_council_team_messages.sql"]) for (const sql of read(path).split("--> statement-breakpoint")) if (sql.trim()) await db.prepare(sql).run();
    let identity; let beforeStatement;
    const wrapStatement = (statement, sql) => ({
      bind: (...values) => wrapStatement(statement.bind(...values), sql),
      run: async () => { if (beforeStatement?.matches(sql)) { const effect = beforeStatement.effect; beforeStatement = null; await effect(); } return statement.run(); },
      all: (...args) => statement.all(...args), first: (...args) => statement.first(...args),
    });
    const wrapped = { prepare: sql => wrapStatement(db.prepare(sql), sql) };
    const access = load("../src/lib/council-access-server.ts", { "../../db": { getD1: () => wrapped }, "./firebase-server": { requireFirebaseIdentity: async () => { if (!identity) throw new Error("AUTH_REQUIRED"); return identity; } } });
    const route = load("../src/app/api/council/connect/route.ts", { "@/lib/council-access-server": access, "@/lib/council-connect-server": server, "@/lib/council-connect": contract, "@/lib/portal-team-workspace": portal, "@/lib/bounded-request-body.mjs": boundedBody });
    const as = (member = "owner") => { identity = { uid: `${member}-uid`, email: `${member}@council.example`, emailVerified: true }; };
    const reset = async () => {
      as(); beforeStatement = null;
      await db.prepare("DROP TRIGGER council_team_messages_no_delete").run();
      await db.batch(["council_team_message_reads", "council_team_messages", "council_memberships", "council_organisations"].map(table => db.prepare(`DELETE FROM ${table}`)));
      await db.prepare("CREATE TRIGGER council_team_messages_no_delete BEFORE DELETE ON council_team_messages BEGIN SELECT RAISE(ABORT,'COUNCIL_MESSAGE_IMMUTABLE'); END").run();
      await db.batch([
        db.prepare("INSERT INTO council_organisations(id,name,slug,state,status,created_at,updated_at) VALUES ('owned','Our council','our-council','VIC','active','2026-10-07','2026-10-07'),('other','Other council','other-council','VIC','active','2026-10-07','2026-10-07')"),
        db.prepare(`INSERT INTO council_memberships(id,council_id,firebase_uid,email,display_name,role,status,invited_by_uid,accepted_at,created_at,updated_at) VALUES
          ('owner','owned','owner-uid','owner@council.example','Owner','owner','active','admin','2026-10-07','2026-10-07','2026-10-07'),
          ('editor','owned','editor-uid','editor@council.example','Editor','editor','active','admin','2026-10-07','2026-10-07','2026-10-07'),
          ('viewer','owned','viewer-uid','viewer@council.example','Viewer','viewer','active','admin','2026-10-07','2026-10-07','2026-10-07'),
          ('pending','owned',NULL,'pending@council.example','Pending','viewer','active','admin',NULL,'2026-10-07','2026-10-07'),
          ('suspended','owned','suspended-uid','suspended@council.example','Suspended','editor','suspended','admin','2026-10-07','2026-10-07','2026-10-07'),
          ('outsider','other','outsider-uid','outsider@council.example','Other','owner','active','admin','2026-10-07','2026-10-07','2026-10-07')`),
      ]);
    };
    const post = async body => route.POST(request(body));
    const directory = async options => { const response = await route.GET(request(undefined, options)); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).directory; };
    const conversation = async (peerId, before) => { const response = await route.GET(request(undefined, { peerId, before })); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).conversation; };
    const count = async () => (await db.prepare("SELECT count(*) n FROM council_team_messages").first()).n;
    const seed = (id, sender = "editor", recipient = "owner", at = "2026-10-07T00:00:00.000Z", council = "owned") => db.prepare("INSERT INTO council_team_messages(id,council_id,sender_id,recipient_id,sender_name,body,created_at) VALUES (?,?,?,?,?,'Fixture message',?)").bind(uuid(id), council, sender, recipient, sender, at).run();

    await t.test("directory only reveals accepted active colleagues within the chosen council", async () => {
      await reset(); const result = await directory();
      assert.deepEqual(result.people.map(person => person.id), ["editor", "viewer"]); assert.equal(result.memberId, "owner");
      assert.equal(result.unread, 0); assert.equal(result.hasMore, false);
      const response = await route.GET(request()); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("Vary"), "Authorization");
      assert.doesNotMatch(await response.text(), /owner-uid|editor-uid|outsider|pending|suspended/);
      assert.deepEqual((await directory({ search: "vIeW" })).people.map(person => person.id), ["viewer"]);
      assert.equal((await route.GET(request(undefined, { councilId: "other" }))).status, 403);
    });
    await t.test("all accepted Council roles can collaborate, but strangers and pending invitations cannot", async () => {
      await reset(); as("viewer"); assert.equal((await post(message(1))).status, 200); as("editor"); assert.equal((await post(message(2, "owner"))).status, 200);
      as(); for (const recipient of ["outsider", "pending", "suspended", "unknown"]) assert.equal((await post(message(3, recipient))).status, 403);
      assert.equal((await post(message(4, "owner"))).status, 400); assert.equal(await count(), 2);
      as("suspended"); assert.equal((await route.GET(request())).status, 403);
      identity = null; assert.equal((await route.GET(request())).status, 401);
      as(); identity.emailVerified = false; assert.equal((await post(message(9))).status, 403);
    });
    await t.test("message sends are idempotent under concurrent retries and preserve immutable content", async () => {
      await reset(); const results = await Promise.all([post(message()), post(message())]);
      for (const response of results) assert.equal(response.status, 200, await response.clone().text()); assert.equal(await count(), 1);
      assert.equal((await post(message())).status, 200); assert.equal(await count(), 1);
      assert.equal((await post(message(1, "editor", "Different body"))).status, 409);
      assert.equal((await post(message(1, "viewer"))).status, 409);
      assert.equal((await conversation("editor")).messages[0].body, message().body);
      await assert.rejects(db.prepare("UPDATE council_team_messages SET body='changed'").run(), /COUNCIL_MESSAGE_IMMUTABLE/);
      await assert.rejects(db.prepare("DELETE FROM council_team_messages").run(), /COUNCIL_MESSAGE_IMMUTABLE/);
    });
    await t.test("conversation history is participant-scoped even for the Council owner", async () => {
      await reset(); as("viewer"); await post(message(1)); as();
      assert.equal((await conversation("editor")).messages.length, 0, "Owners cannot read other colleagues' direct messages");
      for (const peerId of ["outsider", "pending", "suspended", "owner", "unknown"]) assert.equal((await route.GET(request(undefined, { peerId }))).status, 404);
      as("editor"); assert.equal((await conversation("viewer")).messages.length, 1);
    });
    await t.test("pagination includes tied timestamps exactly once, newest pages first", async () => {
      await reset(); for (let i = 1; i <= 53; i++) await seed(i);
      const first = await conversation("editor"); assert.equal(first.messages.length, 50); assert.equal(first.hasMore, true); assert.equal(first.messages[0].id, uuid(4));
      const second = await conversation("editor", first.before); assert.equal(second.hasMore, false); assert.deepEqual(second.messages.map(item => item.id), [uuid(1), uuid(2), uuid(3)]);
      assert.equal(new Set([...first.messages, ...second.messages].map(item => item.id)).size, 53);
      assert.equal((await route.GET(request(undefined, { peerId: "editor", before: "invalid" }))).status, 400);
    });
    await t.test("read watermarks only advance to an incoming message the caller explicitly saw", async () => {
      await reset(); await seed(1); await seed(2); await seed(3, "owner", "editor");
      assert.equal((await directory()).unread, 2);
      assert.equal((await post({ action: "read", peerId: "editor", messageId: uuid(1) })).status, 200); assert.equal((await directory()).unread, 1);
      assert.equal((await post({ action: "read", peerId: "editor", messageId: uuid(2) })).status, 200); assert.equal((await directory()).unread, 0);
      assert.equal((await post({ action: "read", peerId: "editor", messageId: uuid(1) })).status, 200); assert.equal((await directory()).unread, 0, "An older tab cannot move the seen watermark backwards");
      assert.equal((await post({ action: "read", peerId: "editor", messageId: uuid(3) })).status, 404, "Own outgoing messages cannot mark incoming messages read");
      assert.equal((await post({ action: "read", peerId: "viewer", messageId: uuid(2) })).status, 404);
      assert.equal((await post({ action: "read", peerId: "editor", messageId: uuid(999) })).status, 404);
      await seed(4); assert.equal((await directory()).unread, 1);
    });
    await t.test("a message arriving during a read acknowledgement remains unread", async () => {
      await reset(); await seed(1);
      beforeStatement = { matches: sql => sql.includes("INSERT INTO council_team_message_reads"), effect: () => seed(2) };
      assert.equal((await post({ action: "read", peerId: "editor", messageId: uuid(1) })).status, 200);
      assert.equal((await directory()).unread, 1);
    });
    await t.test("sender/recipient revocation and Council suspension at the write boundary fail closed", async () => {
      for (const sql of ["UPDATE council_memberships SET status='suspended' WHERE id='owner'", "UPDATE council_memberships SET status='suspended' WHERE id='editor'", "UPDATE council_organisations SET status='suspended' WHERE id='owned'"]) {
        await reset(); beforeStatement = { matches: value => value.includes("INSERT INTO council_team_messages("), effect: () => db.prepare(sql).run() };
        assert.equal((await post(message())).status, 403); assert.equal(await count(), 0);
      }
    });
    await t.test("read acknowledgements cannot bypass revoked membership", async () => {
      await reset(); await seed(1);
      beforeStatement = { matches: sql => sql.includes("INSERT INTO council_team_message_reads"), effect: () => db.prepare("UPDATE council_memberships SET status='suspended' WHERE id='owner'").run() };
      assert.equal((await post({ action: "read", peerId: "editor", messageId: uuid(1) })).status, 403);
      assert.equal((await db.prepare("SELECT count(*) n FROM council_team_message_reads").first()).n, 0);
    });
    await t.test("cross-council foreign keys prevent inserting a different Council's sender or recipient", async () => {
      await reset(); await assert.rejects(seed(1, "outsider"), /FOREIGN KEY/); await assert.rejects(seed(2, "editor", "outsider"), /FOREIGN KEY/); assert.equal(await count(), 0);
    });
    await t.test("same-origin, JSON, body bounds and exact action contracts reject hostile requests", async () => {
      await reset(); for (const origin of [null, "https://hostile.test"]) assert.equal((await route.POST(request(message(), { origin }))).status, 403);
      assert.equal((await route.GET(request(undefined, { origin: "https://hostile.test" }))).status, 403);
      assert.equal((await route.POST(request(message(), { contentType: "text/plain" }))).status, 415);
      assert.equal((await post("{" )).status, 400); assert.equal((await post("x".repeat(contract.COUNCIL_CONNECT_MAX_BODY_BYTES + 1))).status, 413);
      assert.equal((await post({ ...message(), councilId: "other" })).status, 400); assert.equal(await count(), 0);
    });
  } finally { await runtime.dispose(); }
});
