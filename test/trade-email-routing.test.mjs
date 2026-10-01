import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as appointmentNotifications from "../src/lib/appointment-notifications.ts";
import { australianAppointmentTimeZone, textAttachment } from "../src/lib/customer-appointment-calendar.ts";
import { directAppointmentInviteDraft } from "../src/lib/direct-appointment-invite.ts";
import { ReminderProviderDeliveryError, reminderProviderFailureOutcome } from "../src/lib/service-reminder-delivery.ts";

function inviteFixture({ configured = true, indeterminate = false, receiptFailure = false } = {}) {
  const source = fs.readFileSync(new URL("../src/lib/direct-appointment-invite-server.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sent = [], receipts = [];
  const db = { prepare: sql => sql.startsWith("INSERT INTO trade_work_order_events") ? { bind: (...values) => ({ run: async () => { if (receiptFailure) throw new Error("receipt write unavailable"); receipts.push(values); return { meta: { changes: 1 } }; } }) } : ({ bind: (appointmentId, ownerUid) => ({ first: async () => {
    assert.equal(appointmentId, "appointment"); assert.equal(ownerUid, "business");
    return { work_order_id: "job", work_number: "JOB-123", revision: 1, first_name: "Jane", customer_email: "jane@example.test",
      trade_business_name: "Johns Electrical", starts_at: "2026-10-10T09:00", ends_at: "2026-10-10T10:00", address_state: "VIC" };
  } }) }) };
  const mocks = {
    "../../db": { getD1: () => db },
    "@/lib/customer-appointment-calendar": { australianAppointmentTimeZone, textAttachment },
    "@/lib/direct-appointment-invite": { directAppointmentInviteDraft },
    "@/lib/service-reminder-delivery": { reminderProviderFailureOutcome },
    "@/lib/trade-email-server": {
      tradeCustomerEmailReadiness: async (ownerUid) => {
        assert.equal(ownerUid, "business"); return { configured, from: "team@jelec.example", provider: "google" };
      },
      sendTradeCustomerEmail: async (ownerUid, actorUid, message) => {
        sent.push({ ownerUid, actorUid, message });
        if (indeterminate) throw new ReminderProviderDeliveryError("indeterminate", "unknown outcome");
        return { provider: "google", providerMessageId: "accepted-id", providerStatus: "accepted" };
      },
    },
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", output)((key) => {
    assert.ok(Object.hasOwn(mocks, key), `Unexpected dependency ${key}`); return mocks[key];
  }, moduleRecord, moduleRecord.exports);
  const input = { appointmentId: "appointment", ownerUid: "business", actorUid: "team-user", origin: "https://example.test" };
  return { sent, receipts, send: () => moduleRecord.exports.sendDirectAppointmentCalendarInvite(input) };
}

test("direct calendar invite uses the team business sender and selected sender as calendar organizer", async () => {
  const f = inviteFixture(); const result = await f.send();
  assert.equal(result.status, "accepted"); assert.doesNotMatch(result.message, /delivered/i);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].ownerUid, "business"); assert.equal(f.sent[0].actorUid, "team-user");
  const calendar = Buffer.from(f.sent[0].message.attachments[0].content, "base64").toString();
  assert.match(calendar, /ORGANIZER;CN=Johns Electrical:mailto:team@jelec\.example/);
  assert.doesNotMatch(calendar, /info@ausenergyassessments|service@reminders/);
  assert.equal(f.receipts.length, 1); assert.match(f.receipts[0][0], /^calendar-invite:appointment:1:/);
  assert.deepEqual(f.receipts[0].slice(1, 4), ["job", "business", "customer_calendar_invite_accepted"]);
  assert.equal(f.receipts[0][4], result.message);
});

test("disconnected calendar sender blocks sending and an unknown send outcome requires reconciliation", async () => {
  const disconnected = inviteFixture({ configured: false }); assert.equal((await disconnected.send()).status, "unavailable"); assert.equal(disconnected.sent.length, 0);
  assert.equal(disconnected.receipts[0][3], "customer_calendar_invite_unavailable");
  const unknown = inviteFixture({ indeterminate: true }); assert.equal((await unknown.send()).status, "reconciliation_required");
  assert.equal(unknown.receipts[0][3], "customer_calendar_invite_reconciliation_required");
});

