import { getD1 } from "../../../../db";
import { requireFirebaseIdentity, type FirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";

export const runtime = "edge";

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
  return adminJson({ ok: false, error: "The private quote review could not be completed." }, 500);
}

async function customerQuotes(identity: FirebaseIdentity) {
  const db = getD1();
  const rows = await db.prepare(`SELECT v.*, q.quote_number, q.work_order_id, q.crm_customer_id, q.service_site_id,
      w.work_number, w.title work_title, c.customer_number,
      CASE WHEN c.business_name != '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
      s.site_label, s.address_line_1, s.suburb, s.address_state, s.postcode,
      a.decision, a.decided_at
    FROM trade_crm_quote_versions v JOIN trade_crm_quotes q ON q.id = v.quote_id AND q.firebase_uid = v.firebase_uid
    JOIN trade_work_orders w ON w.id = q.work_order_id AND w.firebase_uid = q.firebase_uid AND w.record_status = 'active'
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid AND d.customer_source = 'trade_owned'
      AND d.crm_customer_id = q.crm_customer_id AND d.service_site_id = q.service_site_id
    JOIN trade_crm_customers c ON c.id = q.crm_customer_id AND c.firebase_uid = q.firebase_uid AND c.record_status = 'active'
    JOIN trade_crm_service_sites s ON s.id = q.service_site_id AND s.customer_id = c.id AND s.firebase_uid = q.firebase_uid AND s.record_status = 'active'
    LEFT JOIN trade_crm_quote_acceptances a ON a.quote_version_id = v.id
    WHERE v.acceptance_email = ? AND v.issued_at != ''
    ORDER BY v.issued_at DESC, v.quote_id, v.version_number DESC LIMIT 100`).bind(identity.email).all<Record<string, unknown>>();
  const versionIds = rows.results.map((row) => String(row.id));
  const itemRows = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE quote_version_id IN (${versionIds.map(() => "?").join(",")}) ORDER BY quote_version_id, position`)
    .bind(...versionIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  return rows.results.map((row) => ({
    id: String(row.id), quoteId: String(row.quote_id), quoteNumber: String(row.quote_number), versionNumber: Number(row.version_number), status: String(row.status),
    workOrderId: String(row.work_order_id), workNumber: String(row.work_number), workTitle: String(row.work_title), customerNumber: String(row.customer_number),
    customerName: String(row.customer_name), serviceSiteId: String(row.service_site_id), siteLabel: String(row.site_label),
    siteSummary: [row.address_line_1, row.suburb, row.address_state, row.postcode].filter(Boolean).join(", "),
    subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents), terms: String(row.terms || ""),
    validUntil: String(row.valid_until || ""), consentStatement: String(row.consent_statement || ""), issuedAt: String(row.issued_at),
    decision: String(row.decision || ""), decidedAt: String(row.decided_at || ""),
    items: itemRows.results.filter((item) => item.quote_version_id === row.id).map((item) => ({
      id: String(item.id), position: Number(item.position), lineType: String(item.line_type), description: String(item.description),
      quantityMilli: Number(item.quantity_milli), unitPriceCents: Number(item.unit_price_cents), taxCode: String(item.tax_code),
      subtotalCents: Number(item.subtotal_cents), taxCents: Number(item.tax_cents), totalCents: Number(item.total_cents),
    })),
  }));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { const identity = await customerIdentity(request); return adminJson({ ok: true, quotes: await customerQuotes(identity) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await customerIdentity(request); const body = await request.json() as Record<string, unknown>;
    const versionId = cleanAdminText(body.quoteVersionId, 180); const decision = cleanAdminText(body.decision, 20);
    if (!versionId || !["accepted", "declined"].includes(decision)) return adminJson({ ok: false, error: "Choose accept or decline for this quote." }, 400);
    if (decision === "accepted" && body.consentConfirmed !== true) return adminJson({ ok: false, error: "Confirm the exact quote acceptance statement before accepting." }, 400);
    const db = getD1();
    const version = await db.prepare(`SELECT v.*, q.work_order_id, q.crm_customer_id, q.current_version_number FROM trade_crm_quote_versions v
      JOIN trade_crm_quotes q ON q.id = v.quote_id AND q.firebase_uid = v.firebase_uid
      JOIN trade_crm_job_details d ON d.work_order_id = q.work_order_id AND d.firebase_uid = q.firebase_uid
        AND d.customer_source = 'trade_owned' AND d.crm_customer_id = q.crm_customer_id AND d.service_site_id = q.service_site_id
      WHERE v.id = ? AND v.acceptance_email = ? AND v.status = 'issued' AND v.version_number = q.current_version_number`)
      .bind(versionId, identity.email).first<Record<string, unknown>>();
    if (!version) throw new Error("QUOTE_NOT_FOUND");
    if (version.valid_until && String(version.valid_until) < new Date().toISOString().slice(0, 10)) throw new Error("QUOTE_EXPIRED");
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO trade_crm_quote_acceptances
        (id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, customer_firebase_uid, actor_email,
         actor_email_verified, actor_auth_time, actor_sign_in_provider, decision, consent_statement, decided_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), version.quote_id, version.id, version.work_order_id, version.firebase_uid, version.crm_customer_id,
          identity.uid, identity.email, identity.authTime, identity.signInProvider, decision, version.consent_statement, now, now),
      db.prepare(`UPDATE trade_crm_quote_versions SET status = ?, updated_at = ? WHERE id = ? AND status = 'issued'`).bind(decision, now, version.id),
      db.prepare(`UPDATE trade_crm_quotes SET status = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(decision, now, version.quote_id, version.firebase_uid),
      db.prepare(`UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
        .bind(version.total_cents, decision, now, version.work_order_id, version.firebase_uid),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), version.work_order_id, version.firebase_uid, `quote_${decision}`, `Quote version ${version.version_number} ${decision} by the verified customer account.`, now),
    ]);
    return adminJson({ ok: true, quotes: await customerQuotes(identity) });
  } catch (error) { return errorResponse(error); }
}
