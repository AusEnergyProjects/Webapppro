import { getD1 } from "../../db";
import {
  customerProjectActivityDraft,
  customerProjectActivityEmailHash,
  customerProjectActivityIdentity,
  type CustomerProjectActivityAudience,
  type CustomerProjectActivityEventType,
} from "@/lib/customer-project-activity-notifications";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
  serviceReminderRetryAt,
} from "@/lib/service-reminder-delivery";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";

export const CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER =
  "X-AEA-Customer-Project-Activity-Dispatch";

type ActivityInput = {
  eventKey: string;
  projectId: string;
  quoteId: string;
  opportunityMatchId: string;
  customerUid: string;
  installerUid: string;
  eventType: CustomerProjectActivityEventType;
  audience: CustomerProjectActivityAudience;
  actorType: "customer" | "installer";
  actorUid: string;
  occurredAt: string;
};

type DeliveryRow = Record<string, unknown>;
type DrainOptions = {
  deliveryId?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
};

const CALLBACK_URL =
  "https://compare.ausenergyassessments.com/api/service-reminder-provider-events/resend";
const MAX_ATTEMPTS = 3;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

function text(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

function validEmail(value: unknown) {
  const email = text(value, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function summary(eventType: CustomerProjectActivityEventType) {
  return eventType === "installer_quote_submitted"
    ? "A verified installer submitted a structured quote for customer review."
    : "The customer accepted the installer quote and released contact details.";
}

export async function customerProjectActivityStatements(
  db: ReturnType<typeof getD1>,
  input: ActivityInput,
) {
  const identity = await customerProjectActivityIdentity(
    input.eventKey,
    input.audience,
  );
  return {
    eventId: identity.eventId,
    deliveryId: identity.deliveryId,
    statements: [
      db.prepare(`INSERT OR IGNORE INTO customer_project_activity_events
        (id, event_key, project_id, quote_id, opportunity_match_id, customer_uid,
         installer_uid, event_type, actor_type, actor_uid, summary, occurred_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          identity.eventId,
          input.eventKey,
          input.projectId,
          input.quoteId,
          input.opportunityMatchId,
          input.customerUid,
          input.installerUid,
          input.eventType,
          input.actorType,
          input.actorUid,
          summary(input.eventType),
          input.occurredAt,
          input.occurredAt,
        ),
      db.prepare(`INSERT OR IGNORE INTO customer_project_activity_deliveries
        (id, event_id, audience, recipient_uid, channel, provider, status,
         eligibility_reason, attempts, next_attempt_at, recipient_email_hash,
         idempotency_key, subject, body, html, provider_message_id, provider_status,
         queued_at, last_attempt_at, sent_at, delivered_at, failed_at, last_error,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, 'email', 'resend', 'pending', '', 0, '', '', ?, '', '',
          '', '', '', ?, '', '', '', '', '', ?, ?)`)
        .bind(
          identity.deliveryId,
          identity.eventId,
          input.audience,
          input.audience === "customer"
            ? input.customerUid
            : input.installerUid,
          identity.idempotencyKey,
          input.occurredAt,
          input.occurredAt,
          input.occurredAt,
        ),
    ],
  };
}

async function deliveryContext(deliveryId: string) {
  return getD1().prepare(`SELECT delivery.*, event.event_type, event.project_id,
      event.quote_id, event.opportunity_match_id, event.customer_uid,
      event.installer_uid, event.occurred_at,
      quote.status quote_status, quote.customer_decision,
      customer.email customer_email, customer.account_status customer_account_status,
      customer.account_updates,
      trade.email installer_email, trade.business_name,
      trade.account_status installer_account_status,
      trade.email_opportunities, trade.consent_at installer_consent_at,
      release.status contact_release_status,
      CASE WHEN trade.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("trade")}
        THEN 1 ELSE 0 END installer_access_approved,
      EXISTS (
        SELECT 1 FROM customer_consent_receipts receipt
        WHERE receipt.firebase_uid = event.customer_uid
          AND receipt.purpose = 'customer_account'
          AND receipt.withdrawn_at = ''
      ) customer_account_consent,
      EXISTS (
        SELECT 1 FROM customer_service_reminder_opt_outs optout
        WHERE optout.customer_uid = event.customer_uid
          AND optout.channel = 'email'
      ) customer_email_opted_out
    FROM customer_project_activity_deliveries delivery
    JOIN customer_project_activity_events event ON event.id = delivery.event_id
    JOIN customer_project_quotes quote ON quote.id = event.quote_id
      AND quote.project_id = event.project_id
      AND quote.opportunity_match_id = event.opportunity_match_id
    JOIN customer_accounts customer ON customer.firebase_uid = event.customer_uid
    JOIN trade_accounts trade ON trade.firebase_uid = event.installer_uid
    LEFT JOIN customer_project_contact_releases release
      ON release.quote_id = event.quote_id
      AND release.opportunity_match_id = event.opportunity_match_id
      AND release.customer_uid = event.customer_uid
      AND release.installer_uid = event.installer_uid
    WHERE delivery.id = ? LIMIT 1`)
    .bind(deliveryId)
    .first<DeliveryRow>();
}

function recipient(context: DeliveryRow) {
  return context.audience === "customer"
    ? validEmail(context.customer_email)
    : validEmail(context.installer_email);
}

function ineligibility(context: DeliveryRow) {
  if (Number(context.installer_access_approved || 0) !== 1) {
    return "The installer no longer has active verified access.";
  }
  if (
    context.event_type === "installer_quote_submitted"
    && context.audience === "customer"
  ) {
    if (
      context.quote_status !== "submitted"
      || !["reviewing", "shortlisted"].includes(
        String(context.customer_decision),
      )
    ) {
      return "The quote is no longer waiting for customer review.";
    }
    if (
      context.customer_account_status !== "active"
      || !Boolean(context.account_updates)
      || !Boolean(context.customer_account_consent)
    ) {
      return "Customer project-update consent is not active.";
    }
    if (Boolean(context.customer_email_opted_out)) {
      return "The customer has opted out of email updates.";
    }
    return validEmail(context.customer_email)
      ? ""
      : "The authoritative customer email is unavailable.";
  }
  if (
    context.event_type === "customer_installer_accepted"
    && context.audience === "installer"
  ) {
    if (
      context.customer_decision !== "accepted"
      || context.contact_release_status !== "active"
    ) {
      return "The accepted installer contact release is no longer active.";
    }
    if (
      context.installer_account_status !== "active"
      || !Boolean(context.email_opportunities)
      || !Boolean(context.installer_consent_at)
    ) {
      return "Installer operational email consent is not active.";
    }
    return validEmail(context.installer_email)
      ? ""
      : "The authoritative business email is unavailable.";
  }
  return "The notification audience does not match this project event.";
}

async function finishWithoutSend(
  deliveryId: string,
  status: "skipped" | "suppressed" | "waiting_for_channel" | "opted_out",
  reason: string,
) {
  const now = new Date().toISOString();
  await getD1().prepare(`UPDATE customer_project_activity_deliveries
    SET status = ?, eligibility_reason = ?, last_error = '', next_attempt_at = '',
      updated_at = ?
    WHERE id = ? AND status IN ('pending', 'failed', 'waiting_for_channel')`)
    .bind(status, text(reason, 240), now, deliveryId).run();
  return { outcome: status };
}

async function dispatchDelivery(row: DeliveryRow, fetchImpl: typeof fetch) {
  const db = getD1();
  const context = await deliveryContext(String(row.id));
  if (!context) {
    return finishWithoutSend(
      String(row.id),
      "skipped",
      "The project activity is unavailable.",
    );
  }
  const reason = ineligibility(context);
  if (reason) {
    return finishWithoutSend(
      String(row.id),
      reason.includes("opted out") ? "opted_out" : "skipped",
      reason,
    );
  }

  const email = recipient(context);
  const emailHash = await customerProjectActivityEmailHash(email);
  const previousAttempts = Number(context.attempts || 0);
  const storedEmailHash = text(context.recipient_email_hash, 64);
  if (
    previousAttempts > 0
    && (!storedEmailHash || storedEmailHash !== emailHash)
  ) {
    return finishWithoutSend(
      String(row.id),
      "skipped",
      "The authoritative recipient email changed after an earlier attempt.",
    );
  }
  if (context.audience === "installer") {
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
  }

  const provider = serviceReminderProviderConfiguration();
  if (!provider.email.configured || !provider.email.callbacks) {
    return finishWithoutSend(
      String(row.id),
      "waiting_for_channel",
      "Resend delivery and authenticated callbacks must both be configured.",
    );
  }

  const storedSubject = text(context.subject, 160);
  const storedBody = String(context.body || "").trim().slice(0, 1800);
  const storedHtml = String(context.html || "").trim().slice(0, 12_000);
  if (
    previousAttempts > 0
    && (!storedSubject || !storedBody || !storedHtml)
  ) {
    return finishWithoutSend(
      String(row.id),
      "skipped",
      "The original provider payload is unavailable for a safe retry.",
    );
  }
  const draft = previousAttempts > 0
    ? { subject: storedSubject, body: storedBody, html: storedHtml }
    : customerProjectActivityDraft({
      eventType: String(context.event_type) as CustomerProjectActivityEventType,
      audience: String(context.audience) as CustomerProjectActivityAudience,
      businessName: String(context.business_name || ""),
      opportunityMatchId: String(context.opportunity_match_id || ""),
    });
  const attempts = previousAttempts + 1;
  const attemptedAt = new Date().toISOString();
  const claim = await db.prepare(`UPDATE customer_project_activity_deliveries
    SET status = 'sending', attempts = ?, next_attempt_at = '',
      eligibility_reason = '', recipient_email_hash = ?, subject = ?, body = ?,
      html = ?, last_attempt_at = ?, updated_at = ?
    WHERE id = ? AND status = ? AND attempts = ?`)
    .bind(
      attempts,
      emailHash,
      draft.subject,
      draft.body,
      draft.html,
      attemptedAt,
      attemptedAt,
      row.id,
      row.status,
      row.attempts,
    ).run();
  if (!claim.meta.changes) return { outcome: "not_claimed" };

  try {
    const result = await sendServiceReminderProviderMessage({
      channel: "email",
      recipient: email,
      subject: draft.subject,
      body: draft.body,
      html: draft.html,
      idempotencyKey: String(context.idempotency_key),
      callbackUrl: CALLBACK_URL,
      messageType: "customer_project_activity",
    }, { fetchImpl });
    const sentAt = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE customer_project_activity_deliveries
        SET status = 'sent', provider = ?, provider_message_id = ?,
          provider_status = ?, sent_at = ?, failed_at = '', last_error = '',
          updated_at = ?
        WHERE id = ? AND status = 'sending'`)
        .bind(
          result.provider,
          result.providerMessageId,
          result.providerStatus,
          sentAt,
          sentAt,
          row.id,
        ),
      db.prepare(`INSERT OR IGNORE INTO customer_project_activity_delivery_events
        (id, delivery_id, provider_event_key, event_type, provider_status,
         summary, occurred_at, created_at)
        VALUES (?, ?, ?, 'provider_accepted', ?,
          'Provider accepted project activity notification.', ?, ?)`)
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
    const message = error instanceof Error
      ? text(error.message, 180)
      : "Provider delivery failed.";
    await db.prepare(`UPDATE customer_project_activity_deliveries
      SET status = 'failed', failed_at = ?, last_error = ?, next_attempt_at = ?,
        updated_at = ?
      WHERE id = ? AND status = 'sending'`)
      .bind(
        failedAt,
        message,
        serviceReminderRetryAt(attempts),
        failedAt,
        row.id,
      ).run();
    return { outcome: "failed" };
  }
}

async function recoverInterruptedDeliveries(deliveryId: string) {
  const db = getD1();
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  const filter = deliveryId ? " AND id = ?" : "";
  const statement = db.prepare(`UPDATE customer_project_activity_deliveries
    SET status = 'failed',
      last_error = 'Recovered an interrupted provider attempt.',
      next_attempt_at = ?, updated_at = ?
    WHERE status = 'sending' AND last_attempt_at <> ''
      AND last_attempt_at <= ?${filter}`);
  if (deliveryId) await statement.bind(now, now, cutoff, deliveryId).run();
  else await statement.bind(now, now, cutoff).run();
}

export async function drainCustomerProjectActivityDeliveries({
  deliveryId = "",
  limit = 20,
  fetchImpl = fetch,
}: DrainOptions = {}) {
  await recoverInterruptedDeliveries(deliveryId);
  const db = getD1();
  const now = new Date().toISOString();
  const boundedLimit = Math.max(
    1,
    Math.min(50, Math.floor(Number(limit) || 20)),
  );
  const filter = deliveryId ? " AND id = ?" : "";
  const statement = db.prepare(`SELECT id, status, attempts
    FROM customer_project_activity_deliveries
    WHERE status IN ('pending', 'failed', 'waiting_for_channel')
      AND attempts < ?
      AND (next_attempt_at = '' OR next_attempt_at <= ?)${filter}
    ORDER BY queued_at, id
    LIMIT ?`);
  const rows = deliveryId
    ? await statement.bind(
      MAX_ATTEMPTS,
      now,
      deliveryId,
      boundedLimit,
    ).all<DeliveryRow>()
    : await statement.bind(MAX_ATTEMPTS, now, boundedLimit).all<DeliveryRow>();
  const outcomes = await Promise.all(
    rows.results.map((row) => dispatchDelivery(row, fetchImpl)),
  );
  return {
    attempted: rows.results.length,
    sent: outcomes.filter((item) => item.outcome === "sent").length,
    failed: outcomes.filter((item) => item.outcome === "failed").length,
    skipped: outcomes.filter((item) => item.outcome === "skipped").length,
    suppressed: outcomes.filter(
      (item) => item.outcome === "suppressed",
    ).length,
  };
}
