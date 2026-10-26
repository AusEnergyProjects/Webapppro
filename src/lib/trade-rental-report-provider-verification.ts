import { getD1 } from '../../db';
import { readRentalReportProviderReceipt, recordRentalReportProviderEvent, recoverRentalReportAcceptedEvent } from './trade-rental-report-provider-events';

type Row = Record<string, unknown>;
type VerificationInput = { ownerUid: string; workOrderId: string; reportId: string; expectedRecipientEmail: string; actorUid: string };
type AttachmentEvidence = { providerMessageId: string; filename: string; sizeBytes: number; sha256: string; verifiedAt: string };
export type RentalReportProviderVerification = {
  status: 'verified' | 'unavailable' | 'unverified'; reportId: string; providerStatus: string | null;
  providerMessageId: string; recipientSha256: string; attachment: AttachmentEvidence | null; message: string;
};
const MAX_PDF_BYTES = 18 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const providerEvents = ['sent', 'delivered', 'bounced', 'failed', 'suppressed', 'complained', 'delivery_delayed'] as const;
const object = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hash = async (value: string | Uint8Array) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
};
class InspectionFailure extends Error {
  constructor(readonly status: 'unavailable' | 'unverified', message: string) { super(message); }
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  const declaredSize = response.headers.get('content-length');
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > limit)) {
    await response.body?.cancel();
    throw new InspectionFailure('unverified', 'The delivery service returned an unexpected attachment or response size.');
  }
  if (!response.body) throw new InspectionFailure('unverified', 'The delivery service returned an empty response.');
  const bytes = new Uint8Array(limit);
  const reader = response.body.getReader();
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return bytes.subarray(0, length);
      if (length + result.value.byteLength > limit) {
        await reader.cancel();
        throw new InspectionFailure('unverified', 'The delivery service returned an unexpected attachment or response size.');
      }
      bytes.set(result.value, length);
      length += result.value.byteLength;
    }
  } finally { reader.releaseLock(); }
}

