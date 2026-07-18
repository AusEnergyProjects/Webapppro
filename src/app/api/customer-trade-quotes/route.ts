import { getD1 } from "../../../../db";
import { requireFirebaseIdentity, type FirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { calculateQuoteSelection, type QuoteChoiceTotals } from "@/lib/trade-quote-options";
import { providerNeutralCommercialRecord } from "@/lib/trade-commercial-reference";
import { acceptedScopeSnapshot, depositAmountCents } from "@/lib/trade-commercial-handoff";

export const runtime = "edge";
type Row = Record<string, unknown>;

async function customerIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  if (!identity.emailVerified) throw new Error("EMAIL_VERIFICATION_REQUIRED");
  const account = await getD1().prepare(`SELECT firebase_uid FROM customer_accounts WHERE firebase_uid = ? AND email = ? AND account_status = 'active'`)
    .bind(identity.uid, identity.email).first();
  if (!account) throw new Error("CUSTOMER_ACCOUNT_REQUIRED");
  return identity;
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "EMAIL_VERIFICATION_REQUIRED") return adminJson({ ok: false, error: "Verify your account email before reviewing direct trade quotes." }, 403);
  if (code === "CUSTOMER_ACCOUNT_REQUIRED") return adminJson({ ok: false, error: "Complete your customer account before reviewing direct trade quotes." }, 403);
  if (code === "QUOTE_NOT_FOUND") return adminJson({ ok: false, error: "This quote is no longer available for a decision." }, 404);
  if (code === "QUOTE_EXPIRED") return adminJson({ ok: false, error: "This quote has expired. Ask the installer to issue a new version." }, 409);
  if (code === "INVALID_QUOTE_SELECTION") return adminJson({ ok: false, error: "Choose one package and one answer from every required choice before accepting." }, 400);
  return adminJson({ ok: false, error: "The private quote review could not be completed." }, 500);
}

function publicLine(item: Row) {
  return { id: String(item.id), position: Number(item.position), lineType: String(item.line_type), description: String(item.description),
    quantityMilli: Number(item.quantity_milli), unitPriceCents: Number(item.unit_price_cents), taxCode: String(item.tax_code),
    subtotalCents: Number(item.subtotal_cents), taxCents: Number(item.tax_cents), totalCents: Number(item.total_cents),
    sectionHeading: String(item.section_heading || "Included work") };
}

