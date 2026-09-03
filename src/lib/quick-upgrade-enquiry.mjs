export const QUICK_UPGRADE_ENQUIRY_KIND = "quick-upgrade-options";

export const QUICK_UPGRADE_SOURCE_JOURNEY = "quick-upgrade-options";

export const LEGACY_QUICK_UPGRADE_CONSENT_NOTICE_VERSION =
  "2026-09-03-quick-upgrade-options-v1";

export const LEGACY_QUICK_UPGRADE_CONSENT_PURPOSE =
  "I agree Australian Energy Assessments may share this request and the contact details shown above with every approved TLink trade matching my services and area.";

export const QUICK_UPGRADE_CONSENT_NOTICE_VERSION =
  "2026-09-04-quick-upgrade-options-v2";

export const QUICK_UPGRADE_CONSENT_PURPOSE =
  "I agree Australian Energy Assessments may keep my contact details and share this request, address and chosen contact details with matching TLink trades.";

export const QUICK_UPGRADE_SUBMISSION_ID_PATTERN =
  /^\d{8}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isQuickUpgradeEnquiry(value) {
  return value === QUICK_UPGRADE_ENQUIRY_KIND;
}

export function isQuickUpgradeSubmissionId(value) {
  return QUICK_UPGRADE_SUBMISSION_ID_PATTERN.test(String(value || ""));
}
