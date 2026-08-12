import { publicTradeContactForMatchedLead } from "./public-trade-lead-access.mjs";

const PRIVATE_PROJECTION_KEYS = [
  "public_opportunity_source_reference",
  "opportunity_postcode",
  "opportunity_state",
  "public_contact_release_id",
  "public_contact_status",
  "public_contact_source_reference",
  "public_contact_withdrawn_at",
  "public_contact_disclosed_fields",
  "public_customer_first_name",
  "public_customer_last_name",
  "public_customer_email",
  "public_customer_phone",
  "public_customer_unit_number",
  "public_customer_street_address",
  "public_customer_suburb",
  "public_customer_address_state",
  "public_contact_postcode",
  "public_customer_message",
  "public_contact_notice_version",
  "public_contact_consent_purpose",
  "public_contact_granted_at",
];

function withoutPrivateProjectionFields(row) {
  const result = { ...row };
  for (const key of PRIVATE_PROJECTION_KEYS) delete result[key];
  return result;
}

export function projectPublicMarketplaceEnquiry(row) {
  if (!row || typeof row !== "object") return null;
  if (String(row.source_type || "") !== "tlink_marketplace") {
    return withoutPrivateProjectionFields(row);
  }
  const contact = publicTradeContactForMatchedLead({
    ...row,
    source_reference: row.public_opportunity_source_reference,
    state: row.opportunity_state,
  });
  if (!contact) return null;
  const description = [
    String(row.description || "").trim(),
    contact.message ? `Customer message: ${contact.message}` : "",
  ].filter(Boolean).join(" ");
  return withoutPrivateProjectionFields({
    ...row,
    first_name: contact.firstName,
    last_name: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    address_line_1: contact.addressLine1,
    address_line_2: contact.addressLine2,
    suburb: contact.suburb,
    address_state: contact.addressState,
    postcode: contact.postcode,
    description,
  });
}
