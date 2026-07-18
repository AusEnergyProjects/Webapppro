export const ACCOUNTING_ADAPTERS = ["xero", "myob", "quickbooks"] as const;
export const PAYMENT_ADAPTERS = ["stripe", "square"] as const;
export type AccountingAdapter = typeof ACCOUNTING_ADAPTERS[number];
export type PaymentAdapter = typeof PAYMENT_ADAPTERS[number];

export function quoteCommercialReference(quoteNumber: string, versionNumber: number) {
  const base = String(quoteNumber || "QUOTE").toUpperCase().replace(/[^A-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${base || "QUOTE"}-V${Math.max(1, Math.trunc(versionNumber || 1))}`.slice(0, 80);
}

export function providerNeutralCommercialRecord(input: { quoteNumber: string; versionNumber: number; subtotalCents: number; taxCents: number; totalCents: number; selectedChoiceIds: string[] }) {
  return {
    reference: quoteCommercialReference(input.quoteNumber, input.versionNumber), currency: "AUD" as const,
    subtotalCents: Math.trunc(input.subtotalCents), taxCents: Math.trunc(input.taxCents), totalCents: Math.trunc(input.totalCents),
    selectedChoiceIds: [...input.selectedChoiceIds], accountingAdapters: [...ACCOUNTING_ADAPTERS], paymentAdapters: [...PAYMENT_ADAPTERS],
  };
}
