import { getD1 } from "../../db";
import { decryptProtectedPayload } from "@/lib/trade-integration-crypto";
import {
  PHOTO_REQUEST_RESEND_LIMIT,
  maskPhotoRequestEmail,
  maskPhotoRequestMobile,
  photoRequestDeliveryDraft,
  photoRequestDeliveryIdempotencyKey,
  photoRequestReminderAvailable,
  type PhotoRequestDeliveryIntent,
} from "@/lib/trade-photo-request-delivery";
import { hashPhotoRequestSecret } from "@/lib/trade-photo-requests";
import {
  normalizeAustralianMobile,
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
  serviceReminderRetryAt,
  type ReminderChannel,
} from "@/lib/service-reminder-delivery";

type Row = Record<string, unknown>;

type DeliveryContext = Row & {
  id: string;
  work_order_id: string;
  firebase_uid: string;
  crm_customer_id: string;
  token_hash: string;
  encrypted_token: string;
  status: string;
  revision: number;
  token_issue: number;
  expires_at: string;
  work_status: string;
  work_record_status: string;
  work_number: string;
  customer_email: string;
  customer_phone: string;
  customer_record_status: string;
  business_name: string;
};

type CustomerAccount = Row & {
  firebase_uid: string;
  email: string;
  account_status: string;
  account_updates: number;
  account_consent: number;
  email_opted_out: number;
  sms_opted_out: number;
  mobile_e164: string;
  mobile_verified_at: string;
};

type Readiness = {
  allowed: boolean;
  status: string;
  reason: string;
  provider: string;
  destination: string;
  preview: string;
  customerUid: string;
  consentBasis: string;
  configured: boolean;
};

const stoppedWorkStatuses = new Set(["cancelled", "canceled", "closed", "complete", "completed"]);

function text(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

function smsSenderApproved() {
  return String(process.env.TLINK_SMS_SENDER_APPROVED || "").toLowerCase() === "true";
}

async function deliveryContext(requestId: string, ownerUid = "") {
  return getD1().prepare(`SELECT r.*, w.stage work_status, w.record_status work_record_status, w.work_number,
      c.email customer_email, c.phone customer_phone, c.record_status customer_record_status,
      trade.business_name
    FROM trade_crm_photo_requests r
    JOIN trade_work_orders w ON w.id = r.work_order_id AND w.firebase_uid = r.firebase_uid
    JOIN trade_crm_job_details details ON details.work_order_id = w.id AND details.firebase_uid = w.firebase_uid
      AND details.crm_customer_id = r.crm_customer_id AND details.customer_source = 'trade_owned'
    JOIN trade_crm_customers c ON c.id = r.crm_customer_id AND c.firebase_uid = r.firebase_uid
    JOIN trade_accounts trade ON trade.firebase_uid = r.firebase_uid
    WHERE r.id = ? AND (? = '' OR r.firebase_uid = ?) LIMIT 1`)
    .bind(requestId, ownerUid, ownerUid).first<DeliveryContext>();
}

async function customerAccount(context: DeliveryContext) {
  if (!context.customer_email) return null;
  return getD1().prepare(`SELECT account.firebase_uid, account.email, account.account_status, account.account_updates,
      EXISTS (SELECT 1 FROM customer_consent_receipts receipt WHERE receipt.firebase_uid = account.firebase_uid
        AND receipt.purpose = 'customer_account' AND receipt.withdrawn_at = '') account_consent,
      EXISTS (SELECT 1 FROM customer_service_reminder_opt_outs optout WHERE optout.customer_uid = account.firebase_uid
        AND optout.channel = 'email') email_opted_out,
      EXISTS (SELECT 1 FROM customer_service_reminder_opt_outs optout WHERE optout.customer_uid = account.firebase_uid
        AND optout.channel = 'sms') sms_opted_out,
      contact.mobile_e164, contact.mobile_verified_at
    FROM customer_accounts account
    LEFT JOIN customer_service_reminder_contacts contact ON contact.customer_uid = account.firebase_uid
    WHERE LOWER(account.email) = LOWER(?) ORDER BY account.updated_at DESC LIMIT 1`)
    .bind(context.customer_email).first<CustomerAccount>();
}

async function channelSetting(channel: ReminderChannel) {
  return getD1().prepare("SELECT channel, provider, enabled, daily_limit FROM service_reminder_channel_settings WHERE channel = ?")
    .bind(channel).first<Row>();
}

async function dailyLimitAvailable(channel: ReminderChannel, dailyLimit: number) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const row = await getD1().prepare(`SELECT
      (SELECT COUNT(*) FROM service_reminder_deliveries WHERE channel = ? AND created_at >= ? AND status NOT IN ('skipped', 'opted_out')) +
      (SELECT COUNT(*) FROM appointment_notification_deliveries WHERE channel = ? AND created_at >= ? AND status NOT IN ('skipped', 'opted_out')) +
      (SELECT COUNT(*) FROM trade_crm_photo_request_deliveries WHERE channel = ? AND created_at >= ?
        AND status NOT IN ('skipped', 'opted_out', 'replaced', 'revoked')) total`)
    .bind(channel, since.toISOString(), channel, since.toISOString(), channel, since.toISOString()).first<Row>();
  return Number(row?.total || 0) < dailyLimit;
}

