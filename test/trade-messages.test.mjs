import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as pure from "../src/lib/trade-messages.ts";
import * as bounded from "../src/lib/bounded-request-body.mjs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, record, record.exports);
  return record.exports;
}
const mediaAccess = load("../src/lib/trade-message-media-access.ts", {});
const mediaPure = load("../src/lib/trade-message-media.ts", { "./private-image-evidence": load("../src/lib/private-image-evidence.ts", {}) });
const mediaServer = load("../src/lib/trade-message-media-server.ts", { "./trade-message-media-access": mediaAccess, "./trade-message-media": mediaPure });
const owner = { ownerUid: "business-a", actorUid: "business-a", memberId: "owner", displayName: "Owner", isOwner: true, canSendSms: true };
const jane = { ...owner, actorUid: "jane-uid", memberId: "jane", displayName: "Jane", isOwner: false };
const john = { ...owner, actorUid: "john-uid", memberId: "john", displayName: "John", isOwner: false };
const foreign = { ...owner, ownerUid: "business-b", actorUid: "other-uid", memberId: "other" };
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,display_name TEXT,job_scope TEXT,can_send_sms INTEGER,can_view_quotes INTEGER DEFAULT 0,phone TEXT DEFAULT '');
    INSERT INTO trade_team_members VALUES('owner','business-a','business-a','active','Owner','team',1,1,'0412 000 000'),('jane','business-a','jane-uid','active','Jane','own',1,0,'0412 111 111'),('john','business-a','john-uid','active','John','own',1,0,'0412 111 111'),('other','business-b','other-uid','active','Other owner','team',1,1,'0412 000 000'),('inactive','business-a','inactive-uid','suspended','Inactive','own',0,0,'');
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,first_name TEXT,last_name TEXT,business_name TEXT,phone TEXT,record_status TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,record_status TEXT,source_type TEXT,assignee_member_id TEXT,work_number TEXT,created_at TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,customer_source TEXT);
    CREATE TABLE trade_crm_quote_questions(id TEXT,work_order_id TEXT,firebase_uid TEXT,question TEXT,status TEXT,asked_at TEXT);
    CREATE TABLE trade_sms_messages(id TEXT PRIMARY KEY,firebase_uid TEXT,customer_id TEXT,work_order_id TEXT,body TEXT,created_at TEXT);
    INSERT INTO trade_crm_customers VALUES('customer','business-a','Test','Customer','','0412 345 678','active'),('foreign-customer','business-b','Other','Customer','','0412 987 654','active');
    INSERT INTO trade_work_orders VALUES('job-1','business-a','installer','active','manual','jane','TLJ-ONE12345','2026-01-01'),('job-2','business-a','installer','active','manual','john','TLJ-TWO12345','2026-01-01'),('private-job','business-a','installer','active','opportunity','jane','TLJ-SEC12345','2026-01-01');
    INSERT INTO trade_crm_job_details VALUES('job-1','business-a','customer','internal'),('job-2','business-a','customer','internal'),('private-job','business-a','customer','platform_private');
    INSERT INTO trade_sms_messages VALUES('sms-1','business-a','customer','job-1','Jane job message','2026-09-01'),('sms-2','business-a','customer','job-2','Other job confidential','2026-09-02');`);
  sqlite.exec(read("../drizzle/0214_trade_messages.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.exec(read("../drizzle/0215_trade_message_media.sql").replaceAll("--> statement-breakpoint", ""));
  const statement = (sql, values = []) => ({ bind: (...params) => statement(sql, params), first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }), runSync: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }), run() { return Promise.resolve(this.runSync()); } });
  const db = { prepare: statement, batch: async statements => { sqlite.exec("BEGIN"); try { const out = []; for (const s of statements) out.push(s.runSync()); sqlite.exec("COMMIT"); return out; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  const server = load("../src/lib/trade-messages-server.ts", { "../../db": { getD1: () => db }, "./trade-messages": pure,
    "./trade-message-media-access": mediaAccess, "./trade-message-media": mediaPure, "./trade-message-media-server": mediaServer });
  return { sqlite, db, server, close: () => sqlite.close() };
}
const request = number => `message-request-${String(number).padStart(8, "0")}`;
const create = (f, actor, memberIds, subject = "", requestId = request(1)) => f.server.createTeamConversation(actor, { memberIds, subject, requestId }, f.db);

test("a new business team inbox returns HTTP 200 with no threads and its available teammates", async () => {
  const f = fixture(); try {
    const route = load("../src/app/api/trade-messages/route.ts", {
      "@/lib/admin-server": { sameOrigin: () => true, mfaErrorResponse: () => null, adminJson: (body, status = 200) => Response.json(body, { status }) },
      "@/lib/trade-access-server": { TradeAccessError: class extends Error {} },
      "@/lib/trade-communications-access": { requireTeamCommunicationAccess: async () => jane },
      "cloudflare:workers": { waitUntil: () => assert.fail("Reading an empty inbox cannot send a notification") },
      "@/lib/trade-push-server": {}, "@/lib/bounded-request-body.mjs": bounded,
      "@/lib/trade-messages-server": f.server,
    });
    const response = await route.GET(new Request("https://tlink.test/api/trade-messages"));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true); assert.equal(result.memberId, jane.memberId);
    assert.deepEqual(result.threads, []); assert.equal(result.hasMore, false);
    assert.deepEqual(result.members.map(member => member.id).sort(), ["jane", "john", "owner"]);
    assert.equal(result.error, undefined);
  } finally { f.close(); }
});

test("message route rejects oversized UTF-8 bodies before any conversation mutation", async () => {
  const route = load("../src/app/api/trade-messages/route.ts", {
    "@/lib/admin-server": { sameOrigin:()=>true, mfaErrorResponse:()=>null, adminJson:(body,status=200)=>Response.json(body,{status}) },
    "@/lib/trade-access-server": {TradeAccessError:class extends Error {}},
    "@/lib/trade-communications-access": {requireTeamCommunicationAccess:async()=>owner},
    "cloudflare:workers":{waitUntil:()=>assert.fail("Oversized body scheduled notification")},
    "@/lib/trade-push-server":{notifyTeamMessage:()=>assert.fail("Oversized body dispatched notification")},
    "@/lib/bounded-request-body.mjs":bounded,
    "@/lib/trade-messages-server": {sendTeamMessage:()=>assert.fail("Oversized body reached message mutation")},
  });
  const response = await route.POST(new Request("https://tlink.test/api/trade-messages",{method:"POST",body:JSON.stringify({action:"send",body:"é".repeat(7000)})}));
  assert.equal(response.status,413);
});

test("notification deep links select an authorised conversation beyond the first inbox page",async()=>{
  const f=fixture();try{
    const target=await create(f,owner,["jane"]);
    f.sqlite.prepare("UPDATE trade_message_threads SET updated_at='2000-01-01' WHERE id=?").run(target.id);
    for(let i=1;i<=55;i++)await create(f,owner,["jane","john"],`Newer group ${i}`,request(i+100));
    const inbox=await f.server.messagesWorkspace(jane,"",1,f.db);
    assert.equal(inbox.threads.length,50);assert.equal(inbox.hasMore,true);assert.ok(!inbox.threads.some(thread=>thread.id===target.id));
    const selected=await f.server.messagesWorkspace(jane,"",1,f.db,target.id);
    assert.equal(selected.threads.length,1);assert.equal(selected.threads[0].id,target.id);assert.equal(selected.hasMore,false);
    for(const actor of [john,foreign])await assert.rejects(f.server.messagesWorkspace(actor,"",1,f.db,target.id),/MESSAGE_ACCESS_REQUIRED/);
    await assert.rejects(f.server.messagesWorkspace(jane,"",1,f.db,"missing-thread"),/MESSAGE_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='jane'");
    await assert.rejects(f.server.messagesWorkspace(jane,"",1,f.db,target.id),/MESSAGE_ACCESS_REQUIRED/);
  }finally{f.close();}
});

function messageRouteFixture({sendFailure="",authFailure="",deferSave=false,deferPush=false}={}){
  const events=[],background=[];let releaseSave,releasePush,saved=false;
  const server={sendTeamMessage:async(actor,threadId,body,requestId,_db,attachmentIds)=>{events.push("send");assert.equal(actor,owner);assert.equal(threadId,"thread-a");assert.equal(body,"Hello");assert.equal(requestId,request(99));assert.deepEqual(attachmentIds,[]);if(deferSave)await new Promise(resolve=>{releaseSave=resolve;});if(sendFailure)throw new Error(sendFailure);saved=true;events.push("saved");return{id:"message-a",body:"Hello"};},
    messagesWorkspace:async(...args)=>{events.push({name:"workspace",args});return{threads:[{id:"thread-a",kind:"dm",members:[]}]};}};
  const route=load("../src/app/api/trade-messages/route.ts",{
    "@/lib/admin-server":{sameOrigin:()=>true,mfaErrorResponse:()=>null,adminJson:(body,status=200)=>Response.json(body,{status})},
    "@/lib/trade-access-server":{TradeAccessError:class extends Error{}},
    "@/lib/trade-communications-access":{requireTeamCommunicationAccess:async()=>{events.push("access");if(authFailure)throw new Error(authFailure);return owner;}},
    "cloudflare:workers":{waitUntil:promise=>{events.push("waitUntil");background.push(promise);}},
    "@/lib/trade-push-server":{notifyTeamMessage:async(actor,threadId,messageId)=>{assert.equal(saved,true);assert.equal(actor,owner);assert.equal(threadId,"thread-a");assert.equal(messageId,"message-a");events.push("notify");if(deferPush)await new Promise(resolve=>{releasePush=resolve;});return{failed:1};}},
    "@/lib/bounded-request-body.mjs":bounded,"@/lib/trade-messages-server":server,
  });
  return{route,events,background,releaseSave:()=>releaseSave(),releasePush:()=>releasePush()};
}
const sendRequest=()=>new Request("https://tlink.test/api/trade-messages",{method:"POST",body:JSON.stringify({action:"send",threadId:"thread-a",body:"Hello",requestId:request(99),attachmentIds:[]})});

test("saved messages schedule background notification without waiting for push acceptance",async()=>{
  const f=messageRouteFixture({deferSave:true,deferPush:true}),pending=f.route.POST(sendRequest());
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,["access","send"]);assert.equal(f.background.length,0);
  f.releaseSave();const response=await pending;assert.equal(response.status,200);assert.deepEqual(f.events,["access","send","saved","notify","waitUntil"]);
  assert.equal((await response.json()).message.id,"message-a");f.releasePush();await Promise.all(f.background);
});

test("failed authentication or message save never starts notification delivery",async()=>{
  for(const [options,status] of [[{authFailure:"AUTH_REQUIRED"},401],[{sendFailure:"MESSAGE_ACCESS_REQUIRED"},403],[{sendFailure:"MESSAGE_REQUEST_CONFLICT"},409]]){
    const f=messageRouteFixture(options);assert.equal((await f.route.POST(sendRequest())).status,status);assert.ok(!f.events.includes("notify"));assert.equal(f.background.length,0);
  }
});

test("thread view forwards the exact deep-link ID to the participant-scoped workspace lookup",async()=>{
  const f=messageRouteFixture(),response=await f.route.GET(new Request("https://tlink.test/api/trade-messages?view=thread&threadId=thread-a"));
  assert.equal(response.status,200);assert.deepEqual(f.events.at(-1),{name:"workspace",args:[owner,"",1,undefined,"thread-a"]});
  assert.deepEqual(await response.json(),{ok:true,thread:{id:"thread-a",kind:"dm",members:[]}});
});

test("team message input is bounded, plain text and gives groups a required simple name", () => {
  assert.equal(pure.teamMessageBody(" Hi "), "Hi");
  for (const body of ["", "a".repeat(2001), "bad\0", 123]) assert.throws(() => pure.teamMessageBody(body), /MESSAGE_INVALID/);
  assert.deepEqual(pure.teamThreadInput({ memberIds: ["jane", "jane"] }, "owner"), { memberIds: ["jane", "owner"], kind: "dm", subject: "", dmKey: '["jane","owner"]' });
  assert.throws(() => pure.teamThreadInput({ memberIds: ["jane", "john"] }, "owner"), /MESSAGE_SUBJECT_INVALID/);
  assert.throws(() => pure.teamThreadInput({ memberIds: ["owner"] }, "owner"), /MESSAGE_MEMBERS_INVALID/);
});

test("DMs are deterministic across both senders and a business owner cannot read other participants' DMs", async () => {
  const f = fixture(); try {
    const a = await create(f, jane, ["john"]), b = await create(f, john, ["jane"]);
    assert.equal(a.id, b.id);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_message_threads").get().count, 1);
    await f.server.sendTeamMessage(jane, a.id, "Private team message", request(2), f.db);
    assert.equal((await f.server.teamConversation(john, a.id, 0, f.db)).messages[0].senderName, "Jane");
    await assert.rejects(f.server.teamConversation(owner, a.id, 0, f.db), /MESSAGE_ACCESS_REQUIRED/);
    await assert.rejects(f.server.sendTeamMessage(owner, a.id, "Intercept", request(3), f.db), /MESSAGE_ACCESS_REQUIRED/);
    assert.equal((await f.server.messagesWorkspace(owner, "", 1, f.db)).threads.length, 0);
    assert.equal((await f.server.messagesWorkspace(jane, "", 1, f.db)).threads.length, 1);
  } finally { f.close(); }
});

test("group membership is business-bound and suspended or foreign people cannot be added", async () => {
  const f = fixture(); try {
    for (const memberIds of [["other"], ["inactive"], ["missing"]]) await assert.rejects(create(f, owner, memberIds), /MESSAGE_MEMBERS_INVALID/);
    const group = await create(f, owner, ["jane", "john"], "Installation crew");
    await f.server.sendTeamMessage(owner, group.id, "Team update", request(2), f.db);
    assert.equal((await f.server.teamConversation(jane, group.id, 0, f.db)).messages.length, 1);
    await assert.rejects(f.server.teamConversation(foreign, group.id, 0, f.db), /MESSAGE_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='jane'");
    await assert.rejects(f.server.teamConversation(jane, group.id, 0, f.db), /MESSAGE_ACCESS_REQUIRED/);
    await assert.rejects(f.server.sendTeamMessage(jane, group.id, "Blocked", request(3), f.db), /MESSAGE_ACCESS_REQUIRED/);
    assert.equal((await f.server.teamConversation(john, group.id, 0, f.db)).messages.length, 1);
  } finally { f.close(); }
});

test("send replay is idempotent, actor-bound and conflicting request content is rejected", async () => {
  const f = fixture(); try {
    const thread = await create(f, owner, ["jane"]);
    const [one, two] = await Promise.all([1,2].map(() => f.server.sendTeamMessage(owner, thread.id, "Hello", request(2), f.db)));
    assert.equal(one.id, two.id);
    await assert.rejects(f.server.sendTeamMessage(owner, thread.id, "Different", request(2), f.db), /MESSAGE_REQUEST_CONFLICT/);
    const next = await f.server.sendTeamMessage(jane, thread.id, "Hi", request(2), f.db);
    assert.notEqual(next.id, one.id); assert.equal(next.sequence, 2);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_internal_messages").get().count, 2);
  } finally { f.close(); }
});

test("unread counts and older pages remain participant-only and read markers never move backwards", async () => {
  const f = fixture(); try {
    const thread = await create(f, owner, ["jane"]);
    for (let i=1;i<=45;i++) await f.server.sendTeamMessage(owner, thread.id, `Message ${i}`, request(i+1), f.db);
    assert.equal((await f.server.messagesWorkspace(jane, "", 1, f.db)).threads[0].unread, 45);
    const latest = await f.server.teamConversation(jane, thread.id, 0, f.db);
    assert.equal(latest.messages.length, 40); assert.equal(latest.hasOlder, true); assert.equal(latest.messages[0].sequence, 6);
    const older = await f.server.teamConversation(jane, thread.id, 6, f.db); assert.equal(older.messages.length, 5); assert.equal(older.hasOlder, false);
    await f.server.readTeamConversation(jane, thread.id, 45, f.db); await f.server.readTeamConversation(jane, thread.id, 2, f.db);
    assert.equal((await f.server.messagesWorkspace(jane, "", 1, f.db)).threads[0].unread, 0);
    await assert.rejects(f.server.readTeamConversation(john, thread.id, 45, f.db), /MESSAGE_ACCESS_REQUIRED/);
    await assert.rejects(f.server.readTeamConversation(jane, thread.id, 999, f.db), /MESSAGE_ACCESS_REQUIRED/);
  } finally { f.close(); }
});

test("SMS inbox lists only current authorised jobs and never includes another job's preview", async () => {
  const f = fixture(); try {
    const own = await f.server.customerMessageThreads(owner, "", 1, f.db); assert.equal(own.customerThreads.length, 1); assert.equal(own.customerThreads[0].latest, "Other job confidential");
    const staff = await f.server.customerMessageThreads(jane, "", 1, f.db); assert.equal(staff.customerThreads.length, 1); assert.equal(staff.customerThreads[0].jobNumber, "TLJ-ONE12345"); assert.equal(staff.customerThreads[0].latest, "Jane job message");
    assert.equal((await f.server.customerMessageThreads(jane, "TWO12345", 1, f.db)).customerThreads.length, 0);
    await assert.rejects(f.server.customerMessageThreads({ ...jane, canSendSms: false }, "", 1, f.db), /MESSAGE_SMS_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_team_members SET can_send_sms=0 WHERE id='jane'");
    assert.equal((await f.server.customerMessageThreads(jane, "", 1, f.db)).customerThreads.length, 0);
  } finally { f.close(); }
});

test("new-chat directory includes the owner, excludes other businesses and suspended members; field sessions revoke access", async () => {
  const f = fixture(); try {
    assert.deepEqual((await f.server.messagesWorkspace(jane, "", 1, f.db)).members.map(m => m.id).sort(), ["jane", "john", "owner"]);
    f.sqlite.exec("INSERT INTO trade_field_sessions VALUES('field','business-a','jane','active','2099-01-01')");
    const field = { ...jane, actorUid: "field-member:jane", fieldSessionId: "field" };
    await f.server.messagesWorkspace(field, "", 1, f.db);
    f.sqlite.exec("UPDATE trade_field_sessions SET status='revoked'");
    await assert.rejects(f.server.messagesWorkspace(field, "", 1, f.db), /MESSAGE_ACCESS_REQUIRED/);
  } finally { f.close(); }
});

test("quote questions remain available without SMS and respect current quote permission and job assignment", async () => {
  const f = fixture(); try {
    f.sqlite.exec("INSERT INTO trade_crm_quote_questions VALUES('q1','job-1','business-a','Can you explain the system?','open','2026-09-01'),('q2','job-2','business-a','Other job question','open','2026-09-02'),('q3','private-job','business-a','Protected question','open','2026-09-03'); UPDATE trade_team_members SET can_send_sms=0,can_view_quotes=1 WHERE id='jane'");
    const actor = { ...jane, canSendSms: false, canViewQuotes: true };
    const result = await f.server.customerMessageThreads(actor, "", 1, f.db);
    assert.deepEqual(result.questions.map(q => q.id), ["q1"]); assert.equal(result.customerThreads.length, 0);
    assert.equal((await f.server.messagesWorkspace(actor, "", 1, f.db)).canUseQuotes, true);
    f.sqlite.exec("UPDATE trade_team_members SET can_view_quotes=0 WHERE id='jane'");
    assert.equal((await f.server.customerMessageThreads(actor, "", 1, f.db)).questions.length, 0);
  } finally { f.close(); }
});

test("unified contact search normalises phone numbers but does not grant customer access or leak teammate phone fields", async () => {
  const f = fixture(); try {
    for (const phone of ["0412345678", "+61 412 345 678"]) assert.equal((await f.server.searchMessageContacts(owner, phone, f.db)).customerThreads[0].customerId, "customer");
    const staff = await f.server.searchMessageContacts({ ...jane, canSendSms: false }, "0412345678", f.db); assert.deepEqual(staff.customerThreads, []);
    const teammate = await f.server.searchMessageContacts(owner, "+61412111111", f.db); assert.deepEqual(teammate.members.map(m => m.id), ["jane", "john"]);
    assert.equal("phone" in teammate.members[0], false);
    assert.equal((await f.server.messagesWorkspace(jane, "", 1, f.db)).members.find(m => m.id === "owner").isOwner, true);
  } finally { f.close(); }
});

test("media-only send attaches once, rejects changed replay and cannot use another participant's upload", async () => {
  const f = fixture(); try {
    const thread = await create(f, owner, ["jane"]);
    const add = (id, uploader = "owner") => f.sqlite.prepare("INSERT INTO trade_message_media VALUES(?, 'business-a',?,'message','image',?,'','',?,'image/png',100,'pending','2026','2099')").run(id,uploader,thread.id,id);
    add("attachment-one-123456"); add("attachment-two-123456"); add("attachment-jane-12345", "jane");
    const saved = await f.server.sendTeamMessage(owner, thread.id, "", request(2), f.db, ["attachment-one-123456"]);
    const again = await f.server.sendTeamMessage(owner, thread.id, "", request(2), f.db, ["attachment-one-123456"]);
    assert.equal(saved.id, again.id); assert.equal(saved.attachments[0].id, "attachment-one-123456");
    await assert.rejects(f.server.sendTeamMessage(owner, thread.id, "", request(2), f.db, ["attachment-two-123456"]), /MESSAGE_REQUEST_CONFLICT/);
    await assert.rejects(f.server.sendTeamMessage(owner, thread.id, "", request(3), f.db, ["attachment-jane-12345"]), /MESSAGE_ACCESS_REQUIRED/);
    await assert.rejects(f.server.sendTeamMessage(owner, thread.id, "", request(4), f.db), /MESSAGE_INVALID/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_internal_messages").get().count, 1);
    assert.equal(f.sqlite.prepare("SELECT state FROM trade_message_media WHERE id='attachment-two-123456'").get().state, "pending");
    assert.equal((await f.server.teamConversation(jane, thread.id, 0, f.db)).messages[0].attachments.length, 1);
  } finally { f.close(); }
});

test("membership revoked between initial access and atomic send prevents a message", async () => {
  const f = fixture(); try {
    const thread = await create(f, owner, ["jane"]), batch = f.db.batch;
    f.db.batch = async statements => { f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='jane'"); return batch(statements); };
    await assert.rejects(f.server.sendTeamMessage(jane, thread.id, "Blocked", request(2), f.db), /MESSAGE_ACCESS_REQUIRED/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_internal_messages").get().count, 0);
  } finally { f.close(); }
});
