import { createHash } from "node:crypto";

import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
  CREDITEX_VEU_CATALOGUE_REVIEWED_ON,
  CREDITEX_VEU_ELECTRICITY_EMISSIONS_FACTOR,
  CREDITEX_VEU_LOCATION_CLASSES,
  CREDITEX_VEU_METROPOLITAN_FACTOR,
  CREDITEX_VEU_PART_6_BASELINES,
  CREDITEX_VEU_PART_6_BUILDING_LOADS,
  CREDITEX_VEU_PART_6_CATEGORIES,
  CREDITEX_VEU_PART_6_CATEGORY_FACTORS,
  CREDITEX_VEU_PART_6_SCENARIOS,
  CREDITEX_VEU_PUBLIC_REGISTRY_URL,
  CREDITEX_VEU_REGIONAL_FACTOR,
  CREDITEX_VEU_SPECIFICATION_SOURCES,
  type CreditexVeuLocationClass,
  type CreditexVeuPart6Category,
  type CreditexVeuPart6Scenario,
} from "./creditex-veu-calculator-catalogue.ts";

export const CREDITEX_VEU_ESTIMATE_SCHEMA =
  "creditex-veu-deterministic-estimate/v1" as const;
export const CREDITEX_VEU_ESTIMATOR_VERSION =
  "creditex-veu-exact-rational-engine/2026-08-08" as const;

export type CreditexVeuRegistry = "VEU" | "GEMS";

export type CreditexVeuProductEvidence = {
  registry: CreditexVeuRegistry;
  activityCategory: string;
  productId: string;
  status: "Approved" | "Registered";
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
  const expectedStatus = registry === "VEU" ? "Approved" : "Registered";
  if (product.status !== expectedStatus) {
    fail(
      "VEU_PRODUCT_EVIDENCE_INVALID",
      `Product status must be ${expectedStatus} for this estimate.`,
    );
  }
  const productId = requiredString(product.productId, "Product ID");
  const effectiveFrom = parseDate(product.effectiveFrom, "Product effective-from date");
  const effectiveTo = product.effectiveTo === ""
    ? null
    : parseDate(product.effectiveTo, "Product effective-to date");
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
    status: expectedStatus,
    effectiveFrom: effectiveFrom.text,
    effectiveTo: effectiveTo?.text ?? "",
    sourceSnapshotHash: product.sourceSnapshotHash,
  };
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

