import { createHash } from "node:crypto";

import type { CreditexStcEstimate } from "./creditex-stc-estimator.ts";
import {
  CreditexStcEstimateError,
  creditexStcMaximumDeemingYears,
  estimateCreditexStcs,
} from "./creditex-stc-estimator.ts";
import { resolveCerSresPostcode } from "./creditex-sres-registry.ts";
import { estimateCreditexStcsFromRegistry } from "./creditex-sres-registry-server.ts";

export type CreditexSresQuoteEstimate = Omit<
  CreditexStcEstimate,
  "inputSnapshot"
> & {
  inputSnapshot: Record<string, unknown>;
  estimatePurpose: "quote";
  eligibilityConfirmed: false;
  eligibilityWarning: string;
  resolution?: Record<string, unknown>;
  resolvedReceiptHash?: string;
  unitQuantity?: string;
  perUnitOutput?: CreditexStcEstimate["output"];
  waterHeaterItems?: CreditexSresWaterHeaterQuoteItem[];
};

export type CreditexSresWaterHeaterQuoteItem = {
  itemNumber: string;
  productKey: string;
  unitQuantity: string;
  resolution: Record<string, unknown>;
  perUnitOutput: CreditexStcEstimate["output"];
  output: CreditexStcEstimate["output"];
  trace: CreditexStcEstimate["trace"];
  receiptHash: string;
  resolvedReceiptHash?: string;
};

const QUOTE_WARNING =
  "The STC quantity is an exact, source-verified calculation for the supplied inputs. Equipment and installation eligibility and evidence are not confirmed by this calculation. Certificate creation, provider submission and provider acceptance remain separate governed workflows.";

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

export function creditexSresWaterHeaterQuoteItems(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    requestError("Add between 1 and 10 approved water-heater product groups.");
  }
  let totalUnits = 0;
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      requestError(`Water-heater product group ${index + 1} is invalid.`);
    }
    exactKeys(candidate, ["productKey", "unitQuantity"]);
    const productKey = typeof candidate.productKey === "string"
      ? candidate.productKey.trim()
      : "";
    if (!productKey || productKey !== candidate.productKey) {
      requestError(`Choose an exact approved product for water-heater group ${index + 1}.`);
    }
    const unitQuantity = registeredUnitQuantity(candidate.unitQuantity);
    totalUnits += unitQuantity;
    if (totalUnits > 10) {
      requestError("A mixed-model water-heater quote can include no more than 10 systems in total.");
    }
    return { productKey, unitQuantity: String(unitQuantity) };
  });
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