function requestActive(context: DeliveryContext) {
  return context.status === "active" && context.expires_at > new Date().toISOString()
    && context.work_record_status === "active" && context.customer_record_status === "active"
    && !stoppedWorkStatuses.has(context.work_status);
}

async function readiness(context: DeliveryContext, channel: ReminderChannel): Promise<Readiness> {
  const provider = channel === "email" ? "resend" : "twilio";
  if (!requestActive(context)) return { allowed: false, status: "stopped", reason: "This request or job is no longer active.", provider,
    destination: "", preview: "", customerUid: "", consentBasis: "", configured: false };
  if (!context.encrypted_token || !context.token_hash || Number(context.token_issue) < 1) return { allowed: false, status: "stopped",
    reason: "Replace the secure link once before using direct delivery.", provider, destination: "", preview: "", customerUid: "", consentBasis: "", configured: false };

  const account = await customerAccount(context);
  const priorOptOut = await getD1().prepare(`SELECT 1 opted_out FROM trade_crm_photo_request_deliveries
    WHERE firebase_uid = ? AND crm_customer_id = ? AND channel = ? AND status = 'opted_out' LIMIT 1`)
    .bind(context.firebase_uid, context.crm_customer_id, channel).first<Row>();
  if (priorOptOut || (channel === "email" ? Boolean(account?.email_opted_out) : Boolean(account?.sms_opted_out))) {
    return { allowed: false, status: "opted_out", reason: `This customer has opted out of ${channel}.`, provider,
      destination: "", preview: "", customerUid: text(account?.firebase_uid, 180), consentBasis: "", configured: false };
  }

  let destination = "";
  let preview = "";
  let consentBasis = "installer_confirmed_current_request";
  if (channel === "email") {
    destination = text(context.customer_email, 320).toLowerCase();
    preview = maskPhotoRequestEmail(destination);
    if (!/^\S+@\S+\.\S+$/.test(destination)) return { allowed: false, status: "skipped", reason: "Add a valid primary customer email first.",
      provider, destination: "", preview: "", customerUid: text(account?.firebase_uid, 180), consentBasis: "", configured: false };
    if (account) {
      const consent = account.account_status === "active" && Boolean(account.account_updates) && Boolean(account.account_consent);
      if (!consent) return { allowed: false, status: "skipped", reason: "The linked customer account has not allowed project update emails.",
        provider, destination: "", preview, customerUid: text(account.firebase_uid, 180), consentBasis: "", configured: false };
      consentBasis = "customer_account_project_updates";
    }
  } else {
    const crmMobile = normalizeAustralianMobile(context.customer_phone);
    const verifiedMobile = text(account?.mobile_e164, 32);
    preview = maskPhotoRequestMobile(verifiedMobile || crmMobile);
    const consent = account?.account_status === "active" && Boolean(account.account_updates) && Boolean(account.account_consent)
      && Boolean(account.mobile_verified_at) && Boolean(verifiedMobile) && verifiedMobile === crmMobile;
    if (!consent) return { allowed: false, status: "skipped",
      reason: "SMS requires a matching customer account, project update consent and verified primary mobile.", provider,
      destination: "", preview, customerUid: text(account?.firebase_uid, 180), consentBasis: "", configured: false };
    destination = verifiedMobile;
    consentBasis = "customer_account_verified_mobile";
  }

  const setting = await channelSetting(channel);
  const providers = serviceReminderProviderConfiguration();
  const configured = channel === "email" ? providers.email.configured && providers.email.callbacks
    : providers.sms.configured && providers.sms.callbacks;
  const selectedProvider = text(setting?.provider, 30) || provider;
  if (channel === "sms" && !smsSenderApproved()) return { allowed: false, status: "waiting_for_sender",
    reason: "TLink Australian SMS sender approval is still pending.", provider: selectedProvider, destination: "", preview,
    customerUid: text(account?.firebase_uid, 180), consentBasis, configured };
  if (!setting || !Boolean(setting.enabled) || !configured) return { allowed: false, status: "waiting_for_channel",
    reason: "This provider channel and its authenticated callbacks are not active.", provider: selectedProvider, destination: "", preview,
    customerUid: text(account?.firebase_uid, 180), consentBasis, configured };
  if (!(await dailyLimitAvailable(channel, Number(setting.daily_limit || 1)))) return { allowed: false, status: "waiting_for_limit",
    reason: "The channel daily safety limit has been reached.", provider: selectedProvider, destination: "", preview,
    customerUid: text(account?.firebase_uid, 180), consentBasis, configured };
  return { allowed: true, status: "queued", reason: "", provider: selectedProvider, destination, preview,
    customerUid: text(account?.firebase_uid, 180), consentBasis, configured };
}

