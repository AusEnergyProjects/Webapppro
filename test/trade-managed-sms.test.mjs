import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as pure from "../src/lib/trade-sms.ts";
import * as reminders from "../src/lib/service-reminder-delivery.ts";
import * as clicksend from "../src/lib/trade-clicksend-provider.ts";
import * as billing from "../src/lib/trade-sms-billing.ts";
import * as stripe from "../src/lib/trade-sms-stripe.ts";
import * as abn from "../src/lib/trade-abn.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const source = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", source)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected managed SMS dependency ${name}`);
  }, record, record.exports);
  return record.exports;
}
const owner = { ownerUid: "owner", actorUid: "owner", memberId: "owner-member", displayName: "Business owner", isOwner: true, businessName: "Business", canSendSms: true };
const credentials = { username: "fixture_subaccount", apiKey: "fixture-private-key-123456" };
const from = "+61400000001", phone = "+61412345678", secret = "a".repeat(64);
const sid = "1ABC3200-C38C-6308-BE4B-C7C51D01DCF0", inboundSid = "31BC271B-1E0C-45F6-9E7E-97186C46BB82";
const callbackUrl = `https://example.test/api/trade-sms/clicksend/connection-1?token=${secret}`;
const json = (data) => Response.json({ http_code: 200, response_code: "SUCCESS", data });

