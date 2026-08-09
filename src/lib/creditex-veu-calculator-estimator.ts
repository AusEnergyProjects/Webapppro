import { createHash } from "node:crypto";

import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
  CREDITEX_VEU_CATALOGUE_REVIEWED_ON,
  CREDITEX_VEU_ELECTRICITY_EMISSIONS_FACTOR,
  CREDITEX_VEU_LOCATION_CLASSES,
  CREDITEX_VEU_METROPOLITAN_FACTOR,
  CREDITEX_VEU_PART_44_APPLICATION_GUIDE,
  CREDITEX_VEU_PART_6_BASELINES,
  CREDITEX_VEU_PART_6_BUILDING_LOADS,
  CREDITEX_VEU_PART_6_CATEGORIES,
  CREDITEX_VEU_PART_6_CATEGORY_FACTORS,
  CREDITEX_VEU_PART_6_SCENARIOS,
  CREDITEX_VEU_PUBLIC_REGISTRY_URL,
  CREDITEX_VEU_QUOTE_EVIDENCE_ASSUMPTIONS,
  CREDITEX_VEU_REGIONAL_FACTOR,
  CREDITEX_VEU_SPECIFICATION_SOURCES,
  type CreditexVeuActivityDefinition,
  type CreditexVeuLocationClass,
  type CreditexVeuPart6Category,
  type CreditexVeuPart6Scenario,
} from "./creditex-veu-calculator-catalogue.ts";

export const CREDITEX_VEU_ESTIMATE_SCHEMA =
  "creditex-veu-deterministic-estimate/v1" as const;
export const CREDITEX_VEU_ESTIMATOR_VERSION =
  "creditex-veu-exact-rational-engine/2026-08-09" as const;

export type CreditexVeuRegistry = "VEU" | "GEMS";

export type CreditexVeuProductEvidence = {
  registry: CreditexVeuRegistry;
  activityCategory: string;
  productId: string;
  status: "Approved" | "Legacy" | "Registered";
  effectiveFrom: string;
  effectiveTo: string;
  sourceSnapshotHash: string;
};

export type CreditexVeuTraceValue = {
  decimal: string;
  decimalStatus: "exact" | "truncated_18dp";
  exactFraction: string;
  unit: string;
};

export type CreditexVeuTraceEntry = {
  key: string;
  label: string;
  input: string;
  operation: string;
  output: CreditexVeuTraceValue;
};

export type CreditexVeuQuoteEligibilityWarning = {
  inputKey: string;
  label: string;
  suppliedValue: string;
  assumedValue: string;
  assumptionApplied: boolean;
  message: string;
};

export type CreditexVeuEstimate = {
  schemaVersion: typeof CREDITEX_VEU_ESTIMATE_SCHEMA;
  estimatorVersion: typeof CREDITEX_VEU_ESTIMATOR_VERSION;
  activityCode: string;
  activityTitle: string;
  scenario: string;
  formulaKey: string;
  formulaProfile: string;
  specificationVersion: "24.0" | "25.0";
  specificationEffectiveFrom: string;
  installationDate: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  sourcePages: string;
  sourceReviewedOn: typeof CREDITEX_VEU_CATALOGUE_REVIEWED_ON;
  supportingSources: readonly {
    version: string;
    publishedOn: string;
    url: string;
    title: string;
    pages: string;
  }[];
  productRegistryUrl: typeof CREDITEX_VEU_PUBLIC_REGISTRY_URL | "";
  inputSnapshot: Record<string, unknown>;
  trace: CreditexVeuTraceEntry[];
  output: {
    unroundedTonnes: string;
    unroundedDecimalStatus: "exact" | "truncated_18dp";
    exactFraction: string;
    wholeCertificates: string | null;
    roundingStatus:
      | "nearest_whole_applied"
      | "exact_half_tie_requires_regulator_confirmation";
    unit: "VEEC";
    unitQuantity?: string;
    perUnit?: {
      unroundedTonnes: string;
      unroundedDecimalStatus: "exact" | "truncated_18dp";
      exactFraction: string;
      wholeCertificates: string | null;
      roundingStatus:
        | "nearest_whole_applied"
        | "exact_half_tie_requires_regulator_confirmation";
      unit: "VEEC";
    };
  };
  status:
    | "estimate_only_compliance_reconciliation_required"
    | "estimate_only_rounding_tie_unresolved";
  certificateActionEnabled: false;
  operatorMessage: string;
  inputHash: string;
  traceHash: string;
  outputHash: string;
  receiptHash: string;
  estimatePurpose?: "quote";
  eligibilityConfirmed?: false;
  eligibilityWarnings?: CreditexVeuQuoteEligibilityWarning[];
};

export type CreditexVeuEstimateErrorCode =
  | "VEU_REQUEST_INVALID"
  | "VEU_ACTIVITY_UNSUPPORTED"
  | "VEU_DATE_UNSUPPORTED"
  | "VEU_INPUT_INVALID"
  | "VEU_PRODUCT_EVIDENCE_INVALID"
  | "VEU_PRODUCT_NOT_EFFECTIVE"
  | "VEU_SYSTEM_INELIGIBLE";

export class CreditexVeuEstimateError extends Error {
  readonly code: CreditexVeuEstimateErrorCode;
  readonly status: number;

  constructor(
    code: CreditexVeuEstimateErrorCode,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "CreditexVeuEstimateError";
    this.code = code;
    this.status = status;
  }
}

type UnknownRecord = Record<string, unknown>;

type Fraction = {
  numerator: bigint;
  denominator: bigint;
};

type Execution = {
  scenario: string;
  result: Fraction;
  trace: CreditexVeuTraceEntry[];
  inputSnapshot: Record<string, unknown>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_DECIMAL_PLACES = 12;
const ZERO = fraction(BigInt(0));
const EEF = decimalConstant(CREDITEX_VEU_ELECTRICITY_EMISSIONS_FACTOR);

function fail(
  code: CreditexVeuEstimateErrorCode,
  message: string,
  status = 400,
): never {
  throw new CreditexVeuEstimateError(code, message, status);
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    fail("VEU_REQUEST_INVALID", `${label} must be an object.`);
  }
  return value;
}

function exactKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  label: string,
) {
  const permitted = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !permitted.has(key));
  if (unexpected.length > 0) {
    fail(
      "VEU_REQUEST_INVALID",
      `Remove unsupported ${label} field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}.`,
    );
  }
}

function requiredString(value: unknown, label: string) {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || value.length === 0
    || value.length > 200
  ) {
    fail("VEU_INPUT_INVALID", `${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function greatestCommonDivisor(left: bigint, right: bigint) {
  let a = left < BigInt(0) ? -left : left;
  let b = right < BigInt(0) ? -right : right;
  while (b !== BigInt(0)) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || BigInt(1);
}

function fraction(numerator: bigint, denominator = BigInt(1)): Fraction {
  if (denominator === BigInt(0)) {
    fail("VEU_INPUT_INVALID", "A calculation divisor cannot be zero.");
  }
  const sign = denominator < BigInt(0) ? BigInt(-1) : BigInt(1);
  const signedNumerator = numerator * sign;
  const positiveDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(signedNumerator, positiveDenominator);
  return {
    numerator: signedNumerator / divisor,
    denominator: positiveDenominator / divisor,
  };
}

function decimalConstant(value: string): Fraction {
  const [whole, decimals = ""] = value.split(".");
  return fraction(
    BigInt(`${whole}${decimals}`),
    BigInt(10) ** BigInt(decimals.length),
  );
}

function decimalInput(
  inputs: UnknownRecord,
  key: string,
  label: string,
  options: { allowZero?: boolean; integer?: boolean; maximum?: string } = {},
) {
  const value = inputs[key];
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    fail("VEU_INPUT_INVALID", `${label} must be an exact non-negative decimal string.`);
  }
  const [, decimals = ""] = value.split(".");
  if (
    decimals.length > MAX_DECIMAL_PLACES
    || (options.integer && decimals.length > 0)
  ) {
    fail(
      "VEU_INPUT_INVALID",
      options.integer
        ? `${label} must be a whole number.`
        : `${label} supports no more than ${MAX_DECIMAL_PLACES} decimal places.`,
    );
  }
  const parsed = decimalConstant(value);
  if (!options.allowZero && compare(parsed, ZERO) <= 0) {
    fail("VEU_INPUT_INVALID", `${label} must be greater than zero.`);
  }
  if (
    options.maximum
    && compare(parsed, decimalConstant(options.maximum)) > 0
  ) {
    fail("VEU_INPUT_INVALID", `${label} must not exceed ${options.maximum}.`);
  }
  return parsed;
}

function selectInput<const T extends readonly string[]>(
  inputs: UnknownRecord,
  key: string,
  label: string,
  options: T,
): T[number] {
  const value = inputs[key];
  if (typeof value !== "string" || !options.includes(value)) {
    fail("VEU_INPUT_INVALID", `Choose a valid ${label.toLowerCase()}.`);
  }
  return value as T[number];
}

function add(left: Fraction, right: Fraction) {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtract(left: Fraction, right: Fraction) {
  return fraction(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiply(left: Fraction, right: Fraction) {
  return fraction(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

function divide(left: Fraction, right: Fraction) {
  return fraction(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
  );
}

function minimum(left: Fraction, right: Fraction) {
  return compare(left, right) <= 0 ? left : right;
}

function maximum(left: Fraction, right: Fraction) {
  return compare(left, right) >= 0 ? left : right;
}

function compare(left: Fraction, right: Fraction) {
  const comparison =
    left.numerator * right.denominator - right.numerator * left.denominator;
  return comparison === BigInt(0) ? 0 : comparison > BigInt(0) ? 1 : -1;
}

function exactFraction(value: Fraction) {
  return `${value.numerator}/${value.denominator}`;
}

function decimalPresentation(value: Fraction) {
  const negative = value.numerator < BigInt(0);
  const absolute = negative ? -value.numerator : value.numerator;
  const whole = absolute / value.denominator;
  let remainder = absolute % value.denominator;
  let decimals = "";
  for (let index = 0; index < 18 && remainder !== BigInt(0); index += 1) {
    remainder *= BigInt(10);
    decimals += String(remainder / value.denominator);
    remainder %= value.denominator;
  }
  const trimmed = decimals.replace(/0+$/, "");
  return {
    decimal: `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`,
    status: remainder === BigInt(0)
      ? "exact" as const
      : "truncated_18dp" as const,
  };
}

function traceValue(value: Fraction, unit: string): CreditexVeuTraceValue {
  const presentation = decimalPresentation(value);
  return {
    decimal: presentation.decimal,
    decimalStatus: presentation.status,
    exactFraction: exactFraction(value),
    unit,
  };
}

function traceEntry(
  key: string,
  label: string,
  input: string,
  operation: string,
  output: Fraction,
  unit = "tCO2-e",
): CreditexVeuTraceEntry {
  return { key, label, input, operation, output: traceValue(output, unit) };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as UnknownRecord)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function usesVeuProductRegistry(
  productRegistry: CreditexVeuActivityDefinition["productRegistry"],
) {
  return productRegistry === "VEU" || productRegistry === "VEU_AND_GEMS";
}

function supportingSourcesFor(activity: CreditexVeuActivityDefinition) {
  return activity.supportingSources || [];
}

function parseDate(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    fail("VEU_DATE_UNSUPPORTED", `${label} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail("VEU_DATE_UNSUPPORTED", `${label} is not a valid calendar date.`);
  }
  return { text: value, time: date.getTime() };
}

function resolveSpecification(installationDate: string, activityCode: string) {
  const parsed = parseDate(installationDate, "Installation date");
  const minimum = parseDate("2026-06-30", "Minimum supported date");
  if (parsed.time < minimum.time) {
    fail(
      "VEU_DATE_UNSUPPORTED",
      "This VEU slice supports Version 24 and Version 25 installations from 30 June 2026 onward.",
    );
  }
  const v25Start = parseDate("2026-07-21", "Version 25 start");
  const part6Revision = parseDate("2026-09-30", "Part 6 revision start");
  const source = parsed.time < v25Start.time
    ? CREDITEX_VEU_SPECIFICATION_SOURCES.v24
    : CREDITEX_VEU_SPECIFICATION_SOURCES.v25;
  let formulaProfile = `veu-specification-v${source.version}`;
  if (activityCode === "6") {
    if (parsed.time < v25Start.time) {
      formulaProfile = "veu-v24-part6";
    } else if (parsed.time < part6Revision.time) {
      formulaProfile = "veu-v25-part6-transition-pre-2026-09-30";
    } else {
      formulaProfile = "veu-v25-part6-from-2026-09-30";
    }
  }
  return { parsed, source, formulaProfile, part6RevisionApplied: parsed.time >= part6Revision.time };
}

function validateProductEvidence(
  value: unknown,
  installationDate: string,
  registry: CreditexVeuRegistry,
  activityCategories: readonly string[],
) {
  const product = record(value, "Product evidence");
  exactKeys(product, [
    "registry",
    "activityCategory",
    "productId",
    "status",
    "effectiveFrom",
    "effectiveTo",
    "sourceSnapshotHash",
  ], "product evidence");
  if (product.registry !== registry) {
    fail(
      "VEU_PRODUCT_EVIDENCE_INVALID",
      `This activity requires ${registry} product evidence.`,
    );
  }
  const category = requiredString(product.activityCategory, "Product activity category");
  if (!activityCategories.includes(category)) {
    fail(
      "VEU_PRODUCT_EVIDENCE_INVALID",
      `Product activity category must be ${activityCategories.join(" or ")}.`,
    );
  }
  const productStatus = requiredString(product.status, "Product status");
  let status: CreditexVeuProductEvidence["status"];
  if (registry === "VEU") {
    if (productStatus !== "Approved" && productStatus !== "Legacy") {
      fail(
        "VEU_PRODUCT_EVIDENCE_INVALID",
        "Product status must be Approved or Legacy for this estimate.",
      );
    }
    status = productStatus;
  } else {
    if (productStatus !== "Registered") {
      fail(
        "VEU_PRODUCT_EVIDENCE_INVALID",
        "Product status must be Registered for this estimate.",
      );
    }
    status = productStatus;
  }
  const productId = requiredString(product.productId, "Product ID");
  const effectiveFrom = parseDate(product.effectiveFrom, "Product effective-from date");
  const effectiveTo = product.effectiveTo === ""
    ? null
    : parseDate(product.effectiveTo, "Product effective-to date");
  if (status === "Legacy" && !effectiveTo) {
    fail(
      "VEU_PRODUCT_EVIDENCE_INVALID",
      "Legacy product evidence requires an exact official effective-to date.",
    );
  }
  const install = parseDate(installationDate, "Installation date");
  if (
    install.time < effectiveFrom.time
    || (effectiveTo && install.time > effectiveTo.time)
  ) {
    fail(
      "VEU_PRODUCT_NOT_EFFECTIVE",
      `Product ${productId} is not effective on ${installationDate}.`,
      409,
    );
  }
  if (
    typeof product.sourceSnapshotHash !== "string"
    || !HASH_PATTERN.test(product.sourceSnapshotHash)
  ) {
    fail(
      "VEU_PRODUCT_EVIDENCE_INVALID",
      "Product evidence must reference a sha256 source snapshot hash.",
    );
  }
  return {
    registry,
    activityCategory: category,
    productId,
    status,
    effectiveFrom: effectiveFrom.text,
    effectiveTo: effectiveTo?.text ?? "",
    sourceSnapshotHash: product.sourceSnapshotHash,
  };
}

function validateNoProductEvidence(value: unknown, activityCode: string) {
  if (value !== undefined && value !== null) {
    fail(
      "VEU_PRODUCT_EVIDENCE_INVALID",
      `Activity ${activityCode} has no approved-product registry contract; remove product evidence and provide the governed site and equipment inputs instead.`,
    );
  }
  return null;
}

function confirmedInput(inputs: UnknownRecord, key: string, label: string) {
  return selectInput(inputs, key, label, ["yes"] as const);
}

function eligibilityConfirmationInput(
  inputs: UnknownRecord,
  key: string,
  label: string,
  failureMessage: string,
) {
  const value = selectInput(inputs, key, label, ["yes", "no"] as const);
  if (value !== "yes") {
    fail("VEU_SYSTEM_INELIGIBLE", failureMessage, 409);
  }
  return value;
}

function rejectNotApplicableInputs(
  inputs: UnknownRecord,
  keys: readonly string[],
  context: string,
) {
  const provided = keys.filter((key) => inputs[key] !== undefined);
  if (provided.length > 0) {
    fail(
      "VEU_REQUEST_INVALID",
      `Remove ${context} input${provided.length === 1 ? "" : "s"}: ${provided.join(", ")}.`,
    );
  }
}

function quoteInputDefinitionApplies(
  definition: CreditexVeuActivityDefinition["inputDefinitions"][number],
  inputs: UnknownRecord,
) {
  const condition = definition.showWhen;
  if (!condition) return true;
  const current = inputs[condition.key];
  if (condition.oneOf && !condition.oneOf.includes(String(current))) return false;
  if (condition.notOneOf && condition.notOneOf.includes(String(current))) return false;
  return true;
}

function quoteAssumptionSatisfied(value: unknown, assumedValue: string) {
  if (assumedValue === "yes") return value === "yes";
  if (
    (typeof value !== "string" && typeof value !== "number")
    || !DECIMAL_PATTERN.test(String(value))
  ) {
    return false;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= Number(assumedValue);
}

function prepareQuoteInputs(
  activity: CreditexVeuActivityDefinition,
  inputs: UnknownRecord,
) {
  const normalizedInputs = { ...inputs };
  const warnings: CreditexVeuQuoteEligibilityWarning[] = [];
  const assumptions = CREDITEX_VEU_QUOTE_EVIDENCE_ASSUMPTIONS[
    activity.activityCode as keyof typeof CREDITEX_VEU_QUOTE_EVIDENCE_ASSUMPTIONS
  ] || [];
  for (const assumption of assumptions) {
    const definition = activity.inputDefinitions.find(
      (candidate) => candidate.key === assumption.key,
    );
    if (!definition || !quoteInputDefinitionApplies(definition, normalizedInputs)) {
      continue;
    }
    const suppliedValue = normalizedInputs[assumption.key];
    const assumptionApplied = !quoteAssumptionSatisfied(
      suppliedValue,
      assumption.assumedValue,
    );
    if (assumptionApplied) {
      normalizedInputs[assumption.key] = assumption.assumedValue;
    }
    warnings.push({
      inputKey: assumption.key,
      label: definition.label,
      suppliedValue: typeof suppliedValue === "string" || typeof suppliedValue === "number"
        ? String(suppliedValue)
        : "not_provided",
      assumedValue: assumption.assumedValue,
      assumptionApplied,
      message: assumptionApplied
        ? `${definition.label} is not yet confirmed. Quote mode assumed a qualifying value only to calculate potential VEECs.`
        : `${definition.label} was supplied, but quote mode does not independently confirm the supporting compliance evidence.`,
    });
  }
  return { normalizedInputs, warnings };
}

const MAXIMUM_IDENTICAL_WATER_HEATER_SYSTEMS = "10";

function prepareWaterHeaterUnitQuantity(
  activityCode: string,
  estimatePurpose: "compliance" | "quote",
  inputs: UnknownRecord,
) {
  if (!(["1C", "1D", "3C", "3D"] as readonly string[]).includes(activityCode)) {
    return {
      executionInputs: inputs,
      quantity: decimalConstant("1"),
      quantityText: "1",
    };
  }
  const executionInputs = { ...inputs };
  const quantity = inputs.unit_quantity === undefined
    ? decimalConstant("1")
    : decimalInput(
      inputs,
      "unit_quantity",
      "Number of identical systems",
      { integer: true, maximum: MAXIMUM_IDENTICAL_WATER_HEATER_SYSTEMS },
    );
  delete executionInputs.unit_quantity;
  const quantityText = decimalPresentation(quantity).decimal;
  if (estimatePurpose !== "quote" && quantityText !== "1") {
    fail(
      "VEU_REQUEST_INVALID",
      "Strict compliance estimates accept one water-heater activity at a time. Use quote mode to compare multiple identical systems, then validate each installation separately.",
    );
  }
  return { executionInputs, quantity, quantityText };
}

function ensureAtLeast(value: Fraction, minimumValue: string, message: string) {
  if (compare(value, decimalConstant(minimumValue)) < 0) {
    fail("VEU_SYSTEM_INELIGIBLE", message, 409);
  }
}

function ensurePositiveResult(value: Fraction) {
  if (compare(value, ZERO) <= 0) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      "The governed formula does not produce a positive GHG reduction for these inputs.",
      409,
    );
  }
}