async function currentShareUrl(context: DeliveryContext, origin: string) {
  const protectedValue = await decryptProtectedPayload(context.encrypted_token);
  const secret = text(protectedValue.secret, 100);
  if (protectedValue.requestId !== context.id || Number(protectedValue.tokenIssue) !== Number(context.token_issue)
    || !secret || await hashPhotoRequestSecret(secret) !== context.token_hash) throw new Error("PHOTO_REQUEST_LINK_STALE");
  return `${origin}/job-information/${context.id}.${secret}`;
}

function deliveryPayload(row: Row) {
  return {
    id: String(row.id), channel: String(row.channel), provider: String(row.provider), intent: String(row.intent),
    status: String(row.status), eligibilityReason: String(row.eligibility_reason || ""), attempts: Number(row.attempts),
    providerStatus: String(row.provider_status || ""), lastError: String(row.last_error || ""),
    queuedAt: String(row.queued_at), sentAt: String(row.sent_at || ""), deliveredAt: String(row.delivered_at || ""),
    failedAt: String(row.failed_at || ""), updatedAt: String(row.updated_at),
  };
}

export async function photoRequestDeliveryOverview(requestId: string, ownerUid: string) {
  const context = await deliveryContext(requestId, ownerUid);
  if (!context) return { channels: [], deliveries: [], reminderAvailable: false, linkDeliverable: false };
  const [email, sms, deliveries] = await Promise.all([
    readiness(context, "email"), readiness(context, "sms"),
    getD1().prepare(`SELECT id, channel, provider, intent, status, eligibility_reason, attempts, provider_status,
        last_error, queued_at, sent_at, delivered_at, failed_at, updated_at
      FROM trade_crm_photo_request_deliveries WHERE photo_request_id = ? AND firebase_uid = ?
      ORDER BY created_at DESC LIMIT 20`).bind(requestId, ownerUid).all<Row>(),
  ]);
  return {
    channels: [email, sms].map((item, index) => ({ channel: index === 0 ? "email" : "sms", recipientPreview: item.preview,
      available: item.allowed, reason: item.reason, provider: item.provider, configured: item.configured,
      consentBasis: item.consentBasis })),
    deliveries: deliveries.results.map(deliveryPayload),
    reminderAvailable: requestActive(context) && photoRequestReminderAvailable(context.expires_at),
    linkDeliverable: Boolean(context.encrypted_token && Number(context.token_issue) > 0),
  };
}

