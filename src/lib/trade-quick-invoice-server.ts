import { getD1 } from "../../db";
import { sendServiceReminderProviderMessage, serviceReminderProviderConfiguration } from "@/lib/service-reminder-delivery";
import { quickInvoiceTotals, type QuickInvoiceDraft, type QuickInvoiceLine } from "@/lib/trade-quick-invoice";

export type { QuickInvoiceDraft } from "@/lib/trade-quick-invoice";

type Row = Record<string, unknown>;

function clean(value: unknown, limit: number) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function rawLines(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch { throw new Error("INVALID_QUICK_INVOICE"); }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 8) throw new Error("INVALID_QUICK_INVOICE");
  return parsed as Row[];
}

export async function resolveQuickInvoiceDraft(ownerUid: string, value: unknown): Promise<QuickInvoiceDraft> {
  const input = rawLines(value);
  const ids = [...new Set(input.map((line) => clean(line.priceBookItemId, 180)).filter(Boolean))];
  const rows = ids.length
    ? await getD1().prepare(`SELECT id, name, sell_price_cents_ex_gst, tax_code, price_revision
        FROM trade_price_book_items WHERE firebase_uid = ? AND record_status = 'active'
          AND id IN (${ids.map(() => "?").join(",")})`).bind(ownerUid, ...ids).all<Row>()
    : { results: [] as Row[] };
  const byId = new Map(rows.results.map((row) => [String(row.id), row]));
  if (byId.size !== ids.length) throw new Error("PRICE_BOOK_ITEM_UNAVAILABLE");

  const lines = input.map((raw, index): QuickInvoiceLine => {
    const priceBookItemId = clean(raw.priceBookItemId, 180);
    const reference = priceBookItemId ? byId.get(priceBookItemId) : undefined;
    const description = reference ? clean(reference.name, 180) : clean(raw.description, 180);
    const unitPriceCentsExGst = reference ? Number(reference.sell_price_cents_ex_gst) : Number(raw.unitPriceCentsExGst);
    const taxCode = (reference ? String(reference.tax_code) : clean(raw.taxCode, 20)) as "gst" | "none";
    if (!description || !Number.isInteger(unitPriceCentsExGst) || Math.abs(unitPriceCentsExGst) > 10_000_000
      || !["gst", "none"].includes(taxCode) || (!reference && unitPriceCentsExGst <= 0)) throw new Error("INVALID_QUICK_INVOICE");
    const taxCents = taxCode === "gst" ? Math.round(unitPriceCentsExGst / 10) : 0;
    return {
      lineId: `line-${index + 1}`,
      priceBookItemId,
      priceRevision: reference ? Number(reference.price_revision || 1) : 0,
      description,
      quantity: 1,
      unitPriceCentsExGst,
      taxCode,
      subtotalCents: unitPriceCentsExGst,
      taxCents,
      totalCents: unitPriceCentsExGst + taxCents,
    };
  });
  const totals = quickInvoiceTotals(lines);
  if (totals.totalCents <= 0 || totals.totalCents > 100_000_000) throw new Error("INVALID_QUICK_INVOICE");
  return { lines, ...totals };
}

export function quickInvoiceNumber(workNumber: string) {
  return `INV-${clean(workNumber, 40)}`;
}

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}