function validateWaterHeaterEligibility(
  inputs: UnknownRecord,
  activityCode: "1C" | "1D" | "3C" | "3D",
  heatPump: boolean,
) {
  const premises = selectInput(
    inputs,
    "premises",
    "premises type",
    ["residential", "business"] as const,
  );
  eligibilityConfirmationInput(
    inputs,
    "incumbent_scenario_requirements_confirmed",
    "incumbent water-heater evidence",
    `Part ${activityCode.startsWith("1") ? "1" : "3"} requires governed evidence that the incumbent water heater and any non-functional solar component match the selected prescribed scenario.`,
  );
  if (premises === "residential") {
    eligibilityConfirmationInput(
      inputs,
      "residential_consumer_fact_sheet_provided",
      "VEU Water Heating Consumer Fact Sheet confirmation",
      "Residential Part 1 and Part 3 work requires the current VEU Water Heating Consumer Fact Sheet to be provided before the consumer agrees to the activity.",
    );
    eligibilityConfirmationInput(
      inputs,
      "residential_suitability_and_sizing_advice_confirmed",
      "water-heater suitability and sizing advice confirmation",
      "Residential Part 1 and Part 3 work requires governed evidence of fit-for-purpose information and the prescribed sizing advice.",
    );
  } else {
    rejectNotApplicableInputs(
      inputs,
      [
        "residential_consumer_fact_sheet_provided",
        "residential_suitability_and_sizing_advice_confirmed",
      ],
      "residential-only water-heater eligibility",
    );
  }
  eligibilityConfirmationInput(
    inputs,
    "no_additional_inline_storage_or_system_confirmed",
    "no manifold or in-line system confirmation",
    "Parts 1 and 3 prohibit installing the product in-line with an additional hot-water storage tank or hot-water system, including a manifold system.",
  );
  eligibilityConfirmationInput(
    inputs,
    "decommissioning_and_disposal_confirmed",
    "decommissioning and lawful disposal confirmation",
    "Parts 1 and 3 require the incumbent product to be made incapable of reuse and the decommissioned product, waste and debris to be lawfully removed and disposed of where practical and safe.",
  );
  const coPayment = decimalInput(
    inputs,
    "co_payment_per_installed_product_aud",
    "Co-payment per installed product",
    { allowZero: true },
  );
  ensureAtLeast(
    coPayment,
    "200",
    `Part ${activityCode.startsWith("1") ? "1" : "3"} requires a minimum co-payment of $200 including GST per installed product.`,
  );

  let refrigerantGwp: Fraction | null = null;
  let warrantyYears: Fraction | null = null;
  if (heatPump) {
    refrigerantGwp = decimalInput(
      inputs,
      "refrigerant_gwp",
      "Refrigerant GWP",
      { allowZero: true },
    );
    if (compare(refrigerantGwp, decimalConstant("700")) >= 0) {
      fail(
        "VEU_SYSTEM_INELIGIBLE",
        `Activity ${activityCode} requires heat-pump refrigerant GWP below 700.`,
        409,
      );
    }
    warrantyYears = decimalInput(
      inputs,
      "warranty_years",
      "Product warranty",
      { allowZero: true },
    );
    ensureAtLeast(
      warrantyYears,
      "5",
      `Activity ${activityCode} requires a warranty against defects of at least five years.`,
    );
    eligibilityConfirmationInput(
      inputs,
      "warranty_requirements_confirmed",
      "warranty obligations evidence confirmation",
      `Activity ${activityCode} requires governed warranty evidence, including an Australian warranty contact when the warranty provider is not in Australia.`,
    );
  }

  return {
    premises,
    incumbentScenarioRequirementsConfirmed: "yes",
    residentialConsumerFactSheetProvided: premises === "residential" ? "yes" : null,
    residentialSuitabilityAndSizingAdviceConfirmed: premises === "residential" ? "yes" : null,
    noAdditionalInlineStorageOrSystemConfirmed: "yes",
    decommissioningAndDisposalConfirmed: "yes",
    coPaymentPerInstalledProductAud: exactFraction(coPayment),
    refrigerantGwp: refrigerantGwp ? exactFraction(refrigerantGwp) : null,
    warrantyYears: warrantyYears ? exactFraction(warrantyYears) : null,
    warrantyRequirementsConfirmed: heatPump ? "yes" : null,
  };
}

function calculatePart1(
  activityCode: "1C" | "1D",
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  const heatPump = activityCode === "1D";
  exactKeys(inputs, [
    "geography",
    "system_size",
    "climate_zone",
    "bs2021_gj_per_year",
    "be2021_gj_per_year",
    "premises",
    "incumbent_scenario_requirements_confirmed",
    "residential_consumer_fact_sheet_provided",
    "residential_suitability_and_sizing_advice_confirmed",
    "no_additional_inline_storage_or_system_confirmed",
    "decommissioning_and_disposal_confirmed",
    "co_payment_per_installed_product_aud",
    ...(heatPump
      ? ["refrigerant_gwp", "warranty_years", "warranty_requirements_confirmed"]
      : []),
  ], "Part 1 input");
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const systemSize = selectInput(inputs, "system_size", "system size", ["small", "medium"] as const);
  const climateZone = selectInput(inputs, "climate_zone", "AS/NZS 4234 climate zone", ["4", "5"] as const);
  if (activityCode === "1C" && climateZone !== "4") {
    fail("VEU_SYSTEM_INELIGIBLE", "Part 1C solar-water-heater modelling uses climate zone 4.", 409);
  }
  const bs = decimalInput(inputs, "bs2021_gj_per_year", "Bs2021", { allowZero: true });
  const be = decimalInput(inputs, "be2021_gj_per_year", "Be2021", { allowZero: true });
  const eligibility = validateWaterHeaterEligibility(inputs, activityCode, heatPump);
  const evidence = validateProductEvidence(product, installationDate, "VEU", [activityCode]);
  const isMetro = geography === "metropolitan";
  const factors = activityCode === "1C"
    ? {
        abatement: isMetro
          ? systemSize === "small" ? "30.42" : "41.75"
          : systemSize === "small" ? "32.29" : "44.3",
        sef: isMetro ? "4.08" : "4.33",
      }
    : {
        abatement: isMetro
          ? systemSize === "small" ? "24.34" : "33.4"
          : systemSize === "small" ? "25.83" : "35.44",
        sef: isMetro ? "3.27" : "3.47",
      };
  const modelledEnergy = add(
    multiply(decimalConstant(factors.sef), bs),
    multiply(decimalConstant(factors.sef), be),
  );
  const adjusted = subtract(decimalConstant(factors.abatement), modelledEnergy);
  const result = multiply(EEF, adjusted);
  ensurePositiveResult(result);
  return {
    scenario: `${activityCode}(i)`,
    result,
    inputSnapshot: {
      geography,
      systemSize,
      climateZone,
      bs2021GjPerYear: exactFraction(bs),
      be2021GjPerYear: exactFraction(be),
      ...eligibility,
      product: evidence,
    },
    trace: [
      traceEntry("modelled_energy", "Modelled product energy", `Bs ${decimalPresentation(bs).decimal}; Be ${decimalPresentation(be).decimal}`, `SEF ${factors.sef} x Bs + AEF ${factors.sef} x Be`, modelledEnergy, "GJ/year-weighted"),
      traceEntry("abatement_adjustment", "Adjusted abatement factor", factors.abatement, "abatement factor - modelled product energy", adjusted, "tCO2-e/EEF"),
      traceEntry("ghg_reduction", "GHG equivalent reduction", CREDITEX_VEU_ELECTRICITY_EMISSIONS_FACTOR, "EEF x adjusted abatement factor", result),
    ],
  };
}

function calculatePart3(
  activityCode: "3C" | "3D",
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  const heatPump = activityCode === "3C";
  exactKeys(inputs, [
    "climate_zone",
    "bs2021_gj_per_year",
    "be2021_gj_per_year",
    "premises",
    "incumbent_scenario_requirements_confirmed",
    "residential_consumer_fact_sheet_provided",
    "residential_suitability_and_sizing_advice_confirmed",
    "no_additional_inline_storage_or_system_confirmed",
    "decommissioning_and_disposal_confirmed",
    "co_payment_per_installed_product_aud",
    ...(heatPump
      ? ["refrigerant_gwp", "warranty_years", "warranty_requirements_confirmed"]
      : []),
  ], "Part 3 input");
  const climateZone = selectInput(inputs, "climate_zone", "AS/NZS 4234 climate zone", ["4", "5"] as const);
  if (activityCode === "3D" && climateZone !== "4") {
    fail("VEU_SYSTEM_INELIGIBLE", "Part 3D solar-water-heater modelling uses climate zone 4.", 409);
  }
  const bs = decimalInput(inputs, "bs2021_gj_per_year", "Bs2021", { allowZero: true });
  const be = decimalInput(inputs, "be2021_gj_per_year", "Be2021", { allowZero: true });
  const eligibility = validateWaterHeaterEligibility(inputs, activityCode, heatPump);
  const evidence = validateProductEvidence(product, installationDate, "VEU", [activityCode]);
  const modelledEnergy = add(
    multiply(decimalConstant("4.17"), bs),
    multiply(decimalConstant("4.17"), be),
  );
  const modelledEmissions = multiply(modelledEnergy, EEF);
  const result = subtract(decimalConstant("13.23"), modelledEmissions);
  ensurePositiveResult(result);
  return {
    scenario: activityCode,
    result,
    inputSnapshot: {
      climateZone,
      bs2021GjPerYear: exactFraction(bs),
      be2021GjPerYear: exactFraction(be),
      ...eligibility,
      product: evidence,
    },
    trace: [
      traceEntry("modelled_energy", "Modelled product energy", `Bs ${decimalPresentation(bs).decimal}; Be ${decimalPresentation(be).decimal}`, "4.17 x Bs + 4.17 x Be", modelledEnergy, "GJ/year-weighted"),
      traceEntry("modelled_emissions", "Modelled product emissions", CREDITEX_VEU_ELECTRICITY_EMISSIONS_FACTOR, "modelled energy x EEFm", modelledEmissions),
      traceEntry("ghg_reduction", "GHG equivalent reduction", "13.23", "abatement factor - modelled product emissions", result),
    ],
  };
}

type RuntimePart6Factors = {
  hspfCold: string;
  hspfMixed: string;
  tcspfCold: string;
  tcspfMixed: string;
  lossFactor: string;
  minimumHspf: string;
  minimumTcspf: string;
};

function part6CategoryFactors(
  premises: "residential" | "business",
  category: CreditexVeuPart6Category,
) {
  const factors = (CREDITEX_VEU_PART_6_CATEGORY_FACTORS[premises] as Partial<Record<CreditexVeuPart6Category, RuntimePart6Factors>>)[category];
  if (!factors) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      `Category ${category} is not eligible at ${premises} premises.`,
      409,
    );
  }
  return factors;
}

function ensurePart6CategoryCapacity(category: CreditexVeuPart6Category, capacity: Fraction) {
  const lowerInclusive: Partial<Record<CreditexVeuPart6Category, string>> = {
    "6B(i)": "10", "6B(ii)": "25", "6E(i)": "4", "6E(ii)": "7", "6F": "10",
  };
  const lowerExclusive: Partial<Record<CreditexVeuPart6Category, string>> = { "6C": "39", "6G": "39" };
  const upperExclusive: Partial<Record<CreditexVeuPart6Category, string>> = {
    "6A": "10", "6B(i)": "25", "6D": "4", "6E(i)": "7", "6E(ii)": "10",
  };
  const upperInclusive: Partial<Record<CreditexVeuPart6Category, string>> = {
    "6B(ii)": "39", "6C": "65", "6F": "39", "6G": "65",
  };
  if (
    (lowerInclusive[category] && compare(capacity, decimalConstant(lowerInclusive[category])) < 0)
    || (lowerExclusive[category] && compare(capacity, decimalConstant(lowerExclusive[category])) <= 0)
    || (upperExclusive[category] && compare(capacity, decimalConstant(upperExclusive[category])) >= 0)
    || (upperInclusive[category] && compare(capacity, decimalConstant(upperInclusive[category])) > 0)
  ) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      `Rated standard cooling capacity does not fall within category ${category}.`,
      409,
    );
  }
}

function part6MinimumCoPayment(
  category: CreditexVeuPart6Category,
  configuration: "single" | "multi" | "packaged",
  ratedCoolingCapacity: Fraction,
  part6RevisionApplied: boolean,
) {
  const belowTenKw = compare(ratedCoolingCapacity, decimalConstant("10")) < 0;
  const ducted = ["6A", "6B(i)", "6B(ii)", "6C"].includes(category);
  if (!part6RevisionApplied) {
    return {
      minimum: decimalConstant(configuration === "multi" || ducted || !belowTenKw ? "1000" : "200"),
      rule: "v24-and-v25-through-2026-09-29",
    };
  }
  if (configuration === "multi") {
    return {
      minimum: decimalConstant(belowTenKw ? "1000" : "3000"),
      rule: "v25-multi-split-from-2026-09-30",
    };
  }
  if (ducted) {
    return {
      minimum: decimalConstant("3000"),
      rule: "v25-ducted-from-2026-09-30",
    };
  }
  return {
    minimum: decimalConstant(belowTenKw ? "200" : "1000"),
    rule: "v25-other-non-ducted-from-2026-09-30",
  };
}

function part6ScenarioCap(scenario: CreditexVeuPart6Scenario) {
  if (scenario === "i" || scenario === "ii") return decimalConstant("2.4");
  if (scenario === "iii" || scenario === "iv") return decimalConstant("15");
  return null;
}

function part6BaselineValue(
  scenario: CreditexVeuPart6Scenario,
  key: "hspf" | "tcspf",
  mixed: boolean,
  categoryFactors: RuntimePart6Factors,
) {
  const baseline = CREDITEX_VEU_PART_6_BASELINES[scenario] as Record<string, string>;
  if (baseline[key] === "category") {
    return decimalConstant(key === "hspf"
      ? mixed ? categoryFactors.hspfMixed : categoryFactors.hspfCold
      : mixed ? categoryFactors.tcspfMixed : categoryFactors.tcspfCold);
  }
  const zoneKey = `${key}${mixed ? "Mixed" : "Cold"}`;
  return decimalConstant(baseline[zoneKey] ?? baseline[key]);
}

type CreditexVeuPart6IndoorUnitSnapshot = {
  label: string;
  model: string;
  quantity: string;
  heatingCapacityKw: string;
  coolingCapacityKw: string;
};

function optionalPart6IndoorUnitText(
  value: unknown,
  label: string,
) {
  if (value === undefined || value === "") return "";
  if (
    typeof value !== "string"
    || value.trim() !== value
    || value.length > 80
  ) {
    fail(
      "VEU_INPUT_INVALID",
      `${label} must be a trimmed text value of at most 80 characters.`,
    );
  }
  return value;
}

function part6IndoorUnitList(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    fail(
      "VEU_INPUT_INVALID",
      "Add between 1 and 20 connected indoor-unit rows for a multi-split or VRF quote.",
    );
  }
  let totalQuantity = ZERO;
  let totalHeating = ZERO;
  let totalCooling = ZERO;
  const snapshot: CreditexVeuPart6IndoorUnitSnapshot[] = [];
  for (const [index, rawUnit] of value.entries()) {
    const unit = record(rawUnit, `Indoor unit ${index + 1}`);
    exactKeys(unit, [
      "label",
      "model",
      "quantity",
      "heatingCapacityKw",
      "coolingCapacityKw",
    ], `indoor unit ${index + 1}`);
    const quantity = decimalInput(
      unit,
      "quantity",
      `Indoor unit ${index + 1} quantity`,
      { integer: true, maximum: "20" },
    );
    const heating = decimalInput(
      unit,
      "heatingCapacityKw",
      `Indoor unit ${index + 1} heating capacity`,
      { maximum: "65" },
    );
    const cooling = decimalInput(
      unit,
      "coolingCapacityKw",
      `Indoor unit ${index + 1} cooling capacity`,
      { maximum: "65" },
    );
    totalQuantity = add(totalQuantity, quantity);
    totalHeating = add(totalHeating, multiply(quantity, heating));
    totalCooling = add(totalCooling, multiply(quantity, cooling));
    snapshot.push({
      label: optionalPart6IndoorUnitText(
        unit.label,
        `Indoor unit ${index + 1} label`,
      ),
      model: optionalPart6IndoorUnitText(
        unit.model,
        `Indoor unit ${index + 1} model`,
      ),
      quantity: decimalPresentation(quantity).decimal,
      heatingCapacityKw: decimalPresentation(heating).decimal,
      coolingCapacityKw: decimalPresentation(cooling).decimal,
    });
  }
  if (compare(totalQuantity, decimalConstant("20")) > 0) {
    fail(
      "VEU_INPUT_INVALID",
      "A multi-split or VRF quote supports no more than 20 connected indoor units.",
    );
  }
  return { snapshot, totalQuantity, totalHeating, totalCooling };
}

