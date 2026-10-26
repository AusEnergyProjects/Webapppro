const providerStatuses = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.failed': 'failed',
  'email.suppressed': 'suppressed',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delivery_delayed',
} as const;

export type RentalReportProviderEventType = keyof typeof providerStatuses;
export type RentalReportProviderStatus = typeof providerStatuses[RentalReportProviderEventType];
export function isRentalReportProviderEventType(value: string): value is RentalReportProviderEventType {
  return Object.hasOwn(providerStatuses, value);
}
export type RentalReportProviderReceipt = {
  providerStatus: RentalReportProviderStatus;
  providerMessageId: string;
  occurredAt: string;
};
export type RentalReportProviderEventInput = {
  providerMessageId: string;
  eventId: string;
  eventType: RentalReportProviderEventType;
  recipientEmails: string[];
  occurredAt: string;
  source?: 'webhook' | 'provider_api';
};

type Binding = {
  accepted_id: string;
  inspection_id: string;
  report_id: string;
  firebase_uid: string;
  recipient_sha256: string;
  recipient_email: string;
  request_key: string;
  pdf_sha256: string;
};

const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(value),
)), byte => byte.toString(16).padStart(2, '0')).join('');

const bindingFrom = `FROM trade_rental_inspection_events accepted
  JOIN trade_email_submissions submission
    ON submission.owner_uid = accepted.firebase_uid
      AND accepted.request_id = 'report-email:' || submission.request_key || ':accepted'
      AND submission.provider = 'resend' AND submission.status = 'accepted'
      AND submission.provider_message_id = json_extract(accepted.metadata, '$.providerMessageId')
  JOIN trade_rental_reports report
    ON report.id = accepted.report_id AND report.inspection_id = accepted.inspection_id
      AND report.firebase_uid = accepted.firebase_uid
  JOIN trade_rental_inspections inspection
    ON inspection.id = report.inspection_id AND inspection.firebase_uid = report.firebase_uid`;

async function readProviderBindings(db: D1Database, providerMessageId: string) {
  return (await db.prepare(`SELECT accepted.id accepted_id, accepted.inspection_id, accepted.report_id,
      accepted.firebase_uid, json_extract(accepted.metadata, '$.recipientSha256') recipient_sha256,
      submission.recipient_email, submission.request_key, report.pdf_sha256
    ${bindingFrom}
    WHERE accepted.event_type = 'report_email_accepted' AND json_extract(accepted.metadata, '$.provider') = 'resend'
      AND submission.provider_message_id = ? LIMIT 2`).bind(providerMessageId).all<Binding>()).results;
}

async function validReportBinding(binding: Omit<Binding, 'accepted_id'>) {
  const recipient = binding.recipient_email.trim().toLowerCase();
  return await sha256(recipient) === binding.recipient_sha256
    && await sha256(`rental-report-email|${binding.firebase_uid}|${binding.report_id}|${binding.pdf_sha256}|${binding.recipient_sha256}`) === binding.request_key;
}

