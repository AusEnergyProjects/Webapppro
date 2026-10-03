import type { AuthorisedTradeQuoteDecisionLink } from "./trade-quote-decision-server";
import { quoteQuestionScope } from "./trade-quote-questions-server";
import { decryptProtectedPayload } from "./trade-integration-crypto";
import { hashPhotoRequestSecret, normalisePhotoRequirements, parsePhotoRequestToken } from "./trade-photo-requests";
import { photoRequestProofOverview } from "./photo-request-review-server";
import { australianAppointmentTimeZone, customerAppointmentCalendar } from "./customer-appointment-calendar";
import { customerJobAppointmentLabel, customerJobLocalNow, type CustomerJobCurrent } from "./customer-job-journey";

type JobRow = { work_number: string; stage: string; pipeline_stage: string; business_name: string; address_state: string };
type PhotoRow = { id: string; encrypted_token: string; token_hash: string; token_issue: number; revision: number; requirements: string };

/** Never apply historical receipt authority to live operational information. */
export function customerJobScope(link: AuthorisedTradeQuoteDecisionLink, now: string) {
  const scope = quoteQuestionScope(link, now);
  return { ...scope, sql: `${scope.sql}
    AND detail.customer_source='trade_owned' AND work.source_type<>'opportunity'
    AND detail.pipeline_stage<>'lost'
    AND EXISTS (SELECT 1 FROM trade_crm_customers customer WHERE customer.id=detail.crm_customer_id
      AND customer.firebase_uid=work.firebase_uid AND customer.record_status='active')
    AND EXISTS (SELECT 1 FROM trade_crm_service_sites site WHERE site.id=detail.service_site_id
      AND site.customer_id=detail.crm_customer_id AND site.firebase_uid=work.firebase_uid AND site.record_status='active')` };
}

async function photoRequest(db: D1Database, link: AuthorisedTradeQuoteDecisionLink, now: string) {
  const scope = customerJobScope(link, now);
  return db.prepare(`SELECT id,encrypted_token,token_hash,token_issue,revision,requirements FROM trade_crm_photo_requests
    WHERE firebase_uid=? AND work_order_id=? AND crm_customer_id=? AND status='active' AND expires_at>?
      AND token_hash<>'' AND encrypted_token<>'' AND EXISTS (SELECT 1 ${scope.sql} AND work.stage<>'cancelled')
    ORDER BY updated_at DESC,id LIMIT 1`).bind(link.firebase_uid, link.work_order_id, link.crm_customer_id, now, ...scope.bindings).first<PhotoRow>();
}

/** Kept on the server: every proxied photo action rechecks the quote capability. */
export async function customerJobPhotoToken(db: D1Database, link: AuthorisedTradeQuoteDecisionLink, now = new Date().toISOString()) {
  const request = await photoRequest(db, link, now);
  if (!request) throw new Error("QUOTE_LINK_STOPPED");
  const protectedToken = await decryptProtectedPayload(request.encrypted_token);
  const secret = typeof protectedToken.secret === "string" ? protectedToken.secret : "";
  const token = `${request.id}.${secret}`;
  if (protectedToken.requestId !== request.id || Number(protectedToken.tokenIssue) !== Number(request.token_issue)
    || !parsePhotoRequestToken(token) || await hashPhotoRequestSecret(secret) !== request.token_hash) throw new Error("CUSTOMER_JOB_PHOTO_LINK_INVALID");
  return token;
}

export async function loadCustomerJobCurrent(db: D1Database, link: AuthorisedTradeQuoteDecisionLink, now = new Date().toISOString()): Promise<CustomerJobCurrent | null> {
  if (link.status === "declined") return null;
  const scope = customerJobScope(link, now);
  const job = await db.prepare(`SELECT work.work_number, work.stage, detail.pipeline_stage, trade.business_name,
    COALESCE((SELECT site.address_state FROM trade_crm_service_sites site WHERE site.id=detail.service_site_id
      AND site.firebase_uid=work.firebase_uid AND site.customer_id=detail.crm_customer_id),trade.address_state,'NSW') address_state
    ${scope.sql}`).bind(...scope.bindings).first<JobRow>();
  if (!job) return null;
  const stage: CustomerJobCurrent["stage"] = job.stage === "cancelled" ? "cancelled"
    : job.stage === "completed" || job.pipeline_stage === "completed" ? "completed"
      : job.stage === "in_progress" || job.pipeline_stage === "in_progress" ? "in_progress" : "preparing";
  if (stage === "cancelled") return { stage, appointment: null, photos: null };
  const timeZone = australianAppointmentTimeZone(job.address_state);
  const [visit, request] = await Promise.all([
    db.prepare(`SELECT starts_at,ends_at FROM trade_crm_appointments
      WHERE firebase_uid=? AND work_order_id=? AND status IN ('scheduled','en_route','arrived','in_progress')
        AND ends_at>? AND EXISTS (SELECT 1 ${scope.sql} AND work.stage<>'cancelled')
      ORDER BY starts_at,id LIMIT 1`).bind(link.firebase_uid, link.work_order_id, customerJobLocalNow(now, timeZone), ...scope.bindings)
      .first<{ starts_at: string; ends_at: string }>(),
    photoRequest(db, link, now),
  ]);
  const calendar = visit && stage !== "completed" ? customerAppointmentCalendar({ workNumber: job.work_number, businessName: job.business_name,
    startsAt: visit.starts_at, endsAt: visit.ends_at, timeZone }) : null;
  const label = visit ? customerJobAppointmentLabel(visit.starts_at, visit.ends_at) : "";
  const appointment = visit && calendar && label ? { startsAt: visit.starts_at, endsAt: visit.ends_at, label, googleCalendarUrl: calendar.googleUrl } : null;
  let photos: CustomerJobCurrent["photos"] = null;
  if (request) {
    const proof = await photoRequestProofOverview({ ownerUid: link.firebase_uid, workOrderId: link.work_order_id,
      requestId: request.id, requestRevision: Number(request.revision), requirements: normalisePhotoRequirements(JSON.parse(request.requirements)) });
    photos = { status: proof.proofReady ? "reviewed" : proof.completion?.current ? "submitted" : "needed", outstanding: proof.outstandingRequirementIds.length };
  }
  if (!await db.prepare(`SELECT link.id ${scope.sql} AND work.stage<>'cancelled'`).bind(...scope.bindings).first()) return null;
  return { stage: stage === "preparing" && appointment ? "scheduled" : stage, appointment, photos };
}