function calculatePart6(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
  part6RevisionApplied: boolean,
  estimatePurpose: "compliance" | "quote",
): Execution {
  exactKeys(inputs, [
    "scenario",
    "category",
    "premises",
    "location_class",
    "configuration",
    "rated_heating_capacity_kw",
    "rated_cooling_capacity_kw",
    "outdoor_heating_capacity_kw",
    "outdoor_cooling_capacity_kw",
    "indoor_units",
    "hspf_upgrade",
    "tcspf_upgrade",
    "hspf_cold_eligibility",
    "tcspf_cold_eligibility",
    "refrigerant_gwp",
    "performance_basis",
    "same_oem_confirmed",
    "incumbent_scenario_requirements_confirmed",
    "decommissioning_and_disposal_confirmed",
    "residential_consumer_fact_sheet_provided",
    "residential_suitability_and_sizing_advice_confirmed",
    "warranty_years",
    "warranty_requirements_confirmed",
    "co_payment_per_installed_product_aud",
  ], "Part 6 input");
  const scenario = selectInput(inputs, "scenario", "Part 6 scenario", CREDITEX_VEU_PART_6_SCENARIOS);
  const category = selectInput(inputs, "category", "Part 6 category", CREDITEX_VEU_PART_6_CATEGORIES);
  const premises = selectInput(inputs, "premises", "premises type", ["residential", "business"] as const);
  const locationClass = selectInput(inputs, "location_class", "location class", CREDITEX_VEU_LOCATION_CLASSES);
  const configuration = selectInput(
    inputs,
    "configuration",
    "air-conditioner configuration",
    ["single", "multi", "packaged"] as const,
  );
  if (configuration === "packaged" && estimatePurpose !== "quote") {
    fail(
      "VEU_PRODUCT_EVIDENCE_INVALID",
      "Packaged Part 6 systems require a complete governed indoor and outdoor bundle evidence contract before a strict compliance estimate can run. Quote mode may use the exact approved packaged-system row.",
      409,
    );
  }
  if (scenario === "xi") {
    rejectNotApplicableInputs(
      inputs,
      ["incumbent_scenario_requirements_confirmed", "decommissioning_and_disposal_confirmed"],
      "scenario (xi) decommissioning",
    );
  } else {
    eligibilityConfirmationInput(
      inputs,
      "incumbent_scenario_requirements_confirmed",
      "incumbent scenario evidence confirmation",
      `Part 6 scenario (${scenario}) requires governed evidence that all applicable Table 6.1 incumbent-equipment, main-heating, floor-area and refrigerative-air-conditioner conditions are satisfied.`,
    );
    eligibilityConfirmationInput(
      inputs,
      "decommissioning_and_disposal_confirmed",
      "decommissioning and lawful disposal confirmation",
      "Part 6 scenarios (i) to (x) require the incumbent product to be made incapable of reuse, refrigerant to be lawfully disposed of where present, and removed waste and debris to be lawfully disposed of.",
    );
  }
  let warrantyYears: Fraction | null = null;
  if (premises === "residential") {
    eligibilityConfirmationInput(
      inputs,
      "residential_consumer_fact_sheet_provided",
      "VEU Space Heating and Cooling Consumer Fact Sheet confirmation",
      "Residential Part 6 work requires the current VEU Space Heating and Cooling Consumer Fact Sheet to be provided before the consumer agrees to the activity.",
    );
    eligibilityConfirmationInput(
      inputs,
      "residential_suitability_and_sizing_advice_confirmed",
      "air-conditioner suitability and sizing advice confirmation",
      "Residential Part 6 work requires governed evidence of fit-for-purpose information and the prescribed sizing advice.",
    );
    warrantyYears = decimalInput(
      inputs,
      "warranty_years",
      "Product warranty",
      { allowZero: true },
    );
    ensureAtLeast(
      warrantyYears,
      "5",
      "Residential Part 6 products require a warranty against defects of at least five years.",
    );
    eligibilityConfirmationInput(
      inputs,
      "warranty_requirements_confirmed",
      "warranty obligations evidence confirmation",
      "Residential Part 6 work requires governed warranty evidence, including an Australian warranty contact when the warranty provider is not in Australia.",
    );
  } else {
    rejectNotApplicableInputs(
      inputs,
      [
        "residential_consumer_fact_sheet_provided",
        "residential_suitability_and_sizing_advice_confirmed",
        "warranty_years",
        "warranty_requirements_confirmed",
      ],
      "residential-only Part 6 eligibility",
    );
  }
  const performanceBasis = selectInput(
    inputs,
    "performance_basis",
    "performance basis",
    ["gems", "calculated_from_acop_aeer", "mixed_gems_and_calculated"] as const,
  );
  let indoorUnits: ReturnType<typeof part6IndoorUnitList> | null = null;
  let ratedHeating: Fraction;
  let ratedCooling: Fraction;
  if (configuration === "multi" && inputs.indoor_units !== undefined) {
    if (estimatePurpose !== "quote") {
      fail(
        "VEU_REQUEST_INVALID",
        "Strict compliance estimates require the governed multi-split evidence contract. Remove the quote-only indoor-unit list.",
      );
    }
    if (
      inputs.rated_heating_capacity_kw !== undefined
      || inputs.rated_cooling_capacity_kw !== undefined
    ) {
      fail(
        "VEU_REQUEST_INVALID",
        "Use the connected indoor-unit list instead of entering separate indoor capacity totals.",
      );
    }
    indoorUnits = part6IndoorUnitList(inputs.indoor_units);
    ratedHeating = indoorUnits.totalHeating;
    ratedCooling = indoorUnits.totalCooling;
  } else {
    ratedHeating = decimalInput(
      inputs,
      "rated_heating_capacity_kw",
      "Rated heating capacity",
    );
    ratedCooling = decimalInput(
      inputs,
      "rated_cooling_capacity_kw",
      "Rated cooling capacity",
    );
  }
  let outdoorHeating: Fraction | null = null;
  let outdoorCooling: Fraction | null = null;
  if (configuration === "multi") {
    outdoorHeating = decimalInput(inputs, "outdoor_heating_capacity_kw", "Outdoor-unit heating capacity");
    outdoorCooling = decimalInput(inputs, "outdoor_cooling_capacity_kw", "Outdoor-unit cooling capacity");
    if (inputs.same_oem_confirmed !== "yes") {
      fail(
        "VEU_SYSTEM_INELIGIBLE",
        "All multi-split indoor units must use the same original equipment manufacturer as the connected outdoor unit.",
        409,
      );
    }
  } else if (
    inputs.outdoor_heating_capacity_kw !== undefined
    || inputs.outdoor_cooling_capacity_kw !== undefined
    || inputs.same_oem_confirmed !== undefined
    || inputs.indoor_units !== undefined
  ) {
    fail(
      "VEU_REQUEST_INVALID",
      `Remove multi-split-only inputs for a ${configuration === "packaged" ? "packaged" : "single"} system.`,
    );
  }
  const productRatedCooling = outdoorCooling ?? ratedCooling;
  ensurePart6CategoryCapacity(category, productRatedCooling);
  const coPaymentRequirement = part6MinimumCoPayment(
    category,
    configuration,
    productRatedCooling,
    part6RevisionApplied,
  );
  const coPayment = decimalInput(
    inputs,
    "co_payment_per_installed_product_aud",
    "Co-payment per installed product",
    { allowZero: true },
  );
  ensureAtLeast(
    coPayment,
    decimalPresentation(coPaymentRequirement.minimum).decimal,
    `Part 6 requires a minimum co-payment of $${decimalPresentation(coPaymentRequirement.minimum).decimal} including GST per installed product for this installation date and system configuration.`,
  );
  const categoryFactors = part6CategoryFactors(premises, category);
  const hspfUpgrade = decimalInput(inputs, "hspf_upgrade", "Applicable HSPF");
  const tcspfUpgrade = decimalInput(inputs, "tcspf_upgrade", "Applicable TCSPF");
  const hspfColdEligibility = decimalInput(inputs, "hspf_cold_eligibility", "Cold-zone eligibility HSPF");
  const tcspfColdEligibility = decimalInput(inputs, "tcspf_cold_eligibility", "Cold-zone eligibility TCSPF");
  if (
    compare(hspfColdEligibility, decimalConstant(categoryFactors.minimumHspf)) < 0
    || compare(tcspfColdEligibility, decimalConstant(categoryFactors.minimumTcspf)) < 0
  ) {
    fail("VEU_SYSTEM_INELIGIBLE", `The product does not meet category ${category} minimum HSPF and TCSPF.`, 409);
  }
  const refrigerantGwp = decimalInput(inputs, "refrigerant_gwp", "Refrigerant GWP", { allowZero: true });
  if (
    compare(productRatedCooling, decimalConstant("15")) < 0
    && compare(refrigerantGwp, decimalConstant("700")) >= 0
  ) {
    fail("VEU_SYSTEM_INELIGIBLE", "Air conditioners below 15 kW rated cooling capacity require refrigerant GWP below 700.", 409);
  }
  const evidence = validateProductEvidence(product, installationDate, "VEU", [category]);
  let heatingCapacity = outdoorHeating ? minimum(ratedHeating, outdoorHeating) : ratedHeating;
  let coolingCapacity = outdoorCooling ? minimum(ratedCooling, outdoorCooling) : ratedCooling;
  if (part6RevisionApplied && premises === "residential" && configuration === "multi") {
    heatingCapacity = minimum(heatingCapacity, decimalConstant("20"));
    coolingCapacity = minimum(coolingCapacity, decimalConstant("20"));
  }
  const scenarioCap = part6ScenarioCap(scenario);
  if (scenarioCap) {
    heatingCapacity = minimum(heatingCapacity, scenarioCap);
    coolingCapacity = minimum(coolingCapacity, scenarioCap);
  }
  const mixed = locationClass === "regional_hot";
  const baselineHspf = part6BaselineValue(scenario, "hspf", mixed, categoryFactors);
  const baselineTcspf = part6BaselineValue(scenario, "tcspf", mixed, categoryFactors);
  const gasHeating = ["vii", "viii", "ix", "x"].includes(scenario);
  const baselineHeatingIntensity = gasHeating ? decimalConstant("0.198") : EEF;
  const lossFactor = decimalConstant(categoryFactors.lossFactor);
  const gsfHeat = subtract(
    divide(baselineHeatingIntensity, baselineHspf),
    divide(multiply(EEF, lossFactor), hspfUpgrade),
  );
  const gsfCool = subtract(
    divide(EEF, baselineTcspf),
    divide(multiply(EEF, lossFactor), tcspfUpgrade),
  );
  const buildingLoads = CREDITEX_VEU_PART_6_BUILDING_LOADS[locationClass][premises];
  const heatingSavings = multiply(
    multiply(gsfHeat, decimalConstant(buildingLoads.heating)),
    heatingCapacity,
  );
  const coolingSavings = multiply(
    multiply(gsfCool, decimalConstant(buildingLoads.cooling)),
    coolingCapacity,
  );
  const lifetime = decimalConstant(scenario === "xi" ? "15" : "12");
  const result = multiply(add(heatingSavings, coolingSavings), lifetime);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      category,
      premises,
      locationClass,
      configuration,
      performanceBasis,
      ratedHeatingCapacityKw: exactFraction(ratedHeating),
      ratedCoolingCapacityKw: exactFraction(ratedCooling),
      indoorUnits: indoorUnits?.snapshot || [],
      indoorUnitQuantity: indoorUnits
        ? decimalPresentation(indoorUnits.totalQuantity).decimal
        : "",
      outdoorHeatingCapacityKw: outdoorHeating ? exactFraction(outdoorHeating) : "",
      outdoorCoolingCapacityKw: outdoorCooling ? exactFraction(outdoorCooling) : "",
      governedHeatingCapacityKw: exactFraction(heatingCapacity),
      governedCoolingCapacityKw: exactFraction(coolingCapacity),
      hspfUpgrade: exactFraction(hspfUpgrade),
      tcspfUpgrade: exactFraction(tcspfUpgrade),
      hspfColdEligibility: exactFraction(hspfColdEligibility),
      tcspfColdEligibility: exactFraction(tcspfColdEligibility),
      refrigerantGwp: exactFraction(refrigerantGwp),
      sameOemConfirmed: configuration === "multi" ? "yes" : "not_applicable",
      incumbentScenarioRequirementsConfirmed: scenario === "xi" ? null : "yes",
      decommissioningAndDisposalConfirmed: scenario === "xi" ? null : "yes",
      residentialConsumerFactSheetProvided: premises === "residential" ? "yes" : null,
      residentialSuitabilityAndSizingAdviceConfirmed: premises === "residential" ? "yes" : null,
      warrantyYears: warrantyYears ? exactFraction(warrantyYears) : null,
      warrantyRequirementsConfirmed: premises === "residential" ? "yes" : null,
      coPaymentPerInstalledProductAud: exactFraction(coPayment),
      minimumCoPaymentAud: exactFraction(coPaymentRequirement.minimum),
      coPaymentRule: coPaymentRequirement.rule,
      product: evidence,
    },
    trace: [
      traceEntry("minimum_co_payment", "Minimum co-payment gate", exactFraction(coPayment), coPaymentRequirement.rule, coPaymentRequirement.minimum, "AUD including GST per installed product"),
      ...(indoorUnits
        ? [
            traceEntry(
              "connected_indoor_units",
              "Connected indoor units",
              `${indoorUnits.snapshot.length} configured rows`,
              "sum quantity x rated capacity for each connected indoor-unit row",
              indoorUnits.totalQuantity,
              "indoor units",
            ),
          ]
        : []),
      traceEntry(
        "governed_heating_capacity",
        "Governed heating capacity",
        decimalPresentation(ratedHeating).decimal,
        configuration === "multi"
          ? "connected indoor-unit sum capped by approved outdoor rating, scenario cap and applicable 20 kW residential multi-split cap"
          : configuration === "packaged"
            ? "exact approved packaged-system rating capped by the selected scenario"
            : "exact approved single-system rating capped by the selected scenario",
        heatingCapacity,
        "kW",
      ),
      traceEntry(
        "governed_cooling_capacity",
        "Governed cooling capacity",
        decimalPresentation(ratedCooling).decimal,
        configuration === "multi"
          ? "connected indoor-unit sum capped by approved outdoor rating, scenario cap and applicable 20 kW residential multi-split cap"
          : configuration === "packaged"
            ? "exact approved packaged-system rating capped by the selected scenario"
            : "exact approved single-system rating capped by the selected scenario",
        coolingCapacity,
        "kW",
      ),
      traceEntry("gsf_heat", "Heating greenhouse savings factor", `${exactFraction(baselineHeatingIntensity)} / ${exactFraction(baselineHspf)}`, `baseline intensity / baseline HSPF - EEF x ${categoryFactors.lossFactor} / approved-product HSPF`, gsfHeat, "tCO2-e/MWh"),
      traceEntry("heating_savings", "Annual heating savings", `${exactFraction(gsfHeat)} x ${buildingLoads.heating} x ${exactFraction(heatingCapacity)}`, "GSFheat x BTLheat x governed heating capacity", heatingSavings, "tCO2-e/year"),
      traceEntry("gsf_cool", "Cooling greenhouse savings factor", `${exactFraction(EEF)} / ${exactFraction(baselineTcspf)}`, `baseline intensity / baseline TCSPF - EEF x ${categoryFactors.lossFactor} / approved-product TCSPF`, gsfCool, "tCO2-e/MWh"),
      traceEntry("cooling_savings", "Annual cooling savings", `${exactFraction(gsfCool)} x ${buildingLoads.cooling} x ${exactFraction(coolingCapacity)}`, "GSFcool x BTLcool x governed cooling capacity", coolingSavings, "tCO2-e/year"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(heatingSavings)} + ${exactFraction(coolingSavings)}`, `annual heating plus cooling savings x ${scenario === "xi" ? "15" : "12"} years`, result),
    ],
  };
}

const PART_13_REGIONAL_FACTORS: Record<CreditexVeuLocationClass, string> = {
  metro_mild: "1.03",
  metro_cold: "1.39",
  regional_mild: "0.93",
  regional_cold: "1.42",
  regional_hot: "0.76",
};

function calculatePart13(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, ["location_class", "area_m2", "wers_heating_stars"], "Part 13 input");
  const location = selectInput(inputs, "location_class", "location class", CREDITEX_VEU_LOCATION_CLASSES);
  const area = decimalInput(inputs, "area_m2", "Glazing area");
  if (compare(area, decimalConstant("5")) < 0) {
    fail("VEU_SYSTEM_INELIGIBLE", "Part 13 requires at least 5 square metres of glazing.", 409);
  }
  const stars = decimalInput(inputs, "wers_heating_stars", "WERS heating stars");
  if (compare(stars, decimalConstant("4")) < 0) {
    fail("VEU_SYSTEM_INELIGIBLE", "Part 13 requires a WERS heating rating of at least 4 stars.", 409);
  }
  const band = compare(stars, decimalConstant("6")) >= 0
    ? { base: "0.0146", electricity: "0.00886" }
    : compare(stars, decimalConstant("5")) >= 0
      ? { base: "0.0121", electricity: "0.00738" }
      : { base: "0.00971", electricity: "0.00591" };
  const ghgSavings = add(decimalConstant(band.base), multiply(decimalConstant(band.electricity), EEF));
  const result = multiply(
    multiply(multiply(ghgSavings, decimalConstant("25")), decimalConstant(PART_13_REGIONAL_FACTORS[location])),
    area,
  );
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["13A"]);
  ensurePositiveResult(result);
  return {
    scenario: "13A",
    result,
    inputSnapshot: { locationClass: location, areaM2: exactFraction(area), wersHeatingStars: exactFraction(stars), product: evidence },
    trace: [
      traceEntry("ghg_savings", "GHG savings rate", `${band.base} + ${band.electricity} x EEF`, "WERS heating-star band formula", ghgSavings, "tCO2-e/m2/year"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(area)} m2`, `savings rate x 25 years x regional factor ${PART_13_REGIONAL_FACTORS[location]} x area`, result),
    ],
  };
}

function calculatePart14(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, ["location_class", "area_m2", "product_type"], "Part 14 input");
  const location = selectInput(inputs, "location_class", "location class", CREDITEX_VEU_LOCATION_CLASSES);
  const productType = selectInput(inputs, "product_type", "product type", ["glass", "acrylic", "film"] as const);
  const area = decimalInput(inputs, "area_m2", "Glazing area");
  if (compare(area, decimalConstant("5")) < 0) {
    fail("VEU_SYSTEM_INELIGIBLE", "Part 14 requires at least 5 square metres of glazing.", 409);
  }
  const lifetime = decimalConstant(productType === "film" ? "5" : "15");
  const ghgSavings = add(decimalConstant("0.00874"), multiply(decimalConstant("0.00531"), EEF));
  const result = multiply(
    multiply(multiply(ghgSavings, lifetime), decimalConstant(PART_13_REGIONAL_FACTORS[location])),
    area,
  );
  const evidence = validateProductEvidence(
    product,
    installationDate,
    "VEU",
    ["14A"],
  );
  ensurePositiveResult(result);
  return {
    scenario: "14A",
    result,
    inputSnapshot: { locationClass: location, areaM2: exactFraction(area), productType, product: evidence },
    trace: [
      traceEntry("ghg_savings", "GHG savings rate", "0.00874 + 0.00531 x EEF", "Part 14 savings formula", ghgSavings, "tCO2-e/m2/year"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(area)} m2`, `savings rate x ${productType === "film" ? "5" : "15"} years x regional factor ${PART_13_REGIONAL_FACTORS[location]} x area`, result),
    ],
  };
}

const PART_15_SAVINGS = {
  "15A": ["0.0315", "0.0266"],
  "15B": ["0.00147", "0.00116"],
  "15C": ["0.0504", "0.0387"],
  "15D": ["0.0963", "0.0742"],
  "15E": ["0.0127", "0.00991"],
  "15F": ["0.283", "0.219"],
  "15G": ["0.283", "0.219"],
  "15H": ["0.0131", "0.00985"],
} as const;

const PART_15_REGIONAL_FACTORS = {
  standard: {
    metro_mild: "1.05", metro_cold: "1.3", regional_mild: "0.84", regional_cold: "1.33", regional_hot: "0.63",
  },
  h: {
    metro_mild: "1.05", metro_cold: "1.88", regional_mild: "0.84", regional_cold: "1.93", regional_hot: "0.55",
  },
} as const;

function calculatePart15(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, ["scenario", "location_class", "installation_count", "area_m2", "warranty_years"], "Part 15 input");
  const scenario = selectInput(inputs, "scenario", "Part 15 scenario", Object.keys(PART_15_SAVINGS) as Array<keyof typeof PART_15_SAVINGS>);
  const location = selectInput(inputs, "location_class", "location class", CREDITEX_VEU_LOCATION_CLASSES);
  const savingsFactors = PART_15_SAVINGS[scenario];
  const savings = add(decimalConstant(savingsFactors[0]), multiply(decimalConstant(savingsFactors[1]), EEF));
  let measure: Fraction;
  let measureLabel: string;
  if (scenario === "15B") {
    measure = decimalInput(inputs, "area_m2", "Window area");
    measureLabel = "m2";
    if (inputs.installation_count !== undefined) {
      fail("VEU_REQUEST_INVALID", "Part 15B uses window area, not installation count.");
    }
  } else {
    measure = decimalInput(inputs, "installation_count", "Installation count", { integer: true });
    measureLabel = "installations";
    if (inputs.area_m2 !== undefined) {
      fail("VEU_REQUEST_INVALID", "This Part 15 scenario uses installation count, not area.");
    }
  }
  let lifetime: Fraction;
  if (scenario === "15F") {
    lifetime = decimalConstant("10");
    if (inputs.warranty_years !== undefined) fail("VEU_REQUEST_INVALID", "Part 15F has a governed 10-year lifetime input.");
  } else if (scenario === "15G") {
    lifetime = decimalConstant("5");
    if (inputs.warranty_years !== undefined) fail("VEU_REQUEST_INVALID", "Part 15G has a governed 5-year lifetime input.");
  } else {
    const warranty = decimalInput(inputs, "warranty_years", "Warranty period");
    if (compare(warranty, decimalConstant("2")) < 0) {
      fail("VEU_SYSTEM_INELIGIBLE", "This Part 15 product requires at least a two-year warranty.", 409);
    }
    lifetime = compare(warranty, decimalConstant("5")) >= 0
      ? decimalConstant("10")
      : decimalConstant("5");
  }
  const regionalFactor = scenario === "15H"
    ? PART_15_REGIONAL_FACTORS.h[location]
    : PART_15_REGIONAL_FACTORS.standard[location];
  const result = multiply(
    multiply(multiply(savings, lifetime), decimalConstant(regionalFactor)),
    measure,
  );
  const evidence = validateProductEvidence(product, installationDate, "VEU", [scenario]);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: { scenario, locationClass: location, measure: exactFraction(measure), measureUnit: measureLabel, lifetimeYears: exactFraction(lifetime), product: evidence },
    trace: [
      traceEntry("ghg_savings", "GHG savings", `${savingsFactors[0]} + ${savingsFactors[1]} x EEF`, "scenario savings formula", savings, scenario === "15B" ? "tCO2-e/m2/year" : "tCO2-e/installation/year"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(measure)} ${measureLabel}`, `savings x ${decimalPresentation(lifetime).decimal} years x regional factor ${regionalFactor} x measure`, result),
    ],
  };
}

