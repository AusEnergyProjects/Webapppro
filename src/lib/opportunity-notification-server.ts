import { getD1 } from "../../db";
import {
  opportunityNotificationDraft,
  opportunityNotificationEmailHash,
  opportunityNotificationEmailPreferenceAllows,
  opportunityNotificationIdempotencyKey,
  type OpportunityNotificationSourceKind,
} from "@/lib/opportunity-notifications";
import {
  CUSTOMER_MATCHING_NOTICE_VERSION,
  matchingLocalityDisclosure,
} from "@/lib/customer-matching-locality.mjs";
import {
  publicPlanContactReleaseAccessSql,
  publicPlanContactReleaseDisclosedFieldsAreValid,
} from "@/lib/public-plan-enquiry.mjs";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
} from "@/lib/service-reminder-delivery";
import {
  OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL,
  OPPORTUNITY_NOTIFICATION_ENSURE_DELIVERIES_SQL,
  OPPORTUNITY_NOTIFICATION_MANUAL_RETRY_STATUS_SQL,
  OPPORTUNITY_NOTIFICATION_RETRYABLE_STATUS_SQL,
  opportunityNotificationFailureAudit,
  opportunityNotificationRetryAt,
} from "@/lib/opportunity-notification-retry";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";

type DeliveryRow = Record<string, unknown>;

type DrainOptions = {
  limit?: number;
  opportunityId?: string;
  fetchImpl?: typeof fetch;
};

type ExactOpportunityDrainOptions = {
  opportunityId: string;
  fetchImpl?: typeof fetch;
};

export const OPPORTUNITY_NOTIFICATION_DISPATCH_HEADER =
  "X-AEA-Opportunity-Notification-Dispatch";

const CALLBACK_URL =
  "https://compare.ausenergyassessments.com/api/service-reminder-provider-events/resend";
