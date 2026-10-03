import { canonicalAustralianState } from "./australian-postcodes.mjs";
import {
  MAX_HOME_FEATURE_SELECTIONS,
  customerProjectOptions,
  normalizeHomeFeatureSelections,
} from "./customer-projects.mjs";
import { ENERGY_SERVICE_IDS } from "./energy-service-catalogue.mjs";
import {
  AEA_SERVICE_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  AEA_SERVICE_QUICK_UPGRADE_CONSENT_PURPOSE,
  AEA_RESTRICTED_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  AEA_RESTRICTED_QUICK_UPGRADE_CONSENT_PURPOSE,
  LEGACY_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  LEGACY_QUICK_UPGRADE_CONSENT_PURPOSE,
  PREVIOUS_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  PREVIOUS_QUICK_UPGRADE_CONSENT_PURPOSE,
  QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  QUICK_UPGRADE_CONSENT_PURPOSE,
} from "./quick-upgrade-enquiry.mjs";

export const PUBLIC_PLAN_ENQUIRY_KIND = "home-plan-upgrade";

export const PUBLIC_PLAN_CONSENT_PURPOSE =
  "Email my private plan and share my enquiry and selected quote details with all approved TLink businesses matching at least one selected service and my area.";

export const PUBLIC_PLAN_CONSENT_NOTICE_VERSION =
  "2026-10-04-all-qualified-service-area-sharing-v10";

export const AEA_RESTRICTED_PUBLIC_PLAN_CONSENT_NOTICE_VERSION =
  "2026-09-14-aea-services-and-upgrade-sharing-v9";
export const AEA_RESTRICTED_PUBLIC_PLAN_CONSENT_PURPOSE =
  "Email my private plan. Australian Energy Assessments handles safety and assessments. Other requests and selected quote details go to approved matching trades.";

const PREVIOUS_PUBLIC_PLAN_CONSENT_NOTICE_VERSION =
  "2026-08-21-quote-preparation-sharing-notice-v8";
const PREVIOUS_PUBLIC_PLAN_CONSENT_PURPOSE =
  "Email my private plan and share my email, postcode, services, message, quote answers and selected photos with approved trades matched to my area";

const LEGACY_PUBLIC_PLAN_CONSENT_NOTICE_VERSION =
  "2026-08-11-quote-preparation-sharing-notice-v7";

const LEGACY_PUBLIC_PLAN_CONSENT_PURPOSE =
  "Email my private plan and share my email, postcode, services, message, quote answers and selected photos with approved matched TLink trades";

export const ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION =
  "2026-10-04-energy-assistant-all-qualified-v2";
export const ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE =
  "Share this quote brief and selected contact details with all approved TLink businesses matching at least one selected service and my area";

export const LEGACY_ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION =
  "2026-08-20-energy-assistant-trade-sharing-v1";

export const LEGACY_ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE =
  "Share this quote brief and selected contact details with approved matched TLink trades";

const publicPlanContactReleaseRequiredFields = Object.freeze([
  "customer_email",
  "postcode",
  "service_categories",
]);

const quickUpgradeContactReleaseRequiredFields = Object.freeze([
  "postcode",
  "service_categories",
  "customer_address",
]);

