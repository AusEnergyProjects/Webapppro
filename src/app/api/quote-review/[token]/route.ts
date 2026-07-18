import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { calculateQuoteSelection, type QuoteChoiceTotals } from "@/lib/trade-quote-options";
import { providerNeutralCommercialRecord } from "@/lib/trade-commercial-reference";
import { hashQuoteLinkSecret, splitQuoteLinkToken } from "@/lib/trade-quote-links";
import { acceptedScopeSnapshot, depositAmountCents } from "@/lib/trade-commercial-handoff";

export const runtime = "edge";
type Context = { params: Promise<{ token: string }> };
type Row = Record<string, unknown>;

function publicError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (["QUOTE_LINK_INVALID", "QUOTE_LINK_NOT_FOUND"].includes(code)) return adminJson({ ok: false, error: "This quote link is not valid." }, 404);
  if (code === "QUOTE_LINK_EXPIRED") return adminJson({ ok: false, error: "This quote link has expired. Ask the trade business for a new one." }, 410);
  if (code === "QUOTE_LINK_STOPPED") return adminJson({ ok: false, error: "This quote link is no longer active." }, 410);
  if (code === "INVALID_QUOTE_SELECTION") return adminJson({ ok: false, error: "Choose one package and one answer from each required choice." }, 400);
  return adminJson({ ok: false, error: "This quote could not be opened." }, 500);
}

async function authorisedLink(token: string) {
  const { linkId, secret } = splitQuoteLinkToken(token); const db = getD1();
  const row = await db.prepare(`SELECT link.*, version.version_number, version.status version_status, version.subtotal_cents,
      version.tax_cents, version.total_cents, version.terms, version.valid_until, version.consent_statement, version.issued_at,
      quote.quote_number, quote.current_version_number, work.work_number, work.title work_title,
      customer.customer_number, CASE WHEN customer.business_name != '' THEN customer.business_name ELSE TRIM(customer.first_name || ' ' || customer.last_name) END customer_name,
      site.site_label, site.address_line_1, site.suburb, site.address_state, site.postcode,
      trade.business_name trade_business_name, trade.email trade_email, trade.phone trade_phone, trade.abn trade_abn
    FROM trade_crm_quote_links link
    JOIN trade_crm_quote_versions version ON version.id = link.quote_version_id AND version.firebase_uid = link.firebase_uid
    JOIN trade_crm_quotes quote ON quote.id = link.quote_id AND quote.firebase_uid = link.firebase_uid
    JOIN trade_work_orders work ON work.id = link.work_order_id AND work.firebase_uid = link.firebase_uid AND work.record_status = 'active'
    JOIN trade_crm_customers customer ON customer.id = link.crm_customer_id AND customer.firebase_uid = link.firebase_uid AND customer.record_status = 'active'
    JOIN trade_crm_service_sites site ON site.id = quote.service_site_id AND site.customer_id = customer.id AND site.firebase_uid = link.firebase_uid AND site.record_status = 'active'
    JOIN trade_accounts trade ON trade.firebase_uid = link.firebase_uid
    WHERE link.id = ? LIMIT 1`).bind(linkId).first<Row>();
  if (!row || !row.token_hash || await hashQuoteLinkSecret(secret) !== row.token_hash) throw new Error("QUOTE_LINK_NOT_FOUND");
  const now = new Date().toISOString();
  if (String(row.expires_at) <= now || (row.valid_until && String(row.valid_until) < now.slice(0, 10))) throw new Error("QUOTE_LINK_EXPIRED");
  if (row.status !== "active" || row.version_status !== "issued" || Number(row.version_number) !== Number(row.current_version_number)) throw new Error("QUOTE_LINK_STOPPED");
  return row;
}

function publicLine(item: Row) {
  return { id: String(item.id), description: String(item.description), quantityMilli: Number(item.quantity_milli), unitPriceCents: Number(item.unit_price_cents),
    subtotalCents: Number(item.subtotal_cents), taxCents: Number(item.tax_cents), totalCents: Number(item.total_cents), sectionHeading: String(item.section_heading || "Included work") };
}

