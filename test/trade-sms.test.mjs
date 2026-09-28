import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as pure from "../src/lib/trade-sms.ts";
import * as reminders from "../src/lib/service-reminder-delivery.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected SMS dependency ${name}`);
  }, record, record.exports);
  return record.exports;
}

const provider = load("../src/lib/trade-sms-provider.ts", { "./trade-sms": pure });
const protectedPayload = load("../src/lib/trade-integration-crypto.ts", {
  "cloudflare:workers": { env: { CRM_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 91).toString("base64url") } },
  "@/lib/trade-integration-state": {},
});
const credentials = { accountSid: `AC${"a".repeat(32)}`, authToken: "b".repeat(32) };
const numberSid = `PN${"c".repeat(32)}`;
const messageSid = `SM${"d".repeat(32)}`;
const from = "+61400000001";
const phone = "+61412345678";
const origin = "https://example.test";
const owner = { ownerUid: "owner", actorUid: "owner", memberId: "owner-member", displayName: "Business owner", isOwner: true, businessName: "Business", canSendSms: true };
const account = { sid: credentials.accountSid, owner_account_sid: credentials.accountSid, status: "active", type: "Full", friendly_name: "Test trade" };
const number = { sid: numberSid, account_sid: credentials.accountSid, phone_number: from, friendly_name: "Business", capabilities: { sms: true }, sms_url: "", sms_fallback_url: "", sms_application_sid: "" };
const json = (body, status = 200) => Response.json(body, { status });

