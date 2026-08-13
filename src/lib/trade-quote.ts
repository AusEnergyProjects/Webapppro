import { normaliseQuoteChoices } from "./trade-quote-options.ts";

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

export type TradeQuoteLineValidationField = "lineType" | "description" | "quantity" | "unitPrice" | "taxCode";

export type TradeQuoteLineValidationIssue = {
  lineIndex: number;
  field: TradeQuoteLineValidationField;
  code: string;
  message: string;
};

export type TradeQuoteChoiceValidationIssue = {
  scopeKey: string;
  field: "name" | "recommended" | "remove" | "addLine";
  code: "INVALID_QUOTE_CHOICES";
  message: string;
};

const LINE_TYPES = new Set<TradeQuoteLine["lineType"]>(["product", "labour", "adjustment"]);
const TAX_CODES = new Set<TradeQuoteLine["taxCode"]>(["gst", "none"]);
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
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

export function moveTradeQuoteLine<T>(lines: readonly T[], fromIndex: number, toIndex: number) {
  const next = [...lines];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
    || fromIndex < 0 || toIndex < 0 || fromIndex >= next.length || toIndex >= next.length
    || fromIndex === toIndex) return next;
  const [line] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, line);
  return next;
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

function quoteLineIssue(
  lineIndex: number,
  field: TradeQuoteLineValidationField,
  code: string,
  reason: string,
  lineLabel: string,
): TradeQuoteLineValidationIssue {
  return { lineIndex, field, code, message: `${lineLabel} ${lineIndex + 1}: ${reason}` };
}

export function tradeQuoteLineValidationIssues(
  rawLines: unknown,
  cleanDescription: (value: unknown) => string,
  allowEmpty = false,
  lineLabel = "Quote item",
): TradeQuoteLineValidationIssue[] {
  if (!Array.isArray(rawLines)) {
    return [quoteLineIssue(0, "description", "INVALID_LINES", "add a quote item.", lineLabel)];
  }
  if (!rawLines.length) {
    return allowEmpty ? [] : [quoteLineIssue(0, "description", "INVALID_LINES", "add a quote item.", lineLabel)];
  }
  if (rawLines.length > 100) {
    return [quoteLineIssue(99, "description", "INVALID_LINES", "remove items so the quote has no more than 100 lines.", lineLabel)];
  }

  const records = rawLines.map((line) => line && typeof line === "object" ? line as Record<string, unknown> : null);
  const issues: TradeQuoteLineValidationIssue[] = [];
  const overallDiscountIndexes: number[] = [];

  records.forEach((record, lineIndex) => {
    if (!record) {
      issues.push(quoteLineIssue(lineIndex, "description", "INVALID_LINES", "add a description.", lineLabel));
      return;
    }
    const lineType = String(record.lineType || "") as TradeQuoteLine["lineType"];
    const taxCode = String(record.taxCode || "") as TradeQuoteLine["taxCode"];
    const description = cleanDescription(record.description);
    const overallDiscount = overallTradeQuoteDiscountKind(record);
    if (overallDiscount) overallDiscountIndexes.push(lineIndex);

    if (!LINE_TYPES.has(lineType)) {
      issues.push(quoteLineIssue(lineIndex, "lineType", "INVALID_LINES", "choose Product, Labour or Adjustment.", lineLabel));
    }
    if (!description) {
      issues.push(quoteLineIssue(lineIndex, "description", "INVALID_LINES", "add a description.", lineLabel));
    }
    if (!TAX_CODES.has(taxCode)) {
      issues.push(quoteLineIssue(lineIndex, "taxCode", "INVALID_TAX", "choose GST 10% or No GST.", lineLabel));
    }
    if (overallDiscount && lineType !== "adjustment") {
      issues.push(quoteLineIssue(lineIndex, "lineType", "INVALID_LINES", "use Adjustment for an overall discount.", lineLabel));
    }

    if (overallDiscount === "percent") {
      const rawQuantity = String(record.quantity || "");
      let validPercentage = false;
      if (rawQuantity.startsWith("percent:")) {
        const percentageInput = rawQuantity.slice("percent:".length);
        validPercentage = percentInputToQuantity(percentageInput) !== null
          && percentageInput !== ""
          && Number(percentageInput) > 0
          && Number(percentageInput) < 100;
      } else {
        try {
          const quantityMilli = quantityToMilli(rawQuantity);
          validPercentage = quantityMilli < 1000;
        } catch {
          validPercentage = false;
        }
      }
      if (!validPercentage) {
        issues.push(quoteLineIssue(lineIndex, "quantity", "INVALID_QUANTITY", "enter a discount greater than 0% and less than 100%.", lineLabel));
      }
      return;
    }

    if (overallDiscount === "fixed") {
      try {
        if (Math.abs(dollarsToCents(record.unitPrice, true)) <= 0) throw new Error("INVALID_MONEY");
      } catch {
        issues.push(quoteLineIssue(lineIndex, "unitPrice", "INVALID_MONEY", "enter a dollar discount greater than $0 with no more than 2 decimal places.", lineLabel));
      }
      return;
    }

    try {
      quantityToMilli(record.quantity);
    } catch {
      issues.push(quoteLineIssue(lineIndex, "quantity", "INVALID_QUANTITY", "enter a quantity greater than 0 with no more than 3 decimal places.", lineLabel));
    }
    try {
      const unitPriceCents = dollarsToCents(record.unitPrice, lineType === "adjustment");
      if (lineType !== "adjustment" && unitPriceCents < 0) throw new Error("INVALID_MONEY");
    } catch {
      issues.push(quoteLineIssue(lineIndex, "unitPrice", "INVALID_MONEY", lineType === "adjustment"
        ? "enter a dollar amount with no more than 2 decimal places."
        : "enter a price of $0 or more with no more than 2 decimal places.", lineLabel));
    }
  });

  if (issues.length) return issues;

  try {
    normaliseTradeQuoteLineGroup(rawLines, cleanDescription, allowEmpty);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_LINES";
    const lineIndex = overallDiscountIndexes.at(-1) ?? Math.max(0, records.length - 1);
    const field: TradeQuoteLineValidationField = overallTradeQuoteDiscountKind(records[lineIndex]) === "percent" ? "quantity" : "unitPrice";
    const reason = overallDiscountIndexes.length
      ? "reduce the discount so it does not exceed the included quote total."
      : code === "QUOTE_TOTAL_TOO_LARGE"
        ? "reduce this amount so the quote can be calculated safely."
        : "change this amount so the quote total is greater than $0.";
    return [quoteLineIssue(lineIndex, field, code, reason, lineLabel)];
  }
  return [];
}

