import { getD1 } from "../../db";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";
import {
  hashQuoteLinkSecret,
  splitQuoteLinkToken,
} from "@/lib/trade-quote-links";

type Row = Record<string, unknown>;

export type QuoteDecision = "accepted" | "declined";

export type AuthorisedTradeQuoteDecisionLink = Row & {
  id: string;
  quote_id: string;
  quote_version_id: string;
  work_order_id: string;
  firebase_uid: string;
  crm_customer_id: string;
  token_issue: number;
  token_hash: string;
  status: "active" | QuoteDecision;
  expires_at: string;
  version_number: number;
  current_version_number: number;
  document_snapshot_json: string;
  invoice_payment_account_name: string;
  invoice_payment_bsb: string;
  invoice_payment_account_number: string;
  invoice_payment_reference: string;
  invoice_default_terms: string;
};

export type QuoteDecisionCommercialReceipt = {
  reference: string;
  currency: "AUD";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  selectedChoiceIds: string[];
};

export type QuoteDecisionReceipt = {
  acceptanceId: string;
  decision: QuoteDecision;
  signerName: string;
  decidedAt: string;
  consentStatement: string;
  commercialReference: string;
  invoice: null | {
    id: string;
    number: string;
    status: "issued" | "attention_required";
    documentLabel: "Invoice";
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    dueAt: string;
    issueBlockerCode: string;
  };
  payment: {
    availability: "bank_transfer" | "not_configured" | "withheld";
    method: "bank_transfer" | "none";
    accountName: string;
    bsb: string;
    accountNumber: string;
    reference: string;
    terms: string;
    amountDueCents: number;
    currency: "AUD";
    dueAt: string;
  };
};

export type StoredQuoteDecision = {
  receipt: QuoteDecisionReceipt;
  commercial: QuoteDecisionCommercialReceipt;
  clientDecisionId: string;
  payloadSha256: string;
};