function calculatePart17(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, ["geography", "installation_count"], "Part 17 input");
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const count = decimalInput(inputs, "installation_count", "Installation count", { integer: true });
  const baseline = add(decimalConstant("0.0978"), multiply(decimalConstant("0.223"), EEF));
  const upgrade = add(decimalConstant("0.0699"), multiply(decimalConstant("0.159"), EEF));
  const regionalFactor = geography === "metropolitan" ? "0.92" : "1.21";
  const result = multiply(
    multiply(multiply(subtract(baseline, upgrade), decimalConstant("15")), decimalConstant(regionalFactor)),
    count,
  );
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["17A"]);
  ensurePositiveResult(result);
  return {
    scenario: "17A",
    result,
    inputSnapshot: { geography, installationCount: exactFraction(count), product: evidence },
    trace: [
      traceEntry("baseline", "Baseline emissions", "0.0978 + 0.223 x EEF", "Part 17 baseline formula", baseline, "tCO2-e/installation/year"),
      traceEntry("upgrade", "Upgrade emissions", "0.0699 + 0.159 x EEF", "Part 17 upgrade formula", upgrade, "tCO2-e/installation/year"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(count)} installations`, `(baseline - upgrade) x 15 years x regional factor ${regionalFactor} x installations`, result),
    ],
  };
}

function calculateFixedProduct(
  activityCode: "22" | "24" | "25",
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  const scenarios = activityCode === "22"
    ? ["22A", "22B", "22C", "22D"] as const
    : activityCode === "24" ? ["24A"] as const : ["25A"] as const;
  exactKeys(inputs, ["scenario"], `Part ${activityCode} input`);
  const scenario = selectInput(inputs, "scenario", `Part ${activityCode} scenario`, scenarios);
  const quantity = activityCode === "22"
    ? decimalConstant(scenario === "22A" || scenario === "22B" ? "0.62" : "0.71")
    : decimalConstant(activityCode === "24" ? "0.8" : "0.54");
  const evidence = validateProductEvidence(product, installationDate, "VEU", [scenario]);
  return {
    scenario,
    result: quantity,
    inputSnapshot: { scenario, product: evidence },
    trace: [traceEntry("fixed_reduction", "Governed fixed GHG equivalent reduction", scenario, "use the fixed scenario value", quantity)],
  };
}

function calculatePart26(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, ["geography", "paec_kwh_per_year"], "Part 26 input");
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const paec = decimalInput(inputs, "paec_kwh_per_year", "PAEC", { allowZero: true });
  const annualSavings = subtract(decimalConstant("1.16"), multiply(paec, decimalConstant("0.001")));
  if (compare(annualSavings, ZERO) <= 0) {
    fail("VEU_SYSTEM_INELIGIBLE", "PAEC must be below 1,160 kWh/year for a positive Part 26 reduction.", 409);
  }
  const regionalFactor = geography === "metropolitan"
    ? CREDITEX_VEU_METROPOLITAN_FACTOR
    : CREDITEX_VEU_REGIONAL_FACTOR;
  const result = multiply(
    multiply(multiply(annualSavings, EEF), decimalConstant("7")),
    decimalConstant(regionalFactor),
  );
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["26A"]);
  return {
    scenario: "26A",
    result,
    inputSnapshot: { geography, paecKwhPerYear: exactFraction(paec), product: evidence },
    trace: [
      traceEntry("annual_savings", "Annual electricity savings", `1.16 - ${exactFraction(paec)} x 0.001`, "Part 26 PAEC adjustment", annualSavings, "MWh/year"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", exactFraction(annualSavings), `annual savings x EEF x 7 years x regional factor ${regionalFactor}`, result),
    ],
  };
}

const SIMPLE_LIGHTING_CONTROL_PROFILES = [
  "none",
  "occupancy_1_to_2",
  "occupancy_3_to_6",
  "occupancy_more_than_6",
  "programmable_dimmer",
  "occupancy_1_to_2_and_programmable_dimmer",
  "occupancy_3_to_6_and_programmable_dimmer",
  "occupancy_more_than_6_and_programmable_dimmer",
] as const;

const SIMPLE_LIGHTING_CONTROL_MULTIPLIERS: Record<
  typeof SIMPLE_LIGHTING_CONTROL_PROFILES[number],
  string
> = {
  none: "1",
  occupancy_1_to_2: "0.55",
  occupancy_3_to_6: "0.70",
  occupancy_more_than_6: "0.90",
  programmable_dimmer: "0.85",
  occupancy_1_to_2_and_programmable_dimmer: "0.4675",
  occupancy_3_to_6_and_programmable_dimmer: "0.595",
  occupancy_more_than_6_and_programmable_dimmer: "0.765",
};

const PART_34_OCCUPANCY_SCOPES = [
  "none",
  "one_to_two_luminaires",
  "three_to_six_luminaires",
  "more_than_six_luminaires",
] as const;

const YES_NO = ["yes", "no"] as const;

const PART_34_ANNUAL_OPERATING_HOURS = [
  "1000", "2000", "3000", "4500", "5000", "5100", "6000", "7000", "8500",
] as const;

function simpleLightingControl(
  inputs: UnknownRecord,
  key: string,
  label: string,
) {
  const profile = selectInput(inputs, key, label, SIMPLE_LIGHTING_CONTROL_PROFILES);
  return {
    profile,
    multiplier: decimalConstant(SIMPLE_LIGHTING_CONTROL_MULTIPLIERS[profile]),
  };
}

function part34Control(
  inputs: UnknownRecord,
  prefix: "baseline" | "approved_upgrade" | "retained_upgrade",
  label: string,
) {
  const occupancy = selectInput(
    inputs,
    `${prefix}_occupancy_sensor_scope`,
    `${label} occupancy-sensor scope`,
    PART_34_OCCUPANCY_SCOPES,
  );
  const daylightLinked = selectInput(
    inputs,
    `${prefix}_daylight_linked_control`,
    `${label} daylight-linked control status`,
    YES_NO,
  );
  const programmableDimmer = selectInput(
    inputs,
    `${prefix}_programmable_dimmer`,
    `${label} programmable-dimmer status`,
    YES_NO,
  );
  const manualDimmer = selectInput(
    inputs,
    `${prefix}_manual_dimmer`,
    `${label} manual-dimmer status`,
    YES_NO,
  );
  const voltageReductionUnit = selectInput(
    inputs,
    `${prefix}_voltage_reduction_unit`,
    `${label} voltage-reduction-unit status`,
    YES_NO,
  );
  const voltage = voltageReductionUnit === "yes"
    ? decimalInput(
      inputs,
      `${prefix}_voltage_reduction_unit_output_v`,
      `${label} voltage-reduction-unit output`,
      { maximum: "240" },
    )
    : null;
  const factors: Fraction[] = [];
  if (occupancy !== "none") {
    factors.push(decimalConstant(
      occupancy === "one_to_two_luminaires"
        ? "0.55"
        : occupancy === "three_to_six_luminaires"
          ? "0.70"
          : "0.90",
    ));
  }
  if (daylightLinked === "yes") factors.push(decimalConstant("0.70"));
  if (programmableDimmer === "yes") factors.push(decimalConstant("0.85"));
  if (manualDimmer === "yes") factors.push(decimalConstant("0.90"));
  if (voltage) {
    factors.push(divide(
      multiply(voltage, voltage),
      multiply(decimalConstant("240"), decimalConstant("240")),
    ));
  }
  let multiplier = decimalConstant("1");
  if (factors.length === 1) {
    multiplier = factors[0];
  } else if (factors.length > 1) {
    factors.sort(compare);
    const twoLowest = multiply(factors[0], factors[1]);
    const floor = decimalConstant(
      occupancy === "one_to_two_luminaires"
        ? "0.4"
        : occupancy === "three_to_six_luminaires"
          ? "0.5"
          : "0.6",
    );
    multiplier = maximum(floor, twoLowest);
  }
  return {
    multiplier,
    snapshot: {
      occupancySensorScope: occupancy,
      daylightLinkedControl: daylightLinked,
      programmableDimmer,
      manualDimmer,
      voltageReductionUnit,
      voltageReductionUnitOutputV: voltage ? exactFraction(voltage) : null,
    },
  };
}

function cappedRatedLightingLifetime(
  inputs: UnknownRecord,
  key: string,
  label: string,
  annualOperatingHours: Fraction,
  maximumYears: string,
) {
  const ratedLifetimeHours = decimalInput(inputs, key, label);
  const cappedHours = minimum(ratedLifetimeHours, decimalConstant("30000"));
  return {
    ratedLifetimeHours,
    assetLifetimeYears: minimum(
      divide(cappedHours, annualOperatingHours),
      decimalConstant(maximumYears),
    ),
  };
}

function lightingLifetime(
  assetLifetimeYears: Fraction,
  annualOperatingHours: Fraction,
) {
  return multiply(
    multiply(assetLifetimeYears, annualOperatingHours),
    decimalConstant("0.000001"),
  );
}

function requireEqualLightingSourceCounts(
  scenario: string,
  incumbentSourceCount: Fraction,
  upgradeSourceCount: Fraction,
) {
  if (compare(incumbentSourceCount, upgradeSourceCount) !== 0) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      `Control-only scenario ${scenario} requires equal incumbent and upgrade lighting-source counts.`,
      409,
    );
  }
}

function requireEligibleDelampingCounts(
  scenario: "34D" | "35C",
  incumbentSourceCount: Fraction,
  retainedUpgradeSourceCount: Fraction,
) {
  if (compare(retainedUpgradeSourceCount, incumbentSourceCount) >= 0) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      `Delamping scenario ${scenario} requires at least one incumbent lighting source to be removed.`,
      409,
    );
  }
  if (
    compare(
      multiply(retainedUpgradeSourceCount, decimalConstant("2")),
      incumbentSourceCount,
    ) < 0
  ) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      `Delamping scenario ${scenario} cannot remove more than half of the incumbent lighting sources.`,
      409,
    );
  }
}

function calculatePart27(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "geography",
    "baseline_lcp_w",
    "baseline_control_profile",
    "approved_upgrade_lcp_w",
    "approved_upgrade_control_profile",
    "incumbent_source_count",
    "upgrade_source_count",
    "removal_requirements_confirmed",
  ], "Part 27 input");
  const scenario = selectInput(inputs, "scenario", "Part 27 scenario", ["27A", "27B", "27C"] as const);
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const baselineLcp = decimalInput(inputs, "baseline_lcp_w", "Governed incumbent lamp circuit power");
  const baselineControl = simpleLightingControl(
    inputs,
    "baseline_control_profile",
    "Incumbent Table 27.7 control profile",
  );
  const incumbentSourceCount = decimalInput(
    inputs,
    "incumbent_source_count",
    "Incumbent lighting-source count",
    { integer: true },
  );
  const upgradeSourceCount = scenario === "27C"
    ? null
    : decimalInput(
      inputs,
      "upgrade_source_count",
      "Upgrade lighting-source count",
      { integer: true },
    );
  if (scenario === "27C") {
    rejectNotApplicableInputs(inputs, ["upgrade_source_count"], "scenario 27C upgrade-source");
  }
  if (scenario === "27A" && upgradeSourceCount) {
    requireEqualLightingSourceCounts(scenario, incumbentSourceCount, upgradeSourceCount);
  }
  const upgradeControl = scenario === "27C"
    ? { profile: "not_applicable" as const, multiplier: ZERO }
    : simpleLightingControl(
      inputs,
      "approved_upgrade_control_profile",
      "Approved Table 27.7 control profile",
    );
  const upgradeLcp = scenario === "27A"
    ? baselineLcp
    : scenario === "27B"
      ? decimalInput(inputs, "approved_upgrade_lcp_w", "Approved upgrade lamp circuit power")
      : ZERO;
  if (scenario === "27A" && compare(upgradeControl.multiplier, baselineControl.multiplier) >= 0) {
    fail("VEU_SYSTEM_INELIGIBLE", "Scenario 27A requires the approved lighting control to reduce the incumbent control multiplier.", 409);
  }
  if (scenario === "27C") {
    confirmedInput(inputs, "removal_requirements_confirmed", "Part 27C removal and decommissioning requirements");
  }
  const baselinePerSource = multiply(multiply(baselineLcp, baselineControl.multiplier), EEF);
  const upgradePerSource = scenario === "27C"
    ? ZERO
    : multiply(multiply(upgradeLcp, upgradeControl.multiplier), EEF);
  const baseline = multiply(baselinePerSource, incumbentSourceCount);
  const upgrade = upgradeSourceCount
    ? multiply(upgradePerSource, upgradeSourceCount)
    : ZERO;
  const assetLifetimeYears = decimalConstant(scenario === "27A" ? "5" : "10");
  const annualOperatingHours = decimalConstant("4500");
  const lifetime = lightingLifetime(assetLifetimeYears, annualOperatingHours);
  const regionalFactor = decimalConstant(
    geography === "metropolitan"
      ? CREDITEX_VEU_METROPOLITAN_FACTOR
      : CREDITEX_VEU_REGIONAL_FACTOR,
  );
  const result = multiply(
    multiply(subtract(baseline, upgrade), lifetime),
    regionalFactor,
  );
  const evidence = scenario === "27C"
    ? validateNoProductEvidence(product, "27")
    : validateProductEvidence(product, installationDate, "VEU", [scenario]);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      geography,
      baselineLcpW: exactFraction(baselineLcp),
      baselineControlProfile: baselineControl.profile,
      baselineControlMultiplier: exactFraction(baselineControl.multiplier),
      upgradeLcpW: exactFraction(upgradeLcp),
      upgradeControlProfile: upgradeControl.profile,
      upgradeControlMultiplier: exactFraction(upgradeControl.multiplier),
      incumbentSourceCount: exactFraction(incumbentSourceCount),
      upgradeSourceCount: upgradeSourceCount ? exactFraction(upgradeSourceCount) : null,
      assetLifetimeYears: exactFraction(assetLifetimeYears),
      annualOperatingHours: exactFraction(annualOperatingHours),
      removalRequirementsConfirmed: scenario === "27C" ? "yes" : null,
      product: evidence,
    },
    trace: [
      traceEntry("baseline", "Baseline lighting emissions rate", `${exactFraction(baselineLcp)} W; CM ${exactFraction(baselineControl.multiplier)}; ${exactFraction(incumbentSourceCount)} incumbent sources`, "sum incumbent LCP x CM x EEF", baseline, "tCO2-e/Mh"),
      traceEntry("upgrade", "Upgrade lighting emissions rate", `${exactFraction(upgradeLcp)} W; CM ${exactFraction(upgradeControl.multiplier)}; ${upgradeSourceCount ? exactFraction(upgradeSourceCount) : "0/1"} upgrade sources`, "sum upgrade LCP x CM x EEF", upgrade, "tCO2-e/Mh"),
      traceEntry("lifetime", "Lighting lifetime factor", `${exactFraction(assetLifetimeYears)} years; ${exactFraction(annualOperatingHours)} hours/year`, "asset lifetime x annual operating hours x 10^-6", lifetime, "Mh"),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", `${exactFraction(baseline)} - ${exactFraction(upgrade)}`, `(independent incumbent sum - independent upgrade sum) x lifetime x regional factor ${exactFraction(regionalFactor)}`, result),
    ],
  };
}

function calculatePart34(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "site_part_j6_status",
    "geography",
    "space_air_conditioned",
    "annual_operating_hours",
    "baseline_lcp_w",
    "baseline_occupancy_sensor_scope",
    "baseline_daylight_linked_control",
    "baseline_programmable_dimmer",
    "baseline_manual_dimmer",
    "baseline_voltage_reduction_unit",
    "baseline_voltage_reduction_unit_output_v",
    "approved_upgrade_lcp_w",
    "approved_upgrade_occupancy_sensor_scope",
    "approved_upgrade_daylight_linked_control",
    "approved_upgrade_programmable_dimmer",
    "approved_upgrade_manual_dimmer",
    "approved_upgrade_voltage_reduction_unit",
    "approved_upgrade_voltage_reduction_unit_output_v",
    "retained_upgrade_lcp_w",
    "retained_upgrade_occupancy_sensor_scope",
    "retained_upgrade_daylight_linked_control",
    "retained_upgrade_programmable_dimmer",
    "retained_upgrade_manual_dimmer",
    "retained_upgrade_voltage_reduction_unit",
    "retained_upgrade_voltage_reduction_unit_output_v",
    "replacement_method",
    "upgrade_rated_lifetime_hours",
    "incumbent_rated_lifetime_hours",
    "incumbent_source_count",
    "upgrade_source_count",
    "vru_compatibility_confirmed",
    "removal_requirements_confirmed",
  ], "Part 34 input");
  const scenario = selectInput(inputs, "scenario", "Part 34 scenario", ["34A", "34B", "34C", "34D", "34E"] as const);
  selectInput(inputs, "site_part_j6_status", "Part J6 status", ["not_required"] as const);
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const airConditioned = selectInput(inputs, "space_air_conditioned", "space air-conditioning status", YES_NO);
  const annualHoursText = selectInput(
    inputs,
    "annual_operating_hours",
    "Table 34.6 or 34.10 annual operating-hours branch",
    PART_34_ANNUAL_OPERATING_HOURS,
  );
  const annualOperatingHours = decimalConstant(annualHoursText);
  const baselineLcp = decimalInput(inputs, "baseline_lcp_w", "Governed incumbent lamp circuit power");
  const baselineControl = part34Control(inputs, "baseline", "Incumbent");
  const incumbentSourceCount = decimalInput(
    inputs,
    "incumbent_source_count",
    "Incumbent lighting-source count",
    { integer: true },
  );
  const upgradeSourceCount = scenario === "34E"
    ? null
    : decimalInput(
      inputs,
      "upgrade_source_count",
      "Upgrade lighting-source count",
      { integer: true },
    );
  if (scenario === "34E") {
    rejectNotApplicableInputs(inputs, ["upgrade_source_count"], "scenario 34E upgrade-source");
  }
  if ((scenario === "34A" || scenario === "34B") && upgradeSourceCount) {
    requireEqualLightingSourceCounts(scenario, incumbentSourceCount, upgradeSourceCount);
  } else if (scenario === "34D" && upgradeSourceCount) {
    requireEligibleDelampingCounts(scenario, incumbentSourceCount, upgradeSourceCount);
  }
  let upgradeLcp: Fraction;
  let upgradeControl: ReturnType<typeof part34Control> | null;
  let evidence: ReturnType<typeof validateProductEvidence> | null;
  if (scenario === "34A" || scenario === "34B" || scenario === "34C") {
    upgradeControl = part34Control(inputs, "approved_upgrade", "Approved upgrade");
    if (scenario === "34A" && upgradeControl.snapshot.voltageReductionUnit === "yes") {
      fail("VEU_SYSTEM_INELIGIBLE", "Scenario 34A cannot use a voltage reduction unit.", 409);
    }
    if (scenario === "34B") {
      if (upgradeControl.snapshot.voltageReductionUnit !== "yes") {
        fail("VEU_SYSTEM_INELIGIBLE", "Scenario 34B requires an approved voltage reduction unit.", 409);
      }
      confirmedInput(inputs, "vru_compatibility_confirmed", "Scenario 34B ballast, driver and LED compatibility requirements");
    }
    upgradeLcp = scenario === "34C"
      ? decimalInput(inputs, "approved_upgrade_lcp_w", "Approved upgrade lamp circuit power")
      : baselineLcp;
    evidence = validateProductEvidence(product, installationDate, "VEU", [scenario]);
  } else if (scenario === "34D") {
    upgradeLcp = decimalInput(inputs, "retained_upgrade_lcp_w", "Retained lamp circuit power per lighting source after delamping");
    upgradeControl = part34Control(inputs, "retained_upgrade", "Retained upgrade");
    confirmedInput(inputs, "removal_requirements_confirmed", "Scenario 34D delamping and control-gear requirements");
    evidence = validateNoProductEvidence(product, "34");
  } else {
    upgradeLcp = ZERO;
    upgradeControl = null;
    confirmedInput(inputs, "removal_requirements_confirmed", "Scenario 34E removal and decommissioning requirements");
    evidence = validateNoProductEvidence(product, "34");
  }
  const airConditioningMultiplier = decimalConstant(airConditioned === "yes" ? "1.05" : "1");
  const baseline = multiply(
    multiply(multiply(multiply(baselineLcp, baselineControl.multiplier), airConditioningMultiplier), EEF),
    incumbentSourceCount,
  );
  const upgrade = upgradeControl && upgradeSourceCount
    ? multiply(
      multiply(multiply(multiply(upgradeLcp, upgradeControl.multiplier), airConditioningMultiplier), EEF),
      upgradeSourceCount,
    )
    : ZERO;
  let assetLifetimeYears: Fraction;
  let replacementMethod: string | null = null;
  let ratedLifetimeHours: Fraction | null = null;
  if (scenario === "34A" || scenario === "34B" || scenario === "34D") {
    assetLifetimeYears = decimalConstant("5");
  } else if (scenario === "34E") {
    assetLifetimeYears = decimalConstant("10");
  } else {
    replacementMethod = selectInput(
      inputs,
      "replacement_method",
      "Scenario 34C replacement method",
      ["luminaire_replacement", "modification", "retrofit", "other"] as const,
    );
    if (replacementMethod === "luminaire_replacement") {
      assetLifetimeYears = decimalConstant("10");
    } else if (replacementMethod === "modification") {
      assetLifetimeYears = decimalConstant("4");
    } else {
      const rated = cappedRatedLightingLifetime(
        inputs,
        replacementMethod === "retrofit"
          ? "upgrade_rated_lifetime_hours"
          : "incumbent_rated_lifetime_hours",
        replacementMethod === "retrofit"
          ? "Approved upgrade lamp rated lifetime"
          : "Incumbent lamp rated lifetime",
        annualOperatingHours,
        "4",
      );
      ratedLifetimeHours = rated.ratedLifetimeHours;
      assetLifetimeYears = rated.assetLifetimeYears;
    }
  }
  const lifetime = lightingLifetime(assetLifetimeYears, annualOperatingHours);
  const regionalFactor = decimalConstant(
    geography === "metropolitan"
      ? CREDITEX_VEU_METROPOLITAN_FACTOR
      : CREDITEX_VEU_REGIONAL_FACTOR,
  );
  const result = multiply(multiply(subtract(baseline, upgrade), lifetime), regionalFactor);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      sitePartJ6Status: "not_required",
      geography,
      spaceAirConditioned: airConditioned,
      annualOperatingHours: exactFraction(annualOperatingHours),
      baselineLcpW: exactFraction(baselineLcp),
      baselineControl: baselineControl.snapshot,
      baselineControlMultiplier: exactFraction(baselineControl.multiplier),
      upgradeLcpW: exactFraction(upgradeLcp),
      upgradeControl: upgradeControl?.snapshot ?? null,
      upgradeControlMultiplier: upgradeControl ? exactFraction(upgradeControl.multiplier) : "0/1",
      replacementMethod,
      ratedLifetimeHours: ratedLifetimeHours ? exactFraction(ratedLifetimeHours) : null,
      assetLifetimeYears: exactFraction(assetLifetimeYears),
      airConditioningMultiplier: exactFraction(airConditioningMultiplier),
      incumbentSourceCount: exactFraction(incumbentSourceCount),
      upgradeSourceCount: upgradeSourceCount ? exactFraction(upgradeSourceCount) : null,
      vruCompatibilityConfirmed: scenario === "34B" ? "yes" : null,
      removalRequirementsConfirmed: scenario === "34D" || scenario === "34E" ? "yes" : null,
      product: evidence,
    },
    trace: [
      traceEntry("baseline", "Baseline lighting emissions rate", `${exactFraction(baselineLcp)} W; CM ${exactFraction(baselineControl.multiplier)}; AM ${exactFraction(airConditioningMultiplier)}; ${exactFraction(incumbentSourceCount)} incumbent sources`, "sum incumbent LCP x CM x AM x EEF", baseline, "tCO2-e/Mh"),
      traceEntry("upgrade", "Upgrade lighting emissions rate", `${exactFraction(upgradeLcp)} W; CM ${upgradeControl ? exactFraction(upgradeControl.multiplier) : "0/1"}; AM ${exactFraction(airConditioningMultiplier)}; ${upgradeSourceCount ? exactFraction(upgradeSourceCount) : "0/1"} upgrade sources`, "sum upgrade LCP x CM x AM x EEF", upgrade, "tCO2-e/Mh"),
      traceEntry("lifetime", "Lighting lifetime factor", `${exactFraction(assetLifetimeYears)} years; ${exactFraction(annualOperatingHours)} hours/year`, "asset lifetime x annual operating hours x 10^-6", lifetime, "Mh"),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", `${exactFraction(baseline)} - ${exactFraction(upgrade)}`, `(independent incumbent sum - independent upgrade sum) x lifetime x regional factor ${exactFraction(regionalFactor)}`, result),
    ],
  };
}

function calculatePart35(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "geography",
    "area_type",
    "baseline_lcp_w",
    "baseline_control_profile",
    "approved_upgrade_lcp_w",
    "approved_upgrade_control_profile",
    "retained_upgrade_lcp_w",
    "retained_upgrade_control_profile",
    "replacement_method",
    "upgrade_rated_lifetime_hours",
    "incumbent_rated_lifetime_hours",
    "incumbent_source_count",
    "upgrade_source_count",
    "removal_requirements_confirmed",
  ], "Part 35 input");
  const scenario = selectInput(inputs, "scenario", "Part 35 scenario", ["35A", "35B", "35C", "35D"] as const);
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const areaType = selectInput(
    inputs,
    "area_type",
    "Table 35.9 area type",
    ["road_or_public_outdoor_space", "other"] as const,
  );
  const annualOperatingHours = decimalConstant(areaType === "road_or_public_outdoor_space" ? "4500" : "1000");
  const baselineLcp = decimalInput(inputs, "baseline_lcp_w", "Governed incumbent lamp circuit power");
  const baselineControl = simpleLightingControl(
    inputs,
    "baseline_control_profile",
    "Incumbent Table 35.7 control profile",
  );
  const incumbentSourceCount = decimalInput(
    inputs,
    "incumbent_source_count",
    "Incumbent lighting-source count",
    { integer: true },
  );
  const upgradeSourceCount = scenario === "35D"
    ? null
    : decimalInput(
      inputs,
      "upgrade_source_count",
      "Upgrade lighting-source count",
      { integer: true },
    );
  if (scenario === "35D") {
    rejectNotApplicableInputs(inputs, ["upgrade_source_count"], "scenario 35D upgrade-source");
  }
  if (scenario === "35A" && upgradeSourceCount) {
    requireEqualLightingSourceCounts(scenario, incumbentSourceCount, upgradeSourceCount);
  } else if (scenario === "35C" && upgradeSourceCount) {
    requireEligibleDelampingCounts(scenario, incumbentSourceCount, upgradeSourceCount);
  }
  let upgradeLcp: Fraction;
  let upgradeControl: ReturnType<typeof simpleLightingControl> | null;
  let evidence: ReturnType<typeof validateProductEvidence> | null;
  if (scenario === "35A" || scenario === "35B") {
    upgradeLcp = scenario === "35A"
      ? baselineLcp
      : decimalInput(inputs, "approved_upgrade_lcp_w", "Approved upgrade lamp circuit power");
    upgradeControl = simpleLightingControl(
      inputs,
      "approved_upgrade_control_profile",
      "Approved Table 35.7 control profile",
    );
    evidence = validateProductEvidence(product, installationDate, "VEU", [scenario]);
  } else if (scenario === "35C") {
    upgradeLcp = decimalInput(inputs, "retained_upgrade_lcp_w", "Retained lamp circuit power per lighting source after delamping");
    upgradeControl = simpleLightingControl(
      inputs,
      "retained_upgrade_control_profile",
      "Retained Table 35.7 control profile",
    );
    confirmedInput(inputs, "removal_requirements_confirmed", "Scenario 35C delamping and control-gear requirements");
    evidence = validateNoProductEvidence(product, "35");
  } else {
    upgradeLcp = ZERO;
    upgradeControl = null;
    confirmedInput(inputs, "removal_requirements_confirmed", "Scenario 35D removal and decommissioning requirements");
    evidence = validateNoProductEvidence(product, "35");
  }
  if (scenario === "35A" && upgradeControl && compare(upgradeControl.multiplier, baselineControl.multiplier) >= 0) {
    fail("VEU_SYSTEM_INELIGIBLE", "Scenario 35A requires the approved lighting control to reduce the incumbent control multiplier.", 409);
  }
  const baseline = multiply(
    multiply(multiply(baselineLcp, baselineControl.multiplier), EEF),
    incumbentSourceCount,
  );
  const upgrade = upgradeControl && upgradeSourceCount
    ? multiply(
      multiply(multiply(upgradeLcp, upgradeControl.multiplier), EEF),
      upgradeSourceCount,
    )
    : ZERO;
  let assetLifetimeYears: Fraction;
  let replacementMethod: string | null = null;
  let ratedLifetimeHours: Fraction | null = null;
  if (scenario === "35A" || scenario === "35C") {
    assetLifetimeYears = decimalConstant("5");
  } else if (scenario === "35D") {
    assetLifetimeYears = decimalConstant("10");
  } else {
    replacementMethod = selectInput(
      inputs,
      "replacement_method",
      "Scenario 35B replacement method",
      ["luminaire_replacement", "modification", "retrofit", "other"] as const,
    );
    if (replacementMethod === "luminaire_replacement") {
      assetLifetimeYears = decimalConstant("10");
    } else if (replacementMethod === "modification") {
      assetLifetimeYears = decimalConstant("5");
    } else {
      const rated = cappedRatedLightingLifetime(
        inputs,
        replacementMethod === "retrofit"
          ? "upgrade_rated_lifetime_hours"
          : "incumbent_rated_lifetime_hours",
        replacementMethod === "retrofit"
          ? "Approved upgrade lamp rated lifetime"
          : "Incumbent lamp rated lifetime",
        annualOperatingHours,
        "5",
      );
      ratedLifetimeHours = rated.ratedLifetimeHours;
      assetLifetimeYears = rated.assetLifetimeYears;
    }
  }
  const lifetime = lightingLifetime(assetLifetimeYears, annualOperatingHours);
  const regionalFactor = decimalConstant(
    geography === "metropolitan"
      ? CREDITEX_VEU_METROPOLITAN_FACTOR
      : CREDITEX_VEU_REGIONAL_FACTOR,
  );
  const result = multiply(multiply(subtract(baseline, upgrade), lifetime), regionalFactor);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      geography,
      areaType,
      annualOperatingHours: exactFraction(annualOperatingHours),
      baselineLcpW: exactFraction(baselineLcp),
      baselineControlProfile: baselineControl.profile,
      baselineControlMultiplier: exactFraction(baselineControl.multiplier),
      upgradeLcpW: exactFraction(upgradeLcp),
      upgradeControlProfile: upgradeControl?.profile ?? "not_applicable",
      upgradeControlMultiplier: upgradeControl ? exactFraction(upgradeControl.multiplier) : "0/1",
      replacementMethod,
      ratedLifetimeHours: ratedLifetimeHours ? exactFraction(ratedLifetimeHours) : null,
      assetLifetimeYears: exactFraction(assetLifetimeYears),
      incumbentSourceCount: exactFraction(incumbentSourceCount),
      upgradeSourceCount: upgradeSourceCount ? exactFraction(upgradeSourceCount) : null,
      removalRequirementsConfirmed: scenario === "35C" || scenario === "35D" ? "yes" : null,
      product: evidence,
    },
    trace: [
      traceEntry("baseline", "Baseline lighting emissions rate", `${exactFraction(baselineLcp)} W; CM ${exactFraction(baselineControl.multiplier)}; ${exactFraction(incumbentSourceCount)} incumbent sources`, "sum incumbent LCP x CM x EEF", baseline, "tCO2-e/Mh"),
      traceEntry("upgrade", "Upgrade lighting emissions rate", `${exactFraction(upgradeLcp)} W; CM ${upgradeControl ? exactFraction(upgradeControl.multiplier) : "0/1"}; ${upgradeSourceCount ? exactFraction(upgradeSourceCount) : "0/1"} upgrade sources`, "sum upgrade LCP x CM x EEF", upgrade, "tCO2-e/Mh"),
      traceEntry("lifetime", "Lighting lifetime factor", `${exactFraction(assetLifetimeYears)} years; ${exactFraction(annualOperatingHours)} hours/year`, "asset lifetime x annual operating hours x 10^-6", lifetime, "Mh"),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", `${exactFraction(baseline)} - ${exactFraction(upgrade)}`, `(independent incumbent sum - independent upgrade sum) x lifetime x regional factor ${exactFraction(regionalFactor)}`, result),
    ],
  };
}

const PART_28_REGIONAL_FACTORS: Record<CreditexVeuLocationClass, string> = {
  metro_mild: "1.00",
  metro_cold: "1.62",
  regional_mild: "1.01",
  regional_cold: "1.63",
  regional_hot: "0.70",
};

function calculatePart28(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "location_class",
    "heater_output_status",
    "heater_thermal_output_kw",
    "r_value",
  ], "Part 28 input");
  const scenario = selectInput(inputs, "scenario", "Part 28 scenario", ["28A", "28B"] as const);
  const location = selectInput(
    inputs,
    "location_class",
    "VEU climatic location",
    CREDITEX_VEU_LOCATION_CLASSES,
  );
  const outputStatus = selectInput(
    inputs,
    "heater_output_status",
    "heater thermal-output status",
    ["known", "unknown"] as const,
  );
  const output = outputStatus === "known"
    ? decimalInput(inputs, "heater_thermal_output_kw", "Heater thermal output")
    : null;
  if (output && compare(output, decimalConstant("10")) < 0) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      "A known heater thermal output must be at least 10 kW for Part 28.",
      409,
    );
  }
  const rValue = decimalInput(inputs, "r_value", "Approved ductwork R-value");
  ensureAtLeast(
    rValue,
    "1.5",
    "The selected Part 28 ductwork must have an R-value of at least 1.5 under AS/NZS 4859.1.",
  );
  const size = !output
    ? "unknown"
    : compare(output, decimalConstant("18")) <= 0
      ? "small"
      : compare(output, decimalConstant("28")) <= 0
        ? "medium"
        : "large";
  const branch = size === "small" || size === "unknown"
    ? { baselineConstant: "2.59", baselineEef: "0.26", upgradeConstant: "2.04", upgradeEef: "0.20" }
    : size === "medium"
      ? { baselineConstant: "3.27", baselineEef: "0.33", upgradeConstant: "2.57", upgradeEef: "0.26" }
      : { baselineConstant: "4.13", baselineEef: "0.42", upgradeConstant: "3.24", upgradeEef: "0.33" };
  const baseline = add(
    decimalConstant(branch.baselineConstant),
    multiply(decimalConstant(branch.baselineEef), EEF),
  );
  const upgrade = add(
    decimalConstant(branch.upgradeConstant),
    multiply(decimalConstant(branch.upgradeEef), EEF),
  );
  const regionalFactor = decimalConstant(PART_28_REGIONAL_FACTORS[location]);
  const result = multiply(
    multiply(subtract(baseline, upgrade), decimalConstant("14")),
    regionalFactor,
  );
  const evidence = validateProductEvidence(product, installationDate, "VEU", [scenario]);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      locationClass: location,
      heaterOutputStatus: outputStatus,
      heaterThermalOutputKw: output ? exactFraction(output) : null,
      heaterSizeClass: size,
      rValue: exactFraction(rValue),
      product: evidence,
    },
    trace: [
      traceEntry("baseline", "Baseline emissions", size, `${branch.baselineConstant} + ${branch.baselineEef} x EEF`, baseline, "tCO2-e/year"),
      traceEntry("upgrade", "Upgrade emissions", size, `${branch.upgradeConstant} + ${branch.upgradeEef} x EEF`, upgrade, "tCO2-e/year"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(baseline)} - ${exactFraction(upgrade)}`, `(baseline - upgrade) x 14 years x regional factor ${PART_28_REGIONAL_FACTORS[location]}`, result),
    ],
  };
}

