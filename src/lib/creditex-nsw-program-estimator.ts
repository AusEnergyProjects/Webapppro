import { createHash } from "node:crypto";
import {
  creditexNswActivityDefinition,
  creditexNswProgramDefinition,
  type CreditexNswActivityDefinition,
  type CreditexNswInputDefinition,
  type CreditexNswProgramDefinition,
  type CreditexNswSourceReference,
} from "./creditex-nsw-program-catalogue.ts";

export const CREDITEX_NSW_ESTIMATE_SCHEMA =
  "creditex-nsw-program-estimate/v1" as const;
export const CREDITEX_NSW_ESTIMATOR_VERSION =
  "creditex-nsw-program-estimator/exact-rational-2026-07-v1" as const;

export type CreditexNswEstimateErrorCode =
  | "NSW_ESTIMATE_INVALID"
  | "NSW_PROGRAM_NOT_SUPPORTED"
  | "NSW_ACTIVITY_NOT_SUPPORTED"
  | "NSW_EFFECTIVE_DATE_UNSUPPORTED"
  | "NSW_INPUT_INVALID"
  | "NSW_ELIGIBILITY_NOT_CONFIRMED"
  | "NSW_PRODUCT_DATA_NOT_CONFIRMED"
  | "NSW_RULE_AMBIGUITY"
  | "NSW_NON_POSITIVE_SAVINGS";

export class CreditexNswEstimateError extends Error {
  readonly code: CreditexNswEstimateErrorCode;
  readonly status: number;

  constructor(
    code: CreditexNswEstimateErrorCode,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "CreditexNswEstimateError";
    this.code = code;
    this.status = status;
  }
}

type Rational = {
  numerator: bigint;
  denominator: bigint;
};

type ValidatedRequest = {
  program: CreditexNswProgramDefinition;
  activity: CreditexNswActivityDefinition;
  effectiveDate: string;
  inputs: Record<string, string>;
};

export type CreditexNswEstimateTraceEntry = {
  key: string;
  label: string;
  input: string;
  operation: string;
  output: string;
  unit: string;
  source: string;
};

export type CreditexNswProgramEstimate = {
  schemaVersion: typeof CREDITEX_NSW_ESTIMATE_SCHEMA;
  estimatorVersion: typeof CREDITEX_NSW_ESTIMATOR_VERSION;
  programCode: string;
  jurisdiction: "NSW";
  activityCode: string;
  officialActivityCode: string;
  activityTitle: string;
  supportedScenario: string;
  formulaKey: string;
  sourceVersion: string;
  sourceEffectiveFrom: string;
  sourceEffectiveTo: string;
  effectiveDate: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  sourceReferences: readonly CreditexNswSourceReference[];
  productRegistryRequirements: readonly string[];
  trace: CreditexNswEstimateTraceEntry[];
  output: {
    quantity: string;
    unit: "ESC" | "PRC";
    label: string;
    rawExact: string;
    rounding: "floor_after_single_implementation";
  };
  annualAllocation: readonly {
    compliancePeriodOrdinal: number;
    quantity: string;
    unit: "PRC";
  }[];
  status: "estimate_only_registry_and_evidence_reconciliation_required";
  certificateActionEnabled: false;
  operatorMessage: string;
  inputHash: string;
  traceHash: string;
  outputHash: string;
  receiptHash: string;
};

type Calculation = {
  rawCertificates: Rational;
  wholeCertificates: bigint;
  trace: CreditexNswEstimateTraceEntry[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/;
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_TWO = BigInt(2);
const BIGINT_FIVE = BigInt(5);
const BIGINT_TEN = BigInt(10);
const ZERO: Rational = { numerator: BIGINT_ZERO, denominator: BIGINT_ONE };
const ONE: Rational = { numerator: BIGINT_ONE, denominator: BIGINT_ONE };

function fail(
  code: CreditexNswEstimateErrorCode,
  message: string,
  status = 400,
): never {
  throw new CreditexNswEstimateError(code, message, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      "NSW_ESTIMATE_INVALID",
      `${path} must contain exactly ${expected.join(", ")}.`,
    );
  }
}

function stringValue(value: unknown, path: string, maximum = 120) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail("NSW_ESTIMATE_INVALID", `${path} must be a non-empty string.`);
  }
  return value;
}

function canonicalDate(value: unknown) {
  const date = stringValue(value, "effectiveDate", 10);
  if (!DATE_PATTERN.test(date)) {
    fail("NSW_ESTIMATE_INVALID", "effectiveDate must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    fail("NSW_ESTIMATE_INVALID", "effectiveDate is not a valid calendar date.");
  }
  return date;
}

function absolute(value: bigint) {
  return value < BIGINT_ZERO ? -value : value;
}

function gcd(left: bigint, right: bigint) {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== BIGINT_ZERO) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === BIGINT_ZERO ? BIGINT_ONE : a;
}

function rational(numerator: bigint, denominator = BIGINT_ONE): Rational {
  if (denominator === BIGINT_ZERO) {
    fail("NSW_INPUT_INVALID", "Division by zero is not permitted.");
  }
  const sign = denominator < BIGINT_ZERO ? -BIGINT_ONE : BIGINT_ONE;
  const divisor = gcd(numerator, denominator);
  return {
    numerator: sign * numerator / divisor,
    denominator: absolute(denominator) / divisor,
  };
}

function parseDecimal(value: string, path: string): Rational {
  if (!DECIMAL_PATTERN.test(value)) {
    fail(
      "NSW_INPUT_INVALID",
      `${path} must be a non-negative base-10 decimal string with no more than 9 decimal places.`,
    );
  }
  const [whole, fraction = ""] = value.split(".");
  const denominator = BIGINT_TEN ** BigInt(fraction.length);
  return rational(BigInt(`${whole}${fraction}`), denominator);
}

