type InvoiceRegisterRow = Record<string, unknown>;

export const TRADE_INVOICE_REGISTER_HANDOFF_JOIN_SQL = `LEFT JOIN trade_crm_commercial_handovers h
  ON h.id = COALESCE(
    (SELECT accepted.commercial_handoff_id
      FROM trade_crm_accepted_invoices accepted
      WHERE accepted.work_order_id = w.id
        AND accepted.firebase_uid = w.firebase_uid
        AND accepted.crm_customer_id = d.crm_customer_id
      ORDER BY datetime(accepted.created_at) DESC, accepted.id DESC
      LIMIT 1),
    (SELECT handoff.id
      FROM trade_crm_commercial_handovers handoff
      WHERE handoff.work_order_id = w.id
        AND handoff.firebase_uid = w.firebase_uid
        AND handoff.crm_customer_id = d.crm_customer_id
      ORDER BY datetime(handoff.accepted_at) DESC, handoff.id DESC
      LIMIT 1)
  )
  AND h.work_order_id = w.id
  AND h.firebase_uid = w.firebase_uid
  AND h.crm_customer_id = d.crm_customer_id`;

const cents = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : 0;
};

export function projectTradeInvoiceRegisterFinance(row: InvoiceRegisterRow) {
  const quickInvoice = Boolean(row.quick_invoice_number);
  const accountingInvoice = Boolean(row.accounting_document_id);
  const acceptedIssued = Boolean(row.accepted_invoice_number)
    && row.accepted_invoice_status === "issued";
  const acceptedConflict = row.accepted_invoice_status === "attention_required";

  const totalCents = quickInvoice
    ? Math.max(0, cents(row.quick_total_cents) - cents(row.quick_credited_cents))
    : accountingInvoice
      ? cents(row.accounting_amount_cents)
      : acceptedIssued
        ? cents(row.accepted_invoice_total_cents)
        : acceptedConflict
          ? cents(row.invoiced_value_cents)
          : cents(row.accepted_total_cents || row.invoiced_value_cents);
  const paidCents = quickInvoice
    ? 0
    : accountingInvoice
      ? cents(row.accounting_paid_amount_cents)
      : cents(row.paid_value_cents);
  const accountingStatus = String(row.accounting_status || "");
  const quickDeliveryStatus = String(row.quick_delivery_status || "");
  const status = accountingStatus === "error" || quickDeliveryStatus === "failed" || acceptedConflict
    ? "attention"
    : paidCents >= totalCents && totalCents > 0
      ? "paid"
      : row.quick_invoice_status === "part_credited"
        ? "part_credited"
        : row.quick_invoice_status === "credited"
          ? "credited"
          : accountingInvoice && accountingStatus
            ? accountingStatus
            : acceptedIssued
              ? "issued"
              : totalCents > 0
                ? "ready"
                : "not_ready";

  return {
    totalCents,
    paidCents,
    outstandingCents: Math.max(0, totalCents - paidCents),
    status,
    provider: quickInvoice
      ? "tlink"
      : accountingInvoice
        ? String(row.provider || "")
        : acceptedIssued
          ? "tlink"
          : "",
    externalNumber: quickInvoice
      ? String(row.quick_invoice_number || "")
      : accountingInvoice
        ? String(row.external_number || "")
        : acceptedIssued
          ? String(row.accepted_invoice_number || "")
          : "",
    externalUrl: accountingInvoice ? String(row.external_url || "") : "",
    dueAt: quickInvoice
      ? String(row.quick_due_at || "")
      : accountingInvoice
        ? String(row.accounting_due_at || "")
        : acceptedIssued
          ? String(row.accepted_invoice_due_at || "")
          : acceptedConflict
            ? String(row.payment_due_at || "")
            : "",
    lastError: String(row.quick_last_error || (acceptedConflict ? row.accepted_invoice_blocker_code : "") || row.last_error || ""),
    acceptedAt: String(row.quick_sent_at || (accountingInvoice ? row.accounting_created_at : "") || row.accepted_invoice_created_at || row.accepted_at || ""),
  };
}
