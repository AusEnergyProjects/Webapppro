import { publicPlanContactReleaseDisclosedFieldsAreValid } from "./public-plan-enquiry.mjs";

function exactStoredDisclosedFields(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function publicTradeContactForMatchedLead(row) {
  if (!row?.public_contact_release_id) return null;
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

  const disclosed = new Set(disclosedFields);
  const email = String(row.public_customer_email || "").trim().toLowerCase();
  const postcode = String(row.public_contact_postcode || "").trim();
  const firstName = disclosed.has("customer_name")
    ? String(row.public_customer_first_name || "").trim()
    : "";
  const lastName = disclosed.has("customer_name")
    ? String(row.public_customer_last_name || "").trim()
    : "";
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const phone = disclosed.has("customer_phone")
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
    || (disclosed.has("customer_name") && (!firstName || !lastName))
    || (disclosed.has("customer_phone") && !phone)
    || (disclosed.has("customer_address") && (
      !addressLine1
      || !suburb
      || !addressState
      || addressState !== String(row.state || "").trim()
    ))
    || (disclosed.has("customer_message") && !message)
  ) return null;

  return {
    name,
    firstName,
    lastName,
    email,
    phone,
    addressLine1,
    addressLine2,
    suburb,
    addressState,
    postcode,
    grantedAt: row.public_contact_granted_at,
    noticeVersion: row.public_contact_notice_version,
    message,
    releaseScope: "all_qualified_trades",
  };
}