const RECOVERABLE_PUBLIC_EMAIL_SKIP_REASONS = [
  "Opportunity email consent is not active.",
  "Optional opportunity emails are disabled.",
  "The public enquiry contact consent is unavailable or no longer current.",
] as const;

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
      opportunity.suburb opportunity_suburb, opportunity.postcode opportunity_postcode,
      opportunity.state, opportunity.timing, opportunity.expires_at,
      opportunity.created_at opportunity_created_at, opportunity.status opportunity_status,
      CASE
        WHEN public_contact.id IS NOT NULL THEN 'public_plan_enquiry'
        WHEN project.id IS NOT NULL THEN 'customer_project'
        ELSE 'legacy_marketplace'
      END notification_source,
      public_contact.status public_contact_status,
      public_contact.notice_version public_contact_notice_version,
      public_contact.consent_purpose public_contact_consent_purpose,
      public_contact.disclosed_fields public_contact_disclosed_fields,
      trim(public_contact.customer_first_name || ' ' || public_contact.customer_last_name) public_customer_name,
      CASE WHEN public_contact.customer_first_name <> '' THEN 1 ELSE 0 END public_contact_has_first_name,
      CASE WHEN public_contact.customer_last_name <> '' THEN 1 ELSE 0 END public_contact_has_last_name,
      CASE WHEN public_contact.customer_street_address <> ''
        AND public_contact.customer_suburb <> ''
        AND public_contact.customer_address_state <> ''
        THEN 1 ELSE 0 END public_contact_has_address,
      public_contact.postcode public_contact_postcode,
      public_contact.customer_message public_customer_message,
      CASE WHEN public_contact.customer_email <> '' THEN 1 ELSE 0 END public_contact_has_email,
      CASE WHEN public_contact.customer_phone <> '' THEN 1 ELSE 0 END public_contact_has_phone,
      public_contact.granted_at public_contact_granted_at,
      public_contact.withdrawn_at public_contact_withdrawn_at,
      matching_locality_consent.purpose matching_consent_purpose,
      matching_locality_consent.notice_version matching_notice_version,
      matching_locality_consent.granted_at matching_granted_at,
      matching_locality_consent.withdrawn_at matching_withdrawn_at,
      account.email, account.business_name, account.consent_at, account.email_opportunities,
      account.availability_status,
      CASE WHEN ${verifiedTradeAccountPredicate("account")} AND account.partner_type = 'installer'
        THEN 1 ELSE 0 END installer_access_approved,
      COALESCE((
        SELECT COUNT(*)
        FROM customer_project_evidence evidence
        WHERE evidence.project_id = project.id
          AND evidence.customer_uid = project.firebase_uid
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
      ), 0) customer_shared_evidence_count
    FROM trade_opportunity_notification_deliveries delivery
    JOIN trade_opportunity_matches assignment ON assignment.id = delivery.match_id
    JOIN trade_opportunities opportunity ON opportunity.id = assignment.opportunity_id
    JOIN trade_accounts account ON account.firebase_uid = assignment.firebase_uid
    LEFT JOIN customer_projects project ON project.opportunity_id = opportunity.id
      AND opportunity.source_reference = 'customer-project:' || project.id
    LEFT JOIN public_trade_lead_contact_releases public_contact
      ON public_contact.opportunity_id = opportunity.id
    LEFT JOIN customer_consent_receipts matching_locality_consent
      ON matching_locality_consent.id = (
        SELECT locality_consent.id
        FROM customer_consent_receipts locality_consent
        WHERE locality_consent.project_id = project.id
          AND locality_consent.firebase_uid = project.firebase_uid
          AND locality_consent.purpose = 'anonymized_installer_matching'
          AND locality_consent.notice_version = '${CUSTOMER_MATCHING_NOTICE_VERSION}'
          AND locality_consent.granted_at <> ''
          AND locality_consent.withdrawn_at = ''
        ORDER BY locality_consent.granted_at DESC, locality_consent.id DESC
        LIMIT 1
      )
    WHERE delivery.id = ? LIMIT 1`)
    .bind(deliveryId).first<DeliveryRow>();
}

function ineligibility(context: DeliveryRow) {
  if (Number(context.installer_access_approved || 0) !== 1) {
    return "The installer no longer has active verified access.";
  }
  if (!String(context.consent_at || "")) {
    return "The trade account consent is not active.";
  }
  if (!["open", "limited"].includes(String(context.availability_status || ""))) {
    return "The installer is not currently open to matching.";
  }
  const notificationSource = String(
    context.notification_source || "legacy_marketplace",
  ) as OpportunityNotificationSourceKind;
  if (!opportunityNotificationEmailPreferenceAllows(
    notificationSource,
    context.email_opportunities,
  )) {
    return "Optional opportunity emails are disabled.";
  }
  if (context.notification_source === "public_plan_enquiry") {
    const disclosedFields = list(context.public_contact_disclosed_fields);
    const hasEmail = Number(context.public_contact_has_email || 0) === 1;
    const hasPhone = Number(context.public_contact_has_phone || 0) === 1;
    const hasMessage = Boolean(text(context.public_customer_message, 500));
    const hasAddress = Number(context.public_contact_has_address || 0) === 1;
    const sharesName = disclosedFields.includes("customer_name");
    const sharesPhone = disclosedFields.includes("customer_phone");
    const sharesMessage = disclosedFields.includes("customer_message");
    const sharesAddress = disclosedFields.includes("customer_address");
    if (
      context.public_contact_status !== "active"
      || !publicPlanContactReleaseDisclosedFieldsAreValid(
        context.public_contact_notice_version,
        context.public_contact_consent_purpose,
        disclosedFields,
      )
      || !Number.isFinite(Date.parse(String(context.public_contact_granted_at || "")))
      || Boolean(String(context.public_contact_withdrawn_at || ""))
      || !/^\d{4}$/.test(text(context.public_contact_postcode, 4))
      || text(context.public_contact_postcode, 4) !== text(context.opportunity_postcode, 4)
      || !hasEmail
      || (sharesName && (
        Number(context.public_contact_has_first_name || 0) !== 1
        || Number(context.public_contact_has_last_name || 0) !== 1
        || !text(context.public_customer_name, 120)
      ))
      || (sharesPhone && !hasPhone)
      || (sharesMessage && !hasMessage)
      || (sharesAddress && !hasAddress)
    ) return "The public enquiry contact consent is unavailable or no longer current.";
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
  if (!["offered", "viewed", "interested", "connected"].includes(String(context.match_status))) {
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

async function recoverLegacyPublicOptionalEmailSkips(now: string) {
  return getD1().prepare(`UPDATE trade_opportunity_notification_deliveries
    SET status = 'pending', eligibility_reason = '', next_attempt_at = '', updated_at = ?
    WHERE status = 'skipped'
      AND attempts = 0
      AND eligibility_reason IN (?, ?, ?)
      AND EXISTS (
        SELECT 1
        FROM trade_opportunity_matches recovery_match
        JOIN trade_opportunities recovery_opportunity
          ON recovery_opportunity.id = recovery_match.opportunity_id
        JOIN trade_accounts recovery_account
          ON recovery_account.firebase_uid = recovery_match.firebase_uid
        JOIN public_trade_lead_contact_releases recovery_public_contact
          ON recovery_public_contact.opportunity_id = recovery_opportunity.id
        WHERE recovery_match.id = trade_opportunity_notification_deliveries.match_id
          AND recovery_match.status IN ('offered', 'viewed', 'interested', 'connected')
          AND recovery_opportunity.status = 'open'
          AND (
            (recovery_opportunity.expires_at <> '' AND recovery_opportunity.expires_at > ?)
            OR (
              recovery_opportunity.expires_at = ''
              AND datetime(recovery_opportunity.created_at, '+30 days') > ?
            )
          )
          AND recovery_account.partner_type = 'installer'
          AND recovery_account.consent_at <> ''
          AND recovery_account.availability_status IN ('open', 'limited')
          AND recovery_account.email <> ''
          AND ${verifiedTradeAccountPredicate("recovery_account")}
          AND recovery_public_contact.status = 'active'
          AND ${publicPlanContactReleaseAccessSql("recovery_public_contact")}
          AND datetime(recovery_public_contact.granted_at) IS NOT NULL
          AND recovery_public_contact.withdrawn_at = ''
          AND recovery_public_contact.postcode = recovery_opportunity.postcode
      )`)
    .bind(
      now,
      RECOVERABLE_PUBLIC_EMAIL_SKIP_REASONS[0],
      RECOVERABLE_PUBLIC_EMAIL_SKIP_REASONS[1],
      RECOVERABLE_PUBLIC_EMAIL_SKIP_REASONS[2],
      now,
      now,
    ).run();
}

export async function ensureOpportunityNotificationDeliveries(
  opportunityId: string,
) {
  const exactOpportunityId = text(opportunityId, 180);
  if (!exactOpportunityId) throw new Error("OPPORTUNITY_NOTIFICATION_ENQUEUE_INCOMPLETE");
  const db = getD1();
  const now = new Date().toISOString();
  await db.prepare(OPPORTUNITY_NOTIFICATION_ENSURE_DELIVERIES_SQL)
    .bind(now, exactOpportunityId)
    .run();
  const coverage = await db.prepare(`SELECT COUNT(*) active_match_count,
      COUNT(delivery.id) delivery_count
    FROM trade_opportunity_matches assignment
    LEFT JOIN trade_opportunity_notification_deliveries delivery
      ON delivery.match_id = assignment.id
    WHERE assignment.opportunity_id = ?
      AND assignment.status IN ('offered', 'viewed', 'interested', 'connected')`)
    .bind(exactOpportunityId)
    .first<{ active_match_count: number; delivery_count: number }>();
  const activeMatchCount = Number(coverage?.active_match_count || 0);
  const deliveryCount = Number(coverage?.delivery_count || 0);
  if (activeMatchCount !== deliveryCount) {
    throw new Error("OPPORTUNITY_NOTIFICATION_ENQUEUE_INCOMPLETE");
  }
  return { activeMatchCount, deliveryCount };
}

export async function prepareOpportunityNotificationDeliveriesForManualRetry(
  opportunityId: string,
) {
  const exactOpportunityId = text(opportunityId, 180);
  if (!exactOpportunityId) throw new Error("OPPORTUNITY_NOTIFICATION_ENQUEUE_INCOMPLETE");
  const db = getD1();
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO trade_opportunity_notification_delivery_events
      (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
      SELECT lower(hex(randomblob(16))), delivery.id, 'manual-retry:' || delivery.id || ':' || ?,
        'manual_retry_requested', 'retry_scheduled',
        'An owner or administrator requested an immediate retry.', ?, ?
      FROM trade_opportunity_notification_deliveries delivery
      JOIN trade_opportunity_matches assignment ON assignment.id = delivery.match_id
      WHERE assignment.opportunity_id = ?
        AND delivery.status IN (${OPPORTUNITY_NOTIFICATION_MANUAL_RETRY_STATUS_SQL})`)
      .bind(now, now, now, exactOpportunityId),
    db.prepare(`UPDATE trade_opportunity_notification_deliveries
      SET status = 'pending', eligibility_reason = '', next_attempt_at = '', updated_at = ?
      WHERE status IN (${OPPORTUNITY_NOTIFICATION_MANUAL_RETRY_STATUS_SQL})
        AND EXISTS (
          SELECT 1 FROM trade_opportunity_matches assignment
          WHERE assignment.id = trade_opportunity_notification_deliveries.match_id
            AND assignment.opportunity_id = ?
        )`)
      .bind(now, exactOpportunityId),
  ]);
  return { prepared: Number(results[1]?.meta.changes || 0) };
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
  if (!provider.email.configured) {
    return finishWithoutSend(
      String(row.id),
      "waiting_for_channel",
      "Resend delivery must be configured.",
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
  const publicPlanEnquiry = context.notification_source === "public_plan_enquiry";
  const publicDisclosedFields = new Set(
    publicPlanEnquiry ? list(context.public_contact_disclosed_fields) : [],
  );
  const matchingLocality = publicPlanEnquiry
    ? {
        suburb: "",
        postcode: text(context.public_contact_postcode, 4),
        state: text(context.state, 3),
      }
    : matchingLocalityDisclosure({
        suburb: context.opportunity_suburb,
        postcode: context.opportunity_postcode,
        state: context.state,
      }, {
        purpose: context.matching_consent_purpose,
        noticeVersion: context.matching_notice_version,
        grantedAt: context.matching_granted_at,
        withdrawnAt: context.matching_withdrawn_at,
      });
  const draft = previousAttempts > 0
    ? { subject: storedSubject, body: storedBody }
    : opportunityNotificationDraft({
      businessName: String(context.business_name || ""),
      sourceKind: String(context.notification_source || "legacy_marketplace") as
        "customer_project" | "public_plan_enquiry" | "legacy_marketplace",
      customerName: publicDisclosedFields.has("customer_name")
        ? String(context.public_customer_name || "")
        : "",
      customerMessage: publicDisclosedFields.has("customer_message")
        ? String(context.public_customer_message || "")
        : "",
      suburb: matchingLocality.suburb,
      postcode: matchingLocality.postcode,
      state: matchingLocality.state,
      matchedCategories: list(context.matched_categories),
      timing: String(context.timing || ""),
      expiresAt: String(context.expires_at || ""),
      customerSharedEvidenceCount: Number(context.customer_shared_evidence_count || 0),
    });
  const attempts = previousAttempts + 1;
  const attemptedAt = new Date().toISOString();
  const claim = await db.prepare(`UPDATE trade_opportunity_notification_deliveries
    SET status = 'sending', attempts = ?, next_attempt_at = '', eligibility_reason = '',
      recipient_email_hash = ?, idempotency_key = ?, subject = ?, body = ?,
      last_attempt_at = ?, updated_at = ?
    WHERE ${OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL}
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
          AND current_match.status IN ('offered', 'viewed', 'interested', 'connected')
          AND current_opportunity.status = 'open'
          AND (
            (current_opportunity.expires_at <> '' AND current_opportunity.expires_at > ?)
            OR (
              current_opportunity.expires_at = ''
              AND datetime(current_opportunity.created_at, '+30 days') > ?
            )
          )
          AND current_account.email = ?
          AND (
            current_account.email_opportunities = 1
            OR EXISTS (
              SELECT 1
              FROM public_trade_lead_contact_releases mandatory_public_email
              WHERE mandatory_public_email.opportunity_id = current_opportunity.id
                AND mandatory_public_email.status = 'active'
                AND ${publicPlanContactReleaseAccessSql("mandatory_public_email")}
                AND mandatory_public_email.postcode = current_opportunity.postcode
                AND datetime(mandatory_public_email.granted_at) IS NOT NULL
                AND mandatory_public_email.withdrawn_at = ''
            )
          )
          AND current_account.consent_at <> ''
          AND current_account.availability_status IN ('open', 'limited')
          AND current_account.partner_type = 'installer'
          AND ${verifiedTradeAccountPredicate("current_account")}
          AND (
            NOT EXISTS (
              SELECT 1
              FROM public_trade_lead_contact_releases any_public_contact
              WHERE any_public_contact.opportunity_id = current_opportunity.id
            )
            OR (
              EXISTS (
                SELECT 1
                FROM public_trade_lead_contact_releases current_public_contact
                WHERE current_public_contact.opportunity_id = current_opportunity.id
                  AND current_public_contact.status = 'active'
                  AND ${publicPlanContactReleaseAccessSql("current_public_contact")}
                  AND current_public_contact.postcode = current_opportunity.postcode
                  AND datetime(current_public_contact.granted_at) IS NOT NULL
                  AND current_public_contact.withdrawn_at = ''
              )
            )
          )
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
    const audit = opportunityNotificationFailureAudit(attempts);
    const failure = await db.prepare(`UPDATE trade_opportunity_notification_deliveries
      SET status = 'failed', failed_at = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'sending'`)
      .bind(failedAt, message, opportunityNotificationRetryAt(attempts), failedAt, row.id)
      .run();
    if (failure.meta.changes) {
      await db.prepare(`INSERT OR IGNORE INTO trade_opportunity_notification_delivery_events
        (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          row.id,
          `attempt-failed:${String(row.id)}:${attempts}`,
          audit.eventType,
          audit.providerStatus,
          audit.summary,
          failedAt,
          failedAt,
        )
        .run();
    }
    return { outcome: "failed" };
  }
}

