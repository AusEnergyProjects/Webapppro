import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { buildAcceptedInvoiceSnapshot } from "@/lib/trade-accepted-invoice";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";
import { acceptedScopeSnapshot, depositAmountCents } from "@/lib/trade-commercial-handoff";
import { providerNeutralCommercialRecord } from "@/lib/trade-commercial-reference";
import {
  authoriseTradeQuoteDecisionLink,
  exactQuoteDecisionReplay,
  normaliseQuoteDecisionSigner,
  quoteDecisionPayloadSha256,
  storedQuoteDecision,
  validQuoteDecisionId,
  type AuthorisedTradeQuoteDecisionLink,
  type QuoteDecision,
} from "@/lib/trade-quote-decision-server";
import { calculateQuoteSelection, type QuoteChoiceTotals } from "@/lib/trade-quote-options";
import {
  buildTradeQuoteReviewPayload,
  quoteDocumentSnapshotForAuthorisedLink,
  tradeQuoteTokenErrorResponse,
} from "@/lib/trade-quote-review-server";

export const runtime = "edge";

type Context = { params: Promise<{ token: string }> };
type Row = Record<string, unknown>;

function publicError(error: unknown, stage = "review") {
  const code = error instanceof Error ? error.message : "";
  if (code === "INVALID_QUOTE_SELECTION") {
    return adminJson({
      ok: false,
      error: "Choose one package and one answer from each required choice.",
    }, 400);
  }
  return tradeQuoteTokenErrorResponse(error, stage);
}

function quoteChoices(snapshot: Awaited<ReturnType<typeof quoteDocumentSnapshotForAuthorisedLink>>) {
  return snapshot.choices.map<QuoteChoiceTotals>((choice) => ({
    id: choice.id,
    kind: choice.kind,
    groupKey: choice.groupKey,
    name: choice.name,
    subtotalCents: choice.subtotalCents,
    taxCents: choice.taxCents,
    totalCents: choice.totalCents,
  }));
}

function acceptedScope(
  snapshot: Awaited<ReturnType<typeof quoteDocumentSnapshotForAuthorisedLink>>,
  selectedIds: string[],
  totals: { subtotalCents: number; taxCents: number; totalCents: number },
) {
  return acceptedScopeSnapshot([
    ...snapshot.items.map((item) => ({
      id: item.id,
      line_type: item.lineType,
      section_heading: item.sectionHeading,
      description: item.description,
      quantity_milli: item.quantityMilli,
      subtotal_cents: item.subtotalCents,
      tax_cents: item.taxCents,
      total_cents: item.totalCents,
      quote_choice_id: "",
    })),
    ...snapshot.choices.flatMap((choice) => choice.items.map((item) => ({
      id: item.id,
      line_type: item.lineType,
      section_heading: item.sectionHeading,
      description: item.description,
      quantity_milli: item.quantityMilli,
      subtotal_cents: item.subtotalCents,
      tax_cents: item.taxCents,
      total_cents: item.totalCents,
      quote_choice_id: choice.id,
    }))),
  ], selectedIds, totals);
}

function dueDate(acceptedAt: string) {
  const due = new Date(acceptedAt);
  due.setUTCDate(due.getUTCDate() + 7);
  return due.toISOString().slice(0, 10);
}

const existingInvoiceConflictSql = `(EXISTS (
  SELECT 1 FROM trade_crm_quick_invoices quick
  WHERE quick.work_order_id = link.work_order_id
    AND quick.firebase_uid = link.firebase_uid AND quick.status <> 'void'
) OR EXISTS (
  SELECT 1 FROM trade_crm_accounting_documents accounting
  WHERE accounting.work_order_id = link.work_order_id
    AND accounting.firebase_uid = link.firebase_uid
    AND accounting.document_type = 'invoice'
    AND accounting.status NOT IN ('void', 'cancelled')
) OR EXISTS (
  SELECT 1 FROM trade_crm_job_details finance
  WHERE finance.work_order_id = link.work_order_id
    AND finance.firebase_uid = link.firebase_uid
    AND finance.crm_customer_id = link.crm_customer_id
    AND (finance.invoiced_value_cents <> 0
      OR finance.paid_value_cents <> 0
      OR finance.payment_due_at <> ''
      OR finance.invoice_status NOT IN ('', 'not_started', 'void', 'cancelled'))
))`;