async function customerQuotes(identity: FirebaseIdentity) {
  const db = getD1();
  const rows = await db.prepare(`SELECT v.*, q.quote_number, q.work_order_id, q.crm_customer_id, q.service_site_id,
      w.work_number, w.title work_title, c.customer_number,
      CASE WHEN c.business_name != '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
      s.site_label, s.address_line_1, s.suburb, s.address_state, s.postcode,
      a.decision, a.decided_at, a.selected_choice_ids_json, a.selected_subtotal_cents, a.selected_tax_cents,
      a.selected_total_cents, a.selection_summary
    FROM trade_crm_quote_versions v JOIN trade_crm_quotes q ON q.id = v.quote_id AND q.firebase_uid = v.firebase_uid
    JOIN trade_work_orders w ON w.id = q.work_order_id AND w.firebase_uid = q.firebase_uid AND w.record_status = 'active'
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid AND d.customer_source = 'trade_owned'
      AND d.crm_customer_id = q.crm_customer_id AND d.service_site_id = q.service_site_id
    JOIN trade_crm_customers c ON c.id = q.crm_customer_id AND c.firebase_uid = q.firebase_uid AND c.record_status = 'active'
    JOIN trade_crm_service_sites s ON s.id = q.service_site_id AND s.customer_id = c.id AND s.firebase_uid = q.firebase_uid AND s.record_status = 'active'
    LEFT JOIN trade_crm_quote_acceptances a ON a.quote_version_id = v.id
    WHERE v.acceptance_email = ? AND v.issued_at != ''
    ORDER BY v.issued_at DESC, v.quote_id, v.version_number DESC LIMIT 100`).bind(identity.email).all<Row>();
  const versionIds = rows.results.map((row) => String(row.id)); const placeholders = versionIds.map(() => "?").join(",");
  const itemRows = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE quote_version_id IN (${placeholders}) ORDER BY quote_version_id, position`).bind(...versionIds).all<Row>() : { results: [] as Row[] };
  const choiceRows = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_choices WHERE quote_version_id IN (${placeholders}) ORDER BY quote_version_id, position`).bind(...versionIds).all<Row>() : { results: [] as Row[] };
  return rows.results.map((row) => {
    const items = itemRows.results.filter((item) => item.quote_version_id === row.id);
    const choices = choiceRows.results.filter((choice) => choice.quote_version_id === row.id).map((choice) => ({
      id: String(choice.id), kind: String(choice.choice_kind), groupKey: String(choice.group_key), name: String(choice.name),
      summary: String(choice.summary || ""), recommended: Boolean(choice.recommended), subtotalCents: Number(choice.subtotal_cents),
      taxCents: Number(choice.tax_cents), totalCents: Number(choice.total_cents),
      items: items.filter((item) => item.quote_choice_id === choice.id).map(publicLine),
    }));
    let selectedChoiceIds: string[] = [];
    try { const parsed = JSON.parse(String(row.selected_choice_ids_json || "[]")); if (Array.isArray(parsed)) selectedChoiceIds = parsed.map(String); } catch { selectedChoiceIds = []; }
    return {
      id: String(row.id), quoteId: String(row.quote_id), quoteNumber: String(row.quote_number), versionNumber: Number(row.version_number), status: String(row.status),
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), workTitle: String(row.work_title), customerNumber: String(row.customer_number),
      customerName: String(row.customer_name), serviceSiteId: String(row.service_site_id), siteLabel: String(row.site_label),
      siteSummary: [row.address_line_1, row.suburb, row.address_state, row.postcode].filter(Boolean).join(", "),
      subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents), terms: String(row.terms || ""),
      validUntil: String(row.valid_until || ""), consentStatement: String(row.consent_statement || ""), issuedAt: String(row.issued_at),
      decision: String(row.decision || ""), decidedAt: String(row.decided_at || ""), selectedChoiceIds,
      selectedSubtotalCents: Number(row.selected_subtotal_cents || 0), selectedTaxCents: Number(row.selected_tax_cents || 0),
      selectedTotalCents: Number(row.selected_total_cents || 0), selectionSummary: String(row.selection_summary || ""),
      items: items.filter((item) => !item.quote_choice_id).map(publicLine), choices,
    };
  });
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { const identity = await customerIdentity(request); return adminJson({ ok: true, quotes: await customerQuotes(identity) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await customerIdentity(request); const body = await request.json() as Row;
    const versionId = cleanAdminText(body.quoteVersionId, 180); const decision = cleanAdminText(body.decision, 20);
    if (!versionId || !["accepted", "declined"].includes(decision)) return adminJson({ ok: false, error: "Choose accept or decline for this quote." }, 400);
    if (decision === "accepted" && body.consentConfirmed !== true) return adminJson({ ok: false, error: "Confirm the exact quote acceptance statement before accepting." }, 400);
    const db = getD1();
    const version = await db.prepare(`SELECT v.*, q.quote_number, q.work_order_id, q.crm_customer_id, q.current_version_number FROM trade_crm_quote_versions v
      JOIN trade_crm_quotes q ON q.id = v.quote_id AND q.firebase_uid = v.firebase_uid
      JOIN trade_crm_job_details d ON d.work_order_id = q.work_order_id AND d.firebase_uid = q.firebase_uid
        AND d.customer_source = 'trade_owned' AND d.crm_customer_id = q.crm_customer_id AND d.service_site_id = q.service_site_id
      WHERE v.id = ? AND v.acceptance_email = ? AND v.status = 'issued' AND v.version_number = q.current_version_number`)
      .bind(versionId, identity.email).first<Row>();
    if (!version) throw new Error("QUOTE_NOT_FOUND");
    if (version.valid_until && String(version.valid_until) < new Date().toISOString().slice(0, 10)) throw new Error("QUOTE_EXPIRED");
    const choiceRows = await db.prepare(`SELECT id, choice_kind, group_key, name, subtotal_cents, tax_cents, total_cents FROM trade_crm_quote_choices WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position`)
      .bind(version.id, version.firebase_uid).all<Row>();
    const choices: QuoteChoiceTotals[] = choiceRows.results.map((choice) => ({ id: String(choice.id), kind: String(choice.choice_kind) as QuoteChoiceTotals["kind"],
      groupKey: String(choice.group_key), name: String(choice.name), subtotalCents: Number(choice.subtotal_cents), taxCents: Number(choice.tax_cents), totalCents: Number(choice.total_cents) }));
    const selection = decision === "accepted" ? calculateQuoteSelection({ subtotalCents: Number(version.subtotal_cents), taxCents: Number(version.tax_cents), totalCents: Number(version.total_cents) }, choices, body.selectedChoiceIds)
      : { selectedIds: [] as string[], subtotalCents: 0, taxCents: 0, totalCents: 0, selectionSummary: "" };
    const now = new Date().toISOString();
    const consentStatement = decision === "accepted"
      ? `I accept quote ${version.quote_number} version ${version.version_number} for AUD ${(selection.totalCents / 100).toFixed(2)}${selection.selectionSummary ? ` with ${selection.selectionSummary}` : ""}, subject to its recorded terms.`
      : `I decline quote ${version.quote_number} version ${version.version_number}.`;
    const commercial = providerNeutralCommercialRecord({ quoteNumber: String(version.quote_number), versionNumber: Number(version.version_number), subtotalCents: selection.subtotalCents, taxCents: selection.taxCents, totalCents: selection.totalCents, selectedChoiceIds: selection.selectedIds });
    const acceptanceId = crypto.randomUUID();
    const statements = [
      db.prepare(`INSERT INTO trade_crm_quote_acceptances
        (id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, customer_firebase_uid, actor_email,
         actor_email_verified, actor_auth_time, actor_sign_in_provider, decision, consent_statement, selected_choice_ids_json,
         selected_subtotal_cents, selected_tax_cents, selected_total_cents, selection_summary, actor_type, commercial_reference, currency, decided_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified_account', ?, 'AUD', ?, ?)`)
        .bind(acceptanceId, version.quote_id, version.id, version.work_order_id, version.firebase_uid, version.crm_customer_id,
          identity.uid, identity.email, identity.authTime, identity.signInProvider, decision, consentStatement, JSON.stringify(selection.selectedIds),
          selection.subtotalCents, selection.taxCents, selection.totalCents, selection.selectionSummary, commercial.reference, now, now),
      db.prepare(`UPDATE trade_crm_quote_versions SET status = ?, updated_at = ? WHERE id = ? AND status = 'issued'`).bind(decision, now, version.id),
      db.prepare(`UPDATE trade_crm_quotes SET status = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(decision, now, version.quote_id, version.firebase_uid),
      db.prepare(`UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`).bind(selection.totalCents || version.total_cents, decision, now, version.work_order_id, version.firebase_uid),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), version.work_order_id, version.firebase_uid, `quote_${decision}`, `Quote version ${version.version_number} ${decision} by the verified customer account.`, now),
      db.prepare(`UPDATE trade_crm_quote_links SET status = ?, token_hash = '', encrypted_token = '', updated_at = ? WHERE quote_version_id = ? AND firebase_uid = ? AND status = 'active'`)
        .bind(decision, now, version.id, version.firebase_uid),
      db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
        SELECT ?, link.id, link.quote_id, link.quote_version_id, link.work_order_id, link.firebase_uid, ?, 'verified_account', ?, ?, ?
        FROM trade_crm_quote_links link WHERE link.quote_version_id = ? AND link.firebase_uid = ?`)
        .bind(crypto.randomUUID(), decision, `Quote ${decision} by the verified customer account.`, `account-decision:${version.id}`, now, version.id, version.firebase_uid),
    ];
    if (decision === "accepted") {
      const itemRows = await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position`)
        .bind(version.id, version.firebase_uid).all<Row>();
      const scope = acceptedScopeSnapshot(itemRows.results, selection.selectedIds);
      statements.push(db.prepare(`INSERT INTO trade_crm_commercial_handovers
        (id, acceptance_id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, commercial_reference,
         currency, scope_snapshot_json, terms_snapshot, subtotal_cents, tax_cents, total_cents, deposit_kind,
         deposit_basis_points, deposit_fixed_cents, deposit_amount_cents, status, accepted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, 'percentage', 1000, 0, ?, 'accepted', ?, ?, ?)`)
        .bind(crypto.randomUUID(), acceptanceId, version.quote_id, version.id, version.work_order_id, version.firebase_uid,
          version.crm_customer_id, commercial.reference, JSON.stringify(scope), String(version.terms || ""), selection.subtotalCents,
          selection.taxCents, selection.totalCents, depositAmountCents(selection.totalCents, "percentage", 1000), now, now, now));
    }
    await db.batch(statements);
    return adminJson({ ok: true, quotes: await customerQuotes(identity) });
  } catch (error) { return errorResponse(error); }
}