async function fixture(balance = 1_000_000) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY, firebase_uid TEXT, phone TEXT, record_status TEXT);
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY, owner_uid TEXT, member_uid TEXT, status TEXT, job_scope TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT, record_status TEXT, source_type TEXT, assignee_member_id TEXT, work_number TEXT, created_at TEXT,stage TEXT DEFAULT 'scheduled');
    CREATE TABLE trade_crm_job_details(work_order_id TEXT PRIMARY KEY, firebase_uid TEXT, crm_customer_id TEXT, customer_source TEXT);
    CREATE TABLE trade_field_sessions(id TEXT PRIMARY KEY, owner_uid TEXT, team_member_id TEXT, status TEXT, expires_at TEXT);
    CREATE TABLE trade_crm_appointments(id TEXT PRIMARY KEY,firebase_uid TEXT,work_order_id TEXT,starts_at TEXT,status TEXT,completed_at TEXT DEFAULT '');
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT,partner_type TEXT,abn TEXT,account_status TEXT,verification_status TEXT,verified_abn TEXT,verification_review_id TEXT,verification_reviewed_at TEXT,verification_reviewed_by_uid TEXT);
    CREATE TABLE trade_account_verification_reviews(id TEXT PRIMARY KEY,firebase_uid TEXT,business_name TEXT,partner_type TEXT,abn TEXT,decision TEXT,review_method TEXT,reviewed_at TEXT,reviewed_by_uid TEXT);`);
  for (const migration of ["0182_trade_sms", "0212_trade_team_sms", "0220_trade_managed_sms"]) sqlite.exec(read(`../drizzle/${migration}.sql`).replaceAll("--> statement-breakpoint", ""));
  const statement = (sql, bindings = []) => {
    const execute = () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } });
    return { bind: (...values) => statement(sql, values), first: async () => sqlite.prepare(sql).get(...bindings) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }), run: async () => execute(), execute };
  };
  let beforeBatch;
  const db = { prepare: statement, batch: async (statements) => {
    if(beforeBatch){const mutation=beforeBatch;beforeBatch=undefined;mutation();}
    sqlite.exec("BEGIN");
    try { const result = statements.map((item) => item.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const env = { CRM_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 91).toString("base64url"), TLINK_SMS_PUBLIC_ORIGIN: "https://example.test" };
  const environment = load("../src/lib/trade-sms-environment.ts", { "cloudflare:workers": { env } });
  const protectedPayload = load("../src/lib/trade-integration-crypto.ts", { "cloudflare:workers": { env }, "@/lib/trade-integration-state": {} });
  const dependencies = { "../../db": { getD1: () => db }, "./trade-integration-crypto": protectedPayload,
    "./trade-clicksend-provider": clicksend, "./trade-sms-billing": billing, "./trade-sms-environment": environment, "./trade-sms-stripe": stripe };
  const wallet = load("../src/lib/trade-sms-wallet-server.ts", dependencies);
  const account = load("../src/lib/trade-sms-account-server.ts", { ...dependencies, "./trade-sms-wallet-server": wallet,
    "./admin-notifications": { adminNotificationStatement: () => { throw new Error("Unexpected rental notification in managed send fixture"); } } });
  const twilio = load("../src/lib/trade-sms-provider.ts", { "./trade-sms": pure });
  const tradeAccess=load("../src/lib/trade-access-server.ts",{"../../db":{getD1:()=>db},"./firebase-server":{},"./creditex-schema-guards":{},"./trade-abn":abn,"./trade-mfa-server":{}});
  const server = load("../src/lib/trade-sms-server.ts", { ...dependencies, "@/lib/trade-integration-crypto": protectedPayload,
    "./trade-access-server":tradeAccess,
    "@/lib/service-reminder-delivery": reminders, "./trade-sms": pure, "./trade-sms-provider": twilio,
    "./trade-sms-wallet-server": wallet, "./trade-sms-account-server": account });
  const now = new Date().toISOString();
  const encrypted = await protectedPayload.encryptProtectedPayload({ ...credentials, callbackToken: secret });
  sqlite.prepare("INSERT INTO trade_sms_accounts(owner_uid,status,subaccount_id,encrypted_credentials,callback_token_hash,created_at,updated_at) VALUES('owner','ready','123',?,?,?,?)").run(encrypted, await protectedPayload.integrationStateHash(secret), now, now);
  sqlite.prepare(`INSERT INTO trade_sms_connections(id,firebase_uid,provider,account_sid,account_label,account_type,number_sid,phone_number,encrypted_credentials,callback_url,status,daily_limit,created_at,updated_at)
    VALUES('connection-1','owner','clicksend','123','TLink SMS','managed',?,?,?,?,'connected',1000,?,?)`).run(from, from, encrypted, callbackUrl, now, now);
  sqlite.prepare("INSERT INTO trade_sms_number_orders(id,owner_uid,request_id,number,status,setup_micro,monthly_micro,connection_id,renewal_at,created_at,updated_at) VALUES('order-1','owner','rental-request-0001',?,'active',0,10000000,'connection-1','2099-01-01T00:00:00.000Z',?,?)").run(from, now, now);
  sqlite.prepare("INSERT INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at) VALUES('initial','owner','top_up',?,'Fixture credit',?)").run(balance, now);
  sqlite.exec("INSERT INTO trade_crm_customers VALUES('customer','owner','0412 345 678','active'),('foreign-customer','foreign-owner','0412 345 678','active')");
  await server.recordSmsConsent(owner, "customer", "Customer requested service SMS by phone", "", db);
  return { sqlite, db, env, server, wallet, account, beforeReservation:mutation=>{beforeBatch=mutation;}, close: () => sqlite.close() };
}
function accepted(options, overrides = {}) {
  const message = JSON.parse(options.body).messages[0];
  const segments = pure.smsSegments(message.body);
  return json({ _currency: { currency_name_short: "AUD" }, total_count: 1, queued_count: 1,
    messages: [{ ...message, subaccount_id: 123, is_shared_system_number: false, status: "SUCCESS", message_id: sid, message_parts: segments, message_price: String(segments * 0.054), ...overrides }] });
}
function inbound(body, changes = {}, url = callbackUrl) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message_id: inboundSid, from: phone, to: from, body, ...changes }) });
}
const send = (f, requestId, transport, options = {}, body = "Appointment reminder") => f.server.sendTradeSms(owner, "customer", body, requestId, "", f.db, transport, options);

test("managed concurrent sends atomically debit exact price and refuse spending the same credit twice", async () => {
  const f = await fixture(99_000);
  try {
    let calls = 0;
    const transport = async (_url, options) => { calls++; return accepted(options); };
    const result = await Promise.allSettled([send(f, "wallet-request-0001", transport), send(f, "wallet-request-0002", transport)]);
    assert.equal(result.filter((row) => row.status === "fulfilled").length, 1);
    assert.equal(result.filter((row) => row.status === "rejected" && /SMS_CREDIT_REQUIRED/.test(row.reason.message)).length, 1);
    assert.equal(calls, 1);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
    assert.equal(f.sqlite.prepare("SELECT amount_micro FROM trade_sms_ledger WHERE kind='sms'").get().amount_micro, -99_000);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_messages").get().n, 1);
  } finally { f.close(); }
});

test("multipart debit uses complete identified body with opt-out footer", async () => {
  const f = await fixture(500_000);
  try {
    const message = await send(f, "multipart-request-01", async (_url, options) => accepted(options), {}, "a".repeat(150));
    assert.equal(message.segments, 2);
    assert.equal(message.priceMicro, 198_000);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 302_000);
  } finally { f.close(); }
});

test("ambiguous send retains debit and reservation; sequential and concurrent replay never sends again", async () => {
  const f = await fixture(99_000);
  try {
    let calls = 0;
    const transport = async () => { calls++; throw new Error("Provider response lost"); };
    const [first, second] = await Promise.all([send(f, "unknown-request-0001", transport), send(f, "unknown-request-0001", transport)]);
    assert.equal(first.id, second.id);
    assert.equal(first.status, "unknown");
    assert.equal((await send(f, "unknown-request-0001", transport)).status, "unknown");
    assert.equal(calls, 1);
    assert.deepEqual(await f.wallet.smsWallet("owner", f.db), { balanceMicro: 0, reservedMicro: 99_000 });
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger WHERE kind='sms_refund'").get().n, 0);
  } finally { f.close(); }
});

test("definitive provider rejection refunds once and replay preserves failed result", async () => {
  const f = await fixture(99_000);
  try {
    let calls = 0;
    const transport = async (_url, options) => { calls++; return accepted(options, { status: "INSUFFICIENT_CREDIT" }); };
    assert.equal((await send(f, "rejected-request-001", transport)).status, "failed");
    assert.equal((await send(f, "rejected-request-001", transport)).status, "failed");
    assert.equal(calls, 1);
    assert.deepEqual(await f.wallet.smsWallet("owner", f.db), { balanceMicro: 99_000, reservedMicro: 0 });
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger WHERE kind='sms_refund'").get().n, 1);
  } finally { f.close(); }
});

test("refund write failure rolls back failed status and keeps one unknown reservation without retrying provider", async () => {
  const f = await fixture(99_000);
  try {
    f.sqlite.exec(`CREATE TRIGGER fail_sms_refund BEFORE INSERT ON trade_sms_ledger WHEN NEW.kind='sms_refund'
      BEGIN SELECT RAISE(ABORT,'Fixture refund storage unavailable'); END`);
    let calls = 0;
    const transport = async (_url, options) => { calls++; return accepted(options, { status: "INSUFFICIENT_CREDIT" }); };
    await assert.rejects(send(f, "atomic-refund-request", transport), /Fixture refund storage unavailable/);
    assert.equal(calls, 1);
    const pending = f.sqlite.prepare("SELECT status,provider_message_sid FROM trade_sms_messages WHERE request_id='atomic-refund-request'").get();
    assert.equal(pending.status, "unknown", "A failed result must never commit without its refund");
    assert.equal(pending.provider_message_sid, "");
    assert.deepEqual(await f.wallet.smsWallet("owner", f.db), { balanceMicro: 0, reservedMicro: 99_000 });
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger WHERE kind='sms_refund'").get().n, 0);
    f.sqlite.exec("DROP TRIGGER fail_sms_refund");
    assert.equal((await send(f, "atomic-refund-request", transport)).status, "unknown");
    assert.equal(calls, 1, "An interrupted refund requires reconciliation, never another SMS attempt");
  } finally { f.close(); }
});

test("managed sending requires ready paid account, active rental, consent and provider URL approval", async () => {
  const f = await fixture();
  try {
    const noSend = async () => assert.fail("Provider must not be called");
    await assert.rejects(send(f, "marketing-request-01", noSend, { purpose: "marketing" }), /SMS_MARKETING_CONSENT_REQUIRED/);
    await assert.rejects(send(f, "url-request-0000001", noSend, {}, "Review us at https://example.test"), /SMS_URL_APPROVAL_REQUIRED/);
    f.sqlite.exec("UPDATE trade_sms_accounts SET status='payment_review'");
    await assert.rejects(send(f, "review-request-00001", noSend), /SMS_ACCOUNT_NOT_READY/);
    f.sqlite.exec("UPDATE trade_sms_accounts SET status='ready'; UPDATE trade_sms_number_orders SET renewal_at='2000-01-01T00:00:00.000Z'");
    await assert.rejects(send(f, "expired-request-0001", noSend), /SMS_LIMIT_OR_PERMISSION_CHANGED/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_messages").get().n, 0);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 1_000_000);
  } finally { f.close(); }
});

test("purpose is part of send identity in both ordinary and concurrent replay", async () => {
  const f = await fixture();
  try {
    await f.server.recordSmsConsent(owner, "customer", "Customer separately agreed to marketing SMS", "", f.db, "marketing");
    let calls = 0;
    const transport = async (_url, options) => { calls++; return accepted(options); };
    const results = await Promise.allSettled([send(f, "purpose-request-0001", transport, { purpose: "service" }), send(f, "purpose-request-0001", transport, { purpose: "marketing" })]);
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    assert.equal(results.filter((row) => row.status === "rejected" && /SMS_REQUEST_CONFLICT/.test(row.reason.message)).length, 1);
    assert.equal(calls, 1);
    const saved = f.sqlite.prepare("SELECT purpose FROM trade_sms_messages").get();
    await assert.rejects(send(f, "purpose-request-0001", transport, { purpose: saved.purpose === "service" ? "marketing" : "service" }), /SMS_REQUEST_CONFLICT/);
  } finally { f.close(); }
});

test("ClickSend inbound authenticates token and number, isolates business and deduplicates STOP/START", async () => {
  const f = await fixture();
  try {
    await f.server.recordSmsConsent(owner, "customer", "Customer separately agreed to marketing SMS", "", f.db, "marketing");
    for (const request of [inbound("Hello", {}, callbackUrl.replace(secret, "b".repeat(64))), inbound("Hello", { to: "+61400000002" }), inbound("Hello", { subaccount_id: "999" }), inbound("Hello", {}, callbackUrl + "&unexpected=true")]) await assert.rejects(f.server.receiveClickSendWebhook(request, "connection-1", f.db), /SMS_WEBHOOK_INVALID/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_messages").get().n, 0);
    await f.server.receiveClickSendWebhook(inbound("STOP"), "connection-1", f.db);
    await f.server.receiveClickSendWebhook(inbound("STOP"), "connection-1", f.db);
    assert.equal((await f.server.smsWorkspace(owner, "customer", "", f.db)).consent, "opted_out");
    await f.server.receiveClickSendWebhook(inbound("START", { message_id: sid }), "connection-1", f.db);
    await f.server.receiveClickSendWebhook(inbound("STOP"), "connection-1", f.db);
    const workspace = await f.server.smsWorkspace(owner, "customer", "", f.db);
    assert.equal(workspace.consent, "allowed");
    assert.equal(workspace.marketingConsent, "required");
    assert.equal(workspace.messages.length, 2);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_messages WHERE firebase_uid='foreign-owner'").get().n, 0);
  } finally { f.close(); }
});

test("ClickSend receipt trusts authenticated lookup over posted status and cannot regress delivered or credit twice", async () => {
  const f = await fixture(99_000);
  try {
    const saved = await send(f, "receipt-request-0001", async (_url, options) => accepted(options));
    let status = 300;
    const transport = async (url, options) => {
      assert.equal(url, `https://rest.clicksend.com/v3/sms/receipts/${sid}`);
      assert.equal(options.headers.Authorization, `Basic ${btoa(`${credentials.username}:${credentials.apiKey}`)}`);
      return json({ message_id: sid, subaccount_id: 123, message_type: "sms", status_code: status, error_code: null, custom_string: saved.id, timestamp: Math.floor(Date.now() / 1000) });
    };
    const request = () => inbound("", { message_id: sid, status_code: 201 }, callbackUrl + "&kind=receipt");
    await f.server.receiveClickSendWebhook(request(), "connection-1", f.db, transport);
    assert.notEqual(f.sqlite.prepare("SELECT status FROM trade_sms_messages").get().status, "delivered");
    status = 201;
    await f.server.receiveClickSendWebhook(request(), "connection-1", f.db, transport);
    status = 200;
    await f.server.receiveClickSendWebhook(request(), "connection-1", f.db, transport);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_messages").get().status, "delivered");
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger").get().n, 2);
  } finally { f.close(); }
});

