import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, parseJsonList, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";

const ACCOUNT_STATUSES = new Set(["active", "suspended", "closed"]);
const VERIFICATION_STATUSES = new Set(["not_started", "submitted", "under_review", "needs_information", "approved", "rejected", "expired"]);
const AVAILABILITY_STATUSES = new Set(["open", "limited", "paused"]);
const PLAN_KEYS = new Set(["unselected", "installer_annual", "installer_monthly", "supplier_annual", "supplier_monthly"]);
const BILLING_STATUSES = new Set(["not_connected", "processing", "trial", "active", "active_cancels_at_period_end", "past_due", "paused", "cancelled"]);

function shapeAccount(row: Record<string, unknown>) {
  return {
    firebaseUid: row.firebase_uid,
    email: row.email,
    businessName: row.business_name,
    contactName: row.contact_name,
    phone: row.phone,
    partnerType: row.partner_type,
    businessWebsite: row.business_website,
    addressLine1: row.address_line_1,
    suburb: row.suburb,
    addressState: row.address_state,
    postcode: row.postcode,
    serviceStates: parseJsonList(row.service_states),
    capabilities: parseJsonList(row.capabilities),
    summary: row.summary,
    accountStatus: row.account_status,
    verificationStatus: row.verification_status,
    planKey: row.plan_key,
    billingStatus: row.billing_status,
    availabilityStatus: row.availability_status,
    serviceBasePostcode: row.service_base_postcode || row.postcode,
    serviceRadiusKm: Number(row.service_radius_km || 50),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const db = getD1();
    const url = new URL(request.url);
    const uid = cleanAdminText(url.searchParams.get("uid"), 180);
    if (uid) {
      const account = await db.prepare("SELECT * FROM trade_accounts WHERE firebase_uid = ? LIMIT 1").bind(uid).first<Record<string, unknown>>();
      if (!account) return adminJson({ ok: false, error: "Business account not found." }, 404);
      const [documents, notes, matches] = await Promise.all([
        db.prepare(`SELECT id, category, file_name, content_type, size_bytes, expiry_date, status, created_at, updated_at
          FROM verification_documents WHERE firebase_uid = ? ORDER BY created_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>(),
        db.prepare(`SELECT n.id, n.note, n.created_at, COALESCE(a.display_name, a.email, 'Operations team') author
          FROM trade_account_notes n LEFT JOIN admin_users a ON a.firebase_uid = n.created_by_uid
          WHERE n.firebase_uid = ? ORDER BY n.created_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>(),
        db.prepare(`SELECT m.id, m.status match_status, m.admin_note, m.partner_note, m.matched_at, m.updated_at,
          o.id opportunity_id, o.title, o.project_type, o.state, o.postcode, o.priority, o.timing, o.status opportunity_status
          FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
          WHERE m.firebase_uid = ? ORDER BY m.updated_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>(),
      ]);
      return adminJson({ ok: true, account: shapeAccount(account), documents: documents.results, notes: notes.results, matches: matches.results });
    }

    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const partnerType = cleanAdminText(url.searchParams.get("partnerType"), 20);
    const verification = cleanAdminText(url.searchParams.get("verification"), 30);
    const clauses: string[] = [];
    const bindings: string[] = [];
    if (search) {
      clauses.push("(LOWER(business_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(contact_name) LIKE ? OR postcode LIKE ?)");
      const term = `%${search}%`;
      bindings.push(term, term, term, term);
    }
    if (ACCOUNT_STATUSES.has(status)) { clauses.push("account_status = ?"); bindings.push(status); }
    if (["installer", "supplier"].includes(partnerType)) { clauses.push("partner_type = ?"); bindings.push(partnerType); }
    if (VERIFICATION_STATUSES.has(verification)) { clauses.push("verification_status = ?"); bindings.push(verification); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const statement = db.prepare(`SELECT firebase_uid, email, business_name, contact_name, partner_type,
      address_state, postcode, service_states, capabilities, account_status, verification_status,
      plan_key, billing_status, availability_status, service_base_postcode, service_radius_km, created_at, updated_at
      FROM trade_accounts ${where} ORDER BY updated_at DESC LIMIT 100`);
    const rows = bindings.length ? await statement.bind(...bindings).all<Record<string, unknown>>() : await statement.all<Record<string, unknown>>();
    return adminJson({ ok: true, accounts: rows.results.map(shapeAccount) });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid account update." }, 400); }
    const uid = cleanAdminText(body.firebaseUid, 180);
    if (!uid) return adminJson({ ok: false, error: "Choose a business account." }, 400);

    const db = getD1();
    const current = await db.prepare(`SELECT account_status, verification_status, availability_status, plan_key, billing_status
      FROM trade_accounts WHERE firebase_uid = ?`).bind(uid).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Business account not found." }, 404);

    const accountStatus = cleanAdminText(body.accountStatus, 30) || String(current.account_status);
    const verificationStatus = cleanAdminText(body.verificationStatus, 30) || String(current.verification_status);
    const availabilityStatus = cleanAdminText(body.availabilityStatus, 30) || String(current.availability_status);
    const planKey = cleanAdminText(body.planKey, 40) || String(current.plan_key);
    const billingStatus = cleanAdminText(body.billingStatus, 30) || String(current.billing_status);
    if (!ACCOUNT_STATUSES.has(accountStatus) || !VERIFICATION_STATUSES.has(verificationStatus) || !AVAILABILITY_STATUSES.has(availabilityStatus) || !PLAN_KEYS.has(planKey) || !BILLING_STATUSES.has(billingStatus)) {
      return adminJson({ ok: false, error: "One or more account settings are invalid." }, 400);
    }
    if (admin.role === "reviewer" && (accountStatus !== current.account_status || availabilityStatus !== current.availability_status || planKey !== current.plan_key || billingStatus !== current.billing_status)) {
      return adminJson({ ok: false, error: "Reviewers can update verification status and internal notes only." }, 403);
    }

    const note = cleanAdminText(body.note, 1200);
    const now = new Date().toISOString();
    await db.prepare(`UPDATE trade_accounts SET account_status = ?, verification_status = ?, availability_status = ?,
      plan_key = ?, billing_status = ?, updated_at = ? WHERE firebase_uid = ?`)
      .bind(accountStatus, verificationStatus, availabilityStatus, planKey, billingStatus, now, uid).run();
    if (note) await db.prepare(`INSERT INTO trade_account_notes (id, firebase_uid, note, created_by_uid, created_at)
      VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), uid, note, admin.uid, now).run();
    await writeAdminAudit(admin, "trade_account.update", "trade_account", uid, "Updated business account moderation settings.", {
      before: current,
      after: { accountStatus, verificationStatus, availabilityStatus, planKey, billingStatus },
      noteAdded: Boolean(note),
    });
    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error);
  }
}
