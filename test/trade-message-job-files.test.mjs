import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as boundedBody from "../src/lib/bounded-request-body.mjs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies = {}) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, record, record.exports);
  return record.exports;
}
const pure = load("../src/lib/trade-message-job-files.ts");
const access = load("../src/lib/trade-message-media-access.ts");
const server = load("../src/lib/trade-message-job-files-server.ts", { "./trade-message-media-access": access, "./trade-message-job-files": pure });
const jane = { ownerUid: "owner-a", actorUid: "jane-uid", memberId: "jane", displayName: "Jane", isOwner: false,
  canManageFieldEvidence: true, canViewFieldEvidence: true, jobScope: "own" };
const john = { ...jane, actorUid: "john-uid", memberId: "john", displayName: "John" };
const foreign = { ...jane, ownerUid: "owner-b", actorUid: "foreign-uid", memberId: "foreign" };
const input = { threadId: "thread-a", messageId: "message-a", workOrderId: "job-a" };

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,can_view_field_evidence INTEGER,can_manage_field_evidence INTEGER,job_scope TEXT);
    INSERT INTO trade_team_members VALUES('owner','owner-a','owner-a','active',1,1,'team'),('jane','owner-a','jane-uid','active',1,1,'own'),('john','owner-a','john-uid','active',1,1,'own'),('foreign','owner-b','foreign-uid','active',1,1,'team');
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,work_type TEXT,record_status TEXT,assignee_member_id TEXT,work_number TEXT,revision INTEGER,updated_at TEXT);
    INSERT INTO trade_work_orders VALUES('job-a','owner-a','installer','job','active','jane','TLJ-00000001',1,''),('job-b','owner-a','installer','job','active','john','TLJ-00000002',1,''),('job-x','owner-b','installer','job','active','foreign','TLJ-00000003',1,'');
    CREATE TABLE trade_work_order_events(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,event_type TEXT,summary TEXT,created_at TEXT);
    CREATE TABLE trade_team_sync_changes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,owner_uid TEXT,audience_member_id TEXT,entity_type TEXT,entity_id TEXT,operation TEXT,revision INTEGER,changed_at TEXT);
    CREATE TABLE trade_crm_job_media(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,category TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,object_key TEXT,caption TEXT,source TEXT,evidence_envelope TEXT,original_sha256 TEXT,created_at TEXT,updated_at TEXT);`);
  sqlite.exec(read("../drizzle/0214_trade_messages.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.exec(read("../drizzle/0215_trade_message_media.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.exec(`INSERT INTO trade_message_threads VALUES('thread-a','owner-a','group','Site planning','','owner','thread-request','hash','2026-09-29','2026-09-29');
    INSERT INTO trade_message_participants VALUES('thread-a','owner-a','owner',0),('thread-a','owner-a','jane',0);
    INSERT INTO trade_internal_messages VALUES('message-a','owner-a','thread-a',1,'owner','Original sender','See https://example.com/spec and https://example.com/spec','message-request','2026-09-29T01:02:03.000Z');
    INSERT INTO trade_message_media VALUES('attachment-a','owner-a','owner','message','image','thread-a','','message-a','chat/original','image/png',4,'attached','2026-09-29','');`);
  const statement = (sql, values = []) => ({ bind: (...params) => statement(sql, params), first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }), runSync: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }), run() { return Promise.resolve(this.runSync()); } });
  const db = { prepare: statement, batch: async statements => { sqlite.exec("BEGIN"); try { const out = statements.map(s => s.runSync()); sqlite.exec("COMMIT"); return out; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  const objects = new Map([["chat/original", new Uint8Array([1, 2, 3, 4]).buffer]]);
  let putHook;
  const bucket = { put: async (key, value) => { objects.set(key, value); putHook?.(); },
    get: async key => objects.has(key) ? { body: objects.get(key), arrayBuffer: async () => objects.get(key).slice(0) } : null,
    delete: async key => { objects.delete(key); } };
  return { sqlite, db, bucket, objects, afterPut: hook => { putHook = hook; }, close: () => sqlite.close() };
}

test("only safe HTTP(S) links are extracted and deduplicated without fetching", () => {
  assert.deepEqual(pure.messageLinks('Read https://example.com/a. https://example.com/a javascript:alert(1) https://user:secret@example.com/x http://example.net/help'), ['https://example.com/a', 'http://example.net/help']);
  assert.deepEqual(pure.messageLinks('See (https://example.com/a) and https://example.com/page_(one).'), ['https://example.com/a', 'https://example.com/page_(one)']);
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "https://user:secret@example.com/", "//example.com", "https://example.com/\nsecret"]) assert.equal(pure.safeMessageLink(url), null);
});

test("save retains an independent file copy, safe link and authoritative provenance in existing job media", async () => {
  const f = fixture();
  try {
    assert.deepEqual(await server.saveMessageToJob(f.db, f.bucket, jane, input), { saved: 2, total: 2, jobNumber: "TLJ-00000001" });
    const rows = f.sqlite.prepare("SELECT * FROM trade_crm_job_media ORDER BY content_type").all();
    assert.equal(rows.length, 2);
    assert.equal(f.objects.size, 3);
    for (const row of rows) {
      assert.equal(row.source, "team_chat");
      assert.match(row.original_sha256, /^[a-f0-9]{64}$/);
      assert.notEqual(row.object_key, "chat/original");
      const metadata = JSON.parse(row.evidence_envelope);
      assert.equal(metadata.senderName, "Original sender"); assert.equal(metadata.senderMemberId, "owner");
      assert.equal(metadata.threadName, "Site planning"); assert.equal(metadata.threadId, "thread-a");
      assert.equal(metadata.messageId, "message-a"); assert.equal(metadata.messageCreatedAt, "2026-09-29T01:02:03.000Z");
      assert.equal(metadata.savedByName, "Jane"); assert.equal(metadata.savedByUid, "jane-uid"); assert.equal(metadata.savedByMemberId, "jane");
      assert.ok(Number.isFinite(Date.parse(metadata.savedAt)));
    }
    assert.deepEqual(new Uint8Array(f.objects.get(rows.find(row => row.content_type === "image/png").object_key)), new Uint8Array([1,2,3,4]));
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_work_order_events").get().n, 2);
    assert.equal(f.sqlite.prepare("SELECT revision FROM trade_work_orders WHERE id='job-a'").get().revision, 3);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_team_sync_changes").get().n, 4);
  } finally { f.close(); }
});

test("retry and concurrent saves are idempotent without overwriting first saver metadata or leaking orphan copies", async () => {
  const f = fixture();
  try {
    const results = await Promise.all([server.saveMessageToJob(f.db, f.bucket, jane, input), server.saveMessageToJob(f.db, f.bucket, jane, input)]);
    assert.equal(results.reduce((n, value) => n + value.saved, 0), 2);
    const before = f.sqlite.prepare("SELECT evidence_envelope FROM trade_crm_job_media ORDER BY id").all();
    assert.equal((await server.saveMessageToJob(f.db, f.bucket, { ...jane, displayName: "New name" }, input)).saved, 0);
    assert.deepEqual(f.sqlite.prepare("SELECT evidence_envelope FROM trade_crm_job_media ORDER BY id").all(), before);
    assert.equal(f.objects.size, 3);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_crm_job_media").get().n, 2);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_work_order_events").get().n, 2);
  } finally { f.close(); }
});

test("nonparticipants, another business, unassigned jobs and revoked evidence permissions cannot save", async () => {
  for (const [actor, target, mutation] of [
    [john, { ...input, workOrderId: "job-b" }, ""], [foreign, { ...input, workOrderId: "job-x" }, ""],
    [jane, { ...input, workOrderId: "job-b" }, ""], [jane, { ...input, workOrderId: "job-x" }, ""],
    [jane, input, "UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id='jane'"],
    [jane, input, "UPDATE trade_team_members SET can_view_field_evidence=0 WHERE id='jane'"],
    [jane, input, "UPDATE trade_team_members SET status='inactive' WHERE id='jane'"],
    [jane, input, "UPDATE trade_work_orders SET record_status='binned' WHERE id='job-a'"],
  ]) {
    const f = fixture();
    try {
      if (mutation) f.sqlite.exec(mutation);
      await assert.rejects(server.saveMessageToJob(f.db, f.bucket, actor, target), error => error instanceof server.MessageJobFileError && error.status === 403);
      assert.equal(f.objects.size, 1);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_crm_job_media").get().n, 0);
    } finally { f.close(); }
  }
});

test("search shows only currently writable same-business job numbers and treats wildcard input literally", async () => {
  const f = fixture();
  try {
    assert.deepEqual(await server.searchMessageSaveJobs(f.db, jane, { ...input, search: "TLJ" }), [{ id: "job-a", jobNumber: "TLJ-00000001" }]);
    assert.deepEqual(await server.searchMessageSaveJobs(f.db, jane, { ...input, search: "%" }), []);
    assert.deepEqual(await server.searchMessageSaveJobs(f.db, jane, { ...input, search: "" }), []);
    f.sqlite.exec("UPDATE trade_team_members SET job_scope='team' WHERE id='jane'");
    assert.equal((await server.searchMessageSaveJobs(f.db, jane, { ...input, search: "TLJ" })).length, 2);
  } finally { f.close(); }
});

test("destination teammates may read explicitly saved files without private-chat membership", async () => {
  const f = fixture();
  try {
    await server.saveMessageToJob(f.db, f.bucket, jane, input);
    await assert.rejects(server.listSavedMessageJobFiles(f.db, john, "job-a"), /access/);
    f.sqlite.exec("UPDATE trade_team_members SET job_scope='team' WHERE id='john'");
    const files = await server.listSavedMessageJobFiles(f.db, john, "job-a");
    assert.equal(files.length, 2);
    assert.ok(files.every(file => !Object.hasOwn(file, "object_key")));
    await assert.rejects(server.listSavedMessageJobFiles(f.db, foreign, "job-a"), /access/);
    f.sqlite.exec("UPDATE trade_team_members SET can_view_field_evidence=0 WHERE id='john'");
    await assert.rejects(server.listSavedMessageJobFiles(f.db, john, "job-a"), /access/);
  } finally { f.close(); }
});

test("chat or destination access revoked while copying is checked again before persistence", async () => {
  for (const mutation of [
    "DELETE FROM trade_message_participants WHERE member_id='jane'",
    "UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id='jane'",
    "UPDATE trade_work_orders SET assignee_member_id='john' WHERE id='job-a'",
  ]) {
    const f = fixture();
    try {
      f.afterPut(() => f.sqlite.exec(mutation));
      await assert.rejects(server.saveMessageToJob(f.db, f.bucket, jane, input));
      assert.equal(f.objects.size, 1);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_crm_job_media").get().n, 0);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_work_order_events").get().n, 0);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_team_sync_changes").get().n, 0);
    } finally { f.close(); }
  }
});

test("expired field sessions cannot reuse a prior actor and save private content", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("INSERT INTO trade_field_sessions VALUES('session','owner-a','jane','active','2020-01-01T00:00:00Z')");
    await assert.rejects(server.saveMessageToJob(f.db, f.bucket, { ...jane, fieldSessionId: "session" }, input), /access/);
    assert.equal(f.objects.size, 1);
  } finally { f.close(); }
});

test("nonattached media and text-only messages cannot be saved as chat files", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("UPDATE trade_internal_messages SET body='Plain message'; DELETE FROM trade_message_media");
    await assert.rejects(server.saveMessageToJob(f.db, f.bucket, jane, input), /no links or attachments/);
    assert.equal(f.objects.size, 1);
  } finally { f.close(); }
});

test("message save UI discloses destination visibility and job files include links, provenance and audio", () => {
  const component = read("../src/components/TradeMessageSaveToJob.tsx");
  const panel = read("../src/components/TradeJobFilesPanel.tsx");
  assert.match(component, /Saved files can be seen by teammates who can access that job/);
  assert.match(component, /threadId, messageId: message.id, workOrderId: selected.id/);
  assert.match(panel, /Saved from chats/); assert.match(panel, /source.senderName/); assert.match(panel, /source.savedByName/);
  assert.match(panel, /rel="noopener noreferrer"/); assert.match(panel, /<audio controls/);
});

function routeFixture({ denied = false } = {}) {
  const calls = [];
  class TradeAccessError extends Error {}
  const route = load("../src/app/api/trade-message-job-files/route.ts", {
    "../../../../db": { getD1: () => ({}) },
    "@/lib/admin-server": { adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } }),
      mfaErrorResponse: () => null, sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin },
    "@/lib/trade-communications-access": { requireTeamCommunicationAccess: async () => { if (denied) throw new Error("AUTH_REQUIRED"); return jane; } },
    "@/lib/customer-project-evidence-bucket": { getCustomerProjectEvidenceBucket: () => ({}) },
    "@/lib/bounded-request-body.mjs": boundedBody,
    "@/lib/trade-access-server": { TradeAccessError },
    "@/lib/trade-message-job-files-server": { MessageJobFileError: server.MessageJobFileError,
      saveMessageToJob: async (db, bucket, actor, input) => { calls.push({ actor, input }); return { saved: 1, total: 1, jobNumber: "TLJ-00000001" }; },
      searchMessageSaveJobs: async () => [], listSavedMessageJobFiles: async () => [] },
  });
  return { route, calls };
}

test("save route accepts only record references and derives actor/content on the server", async () => {
  const { route, calls } = routeFixture();
  const response = await route.POST(new Request("https://tlink.example/api/trade-message-job-files", {
    method: "POST", body: JSON.stringify({ ...input, senderName: "forged", ownerUid: "owner-b", attachmentIds: ["foreign"], url: "https://attacker.example" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(calls, [{ actor: jane, input }]);
});

test("route rejects missing authority, cross-origin requests, oversized bodies and malformed references before saving", async () => {
  for (const [options, headers, body, expected] of [
    [{ denied: true }, {}, JSON.stringify(input), 401], [{}, { origin: "https://attacker.example" }, JSON.stringify(input), 403],
    [{}, {}, "x".repeat(2049), 413], [{}, {}, "{", 400], [{}, {}, "null", 400], [{}, {}, "[]", 400], [{}, {}, "{}", 400],
  ]) {
    const { route, calls } = routeFixture(options);
    const response = await route.POST(new Request("https://tlink.example/api/trade-message-job-files", { method: "POST", headers, body }));
    assert.equal(response.status, expected); assert.equal(calls.length, 0);
  }
});
