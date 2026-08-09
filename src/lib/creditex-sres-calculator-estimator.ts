import { createHash } from "node:crypto";

import type { CreditexStcEstimate } from "./creditex-stc-estimator.ts";
import {
  CreditexStcEstimateError,
  creditexStcMaximumDeemingYears,
  estimateCreditexStcs,
} from "./creditex-stc-estimator.ts";
import { resolveCerSresPostcode } from "./creditex-sres-registry.ts";
import { estimateCreditexStcsFromRegistry } from "./creditex-sres-registry-server.ts";

export type CreditexSresQuoteEstimate = CreditexStcEstimate & {
  estimatePurpose: "quote";
  eligibilityConfirmed: false;
  eligibilityWarning: string;
  resolution?: Record<string, unknown>;
  resolvedReceiptHash?: string;
  unitQuantity?: string;
  perUnitOutput?: CreditexStcEstimate["output"];
};

const QUOTE_WARNING =
  "Quote estimate only. Equipment and installation eligibility have not been confirmed. Confirm approved products and complete installation evidence before any certificate action.";

function requestError(message: string): never {
  throw new CreditexStcEstimateError("STC_REQUEST_INVALID", 400, message);
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
  if (unexpected.length > 0) {
    requestError(
      `Remove unsupported quote estimate field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
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

function registeredUnitQuantity(value: unknown) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    requestError("Number of identical systems must be a whole number from 1 to 10.");
  }
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
    requestError("Number of identical systems must be a whole number from 1 to 10.");
  }
  return quantity;
}

type ResolvedStcEstimate = CreditexStcEstimate & {
  resolution?: Record<string, unknown>;
  resolvedReceiptHash?: string;
};

export function creditexRepeatRegisteredWaterHeaterQuote(
  estimate: ResolvedStcEstimate,
  rawUnitQuantity: unknown,
): ResolvedStcEstimate & {
  unitQuantity: string;
  perUnitOutput: CreditexStcEstimate["output"];
} {
  const quantity = registeredUnitQuantity(rawUnitQuantity);
  const unitQuantity = String(quantity);
  const perUnitQuantity = BigInt(estimate.output.quantity);
  const totalQuantity = String(perUnitQuantity * BigInt(quantity));
  const inputSnapshot = {
    ...estimate.inputSnapshot,
    unitQuantity,
    repeatedIdenticalRegisteredProduct: String(quantity > 1),
  };
  const trace = [
    ...estimate.trace,
    {
      key: "unit_quantity",
      label: "Identical systems",
      input: unitQuantity,
      operation: "calculate the selected registered system once per installed unit",
      output: unitQuantity,
      unit: "systems",
    },
    {
      key: "multi_unit_total",
      label: "Total whole STCs",
      input: `${estimate.output.quantity} STC per system`,
      operation: `multiply the per-system whole STCs by ${unitQuantity} identical systems`,
      output: totalQuantity,
      unit: "STC",
    },
  ];
  const output = { quantity: totalQuantity, unit: "STC" as const };
  const resolution = {
    ...(estimate.resolution || {}),
    unitQuantity,
    perUnitStcs: estimate.output.quantity,
    totalStcs: totalQuantity,
  };
  const repetitionReceipt = {
    contract: "creditex-sres-repeated-identical-water-heater-quote/v1",
    perUnitReceiptHash: estimate.receiptHash,
    perUnitResolvedReceiptHash: estimate.resolvedReceiptHash || "",
    unitQuantity,
    perUnitQuantity: estimate.output.quantity,
    totalQuantity,
  };
  return {
    ...estimate,
    inputSnapshot,
    trace,
    output,
    resolution,
    unitQuantity,
    perUnitOutput: estimate.output,
    inputHash: sha256(inputSnapshot),
    traceHash: sha256(trace),
    outputHash: sha256(output),
    receiptHash: sha256(repetitionReceipt),
    resolvedReceiptHash: sha256({ repetitionReceipt, resolution }),
  };
}

function quoteEstimate(
  estimate: CreditexStcEstimate,
  resolution?: Record<string, unknown>,
): CreditexSresQuoteEstimate {
  return {
    ...estimate,
    estimatePurpose: "quote",
    eligibilityConfirmed: false,
    eligibilityWarning: QUOTE_WARNING,
    ...(resolution ? { resolution } : {}),
    operatorMessage: QUOTE_WARNING,
  };
}

/**
 * Produces a non-claimable quote estimate from the minimum inputs that affect
 * SRES arithmetic. Product evidence remains mandatory on the registered water
 * heater pathways and every response remains ineligible for certificate action.
 */
export async function estimateCreditexSresQuote(
  db: D1Database,
  requestValue: unknown,
): Promise<CreditexSresQuoteEstimate> {
  if (!isRecord(requestValue) || requestValue.estimatePurpose !== "quote") {
    requestError("Choose the quote estimate purpose.");
  }

  const technology = String(requestValue.technology || "").trim();
  if (technology === "solar_pv") {
    exactKeys(requestValue, [
      "estimatePurpose",
      "technology",
      "installationDate",
      "ratedCapacityKw",
      "postcode",
    ]);
    const postcode = resolveCerSresPostcode("solar_pv", requestValue.postcode);
    return quoteEstimate(
      estimateCreditexStcs({
        technology,
        installationDate: requestValue.installationDate,
        ratedCapacityKw: requestValue.ratedCapacityKw,
        zoneRating: postcode.rating,
      }),
      {
        postcode: postcode.postcode,
        zone: postcode.zone,
        zoneRating: postcode.rating,
        sourceUrl: postcode.sourceUrl,
        sourceVersion: postcode.sourceVersion,
        sourceSha256: postcode.sourceSha256,
      },
    );
  }

  if (technology === "small_wind" || technology === "small_hydro") {
    exactKeys(requestValue, [
      "estimatePurpose",
      "technology",
      "installationDate",
      "ratedCapacityKw",
      "postcode",
    ]);
    const postcode = resolveCerSresPostcode("solar_pv", requestValue.postcode);
    const deemingYears = creditexStcMaximumDeemingYears(
      requestValue.installationDate,
    );
    const resourceHoursPerYear = technology === "small_wind" ? "2000" : "4000";
    return quoteEstimate(
      estimateCreditexStcs({
        technology,
        installationDate: requestValue.installationDate,
        ratedCapacityKw: requestValue.ratedCapacityKw,
        resourceAvailability: "default",
        deemingYears,
      }),
      {
        postcode: postcode.postcode,
        postcodeUsedInArithmetic: false,
        resourceAvailability: "government_default",
        resourceHoursPerYear,
        deemingYears,
      },
    );
  }

  if (
    technology === "solar_water_heater"
    || technology === "air_source_heat_pump"
  ) {
    exactKeys(requestValue, [
      "estimatePurpose",
      "technology",
      "installationDate",
      "postcode",
      "productKey",
      "unitQuantity",
    ]);
    const registryRequest = Object.fromEntries(
      Object.entries(requestValue).filter(
        ([key]) => key !== "estimatePurpose" && key !== "unitQuantity",
      ),
    );
    const perUnitEstimate = await estimateCreditexStcsFromRegistry(
      db,
      registryRequest,
    );
    const estimate = creditexRepeatRegisteredWaterHeaterQuote(
      perUnitEstimate,
      requestValue.unitQuantity,
    );
    return {
      ...quoteEstimate(estimate, estimate.resolution),
      ...(estimate.resolvedReceiptHash
        ? { resolvedReceiptHash: estimate.resolvedReceiptHash }
        : {}),
    };
  }

  if (technology === "solar_battery") {
    exactKeys(requestValue, [
      "estimatePurpose",
      "technology",
      "certificationDate",
      "nominalCapacityKwh",
      "usableCapacityKwh",
    ]);
    if (
      !requestValue.certificationDate
      || !requestValue.nominalCapacityKwh
      || !requestValue.usableCapacityKwh
    ) {
      requestError(
        "Enter the expected safety certification date, nominal capacity and usable capacity for a battery quote estimate.",
      );
    }
    return quoteEstimate(estimateCreditexStcs({
      technology,
      certificationDate: requestValue.certificationDate,
      claimScope: "new_system",
      nominalCapacityKwh: requestValue.nominalCapacityKwh,
      usableCapacityKwh: requestValue.usableCapacityKwh,
    }));
  }

  requestError("Choose a supported SRES technology.");
}