export function normaliseQuoteDecisionSigner(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function validQuoteDecisionId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hexadecimal(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function quoteDecisionPayloadSha256(input: {
  linkId: string;
  tokenIssue: number;
  quoteVersionId: string;
  decision: QuoteDecision;
  signerName: string;
  selectedChoiceIds: string[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}) {
  const canonical = JSON.stringify({
    linkId: input.linkId,
    tokenIssue: input.tokenIssue,
    quoteVersionId: input.quoteVersionId,
    decision: input.decision,
    signerName: normaliseQuoteDecisionSigner(input.signerName),
    selectedChoiceIds: [...input.selectedChoiceIds].map(String).sort(),
    subtotalCents: input.subtotalCents,
    taxCents: input.taxCents,
    totalCents: input.totalCents,
  });
  return hexadecimal(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  )));
}

export async function authoriseTradeQuoteDecisionLink(
  token: string,
  options: { requireCurrentTradeAccess?: boolean } = {},
): Promise<AuthorisedTradeQuoteDecisionLink> {
  const { linkId, secret } = splitQuoteLinkToken(token);
  const tradeAccessPredicate = options.requireCurrentTradeAccess
    ? verifiedTradeAccountPredicate("trade")
    : "trade.account_status = 'active'";
  const row = await getD1().prepare(`SELECT link.*,
      version.version_number, version.status version_status,
      version.document_snapshot_json, version.valid_until,
      quote.current_version_number,
      trade.invoice_payment_account_name,
      trade.invoice_payment_bsb,
      trade.invoice_payment_account_number,
      trade.invoice_payment_reference,
      trade.invoice_default_terms
    FROM trade_crm_quote_links link
    JOIN trade_crm_quote_versions version
      ON version.id = link.quote_version_id
      AND version.quote_id = link.quote_id
      AND version.firebase_uid = link.firebase_uid
    JOIN trade_crm_quotes quote
      ON quote.id = link.quote_id
      AND quote.firebase_uid = link.firebase_uid
      AND quote.work_order_id = link.work_order_id
      AND quote.crm_customer_id = link.crm_customer_id
    JOIN trade_work_orders work
      ON work.id = link.work_order_id
      AND work.firebase_uid = link.firebase_uid
    LEFT JOIN trade_crm_job_details detail
      ON detail.work_order_id = link.work_order_id
      AND detail.firebase_uid = link.firebase_uid
      AND detail.crm_customer_id = link.crm_customer_id
    JOIN trade_accounts trade
      ON trade.firebase_uid = link.firebase_uid
      AND (link.status <> 'active' OR (
        trade.partner_type = 'installer' AND ${tradeAccessPredicate}
      ))
    WHERE link.id = ?
      AND (link.status <> 'active' OR (
        work.record_status = 'active'
        AND detail.work_order_id IS NOT NULL
        AND detail.customer_source IN ('trade_owned', 'public_lead_released')
      ))
    LIMIT 1`).bind(linkId).first<Row>();
  if (!row || !row.token_hash || await hashQuoteLinkSecret(secret) !== row.token_hash) {
    throw new Error("QUOTE_LINK_NOT_FOUND");
  }
  const now = new Date().toISOString();
  if (String(row.expires_at) <= now ||
      (row.status === "active" && row.valid_until &&
        String(row.valid_until) < now.slice(0, 10))) {
    throw new Error("QUOTE_LINK_EXPIRED");
  }
  const linkStatus = String(row.status);
  const versionStatus = String(row.version_status);
  if (!["active", "accepted", "declined"].includes(linkStatus) ||
      (linkStatus === "active" && (
        versionStatus !== "issued" ||
        Number(row.version_number) !== Number(row.current_version_number)
      ))) {
    throw new Error("QUOTE_LINK_STOPPED");
  }
  return {
    ...row,
    id: String(row.id),
    quote_id: String(row.quote_id),
    quote_version_id: String(row.quote_version_id),
    work_order_id: String(row.work_order_id),
    firebase_uid: String(row.firebase_uid),
    crm_customer_id: String(row.crm_customer_id),
    token_issue: Number(row.token_issue),
    token_hash: String(row.token_hash),
    status: linkStatus as AuthorisedTradeQuoteDecisionLink["status"],
    expires_at: String(row.expires_at),
    version_number: Number(row.version_number),
    current_version_number: Number(row.current_version_number),
    document_snapshot_json: String(row.document_snapshot_json || ""),
    invoice_payment_account_name: String(row.invoice_payment_account_name || ""),
    invoice_payment_bsb: String(row.invoice_payment_bsb || ""),
    invoice_payment_account_number: String(row.invoice_payment_account_number || ""),
    invoice_payment_reference: String(row.invoice_payment_reference || ""),
    invoice_default_terms: String(row.invoice_default_terms || ""),
  };
}

function clean(value: unknown, maximum = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function integer(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("QUOTE_DECISION_RECEIPT_INVALID");
  return parsed;
}

function selectedIds(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) throw new Error("invalid");
    return parsed.map(String).sort();
  } catch {
    throw new Error("QUOTE_DECISION_RECEIPT_INVALID");
  }
}

function paymentSnapshot(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed as Row : {};
  } catch {
    return {};
  }
}

