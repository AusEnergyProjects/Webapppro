export type TradeQuoteLine = {
  lineType: "product" | "labour" | "adjustment";
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  taxCode: "gst" | "none";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export const OVERALL_PERCENT_DISCOUNT_SECTION = "Overall percentage discount";
export const OVERALL_FIXED_DISCOUNT_SECTION = "Overall dollar discount";

export type OverallTradeQuoteDiscountKind = "percent" | "fixed";

const LINE_TYPES = new Set<TradeQuoteLine["lineType"]>(["product", "labour", "adjustment"]);
const TAX_CODES = new Set<TradeQuoteLine["taxCode"]>(["gst", "none"]);
const MAX_QUANTITY_MILLI = 999_999_999;
const MAX_ABS_CENTS = 100_000_000;

function decimalParts(value: unknown, signed: boolean, decimalPlaces: number) {
  const text = String(value ?? "").trim();
  const pattern = signed
    ? new RegExp(`^(-?)(\\d{1,9})(?:\\.(\\d{1,${decimalPlaces}}))?$`)
    : new RegExp(`^(\\d{1,9})(?:\\.(\\d{1,${decimalPlaces}}))?$`);
  const match = text.match(pattern);
  if (!match) throw new Error("INVALID_DECIMAL");
  const negative = signed && match[1] === "-";
  const whole = signed ? match[2] : match[1];
  const fraction = (signed ? match[3] : match[2]) || "";
  return { negative, whole, fraction: fraction.padEnd(decimalPlaces, "0") };
}

export function quantityToMilli(value: unknown) {
  const parsed = decimalParts(value, false, 3);
  const result = Number(parsed.whole) * 1000 + Number(parsed.fraction);
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_QUANTITY_MILLI) throw new Error("INVALID_QUANTITY");
  return result;
}

export function dollarsToCents(value: unknown, allowNegative = false) {
  const parsed = decimalParts(value, allowNegative, 2);
  const absolute = Number(parsed.whole) * 100 + Number(parsed.fraction);
  const result = parsed.negative ? -absolute : absolute;
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_ABS_CENTS || (!allowNegative && result < 0)) throw new Error("INVALID_MONEY");
  return result;
}

function roundRatioHalfAwayFromZero(numerator: bigint, denominator: bigint) {
  const negative = numerator < BigInt(0); const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / BigInt(2)) / denominator;
  return Number(negative ? -rounded : rounded);
}

function rawRecord(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("INVALID_LINES");
  return value as Record<string, unknown>;
}

export function overallTradeQuoteDiscountKind(line: unknown): OverallTradeQuoteDiscountKind | null {
  if (!line || typeof line !== "object") return null;
  const sectionHeading = String((line as Record<string, unknown>).sectionHeading || "");
  if (sectionHeading === OVERALL_PERCENT_DISCOUNT_SECTION) return "percent";
  if (sectionHeading === OVERALL_FIXED_DISCOUNT_SECTION) return "fixed";
  return null;
}

export function percentInputToQuantity(value: string) {
  if (value === "") return "";
  if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(value)) return null;
  const [whole = "", fraction = ""] = value.split(".");
  const wholeNumber = Number(whole || "0");
  if (wholeNumber > 100 || (wholeNumber === 100 && Number(fraction || "0") > 0)) return null;
  return `percent:${whole}${value.includes(".") ? `.${fraction}` : ""}`;
}

export function quantityToPercentInput(value: string) {
  if (value === "") return "";
  if (value.startsWith("percent:")) return value.slice("percent:".length);
  const quantity = Number(value);
  return Number.isFinite(quantity) ? String(quantity * 100) : "";
}

export function persistedOverallDiscountUnitPrice(line: { sectionHeading?: unknown; totalCents?: unknown; unitPriceCents?: unknown }) {
  const cents = overallTradeQuoteDiscountKind(line) === "fixed"
    ? Math.abs(Number(line.totalCents || 0))
    : Number(line.unitPriceCents || 0);
  return (cents / 100).toFixed(2);
}

export function calculateTradeQuoteLine(quantityMilli: number, unitPriceCents: number, taxCode: TradeQuoteLine["taxCode"]) {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 1 || quantityMilli > MAX_QUANTITY_MILLI) throw new Error("INVALID_QUANTITY");
  if (!Number.isSafeInteger(unitPriceCents) || Math.abs(unitPriceCents) > MAX_ABS_CENTS) throw new Error("INVALID_MONEY");
  if (!TAX_CODES.has(taxCode)) throw new Error("INVALID_TAX");
  const subtotalCents = roundRatioHalfAwayFromZero(BigInt(quantityMilli) * BigInt(unitPriceCents), BigInt(1000));
  const taxCents = taxCode === "gst" ? roundRatioHalfAwayFromZero(BigInt(subtotalCents), BigInt(10)) : 0;
  const totalCents = subtotalCents + taxCents;
  if (![subtotalCents, taxCents, totalCents].every(Number.isSafeInteger)) throw new Error("QUOTE_TOTAL_TOO_LARGE");
  return { subtotalCents, taxCents, totalCents };
}

