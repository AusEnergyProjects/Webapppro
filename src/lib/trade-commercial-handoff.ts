export type AcceptedScopeLine = {
  lineId: string;
  section: string;
  description: string;
  quantityMilli: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

type QuoteItemRow = Record<string, unknown>;

const MAX_MONEY_CENTS = 100_000_000;

function boundedInteger(value: unknown, minimum = 0, maximum = MAX_MONEY_CENTS) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error("INVALID_COMMERCIAL_HANDOFF");
  return number;
}

export function acceptedScopeSnapshot(items: QuoteItemRow[], selectedChoiceIds: string[]): AcceptedScopeLine[] {
  const selected = new Set(selectedChoiceIds);
  const lines = items.filter((item) => !String(item.quote_choice_id || "") || selected.has(String(item.quote_choice_id)));
  if (!lines.length || lines.length > 300) throw new Error("INVALID_COMMERCIAL_HANDOFF");
  return lines.map((item) => ({
    lineId: String(item.id || "").slice(0, 180),
    section: String(item.section_heading || "Included work").replace(/\s+/g, " ").trim().slice(0, 120),
    description: String(item.description || "").replace(/\s+/g, " ").trim().slice(0, 500),
    quantityMilli: boundedInteger(item.quantity_milli, 1, 100_000_000),
    subtotalCents: boundedInteger(item.subtotal_cents),
    taxCents: boundedInteger(item.tax_cents),
    totalCents: boundedInteger(item.total_cents),
  }));
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
