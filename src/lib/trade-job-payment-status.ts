import { TRADE_JOB_LIFECYCLE_LABELS, TRADE_JOB_LIFECYCLE_STATUSES } from "./trade-job-lifecycle.ts";

type InvoicePaymentInput = {
  invoiceStatus: string;
  invoicedValueCents: number;
  paidValueCents: number;
};

type InvoicePaymentStatus = {
  label: string;
  tone: "paid" | "pending" | "muted";
  status: string;
};

type CustomerBillingInput = InvoicePaymentInput & {
  quoteStatus: string;
  quotedValueCents: number;
};

export function jobInvoicePaymentStatus(input: InvoicePaymentInput): InvoicePaymentStatus | null {
  const status = input.invoiceStatus;
  if (status === "restricted") return null;
  // Explicit status remains authoritative when the amount summary is older.
  if (status === "paid") return { label: "Invoice paid", tone: "paid", status };
  if (status === "void") return { label: "Invoice void", tone: "muted", status };
  if (status === "credited") return { label: "Invoice credited", tone: "muted", status };
  if (status === "draft") return { label: "Invoice draft", tone: "muted", status };
  if (status === "not_started") return { label: "Not invoiced", tone: "muted", status };

  const { invoicedValueCents: invoiced, paidValueCents: paid } = input;
  if (!["issued", "part_paid", "overdue"].includes(status)
    || !Number.isSafeInteger(invoiced) || invoiced < 0
    || !Number.isSafeInteger(paid) || paid < 0) {
    return { label: "Invoice status unavailable", tone: "muted", status: "unavailable" };
  }
  if (invoiced > 0 && paid >= invoiced) return { label: "Invoice paid", tone: "paid", status: "paid" };
  if (status === "overdue") return { label: "Invoice overdue", tone: "pending", status };
  if (status === "part_paid" || (invoiced > 0 && paid > 0)) {
    return { label: "Invoice part paid", tone: "pending", status: "part_paid" };
  }
  return { label: "Invoice unpaid", tone: "pending", status: "issued" };
}

export function jobCustomerBillingStatus(input: CustomerBillingInput): string | null {
  const payment = jobInvoicePaymentStatus(input);
  if (!payment) return null;
  if (payment.status === "paid") return "Paid";
  if (["issued", "part_paid", "overdue"].includes(input.invoiceStatus)) return "Invoiced";
  if (!["not_started", "draft", "void", "credited"].includes(input.invoiceStatus)) return "-";
  if (input.quoteStatus === "restricted") return null;
  if (["issued", "sent", "accepted", "declined"].includes(input.quoteStatus)) return "Quoted";
  // Drafts also set quotedValueCents; a positive amount does not prove issue.
  if (["not_started", "draft"].includes(input.quoteStatus)) return "Unquoted";
  return "-";
}

export function jobInvoiceSettlementStatus(input: InvoicePaymentInput): string | null {
  const payment = jobInvoicePaymentStatus(input);
  if (!payment) return null;
  if (payment.status === "paid") return "Paid";
  if (["issued", "part_paid", "overdue"].includes(payment.status)) return "Unpaid";
  return "-";
}

export function jobProgressStatusLabel(status: string): string {
  if (status === "paid") return "Rebate paid";
  if (status === "submitted") return "Submitted / rebate pending";
  const known = TRADE_JOB_LIFECYCLE_STATUSES.find(value => value === status);
  return known ? TRADE_JOB_LIFECYCLE_LABELS[known]
    : status.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}
