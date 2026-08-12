import { getD1 } from "../../db";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
} from "@/lib/service-reminder-delivery";
import {
  normaliseQuickInvoiceDocumentSnapshot,
  quickInvoiceTotals,
  type QuickInvoiceBrandAssetSnapshot,
  type QuickInvoiceDocumentSnapshot,
  type QuickInvoiceDraft,
  type QuickInvoiceLine,
} from "@/lib/trade-quick-invoice";
import {
  renderTradeQuickInvoicePdf,
  tradeQuickInvoicePdfBase64,
  tradeQuickInvoicePdfFilename,
} from "@/lib/trade-quick-invoice-pdf-server";
import {
  readImmutableIssuedPdf,
  storeImmutableIssuedPdf,
} from "@/lib/trade-issued-document-store";

export type { QuickInvoiceDraft } from "@/lib/trade-quick-invoice";

type Row = Record<string, unknown>;

function clean(value: unknown, limit: number, multiline = false) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-");
  return (multiline
    ? text
        .split("\n")
        .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
    : text.replace(/\s+/g, " ").trim()
  ).slice(0, limit);
}

function rawLines(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("INVALID_QUICK_INVOICE");
    }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 8) {
    throw new Error("INVALID_QUICK_INVOICE");
  }
  return parsed as Row[];
}

function boundedDiscount(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
    throw new Error("INVALID_QUICK_INVOICE");
  }
  return amount;
}

