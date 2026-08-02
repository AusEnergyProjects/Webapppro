import { createHash } from "node:crypto";

export const CREDITEX_STC_ESTIMATE_CONTRACT =
  "creditex-stc-deterministic-estimate/v1" as const;
export const CREDITEX_STC_ESTIMATE_REVIEWED_ON = "2026-08-02";

export const CREDITEX_STC_TECHNOLOGIES = [
  "solar_pv",
  "small_wind",
  "small_hydro",
  "solar_water_heater",
  "air_source_heat_pump",
  "solar_battery",
] as const;

export type CreditexStcTechnology =
  typeof CREDITEX_STC_TECHNOLOGIES[number];

export const CREDITEX_STC_ZONE_RATINGS = [
  "1.622",
  "1.536",
  "1.382",
  "1.185",
] as const;

export type CreditexStcZoneRating =
  typeof CREDITEX_STC_ZONE_RATINGS[number];

type SolarPvRequest = {
  technology: "solar_pv";
  installationDate: string;
  ratedCapacityKw: string;
  zoneRating: CreditexStcZoneRating;
};

type WindHydroRequest = {
  technology: "small_wind" | "small_hydro";
  installationDate: string;
  ratedCapacityKw: string;
  resourceAvailability: "default" | "site_assessed";
  resourceHoursPerYear?: string;
  deemingYears: string;
};

type WaterHeaterRequest = {
  technology: "solar_water_heater" | "air_source_heat_pump";
  installationDate: string;
  registeredTenYearStcs: string;
};

type SolarBatteryRequest = {
  technology: "solar_battery";
  certificationDate: string;
  claimScope: "new_system";
  nominalCapacityKwh: string;
  usableCapacityKwh: string;
};

export type CreditexStcEstimateRequest =
  | SolarPvRequest
  | WindHydroRequest
  | WaterHeaterRequest
  | SolarBatteryRequest;

export type CreditexStcEstimateTrace = {
  key: string;
  label: string;
  input: string;
  operation: string;
  output: string;
  unit: string;
};

export type CreditexStcEstimate = {
  schemaVersion: typeof CREDITEX_STC_ESTIMATE_CONTRACT;
  technology: CreditexStcTechnology;
  formulaKey: string;
  formulaVersion: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  sourceReviewedOn: typeof CREDITEX_STC_ESTIMATE_REVIEWED_ON;
  effectiveDate: string;
  inputSnapshot: Record<string, string>;
  trace: CreditexStcEstimateTrace[];
  output: {
    quantity: string;
    unit: "STC";
  };
  status: "estimate_only_registry_reconciliation_required";
  certificateActionEnabled: false;
  inputHash: string;
  traceHash: string;
  outputHash: string;
  receiptHash: string;
  operatorMessage: string;
};

export type CreditexStcEstimateErrorCode =
  | "STC_REQUEST_INVALID"
  | "STC_DATE_UNSUPPORTED"
  | "STC_VALUE_INVALID"
  | "STC_SYSTEM_INELIGIBLE";

export class CreditexStcEstimateError extends Error {
  readonly code: CreditexStcEstimateErrorCode;
  readonly status: number;

  constructor(
    code: CreditexStcEstimateErrorCode,
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "CreditexStcEstimateError";
    this.code = code;
    this.status = status;
  }
}

type Decimal = {
  coefficient: bigint;
  scale: number;
};

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DECIMAL_PLACES = 6;
const ZERO: Decimal = { coefficient: BigInt(0), scale: 0 };

