export type AdminRetainedContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  unitNumber: string;
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
  grantedAt: string;
};

export type AdminSubmittedEnquiry = {
  id: string;
  title: string;
  serviceCategories: string[];
  createdAt: string;
  status: string;
  sourceReference: string;
  customerMessage: string;
  consent: { noticeVersion: string; purpose: string; grantedAt: string; disclosedFields: string[] };
};

export type AdminSubmittedEnquiryResult = {
  ok: true;
  retainedContact: AdminRetainedContact;
  submittedEnquiry: AdminSubmittedEnquiry;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// This payload is private and belongs only to the explicitly opened enquiry.
export function isAdminSubmittedEnquiryResult(value: unknown, opportunityId: string): value is AdminSubmittedEnquiryResult {
  if (!record(value) || value.ok !== true || !record(value.retainedContact) || !record(value.submittedEnquiry)) return false;
  const contact = value.retainedContact;
  const enquiry = value.submittedEnquiry;
  const consent = enquiry.consent;
  return enquiry.id === opportunityId && record(consent)
    && ["firstName", "lastName", "email", "phone", "unitNumber", "streetAddress", "suburb", "state", "postcode", "grantedAt"].every((key) => typeof contact[key] === "string")
    && ["title", "createdAt", "status", "sourceReference", "customerMessage"].every((key) => typeof enquiry[key] === "string")
    && strings(enquiry.serviceCategories) && strings(consent.disclosedFields)
    && ["noticeVersion", "purpose", "grantedAt"].every((key) => typeof consent[key] === "string");
}