export function normaliseTradeQuoteLineGroup(rawLines: unknown, cleanDescription: (value: unknown) => string, allowEmpty = false) {
  if (!Array.isArray(rawLines) || (!allowEmpty && rawLines.length < 1) || rawLines.length > 100) throw new Error("INVALID_LINES");
  const records = rawLines.map(rawRecord);
  const overallDiscountIndexes = records
    .map((record, index) => overallTradeQuoteDiscountKind(record) ? index : -1)
    .filter((index) => index >= 0);
  if (overallDiscountIndexes.length > 1) throw new Error("INVALID_LINES");

  const parsed = records.map((record, index) => {
    const lineType = String(record.lineType || "") as TradeQuoteLine["lineType"];
    const taxCode = String(record.taxCode || "") as TradeQuoteLine["taxCode"];
    const description = cleanDescription(record.description);
    if (!LINE_TYPES.has(lineType) || !TAX_CODES.has(taxCode) || !description) throw new Error("INVALID_LINES");
    const overallDiscount = overallTradeQuoteDiscountKind(record);
    if (overallDiscount) {
      if (lineType !== "adjustment") throw new Error("INVALID_LINES");
      return { index, record, lineType, taxCode, description, overallDiscount, line: null as TradeQuoteLine | null };
    }
    const quantityMilli = quantityToMilli(record.quantity);
    const unitPriceCents = dollarsToCents(record.unitPrice, lineType === "adjustment");
    if (lineType !== "adjustment" && unitPriceCents < 0) throw new Error("INVALID_MONEY");
    return { index, record, lineType, taxCode, description, overallDiscount, line: { lineType, description, quantityMilli, unitPriceCents, taxCode, ...calculateTradeQuoteLine(quantityMilli, unitPriceCents, taxCode) } };
  });

  const ordinaryLines = parsed.flatMap((entry) => entry.line ? [entry.line] : []);
  const eligibleSubtotalCents = ordinaryLines.reduce((sum, line) => sum + Math.max(0, line.subtotalCents), 0);
  const eligibleTaxCents = ordinaryLines.reduce((sum, line) => line.subtotalCents > 0 ? sum + Math.max(0, line.taxCents) : sum, 0);
  const eligibleTotalCents = eligibleSubtotalCents + eligibleTaxCents;

  const lines = parsed.map((entry) => {
    if (entry.line) return entry.line;
    if (eligibleSubtotalCents <= 0 || eligibleTotalCents <= 0) throw new Error("INVALID_TOTAL");
    const taxCode: TradeQuoteLine["taxCode"] = eligibleTaxCents > 0 ? "gst" : "none";
    if (entry.overallDiscount === "percent") {
      // The persisted quantity is the percentage as a factor: 25% is 0.250.
      // The submitted unit price is deliberately ignored so the server always
      // recalculates the discount from the current positive quote scope.
      const rawQuantity = String(entry.record.quantity || "");
      const quantityMilli = rawQuantity.startsWith("percent:")
        ? Math.round(Number(rawQuantity.slice("percent:".length)) * 10)
        : quantityToMilli(rawQuantity);
      if (!Number.isInteger(quantityMilli) || quantityMilli < 1) throw new Error("INVALID_QUANTITY");
      if (quantityMilli >= 1000) throw new Error("INVALID_TOTAL");
      const subtotalCents = -roundRatioHalfAwayFromZero(BigInt(eligibleSubtotalCents) * BigInt(quantityMilli), BigInt(1000));
      const taxCents = -roundRatioHalfAwayFromZero(BigInt(eligibleTaxCents) * BigInt(quantityMilli), BigInt(1000));
      const totalCents = subtotalCents + taxCents;
      return { lineType: entry.lineType, description: entry.description, quantityMilli,
        unitPriceCents: -eligibleSubtotalCents, taxCode, subtotalCents, taxCents, totalCents };
    }

    // Fixed discounts are entered as the exact customer-facing amount including
    // GST. Allocate the reduction across subtotal and GST in the same proportion
    // as the eligible positive quote scope.
    const discountTotalCents = Math.abs(dollarsToCents(entry.record.unitPrice, true));
    if (discountTotalCents <= 0 || discountTotalCents > eligibleTotalCents) throw new Error("INVALID_TOTAL");
    const subtotalMagnitude = roundRatioHalfAwayFromZero(
      BigInt(discountTotalCents) * BigInt(eligibleSubtotalCents),
      BigInt(eligibleTotalCents),
    );
    const taxMagnitude = discountTotalCents - subtotalMagnitude;
    return { lineType: entry.lineType, description: entry.description, quantityMilli: 1000,
      unitPriceCents: -subtotalMagnitude, taxCode, subtotalCents: -subtotalMagnitude,
      taxCents: -taxMagnitude, totalCents: -discountTotalCents };
  });
  const subtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0);
  const totalCents = subtotalCents + taxCents;
  if (![subtotalCents, taxCents, totalCents].every(Number.isSafeInteger) || (!allowEmpty && totalCents <= 0 && !overallDiscountIndexes.length) || totalCents < 0 || totalCents > MAX_ABS_CENTS) throw new Error("INVALID_TOTAL");
  return { lines, subtotalCents, taxCents, totalCents };
}

export function normaliseTradeQuoteLines(rawLines: unknown, cleanDescription: (value: unknown) => string) {
  return normaliseTradeQuoteLineGroup(rawLines, cleanDescription);
}