function deliveryBody(row: Row, lines: QuickInvoiceLine[]) {
  const address = [row.address_line_1, row.suburb, row.address_state, row.postcode].map((part) => clean(part, 140)).filter(Boolean).join(", ");
  const lineText = lines.map((line) => `${line.description}: ${money(line.subtotalCents)}${line.taxCode === "gst" ? " plus GST" : " GST-free"}`).join("\n");
  return [
    `Invoice ${row.invoice_number}`,
    clean(row.business_name, 180),
    row.abn ? `ABN ${clean(row.abn, 20)}` : "",
    address,
    "",
    `Customer: ${clean(row.customer_name, 180)}`,
    `Job: ${clean(row.work_number, 40)} | ${clean(row.title, 180)}`,
    "",
    lineText,
    "",
    `Subtotal: ${money(Number(row.subtotal_cents))}`,
    `GST: ${money(Number(row.tax_cents))}`,
    `Total due: ${money(Number(row.total_cents))}`,
    `Due date: ${clean(row.due_at, 20)}`,
    "",
    "Please contact the trade business directly if you have a question about this invoice or need payment instructions.",
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n");
}

export async function sendQuickInvoiceDelivery(input: { invoiceId: string; ownerUid: string; actorUid: string; origin: string }) {
  const db = getD1();
  const row = await db.prepare(`SELECT q.*, w.work_number, w.title,
      a.business_name, a.abn, a.address_line_1, a.suburb, a.address_state, a.postcode,
      c.email customer_email,
      CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name
    FROM trade_crm_quick_invoices q
    JOIN trade_work_orders w ON w.id = q.work_order_id AND w.firebase_uid = q.firebase_uid
    JOIN trade_accounts a ON a.firebase_uid = q.firebase_uid
    JOIN trade_crm_customers c ON c.id = q.crm_customer_id AND c.firebase_uid = q.firebase_uid AND c.record_status = 'active'
    WHERE q.id = ? AND q.firebase_uid = ?`).bind(input.invoiceId, input.ownerUid).first<Row>();
  if (!row) throw new Error("QUICK_INVOICE_NOT_FOUND");
  if (row.delivery_status === "sent") return { ok: true, duplicate: true, providerMessageId: String(row.provider_message_id || "") };
  const recipient = clean(row.customer_email, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("QUICK_INVOICE_RECIPIENT_INVALID");
  if (!serviceReminderProviderConfiguration().email.configured) throw new Error("waiting_for_channel");
  let lines: QuickInvoiceLine[];
  try { lines = JSON.parse(String(row.line_items_json || "[]")) as QuickInvoiceLine[]; }
  catch { throw new Error("INVALID_QUICK_INVOICE"); }
  const now = new Date().toISOString();
  try {
    const result = await sendServiceReminderProviderMessage({
      channel: "email",
      recipient,
      subject: `${clean(row.invoice_number, 60)} from ${clean(row.business_name, 180)}`,
      body: deliveryBody(row, lines),
      idempotencyKey: `quick-invoice:${input.invoiceId}`,
      callbackUrl: `${input.origin}/api/trade-quick-invoices/provider-callback`,
      messageType: "quick_invoice",
    });
    await db.batch([
      db.prepare(`UPDATE trade_crm_quick_invoices SET status = 'issued', delivery_status = 'sent', delivery_provider = ?,
        provider_message_id = ?, attempts = attempts + 1, last_error = '', sent_at = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ?`).bind(result.provider, result.providerMessageId, now, now, input.invoiceId, input.ownerUid),
      db.prepare(`UPDATE trade_crm_job_details SET invoice_status = 'issued', invoiced_value_cents = ?, payment_due_at = ?, updated_at = ?
        WHERE work_order_id = ? AND firebase_uid = ?`).bind(row.total_cents, row.due_at, now, row.work_order_id, input.ownerUid),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'quick_invoice_sent', ?, ?)`).bind(crypto.randomUUID(), row.work_order_id, input.ownerUid,
          `${row.invoice_number} sent by ${input.actorUid === input.ownerUid ? "the business owner" : "a team member"}.`, now),
    ]);
    return { ok: true, duplicate: false, providerMessageId: result.providerMessageId };
  } catch {
    await db.prepare(`UPDATE trade_crm_quick_invoices SET delivery_status = 'failed', attempts = attempts + 1,
      last_error = 'PROVIDER_SEND_FAILED', updated_at = ? WHERE id = ? AND firebase_uid = ?`)
      .bind(now, input.invoiceId, input.ownerUid).run();
    throw new Error("QUICK_INVOICE_DELIVERY_FAILED");
  }
}