test("receipt persistence failure preserves actual provider outcome without submitting a second copy", async () => {
  for (const indeterminate of [false, true]) {
    const f = inviteFixture({ indeterminate, receiptFailure: true }); const result = await f.send();
    assert.equal(result.status, indeterminate ? "reconciliation_required" : "accepted");
    assert.match(result.message, /receipt could not be saved.*Check the outgoing mailbox/);
    assert.equal(f.sent.length, 1); assert.equal(f.receipts.length, 0);
  }
});

function appointmentFixture({ platformConfigured = false, indeterminate = false, failSend = false } = {}) {
  const database = new DatabaseSync(":memory:");
  const migration = fs.readFileSync(new URL("../drizzle/0059_appointment_notifications.sql", import.meta.url), "utf8");
  database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  database.exec(`
    CREATE TABLE trade_crm_appointments (id TEXT,work_order_id TEXT,firebase_uid TEXT,revision INTEGER,starts_at TEXT,ends_at TEXT);
    CREATE TABLE trade_work_orders (id TEXT,firebase_uid TEXT,work_number TEXT,title TEXT,service_category TEXT);
    CREATE TABLE customer_project_arrival_proposals (id TEXT,project_id TEXT,customer_uid TEXT,crm_appointment_id TEXT,installer_uid TEXT,status TEXT);
    CREATE TABLE customer_accounts (firebase_uid TEXT,email TEXT,account_updates INTEGER,account_status TEXT);
    CREATE TABLE trade_accounts (firebase_uid TEXT,email TEXT,business_name TEXT,account_status TEXT,email_opportunities INTEGER,consent_at TEXT);
    CREATE TABLE customer_consent_receipts (firebase_uid TEXT,purpose TEXT,withdrawn_at TEXT);
    CREATE TABLE customer_service_reminder_opt_outs (customer_uid TEXT,channel TEXT);
    CREATE TABLE customer_service_reminder_contacts (customer_uid TEXT,mobile_e164 TEXT,mobile_verified_at TEXT);
    CREATE TABLE service_reminder_channel_settings (channel TEXT,provider TEXT,enabled INTEGER,daily_limit INTEGER);
    CREATE TABLE service_reminder_deliveries (channel TEXT,created_at TEXT,status TEXT);
    INSERT INTO trade_crm_appointments VALUES ('appointment','job','business',1,'2026-10-10T09:00','2026-10-10T10:00');
    INSERT INTO trade_work_orders VALUES ('job','business','JOB-123','Electrical work','electrical');
    INSERT INTO customer_project_arrival_proposals VALUES ('proposal','project','customer','appointment','business','selected');
    INSERT INTO customer_accounts VALUES ('customer','client@example.test',1,'active');
    INSERT INTO trade_accounts VALUES ('business','owner@jelec.example','Johns Electrical','active',1,'2026-09-01');
    INSERT INTO customer_consent_receipts VALUES ('customer','customer_account','');
    INSERT INTO service_reminder_channel_settings VALUES ('email','resend',1,1000),('sms','twilio',0,1000);
  `);
  const db = {
    prepare(sql) {
      let values = []; const statement = database.prepare(sql);
      const prepared = {
        bind(...input) { values = input; return prepared; },
        async first() { return statement.get(...values) || null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      };
      return prepared;
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
  const mailbox = []; const platform = []; let shouldFail = failSend;
  const mocks = {
    "../../db": { getD1: () => db },
    "@/lib/appointment-notifications": appointmentNotifications,
    "@/lib/trade-access-server": { verifiedTradeAccountPredicate: () => "trade.account_status = 'active'" },
    "@/lib/service-reminder-delivery": {
      reminderProviderFailureOutcome,
      serviceReminderRetryAt: () => "later",
      serviceReminderProviderConfiguration: () => ({ email: { configured: platformConfigured, callbacks: platformConfigured }, sms: { configured: false, callbacks: false } }),
      sendServiceReminderProviderMessage: async (message) => { platform.push(message); return { provider: "resend", providerMessageId: "platform-id", providerStatus: "accepted" }; },
    },
    "@/lib/trade-email-server": {
      tradeCustomerEmailReadiness: async (ownerUid) => { assert.equal(ownerUid, "business"); return { configured: true, provider: "google", from: "team@jelec.example" }; },
      sendTradeCustomerEmail: async (ownerUid, actorUid, message, options) => {
        mailbox.push({ ownerUid, actorUid, message, options });
        if (indeterminate) throw new ReminderProviderDeliveryError("indeterminate", "unknown outcome");
        if (shouldFail) throw new ReminderProviderDeliveryError("definite_failure", "provider rejected request");
        return { provider: "google", providerMessageId: "mailbox-id", providerStatus: "accepted" };
      },
    },
  };
  const source = fs.readFileSync(new URL("../src/lib/appointment-notification-server.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", output)((key) => { assert.ok(Object.hasOwn(mocks, key)); return mocks[key]; }, moduleRecord, moduleRecord.exports);
  const input = { appointmentId: "appointment", ownerUid: "business", eventType: "staff_assigned", appointmentRevision: 1, origin: "https://example.test" };
  return { database, mailbox, platform, allowSend: () => { shouldFail = false; }, queue: () => moduleRecord.exports.queueAppointmentNotifications(input), retry: (id) => moduleRecord.exports.retryAppointmentNotificationDelivery(id, input.origin) };
}

test("customer appointment emails use the business mailbox without requiring platform credentials or callbacks", async () => {
  const f = appointmentFixture(); assert.equal((await f.queue()).ok, true); await f.queue();
  assert.equal(f.mailbox.length, 1); assert.equal(f.mailbox[0].ownerUid, "business");
  assert.equal(f.mailbox[0].message.recipient, "client@example.test"); assert.equal(f.platform.length, 0);
  const row = f.database.prepare("SELECT provider,status,delivered_at FROM appointment_notification_deliveries WHERE audience='customer' AND channel='email'").get();
  assert.deepEqual({ ...row }, { provider: "google", status: "sent", delivered_at: "" }); f.database.close();
});

test("installer operational appointment notices retain the platform sender", async () => {
  const f = appointmentFixture({ platformConfigured: true }); await f.queue();
  assert.equal(f.mailbox.length, 1); assert.equal(f.platform.length, 1);
  assert.equal(f.platform[0].recipient, "owner@jelec.example"); f.database.close();
});

test("uncertain customer appointment delivery cannot be automatically retried", async () => {
  const f = appointmentFixture({ indeterminate: true }); await f.queue();
  const row = f.database.prepare("SELECT id,status FROM appointment_notification_deliveries WHERE audience='customer' AND channel='email'").get();
  assert.equal(row.status, "reconciliation_required"); assert.equal((await f.retry(row.id)).error, "DELIVERY_NOT_RETRYABLE");
  await f.queue(); assert.equal(f.mailbox.length, 1); f.database.close();
});

test("appointment retries tell the mailbox adapter about earlier provider attempts", async () => {
  const f = appointmentFixture({ failSend: true }); await f.queue();
  const row = f.database.prepare("SELECT id,status FROM appointment_notification_deliveries WHERE audience='customer' AND channel='email'").get();
  assert.equal(row.status, "failed"); f.allowSend(); assert.equal((await f.retry(row.id)).ok, true);
  assert.deepEqual(f.mailbox.map(send => send.options.previouslyAttempted), [false, true]);
  assert.equal(f.mailbox[0].message.idempotencyKey, f.mailbox[1].message.idempotencyKey); f.database.close();
});

function photoPreparationFixture(failureStage, historicalAttempt) {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_crm_photo_request_deliveries (
    id text,photo_request_id text,firebase_uid text,token_issue integer,request_revision integer,channel text,intent text,
    status text,attempts integer,eligibility_reason text,last_error text,provider_message_id text,created_by_uid text,idempotency_key text,
    provider text,provider_status text,sent_at text,failed_at text,updated_at text);
    CREATE TABLE trade_crm_photo_request_delivery_events (id text,delivery_id text,provider_event_key text,event_type text,provider_status text,summary text,occurred_at text,created_at text);
    CREATE TABLE trade_crm_photo_requests (id text,token_issue integer,last_shared_at text,updated_at text);
    INSERT INTO trade_crm_photo_request_deliveries VALUES ('delivery','photo','business',1,1,'email','initial','queued',0,'','','','team-user','photo-key','','','','','');
    INSERT INTO trade_crm_photo_requests VALUES ('photo',1,'','');`);
  if (historicalAttempt) database.exec("UPDATE trade_crm_photo_request_deliveries SET attempts=1,last_error='old provider failure'");
  const db = {
    prepare(sql) {
      const statement = database.prepare(sql); let values = [];
      const prepared = { bind(...input) { values = input; return prepared; },
        async first() { return statement.get(...values) || null; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; } };
      return prepared;
    },
    async batch(statements) { const results = []; for (const statement of statements) results.push(await statement.run()); return results; },
  };
  let fail = true; const sends = [];
  const context = { id: "photo", firebase_uid: "business", token_issue: 1, revision: 1, business_name: "Johns Electrical", work_number: "JOB-123", expires_at: "2026-10-01" };
  const dependencies = {
    getD1: () => db, deliveryContext: async () => context,
    readiness: async () => ({ allowed: true, destination: "customer@example.test" }),
    currentShareUrl: async () => { if (fail && failureStage === "link") throw new Error("link decryption unavailable"); return "https://example.test/photo/secure"; },
    tradeCustomerEmailReadiness: async () => ({ configured: true, provider: "google", from: "team@jelec.example" }),
    photoRequestDeliveryDraft: () => { if (fail && failureStage === "draft") throw new Error("calendar preparation unavailable"); return { subject: "Photos", body: "Please upload photos" }; },
    australianAppointmentTimeZone: () => "Australia/Sydney", text: value => String(value || ""),
    reminderProviderFailureOutcome, serviceReminderRetryAt: () => "later",
    sendTradeCustomerEmail: async (ownerUid, actorUid, message, options) => {
      sends.push({ ownerUid, actorUid, message, options });
      if (options.previouslyAttempted) throw new ReminderProviderDeliveryError("indeterminate", "EMAIL_LEGACY_SEND_UNCERTAIN");
      return { provider: "google", providerMessageId: "photo-receipt", providerStatus: "accepted" };
    },
    sendServiceReminderProviderMessage: async () => { throw new Error("Platform sender must not be called"); },
  };
  const source = fs.readFileSync(new URL("../src/lib/photo-request-delivery-server.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("photo.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "dispatchPhotoRequestDelivery");
  assert.ok(declaration);
  const compiled = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const dispatch = new Function(...Object.keys(dependencies), `${compiled}; return dispatchPhotoRequestDelivery;`)(...Object.values(dependencies));
  return { database, sends, allowPreparation: () => { fail = false; }, send: retry => dispatch("delivery", "https://example.test", retry) };
}

for (const stage of ["link", "draft"]) test(`photo ${stage} preparation can retry without forgetting an earlier provider attempt`, async () => {
  for (const historical of [false, true]) {
    const f = photoPreparationFixture(stage, historical);
    assert.equal((await f.send(false)).ok, false); assert.equal(f.sends.length, 0);
    const failed = f.database.prepare("SELECT last_error FROM trade_crm_photo_request_deliveries WHERE id='delivery'").get();
    assert.equal(failed.last_error === "PROVIDER_NOT_DISPATCHED", !historical);
    f.allowPreparation(); assert.equal((await f.send(true)).ok, !historical);
    assert.equal(f.sends.length, 1); assert.equal(f.sends[0].options.previouslyAttempted, historical);
    const receipt = f.database.prepare("SELECT status,provider_message_id FROM trade_crm_photo_request_deliveries WHERE id='delivery'").get();
    assert.deepEqual({ ...receipt }, historical ? { status: "reconciliation_required", provider_message_id: "" } : { status: "sent", provider_message_id: "photo-receipt" });
    assert.equal((await f.send(true)).error, "DELIVERY_NOT_RETRYABLE"); assert.equal(f.sends.length, 1); f.database.close();
  }
});