async function reviewPayload(row: Row) {
  const db = getD1(); const [items, choices, questions] = await Promise.all([
    db.prepare("SELECT * FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position").bind(row.quote_version_id, row.firebase_uid).all<Row>(),
    db.prepare("SELECT * FROM trade_crm_quote_choices WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position").bind(row.quote_version_id, row.firebase_uid).all<Row>(),
    db.prepare("SELECT id, question, answer, status, asked_at, answered_at FROM trade_crm_quote_questions WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY asked_at").bind(row.quote_version_id, row.firebase_uid).all<Row>(),
  ]);
  return {
    linkId: String(row.id), tokenIssue: Number(row.token_issue), quoteVersionId: String(row.quote_version_id), quoteNumber: String(row.quote_number), versionNumber: Number(row.version_number),
    workNumber: String(row.work_number), workTitle: String(row.work_title), customerName: String(row.customer_name), customerNumber: String(row.customer_number),
    siteLabel: String(row.site_label), siteSummary: [row.address_line_1, row.suburb, row.address_state, row.postcode].filter(Boolean).join(", "),
    business: { name: String(row.trade_business_name), email: String(row.trade_email), phone: String(row.trade_phone), abn: String(row.trade_abn) },
    subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents), terms: String(row.terms || ""),
    validUntil: String(row.valid_until || ""), issuedAt: String(row.issued_at), consentStatement: String(row.consent_statement || ""), expiresAt: String(row.expires_at),
    items: items.results.filter((item) => !item.quote_choice_id).map(publicLine),
    choices: choices.results.map((choice) => ({ id: String(choice.id), kind: String(choice.choice_kind), groupKey: String(choice.group_key), name: String(choice.name), summary: String(choice.summary || ""),
      recommended: Boolean(choice.recommended), subtotalCents: Number(choice.subtotal_cents), taxCents: Number(choice.tax_cents), totalCents: Number(choice.total_cents),
      items: items.results.filter((item) => item.quote_choice_id === choice.id).map(publicLine) })),
    questions: questions.results.map((question) => ({ id: String(question.id), question: String(question.question), answer: String(question.answer || ""), status: String(question.status), askedAt: String(question.asked_at), answeredAt: String(question.answered_at || "") })),
  };
}