const publicPlanContactReleasePolicies = Object.freeze([
  Object.freeze({
    noticeVersion: LEGACY_ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
    purpose: LEGACY_ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
    requiredDisclosedFields: Object.freeze([...publicPlanContactReleaseRequiredFields, "state", "quote_brief", "customer_name"]),
    allowedDisclosedFields: Object.freeze([...publicPlanContactReleaseRequiredFields, "state", "quote_brief", "customer_name", "customer_phone"]),
  }),
  Object.freeze({
    noticeVersion: AEA_RESTRICTED_PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    purpose: AEA_RESTRICTED_PUBLIC_PLAN_CONSENT_PURPOSE,
    requiredDisclosedFields: publicPlanContactReleaseRequiredFields,
    allowedDisclosedFields: Object.freeze([...publicPlanContactReleaseRequiredFields, "customer_name", "customer_phone", "customer_address", "customer_message"]),
  }),
  Object.freeze({
    noticeVersion: AEA_RESTRICTED_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    purpose: AEA_RESTRICTED_QUICK_UPGRADE_CONSENT_PURPOSE,
    requiredDisclosedFields: Object.freeze([...quickUpgradeContactReleaseRequiredFields, "customer_email"]),
    allowedDisclosedFields: Object.freeze([...quickUpgradeContactReleaseRequiredFields, "customer_email", "customer_name", "customer_phone", "customer_message"]),
  }),
  Object.freeze({
    noticeVersion: PREVIOUS_PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    purpose: PREVIOUS_PUBLIC_PLAN_CONSENT_PURPOSE,
    requiredDisclosedFields: publicPlanContactReleaseRequiredFields,
    allowedDisclosedFields: Object.freeze([...publicPlanContactReleaseRequiredFields, "customer_name", "customer_phone", "customer_address", "customer_message"]),
  }),
  Object.freeze({
    noticeVersion: PREVIOUS_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    purpose: PREVIOUS_QUICK_UPGRADE_CONSENT_PURPOSE,
    requiredDisclosedFields: quickUpgradeContactReleaseRequiredFields,
    allowedDisclosedFields: Object.freeze([...quickUpgradeContactReleaseRequiredFields, "customer_email", "customer_name", "customer_phone", "customer_message"]),
  }),
  Object.freeze({
    noticeVersion: QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    purpose: QUICK_UPGRADE_CONSENT_PURPOSE,
    requiredDisclosedFields: Object.freeze([...quickUpgradeContactReleaseRequiredFields, "customer_email"]),
    allowedDisclosedFields: Object.freeze([
      ...quickUpgradeContactReleaseRequiredFields,
      "customer_email",
      "customer_name",
      "customer_phone",
      "customer_message",
    ]),
  }),
  Object.freeze({
    noticeVersion: AEA_SERVICE_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    purpose: AEA_SERVICE_QUICK_UPGRADE_CONSENT_PURPOSE,
    requiredDisclosedFields: quickUpgradeContactReleaseRequiredFields,
    allowedDisclosedFields: Object.freeze([
      ...quickUpgradeContactReleaseRequiredFields,
      "customer_email",
      "customer_name",
      "customer_phone",
      "customer_message",
    ]),
  }),
  Object.freeze({
    noticeVersion: LEGACY_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    purpose: LEGACY_QUICK_UPGRADE_CONSENT_PURPOSE,
    requiredDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "customer_address",
    ]),
    allowedDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "customer_address",
      "customer_name",
      "customer_phone",
      "customer_message",
    ]),
  }),
  Object.freeze({
    noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    requiredDisclosedFields: publicPlanContactReleaseRequiredFields,
    allowedDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "customer_name",
      "customer_phone",
      "customer_address",
      "customer_message",
    ]),
  }),
  Object.freeze({
    noticeVersion: LEGACY_PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    purpose: LEGACY_PUBLIC_PLAN_CONSENT_PURPOSE,
    requiredDisclosedFields: publicPlanContactReleaseRequiredFields,
    allowedDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "customer_name",
      "customer_phone",
      "customer_address",
      "customer_message",
    ]),
  }),
  Object.freeze({
    noticeVersion: "2026-08-10-structured-service-address-sharing-v6",
    purpose:
      "Share my email, postcode, services and message with all approved TLink trades in my area, plus name, phone or full service address, and email my private plan",
    requiredDisclosedFields: publicPlanContactReleaseRequiredFields,
    allowedDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "customer_name",
      "customer_phone",
      "customer_address",
      "customer_message",
    ]),
  }),
  Object.freeze({
    noticeVersion: "2026-08-10-customer-selected-trade-sharing-v4",
    purpose:
      "Share my email, postcode, service and any message I write with all approved TLink trades in my area, plus chosen name or phone, and email my private plan",
    requiredDisclosedFields: publicPlanContactReleaseRequiredFields,
    allowedDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "customer_name",
      "customer_phone",
      "customer_message",
    ]),
  }),
  Object.freeze({
    noticeVersion: ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
    purpose: ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
    requiredDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "state",
      "quote_brief",
      "customer_name",
    ]),
    allowedDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "state",
      "quote_brief",
      "customer_name",
      "customer_phone",
    ]),
  }),
]);

function publicPlanContactReleasePolicy(noticeVersion, purpose) {
  return publicPlanContactReleasePolicies.find((policy) =>
    policy.noticeVersion === noticeVersion && policy.purpose === purpose
  ) || null;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function publicPlanContactReleaseAlias(value) {
  const alias = String(value || "");
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error("PUBLIC_PLAN_CONTACT_RELEASE_ALIAS_INVALID");
  }
  return alias;
}

export function isRecognizedPublicPlanContactReleaseConsent(
  noticeVersion,
  purpose,
) {
  return Boolean(publicPlanContactReleasePolicy(noticeVersion, purpose));
}

// New receipts explicitly include assessment and safety services. Earlier notices
// remain recognized for their original disclosure scope, never widened in place.
export function isAllQualifiedTradeConsent(noticeVersion, purpose) {
  return (noticeVersion === QUICK_UPGRADE_CONSENT_NOTICE_VERSION && purpose === QUICK_UPGRADE_CONSENT_PURPOSE)
    || (noticeVersion === PUBLIC_PLAN_CONSENT_NOTICE_VERSION && purpose === PUBLIC_PLAN_CONSENT_PURPOSE)
    || (noticeVersion === ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION && purpose === ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE);
}

