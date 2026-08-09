export const PUBLIC_PLAN_ENQUIRY_KIND = "home-plan-upgrade";

export const PUBLIC_PLAN_CONSENT_PURPOSE =
  "Contact me about my selected home energy upgrade";

export const PUBLIC_PLAN_CONSENT_NOTICE_VERSION = "2026-08-10";

export const PUBLIC_PLAN_UPGRADE_INTERESTS = Object.freeze([
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "draught-proofing",
  "insulation",
  "glazing",
  "window-coverings",
  "ev-charging",
  "other",
]);

const publicPlanUpgradeInterestSet = new Set(
  PUBLIC_PLAN_UPGRADE_INTERESTS,
);

export function isPublicPlanEnquiry(value) {
  return value === PUBLIC_PLAN_ENQUIRY_KIND;
}

export function isPublicPlanUpgradeInterest(value) {
  return publicPlanUpgradeInterestSet.has(value);
}
