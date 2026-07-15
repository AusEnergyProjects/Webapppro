import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";
const REVIEW_STATUSES = new Set(["pending", "approved", "needs_changes", "rejected"]);
const LISTING_STATUSES = new Set(["draft", "published", "paused", "archived"]);

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const rows = await getD1().prepare(`SELECT p.*, a.business_name supplier_name, a.email supplier_email,
      (SELECT COUNT(*) FROM supplier_product_links l WHERE l.product_id = p.id) linked_count
      FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
      ORDER BY CASE p.review_status WHEN 'pending' THEN 0 WHEN 'needs_changes' THEN 1 ELSE 2 END, p.updated_at DESC LIMIT 500`).all<Record<string, unknown>>();
    return adminJson({ ok: true, products: rows.results.map((row: Record<string, unknown>) => ({
      id: row.id, firebaseUid: row.firebase_uid, supplierName: row.supplier_name, supplierEmail: row.supplier_email,
      modelNumber: row.model_number, brand: row.brand, name: row.name, category: row.category, description: row.description,
      unitPriceCentsExGst: Number(row.unit_price_cents_ex_gst), minOrderQty: Number(row.min_order_qty), stockStatus: row.stock_status,
      leadTimeDays: Number(row.lead_time_days), warrantyYears: Number(row.warranty_years), listingStatus: row.listing_status,
      reviewStatus: row.review_status, reviewNote: row.review_note, linkedCount: Number(row.linked_count), updatedAt: row.updated_at,
      isSynthetic: Boolean(row.is_synthetic),
    })) });
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return adminJson({ ok: false, error: "Invalid catalogue decision." }, 400); }
    const id = cleanAdminText(body.id, 180);
    const reviewStatus = cleanAdminText(body.reviewStatus, 30);
    const reviewNote = cleanAdminText(body.reviewNote, 800);
    const listingStatus = cleanAdminText(body.listingStatus, 30);
    if (!id || !REVIEW_STATUSES.has(reviewStatus) || (listingStatus && !LISTING_STATUSES.has(listingStatus))) return adminJson({ ok: false, error: "Choose a valid product review decision." }, 400);
    if (["needs_changes", "rejected"].includes(reviewStatus) && !reviewNote) return adminJson({ ok: false, error: "Add a clear review note for the wholesaler." }, 400);
    const db = getD1();
    const current = await db.prepare("SELECT model_number, name, listing_status, review_status FROM supplier_products WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Product not found." }, 404);
    const nextListing = listingStatus || String(current.listing_status);
    if (admin.role === "reviewer" && nextListing !== current.listing_status) return adminJson({ ok: false, error: "Reviewers can decide evidence status but cannot change listing availability." }, 403);
    const now = new Date().toISOString();
    await db.prepare("UPDATE supplier_products SET review_status = ?, review_note = ?, listing_status = ?, updated_at = ? WHERE id = ?")
      .bind(reviewStatus, reviewNote, nextListing, now, id).run();
    if (reviewStatus !== "pending") {
      await db.prepare(`UPDATE admin_notifications SET status = 'resolved', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
        read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, resolved_at = ?, resolved_by_uid = ?,
        resolution_note = ?, updated_at = ? WHERE entity_type = 'supplier_product' AND entity_id = ? AND status != 'resolved'`)
        .bind(now, admin.uid, now, admin.uid, `Catalogue review: ${reviewStatus}`, now, id).run();
    }
    await writeAdminAudit(admin, "catalogue.review", "supplier_product", id,
      `Reviewed ${current.model_number} ${current.name}: ${reviewStatus}.`, { before: current, listingStatus: nextListing, reviewNote: Boolean(reviewNote) });
    return adminJson({ ok: true });
  } catch (error) { return adminError(error); }
}
