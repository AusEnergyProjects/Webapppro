export const PUBLIC_RENTAL_ASSESSMENT_REQUEST_KIND = "rental-assessment-request";
export const PUBLIC_RENTAL_ASSESSMENT_SOURCE_JOURNEY = "public-rental-assessment-request";
export const PUBLIC_RENTAL_ASSESSMENT_CONSENT_PURPOSE = "Request contact about a Victorian rental minimum standards assessment and its selected optional checks";
export const PUBLIC_RENTAL_ASSESSMENT_CONSENT_NOTICE_VERSION = "tlink-rental-assessment-request-2026-08-24";

export const PUBLIC_RENTAL_ASSESSMENT_REQUESTER_ROLES = [
  "rental-provider",
  "agent-property-manager",
];

export const PUBLIC_RENTAL_ASSESSMENT_OPTIONAL_MODULES = [
  "electrical_safety_check",
  "gas_safety_check",
  "smoke_alarm_check",
];

const requesterRoles = new Set(PUBLIC_RENTAL_ASSESSMENT_REQUESTER_ROLES);
const optionalModules = new Set(PUBLIC_RENTAL_ASSESSMENT_OPTIONAL_MODULES);

export function isPublicRentalAssessmentRequest(value) {
  return value === PUBLIC_RENTAL_ASSESSMENT_REQUEST_KIND;
}

export function isPublicRentalAssessmentSubmissionId(value) {
  return /^\d{8}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function isPublicRentalAssessmentRequesterRole(value) {
  return requesterRoles.has(value);
}

export function normalizePublicRentalAssessmentOptionalModules(value) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !optionalModules.has(entry))) {
    return null;
  }
  return PUBLIC_RENTAL_ASSESSMENT_OPTIONAL_MODULES.filter((moduleKey) => value.includes(moduleKey));
}