export async function resolveQuickInvoiceDraft(
  ownerUid: string,
  value: unknown,
  discountValue: unknown = 0,
  allowPriceBook = true,
): Promise<QuickInvoiceDraft> {
  const input = rawLines(value);
  const ids = [
    ...new Set(
      input
        .map((line) => clean(line.priceBookItemId, 180))
        .filter(Boolean),
    ),
  ];
  if (ids.length && !allowPriceBook) throw new Error("PRICE_BOOK_VIEW_REQUIRED");
  const rows = ids.length
    ? await getD1()
        .prepare(
          `SELECT id, name, sell_price_cents_ex_gst, tax_code, price_revision
          FROM trade_price_book_items WHERE firebase_uid = ? AND record_status = 'active'
            AND id IN (${ids.map(() => "?").join(",")})`,
        )
        .bind(ownerUid, ...ids)
        .all<Row>()
    : { results: [] as Row[] };
  const byId = new Map(rows.results.map((row) => [String(row.id), row]));
  if (byId.size !== ids.length) throw new Error("PRICE_BOOK_ITEM_UNAVAILABLE");

  const lines = input.map((raw, index): QuickInvoiceLine => {
    const priceBookItemId = clean(raw.priceBookItemId, 180);
    const reference = priceBookItemId ? byId.get(priceBookItemId) : undefined;
    const description = reference
      ? clean(reference.name, 180)
      : clean(raw.description, 180);
    const unitPriceCentsExGst = reference
      ? Number(reference.sell_price_cents_ex_gst)
      : Number(raw.unitPriceCentsExGst);
    const taxCode = (reference
      ? String(reference.tax_code)
      : clean(raw.taxCode, 20)) as "gst" | "none";
    if (
      !description ||
      !Number.isInteger(unitPriceCentsExGst) ||
      Math.abs(unitPriceCentsExGst) > 10_000_000 ||
      !["gst", "none"].includes(taxCode) ||
      (!reference && unitPriceCentsExGst <= 0)
    ) {
      throw new Error("INVALID_QUICK_INVOICE");
    }
    const taxCents =
      taxCode === "gst" ? Math.round(unitPriceCentsExGst / 10) : 0;
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
  const discountCents = boundedDiscount(discountValue);
  let totals;
  try {
    totals = quickInvoiceTotals(lines, discountCents);
  } catch {
    throw new Error("INVALID_QUICK_INVOICE");
  }
  if (totals.totalCents <= 0 || totals.totalCents > 100_000_000) {
    throw new Error("INVALID_QUICK_INVOICE");
  }
  return {
    lines,
    subtotalCents: totals.subtotalCents,
    discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
  };
}

export function quickInvoiceNumber(workNumber: string) {
  return `INV-${clean(workNumber, 40)}`;
}

export const QUICK_INVOICE_SEND_LOCK_SQL = `UPDATE trade_crm_quick_invoices
  SET delivery_status = 'sending',
    last_error = '',
    updated_at = ?
  WHERE id = ? AND firebase_uid = ?
    AND status = 'draft'
    AND revision = ?
    AND (
      delivery_status IN ('queued', 'failed')
      OR (
        delivery_status = 'sending'
        AND updated_at < ?
        AND provider_message_id = ''
      )
    )`;

export const QUICK_INVOICE_SUCCESS_UPDATE_SQL = `UPDATE trade_crm_quick_invoices
  SET status = 'issued',
    delivery_status = 'provider_accepted',
    delivery_provider = ?,
    provider_message_id = ?,
    issued_pdf_object_key = ?,
    issued_pdf_sha256 = ?,
    issued_pdf_size_bytes = ?,
    consent_confirmed_at = CASE
      WHEN consent_confirmed_at = '' THEN ?
      ELSE consent_confirmed_at
    END,
    attempts = attempts + 1,
    last_error = '',
    sent_at = ?,
    updated_at = ?
  WHERE id = ? AND firebase_uid = ?
    AND status = 'draft'
    AND revision = ?
    AND delivery_status = 'sending'
    AND document_snapshot_json = ?`;

export const QUICK_INVOICE_PROVIDER_ACCEPTED_RECOVERY_SQL = `UPDATE trade_crm_quick_invoices
  SET status = 'issued',
    delivery_status = 'provider_accepted',
    delivery_provider = ?,
    provider_message_id = ?,
    issued_pdf_object_key = ?,
    issued_pdf_sha256 = ?,
    issued_pdf_size_bytes = ?,
    consent_confirmed_at = CASE
      WHEN consent_confirmed_at = '' THEN ?
      ELSE consent_confirmed_at
    END,
    attempts = attempts + 1,
    last_error = '',
    sent_at = ?,
    updated_at = ?
  WHERE id = ? AND firebase_uid = ?
    AND status = 'draft'
    AND revision = ?
    AND document_snapshot_json = ?`;

export const QUICK_INVOICE_PROVIDER_ACCEPTED_CONFLICT_SQL = `UPDATE trade_crm_quick_invoices
  SET delivery_status = 'reconciliation_required',
    delivery_provider = ?,
    provider_message_id = ?,
    attempts = attempts + 1,
    last_error = 'PROVIDER_ACCEPTED_RECONCILIATION_REQUIRED',
    updated_at = ?
  WHERE id = ? AND firebase_uid = ? AND status = 'draft'
    AND delivery_status != 'reconciliation_required'`;

export const QUICK_INVOICE_PROVIDER_EVENT_UPDATE_SQL = `UPDATE trade_crm_quick_invoices
  SET delivery_status = CASE
      WHEN delivery_status IN ('bounced', 'opted_out') THEN delivery_status
      WHEN delivery_status = 'reconciliation_required' THEN delivery_status
      WHEN ? IN ('bounced', 'opted_out') THEN ?
      WHEN delivery_status = 'delivered' THEN delivery_status
      WHEN delivery_status = 'failed' THEN delivery_status
      WHEN ? = 'delivered' THEN 'delivered'
      WHEN ? = 'failed' THEN 'failed'
      WHEN ? = 'sent' AND delivery_status IN ('provider_accepted', 'sent') THEN 'sent'
      ELSE delivery_status
    END,
    last_error = CASE
      WHEN delivery_status IN ('bounced', 'opted_out') THEN last_error
      WHEN delivery_status = 'reconciliation_required' THEN last_error
      WHEN ? IN ('bounced', 'opted_out') THEN ?
      WHEN delivery_status IN ('delivered', 'failed') THEN last_error
      WHEN ? = 'failed' THEN ?
      WHEN ? IN ('sent', 'delivered') THEN ''
      ELSE last_error
    END,
    updated_at = ?
  WHERE id = ? AND firebase_uid = ?
    AND delivery_provider = 'resend' AND provider_message_id = ?`;

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function validEmail(value: unknown) {
  const email = clean(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function imageAsset(
  objectKey: unknown,
  contentType: unknown,
): QuickInvoiceBrandAssetSnapshot | null {
  const key = clean(objectKey, 1_000);
  const type = clean(contentType, 100).toLowerCase();
  return key && (type === "image/png" || type === "image/jpeg")
    ? { objectKey: key, contentType: type }
    : null;
}

function integerWithin(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function bannerCrop(row: Row) {
  const xBasisPoints = integerWithin(
    row.banner_crop_x_basis_points,
    0,
    0,
    9_999,
  );
  const yBasisPoints = integerWithin(
    row.banner_crop_y_basis_points,
    0,
    0,
    9_999,
  );
  return {
    xBasisPoints,
    yBasisPoints,
    widthBasisPoints: Math.min(
      integerWithin(row.banner_crop_width_basis_points, 10_000, 1, 10_000),
      10_000 - xBasisPoints,
    ),
    heightBasisPoints: Math.min(
      integerWithin(row.banner_crop_height_basis_points, 10_000, 1, 10_000),
      10_000 - yBasisPoints,
    ),
  };
}

async function invoiceDocumentRow(ownerUid: string, invoiceId: string) {
  return getD1()
    .prepare(
      `SELECT q.*, work.work_number, work.title work_title,
        COALESCE((
          SELECT revision.document_snapshot_json
          FROM trade_crm_quick_invoice_revisions revision
          WHERE revision.invoice_id = q.id
            AND revision.firebase_uid = q.firebase_uid
            AND revision.revision = q.revision
          LIMIT 1
        ), '') revision_document_snapshot_json,
        details.service_site_id,
        customer.customer_number,
        CASE WHEN customer.business_name <> '' THEN customer.business_name
          ELSE TRIM(customer.first_name || ' ' || customer.last_name) END customer_name,
        customer.email customer_email, customer.phone customer_phone,
        customer.address_line_1 customer_address_line_1,
        customer.address_line_2 customer_address_line_2,
        customer.suburb customer_suburb,
        customer.address_state customer_address_state,
        customer.postcode customer_postcode,
        site.site_label, site.address_line_1, site.address_line_2,
        site.suburb, site.address_state, site.postcode,
        account.business_name trade_business_name, account.email trade_email,
        account.phone trade_phone, account.abn trade_abn,
        account.business_website trade_website,
        account.address_line_1 trade_address_line_1,
        account.suburb trade_suburb, account.address_state trade_address_state,
        account.postcode trade_postcode,
        account.brand_theme_key, account.brand_border_style,
        account.logo_object_key, account.logo_content_type,
        account.banner_object_key, account.banner_content_type,
        account.document_business_name, account.document_phone,
        account.document_email, account.banner_crop_x_basis_points,
        account.banner_crop_y_basis_points,
        account.banner_crop_width_basis_points,
        account.banner_crop_height_basis_points,
        account.invoice_payment_account_name, account.invoice_payment_bsb,
        account.invoice_payment_account_number,
        account.invoice_payment_reference, account.invoice_default_terms
      FROM trade_crm_quick_invoices q
      JOIN trade_work_orders work
        ON work.id = q.work_order_id AND work.firebase_uid = q.firebase_uid
      JOIN trade_crm_job_details details
        ON details.work_order_id = work.id AND details.firebase_uid = q.firebase_uid
      JOIN trade_crm_customers customer
        ON customer.id = q.crm_customer_id
        AND customer.firebase_uid = q.firebase_uid
        AND customer.record_status = 'active'
      LEFT JOIN trade_crm_service_sites site
        ON site.id = details.service_site_id
        AND site.customer_id = customer.id
        AND site.firebase_uid = q.firebase_uid
        AND site.record_status = 'active'
      JOIN trade_accounts account ON account.firebase_uid = q.firebase_uid
      WHERE q.id = ? AND q.firebase_uid = ?
      LIMIT 1`,
    )
    .bind(invoiceId, ownerUid)
    .first<Row>();
}

function freshDocumentSnapshot(
  row: Row,
  issuedAt = "",
): QuickInvoiceDocumentSnapshot {
  const lines = rawLines(row.line_items_json) as unknown as QuickInvoiceLine[];
  const discountCents = boundedDiscount(row.discount_cents);
  let totals;
  try {
    totals = quickInvoiceTotals(lines, discountCents);
  } catch {
    throw new Error("QUICK_INVOICE_DOCUMENT_INVALID");
  }
  if (
    totals.subtotalCents !== Number(row.subtotal_cents) ||
    totals.taxCents !== Number(row.tax_cents) ||
    totals.totalCents !== Number(row.total_cents)
  ) {
    throw new Error("QUICK_INVOICE_DOCUMENT_INVALID");
  }
  const siteParts = [
    row.address_line_1 || row.customer_address_line_1,
    row.address_line_2 || row.customer_address_line_2,
    row.suburb || row.customer_suburb,
    row.address_state || row.customer_address_state,
    row.postcode || row.customer_postcode,
  ]
    .map((value) => clean(value, 300))
    .filter(Boolean);
  const businessAddress = [
    row.trade_address_line_1,
    row.trade_suburb,
    row.trade_address_state,
    row.trade_postcode,
  ]
    .map((value) => clean(value, 300))
    .filter(Boolean)
    .join(", ");
  const snapshot: QuickInvoiceDocumentSnapshot = {
    schemaVersion: "trade-quick-invoice-document-v1",
    capturedAt: new Date().toISOString(),
    invoiceId: clean(row.id, 180),
    invoiceNumber: clean(row.invoice_number, 120),
    revision: Math.max(1, Number(row.revision || 1)),
    currency: "AUD",
    dueAt: clean(row.due_at, 20),
    issuedAt: clean(issuedAt || row.sent_at, 40),
    business: {
      name:
        clean(row.document_business_name, 240) ||
        clean(row.trade_business_name, 240),
      phone: clean(row.document_phone, 60) || clean(row.trade_phone, 60),
      email: clean(row.document_email, 254) || clean(row.trade_email, 254),
      abn: clean(row.trade_abn, 20),
      website: clean(row.trade_website, 500),
      address: businessAddress,
      themeKey: clean(row.brand_theme_key, 60) || "emerald_navy",
      borderStyle: clean(row.brand_border_style, 30) || "soft",
      logo: imageAsset(row.logo_object_key, row.logo_content_type),
      banner: imageAsset(row.banner_object_key, row.banner_content_type),
      bannerCrop: bannerCrop(row),
    },
    payment: {
      accountName: clean(row.invoice_payment_account_name, 180),
      bsb: clean(row.invoice_payment_bsb, 20),
      accountNumber: clean(row.invoice_payment_account_number, 40),
      reference:
        clean(row.invoice_payment_reference, 120) ||
        clean(row.invoice_number, 120),
      terms: clean(row.invoice_default_terms, 20_000, true),
    },
    customer: {
      id: clean(row.crm_customer_id, 180),
      number: clean(row.customer_number, 120),
      name: clean(row.customer_name, 240),
      email: clean(row.customer_email, 254),
      phone: clean(row.customer_phone, 60),
    },
    site: {
      id: clean(row.service_site_id, 180),
      label: clean(row.site_label, 160) || "Service address",
      addressLine1: clean(
        row.address_line_1 || row.customer_address_line_1,
        300,
      ),
      addressLine2: clean(
        row.address_line_2 || row.customer_address_line_2,
        300,
      ),
      suburb: clean(row.suburb || row.customer_suburb, 160),
      state: clean(row.address_state || row.customer_address_state, 16),
      postcode: clean(row.postcode || row.customer_postcode, 12),
      summary: siteParts.join(", "),
    },
    work: {
      id: clean(row.work_order_id, 180),
      number: clean(row.work_number, 120),
      title: clean(row.work_title, 300),
    },
    lines,
    subtotalCents: totals.subtotalCents,
    discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
  };
  const checked = normaliseQuickInvoiceDocumentSnapshot(snapshot);
  if (!checked) throw new Error("QUICK_INVOICE_DOCUMENT_INVALID");
  return checked;
}

export async function buildQuickInvoiceDocumentSnapshot(
  ownerUid: string,
  invoiceId: string,
  options: {
    forceDraftRefresh?: boolean;
    issuedAt?: string;
    expectedRevision?: number;
  } = {},
) {
  const row = await invoiceDocumentRow(ownerUid, invoiceId);
  if (!row) throw new Error("QUICK_INVOICE_NOT_FOUND");
  const rowRevision = Math.max(1, Number(row.revision || 1));
  if (
    options.expectedRevision !== undefined &&
    rowRevision !== options.expectedRevision
  ) {
    throw new Error("QUICK_INVOICE_CHANGED");
  }
  const stored =
    clean(row.document_snapshot_json, 2_000_000, true) ||
    clean(row.revision_document_snapshot_json, 2_000_000, true);
  if (stored && !options.forceDraftRefresh) {
    const snapshot = normaliseQuickInvoiceDocumentSnapshot(stored);
    if (!snapshot) throw new Error("QUICK_INVOICE_DOCUMENT_INVALID");
    return snapshot;
  }
  if (!stored && row.status !== "draft") {
    throw new Error("QUICK_INVOICE_DOCUMENT_UNAVAILABLE");
  }
  if (options.forceDraftRefresh && row.status !== "draft") {
    throw new Error("QUICK_INVOICE_ISSUED");
  }
  const snapshot = freshDocumentSnapshot(row, options.issuedAt);
  const json = JSON.stringify(snapshot);
  const results = await getD1().batch([
    getD1()
      .prepare(
        `UPDATE trade_crm_quick_invoices
        SET document_snapshot_json = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ?
          AND status = 'draft' AND revision = ?`,
      )
      .bind(
        json,
        snapshot.capturedAt,
        invoiceId,
        ownerUid,
        rowRevision,
      ),
    getD1()
      .prepare(
        `UPDATE trade_crm_quick_invoice_revisions
        SET document_snapshot_json = ?
        WHERE invoice_id = ? AND firebase_uid = ? AND revision = ?
          AND EXISTS (
            SELECT 1 FROM trade_crm_quick_invoices invoice
            WHERE invoice.id = ?
              AND invoice.firebase_uid = ?
              AND invoice.status = 'draft'
              AND invoice.revision = ?
              AND invoice.document_snapshot_json = ?
          )`,
      )
      .bind(
        json,
        invoiceId,
        ownerUid,
        rowRevision,
        invoiceId,
        ownerUid,
        rowRevision,
        json,
      ),
  ]);
  if (
    !Number(results[0].meta.changes || 0) ||
    !Number(results[1].meta.changes || 0)
  ) {
    throw new Error("QUICK_INVOICE_CHANGED");
  }
  return snapshot;
}

export async function issuedQuickInvoicePdf(
  ownerUid: string,
  invoiceId: string,
) {
  const row = await invoiceDocumentRow(ownerUid, invoiceId);
  if (!row) throw new Error("QUICK_INVOICE_NOT_FOUND");
  const stored =
    clean(row.document_snapshot_json, 2_000_000, true) ||
    clean(row.revision_document_snapshot_json, 2_000_000, true);
  const snapshot = normaliseQuickInvoiceDocumentSnapshot(stored);
  if (!snapshot) {
    throw new Error("QUICK_INVOICE_DOCUMENT_UNAVAILABLE");
  }
  const objectKey = clean(row.issued_pdf_object_key, 1_000);
  const sha256 = clean(row.issued_pdf_sha256, 64).toLowerCase();
  const sizeBytes = Number(row.issued_pdf_size_bytes || 0);
  if (!objectKey || !sha256 || !Number.isInteger(sizeBytes)) {
    throw new Error("QUICK_INVOICE_PDF_UNAVAILABLE");
  }
  try {
    const bytes = await readImmutableIssuedPdf(
      {
        objectKey,
        sha256,
        sizeBytes,
      },
      {
        kind: "invoice",
        documentId: invoiceId,
        revision: snapshot.revision,
      },
    );
    return { snapshot, bytes };
  } catch {
    throw new Error("QUICK_INVOICE_PDF_UNAVAILABLE");
  }
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function deliveryBody(snapshot: QuickInvoiceDocumentSnapshot) {
  const lineText = snapshot.lines
    .map(
      (line) =>
        `${line.description}: ${money(line.subtotalCents)}${
          line.taxCode === "gst" ? " plus GST" : " GST-free"
        }`,
    )
    .join("\n");
  const payment = [
    snapshot.payment.accountName
      ? `Account name: ${snapshot.payment.accountName}`
      : "",
    snapshot.payment.bsb ? `BSB: ${snapshot.payment.bsb}` : "",
    snapshot.payment.accountNumber
      ? `Account number: ${snapshot.payment.accountNumber}`
      : "",
    snapshot.payment.reference
      ? `Reference: ${snapshot.payment.reference}`
      : "",
  ].filter(Boolean);
  return [
    `Invoice ${snapshot.invoiceNumber} from ${snapshot.business.name}`,
    "",
    `Prepared for ${snapshot.customer.name}`,
    snapshot.site.summary,
    `Job: ${snapshot.work.number} | ${snapshot.work.title}`,
    "",
    lineText,
    "",
    `Subtotal: ${money(snapshot.subtotalCents)}`,
    snapshot.discountCents
      ? `Discount: -${money(snapshot.discountCents)}`
      : "",
    `GST: ${money(snapshot.taxCents)}`,
    `Total due: ${money(snapshot.totalCents)}`,
    `Due date: ${snapshot.dueAt}`,
    "",
    ...payment,
    payment.length ? "" : "",
    "A PDF copy is attached. Please contact the business directly if you have a question.",
  ]
    .filter(
      (line, index, all) =>
        line !== "" || (index > 0 && all[index - 1] !== ""),
    )
    .join("\n");
}

function deliveryHtml(snapshot: QuickInvoiceDocumentSnapshot) {
  const business = escapeHtml(snapshot.business.name);
  const rows = snapshot.lines
    .map(
      (line) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #d8e4e1">${escapeHtml(
          line.description,
        )}</td><td style="padding:10px 0;border-bottom:1px solid #d8e4e1;text-align:right">${escapeHtml(
          money(line.subtotalCents),
        )}</td></tr>`,
    )
    .join("");
  const payment = snapshot.payment.accountNumber
    ? `<div style="margin-top:20px;padding:16px;background:#f0f7f5;border-radius:10px">
      <strong>Payment details</strong><br>
      ${escapeHtml(snapshot.payment.accountName)}<br>
      BSB ${escapeHtml(snapshot.payment.bsb)} &nbsp; Account ${escapeHtml(snapshot.payment.accountNumber)}<br>
      Reference ${escapeHtml(snapshot.payment.reference)}
    </div>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#eef5f3;font-family:Arial,sans-serif;color:#08343b">
    <div style="max-width:640px;margin:0 auto;padding:28px 16px">
      <div style="background:#06313d;color:white;padding:24px;border-radius:14px 14px 0 0">
        <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase">Invoice from</div>
        <h1 style="margin:8px 0 0;font-size:27px">${business}</h1>
      </div>
      <div style="background:white;padding:26px;border-radius:0 0 14px 14px">
        <p style="font-size:17px;margin-top:0">Hello ${escapeHtml(snapshot.customer.name)},</p>
        <p>Your invoice for <strong>${escapeHtml(snapshot.work.title)}</strong> is attached.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:18px">${rows}</table>
        <table style="width:100%;margin-top:18px">
          <tr><td>Subtotal</td><td style="text-align:right">${escapeHtml(money(snapshot.subtotalCents))}</td></tr>
          ${snapshot.discountCents ? `<tr><td>Discount (ex GST)</td><td style="text-align:right">-${escapeHtml(money(snapshot.discountCents))}</td></tr>` : ""}
          <tr><td>GST</td><td style="text-align:right">${escapeHtml(money(snapshot.taxCents))}</td></tr>
          <tr><td style="padding-top:10px;font-size:18px"><strong>Total due</strong></td><td style="padding-top:10px;text-align:right;font-size:18px"><strong>${escapeHtml(money(snapshot.totalCents))}</strong></td></tr>
        </table>
        <p><strong>Due ${escapeHtml(snapshot.dueAt)}</strong></p>
        ${payment}
        <p style="margin-top:22px;color:#4d6265">Questions? Reply to this email or contact ${business}${snapshot.business.phone ? ` on ${escapeHtml(snapshot.business.phone)}` : ""}.</p>
      </div>
    </div>
  </body></html>`;
}

const PROVIDER_ACCEPTED_DELIVERY_STATES = [
  "provider_accepted",
  "sent",
  "delivered",
];

function hasIssuedPdfReference(row: Row) {
  return (
    clean(row.issued_pdf_object_key, 1_000) !== "" &&
    /^[a-f0-9]{64}$/.test(
      clean(row.issued_pdf_sha256, 64).toLowerCase(),
    ) &&
    Number.isInteger(Number(row.issued_pdf_size_bytes)) &&
    Number(row.issued_pdf_size_bytes) >= 5
  );
}

function isFinalisedProviderAcceptedInvoice(
  row: Row | null | undefined,
) {
  return Boolean(
    row &&
      row.status === "issued" &&
      PROVIDER_ACCEPTED_DELIVERY_STATES.includes(
        String(row.delivery_status),
      ) &&
      clean(row.provider_message_id, 500) &&
      hasIssuedPdfReference(row),
  );
}

export async function sendQuickInvoiceDelivery(input: {
  invoiceId: string;
  ownerUid: string;
  actorUid: string;
  origin: string;
}) {
  const db = getD1();
  const row = await invoiceDocumentRow(input.ownerUid, input.invoiceId);
  if (!row) throw new Error("QUICK_INVOICE_NOT_FOUND");
  if (isFinalisedProviderAcceptedInvoice(row)) {
    return {
      ok: true,
      duplicate: true,
      providerMessageId: String(row.provider_message_id || ""),
    };
  }
  if (
    row.delivery_status === "reconciliation_required" ||
    (row.status !== "issued" &&
      PROVIDER_ACCEPTED_DELIVERY_STATES.includes(
        String(row.delivery_status),
      ))
  ) {
    if (row.delivery_status !== "reconciliation_required") {
      await db
        .prepare(QUICK_INVOICE_PROVIDER_ACCEPTED_CONFLICT_SQL)
        .bind(
          clean(row.delivery_provider, 60),
          clean(row.provider_message_id, 500),
          new Date().toISOString(),
          input.invoiceId,
          input.ownerUid,
        )
        .run();
    }
    throw new Error("QUICK_INVOICE_ISSUE_CONFLICT");
  }
  if (
    row.status === "issued" &&
    PROVIDER_ACCEPTED_DELIVERY_STATES.includes(
      String(row.delivery_status),
    )
  ) {
    throw new Error("QUICK_INVOICE_PDF_UNAVAILABLE");
  }
  const recipient = validEmail(row.customer_email);
  if (!recipient) throw new Error("QUICK_INVOICE_RECIPIENT_INVALID");
  if (!serviceReminderProviderConfiguration().email.configured) {
    throw new Error("waiting_for_channel");
  }
  const now = new Date().toISOString();
  const expectedRevision = Math.max(1, Number(row.revision || 1));
  const staleSendingBefore = new Date(
    Date.parse(now) - 10 * 60 * 1_000,
  ).toISOString();
  const lock = await db
    .prepare(QUICK_INVOICE_SEND_LOCK_SQL)
    .bind(
      now,
      input.invoiceId,
      input.ownerUid,
      expectedRevision,
      staleSendingBefore,
    )
    .run();
  if (!Number(lock.meta.changes || 0)) {
    const current = await invoiceDocumentRow(
      input.ownerUid,
      input.invoiceId,
    );
    if (current && isFinalisedProviderAcceptedInvoice(current)) {
      return {
        ok: true,
        duplicate: true,
        providerMessageId: String(current.provider_message_id || ""),
      };
    }
    if (
      current?.delivery_status === "reconciliation_required" ||
      (current?.status !== "issued" &&
        PROVIDER_ACCEPTED_DELIVERY_STATES.includes(
          String(current?.delivery_status),
        ))
    ) {
      if (
        current &&
        current.delivery_status !== "reconciliation_required"
      ) {
        await db
          .prepare(QUICK_INVOICE_PROVIDER_ACCEPTED_CONFLICT_SQL)
          .bind(
            clean(current.delivery_provider, 60),
            clean(current.provider_message_id, 500),
            new Date().toISOString(),
            input.invoiceId,
            input.ownerUid,
          )
          .run();
      }
      throw new Error("QUICK_INVOICE_ISSUE_CONFLICT");
    }
    if (current?.delivery_status === "sending") {
      throw new Error("QUICK_INVOICE_SENDING");
    }
    throw new Error("QUICK_INVOICE_CHANGED");
  }
  let snapshot: QuickInvoiceDocumentSnapshot;
  let acceptedProvider:
    | { provider: string; providerMessageId: string }
    | null = null;
  try {
    snapshot = await buildQuickInvoiceDocumentSnapshot(
      input.ownerUid,
      input.invoiceId,
      {
        forceDraftRefresh: true,
        issuedAt: now,
        expectedRevision,
      },
    );
    const pdf = await renderTradeQuickInvoicePdf(snapshot, {
      origin: input.origin,
    });
    const issuedPdf = await storeImmutableIssuedPdf({
      kind: "invoice",
      documentId: input.invoiceId,
      revision: expectedRevision,
      bytes: pdf,
    });
    const result = await sendServiceReminderProviderMessage({
      channel: "email",
      recipient,
      subject: `${snapshot.business.name} | Invoice ${snapshot.invoiceNumber} for ${snapshot.customer.name}`,
      body: deliveryBody(snapshot),
      html: deliveryHtml(snapshot),
      replyTo: validEmail(snapshot.business.email) || undefined,
      attachments: [
        {
          filename: tradeQuickInvoicePdfFilename(snapshot),
          content: tradeQuickInvoicePdfBase64(pdf),
          contentType: "application/pdf",
        },
      ],
      idempotencyKey: `quick-invoice:${input.invoiceId}:revision:${expectedRevision}`,
      callbackUrl: `${input.origin}/api/service-reminder-provider-events/resend`,
      messageType: "quick_invoice",
    });
    acceptedProvider = result;
    const snapshotJson = JSON.stringify(snapshot);
    const eventId = `quick-invoice-issued:${input.invoiceId}:${expectedRevision}`;
    const finaliseAcceptedInvoice = (invoiceUpdateSql: string) => db.batch([
      db
        .prepare(invoiceUpdateSql)
        .bind(
          result.provider,
          result.providerMessageId,
          issuedPdf.objectKey,
          issuedPdf.sha256,
          issuedPdf.sizeBytes,
          now,
          now,
          now,
          input.invoiceId,
          input.ownerUid,
          expectedRevision,
          snapshotJson,
        ),
      db
        .prepare(
          `UPDATE trade_crm_quick_invoice_revisions
          SET issued_pdf_object_key = ?,
            issued_pdf_sha256 = ?,
            issued_pdf_size_bytes = ?
          WHERE invoice_id = ? AND firebase_uid = ? AND revision = ?
            AND EXISTS (
              SELECT 1 FROM trade_crm_quick_invoices invoice
              WHERE invoice.id = ?
                AND invoice.firebase_uid = ?
                AND invoice.status = 'issued'
                AND invoice.revision = ?
                AND invoice.provider_message_id = ?
                AND invoice.issued_pdf_object_key = ?
                AND invoice.issued_pdf_sha256 = ?
                AND invoice.issued_pdf_size_bytes = ?
            )`,
        )
        .bind(
          issuedPdf.objectKey,
          issuedPdf.sha256,
          issuedPdf.sizeBytes,
          input.invoiceId,
          input.ownerUid,
          expectedRevision,
          input.invoiceId,
          input.ownerUid,
          expectedRevision,
          result.providerMessageId,
          issuedPdf.objectKey,
          issuedPdf.sha256,
          issuedPdf.sizeBytes,
        ),
      db
        .prepare(
          `UPDATE trade_crm_job_details SET invoice_status = 'issued',
          invoiced_value_cents = ?, payment_due_at = ?, updated_at = ?
          WHERE work_order_id = ? AND firebase_uid = ?
            AND EXISTS (
              SELECT 1 FROM trade_crm_quick_invoices invoice
              WHERE invoice.id = ?
                AND invoice.firebase_uid = ?
                AND invoice.status = 'issued'
                AND invoice.revision = ?
                AND invoice.provider_message_id = ?
                AND invoice.sent_at = ?
            )`,
        )
        .bind(
          snapshot.totalCents,
          snapshot.dueAt,
          now,
          snapshot.work.id,
          input.ownerUid,
          input.invoiceId,
          input.ownerUid,
          expectedRevision,
          result.providerMessageId,
          now,
        ),
      db
        .prepare(
          `INSERT INTO trade_work_order_events
          (id, work_order_id, firebase_uid, event_type, summary, created_at)
          SELECT ?, ?, ?, 'quick_invoice_provider_accepted', ?, ?
          WHERE EXISTS (
            SELECT 1 FROM trade_crm_quick_invoices invoice
            WHERE invoice.id = ?
              AND invoice.firebase_uid = ?
              AND invoice.status = 'issued'
              AND invoice.revision = ?
              AND invoice.provider_message_id = ?
              AND invoice.sent_at = ?
          )`,
        )
        .bind(
          eventId,
          snapshot.work.id,
          input.ownerUid,
          `${snapshot.invoiceNumber} submitted to the email provider by ${
            input.actorUid === input.ownerUid
              ? `business owner ${input.actorUid}`
              : `team member ${input.actorUid}`
          }.`,
          now,
          input.invoiceId,
          input.ownerUid,
          expectedRevision,
          result.providerMessageId,
          now,
        ),
    ]);
    let results = await finaliseAcceptedInvoice(
      QUICK_INVOICE_SUCCESS_UPDATE_SQL,
    );
    if (!Number(results[0].meta.changes || 0)) {
      let current = await invoiceDocumentRow(
        input.ownerUid,
        input.invoiceId,
      );
      if (
        current &&
        isFinalisedProviderAcceptedInvoice(current) &&
        current.provider_message_id === result.providerMessageId &&
        Number(current.revision || 1) === expectedRevision &&
        clean(current.document_snapshot_json, 2_000_000, true) ===
          snapshotJson &&
        current.issued_pdf_object_key === issuedPdf.objectKey &&
        current.issued_pdf_sha256 === issuedPdf.sha256 &&
        Number(current.issued_pdf_size_bytes) === issuedPdf.sizeBytes
      ) {
        return {
          ok: true,
          duplicate: true,
          providerMessageId: result.providerMessageId,
        };
      }
      if (
        current?.status === "draft" &&
        Number(current.revision || 1) === expectedRevision &&
        clean(current.document_snapshot_json, 2_000_000, true) ===
          snapshotJson
      ) {
        results = await finaliseAcceptedInvoice(
          QUICK_INVOICE_PROVIDER_ACCEPTED_RECOVERY_SQL,
        );
        if (Number(results[0].meta.changes || 0)) {
          return {
            ok: true,
            duplicate: false,
            providerMessageId: result.providerMessageId,
          };
        }
        current = await invoiceDocumentRow(
          input.ownerUid,
          input.invoiceId,
        );
        if (
          current &&
          isFinalisedProviderAcceptedInvoice(current) &&
          current.provider_message_id === result.providerMessageId &&
          Number(current.revision || 1) === expectedRevision &&
          clean(current.document_snapshot_json, 2_000_000, true) ===
            snapshotJson &&
          current.issued_pdf_object_key === issuedPdf.objectKey &&
          current.issued_pdf_sha256 === issuedPdf.sha256 &&
          Number(current.issued_pdf_size_bytes) === issuedPdf.sizeBytes
        ) {
          return {
            ok: true,
            duplicate: true,
            providerMessageId: result.providerMessageId,
          };
        }
      }
      throw new Error("QUICK_INVOICE_ISSUE_CONFLICT");
    }
    return {
      ok: true,
      duplicate: false,
      providerMessageId: result.providerMessageId,
    };
  } catch (error) {
    if (acceptedProvider) {
      await db
        .prepare(QUICK_INVOICE_PROVIDER_ACCEPTED_CONFLICT_SQL)
        .bind(
          acceptedProvider.provider,
          acceptedProvider.providerMessageId,
          now,
          input.invoiceId,
          input.ownerUid,
        )
        .run();
      throw new Error("QUICK_INVOICE_ISSUE_CONFLICT");
    }
    await db
      .prepare(
        `UPDATE trade_crm_quick_invoices
        SET delivery_status = 'failed', attempts = attempts + 1,
          last_error = 'PROVIDER_SEND_FAILED', updated_at = ?
        WHERE id = ? AND firebase_uid = ?
          AND status = 'draft'
          AND revision = ?
          AND delivery_status = 'sending'`,
      )
      .bind(
        now,
        input.invoiceId,
        input.ownerUid,
        expectedRevision,
      )
      .run();
    if (
      error instanceof Error &&
      [
        "QUICK_INVOICE_CHANGED",
        "QUICK_INVOICE_DOCUMENT_INVALID",
        "QUICK_INVOICE_ISSUE_CONFLICT",
      ].includes(error.message)
    ) {
      throw error;
    }
    throw new Error("QUICK_INVOICE_DELIVERY_FAILED");
  }
}
