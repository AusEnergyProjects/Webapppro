import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { calculateQuoteSelection, type QuoteChoiceTotals } from "@/lib/trade-quote-options";
import { providerNeutralCommercialRecord } from "@/lib/trade-commercial-reference";
import { acceptedScopeSnapshot, depositAmountCents } from "@/lib/trade-commercial-handoff";
import {
  authoriseTradeQuoteLink,
  buildTradeQuoteReviewPayload,
  quoteDocumentSnapshotForAuthorisedLink,
  tradeQuoteTokenErrorResponse,
} from "@/lib/trade-quote-review-server";

export const runtime = "edge";
type Context = { params: Promise<{ token: string }> };
type Row = Record<string, unknown>;

function publicError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "INVALID_QUOTE_SELECTION") return adminJson({ ok: false, error: "Choose one package and one answer from each required choice." }, 400);
  return tradeQuoteTokenErrorResponse(error);
}

export async function GET(_request: Request, context: Context) {
  try {
    const row = await authoriseTradeQuoteLink((await context.params).token); const now = new Date().toISOString();
    await getD1().prepare(`INSERT OR IGNORE INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, 'viewed', 'link_holder', 'Secure quote opened.', ?, ?)`)
      .bind(crypto.randomUUID(), row.id, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, `view:${row.id}:${now.slice(0, 10)}`, now).run();
    return adminJson({ ok: true, quote: await buildTradeQuoteReviewPayload(row) });
  } catch (error) { return publicError(error); }
}

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const row = await authoriseTradeQuoteLink((await context.params).token); const body = await request.json() as Row; const action = cleanAdminText(body.action, 20); const now = new Date().toISOString(); const db = getD1();
    if (action === "ask_question") {
      const question = cleanAdminText(body.question, 1000); if (question.length < 5) return adminJson({ ok: false, error: "Enter a clear question for the trade business." }, 400);
      const questionId = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO trade_crm_quote_questions (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, question, answer, status, asked_at, answered_at, answered_by_uid)
          VALUES (?, ?, ?, ?, ?, ?, ?, '', 'open', ?, '', '')`).bind(questionId, row.id, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, question, now),
        db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, 'questioned', 'link_holder', 'Customer asked a quote question.', ?, ?)`).bind(crypto.randomUUID(), row.id, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, `question:${questionId}`, now),
      ]);
      return adminJson({ ok: true, quote: await buildTradeQuoteReviewPayload(row) });
    }
    if (action !== "decide") return adminJson({ ok: false, error: "Choose a valid quote action." }, 400);
    const decision = cleanAdminText(body.decision, 20); const signerName = cleanAdminText(body.signerName, 160);
    if (!["accepted", "declined"].includes(decision) || signerName.length < 2) return adminJson({ ok: false, error: "Type the signer's full name and choose accept or decline." }, 400);
    if (body.consentConfirmed !== true) return adminJson({ ok: false, error: "Confirm the exact quote decision statement." }, 400);
    const snapshot = await quoteDocumentSnapshotForAuthorisedLink(row);
    const choices: QuoteChoiceTotals[] = snapshot.choices.map((choice) => ({
      id: choice.id,
      kind: choice.kind,
      groupKey: choice.groupKey,
      name: choice.name,
      subtotalCents: choice.subtotalCents,
      taxCents: choice.taxCents,
      totalCents: choice.totalCents,
    }));
    const selection = decision === "accepted" ? calculateQuoteSelection({
      subtotalCents: snapshot.subtotalCents,
      taxCents: snapshot.taxCents,
      totalCents: snapshot.totalCents,
    }, choices, body.selectedChoiceIds)
      : { selectedIds: [] as string[], subtotalCents: 0, taxCents: 0, totalCents: 0, selectionSummary: "" };
    const commercial = providerNeutralCommercialRecord({ quoteNumber: snapshot.quoteNumber, versionNumber: snapshot.versionNumber, subtotalCents: selection.subtotalCents, taxCents: selection.taxCents, totalCents: selection.totalCents, selectedChoiceIds: selection.selectedIds });
    const statement = decision === "accepted" ? `I, ${signerName}, accept quote ${snapshot.quoteNumber} version ${snapshot.versionNumber} for AUD ${(selection.totalCents / 100).toFixed(2)}${selection.selectionSummary ? ` with ${selection.selectionSummary}` : ""}, subject to its recorded terms.` : `I, ${signerName}, decline quote ${snapshot.quoteNumber} version ${snapshot.versionNumber}.`;
    const acceptanceId = crypto.randomUUID();
    const statements = [
      db.prepare(`INSERT INTO trade_crm_quote_acceptances (id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, customer_firebase_uid, actor_email, actor_email_verified, actor_auth_time, actor_sign_in_provider, decision, consent_statement, selected_choice_ids_json, selected_subtotal_cents, selected_tax_cents, selected_total_cents, selection_summary, signer_name, actor_type, quote_link_id, token_issue, commercial_reference, currency, decided_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '', '', 0, 0, 'secure_link', ?, ?, ?, ?, ?, ?, ?, ?, 'secure_link_holder', ?, ?, ?, 'AUD', ?, ?)`)
        .bind(acceptanceId, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, row.crm_customer_id, decision, statement, JSON.stringify(selection.selectedIds), selection.subtotalCents, selection.taxCents, selection.totalCents, selection.selectionSummary, signerName, row.id, row.token_issue, commercial.reference, now, now),
      db.prepare("UPDATE trade_crm_quote_versions SET status = ?, updated_at = ? WHERE id = ? AND status = 'issued'").bind(decision, now, row.quote_version_id),
      db.prepare("UPDATE trade_crm_quotes SET status = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(decision, now, row.quote_id, row.firebase_uid),
      db.prepare("UPDATE trade_crm_quote_links SET status = ?, token_hash = '', encrypted_token = '', updated_at = ? WHERE id = ? AND token_issue = ?").bind(decision, now, row.id, row.token_issue),
      db.prepare("UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?").bind(selection.totalCents || snapshot.totalCents, decision, now, row.work_order_id, row.firebase_uid),
      db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'link_holder', ?, ?, ?)`).bind(crypto.randomUUID(), row.id, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, decision, `Quote ${decision} with typed signature and exact total evidence.`, `decision:${row.quote_version_id}`, now),
    ];
    if (decision === "accepted") {
      const scopeRows = [
        ...snapshot.items.map((item) => ({
          id: item.id,
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
          section_heading: item.sectionHeading,
          description: item.description,
          quantity_milli: item.quantityMilli,
          subtotal_cents: item.subtotalCents,
          tax_cents: item.taxCents,
          total_cents: item.totalCents,
          quote_choice_id: choice.id,
        }))),
      ];
      const scope = acceptedScopeSnapshot(scopeRows, selection.selectedIds);
      statements.push(db.prepare(`INSERT INTO trade_crm_commercial_handovers
        (id, acceptance_id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, commercial_reference,
         currency, scope_snapshot_json, terms_snapshot, subtotal_cents, tax_cents, total_cents, deposit_kind,
         deposit_basis_points, deposit_fixed_cents, deposit_amount_cents, status, accepted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, 'percentage', 1000, 0, ?, 'accepted', ?, ?, ?)`)
        .bind(crypto.randomUUID(), acceptanceId, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid,
          row.crm_customer_id, commercial.reference, JSON.stringify(scope), snapshot.terms, selection.subtotalCents,
          selection.taxCents, selection.totalCents, depositAmountCents(selection.totalCents, "percentage", 1000), now, now, now));
    }
    await db.batch(statements);
    return adminJson({ ok: true, decision, commercial });
  } catch (error) { return publicError(error); }
}