async function dispatchPhotoRequestDelivery(deliveryId: string, origin: string, retry = false) {
  const db = getD1();
  const delivery = await db.prepare("SELECT * FROM trade_crm_photo_request_deliveries WHERE id = ?").bind(deliveryId).first<Row>();
  if (!delivery) return { ok: false, error: "DELIVERY_NOT_FOUND" };
  const allowed = retry ? ["failed", "waiting_for_channel", "waiting_for_sender", "waiting_for_limit"] : ["queued"];
  if (!allowed.includes(String(delivery.status)) || Number(delivery.attempts) >= 3) return { ok: false, error: "DELIVERY_NOT_RETRYABLE" };
  const context = await deliveryContext(String(delivery.photo_request_id), String(delivery.firebase_uid));
  if (!context) return { ok: false, error: "PHOTO_REQUEST_NOT_FOUND" };
  if (Number(delivery.token_issue) !== Number(context.token_issue) || Number(delivery.request_revision) !== Number(context.revision)) {
    await db.prepare("UPDATE trade_crm_photo_request_deliveries SET status = 'replaced', eligibility_reason = 'A newer request or link replaced this delivery.', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), deliveryId).run();
    return { ok: false, error: "PHOTO_REQUEST_LINK_STALE" };
  }
  const channel = String(delivery.channel) as ReminderChannel;
  const ready = await readiness(context, channel); const now = new Date().toISOString();
  if (!ready.allowed) {
    await db.prepare("UPDATE trade_crm_photo_request_deliveries SET status = ?, eligibility_reason = ?, updated_at = ? WHERE id = ?")
      .bind(ready.status, ready.reason, now, deliveryId).run();
    return { ok: false, error: ready.status };
  }
  const attempts = Number(delivery.attempts) + 1;
  const claim = await db.prepare(`UPDATE trade_crm_photo_request_deliveries SET status = 'sending', attempts = ?, eligibility_reason = '',
      updated_at = ? WHERE id = ? AND status = ? AND attempts = ?`)
    .bind(attempts, now, deliveryId, delivery.status, delivery.attempts).run();
  if (!claim.meta.changes) return { ok: false, error: "DELIVERY_ALREADY_CLAIMED" };
  try {
    const shareUrl = await currentShareUrl(context, origin);
    const draft = photoRequestDeliveryDraft({ intent: String(delivery.intent) as PhotoRequestDeliveryIntent,
      businessName: context.business_name, workNumber: context.work_number, shareUrl, expiresAt: context.expires_at });
    const result = await sendServiceReminderProviderMessage({ channel, recipient: ready.destination, subject: draft.subject, body: draft.body,
      idempotencyKey: String(delivery.idempotency_key), messageType: "photo_request_link",
      callbackUrl: new URL("/api/service-reminder-provider-events/twilio", origin).toString() });
    await db.batch([
      db.prepare(`UPDATE trade_crm_photo_request_deliveries SET status = 'sent', attempts = ?, provider = ?, provider_message_id = ?,
        provider_status = ?, eligibility_reason = '', last_error = '', sent_at = ?, updated_at = ? WHERE id = ?`)
        .bind(attempts, result.provider, result.providerMessageId, result.providerStatus, now, now, deliveryId),
      db.prepare(`INSERT INTO trade_crm_photo_request_delivery_events
        (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
        VALUES (?, ?, ?, 'provider_accepted', ?, 'Provider accepted photo request delivery.', ?, ?)`)
        .bind(crypto.randomUUID(), deliveryId, `accepted:${deliveryId}:${attempts}`, result.providerStatus, now, now),
      db.prepare("UPDATE trade_crm_photo_requests SET last_shared_at = ?, updated_at = ? WHERE id = ? AND token_issue = ?")
        .bind(now, now, context.id, context.token_issue),
    ]);
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? text(error.message, 180) : "Provider delivery failed.";
    await db.prepare(`UPDATE trade_crm_photo_request_deliveries SET status = 'failed', attempts = ?, last_error = ?, failed_at = ?,
      eligibility_reason = '', updated_at = ? WHERE id = ?`).bind(attempts, reason, now, now, deliveryId).run();
    return { ok: false, error: reason, retryAt: serviceReminderRetryAt(attempts) };
  }
}

async function deliveryIntent(requestId: string, tokenIssue: number, channel: ReminderChannel, requested: "initial" | "resend" | "expiry_reminder", expiresAt: string) {
  if (requested === "initial") return "initial" as const;
  if (requested === "expiry_reminder") {
    if (!photoRequestReminderAvailable(expiresAt)) throw new Error("PHOTO_REQUEST_REMINDER_NOT_DUE");
    return "expiry_reminder" as const;
  }
  const row = await getD1().prepare(`SELECT COUNT(*) total FROM trade_crm_photo_request_deliveries
    WHERE photo_request_id = ? AND token_issue = ? AND channel = ? AND intent LIKE 'resend_%'`)
    .bind(requestId, tokenIssue, channel).first<Row>();
  const next = Number(row?.total || 0) + 1;
  if (next > PHOTO_REQUEST_RESEND_LIMIT) throw new Error("PHOTO_REQUEST_RESEND_LIMIT");
  return `resend_${next}` as "resend_1" | "resend_2";
}

export async function sendPhotoRequestDelivery(input: {
  requestId: string;
  ownerUid: string;
  actorUid: string;
  channel: ReminderChannel;
  requestedIntent: "initial" | "resend" | "expiry_reminder";
  consentConfirmed: boolean;
  origin: string;
}) {
  const context = await deliveryContext(input.requestId, input.ownerUid);
  if (!context) throw new Error("PHOTO_REQUEST_NOT_FOUND");
  if (!input.consentConfirmed) throw new Error("CONSENT_CONFIRMATION_REQUIRED");
  const ready = await readiness(context, input.channel);
  if (!ready.allowed) throw new Error(ready.status);
  const intent = await deliveryIntent(context.id, Number(context.token_issue), input.channel, input.requestedIntent, context.expires_at);
  const idempotencyKey = await photoRequestDeliveryIdempotencyKey({ requestId: context.id, requestRevision: Number(context.revision),
    tokenIssue: Number(context.token_issue), intent, channel: input.channel });
  const db = getD1(); const deliveryId = crypto.randomUUID(); const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO trade_crm_photo_request_deliveries
    (id, photo_request_id, work_order_id, firebase_uid, crm_customer_id, customer_uid, channel, provider,
     request_revision, token_issue, intent, idempotency_key, consent_basis, consent_confirmed_at, status,
     eligibility_reason, attempts, provider_message_id, queued_at, created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', '', 0, ?, ?, ?, ?, ?)`)
    .bind(deliveryId, context.id, context.work_order_id, context.firebase_uid, context.crm_customer_id, ready.customerUid,
      input.channel, ready.provider, context.revision, context.token_issue, intent, idempotencyKey, ready.consentBasis, now,
      deliveryId, now, input.actorUid, now, now).run();
  const stored = await db.prepare("SELECT id, status, attempts FROM trade_crm_photo_request_deliveries WHERE idempotency_key = ?")
    .bind(idempotencyKey).first<Row>();
  if (!stored) throw new Error("DELIVERY_NOT_FOUND");
  if (String(stored.id) !== deliveryId || Number(stored.attempts) > 0) return { ok: true, duplicate: true, deliveryId: String(stored.id) };
  const result = await dispatchPhotoRequestDelivery(deliveryId, input.origin);
  return { ...result, duplicate: false, deliveryId };
}

export async function retryPhotoRequestDelivery(deliveryId: string, origin: string) {
  return dispatchPhotoRequestDelivery(deliveryId, origin, true);
}
