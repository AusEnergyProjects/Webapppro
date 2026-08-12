type QuoteLine = { subtotalCents?: number; unitPriceCents?: number };
type PriceReference = { itemType?: string } | null | undefined;

export function quoteInputAppliesDiscount(
  groups: Array<{ calculated: { lines: QuoteLine[] }; priceReferences: PriceReference[] }>,
) {
  return groups.some((group) => group.calculated.lines.some((line, index) =>
    Number(line.unitPriceCents || 0) < 0
    || Number(line.subtotalCents || 0) < 0
    || ["discount", "rebate"].includes(String(group.priceReferences[index]?.itemType || "")),
  ));
}

export function quoteInputDiscountMagnitude(
  groups: Array<{ calculated: { lines: QuoteLine[] }; priceReferences: PriceReference[] }>,
) {
  return groups.reduce((total, group) => total + group.calculated.lines.reduce((sum, line, index) => {
    const amount = Math.abs(Math.min(0, Number(line.subtotalCents || 0)));
    const priceType = String(group.priceReferences[index]?.itemType || "");
    return sum + (amount || (["discount", "rebate"].includes(priceType)
      ? Math.abs(Number(line.subtotalCents || 0)) : 0));
  }, 0), 0);
}

export function invoiceInputAppliesDiscount(discountCents: unknown) {
  const value = Number(discountCents || 0);
  return Number.isFinite(value) && value > 0;
}

export function lowersAuthoritativeTotal(nextTotalCents: number, currentTotalCents: unknown) {
  const current = Number(currentTotalCents || 0);
  return current > 0 && nextTotalCents < current;
}
