import { dollarsToCents } from "./trade-quote.ts";

export const PRICE_BOOK_ITEM_TYPES = [
  "labour", "material", "equipment", "subcontractor", "travel", "call_out",
  "disposal", "rebate", "discount", "non_billable", "one_off",
] as const;

export type PriceBookItemType = typeof PRICE_BOOK_ITEM_TYPES[number];
export type PriceBookTaxCode = "gst" | "none";

export const PRICE_BOOK_TYPE_LABELS: Record<PriceBookItemType, string> = {
  labour: "Labour",
  material: "Material",
  equipment: "Equipment",
  subcontractor: "Subcontractor",
  travel: "Travel",
  call_out: "Call-out",
  disposal: "Disposal",
  rebate: "Rebate",
  discount: "Discount",
  non_billable: "Non-billable",
  one_off: "One-off work",
};

export const PRICE_BOOK_UNITS = [
  ["each", "Each"], ["hour", "Hour"], ["day", "Day"], ["metre", "Metre"],
  ["square_metre", "Square metre"], ["kilometre", "Kilometre"], ["visit", "Visit"], ["fixed", "Fixed"],
] as const;

const itemTypes = new Set<string>(PRICE_BOOK_ITEM_TYPES);
const units = new Set<string>(PRICE_BOOK_UNITS.map(([value]) => value));
const taxCodes = new Set<string>(["gst", "none"]);

function roundRatioHalfAwayFromZero(numerator: bigint, denominator: bigint) {
  const negative = numerator < BigInt(0);
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / BigInt(2)) / denominator;
  return Number(negative ? -rounded : rounded);
}

export function calculatePriceBookRates(costCents: number, sellCents: number) {
  if (!Number.isSafeInteger(costCents) || costCents < 0 || !Number.isSafeInteger(sellCents)) throw new Error("INVALID_PRICE_BOOK_MONEY");
  const grossProfitCents = sellCents - costCents;
  const markupBasisPoints = costCents > 0 && sellCents > 0
    ? roundRatioHalfAwayFromZero(BigInt(grossProfitCents) * BigInt(10_000), BigInt(costCents)) : 0;
  const marginBasisPoints = sellCents > 0
    ? roundRatioHalfAwayFromZero(BigInt(grossProfitCents) * BigInt(10_000), BigInt(sellCents)) : 0;
  return { grossProfitCents, markupBasisPoints, marginBasisPoints };
}

export function priceBookQuoteLineType(itemType: PriceBookItemType): "product" | "labour" | "adjustment" {
  if (["rebate", "discount", "non_billable"].includes(itemType)) return "adjustment";
  if (["labour", "subcontractor", "travel", "call_out", "disposal", "one_off"].includes(itemType)) return "labour";
  return "product";
}

export function normalisePriceBookInput(raw: Record<string, unknown>, clean: (value: unknown, length: number) => string) {
  const itemType = clean(raw.itemType, 30) as PriceBookItemType;
  const name = clean(raw.name, 140);
  const description = clean(raw.description, 500);
  const unitLabelInput = clean(raw.unitLabel, 30);
  const unitLabel = units.has(unitLabelInput) ? unitLabelInput : "each";
  const taxCode = clean(raw.taxCode, 20) as PriceBookTaxCode;
  if (!itemTypes.has(itemType) || !name || !taxCodes.has(taxCode)) throw new Error("INVALID_PRICE_BOOK_ITEM");

  const supplierCostCentsExGst = dollarsToCents(raw.supplierCost || "0");
  const allowNegative = itemType === "rebate" || itemType === "discount";
  const sellPriceCentsExGst = dollarsToCents(raw.sellPrice, allowNegative);
  if (allowNegative && sellPriceCentsExGst >= 0) throw new Error("INVALID_PRICE_BOOK_ADJUSTMENT");
  if (!allowNegative && itemType !== "non_billable" && sellPriceCentsExGst <= 0) throw new Error("INVALID_PRICE_BOOK_SELL_PRICE");
  if (itemType === "non_billable" && sellPriceCentsExGst !== 0) throw new Error("INVALID_PRICE_BOOK_NON_BILLABLE");
  if (allowNegative && supplierCostCentsExGst !== 0) throw new Error("INVALID_PRICE_BOOK_ADJUSTMENT");

  const durationText = String(raw.expectedDurationMinutes ?? "0").trim();
  if (!/^\d{1,5}$/.test(durationText)) throw new Error("INVALID_PRICE_BOOK_DURATION");
  const expectedDurationMinutes = Number(durationText);
  if (expectedDurationMinutes < 0 || expectedDurationMinutes > 10_080) throw new Error("INVALID_PRICE_BOOK_DURATION");

  return {
    name,
    description,
    itemType,
    unitLabel,
    supplierCostCentsExGst,
    sellPriceCentsExGst,
    taxCode,
    ...calculatePriceBookRates(supplierCostCentsExGst, sellPriceCentsExGst),
    expectedDurationMinutes,
    requiredSkill: clean(raw.requiredSkill, 80),
    supplierName: clean(raw.supplierName, 140),
    supplierSku: clean(raw.supplierSku, 100),
    supplierProductId: clean(raw.supplierProductId, 180),
  };
}