const existingAcceptedInvoiceSql = `EXISTS (
  SELECT 1 FROM trade_crm_accepted_invoices accepted_invoice
  WHERE accepted_invoice.firebase_uid = link.firebase_uid
    AND accepted_invoice.work_order_id = link.work_order_id
)`;

async function existingAcceptedInvoice(
  db: D1Database,
  link: AuthorisedTradeQuoteDecisionLink,
) {
  return Boolean(await db.prepare(`SELECT 'conflict' conflict
    FROM trade_crm_quote_links link
    WHERE link.id = ? AND link.quote_id = ? AND link.quote_version_id = ?
      AND link.work_order_id = ? AND link.firebase_uid = ?
      AND link.crm_customer_id = ? AND ${existingAcceptedInvoiceSql}
    LIMIT 1`).bind(
      link.id, link.quote_id, link.quote_version_id, link.work_order_id,
      link.firebase_uid, link.crm_customer_id,
    ).first<Row>());
}

async function existingInvoiceConflict(
  db: D1Database,
  link: AuthorisedTradeQuoteDecisionLink,
) {
  return Boolean(await db.prepare(`SELECT 'conflict' conflict
    FROM trade_crm_quote_links link
    WHERE link.id = ? AND link.quote_id = ? AND link.quote_version_id = ?
      AND link.work_order_id = ? AND link.firebase_uid = ?
      AND link.crm_customer_id = ? AND ${existingInvoiceConflictSql}
    LIMIT 1`).bind(
      link.id, link.quote_id, link.quote_version_id, link.work_order_id,
      link.firebase_uid, link.crm_customer_id,
    ).first<Row>());
}

function success(stored: Awaited<ReturnType<typeof exactQuoteDecisionReplay>>, duplicate: boolean) {
  return adminJson({
    ok: true,
    duplicate,
    decision: stored.receipt.decision,
    commercial: stored.commercial,
    receipt: stored.receipt,
  });
}

export async function GET(_request: Request, context: Context) {
  try {
    const link = await authoriseTradeQuoteDecisionLink((await context.params).token);
    if (link.status !== "active") {
      const stored = await storedQuoteDecision(link);
      if (!stored) throw new Error("QUOTE_DECISION_RECEIPT_INVALID");
      return adminJson({ ok: true, receipt: stored.receipt });
    }
    const quote = await buildTradeQuoteReviewPayload(link);
    const now = new Date().toISOString();
    await getD1().prepare(`INSERT OR IGNORE INTO trade_crm_quote_events
      (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid,
       event_type, actor_type, summary, evidence_key, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, 'viewed', 'link_holder', 'Secure quote opened.', ?, ?)`)
      .bind(crypto.randomUUID(), link.id, link.quote_id, link.quote_version_id,
        link.work_order_id, link.firebase_uid, `view:${link.id}:${now.slice(0, 10)}`, now)
      .run();
    return adminJson({ ok: true, quote });
  } catch (error) {
    return publicError(error);
  }
}

