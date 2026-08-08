import { createHash } from "node:crypto";
import {
  HORIZON_POWER_TOWN_CLASSES,
  creditexLocalActivityDefinition,
  creditexLocalProgramDefinition,
  type CreditexLocalActivityDefinition,
  type CreditexLocalInputDefinition,
  type CreditexLocalProgramDefinition,
} from "./creditex-local-program-catalogue.ts";

export const CREDITEX_LOCAL_ESTIMATE_SCHEMA =
  "creditex-local-program-estimate/v1" as const;
export const CREDITEX_LOCAL_ESTIMATOR_VERSION =
  "creditex-local-program-estimator/exact-decimal-v1" as const;

export type CreditexLocalEstimateErrorCode =
  | "LOCAL_ESTIMATE_INVALID"
  | "LOCAL_PROGRAM_NOT_SUPPORTED"
  | "LOCAL_ACTIVITY_NOT_SUPPORTED"
  | "LOCAL_EFFECTIVE_DATE_UNSUPPORTED"
  | "LOCAL_INPUT_INVALID"
  | "LOCAL_ELIGIBILITY_NOT_CONFIRMED"
  | "LOCAL_INTERVAL_ALLOCATION_REQUIRED";

export class CreditexLocalEstimateError extends Error {
  readonly code: CreditexLocalEstimateErrorCode;
  readonly status: number;

  constructor(
    code: CreditexLocalEstimateErrorCode,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "CreditexLocalEstimateError";
    this.code = code;
    this.status = status;
  }
}

type Decimal = {
  coefficient: bigint;
  scale: number;
};

type ValidatedRequest = {
  program: CreditexLocalProgramDefinition;
  activity: CreditexLocalActivityDefinition;
  effectiveDate: string;
  inputs: Record<string, string>;
};

export type CreditexLocalEstimateTraceEntry = {
  key: string;
  label: string;
  input: string;
  operation: string;
  output: string;
  unit: string;
};

export type CreditexLocalProgramEstimate = {
  schemaVersion: typeof CREDITEX_LOCAL_ESTIMATE_SCHEMA;
  estimatorVersion: typeof CREDITEX_LOCAL_ESTIMATOR_VERSION;
  programCode: string;
  jurisdiction: string;
  activityCode: string;
  activityTitle: string;
  scenario: string;
  formulaKey: string;
  sourceVersion: string;
  sourceEffectiveFrom: string;
  sourceEffectiveTo: string;
  effectiveDate: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  productRegistryRequirements: readonly string[];
  trace: CreditexLocalEstimateTraceEntry[];
  output: {
    quantity: string;
    unit: "AUD";
    label: string;
  };
  status: "estimate_only_program_reconciliation_required";
  certificateActionEnabled: false;
  operatorMessage: string;
  inputHash: string;
  traceHash: string;
  outputHash: string;
  receiptHash: string;
};

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POWERS_OF_TEN = Array.from({ length: 19 }, (_, index) => (
  BigInt(10) ** BigInt(index)
));

const ZERO: Decimal = { coefficient: BigInt(0), scale: 0 };

function fail(
  code: CreditexLocalEstimateErrorCode,
  message: string,
  status = 400,
): never {
  throw new CreditexLocalEstimateError(code, message, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    fail(
      "LOCAL_ESTIMATE_INVALID",
      `${path} must contain exactly ${expected.join(", ")}.`,
    );
  }
}

function stringValue(value: unknown, path: string, maximum = 120) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail("LOCAL_ESTIMATE_INVALID", `${path} must be a non-empty string.`);
  }
  return value;
}