test("ClickSend receipt cannot claim a provider message from another subaccount", async () => {
  const f = await fixture(99_000);
  try {
    const saved = await send(f, "foreign-receipt-0001", async (_url, options) => accepted(options));
    await assert.rejects(f.server.receiveClickSendWebhook(inbound("", { message_id: sid }, callbackUrl + "&kind=receipt"), "connection-1", f.db,
      async () => json({ message_id: sid, subaccount_id: 999, message_type: "sms", status_code: 201, error_code: null, custom_string: saved.id, timestamp: Math.floor(Date.now() / 1000) })), /SMS_MESSAGE_IDENTITY_MISMATCH/);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_messages").get().status, "queued");
  } finally { f.close(); }
});

async function automationFixture(kind="appointment_reminder") {
  const f=await fixture(),now=new Date().toISOString(),startsAt=new Date(Date.now()+(kind==="appointment_reminder"?86400000:-86400000)).toISOString().slice(0,16);
  f.sqlite.prepare("INSERT INTO trade_accounts VALUES('owner','Business','installer','51824753556','active','approved','51824753556','review',?,'admin')").run(now);
  f.sqlite.prepare("INSERT INTO trade_account_verification_reviews VALUES('review','owner','Business','installer','51824753556','approved','official_abr_lookup',?,'admin')").run(now);
  f.sqlite.prepare("INSERT INTO trade_work_orders(id,firebase_uid,partner_type,record_status,source_type,work_number,created_at) VALUES('job','owner','installer','active','internal','JOB-1',?)").run(now);
  f.sqlite.exec("INSERT INTO trade_crm_job_details VALUES('job','owner','customer','trade_owned')");
  f.sqlite.prepare("INSERT INTO trade_crm_appointments VALUES('appointment','owner','job',?,?,?)").run(startsAt,kind==="appointment_reminder"?"scheduled":"completed",kind==="appointment_reminder"?"":new Date(Date.now()-3600000).toISOString());
  f.sqlite.prepare("INSERT INTO trade_sms_automation_rules(owner_uid,kind,enabled,delay_hours,body,revision,enabled_at,updated_at) VALUES('owner',?,1,24,'Appointment update',1,?,?)").run(kind,now,now);
  f.sqlite.prepare(`INSERT INTO trade_sms_automation_events(id,owner_uid,rule_kind,rule_revision,work_order_id,customer_id,appointment_id,appointment_start,event_key,due_at,status,created_at,updated_at)
    VALUES('event','owner',?,1,'job','customer','appointment',?,'event-key',?,'reserved',?,?)`).run(kind,startsAt,now,now,now);
  return {...f,automation:{eventId:"event",ruleKind:kind,ruleRevision:1,appointmentId:"appointment",appointmentStart:startsAt}};
}
const automatedSend=(f,transport)=>f.server.sendTradeSms({...owner,actorUid:"system:sms-automation"},"customer","Appointment update","automation-send-0001","job",f.db,transport,{purpose:"service",automation:f.automation});