async function askQuestion(
  link: AuthorisedTradeQuoteDecisionLink,
  body: Row,
) {
  if (link.status !== "active") throw new Error("QUOTE_LINK_STOPPED");
  const question = cleanAdminText(body.question, 1000);
  if (question.length < 5) {
    return adminJson({ ok: false, error: "Enter a clear question for the trade business." }, 400);
  }
  const questionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO trade_crm_quote_questions
      (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid,
       question, answer, status, asked_at, answered_at, answered_by_uid)
      SELECT ?, link.id, link.quote_id, link.quote_version_id, link.work_order_id,
        link.firebase_uid, ?, '', 'open', ?, '', ''
      FROM trade_crm_quote_links link
      WHERE link.id = ? AND link.quote_id = ? AND link.quote_version_id = ?
        AND link.work_order_id = ? AND link.firebase_uid = ? AND link.crm_customer_id = ?
        AND link.token_issue = ? AND link.token_hash = ? AND link.status = 'active'
        AND link.expires_at > ?`)
      .bind(questionId, question, now, link.id, link.quote_id, link.quote_version_id,
        link.work_order_id, link.firebase_uid, link.crm_customer_id, link.token_issue,
        link.token_hash, now),
    db.prepare(`INSERT INTO trade_crm_quote_events
      (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid,
       event_type, actor_type, summary, evidence_key, occurred_at)
      SELECT ?, question.quote_link_id, question.quote_id, question.quote_version_id,
        question.work_order_id, question.firebase_uid, 'questioned', 'link_holder',
        'Customer asked a quote question.', ?, ?
      FROM trade_crm_quote_questions question WHERE question.id = ?`)
      .bind(crypto.randomUUID(), `question:${questionId}`, now, questionId),
  ]);
  return adminJson({ ok: true, quote: await buildTradeQuoteReviewPayload(link) });
}

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) {
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  try {
    const token = (await context.params).token;
    const link = await authoriseTradeQuoteDecisionLink(token, {
      requireCurrentTradeAccess: true,
    });
    const body = await request.json() as Row;
    const action = cleanAdminText(body.action, 20);
    if (action === "ask_question") return await askQuestion(link, body);
    if (action !== "decide") {
      return adminJson({ ok: false, error: "Choose a valid quote action." }, 400);
    }
    if (!validQuoteDecisionId(body.clientDecisionId)) {
      return adminJson({ ok: false, error: "Refresh this quote before recording the decision." }, 400);
    }
    const clientDecisionId = body.clientDecisionId;
    const decision = cleanAdminText(body.decision, 20) as QuoteDecision;
    const signerName = normaliseQuoteDecisionSigner(body.signerName);
    if (!["accepted", "declined"].includes(decision) || signerName.length < 2) {
      return adminJson({
        ok: false,
        error: "Type the signer's full name and choose accept or decline.",
      }, 400);
    }
    if (body.consentConfirmed !== true) {
      return adminJson({ ok: false, error: "Confirm the exact quote decision statement." }, 400);
    }

    if (link.status !== "active") {
      const stored = await storedQuoteDecision(link);
      if (!stored) throw new Error("QUOTE_DECISION_RECEIPT_INVALID");
      if (decision === "accepted" && !Array.isArray(body.selectedChoiceIds)) {
        return adminJson({
          ok: false,
          error: "Choose one package and one answer from each required choice.",
        }, 400);
      }
      const selectedChoiceIds = decision === "accepted"
        ? (body.selectedChoiceIds as unknown[]).map(String).sort()
        : [];
      const replayPayloadSha256 = await quoteDecisionPayloadSha256({
        linkId: link.id,
        tokenIssue: link.token_issue,
        quoteVersionId: link.quote_version_id,
        decision,
        signerName,
        selectedChoiceIds,
        subtotalCents: decision === "accepted" ? stored.commercial.subtotalCents : 0,
        taxCents: decision === "accepted" ? stored.commercial.taxCents : 0,
        totalCents: decision === "accepted" ? stored.commercial.totalCents : 0,
      });
      return success(await exactQuoteDecisionReplay(
        link,
        clientDecisionId,
        replayPayloadSha256,
      ), true);
    }

    const snapshot = await quoteDocumentSnapshotForAuthorisedLink(link);
    const selection = decision === "accepted"
      ? calculateQuoteSelection({
        subtotalCents: snapshot.subtotalCents,
        taxCents: snapshot.taxCents,
        totalCents: snapshot.totalCents,
      }, quoteChoices(snapshot), body.selectedChoiceIds)
      : {
        selectedIds: [] as string[],
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
        selectionSummary: "",
      };
    selection.selectedIds.sort();
    const payloadSha256 = await quoteDecisionPayloadSha256({
      linkId: link.id,
      tokenIssue: link.token_issue,
      quoteVersionId: link.quote_version_id,
      decision,
      signerName,
      selectedChoiceIds: selection.selectedIds,
      subtotalCents: selection.subtotalCents,
      taxCents: selection.taxCents,
      totalCents: selection.totalCents,
    });
    const now = new Date().toISOString();
    const commercial = providerNeutralCommercialRecord({
      quoteNumber: snapshot.quoteNumber,
      versionNumber: snapshot.versionNumber,
      subtotalCents: selection.subtotalCents,
      taxCents: selection.taxCents,
      totalCents: selection.totalCents,
      selectedChoiceIds: selection.selectedIds,
    });
    const statement = decision === "accepted"
      ? `I, ${signerName}, accept quote ${snapshot.quoteNumber} version ${snapshot.versionNumber} for AUD ${(selection.totalCents / 100).toFixed(2)}${selection.selectionSummary ? ` with ${selection.selectionSummary}` : ""}, subject to its recorded terms.`
      : `I, ${signerName}, decline quote ${snapshot.quoteNumber} version ${snapshot.versionNumber}.`;
    const acceptanceId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const handoffId = decision === "accepted" ? crypto.randomUUID() : "";
    const invoiceId = decision === "accepted" ? crypto.randomUUID() : "";
    const invoiceNumber = decision === "accepted" ? `INV-${commercial.reference}` : "";
    const scope = decision === "accepted"
      ? acceptedScope(snapshot, selection.selectedIds, selection)
      : [];
    const db = getD1();
    const financeBefore = await db.prepare(`SELECT invoiced_value_cents,
        paid_value_cents, invoice_status, payment_due_at
      FROM trade_crm_job_details
      WHERE work_order_id = ? AND firebase_uid = ? AND crm_customer_id = ?
        AND customer_source IN ('trade_owned', 'public_lead_released')
      LIMIT 1`).bind(
        link.work_order_id, link.firebase_uid, link.crm_customer_id,
      ).first<Row>();
    if (!financeBefore) throw new Error("QUOTE_DECISION_CONFLICT");
    const existingInvoice = decision === "accepted"
      ? await existingInvoiceConflict(db, link)
      : false;
    if (decision === "accepted" && await existingAcceptedInvoice(db, link)) {
      throw new Error("QUOTE_JOB_ALREADY_ACCEPTED");
    }
    const invoice = decision === "accepted"
      ? await buildAcceptedInvoiceSnapshot({
        invoiceId,
        invoiceNumber,
        acceptanceId,
        commercialHandoffId: handoffId,
        quoteId: link.quote_id,
        quoteVersionId: link.quote_version_id,
        workOrderId: link.work_order_id,
        firebaseUid: link.firebase_uid,
        crmCustomerId: link.crm_customer_id,
        issuedAt: now,
        dueAt: dueDate(now),
        scope,
        totals: {
          subtotalCents: selection.subtotalCents,
          taxCents: selection.taxCents,
          totalCents: selection.totalCents,
        },
        business: {
          name: snapshot.business.name,
          email: snapshot.business.email,
          phone: snapshot.business.phone,
          abn: snapshot.business.abn,
          address: snapshot.business.address,
        },
        customer: {
          name: snapshot.customer.name,
          email: snapshot.customer.email,
          phone: "",
          number: snapshot.customer.number,
        },
        site: {
          label: snapshot.site.label,
          addressLine1: snapshot.site.addressLine1,
          addressLine2: snapshot.site.addressLine2,
          suburb: snapshot.site.suburb,
          state: snapshot.site.state,
          postcode: snapshot.site.postcode,
          summary: snapshot.site.summary,
        },
        work: { number: snapshot.work.number, title: snapshot.work.title },
        payment: {
          accountName: link.invoice_payment_account_name,
          bsb: link.invoice_payment_bsb,
          accountNumber: link.invoice_payment_account_number,
          reference: link.invoice_payment_reference || invoiceNumber,
          terms: link.invoice_default_terms,
        },
        issueBlockerCode: existingInvoice ? "ACCEPTED_INVOICE_CONFLICT" : undefined,
      })
      : null;
    const statements = [
      db.prepare(`INSERT INTO trade_crm_quote_acceptances
        (id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id,
         customer_firebase_uid, actor_email, actor_email_verified, actor_auth_time,
         actor_sign_in_provider, decision, consent_statement, selected_choice_ids_json,
         selected_subtotal_cents, selected_tax_cents, selected_total_cents,
         selection_summary, signer_name, actor_type, quote_link_id, token_issue,
         commercial_reference, currency, decided_at, created_at,
         decision_request_id, decision_payload_sha256, result_invoice_id,
         invoice_creation_status, invoice_creation_error_code)
        SELECT ?, link.quote_id, link.quote_version_id, link.work_order_id,
          link.firebase_uid, link.crm_customer_id, '', '', 0, 0, 'secure_link',
          ?, ?, ?, ?, ?, ?, ?, ?, 'secure_link_holder', link.id, link.token_issue,
          ?, 'AUD', ?, ?, ?, ?, ?, ?, ?
        FROM trade_crm_quote_links link
        JOIN trade_crm_quote_versions version
          ON version.id = link.quote_version_id AND version.quote_id = link.quote_id
          AND version.firebase_uid = link.firebase_uid AND version.status = 'issued'
        JOIN trade_crm_quotes quote
          ON quote.id = link.quote_id AND quote.firebase_uid = link.firebase_uid
          AND quote.work_order_id = link.work_order_id
          AND quote.crm_customer_id = link.crm_customer_id
          AND quote.current_version_number = version.version_number
        JOIN trade_work_orders work
          ON work.id = link.work_order_id AND work.firebase_uid = link.firebase_uid
          AND work.record_status = 'active'
        JOIN trade_crm_job_details detail
          ON detail.work_order_id = link.work_order_id AND detail.firebase_uid = link.firebase_uid
          AND detail.crm_customer_id = link.crm_customer_id
          AND detail.customer_source IN ('trade_owned', 'public_lead_released')
        JOIN trade_accounts trade
          ON trade.firebase_uid = link.firebase_uid AND trade.partner_type = 'installer'
          AND ${verifiedTradeAccountPredicate("trade")}
        WHERE link.id = ? AND link.quote_id = ? AND link.quote_version_id = ?
          AND link.work_order_id = ? AND link.firebase_uid = ? AND link.crm_customer_id = ?
          AND link.token_issue = ? AND link.token_hash = ? AND link.status = 'active'
          AND link.expires_at > ?
          AND (version.valid_until = '' OR version.valid_until >= ?)
          AND (? <> 'accepted' OR NOT ${existingAcceptedInvoiceSql})
          AND (? <> 'accepted'
            OR (? = 'attention_required' AND ${existingInvoiceConflictSql})
            OR (? = 'issued' AND NOT ${existingInvoiceConflictSql}))`)
        .bind(acceptanceId, decision, statement, JSON.stringify(selection.selectedIds),
          selection.subtotalCents, selection.taxCents, selection.totalCents,
          selection.selectionSummary, signerName, commercial.reference, now, now,
          clientDecisionId, payloadSha256, invoiceId,
          invoice?.status || "not_applicable", invoice?.issueBlockerCode || "",
          link.id, link.quote_id, link.quote_version_id, link.work_order_id,
          link.firebase_uid, link.crm_customer_id, link.token_issue, link.token_hash,
          now, now.slice(0, 10), decision, decision,
          invoice?.status || "not_applicable",
          invoice?.status || "not_applicable"),
      db.prepare(`UPDATE trade_crm_quote_versions SET status = ?, updated_at = ?
        WHERE id = ? AND quote_id = ? AND firebase_uid = ? AND version_number = ?
          AND status = 'issued' AND EXISTS (
            SELECT 1 FROM trade_crm_quote_acceptances acceptance
            WHERE acceptance.id = ? AND acceptance.quote_version_id = trade_crm_quote_versions.id
              AND acceptance.quote_link_id = ? AND acceptance.token_issue = ?
              AND acceptance.decision = ? AND acceptance.decision_request_id = ?
              AND acceptance.decision_payload_sha256 = ?)`)
        .bind(decision, now, link.quote_version_id, link.quote_id, link.firebase_uid,
          link.version_number, acceptanceId, link.id, link.token_issue, decision,
          clientDecisionId, payloadSha256),
      db.prepare(`UPDATE trade_crm_quotes SET status = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND current_version_number = ?
          AND EXISTS (SELECT 1 FROM trade_crm_quote_acceptances acceptance
            WHERE acceptance.id = ? AND acceptance.quote_id = trade_crm_quotes.id
              AND acceptance.quote_version_id = ?
              AND acceptance.firebase_uid = trade_crm_quotes.firebase_uid
              AND acceptance.decision = ?)`)
        .bind(decision, now, link.quote_id, link.firebase_uid, link.version_number,
          acceptanceId, link.quote_version_id, decision),
      db.prepare(`UPDATE trade_crm_quote_links
        SET status = ?, encrypted_token = '', updated_at = ?
        WHERE id = ? AND quote_id = ? AND quote_version_id = ? AND work_order_id = ?
          AND firebase_uid = ? AND crm_customer_id = ? AND token_issue = ?
          AND token_hash = ? AND status = 'active' AND expires_at > ?
          AND EXISTS (SELECT 1 FROM trade_crm_quote_acceptances acceptance
            WHERE acceptance.id = ? AND acceptance.quote_link_id = trade_crm_quote_links.id
              AND acceptance.quote_version_id = trade_crm_quote_links.quote_version_id
              AND acceptance.token_issue = trade_crm_quote_links.token_issue
              AND acceptance.decision = ?)`)
        .bind(decision, now, link.id, link.quote_id, link.quote_version_id,
          link.work_order_id, link.firebase_uid, link.crm_customer_id,
          link.token_issue, link.token_hash, now, acceptanceId, decision),
      db.prepare(`UPDATE trade_crm_job_details
        SET quoted_value_cents = ?, quote_status = ?,
          invoiced_value_cents = CASE WHEN ? = 'issued' THEN ? ELSE invoiced_value_cents END,
          invoice_status = CASE WHEN ? = 'issued' THEN ? ELSE invoice_status END,
          payment_due_at = CASE WHEN ? = 'issued' THEN ? ELSE payment_due_at END,
          updated_at = ?
        WHERE work_order_id = ? AND firebase_uid = ? AND crm_customer_id = ?
          AND customer_source IN ('trade_owned', 'public_lead_released')
          AND EXISTS (SELECT 1 FROM trade_crm_quote_acceptances acceptance
            WHERE acceptance.id = ?
              AND acceptance.work_order_id = trade_crm_job_details.work_order_id
              AND acceptance.firebase_uid = trade_crm_job_details.firebase_uid
              AND acceptance.crm_customer_id = trade_crm_job_details.crm_customer_id
              AND acceptance.decision = ?)`)
        .bind(selection.totalCents || snapshot.totalCents, decision,
          invoice?.status || "not_applicable", invoice?.totalCents || 0,
          invoice?.status || "not_applicable", invoice?.status || "not_started",
          invoice?.status || "not_applicable", invoice?.dueAt || "", now,
          link.work_order_id, link.firebase_uid, link.crm_customer_id,
          acceptanceId, decision),
      db.prepare(`INSERT INTO trade_crm_quote_events
        (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid,
         event_type, actor_type, summary, evidence_key, occurred_at)
        SELECT ?, link.id, link.quote_id, link.quote_version_id, link.work_order_id,
          link.firebase_uid, acceptance.decision, 'link_holder', ?, ?, ?
        FROM trade_crm_quote_links link
        JOIN trade_crm_quote_acceptances acceptance
          ON acceptance.id = ? AND acceptance.quote_link_id = link.id
          AND acceptance.quote_version_id = link.quote_version_id
          AND acceptance.token_issue = link.token_issue
        WHERE link.id = ? AND link.quote_id = ? AND link.quote_version_id = ?
          AND link.work_order_id = ? AND link.firebase_uid = ?
          AND link.crm_customer_id = ?`)
        .bind(eventId, `Quote ${decision} with typed signature and exact total evidence.`,
          `decision:${link.quote_version_id}`, now, acceptanceId, link.id,
          link.quote_id, link.quote_version_id, link.work_order_id,
          link.firebase_uid, link.crm_customer_id),
    ];
    if (decision === "accepted" && invoice) {
      statements.push(
        db.prepare(`INSERT INTO trade_crm_commercial_handovers
          (id, acceptance_id, quote_id, quote_version_id, work_order_id, firebase_uid,
           crm_customer_id, commercial_reference, currency, scope_snapshot_json,
           terms_snapshot, subtotal_cents, tax_cents, total_cents, deposit_kind,
           deposit_basis_points, deposit_fixed_cents, deposit_amount_cents, status,
           accepted_at, created_at, updated_at)
          SELECT ?, acceptance.id, acceptance.quote_id, acceptance.quote_version_id,
            acceptance.work_order_id, acceptance.firebase_uid, acceptance.crm_customer_id,
            acceptance.commercial_reference, acceptance.currency, ?, ?,
            acceptance.selected_subtotal_cents, acceptance.selected_tax_cents,
            acceptance.selected_total_cents, 'percentage', 1000, 0, ?, 'accepted',
            acceptance.decided_at, ?, ?
          FROM trade_crm_quote_acceptances acceptance
          WHERE acceptance.id = ? AND acceptance.quote_id = ?
            AND acceptance.quote_version_id = ? AND acceptance.work_order_id = ?
            AND acceptance.firebase_uid = ? AND acceptance.crm_customer_id = ?
            AND acceptance.quote_link_id = ? AND acceptance.token_issue = ?
            AND acceptance.decision = 'accepted'
            AND acceptance.selected_subtotal_cents = ?
            AND acceptance.selected_tax_cents = ?
            AND acceptance.selected_total_cents = ?`)
          .bind(handoffId, JSON.stringify(scope), snapshot.terms,
            depositAmountCents(selection.totalCents, "percentage", 1000), now, now,
            acceptanceId, link.quote_id, link.quote_version_id, link.work_order_id,
            link.firebase_uid, link.crm_customer_id, link.id, link.token_issue,
            selection.subtotalCents, selection.taxCents, selection.totalCents),
        db.prepare(`INSERT INTO trade_crm_accepted_invoices
          (id, acceptance_id, commercial_handoff_id, quote_id, quote_version_id,
           work_order_id, firebase_uid, crm_customer_id, invoice_number, currency,
           document_label, source_snapshot_sha256, document_snapshot_json,
           subtotal_cents, tax_cents, total_cents, due_at, status,
           issue_blocker_code, payment_snapshot_json, created_at, updated_at)
          SELECT ?, acceptance.id, handoff.id, acceptance.quote_id,
            acceptance.quote_version_id, acceptance.work_order_id,
            acceptance.firebase_uid, acceptance.crm_customer_id, ?, 'AUD', ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM trade_crm_quote_acceptances acceptance
          JOIN trade_crm_commercial_handovers handoff
            ON handoff.id = ? AND handoff.acceptance_id = acceptance.id
            AND handoff.quote_id = acceptance.quote_id
            AND handoff.quote_version_id = acceptance.quote_version_id
            AND handoff.work_order_id = acceptance.work_order_id
            AND handoff.firebase_uid = acceptance.firebase_uid
            AND handoff.crm_customer_id = acceptance.crm_customer_id
          WHERE acceptance.id = ? AND acceptance.result_invoice_id = ?
            AND acceptance.invoice_creation_status = ?
            AND acceptance.selected_subtotal_cents = ?
            AND acceptance.selected_tax_cents = ?
            AND acceptance.selected_total_cents = ?`)
          .bind(invoiceId, invoiceNumber, invoice.documentLabel,
            invoice.sourceSnapshotSha256, invoice.documentSnapshotJson,
            invoice.subtotalCents, invoice.taxCents, invoice.totalCents,
            invoice.dueAt, invoice.status, invoice.issueBlockerCode,
            invoice.paymentSnapshotJson, now, now, handoffId, acceptanceId,
            invoiceId, invoice.status, selection.subtotalCents,
            selection.taxCents, selection.totalCents),
      );
    }
    statements.push(db.prepare(`INSERT INTO trade_accounts
      SELECT guard.* FROM trade_accounts guard
      WHERE guard.firebase_uid = ? AND NOT (
        EXISTS (SELECT 1 FROM trade_crm_quote_acceptances acceptance
          WHERE acceptance.id = ? AND acceptance.quote_link_id = ?
            AND acceptance.token_issue = ? AND acceptance.decision = ?
            AND acceptance.decision_request_id = ?
            AND acceptance.decision_payload_sha256 = ?)
        AND EXISTS (SELECT 1 FROM trade_crm_quote_versions version
          WHERE version.id = ? AND version.quote_id = ? AND version.firebase_uid = ?
            AND version.status = ?)
        AND EXISTS (SELECT 1 FROM trade_crm_quotes quote
          WHERE quote.id = ? AND quote.firebase_uid = ? AND quote.status = ?
            AND quote.work_order_id = ? AND quote.crm_customer_id = ?)
        AND EXISTS (SELECT 1 FROM trade_crm_quote_links link
          WHERE link.id = ? AND link.quote_id = ? AND link.quote_version_id = ?
            AND link.work_order_id = ? AND link.firebase_uid = ?
            AND link.crm_customer_id = ? AND link.token_issue = ?
            AND link.token_hash = ? AND link.encrypted_token = '' AND link.status = ?)
        AND EXISTS (SELECT 1 FROM trade_crm_job_details detail
          WHERE detail.work_order_id = ? AND detail.firebase_uid = ?
            AND detail.crm_customer_id = ? AND detail.quote_status = ?
            AND detail.paid_value_cents = ?
            AND ((? <> 'issued'
              AND detail.invoiced_value_cents = ?
              AND detail.invoice_status = ? AND detail.payment_due_at = ?)
              OR (? = 'issued'
              AND detail.invoiced_value_cents = ?
              AND detail.invoice_status = ? AND detail.payment_due_at = ?)))
        AND EXISTS (SELECT 1 FROM trade_crm_quote_events event
          WHERE event.id = ? AND event.quote_link_id = ?
            AND event.quote_version_id = ? AND event.event_type = ?)
        AND ((? = 'declined'
          AND NOT EXISTS (SELECT 1 FROM trade_crm_commercial_handovers handoff
            WHERE handoff.acceptance_id = ?)
          AND NOT EXISTS (SELECT 1 FROM trade_crm_accepted_invoices invoice
            WHERE invoice.acceptance_id = ?))
          OR (? = 'accepted'
            AND EXISTS (SELECT 1 FROM trade_crm_commercial_handovers handoff
              WHERE handoff.id = ? AND handoff.acceptance_id = ?
                AND handoff.quote_version_id = ? AND handoff.total_cents = ?)
            AND EXISTS (SELECT 1 FROM trade_crm_accepted_invoices invoice
              WHERE invoice.id = ? AND invoice.acceptance_id = ?
                AND invoice.commercial_handoff_id = ?
                AND invoice.quote_version_id = ? AND invoice.total_cents = ?)))
      )`).bind(
        link.firebase_uid, acceptanceId, link.id, link.token_issue, decision,
        clientDecisionId, payloadSha256, link.quote_version_id, link.quote_id,
        link.firebase_uid, decision, link.quote_id, link.firebase_uid, decision,
        link.work_order_id, link.crm_customer_id,
        link.id, link.quote_id, link.quote_version_id, link.work_order_id,
        link.firebase_uid, link.crm_customer_id, link.token_issue, link.token_hash,
        decision, link.work_order_id, link.firebase_uid, link.crm_customer_id,
        decision, Number(financeBefore.paid_value_cents || 0),
        invoice?.status || "not_applicable",
        Number(financeBefore.invoiced_value_cents || 0),
        String(financeBefore.invoice_status || ""),
        String(financeBefore.payment_due_at || ""),
        invoice?.status || "not_applicable", invoice?.totalCents || 0,
        invoice?.status || "not_started", invoice?.dueAt || "",
        eventId, link.id, link.quote_version_id, decision,
        decision, acceptanceId, acceptanceId, decision, handoffId, acceptanceId,
        link.quote_version_id, selection.totalCents, invoiceId, acceptanceId,
        handoffId, link.quote_version_id, selection.totalCents,
      ));

    try {
      await db.batch(statements);
    } catch (writeError) {
      let replayMismatch: unknown = null;
      try {
        return success(await exactQuoteDecisionReplay(
          link,
          clientDecisionId,
          payloadSha256,
        ), true);
      } catch (replayError) {
        replayMismatch = replayError;
        if (decision === "accepted" && await existingAcceptedInvoice(db, link)) {
          throw new Error("QUOTE_JOB_ALREADY_ACCEPTED");
        }
        if (decision === "accepted" && await existingInvoiceConflict(db, link)) {
          throw new Error("QUOTE_DECISION_CONFLICT");
        }
        if (replayMismatch instanceof Error &&
            replayMismatch.message === "QUOTE_DECISION_REPLAY_MISMATCH") {
          throw replayMismatch;
        }
        throw writeError;
      }
    }
    return success(await exactQuoteDecisionReplay(
      { ...link, status: decision },
      clientDecisionId,
      payloadSha256,
    ), false);
  } catch (error) {
    return publicError(error, "decision");
  }
}
