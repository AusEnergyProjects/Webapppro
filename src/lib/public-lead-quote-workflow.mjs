import { ENERGY_SERVICE_LABELS } from "./energy-service-catalogue.mjs";
import { publicTradeContactForMatchedLead } from "./public-trade-lead-access.mjs";
import {
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
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
    title: String(row.opportunity_title || row.title || "Customer enquiry").trim().slice(0, 180),
    summary: String(row.summary || "").trim().slice(0, 1200),
    priority: String(row.opportunity_priority || row.priority || "standard").trim().slice(0, 40) || "standard",
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
  const snapshot = publicLeadQuoteWorkflowSnapshot(row);
  if (!snapshot) return "";
  return JSON.stringify({
    releaseId: String(row?.public_contact_release_id || ""),
    releaseUpdatedAt: String(row?.public_contact_updated_at || ""),
    releaseGrantedAt: String(row?.public_contact_granted_at || ""),
    releaseNoticeVersion: String(row?.public_contact_notice_version || ""),
    releasePurpose: String(row?.public_contact_consent_purpose || ""),
    disclosedFields: String(row?.public_contact_disclosed_fields || ""),
    matchStatus: String(row?.match_status || ""),
    matchedCategories: String(row?.matched_categories || ""),
    opportunityStatus: String(row?.opportunity_status || ""),
    opportunityExpiresAt: String(row?.expires_at || ""),
    opportunitySourceReference: String(row?.source_reference || ""),
    opportunityTitle: String(row?.opportunity_title || row?.title || ""),
    opportunitySummary: String(row?.summary || ""),
    opportunityPriority: String(row?.opportunity_priority || row?.priority || ""),
    opportunityPostcode: String(row?.opportunity_postcode || ""),
    opportunityState: String(row?.state || ""),
    quotePreparationId: String(row?.public_quote_preparation_id || ""),
    quotePreparationVersion: String(row?.public_quote_preparation_version || ""),
    quotePreparationGrantedAt: String(row?.public_quote_preparation_granted_at || ""),
    quotePreparationUpdatedAt: String(row?.public_quote_preparation_updated_at || ""),
    quoteAnswers: String(row?.public_quote_answers || ""),
    snapshot,
  });
}

export function publicLeadIssueAccessGuard(ownerUid, row) {
  if (!row?.public_lead_enquiry) return { sql: "1 = 1", bindings: [] };
  return {
    sql: `EXISTS (
      SELECT 1
      FROM trade_opportunity_matches current_match
      JOIN trade_opportunities current_opportunity
        ON current_opportunity.id = current_match.opportunity_id
      JOIN public_trade_lead_contact_releases current_release
        ON current_release.id = (
          SELECT latest_release.id
          FROM public_trade_lead_contact_releases latest_release
          WHERE latest_release.opportunity_id = current_opportunity.id
            AND latest_release.source_reference = current_opportunity.source_reference
          ORDER BY datetime(latest_release.updated_at) DESC,
            datetime(latest_release.granted_at) DESC, latest_release.id DESC
          LIMIT 1
        )
      WHERE current_match.id = ? AND current_match.firebase_uid = ?
        AND current_match.status IN ('interested', 'connected')
        AND current_match.matched_categories = ?
        AND current_opportunity.status = 'open'
        AND datetime(current_opportunity.expires_at) > datetime('now')
        AND current_opportunity.source_reference = ?
        AND current_opportunity.title = ?
        AND current_opportunity.summary = ?
        AND current_opportunity.priority = ?
        AND current_opportunity.postcode = ?
        AND current_opportunity.state = ?
        AND current_release.id = ?
        AND current_release.updated_at = ?
        AND current_release.status = 'active'
        AND current_release.withdrawn_at = ''
        AND current_release.source_reference = current_opportunity.source_reference
        AND current_release.postcode = current_opportunity.postcode
        AND current_release.disclosed_fields = ?
        AND current_release.customer_first_name = ?
        AND current_release.customer_last_name = ?
        AND current_release.customer_email = ?
        AND current_release.customer_phone = ?
        AND current_release.customer_unit_number = ?
        AND current_release.customer_street_address = ?
        AND current_release.customer_suburb = ?
        AND current_release.customer_address_state = ?
        AND current_release.customer_message = ?
        AND current_release.notice_version = ?
        AND current_release.consent_purpose = ?
        AND current_release.granted_at = ?
        AND (
          (? = '' AND NOT EXISTS (
            SELECT 1 FROM public_trade_lead_quote_preparations current_preparation
            WHERE current_preparation.opportunity_id = current_opportunity.id
              AND current_preparation.source_reference = current_opportunity.source_reference
              AND current_preparation.status = 'active'
              AND current_preparation.withdrawn_at = ''
              AND current_preparation.notice_version = ?
              AND current_preparation.consent_purpose = ?
          ))
          OR EXISTS (
            SELECT 1 FROM public_trade_lead_quote_preparations current_preparation
            WHERE current_preparation.id = ?
              AND current_preparation.opportunity_id = current_opportunity.id
              AND current_preparation.source_reference = current_opportunity.source_reference
              AND current_preparation.status = 'active'
              AND current_preparation.withdrawn_at = ''
              AND current_preparation.version = ?
              AND current_preparation.granted_at = ?
              AND current_preparation.updated_at = ?
              AND current_preparation.notice_version = ?
              AND current_preparation.consent_purpose = ?
              AND current_preparation.question_answers = ?
          )
        )
    )`,
    bindings: [
      row.work_source_reference,
      ownerUid,
      row.matched_categories,
      row.source_reference,
      row.opportunity_title,
      row.summary,
      row.opportunity_priority,
      row.opportunity_postcode,
      row.state,
      row.public_contact_release_id,
      row.public_contact_updated_at,
      row.public_contact_disclosed_fields,
      row.public_customer_first_name,
      row.public_customer_last_name,
      row.public_customer_email,
      row.public_customer_phone,
      row.public_customer_unit_number,
      row.public_customer_street_address,
      row.public_customer_suburb,
      row.public_customer_address_state,
      row.public_customer_message,
      row.public_contact_notice_version,
      row.public_contact_consent_purpose,
      row.public_contact_granted_at,
      row.public_quote_preparation_id,
      PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
      row.public_quote_preparation_id,
      row.public_quote_preparation_version,
      row.public_quote_preparation_granted_at,
      row.public_quote_preparation_updated_at,
      PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
      row.public_quote_answers,
    ],
  };
}