export async function drainOpportunityNotificationDeliveries({
  limit = 20,
  opportunityId = "",
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
  await recoverLegacyPublicOptionalEmailSkips(now);
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
  const retryWaitingForChannel = serviceReminderProviderConfiguration().email.configured ? 1 : 0;
  const opportunityFilter = opportunityId
    ? ` AND EXISTS (
        SELECT 1 FROM trade_opportunity_matches assignment
        WHERE assignment.id = trade_opportunity_notification_deliveries.match_id
          AND assignment.opportunity_id = ?
      )`
    : "";
  const statement = db.prepare(`SELECT id, status, attempts
    FROM trade_opportunity_notification_deliveries
    WHERE status IN (${OPPORTUNITY_NOTIFICATION_RETRYABLE_STATUS_SQL})
      AND (next_attempt_at = '' OR next_attempt_at <= ?)
      AND (status <> 'waiting_for_channel' OR ? = 1)
      ${opportunityFilter}
    ORDER BY enqueued_at, id
    LIMIT ?`);
  const rows = opportunityId
    ? await statement.bind(
      now,
      retryWaitingForChannel,
      opportunityId,
      boundedLimit,
    ).all<DeliveryRow>()
    : await statement.bind(
      now,
      retryWaitingForChannel,
      boundedLimit,
    ).all<DeliveryRow>();
  const outcomes = await Promise.all(rows.results.map((row) => dispatchDelivery(row, fetchImpl)));
  return {
    attempted: rows.results.length,
    sent: outcomes.filter((item) => item.outcome === "sent").length,
    failed: outcomes.filter((item) => item.outcome === "failed").length,
    skipped: outcomes.filter((item) => item.outcome === "skipped").length,
    suppressed: outcomes.filter((item) => item.outcome === "suppressed").length,
    waitingForChannel: outcomes.filter((item) => item.outcome === "waiting_for_channel").length,
  };
}

export async function drainOpportunityNotificationDeliveriesForOpportunity({
  opportunityId,
  fetchImpl = fetch,
}: ExactOpportunityDrainOptions) {
  const exactOpportunityId = text(opportunityId, 180);
  if (!exactOpportunityId) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      suppressed: 0,
      waitingForChannel: 0,
    };
  }
  const totals = {
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    suppressed: 0,
    waitingForChannel: 0,
  };
  const batchSize = 20;
  while (true) {
    const result = await drainOpportunityNotificationDeliveries({
      opportunityId: exactOpportunityId,
      limit: batchSize,
      fetchImpl,
    });
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] += result[key];
    }
    if (result.attempted < batchSize) break;
  }
  return totals;
}
