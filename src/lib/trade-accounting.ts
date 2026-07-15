export type AccountingProvider = "xero" | "myob";

export function isAccountingProvider(value: string): value is AccountingProvider {
  return value === "xero" || value === "myob";
}
export function accountingReference(workNumber: string, maximumLength: number) {
  const cleaned = `AEA-${workNumber}`.toUpperCase().replace(/[^A-Z0-9-]/g, "-").replace(/-+/g, "-");
  return cleaned.slice(0, maximumLength).replace(/-$/g, "") || "AEA-INVOICE";
}

export function accountingContactReference(customerNumber: string, maximumLength: number) {
  const cleaned = `AEA${customerNumber}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, maximumLength) || "AEACUSTOMER";
}

export function centsFromProvider(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

export function accountingStatus(
  provider: AccountingProvider,
  providerStatus: string,
  amountCents: number,
  paidAmountCents: number,
  dueAt: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const status = providerStatus.trim().toUpperCase();
  if (provider === "xero") {
    if (status === "VOIDED" || status === "DELETED") return "void";
    if (status === "PAID" || (amountCents > 0 && paidAmountCents >= amountCents)) return "paid";
    if (paidAmountCents > 0) return "part_paid";
    if (status === "DRAFT" || status === "SUBMITTED") return "draft";
    if (status === "AUTHORISED" && dueAt && dueAt < today) return "overdue";
    if (status === "AUTHORISED") return "issued";
    return "draft";
  }
  if (status === "CREDIT") return "void";
  if (status === "CLOSED" || (amountCents > 0 && paidAmountCents >= amountCents)) return "paid";
  if (paidAmountCents > 0) return "part_paid";
  if (status === "OPEN" && dueAt && dueAt < today) return "overdue";
  if (status === "OPEN") return "issued";
  return "draft";
}

export function accountingProviderUrl(provider: AccountingProvider, externalDocumentId = "") {
  if (provider === "xero") {
    return externalDocumentId
      ? `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(externalDocumentId)}`
      : "https://go.xero.com/AccountsReceivable/Search.aspx";
  }
  return "https://app.myob.com/";
}
