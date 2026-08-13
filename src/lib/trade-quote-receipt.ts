export function isPayableQuoteDecisionInvoice(
  invoice: { status?: unknown } | null | undefined,
) {
  return invoice?.status === "issued";
}
