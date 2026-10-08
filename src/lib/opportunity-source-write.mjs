import { enquiryDeadlines } from "./enquiry-timing.mjs";
import { tradeOpportunityServiceScopeAllowed, tradeOpportunityServiceScopeSql } from "./aea-trade-routing.mjs";
import { isAllQualifiedTradeConsent } from "./public-plan-enquiry.mjs";
/** @param {import("./council-campaign-server.ts").CouncilReferral | null} councilAttribution */
export async function persistLeadOpportunity(
  database,
  record,
  contactRelease,
  currentConsent,
  councilAttribution = null,
) {
  const allQualifiedConsent = Boolean(contactRelease && isAllQualifiedTradeConsent(contactRelease.noticeVersion, contactRelease.consentPurpose));
  const tradeScopeAllowed = tradeOpportunityServiceScopeAllowed(record.serviceCategories, false, allQualifiedConsent);
  const initialStatus = record.publicPlanEnquiry || !tradeScopeAllowed ? "draft" : record.requestedStatus;
  const referralGuard = councilAttribution ? ` WHERE EXISTS (
    SELECT 1 FROM council_campaigns c JOIN council_organisations org ON org.id=c.council_id AND org.status='active'
    JOIN council_postcodes p ON p.council_id=c.council_id AND p.state=? AND p.postcode=?
    WHERE c.id=? AND c.council_id=? AND c.code=? AND c.status='active')` : "";
  const insert = database.prepare(`INSERT INTO trade_opportunities
    (id, title, project_type, postcode, state, service_categories, priority, timing, summary, status,
     source_reference, contact_limit, maximum_connected_installers, expires_at, expired_at,
     created_by_uid, created_at, updated_at, quote_window_value, quote_window_unit, requested_completion, requested_work_by, customer_sector)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'lead-intake', ?, ?, ?, ?, ?, ?, ? ${referralGuard}
    ON CONFLICT(source_reference) WHERE source_reference <> '' DO NOTHING`)
    .bind(
      record.id,
      record.title,
      record.projectType,
      record.postcode,
      record.state,
      record.serviceCategories,
      record.priority,
      record.timing,
      record.summary,
      initialStatus,
      record.sourceReference,
      record.contactLimit,
      record.maximumConnectedInstallers,
      record.expiresAt,
      record.createdAt,
      record.createdAt,
      record.quoteWindowValue ?? 30,
      record.quoteWindowUnit || "days",
      record.requestedCompletion || "flexible",
      record.requestedWorkBy || "",
      record.customerSector || "unclassified",
      ...(councilAttribution ? [record.state,record.postcode,councilAttribution.campaignId,councilAttribution.councilId,councilAttribution.code] : []),
    );
  if (councilAttribution) {
    await database.batch([insert, database.prepare(`INSERT INTO council_attributions
      (opportunity_id,campaign_id,council_id,attributed_at,source)
      SELECT o.id,c.id,c.council_id,?,'explicit_referral'
      FROM trade_opportunities o JOIN council_campaigns c ON c.id=? AND c.council_id=? AND c.code=? AND c.status='active'
      JOIN council_organisations org ON org.id=c.council_id AND org.status='active'
      JOIN council_postcodes p ON p.council_id=c.council_id AND p.state=o.state AND p.postcode=o.postcode
      WHERE o.id=? ON CONFLICT(opportunity_id) DO NOTHING`)
      .bind(record.createdAt,councilAttribution.campaignId,councilAttribution.councilId,councilAttribution.code,record.id)]);
  } else {
    await insert.run();
  }
  const canonical = await database.prepare(record.sourceReference
    ? `SELECT id, status, postcode, state, service_categories, created_at, quote_window_value, quote_window_unit, requested_completion, requested_work_by, customer_sector
      FROM trade_opportunities WHERE source_reference = ? LIMIT 1`
    : `SELECT id, status, postcode, state, service_categories, created_at, quote_window_value, quote_window_unit, requested_completion, requested_work_by, customer_sector
      FROM trade_opportunities WHERE id = ? LIMIT 1`)
    .bind(record.sourceReference || record.id)
    .first();
  if (!canonical) throw new Error(councilAttribution ? "COUNCIL_REFERENCE_INVALID" : "OPPORTUNITY_CANONICAL_RECORD_UNAVAILABLE");
  const canonicalCategories = (() => {
    try {
      const parsed = JSON.parse(String(canonical.service_categories || "[]"));
      return Array.isArray(parsed) ? [...new Set(parsed.map(String))].sort() : [];
    } catch {
      return [];
    }
  })();
  const requestedCategories = (() => {
    try {
      const parsed = JSON.parse(String(record.serviceCategories || "[]"));
      return Array.isArray(parsed) ? [...new Set(parsed.map(String))].sort() : [];
    } catch {
      return [];
    }
  })();
  if (
    Number(canonical.quote_window_value) !== (record.quoteWindowValue ?? 30)
    || String(canonical.quote_window_unit) !== (record.quoteWindowUnit || "days")
    || String(canonical.requested_completion) !== (record.requestedCompletion || "flexible")
    || String(canonical.customer_sector) !== (record.customerSector || "unclassified")
    || String(canonical.requested_work_by) !== (record.requestedCompletion ? enquiryDeadlines(record, String(canonical.created_at)).requestedWorkBy : "")
    || String(canonical.postcode) !== String(record.postcode)
    || String(canonical.state) !== String(record.state)
    || JSON.stringify(canonicalCategories) !== JSON.stringify(requestedCategories)
  ) throw new Error("OPPORTUNITY_SOURCE_REFERENCE_MISMATCH");
  const canonicalId = String(canonical.id);
  let contactIsCurrent = !record.publicPlanEnquiry;
  if (contactRelease) {
    const customerFirstName = String(contactRelease.customerFirstName).trim();
    const customerLastName = String(contactRelease.customerLastName).trim();
    const customerName = [customerFirstName, customerLastName].filter(Boolean).join(" ");
    await database.prepare(`INSERT INTO public_trade_lead_contact_releases
      (id, opportunity_id, source_reference, status, notice_version, consent_purpose,
       disclosed_fields, customer_name, customer_first_name, customer_last_name, customer_email, customer_phone, customer_unit_number,
       customer_street_address, customer_suburb, customer_address_state, postcode,
       customer_message, granted_at, withdrawn_at, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
      ON CONFLICT DO NOTHING`)
      .bind(
        contactRelease.id,
        canonicalId,
        record.sourceReference,
        contactRelease.noticeVersion,
        contactRelease.consentPurpose,
        JSON.stringify(contactRelease.disclosedFields),
        customerName,
        customerFirstName,
        customerLastName,
        contactRelease.customerEmail,
        contactRelease.customerPhone,
        contactRelease.customerUnitNumber,
        contactRelease.customerStreetAddress,
        contactRelease.customerSuburb,
        contactRelease.customerAddressState,
        record.postcode,
        contactRelease.customerMessage,
        contactRelease.grantedAt,
        record.createdAt,
        record.createdAt,
      )
      .run();
    const storedRelease = await database.prepare(`SELECT status, notice_version, consent_purpose,
        disclosed_fields, customer_name, customer_first_name, customer_last_name, customer_email, customer_phone, customer_unit_number,
        customer_street_address, customer_suburb, customer_address_state, postcode,
        customer_message, granted_at, withdrawn_at
      FROM public_trade_lead_contact_releases
      WHERE opportunity_id = ? AND source_reference = ? LIMIT 1`)
      .bind(canonicalId, record.sourceReference)
      .first();
    const storedFields = (() => {
      try {
        const parsed = JSON.parse(String(storedRelease?.disclosed_fields || "[]"));
        return Array.isArray(parsed) ? [...new Set(parsed.map(String))].sort() : [];
      } catch {
        return [];
      }
    })();
    const requestedFields = [...new Set(contactRelease.disclosedFields.map(String))].sort();
    if (
      !storedRelease
      || String(storedRelease.customer_name) !== customerName
      || String(storedRelease.customer_first_name) !== customerFirstName
      || String(storedRelease.customer_last_name) !== customerLastName
      || String(storedRelease.customer_email) !== contactRelease.customerEmail
      || String(storedRelease.customer_phone) !== contactRelease.customerPhone
      || String(storedRelease.customer_unit_number) !== contactRelease.customerUnitNumber
      || String(storedRelease.customer_street_address) !== contactRelease.customerStreetAddress
      || String(storedRelease.customer_suburb) !== contactRelease.customerSuburb
      || String(storedRelease.customer_address_state) !== contactRelease.customerAddressState
      || String(storedRelease.postcode) !== String(record.postcode)
      || String(storedRelease.customer_message) !== contactRelease.customerMessage
      || String(storedRelease.notice_version) !== contactRelease.noticeVersion
      || String(storedRelease.consent_purpose) !== contactRelease.consentPurpose
      || String(storedRelease.granted_at) !== contactRelease.grantedAt
      || JSON.stringify(storedFields) !== JSON.stringify(requestedFields)
    ) throw new Error("OPPORTUNITY_SOURCE_REFERENCE_MISMATCH");
    contactIsCurrent = Boolean(
      storedRelease
      && storedRelease.status === "active"
      && storedRelease.notice_version === currentConsent.noticeVersion
      && storedRelease.consent_purpose === currentConsent.purpose
      && Number.isFinite(Date.parse(String(storedRelease.granted_at || "")))
      && !String(storedRelease.withdrawn_at || ""),
    );
  }
  if (
    record.requestedStatus === "open"
    && tradeScopeAllowed
    && tradeOpportunityServiceScopeAllowed(canonical.service_categories, false, allQualifiedConsent)
    && contactIsCurrent
    && canonical.status === "draft"
  ) {
    const updatedAt = new Date().toISOString();
    await database.prepare(`UPDATE trade_opportunities
      SET status = 'open', updated_at = ?
      WHERE id = ? AND status = 'draft'
        AND ${tradeOpportunityServiceScopeSql("trade_opportunities")}`)
      .bind(updatedAt, canonicalId)
      .run();
  }
  const storedOpportunity = await database.prepare(
    "SELECT id, status FROM trade_opportunities WHERE id = ? LIMIT 1",
  ).bind(canonicalId).first();
  if (!storedOpportunity) throw new Error("OPPORTUNITY_CANONICAL_RECORD_UNAVAILABLE");
  return {
    id: canonicalId,
    status: String(storedOpportunity.status),
    contactIsCurrent,
  };
}