function calculatePart30(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "geography",
    "gas_reticulation",
    "installation_count",
  ], "Part 30 input");
  const scenario = selectInput(inputs, "scenario", "Part 30 scenario", ["30A", "30B"] as const);
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const gasReticulation = selectInput(
    inputs,
    "gas_reticulation",
    "gas-reticulation status",
    ["reticulated", "not_reticulated"] as const,
  );
  const count = decimalInput(inputs, "installation_count", "Installation count", { integer: true });
  const electricitySavings = decimalConstant(gasReticulation === "reticulated" ? "0.39" : "0.51");
  const regionalFactor = decimalConstant(
    geography === "metropolitan"
      ? CREDITEX_VEU_METROPOLITAN_FACTOR
      : CREDITEX_VEU_REGIONAL_FACTOR,
  );
  const perUnit = multiply(
    multiply(multiply(electricitySavings, EEF), decimalConstant("5")),
    regionalFactor,
  );
  const result = multiply(perUnit, count);
  const evidence = validateProductEvidence(product, installationDate, "VEU", [scenario]);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      geography,
      gasReticulation,
      installationCount: exactFraction(count),
      product: evidence,
    },
    trace: [
      traceEntry("electricity_savings", "Annual electricity savings", gasReticulation, "Table 30.2 gas-reticulation branch", electricitySavings, "MWh/unit/year"),
      traceEntry("per_unit_reduction", "GHG reduction per in-home display", exactFraction(electricitySavings), `electricity savings x EEF x 5 years x regional factor ${exactFraction(regionalFactor)}`, perUnit),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", exactFraction(count), "per-unit reduction x installation count", result),
    ],
  };
}

const PART_31_RATED_OUTPUTS = [
  "0.75", "1.1", "1.5", "2.2", "3", "4", "5.5", "7.5", "11", "15", "18.5",
  "22", "30", "37", "45", "55", "75", "90", "110", "132", "150", "185",
] as const;

const PART_31_SAVINGS = {
  "31A": [
    "0.0249", "0.0326", "0.0400", "0.0545", "0.0666", "0.0792", "0.102", "0.122", "0.214", "0.269", "0.306",
    "0.361", "0.451", "0.509", "0.620", "0.751", "0.922", "1.15", "1.32", "1.57", "1.78", "2.28",
  ],
  "31B": [
    "0.0502", "0.0673", "0.0831", "0.121", "0.173", "0.208", "0.263", "0.329", "0.413", "0.523", "0.645",
    "0.736", "0.889", "1.05", "1.28", "1.49", "1.83", "2.07", "2.39", "2.70", "3.05", "3.53",
  ],
} as const;

function part31Lifetime(index: number) {
  if (index <= 3) return "12";
  if (index <= 7) return "15";
  if (index <= 13) return "20";
  if (index <= 17) return "22";
  return "25";
}

function calculatePart31(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "geography",
    "rated_output_kw",
    "installation_count",
    "co_payment_per_motor_aud",
  ], "Part 31 input");
  const scenario = selectInput(inputs, "scenario", "Part 31 scenario", ["31A", "31B"] as const);
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const ratedOutput = selectInput(
    inputs,
    "rated_output_kw",
    "rated motor output",
    PART_31_RATED_OUTPUTS,
  );
  const count = decimalInput(inputs, "installation_count", "Installation count", { integer: true });
  const coPayment = decimalInput(
    inputs,
    "co_payment_per_motor_aud",
    "Co-payment per motor",
    { allowZero: true },
  );
  ensureAtLeast(
    coPayment,
    "200",
    "Part 31 requires a minimum co-payment of $200 including GST per motor.",
  );
  const index = PART_31_RATED_OUTPUTS.indexOf(ratedOutput);
  const electricitySavings = decimalConstant(PART_31_SAVINGS[scenario][index]);
  const lifetime = decimalConstant(part31Lifetime(index));
  const regionalFactor = decimalConstant(
    geography === "metropolitan"
      ? CREDITEX_VEU_METROPOLITAN_FACTOR
      : CREDITEX_VEU_REGIONAL_FACTOR,
  );
  const perMotor = multiply(
    multiply(multiply(electricitySavings, EEF), lifetime),
    regionalFactor,
  );
  const result = multiply(perMotor, count);
  const evidence = scenario === "31A"
    ? validateProductEvidence(product, installationDate, "GEMS", ["electric_motor"])
    : validateProductEvidence(product, installationDate, "VEU", ["31B"]);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      geography,
      ratedOutputKw: ratedOutput,
      installationCount: exactFraction(count),
      coPaymentPerMotorAud: exactFraction(coPayment),
      product: evidence,
    },
    trace: [
      traceEntry("electricity_savings", "Annual electricity savings", `${scenario}; ${ratedOutput} kW`, "Table 31.4 or Table 31.5 rated-output branch", electricitySavings, "MWh/motor/year"),
      traceEntry("lifetime", "Asset lifetime", ratedOutput, "Table 31.4 or Table 31.5 rated-output branch", lifetime, "years"),
      traceEntry("per_motor_reduction", "GHG reduction per motor", exactFraction(electricitySavings), `electricity savings x EEF x lifetime x regional factor ${exactFraction(regionalFactor)}`, perMotor),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", exactFraction(count), "per-motor reduction x installation count", result),
    ],
  };
}