export function allQualifiedTradeOpportunitySql(opportunityAlias) {
  const opportunity = publicPlanContactReleaseAlias(opportunityAlias);
  return `EXISTS (SELECT 1 FROM public_trade_lead_contact_releases all_trade_contact
    WHERE (all_trade_contact.opportunity_id, all_trade_contact.source_reference,
      all_trade_contact.postcode, all_trade_contact.status, all_trade_contact.withdrawn_at) =
      (${opportunity}.id, ${opportunity}.source_reference, ${opportunity}.postcode, 'active', '')
      AND datetime(all_trade_contact.granted_at) IS NOT NULL
      AND ${contactReleaseAccessSql('all_trade_contact', publicPlanContactReleasePolicies.filter(policy =>
        isAllQualifiedTradeConsent(policy.noticeVersion, policy.purpose)))})`;
}

export function publicPlanContactReleaseConsentSql(releaseAlias) {
  const alias = publicPlanContactReleaseAlias(releaseAlias);
  return `CASE ${alias}.notice_version ${publicPlanContactReleasePolicies.map((policy) =>
      `WHEN ${sqlLiteral(policy.noticeVersion)} THEN ${sqlLiteral(policy.purpose)}`
    ).join(" ")} ELSE NULL END = ${alias}.consent_purpose`;
}

export function publicPlanContactReleaseDisclosedFieldsAreValid(
  noticeVersion,
  purpose,
  disclosedFields,
) {
  const policy = publicPlanContactReleasePolicy(noticeVersion, purpose);
  if (!policy || !Array.isArray(disclosedFields)) return false;
  const uniqueFields = new Set(disclosedFields);
  const allowedFields = new Set(policy.allowedDisclosedFields);
  return uniqueFields.size === disclosedFields.length
    && disclosedFields.every((field) => typeof field === "string" && allowedFields.has(field))
    && policy.requiredDisclosedFields.every((field) => uniqueFields.has(field));
}

export function publicPlanContactReleaseAccessSql(releaseAlias) {
  return contactReleaseAccessSql(releaseAlias, publicPlanContactReleasePolicies);
}

function contactReleaseAccessSql(releaseAlias, policies) {
  const alias = publicPlanContactReleaseAlias(releaseAlias);
  // Select one exact policy row instead of nesting one expression per historical
  // version. Allocation and notification guards must fit D1's expression depth.
  const policyRows = sqlLiteral(JSON.stringify(policies));
  // CASE guards every JSON read once. Repeating a nested sanitising CASE in
  // each subquery unnecessarily consumes D1's expression-depth allowance.
  return `(CASE WHEN json_valid(${alias}.disclosed_fields) THEN (
    (json_type(${alias}.disclosed_fields), trim(${alias}.customer_email) <> '',
      length(${alias}.postcode), ${alias}.postcode NOT GLOB '*[^0-9]*') = ('array', 1, 4, 1)
    AND EXISTS (SELECT 1 FROM json_each(${policyRows}) consent_policy
      WHERE (${alias}.notice_version, ${alias}.consent_purpose) =
        (json_extract(consent_policy.value, '$.noticeVersion'), json_extract(consent_policy.value, '$.purpose'))
        AND NOT EXISTS (SELECT 1 FROM json_each(${alias}.disclosed_fields) disclosed_policy_field
          WHERE typeof(disclosed_policy_field.value) <> 'text' OR NOT EXISTS (
            SELECT 1 FROM json_each(json_extract(consent_policy.value, '$.allowedDisclosedFields')) allowed_field
            WHERE allowed_field.value = disclosed_policy_field.value))
        AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(consent_policy.value, '$.requiredDisclosedFields')) required_field
          WHERE NOT EXISTS (SELECT 1 FROM json_each(${alias}.disclosed_fields) disclosed_required_field
            WHERE disclosed_required_field.value = required_field.value)))
    AND (
      SELECT COUNT(*) FROM json_each(${alias}.disclosed_fields) disclosed_field_count
    ) = (
      SELECT COUNT(DISTINCT disclosed_unique_field.value)
      FROM json_each(${alias}.disclosed_fields) disclosed_unique_field
    )
  ) ELSE 0 END)`;
}

export const PUBLIC_PLAN_SNAPSHOT_VERSION =
  "2026-08-10-complete-home-context-snapshot-v2";

