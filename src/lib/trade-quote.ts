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

export function normaliseTradeQuoteLines(rawLines: unknown, cleanDescription: (value: unknown) => string) {
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 100) throw new Error("INVALID_LINES");
  const lines = rawLines.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("INVALID_LINES");
    const record = raw as Record<string, unknown>;
    const lineType = String(record.lineType || "") as TradeQuoteLine["lineType"];
    const taxCode = String(record.taxCode || "") as TradeQuoteLine["taxCode"];
    const description = cleanDescription(record.description);
    if (!LINE_TYPES.has(lineType) || !TAX_CODES.has(taxCode) || !description) throw new Error("INVALID_LINES");
    const quantityMilli = quantityToMilli(record.quantity);
    const unitPriceCents = dollarsToCents(record.unitPrice, lineType === "adjustment");
    if (lineType !== "adjustment" && unitPriceCents < 0) throw new Error("INVALID_MONEY");
    return { lineType, description, quantityMilli, unitPriceCents, taxCode, ...calculateTradeQuoteLine(quantityMilli, unitPriceCents, taxCode) };
  });
  const subtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0);
  const totalCents = subtotalCents + taxCents;
  if (![subtotalCents, taxCents, totalCents].every(Number.isSafeInteger) || totalCents <= 0 || totalCents > MAX_ABS_CENTS) throw new Error("INVALID_TOTAL");
  return { lines, subtotalCents, taxCents, totalCents };
}
