import { getD1 } from "../../db";
import { encryptProtectedPayload, decryptProtectedPayload } from "@/lib/trade-integration-crypto";
import { normalizeAustralianMobile, verifyTwilioWebhook } from "@/lib/service-reminder-delivery";
import { smsConsentKeyword, smsDailyLimit, smsSegments, smsStatusRank, tradeSmsBody, twilioSmsStatus } from "./trade-sms";
import { assertSmsNumberRouting, inspectSmsAccount, smsCredentials, submitSms, unwireSmsNumber, wireSmsNumber, type SmsCredentials } from "./trade-sms-provider";
import type { TeamAccess } from "./trade-team-server";

type Connection = { id: string; firebase_uid: string; account_sid: string; account_label: string; account_type: string; number_sid: string; phone_number: string; encrypted_credentials: string; callback_url: string; status: string; daily_limit: number };
type Customer = { id: string; phone: string };
type Recipient = { id: string; customer_id: string; phone_number: string; consent_at: string; opted_out_at: string };
type Message = { id: string; connection_id: string; recipient_id: string; customer_id: string; direction: "inbound" | "outbound"; body: string; status: string; segments: number; request_id: string; provider_message_sid: string; created_at: string; work_order_id: string; actor_uid: string; actor_name: string };
export type SmsActor = Pick<TeamAccess, "ownerUid" | "actorUid" | "memberId" | "displayName" | "isOwner" | "businessName" | "canSendSms" | "fieldSessionId">;
type SmsJob = { id: string; work_number: string };

function publicMessage(row: Message) {
  return { id: row.id, requestId: row.request_id, direction: row.direction, body: row.body, status: row.status, createdAt: row.created_at,
    workOrderId: row.work_order_id, senderName: row.actor_name || "Your business" };
}

// Reused in both reads and mutation reservations so revocation or reassignment cannot race a send.
function smsScopeGuard(actor: SmsActor, customerId: string, workOrderId: string) {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (!actor.isOwner) {
    if (!actor.canSendSms || !workOrderId) throw new Error("SMS_JOB_ACCESS_REQUIRED");
    clauses.push(`EXISTS (SELECT 1 FROM trade_team_members sms_actor WHERE sms_actor.id = ? AND sms_actor.owner_uid = ?
      AND sms_actor.status = 'active' AND sms_actor.can_send_sms = 1 AND ${actor.fieldSessionId
        ? `EXISTS (SELECT 1 FROM trade_field_sessions sms_session WHERE sms_session.id = ? AND sms_session.owner_uid = sms_actor.owner_uid
            AND sms_session.team_member_id = sms_actor.id AND sms_session.status = 'active' AND sms_session.expires_at > ?)`
        : "sms_actor.member_uid = ?"}
      AND EXISTS (SELECT 1 FROM trade_work_orders sms_work WHERE sms_work.id = ? AND sms_work.firebase_uid = sms_actor.owner_uid
        AND (sms_actor.job_scope = 'team' OR sms_work.assignee_member_id = sms_actor.id)))`);
    values.push(actor.memberId, actor.ownerUid, ...(actor.fieldSessionId ? [actor.fieldSessionId, new Date().toISOString()] : [actor.actorUid]), workOrderId);
  }
  if (workOrderId) {
    clauses.push(`EXISTS (SELECT 1 FROM trade_work_orders sms_job JOIN trade_crm_job_details sms_details
      ON sms_details.work_order_id = sms_job.id AND sms_details.firebase_uid = sms_job.firebase_uid
      WHERE sms_job.id = ? AND sms_job.firebase_uid = ? AND sms_job.partner_type = 'installer' AND sms_job.record_status = 'active'
        AND sms_job.source_type <> 'opportunity' AND sms_details.customer_source <> 'platform_private' AND sms_details.crm_customer_id = ?)`);
    values.push(workOrderId, actor.ownerUid, customerId);
  }
  return { sql: clauses.join(" AND ") || "1 = 1", values };
}

async function smsContext(actor: SmsActor, customerId: string, workOrderId: string, db: D1Database) {
  const guard = smsScopeGuard(actor, customerId, workOrderId);
  const allowed = await db.prepare(`SELECT 1 allowed WHERE ${guard.sql}`).bind(...guard.values).first();
  if (!allowed) throw new Error("SMS_JOB_ACCESS_REQUIRED");
  const customer = await currentCustomer(actor.ownerUid, customerId, db);
  const job = workOrderId ? await db.prepare("SELECT id, work_number FROM trade_work_orders WHERE id = ? AND firebase_uid = ?")
    .bind(workOrderId, actor.ownerUid).first<SmsJob>() : null;
  return { customer, job, guard };
}