function calculatePart1(
  activityCode: "1C" | "1D",
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
): Execution {
  exactKeys(inputs, [
    "geography",
    "system_size",
    "climate_zone",
    "bs2021_gj_per_year",
    "be2021_gj_per_year",
  ], "Part 1 input");
  const geography = selectInput(inputs, "geography", "geography", ["metropolitan", "regional"] as const);
  const systemSize = selectInput(inputs, "system_size", "system size", ["small", "medium"] as const);
  const climateZone = selectInput(inputs, "climate_zone", "AS/NZS 4234 climate zone", ["4", "5"] as const);
  if (activityCode === "1C" && climateZone !== "4") {
    fail("VEU_SYSTEM_INELIGIBLE", "Part 1C solar-water-heater modelling uses climate zone 4.", 409);
  }
  const bs = decimalInput(inputs, "bs2021_gj_per_year", "Bs2021", { allowZero: true });
  const be = decimalInput(inputs, "be2021_gj_per_year", "Be2021", { allowZero: true });
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
  exactKeys(inputs, ["climate_zone", "bs2021_gj_per_year", "be2021_gj_per_year"], "Part 3 input");
  const climateZone = selectInput(inputs, "climate_zone", "AS/NZS 4234 climate zone", ["4", "5"] as const);
  if (activityCode === "3D" && climateZone !== "4") {
    fail("VEU_SYSTEM_INELIGIBLE", "Part 3D solar-water-heater modelling uses climate zone 4.", 409);
  }
  const bs = decimalInput(inputs, "bs2021_gj_per_year", "Bs2021", { allowZero: true });
  const be = decimalInput(inputs, "be2021_gj_per_year", "Be2021", { allowZero: true });
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

function calculatePart6(
  inputs: UnknownRecord,
  product: unknown,
  installationDate: string,
  part6RevisionApplied: boolean,
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
    "hspf_upgrade",
    "tcspf_upgrade",
    "hspf_cold_eligibility",
    "tcspf_cold_eligibility",
    "refrigerant_gwp",
    "performance_basis",
    "same_oem_confirmed",
  ], "Part 6 input");
  const scenario = selectInput(inputs, "scenario", "Part 6 scenario", CREDITEX_VEU_PART_6_SCENARIOS);
  const category = selectInput(inputs, "category", "Part 6 category", CREDITEX_VEU_PART_6_CATEGORIES);
  const premises = selectInput(inputs, "premises", "premises type", ["residential", "business"] as const);
  const locationClass = selectInput(inputs, "location_class", "location class", CREDITEX_VEU_LOCATION_CLASSES);
  const configuration = selectInput(inputs, "configuration", "air-conditioner configuration", ["single", "multi"] as const);
  const performanceBasis = selectInput(inputs, "performance_basis", "performance basis", ["gems", "calculated_from_acop_aeer"] as const);
  const ratedHeating = decimalInput(inputs, "rated_heating_capacity_kw", "Rated heating capacity");
  const ratedCooling = decimalInput(inputs, "rated_cooling_capacity_kw", "Rated cooling capacity");
  let outdoorHeating: Fraction | null = null;
  let outdoorCooling: Fraction | null = null;
  if (configuration === "multi") {
    outdoorHeating = decimalInput(inputs, "outdoor_heating_capacity_kw", "Outdoor-unit heating capacity");
    outdoorCooling = decimalInput(inputs, "outdoor_cooling_capacity_kw", "Outdoor-unit cooling capacity");
    if (inputs.same_oem_confirmed !== "yes") {
      fail("VEU_SYSTEM_INELIGIBLE", "All multi-split indoor units must use the same original equipment manufacturer as the outdoor unit.", 409);
    }
  } else if (
    inputs.outdoor_heating_capacity_kw !== undefined
    || inputs.outdoor_cooling_capacity_kw !== undefined
    || inputs.same_oem_confirmed !== undefined
  ) {
    fail("VEU_REQUEST_INVALID", "Remove multi-split-only inputs for a single system.");
  }
  const productRatedCooling = outdoorCooling ?? ratedCooling;
  ensurePart6CategoryCapacity(category, productRatedCooling);
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
      product: evidence,
    },
    trace: [
      traceEntry("governed_heating_capacity", "Governed heating capacity", decimalPresentation(ratedHeating).decimal, "indoor sum capped by outdoor rating, scenario cap and applicable 20 kW residential multi-split cap", heatingCapacity, "kW"),
      traceEntry("governed_cooling_capacity", "Governed cooling capacity", decimalPresentation(ratedCooling).decimal, "indoor sum capped by outdoor rating, scenario cap and applicable 20 kW residential multi-split cap", coolingCapacity, "kW"),
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
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["13"]);
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
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["14"]);
  ensurePositiveResult(result);
  return {
    scenario: productType === "film" ? "14B" : "14A",
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
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["17"]);
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
  const evidence = validateProductEvidence(product, installationDate, "GEMS", [scenario]);
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
  const evidence = validateProductEvidence(product, installationDate, "VEU", ["26"]);
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