type Part32ScenarioOneClass = {
  baselineEei: string;
  m: string;
  n: string;
  lifetimeBelow3_3: string;
  lifetimeAtLeast3_3: string;
};

const PART_32_SCENARIO_ONE_CLASSES: Record<string, Part32ScenarioOneClass> = {
  "1": { baselineEei: "130", m: "3.7", n: "3.5", lifetimeBelow3_3: "8", lifetimeAtLeast3_3: "8" },
  "2": { baselineEei: "92", m: "4.2", n: "9.8", lifetimeBelow3_3: "8", lifetimeAtLeast3_3: "8" },
  "6": { baselineEei: "76", m: "10.4", n: "30.4", lifetimeBelow3_3: "8", lifetimeAtLeast3_3: "8" },
  "7": { baselineEei: "90", m: "9.1", n: "9.1", lifetimeBelow3_3: "8", lifetimeAtLeast3_3: "12" },
  "8": { baselineEei: "97", m: "1.6", n: "19.1", lifetimeBelow3_3: "8", lifetimeAtLeast3_3: "12" },
  "11": { baselineEei: "130", m: "0.69", n: "5.97", lifetimeBelow3_3: "8", lifetimeAtLeast3_3: "12" },
  "12": { baselineEei: "130", m: "3.7", n: "3.5", lifetimeBelow3_3: "12", lifetimeAtLeast3_3: "12" },
  "13": { baselineEei: "80", m: "4.2", n: "9.8", lifetimeBelow3_3: "12", lifetimeAtLeast3_3: "12" },
  "14": { baselineEei: "91", m: "9.1", n: "9.1", lifetimeBelow3_3: "12", lifetimeAtLeast3_3: "12" },
  "15": { baselineEei: "106", m: "1.6", n: "19.1", lifetimeBelow3_3: "12", lifetimeAtLeast3_3: "12" },
};

const PART_32_SCENARIO_THREE_CLASSES = {
  "3": { heavyBaselineEei: "73", otherBaselineEei: "71", m: "2.555", n: "1790" },
  "4": { heavyBaselineEei: "89", otherBaselineEei: "80", m: "5.84", n: "2380" },
  "9": { heavyBaselineEei: "91", otherBaselineEei: "79", m: "1.643", n: "609" },
  "10": { heavyBaselineEei: "96", otherBaselineEei: "80", m: "4.928", n: "1472" },
} as const;

function calculatePart32(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "geography",
    "product_class",
    "product_eei",
    "total_display_area_m2",
    "tec_kwh_per_24h",
    "net_volume_litres",
    "duty_type",
    "installation_count",
  ], "Part 32 input");
  const scenario = selectInput(
    inputs,
    "scenario",
    "Part 32 scenario",
    ["32A(i)", "32A(ii)", "32A(iii)"] as const,
  );
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const productClass = selectInput(
    inputs,
    "product_class",
    "GEMS 2020 product class",
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"] as const,
  );
  const eei = decimalInput(inputs, "product_eei", "Product Energy Efficiency Index", { allowZero: true });
  const tec = decimalInput(inputs, "tec_kwh_per_24h", "Total Energy Consumption");
  const count = decimalInput(inputs, "installation_count", "Installation count", { integer: true });
  const regionalFactor = decimalConstant(
    geography === "metropolitan"
      ? CREDITEX_VEU_METROPOLITAN_FACTOR
      : CREDITEX_VEU_REGIONAL_FACTOR,
  );
  let baseline: Fraction;
  let upgrade: Fraction;
  let lifetime: Fraction;
  let formulaDifference: Fraction;
  let formulaScale: Fraction;
  let scenarioInputs: Record<string, unknown>;

  if (scenario === "32A(i)") {
    const branch = PART_32_SCENARIO_ONE_CLASSES[productClass];
    if (!branch) {
      fail("VEU_SYSTEM_INELIGIBLE", `GEMS product class ${productClass} is not eligible for scenario 32A(i).`, 409);
    }
    if (compare(eei, decimalConstant("81")) >= 0) {
      fail("VEU_SYSTEM_INELIGIBLE", "Scenario 32A(i) requires an Energy Efficiency Index below 81.", 409);
    }
    const tda = decimalInput(inputs, "total_display_area_m2", "Total display area");
    baseline = multiply(
      divide(decimalConstant(branch.baselineEei), decimalConstant("100")),
      add(decimalConstant(branch.m), multiply(decimalConstant(branch.n), tda)),
    );
    upgrade = tec;
    lifetime = decimalConstant(
      compare(tda, decimalConstant("3.3")) < 0
        ? branch.lifetimeBelow3_3
        : branch.lifetimeAtLeast3_3,
    );
    formulaDifference = subtract(baseline, upgrade);
    formulaScale = multiply(decimalConstant("365.24"), decimalConstant("0.001"));
    scenarioInputs = { totalDisplayAreaM2: exactFraction(tda) };
  } else if (scenario === "32A(ii)") {
    if (productClass !== "5") {
      fail("VEU_SYSTEM_INELIGIBLE", "Scenario 32A(ii) requires GEMS product class 5 (IFH-5).", 409);
    }
    if (compare(eei, decimalConstant("51")) >= 0) {
      fail("VEU_SYSTEM_INELIGIBLE", "Scenario 32A(ii) requires an Energy Efficiency Index below 51.", 409);
    }
    const volume = decimalInput(inputs, "net_volume_litres", "Net volume");
    baseline = multiply(
      decimalConstant("1.30"),
      add(decimalConstant("1"), multiply(decimalConstant("0.009"), volume)),
    );
    upgrade = tec;
    lifetime = decimalConstant("8");
    formulaDifference = subtract(baseline, upgrade);
    formulaScale = multiply(decimalConstant("365.24"), decimalConstant("0.001"));
    scenarioInputs = { netVolumeLitres: exactFraction(volume) };
  } else {
    const branch = PART_32_SCENARIO_THREE_CLASSES[productClass as keyof typeof PART_32_SCENARIO_THREE_CLASSES];
    if (!branch) {
      fail("VEU_SYSTEM_INELIGIBLE", `GEMS product class ${productClass} is not eligible for scenario 32A(iii).`, 409);
    }
    if (compare(eei, decimalConstant("81")) >= 0) {
      fail("VEU_SYSTEM_INELIGIBLE", "Scenario 32A(iii) requires an Energy Efficiency Index below 81.", 409);
    }
    const volume = decimalInput(inputs, "net_volume_litres", "Net volume");
    const dutyType = selectInput(
      inputs,
      "duty_type",
      "duty type",
      ["light_duty_chiller", "light_duty_freezer", "normal_duty", "heavy_duty"] as const,
    );
    const baselineEei = dutyType === "heavy_duty"
      ? branch.heavyBaselineEei
      : branch.otherBaselineEei;
    const adjustmentFactor = decimalConstant(
      dutyType === "light_duty_chiller"
        ? "1.2"
        : dutyType === "light_duty_freezer"
          ? "1.1"
          : "1",
    );
    baseline = multiply(
      divide(decimalConstant(baselineEei), decimalConstant("100")),
      add(decimalConstant(branch.n), multiply(decimalConstant(branch.m), volume)),
    );
    upgrade = multiply(multiply(tec, adjustmentFactor), decimalConstant("365.24"));
    lifetime = decimalConstant("8");
    formulaDifference = subtract(baseline, upgrade);
    formulaScale = decimalConstant("0.001");
    scenarioInputs = {
      netVolumeLitres: exactFraction(volume),
      dutyType,
      adjustmentFactor: exactFraction(adjustmentFactor),
    };
  }
  if (compare(formulaDifference, ZERO) <= 0) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      "The selected refrigerated cabinet does not produce positive electricity savings under the applicable Part 32 baseline.",
      409,
    );
  }
  const perCabinet = multiply(
    multiply(
      multiply(formulaDifference, formulaScale),
      lifetime,
    ),
    multiply(regionalFactor, EEF),
  );
  const result = multiply(perCabinet, count);
  const evidence = validateProductEvidence(
    product,
    installationDate,
    "GEMS",
    ["commercial_refrigerator"],
  );
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      geography,
      productClass,
      productEei: exactFraction(eei),
      tecKwhPer24h: exactFraction(tec),
      installationCount: exactFraction(count),
      ...scenarioInputs,
      product: evidence,
    },
    trace: [
      traceEntry("baseline", "Baseline energy", `${scenario}; class ${productClass}`, "applicable Table 32.4, 32.5 or 32.6 baseline formula", baseline, scenario === "32A(iii)" ? "kWh/year" : "kWh/day"),
      traceEntry("upgrade", "Upgrade energy", exactFraction(tec), scenario === "32A(iii)" ? "TEC x duty adjustment x 365.24" : "TEC", upgrade, scenario === "32A(iii)" ? "kWh/year" : "kWh/day"),
      traceEntry("per_cabinet_reduction", "GHG reduction per cabinet", exactFraction(formulaDifference), "(baseline - upgrade) x applicable day/year scale x lifetime x regional factor x EEF", perCabinet),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", exactFraction(count), "per-cabinet reduction x installation count", result),
    ],
  };
}

function calculatePart33(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "geography",
    "rotor_motor_type",
    "input_power_w",
    "output_power_w",
    "refrigeration_application",
    "installation_count",
  ], "Part 33 input");
  const scenario = selectInput(inputs, "scenario", "Part 33 scenario", ["33A", "33B"] as const);
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const rotorType = selectInput(
    inputs,
    "rotor_motor_type",
    "rotor motor type",
    ["internal", "external"] as const,
  );
  const inputPower = decimalInput(inputs, "input_power_w", "New fan input power");
  const outputPower = decimalInput(inputs, "output_power_w", "Rated motor output power");
  if (rotorType === "internal" && compare(outputPower, decimalConstant("600")) > 0) {
    fail("VEU_SYSTEM_INELIGIBLE", "An internal-rotor Part 33 motor must have rated output of no more than 600 W.", 409);
  }
  if (rotorType === "external" && compare(inputPower, decimalConstant("800")) > 0) {
    fail("VEU_SYSTEM_INELIGIBLE", "An external-rotor Part 33 motor must have rated input of no more than 800 W.", 409);
  }
  const refrigerationApplication = scenario === "33A"
    ? selectInput(
      inputs,
      "refrigeration_application",
      "refrigeration application",
      ["refrigerated_cabinet", "cold_room_below_zero_c", "cold_room_at_or_above_zero_c"] as const,
    )
    : null;
  const count = decimalInput(inputs, "installation_count", "Installation count", { integer: true });
  const transformedInput = add(
    multiply(inputPower, decimalConstant("1.77")),
    decimalConstant("19.39"),
  );
  const cop = refrigerationApplication === "refrigerated_cabinet"
    ? decimalConstant("2.80")
    : refrigerationApplication === "cold_room_below_zero_c"
      ? decimalConstant("1.80")
      : refrigerationApplication === "cold_room_at_or_above_zero_c"
        ? decimalConstant("2.56")
        : null;
  const copFactor = cop
    ? add(decimalConstant("1"), divide(decimalConstant("1"), cop))
    : decimalConstant("1");
  const baseline = multiply(
    multiply(decimalConstant("0.00438"), transformedInput),
    copFactor,
  );
  const upgrade = multiply(
    multiply(decimalConstant("0.00438"), inputPower),
    copFactor,
  );
  const regionalFactor = decimalConstant(
    geography === "metropolitan"
      ? CREDITEX_VEU_METROPOLITAN_FACTOR
      : CREDITEX_VEU_REGIONAL_FACTOR,
  );
  const perMotor = multiply(
    multiply(multiply(subtract(baseline, upgrade), EEF), decimalConstant("7")),
    regionalFactor,
  );
  const result = multiply(perMotor, count);
  const evidence = validateProductEvidence(product, installationDate, "VEU", [scenario]);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      geography,
      rotorMotorType: rotorType,
      inputPowerW: exactFraction(inputPower),
      outputPowerW: exactFraction(outputPower),
      refrigerationApplication,
      installationCount: exactFraction(count),
      product: evidence,
    },
    trace: [
      traceEntry("baseline", "Baseline fan energy", `${exactFraction(inputPower)} W NFIP${cop ? `; COP ${exactFraction(cop)}` : ""}`, "0.00438 x (NFIP x 1.77 + 19.39) x applicable COP factor", baseline, "MWh/year"),
      traceEntry("upgrade", "Upgrade fan energy", exactFraction(inputPower), "0.00438 x NFIP x applicable COP factor", upgrade, "MWh/year"),
      traceEntry("per_motor_reduction", "GHG reduction per fan motor", `${exactFraction(baseline)} - ${exactFraction(upgrade)}`, `(baseline - upgrade) x EEF x 7 years x regional factor ${exactFraction(regionalFactor)}`, perMotor),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", exactFraction(count), "per-motor reduction x installation count", result),
    ],
  };
}

function calculatePart36(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, ["scenario", "geography", "installation_count"], "Part 36 input");
  const scenario = selectInput(
    inputs,
    "scenario",
    "Part 36 scenario",
    ["36A(i)", "36A(ii)"] as const,
  );
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const count = decimalInput(inputs, "installation_count", "Installation count", { integer: true });
  const baseline = add(decimalConstant("0.53"), multiply(decimalConstant("1.21"), EEF));
  const upgrade = add(decimalConstant("0.24"), multiply(decimalConstant("0.54"), EEF));
  const regionalFactor = decimalConstant(geography === "metropolitan" ? "0.92" : "1.21");
  const perValve = multiply(
    multiply(subtract(baseline, upgrade), decimalConstant("5")),
    regionalFactor,
  );
  const result = multiply(perValve, count);
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["36A"]);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      geography,
      installationCount: exactFraction(count),
      product: evidence,
    },
    trace: [
      traceEntry("baseline", "Baseline emissions", "0.53 + 1.21 x EEF", "Part 36 baseline formula", baseline, "tCO2-e/valve/year"),
      traceEntry("upgrade", "Upgrade emissions", "0.24 + 0.54 x EEF", "Part 36 upgrade formula", upgrade, "tCO2-e/valve/year"),
      traceEntry("per_valve_reduction", "GHG reduction per pre-rinse spray valve", `${exactFraction(baseline)} - ${exactFraction(upgrade)}`, `(baseline - upgrade) x 5 years x regional factor ${exactFraction(regionalFactor)}`, perValve),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", exactFraction(count), "per-valve reduction x installation count", result),
    ],
  };
}

const INDUSTRIAL_GAS_LUF = decimalConstant("0.206");
const HOURS_PER_YEAR = decimalConstant("8760");

function industrialGasReduction(
  consumption: Fraction,
  dei: Fraction,
  lifetimeYears: string,
) {
  return multiply(
    multiply(
      multiply(consumption, dei),
      INDUSTRIAL_GAS_LUF,
    ),
    multiply(HOURS_PER_YEAR, decimalConstant(lifetimeYears)),
  );
}

function validateBoilerControlRequirement(
  replacementConsumption: Fraction,
  controlSystem: "not_required" | "electronic_gas_air_ratio" | "electronic_gas_air_ratio_with_combustion_trim",
) {
  if (
    compare(replacementConsumption, decimalConstant("7500")) > 0
    && controlSystem !== "electronic_gas_air_ratio_with_combustion_trim"
  ) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      "Replacement equipment above 7,500 MJ/h requires an electronic gas/air ratio control system receiving a flue-gas-sensor signal for combustion trim.",
      409,
    );
  }
  if (
    compare(replacementConsumption, decimalConstant("3700")) > 0
    && compare(replacementConsumption, decimalConstant("7500")) <= 0
    && controlSystem === "not_required"
  ) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      "Replacement equipment above 3,700 MJ/h requires an electronic gas/air ratio control system.",
      409,
    );
  }
}