function canonicalDate(value: unknown) {
  const date = stringValue(value, "effectiveDate", 10);
  if (!DATE_PATTERN.test(date)) {
    fail("LOCAL_ESTIMATE_INVALID", "effectiveDate must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date
  ) {
    fail("LOCAL_ESTIMATE_INVALID", "effectiveDate is not a valid calendar date.");
  }
  return date;
}

function normalize(decimal: Decimal): Decimal {
  let { coefficient, scale } = decimal;
  while (scale > 0 && coefficient % BigInt(10) === BigInt(0)) {
    coefficient /= BigInt(10);
    scale -= 1;
  }
  return { coefficient, scale };
}

function parseDecimal(value: string, path: string): Decimal {
  if (!DECIMAL_PATTERN.test(value)) {
    fail(
      "LOCAL_INPUT_INVALID",
      `${path} must be a non-negative base-10 decimal string with no more than 9 decimal places.`,
    );
  }
  const [whole, fraction = ""] = value.split(".");
  return normalize({
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  });
}

function decimalText(value: Decimal) {
  const decimal = normalize(value);
  const negative = decimal.coefficient < BigInt(0);
  const digits = (negative ? -decimal.coefficient : decimal.coefficient).toString();
  if (decimal.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(decimal.scale + 1, "0");
  const split = padded.length - decimal.scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

function align(left: Decimal, right: Decimal) {
  const scale = Math.max(left.scale, right.scale);
  return {
    left: left.coefficient * POWERS_OF_TEN[scale - left.scale],
    right: right.coefficient * POWERS_OF_TEN[scale - right.scale],
    scale,
  };
}

function compare(left: Decimal, right: Decimal) {
  const aligned = align(left, right);
  return aligned.left < aligned.right ? -1 : aligned.left > aligned.right ? 1 : 0;
}

function add(left: Decimal, right: Decimal): Decimal {
  const aligned = align(left, right);
  return normalize({
    coefficient: aligned.left + aligned.right,
    scale: aligned.scale,
  });
}

function multiply(left: Decimal, right: Decimal): Decimal {
  if (left.scale + right.scale > 18) {
    fail("LOCAL_INPUT_INVALID", "The calculation exceeds supported exact-decimal precision.");
  }
  return normalize({
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  });
}

function minimum(left: Decimal, right: Decimal) {
  return compare(left, right) <= 0 ? left : right;
}

function decimalConstant(value: string) {
  return parseDecimal(value, "formula constant");
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function validateInput(
  definition: CreditexLocalInputDefinition,
  value: unknown,
) {
  const text = stringValue(value, `inputs.${definition.key}`, 64);
  if (definition.type === "select") {
    if (!definition.options?.some((option) => option.value === text)) {
      fail(
        "LOCAL_INPUT_INVALID",
        `inputs.${definition.key} is not an allowed option.`,
      );
    }
    return text;
  }
  const decimal = parseDecimal(text, `inputs.${definition.key}`);
  if (definition.type === "integer" && decimal.scale !== 0) {
    fail("LOCAL_INPUT_INVALID", `inputs.${definition.key} must be a whole number.`);
  }
  if (
    definition.minimum !== undefined
    && compare(decimal, decimalConstant(definition.minimum)) < 0
  ) {
    fail(
      "LOCAL_INPUT_INVALID",
      `inputs.${definition.key} must be at least ${definition.minimum} ${definition.unit}.`,
    );
  }
  if (
    definition.maximum !== undefined
    && compare(decimal, decimalConstant(definition.maximum)) > 0
  ) {
    fail(
      "LOCAL_INPUT_INVALID",
      `inputs.${definition.key} must not exceed ${definition.maximum} ${definition.unit}.`,
    );
  }
  return decimalText(decimal);
}

function validateRequest(value: unknown): ValidatedRequest {
  if (!isRecord(value)) {
    fail("LOCAL_ESTIMATE_INVALID", "The estimate request must be an object.");
  }
  exactKeys(value, ["programCode", "activityCode", "effectiveDate", "inputs"], "request");
  const programCode = stringValue(value.programCode, "programCode", 64);
  const activityCode = stringValue(value.activityCode, "activityCode", 64);
  const effectiveDate = canonicalDate(value.effectiveDate);
  const program = creditexLocalProgramDefinition(programCode);
  if (!program) {
    fail(
      "LOCAL_PROGRAM_NOT_SUPPORTED",
      `Program ${programCode} does not have an executable local estimate.`,
      404,
    );
  }
  const activity = creditexLocalActivityDefinition(programCode, activityCode);
  if (!activity) {
    fail(
      "LOCAL_ACTIVITY_NOT_SUPPORTED",
      `Activity ${activityCode} is not supported for ${programCode}.`,
      404,
    );
  }
  if (
    effectiveDate < program.effectiveFrom
    || (program.effectiveTo && effectiveDate > program.effectiveTo)
  ) {
    fail(
      "LOCAL_EFFECTIVE_DATE_UNSUPPORTED",
      `${programCode} has no source-pinned formula for ${effectiveDate}.`,
      409,
    );
  }
  if (!isRecord(value.inputs)) {
    fail("LOCAL_ESTIMATE_INVALID", "inputs must be an object.");
  }
  exactKeys(
    value.inputs,
    activity.inputDefinitions.map((definition) => definition.key),
    "inputs",
  );
  const inputs: Record<string, string> = {};
  for (const definition of activity.inputDefinitions) {
    inputs[definition.key] = validateInput(
      definition,
      value.inputs[definition.key],
    );
  }
  return { program, activity, effectiveDate, inputs };
}

function inputDecimal(request: ValidatedRequest, key: string) {
  const value = request.inputs[key];
  if (value === undefined) {
    fail("LOCAL_ESTIMATE_INVALID", `Validated input ${key} is unavailable.`);
  }
  return parseDecimal(value, `inputs.${key}`);
}

function traceEntry(
  key: string,
  label: string,
  input: string,
  operation: string,
  output: Decimal,
  unit: string,
): CreditexLocalEstimateTraceEntry {
  return {
    key,
    label,
    input,
    operation,
    output: decimalText(output),
    unit,
  };
}

function calculateQldSsr(request: ValidatedRequest) {
  const panel = inputDecimal(request, "panel_capacity_kw");
  const inverter = inputDecimal(request, "inverter_capacity_kw");
  const cost = inputDecimal(request, "eligible_cost_aud");
  const capacity = minimum(panel, inverter);
  const three = decimalConstant("3");
  const four = decimalConstant("4");
  const five = decimalConstant("5");
  const bands = {
    "PV-3-4": { minimum: three, maximum: four, cap: "2500" },
    "PV-4-5": { minimum: four, maximum: five, cap: "3000" },
    "PV-5-PLUS": { minimum: five, maximum: null, cap: "3500" },
  } as const;
  const band = bands[request.activity.activityCode as keyof typeof bands];
  if (
    !band
    || compare(capacity, band.minimum) < 0
    || (band.maximum && compare(capacity, band.maximum) >= 0)
  ) {
    fail(
      "LOCAL_INPUT_INVALID",
      `The lower panel or inverter capacity (${decimalText(capacity)} kW) does not match activity ${request.activity.activityCode}.`,
    );
  }
  const cap = decimalConstant(band.cap);
  const output = minimum(cost, cap);
  return {
    output,
    trace: [
      traceEntry(
        "system_capacity",
        "Program system capacity",
        `${decimalText(panel)} kW panels; ${decimalText(inverter)} kW inverter`,
        "lower of panel and inverter capacity",
        capacity,
        "kW",
      ),
      traceEntry(
        "rebate_cap",
        "Capacity-band maximum",
        `${decimalText(capacity)} kW`,
        `${request.activity.activityCode} official band`,
        cap,
        "AUD",
      ),
      traceEntry(
        "eligible_rebate",
        "Indicative rebate",
        `${decimalText(cost)} AUD eligible cost; ${decimalText(cap)} AUD maximum`,
        "lower of eligible cost and band maximum",
        output,
        "AUD",
      ),
    ],
  };
}

function calculateQldQcheu(request: ValidatedRequest) {
  if (
    ["FANS", "LED"].includes(request.activity.activityCode)
    && request.inputs.primary_upgrade_included !== "yes"
  ) {
    fail(
      "LOCAL_ELIGIBILITY_NOT_CONFIRMED",
      "DC fans and LED lighting require another eligible primary upgrade in the same application.",
      409,
    );
  }
  const dwellings = inputDecimal(request, "eligible_dwellings");
  const cost = inputDecimal(request, "eligible_cost_ex_gst_aud");
  const maximum = multiply(dwellings, decimalConstant("4500"));
  const output = minimum(cost, maximum);
  return {
    output,
    trace: [
      traceEntry(
        "dwelling_cap",
        "Maximum by eligible dwelling count",
        `${decimalText(dwellings)} dwellings`,
        "eligible dwellings x 4,500 AUD",
        maximum,
        "AUD",
      ),
      traceEntry(
        "eligible_rebate",
        "Indicative rebate",
        `${decimalText(cost)} AUD GST-exclusive cost; ${decimalText(maximum)} AUD maximum`,
        "lower of eligible cost and dwelling maximum",
        output,
        "AUD",
      ),
    ],
  };
}

function calculateQldFit(request: ValidatedRequest) {
  if (
    request.activity.activityCode === "SBS-44C"
    && request.inputs.legacy_eligibility_confirmed !== "yes"
  ) {
    fail(
      "LOCAL_ELIGIBILITY_NOT_CONFIRMED",
      "Continuous eligibility for the grandfathered 44 cent tariff must be confirmed.",
      409,
    );
  }
  const exports = inputDecimal(request, "eligible_export_kwh");
  const rate = decimalConstant(
    request.activity.activityCode === "SBS-44C" ? "0.44" : "0.06006",
  );
  const output = multiply(exports, rate);
  return {
    output,
    trace: [traceEntry(
      "export_credit",
      "Eligible export credit",
      `${decimalText(exports)} kWh`,
      `eligible exports x ${decimalText(rate)} AUD/kWh`,
      output,
      "AUD",
    )],
  };
}

function calculateWaRbs(request: ValidatedRequest) {
  const usable = inputDecimal(request, "usable_capacity_kwh");
  const capped = minimum(usable, decimalConstant("10"));
  const rate = decimalConstant(
    request.activity.activityCode === "SYNERGY-BATTERY" ? "130" : "380",
  );
  const output = multiply(capped, rate);
  return {
    output,
    trace: [
      traceEntry(
        "rebate_capacity",
        "Rebate-eligible usable capacity",
        `${decimalText(usable)} kWh`,
        "usable capacity capped at 10 kWh",
        capped,
        "kWh",
      ),
      traceEntry(
        "state_rebate",
        "Indicative state rebate",
        `${decimalText(capped)} kWh`,
        `eligible capacity x ${decimalText(rate)} AUD/kWh`,
        output,
        "AUD",
      ),
    ],
  };
}

function horizonTownClass(request: ValidatedRequest) {
  const town = request.inputs.horizon_town;
  if (!(town in HORIZON_POWER_TOWN_CLASSES)) {
    fail("LOCAL_INPUT_INVALID", "The selected Horizon Power town is unavailable.");
  }
  return HORIZON_POWER_TOWN_CLASSES[town as keyof typeof HORIZON_POWER_TOWN_CLASSES];
}

function horizonDebsRates(townClass: "A" | "B" | "C") {
  if (townClass === "A") return { peak: "0.10", offPeak: "0.03" };
  if (townClass === "B") return { peak: "0.3776", offPeak: "0.1133" };
  return { peak: "0.5599", offPeak: "0.168" };
}

function calculateTwoBandCredit(
  request: ValidatedRequest,
  peakRateText: string,
  offPeakRateText: string,
) {
  const peakExports = inputDecimal(request, "peak_export_kwh");
  const offPeakExports = inputDecimal(request, "off_peak_export_kwh");
  const peakRate = decimalConstant(peakRateText);
  const offPeakRate = decimalConstant(offPeakRateText);
  const peakCredit = multiply(peakExports, peakRate);
  const offPeakCredit = multiply(offPeakExports, offPeakRate);
  const output = add(peakCredit, offPeakCredit);
  return {
    output,
    trace: [
      traceEntry(
        "peak_credit",
        "Peak export credit",
        `${decimalText(peakExports)} kWh`,
        `peak exports x ${decimalText(peakRate)} AUD/kWh`,
        peakCredit,
        "AUD",
      ),
      traceEntry(
        "off_peak_credit",
        "Off-peak export credit",
        `${decimalText(offPeakExports)} kWh`,
        `off-peak exports x ${decimalText(offPeakRate)} AUD/kWh`,
        offPeakCredit,
        "AUD",
      ),
      traceEntry(
        "total_credit",
        "Total indicative export credit",
        `${decimalText(peakCredit)} AUD peak; ${decimalText(offPeakCredit)} AUD off-peak`,
        "peak credit + off-peak credit",
        output,
        "AUD",
      ),
    ],
  };
}

function calculateWaDebs(request: ValidatedRequest) {
  if (request.inputs.service_area === "synergy") {
    const totalExports = add(
      inputDecimal(request, "peak_export_kwh"),
      inputDecimal(request, "off_peak_export_kwh"),
    );
    if (compare(totalExports, decimalConstant("50")) > 0) {
      fail(
        "LOCAL_INTERVAL_ALLOCATION_REQUIRED",
        "Synergy DEBS pays only the first 50 exported kWh per day. Provide eligible peak and off-peak volumes whose daily total is no more than 50 kWh, or calculate from ordered interval data.",
        409,
      );
    }
    return calculateTwoBandCredit(request, "0.10", "0.02");
  }
  const rates = horizonDebsRates(horizonTownClass(request));
  return calculateTwoBandCredit(request, rates.peak, rates.offPeak);
}

function calculateWaBatteryRewards(request: ValidatedRequest) {
  const exports = inputDecimal(request, "event_export_kwh");
  const capacity = inputDecimal(request, "installed_battery_capacity_kwh");
  const eligibleExports = minimum(exports, capacity);
  const output = multiply(eligibleExports, decimalConstant("0.70"));
  return {
    output,
    trace: [
      traceEntry(
        "eligible_event_export",
        "Credit-eligible event export",
        `${decimalText(exports)} kWh export; ${decimalText(capacity)} kWh installed capacity`,
        "event export capped at installed battery capacity",
        eligibleExports,
        "kWh",
      ),
      traceEntry(
        "activation_credit",
        "Indicative activation credit",
        `${decimalText(eligibleExports)} kWh`,
        "eligible event export x 0.70 AUD/kWh",
        output,
        "AUD",
      ),
    ],
  };
}

function calculateWaHorizonBuyback(request: ValidatedRequest) {
  const townClass = horizonTownClass(request);
  const month = Number(request.effectiveDate.slice(5, 7));
  const summer = month >= 11 || month <= 3;
  const base = horizonDebsRates(townClass);
  const peak = townClass === "A" && summer ? "0.3326" : base.peak;
  return calculateTwoBandCredit(request, peak, base.offPeak);
}

function calculateTasPowerSmart(request: ValidatedRequest) {
  const cost = inputDecimal(request, "eligible_cost_aud");
  const output = minimum(cost, decimalConstant("1000"));
  return {
    output,
    trace: [traceEntry(
      "audit_grant",
      "Indicative audit grant",
      `${decimalText(cost)} AUD eligible paid audit cost`,
      "lower of eligible cost and 1,000 AUD",
      output,
      "AUD",
    )],
  };
}

function calculateTasFit(request: ValidatedRequest) {
  const exports = inputDecimal(request, "eligible_export_kwh");
  const output = multiply(exports, decimalConstant("0.09276"));
  return {
    output,
    trace: [traceEntry(
      "export_credit",
      "Eligible export credit",
      `${decimalText(exports)} kWh`,
      "eligible exports x 0.09276 AUD/kWh",
      output,
      "AUD",
    )],
  };
}

function calculateNtSmd(request: ValidatedRequest) {
  const dwellings = inputDecimal(request, "eligible_dwellings");
  const cost = inputDecimal(request, "eligible_cost_ex_gst_aud");
  const dwellingCap = multiply(dwellings, decimalConstant("7500"));
  const costShare = multiply(cost, decimalConstant("0.5"));
  const output = minimum(dwellingCap, costShare);
  return {
    output,
    trace: [
      traceEntry(
        "dwelling_cap",
        "Maximum by dwelling count",
        `${decimalText(dwellings)} dwellings`,
        "eligible dwellings x 7,500 AUD",
        dwellingCap,
        "AUD",
      ),
      traceEntry(
        "cost_share",
        "Maximum by project cost",
        `${decimalText(cost)} AUD GST-exclusive eligible cost`,
        "50 percent of eligible cost",
        costShare,
        "AUD",
      ),
      traceEntry(
        "eligible_grant",
        "Indicative grant",
        `${decimalText(dwellingCap)} AUD dwelling cap; ${decimalText(costShare)} AUD cost share`,
        "lower of dwelling cap and 50 percent cost share",
        output,
        "AUD",
      ),
    ],
  };
}

function calculateNtFit(request: ValidatedRequest) {
  return calculateTwoBandCredit(request, "0.1866", "0.0933");
}

function execute(request: ValidatedRequest) {
  switch (request.program.programCode) {
    case "QLD-SSR":
      return calculateQldSsr(request);
    case "QLD-QCHEU":
      return calculateQldQcheu(request);
    case "QLD-FIT":
      return calculateQldFit(request);
    case "WA-RBS":
      return calculateWaRbs(request);
    case "WA-DEBS":
      return calculateWaDebs(request);
    case "WA-BATTERY-REWARDS":
      return calculateWaBatteryRewards(request);
    case "WA-HORIZON-BUYBACK":
      return calculateWaHorizonBuyback(request);
    case "TAS-POWERSMART":
      return calculateTasPowerSmart(request);
    case "TAS-FIT":
      return calculateTasFit(request);
    case "NT-SMD":
      return calculateNtSmd(request);
    case "NT-FIT":
      return calculateNtFit(request);
    default:
      return { output: ZERO, trace: [] };
  }
}

export function estimateCreditexLocalProgram(
  value: unknown,
): CreditexLocalProgramEstimate {
  const request = validateRequest(value);
  const execution = execute(request);
  if (execution.trace.length === 0) {
    fail(
      "LOCAL_PROGRAM_NOT_SUPPORTED",
      `Program ${request.program.programCode} does not have an executable estimate.`,
      404,
    );
  }
  const canonicalInputs = Object.entries(request.inputs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value }));
  const output = {
    quantity: decimalText(execution.output),
    unit: "AUD" as const,
    label: request.program.outputLabel,
  };
  const receiptBase = {
    schemaVersion: CREDITEX_LOCAL_ESTIMATE_SCHEMA,
    estimatorVersion: CREDITEX_LOCAL_ESTIMATOR_VERSION,
    programCode: request.program.programCode,
    activityCode: request.activity.activityCode,
    formulaKey: request.activity.formulaKey,
    sourceVersion: request.program.sourceVersion,
    effectiveDate: request.effectiveDate,
    canonicalInputs,
    trace: execution.trace,
    output,
  };
  return {
    schemaVersion: CREDITEX_LOCAL_ESTIMATE_SCHEMA,
    estimatorVersion: CREDITEX_LOCAL_ESTIMATOR_VERSION,
    programCode: request.program.programCode,
    jurisdiction: request.program.jurisdiction,
    activityCode: request.activity.activityCode,
    activityTitle: request.activity.title,
    scenario: request.activity.scenario,
    formulaKey: request.activity.formulaKey,
    sourceVersion: request.program.sourceVersion,
    sourceEffectiveFrom: request.program.effectiveFrom,
    sourceEffectiveTo: request.program.effectiveTo,
    effectiveDate: request.effectiveDate,
    officialSourceUrl: request.program.officialSourceUrl,
    officialSourceTitle: request.program.officialSourceTitle,
    productRegistryRequirements: request.activity.productRegistryRequirements,
    trace: execution.trace,
    output,
    status: "estimate_only_program_reconciliation_required",
    certificateActionEnabled: false,
    operatorMessage: request.program.operatorMessage,
    inputHash: sha256(canonicalInputs),
    traceHash: sha256(execution.trace),
    outputHash: sha256(output),
    receiptHash: sha256(receiptBase),
  };
}
