import { getD1 } from "../../db";
import {
  opportunityNotificationDraft,
  opportunityNotificationEmailHash,
  opportunityNotificationIdempotencyKey,
} from "@/lib/opportunity-notifications";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
  serviceReminderRetryAt,
} from "@/lib/service-reminder-delivery";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";

type DeliveryRow = Record<string, unknown>;

type DrainOptions = {
  limit?: number;
  fetchImpl?: typeof fetch;
};

const CALLBACK_URL =
  "https://compare.ausenergyassessments.com/api/service-reminder-provider-events/resend";
const MAX_ATTEMPTS = 3;

function text(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

function list(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map((item) => text(item, 40)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function validEmail(value: unknown) {
  const email = text(value, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

async function deliveryContext(deliveryId: string) {
  return getD1().prepare(`SELECT delivery.id delivery_id, delivery.match_id, delivery.status delivery_status,
      delivery.attempts, delivery.recipient_email_hash, delivery.idempotency_key,
      delivery.subject, delivery.body,
      assignment.firebase_uid, assignment.status match_status, assignment.matched_categories,
      opportunity.state, opportunity.timing, opportunity.expires_at,
      opportunity.created_at opportunity_created_at, opportunity.status opportunity_status,
      account.email, account.business_name, account.consent_at, account.email_opportunities,
      CASE WHEN ${verifiedTradeAccountPredicate("account")} AND account.partner_type = 'installer'
        THEN 1 ELSE 0 END installer_access_approved,
      COALESCE((
        SELECT COUNT(*)
        FROM customer_project_evidence evidence
        JOIN customer_projects project ON project.id = evidence.project_id
        WHERE project.opportunity_id = opportunity.id
          AND evidence.status = 'active'
          AND evidence.sharing_scope = 'allocated-installers'
          AND EXISTS (
            SELECT 1
            FROM customer_consent_receipts consent
            WHERE consent.project_id = project.id
              AND consent.firebase_uid = project.firebase_uid
              AND consent.purpose = 'installer_evidence_sharing'
              AND consent.withdrawn_at = ''
          )
      ), 0) approved_evidence_count
    FROM trade_opportunity_notification_deliveries delivery
    JOIN trade_opportunity_matches assignment ON assignment.id = delivery.match_id
    JOIN trade_opportunities opportunity ON opportunity.id = assignment.opportunity_id
    JOIN trade_accounts account ON account.firebase_uid = assignment.firebase_uid
    WHERE delivery.id = ? LIMIT 1`)
    .bind(deliveryId).first<DeliveryRow>();
}

function ineligibility(context: DeliveryRow) {
  if (Number(context.installer_access_approved || 0) !== 1) {
    return "The installer no longer has active verified access.";
  }
  if (!String(context.consent_at || "") || !Boolean(context.email_opportunities)) {
    return "Opportunity email consent is not active.";
  }
  if (context.opportunity_status !== "open") {
    return "The opportunity is no longer open.";
  }
  const expiresAt = String(context.expires_at || "");
  const explicitExpiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const createdAt = Date.parse(String(context.opportunity_created_at || ""));
  const effectiveExpiry = Number.isFinite(explicitExpiry)
    ? explicitExpiry
    : createdAt + 30 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(effectiveExpiry) || effectiveExpiry <= Date.now()) {
    return "The opportunity has expired.";
  }
  if (!["offered", "viewed"].includes(String(context.match_status))) {
    return "The opportunity offer is no longer active.";
  }
  if (!validEmail(context.email)) {
    return "The authoritative business email is unavailable.";
  }
  return "";
}

async function finishWithoutSend(deliveryId: string, status: "skipped" | "suppressed" | "waiting_for_channel", reason: string) {
  const now = new Date().toISOString();
  await getD1().prepare(`UPDATE trade_opportunity_notification_deliveries
    SET status = ?, eligibility_reason = ?, last_error = '', next_attempt_at = '', updated_at = ?
    WHERE id = ? AND status IN ('pending', 'failed', 'waiting_for_channel')`)
    .bind(status, text(reason, 240), now, deliveryId).run();
  return { outcome: status };
}

async function dispatchDelivery(row: DeliveryRow, fetchImpl: typeof fetch) {
  const db = getD1();
  const context = await deliveryContext(String(row.id));
  if (!context) {
    return finishWithoutSend(String(row.id), "skipped", "The matched opportunity is unavailable.");
  }
  const reason = ineligibility(context);
  if (reason) return finishWithoutSend(String(row.id), "skipped", reason);

  const email = validEmail(context.email);
  const emailHash = await opportunityNotificationEmailHash(email);
  const previousAttempts = Number(context.attempts || 0);
  const storedEmailHash = text(context.recipient_email_hash, 64);
  if (previousAttempts > 0 && (!storedEmailHash || storedEmailHash !== emailHash)) {
    return finishWithoutSend(
      String(row.id),
      "skipped",
      "The authoritative business email changed after an earlier delivery attempt.",
    );
  }
  const suppression = await db.prepare(
    "SELECT email_hash FROM trade_opportunity_email_suppressions WHERE email_hash = ?",
  ).bind(emailHash).first();
  if (suppression) {
    return finishWithoutSend(
      String(row.id),
      "suppressed",
      "Provider suppression applies to the current business email.",
    );
  }

  const provider = serviceReminderProviderConfiguration();
  if (!provider.email.configured || !provider.email.callbacks) {
    return finishWithoutSend(
      String(row.id),
      "waiting_for_channel",
      "Resend delivery and authenticated callbacks must both be configured.",
    );
  }

  const storedIdempotencyKey = text(context.idempotency_key, 64);
  const storedSubject = text(context.subject, 160);
  const storedBody = String(context.body || "").trim().slice(0, 1800);
  if (previousAttempts > 0 && (!storedIdempotencyKey || !storedSubject || !storedBody)) {
    return finishWithoutSend(
      String(row.id),
      "skipped",
      "The original provider payload is unavailable for a safe retry.",
    );
  }
  const idempotencyKey = previousAttempts > 0
    ? storedIdempotencyKey
    : await opportunityNotificationIdempotencyKey(String(context.match_id));
  const draft = previousAttempts > 0
    ? { subject: storedSubject, body: storedBody }
    : opportunityNotificationDraft({
      businessName: String(context.business_name || ""),
      state: String(context.state || ""),
      matchedCategories: list(context.matched_categories),
      timing: String(context.timing || ""),
      expiresAt: String(context.expires_at || ""),
      approvedEvidenceCount: Number(context.approved_evidence_count || 0),
    });
  const attempts = previousAttempts + 1;
  const attemptedAt = new Date().toISOString();
  const claim = await db.prepare(`UPDATE trade_opportunity_notification_deliveries
    SET status = 'sending', attempts = ?, next_attempt_at = '', eligibility_reason = '',
      recipient_email_hash = ?, idempotency_key = ?, subject = ?, body = ?,
      last_attempt_at = ?, updated_at = ?
    WHERE id = ? AND status = ? AND attempts = ?
      AND NOT EXISTS (
        SELECT 1 FROM trade_opportunity_email_suppressions suppression
        WHERE suppression.email_hash = ?
      )
      AND EXISTS (
        SELECT 1
        FROM trade_opportunity_matches current_match
        JOIN trade_opportunities current_opportunity ON current_opportunity.id = current_match.opportunity_id
        JOIN trade_accounts current_account ON current_account.firebase_uid = current_match.firebase_uid
        WHERE current_match.id = trade_opportunity_notification_deliveries.match_id
          AND current_match.status IN ('offered', 'viewed')
          AND current_opportunity.status = 'open'
          AND (
            (current_opportunity.expires_at <> '' AND current_opportunity.expires_at > ?)
            OR (
              current_opportunity.expires_at = ''
              AND datetime(current_opportunity.created_at, '+30 days') > ?
            )
          )
          AND current_account.email = ?
          AND current_account.email_opportunities = 1
          AND current_account.consent_at <> ''
          AND current_account.partner_type = 'installer'
          AND ${verifiedTradeAccountPredicate("current_account")}
      )`)
    .bind(
      attempts,
      emailHash,
      idempotencyKey,
      draft.subject,
      draft.body,
      attemptedAt,
      attemptedAt,
      row.id,
      row.status,
      row.attempts,
      emailHash,
      attemptedAt,
      attemptedAt,
      email,
    ).run();
  if (!claim.meta.changes) return { outcome: "not_claimed" };

  try {
    const result = await sendServiceReminderProviderMessage({
      channel: "email",
      recipient: email,
      subject: draft.subject,
      body: draft.body,
      idempotencyKey,
      callbackUrl: CALLBACK_URL,
      messageType: "trade_opportunity",
    }, { fetchImpl });
    const sentAt = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE trade_opportunity_notification_deliveries
        SET status = 'sent', provider = ?, provider_message_id = ?, provider_status = ?,
          sent_at = ?, failed_at = '', last_error = '', updated_at = ?
        WHERE id = ? AND status = 'sending'`)
        .bind(result.provider, result.providerMessageId, result.providerStatus, sentAt, sentAt, row.id),
      db.prepare(`INSERT OR IGNORE INTO trade_opportunity_notification_delivery_events
        (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
        VALUES (?, ?, ?, 'provider_accepted', ?, 'Provider accepted opportunity notification.', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          row.id,
          `accepted:${String(row.id)}:${attempts}`,
          result.providerStatus,
          sentAt,
          sentAt,
        ),
    ]);
    return { outcome: "sent" };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message = error instanceof Error ? text(error.message, 180) : "Provider delivery failed.";
    await db.prepare(`UPDATE trade_opportunity_notification_deliveries
      SET status = 'failed', failed_at = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'sending'`)
      .bind(failedAt, message, serviceReminderRetryAt(attempts), failedAt, row.id).run();
    return { outcome: "failed" };
  }
}

export async function drainOpportunityNotificationDeliveries({
  limit = 20,
  fetchImpl = fetch,
}: DrainOptions = {}) {
  const db = getD1();
  const now = new Date().toISOString();
  const staleClaimCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await db.prepare(`UPDATE trade_opportunity_notification_deliveries
    SET status = 'failed', last_error = 'Recovered an interrupted provider attempt.',
      next_attempt_at = ?, updated_at = ?
    WHERE status = 'sending' AND last_attempt_at <> '' AND last_attempt_at <= ?`)
    .bind(now, now, staleClaimCutoff).run();
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
  const rows = await db.prepare(`SELECT id, status, attempts
    FROM trade_opportunity_notification_deliveries
    WHERE status IN ('pending', 'failed', 'waiting_for_channel')
      AND attempts < ?
      AND (next_attempt_at = '' OR next_attempt_at <= ?)
    ORDER BY enqueued_at, id
    LIMIT ?`)
    .bind(MAX_ATTEMPTS, now, boundedLimit).all<DeliveryRow>();
  const outcomes = await Promise.all(rows.results.map((row) => dispatchDelivery(row, fetchImpl)));
  return {
    attempted: rows.results.length,
    sent: outcomes.filter((item) => item.outcome === "sent").length,
    failed: outcomes.filter((item) => item.outcome === "failed").length,
    skipped: outcomes.filter((item) => item.outcome === "skipped").length,
    suppressed: outcomes.filter((item) => item.outcome === "suppressed").length,
  };
}