/** Restore a lost journal acknowledgement only from a durably accepted, exactly bound submission. */
export async function recoverRentalReportAcceptedEvent(db: D1Database, providerMessageId: string): Promise<boolean> {
  if (!providerMessageId) return false;
  const existing = await readProviderBindings(db, providerMessageId);
  if (existing.length) return existing.length === 1 && await validReportBinding(existing[0]);
  const submissions = await db.prepare(`SELECT id, owner_uid, request_key, recipient_email, updated_at
    FROM trade_email_submissions WHERE provider = 'resend' AND status = 'accepted' AND provider_message_id = ? LIMIT 2`)
    .bind(providerMessageId).all<{ id: string; owner_uid: string; request_key: string; recipient_email: string; updated_at: string }>();
  if (submissions.results.length !== 1) return false;
  const submission = submissions.results[0];
  if (!/^[a-f0-9]{64}$/.test(submission.request_key) || !Number.isFinite(Date.parse(submission.updated_at))) return false;
  const prefix = `report-email:${submission.request_key}:`;
  const requested = await db.prepare(`SELECT MIN(requested.id) requested_id, requested.inspection_id, requested.report_id,
      requested.firebase_uid, json_extract(requested.metadata, '$.recipientSha256') recipient_sha256, report.pdf_sha256
    FROM trade_rental_inspection_events requested
    JOIN trade_rental_reports report ON report.id = requested.report_id
      AND report.inspection_id = requested.inspection_id AND report.firebase_uid = requested.firebase_uid
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id AND inspection.firebase_uid = report.firebase_uid
    WHERE requested.firebase_uid = ? AND requested.event_type = 'report_email_requested'
      AND requested.request_id >= ? AND requested.request_id < ?
      AND substr(requested.request_id, ?) NOT GLOB '*[^0-9]*' AND CAST(substr(requested.request_id, ?) AS INTEGER) > 0
    GROUP BY requested.inspection_id, requested.report_id, requested.firebase_uid,
      json_extract(requested.metadata, '$.recipientSha256'), report.pdf_sha256 LIMIT 2`)
    .bind(submission.owner_uid, prefix, `report-email:${submission.request_key};`, prefix.length + 1, prefix.length + 1)
    .all<Omit<Binding, 'accepted_id' | 'recipient_email' | 'request_key'> & { requested_id: string }>();
  if (requested.results.length !== 1) return false;
  const binding = { ...requested.results[0], recipient_email: submission.recipient_email, request_key: submission.request_key };
  if (!(await validReportBinding(binding))) return false;
  const metadata = JSON.stringify({ reportId: binding.report_id, recipientSha256: binding.recipient_sha256,
    provider: 'resend', providerMessageId, recoveredFromSubmission: true });
  await db.prepare(`INSERT OR IGNORE INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, created_at)
    SELECT ?, requested.inspection_id, requested.report_id, requested.firebase_uid, 'system', '', 'report_email_accepted', ?,
      'Report email acceptance recovered from the saved provider submission.', ?, ?
    FROM trade_rental_inspection_events requested
    JOIN trade_email_submissions submission ON submission.owner_uid = requested.firebase_uid
    JOIN trade_rental_reports report ON report.id = requested.report_id AND report.inspection_id = requested.inspection_id
      AND report.firebase_uid = requested.firebase_uid
    WHERE requested.id = ? AND requested.event_type = 'report_email_requested'
      AND submission.id = ? AND submission.status = 'accepted' AND submission.provider = 'resend'
      AND submission.provider_message_id = ? AND submission.request_key = ?
      AND submission.recipient_email = ? AND report.pdf_sha256 = ?
      AND json_extract(requested.metadata, '$.recipientSha256') = ?`)
    .bind(crypto.randomUUID(), `${prefix}accepted`, metadata, new Date(submission.updated_at).toISOString(),
      binding.requested_id, submission.id, providerMessageId, submission.request_key, submission.recipient_email,
      binding.pdf_sha256, binding.recipient_sha256).run();
  const recovered = await readProviderBindings(db, providerMessageId);
  return recovered.length === 1 && await validReportBinding(recovered[0]);
}

/** Call only after authenticating the webhook or the provider API response. */
export async function recordRentalReportProviderEvent(db: D1Database, input: RentalReportProviderEventInput): Promise<
  { matched: false } | ({ matched: true; replay: boolean } & RentalReportProviderReceipt)
> {
  if (!isRentalReportProviderEventType(input.eventType) || !input.providerMessageId || !input.eventId
    || !Number.isFinite(Date.parse(input.occurredAt))) throw new Error('RENTAL_REPORT_PROVIDER_EVENT_INVALID');
  const providerStatus = providerStatuses[input.eventType];
  const occurredAt = new Date(input.occurredAt).toISOString();
  await recoverRentalReportAcceptedEvent(db, input.providerMessageId);
  const bindings = await readProviderBindings(db, input.providerMessageId);
  if (bindings.length !== 1) return { matched: false };
  const binding = bindings[0];
  const recipient = binding.recipient_email.trim().toLowerCase();
  if (input.recipientEmails.length !== 1 || input.recipientEmails[0].trim().toLowerCase() !== recipient
    || !(await validReportBinding(binding))) {
    return { matched: false };
  }
  const requestId = `report-email-provider:${await sha256(`resend|${input.providerMessageId}|${input.eventId}`)}`;
  const metadata = JSON.stringify({ provider: 'resend', providerMessageId: input.providerMessageId,
    providerStatus, recipientSha256: binding.recipient_sha256, occurredAt, eventType: input.eventType,
    source: input.source || 'webhook' });
  // Append evidence only. Accepted submission status is the duplicate-send guard.
  const result = await db.prepare(`INSERT OR IGNORE INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, created_at)
    SELECT ?, accepted.inspection_id, accepted.report_id, accepted.firebase_uid, 'system', '',
      'report_email_provider_event', ?, 'Authenticated report email provider receipt recorded.', ?, ?
    ${bindingFrom}
    WHERE accepted.id = ? AND submission.provider_message_id = ?`)
    .bind(crypto.randomUUID(), requestId, metadata, new Date().toISOString(), binding.accepted_id, input.providerMessageId).run();
  if (!result.meta.changes) {
    const replay = await db.prepare(`SELECT id FROM trade_rental_inspection_events
      WHERE firebase_uid = ? AND inspection_id = ? AND report_id = ? AND request_id = ?
        AND event_type = 'report_email_provider_event'
        AND json_extract(metadata, '$.providerMessageId') = ?`)
      .bind(binding.firebase_uid, binding.inspection_id, binding.report_id, requestId, input.providerMessageId).first();
    if (!replay) return { matched: false };
  }
  return { matched: true, replay: !result.meta.changes, providerStatus, providerMessageId: input.providerMessageId, occurredAt };
}

