import {
  CUSTOMER_CONTACT_RELEASE_FIELDS,
  CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION,
} from "./customer-projects.mjs";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function exactStoredFields(value, expected) {
  if (typeof value !== "string") return false;
  try {
    const fields = JSON.parse(value);
    return Array.isArray(fields)
      && fields.length === expected.length
      && new Set(fields).size === expected.length
      && fields.every((field, index) => typeof field === "string" && field === expected[index]);
  } catch {
    return false;
  }
}

export function customerProjectContextMatchesBase(base, project) {
  const projectId = text(base?.customer_project_id);
  if (!projectId) return !project;
  return Boolean(
    project
      && text(project.project_match_id) === text(base.match_id)
      && text(project.customer_project_id) === projectId
      && text(project.customer_uid) === text(base.customer_uid),
  );
}

export function platformQuoteForMatchedLead(base, project, quote) {
  if (!quote || !project) return null;
  if (
    text(quote.quote_match_id) !== text(base?.match_id)
    || text(quote.quote_project_id) !== text(project.customer_project_id)
    || text(quote.quote_opportunity_id) !== text(base?.id)
    || text(quote.quote_opportunity_match_id) !== text(base?.match_id)
    || text(quote.quote_installer_uid) !== text(base?.installer_uid)
  ) return null;
  return quote;
}

export function customerProjectContactForMatchedLead(base, project, quote, release) {
  if (!release?.contact_release_id || !project || !quote) return null;
  const grantedAt = text(release.contact_granted_at);
  const requiredText = [
    release.customer_name,
    release.customer_email,
    release.customer_phone,
    release.contact_address_line_1,
    release.contact_suburb,
    release.contact_address_state,
    release.contact_postcode,
  ];
  if (
    text(release.contact_match_id) !== text(base?.match_id)
    || text(release.contact_project_id) !== text(project.customer_project_id)
    || text(release.contact_opportunity_id) !== text(base?.id)
    || text(release.contact_opportunity_match_id) !== text(base?.match_id)
    || text(release.contact_quote_id) !== text(quote.quote_id)
    || text(release.contact_customer_uid) !== text(project.customer_uid)
    || text(release.contact_installer_uid) !== text(base?.installer_uid)
    || text(release.contact_release_status) !== "active"
    || text(release.contact_withdrawn_at)
    || text(release.contact_notice_version) !== CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION
    || !exactStoredFields(release.contact_disclosed_fields, CUSTOMER_CONTACT_RELEASE_FIELDS)
    || !grantedAt
    || Number.isNaN(Date.parse(grantedAt))
    || requiredText.some((value) => !text(value))
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(release.customer_email))
    || !/^\d{4}$/.test(text(release.contact_postcode))
    || text(release.contact_postcode) !== text(project.customer_postcode)
    || text(release.contact_postcode) !== text(base?.opportunity_postcode)
    || text(release.contact_address_state) !== text(project.customer_address_state)
    || text(release.contact_address_state) !== text(base?.state)
  ) return null;
  return {
    name: text(release.customer_name),
    email: text(release.customer_email),
    phone: text(release.customer_phone),
    addressLine1: text(release.contact_address_line_1),
    addressLine2: text(release.contact_address_line_2),
    suburb: text(release.contact_suburb),
    addressState: text(release.contact_address_state),
    postcode: text(release.contact_postcode),
    grantedAt,
    noticeVersion: text(release.contact_notice_version),
    message: "",
    releaseScope: "shortlisted_installer",
  };
}

export function arrivalProposalForMatchedLead(base, project, quote, arrival) {
  if (!arrival?.arrival_proposal_id || !project || !quote) return null;
  if (
    text(arrival.arrival_match_id) !== text(base?.match_id)
    || text(arrival.arrival_project_id) !== text(project.customer_project_id)
    || text(arrival.arrival_quote_id) !== text(quote.quote_id)
    || text(arrival.arrival_opportunity_match_id) !== text(base?.match_id)
    || text(arrival.arrival_customer_uid) !== text(project.customer_uid)
    || text(arrival.arrival_installer_uid) !== text(base?.installer_uid)
    || !["proposed", "selected", "direct_contact"].includes(text(arrival.arrival_status))
    || text(arrival.arrival_withdrawn_at)
  ) return null;
  return arrival;
}