export function tradeQuoteChoiceValidationIssue(
  rawChoices: unknown,
  clean: (value: unknown, maximum?: number) => string,
): TradeQuoteChoiceValidationIssue | null {
  if (!Array.isArray(rawChoices) || rawChoices.length > 20) {
    const record = Array.isArray(rawChoices) && rawChoices[20] && typeof rawChoices[20] === "object"
      ? rawChoices[20] as Record<string, unknown>
      : null;
    return { scopeKey: clean(record?.clientKey, 64), field: "remove", code: "INVALID_QUOTE_CHOICES", message: "Customer choices: remove choices so there are no more than 20." };
  }
  const records = rawChoices.map((value) => value && typeof value === "object" ? value as Record<string, unknown> : null);
  const seenChoiceKeys = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) return { scopeKey: "", field: "remove", code: "INVALID_QUOTE_CHOICES", message: `Customer choice ${index + 1}: remove this invalid choice and add it again.` };
    const clientKey = clean(record.clientKey, 64).toLowerCase();
    const kind = clean(record.kind, 20);
    const groupKey = clean(record.groupKey, 64).toLowerCase() || (kind === "addon" ? clientKey : `${kind}-1`);
    const name = clean(record.name, 120);
    const prefix = name || "Unnamed customer choice";
    if (!name) return { scopeKey: clientKey, field: "name", code: "INVALID_QUOTE_CHOICES", message: "Customer choice: add a clear name." };
    if (!KEY_PATTERN.test(clientKey) || seenChoiceKeys.has(clientKey) || !KEY_PATTERN.test(groupKey) || !["package", "addon", "choose_one"].includes(kind)) {
      return { scopeKey: clientKey, field: "remove", code: "INVALID_QUOTE_CHOICES", message: `${prefix}: remove this invalid choice and add it again.` };
    }
    seenChoiceKeys.add(clientKey);
    const lines = Array.isArray(record.lines) ? record.lines : [];
    if (!lines.length) return { scopeKey: clientKey, field: "addLine", code: "INVALID_QUOTE_CHOICES", message: `${prefix}: add at least one priced line.` };
    if (lines.length > 100) return { scopeKey: clientKey, field: "remove", code: "INVALID_QUOTE_CHOICES", message: `${prefix}: remove lines so this choice has no more than 100 items.` };
  }

  const requiredGroups = new Map<string, Record<string, unknown>[]>();
  for (const record of records as Record<string, unknown>[]) {
    const kind = clean(record.kind, 20);
    if (kind === "addon") continue;
    const groupKey = clean(record.groupKey, 64).toLowerCase() || `${kind}-1`;
    const key = `${kind}:${groupKey}`;
    requiredGroups.set(key, [...(requiredGroups.get(key) || []), record]);
  }
  for (const [key, group] of requiredGroups) {
    const groupLabel = key.startsWith("package:") ? "package" : "choose-one group";
    if (group.length < 2) {
      const record = group[0];
      const name = clean(record.name, 120);
      return { scopeKey: clean(record.clientKey, 64).toLowerCase(), field: "remove", code: "INVALID_QUOTE_CHOICES", message: `${name}: this ${groupLabel} needs at least 2 choices. Remove it or create the complete group again.` };
    }
    if (key.startsWith("package:") && group.length > 3) {
      const record = group[3];
      const name = clean(record.name, 120);
      return { scopeKey: clean(record.clientKey, 64).toLowerCase(), field: "remove", code: "INVALID_QUOTE_CHOICES", message: `${name}: a package group can contain no more than 3 choices. Remove this extra choice.` };
    }
    const recommended = group.filter((record) => record.recommended === true);
    if (recommended.length > 1) {
      const record = recommended[1];
      const name = clean(record.name, 120);
      return { scopeKey: clean(record.clientKey, 64).toLowerCase(), field: "recommended", code: "INVALID_QUOTE_CHOICES", message: `${name}: only one choice in this group can be recommended.` };
    }
  }
  try {
    normaliseQuoteChoices(rawChoices, clean);
  } catch {
    const record = records[0];
    return record ? { scopeKey: clean(record.clientKey, 64).toLowerCase(), field: "remove", code: "INVALID_QUOTE_CHOICES", message: `${clean(record.name, 120) || "Customer choice"}: remove this invalid choice and add it again.` } : null;
  }
  return null;
}