function calculatePart46(inputs: UnknownRecord, product: unknown): Execution {
  exactKeys(inputs, ["scenario"], "Part 46 input");
  if (product !== undefined) {
    fail("VEU_REQUEST_INVALID", "Part 46 no longer uses the Secretary product list; remove product registry evidence.");
  }
  const scenario = selectInput(inputs, "scenario", "Part 46 scenario", ["46A", "46B"] as const);
  const result = multiply(subtract(decimalConstant("0.1"), decimalConstant("0.04")), decimalConstant("25"));
  return {
    scenario,
    result,
    inputSnapshot: { scenario },
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
  const category = scenario.startsWith("48A") ? "48A" : "48B";
  const evidence = validateProductEvidence(product, installationDate, "VEU", [category]);
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
): Execution {
  switch (activityCode) {
    case "1C":
    case "1D":
      return calculatePart1(activityCode, inputs, product, installationDate);
    case "3C":
    case "3D":
      return calculatePart3(activityCode, inputs, product, installationDate);
    case "6":
      return calculatePart6(inputs, product, installationDate, part6RevisionApplied);
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
    case "46":
      return calculatePart46(inputs, product);
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
  exactKeys(request, ["activityCode", "installationDate", "inputs", "product"], "VEU estimate request");
  const activityCode = requiredString(request.activityCode, "Activity code");
  const activity = CREDITEX_VEU_ACTIVITY_DEFINITIONS.find((candidate) => candidate.activityCode === activityCode);
  if (!activity) {
    fail("VEU_ACTIVITY_UNSUPPORTED", `Activity ${activityCode} is not executable in this bounded VEU slice.`, 404);
  }
  const installationDate = parseDate(request.installationDate, "Installation date").text;
  const specification = resolveSpecification(installationDate, activityCode);
  const inputs = record(request.inputs, "Activity inputs");
  const execution = execute(
    activityCode,
    inputs,
    request.product,
    installationDate,
    specification.part6RevisionApplied,
  );
  if (!(activity.scenarios as readonly string[]).includes(execution.scenario)) {
    fail("VEU_REQUEST_INVALID", `Scenario ${execution.scenario} is not declared for activity ${activityCode}.`);
  }
  const rounded = nearestWholeCertificates(execution.result);
  const presentation = decimalPresentation(execution.result);
  const output = {
    unroundedTonnes: presentation.decimal,
    unroundedDecimalStatus: presentation.status,
    exactFraction: exactFraction(execution.result),
    wholeCertificates: rounded.wholeCertificates,
    roundingStatus: rounded.tie
      ? "exact_half_tie_requires_regulator_confirmation" as const
      : "nearest_whole_applied" as const,
    unit: "VEEC" as const,
  };
  const formulaKey = `${activity.formulaKey}:${specification.formulaProfile}`;
  const inputSnapshot = {
    installationDate,
    ...execution.inputSnapshot,
  };
  const receiptBase = {
    schemaVersion: CREDITEX_VEU_ESTIMATE_SCHEMA,
    estimatorVersion: CREDITEX_VEU_ESTIMATOR_VERSION,
    activityCode,
    scenario: execution.scenario,
    formulaKey,
    specificationVersion: specification.source.version,
    inputSnapshot,
    trace: execution.trace,
    output,
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
    productRegistryUrl: activity.productRegistry === "VEU"
      ? CREDITEX_VEU_PUBLIC_REGISTRY_URL
      : "",
    inputSnapshot,
    trace: execution.trace,
    output,
    status: rounded.tie
      ? "estimate_only_rounding_tie_unresolved"
      : "estimate_only_compliance_reconciliation_required",
    certificateActionEnabled: false,
    operatorMessage: rounded.tie
      ? "The official guide requires nearest-whole VEEC rounding but does not state the exact 0.5 tie rule. The unrounded exact quantity is retained and no whole certificate value is asserted."
      : "Estimate only. Reconcile the installation, postcode classification, approved product record, effective dates and all activity evidence against the official VEU systems before certificate creation.",
    inputHash: sha256(inputSnapshot),
    traceHash: sha256(execution.trace),
    outputHash: sha256(output),
    receiptHash: sha256(receiptBase),
  };
}