function add(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtract(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiply(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

function divide(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
  );
}

function compare(left: Rational, right: Rational) {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < BIGINT_ZERO ? -1 : difference > BIGINT_ZERO ? 1 : 0;
}

function minimum(...values: Rational[]) {
  if (values.length === 0) return ZERO;
  return values.reduce((result, value) => compare(result, value) <= 0 ? result : value);
}

function floorPositive(value: Rational) {
  if (value.numerator < BIGINT_ZERO) {
    fail("NSW_NON_POSITIVE_SAVINGS", "A negative result cannot be converted to certificates.", 409);
  }
  return value.numerator / value.denominator;
}

function exactText(value: Rational) {
  const normalized = rational(value.numerator, value.denominator);
  let denominator = normalized.denominator;
  let powersOfTwo = 0;
  let powersOfFive = 0;
  while (denominator % BIGINT_TWO === BIGINT_ZERO) {
    denominator /= BIGINT_TWO;
    powersOfTwo += 1;
  }
  while (denominator % BIGINT_FIVE === BIGINT_ZERO) {
    denominator /= BIGINT_FIVE;
    powersOfFive += 1;
  }
  if (denominator !== BIGINT_ONE) {
    return normalized.denominator === BIGINT_ONE
      ? normalized.numerator.toString()
      : `${normalized.numerator}/${normalized.denominator}`;
  }
  const scale = Math.max(powersOfTwo, powersOfFive);
  let coefficient = normalized.numerator;
  if (powersOfTwo < scale) coefficient *= BIGINT_TWO ** BigInt(scale - powersOfTwo);
  if (powersOfFive < scale) coefficient *= BIGINT_FIVE ** BigInt(scale - powersOfFive);
  if (scale === 0) return coefficient.toString();
  const negative = coefficient < BIGINT_ZERO;
  const digits = absolute(coefficient).toString().padStart(scale + 1, "0");
  const split = digits.length - scale;
  const rendered = `${negative ? "-" : ""}${digits.slice(0, split)}.${digits.slice(split)}`
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
  return rendered;
}

function constant(value: string) {
  return parseDecimal(value, "formula constant");
}

function whole(value: number | bigint) {
  return rational(BigInt(value));
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateInput(
  definition: CreditexNswInputDefinition,
  value: unknown,
) {
  const text = stringValue(value, `inputs.${definition.key}`, 64);
  if (definition.type === "select") {
    if (!definition.options?.some((option) => option.value === text)) {
      fail("NSW_INPUT_INVALID", `inputs.${definition.key} is not an allowed option.`);
    }
    return text;
  }
  const parsed = parseDecimal(text, `inputs.${definition.key}`);
  if (definition.type === "integer" && parsed.denominator !== BIGINT_ONE) {
    fail("NSW_INPUT_INVALID", `inputs.${definition.key} must be a whole number.`);
  }
  if (
    definition.minimum !== undefined
    && compare(parsed, constant(definition.minimum)) < 0
  ) {
    fail(
      "NSW_INPUT_INVALID",
      `inputs.${definition.key} must be at least ${definition.minimum} ${definition.unit}.`,
    );
  }
  if (
    definition.maximum !== undefined
    && compare(parsed, constant(definition.maximum)) > 0
  ) {
    fail(
      "NSW_INPUT_INVALID",
      `inputs.${definition.key} must not exceed ${definition.maximum} ${definition.unit}.`,
    );
  }
  return exactText(parsed);
}

function validateRequest(value: unknown): ValidatedRequest {
  if (!isRecord(value)) {
    fail("NSW_ESTIMATE_INVALID", "The estimate request must be an object.");
  }
  exactKeys(value, ["programCode", "activityCode", "effectiveDate", "inputs"], "request");
  const programCode = stringValue(value.programCode, "programCode", 64);
  const activityCode = stringValue(value.activityCode, "activityCode", 64);
  const effectiveDate = canonicalDate(value.effectiveDate);
  const program = creditexNswProgramDefinition(programCode);
  if (!program) {
    fail(
      "NSW_PROGRAM_NOT_SUPPORTED",
      `Program ${programCode} has no source-pinned NSW estimate.`,
      404,
    );
  }
  const activity = creditexNswActivityDefinition(programCode, activityCode);
  if (!activity) {
    fail(
      "NSW_ACTIVITY_NOT_SUPPORTED",
      `Activity ${activityCode} is not executable for ${programCode}.`,
      404,
    );
  }
  if (
    effectiveDate < program.effectiveFrom
    || effectiveDate > program.effectiveTo
    || effectiveDate < activity.effectiveFrom
    || effectiveDate > activity.effectiveTo
  ) {
    fail(
      "NSW_EFFECTIVE_DATE_UNSUPPORTED",
      `${activityCode} has no source-pinned executable formula for ${effectiveDate}.`,
      409,
    );
  }
  if (!isRecord(value.inputs)) {
    fail("NSW_ESTIMATE_INVALID", "inputs must be an object.");
  }
  exactKeys(
    value.inputs,
    activity.inputDefinitions.map((definition) => definition.key),
    "inputs",
  );
  const inputs: Record<string, string> = {};
  for (const definition of activity.inputDefinitions) {
    inputs[definition.key] = validateInput(definition, value.inputs[definition.key]);
  }
  if (inputs.nsw_site_confirmed !== "yes" || inputs.all_non_formula_requirements_confirmed !== "yes") {
    fail(
      "NSW_ELIGIBILITY_NOT_CONFIRMED",
      "NSW site eligibility and every non-formula rule requirement must be confirmed.",
      409,
    );
  }
  if (inputs.product_registry_eligibility_confirmed !== "yes") {
    fail(
      "NSW_PRODUCT_DATA_NOT_CONFIRMED",
      "Current product-list or GEMS eligibility for the exact model must be confirmed.",
      409,
    );
  }
  return { program, activity, effectiveDate, inputs };
}

function input(request: ValidatedRequest, key: string) {
  const value = request.inputs[key];
  if (value === undefined) {
    fail("NSW_ESTIMATE_INVALID", `Validated input ${key} is unavailable.`);
  }
  return value;
}

function inputRational(request: ValidatedRequest, key: string) {
  return parseDecimal(input(request, key), `inputs.${key}`);
}

function traceEntry(
  key: string,
  label: string,
  inputText: string,
  operation: string,
  output: Rational,
  unit: string,
  source: string,
): CreditexNswEstimateTraceEntry {
  return {
    key,
    label,
    input: inputText,
    operation,
    output: exactText(output),
    unit,
    source,
  };
}

function requirePositive(value: Rational, label: string) {
  if (compare(value, ZERO) <= 0) {
    fail(
      "NSW_NON_POSITIVE_SAVINGS",
      `${label} must be positive after applying every fuel contribution.`,
      409,
    );
  }
}

function requireRange(
  value: Rational,
  minimum: Rational,
  maximum: Rational,
  minimumInclusive: boolean,
  maximumInclusive: boolean,
  message: string,
) {
  const lower = compare(value, minimum);
  const upper = compare(value, maximum);
  if (
    (minimumInclusive ? lower < 0 : lower <= 0)
    || (maximumInclusive ? upper > 0 : upper >= 0)
  ) {
    fail("NSW_INPUT_INVALID", message, 409);
  }
}

const NETWORK_LOSS_FACTORS = {
  ausgrid: constant("1.04"),
  endeavour: constant("1.05"),
  essential: constant("1.05"),
} as const;

function networkLossFactor(request: ValidatedRequest) {
  const network = input(request, "distribution_network");
  const factor = NETWORK_LOSS_FACTORS[network as keyof typeof NETWORK_LOSS_FACTORS];
  if (!factor) fail("NSW_INPUT_INVALID", "The distribution network has no Table A3 factor.");
  return factor;
}

const REGIONAL_POSTCODE_RANGES: readonly [number, number][] = [
  [2311, 2312], [2321, 2321], [2324, 2324], [2329, 2329], [2338, 2490],
  [2536, 2537], [2545, 2551], [2579, 2594], [2611, 2611], [2618, 2739],
  [2787, 2787], [2791, 2844], [2850, 2880], [3644, 3644], [3691, 3691],
  [3707, 3707], [4375, 4375], [4377, 4377], [4380, 4380], [4383, 4383],
  [4385, 4385],
];

function inRanges(postcode: number, ranges: readonly [number, number][]) {
  return ranges.some(([start, end]) => postcode >= start && postcode <= end);
}

function regionalNetworkFactor(request: ValidatedRequest) {
  const postcode = Number(input(request, "site_postcode"));
  return inRanges(postcode, REGIONAL_POSTCODE_RANGES) ? constant("1.03") : ONE;
}

const COLD_CLIMATE_POSTCODE_RANGES: readonly [number, number][] = [
  [2328, 2329], [2333, 2333], [2336, 2347], [2350, 2361], [2365, 2365],
  [2369, 2372], [2379, 2382], [2395, 2396], [2403, 2404], [2453, 2453],
  [2475, 2476], [2527, 2527], [2529, 2529], [2533, 2541], [2545, 2546],
  [2548, 2551], [2575, 2588], [2590, 2590], [2594, 2594], [2600, 2607],
  [2609, 2609], [2611, 2612], [2614, 2615], [2617, 2633], [2640, 2647],
  [2649, 2653], [2655, 2656], [2658, 2661], [2663, 2663], [2665, 2666],
  [2668, 2668], [2671, 2671], [2701, 2702], [2712, 2712], [2720, 2722],
  [2725, 2727], [2729, 2730], [2776, 2776], [2778, 2780], [2782, 2787],
  [2790, 2795], [2797, 2800], [2803, 2810], [2820, 2821], [2823, 2825],
  [2827, 2830], [2842, 2850], [2852, 2852], [2864, 2871], [2873, 2876],
  [3644, 3644], [3707, 3707],
];

const HOT_CLIMATE_POSTCODE_RANGES: readonly [number, number][] = [
  [2477, 2479], [2481, 2490],
];

type AirconClimateZone = "hot" | "average" | "cold";

function airconClimateZone(request: ValidatedRequest): AirconClimateZone {
  const postcode = Number(input(request, "site_postcode"));
  if (postcode === 2730) {
    fail(
      "NSW_RULE_AMBIGUITY",
      "ESS Table A27 lists postcode 2730 in both Cold (2729-2730) and Average (2730-2739). The estimator will not choose between contradictory rows.",
      409,
    );
  }
  if (inRanges(postcode, HOT_CLIMATE_POSTCODE_RANGES)) return "hot";
  if (inRanges(postcode, COLD_CLIMATE_POSTCODE_RANGES)) return "cold";
  return "average";
}

const PDRS_TEMPERATURE_FACTORS: Record<string, Rational> = {
  "2": constant("0.48"),
  "4": constant("1.03"),
  "5": constant("0.55"),
  "6": constant("1.04"),
  "7": constant("0.92"),
  "8": constant("0.55"),
};

function bcaTemperatureFactor(request: ValidatedRequest) {
  const zone = input(request, "bca_climate_zone");
  const factor = PDRS_TEMPERATURE_FACTORS[zone];
  if (!factor) {
    fail("NSW_INPUT_INVALID", `BCA climate zone ${zone} has no PDRS Table A5 factor.`);
  }
  return factor;
}

type AirconBaseline = {
  newCooling: string;
  newHeating: string;
  replacementCooling: string;
  replacementHeating: string;
};

type AirconThreshold = {
  coolingSeasonal: string;
  heatingMixed: string;
  heatingCold: string;
  ratedCooling: string;
  ratedHeating: string;
};

function airconGroup(productClass: number) {
  if ([8, 18].includes(productClass)) return 0;
  if ([9, 19].includes(productClass)) return 1;
  if ([5, 6, 10, 11, 20].includes(productClass)) return 2;
  if ([7, 12, 21, 24, 25, 27].includes(productClass)) return 3;
  fail("NSW_INPUT_INVALID", `Product class ${productClass} has no captured air-conditioner table row.`);
}

const AIRCON_BASELINES: readonly AirconBaseline[] = [
  { newCooling: "3.66", newHeating: "2.33", replacementCooling: "3.33", replacementHeating: "2.17" },
  { newCooling: "3.22", newHeating: "2.11", replacementCooling: "2.93", replacementHeating: "1.97" },
  { newCooling: "3.1", newHeating: "2.05", replacementCooling: "2.8", replacementHeating: "1.90" },
  { newCooling: "2.9", newHeating: "1.95", replacementCooling: "2.75", replacementHeating: "1.88" },
];

const RESIDENTIAL_THRESHOLDS: readonly AirconThreshold[] = [
  { coolingSeasonal: "5.5", heatingMixed: "4.5", heatingCold: "4.0", ratedCooling: "4.3", ratedHeating: "4.4" },
  { coolingSeasonal: "4.5", heatingMixed: "4.0", heatingCold: "3.5", ratedCooling: "3.6", ratedHeating: "3.8" },
  { coolingSeasonal: "4.0", heatingMixed: "3.5", heatingCold: "3.0", ratedCooling: "3.5", ratedHeating: "3.8" },
  { coolingSeasonal: "3.0", heatingMixed: "2.5", heatingCold: "2.0", ratedCooling: "3.3", ratedHeating: "3.5" },
];

const COMMERCIAL_THRESHOLDS: readonly AirconThreshold[] = [
  { coolingSeasonal: "7.0", heatingMixed: "4.5", heatingCold: "4.0", ratedCooling: "4.3", ratedHeating: "4.4" },
  { coolingSeasonal: "5.5", heatingMixed: "4.0", heatingCold: "3.5", ratedCooling: "3.6", ratedHeating: "3.8" },
  { coolingSeasonal: "5.0", heatingMixed: "3.5", heatingCold: "3.5", ratedCooling: "3.5", ratedHeating: "3.8" },
  { coolingSeasonal: "3.5", heatingMixed: "3.0", heatingCold: "2.5", ratedCooling: "3.3", ratedHeating: "3.5" },
];

function baselineFor(request: ValidatedRequest) {
  const group = airconGroup(Number(input(request, "product_class")));
  const baseline = AIRCON_BASELINES[group];
  if (!baseline) fail("NSW_INPUT_INVALID", "The product class baseline row is unavailable.");
  const replacement = input(request, "application_type") === "replacement";
  return {
    cooling: constant(replacement ? baseline.replacementCooling : baseline.newCooling),
    heating: constant(replacement ? baseline.replacementHeating : baseline.newHeating),
  };
}

function checkCoolingEligibility(request: ValidatedRequest, commercial: boolean) {
  const group = airconGroup(Number(input(request, "product_class")));
  const row = (commercial ? COMMERCIAL_THRESHOLDS : RESIDENTIAL_THRESHOLDS)[group];
  if (!row) fail("NSW_INPUT_INVALID", "The product class threshold row is unavailable.");
  const threshold = constant(
    input(request, "cooling_efficiency_basis") === "tcspf"
      ? row.coolingSeasonal
      : row.ratedCooling,
  );
  const actual = inputRational(request, "cooling_efficiency_value");
  if (compare(actual, threshold) < 0) {
    fail(
      "NSW_INPUT_INVALID",
      `Cooling efficiency ${exactText(actual)} is below the applicable minimum ${exactText(threshold)}.`,
      409,
    );
  }
  return threshold;
}

function checkHeatingEligibility(
  request: ValidatedRequest,
  commercial: boolean,
  climate: AirconClimateZone,
) {
  const group = airconGroup(Number(input(request, "product_class")));
  const row = (commercial ? COMMERCIAL_THRESHOLDS : RESIDENTIAL_THRESHOLDS)[group];
  if (!row) fail("NSW_INPUT_INVALID", "The product class threshold row is unavailable.");
  const threshold = constant(
    input(request, "heating_efficiency_basis") === "hspf"
      ? (climate === "cold" ? row.heatingCold : row.heatingMixed)
      : row.ratedHeating,
  );
  const actual = inputRational(request, "heating_efficiency_value");
  if (compare(actual, threshold) < 0) {
    fail(
      "NSW_INPUT_INVALID",
      `Heating efficiency ${exactText(actual)} is below the applicable minimum ${exactText(threshold)}.`,
      409,
    );
  }
  return threshold;
}

function pdrsCoolingCapacityAndInput(request: ValidatedRequest) {
  const multi = request.activity.activityCode.endsWith("-MULTI");
  if (!multi) {
    return {
      capacity: inputRational(request, "rated_cooling_capacity_kw"),
      inputPower: inputRational(request, "rated_cooling_input_kw"),
      detail: "single/unitary GEMS capacity and rated cooling input",
    };
  }
  const outdoorCapacity = inputRational(request, "outdoor_cooling_capacity_kw");
  const indoorSum = inputRational(request, "indoor_cooling_capacity_sum_kw");
  const outdoorInput = inputRational(request, "outdoor_rated_cooling_input_kw");
  const ratio = minimum(divide(indoorSum, outdoorCapacity), ONE);
  return {
    capacity: minimum(indoorSum, outdoorCapacity),
    inputPower: multiply(outdoorInput, ratio),
    detail: `multi-split capacity/input ratio ${exactText(ratio)}`,
  };
}

function pdrsFromSavingsCapacity(
  request: ValidatedRequest,
  savingsCapacity: Rational,
  trace: CreditexNswEstimateTraceEntry[],
  cap?: bigint,
): Calculation {
  requirePositive(savingsCapacity, "Peak demand savings/shifting/response capacity");
  const duration = whole(6);
  const lifetime = whole(request.activity.lifetimeYears);
  const peakDemandReduction = multiply(multiply(savingsCapacity, duration), lifetime);
  const lossFactor = networkLossFactor(request);
  const rawCertificates = multiply(multiply(peakDemandReduction, lossFactor), whole(10));
  let wholeCertificates = floorPositive(rawCertificates);
  if (cap !== undefined && wholeCertificates > cap) wholeCertificates = cap;
  trace.push(
    traceEntry(
      "peak_demand_reduction_capacity",
      "Lifetime peak demand reduction capacity",
      `${exactText(savingsCapacity)} kW; 6 hours; ${request.activity.lifetimeYears} years`,
      "capacity x Summer Peak Demand Reduction Duration x Lifetime",
      peakDemandReduction,
      "kW",
      "PDRS Equations 2a/2b/2c",
    ),
    traceEntry(
      "raw_prcs",
      "Raw Peak Reduction Certificates",
      `${exactText(peakDemandReduction)} kW; NLF ${exactText(lossFactor)}`,
      "Peak Demand Reduction Capacity x Network Loss Factor x 10",
      rawCertificates,
      "PRC",
      "PDRS Equation 1 and Tables A3/A6",
    ),
    traceEntry(
      "whole_prcs",
      "Whole Peak Reduction Certificates",
      exactText(rawCertificates),
      cap === undefined
        ? "floor to whole certificates"
        : `floor to whole certificates, then apply ${cap.toString()} PRC activity cap`,
      whole(wholeCertificates),
      "PRC",
      cap === undefined ? "PDRS clause 6.4" : "PDRS clause 6.4 and activity cap",
    ),
  );
  return { rawCertificates, wholeCertificates, trace };
}

function calculatePdrsHvac(request: ValidatedRequest) {
  const hvac2 = request.activity.officialActivityCode === "HVAC2";
  checkCoolingEligibility(request, hvac2);
  const product = pdrsCoolingCapacityAndInput(request);
  if (hvac2 && compare(product.capacity, whole(30)) < 0) {
    fail("NSW_INPUT_INVALID", "HVAC2 calculated cooling capacity must be at least 30 kW.", 409);
  }
  const baseline = baselineFor(request).cooling;
  const baselineInput = divide(product.capacity, baseline);
  const temperature = bcaTemperatureFactor(request);
  const usage = constant(hvac2 ? "0.6" : "0.72");
  const adjustment = multiply(temperature, usage);
  const savingsCapacity = multiply(subtract(baselineInput, product.inputPower), adjustment);
  const trace = [
    traceEntry(
      "rated_cooling_capacity",
      "Rated cooling capacity used",
      product.detail,
      "Rule-defined single or multi-split capacity",
      product.capacity,
      "kW",
      `${request.activity.officialActivityCode} capacity definition`,
    ),
    traceEntry(
      "baseline_input_power",
      "Baseline input power",
      `${exactText(product.capacity)} kW / ${exactText(baseline)} baseline AEER`,
      "Rated Cooling Capacity / Baseline AEER",
      baselineInput,
      "kW",
      `${request.activity.officialActivityCode}.1 and baseline table`,
    ),
    traceEntry(
      "peak_adjustment",
      "Peak adjustment factor",
      `${exactText(temperature)} temperature; ${exactText(usage)} usage`,
      "Temperature Factor x Usage Factor",
      adjustment,
      "factor",
      `${request.activity.officialActivityCode}.2 and Table A5`,
    ),
    traceEntry(
      "peak_demand_savings_capacity",
      "Peak demand savings capacity",
      `${exactText(baselineInput)} baseline kW; ${exactText(product.inputPower)} product kW`,
      "(Baseline Input Power - Input Power) x common Peak Adjustment x Firmness 1",
      savingsCapacity,
      "kW",
      request.activity.officialActivityCode,
    ),
  ];
  const cap = request.activity.activityCode === "HVAC1-MULTI" ? BigInt(500) : undefined;
  return pdrsFromSavingsCapacity(request, savingsCapacity, trace, cap);
}

function usableBatteryCapacity(request: ValidatedRequest) {
  return multiply(inputRational(request, "nominal_battery_capacity_kwh"), constant("0.9"));
}

function checkBatteryCapacityToInverter(usable: Rational, inverter: Rational) {
  if (compare(usable, multiply(inverter, whole(6))) > 0) {
    fail(
      "NSW_INPUT_INVALID",
      "Usable battery capacity must not exceed six times battery inverter output.",
      409,
    );
  }
}

function checkPayment(request: ValidatedRequest, minimumPayment: Rational) {
  const exemption = input(request, "payment_exemption");
  const payment = inputRational(request, "net_payment_ex_gst_aud");
  if (exemption === "none" && compare(payment, minimumPayment) < 0) {
    fail(
      "NSW_INPUT_INVALID",
      `Net purchaser payment must be at least ${exactText(minimumPayment)} AUD unless the selected Rule exemption applies.`,
      409,
    );
  }
}

function batteryTrace(
  request: ValidatedRequest,
  usable: Rational,
  calculationCapacity: Rational,
  demandComponent: Rational,
  operation: string,
) {
  return [
    traceEntry(
      "usable_battery_capacity",
      "Usable battery capacity",
      `${input(request, "nominal_battery_capacity_kwh")} kWh nominal`,
      "Nominal Battery Capacity x 90%",
      usable,
      "kWh",
      "PDRS clause 10 definition of Usable Battery Capacity",
    ),
    traceEntry(
      "calculation_battery_capacity",
      "Battery capacity used by activity equation",
      "Rule-defined usable, inverter, dwelling and/or 10,000 kWh caps",
      "minimum of the applicable activity limits",
      calculationCapacity,
      "kWh",
      request.activity.officialActivityCode,
    ),
    traceEntry(
      "demand_component",
      "Demand shifting or response component",
      `${exactText(calculationCapacity)} kWh`,
      operation,
      demandComponent,
      "kW",
      request.activity.officialActivityCode,
    ),
  ];
}

function calculateBess1(request: ValidatedRequest) {
  if (input(request, "post_2025_exception") === "none") {
    fail("NSW_ELIGIBILITY_NOT_CONFIRMED", "Post-30 June 2025 BESS1 requires a clause 6.10.2 exception.", 409);
  }
  checkPayment(request, whole(200));
  const usable = usableBatteryCapacity(request);
  requireRange(usable, whole(2), whole(28), false, false, "BESS1 usable battery capacity must be greater than 2 kWh and less than 28 kWh.");
  const component = multiply(usable, constant("0.0853"));
  return pdrsFromSavingsCapacity(
    request,
    component,
    batteryTrace(request, usable, usable, component, "Usable Battery Capacity x 0.0853 x Firmness 1"),
  );
}

function calculateBess2(request: ValidatedRequest) {
  const usable = usableBatteryCapacity(request);
  requireRange(usable, whole(2), whole(50), false, true, "BESS2 usable battery capacity must be greater than 2 kWh and no more than 50 kWh.");
  const capacity = minimum(usable, whole(28));
  const component = multiply(multiply(capacity, constant("0.0734")), constant("0.8"));
  return pdrsFromSavingsCapacity(
    request,
    component,
    batteryTrace(request, usable, capacity, component, "Battery Capacity x 0.0734 x Firmness 0.8"),
  );
}

function calculateBess3(request: ValidatedRequest) {
  checkPayment(request, whole(1000));
  const usable = usableBatteryCapacity(request);
  const inverter = inputRational(request, "battery_inverter_output_kw");
  requireRange(usable, whole(20), whole(200), false, true, "BESS3 usable battery capacity must be greater than 20 kWh and no more than 200 kWh.");
  checkBatteryCapacityToInverter(usable, inverter);
  const dwellingCap = multiply(inputRational(request, "individual_dwellings"), whole(5));
  const capacity = minimum(usable, dwellingCap, multiply(inverter, whole(4)));
  const factor = constant(input(request, "solar_pathway") === "within_90_days_no_nsw_funding" ? "0.12" : "0.0853");
  const component = multiply(capacity, factor);
  return pdrsFromSavingsCapacity(
    request,
    component,
    batteryTrace(request, usable, capacity, component, `Battery Capacity x ${exactText(factor)} x Firmness 1`),
  );
}

function calculateBess4(request: ValidatedRequest) {
  if (compare(inputRational(request, "net_payment_ex_gst_aud"), whole(5000)) < 0) {
    fail("NSW_INPUT_INVALID", "BESS4 net purchaser payment must be at least 5,000 AUD.", 409);
  }
  const usable = usableBatteryCapacity(request);
  const inverter = inputRational(request, "battery_inverter_output_kw");
  requireRange(usable, whole(20), whole(200), false, true, "BESS4 usable battery capacity must be greater than 20 kWh and no more than 200 kWh.");
  checkBatteryCapacityToInverter(usable, inverter);
  if (compare(inputRational(request, "new_solar_capacity_kw"), divide(usable, whole(4))) < 0) {
    fail("NSW_INPUT_INVALID", "BESS4 new solar capacity must be at least one quarter of usable battery capacity.", 409);
  }
  const capacity = minimum(usable, multiply(inverter, whole(4)));
  const withinNinetyDays = input(request, "new_solar_within_90_days") === "yes";
  const baseFactor = constant(withinNinetyDays ? "0.1" : "0.067");
  let component: Rational;
  let equation: string;
  if (compare(capacity, whole(50)) <= 0) {
    component = multiply(multiply(capacity, baseFactor), constant("0.5"));
    equation = withinNinetyDays ? "BESS4.2A" : "BESS4.3A";
  } else if (compare(capacity, whole(100)) <= 0) {
    const firstBand = multiply(multiply(whole(50), baseFactor), constant("0.5"));
    const secondBand = multiply(multiply(subtract(capacity, whole(50)), baseFactor), constant("0.7"));
    component = add(firstBand, secondBand);
    equation = withinNinetyDays ? "BESS4.2B" : "BESS4.3B";
  } else {
    component = multiply(capacity, baseFactor);
    equation = withinNinetyDays ? "BESS4.2C" : "BESS4.3C";
  }
  return pdrsFromSavingsCapacity(
    request,
    component,
    batteryTrace(request, usable, capacity, component, `${equation} piecewise coefficient path`),
  );
}

function calculateBess5(request: ValidatedRequest) {
  if (input(request, "administrator_recording_confirmed") !== "yes") {
    fail("NSW_PRODUCT_DATA_NOT_CONFIRMED", "BESS5 requires the current Scheme Administrator-specified recording manner.", 409);
  }
  const usable = usableBatteryCapacity(request);
  const inverter = inputRational(request, "battery_inverter_output_kw");
  requireRange(usable, whole(200), whole(30000), false, true, "BESS5 usable battery capacity must be greater than 200 kWh and no more than 30,000 kWh.");
  checkBatteryCapacityToInverter(usable, inverter);
  if (compare(inputRational(request, "new_solar_capacity_kw"), divide(usable, whole(4))) < 0) {
    fail("NSW_INPUT_INVALID", "BESS5 new solar capacity must be at least one quarter of usable battery capacity.", 409);
  }
  const capacity = minimum(usable, whole(10000), multiply(inverter, whole(4)));
  const factor = constant(input(request, "new_solar_within_90_days") === "yes" ? "0.1" : "0.067");
  const component = multiply(capacity, factor);
  return pdrsFromSavingsCapacity(
    request,
    component,
    batteryTrace(request, usable, capacity, component, `Battery Capacity x ${exactText(factor)} x Firmness 1`),
  );
}

function calculateRf2(request: ValidatedRequest) {
  const baselineEeiByClass: Record<string, Rational> = {
    "12": whole(100),
    "13": whole(77),
    "14": whole(77),
    "15": whole(100),
  };
  const productClass = input(request, "product_class");
  const baselineEei = baselineEeiByClass[productClass];
  if (!baselineEei) fail("NSW_INPUT_INVALID", "Only active RF2 Classes 12-15 are supported.");
  const tec = inputRational(request, "tec_kwh_per_24h");
  const productEei = inputRational(request, "product_eei");
  if (compare(productEei, whole(81)) >= 0) {
    fail("NSW_INPUT_INVALID", "RF2 remote refrigerated cabinets must have a GEMS EEI below 81.", 409);
  }
  const baselineInput = divide(multiply(tec, baselineEei), multiply(productEei, whole(24)));
  const productInput = divide(tec, whole(24));
  const savingsCapacity = multiply(subtract(baselineInput, productInput), constant("1.81"));
  const trace = [
    traceEntry("baseline_input_power", "Baseline input power", `${exactText(tec)} TEC; baseline EEI ${exactText(baselineEei)}; product EEI ${exactText(productEei)}`, "TEC x af 1 x Baseline EEI / Product EEI / 24", baselineInput, "kW", "RF2.1 and Table RF2.1"),
    traceEntry("input_power", "Product input power", `${exactText(tec)} TEC`, "TEC x af 1 / 24", productInput, "kW", "RF2.2 and Table RF2.1"),
    traceEntry("peak_demand_savings_capacity", "Peak demand savings capacity", `${exactText(baselineInput)} baseline; ${exactText(productInput)} product`, "(Baseline Input - Input) x remote cabinet Temperature Factor 1.81 x Firmness 1", savingsCapacity, "kW", "RF2.3, Table RF2.2 and Table A6"),
  ];
  return pdrsFromSavingsCapacity(request, savingsCapacity, trace);
}

function poolPumpBaseline(maximumTestedInput: Rational, ess: boolean) {
  if (compare(maximumTestedInput, whole(1000)) <= 0) {
    return ess ? whole(1300) : constant("0.8");
  }
  if (!ess) return constant("1.2");
  if (compare(maximumTestedInput, whole(1500)) <= 0) return whole(1500);
  if (compare(maximumTestedInput, whole(2000)) <= 0) return whole(1700);
  return whole(2000);
}

function calculateSys2(request: ValidatedRequest) {
  const maximumInput = inputRational(request, "maximum_tested_input_w");
  const baselineInput = poolPumpBaseline(maximumInput, false);
  const paec = inputRational(request, "paec_kwh_per_year");
  const runTime = inputRational(request, "daily_run_time_hours");
  const productInput = divide(paec, multiply(whole(365), runTime));
  const savingsCapacity = multiply(subtract(baselineInput, productInput), constant("0.41"));
  const trace = [
    traceEntry("baseline_input_power", "Baseline pool-pump input", `${exactText(maximumInput)} W maximum tested input`, "Table SYS2.1 lookup", baselineInput, "kW", "Table SYS2.1"),
    traceEntry("input_power", "Product input power", `${exactText(paec)} kWh/year; ${exactText(runTime)} hours/day`, "PAEC / (365 x DRT)", productInput, "kW", "SYS2.1"),
    traceEntry("peak_demand_savings_capacity", "Peak demand savings capacity", `${exactText(baselineInput)} baseline; ${exactText(productInput)} product`, "(Baseline Input - Input) x 0.41 x Firmness 1", savingsCapacity, "kW", "Table A4 and Table A6"),
  ];
  return pdrsFromSavingsCapacity(request, savingsCapacity, trace);
}

function calculatePdrs(request: ValidatedRequest) {
  switch (request.activity.activityCode) {
    case "BESS1": return calculateBess1(request);
    case "BESS2": return calculateBess2(request);
    case "BESS3": return calculateBess3(request);
    case "BESS4": return calculateBess4(request);
    case "BESS5": return calculateBess5(request);
    case "HVAC1-SINGLE":
    case "HVAC1-MULTI":
    case "HVAC2-SINGLE":
    case "HVAC2-MULTI": return calculatePdrsHvac(request);
    case "RF2-REMOTE": return calculateRf2(request);
    case "SYS2": return calculateSys2(request);
    default:
      fail("NSW_ACTIVITY_NOT_SUPPORTED", `No PDRS executor exists for ${request.activity.activityCode}.`, 404);
  }
}

function essCertificateCalculation(
  request: ValidatedRequest,
  electricitySavings: Rational,
  gasSavings: Rational,
  trace: CreditexNswEstimateTraceEntry[],
  cap?: bigint,
): Calculation {
  const regionalFactor = regionalNetworkFactor(request);
  const electricityContribution = multiply(multiply(electricitySavings, regionalFactor), constant("1.06"));
  const gasContribution = multiply(gasSavings, constant("0.47"));
  const rawCertificates = add(electricityContribution, gasContribution);
  requirePositive(rawCertificates, "Equation 1 certificate result");
  let wholeCertificates = floorPositive(rawCertificates);
  if (cap !== undefined && wholeCertificates > cap) wholeCertificates = cap;
  trace.push(
    traceEntry("regional_network_factor", "Regional network factor", input(request, "site_postcode"), "Table A24 postcode lookup", regionalFactor, "factor", "ESS Table A24"),
    traceEntry("electricity_certificate_contribution", "Electricity certificate contribution", `${exactText(electricitySavings)} MWh; RNF ${exactText(regionalFactor)}`, "Electricity Savings x Regional Network Factor x 1.06", electricityContribution, "ESC", "ESS Equation 1; Act clause 33"),
    traceEntry("gas_certificate_contribution", "Gas certificate contribution", `${exactText(gasSavings)} MWh`, "Gas Savings x 0.47", gasContribution, "ESC", "ESS Equation 1; Regulation clause 37A"),
    traceEntry("whole_escs", "Whole Energy Savings Certificates", exactText(rawCertificates), cap === undefined ? "floor Equation 1 result" : `floor Equation 1 result, then apply ${cap.toString()} ESC activity cap`, whole(wholeCertificates), "ESC", cap === undefined ? "ESS clause 6.5" : "ESS clause 6.5 and activity cap"),
  );
  return { rawCertificates, wholeCertificates, trace };
}

function calculateD5(request: ValidatedRequest) {
  checkPayment(request, whole(200));
  const maximumInput = inputRational(request, "maximum_tested_input_w");
  const baseline = poolPumpBaseline(maximumInput, true);
  const paec = inputRational(request, "paec_kwh_per_year");
  const savings = divide(multiply(subtract(baseline, paec), whole(10)), whole(1000));
  requirePositive(savings, "D5 deemed electricity savings");
  const trace = [
    traceEntry("baseline_paec", "Baseline projected annual energy consumption", `${exactText(maximumInput)} W maximum tested input`, "Table D5.1 lookup", baseline, "kWh/year", "ESS Table D5.1"),
    traceEntry("electricity_savings", "Deemed activity electricity savings", `${exactText(baseline)} baseline; ${exactText(paec)} product`, "(Baseline PAEC - Product PAEC) x 10 years / 1000", savings, "MWh", "ESS Activity D5"),
  ];
  return essCertificateCalculation(request, savings, ZERO, trace);
}

const RESIDENTIAL_HOURS: Record<AirconClimateZone, readonly [Rational, Rational]> = {
  hot: [whole(1274), whole(109)],
  average: [whole(429), whole(648)],
  cold: [whole(285), whole(1534)],
};

const COMMERCIAL_HOURS: Record<AirconClimateZone, readonly [Rational, Rational]> = {
  hot: [whole(1754), whole(71)],
  average: [whole(801), whole(303)],
  cold: [whole(530), whole(530)],
};

function essCoolingAndHeatingCapacity(request: ValidatedRequest) {
  const multi = request.activity.activityCode.endsWith("-MULTI");
  if (!multi) {
    return {
      cooling: inputRational(request, "cooling_capacity_kw"),
      heating: inputRational(request, "heating_capacity_kw"),
      detail: "single/unitary GEMS capacities",
    };
  }
  return {
    cooling: minimum(
      inputRational(request, "outdoor_cooling_capacity_kw"),
      inputRational(request, "indoor_cooling_capacity_sum_kw"),
    ),
    heating: minimum(
      inputRational(request, "outdoor_heating_capacity_kw"),
      inputRational(request, "indoor_heating_capacity_sum_kw"),
    ),
    detail: "minimum of outdoor-unit capacity and connected indoor-unit capacity sum",
  };
}

function requiredD16Payment(coolingCapacity: Rational, multi: boolean) {
  if (!multi) return whole(500);
  const roundedDownKw = floorPositive(coolingCapacity);
  if (roundedDownKw <= BigInt(15)) return whole(1000);
  if (roundedDownKw < BigInt(20)) return whole(2000);
  return whole(3000);
}

function calculateEssAircon(request: ValidatedRequest) {
  const commercial = request.activity.officialActivityCode === "F4";
  const multi = request.activity.activityCode.endsWith("-MULTI");
  const climate = airconClimateZone(request);
  checkCoolingEligibility(request, commercial);
  checkHeatingEligibility(request, commercial, climate);
  const capacities = essCoolingAndHeatingCapacity(request);
  if (commercial && compare(capacities.cooling, whole(30)) < 0) {
    fail("NSW_INPUT_INVALID", "F4 calculated cooling capacity must be at least 30 kW.", 409);
  }
  const ductedOrMulti = multi || input(request, "installation_configuration") === "ducted";
  checkPayment(
    request,
    commercial
      ? (ductedOrMulti ? whole(3000) : whole(1000))
      : requiredD16Payment(capacities.cooling, ductedOrMulti),
  );
  const baseline = baselineFor(request);
  const [coolingHours, heatingHours] = (commercial ? COMMERCIAL_HOURS : RESIDENTIAL_HOURS)[climate];
  const referenceCooling = divide(multiply(capacities.cooling, coolingHours), baseline.cooling);
  const referenceHeating = divide(multiply(capacities.heating, heatingHours), baseline.heating);
  const actualCooling = inputRational(request, "cooling_annual_energy_kwh");
  const actualHeating = inputRational(request, "heating_annual_energy_kwh");
  const annualSavings = add(subtract(referenceCooling, actualCooling), subtract(referenceHeating, actualHeating));
  const lifetimeSavings = divide(multiply(annualSavings, whole(12)), whole(1000));
  requirePositive(lifetimeSavings, `${request.activity.officialActivityCode} deemed electricity savings`);
  const trace = [
    traceEntry("aircon_climate_zone", "AS/NZS 3823.4 climate zone", input(request, "site_postcode"), "Table A27 postcode lookup", climate === "hot" ? whole(1) : climate === "average" ? whole(2) : whole(3), "code (1 hot, 2 average, 3 cold)", "ESS Table A27"),
    traceEntry("cooling_capacity", "Cooling capacity used", capacities.detail, "Rule-defined single or multi-split capacity", capacities.cooling, "kW", `${request.activity.officialActivityCode} capacity definition`),
    traceEntry("heating_capacity", "Heating capacity used", capacities.detail, "Rule-defined single or multi-split capacity", capacities.heating, "kW", `${request.activity.officialActivityCode} capacity definition`),
    traceEntry("reference_cooling_energy", "Reference cooling annual energy use", `${exactText(capacities.cooling)} kW x ${exactText(coolingHours)} h / ${exactText(baseline.cooling)} baseline AEER`, "Cooling Capacity x Equivalent Cooling Hours / Baseline Cooling AEER", referenceCooling, "kWh/year", `${request.activity.officialActivityCode}.2 and baseline table`),
    traceEntry("reference_heating_energy", "Reference heating annual energy use", `${exactText(capacities.heating)} kW x ${exactText(heatingHours)} h / ${exactText(baseline.heating)} baseline ACOP`, "Heating Capacity x Equivalent Heating Hours / Baseline Heating ACOP", referenceHeating, "kWh/year", `${request.activity.officialActivityCode}.3 and baseline table`),
    traceEntry("electricity_savings", "Deemed activity electricity savings", `${exactText(referenceCooling)} reference cooling; ${exactText(actualCooling)} actual cooling; ${exactText(referenceHeating)} reference heating; ${exactText(actualHeating)} actual heating`, "[(Reference Cooling - Actual Cooling) + (Reference Heating - Actual Heating)] x 12 / 1000", lifetimeSavings, "MWh", `${request.activity.officialActivityCode}.1`),
  ];
  const cap = request.activity.activityCode === "D16-MULTI"
    ? (climate === "cold" ? BigInt(90) : BigInt(70))
    : undefined;
  return essCertificateCalculation(request, lifetimeSavings, ZERO, trace, cap);
}

type HotWaterCoefficients = {
  baselineA: Rational;
  baselineB: Rational;
  adjustment: Rational;
};

function heatPumpClimate(request: ValidatedRequest) {
  const bcaZone = Number(input(request, "bca_climate_zone"));
  return bcaZone <= 6 ? "hp3" : "hp5";
}

function hotWaterCoefficients(request: ValidatedRequest): HotWaterCoefficients {
  const medium = input(request, "system_size") === "medium";
  const activityCode = request.activity.activityCode;
  if (activityCode === "D17") {
    const hp5 = heatPumpClimate(request) === "hp5";
    return {
      baselineA: constant(hp5 ? (medium ? "38.49" : "25.43") : (medium ? "35.14" : "23.18")),
      baselineB: ZERO,
      adjustment: constant(hp5 ? "2.310" : "2.291"),
    };
  }
  if (activityCode === "D18") {
    return {
      baselineA: constant(medium ? "43.93" : "28.98"),
      baselineB: ZERO,
      adjustment: constant("2.310"),
    };
  }
  if (activityCode === "D19") {
    const hp5 = heatPumpClimate(request) === "hp5";
    return {
      baselineA: constant("0.58"),
      baselineB: constant(hp5 ? (medium ? "52.750" : "31.650") : (medium ? "47.337" : "28.029")),
      adjustment: constant(hp5 ? "2.310" : "2.291"),
    };
  }
  if (activityCode === "D20") {
    return {
      baselineA: constant("0.73"),
      baselineB: constant(medium ? "59.171" : "35.036"),
      adjustment: constant("2.310"),
    };
  }
  fail("NSW_ACTIVITY_NOT_SUPPORTED", `No hot-water table exists for ${activityCode}.`);
}

function calculateHotWater(request: ValidatedRequest) {
  checkPayment(request, whole(200));
  const coefficients = hotWaterCoefficients(request);
  const supplementary = inputRational(request, "annual_supplementary_energy_gj");
  const auxiliary = inputRational(request, "annual_auxiliary_electricity_gj");
  const adjustedProductEnergy = multiply(coefficients.adjustment, add(supplementary, auxiliary));
  const electricitySavings = subtract(coefficients.baselineA, adjustedProductEnergy);
  const gasSavings = coefficients.baselineB;
  const trace = [
    traceEntry("baseline_a", "Baseline A", `${input(request, "system_size")} system${request.inputs.bca_climate_zone ? `; BCA zone ${request.inputs.bca_climate_zone}` : ""}`, "activity table lookup", coefficients.baselineA, "MWh", `ESS Table ${request.activity.officialActivityCode}.1`),
    traceEntry("adjusted_product_energy", "Adjusted product energy", `${exactText(supplementary)} GJ Bs + ${exactText(auxiliary)} GJ Be`, `(Bs + Be) x adjustment ${exactText(coefficients.adjustment)}`, adjustedProductEnergy, "MWh", `ESS Activity ${request.activity.officialActivityCode}`),
    traceEntry("electricity_savings", "Deemed electricity savings", `${exactText(coefficients.baselineA)} baseline A; ${exactText(adjustedProductEnergy)} adjusted product energy`, "Baseline A - a x (Bs + Be)", electricitySavings, "MWh", `ESS Activity ${request.activity.officialActivityCode}`),
    traceEntry("gas_savings", "Deemed gas savings", `${input(request, "system_size")} system table row`, "Baseline B", gasSavings, "MWh", `ESS Table ${request.activity.officialActivityCode}.1`),
  ];
  return essCertificateCalculation(request, electricitySavings, gasSavings, trace);
}

function calculateEss(request: ValidatedRequest) {
  switch (request.activity.activityCode) {
    case "D5": return calculateD5(request);
    case "D16-SINGLE":
    case "D16-MULTI":
    case "F4-SINGLE":
    case "F4-MULTI": return calculateEssAircon(request);
    case "D17":
    case "D18":
    case "D19":
    case "D20": return calculateHotWater(request);
    default:
      fail("NSW_ACTIVITY_NOT_SUPPORTED", `No ESS executor exists for ${request.activity.activityCode}.`, 404);
  }
}

function annualAllocation(wholeCertificates: bigint, lifetimeYears: number) {
  const years = BigInt(lifetimeYears);
  const base = wholeCertificates / years;
  const remainder = wholeCertificates % years;
  return Array.from({ length: lifetimeYears }, (_, index) => ({
    compliancePeriodOrdinal: index + 1,
    quantity: (base + (BigInt(index) < remainder ? BIGINT_ONE : BIGINT_ZERO)).toString(),
    unit: "PRC" as const,
  }));
}

export function estimateCreditexNswProgram(
  value: unknown,
): CreditexNswProgramEstimate {
  const request = validateRequest(value);
  const calculation = request.program.programCode === "NSW-PDRS-2026"
    ? calculatePdrs(request)
    : calculateEss(request);
  const canonicalInputs = Object.entries(request.inputs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, inputValue]) => ({ key, value: inputValue }));
  const output = {
    quantity: calculation.wholeCertificates.toString(),
    unit: request.activity.outputUnit,
    label: request.activity.outputUnit === "PRC"
      ? "Estimated whole Peak Reduction Certificates"
      : "Estimated whole Energy Savings Certificates",
    rawExact: exactText(calculation.rawCertificates),
    rounding: "floor_after_single_implementation" as const,
  };
  const allocation = request.activity.outputUnit === "PRC"
    ? annualAllocation(calculation.wholeCertificates, request.activity.lifetimeYears)
    : [];
  const receiptBase = {
    schemaVersion: CREDITEX_NSW_ESTIMATE_SCHEMA,
    estimatorVersion: CREDITEX_NSW_ESTIMATOR_VERSION,
    programCode: request.program.programCode,
    activityCode: request.activity.activityCode,
    officialActivityCode: request.activity.officialActivityCode,
    formulaKey: request.activity.formulaKey,
    sourceVersion: request.program.sourceVersion,
    effectiveDate: request.effectiveDate,
    canonicalInputs,
    trace: calculation.trace,
    output,
    annualAllocation: allocation,
  };
  return {
    schemaVersion: CREDITEX_NSW_ESTIMATE_SCHEMA,
    estimatorVersion: CREDITEX_NSW_ESTIMATOR_VERSION,
    programCode: request.program.programCode,
    jurisdiction: "NSW",
    activityCode: request.activity.activityCode,
    officialActivityCode: request.activity.officialActivityCode,
    activityTitle: request.activity.title,
    supportedScenario: request.activity.supportedScenario,
    formulaKey: request.activity.formulaKey,
    sourceVersion: request.program.sourceVersion,
    sourceEffectiveFrom: request.activity.effectiveFrom,
    sourceEffectiveTo: request.activity.effectiveTo,
    effectiveDate: request.effectiveDate,
    officialSourceUrl: request.program.officialSourceUrl,
    officialSourceTitle: request.program.officialSourceTitle,
    sourceReferences: request.activity.sourceReferences,
    productRegistryRequirements: request.activity.productRegistryRequirements,
    trace: calculation.trace,
    output,
    annualAllocation: allocation,
    status: "estimate_only_registry_and_evidence_reconciliation_required",
    certificateActionEnabled: false,
    operatorMessage: request.program.operatorMessage,
    inputHash: sha256(canonicalInputs),
    traceHash: sha256(calculation.trace),
    outputHash: sha256(output),
    receiptHash: sha256(receiptBase),
  };
}
