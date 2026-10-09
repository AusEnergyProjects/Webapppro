import { getD1 } from '../../db';
import { assignedJob, type TeamAccess } from '@/lib/trade-team-server';
import { authenticatedRentalReportPdf, ownerRentalReportPresentation } from '@/lib/trade-rental-report-server';
import { reminderProviderFailureOutcome } from '@/lib/service-reminder-delivery';
import { sendTradeCustomerEmail, tradeCustomerEmailReadiness } from '@/lib/trade-email-server';
import { rentalReportEmailDraft } from './rental-report-email-template.mjs';

type Row = Record<string, unknown>;
type Input = { access: TeamAccess; workOrderId: string; inspectionId: string; reportId: string; expectedRecipientEmail: string; origin: string };
type ReviewInput = { access: TeamAccess; workOrderId: string; inspectionId: string; hold: boolean; expectedInspectionRevision: number };
type ReviewState = { status: 'held' | 'released'; message: string; at: string };
const REVIEW_HELD_MESSAGE = 'The business owner is reviewing this report. The completed report is saved; email will wait for their approval.';
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,'0')).join('');
const object = (value: unknown): Row => { try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };

export async function rentalReportDeliveryReview(ownerUid: string, inspectionId: string): Promise<ReviewState | null> {
  const row = await getD1().prepare(`SELECT event.event_type, event.created_at FROM trade_rental_inspection_events event
    JOIN trade_rental_inspections inspection ON inspection.id = event.inspection_id AND inspection.firebase_uid = event.firebase_uid
    WHERE event.firebase_uid = ? AND event.inspection_id = ?
      AND event.event_type IN ('report_email_review_held', 'report_email_review_released')
    ORDER BY event.rowid DESC LIMIT 1`).bind(ownerUid, inspectionId).first<Row>();
  if (!row) return null;
  const status = row.event_type === 'report_email_review_held' ? 'held' : 'released';
  return { status, message: status === 'held' ? REVIEW_HELD_MESSAGE : 'The business owner approved this report for email delivery.', at: String(row.created_at) };
}

