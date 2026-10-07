import { getD1 } from "../../db";
import { encryptProtectedPayload, decryptProtectedPayload } from "@/lib/trade-integration-crypto";
import { normalizeAustralianMobile, verifyTwilioWebhook } from "@/lib/service-reminder-delivery";
import { smsConsentKeyword, smsDailyLimit, smsSegments, smsStatusRank, tradeSmsBody, twilioSmsStatus } from "./trade-sms";
import { assertSmsNumberRouting, inspectSmsAccount, smsCredentials, submitSms, unwireSmsNumber, wireSmsNumber, type SmsCredentials } from "./trade-sms-provider";
import type { TeamAccess } from "./trade-team-server";
import { managedSmsCredentials } from "./trade-sms-account-server";
import { submitClickSendSms, getClickSendReceipt } from "./trade-clicksend-provider";
import { SMS_PART_PRICE_MICRO } from "./trade-sms-billing";
import { smsWallet } from "./trade-sms-wallet-server";
import { smsEnvironment } from "./trade-sms-environment";
import { integrationStateHash } from "./trade-integration-crypto";
import { verifiedTradeAccountPredicate } from "./trade-access-server";

type Connection = { id: string; firebase_uid: string; provider: "twilio" | "clicksend"; account_sid: string; account_label: string; account_type: string; number_sid: string; phone_number: string; encrypted_credentials: string; callback_url: string; status: string; daily_limit: number };
type Customer = { id: string; phone: string };
type Recipient = { id: string; customer_id: string; phone_number: string; consent_at: string; opted_out_at: string; marketing_consent_at:string };
type Message = { id: string; connection_id: string; recipient_id: string; customer_id: string; direction: "inbound" | "outbound"; body: string; status: string; segments: number; request_id: string; provider_message_sid: string; created_at: string; work_order_id: string; actor_uid: string; actor_name: string; purpose:string; price_micro:number };
export type SmsSendOptions = {purpose?:"service"|"marketing";expectedPhone?:string;automation?:{eventId:string;ruleKind:string;ruleRevision:number;appointmentId:string;appointmentStart:string}};
export type SmsActor = Pick<TeamAccess, "ownerUid" | "actorUid" | "memberId" | "displayName" | "isOwner" | "businessName" | "canSendSms" | "fieldSessionId">;
type SmsJob = { id: string; work_number: string };