function fail(
  code: CreditexStcEstimateErrorCode,
  message: string,
): never {
  throw new CreditexStcEstimateError(code, 400, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    fail(
      "STC_REQUEST_INVALID",
      `Remove unsupported STC estimate field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
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

function parseDate(value: unknown) {
  const text = String(value || "").trim();
  if (!DATE_PATTERN.test(text)) {
    fail(
      "STC_DATE_UNSUPPORTED",
      "Choose a valid installation date from 2026 to 2030.",
    );
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== text
    || date.getUTCFullYear() < 2026
    || date.getUTCFullYear() > 2030
  ) {
    fail(
      "STC_DATE_UNSUPPORTED",
      "This deterministic STC estimate supports installation dates from 1 January 2026 to 31 December 2030.",
    );
  }
  return {
    text,
    date,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function powerOfTen(scale: number) {
  return BigInt(10) ** BigInt(scale);
}

function parseDecimal(
  value: unknown,
  label: string,
  maximum?: string,
  options: { allowZero?: boolean; integer?: boolean } = {},
) {
  if (typeof value !== "string") {
    fail("STC_VALUE_INVALID", `${label} must be an exact decimal string.`);
  }
  const text = value.trim();
  if (!DECIMAL_PATTERN.test(text)) {
    fail("STC_VALUE_INVALID", `Enter a valid ${label.toLowerCase()}.`);
  }
  const [whole, fraction = ""] = text.split(".");
  if (
    fraction.length > MAX_DECIMAL_PLACES
    || (options.integer && fraction.length > 0)
  ) {
    fail(
      "STC_VALUE_INVALID",
      options.integer
        ? `${label} must be a whole number.`
        : `${label} supports no more than ${MAX_DECIMAL_PLACES} decimal places.`,
    );
  }
  const decimal = {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
  if (
    (!options.allowZero && decimal.coefficient === BigInt(0))
    || (
      maximum
      && compare(decimal, parseDecimalUnsafe(maximum)) > 0
    )
  ) {
    fail(
      "STC_VALUE_INVALID",
      `${label} must be ${options.allowZero ? "zero or greater" : "greater than zero"}${maximum ? ` and no more than ${maximum}` : ""}.`,
    );
  }
  return decimal;
}

function parseDecimalUnsafe(value: string): Decimal {
  const [whole, fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function align(left: Decimal, right: Decimal) {
  const scale = Math.max(left.scale, right.scale);
  return {
    left: left.coefficient * powerOfTen(scale - left.scale),
    right: right.coefficient * powerOfTen(scale - right.scale),
    scale,
  };
}

function compare(left: Decimal, right: Decimal) {
  const aligned = align(left, right);
  return aligned.left === aligned.right
    ? 0
    : aligned.left > aligned.right
      ? 1
      : -1;
}

function add(left: Decimal, right: Decimal): Decimal {
  const aligned = align(left, right);
  return {
    coefficient: aligned.left + aligned.right,
    scale: aligned.scale,
  };
}

function subtract(left: Decimal, right: Decimal): Decimal {
  const aligned = align(left, right);
  return {
    coefficient: aligned.left - aligned.right,
    scale: aligned.scale,
  };
}

function multiply(left: Decimal, right: Decimal): Decimal {
  return {
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  };
}

function minimum(left: Decimal, right: Decimal) {
  return compare(left, right) <= 0 ? left : right;
}

function maximum(left: Decimal, right: Decimal) {
  return compare(left, right) >= 0 ? left : right;
}

function formatDecimal(value: Decimal) {
  const negative = value.coefficient < BigInt(0);
  const absolute = negative ? -value.coefficient : value.coefficient;
  if (value.scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const padded = absolute.toString().padStart(value.scale + 1, "0");
  const whole = padded.slice(0, -value.scale) || "0";
  const fraction = padded.slice(-value.scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function floorDecimal(value: Decimal) {
  if (value.coefficient < BigInt(0)) {
    fail("STC_VALUE_INVALID", "STC estimates cannot be negative.");
  }
  return value.coefficient / powerOfTen(value.scale);
}

function sourceFor(technology: CreditexStcTechnology) {
  if (technology === "solar_battery") {
    return {
      formulaKey: "cer-sres-solar-battery-estimate/v1",
      formulaVersion:
        "CER solar battery STC factors and tapered capacity bands reviewed 2 August 2026",
      officialSourceUrl:
        "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-batteries",
      officialSourceTitle: "Solar batteries",
    };
  }
  if (
    technology === "solar_water_heater"
    || technology === "air_source_heat_pump"
  ) {
    return {
      formulaKey: "cer-sres-registered-water-heater-estimate/v1",
      formulaVersion:
        "CER registered 10-year entitlement deeming factors reviewed 2 August 2026",
      officialSourceUrl:
        "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-water-heaters/register-solar-water-heaters",
      officialSourceTitle: "Register of solar water heaters",
    };
  }
  if (technology === "small_wind" || technology === "small_hydro") {
    return {
      formulaKey: "cer-sres-wind-hydro-estimate/v1",
      formulaVersion:
        "Renewable Energy (Electricity) Regulations 2001 compilation 90, regulations 19D and 20",
      officialSourceUrl:
        "https://www.legislation.gov.au/F2001B00053/2026-05-01/2026-05-01/text/original/pdf",
      officialSourceTitle:
        "Renewable Energy (Electricity) Regulations 2001, compilation 90",
    };
  }
  return {
    formulaKey: "cer-sres-solar-pv-estimate/v1",
    formulaVersion:
      "CER small generation unit zone ratings and 2026-2030 deeming periods reviewed 2 August 2026",
    officialSourceUrl:
      "https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems",
    officialSourceTitle: "Postcode zone ratings and zones for solar panel systems",
  };
}

function batteryFactor(year: number, month: number) {
  const periods = [
    { from: 202601, to: 202604, factor: "8.4" },
    { from: 202605, to: 202612, factor: "6.8" },
    { from: 202701, to: 202706, factor: "5.7" },
    { from: 202707, to: 202712, factor: "5.2" },
    { from: 202801, to: 202806, factor: "4.6" },
    { from: 202807, to: 202812, factor: "4.1" },
    { from: 202901, to: 202906, factor: "3.6" },
    { from: 202907, to: 202912, factor: "3.1" },
    { from: 203001, to: 203006, factor: "2.6" },
    { from: 203007, to: 203012, factor: "2.1" },
  ];
  const period = year * 100 + month;
  const match = periods.find(
    (candidate) => period >= candidate.from && period <= candidate.to,
  );
  if (!match) {
    fail(
      "STC_DATE_UNSUPPORTED",
      "No governed battery STC factor is available for this date.",
    );
  }
  return match.factor;
}

function estimateSolarPv(
  request: Record<string, unknown>,
  date: ReturnType<typeof parseDate>,
) {
  exactKeys(request, [
    "technology",
    "installationDate",
    "ratedCapacityKw",
    "zoneRating",
  ]);
  const capacity = parseDecimal(
    request.ratedCapacityKw,
    "Rated system capacity (kW)",
    "100",
  );
  const zoneRating = String(request.zoneRating || "").trim();
  if (
    !CREDITEX_STC_ZONE_RATINGS.includes(
      zoneRating as CreditexStcZoneRating,
    )
  ) {
    fail(
      "STC_VALUE_INVALID",
      "Choose the official zone rating returned by the current postcode lookup.",
    );
  }
  const deemingYears = String(2031 - date.year);
  const annualOutput = multiply(capacity, parseDecimalUnsafe(zoneRating));
  const deemedOutput = multiply(
    annualOutput,
    parseDecimalUnsafe(deemingYears),
  );
  const quantity = floorDecimal(deemedOutput).toString();
  return {
    inputSnapshot: {
      installationDate: date.text,
      ratedCapacityKw: formatDecimal(capacity),
      technology: String(request.technology),
      zoneRating,
    },
    trace: [
      {
        key: "annual_output",
        label: "Deemed annual output",
        input: `${formatDecimal(capacity)} kW`,
        operation: `multiply by zone rating ${zoneRating}`,
        output: formatDecimal(annualOutput),
        unit: "MWh/year",
      },
      {
        key: "deeming_period",
        label: "Deemed renewable generation",
        input: `${formatDecimal(annualOutput)} MWh/year`,
        operation: `multiply by ${deemingYears} deeming years`,
        output: formatDecimal(deemedOutput),
        unit: "MWh",
      },
      {
        key: "whole_stcs",
        label: "Whole STCs",
        input: formatDecimal(deemedOutput),
        operation: "round down once at the final entitlement step",
        output: quantity,
        unit: "STC",
      },
    ] satisfies CreditexStcEstimateTrace[],
    quantity,
  };
}

function estimateWindOrHydro(
  request: Record<string, unknown>,
  date: ReturnType<typeof parseDate>,
) {
  exactKeys(request, [
    "technology",
    "installationDate",
    "ratedCapacityKw",
    "resourceAvailability",
    "resourceHoursPerYear",
    "deemingYears",
  ]);
  const technology = String(request.technology);
  const isWind = technology === "small_wind";
  const maximumCapacity = isWind ? "10" : "6.4";
  const defaultHours = isWind ? "2000" : "4000";
  const capacity = parseDecimal(
    request.ratedCapacityKw,
    "Rated system capacity (kW)",
    maximumCapacity,
  );
  if (
    request.resourceAvailability !== "default"
    && request.resourceAvailability !== "site_assessed"
  ) {
    fail(
      "STC_VALUE_INVALID",
      "Choose the default or site-assessed resource availability route.",
    );
  }
  const siteAssessed = request.resourceAvailability === "site_assessed";
  if (!siteAssessed && request.resourceHoursPerYear !== undefined) {
    fail(
      "STC_REQUEST_INVALID",
      "Remove custom resource hours when using the government default.",
    );
  }
  const resourceHours = siteAssessed
    ? parseDecimal(
        request.resourceHoursPerYear,
        "Site-assessed resource hours per year",
        "8760",
        { integer: true },
      )
    : parseDecimalUnsafe(defaultHours);
  if (
    siteAssessed
    && compare(resourceHours, parseDecimalUnsafe(defaultHours)) <= 0
  ) {
    fail(
      "STC_SYSTEM_INELIGIBLE",
      `A site-assessed ${isWind ? "wind" : "hydro"} resource figure must exceed the ${defaultHours}-hour government default.`,
    );
  }
  const maximumDeemingYears = 2031 - date.year;
  const deemingYears = parseDecimal(
    request.deemingYears,
    "Certificate period (years)",
    String(maximumDeemingYears),
    { integer: true },
  );
  if (
    compare(deemingYears, parseDecimalUnsafe("1")) !== 0
    && compare(
      deemingYears,
      parseDecimalUnsafe(String(maximumDeemingYears)),
    ) !== 0
  ) {
    fail(
      "STC_VALUE_INVALID",
      `For a ${date.year} installation, choose a 1-year or ${maximumDeemingYears}-year certificate period.`,
    );
  }

  const annualOutput = multiply(
    multiply(parseDecimalUnsafe("0.00095"), capacity),
    resourceHours,
  );
  if (compare(annualOutput, parseDecimalUnsafe("25")) > 0) {
    fail(
      "STC_SYSTEM_INELIGIBLE",
      "The calculated annual output exceeds the 25 MWh small-generation-unit limit.",
    );
  }
  const periodOutput = multiply(annualOutput, deemingYears);
  const statutoryEntitlement =
    compare(periodOutput, parseDecimalUnsafe("0.5")) >= 0
      && compare(periodOutput, parseDecimalUnsafe("1")) < 0
      ? parseDecimalUnsafe("1")
      : periodOutput;
  const quantity = floorDecimal(statutoryEntitlement).toString();
  return {
    inputSnapshot: {
      deemingYears: formatDecimal(deemingYears),
      installationDate: date.text,
      ratedCapacityKw: formatDecimal(capacity),
      resourceAvailability: String(request.resourceAvailability),
      resourceHoursPerYear: formatDecimal(resourceHours),
      technology,
    },
    trace: [
      {
        key: "annual_output",
        label: "Annual renewable generation",
        input: `${formatDecimal(capacity)} kW at ${formatDecimal(resourceHours)} hours/year`,
        operation: "multiply by the statutory 0.00095 conversion factor",
        output: formatDecimal(annualOutput),
        unit: "MWh/year",
      },
      {
        key: "certificate_period",
        label: "Certificate period output",
        input: `${formatDecimal(annualOutput)} MWh/year`,
        operation: `multiply by the controlled ${formatDecimal(deemingYears)}-year period`,
        output: formatDecimal(periodOutput),
        unit: "MWh",
      },
      {
        key: "statutory_entitlement",
        label: "Statutory entitlement amount",
        input: formatDecimal(periodOutput),
        operation:
          compare(periodOutput, parseDecimalUnsafe("0.5")) >= 0
            && compare(periodOutput, parseDecimalUnsafe("1")) < 0
            ? "apply the statutory 0.5-to-below-1 MWh minimum of 1"
            : "retain the calculated period output",
        output: formatDecimal(statutoryEntitlement),
        unit: "STC",
      },
      {
        key: "whole_stcs",
        label: "Whole STCs",
        input: formatDecimal(statutoryEntitlement),
        operation: "round down once at the final entitlement step",
        output: quantity,
        unit: "STC",
      },
    ] satisfies CreditexStcEstimateTrace[],
    quantity,
  };
}

function estimateWaterHeater(
  request: Record<string, unknown>,
  date: ReturnType<typeof parseDate>,
) {
  exactKeys(request, [
    "technology",
    "installationDate",
    "registeredTenYearStcs",
  ]);
  const registered = parseDecimal(
    request.registeredTenYearStcs,
    "Registered 10-year STCs",
    undefined,
    { integer: true },
  );
  const deemingFactor = parseDecimalUnsafe(
    `${2031 - date.year === 10 ? "1" : `0.${2031 - date.year}`}`,
  );
  const adjusted = multiply(registered, deemingFactor);
  const quantity = floorDecimal(adjusted).toString();
  return {
    inputSnapshot: {
      installationDate: date.text,
      registeredTenYearStcs: formatDecimal(registered),
      technology: String(request.technology),
    },
    trace: [
      {
        key: "deeming_factor",
        label: "Reduced deeming entitlement",
        input: `${formatDecimal(registered)} registered 10-year STCs`,
        operation: `multiply by ${formatDecimal(deemingFactor)} for an installation in ${date.year}`,
        output: formatDecimal(adjusted),
        unit: "STC",
      },
      {
        key: "whole_stcs",
        label: "Whole STCs",
        input: formatDecimal(adjusted),
        operation: "round down once at the final entitlement step",
        output: quantity,
        unit: "STC",
      },
    ] satisfies CreditexStcEstimateTrace[],
    quantity,
  };
}

function estimateBattery(
  request: Record<string, unknown>,
  date: ReturnType<typeof parseDate>,
) {
  exactKeys(request, [
    "technology",
    "certificationDate",
    "claimScope",
    "nominalCapacityKwh",
    "usableCapacityKwh",
  ]);
  if (request.claimScope !== "new_system") {
    fail(
      "STC_REQUEST_INVALID",
      "This phase supports a new eligible battery system only. Expansion claims require additional evidence and are blocked.",
    );
  }
  const nominal = parseDecimal(
    request.nominalCapacityKwh,
    "Nominal battery capacity (kWh)",
    "100",
  );
  if (compare(nominal, parseDecimalUnsafe("5")) < 0) {
    fail(
      "STC_SYSTEM_INELIGIBLE",
      "A new solar battery must have at least 5 kWh nominal capacity.",
    );
  }
  const usable = parseDecimal(
    request.usableCapacityKwh,
    "Usable battery capacity (kWh)",
    "100",
  );
  if (compare(usable, nominal) > 0) {
    fail(
      "STC_SYSTEM_INELIGIBLE",
      "Usable battery capacity cannot exceed nominal capacity.",
    );
  }

  const fourteen = parseDecimalUnsafe("14");
  const twentyEight = parseDecimalUnsafe("28");
  const fifty = parseDecimalUnsafe("50");
  const claimable = minimum(usable, fifty);
  const firstTier = minimum(claimable, fourteen);
  const secondTier = minimum(
    maximum(subtract(claimable, fourteen), ZERO),
    fourteen,
  );
  const thirdTier = minimum(
    maximum(subtract(claimable, twentyEight), ZERO),
    parseDecimalUnsafe("22"),
  );
  const weightedSecond = multiply(secondTier, parseDecimalUnsafe("0.6"));
  const weightedThird = multiply(thirdTier, parseDecimalUnsafe("0.15"));
  const weightedCapacity = add(add(firstTier, weightedSecond), weightedThird);
  const factor = parseDecimalUnsafe(batteryFactor(date.year, date.month));
  const tapered = date.year > 2026 || date.month >= 5;
  const factorCapacity = tapered ? weightedCapacity : claimable;
  const raw = multiply(factorCapacity, factor);
  const quantity = floorDecimal(raw).toString();
  const capacityTrace: CreditexStcEstimateTrace[] = tapered
    ? [
        {
          key: "tier_one",
          label: "Tier 1 capacity",
          input: `${formatDecimal(firstTier)} kWh`,
          operation: "apply 100% weighting from 0 to 14 kWh",
          output: formatDecimal(firstTier),
          unit: "weighted kWh",
        },
        {
          key: "tier_two",
          label: "Tier 2 capacity",
          input: `${formatDecimal(secondTier)} kWh`,
          operation: "apply 60% weighting above 14 to 28 kWh",
          output: formatDecimal(weightedSecond),
          unit: "weighted kWh",
        },
        {
          key: "tier_three",
          label: "Tier 3 capacity",
          input: `${formatDecimal(thirdTier)} kWh`,
          operation: "apply 15% weighting above 28 to 50 kWh",
          output: formatDecimal(weightedThird),
          unit: "weighted kWh",
        },
      ]
    : [
        {
          key: "pre_reform_capacity",
          label: "Pre-reform factor capacity",
          input: `${formatDecimal(claimable)} kWh`,
          operation:
            "apply the full factor to claimable capacity before 1 May 2026",
          output: formatDecimal(claimable),
          unit: "kWh",
        },
      ];
  return {
    inputSnapshot: {
      certificationDate: date.text,
      claimScope: "new_system",
      nominalCapacityKwh: formatDecimal(nominal),
      technology: "solar_battery",
      usableCapacityKwh: formatDecimal(usable),
    },
    trace: [
      {
        key: "claimable_capacity",
        label: "Claimable usable capacity",
        input: `${formatDecimal(usable)} kWh usable`,
        operation: "cap at 50 kWh",
        output: formatDecimal(claimable),
        unit: "kWh",
      },
      ...capacityTrace,
      {
        key: "stc_factor",
        label: "Battery STC factor",
        input: `${formatDecimal(factorCapacity)} ${tapered ? "weighted " : ""}kWh`,
        operation: `multiply by ${formatDecimal(factor)} for the safety certification date`,
        output: formatDecimal(raw),
        unit: "STC",
      },
      {
        key: "whole_stcs",
        label: "Whole STCs",
        input: formatDecimal(raw),
        operation: "round down once at the final entitlement step",
        output: quantity,
        unit: "STC",
      },
    ] satisfies CreditexStcEstimateTrace[],
    quantity,
  };
}

export function estimateCreditexStcs(
  requestValue: unknown,
): CreditexStcEstimate {
  if (!isRecord(requestValue)) {
    fail("STC_REQUEST_INVALID", "Enter a valid STC estimate request.");
  }
  const request = requestValue;
  const technology = String(request.technology || "").trim();
  if (
    !CREDITEX_STC_TECHNOLOGIES.includes(
      technology as CreditexStcTechnology,
    )
  ) {
    fail("STC_REQUEST_INVALID", "Choose a supported SRES technology.");
  }
  const typedTechnology = technology as CreditexStcTechnology;
  const date = parseDate(
    typedTechnology === "solar_battery"
      ? request.certificationDate
      : request.installationDate,
  );
  const calculation = typedTechnology === "solar_battery"
    ? estimateBattery(request, date)
    : typedTechnology === "solar_water_heater"
        || typedTechnology === "air_source_heat_pump"
      ? estimateWaterHeater(request, date)
      : typedTechnology === "small_wind"
          || typedTechnology === "small_hydro"
        ? estimateWindOrHydro(request, date)
        : estimateSolarPv(request, date);
  const source = sourceFor(typedTechnology);
  const output = {
    quantity: calculation.quantity,
    unit: "STC" as const,
  };
  const inputHash = sha256(calculation.inputSnapshot);
  const traceHash = sha256(calculation.trace);
  const outputHash = sha256(output);
  const receiptCore = {
    schemaVersion: CREDITEX_STC_ESTIMATE_CONTRACT,
    technology: typedTechnology,
    formulaKey: source.formulaKey,
    formulaVersion: source.formulaVersion,
    officialSourceUrl: source.officialSourceUrl,
    sourceReviewedOn: CREDITEX_STC_ESTIMATE_REVIEWED_ON,
    effectiveDate: date.text,
    inputHash,
    traceHash,
    outputHash,
    status: "estimate_only_registry_reconciliation_required",
    certificateActionEnabled: false,
  } as const;
  return {
    ...receiptCore,
    officialSourceTitle: source.officialSourceTitle,
    inputSnapshot: calculation.inputSnapshot,
    trace: calculation.trace,
    output,
    receiptHash: sha256(receiptCore),
    operatorMessage:
      "Estimate only. Confirm current product eligibility and reconcile the result with the REC Registry calculator before any assignment or STC creation. This response cannot create, submit, trade or settle a certificate.",
  };
}
