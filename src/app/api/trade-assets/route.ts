import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";

export const runtime = "edge";

const ASSET_CATEGORIES = new Set(["solar", "battery", "hot-water", "heating-cooling", "ev-charging", "electrical", "insulation-draughts", "controls", "other"]);
const ASSET_STATUSES = new Set(["active", "retired", "replaced"]);
const WARRANTY_FILTERS = new Set(["", "expired", "due_90", "covered", "no_date"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function installerIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_ONLY");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  const entitlements = await accountEntitlements(identity.uid, "installer", account.billing_status);
  if (!entitlements.features.business_operations) throw new Error("FULL_ACCESS_REQUIRED");
  return { uid: identity.uid };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the business profile first." }, 404);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "The asset register is available to installer accounts only." }, 403);
  if (code === "ACCOUNT_INACTIVE" || code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using the asset register." }, 403);
  if (code === "CUSTOMER_NOT_FOUND") return adminJson({ ok: false, error: "Customer not found." }, 404);
  if (code === "SITE_NOT_FOUND") return adminJson({ ok: false, error: "Choose a service site belonging to this customer." }, 400);
  if (code === "ASSET_NOT_FOUND") return adminJson({ ok: false, error: "Installed asset not found." }, 404);
  return adminJson({ ok: false, error: "The private asset register request could not be completed." }, 500);
}

function dateValue(value: unknown) {
  const cleaned = cleanAdminText(value, 10);
  return !cleaned || DATE_PATTERN.test(cleaned) ? cleaned : "";
}

function assetPayload(row: Record<string, unknown>) {
  return {
    id: String(row.id), customerId: String(row.crm_customer_id || ""), serviceSiteId: String(row.service_site_id || ""),
    sourceType: String(row.source_type || ""), sourceReference: String(row.source_reference || ""), reviewStatus: String(row.review_status || ""),
    assetStatus: String(row.asset_status || "active"), assetLabel: String(row.asset_label || ""), commissioningReference: String(row.commissioning_reference || ""),
    assetCategory: String(row.asset_category), brand: String(row.brand), modelNumber: String(row.model_number), serialNumber: String(row.serial_number || ""),
    quantity: Number(row.quantity || 1), installedAt: String(row.installed_at || ""), warrantyProvider: String(row.warranty_provider || ""),
    warrantyReference: String(row.warranty_reference || ""), warrantyStart: String(row.warranty_start || ""), warrantyEnd: String(row.warranty_end || ""),
    customerNumber: String(row.customer_number || ""), customerName: String(row.customer_name || ""), siteLabel: String(row.site_label || ""),
    siteSummary: [row.address_line_1, row.suburb, row.address_state, row.postcode].filter(Boolean).join(", "),
    workOrderId: String(row.work_order_id || ""), workNumber: String(row.work_number || ""), workTitle: String(row.work_title || ""),
    handoverStatus: String(row.handover_status || ""), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

async function ownedCustomer(uid: string, customerId: string) {
  const customer = await getD1().prepare("SELECT id FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
    .bind(customerId, uid).first();
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
}

async function ownedSite(uid: string, customerId: string, siteId: string) {
  const site = await getD1().prepare(`SELECT id FROM trade_crm_service_sites
    WHERE id = ? AND customer_id = ? AND firebase_uid = ? AND record_status = 'active'`).bind(siteId, customerId, uid).first();
  if (!site) throw new Error("SITE_NOT_FOUND");
}

async function assetRows(uid: string, filters: { search?: string; status?: string; warranty?: string; category?: string; customerId?: string; siteId?: string }) {
  const search = String(filters.search || "").toLowerCase();
  const status = ASSET_STATUSES.has(String(filters.status)) ? String(filters.status) : "";
  const warranty = WARRANTY_FILTERS.has(String(filters.warranty)) ? String(filters.warranty) : "";
  const category = ASSET_CATEGORIES.has(String(filters.category)) ? String(filters.category) : "";
  const rows = await getD1().prepare(`SELECT a.*,
      c.customer_number, CASE WHEN c.business_name != '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
      s.site_label, s.address_line_1, s.suburb, s.address_state, s.postcode,
      w.work_number, w.title work_title, p.status handover_status
    FROM trade_installed_assets a
    JOIN trade_crm_customers c ON c.id = a.crm_customer_id AND c.firebase_uid = a.firebase_uid AND c.record_status = 'active'
    JOIN trade_crm_service_sites s ON s.id = a.service_site_id AND s.customer_id = c.id AND s.firebase_uid = a.firebase_uid AND s.record_status = 'active'
    LEFT JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
    LEFT JOIN trade_handover_packs p ON p.id = a.handover_pack_id AND p.firebase_uid = a.firebase_uid
    WHERE a.firebase_uid = ? AND a.record_status = 'active' AND a.review_status = 'confirmed'
      AND (? = '' OR a.asset_status = ?) AND (? = '' OR a.asset_category = ?)
      AND (? = '' OR a.crm_customer_id = ?) AND (? = '' OR a.service_site_id = ?)
      AND (? = '' OR LOWER(a.brand || ' ' || a.model_number || ' ' || a.serial_number || ' ' || a.asset_label || ' ' || a.commissioning_reference || ' ' ||
        CASE WHEN c.business_name != '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END || ' ' || s.site_label) LIKE '%' || ? || '%')
      AND (? = '' OR (? = 'expired' AND a.warranty_end != '' AND a.warranty_end < date('now'))
        OR (? = 'due_90' AND a.warranty_end BETWEEN date('now') AND date('now', '+90 days'))
        OR (? = 'covered' AND a.warranty_end > date('now', '+90 days'))
        OR (? = 'no_date' AND a.warranty_end = ''))
    ORDER BY CASE WHEN a.warranty_end != '' AND a.warranty_end < date('now') THEN 0
      WHEN a.warranty_end BETWEEN date('now') AND date('now', '+90 days') THEN 1 ELSE 2 END,
      a.updated_at DESC, a.id DESC LIMIT 500`)
    .bind(uid, status, status, category, category, filters.customerId || "", filters.customerId || "", filters.siteId || "", filters.siteId || "",
      search, search, warranty, warranty, warranty, warranty, warranty).all<Record<string, unknown>>();
  return rows.results.map(assetPayload);
}

async function pendingHandoverRows(uid: string, customerId = "") {
  const rows = await getD1().prepare(`SELECT a.*, d.crm_customer_id proposed_customer_id, d.service_site_id proposed_site_id,
      c.customer_number, CASE WHEN c.business_name != '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
      s.site_label, s.address_line_1, s.suburb, s.address_state, s.postcode, w.work_number, w.title work_title, p.status handover_status
    FROM trade_installed_assets a
    JOIN trade_crm_job_details d ON d.work_order_id = a.work_order_id AND d.firebase_uid = a.firebase_uid
      AND d.customer_source = 'trade_owned' AND d.crm_customer_id != '' AND d.service_site_id != ''
    JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = a.firebase_uid AND c.record_status = 'active'
    JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.customer_id = c.id AND s.firebase_uid = a.firebase_uid AND s.record_status = 'active'
    JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
    LEFT JOIN trade_handover_packs p ON p.id = a.handover_pack_id AND p.firebase_uid = a.firebase_uid
    WHERE a.firebase_uid = ? AND a.record_status = 'active' AND a.review_status = 'pending_review'
      AND (? = '' OR d.crm_customer_id = ?) ORDER BY a.updated_at DESC LIMIT 100`)
    .bind(uid, customerId, customerId).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ ...assetPayload(row), proposedCustomerId: String(row.proposed_customer_id), proposedSiteId: String(row.proposed_site_id) }));
}

async function timelineRows(uid: string, customerId: string, siteId: string) {
  const rows = await getD1().prepare(`SELECT * FROM (
    SELECT ev.id, 'enquiry' source_type, ev.event_type, 'Enquiry' title, ev.summary,
      ev.created_at occurred_at, e.source_reference, e.service_site_id, '' work_order_id
    FROM trade_crm_enquiry_events ev JOIN trade_crm_enquiries e ON e.id = ev.enquiry_id AND e.firebase_uid = ev.firebase_uid
    WHERE ev.firebase_uid = ? AND e.customer_id = ? AND (? = '' OR e.service_site_id = ?)
    UNION ALL
    SELECT ev.id, 'job' source_type, ev.event_type, w.work_number || ' | ' || w.title title, ev.summary,
      ev.created_at occurred_at, w.source_reference, d.service_site_id, w.id work_order_id
    FROM trade_work_order_events ev JOIN trade_work_orders w ON w.id = ev.work_order_id AND w.firebase_uid = ev.firebase_uid
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE ev.firebase_uid = ? AND d.crm_customer_id = ? AND (? = '' OR d.service_site_id = ?)
    UNION ALL
    SELECT ap.id, 'appointment' source_type, ap.appointment_type event_type, ap.title, ap.status summary,
      ap.starts_at occurred_at, w.work_number source_reference, d.service_site_id, w.id work_order_id
    FROM trade_crm_appointments ap JOIN trade_work_orders w ON w.id = ap.work_order_id AND w.firebase_uid = ap.firebase_uid
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE ap.firebase_uid = ? AND d.crm_customer_id = ? AND (? = '' OR d.service_site_id = ?)
    UNION ALL
    SELECT n.id, 'note' source_type, n.note_type event_type, w.work_number || ' note' title, n.body summary,
      n.created_at occurred_at, w.work_number source_reference, d.service_site_id, w.id work_order_id
    FROM trade_crm_job_notes n JOIN trade_work_orders w ON w.id = n.work_order_id AND w.firebase_uid = n.firebase_uid
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE n.firebase_uid = ? AND d.crm_customer_id = ? AND (? = '' OR d.service_site_id = ?)
    UNION ALL
    SELECT p.id, 'handover' source_type, 'handover_' || p.status event_type, w.work_number || ' handover' title,
      'Handover pack status: ' || REPLACE(p.status, '_', ' ') summary,
      CASE WHEN p.published_at != '' THEN p.published_at WHEN p.submitted_at != '' THEN p.submitted_at ELSE p.created_at END occurred_at,
      p.id source_reference, d.service_site_id, w.id work_order_id
    FROM trade_handover_packs p JOIN trade_work_orders w ON w.id = p.work_order_id AND w.firebase_uid = p.firebase_uid
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE p.firebase_uid = ? AND d.crm_customer_id = ? AND (? = '' OR d.service_site_id = ?)
    UNION ALL
    SELECT a.id, 'asset' source_type, 'asset_registered' event_type,
      CASE WHEN a.asset_label != '' THEN a.asset_label ELSE a.brand || ' ' || a.model_number END title,
      'Installed asset linked to this customer and service site.' summary,
      CASE WHEN a.installed_at != '' THEN a.installed_at || 'T12:00:00.000Z' ELSE a.created_at END occurred_at,
      a.source_reference, a.service_site_id, a.work_order_id
    FROM trade_installed_assets a WHERE a.firebase_uid = ? AND a.crm_customer_id = ? AND a.record_status = 'active'
      AND a.review_status = 'confirmed' AND (? = '' OR a.service_site_id = ?)
    UNION ALL
    SELECT se.id, 'service' source_type, se.event_type, a.brand || ' ' || a.model_number title,
      se.summary, se.serviced_at || 'T12:00:00.000Z' occurred_at, a.source_reference, a.service_site_id, a.work_order_id
    FROM trade_asset_service_events se JOIN trade_installed_assets a ON a.id = se.asset_id AND a.firebase_uid = se.firebase_uid
    WHERE se.firebase_uid = ? AND a.crm_customer_id = ? AND (? = '' OR a.service_site_id = ?)
  ) timeline ORDER BY occurred_at DESC, source_type ASC, id DESC LIMIT 500`)
    .bind(uid, customerId, siteId, siteId, uid, customerId, siteId, siteId, uid, customerId, siteId, siteId,
      uid, customerId, siteId, siteId, uid, customerId, siteId, siteId, uid, customerId, siteId, siteId,
      uid, customerId, siteId, siteId)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: String(row.id), sourceType: String(row.source_type), eventType: String(row.event_type), title: String(row.title),
    summary: String(row.summary || ""), occurredAt: String(row.occurred_at), sourceReference: String(row.source_reference || ""),
    serviceSiteId: String(row.service_site_id || ""), workOrderId: String(row.work_order_id || ""),
  }));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { uid } = await installerIdentity(request);
    const url = new URL(request.url);
    const customerId = cleanAdminText(url.searchParams.get("customerId"), 180);
    const siteId = cleanAdminText(url.searchParams.get("siteId"), 180);
    if (customerId) await ownedCustomer(uid, customerId);
    if (siteId) {
      if (!customerId) return adminJson({ ok: false, error: "Choose a customer before filtering by service site." }, 400);
      await ownedSite(uid, customerId, siteId);
    }
    const filters = {
      search: cleanAdminText(url.searchParams.get("search"), 120), status: cleanAdminText(url.searchParams.get("status"), 20),
      warranty: cleanAdminText(url.searchParams.get("warranty"), 20), category: cleanAdminText(url.searchParams.get("category"), 60), customerId, siteId,
    };
    const [assets, pendingReviews, timeline] = await Promise.all([
      assetRows(uid, filters), pendingHandoverRows(uid, customerId), customerId ? timelineRows(uid, customerId, siteId) : Promise.resolve([]),
    ]);
    return adminJson({ ok: true, assets, pendingReviews, timeline });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { uid } = await installerIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40);
    const db = getD1(); const now = new Date().toISOString();
    if (action === "review_handover_asset") {
      const assetId = cleanAdminText(body.assetId, 180);
      const candidate = await db.prepare(`SELECT a.id, a.handover_pack_id, d.crm_customer_id, d.service_site_id FROM trade_installed_assets a
        JOIN trade_crm_job_details d ON d.work_order_id = a.work_order_id AND d.firebase_uid = a.firebase_uid
        WHERE a.id = ? AND a.firebase_uid = ? AND a.record_status = 'active' AND a.review_status = 'pending_review'
          AND d.customer_source = 'trade_owned' AND d.crm_customer_id != '' AND d.service_site_id != ''`).bind(assetId, uid).first<Record<string, unknown>>();
      if (!candidate) throw new Error("ASSET_NOT_FOUND");
      const customerId = String(candidate.crm_customer_id); const siteId = cleanAdminText(body.serviceSiteId, 180) || String(candidate.service_site_id);
      await ownedSite(uid, customerId, siteId);
      await db.batch([
        db.prepare(`UPDATE trade_installed_assets SET crm_customer_id = ?, service_site_id = ?, source_type = 'handover',
          source_reference = ?, review_status = 'confirmed', updated_at = ? WHERE id = ? AND firebase_uid = ? AND review_status = 'pending_review'`)
          .bind(customerId, siteId, candidate.handover_pack_id, now, assetId, uid),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          SELECT ?, work_order_id, firebase_uid, 'asset_link_reviewed', 'Installed asset linked to the authoritative customer and service site.', ?
          FROM trade_installed_assets WHERE id = ? AND firebase_uid = ? AND work_order_id != ''`)
          .bind(crypto.randomUUID(), now, assetId, uid),
      ]);
      return adminJson({ ok: true });
    }
    if (action !== "create_asset") return adminJson({ ok: false, error: "Unsupported asset action." }, 400);
    const customerId = cleanAdminText(body.customerId, 180); const siteId = cleanAdminText(body.serviceSiteId, 180);
    await ownedCustomer(uid, customerId); await ownedSite(uid, customerId, siteId);
    const category = cleanAdminText(body.assetCategory, 60); const brand = cleanAdminText(body.brand, 100); const model = cleanAdminText(body.modelNumber, 120);
    if (!ASSET_CATEGORIES.has(category) || !brand || !model) return adminJson({ ok: false, error: "Choose an asset type and add the installed brand and model." }, 400);
    const installedAt = dateValue(body.installedAt); const warrantyStart = dateValue(body.warrantyStart); const warrantyEnd = dateValue(body.warrantyEnd);
    if ((body.installedAt && !installedAt) || (body.warrantyStart && !warrantyStart) || (body.warrantyEnd && !warrantyEnd) || (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart))
      return adminJson({ ok: false, error: "Check the warranty dates." }, 400);
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO trade_installed_assets
      (id, handover_pack_id, work_order_id, firebase_uid, crm_customer_id, service_site_id, source_type, source_reference,
       review_status, asset_status, asset_label, commissioning_reference, asset_category, brand, model_number, serial_number,
       quantity, installed_at, warranty_provider, warranty_reference, warranty_start, warranty_end, supplier_product_id,
       record_status, created_at, updated_at)
      VALUES (?, '', '', ?, ?, ?, 'manual', ?, 'confirmed', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'active', ?, ?)`)
      .bind(id, uid, customerId, siteId, id, cleanAdminText(body.assetLabel, 140), cleanAdminText(body.commissioningReference, 140),
        category, brand, model, cleanAdminText(body.serialNumber, 140), Math.max(1, Math.min(9999, Math.round(Number(body.quantity) || 1))),
        installedAt, cleanAdminText(body.warrantyProvider, 120), cleanAdminText(body.warrantyReference, 140), warrantyStart, warrantyEnd, now, now).run();
    return adminJson({ ok: true, id }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { uid } = await installerIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const id = cleanAdminText(body.assetId, 180); const db = getD1();
    const current = await db.prepare(`SELECT * FROM trade_installed_assets WHERE id = ? AND firebase_uid = ?
      AND record_status = 'active' AND review_status = 'confirmed' AND crm_customer_id != '' AND service_site_id != ''`).bind(id, uid).first<Record<string, unknown>>();
    if (!current) throw new Error("ASSET_NOT_FOUND");
    const status = cleanAdminText(body.assetStatus, 20) || String(current.asset_status);
    if (!ASSET_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose active, retired or replaced." }, 400);
    const siteId = cleanAdminText(body.serviceSiteId, 180) || String(current.service_site_id);
    await ownedSite(uid, String(current.crm_customer_id), siteId);
    const warrantyStart = body.warrantyStart === undefined ? String(current.warranty_start) : dateValue(body.warrantyStart);
    const warrantyEnd = body.warrantyEnd === undefined ? String(current.warranty_end) : dateValue(body.warrantyEnd);
    if ((body.warrantyStart && !warrantyStart) || (body.warrantyEnd && !warrantyEnd)) return adminJson({ ok: false, error: "Check the warranty dates." }, 400);
    if (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart) return adminJson({ ok: false, error: "The warranty end date cannot be before the start date." }, 400);
    await db.prepare(`UPDATE trade_installed_assets SET service_site_id = ?, asset_status = ?, asset_label = ?, commissioning_reference = ?,
      serial_number = ?, warranty_provider = ?, warranty_reference = ?, warranty_start = ?, warranty_end = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ?`).bind(siteId, status,
        body.assetLabel === undefined ? current.asset_label : cleanAdminText(body.assetLabel, 140),
        body.commissioningReference === undefined ? current.commissioning_reference : cleanAdminText(body.commissioningReference, 140),
        body.serialNumber === undefined ? current.serial_number : cleanAdminText(body.serialNumber, 140),
        body.warrantyProvider === undefined ? current.warranty_provider : cleanAdminText(body.warrantyProvider, 120),
        body.warrantyReference === undefined ? current.warranty_reference : cleanAdminText(body.warrantyReference, 140),
        warrantyStart, warrantyEnd, new Date().toISOString(), id, uid).run();
    return adminJson({ ok: true });
  } catch (error) { return errorResponse(error); }
}
