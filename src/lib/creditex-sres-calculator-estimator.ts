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
    ]);
    const registryRequest = Object.fromEntries(
      Object.entries(requestValue).filter(([key]) => key !== "estimatePurpose"),
    );
    const estimate = await estimateCreditexStcsFromRegistry(db, registryRequest);
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