export const PUBLIC_PLAN_SUBMISSION_ID_PATTERN =
  /^\d{8}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PUBLIC_PLAN_UPGRADE_INTERESTS = ENERGY_SERVICE_IDS;

const publicPlanUpgradeInterestSet = new Set(
  PUBLIC_PLAN_UPGRADE_INTERESTS,
);

export function isPublicPlanEnquiry(value) {
  return value === PUBLIC_PLAN_ENQUIRY_KIND;
}

export function isPublicPlanUpgradeInterest(value) {
  return publicPlanUpgradeInterestSet.has(value);
}

export function isPublicPlanSubmissionId(value) {
  return PUBLIC_PLAN_SUBMISSION_ID_PATTERN.test(String(value || ""));
}

function cleanText(value, maximum = 80) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : "";
}

function optionValue(value, options, fallback = "") {
  const supplied = cleanText(value);
  return options.some(([candidate]) => candidate === supplied)
    ? supplied
    : fallback;
}

function optionValues(value, options, maximum) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(options.map(([candidate]) => candidate));
  return [...new Set(
    value
      .map((item) => cleanText(item))
      .filter((item) => allowed.has(item)),
  )].slice(0, maximum);
}

function propertyContextValue(value, optionKey) {
  const options = customerProjectOptions[optionKey];
  return Array.isArray(options) ? optionValue(value, options) : "";
}

export function normalizePublicPlanSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Return to your plan and try the enquiry again." };
  }
  const allowedKeys = new Set([
    "version",
    "goals",
    "pace",
    "situation",
    "approvalContext",
    "budgetRange",
    "addressState",
    "features",
    "propertyContext",
  ]);
  if (Object.keys(raw).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "The home plan contained an unsupported field." };
  }
  const goals = optionValues(raw.goals, customerProjectOptions.goals, 10);
  if (!goals.length) {
    return { ok: false, error: "Choose at least one home energy priority before enquiring." };
  }
  const sourceContext = raw.propertyContext
    && typeof raw.propertyContext === "object"
    && !Array.isArray(raw.propertyContext)
    ? raw.propertyContext
    : {};
  const allowedContextKeys = new Set([
    "propertyType",
    "storeys",
    "ageBand",
    "floorArea",
    "occupants",
    "sharedWalls",
    "roofType",
    "roofColour",
    "roofForm",
    "roofCondition",
    "switchboard",
    "wallConstruction",
    "floorConstruction",
  ]);
  if (Object.keys(sourceContext).some((key) => !allowedContextKeys.has(key))) {
    return { ok: false, error: "The home summary contained an unsupported field." };
  }
  const propertyContext = {
    propertyType: propertyContextValue(
      sourceContext.propertyType,
      "propertyTypes",
    ),
    storeys: propertyContextValue(sourceContext.storeys, "storeys"),
    ageBand: propertyContextValue(sourceContext.ageBand, "ageBands"),
    floorArea: propertyContextValue(sourceContext.floorArea, "floorAreas"),
    occupants: propertyContextValue(sourceContext.occupants, "occupants"),
    sharedWalls: propertyContextValue(
      sourceContext.sharedWalls,
      "sharedWalls",
    ),
    roofType: propertyContextValue(sourceContext.roofType, "roofTypes"),
    roofColour: propertyContextValue(sourceContext.roofColour, "roofColours"),
    roofForm: propertyContextValue(sourceContext.roofForm, "roofForms"),
    roofCondition: propertyContextValue(
      sourceContext.roofCondition,
      "roofConditions",
    ),
    switchboard: propertyContextValue(
      sourceContext.switchboard,
      "switchboards",
    ),
    wallConstruction: propertyContextValue(
      sourceContext.wallConstruction,
      "wallConstructions",
    ),
    floorConstruction: propertyContextValue(
      sourceContext.floorConstruction,
      "floorConstructions",
    ),
  };
  for (const key of Object.keys(propertyContext)) {
    if (!propertyContext[key]) delete propertyContext[key];
  }
  return {
    ok: true,
    value: {
      version: PUBLIC_PLAN_SNAPSHOT_VERSION,
      goals,
      pace: optionValue(raw.pace, customerProjectOptions.paces, "staged"),
      situation: optionValue(raw.situation, customerProjectOptions.situations),
      approvalContext: optionValue(
        raw.approvalContext,
        customerProjectOptions.approvalContexts,
        "not_sure",
      ),
      budgetRange: optionValue(
        raw.budgetRange,
        customerProjectOptions.budgets,
        "not_set",
      ),
      addressState: canonicalAustralianState(raw.addressState) || "",
      features: normalizeHomeFeatureSelections(raw.features)
        .slice(0, MAX_HOME_FEATURE_SELECTIONS),
      propertyContext,
    },
  };
}
