import { canonicalAustralianState } from "./australian-postcodes.mjs";
import {
  MAX_HOME_FEATURE_SELECTIONS,
  customerProjectOptions,
  normalizeHomeFeatureSelections,
} from "./customer-projects.mjs";
import { ENERGY_SERVICE_IDS } from "./energy-service-catalogue.mjs";

export const PUBLIC_PLAN_ENQUIRY_KIND = "home-plan-upgrade";

export const PUBLIC_PLAN_CONSENT_PURPOSE =
  "Email my private plan and share my email, postcode, services, message, quote answers and selected photos with approved matched TLink trades";

export const PUBLIC_PLAN_CONSENT_NOTICE_VERSION =
  "2026-08-11-quote-preparation-sharing-notice-v7";

const publicPlanContactReleaseRequiredFields = Object.freeze([
  "customer_email",
  "postcode",
  "service_categories",
]);

const publicPlanContactReleasePolicies = Object.freeze([
  Object.freeze({
    noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
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
    allowedDisclosedFields: Object.freeze([
      ...publicPlanContactReleaseRequiredFields,
      "customer_name",
      "customer_phone",
      "customer_message",
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

export function publicPlanContactReleaseConsentSql(releaseAlias) {
  const alias = publicPlanContactReleaseAlias(releaseAlias);
  return `(${publicPlanContactReleasePolicies.map((policy) => `(
    ${alias}.notice_version = ${sqlLiteral(policy.noticeVersion)}
    AND ${alias}.consent_purpose = ${sqlLiteral(policy.purpose)}
  )`).join(" OR ")})`;
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
    && publicPlanContactReleaseRequiredFields.every((field) => uniqueFields.has(field));
}

export function publicPlanContactReleaseAccessSql(releaseAlias) {
  const alias = publicPlanContactReleaseAlias(releaseAlias);
  const safeFields = `CASE
    WHEN json_valid(${alias}.disclosed_fields) THEN CASE
      WHEN json_type(${alias}.disclosed_fields) = 'array'
        THEN ${alias}.disclosed_fields
      ELSE '[]'
    END
    ELSE '[]'
  END`;
  const policySql = publicPlanContactReleasePolicies.map((policy) => `(
    ${alias}.notice_version = ${sqlLiteral(policy.noticeVersion)}
    AND ${alias}.consent_purpose = ${sqlLiteral(policy.purpose)}
    AND NOT EXISTS (
      SELECT 1 FROM json_each(${safeFields}) disclosed_policy_field
      WHERE typeof(disclosed_policy_field.value) <> 'text'
        OR disclosed_policy_field.value NOT IN (${policy.allowedDisclosedFields.map(sqlLiteral).join(", ")})
    )
  )`).join(" OR ");
  const requiredSql = publicPlanContactReleaseRequiredFields.map((requiredField) => `EXISTS (
    SELECT 1 FROM json_each(${safeFields}) required_disclosed_field
    WHERE required_disclosed_field.value = ${sqlLiteral(requiredField)}
  )`).join(" AND ");
  return `(
    json_valid(${alias}.disclosed_fields)
    AND json_type(CASE WHEN json_valid(${alias}.disclosed_fields)
      THEN ${alias}.disclosed_fields ELSE 'null' END) = 'array'
    AND trim(${alias}.customer_email) <> ''
    AND length(${alias}.postcode) = 4
    AND ${alias}.postcode NOT GLOB '*[^0-9]*'
    AND (${policySql})
    AND ${requiredSql}
    AND (
      SELECT COUNT(*) FROM json_each(${safeFields}) disclosed_field_count
    ) = (
      SELECT COUNT(DISTINCT disclosed_unique_field.value)
      FROM json_each(${safeFields}) disclosed_unique_field
    )
  )`;
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
