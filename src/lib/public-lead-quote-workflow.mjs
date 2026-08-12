import { ENERGY_SERVICE_LABELS } from "./energy-service-catalogue.mjs";
import { publicTradeContactForMatchedLead } from "./public-trade-lead-access.mjs";
import {
  publicPlanQuoteAnswersForMatchedCategories,
  strictPublicPlanQuoteServiceCategories,
} from "./public-plan-quote-preparation.mjs";

const MATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function publicLeadQuoteWorkflowIds(matchId) {
  const canonicalMatchId = String(matchId || "").trim().toLowerCase();
  if (!MATCH_ID_PATTERN.test(canonicalMatchId)) return null;
  return {
    customerId: `public-lead-customer-${canonicalMatchId}`,
    contactId: `public-lead-contact-${canonicalMatchId}`,
    serviceSiteId: `public-lead-site-${canonicalMatchId}`,
    siteContactId: `public-lead-site-contact-${canonicalMatchId}`,
    workOrderId: `public-lead-work-${canonicalMatchId}`,
    jobDetailId: `public-lead-job-${canonicalMatchId}`,
    eventId: `public-lead-event-${canonicalMatchId}`,
    quoteId: `public-lead-quote-${canonicalMatchId}`,
    quoteVersionId: `public-lead-quote-version-${canonicalMatchId}`,
  };
}

export function publicLeadAcceptedCrmCustomerName(contact) {
  return {
    firstName: String(contact?.firstName || "").trim() || "Redacted",
    lastName: String(contact?.lastName || "").trim() || "Redacted",
  };
}

export function publicLeadQuoteWorkflowSnapshot(row) {
  const contact = publicTradeContactForMatchedLead(row);
  const categories = strictPublicPlanQuoteServiceCategories(row?.matched_categories);
  if (!contact || !categories.length) return null;
  const answers = publicPlanQuoteAnswersForMatchedCategories(
    row.public_quote_answers,
    categories,
  );
  const serviceLabels = categories.map((category) =>
    ENERGY_SERVICE_LABELS[category] || category.replaceAll("-", " "));
  return {
    contact,
    categories,
    serviceLabels,
    answers,
    reference: String(row.source_reference || "").trim().slice(0, 120),
    title: String(row.opportunity_title || row.title || "").trim().slice(0, 180) || "Customer enquiry",
    summary: String(row.summary || "").trim().slice(0, 1200),
    priority: String(row.opportunity_priority || row.priority || "standard").trim().slice(0, 40) || "standard",
  };
}

export function publicLeadAcceptedDisclosure(snapshot, row, acceptedAt, photos = []) {
  if (!snapshot || !Number.isFinite(Date.parse(String(acceptedAt || "")))) return null;
  if (!Array.isArray(photos) || photos.length > 12) return null;
  let disclosedFields;
  try {
    disclosedFields = JSON.parse(String(row?.public_contact_disclosed_fields || "[]"));
  } catch {
    return null;
  }
  if (!Array.isArray(disclosedFields)) return null;
  return {
    contract: "tlink-public-lead-accepted-disclosure-v1",
    acceptedAt: String(acceptedAt),
    source: {
      opportunityMatchId: String(row?.match_id || row?.work_source_reference || ""),
      sourceReference: snapshot.reference,
      releaseId: String(row?.public_contact_release_id || ""),
      disclosedFields: disclosedFields.map(String).sort(),
      noticeVersion: String(row?.public_contact_notice_version || ""),
      consentPurpose: String(row?.public_contact_consent_purpose || ""),
      grantedAt: String(row?.public_contact_granted_at || ""),
    },
    customer: {
      firstName: snapshot.contact.firstName,
      lastName: snapshot.contact.lastName,
      email: snapshot.contact.email,
      phone: snapshot.contact.phone,
      addressLine1: snapshot.contact.addressLine1,
      addressLine2: snapshot.contact.addressLine2,
      suburb: snapshot.contact.suburb,
      addressState: snapshot.contact.addressState,
      postcode: snapshot.contact.postcode,
      message: snapshot.contact.message,
    },
    enquiry: {
      title: snapshot.title,
      summary: snapshot.summary,
      priority: snapshot.priority,
      categories: snapshot.categories,
      serviceLabels: snapshot.serviceLabels,
      quoteAnswers: snapshot.answers,
    },
    photos: photos.map((photo) => ({
      id: String(photo.id || ""),
      sourcePhotoId: String(photo.sourcePhotoId || ""),
      promptId: String(photo.promptId || ""),
      label: String(photo.label || "").slice(0, 180),
      serviceCategories: strictPublicPlanQuoteServiceCategories(photo.serviceCategories),
      contentType: String(photo.contentType || ""),
      sizeBytes: Number(photo.sizeBytes || 0),
      sha256: String(photo.sha256 || ""),
      privacyStatus: String(photo.privacyStatus || ""),
    })),
  };
}

export function publicLeadQuoteAccessSnapshot(row, now = Date.now()) {
  const nowMs = typeof now === "number" ? now : Date.parse(String(now || ""));
  const expiresAtMs = Date.parse(String(row?.expires_at || ""));
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= nowMs
    || !["interested", "connected"].includes(String(row?.match_status || ""))
    || String(row?.opportunity_status || "") !== "open"
  ) return null;
  return publicLeadQuoteWorkflowSnapshot(row);
}

export function publicLeadQuoteAccessFingerprint(row) {
  const sha256 = String(row?.accepted_disclosure_sha256 || "");
  return /^[0-9a-f]{64}$/.test(sha256) ? sha256 : "";
}

export function publicLeadIssueAccessGuard(ownerUid, row) {
  if (!row?.public_lead_enquiry) return { sql: "1 = 1", bindings: [] };
  return {
    sql: `EXISTS (
      SELECT 1 FROM trade_crm_job_details accepted_detail
      WHERE accepted_detail.work_order_id = ?
        AND accepted_detail.firebase_uid = ?
        AND accepted_detail.customer_source = 'public_lead_released'
        AND accepted_detail.accepted_disclosure_sha256 = ?
        AND json_extract(accepted_detail.accepted_disclosure_snapshot, '$.contract') =
          'tlink-public-lead-accepted-disclosure-v1'
    )`,
    bindings: [
      row.id,
      ownerUid,
      row.accepted_disclosure_sha256,
    ],
  };
}