export function normaliseTradeQuoteLineGroup(rawLines: unknown, cleanDescription: (value: unknown) => string, allowEmpty = false) {
  if (!Array.isArray(rawLines) || (!allowEmpty && rawLines.length < 1) || rawLines.length > 100) throw new Error("INVALID_LINES");
  const records = rawLines.map(rawRecord);
  const overallDiscountIndexes = records
    .map((record, index) => overallTradeQuoteDiscountKind(record) ? index : -1)
    .filter((index) => index >= 0);

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
  const overallDiscountTotalCents = parsed.reduce((sum, entry, index) => (
    entry.overallDiscount ? sum + Math.max(0, -lines[index].totalCents) : sum
  ), 0);
  if (!Number.isSafeInteger(overallDiscountTotalCents) || overallDiscountTotalCents > eligibleTotalCents) {
    throw new Error("INVALID_TOTAL");
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0);
  const totalCents = subtotalCents + taxCents;
  if (![subtotalCents, taxCents, totalCents].every(Number.isSafeInteger) || (!allowEmpty && totalCents <= 0 && !overallDiscountIndexes.length) || totalCents < 0 || totalCents > MAX_ABS_CENTS) throw new Error("INVALID_TOTAL");
  return { lines, subtotalCents, taxCents, totalCents };
}

export function normaliseTradeQuoteLines(rawLines: unknown, cleanDescription: (value: unknown) => string) {
  return normaliseTradeQuoteLineGroup(rawLines, cleanDescription);
}