function calculatePart37(
  inputs: UnknownRecord,
  product: unknown,
): Execution {
  exactKeys(inputs, [
    "incumbent_nominal_gas_consumption_mj_per_h",
    "replacement_nominal_gas_consumption_mj_per_h",
    "incumbent_equipment_age_years",
    "incumbent_manufacture_period",
    "incumbent_burner_age_band",
    "replacement_gross_thermal_efficiency_percent",
    "replacement_control_system",
  ], "Part 37 input");
  const incumbentConsumption = decimalInput(
    inputs,
    "incumbent_nominal_gas_consumption_mj_per_h",
    "Incumbent nominal gas consumption",
  );
  const replacementConsumption = decimalInput(
    inputs,
    "replacement_nominal_gas_consumption_mj_per_h",
    "Replacement nominal gas consumption",
  );
  const incumbentAge = decimalInput(
    inputs,
    "incumbent_equipment_age_years",
    "Incumbent equipment age",
  );
  ensureAtLeast(
    incumbentAge,
    "10",
    "The incumbent steam boiler must have been manufactured at least 10 years before decommissioning.",
  );
  const manufacturePeriod = selectInput(
    inputs,
    "incumbent_manufacture_period",
    "incumbent manufacture period",
    ["1989_or_earlier", "1990_or_later"] as const,
  );
  const burnerAgeBand = selectInput(
    inputs,
    "incumbent_burner_age_band",
    "incumbent burner age band",
    ["over_10_years", "up_to_10_years"] as const,
  );
  const efficiency = decimalInput(
    inputs,
    "replacement_gross_thermal_efficiency_percent",
    "Replacement gross thermal efficiency",
    { maximum: "100" },
  );
  ensureAtLeast(
    efficiency,
    "80",
    "The replacement steam boiler must have a gross thermal efficiency of at least 80%.",
  );
  const controlSystem = selectInput(
    inputs,
    "replacement_control_system",
    "replacement control system",
    [
      "not_required",
      "electronic_gas_air_ratio",
      "electronic_gas_air_ratio_with_combustion_trim",
    ] as const,
  );
  validateBoilerControlRequirement(replacementConsumption, controlSystem);
  validateNoProductEvidence(product, "37");

  const consumption = minimum(incumbentConsumption, replacementConsumption);
  const highEfficiency = compare(efficiency, decimalConstant("85")) >= 0;
  const deiValue = manufacturePeriod === "1989_or_earlier"
    ? burnerAgeBand === "over_10_years"
      ? highEfficiency ? "0.00000547" : "0.00000271"
      : highEfficiency ? "0.00000498" : "0.00000222"
    : burnerAgeBand === "over_10_years"
      ? highEfficiency ? "0.00000525" : "0.00000249"
      : highEfficiency ? "0.00000476" : "0.00000200";
  const dei = decimalConstant(deiValue);
  const result = industrialGasReduction(consumption, dei, "20");
  ensurePositiveResult(result);
  return {
    scenario: "37A",
    result,
    inputSnapshot: {
      incumbentNominalGasConsumptionMjPerH: exactFraction(incumbentConsumption),
      replacementNominalGasConsumptionMjPerH: exactFraction(replacementConsumption),
      governedConsumptionMjPerH: exactFraction(consumption),
      incumbentEquipmentAgeYears: exactFraction(incumbentAge),
      incumbentManufacturePeriod: manufacturePeriod,
      incumbentBurnerAgeBand: burnerAgeBand,
      replacementGrossThermalEfficiencyPercent: exactFraction(efficiency),
      replacementControlSystem: controlSystem,
      product: null,
    },
    trace: [
      traceEntry("consumption", "Governed nominal gas consumption", "lower of incumbent and replacement nominal gas consumption", "min(incumbent, replacement)", consumption, "MJ/h"),
      traceEntry("dei", "Default energy improvement", `${manufacturePeriod}; ${burnerAgeBand}; ${highEfficiency ? "efficiency >= 85%" : "80% <= efficiency < 85%"}`, "Table 37.3 branch", dei, "tCO2-e/MJ"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(consumption)} x ${deiValue}`, "Consumption x DEI x 0.206 LUF x 8760 hours x 20 years", result),
    ],
  };
}

function calculatePart38(
  inputs: UnknownRecord,
  product: unknown,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "incumbent_nominal_gas_consumption_mj_per_h",
    "replacement_nominal_gas_consumption_mj_per_h",
    "incumbent_equipment_age_years",
    "part_j5_2d_refurbishment",
    "incumbent_manufacture_period",
    "incumbent_burner_age_band",
    "replacement_gross_thermal_efficiency_percent",
    "replacement_control_system",
  ], "Part 38 input");
  const scenario = selectInput(
    inputs,
    "scenario",
    "Part 38 scenario",
    ["38A(i)", "38A(ii)", "38A(iii)"] as const,
  );
  const incumbentConsumption = decimalInput(
    inputs,
    "incumbent_nominal_gas_consumption_mj_per_h",
    "Incumbent nominal gas consumption",
  );
  const replacementConsumption = decimalInput(
    inputs,
    "replacement_nominal_gas_consumption_mj_per_h",
    "Replacement nominal gas consumption",
  );
  const incumbentAge = decimalInput(
    inputs,
    "incumbent_equipment_age_years",
    "Incumbent equipment age",
  );
  ensureAtLeast(
    incumbentAge,
    "10",
    "The incumbent boiler or water heater must have been manufactured at least 10 years before decommissioning.",
  );
  const partJRefurbishment = selectInput(
    inputs,
    "part_j5_2d_refurbishment",
    "Part J5.2d refurbishment status",
    ["yes", "no"] as const,
  );
  const manufacturePeriod = partJRefurbishment === "no"
    ? selectInput(
      inputs,
      "incumbent_manufacture_period",
      "incumbent manufacture period",
      ["1989_or_earlier", "1990_or_later"] as const,
    )
    : null;
  const burnerAgeBand = partJRefurbishment === "no"
    ? selectInput(
      inputs,
      "incumbent_burner_age_band",
      "incumbent burner age band",
      ["over_10_years", "up_to_10_years"] as const,
    )
    : null;
  const efficiency = decimalInput(
    inputs,
    "replacement_gross_thermal_efficiency_percent",
    "Replacement gross thermal efficiency",
    { maximum: "100" },
  );
  ensureAtLeast(
    efficiency,
    "85",
    "Table 38.3 does not prescribe a DEI below 85% gross thermal efficiency; the governed calculator therefore requires at least 85%.",
  );
  const controlSystem = selectInput(
    inputs,
    "replacement_control_system",
    "replacement control system",
    [
      "not_required",
      "electronic_gas_air_ratio",
      "electronic_gas_air_ratio_with_combustion_trim",
    ] as const,
  );
  validateBoilerControlRequirement(replacementConsumption, controlSystem);
  validateNoProductEvidence(product, "38");

  const consumption = minimum(incumbentConsumption, replacementConsumption);
  const highEfficiency = compare(efficiency, decimalConstant("90")) >= 0;
  const deiValue = partJRefurbishment === "yes"
    ? highEfficiency ? "0.00000387" : "0.00000110"
    : manufacturePeriod === "1989_or_earlier"
      ? burnerAgeBand === "over_10_years"
        ? highEfficiency ? "0.00000534" : "0.00000258"
        : highEfficiency ? "0.00000482" : "0.00000206"
      : burnerAgeBand === "over_10_years"
        ? highEfficiency ? "0.00000506" : "0.00000229"
        : highEfficiency ? "0.00000454" : "0.00000178";
  const dei = decimalConstant(deiValue);
  const result = industrialGasReduction(consumption, dei, "20");
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      incumbentNominalGasConsumptionMjPerH: exactFraction(incumbentConsumption),
      replacementNominalGasConsumptionMjPerH: exactFraction(replacementConsumption),
      governedConsumptionMjPerH: exactFraction(consumption),
      incumbentEquipmentAgeYears: exactFraction(incumbentAge),
      partJ5_2dRefurbishment: partJRefurbishment,
      incumbentManufacturePeriod: manufacturePeriod,
      incumbentBurnerAgeBand: burnerAgeBand,
      replacementGrossThermalEfficiencyPercent: exactFraction(efficiency),
      replacementControlSystem: controlSystem,
      product: null,
    },
    trace: [
      traceEntry("consumption", "Governed nominal gas consumption", "lower of incumbent and replacement nominal gas consumption", "min(incumbent, replacement)", consumption, "MJ/h"),
      traceEntry("dei", "Default energy improvement", partJRefurbishment === "yes" ? `Part J5.2d refurbishment; ${highEfficiency ? "efficiency >= 90%" : "85% <= efficiency < 90%"}` : `${manufacturePeriod}; ${burnerAgeBand}; ${highEfficiency ? "efficiency >= 90%" : "85% <= efficiency < 90%"}`, "Table 38.3 branch", dei, "tCO2-e/MJ"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(consumption)} x ${deiValue}`, "Consumption x DEI x 0.206 LUF x 8760 hours x 20 years", result),
    ],
  };
}

function calculatePart39(
  inputs: UnknownRecord,
  product: unknown,
): Execution {
  exactKeys(inputs, [
    "nominal_gas_consumption_mj_per_h",
    "eligibility_requirements_confirmed",
  ], "Part 39 input");
  const rawConsumption = decimalInput(
    inputs,
    "nominal_gas_consumption_mj_per_h",
    "Nominal gas consumption",
  );
  confirmedInput(inputs, "eligibility_requirements_confirmed", "Part 39 eligibility confirmation");
  validateNoProductEvidence(product, "39");
  const consumption = minimum(rawConsumption, decimalConstant("11400"));
  const dei = decimalConstant("0.00000065");
  const result = industrialGasReduction(consumption, dei, "20");
  ensurePositiveResult(result);
  return {
    scenario: "39A",
    result,
    inputSnapshot: {
      nominalGasConsumptionMjPerH: exactFraction(rawConsumption),
      governedConsumptionMjPerH: exactFraction(consumption),
      eligibilityRequirementsConfirmed: "yes",
      product: null,
    },
    trace: [
      traceEntry("consumption", "Governed nominal gas consumption", exactFraction(rawConsumption), "minimum of nominal consumption and 11,400 MJ/h", consumption, "MJ/h"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(consumption)} x 0.00000065`, "Consumption x DEI x 0.206 LUF x 8760 hours x 20 years", result),
    ],
  };
}

function calculatePart40(
  inputs: UnknownRecord,
  product: unknown,
): Execution {
  exactKeys(inputs, [
    "equipment_type",
    "nominal_gas_consumption_mj_per_h",
    "eligibility_requirements_confirmed",
  ], "Part 40 input");
  const equipmentType = selectInput(
    inputs,
    "equipment_type",
    "equipment type",
    ["steam_boiler", "hot_water_boiler_or_water_heater"] as const,
  );
  const rawConsumption = decimalInput(
    inputs,
    "nominal_gas_consumption_mj_per_h",
    "Nominal gas consumption",
  );
  confirmedInput(inputs, "eligibility_requirements_confirmed", "Part 40 eligibility confirmation");
  validateNoProductEvidence(product, "40");
  const consumption = minimum(rawConsumption, decimalConstant("11400"));
  const deiValue = equipmentType === "steam_boiler" ? "0.00000080" : "0.00000070";
  const dei = decimalConstant(deiValue);
  const result = industrialGasReduction(consumption, dei, "10");
  ensurePositiveResult(result);
  return {
    scenario: "40A",
    result,
    inputSnapshot: {
      equipmentType,
      nominalGasConsumptionMjPerH: exactFraction(rawConsumption),
      governedConsumptionMjPerH: exactFraction(consumption),
      eligibilityRequirementsConfirmed: "yes",
      product: null,
    },
    trace: [
      traceEntry("consumption", "Governed nominal gas consumption", exactFraction(rawConsumption), "minimum of nominal consumption and 11,400 MJ/h", consumption, "MJ/h"),
      traceEntry("dei", "Default energy improvement", equipmentType, "Table 40.2 equipment branch", dei, "tCO2-e/MJ"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(consumption)} x ${deiValue}`, "Consumption x DEI x 0.206 LUF x 8760 hours x 10 years", result),
    ],
  };
}

function calculatePart41(
  inputs: UnknownRecord,
  product: unknown,
): Execution {
  exactKeys(inputs, [
    "incumbent_nominal_gas_consumption_mj_per_h",
    "replacement_nominal_gas_consumption_mj_per_h",
    "incumbent_burner_age_years",
    "replacement_control_system",
  ], "Part 41 input");
  const incumbentConsumption = decimalInput(
    inputs,
    "incumbent_nominal_gas_consumption_mj_per_h",
    "Incumbent nominal gas consumption",
  );
  const replacementConsumption = decimalInput(
    inputs,
    "replacement_nominal_gas_consumption_mj_per_h",
    "Replacement nominal gas consumption",
  );
  const incumbentBurnerAge = decimalInput(
    inputs,
    "incumbent_burner_age_years",
    "Incumbent burner age",
  );
  ensureAtLeast(
    incumbentBurnerAge,
    "10",
    "The incumbent gas-fired burner must have been manufactured at least 10 years before decommissioning.",
  );
  const controlSystem = selectInput(
    inputs,
    "replacement_control_system",
    "replacement control system",
    ["not_required", "electronic_gas_air_ratio_with_flue_signal"] as const,
  );
  if (
    compare(replacementConsumption, decimalConstant("3700")) > 0
    && controlSystem !== "electronic_gas_air_ratio_with_flue_signal"
  ) {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      "A replacement burner above 3,700 MJ/h requires electronic gas/air ratio control capable of receiving a flue-gas-sensor signal.",
      409,
    );
  }
  validateNoProductEvidence(product, "41");
  const uncappedConsumption = minimum(incumbentConsumption, replacementConsumption);
  const consumption = minimum(uncappedConsumption, decimalConstant("11400"));
  const dei = decimalConstant("0.00000107");
  const result = industrialGasReduction(consumption, dei, "20");
  ensurePositiveResult(result);
  return {
    scenario: "41A",
    result,
    inputSnapshot: {
      incumbentNominalGasConsumptionMjPerH: exactFraction(incumbentConsumption),
      replacementNominalGasConsumptionMjPerH: exactFraction(replacementConsumption),
      governedConsumptionMjPerH: exactFraction(consumption),
      incumbentBurnerAgeYears: exactFraction(incumbentBurnerAge),
      replacementControlSystem: controlSystem,
      product: null,
    },
    trace: [
      traceEntry("consumption", "Governed nominal gas consumption", "lower of incumbent, replacement and 11,400 MJ/h", "min(incumbent, replacement, 11,400)", consumption, "MJ/h"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(consumption)} x 0.00000107`, "Consumption x DEI x 0.206 LUF x 8760 hours x 20 years", result),
    ],
  };
}

function calculatePart42(
  inputs: UnknownRecord,
  product: unknown,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "equipment_type",
    "nominal_gas_consumption_mj_per_h",
    "eligibility_requirements_confirmed",
  ], "Part 42 input");
  const scenario = selectInput(
    inputs,
    "scenario",
    "Part 42 scenario",
    ["42A(i)", "42A(ii)"] as const,
  );
  const equipmentType = selectInput(
    inputs,
    "equipment_type",
    "equipment type",
    ["steam_boiler", "hot_water_boiler_or_water_heater"] as const,
  );
  if (scenario === "42A(ii)" && equipmentType !== "steam_boiler") {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      "Scenario 42A(ii), a non-condensing economizer, is only eligible on a gas-fired steam boiler.",
      409,
    );
  }
  const consumption = decimalInput(
    inputs,
    "nominal_gas_consumption_mj_per_h",
    "Nominal gas consumption",
  );
  confirmedInput(inputs, "eligibility_requirements_confirmed", "Part 42 eligibility confirmation");
  validateNoProductEvidence(product, "42");
  const deiValue = equipmentType === "steam_boiler" ? "0.00000181" : "0.00000141";
  const dei = decimalConstant(deiValue);
  const result = industrialGasReduction(consumption, dei, "10");
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      equipmentType,
      nominalGasConsumptionMjPerH: exactFraction(consumption),
      eligibilityRequirementsConfirmed: "yes",
      product: null,
    },
    trace: [
      traceEntry("dei", "Default energy improvement", equipmentType, "Table 42.2 equipment branch", dei, "tCO2-e/MJ"),
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(consumption)} x ${deiValue}`, "Consumption x DEI x 0.206 LUF x 8760 hours x 10 years", result),
    ],
  };
}

function calculatePart43(
  inputs: UnknownRecord,
  product: unknown,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "geography",
    "operating_temperature_band",
    "internal_floor_area_m2",
    "system_count",
    "eligible_parts_configuration_confirmed",
    "co_payment_per_cold_room_aud",
  ], "Part 43 input");
  const scenario = selectInput(
    inputs,
    "scenario",
    "Part 43 scenario",
    ["43A", "43B(i)", "43B(ii)"] as const,
  );
  const geography = selectInput(
    inputs,
    "geography",
    "geography",
    ["metropolitan", "regional"] as const,
  );
  const temperatureBand = selectInput(
    inputs,
    "operating_temperature_band",
    "operating temperature band",
    ["at_or_above_zero_c", "below_zero_c"] as const,
  );
  const area = decimalInput(inputs, "internal_floor_area_m2", "Internal floor area");
  ensureAtLeast(area, "4", "Part 43 requires a cold room with at least 4 m2 internal floor area.");
  const systemCount = decimalInput(inputs, "system_count", "System count", { integer: true });
  confirmedInput(
    inputs,
    "eligible_parts_configuration_confirmed",
    "eligible parts configuration confirmation",
  );
  let coPayment: Fraction | null = null;
  if (scenario !== "43A") {
    coPayment = decimalInput(
      inputs,
      "co_payment_per_cold_room_aud",
      "Co-payment per cold room",
      { allowZero: true },
    );
    ensureAtLeast(
      coPayment,
      "500",
      "Part 43B requires a minimum co-payment of $500 including GST for each cold room.",
    );
  }
  validateNoProductEvidence(product, "43");

  const energySavings = decimalConstant(
    scenario === "43A" ? "1.7" : scenario === "43B(i)" ? "3.4" : "5.1",
  );
  const temperatureFactor = decimalConstant(
    temperatureBand === "below_zero_c" ? "1.4" : "1",
  );
  const regionalFactor = decimalConstant(
    geography === "metropolitan"
      ? CREDITEX_VEU_METROPOLITAN_FACTOR
      : CREDITEX_VEU_REGIONAL_FACTOR,
  );
  const sizeFactor = compare(area, decimalConstant("9")) <= 0
    ? decimalConstant("0.5")
    : compare(area, decimalConstant("24")) < 0
      ? decimalConstant("1")
      : decimalConstant("2");
  const perSystem = multiply(
    multiply(
      multiply(energySavings, decimalConstant("12")),
      EEF,
    ),
    multiply(temperatureFactor, multiply(regionalFactor, sizeFactor)),
  );
  const result = multiply(perSystem, systemCount);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      geography,
      operatingTemperatureBand: temperatureBand,
      internalFloorAreaM2: exactFraction(area),
      systemCount: exactFraction(systemCount),
      eligiblePartsConfigurationConfirmed: "yes",
      coPaymentPerColdRoomAud: coPayment ? exactFraction(coPayment) : null,
      product: null,
    },
    trace: [
      traceEntry("energy_savings", "Scenario energy savings", scenario, "Table 43.3, 43.4 or 43.5 branch", energySavings, "MWh/system/year"),
      traceEntry("size_factor", "Cold-room size factor", exactFraction(area), "4-9 m2 = 0.5; over 9-under 24 m2 = 1; 24 m2 or more = 2", sizeFactor, "factor"),
      traceEntry("per_system_reduction", "GHG reduction per identical cold-room system", `${exactFraction(energySavings)} x 12 x EEF x ${exactFraction(temperatureFactor)} x ${exactFraction(regionalFactor)} x ${exactFraction(sizeFactor)}`, "Energy Savings x Lifetime x EEF x Temperature Factor x Regional Factor x Size Factor", perSystem),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", exactFraction(systemCount), "per-system reduction x identical system count", result),
    ],
  };
}