async function providerJson(path: string, apiKey: string, fetchImpl: typeof fetch): Promise<Row> {
  const response = await fetchImpl(`https://api.resend.com${path}`, {
    method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    redirect: 'manual', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new InspectionFailure('unavailable',
      'The website delivery service credential cannot read delivery records. Its administrator must enable read access on the existing credential; the report has not been resent.');
    throw new InspectionFailure('unavailable', 'The delivery service could not provide this email record. Try checking again later; the report has not been resent.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(await boundedBytes(response, MAX_JSON_BYTES))); }
  catch (error) {
    if (error instanceof InspectionFailure) throw error;
    throw new InspectionFailure('unverified', 'The delivery service returned an invalid email record.');
  }
  if (!object(parsed)) throw new InspectionFailure('unverified', 'The delivery service returned an invalid email record.');
  return parsed;
}

export async function readRentalReportAttachmentVerification(db: D1Database,
  input: { ownerUid: string; inspectionId: string; reportId: string; recipientSha256: string; providerMessageId: string }): Promise<AttachmentEvidence | null> {
  const row = await db.prepare(`SELECT event.metadata FROM trade_rental_inspection_events event
    JOIN trade_rental_reports report ON report.id = event.report_id AND report.firebase_uid = event.firebase_uid
      AND report.inspection_id = event.inspection_id AND report.status = 'issued'
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id AND inspection.firebase_uid = report.firebase_uid
      AND inspection.issued_report_id = report.id AND inspection.status = 'issued'
    WHERE event.firebase_uid = ? AND event.inspection_id = ? AND event.report_id = ?
      AND event.event_type = 'report_email_attachment_verified' AND json_extract(event.metadata, '$.provider') = 'resend'
      AND json_extract(event.metadata, '$.recipientSha256') = ?
      AND json_extract(event.metadata, '$.providerMessageId') = ?
      AND json_extract(event.metadata, '$.sha256') = report.pdf_sha256
      AND json_extract(event.metadata, '$.sizeBytes') = report.pdf_size_bytes
      AND EXISTS (SELECT 1 FROM trade_rental_inspection_events accepted
        WHERE accepted.inspection_id = event.inspection_id AND accepted.report_id = event.report_id
          AND accepted.firebase_uid = event.firebase_uid AND accepted.event_type = 'report_email_accepted'
          AND json_extract(accepted.metadata, '$.provider') = 'resend'
          AND json_extract(accepted.metadata, '$.providerMessageId') = json_extract(event.metadata, '$.providerMessageId')
          AND json_extract(accepted.metadata, '$.recipientSha256') = json_extract(event.metadata, '$.recipientSha256'))
    ORDER BY event.rowid DESC LIMIT 1`).bind(input.ownerUid, input.inspectionId, input.reportId, input.recipientSha256, input.providerMessageId).first<Row>();
  if (!row) return null;
  let meta: unknown;
  try { meta = JSON.parse(String(row.metadata)); } catch { return null; }
  if (!object(meta) || typeof meta.providerMessageId !== 'string' || typeof meta.filename !== 'string'
    || !Number.isSafeInteger(meta.sizeBytes) || Number(meta.sizeBytes) < 1 || Number(meta.sizeBytes) > MAX_PDF_BYTES
    || typeof meta.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(meta.sha256)
    || typeof meta.verifiedAt !== 'string' || !Number.isFinite(Date.parse(meta.verifiedAt))) return null;
  return { providerMessageId: meta.providerMessageId, filename: meta.filename, sizeBytes: Number(meta.sizeBytes), sha256: meta.sha256, verifiedAt: meta.verifiedAt };
}

export async function verifyRentalReportProviderDelivery(input: VerificationInput,
  options: { db?: D1Database; fetchImpl?: typeof fetch; apiKey?: string } = {}): Promise<RentalReportProviderVerification> {
  const db = options.db ?? getD1();
  const recipient = input.expectedRecipientEmail.trim().toLowerCase();
  if (!input.ownerUid || !input.actorUid || !input.workOrderId || !input.reportId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new Error('REPORT_DELIVERY_VERIFICATION_NOT_FOUND');
  }
  const report = await db.prepare(`SELECT report.id, report.inspection_id, report.report_number, report.pdf_sha256, report.pdf_size_bytes
    FROM trade_rental_reports report
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id AND inspection.firebase_uid = report.firebase_uid
      AND inspection.issued_report_id = report.id AND inspection.status = 'issued'
    JOIN trade_work_orders job ON job.id = inspection.work_order_id AND job.firebase_uid = inspection.firebase_uid
      AND job.partner_type = 'installer' AND job.record_status = 'active'
    WHERE report.firebase_uid = ? AND job.id = ? AND report.id = ? AND report.status = 'issued'`)
    .bind(input.ownerUid, input.workOrderId, input.reportId).first<Row>();
  if (!report) throw new Error('REPORT_DELIVERY_VERIFICATION_NOT_FOUND');
  const recipientSha256 = await hash(recipient);
  const requestKey = await hash(`rental-report-email|${input.ownerUid}|${input.reportId}|${report.pdf_sha256}|${recipientSha256}`);
  const submission = await db.prepare(`SELECT provider_message_id FROM trade_email_submissions
    WHERE owner_uid = ? AND request_key = ? AND recipient_email = ? AND provider = 'resend' AND status = 'accepted' LIMIT 1`)
    .bind(input.ownerUid, requestKey, recipient).first<{ provider_message_id: string }>();
  if (submission?.provider_message_id) await recoverRentalReportAcceptedEvent(db, submission.provider_message_id);
  const accepted = await db.prepare(`SELECT event.id, submission.provider, submission.provider_message_id FROM trade_rental_inspection_events event
    JOIN trade_email_submissions submission ON submission.owner_uid = event.firebase_uid AND submission.request_key = ?
      AND submission.status = 'accepted' AND submission.recipient_email = ?
      AND submission.provider = json_extract(event.metadata, '$.provider')
      AND submission.provider_message_id = json_extract(event.metadata, '$.providerMessageId')
    WHERE event.firebase_uid = ? AND event.inspection_id = ? AND event.report_id = ?
      AND event.event_type = 'report_email_accepted' AND event.request_id = ?
      AND json_extract(event.metadata, '$.recipientSha256') = ? LIMIT 1`)
    .bind(requestKey, recipient, input.ownerUid, report.inspection_id, input.reportId, `report-email:${requestKey}:accepted`, recipientSha256).first<Row>();
  if (!accepted) throw new Error('REPORT_DELIVERY_VERIFICATION_NOT_FOUND');
  const providerMessageId = String(accepted.provider_message_id || '');
  const result: RentalReportProviderVerification = { status: 'unverified', reportId: input.reportId, providerStatus: null,
    providerMessageId, recipientSha256, attachment: null, message: '' };
  if (accepted.provider !== 'resend' || !/^[a-zA-Z0-9_-]{1,200}$/.test(providerMessageId)) return { ...result, status: 'unavailable',
    message: 'Delivery and attachment inspection is unavailable for this email provider. The report has not been resent.' };
  const receiptInput = { ownerUid: input.ownerUid, inspectionId: String(report.inspection_id), reportId: input.reportId, recipientSha256 };
  const existingReceipt = await readRentalReportProviderReceipt(db, receiptInput);
  if (existingReceipt?.providerMessageId === providerMessageId) result.providerStatus = existingReceipt.providerStatus;
  const deliverySummary = () => result.providerStatus === 'delivered' ? 'The recipient mail server accepted this email. '
    : result.providerStatus && ['bounced', 'failed', 'suppressed', 'complained'].includes(result.providerStatus)
      ? `The delivery service reports this email as ${result.providerStatus}. ` : '';
  const failure = (status: 'unavailable' | 'unverified', message: string): RentalReportProviderVerification =>
    ({ ...result, status, message: deliverySummary() + message });
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) return failure('unavailable', 'The website delivery service credential is unavailable for attachment verification. The report has not been resent.');
  const sizeBytes = Number(report.pdf_size_bytes);
  const sha256 = String(report.pdf_sha256 || '');
  const reportNumber = String(report.report_number || '');
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_PDF_BYTES || !/^[a-f0-9]{64}$/.test(sha256) || !reportNumber || reportNumber.length > 200) {
    return failure('unverified', 'The saved PDF cannot be safely checked against an email attachment.');
  }
  const filename = `${reportNumber.replace(/[^a-zA-Z0-9-]/g, '-')}.pdf`;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const email = await providerJson(`/emails/${encodeURIComponent(providerMessageId)}`, apiKey, fetchImpl);
    if (email.id !== providerMessageId || !Array.isArray(email.to) || email.to.length !== 1
      || typeof email.to[0] !== 'string' || email.to[0].trim().toLowerCase() !== recipient) {
      throw new InspectionFailure('unverified', 'The delivery record does not match the report recipient. Delivery and attachment verification were not recorded.');
    }
    const observedAt = new Date().toISOString();
    const providerStatus = providerEvents.find(status => status === email.last_event);
    if (providerStatus) {
      const recorded = await recordRentalReportProviderEvent(db, { providerMessageId,
        eventId: `verification:${providerMessageId}:${providerStatus}`, eventType: `email.${providerStatus}`,
        recipientEmails: [recipient], occurredAt: observedAt, source: 'provider_api' });
      if (!recorded.matched) throw new Error('REPORT_DELIVERY_VERIFICATION_NOT_FOUND');
      const receipt = await readRentalReportProviderReceipt(db, receiptInput);
      if (!receipt || receipt.providerMessageId !== providerMessageId) throw new Error('REPORT_DELIVERY_VERIFICATION_NOT_FOUND');
      result.providerStatus = receipt.providerStatus;
    }
    const attachments = await providerJson(`/emails/${encodeURIComponent(providerMessageId)}/attachments`, apiKey, fetchImpl);
    if (!Array.isArray(attachments.data) || attachments.data.length > 100 || typeof attachments.has_more !== 'boolean') {
      throw new InspectionFailure('unverified', 'The delivery service returned an invalid attachment list.');
    }
    const matching = attachments.data.filter(item => object(item) && item.filename === filename);
    if (matching.length !== 1 || attachments.has_more) throw new InspectionFailure('unverified',
      'The exact PDF attachment could not be confirmed on this email. The report has not been resent.');
    const attachment: unknown = matching[0];
    if (!object(attachment) || attachment.size !== sizeBytes || attachment.content_type !== 'application/pdf'
      || attachment.content_disposition !== 'attachment' || typeof attachment.download_url !== 'string') {
      throw new InspectionFailure('unverified', 'The email attachment metadata does not match the saved report PDF.');
    }
    let url: URL;
    try { url = new URL(attachment.download_url); } catch { throw new InspectionFailure('unverified', 'The delivery service returned an invalid attachment address.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'outbound-cdn.resend.com' || (url.port && url.port !== '443') || url.username || url.password) {
      throw new InspectionFailure('unverified', 'The delivery service returned an untrusted attachment address.');
    }
    const response = await fetchImpl(url.toString(), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { await response.body?.cancel(); throw new InspectionFailure('unavailable', 'The delivery service could not provide the PDF attachment for checking.'); }
    const bytes = await boundedBytes(response, sizeBytes);
    if (bytes.byteLength !== sizeBytes || await hash(bytes) !== sha256) throw new InspectionFailure('unverified',
      'The email attachment bytes do not match the saved report PDF. Attachment verification failed.');
    const verifiedAt = new Date().toISOString();
    const metadata = { provider: 'resend', providerMessageId, recipientSha256, filename, sizeBytes, sha256, verifiedAt };
    const requestId = `report-email-attachment:${await hash(`${input.reportId}|${providerMessageId}|${recipientSha256}|${sha256}`)}`;
    await db.prepare(`INSERT OR IGNORE INTO trade_rental_inspection_events
      (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, created_at)
      SELECT ?, report.inspection_id, report.id, report.firebase_uid, 'system', ?, 'report_email_attachment_verified', ?, ?, ?, ?
      FROM trade_rental_reports report JOIN trade_rental_inspections inspection
        ON inspection.id = report.inspection_id AND inspection.firebase_uid = report.firebase_uid
        AND inspection.issued_report_id = report.id AND inspection.status = 'issued'
      WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'issued' AND inspection.work_order_id = ?
        AND report.pdf_sha256 = ? AND report.pdf_size_bytes = ?
        AND EXISTS (SELECT 1 FROM trade_rental_inspection_events accepted WHERE accepted.id = ?
          AND accepted.inspection_id = report.inspection_id AND accepted.firebase_uid = report.firebase_uid AND accepted.report_id = report.id)`)
      .bind(crypto.randomUUID(), input.actorUid, requestId, 'The provider email PDF attachment matches the issued report.', JSON.stringify(metadata), verifiedAt,
        input.reportId, input.ownerUid, input.workOrderId, sha256, sizeBytes, accepted.id).run();
    result.attachment = await readRentalReportAttachmentVerification(db, { ownerUid: input.ownerUid,
      inspectionId: String(report.inspection_id), reportId: input.reportId, recipientSha256, providerMessageId });
    if (!result.attachment || result.attachment.providerMessageId !== providerMessageId) throw new Error('REPORT_DELIVERY_VERIFICATION_NOT_FOUND');
    const finalReceipt = await readRentalReportProviderReceipt(db, receiptInput);
    result.providerStatus = finalReceipt?.providerMessageId === providerMessageId ? finalReceipt.providerStatus : null;
    return { ...result, status: 'verified', message: result.providerStatus === 'delivered'
      ? 'The recipient mail server accepted this email, and its PDF attachment exactly matches the issued report. Inbox placement and reading are not confirmed.'
      : `${deliverySummary()}The email PDF attachment exactly matches the issued report. Delivery to the recipient mail server is not confirmed.` };
  } catch (error) {
    if (error instanceof Error && error.message === 'REPORT_DELIVERY_VERIFICATION_NOT_FOUND') throw error;
    const finalReceipt = await readRentalReportProviderReceipt(db, receiptInput);
    result.providerStatus = finalReceipt?.providerMessageId === providerMessageId ? finalReceipt.providerStatus : null;
    if (error instanceof InspectionFailure) return failure(error.status, error.message);
    return failure('unavailable', 'The delivery service could not complete attachment verification. Try checking again later; the report has not been resent.');
  }
}