async function customerSmsJobs(ownerUid: string, customerId: string, db: D1Database) {
  return (await db.prepare(`SELECT w.id, w.work_number FROM trade_work_orders w JOIN trade_crm_job_details d
    ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.firebase_uid = ? AND d.crm_customer_id = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND w.source_type <> 'opportunity' AND d.customer_source <> 'platform_private' ORDER BY w.created_at DESC LIMIT 100`)
    .bind(ownerUid, customerId).all<SmsJob>()).results;
}

async function currentConnection(ownerUid: string, db: D1Database) {
  return db.prepare("SELECT * FROM trade_sms_connections WHERE firebase_uid = ? AND status IN ('connecting', 'connected')").bind(ownerUid).first<Connection>();
}

async function requiredConnection(ownerUid: string, db: D1Database) {
  const connection = await currentConnection(ownerUid, db);
  if (!connection || connection.status !== "connected") throw new Error("SMS_CONNECTION_REQUIRED");
  return connection;
}

async function currentCustomer(ownerUid: string, customerId: string, db: D1Database) {
  if (!customerId || customerId.length > 180) throw new Error("SMS_CUSTOMER_REQUIRED");
  const customer = await db.prepare("SELECT id, phone FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
    .bind(customerId, ownerUid).first<Customer>();
  if (!customer) throw new Error("SMS_CUSTOMER_REQUIRED");
  return customer;
}

async function currentRecipient(connection: Connection, phone: string, db: D1Database) {
  return db.prepare("SELECT * FROM trade_sms_recipients WHERE connection_id = ? AND firebase_uid = ? AND phone_number = ?")
    .bind(connection.id, connection.firebase_uid, phone).first<Recipient>();
}

async function credentialsFor(connection: Connection) {
  const value = await decryptProtectedPayload(connection.encrypted_credentials);
  const credentials = smsCredentials(value.accountSid, value.authToken);
  if (credentials.accountSid !== connection.account_sid) throw new Error("SMS_CREDENTIALS_INVALID");
  return credentials;
}

async function usedSegments(ownerUid: string, db: D1Database, now = new Date().toISOString()) {
  const usage = await db.prepare("SELECT COALESCE(SUM(segments), 0) total FROM trade_sms_messages WHERE firebase_uid = ? AND direction = 'outbound' AND created_at >= ?")
    .bind(ownerUid, `${now.slice(0, 10)}T00:00:00.000Z`).first<{ total: number }>();
  return Number(usage?.total || 0);
}

export async function smsWorkspace(actor: SmsActor, customerId = "", workOrderId = "", db: D1Database = getD1()) {
  const ownerUid = actor.ownerUid;
  if (!customerId && !actor.isOwner) throw new Error("SMS_JOB_ACCESS_REQUIRED");
  const context = customerId ? await smsContext(actor, customerId, workOrderId, db) : null;
  const current = await currentConnection(ownerUid, db);
  const connection = current ? { number: current.phone_number, status: current.status, accountLabel: current.account_label, accountType: current.account_type,
    dailyLimit: current.daily_limit, usedSegments: await usedSegments(ownerUid, db) } : null;
  if (!context) return { connection, canManageConnection: true };
  const { customer, guard } = context;
  const customerPhone = normalizeAustralianMobile(customer.phone);
  const recipient = current && customerPhone ? await currentRecipient(current, customerPhone, db) : null;
  const ownsRecipient = recipient?.customer_id === customerId;
  const consent = ownsRecipient && recipient.opted_out_at ? "opted_out" : ownsRecipient && recipient.consent_at ? "allowed" : "required";
  const history = await db.prepare(`SELECT * FROM trade_sms_messages WHERE firebase_uid = ? AND customer_id = ?
    ${actor.isOwner ? "" : "AND work_order_id = ?"} AND ${guard.sql} ORDER BY created_at DESC, id DESC LIMIT 100`)
    .bind(ownerUid, customerId, ...(!actor.isOwner ? [workOrderId] : []), ...guard.values).all<Message>();
  return { connection, customerPhone, consent, messages: history.results.reverse().map(publicMessage), canManageConnection: actor.isOwner,
    jobNumber: context.job?.work_number || "", jobs: actor.isOwner ? (await customerSmsJobs(ownerUid, customerId, db)).map(job => ({ id: job.id, jobNumber: job.work_number })) : [] };
}

export async function connectSms(ownerUid: string, credentials: SmsCredentials, numberSid: string, limit: unknown, origin: string, db: D1Database = getD1(), fetchImpl: typeof fetch = fetch) {
  const dailyLimit = smsDailyLimit(limit);
  const account = await inspectSmsAccount(credentials, fetchImpl);
  if (!account.numbers.some((number) => number.sid === numberSid)) throw new Error("SMS_NUMBER_INVALID");
  const current = await currentConnection(ownerUid, db);
  if (current && (current.account_sid !== credentials.accountSid || current.number_sid !== numberSid)) throw new Error("SMS_DISCONNECT_FIRST");
  const prior = await db.prepare("SELECT * FROM trade_sms_connections WHERE account_sid = ? AND number_sid = ?").bind(credentials.accountSid, numberSid).first<Connection>();
  if (prior && prior.firebase_uid !== ownerUid) throw new Error("SMS_NUMBER_ALREADY_CONNECTED");
  const id = prior?.id || crypto.randomUUID();
  const callbackUrl = `${origin}/api/trade-sms/twilio/${id}`;
  if (prior && prior.callback_url !== callbackUrl) throw new Error("SMS_CONNECTION_ORIGIN_CHANGED");
  const number = await assertSmsNumberRouting(credentials, numberSid, callbackUrl, fetchImpl);
  const encrypted = await encryptProtectedPayload(credentials);
  const now = new Date().toISOString();
  // Claim the owner/number before changing provider routing. Concurrent connections cannot both wire a number.
  await db.prepare(`INSERT INTO trade_sms_connections
    (id, firebase_uid, account_sid, account_label, account_type, number_sid, phone_number, encrypted_credentials, callback_url, status, daily_limit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connecting', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, account_label = excluded.account_label,
      account_type = excluded.account_type, status = 'connecting', daily_limit = excluded.daily_limit, updated_at = excluded.updated_at
    WHERE trade_sms_connections.firebase_uid = excluded.firebase_uid`)
    .bind(id, ownerUid, credentials.accountSid, account.accountLabel, account.accountType, numberSid, number.number, encrypted, callbackUrl, dailyLimit, now, now).run();
  await wireSmsNumber(credentials, numberSid, callbackUrl, fetchImpl);
  await db.prepare("UPDATE trade_sms_connections SET status = 'connected', updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'connecting'")
    .bind(new Date().toISOString(), id, ownerUid).run();
}

export async function disconnectSms(ownerUid: string, db: D1Database = getD1(), fetchImpl: typeof fetch = fetch) {
  const connection = await currentConnection(ownerUid, db);
  if (!connection) return;
  const credentials = await credentialsFor(connection);
  // Stop local sends even when the provider is temporarily unavailable. Credentials are removed only after cleanup.
  await db.prepare("UPDATE trade_sms_connections SET status = 'connecting' WHERE id = ? AND firebase_uid = ?").bind(connection.id, ownerUid).run();
  await unwireSmsNumber(credentials, connection.number_sid, connection.callback_url, fetchImpl);
  await db.prepare("UPDATE trade_sms_connections SET status = 'disconnected', encrypted_credentials = '', updated_at = ? WHERE id = ? AND firebase_uid = ?")
    .bind(new Date().toISOString(), connection.id, ownerUid).run();
}

export async function recordSmsConsent(actor: SmsActor, customerId: string, note: unknown, workOrderId = "", db: D1Database = getD1()) {
  const ownerUid = actor.ownerUid;
  if (typeof note !== "string" || note.trim().length < 8 || note.trim().length > 500) throw new Error("SMS_CONSENT_NOTE_REQUIRED");
  const { customer, guard } = await smsContext(actor, customerId, workOrderId, db);
  const phone = normalizeAustralianMobile(customer.phone);
  if (!phone) throw new Error("SMS_MOBILE_REQUIRED");
  const connection = await requiredConnection(ownerUid, db);
  const recipient = await currentRecipient(connection, phone, db);
  if (recipient && recipient.customer_id !== customerId) throw new Error("SMS_PHONE_CONFLICT");
  if (recipient?.opted_out_at) throw new Error("SMS_OPTED_OUT");
  const now = new Date().toISOString();
  const saved = await db.prepare(`INSERT INTO trade_sms_recipients (id, connection_id, firebase_uid, customer_id, phone_number, consent_note, consent_at, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql} ON CONFLICT(connection_id, phone_number) DO UPDATE SET consent_note = excluded.consent_note,
      consent_at = excluded.consent_at, updated_at = excluded.updated_at
    WHERE trade_sms_recipients.customer_id = excluded.customer_id AND trade_sms_recipients.firebase_uid = excluded.firebase_uid AND trade_sms_recipients.opted_out_at = '' AND ${guard.sql}`)
    .bind(crypto.randomUUID(), connection.id, ownerUid, customerId, phone, note.trim(), now, now, now, ...guard.values, ...guard.values).run();
  if (!saved.meta.changes) throw new Error("SMS_OPTED_OUT");
}

export async function sendTradeSms(actor: SmsActor, customerId: string, value: unknown, requestId: unknown, workOrderId = "", db: D1Database = getD1(), fetchImpl: typeof fetch = fetch) {
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new Error("SMS_REQUEST_ID_REQUIRED");
  const { customer, job, guard } = await smsContext(actor, customerId, workOrderId, db);
  const body = tradeSmsBody(value, actor.businessName) + (job ? `\nJob ${job.work_number}` : "");
  const prior = await db.prepare("SELECT * FROM trade_sms_messages WHERE firebase_uid = ? AND request_id = ? AND direction = 'outbound'").bind(actor.ownerUid, requestId).first<Message>();
  if (prior) {
    if (prior.customer_id !== customerId || prior.body !== body || prior.work_order_id !== workOrderId || prior.actor_uid !== actor.actorUid) throw new Error("SMS_REQUEST_CONFLICT");
    return publicMessage(prior);
  }
  const connection = await requiredConnection(actor.ownerUid, db);
  const phone = normalizeAustralianMobile(customer.phone);
  if (!phone) throw new Error("SMS_MOBILE_REQUIRED");
  const recipient = await currentRecipient(connection, phone, db);
  if (!recipient || recipient.customer_id !== customerId || !recipient.consent_at) throw new Error("SMS_CONSENT_REQUIRED");
  if (recipient.opted_out_at) throw new Error("SMS_OPTED_OUT");
  const credentials = await credentialsFor(connection);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const segments = smsSegments(body);
  // This single SQLite write reserves all segments, rechecks current consent/phone/connection, and claims the request ID.
  const inserted = await db.prepare(`INSERT OR IGNORE INTO trade_sms_messages
    (id, connection_id, recipient_id, firebase_uid, customer_id, direction, body, status, segments, request_id, created_at, updated_at, work_order_id, actor_uid, actor_name)
    SELECT ?, ?, ?, ?, ?, 'outbound', ?, 'unknown', ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM trade_sms_connections WHERE id = ? AND firebase_uid = ? AND status = 'connected'
      AND daily_limit >= ? + (SELECT COALESCE(SUM(segments), 0) FROM trade_sms_messages WHERE firebase_uid = ? AND direction = 'outbound' AND created_at >= ?))
      AND EXISTS (SELECT 1 FROM trade_sms_recipients WHERE id = ? AND firebase_uid = ? AND customer_id = ? AND consent_at <> '' AND opted_out_at = '')
      AND EXISTS (SELECT 1 FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND phone = ? AND record_status = 'active') AND ${guard.sql}`)
    .bind(id, connection.id, recipient.id, actor.ownerUid, customerId, body, segments, requestId, now, now, workOrderId, actor.actorUid, actor.displayName,
      connection.id, actor.ownerUid, segments, actor.ownerUid, `${now.slice(0, 10)}T00:00:00.000Z`, recipient.id, actor.ownerUid, customerId, customerId, actor.ownerUid, customer.phone, ...guard.values).run();
  if (!inserted.meta.changes) {
    const existing = await db.prepare(`SELECT * FROM trade_sms_messages WHERE firebase_uid = ? AND request_id = ? AND direction = 'outbound' AND ${guard.sql}`).bind(actor.ownerUid, requestId, ...guard.values).first<Message>();
    if (existing && existing.customer_id === customerId && existing.body === body && existing.work_order_id === workOrderId && existing.actor_uid === actor.actorUid) return publicMessage(existing);
    if (existing) throw new Error("SMS_REQUEST_CONFLICT");
    throw new Error("SMS_LIMIT_OR_PERMISSION_CHANGED");
  }
  const result = await submitSms(credentials, { from: connection.phone_number, to: phone, body, callbackUrl: `${connection.callback_url}?messageId=${id}` }, fetchImpl);
  await applyMessageStatus(db, id, connection.id, result.sid, result.status, result.errorCode);
  if (result.errorCode === "21610") await db.prepare("UPDATE trade_sms_recipients SET opted_out_at = ?, updated_at = ? WHERE id = ? AND connection_id = ?")
    .bind(now, now, recipient.id, connection.id).run();
  const saved = await db.prepare("SELECT * FROM trade_sms_messages WHERE id = ? AND firebase_uid = ?").bind(id, actor.ownerUid).first<Message>();
  if (!saved) throw new Error("SMS_MESSAGE_UNAVAILABLE");
  return publicMessage(saved);
}

async function applyMessageStatus(db: D1Database, id: string, connectionId: string, sid: string, status: string, errorCode: string) {
  await db.prepare(`UPDATE trade_sms_messages SET provider_message_sid = CASE WHEN provider_message_sid = '' THEN ? ELSE provider_message_sid END,
    status = CASE WHEN (CASE status WHEN 'delivered' THEN 5 WHEN 'failed' THEN 4 WHEN 'sent' THEN 3 WHEN 'sending' THEN 2 WHEN 'queued' THEN 1 ELSE 0 END) <= ? THEN ? ELSE status END,
    error_code = CASE WHEN ? <> '' THEN ? ELSE error_code END, updated_at = ?
    WHERE id = ? AND connection_id = ? AND direction = 'outbound' AND (provider_message_sid = '' OR provider_message_sid = ? OR ? = '')`)
    .bind(sid, smsStatusRank(status), status, errorCode, errorCode, new Date().toISOString(), id, connectionId, sid, sid).run();
}

export async function linkSmsReply(actor: SmsActor, customerId: string, messageId: string, workOrderId: string, db: D1Database = getD1()) {
  if (!actor.isOwner) throw new Error("SMS_OWNER_REQUIRED");
  if (!workOrderId || !messageId) throw new Error("SMS_JOB_ACCESS_REQUIRED");
  const { guard } = await smsContext(actor, customerId, workOrderId, db);
  const result = await db.prepare(`UPDATE trade_sms_messages SET work_order_id = ?, updated_at = ?
    WHERE id = ? AND firebase_uid = ? AND customer_id = ? AND direction = 'inbound' AND work_order_id IN ('', ?) AND ${guard.sql}`)
    .bind(workOrderId, new Date().toISOString(), messageId, actor.ownerUid, customerId, workOrderId, ...guard.values).run();
  if (!result.meta.changes) throw new Error("SMS_REPLY_CHANGED");
}

async function inboundSmsJob(ownerUid: string, customerId: string, body: string, db: D1Database) {
  const jobs = await customerSmsJobs(ownerUid, customerId, db);
  const mentions = jobs.filter(job => job.work_number && body.toUpperCase().split(/[^A-Z0-9-]+/).includes(job.work_number.toUpperCase()));
  if (mentions.length === 1) return mentions[0].id;
  if (mentions.length > 1 || jobs.length !== 1) return "";
  // A plain reply is safe only for a single job and a single, already established job conversation.
  // Customer-level or historical conversations prevent inferring which job the reply concerns.
  const contexts = (await db.prepare(`SELECT DISTINCT work_order_id FROM trade_sms_messages
    WHERE firebase_uid = ? AND customer_id = ?`).bind(ownerUid, customerId).all<{ work_order_id: string }>()).results;
  return contexts.length === 1 && contexts[0].work_order_id === jobs[0].id ? jobs[0].id : "";
}

export async function receiveSmsWebhook(request: Request, connectionId: string, db: D1Database = getD1()) {
  const connection = await db.prepare("SELECT * FROM trade_sms_connections WHERE id = ? AND status IN ('connecting', 'connected')").bind(connectionId).first<Connection>();
  if (!connection) throw new Error("SMS_WEBHOOK_INVALID");
  const url = new URL(request.url);
  const messageId = url.searchParams.get("messageId") || "";
  const canonical = connection.callback_url + (messageId ? `?messageId=${encodeURIComponent(messageId)}` : "");
  if (url.href !== canonical) throw new Error("SMS_WEBHOOK_INVALID");
  const body = await request.text();
  if (body.length > 24000) throw new Error("SMS_WEBHOOK_INVALID");
  const parameters = new URLSearchParams(body);
  const credentials = await credentialsFor(connection);
  if (!(await verifyTwilioWebhook(canonical, parameters, request.headers.get("x-twilio-signature") || "", credentials.authToken)) || parameters.get("AccountSid") !== connection.account_sid) throw new Error("SMS_WEBHOOK_INVALID");
  const sid = parameters.get("MessageSid") || "";
  if (!/^S[M][0-9a-fA-F]{32}$/.test(sid)) throw new Error("SMS_WEBHOOK_INVALID");
  const now = new Date().toISOString();
  if (messageId) {
    const message = await db.prepare(`SELECT m.*, r.phone_number FROM trade_sms_messages m JOIN trade_sms_recipients r ON r.id = m.recipient_id
      WHERE m.id = ? AND m.connection_id = ? AND m.firebase_uid = ? AND m.direction = 'outbound'`)
      .bind(messageId, connection.id, connection.firebase_uid).first<Message & { phone_number: string }>();
    if (!message || parameters.get("From") !== connection.phone_number || parameters.get("To") !== message.phone_number || (message.provider_message_sid && message.provider_message_sid !== sid)) throw new Error("SMS_WEBHOOK_INVALID");
    const status = twilioSmsStatus(parameters.get("MessageStatus"));
    if (status) await applyMessageStatus(db, message.id, connection.id, sid, status, /^\d{4,6}$/.test(parameters.get("ErrorCode") || "") ? parameters.get("ErrorCode")! : "");
    if (parameters.get("ErrorCode") === "21610") await db.prepare("UPDATE trade_sms_recipients SET opted_out_at = ?, updated_at = ? WHERE id = ? AND connection_id = ?").bind(now, now, message.recipient_id, connection.id).run();
    return;
  }
  if (parameters.get("To") !== connection.phone_number) throw new Error("SMS_WEBHOOK_INVALID");
  const phone = normalizeAustralianMobile(parameters.get("From"));
  if (!phone) return;
  const recipient = await currentRecipient(connection, phone, db);
  // Only a conversation already attached to this business can receive customer messages. No global phone lookup.
  if (!recipient) return;
  const customer = await db.prepare("SELECT id, phone FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
    .bind(recipient.customer_id, connection.firebase_uid).first<Customer>();
  if (!customer || normalizeAustralianMobile(customer.phone) !== phone) return;
  const text = (parameters.get("Body") || "").slice(0, 1600);
  const keyword = smsConsentKeyword(text, (parameters.get("OptOutType") || "").toUpperCase());
  const workOrderId = keyword ? "" : await inboundSmsJob(connection.firebase_uid, recipient.customer_id, text, db);
  const messageKey = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO trade_sms_messages
      (id, connection_id, recipient_id, firebase_uid, customer_id, direction, body, status, segments, provider_message_sid, created_at, updated_at, work_order_id)
      VALUES (?, ?, ?, ?, ?, 'inbound', ?, 'received', ?, ?, ?, ?, ?)`)
      .bind(messageKey, connection.id, recipient.id, connection.firebase_uid, recipient.customer_id, text || "[Non-text message]", smsSegments(text), sid, now, now, workOrderId),
    db.prepare(`UPDATE trade_sms_recipients SET opted_out_at = CASE WHEN ? = 'stop' THEN ? WHEN ? = 'start' AND consent_at <> '' THEN '' ELSE opted_out_at END,
      opt_in_at = CASE WHEN ? = 'start' AND consent_at <> '' THEN ? ELSE opt_in_at END, updated_at = ?
      WHERE id = ? AND connection_id = ? AND EXISTS (SELECT 1 FROM trade_sms_messages WHERE id = ?)`)
      .bind(keyword, now, keyword, keyword, now, now, recipient.id, connection.id, messageKey),
  ]);
}