test("eligible automation reserves and debits exactly 99000 using the real verified-business predicate",async()=>{
  const f=await automationFixture();
  try{
    let calls=0;
    const message=await automatedSend(f,async(_url,options)=>{calls++;return accepted(options);});
    assert.equal(message.status,"queued");assert.equal(message.priceMicro,99000);assert.equal(calls,1);
    assert.equal((await f.wallet.smsWallet("owner",f.db)).balanceMicro,901000);
  }finally{f.close();}
});
test("confirmed completed visits remain eligible for after-visit automation",async()=>{
  const f=await automationFixture("appointment_follow_up");
  try{
    const message=await automatedSend(f,async(_url,options)=>accepted(options));
    assert.equal(message.status,"queued");assert.equal(message.priceMicro,99000);
  }finally{f.close();}
});

for(const [label,mutation] of [
  ["appointment completed","UPDATE trade_crm_appointments SET status='completed',completed_at='2026-01-01T00:00:00Z'"],
  ["appointment reassigned to another job","UPDATE trade_crm_appointments SET work_order_id='different-job'"],
  ["job cancelled","UPDATE trade_work_orders SET stage='cancelled'"],
  ["business deactivated","UPDATE trade_accounts SET account_status='inactive'"],
  ["approval review revoked","UPDATE trade_account_verification_reviews SET decision='rejected'"],
  ["business ABN changed","UPDATE trade_accounts SET abn='11111111111'"],
  ["rule disabled","UPDATE trade_sms_automation_rules SET enabled=0"],
  ["rule edited","UPDATE trade_sms_automation_rules SET revision=2"],
  ["customer opted out","UPDATE trade_sms_recipients SET opted_out_at='2026-01-01T00:00:00Z'"],
  ["appointment rescheduled","UPDATE trade_crm_appointments SET starts_at='2099-01-01T09:00'"],
]) test(`automation final reservation stops ${label} after initial reads`,async()=>{
  const f=await automationFixture();
  try{
    f.beforeReservation(()=>f.sqlite.exec(mutation));
    await assert.rejects(automatedSend(f,async()=>assert.fail("Stale automation must not reach provider")),/SMS_LIMIT_OR_PERMISSION_CHANGED/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_messages").get().n,0);
    assert.equal((await f.wallet.smsWallet("owner",f.db)).balanceMicro,1000000);
  }finally{f.close();}
});

for(const [label,completedAt] of [["invalid","not-a-date"],["future","2099-01-01T00:00:00Z"],["missing",""]])
  test(`after-visit final reservation rejects ${label} completion evidence changed after scanning`,async()=>{
    const f=await automationFixture("appointment_follow_up");
    try{
      f.beforeReservation(()=>f.sqlite.prepare("UPDATE trade_crm_appointments SET completed_at=?").run(completedAt));
      await assert.rejects(automatedSend(f,async()=>assert.fail("Unconfirmed visit must not reach provider")),/SMS_LIMIT_OR_PERMISSION_CHANGED/);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_messages").get().n,0);
      assert.equal((await f.wallet.smsWallet("owner",f.db)).balanceMicro,1000000);
    }finally{f.close();}
  });