export function creditexCombineRegisteredWaterHeaterQuotes(
  items: readonly {
    productKey: string;
    unitQuantity: string;
    estimate: ResolvedStcEstimate & {
      unitQuantity: string;
      perUnitOutput: CreditexStcEstimate["output"];
    };
  }[],
): Omit<ResolvedStcEstimate, "inputSnapshot"> & {
  inputSnapshot: Record<string, unknown>;
  unitQuantity: string;
  waterHeaterItems: CreditexSresWaterHeaterQuoteItem[];
} {
  if (items.length < 1) {
    requestError("Add at least one approved water-heater product group.");
  }
  const first = items[0].estimate;
  let totalUnits = 0;
  let totalStcs = BigInt(0);
  const waterHeaterItems = items.map((item, index) => {
    const quantity = registeredUnitQuantity(item.unitQuantity);
    totalUnits += quantity;
    if (totalUnits > 10) {
      requestError("A mixed-model water-heater quote can include no more than 10 systems in total.");
    }
    if (
      item.estimate.unitQuantity !== String(quantity)
      || item.estimate.technology !== first.technology
      || item.estimate.effectiveDate !== first.effectiveDate
      || item.estimate.resolution?.postcode !== first.resolution?.postcode
      || item.estimate.resolution?.zone !== first.resolution?.zone
      || item.estimate.resolution?.sourceRecordKey !== item.productKey
      || BigInt(item.estimate.perUnitOutput.quantity) * BigInt(quantity)
        !== BigInt(item.estimate.output.quantity)
    ) {
      requestError(`Water-heater product group ${index + 1} does not match its per-system arithmetic.`);
    }
    totalStcs += BigInt(item.estimate.output.quantity);
    return {
      itemNumber: String(index + 1),
      productKey: item.productKey,
      unitQuantity: String(quantity),
      resolution: item.estimate.resolution || {},
      perUnitOutput: item.estimate.perUnitOutput,
      output: item.estimate.output,
      trace: item.estimate.trace,
      receiptHash: item.estimate.receiptHash,
      ...(item.estimate.resolvedReceiptHash
        ? { resolvedReceiptHash: item.estimate.resolvedReceiptHash }
        : {}),
    };
  });
  const unitQuantity = String(totalUnits);
  const totalQuantity = String(totalStcs);
  const inputSnapshot = {
    technology: first.technology,
    installationDate: first.effectiveDate,
    postcode: String(first.resolution?.postcode || ""),
    waterHeaterItems: waterHeaterItems.map((item) => ({
      itemNumber: item.itemNumber,
      productKey: item.productKey,
      unitQuantity: item.unitQuantity,
      sourceRecordKey: String(item.resolution.sourceRecordKey || ""),
      arithmeticReceiptHash: item.receiptHash,
      resolvedReceiptHash: item.resolvedReceiptHash || "",
    })),
  };
  const trace = [
    ...waterHeaterItems.map((item) => ({
      key: `water_heater_item_${item.itemNumber}`,
      label: `Approved model ${item.itemNumber}`,
      input: `${item.perUnitOutput.quantity} STC per system x ${item.unitQuantity}`,
      operation: "calculate this exact registered product independently, then multiply its whole per-system STCs by its installed quantity",
      output: item.output.quantity,
      unit: "STC",
    })),
    {
      key: "property_total",
      label: "Property total",
      input: `${waterHeaterItems.length} approved model group${waterHeaterItems.length === 1 ? "" : "s"}; ${unitQuantity} systems`,
      operation: "add the independently calculated whole-STC totals for every approved product group",
      output: totalQuantity,
      unit: "STC",
    },
  ];
  const output = { quantity: totalQuantity, unit: "STC" as const };
  const resolution = {
    postcode: String(first.resolution?.postcode || ""),
    zone: first.resolution?.zone,
    registryCode: first.resolution?.registryCode,
    registryLastCheckedAt: first.resolution?.registryLastCheckedAt,
    unitQuantity,
    totalStcs: totalQuantity,
    registrySnapshots: Array.from(new Map(waterHeaterItems.map((item) => [
      String(item.resolution.snapshotId || ""),
      {
        snapshotId: item.resolution.snapshotId,
        sourceSha256: item.resolution.registrySourceSha256,
      },
    ])).values()),
    waterHeaterItems: waterHeaterItems.map((item) => ({
      itemNumber: item.itemNumber,
      unitQuantity: item.unitQuantity,
      brand: item.resolution.brand,
      model: item.resolution.model,
      sourceRecordKey: item.resolution.sourceRecordKey,
      eligibleFrom: item.resolution.eligibleFrom,
      eligibleTo: item.resolution.eligibleTo,
      perUnitStcs: item.perUnitOutput.quantity,
      totalStcs: item.output.quantity,
      resolvedReceiptHash: item.resolvedReceiptHash || "",
    })),
  };
  const propertyReceipt = {
    contract: "creditex-sres-mixed-water-heater-property-quote/v1",
    technology: first.technology,
    installationDate: first.effectiveDate,
    postcode: String(first.resolution?.postcode || ""),
    unitQuantity,
    totalQuantity,
    items: waterHeaterItems.map((item) => ({
      itemNumber: item.itemNumber,
      productKey: item.productKey,
      unitQuantity: item.unitQuantity,
      perUnitQuantity: item.perUnitOutput.quantity,
      totalQuantity: item.output.quantity,
      arithmeticReceiptHash: item.receiptHash,
      resolvedReceiptHash: item.resolvedReceiptHash || "",
    })),
  };
  return {
    ...first,
    inputSnapshot,
    trace,
    output,
    resolution,
    unitQuantity,
    waterHeaterItems,
    inputHash: sha256(inputSnapshot),
    traceHash: sha256(trace),
    outputHash: sha256(output),
    receiptHash: sha256(propertyReceipt),
    resolvedReceiptHash: sha256({ propertyReceipt, resolution }),
    operatorMessage: QUOTE_WARNING,
  };
}

function quoteEstimate(
  estimate: Omit<CreditexStcEstimate, "inputSnapshot"> & {
    inputSnapshot: Record<string, unknown>;
  },
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
  options: {
    now?: Date;
    allowStaleAcceptedSnapshot?: boolean;
  } = {},
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
    const mixedItems = requestValue.waterHeaterItems === undefined
      ? null
      : creditexSresWaterHeaterQuoteItems(requestValue.waterHeaterItems);
    exactKeys(requestValue, mixedItems
      ? [
          "estimatePurpose",
          "technology",
          "installationDate",
          "postcode",
          "waterHeaterItems",
        ]
      : [
          "estimatePurpose",
          "technology",
          "installationDate",
          "postcode",
          "productKey",
          "unitQuantity",
        ]);
    if (mixedItems) {
      const itemEstimates = await Promise.all(mixedItems.map(async (item) => {
        const perUnitEstimate = await estimateCreditexStcsFromRegistry(db, {
          technology,
          installationDate: requestValue.installationDate,
          postcode: requestValue.postcode,
          productKey: item.productKey,
        }, options);
        return {
          ...item,
          estimate: creditexRepeatRegisteredWaterHeaterQuote(
            perUnitEstimate,
            item.unitQuantity,
          ),
        };
      }));
      const estimate = creditexCombineRegisteredWaterHeaterQuotes(itemEstimates);
      return {
        ...quoteEstimate(estimate, estimate.resolution),
        waterHeaterItems: estimate.waterHeaterItems,
        ...(estimate.resolvedReceiptHash
          ? { resolvedReceiptHash: estimate.resolvedReceiptHash }
          : {}),
      };
    }
    const registryRequest = Object.fromEntries(
      Object.entries(requestValue).filter(
        ([key]) => key !== "estimatePurpose" && key !== "unitQuantity",
      ),
    );
    const perUnitEstimate = await estimateCreditexStcsFromRegistry(
      db,
      registryRequest,
      options,
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