export async function GET(_request: Request, context: Context) {
  try {
    const row = await authorisedLink((await context.params).token); const now = new Date().toISOString();
    await getD1().prepare(`INSERT OR IGNORE INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, 'viewed', 'link_holder', 'Secure quote opened.', ?, ?)`)
      .bind(crypto.randomUUID(), row.id, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, `view:${row.id}:${now.slice(0, 10)}`, now).run();
    return adminJson({ ok: true, quote: await reviewPayload(row) });
  } catch (error) { return publicError(error); }
}

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const row = await authorisedLink((await context.params).token); const body = await request.json() as Row; const action = cleanAdminText(body.action, 20); const now = new Date().toISOString(); const db = getD1();
    if (action === "ask_question") {
      const question = cleanAdminText(body.question, 1000); if (question.length < 5) return adminJson({ ok: false, error: "Enter a clear question for the trade business." }, 400);
      const questionId = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO trade_crm_quote_questions (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, question, answer, status, asked_at, answered_at, answered_by_uid)
          VALUES (?, ?, ?, ?, ?, ?, ?, '', 'open', ?, '', '')`).bind(questionId, row.id, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, question, now),
        db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, 'questioned', 'link_holder', 'Customer asked a quote question.', ?, ?)`).bind(crypto.randomUUID(), row.id, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, `question:${questionId}`, now),
      ]);
      return adminJson({ ok: true, quote: await reviewPayload(row) });
    }
    if (action !== "decide") return adminJson({ ok: false, error: "Choose a valid quote action." }, 400);
    const decision = cleanAdminText(body.decision, 20); const signerName = cleanAdminText(body.signerName, 160);
    if (!["accepted", "declined"].includes(decision) || signerName.length < 2) return adminJson({ ok: false, error: "Type the signer's full name and choose accept or decline." }, 400);
    if (body.consentConfirmed !== true) return adminJson({ ok: false, error: "Confirm the exact quote decision statement." }, 400);
    const choiceRows = await db.prepare("SELECT id, choice_kind, group_key, name, subtotal_cents, tax_cents, total_cents FROM trade_crm_quote_choices WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position").bind(row.quote_version_id, row.firebase_uid).all<Row>();
    const choices: QuoteChoiceTotals[] = choiceRows.results.map((choice) => ({ id: String(choice.id), kind: String(choice.choice_kind) as QuoteChoiceTotals["kind"], groupKey: String(choice.group_key), name: String(choice.name), subtotalCents: Number(choice.subtotal_cents), taxCents: Number(choice.tax_cents), totalCents: Number(choice.total_cents) }));
    const selection = decision === "accepted" ? calculateQuoteSelection({ subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents) }, choices, body.selectedChoiceIds)
      : { selectedIds: [] as string[], subtotalCents: 0, taxCents: 0, totalCents: 0, selectionSummary: "" };
    const commercial = providerNeutralCommercialRecord({ quoteNumber: String(row.quote_number), versionNumber: Number(row.version_number), subtotalCents: selection.subtotalCents, taxCents: selection.taxCents, totalCents: selection.totalCents, selectedChoiceIds: selection.selectedIds });
    const statement = decision === "accepted" ? `I, ${signerName}, accept quote ${row.quote_number} version ${row.version_number} for AUD ${(selection.totalCents / 100).toFixed(2)}${selection.selectionSummary ? ` with ${selection.selectionSummary}` : ""}, subject to its recorded terms.` : `I, ${signerName}, decline quote ${row.quote_number} version ${row.version_number}.`;
    const acceptanceId = crypto.randomUUID();
    const statements = [
      db.prepare(`INSERT INTO trade_crm_quote_acceptances (id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, customer_firebase_uid, actor_email, actor_email_verified, actor_auth_time, actor_sign_in_provider, decision, consent_statement, selected_choice_ids_json, selected_subtotal_cents, selected_tax_cents, selected_total_cents, selection_summary, signer_name, actor_type, quote_link_id, token_issue, commercial_reference, currency, decided_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '', '', 0, 0, 'secure_link', ?, ?, ?, ?, ?, ?, ?, ?, 'secure_link_holder', ?, ?, ?, 'AUD', ?, ?)`)
        .bind(acceptanceId, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, row.crm_customer_id, decision, statement, JSON.stringify(selection.selectedIds), selection.subtotalCents, selection.taxCents, selection.totalCents, selection.selectionSummary, signerName, row.id, row.token_issue, commercial.reference, now, now),
      db.prepare("UPDATE trade_crm_quote_versions SET status = ?, updated_at = ? WHERE id = ? AND status = 'issued'").bind(decision, now, row.quote_version_id),
      db.prepare("UPDATE trade_crm_quotes SET status = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(decision, now, row.quote_id, row.firebase_uid),
      db.prepare("UPDATE trade_crm_quote_links SET status = ?, token_hash = '', encrypted_token = '', updated_at = ? WHERE id = ? AND token_issue = ?").bind(decision, now, row.id, row.token_issue),
      db.prepare("UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?").bind(selection.totalCents || row.total_cents, decision, now, row.work_order_id, row.firebase_uid),
      db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'link_holder', ?, ?, ?)`).bind(crypto.randomUUID(), row.id, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid, decision, `Quote ${decision} with typed signature and exact total evidence.`, `decision:${row.quote_version_id}`, now),
    ];
    if (decision === "accepted") {
      const itemRows = await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position`)
        .bind(row.quote_version_id, row.firebase_uid).all<Row>();
      const scope = acceptedScopeSnapshot(itemRows.results, selection.selectedIds);
      statements.push(db.prepare(`INSERT INTO trade_crm_commercial_handovers
        (id, acceptance_id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, commercial_reference,
         currency, scope_snapshot_json, terms_snapshot, subtotal_cents, tax_cents, total_cents, deposit_kind,
         deposit_basis_points, deposit_fixed_cents, deposit_amount_cents, status, accepted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, 'percentage', 1000, 0, ?, 'accepted', ?, ?, ?)`)
        .bind(crypto.randomUUID(), acceptanceId, row.quote_id, row.quote_version_id, row.work_order_id, row.firebase_uid,
          row.crm_customer_id, commercial.reference, JSON.stringify(scope), String(row.terms || ""), selection.subtotalCents,
          selection.taxCents, selection.totalCents, depositAmountCents(selection.totalCents, "percentage", 1000), now, now, now));
    }
    await db.batch(statements);
    return adminJson({ ok: true, decision, commercial });
  } catch (error) { return publicError(error); }
}
