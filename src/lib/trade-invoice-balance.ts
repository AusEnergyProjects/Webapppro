export type InvoiceBalance = {
  originalCents: number;
  creditedCents: number;
  netCents: number;
  paidCents: number;
  outstandingCents: number;
};

function cents(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10_000_000_000) throw new Error("INVALID_INVOICE_BALANCE");
  return value;
}

export function invoiceBalance(input: { totalCents: number; creditedCents: number; paidCents: number }): InvoiceBalance {
  const originalCents = cents(input.totalCents);
  const creditedCents = cents(input.creditedCents);
  const paidCents = cents(input.paidCents);
  if (creditedCents > originalCents || paidCents > originalCents - creditedCents) throw new Error("INVOICE_BALANCE_EXCEEDED");
  const netCents = originalCents - creditedCents;
  return { originalCents, creditedCents, netCents, paidCents, outstandingCents: netCents - paidCents };
}

export function creditTotals(subtotalCents: number, taxCode: "gst" | "none") {
  const subtotal = cents(subtotalCents);
  if (subtotal < 1 || !["gst", "none"].includes(taxCode)) throw new Error("INVALID_INVOICE_CREDIT");
  const taxCents = taxCode === "gst" ? Math.round(subtotal / 10) : 0;
  return { subtotalCents: subtotal, taxCents, totalCents: subtotal + taxCents };
}
