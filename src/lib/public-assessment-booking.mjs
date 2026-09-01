export const PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND = "assessment-booking-request";
export const PUBLIC_ASSESSMENT_BOOKING_SOURCE_JOURNEY = "public-assessment-booking-request";
export const PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE = "Use my details to review this assessment booking request and contact me about scope, price, access and appointment options.";
export const PUBLIC_ASSESSMENT_BOOKING_CONSENT_NOTICE_VERSION = "public-assessment-booking-2026-09-01";

export const PUBLIC_ASSESSMENT_BOOKING_PATHWAYS = Object.freeze([
  "new-home-nathers",
  "existing-home-rating",
  "basix-nsw",
  "unsure",
]);

export const PUBLIC_ASSESSMENT_BOOKING_STAGES = Object.freeze([
  "early-planning",
  "plans-ready",
  "approval-in-progress",
  "home-already-built",
  "unsure",
]);

export const PUBLIC_ASSESSMENT_BOOKING_CONTACT_METHODS = Object.freeze([
  "email",
  "phone",
  "either",
]);

const pathwaySet = new Set(PUBLIC_ASSESSMENT_BOOKING_PATHWAYS);
const stageSet = new Set(PUBLIC_ASSESSMENT_BOOKING_STAGES);
const contactMethodSet = new Set(PUBLIC_ASSESSMENT_BOOKING_CONTACT_METHODS);

export function isPublicAssessmentBookingRequest(value) {
  return value === PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND;
}

export function isPublicAssessmentBookingPathway(value) {
  return typeof value === "string" && pathwaySet.has(value);
}

export function isPublicAssessmentBookingStage(value) {
  return typeof value === "string" && stageSet.has(value);
}

export function isPublicAssessmentBookingContactMethod(value) {
  return typeof value === "string" && contactMethodSet.has(value);
}

export function isPublicAssessmentBookingSubmissionId(value) {
  return /^\d{8}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
