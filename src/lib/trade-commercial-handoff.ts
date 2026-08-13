export type AcceptedScopeLine = {
  lineId: string;
  lineType: "product" | "labour" | "adjustment";
  section: string;
  description: string;
  quantityMilli: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

type QuoteItemRow = Record<string, unknown>;

export type AcceptedScopeTotals = {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

const MAX_MONEY_CENTS = 100_000_000;
const ACCEPTED_LINE_TYPES = new Set<AcceptedScopeLine["lineType"]>([
  "product",
  "labour",
  "adjustment",
]);

function boundedInteger(value: unknown, minimum = 0, maximum = MAX_MONEY_CENTS) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error("INVALID_COMMERCIAL_HANDOFF");
  return number;
}

function signedMoneyInteger(value: unknown) {
  return boundedInteger(value, -MAX_MONEY_CENTS, MAX_MONEY_CENTS);
}

export function acceptedScopeSnapshot(
  items: QuoteItemRow[],
  selectedChoiceIds: string[],
  expectedTotals?: AcceptedScopeTotals,
): AcceptedScopeLine[] {
  const selected = new Set(selectedChoiceIds);
  const lines = items.filter((item) => !String(item.quote_choice_id || "") || selected.has(String(item.quote_choice_id)));
  if (!lines.length || lines.length > 300) throw new Error("INVALID_COMMERCIAL_HANDOFF");
  const scope = lines.map((item) => {
    const lineType = String(item.line_type || "") as AcceptedScopeLine["lineType"];
    if (!ACCEPTED_LINE_TYPES.has(lineType)) throw new Error("INVALID_COMMERCIAL_HANDOFF");
    const moneyInteger = lineType === "adjustment" ? signedMoneyInteger : boundedInteger;
    const subtotalCents = moneyInteger(item.subtotal_cents);
    const taxCents = moneyInteger(item.tax_cents);
    const totalCents = moneyInteger(item.total_cents);
    if (subtotalCents + taxCents !== totalCents) throw new Error("INVALID_COMMERCIAL_HANDOFF");
    return {
      lineId: String(item.id || "").slice(0, 180),
      lineType,
      section: String(item.section_heading || "Included work").replace(/\s+/g, " ").trim().slice(0, 120),
      description: String(item.description || "").replace(/\s+/g, " ").trim().slice(0, 500),
      quantityMilli: boundedInteger(item.quantity_milli, 1, 100_000_000),
      subtotalCents,
      taxCents,
      totalCents,
    };
  });
  if (expectedTotals) {
    const expected = {
      subtotalCents: signedMoneyInteger(expectedTotals.subtotalCents),
      taxCents: signedMoneyInteger(expectedTotals.taxCents),
      totalCents: boundedInteger(expectedTotals.totalCents, 1),
    };
    const actual = scope.reduce<AcceptedScopeTotals>((sum, line) => ({
      subtotalCents: signedMoneyInteger(sum.subtotalCents + line.subtotalCents),
      taxCents: signedMoneyInteger(sum.taxCents + line.taxCents),
      totalCents: signedMoneyInteger(sum.totalCents + line.totalCents),
    }), { subtotalCents: 0, taxCents: 0, totalCents: 0 });
    if (
      expected.subtotalCents + expected.taxCents !== expected.totalCents
      || actual.subtotalCents !== expected.subtotalCents
      || actual.taxCents !== expected.taxCents
      || actual.totalCents !== expected.totalCents
    ) throw new Error("INVALID_COMMERCIAL_HANDOFF");
  }
  return scope;
}

export function depositAmountCents(totalCents: number, kind: "percentage" | "fixed", value: number) {
  const total = boundedInteger(totalCents, 1);
  if (kind === "percentage") {
    const basisPoints = boundedInteger(value, 100, 10_000);
    return Math.max(100, Math.min(total, Math.floor((total * basisPoints + 5_000) / 10_000)));
  }
  return boundedInteger(value, 100, total);
}

export function conciseScopeDescription(scope: AcceptedScopeLine[], fallback: string) {
  const descriptions = scope.map((line) => line.description).filter(Boolean);
  const text = descriptions.slice(0, 4).join("; ");
  return (text || fallback || "Accepted trade services").slice(0, 500);
}