function publicMessage(row: Message) {
  return { id: row.id, requestId: row.request_id, direction: row.direction, body: row.body, status: row.status, createdAt: row.created_at,
    workOrderId: row.work_order_id, senderName: row.actor_name || "Your business",purpose:row.purpose,priceMicro:row.price_micro,segments:row.segments };
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
  const connection = current ? { number: current.phone_number, provider:current.provider, status: current.status, accountLabel: current.account_label, accountType: current.account_type,
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
  return { connection, customerPhone, consent, marketingConsent:ownsRecipient && recipient.marketing_consent_at && !recipient.opted_out_at ? "allowed" : "required",
    businessName:actor.businessName,partPriceMicro:current?.provider==="clicksend" ? SMS_PART_PRICE_MICRO : 0,
    balanceMicro:current?.provider==="clicksend" ? (await smsWallet(ownerUid,db)).balanceMicro : null,
    messages: history.results.reverse().map(publicMessage), canManageConnection: actor.isOwner,
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
  if(connection.provider==="clicksend") throw new Error("SMS_MANAGED_CANCELLATION_REQUIRED");
  const credentials = await credentialsFor(connection);
  // Stop local sends even when the provider is temporarily unavailable. Credentials are removed only after cleanup.
  await db.prepare("UPDATE trade_sms_connections SET status = 'connecting' WHERE id = ? AND firebase_uid = ?").bind(connection.id, ownerUid).run();
  await unwireSmsNumber(credentials, connection.number_sid, connection.callback_url, fetchImpl);
  await db.prepare("UPDATE trade_sms_connections SET status = 'disconnected', encrypted_credentials = '', updated_at = ? WHERE id = ? AND firebase_uid = ?")
    .bind(new Date().toISOString(), connection.id, ownerUid).run();
}

export async function recordSmsConsent(actor: SmsActor, customerId: string, note: unknown, workOrderId = "", db: D1Database = getD1(), purpose:"service"|"marketing"="service") {
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
  if(purpose==="marketing") {
    if(!recipient || recipient.customer_id!==customerId || !recipient.consent_at) throw new Error("SMS_CONSENT_REQUIRED");
    const changed=await db.prepare(`UPDATE trade_sms_recipients SET marketing_consent_at=?,marketing_consent_note=?,updated_at=?
      WHERE id=? AND firebase_uid=? AND customer_id=? AND opted_out_at='' AND ${guard.sql}`)
      .bind(now,note.trim(),now,recipient.id,ownerUid,customerId,...guard.values).run();
    if(!changed.meta.changes) throw new Error("SMS_OPTED_OUT"); return;
  }
  const saved = await db.prepare(`INSERT INTO trade_sms_recipients (id, connection_id, firebase_uid, customer_id, phone_number, consent_note, consent_at, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql} ON CONFLICT(connection_id, phone_number) DO UPDATE SET consent_note = excluded.consent_note,
      consent_at = excluded.consent_at, updated_at = excluded.updated_at
    WHERE trade_sms_recipients.customer_id = excluded.customer_id AND trade_sms_recipients.firebase_uid = excluded.firebase_uid AND trade_sms_recipients.opted_out_at = '' AND ${guard.sql}`)
    .bind(crypto.randomUUID(), connection.id, ownerUid, customerId, phone, note.trim(), now, now, now, ...guard.values, ...guard.values).run();
  if (!saved.meta.changes) throw new Error("SMS_OPTED_OUT");
}

export async function sendTradeSms(actor: SmsActor, customerId: string, value: unknown, requestId: unknown, workOrderId = "", db: D1Database = getD1(), fetchImpl: typeof fetch = fetch, options:SmsSendOptions={}) {
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new Error("SMS_REQUEST_ID_REQUIRED");
  const { customer, job, guard } = await smsContext(actor, customerId, workOrderId, db);
  if (options.expectedPhone !== undefined && (!normalizeAustralianMobile(options.expectedPhone)
    || normalizeAustralianMobile(customer.phone) !== normalizeAustralianMobile(options.expectedPhone))) throw new Error("SMS_PHONE_CHANGED");
  const body = tradeSmsBody(value, actor.businessName) + (job ? `\nJob ${job.work_number}` : "");
  const purpose=options.purpose||"service";
  if(purpose!=="service" && purpose!=="marketing") throw new Error("SMS_PURPOSE_INVALID");
  const prior = await db.prepare("SELECT * FROM trade_sms_messages WHERE firebase_uid = ? AND request_id = ? AND direction = 'outbound'").bind(actor.ownerUid, requestId).first<Message>();
  if (prior) {
    if (prior.customer_id !== customerId || prior.body !== body || prior.work_order_id !== workOrderId || prior.actor_uid !== actor.actorUid || (prior.purpose||"service")!==purpose) throw new Error("SMS_REQUEST_CONFLICT");
    return publicMessage(prior);
  }
  const connection = await requiredConnection(actor.ownerUid, db);
  const phone = normalizeAustralianMobile(customer.phone);
  if (!phone) throw new Error("SMS_MOBILE_REQUIRED");
  const recipient = await currentRecipient(connection, phone, db);
  if (!recipient || recipient.customer_id !== customerId || !recipient.consent_at) throw new Error("SMS_CONSENT_REQUIRED");
  if (recipient.opted_out_at) throw new Error("SMS_OPTED_OUT");
  if(purpose==="marketing" && !recipient.marketing_consent_at) throw new Error("SMS_MARKETING_CONSENT_REQUIRED");
  const managed=connection.provider==="clicksend";
  if(managed && /(?:https?:\/\/|www\.)\S+/i.test(body) && !smsEnvironment().urlsEnabled) throw new Error("SMS_URL_APPROVAL_REQUIRED");
  const managedCredentials=managed ? await managedSmsCredentials(actor.ownerUid,db) : null;
  const credentials = managed ? null : await credentialsFor(connection);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const segments = smsSegments(body);
  const price=managed ? segments*SMS_PART_PRICE_MICRO : 0;
  const extraClauses:string[]=[],extraValues:(string|number)[]=[];
  if(managed){
    extraClauses.push(`(SELECT COALESCE(SUM(amount_micro),0) FROM trade_sms_ledger WHERE owner_uid=?)>=?`,
      `EXISTS(SELECT 1 FROM trade_sms_accounts WHERE owner_uid=? AND status='ready')`,
      `EXISTS(SELECT 1 FROM trade_sms_number_orders WHERE owner_uid=? AND connection_id=? AND status='active' AND renewal_at>?)`);
    extraValues.push(actor.ownerUid,price,actor.ownerUid,actor.ownerUid,connection.id,now);
  }
  if(purpose==="marketing"){extraClauses.push("EXISTS(SELECT 1 FROM trade_sms_recipients WHERE id=? AND marketing_consent_at<>'')");extraValues.push(recipient.id);}
  if(options.automation){
    const a=options.automation;
    extraClauses.push(`EXISTS(SELECT 1 FROM trade_sms_automation_events e JOIN trade_sms_automation_rules r ON r.owner_uid=e.owner_uid AND r.kind=e.rule_kind
      JOIN trade_crm_appointments ap ON ap.id=e.appointment_id AND ap.firebase_uid=e.owner_uid
      JOIN trade_work_orders automation_job ON automation_job.id=e.work_order_id AND automation_job.firebase_uid=e.owner_uid
      JOIN trade_crm_job_details automation_details ON automation_details.work_order_id=automation_job.id AND automation_details.firebase_uid=automation_job.firebase_uid
      WHERE e.id=? AND e.owner_uid=? AND e.customer_id=? AND e.work_order_id=? AND e.status='reserved' AND r.kind=? AND r.enabled=1 AND r.revision=?
      AND e.rule_revision=r.revision AND ap.id=? AND ap.starts_at=? AND e.appointment_start=ap.starts_at AND ap.work_order_id=e.work_order_id
      AND automation_job.stage<>'cancelled' AND automation_details.crm_customer_id=e.customer_id AND automation_details.customer_source IN ('trade_owned','public_lead_released')
      AND ((r.kind='appointment_reminder' AND ap.status='scheduled') OR (r.kind IN ('appointment_follow_up','review_request') AND ap.status='completed' AND julianday(ap.completed_at)<=julianday(?)))
      AND EXISTS(SELECT 1 FROM trade_accounts sms_business WHERE sms_business.firebase_uid=e.owner_uid AND sms_business.partner_type='installer'
        AND ${verifiedTradeAccountPredicate("sms_business")}))`);
    extraValues.push(a.eventId,actor.ownerUid,customerId,workOrderId,a.ruleKind,a.ruleRevision,a.appointmentId,a.appointmentStart,now);
  }
  const extraSql=extraClauses.length?` AND ${extraClauses.join(" AND ")}`:"";
  // This single SQLite write reserves all segments, rechecks current consent/phone/connection, and claims the request ID.
  const insertion = db.prepare(`INSERT OR IGNORE INTO trade_sms_messages
    (id, connection_id, recipient_id, firebase_uid, customer_id, direction, body, status, segments, request_id, created_at, updated_at, work_order_id, actor_uid, actor_name,purpose,price_micro)
    SELECT ?, ?, ?, ?, ?, 'outbound', ?, 'unknown', ?, ?, ?, ?, ?, ?, ?,?,?
    WHERE EXISTS (SELECT 1 FROM trade_sms_connections WHERE id = ? AND firebase_uid = ? AND status = 'connected'
      AND daily_limit >= ? + (SELECT COALESCE(SUM(segments), 0) FROM trade_sms_messages WHERE firebase_uid = ? AND direction = 'outbound' AND created_at >= ?))
      AND EXISTS (SELECT 1 FROM trade_sms_recipients WHERE id = ? AND firebase_uid = ? AND customer_id = ? AND consent_at <> '' AND opted_out_at = '')
      AND EXISTS (SELECT 1 FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND phone = ? AND record_status = 'active') AND ${guard.sql}${extraSql}`)
    .bind(id, connection.id, recipient.id, actor.ownerUid, customerId, body, segments, requestId, now, now, workOrderId, actor.actorUid, actor.displayName,purpose,price,
      connection.id, actor.ownerUid, segments, actor.ownerUid, `${now.slice(0, 10)}T00:00:00.000Z`, recipient.id, actor.ownerUid, customerId, customerId, actor.ownerUid, customer.phone, ...guard.values,...extraValues);
  const inserted=managed ? (await db.batch([insertion,db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
    SELECT ?,firebase_uid,'sms',-price_micro,?,? FROM trade_sms_messages WHERE id=?`).bind(`sms:${id}`,`${segments} SMS part${segments===1?"":"s"}`,now,id)]))[0] : await insertion.run();
  if (!inserted.meta.changes) {
    const existing = await db.prepare(`SELECT * FROM trade_sms_messages WHERE firebase_uid = ? AND request_id = ? AND direction = 'outbound' AND ${guard.sql}`).bind(actor.ownerUid, requestId, ...guard.values).first<Message>();
    if (existing && existing.customer_id === customerId && existing.body === body && existing.work_order_id === workOrderId && existing.actor_uid === actor.actorUid && (existing.purpose||'service')===purpose) return publicMessage(existing);
    if (existing) throw new Error("SMS_REQUEST_CONFLICT");
    if(managed && (await smsWallet(actor.ownerUid,db)).balanceMicro<price) throw new Error("SMS_CREDIT_REQUIRED");
    throw new Error("SMS_LIMIT_OR_PERMISSION_CHANGED");
  }
  const result = managedCredentials ? await submitClickSendSms(managedCredentials.credentials,{from:connection.phone_number,to:phone,body,localMessageId:id,subaccountId:managedCredentials.subaccountId},fetchImpl)
    : await submitSms(credentials!, { from: connection.phone_number, to: phone, body, callbackUrl: `${connection.callback_url}?messageId=${id}` }, fetchImpl);
  const update=messageStatusStatement(db, id, connection.id, result.sid, result.status, result.errorCode);
  if(managed && "definitiveRejection" in result && result.definitiveRejection) await db.batch([update,db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
    SELECT ?,firebase_uid,'sms_refund',price_micro,'SMS not accepted by provider',? FROM trade_sms_messages WHERE id=? AND status='failed' AND provider_message_sid=''`)
    .bind(`sms-refund:${id}`,now,id)]);
  else await update.run();
  if (result.errorCode === "21610") await db.prepare("UPDATE trade_sms_recipients SET opted_out_at = ?, updated_at = ? WHERE id = ? AND connection_id = ?")
    .bind(now, now, recipient.id, connection.id).run();
  const saved = await db.prepare("SELECT * FROM trade_sms_messages WHERE id = ? AND firebase_uid = ?").bind(id, actor.ownerUid).first<Message>();
  if (!saved) throw new Error("SMS_MESSAGE_UNAVAILABLE");
  return publicMessage(saved);
}

async function applyMessageStatus(db: D1Database, id: string, connectionId: string, sid: string, status: string, errorCode: string) {
  await messageStatusStatement(db,id,connectionId,sid,status,errorCode).run();
}
function messageStatusStatement(db: D1Database, id: string, connectionId: string, sid: string, status: string, errorCode: string) {
  return db.prepare(`UPDATE trade_sms_messages SET provider_message_sid = CASE WHEN provider_message_sid = '' THEN ? ELSE provider_message_sid END,
    status = CASE WHEN (CASE status WHEN 'delivered' THEN 5 WHEN 'failed' THEN 4 WHEN 'sent' THEN 3 WHEN 'sending' THEN 2 WHEN 'queued' THEN 1 ELSE 0 END) <= ? THEN ? ELSE status END,
    error_code = CASE WHEN ? <> '' THEN ? ELSE error_code END, updated_at = ?
    WHERE id = ? AND connection_id = ? AND direction = 'outbound' AND (provider_message_sid = '' OR provider_message_sid = ? OR ? = '')`)
    .bind(sid, smsStatusRank(status), status, errorCode, errorCode, new Date().toISOString(), id, connectionId, sid, sid);
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
  if (!connection || connection.provider==='clicksend') throw new Error("SMS_WEBHOOK_INVALID");
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
  return storeInboundSms(connection,phone,(parameters.get("Body")||"").slice(0,1600),sid,(parameters.get("OptOutType")||"").toUpperCase(),db);
}

async function storeInboundSms(connection:Connection,phone:string,text:string,sid:string,optOutType:string,db:D1Database) {
  const now=new Date().toISOString();
  const recipient = await currentRecipient(connection, phone, db);
  // Only a conversation already attached to this business can receive customer messages. No global phone lookup.
  if (!recipient) return;
  const customer = await db.prepare("SELECT id, phone FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
    .bind(recipient.customer_id, connection.firebase_uid).first<Customer>();
  if (!customer || normalizeAustralianMobile(customer.phone) !== phone) return;
  const keyword = smsConsentKeyword(text,optOutType);
  const workOrderId = keyword ? "" : await inboundSmsJob(connection.firebase_uid, recipient.customer_id, text, db);
  const messageKey = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO trade_sms_messages
      (id, connection_id, recipient_id, firebase_uid, customer_id, direction, body, status, segments, provider_message_sid, created_at, updated_at, work_order_id)
      VALUES (?, ?, ?, ?, ?, 'inbound', ?, 'received', ?, ?, ?, ?, ?)`)
      .bind(messageKey, connection.id, recipient.id, connection.firebase_uid, recipient.customer_id, text || "[Non-text message]", smsSegments(text), sid, now, now, workOrderId),
    db.prepare(`UPDATE trade_sms_recipients SET opted_out_at = CASE WHEN ? = 'stop' THEN ? WHEN ? = 'start' AND consent_at <> '' THEN '' ELSE opted_out_at END,
      opt_in_at = CASE WHEN ? = 'start' AND consent_at <> '' THEN ? ELSE opt_in_at END,
      marketing_consent_at=CASE WHEN ?='stop' THEN '' ELSE marketing_consent_at END,updated_at = ?
      WHERE id = ? AND connection_id = ? AND EXISTS (SELECT 1 FROM trade_sms_messages WHERE id = ?)`)
      .bind(keyword, now, keyword, keyword, now,keyword, now, recipient.id, connection.id, messageKey),
  ]);
}

export async function receiveClickSendWebhook(request:Request,connectionId:string,db:D1Database=getD1(),fetchImpl:typeof fetch=fetch) {
  const connection=await db.prepare("SELECT * FROM trade_sms_connections WHERE id=? AND provider='clicksend' AND status IN ('connecting','connected')").bind(connectionId).first<Connection>();
  if(!connection) throw new Error("SMS_WEBHOOK_INVALID");
  const url=new URL(request.url), canonical=new URL(connection.callback_url),secret=url.searchParams.get("token")||"";
  if(!/^[a-f0-9]{64}$/.test(secret) || url.origin!==canonical.origin || url.pathname!==canonical.pathname
    || [...url.searchParams.keys()].some(key=>key!=="token"&&key!=="kind")) throw new Error("SMS_WEBHOOK_INVALID");
  const account=await db.prepare("SELECT callback_token_hash FROM trade_sms_accounts WHERE owner_uid=? AND subaccount_id=?").bind(connection.firebase_uid,connection.account_sid).first<{callback_token_hash:string}>();
  if(!account || await integrationStateHash(secret)!==account.callback_token_hash) throw new Error("SMS_WEBHOOK_INVALID");
  if(Number(request.headers.get("content-length")||0)>24000) throw new Error("SMS_WEBHOOK_INVALID");
  const raw=await request.text();if(raw.length>24000) throw new Error("SMS_WEBHOOK_INVALID");
  let body:Record<string,unknown>;
  try{
    const value:unknown=request.headers.get("content-type")?.includes("application/json")?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw));
    if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error(); body=value as Record<string,unknown>;
  }catch{throw new Error("SMS_WEBHOOK_INVALID");}
  const sid=String(body.message_id||"");
  if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(sid)) throw new Error("SMS_WEBHOOK_INVALID");
  if(url.searchParams.get("kind")==="receipt"){
    const {credentials,subaccountId}=await managedSmsCredentials(connection.firebase_uid,db);
    // ClickSend has no published HMAC scheme. Financial/delivery transitions are verified through its authenticated API.
    const receipt=await getClickSendReceipt(credentials,{messageId:sid,subaccountId},fetchImpl);
    const message=await db.prepare(`SELECT * FROM trade_sms_messages WHERE connection_id=? AND firebase_uid=? AND direction='outbound'
      AND (provider_message_sid=? OR (provider_message_sid='' AND id=?))`).bind(connection.id,connection.firebase_uid,sid,receipt.customString||"").first<Message>();
    if(!message || (receipt.customString && receipt.customString!==message.id)) throw new Error("SMS_WEBHOOK_INVALID");
    const status=receipt.statusCode===201?"delivered":receipt.statusCode===301?"failed":receipt.statusCode===200?"sent":"unknown";
    await applyMessageStatus(db,message.id,connection.id,sid,status,receipt.errorCode?String(receipt.errorCode):"");return;
  }
  if(url.searchParams.has("kind") || body.to!==connection.phone_number || (body.subaccount_id!==undefined && String(body.subaccount_id)!==connection.account_sid)
    || typeof body.body!=="string" || body.body.length>5000) throw new Error("SMS_WEBHOOK_INVALID");
  const phone=normalizeAustralianMobile(body.from); if(!phone) throw new Error("SMS_WEBHOOK_INVALID");
  await storeInboundSms(connection,phone,body.body.slice(0,1600),sid,"",db);
}
