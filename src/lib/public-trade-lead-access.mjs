import { tradeOpportunityServiceScopeAllowed } from "./aea-trade-routing.mjs";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  publicPlanContactReleaseDisclosedFieldsAreValid,
} from "./public-plan-enquiry.mjs";
import {
  AEA_SERVICE_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  AEA_SERVICE_QUICK_UPGRADE_CONSENT_PURPOSE,
  QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  QUICK_UPGRADE_CONSENT_PURPOSE,
} from "./quick-upgrade-enquiry.mjs";

function exactStoredDisclosedFields(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function aeaServiceContactConsentAllows(row, allowAeaDelivery = false) {
  return allowAeaDelivery === true
    && tradeOpportunityServiceScopeAllowed(row.opportunity_service_categories, true)
    && !tradeOpportunityServiceScopeAllowed(row.opportunity_service_categories)
    && (
      (row.public_contact_notice_version === QUICK_UPGRADE_CONSENT_NOTICE_VERSION
        && row.public_contact_consent_purpose === QUICK_UPGRADE_CONSENT_PURPOSE)
      || (row.public_contact_notice_version === AEA_SERVICE_QUICK_UPGRADE_CONSENT_NOTICE_VERSION
        && row.public_contact_consent_purpose === AEA_SERVICE_QUICK_UPGRADE_CONSENT_PURPOSE)
      || (row.public_contact_notice_version === PUBLIC_PLAN_CONSENT_NOTICE_VERSION
        && row.public_contact_consent_purpose === PUBLIC_PLAN_CONSENT_PURPOSE)
    );
}

export function publicTradeContactForMatchedLead(row, allowAeaDelivery = false) {
  if (!row?.public_contact_release_id
    || !tradeOpportunityServiceScopeAllowed(row.opportunity_service_categories, allowAeaDelivery)) return null;
  const disclosedFields = exactStoredDisclosedFields(
    row.public_contact_disclosed_fields,
  );
  if (
    !disclosedFields
    || String(row.public_contact_status || "") !== "active"
    || String(row.public_contact_source_reference || "")
      !== String(row.source_reference || "")
    || String(row.public_contact_withdrawn_at || "") !== ""
    || String(row.public_contact_postcode || "")
      !== String(row.opportunity_postcode || "")
    || !Number.isFinite(Date.parse(String(row.public_contact_granted_at || "")))
    || !publicPlanContactReleaseDisclosedFieldsAreValid(
      row.public_contact_notice_version,
      row.public_contact_consent_purpose,
      disclosedFields,
    )
  ) return null;

  // These notices authorise AEA to handle its own services. The saved sharing
  // choices still govern disclosure to other businesses, including older notices.
  const aeaHandledContact = aeaServiceContactConsentAllows(row, allowAeaDelivery);
  const disclosed = new Set(disclosedFields);
  const email = disclosed.has("customer_email") || aeaHandledContact
    ? String(row.public_customer_email || "").trim().toLowerCase()
    : "";
  const postcode = String(row.public_contact_postcode || "").trim();
  const firstName = disclosed.has("customer_name") || aeaHandledContact
    ? String(row.public_customer_first_name || "").trim()
    : "";
  const lastName = disclosed.has("customer_name") || aeaHandledContact
    ? String(row.public_customer_last_name || "").trim()
    : "";
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const phone = disclosed.has("customer_phone") || aeaHandledContact
    ? String(row.public_customer_phone || "").trim()
    : "";
  const addressLine1 = disclosed.has("customer_address")
    ? String(row.public_customer_street_address || "").trim()
    : "";
  const addressLine2 = disclosed.has("customer_address")
    ? String(row.public_customer_unit_number || "").trim()
    : "";
  const suburb = disclosed.has("customer_address")
    ? String(row.public_customer_suburb || "").trim()
    : "";
  const addressState = disclosed.has("customer_address")
    ? String(row.public_customer_address_state || "").trim()
    : "";
  const message = disclosed.has("customer_message")
    ? String(row.public_customer_message || "").trim()
    : "";
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !/^\d{4}$/.test(postcode)
    || ((disclosed.has("customer_name") || aeaHandledContact) && (!firstName || !lastName))
    || ((disclosed.has("customer_phone") || aeaHandledContact) && !phone)
    || (disclosed.has("customer_address") && (
      !addressLine1
      || !suburb
      || !addressState
      || addressState !== String(row.state || "").trim()
    ))
    || (disclosed.has("customer_message") && !message)
  ) return null;

  /** @type {Array<"name" | "phone">} */
  const redactedFields = [];
  if (!aeaHandledContact) {
    if (!disclosed.has("customer_name")) redactedFields.push("name");
    if (!disclosed.has("customer_phone")) redactedFields.push("phone");
  }

  return {
    name,
    firstName,
    lastName,
    email,
    phone,
    redactedFields,
    ...(aeaHandledContact ? { accessBasis: "aea_service_handling" } : {}),
    addressLine1,
    addressLine2,
    suburb,
    addressState,
    postcode,
    grantedAt: row.public_contact_granted_at,
    noticeVersion: row.public_contact_notice_version,
    message,
    releaseScope: tradeOpportunityServiceScopeAllowed(row.opportunity_service_categories)
      ? "all_qualified_trades" : "aea_only",
  };
}