function calculatePart44(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "scenario",
    "climate_zone",
    "storage_configuration",
    "number_of_heat_pumps",
    "number_of_tanks",
    "total_heat_pump_thermal_capacity_kw",
    "existing_system_thermal_capacity_kw",
    "total_storage_volume_litres",
    "annual_energy_savings_percent",
    "commercial_peak_load_mj_per_day",
    "hp_electricity_gj_per_year",
    "hp_gas_gj_per_year",
    "refrigerant_gwp",
    "refrigerant_charge_kg",
    "delivery_temperature_c",
    "warranty_years",
    "as_nzs_2712_status",
    "incumbent_equipment_age_years",
    "incumbent_decommissioning_evidence_confirmed",
    "existing_storage_requirements_confirmed",
    "installation_and_model_evidence_confirmed",
    "co_payment_per_installed_product_aud",
    "installation_count",
  ], "Part 44 input");
  const scenario = selectInput(
    inputs,
    "scenario",
    "Part 44 scenario",
    ["44A(i)", "44A(ii)", "44A(iii)"] as const,
  );
  const climateZone = selectInput(inputs, "climate_zone", "climate zone", ["4", "5"] as const);
  const storageConfiguration = selectInput(
    inputs,
    "storage_configuration",
    "storage configuration",
    ["modelled_storage", "existing_storage"] as const,
  );
  if (scenario === "44A(iii)" && storageConfiguration === "existing_storage") {
    fail(
      "VEU_SYSTEM_INELIGIBLE",
      "Scenario 44A(iii) cannot use the existing-storage pathway reserved for scenarios 44A(i) and 44A(ii).",
      409,
    );
  }
  const heatPumpCount = decimalInput(
    inputs,
    "number_of_heat_pumps",
    "Number of heat pumps",
    { integer: true },
  );
  const tankCount = decimalInput(inputs, "number_of_tanks", "Number of tanks", { integer: true });
  const heatPumpThermalCapacity = decimalInput(
    inputs,
    "total_heat_pump_thermal_capacity_kw",
    "Total heat-pump thermal capacity",
  );
  const averageHeatPumpThermalCapacity = divide(heatPumpThermalCapacity, heatPumpCount);
  const existingSystemThermalCapacity = scenario === "44A(iii)"
    ? null
    : decimalInput(
      inputs,
      "existing_system_thermal_capacity_kw",
      "Existing-system thermal capacity",
    );
  const totalStorageVolume = decimalInput(
    inputs,
    "total_storage_volume_litres",
    "Total insulated storage volume",
  );
  const averageStorageVolume = divide(totalStorageVolume, tankCount);
  ensureAtLeast(
    averageStorageVolume,
    "425",
    "Part 44 requires an average insulated storage volume of at least 425 litres.",
  );
  const annualEnergySavings = decimalInput(
    inputs,
    "annual_energy_savings_percent",
    "Annual energy savings",
    { maximum: "100" },
  );
  ensureAtLeast(
    annualEnergySavings,
    "60",
    `Part 44 requires at least 60% annual energy savings in climate zone ${climateZone}.`,
  );
  const commercialPeakLoad = decimalInput(
    inputs,
    "commercial_peak_load_mj_per_day",
    "Commercial peak load",
  );
  const hpElectricity = decimalInput(
    inputs,
    "hp_electricity_gj_per_year",
    "Heat-pump annual electrical energy",
    { allowZero: true },
  );
  const hpGas = decimalInput(
    inputs,
    "hp_gas_gj_per_year",
    "Heat-pump annual gas energy",
    { allowZero: true },
  );
  const refrigerantGwp = decimalInput(inputs, "refrigerant_gwp", "Refrigerant GWP");
  const refrigerantCharge = decimalInput(
    inputs,
    "refrigerant_charge_kg",
    "Refrigerant charge",
  );
  const deliveryTemperature = decimalInput(
    inputs,
    "delivery_temperature_c",
    "Minimum delivery temperature",
  );
  ensureAtLeast(
    deliveryTemperature,
    "45",
    "Part 44 requires a minimum delivery temperature of 45 C.",
  );
  const warrantyYears = decimalInput(
    inputs,
    "warranty_years",
    "Product warranty",
    { allowZero: true },
  );
  const asNzsStatus = selectInput(
    inputs,
    "as_nzs_2712_status",
    "AS/NZS 2712 certification status",
    ["certified", "not_applicable_over_700_litres"] as const,
  );
  if (compare(averageStorageVolume, decimalConstant("700")) <= 0) {
    if (asNzsStatus !== "certified") {
      fail(
        "VEU_SYSTEM_INELIGIBLE",
        "Part 44 systems with average insulated storage of 700 litres or less require accredited AS/NZS 2712 certification.",
        409,
      );
    }
    ensureAtLeast(
      warrantyYears,
      "5",
      "Part 44 systems with average insulated storage of 700 litres or less require at least a five-year product warranty.",
    );
  } else if (asNzsStatus !== "not_applicable_over_700_litres") {
    fail(
      "VEU_INPUT_INVALID",
      "Use the over-700-litre AS/NZS 2712 status for this average storage volume.",
    );
  }
  let incumbentAge: Fraction | null = null;
  if (scenario !== "44A(iii)") {
    incumbentAge = decimalInput(
      inputs,
      "incumbent_equipment_age_years",
      "Incumbent equipment age",
    );
    ensureAtLeast(
      incumbentAge,
      "10",
      "The incumbent gas or electric water-heating product must be at least 10 years old at decommissioning.",
    );
    confirmedInput(
      inputs,
      "incumbent_decommissioning_evidence_confirmed",
      "incumbent decommissioning evidence confirmation",
    );
  }
  if (storageConfiguration === "existing_storage") {
    confirmedInput(
      inputs,
      "existing_storage_requirements_confirmed",
      "existing-storage requirements confirmation",
    );
  }
  confirmedInput(
    inputs,
    "installation_and_model_evidence_confirmed",
    "installation and model evidence confirmation",
  );
  const coPayment = decimalInput(
    inputs,
    "co_payment_per_installed_product_aud",
    "Co-payment per installed product",
    { allowZero: true },
  );
  ensureAtLeast(
    coPayment,
    "10000",
    "Part 44 requires a minimum co-payment of $10,000 including GST per installed product.",
  );
  const installationCount = decimalInput(
    inputs,
    "installation_count",
    "Installation count",
    { integer: true },
  );
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["44A"]);

  const referenceElectricity = divide(
    multiply(
      multiply(
        multiply(decimalConstant("365"), decimalConstant("0.905")),
        decimalConstant("1.05"),
      ),
      commercialPeakLoad,
    ),
    decimalConstant("1000"),
  );
  const gasEmissionsFactor = decimalConstant("0.05523");
  const referenceEmissions = scenario === "44A(ii)"
    ? multiply(EEF, divide(referenceElectricity, decimalConstant("3.6")))
    : multiply(
      gasEmissionsFactor,
      divide(referenceElectricity, decimalConstant(scenario === "44A(i)" ? "0.788" : "0.85")),
    );
  const hpGasEmissions = multiply(gasEmissionsFactor, hpGas);
  const hpElectricityEmissions = multiply(
    EEF,
    divide(hpElectricity, decimalConstant("3.6")),
  );
  const annualReduction = subtract(
    subtract(referenceEmissions, hpGasEmissions),
    hpElectricityEmissions,
  );
  const capacityFactor = !existingSystemThermalCapacity
    || compare(heatPumpThermalCapacity, existingSystemThermalCapacity) <= 0
    ? decimalConstant("1")
    : divide(existingSystemThermalCapacity, heatPumpThermalCapacity);
  const loadFactor = compare(averageHeatPumpThermalCapacity, decimalConstant("10")) < 0
    ? minimum(
      decimalConstant("1"),
      divide(multiply(decimalConstant("42"), heatPumpCount), commercialPeakLoad),
    )
    : decimalConstant("1");
  const lifetime = decimalConstant(storageConfiguration === "existing_storage" ? "10" : "15");
  const lifetimeEnergyReduction = multiply(
    multiply(multiply(annualReduction, capacityFactor), loadFactor),
    lifetime,
  );
  const refrigerantReduction = multiply(
    multiply(
      subtract(decimalConstant("1430"), refrigerantGwp),
      decimalConstant("0.0005"),
    ),
    refrigerantCharge,
  );
  const perSystem = add(lifetimeEnergyReduction, refrigerantReduction);
  const result = multiply(perSystem, installationCount);
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: {
      scenario,
      climateZone,
      storageConfiguration,
      numberOfHeatPumps: exactFraction(heatPumpCount),
      numberOfTanks: exactFraction(tankCount),
      totalHeatPumpThermalCapacityKw: exactFraction(heatPumpThermalCapacity),
      averageHeatPumpThermalCapacityKw: exactFraction(averageHeatPumpThermalCapacity),
      existingSystemThermalCapacityKw: existingSystemThermalCapacity
        ? exactFraction(existingSystemThermalCapacity)
        : null,
      totalStorageVolumeLitres: exactFraction(totalStorageVolume),
      averageStorageVolumeLitres: exactFraction(averageStorageVolume),
      annualEnergySavingsPercent: exactFraction(annualEnergySavings),
      commercialPeakLoadMjPerDay: exactFraction(commercialPeakLoad),
      hpElectricityGjPerYear: exactFraction(hpElectricity),
      hpGasGjPerYear: exactFraction(hpGas),
      refrigerantGwp: exactFraction(refrigerantGwp),
      refrigerantChargeKg: exactFraction(refrigerantCharge),
      deliveryTemperatureC: exactFraction(deliveryTemperature),
      warrantyYears: exactFraction(warrantyYears),
      asNzs2712Status: asNzsStatus,
      incumbentEquipmentAgeYears: incumbentAge ? exactFraction(incumbentAge) : null,
      incumbentDecommissioningEvidenceConfirmed: scenario === "44A(iii)" ? null : "yes",
      existingStorageRequirementsConfirmed: storageConfiguration === "existing_storage" ? "yes" : null,
      installationAndModelEvidenceConfirmed: "yes",
      coPaymentPerInstalledProductAud: exactFraction(coPayment),
      installationCount: exactFraction(installationCount),
      referenceElectricityGjPerYear: exactFraction(referenceElectricity),
      applicationGuideVersion: CREDITEX_VEU_PART_44_APPLICATION_GUIDE.version,
      product: evidence,
    },
    trace: [
      traceEntry("reference_electricity", "Reference annual electrical energy", exactFraction(commercialPeakLoad), "365 x 0.905 x 1.05 x ComPeakLoad / 1000", referenceElectricity, "GJ/year"),
      traceEntry("reference_emissions", "Reference annual emissions", scenario, scenario === "44A(ii)" ? "EEF x RefElec / 3.6" : `GEF x RefElec / ${scenario === "44A(i)" ? "0.788" : "0.85"}`, referenceEmissions, "tCO2-e/year"),
      traceEntry("hp_gas_emissions", "Heat-pump annual gas emissions", exactFraction(hpGas), "0.05523 GEF x HPGas", hpGasEmissions, "tCO2-e/year"),
      traceEntry("hp_electricity_emissions", "Heat-pump annual electricity emissions", exactFraction(hpElectricity), "EEF x HPElec / 3.6", hpElectricityEmissions, "tCO2-e/year"),
      traceEntry("capacity_factor", "Capacity factor", `${existingSystemThermalCapacity ? exactFraction(existingSystemThermalCapacity) : "not applicable"}/${exactFraction(heatPumpThermalCapacity)}`, "1 when new capacity is not greater than existing; otherwise existing/new", capacityFactor, "factor"),
      traceEntry("load_factor", "Load factor", `${exactFraction(averageHeatPumpThermalCapacity)} kW average; ${exactFraction(heatPumpCount)} heat pumps; ${exactFraction(commercialPeakLoad)} MJ/day`, "if average thermal capacity < 10 kW, min(1, 42 x N / ComPeakLoad); otherwise 1", loadFactor, "factor"),
      traceEntry("lifetime_energy_reduction", "Lifetime operational GHG reduction", exactFraction(annualReduction), "annual reduction x capacity factor x load factor x lifetime", lifetimeEnergyReduction),
      traceEntry("refrigerant_reduction", "Refrigerant GHG reduction", `${exactFraction(refrigerantGwp)} GWP; ${exactFraction(refrigerantCharge)} kg`, "(1430 - GWP) x 0.0005 x refrigerant charge", refrigerantReduction),
      traceEntry("per_system_reduction", "GHG reduction per modelled installed product", `${exactFraction(lifetimeEnergyReduction)} + ${exactFraction(refrigerantReduction)}`, "lifetime operational reduction + refrigerant reduction", perSystem),
      traceEntry("ghg_reduction", "Total GHG equivalent reduction", exactFraction(installationCount), "per-system reduction x installation count", result),
    ],
  };
}

function calculatePart46(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, ["scenario"], "Part 46 input");
  const scenario = selectInput(inputs, "scenario", "Part 46 scenario", ["46A", "46B"] as const);
  const evidence = validateProductEvidence(
    product,
    installationDate,
    "VEU",
    [scenario],
  );
  const result = multiply(subtract(decimalConstant("0.1"), decimalConstant("0.04")), decimalConstant("25"));
  return {
    scenario,
    result,
    inputSnapshot: { scenario, product: evidence },
    trace: [traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", "baseline 0.10; upgrade 0.04", "(baseline - upgrade) x 25 years", result)],
  };
}

function calculatePart48(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, ["scenario", "geography", "climatic_region", "area_m2"], "Part 48 input");
  const scenario = selectInput(inputs, "scenario", "Part 48 scenario", ["48A(i)", "48A(ii)", "48B(i)", "48B(ii)"] as const);
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const climaticRegion = selectInput(inputs, "climatic_region", "climatic region", ["mild", "cold", "hot"] as const);
  const area = decimalInput(inputs, "area_m2", "Installed insulation area");
  const savings = decimalConstant(climaticRegion === "mild" ? "0.00576" : climaticRegion === "cold" ? "0.00771" : "0.00546");
  const regionalFactor = geography === "metropolitan"
    ? CREDITEX_VEU_METROPOLITAN_FACTOR
    : CREDITEX_VEU_REGIONAL_FACTOR;
  const result = multiply(
    multiply(multiply(savings, area), decimalConstant("25")),
    decimalConstant(regionalFactor),
  );
  const requiredProductCategory = scenario.startsWith("48A") ? "48A" : "48B";
  const evidence = validateProductEvidence(
    product,
    installationDate,
    "VEU",
    [requiredProductCategory],
  );
  ensurePositiveResult(result);
  return {
    scenario,
    result,
    inputSnapshot: { scenario, geography, climaticRegion, areaM2: exactFraction(area), product: evidence },
    trace: [
      traceEntry("ghg_reduction", "Lifetime GHG equivalent reduction", `${exactFraction(area)} m2`, `${decimalPresentation(savings).decimal} savings x area x 25 years x regional factor ${regionalFactor}`, result),
    ],
  };
}

function execute(
  activityCode: string,
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
  part6RevisionApplied: boolean,
  estimatePurpose: "compliance" | "quote",
): Execution {
  switch (activityCode) {
    case "1C":
    case "1D":
      return calculatePart1(activityCode, inputs, product, installationDate);
    case "3C":
    case "3D":
      return calculatePart3(activityCode, inputs, product, installationDate);
    case "6":
      return calculatePart6(
        inputs,
        product,
        installationDate,
        part6RevisionApplied,
        estimatePurpose,
      );
    case "13":
      return calculatePart13(inputs, product, installationDate);
    case "14":
      return calculatePart14(inputs, product, installationDate);
    case "15":
      return calculatePart15(inputs, product, installationDate);
    case "17":
      return calculatePart17(inputs, product, installationDate);
    case "22":
    case "24":
    case "25":
      return calculateFixedProduct(activityCode, inputs, product, installationDate);
    case "26":
      return calculatePart26(inputs, product, installationDate);
    case "27":
      return calculatePart27(inputs, product, installationDate);
    case "28":
      return calculatePart28(inputs, product, installationDate);
    case "30":
      return calculatePart30(inputs, product, installationDate);
    case "31":
      return calculatePart31(inputs, product, installationDate);
    case "32":
      return calculatePart32(inputs, product, installationDate);
    case "33":
      return calculatePart33(inputs, product, installationDate);
    case "34":
      return calculatePart34(inputs, product, installationDate);
    case "35":
      return calculatePart35(inputs, product, installationDate);
    case "36":
      return calculatePart36(inputs, product, installationDate);
    case "37":
      return calculatePart37(inputs, product);
    case "38":
      return calculatePart38(inputs, product);
    case "39":
      return calculatePart39(inputs, product);
    case "40":
      return calculatePart40(inputs, product);
    case "41":
      return calculatePart41(inputs, product);
    case "42":
      return calculatePart42(inputs, product);
    case "43":
      return calculatePart43(inputs, product);
    case "44":
      return calculatePart44(inputs, product, installationDate);
    case "46":
      return calculatePart46(inputs, product, installationDate);
    case "48":
      return calculatePart48(inputs, product, installationDate);
    default:
      fail("VEU_ACTIVITY_UNSUPPORTED", `Activity ${activityCode} is not executable in this bounded VEU slice.`, 404);
  }
}

function nearestWholeCertificates(value: Fraction) {
  if (value.numerator < BigInt(0)) {
    fail("VEU_SYSTEM_INELIGIBLE", "VEEC estimates cannot be negative.", 409);
  }
  const whole = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;
  const comparison = remainder * BigInt(2) - value.denominator;
  if (comparison === BigInt(0)) {
    return { wholeCertificates: null, tie: true } as const;
  }
  return {
    wholeCertificates: String(comparison > BigInt(0) ? whole + BigInt(1) : whole),
    tie: false,
  } as const;
}

export function estimateCreditexVeu(value: unknown): CreditexVeuEstimate {
  const request = record(value, "VEU estimate request");
  exactKeys(request, ["activityCode", "installationDate", "inputs", "product", "estimatePurpose"], "VEU estimate request");
  const estimatePurpose = request.estimatePurpose === undefined
    ? "compliance"
    : selectInput(
      request,
      "estimatePurpose",
      "estimate purpose",
      ["compliance", "quote"] as const,
    );
  const activityCode = requiredString(request.activityCode, "Activity code");
  const activity = CREDITEX_VEU_ACTIVITY_DEFINITIONS.find((candidate) => candidate.activityCode === activityCode);
  if (!activity) {
    fail("VEU_ACTIVITY_UNSUPPORTED", `Activity ${activityCode} is not executable in this bounded VEU slice.`, 404);
  }
  const installationDate = parseDate(request.installationDate, "Installation date").text;
  const specification = resolveSpecification(installationDate, activityCode);
  const suppliedInputs = record(request.inputs, "Activity inputs");
  const quotePreparation = estimatePurpose === "quote"
    ? prepareQuoteInputs(activity, suppliedInputs)
    : { normalizedInputs: suppliedInputs, warnings: [] };
  const unitPreparation = prepareWaterHeaterUnitQuantity(
    activityCode,
    estimatePurpose,
    quotePreparation.normalizedInputs,
  );
  const inputs = unitPreparation.executionInputs;
  const execution = execute(
    activityCode,
    inputs,
    request.product,
    installationDate,
    specification.part6RevisionApplied,
    estimatePurpose,
  );
  if (
    !(activity.scenarios as readonly string[]).includes(execution.scenario)
    && !(
      "internalExecutableScenarios" in activity
      && (activity.internalExecutableScenarios as readonly string[]).includes(execution.scenario)
    )
  ) {
    fail("VEU_REQUEST_INVALID", `Scenario ${execution.scenario} is not declared for activity ${activityCode}.`);
  }
  const repeatedSystems = unitPreparation.quantityText !== "1";
  const perUnitRounded = nearestWholeCertificates(execution.result);
  const totalResult = repeatedSystems
    ? multiply(execution.result, unitPreparation.quantity)
    : execution.result;
  const rounded = repeatedSystems
    ? {
        wholeCertificates: perUnitRounded.wholeCertificates === null
          ? null
          : String(
            BigInt(perUnitRounded.wholeCertificates)
              * unitPreparation.quantity.numerator,
          ),
        tie: perUnitRounded.tie,
      }
    : perUnitRounded;
  const presentation = decimalPresentation(totalResult);
  const perUnitPresentation = decimalPresentation(execution.result);
  const trace = repeatedSystems
    ? [
        ...execution.trace,
        traceEntry(
          "unit_quantity",
          "Identical systems",
          unitPreparation.quantityText,
          "calculate each identical approved system separately",
          unitPreparation.quantity,
          "systems",
        ),
        traceEntry(
          "multi_unit_total",
          "Total governed reduction",
          `${perUnitPresentation.decimal} tCO2-e per system`,
          `multiply the per-system result by ${unitPreparation.quantityText}; whole VEECs are rounded per system before multiplication`,
          totalResult,
        ),
      ]
    : execution.trace;
  const output = {
    unroundedTonnes: presentation.decimal,
    unroundedDecimalStatus: presentation.status,
    exactFraction: exactFraction(totalResult),
    wholeCertificates: rounded.wholeCertificates,
    roundingStatus: rounded.tie
      ? "exact_half_tie_requires_regulator_confirmation" as const
      : "nearest_whole_applied" as const,
    unit: "VEEC" as const,
    ...(repeatedSystems
      ? {
          unitQuantity: unitPreparation.quantityText,
          perUnit: {
            unroundedTonnes: perUnitPresentation.decimal,
            unroundedDecimalStatus: perUnitPresentation.status,
            exactFraction: exactFraction(execution.result),
            wholeCertificates: perUnitRounded.wholeCertificates,
            roundingStatus: perUnitRounded.tie
              ? "exact_half_tie_requires_regulator_confirmation" as const
              : "nearest_whole_applied" as const,
            unit: "VEEC" as const,
          },
        }
      : {}),
  };
  const formulaKey = `${activity.formulaKey}:${specification.formulaProfile}`;
  const inputSnapshot = {
    installationDate,
    ...execution.inputSnapshot,
    ...(repeatedSystems
      ? {
          unitQuantity: unitPreparation.quantityText,
          repeatedIdenticalApprovedProduct: true,
        }
      : {}),
    ...(estimatePurpose === "quote"
      ? { quoteEligibilityEvidence: quotePreparation.warnings }
      : {}),
  };
  const quoteMetadata = estimatePurpose === "quote"
    ? {
        estimatePurpose: "quote" as const,
        eligibilityConfirmed: false as const,
        eligibilityWarnings: quotePreparation.warnings,
      }
    : {};
  const receiptBase = {
    schemaVersion: CREDITEX_VEU_ESTIMATE_SCHEMA,
    estimatorVersion: CREDITEX_VEU_ESTIMATOR_VERSION,
    activityCode,
    scenario: execution.scenario,
    formulaKey,
    specificationVersion: specification.source.version,
    supportingSources: supportingSourcesFor(activity),
    inputSnapshot,
    trace,
    output,
    ...quoteMetadata,
  };
  return {
    schemaVersion: CREDITEX_VEU_ESTIMATE_SCHEMA,
    estimatorVersion: CREDITEX_VEU_ESTIMATOR_VERSION,
    activityCode,
    activityTitle: activity.title,
    scenario: execution.scenario,
    formulaKey,
    formulaProfile: specification.formulaProfile,
    specificationVersion: specification.source.version,
    specificationEffectiveFrom: specification.source.effectiveFrom,
    installationDate,
    officialSourceUrl: specification.source.url,
    officialSourceTitle: specification.source.title,
    sourcePages: activity.sourcePages,
    sourceReviewedOn: CREDITEX_VEU_CATALOGUE_REVIEWED_ON,
    supportingSources: supportingSourcesFor(activity),
    productRegistryUrl: usesVeuProductRegistry(activity.productRegistry)
      ? CREDITEX_VEU_PUBLIC_REGISTRY_URL
      : "",
    inputSnapshot,
    trace,
    output,
    status: rounded.tie
      ? "estimate_only_rounding_tie_unresolved"
      : "estimate_only_compliance_reconciliation_required",
    certificateActionEnabled: false,
    operatorMessage: estimatePurpose === "quote"
      ? "Potential rebate estimate only. Where required, the approved product was checked. The effective date and governed formula values were checked, but quote-mode evidence assumptions must be confirmed before relying on eligibility."
      : rounded.tie
        ? "The official guide requires nearest-whole VEEC rounding but does not state the exact 0.5 tie rule. The unrounded exact quantity is retained and no whole certificate value is asserted."
        : "Estimate only. Reconcile the installation, postcode classification, approved product record, effective dates and all activity evidence against the official VEU systems before certificate creation.",
    inputHash: sha256(inputSnapshot),
    traceHash: sha256(trace),
    outputHash: sha256(output),
    receiptHash: sha256(receiptBase),
    ...quoteMetadata,
  };
}