export async function setRentalReportDeliveryReview(input: ReviewInput) {
  if (!input.access.isOwner || input.access.actorUid !== input.access.ownerUid || !input.access.canRunReports) throw new Error('REPORT_DELIVERY_OWNER_REQUIRED');
  if (!Number.isSafeInteger(input.expectedInspectionRevision) || input.expectedInspectionRevision < 1) throw new Error('REPORT_DELIVERY_REVIEW_CHANGED');
  await assignedJob(input.access, input.workOrderId);
  const db = getD1();
  const inspection = await db.prepare(`SELECT id, revision FROM trade_rental_inspections WHERE id = ? AND firebase_uid = ? AND work_order_id = ?`)
    .bind(input.inspectionId, input.access.ownerUid, input.workOrderId).first<Row>();
  if (!inspection) throw new Error('RENTAL_INSPECTION_NOT_FOUND');
  if (Number(inspection.revision) !== input.expectedInspectionRevision) throw new Error('REPORT_DELIVERY_REVIEW_CHANGED');
  const eventType = input.hold ? 'report_email_review_held' : 'report_email_review_released';
  const id = crypto.randomUUID();
  // Claiming delivery and holding it each use one conditional journal insert.
  // Whichever wins first prevents the other from claiming a contradictory state.
  const write = await db.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, created_at)
    SELECT ?, inspection.id, inspection.issued_report_id, inspection.firebase_uid, 'owner', ?, ?, ?, ?, '{}', ?
    FROM trade_rental_inspections inspection WHERE inspection.id = ? AND inspection.firebase_uid = ? AND inspection.work_order_id = ?
      AND inspection.revision = ?
      AND COALESCE((SELECT review.event_type FROM trade_rental_inspection_events review
        WHERE review.inspection_id = inspection.id AND review.firebase_uid = inspection.firebase_uid
          AND review.event_type IN ('report_email_review_held', 'report_email_review_released') ORDER BY review.rowid DESC LIMIT 1), '') <> ?
      AND (? = 1 OR NOT EXISTS (SELECT 1 FROM trade_rental_reports pending
        WHERE pending.inspection_id = inspection.id AND pending.firebase_uid = inspection.firebase_uid AND pending.status = 'staged'))
      AND (? = 0 OR NOT EXISTS (SELECT 1 FROM trade_rental_inspection_events delivery
        WHERE delivery.inspection_id = inspection.id AND delivery.firebase_uid = inspection.firebase_uid
          AND (delivery.event_type = 'report_email_accepted'
            OR (delivery.event_type = 'report_email_failed' AND json_extract(delivery.metadata, '$.outcome') = 'indeterminate')
            OR (delivery.event_type = 'report_email_requested' AND NOT EXISTS (
              SELECT 1 FROM trade_rental_inspection_events failure WHERE failure.inspection_id = delivery.inspection_id
                AND failure.firebase_uid = delivery.firebase_uid AND failure.report_id = delivery.report_id
                AND failure.event_type = 'report_email_failed' AND failure.request_id = delivery.request_id || ':failed')))))`)
    .bind(id, input.access.actorUid, eventType, `report-email-review:${id}`,
      input.hold ? 'The business owner held report email delivery for review.' : 'The business owner approved report email delivery.', new Date().toISOString(),
      input.inspectionId, input.access.ownerUid, input.workOrderId, input.expectedInspectionRevision, eventType, Number(input.hold), Number(input.hold)).run();
  if (!write.meta.changes) {
    const current = await db.prepare(`SELECT revision FROM trade_rental_inspections WHERE id = ? AND firebase_uid = ? AND work_order_id = ?`)
      .bind(input.inspectionId, input.access.ownerUid, input.workOrderId).first<Row>();
    // A stale approval must not inherit a newer report's prior review state.
    if (!current || Number(current.revision) !== input.expectedInspectionRevision) throw new Error('REPORT_DELIVERY_REVIEW_CHANGED');
  }
  const review = await rentalReportDeliveryReview(input.access.ownerUid, input.inspectionId);
  if (!review || review.status !== (input.hold ? 'held' : 'released')) {
    if (!input.hold && await db.prepare(`SELECT id FROM trade_rental_reports
      WHERE inspection_id = ? AND firebase_uid = ? AND status = 'staged' LIMIT 1`)
      .bind(input.inspectionId, input.access.ownerUid).first<Row>()) throw new Error('RENTAL_REPORT_FORMATTING_IN_PROGRESS');
    throw new Error(input.hold && !write.meta.changes ? 'REPORT_DELIVERY_ALREADY_SENDING' : 'REPORT_DELIVERY_REVIEW_CHANGED');
  }
  return review;
}

export async function rentalReportDeliveryRecipient(ownerUid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT c.email, c.first_name, c.last_name, c.business_name
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND w.source_type <> 'opportunity' AND d.customer_source IN ('trade_owned', 'public_lead_released')`)
    .bind(workOrderId, ownerUid).first<Row>();
  const email = String(row?.email || '').trim().toLowerCase();
  if (!row || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { email, name: String(row.business_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Client') };
}

export async function rentalReportDeliveryState(ownerUid: string, inspectionId: string) {
  const row = await getD1().prepare(`SELECT event.event_type, event.report_id, event.metadata, event.created_at FROM trade_rental_inspection_events event
    JOIN trade_rental_inspections inspection ON inspection.id = event.inspection_id AND inspection.firebase_uid = event.firebase_uid
      AND inspection.issued_report_id = event.report_id AND inspection.status = 'issued'
    WHERE event.firebase_uid = ? AND event.inspection_id = ? AND event.event_type IN ('report_email_requested', 'report_email_accepted', 'report_email_failed')
    ORDER BY event.created_at DESC, CASE event.event_type WHEN 'report_email_accepted' THEN 0 WHEN 'report_email_failed' THEN 1 ELSE 2 END LIMIT 1`)
    .bind(ownerUid, inspectionId).first<Row>();
  if (!row) return null;
  const meta = object(row.metadata);
  const status = row.event_type === 'report_email_accepted' ? 'accepted'
    : meta.outcome === 'indeterminate' ? 'reconciliation_required' : row.event_type === 'report_email_failed' ? 'failed' : 'sending';
  return { status, reportId: String(row.report_id || ''), recipientSha256: /^[a-f0-9]{64}$/.test(String(meta.recipientSha256 || '')) ? String(meta.recipientSha256) : '',
    message: status === 'accepted' ? 'The report email was accepted for delivery.'
    : status === 'reconciliation_required' ? 'Check the outgoing mailbox before sending this report again.'
    : status === 'failed' ? String(meta.error || 'The report could not be emailed. Retry from this assessment.') : 'The report email is being sent.', at: row.created_at };
}

async function event(input: Input, eventType: string, requestId: string, metadata: Row, now = new Date().toISOString()) {
  return getD1().prepare(`INSERT OR IGNORE INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.inspectionId, input.reportId, input.access.ownerUid,
      input.access.isOwner ? 'owner' : 'assessor', input.access.actorUid, eventType, requestId,
      eventType === 'report_email_accepted' ? 'Report email accepted by the delivery provider.' : eventType === 'report_email_failed' ? 'Report email delivery attempt failed.' : 'Report email requested by the assessor.',
      JSON.stringify({ reportId: input.reportId, ...metadata }), now).run();
}

export async function emailRentalAssessmentReport(input: Input) {
  if (!input.access.canRunReports) throw new Error('REPORT_PERMISSION_REQUIRED');
  await assignedJob(input.access, input.workOrderId);
  const db = getD1();
  const report = await db.prepare(`SELECT r.report_number, r.pdf_sha256, i.assessor_member_id
    FROM trade_rental_reports r JOIN trade_rental_inspections i ON i.id = r.inspection_id AND i.firebase_uid = r.firebase_uid
    WHERE r.id = ? AND r.firebase_uid = ? AND r.inspection_id = ? AND r.status = 'issued'
      AND i.work_order_id = ? AND i.status = 'issued' AND i.issued_report_id = r.id`)
    .bind(input.reportId, input.access.ownerUid, input.inspectionId, input.workOrderId).first<Row>();
  if (!report) throw new Error('RENTAL_REPORT_LINK_NOT_FOUND');
  if (!input.access.isOwner && String(report.assessor_member_id || '') !== input.access.memberId) throw new Error('ASSESSOR_REQUIRED');
  if ((await rentalReportDeliveryReview(input.access.ownerUid, input.inspectionId))?.status === 'held') {
    return { status: 'held', reportId: input.reportId, message: REVIEW_HELD_MESSAGE };
  }
  const recipient = await rentalReportDeliveryRecipient(input.access.ownerUid, input.workOrderId);
  if (!recipient || recipient.email !== input.expectedRecipientEmail.trim().toLowerCase()) throw new Error('REPORT_RECIPIENT_CHANGED');
  const recipientHash = await sha256(recipient.email);
  const key = await sha256(`rental-report-email|${input.access.ownerUid}|${input.reportId}|${report.pdf_sha256}|${recipientHash}`);
  const prefix = `report-email:${key}`;
  // D1 caps LIKE patterns at 50 bytes. The journal identity is longer, so use
  // an exact ASCII prefix range without changing existing idempotency keys.
  const events = await db.prepare(`SELECT event_type, request_id, metadata, created_at FROM trade_rental_inspection_events
    WHERE inspection_id = ? AND firebase_uid = ? AND report_id = ?
      AND request_id >= ? AND request_id < ? ORDER BY created_at, request_id`)
    .bind(input.inspectionId, input.access.ownerUid, input.reportId, `${prefix}:`, `${prefix};`).all<Row>();
  if (events.results.some(row => row.event_type === 'report_email_accepted')) return { status: 'accepted', reportId: input.reportId, message: 'The report email was already accepted for delivery.' };
  if (events.results.some(row => object(row.metadata).outcome === 'indeterminate')) return { status: 'reconciliation_required', reportId: input.reportId, message: 'Check the outgoing mailbox before sending this report again. Delivery could not be confirmed.' };
  const requests = events.results.filter(row => row.event_type === 'report_email_requested');
  const last = requests.at(-1);
  if (last && Date.now() - Date.parse(String(requests[0].created_at)) > 23 * 60 * 60 * 1000) {
    return { status: 'reconciliation_required', reportId: input.reportId, message: 'Check the previous email delivery before sending again. It may already have reached the client.' };
  }
  if (last && !events.results.some(row => row.request_id === `${last.request_id}:failed`)
    && Date.now() - Date.parse(String(last.created_at)) < 90_000) return { status: 'sending', reportId: input.reportId, message: 'The report email is being sent.' };
  const email = await tradeCustomerEmailReadiness(input.access.ownerUid, db);
  if (!email.configured) return { status: 'failed', reportId: input.reportId, message: 'Email delivery is not configured. The completed report is saved.' };
  const pdf = await authenticatedRentalReportPdf({ access: input.access, workOrderId: input.workOrderId, reportId: input.reportId });
  // Large evidence reports travel by their existing secure report link rather than exceeding email attachment limits.
  const presentation = await ownerRentalReportPresentation({ ownerUid: input.access.ownerUid, inspectionId: input.inspectionId, origin: input.origin, includeSecret: true });
  const publicReport = presentation.find(row => row.id === input.reportId);
  const link = publicReport?.link;
  if (!link || link.status !== 'active' || !link.shareUrl) return { status: 'failed', reportId: input.reportId, message: 'Renew the report sharing link before emailing this report.' };
  const currentRecipient = await rentalReportDeliveryRecipient(input.access.ownerUid, input.workOrderId);
  if (!currentRecipient || currentRecipient.email !== recipient.email) throw new Error('REPORT_RECIPIENT_CHANGED');
  const attempt = `${prefix}:${requests.length + 1}`;
  const claim = await db.prepare(`INSERT OR IGNORE INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, created_at)
    SELECT ?, inspection.id, inspection.issued_report_id, inspection.firebase_uid, ?, ?, 'report_email_requested', ?, ?, ?, ?
    FROM trade_rental_inspections inspection WHERE inspection.id = ? AND inspection.firebase_uid = ?
      AND inspection.work_order_id = ? AND inspection.status = 'issued' AND inspection.issued_report_id = ?
      AND COALESCE((SELECT review.event_type FROM trade_rental_inspection_events review
        WHERE review.inspection_id = inspection.id AND review.firebase_uid = inspection.firebase_uid
          AND review.event_type IN ('report_email_review_held', 'report_email_review_released') ORDER BY review.rowid DESC LIMIT 1), '') <> 'report_email_review_held'`)
    .bind(crypto.randomUUID(), input.access.isOwner ? 'owner' : 'assessor', input.access.actorUid, attempt,
      'Report email requested by the assessor.', JSON.stringify({ reportId: input.reportId, recipientSha256: recipientHash }), new Date().toISOString(),
      input.inspectionId, input.access.ownerUid, input.workOrderId, input.reportId).run();
  if (!claim.meta.changes) {
    if ((await rentalReportDeliveryReview(input.access.ownerUid, input.inspectionId))?.status === 'held') {
      return { status: 'held', reportId: input.reportId, message: REVIEW_HELD_MESSAGE };
    }
    return { status: 'sending', reportId: input.reportId, message: 'The report email is being sent.' };
  }
  try {
    const attachments = [];
    const attachmentLimit = email.provider === 'resend' ? 18 * 1024 * 1024 : 1.5 * 1024 * 1024;
    if (pdf.bytes.length <= attachmentLimit) {
      let binary = ''; for (const byte of pdf.bytes) binary += String.fromCharCode(byte);
      attachments.push({ filename: `${pdf.reportNumber.replace(/[^a-zA-Z0-9-]/g, '-')}.pdf`, content: btoa(binary), contentType: 'application/pdf' });
    }
    const draft = rentalReportEmailDraft({ recipientName: recipient.name, reportNumber: pdf.reportNumber,
      shareUrl: link.shareUrl, hasAttachment: attachments.length > 0 });
    const result = await sendTradeCustomerEmail(input.access.ownerUid, input.access.actorUid, { channel: 'email', recipient: recipient.email,
      ...draft, attachments, idempotencyKey: key,
      messageType: 'tlink_rental_report', callbackUrl: new URL('/api/service-reminder-provider-events/twilio', input.origin).toString(),
    }, { db, previouslyAttempted: requests.length > 0 });
    await event(input, 'report_email_accepted', `${prefix}:accepted`, { recipientSha256: recipientHash, provider: result.provider, providerMessageId: result.providerMessageId });
    return { status: 'accepted', reportId: input.reportId, message: 'The report email was accepted for delivery.' };
  } catch (error) {
    const outcome = reminderProviderFailureOutcome(error);
    await event(input, 'report_email_failed', `${attempt}:failed`, { recipientSha256: recipientHash, outcome, error: 'The report email could not be confirmed. Retry to check delivery safely.' });
    if (outcome === 'indeterminate') return { status: 'reconciliation_required', reportId: input.reportId, message: 'Check the outgoing mailbox before sending this report again. Delivery could not be confirmed.' };
    return { status: 'failed', reportId: input.reportId, message: 'The report email could not be confirmed. Your completed report is saved; retry email from this assessment.' };
  }
}