function providerFetch(overrides = {}) {
  return async (url, options = {}) => {
    const value = String(url);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`);
    if (overrides.request) {
      const response = await overrides.request(value, options);
      if (response) return response;
    }
    if (value.endsWith(`/Accounts/${credentials.accountSid}.json`)) return json({ ...account, ...overrides.account });
    if (value.includes("IncomingPhoneNumbers.json")) return json({ incoming_phone_numbers: [number], next_page_uri: null, ...overrides.list });
    if (value.includes(`/IncomingPhoneNumbers/${numberSid}.json`)) {
      if (options.method === "POST") return json({ ...number, sms_url: options.body.get("SmsUrl"), sms_method: options.body.get("SmsMethod") });
      return json({ ...number, ...overrides.number });
    }
    if (value === "https://messaging.twilio.com/v1/Services?PageSize=100") return json({ services: overrides.services || [], meta: { next_page_url: null } });
    if (value.includes("/PhoneNumbers?")) return json({ phone_numbers: [number], meta: { next_page_url: null } });
    throw new Error(`Unexpected provider request ${value}`);
  };
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON; CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY, firebase_uid TEXT, phone TEXT, record_status TEXT);");
  sqlite.exec(read("../drizzle/0182_trade_sms.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.exec("CREATE TABLE trade_team_members(id TEXT PRIMARY KEY, owner_uid TEXT, member_uid TEXT, status TEXT, job_scope TEXT); CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT, record_status TEXT, source_type TEXT, assignee_member_id TEXT, work_number TEXT, created_at TEXT); CREATE TABLE trade_crm_job_details(work_order_id TEXT PRIMARY KEY, firebase_uid TEXT, crm_customer_id TEXT, customer_source TEXT); CREATE TABLE trade_field_sessions(id TEXT PRIMARY KEY, owner_uid TEXT, team_member_id TEXT, status TEXT, expires_at TEXT);");
  sqlite.exec(read("../drizzle/0212_trade_team_sms.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, 'active')").run("customer", "owner", "0412 345 678");
  sqlite.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, 'active')").run("other-customer", "other", "0412 345 678");
  const statement = (sql, bindings = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...bindings) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
    run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }),
  });
  const db = { prepare: statement, batch: async (statements) => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const item of statements) results.push(await item.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const server = load("../src/lib/trade-sms-server.ts", { "../../db": { getD1: () => db },
    "@/lib/trade-integration-crypto": protectedPayload, "@/lib/service-reminder-delivery": reminders,
    "./trade-sms": pure, "./trade-sms-provider": provider });
  return { sqlite, db, server, close: () => sqlite.close() };
}

async function connected(limit = 100) {
  const f = fixture();
  await f.server.connectSms("owner", credentials, numberSid, limit, origin, f.db, providerFetch());
  await f.server.recordSmsConsent(owner, "customer", "Customer requested service SMS by phone.", "", f.db);
  return f;
}

async function signedRequest(url, values, token = credentials.authToken) {
  const parameters = new URLSearchParams(values);
  const sorted = [...parameters.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  const signature = createHmac("sha1", token).update(url + sorted.map(([key, value]) => key + value).join("")).digest("base64");
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: parameters });
}

async function inbound(f, body, sid = messageSid, extra = {}) {
  const connection = f.sqlite.prepare("SELECT * FROM trade_sms_connections WHERE firebase_uid='owner'").get();
  const request = await signedRequest(connection.callback_url, { AccountSid: credentials.accountSid, MessageSid: sid, From: phone, To: from, Body: body, ...extra });
  await f.server.receiveSmsWebhook(request, connection.id, f.db);
}

test("segment counting includes GSM extension, Unicode and surrogate pairs; body is identified and bounded", () => {
  assert.equal(pure.smsSegments("a".repeat(160)), 1);
  assert.equal(pure.smsSegments("a".repeat(161)), 2);
  assert.equal(pure.smsSegments("^".repeat(81)), 2);
  assert.equal(pure.smsSegments("中".repeat(70)), 1);
  assert.equal(pure.smsSegments("中".repeat(71)), 2);
  assert.equal(pure.smsSegments("😀".repeat(36)), 2);
  assert.equal(pure.tradeSmsBody("On my way", "Test Trade"), "Test Trade: On my way\nReply STOP to unsubscribe.");
  assert.throws(() => pure.tradeSmsBody("a".repeat(481), "Test"), /SMS_BODY_INVALID/);
  assert.throws(() => pure.tradeSmsBody("bad\u0000", "Test"), /SMS_BODY_INVALID/);
  assert.equal(pure.smsDailyLimit(undefined), 100);
  assert.throws(() => pure.smsDailyLimit(1001), /SMS_LIMIT_INVALID/);
});

test("account inspection verifies active main account and exposes no credentials", async () => {
  const result = await provider.inspectSmsAccount(credentials, providerFetch());
  assert.deepEqual(result, { accountLabel: "Test trade", accountType: "Full", numbers: [{ sid: numberSid, number: from, label: "Business" }] });
  assert.ok(!JSON.stringify(result).includes(credentials.authToken));
  await assert.rejects(provider.inspectSmsAccount(credentials, providerFetch({ account: { status: "suspended" } })), /SMS_ACCOUNT_INACTIVE/);
  await assert.rejects(provider.inspectSmsAccount(credentials, providerFetch({ account: { owner_account_sid: `AC${"1".repeat(32)}` } })), /SMS_MAIN_ACCOUNT_REQUIRED/);
  assert.equal((await provider.inspectSmsAccount(credentials, providerFetch({ account: { type: "Trial" } }))).accountType, "Trial");
});

test("provider pagination is bounded and cannot leak credentials to another origin or resource", async () => {
  for (const next of ["https://attacker.test/steal", "https://api.twilio.com/other", "https://api.twilio.com/2010-04-01/Accounts/ACbad/IncomingPhoneNumbers.json"]) {
    await assert.rejects(provider.inspectSmsAccount(credentials, providerFetch({ list: { next_page_uri: next } })), /SMS_PROVIDER_RESPONSE_INVALID/);
  }
});

test("connection refuses conflicting number applications, URLs, fallback URLs and Messaging Service routing", async () => {
  const callback = `${origin}/api/trade-sms/twilio/example`;
  for (const fields of [{ sms_application_sid: `AP${"1".repeat(32)}` }, { sms_url: "https://other.test/messages" }, { sms_fallback_url: "https://other.test/fallback" }]) {
    await assert.rejects(provider.assertSmsNumberRouting(credentials, numberSid, callback, providerFetch({ number: fields })), /SMS_ROUTING_CONFLICT/);
  }
  const service = { sid: `MG${"e".repeat(32)}`, account_sid: credentials.accountSid, use_inbound_webhook_on_number: false };
  await assert.rejects(provider.assertSmsNumberRouting(credentials, numberSid, callback, providerFetch({ services: [service] })), /SMS_ROUTING_CONFLICT/);
  assert.equal((await provider.assertSmsNumberRouting(credentials, numberSid, callback, providerFetch({ services: [{ ...service, use_inbound_webhook_on_number: true }] }))).number, from);
});

test("number wiring edits only SMS routing and disconnect does not overwrite somebody else's webhook", async () => {
  let writes = 0;
  const transport = providerFetch({ request: (_url, options) => { if (options.method === "POST") { writes++; assert.deepEqual([...options.body.keys()].sort(), ["SmsMethod", "SmsUrl"]); } } });
  await provider.wireSmsNumber(credentials, numberSid, `${origin}/callback`, transport);
  assert.equal(writes, 1);
  await provider.unwireSmsNumber(credentials, numberSid, `${origin}/callback`, providerFetch({ number: { sms_url: "https://other.test" }, request: (_url, options) => assert.notEqual(options.method, "POST") }));
});

test("provider timeouts and unconfirmed responses remain unknown while explicit rejection is failed", async () => {
  const input = { from, to: phone, body: "Test", callbackUrl: `${origin}/callback` };
  for (const status of [408, 409, 500, 503]) assert.equal((await provider.submitSms(credentials, input, async () => json({ code: 20000 }, status))).status, "unknown");
  assert.equal((await provider.submitSms(credentials, input, async () => { throw new Error("network"); })).status, "unknown");
  assert.equal((await provider.submitSms(credentials, input, async () => new Response("not JSON", { status: 201 }))).status, "unknown");
  assert.deepEqual(await provider.submitSms(credentials, input, async () => json({ code: 21610 }, 400)), { sid: "", status: "failed", errorCode: "21610" });
});

test("disconnect clears only owned routing fields and requires the provider to confirm cleanup", async () => {
  const callback = `${origin}/callback`;
  let posted;
  await provider.unwireSmsNumber(credentials, numberSid, callback, providerFetch({
    number: { sms_url: "https://other.test/incoming", sms_fallback_url: callback },
    request: (_url, options) => {
      if (options.method !== "POST") return null;
      posted = Object.fromEntries(options.body);
      return json({ ...number, sms_url: "https://other.test/incoming", sms_fallback_url: "" });
    },
  }));
  assert.deepEqual(posted, { SmsFallbackUrl: "" });
  await assert.rejects(provider.unwireSmsNumber(credentials, numberSid, callback, providerFetch({
    number: { sms_url: callback }, request: (_url, options) => options.method === "POST" ? json({ ...number, sms_url: callback }) : null,
  })), /SMS_ROUTING_UNCONFIRMED/);
});

test("connection uses encrypted credentials, tenant ownership and recoverable unconfirmed routing", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.server.connectSms("owner", credentials, numberSid, 100, origin, f.db, providerFetch({ request: (_url, options) => options.method === "POST" ? json({}, 503) : null })), /SMS_PROVIDER_UNAVAILABLE/);
    const state = await f.server.smsWorkspace(owner, "", "", f.db);
    assert.equal(state.connection.status, "connecting");
    const row = f.sqlite.prepare("SELECT * FROM trade_sms_connections").get();
    assert.match(row.encrypted_credentials, /^v1\./);
    assert.ok(!row.encrypted_credentials.includes(credentials.authToken));
    await assert.rejects(f.server.connectSms("other", credentials, numberSid, 100, origin, f.db, providerFetch()), /SMS_NUMBER_ALREADY_CONNECTED/);
    await f.server.disconnectSms("owner", f.db, providerFetch());
    assert.equal((await f.server.smsWorkspace(owner, "", "", f.db)).connection, null);
    assert.equal(f.sqlite.prepare("SELECT encrypted_credentials FROM trade_sms_connections").get().encrypted_credentials, "");
  } finally { f.close(); }
});

test("SQLite reservation makes concurrent duplicate sends idempotent and preserves unknown requests", async () => {
  const f = await connected();
  try {
    let requests = 0;
    const transport = async () => { requests++; await Promise.resolve(); throw new Error("response lost"); };
    const send = () => f.server.sendTradeSms(owner, "customer", "We are coming", "request-00000000001", "", f.db, transport);
    const [first, duplicate] = await Promise.all([send(), send()]);
    assert.equal(requests, 1);
    assert.equal(first.id, duplicate.id);
    assert.equal(first.status, "unknown");
    assert.equal((await send()).status, "unknown");
    assert.equal(requests, 1);
    assert.equal(first.requestId, "request-00000000001");
    await assert.rejects(f.server.sendTradeSms(owner, "customer", "different", "request-00000000001", "", f.db, transport), /SMS_REQUEST_CONFLICT/);
  } finally { f.close(); }
});

test("SQLite daily segment reservation is atomic for different requests and failed sends keep their budget", async () => {
  const f = await connected(1);
  try {
    let requests = 0;
    const transport = async () => { requests++; return json({ code: 21211 }, 400); };
    const calls = ["request-00000000001", "request-00000000002"].map((id) => f.server.sendTradeSms(owner, "customer", "Hello", id, "", f.db, transport));
    const results = await Promise.allSettled(calls);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(requests, 1);
    assert.equal((await f.server.smsWorkspace(owner, "", "", f.db)).connection.usedSegments, 1);
  } finally { f.close(); }
});

test("owner/customer/phone/consent boundaries reject foreign records and changed destinations without a provider call", async () => {
  const f = await connected();
  try {
    const send = (customerId) => f.server.sendTradeSms(owner, customerId, "Hello", "request-00000000001", "", f.db, async () => assert.fail("Must not send"));
    await assert.rejects(send("other-customer"), /SMS_CUSTOMER_REQUIRED/);
    await assert.rejects(f.server.smsWorkspace({ ...owner, ownerUid: "other" }, "customer", "", f.db), /SMS_CUSTOMER_REQUIRED/);
    f.sqlite.prepare("UPDATE trade_crm_customers SET phone = '0499 999 999' WHERE id='customer'").run();
    await assert.rejects(send("customer"), /SMS_CONSENT_REQUIRED/);
    f.sqlite.prepare("UPDATE trade_crm_customers SET phone = 'not mobile' WHERE id='customer'").run();
    assert.equal((await f.server.smsWorkspace(owner, "customer", "", f.db)).customerPhone, "");
  } finally { f.close(); }
});

test("signed inbound is deduplicated, STOP cannot be cleared by consent, and replayed STOP cannot undo START", async () => {
  const f = await connected();
  try {
    await inbound(f, "STOP");
    assert.equal((await f.server.smsWorkspace(owner, "customer", "", f.db)).consent, "opted_out");
    await assert.rejects(f.server.recordSmsConsent(owner, "customer", "Owner says okay again", "", f.db), /SMS_OPTED_OUT/);
    await assert.rejects(f.server.sendTradeSms(owner, "customer", "Hello", "request-00000000001", "", f.db, async () => assert.fail("Must not send")), /SMS_OPTED_OUT/);
    await inbound(f, "START", `SM${"e".repeat(32)}`);
    await inbound(f, "STOP");
    const state = await f.server.smsWorkspace(owner, "customer", "", f.db);
    assert.equal(state.consent, "allowed");
    assert.equal(state.messages.length, 2);
    assert.equal((await f.server.smsWorkspace({ ...owner, ownerUid: "other" }, "other-customer", "", f.db)).messages.length, 0);
  } finally { f.close(); }
});

test("webhooks require the saved URL, account, sender, signature and recipient; ordinary inbound never grants consent", async () => {
  const f = await connected();
  try {
    f.sqlite.prepare("UPDATE trade_sms_recipients SET consent_at=''").run();
    await inbound(f, "START");
    assert.equal((await f.server.smsWorkspace(owner, "customer", "", f.db)).consent, "required");
    await assert.rejects(inbound(f, "Hello", `SM${"e".repeat(32)}`, { AccountSid: `AC${"1".repeat(32)}` }), /SMS_WEBHOOK_INVALID/);
    await assert.rejects(inbound(f, "Hello", `SM${"e".repeat(32)}`, { To: "+61400000002" }), /SMS_WEBHOOK_INVALID/);
    const connection = f.sqlite.prepare("SELECT * FROM trade_sms_connections").get();
    await assert.rejects(f.server.receiveSmsWebhook(new Request(connection.callback_url, { method: "POST", body: "Body=Hello" }), connection.id, f.db), /SMS_WEBHOOK_INVALID/);
    const changed = await signedRequest(connection.callback_url + "?extra=yes", { AccountSid: credentials.accountSid, MessageSid: messageSid, From: phone, To: from, Body: "Hello" });
    await assert.rejects(f.server.receiveSmsWebhook(changed, connection.id, f.db), /SMS_WEBHOOK_INVALID/);
  } finally { f.close(); }
});

test("callback before send response reconciles the opaque message ID and cannot regress delivered status", async () => {
  const f = await connected();
  try {
    const connection = f.sqlite.prepare("SELECT * FROM trade_sms_connections").get();
    const result = await f.server.sendTradeSms(owner, "customer", "Hello", "request-00000000001", "", f.db, async (_url, options) => {
      const callback = options.body.get("StatusCallback");
      const request = await signedRequest(callback, { AccountSid: credentials.accountSid, MessageSid: messageSid, From: from, To: phone, MessageStatus: "delivered" });
      await f.server.receiveSmsWebhook(request, connection.id, f.db);
      return json({ sid: messageSid, account_sid: credentials.accountSid, from, to: phone, status: "queued" }, 201);
    });
    assert.equal(result.status, "delivered");
    assert.equal(f.sqlite.prepare("SELECT provider_message_sid FROM trade_sms_messages").get().provider_message_sid, messageSid);
    const late = await signedRequest(`${connection.callback_url}?messageId=${result.id}`, { AccountSid: credentials.accountSid, MessageSid: messageSid, From: from, To: phone, MessageStatus: "sent" });
    await f.server.receiveSmsWebhook(late, connection.id, f.db);
    assert.equal((await f.server.smsWorkspace(owner, "customer", "", f.db)).messages[0].status, "delivered");
  } finally { f.close(); }
});

test("SMS routes reject foreign origins and owner/verification failures before provider or storage actions", async () => {
  class TradeAccessError extends Error { constructor(code, status) { super("Private access detail"); this.code = code; this.status = status; } }
  let accessCalls = 0;
  let accessError = new TradeAccessError("ABN_REVIEW_REQUIRED", 403);
  const route = load("../src/app/api/trade-sms/route.ts", {
    "@/lib/admin-server": { mfaErrorResponse: () => null, adminJson: (body, status = 200) => Response.json(body, { status }), sameOrigin: (request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin },
    "@/lib/trade-communications-access": { requireTeamCommunicationIdentity: async () => { accessCalls++; throw accessError; } },
    "@/lib/trade-access-server": { TradeAccessError }, "@/lib/trade-sms-server": {}, "@/lib/trade-sms-provider": {},
  });
  assert.equal((await route.POST(new Request(`${origin}/api/trade-sms`, { method: "POST", headers: { Origin: "https://attacker.test" } }))).status, 403);
  assert.equal(accessCalls, 0);
  for (const code of ["ABN_REVIEW_REQUIRED", "TRADE_ROLE_REQUIRED"]) {
    accessError = new TradeAccessError(code, 403);
    assert.equal((await route.GET(new Request(`${origin}/api/trade-sms`))).status, 403);
  }
  accessError = new Error("AUTH_REQUIRED");
  assert.equal((await route.PATCH(new Request(`${origin}/api/trade-sms`, { method: "PATCH" }))).status, 401);
});

const worker = { ...owner, isOwner: false, actorUid: "worker-uid", memberId: "worker", displayName: "Jane Installer", canSendSms: true };
function teamJobs(f, second = true) {
  f.sqlite.exec(`INSERT INTO trade_team_members VALUES ('worker','owner','worker-uid','active','own',1);
    INSERT INTO trade_team_members VALUES ('colleague','owner','colleague-uid','active','team',1);
    INSERT INTO trade_work_orders VALUES ('job-1','owner','installer','active','manual','worker','TLJ-ABC12345','2026-09-01');
    INSERT INTO trade_crm_job_details VALUES ('job-1','owner','customer','internal');`);
  if (second) f.sqlite.exec(`INSERT INTO trade_work_orders VALUES ('job-2','owner','installer','active','manual','colleague','TLJ-DEF12345','2026-09-02');
    INSERT INTO trade_crm_job_details VALUES ('job-2','owner','customer','internal');`);
}
const smsTransport = async () => json({ sid: messageSid, status: "queued" });

test("authorised assigned staff send using the business number; actor and job are recorded and owner can respond", async () => {
  const f = await connected();
  try {
    teamJobs(f);
    let calls = 0;
    const sent = await f.server.sendTradeSms(worker, "customer", "On my way", "worker-request-0001", "job-1", f.db, async (_url, init) => {
      calls++; assert.equal(init.body.get("From"), from); assert.equal(init.body.get("To"), phone);
      assert.match(init.body.get("Body"), /Job TLJ-ABC12345/); return smsTransport();
    });
    assert.equal(sent.senderName, "Jane Installer"); assert.equal(sent.workOrderId, "job-1");
    const record = f.sqlite.prepare("SELECT * FROM trade_sms_messages WHERE id=?").get(sent.id);
    assert.equal(record.actor_uid, worker.actorUid); assert.equal(record.firebase_uid, "owner");
    assert.equal((await f.server.smsWorkspace(owner, "customer", "", f.db)).messages.length, 1);
    assert.equal((await f.server.smsWorkspace(worker, "customer", "job-1", f.db)).messages.length, 1);
    const replay = await f.server.sendTradeSms(worker, "customer", "On my way", "worker-request-0001", "job-1", f.db, async () => assert.fail("duplicate"));
    assert.equal(replay.id, sent.id); assert.equal(calls, 1);
    const reply = await f.server.sendTradeSms(owner, "customer", "Our office can help", "owner-request-00002", "job-1", f.db,
      async () => json({ sid: `SM${"e".repeat(32)}`, status: "sent" }));
    assert.equal(reply.senderName, "Business owner");
    assert.equal((await f.server.smsWorkspace(worker, "customer", "job-1", f.db)).messages.length, 2);
  } finally { f.close(); }
});

test("staff cannot access unassigned, protected, foreign, customer-wide or permission-denied conversations", async () => {
  const f = await connected();
  try {
    teamJobs(f);
    for (const [actor, customerId, jobId] of [[worker,"customer",""], [worker,"customer","job-2"], [worker,"other-customer","job-1"],
      [{ ...worker, canSendSms: false },"customer","job-1"], [{ ...worker, ownerUid: "other" },"customer","job-1"]]) {
      await assert.rejects(f.server.smsWorkspace(actor, customerId, jobId, f.db), /SMS_JOB_ACCESS_REQUIRED/);
      await assert.rejects(f.server.sendTradeSms(actor, customerId, "Hello", "blocked-request-0001", jobId, f.db, async () => assert.fail("Must not send")), /SMS_JOB_ACCESS_REQUIRED/);
      await assert.rejects(f.server.recordSmsConsent(actor, customerId, "Customer agreed today", jobId, f.db), /SMS_JOB_ACCESS_REQUIRED/);
    }
    f.sqlite.exec("UPDATE trade_crm_job_details SET customer_source='platform_private' WHERE work_order_id='job-1'");
    await assert.rejects(f.server.smsWorkspace(worker, "customer", "job-1", f.db), /SMS_JOB_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_crm_job_details SET customer_source='internal'; UPDATE trade_work_orders SET source_type='opportunity' WHERE id='job-1'");
    await assert.rejects(f.server.smsWorkspace(worker, "customer", "job-1", f.db), /SMS_JOB_ACCESS_REQUIRED/);
  } finally { f.close(); }
});

test("SMS reservations recheck revoked permission and changed assignment before contacting the provider", async () => {
  for (const mutation of ["UPDATE trade_team_members SET can_send_sms=0 WHERE id='worker'", "UPDATE trade_team_members SET status='suspended' WHERE id='worker'", "UPDATE trade_work_orders SET assignee_member_id='colleague' WHERE id='job-1'"]) {
    const f = await connected();
    try {
      teamJobs(f); let changed = false;
      const raceDb = { ...f.db, prepare(sql) {
        const statement = f.db.prepare(sql);
        return { ...statement, bind(...values) {
          const bound = statement.bind(...values);
          return { ...bound, async run() {
            if (!changed && sql.startsWith("INSERT OR IGNORE INTO trade_sms_messages")) { changed = true; f.sqlite.exec(mutation); }
            return bound.run();
          } };
        } };
      } };
      await assert.rejects(f.server.sendTradeSms(worker, "customer", "Hello", "race-request-00001", "job-1", raceDb, async () => assert.fail("Must not send")), /SMS_LIMIT_OR_PERMISSION_CHANGED/);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_sms_messages").get().count, 0);
    } finally { f.close(); }
  }
});

test("field sessions require an active unexpired session and never borrow a colleague identity", async () => {
  const f = await connected();
  try {
    teamJobs(f);
    f.sqlite.exec("INSERT INTO trade_field_sessions VALUES('field-session','owner','worker','active','2099-01-01T00:00:00.000Z')");
    const field = { ...worker, actorUid: "field-member:worker", fieldSessionId: "field-session" };
    await f.server.smsWorkspace(field, "customer", "job-1", f.db);
    await assert.rejects(f.server.smsWorkspace({ ...field, memberId: "colleague" }, "customer", "job-1", f.db), /SMS_JOB_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_field_sessions SET status='revoked'");
    await assert.rejects(f.server.smsWorkspace(field, "customer", "job-1", f.db), /SMS_JOB_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_field_sessions SET status='active',expires_at='2000-01-01'");
    await assert.rejects(f.server.smsWorkspace(field, "customer", "job-1", f.db), /SMS_JOB_ACCESS_REQUIRED/);
  } finally { f.close(); }
});

test("staff history excludes other jobs and ambiguous inbound replies until the owner explicitly links them", async () => {
  const f = await connected();
  try {
    teamJobs(f);
    await f.server.sendTradeSms(owner, "customer", "Office message", "owner-request-00001", "job-2", f.db, smsTransport);
    await inbound(f, "Can you please call me?", `SM${"e".repeat(32)}`);
    const all = await f.server.smsWorkspace(owner, "customer", "", f.db);
    const reply = all.messages.find(message => message.direction === "inbound");
    assert.equal(all.messages.length, 2); assert.ok(reply); assert.equal(reply.workOrderId, "");
    assert.equal((await f.server.smsWorkspace(worker, "customer", "job-1", f.db)).messages.length, 0);
    await assert.rejects(f.server.linkSmsReply(worker, "customer", reply.id, "job-1", f.db), /SMS_OWNER_REQUIRED/);
    await assert.rejects(f.server.linkSmsReply({ ...owner, ownerUid: "other" }, "customer", reply.id, "job-1", f.db), /SMS_JOB_ACCESS_REQUIRED/);
    await f.server.linkSmsReply(owner, "customer", reply.id, "job-1", f.db);
    assert.equal((await f.server.smsWorkspace(worker, "customer", "job-1", f.db)).messages.length, 1);
    await assert.rejects(f.server.linkSmsReply(owner, "customer", reply.id, "job-2", f.db), /SMS_REPLY_CHANGED/);
    await inbound(f, "Question about TLJ-DEF12345", `SM${"f".repeat(32)}`);
    assert.equal((await f.server.smsWorkspace(worker, "customer", "job-1", f.db)).messages.length, 1);
    assert.equal((await f.server.smsWorkspace(owner, "customer", "", f.db)).messages.find(message => message.body === "Question about TLJ-DEF12345").workOrderId, "job-2");
  } finally { f.close(); }
});

test("a single established job receives plain replies but historical customer messages prevent guessing", async () => {
  const f = await connected();
  try {
    teamJobs(f, false);
    await f.server.sendTradeSms(worker, "customer", "Hello", "worker-request-0001", "job-1", f.db, smsTransport);
    await inbound(f, "Thanks", `SM${"e".repeat(32)}`);
    assert.equal((await f.server.smsWorkspace(worker, "customer", "job-1", f.db)).messages.find(message => message.body === "Thanks").workOrderId, "job-1");
    f.sqlite.exec("UPDATE trade_sms_messages SET work_order_id='' WHERE direction='outbound'");
    await inbound(f, "One more question", `SM${"f".repeat(32)}`);
    assert.equal((await f.server.smsWorkspace(owner, "customer", "", f.db)).messages.find(message => message.body === "One more question").workOrderId, "");
  } finally { f.close(); }
});

test("staff STOP remains customer-wide, revoked staff cannot replay sends, and stale phone replies are not attached", async () => {
  const f = await connected();
  try {
    teamJobs(f);
    await f.server.sendTradeSms(worker, "customer", "Hello", "worker-request-0001", "job-1", f.db, smsTransport);
    await assert.rejects(f.server.sendTradeSms({ ...worker, actorUid: "colleague-uid", memberId: "colleague" }, "customer", "Hello", "worker-request-0001", "job-1", f.db, async () => assert.fail("Must not send")), /SMS_REQUEST_CONFLICT/);
    await inbound(f, "STOP", `SM${"e".repeat(32)}`);
    assert.equal((await f.server.smsWorkspace(worker, "customer", "job-1", f.db)).consent, "opted_out");
    await assert.rejects(f.server.recordSmsConsent(worker, "customer", "Customer agreed again", "job-1", f.db), /SMS_OPTED_OUT/);
    await assert.rejects(f.server.sendTradeSms(worker, "customer", "Hello again", "worker-request-0002", "job-1", f.db, async () => assert.fail("Must not send")), /SMS_OPTED_OUT/);
    f.sqlite.exec("UPDATE trade_team_members SET can_send_sms=0 WHERE id='worker'");
    await assert.rejects(f.server.sendTradeSms(worker, "customer", "Hello", "worker-request-0001", "job-1", f.db, async () => assert.fail("Must not send")), /SMS_JOB_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_crm_customers SET phone='0499999999' WHERE id='customer'");
    await inbound(f, "TLJ-ABC12345 hello", `SM${"f".repeat(32)}`);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_sms_messages").get().count, 2);
  } finally { f.close(); }
});

test("staff cannot inspect, connect, disconnect or link replies through the SMS API", async () => {
  const route = load("../src/app/api/trade-sms/route.ts", {
    "@/lib/admin-server": { mfaErrorResponse: () => null, adminJson: (body, status = 200) => Response.json(body, { status }), sameOrigin: () => true },
    "@/lib/trade-communications-access": { requireTeamCommunicationIdentity: async () => worker },
    "@/lib/trade-access-server": { TradeAccessError: class extends Error {} }, "@/lib/trade-sms-server": {}, "@/lib/trade-sms-provider": {},
  });
  for (const action of ["inspect", "connect", "link_reply", "disconnect"]) {
    const method = action === "disconnect" ? "PATCH" : "POST";
    assert.equal((await route[method](new Request(`${origin}/api/trade-sms`, { method, body: JSON.stringify({ action }) }))).status, 403);
  }
});