export async function storedQuoteDecision(
  link: AuthorisedTradeQuoteDecisionLink,
): Promise<StoredQuoteDecision | null> {
  const row = await getD1().prepare(`SELECT
      acceptance.id acceptance_id, acceptance.decision, acceptance.signer_name,
      acceptance.decided_at, acceptance.consent_statement,
      acceptance.commercial_reference,
      acceptance.selected_choice_ids_json, acceptance.selected_subtotal_cents,
      acceptance.selected_tax_cents, acceptance.selected_total_cents,
      acceptance.decision_request_id, acceptance.decision_payload_sha256,
      acceptance.result_invoice_id, acceptance.invoice_creation_status,
      invoice.id invoice_id, invoice.invoice_number, invoice.status invoice_status,
      invoice.document_label, invoice.subtotal_cents invoice_subtotal_cents,
      invoice.tax_cents invoice_tax_cents, invoice.total_cents invoice_total_cents,
      invoice.due_at, invoice.issue_blocker_code, invoice.payment_snapshot_json
    FROM trade_crm_quote_acceptances acceptance
    LEFT JOIN trade_crm_accepted_invoices invoice
      ON invoice.id = acceptance.result_invoice_id
      AND invoice.acceptance_id = acceptance.id
      AND invoice.quote_id = acceptance.quote_id
      AND invoice.quote_version_id = acceptance.quote_version_id
      AND invoice.work_order_id = acceptance.work_order_id
      AND invoice.firebase_uid = acceptance.firebase_uid
      AND invoice.crm_customer_id = acceptance.crm_customer_id
    WHERE acceptance.quote_link_id = ? AND acceptance.token_issue = ?
      AND acceptance.quote_id = ? AND acceptance.quote_version_id = ?
      AND acceptance.work_order_id = ? AND acceptance.firebase_uid = ?
      AND acceptance.crm_customer_id = ?
    LIMIT 1`).bind(
      link.id, link.token_issue, link.quote_id, link.quote_version_id,
      link.work_order_id, link.firebase_uid, link.crm_customer_id,
    ).first<Row>();
  if (!row) return null;
  const decision = String(row.decision) as QuoteDecision;
  if (decision !== "accepted" && decision !== "declined") {
    throw new Error("QUOTE_DECISION_RECEIPT_INVALID");
  }
  const commercial: QuoteDecisionCommercialReceipt = {
    reference: clean(row.commercial_reference, 180),
    currency: "AUD",
    subtotalCents: integer(row.selected_subtotal_cents),
    taxCents: integer(row.selected_tax_cents),
    totalCents: integer(row.selected_total_cents),
    selectedChoiceIds: selectedIds(row.selected_choice_ids_json),
  };
  const hasInvoice = Boolean(row.invoice_id);
  if (decision === "accepted" && !hasInvoice && String(row.result_invoice_id || "")) {
    throw new Error("QUOTE_DECISION_RECEIPT_INVALID");
  }
  const invoice = hasInvoice ? {
    id: clean(row.invoice_id, 180),
    number: clean(row.invoice_number, 180),
    status: String(row.invoice_status) as "issued" | "attention_required",
    documentLabel: "Invoice" as const,
    subtotalCents: integer(row.invoice_subtotal_cents),
    taxCents: integer(row.invoice_tax_cents),
    totalCents: integer(row.invoice_total_cents),
    dueAt: clean(row.due_at, 40),
    issueBlockerCode: clean(row.issue_blocker_code, 120),
  } : null;
  const frozen = hasInvoice ? paymentSnapshot(row.payment_snapshot_json) : {};
  const bankSnapshot = frozen.method === "bank_transfer" && frozen.available === true;
  const accountName = bankSnapshot ? clean(frozen.accountName, 180) : "";
  const bsb = bankSnapshot ? clean(frozen.bsb, 20) : "";
  const accountNumber = bankSnapshot ? clean(frozen.accountNumber, 40) : "";
  const bankTransfer = decision === "accepted" && invoice?.status === "issued" &&
    accountName && bsb && accountNumber;
  const availability = decision === "declined"
    ? "withheld" as const
    : bankTransfer ? "bank_transfer" as const : "not_configured" as const;
  const dueAt = invoice?.dueAt || "";
  return {
    clientDecisionId: clean(row.decision_request_id, 180),
    payloadSha256: clean(row.decision_payload_sha256, 64),
    commercial,
    receipt: {
      acceptanceId: clean(row.acceptance_id, 180),
      decision,
      signerName: clean(row.signer_name, 160),
      decidedAt: clean(row.decided_at, 40),
      consentStatement: clean(row.consent_statement, 20_000),
      commercialReference: commercial.reference,
      invoice,
      payment: {
        availability,
        method: bankTransfer ? "bank_transfer" : "none",
        accountName: bankTransfer ? accountName : "",
        bsb: bankTransfer ? bsb : "",
        accountNumber: bankTransfer ? accountNumber : "",
        reference: bankTransfer ? clean(frozen.reference, 120) : "",
        terms: bankTransfer ? clean(frozen.terms, 20_000) : "",
        amountDueCents: invoice?.status === "issued" ? invoice.totalCents : 0,
        currency: "AUD",
        dueAt,
      },
    },
  };
}

export async function exactQuoteDecisionReplay(
  link: AuthorisedTradeQuoteDecisionLink,
  clientDecisionId: string,
  payloadSha256: string,
) {
  const stored = await storedQuoteDecision(link);
  if (!stored || stored.clientDecisionId !== clientDecisionId ||
      stored.payloadSha256 !== payloadSha256) {
    throw new Error("QUOTE_DECISION_REPLAY_MISMATCH");
  }
  return stored;
}
