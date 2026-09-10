import { getD1 } from '../../db';
import { assignedJob, type TeamAccess } from '@/lib/trade-team-server';
import { authenticatedRentalReportPdf, ownerRentalReportPresentation } from '@/lib/trade-rental-report-server';
import { sendServiceReminderProviderMessage, serviceReminderProviderConfiguration } from '@/lib/service-reminder-delivery';

type Row = Record<string, unknown>;
type Input = { access: TeamAccess; workOrderId: string; inspectionId: string; reportId: string; expectedRecipientEmail: string; origin: string };
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,'0')).join('');
const object = (value: unknown): Row => { try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };

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
  const row = await getD1().prepare(`SELECT event.event_type, event.metadata, event.created_at FROM trade_rental_inspection_events event
    JOIN trade_rental_inspections inspection ON inspection.id = event.inspection_id AND inspection.firebase_uid = event.firebase_uid
      AND inspection.issued_report_id = event.report_id AND inspection.status = 'issued'
    WHERE event.firebase_uid = ? AND event.inspection_id = ? AND event.event_type IN ('report_email_requested', 'report_email_accepted', 'report_email_failed')
    ORDER BY event.created_at DESC, CASE event.event_type WHEN 'report_email_accepted' THEN 0 WHEN 'report_email_failed' THEN 1 ELSE 2 END LIMIT 1`)
    .bind(ownerUid, inspectionId).first<Row>();
  if (!row) return null;
  const meta = object(row.metadata);
  const status = row.event_type === 'report_email_accepted' ? 'accepted' : row.event_type === 'report_email_failed' ? 'failed' : 'sending';
  return { status, reportId: String(meta.reportId || ''), message: status === 'accepted' ? 'The report email was accepted for delivery.'
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
  const requests = events.results.filter(row => row.event_type === 'report_email_requested');
  const last = requests.at(-1);
  if (last && Date.now() - Date.parse(String(requests[0].created_at)) > 23 * 60 * 60 * 1000) {
    return { status: 'reconciliation_required', reportId: input.reportId, message: 'Check the previous email delivery before sending again. It may already have reached the client.' };
  }
  if (last && !events.results.some(row => row.request_id === `${last.request_id}:failed`)
    && Date.now() - Date.parse(String(last.created_at)) < 90_000) return { status: 'sending', reportId: input.reportId, message: 'The report email is being sent.' };
  if (!serviceReminderProviderConfiguration().email.configured) return { status: 'failed', reportId: input.reportId, message: 'Email delivery is not configured. The completed report is saved.' };
  const pdf = await authenticatedRentalReportPdf({ access: input.access, workOrderId: input.workOrderId, reportId: input.reportId });
  // Large evidence reports travel by their existing secure report link rather than exceeding email attachment limits.
  const presentation = pdf.bytes.length > 18 * 1024 * 1024
    ? await ownerRentalReportPresentation({ ownerUid: input.access.ownerUid, inspectionId: input.inspectionId, origin: input.origin, includeSecret: true }) : [];
  const publicReport = presentation.find(row => row.id === input.reportId);
  const link = publicReport?.link;
  if (pdf.bytes.length > 18 * 1024 * 1024 && (!link || link.status !== 'active' || !link.shareUrl)) return { status: 'failed', reportId: input.reportId, message: 'Renew the report sharing link before emailing this large report.' };
  const currentRecipient = await rentalReportDeliveryRecipient(input.access.ownerUid, input.workOrderId);
  if (!currentRecipient || currentRecipient.email !== recipient.email) throw new Error('REPORT_RECIPIENT_CHANGED');
  const attempt = `${prefix}:${requests.length + 1}`;
  const claim = await event(input, 'report_email_requested', attempt, { recipientSha256: recipientHash });
  if (!claim.meta.changes) return { status: 'sending', reportId: input.reportId, message: 'The report email is being sent.' };
  try {
    const attachments = [];
    if (pdf.bytes.length <= 18 * 1024 * 1024) {
      let binary = ''; for (const byte of pdf.bytes) binary += String.fromCharCode(byte);
      attachments.push({ filename: `${pdf.reportNumber.replace(/[^a-zA-Z0-9-]/g, '-')}.pdf`, content: btoa(binary), contentType: 'application/pdf' });
    }
    const body = `Hello,\n\nYour rental assessment report ${pdf.reportNumber} is ready. ${attachments.length ? 'The PDF report is attached.' : `View and download it here: ${link?.shareUrl}`}\n\nIt includes the property findings, evidence and measured work needed for quoting.\n\nTLink`;
    const result = await sendServiceReminderProviderMessage({ channel: 'email', recipient: recipient.email,
      subject: `Rental assessment report | ${pdf.reportNumber}`, body, attachments, idempotencyKey: key,
      messageType: 'tlink_rental_report', callbackUrl: new URL('/api/service-reminder-provider-events/twilio', input.origin).toString(),
    }, { fetchImpl: (resource, init) => fetch(resource, { ...init, signal: AbortSignal.timeout(15_000) }) });
    await event(input, 'report_email_accepted', `${prefix}:accepted`, { recipientSha256: recipientHash, provider: result.provider, providerMessageId: result.providerMessageId });
    return { status: 'accepted', reportId: input.reportId, message: 'The report email was accepted for delivery.' };
  } catch {
    await event(input, 'report_email_failed', `${attempt}:failed`, { recipientSha256: recipientHash, error: 'The report email could not be confirmed. Retry to check delivery safely.' });
    return { status: 'failed', reportId: input.reportId, message: 'The report email could not be confirmed. Your completed report is saved; retry email from this assessment.' };
  }
}