export async function readRentalReportProviderReceipt(db: D1Database, input: {
  ownerUid: string; inspectionId: string; reportId: string; recipientSha256: string;
}): Promise<RentalReportProviderReceipt | null> {
  if (!/^[a-f0-9]{64}$/.test(input.recipientSha256)) return null;
  const receipt = await db.prepare(`WITH latest_accepted AS (
      SELECT accepted.* FROM trade_rental_inspection_events accepted
      WHERE accepted.firebase_uid = ? AND accepted.inspection_id = ? AND accepted.report_id = ?
        AND accepted.event_type = 'report_email_accepted'
        AND json_extract(accepted.metadata, '$.recipientSha256') = ?
      ORDER BY accepted.created_at DESC, accepted.rowid DESC LIMIT 1
    )
    SELECT json_extract(receipt.metadata, '$.providerStatus') providerStatus,
      submission.provider_message_id providerMessageId, json_extract(receipt.metadata, '$.occurredAt') occurredAt
    FROM latest_accepted accepted
    JOIN trade_email_submissions submission
      ON submission.owner_uid = accepted.firebase_uid
        AND accepted.request_id = 'report-email:' || submission.request_key || ':accepted'
        AND submission.provider = 'resend' AND submission.status = 'accepted'
        AND submission.provider_message_id = json_extract(accepted.metadata, '$.providerMessageId')
    JOIN trade_rental_reports report
      ON report.id = accepted.report_id AND report.inspection_id = accepted.inspection_id
        AND report.firebase_uid = accepted.firebase_uid
    JOIN trade_rental_inspections inspection
      ON inspection.id = report.inspection_id AND inspection.firebase_uid = report.firebase_uid
    JOIN trade_rental_inspection_events receipt
      ON receipt.firebase_uid = accepted.firebase_uid AND receipt.inspection_id = accepted.inspection_id
        AND receipt.report_id = accepted.report_id AND receipt.event_type = 'report_email_provider_event'
    WHERE json_extract(accepted.metadata, '$.provider') = 'resend'
      AND json_extract(receipt.metadata, '$.provider') = 'resend'
      AND json_extract(receipt.metadata, '$.providerMessageId') = submission.provider_message_id
      AND json_extract(receipt.metadata, '$.recipientSha256') = json_extract(accepted.metadata, '$.recipientSha256')
      AND json_extract(receipt.metadata, '$.providerStatus') IN ('sent','delivered','bounced','failed','suppressed','complained','delivery_delayed')
      AND datetime(json_extract(receipt.metadata, '$.occurredAt')) IS NOT NULL
    ORDER BY CASE json_extract(receipt.metadata, '$.providerStatus')
      WHEN 'bounced' THEN 0 WHEN 'failed' THEN 0 WHEN 'suppressed' THEN 0 WHEN 'complained' THEN 0
      WHEN 'delivered' THEN 1 WHEN 'delivery_delayed' THEN 2 ELSE 3 END,
      json_extract(receipt.metadata, '$.occurredAt') DESC, receipt.request_id DESC
    LIMIT 1`).bind(input.ownerUid, input.inspectionId, input.reportId, input.recipientSha256).first<RentalReportProviderReceipt>();
  return receipt || null;
}
