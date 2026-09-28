import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, record, record.exports, ...Object.values(globals));
  return record.exports;
}
const image = load("../src/lib/private-image-evidence.ts");
const pure = load("../src/lib/trade-message-media.ts", { "./private-image-evidence": image });
const access = load("../src/lib/trade-message-media-access.ts");
const server = load("../src/lib/trade-message-media-server.ts", { "./trade-message-media-access": access, "./trade-message-media": pure });
const owner = { ownerUid: "owner-a", actorUid: "owner-a", memberId: "owner", isOwner: true, canManageTeam: true };
const jane = { ...owner, actorUid: "jane-uid", memberId: "jane", isOwner: false, canManageTeam: false };
const john = { ...jane, actorUid: "john-uid", memberId: "john" };
const foreign = { ...owner, ownerUid: "owner-b", actorUid: "owner-b", memberId: "foreign" };
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW3sAAAAASUVORK5CYII=", "base64"));
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,can_manage_team INTEGER);
    INSERT INTO trade_team_members VALUES('owner','owner-a','owner-a','active',1),('jane','owner-a','jane-uid','active',0),('john','owner-a','john-uid','active',0),('foreign','owner-b','owner-b','active',1);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);`);
  sqlite.exec(read("../drizzle/0214_trade_messages.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.exec(read("../drizzle/0215_trade_message_media.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.exec(`INSERT INTO trade_message_threads VALUES('thread-a','owner-a','dm','','jane-owner','owner','request-1','hash','2026','2026'),('thread-b','owner-a','dm','','john-owner','owner','request-2','hash2','2026','2026');
    INSERT INTO trade_message_participants VALUES('thread-a','owner-a','owner',0),('thread-a','owner-a','jane',0),('thread-b','owner-a','owner',0),('thread-b','owner-a','john',0);`);
  const statement = (sql, values = []) => ({ bind: (...params) => statement(sql, params), first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }), runSync: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }), run() { return Promise.resolve(this.runSync()); } });
  const db = { prepare: statement, batch: async statements => { sqlite.exec("BEGIN"); try { const out = statements.map(s => s.runSync()); sqlite.exec("COMMIT"); return out; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  const stored = new Map();
  const bucket = { put: async (key, value) => { stored.set(key, value); }, get: async key => stored.has(key) ? { body: stored.get(key) } : null, delete: async key => { stored.delete(key); } };
  return { sqlite, db, bucket, stored, close: () => sqlite.close() };
}
const upload = (f, actor = owner, threadId = "thread-a") => server.uploadMessageMedia(f.db, f.bucket, actor, { purpose: "message", threadId, memberId: "", bytes: png, contentType: "image/png" });
async function attach(f, actor, ids, messageId = "message-1", threadId = "thread-a") {
  const prepared = server.messageAttachmentStatements(f.db, actor, threadId, messageId, ids);
  return f.db.batch([f.db.prepare(`INSERT OR IGNORE INTO trade_internal_messages(id,owner_uid,thread_id,sequence,actor_member_id,actor_name,body,request_id,created_at)
    SELECT ?,?,?,COALESCE((SELECT MAX(sequence) FROM trade_internal_messages),0)+1,?,'Name','Photo','request-'||?,'2026' WHERE ${prepared.guard.sql}`)
    .bind(messageId, actor.ownerUid, threadId, actor.memberId, messageId, ...prepared.guard.values), ...prepared.statements]);
}

test("photo upload verifies dimensions, real bytes, strips metadata and bounds audio and attachment IDs", () => {
  assert.equal(pure.inspectMessageMedia(png, "image/png").kind, "image");
  for (const [bytes, type] of [[new Uint8Array(), "image/png"], [new Uint8Array(6*1024*1024), "audio/webm"], [new TextEncoder().encode("<svg>bad</svg>"), "image/png"], [png, "image/svg+xml"], [png, "audio/ogg"]]) assert.throws(() => pure.inspectMessageMedia(bytes, type), /MESSAGE_/);
  const oversized = png.slice(); new DataView(oversized.buffer).setUint32(16, 3000);
  assert.throws(() => pure.inspectMessageMedia(oversized, "image/png"), /MESSAGE_IMAGE_INVALID/);
  assert.throws(() => pure.inspectMessageMedia(png, "audio/mp4", true), /MESSAGE_MEDIA_TYPE/);
  for (const ids of [["x"], ["valid-id-123456789", "valid-id-123456789"], Array(5).fill("valid-id-123456789"), "id"]) assert.throws(() => pure.messageAttachmentIds(ids), /MESSAGE_ATTACHMENTS_INVALID/);
});

test("pending uploads are visible only to the uploader, and attached photos only to current participants", async () => {
  const f = fixture(); try {
    const media = await upload(f);
    assert.ok(await server.readMessageMedia(f.db, owner, { id: media.id }));
    for (const actor of [jane, john, foreign]) assert.equal(await server.readMessageMedia(f.db, actor, { id: media.id }), null);
    await attach(f, owner, [media.id]);
    assert.ok(await server.readMessageMedia(f.db, jane, { id: media.id }));
    assert.equal(await server.readMessageMedia(f.db, john, { id: media.id }), null);
    assert.equal((await server.loadMessageAttachments(f.db, jane, "thread-a", ["message-1"]))["message-1"][0].id, media.id);
    assert.deepEqual(await server.loadMessageAttachments(f.db, foreign, "thread-a", ["message-1"]), {});
    f.sqlite.exec("DELETE FROM trade_message_participants WHERE member_id='jane'");
    assert.equal(await server.readMessageMedia(f.db, jane, { id: media.id }), null);
  } finally { f.close(); }
});

test("message attachment transaction rejects another owner, actor, thread, expired upload or malformed list without a message", async () => {
  const f = fixture(); try {
    const media = await upload(f);
    for (const [actor, threadId] of [[jane, "thread-a"], [foreign, "thread-a"], [owner, "thread-b"]]) await attach(f, actor, [media.id], "message-1", threadId);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_internal_messages").get().count, 0);
    f.sqlite.exec("UPDATE trade_message_media SET expires_at='2000'");
    await attach(f, owner, [media.id]);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_internal_messages").get().count, 0);
    assert.equal(await server.readMessageMedia(f.db, owner, { id: media.id }), null);
  } finally { f.close(); }
});

test("attachments bind once, replay does not duplicate them, and a changed list cannot mutate an existing send", async () => {
  const f = fixture(); try {
    const one = await upload(f), two = await upload(f);
    await attach(f, owner, [one.id]); await attach(f, owner, [one.id]);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_internal_messages").get().count, 1);
    const changed = server.messageAttachmentStatements(f.db, owner, "thread-a", "message-1", [two.id]);
    assert.equal(await f.db.prepare(`SELECT 1 WHERE ${changed.guard.sql}`).bind(...changed.guard.values).first(), null);
    await attach(f, owner, [two.id]);
    assert.equal(f.sqlite.prepare("SELECT state FROM trade_message_media WHERE id=?").get(two.id).state, "pending");
    await attach(f, owner, [one.id], "message-2");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_internal_messages").get().count, 1);
    await assert.rejects(server.deleteMessageMedia(f.db, f.bucket, owner, one.id), /MESSAGE_ACCESS_REQUIRED/);
    assert.equal(f.sqlite.prepare("SELECT message_id FROM trade_message_media WHERE id=?").get(one.id).message_id, "message-1");
  } finally { f.close(); }
});

test("revoked membership and expired field sessions block read, upload and send even with stale actor claims", async () => {
  const f = fixture(); try {
    const media = await upload(f, jane); await attach(f, jane, [media.id]);
    f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='jane'");
    assert.equal(await server.readMessageMedia(f.db, jane, { id: media.id }), null);
    await assert.rejects(upload(f, jane), /MESSAGE_ACCESS_REQUIRED/);
    const field = { ...owner, fieldSessionId: "field" };
    f.sqlite.exec("INSERT INTO trade_field_sessions VALUES('field','owner-a','owner','active','2000')");
    assert.equal(await server.readMessageMedia(f.db, field, { id: media.id }), null);
    await assert.rejects(upload(f, field), /MESSAGE_ACCESS_REQUIRED/);
  } finally { f.close(); }
});

test("access changed during storage upload prevents a pending record and removes its stored bytes", async () => {
  const f = fixture(); try {
    const put = f.bucket.put; f.bucket.put = async (...args) => { await put(...args); f.sqlite.exec("DELETE FROM trade_message_participants WHERE member_id='jane'"); };
    await assert.rejects(upload(f, jane), /MESSAGE_MEDIA_UPLOAD_DENIED/);
    assert.equal(f.stored.size, 0); assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_message_media").get().count, 0);
  } finally { f.close(); }
});

test("removing a pending photo removes private bytes but cannot delete another person's pending upload", async () => {
  const f = fixture(); try {
    const media = await upload(f, jane);
    await assert.rejects(server.deleteMessageMedia(f.db, f.bucket, owner, media.id), /MESSAGE_ACCESS_REQUIRED/);
    await server.deleteMessageMedia(f.db, f.bucket, jane, media.id);
    assert.equal(f.stored.size, 0); assert.equal(await server.readMessageMedia(f.db, jane, { id: media.id }), null);
  } finally { f.close(); }
});

test("avatars allow self or current team admin, reject tenant and stale permissions, retire revisions and stay private", async () => {
  const f = fixture(); try {
    const avatar = (actor, memberId) => server.uploadMessageMedia(f.db, f.bucket, actor, { purpose: "avatar", threadId: "", memberId, bytes: png, contentType: "image/png" });
    const first = await avatar(jane, "jane");
    assert.ok(await server.readMessageMedia(f.db, owner, { avatarMemberId: "jane", revision: first.id }));
    assert.equal(await server.readMessageMedia(f.db, foreign, { avatarMemberId: "jane" }), null);
    await assert.rejects(avatar(jane, "john"), /MESSAGE_ACCESS_REQUIRED/);
    await assert.rejects(avatar(owner, "foreign"), /MESSAGE_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_team_members SET can_manage_team=1 WHERE id='jane'");
    await avatar({ ...jane, canManageTeam: true }, "john");
    f.sqlite.exec("UPDATE trade_team_members SET can_manage_team=0 WHERE id='jane'");
    await assert.rejects(avatar({ ...jane, canManageTeam: true }, "john"), /MESSAGE_ACCESS_REQUIRED/);
    const second = await avatar(owner, "jane");
    assert.equal(f.stored.size, 2, "superseded avatar bytes are removed even when the uploader was another member");
    assert.equal(await server.readMessageMedia(f.db, owner, { avatarMemberId: "jane", revision: first.id }), null);
    assert.equal((await server.teamAvatarRevisions(f.db, owner)).jane, second.id);
    f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='jane'");
    assert.equal(await server.readMessageMedia(f.db, owner, { avatarMemberId: "jane" }), null);
  } finally { f.close(); }
});

const element = (id, value) => Uint8Array.from([...id, 0x80 | value.length, ...value]);
const concat = (...values) => Uint8Array.from(values.flatMap(value => [...value]));
const utf8 = value => new TextEncoder().encode(value);
function webm(track = 2) {
  const header = element([0x1a,0x45,0xdf,0xa3], element([0x42,0x82], utf8("webm")));
  const entry = element([0xae], concat(element([0x83], [track]), element([0x86], utf8("A_OPUS"))));
  return concat(header, element([0x18,0x53,0x80,0x67], concat(element([0x16,0x54,0xae,0x6b], entry), element([0x1f,0x43,0xb6,0x75], [0x81,0x80]))));
}
function box(type, payload) { const bytes = new Uint8Array(payload.length+8); new DataView(bytes.buffer).setUint32(0, bytes.length); bytes.set(utf8(type),4); bytes.set(payload,8); return bytes; }
function mp4(handler = "soun") { return concat(box("ftyp", utf8("M4A \0\0\0\0")),box("moov",box("trak",box("mdia",box("hdlr",concat(new Uint8Array(8),utf8(handler)))))),box("mdat",[1,2])); }
test("voice notes verify WebM Opus or MP4 audio tracks and reject video, spoofing and truncation", () => {
  assert.equal(pure.inspectMessageMedia(webm(), "audio/webm;codecs=opus").contentType, "audio/webm");
  assert.equal(pure.inspectMessageMedia(mp4(), "audio/mp4").kind, "audio");
  for (const [bytes, type] of [[webm(1),"audio/webm"],[webm().slice(0,-1),"audio/webm"],[mp4("vide"),"audio/mp4"],[mp4().slice(0,12),"audio/mp4"],[webm(),"audio/ogg"]]) assert.throws(() => pure.inspectMessageMedia(bytes,type), /MESSAGE_MEDIA_TYPE/);
});

function recorderFixture({ delayed = false, throws = false } = {}) {
  let tracksStopped = 0, resolveStream;
  const recordings = [];
  const stream = { getTracks: () => [{ stop() { tracksStopped++; } }] };
  class Recorder {
    static isTypeSupported(type) { return type.startsWith("audio/webm"); }
    constructor(_stream, { mimeType }) { if (throws) throw new Error("Unavailable"); this.mimeType = mimeType; this.state = "inactive"; recordings.push(this); }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable({ data: new Blob([webm()], { type: this.mimeType }) }); this.onstop(); }
  }
  const complete = [], errors = [], controller = new AbortController();
  const client = load("../src/lib/trade-message-media-client.ts", { "./trade-message-media": pure }, {
    MediaRecorder: Recorder, navigator: { mediaDevices: { getUserMedia: async () => delayed ? new Promise(resolve => { resolveStream = resolve; }) : stream } },
  });
  return { client, controller, complete, errors, stopped: () => tracksStopped, recording: () => recordings.at(-1),
    resolve: () => resolveStream(stream), start: () => client.startVoiceNoteCapture({ signal: controller.signal, onComplete: value => complete.push(value), onError: value => errors.push(value) }) };
}
test("explicit recording stop attaches audio and closes microphone tracks", async () => {
  const f = recorderFixture(), capture = await f.start(); capture.stop();
  assert.equal(f.complete.length, 1); assert.equal(f.complete[0].type, "audio/webm;codecs=opus"); assert.ok(f.stopped() > 0); assert.equal(f.recording().state, "inactive");
});
test("cancel, unmount abort, denied recorder and cancellation while permission is pending never attach or leak microphone tracks", async () => {
  for (const mode of ["cancel","abort"]) { const f = recorderFixture(), capture = await f.start(); if (mode === "cancel") capture.cancel(); else f.controller.abort(); assert.equal(f.complete.length, 0); assert.ok(f.stopped() > 0); }
  const pending = recorderFixture({ delayed: true }), started = pending.start(); pending.controller.abort(); pending.resolve(); await assert.rejects(started, /cancelled/); assert.ok(pending.stopped() > 0); assert.equal(pending.complete.length, 0);
  const denied = recorderFixture({ throws: true }); await assert.rejects(denied.start(), /Unavailable/); assert.ok(denied.stopped() > 0);
});

function route(f, actor = owner) {
  return load("../src/app/api/trade-message-media/route.ts", {
    "../../../../db": { getD1: () => f.db },
    "@/lib/customer-project-evidence-bucket": { getCustomerProjectEvidenceBucket: () => f.bucket },
    "@/lib/trade-communications-access": { requireTeamCommunicationAccess: async () => actor },
    "@/lib/trade-access-server": { TradeAccessError: class extends Error {} },
    "@/lib/admin-server": { mfaErrorResponse: () => null },
    "@/lib/trade-message-media-server": server,
  });
}
test("HTTP media endpoints keep image bytes authenticated, non-cacheable, and recheck revoked access after object retrieval", async () => {
  const f = fixture(); try {
    const api = route(f), form = new FormData(); form.set("purpose", "message"); form.set("threadId", "thread-a"); form.set("file", new File([png], "photo.png", { type: "image/png" }));
    const response = await api.POST(new Request("https://tlink.test/api/trade-message-media", { method: "POST", headers: { origin: "https://tlink.test" }, body: form }));
    assert.equal(response.status, 201); const result = await response.json(); assert.equal(JSON.stringify(result).includes("object_key"), false);
    const request = () => new Request(`https://tlink.test/api/trade-message-media?id=${result.attachment.id}`);
    assert.equal((await route(f, jane).GET(request())).status, 404);
    await attach(f, owner, [result.attachment.id]);
    const viewed = await route(f, jane).GET(request()); assert.equal(viewed.status, 200); assert.equal(viewed.headers.get("cache-control"), "private, no-store"); assert.equal(viewed.headers.get("content-type"), "image/png"); assert.equal(viewed.headers.get("x-content-type-options"), "nosniff");
    const get = f.bucket.get; f.bucket.get = async key => { const object = await get(key); f.sqlite.exec("DELETE FROM trade_message_participants WHERE member_id='jane'"); return object; };
    assert.equal((await route(f, jane).GET(request())).status, 404);
  } finally { f.close(); }
});
test("HTTP uploads reject cross-origin, oversized declared or streamed bodies and invalid multipart without storing bytes", async () => {
  const f = fixture(); try {
    const api = route(f), url = "https://tlink.test/api/trade-message-media";
    assert.equal((await api.POST(new Request(url, { method: "POST", headers: { origin: "https://other.test" }, body: "x" }))).status, 403);
    assert.equal((await api.POST(new Request(url, { method: "POST", headers: { "content-length": "99999999" }, body: "x" }))).status, 413);
    assert.equal((await api.POST(new Request(url, { method: "POST", body: new Uint8Array(5*1024*1024+16385) }))).status, 413);
    assert.equal((await api.POST(new Request(url, { method: "POST", body: "broken multipart" }))).status, 400);
    assert.equal(f.stored.size, 0);
  } finally { f.close(); }
});
