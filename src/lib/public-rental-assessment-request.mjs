export const PUBLIC_RENTAL_ASSESSMENT_REQUEST_KIND = "rental-assessment-request";
export const PUBLIC_RENTAL_ASSESSMENT_SOURCE_JOURNEY = "public-rental-assessment-request";
export const PUBLIC_RENTAL_ASSESSMENT_CONSENT_PURPOSE = "Request contact about the selected Victorian rental assessment and safety-check services";
export const PUBLIC_RENTAL_ASSESSMENT_CONSENT_NOTICE_VERSION = "tlink-rental-assessment-request-2026-08-24";

export const PUBLIC_RENTAL_ASSESSMENT_REQUESTER_ROLES = [
  "rental-provider",
  "agent-property-manager",
];

export const PUBLIC_RENTAL_ASSESSMENT_MODULES = [
  "minimum_standards",
  "electrical_safety_check",
  "gas_safety_check",
  "smoke_alarm_check",
];
export const PUBLIC_RENTAL_ASSESSMENT_DEFAULT_MODULES = ["minimum_standards"];
// Kept as a compatibility export for stored requests created before every scope
// became independently selectable.
export const PUBLIC_RENTAL_ASSESSMENT_OPTIONAL_MODULES = PUBLIC_RENTAL_ASSESSMENT_MODULES
  .filter((moduleKey) => moduleKey !== "minimum_standards");

const requesterRoles = new Set(PUBLIC_RENTAL_ASSESSMENT_REQUESTER_ROLES);
const modules = new Set(PUBLIC_RENTAL_ASSESSMENT_MODULES);

export function isPublicRentalAssessmentRequest(value) {
  return value === PUBLIC_RENTAL_ASSESSMENT_REQUEST_KIND;
}

export function isPublicRentalAssessmentSubmissionId(value) {
  return /^\d{8}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function isPublicRentalAssessmentRequesterRole(value) {
  return requesterRoles.has(value);
}

export function normalizePublicRentalAssessmentModules(value) {
  if (!Array.isArray(value) || value.length === 0
    || value.some((entry) => typeof entry !== "string" || !modules.has(entry))) {
    return null;
  }
  return PUBLIC_RENTAL_ASSESSMENT_MODULES.filter((moduleKey) => value.includes(moduleKey));
}

export function normalizePublicRentalAssessmentOptionalModules(value) {
  if (!Array.isArray(value)
    || value.some((entry) => typeof entry !== "string" || !PUBLIC_RENTAL_ASSESSMENT_OPTIONAL_MODULES.includes(entry))) {
    return null;
  }
  return PUBLIC_RENTAL_ASSESSMENT_OPTIONAL_MODULES.filter((moduleKey) => value.includes(moduleKey));
}
