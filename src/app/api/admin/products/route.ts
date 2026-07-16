import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";
const REVIEW_STATUSES = new Set(["pending", "approved", "needs_changes", "rejected"]);
const LISTING_STATUSES = new Set(["draft", "published", "paused", "archived"]);
const PAGE_SIZES = new Set([25, 50, 100]);
const SORTS: Record<string, string> = {
  "priority-desc": "CASE p.review_status WHEN 'pending' THEN 0 WHEN 'needs_changes' THEN 1 ELSE 2 END, p.updated_at DESC",
  "updated-desc": "p.updated_at DESC",
  "updated-asc": "p.updated_at ASC",
  "name-asc": "p.name COLLATE NOCASE ASC, p.model_number COLLATE NOCASE ASC",
  "name-desc": "p.name COLLATE NOCASE DESC, p.model_number COLLATE NOCASE ASC",
  "supplier-asc": "a.business_name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC",
  "brand-asc": "p.brand COLLATE NOCASE ASC, p.model_number COLLATE NOCASE ASC",
  "model-asc": "p.model_number COLLATE NOCASE ASC",
  "category-asc": "p.category COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC",
  "price-asc": "p.unit_price_cents_ex_gst ASC, p.name COLLATE NOCASE ASC",
  "price-desc": "p.unit_price_cents_ex_gst DESC, p.name COLLATE NOCASE ASC",
  "stock-asc": "p.stock_status COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC",
  "lead-asc": "p.lead_time_days ASC, p.name COLLATE NOCASE ASC",
  "warranty-desc": "p.warranty_years DESC, p.name COLLATE NOCASE ASC",
  "review-asc": "p.review_status COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC",
  "listing-asc": "p.listing_status COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC",
};

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const db = getD1();
    const url = new URL(request.url);
    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const supplier = cleanAdminText(url.searchParams.get("supplier"), 100).toLowerCase();
    const brand = cleanAdminText(url.searchParams.get("brand"), 100).toLowerCase();
    const model = cleanAdminText(url.searchParams.get("model"), 100).toLowerCase();
    const category = cleanAdminText(url.searchParams.get("category"), 40);
    const stock = cleanAdminText(url.searchParams.get("stock"), 30);
    const review = cleanAdminText(url.searchParams.get("review"), 30);
    const listing = cleanAdminText(url.searchParams.get("listing"), 30);
    const synthetic = cleanAdminText(url.searchParams.get("synthetic"), 20);
    const sort = cleanAdminText(url.searchParams.get("sort"), 30) || "priority-desc";
    const minimumPrice = Number(url.searchParams.get("minPrice"));
    const maximumPrice = Number(url.searchParams.get("maxPrice"));
    const requestedPage = Number(url.searchParams.get("page"));
    const requestedPageSize = Number(url.searchParams.get("pageSize"));
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
    const clauses: string[] = [];
    const bindings: unknown[] = [];
    if (search) { clauses.push("LOWER(p.name) LIKE ?"); bindings.push(`%${search}%`); }
    if (supplier) { clauses.push("LOWER(a.business_name) LIKE ?"); bindings.push(`%${supplier}%`); }
    if (brand) { clauses.push("LOWER(p.brand) LIKE ?"); bindings.push(`%${brand}%`); }
    if (model) { clauses.push("LOWER(p.model_number) LIKE ?"); bindings.push(`%${model}%`); }
    if (category) { clauses.push("p.category = ?"); bindings.push(category); }
    if (stock) { clauses.push("p.stock_status = ?"); bindings.push(stock); }
    if (REVIEW_STATUSES.has(review)) { clauses.push("p.review_status = ?"); bindings.push(review); }
    if (LISTING_STATUSES.has(listing)) { clauses.push("p.listing_status = ?"); bindings.push(listing); }
    if (Number.isFinite(minimumPrice) && minimumPrice > 0) { clauses.push("p.unit_price_cents_ex_gst >= ?"); bindings.push(Math.round(minimumPrice * 100)); }
    if (Number.isFinite(maximumPrice) && maximumPrice > 0) { clauses.push("p.unit_price_cents_ex_gst <= ?"); bindings.push(Math.round(maximumPrice * 100)); }
    if (synthetic === "only") clauses.push("COALESCE(p.is_synthetic, 0) = 1");
    if (synthetic === "exclude") clauses.push("COALESCE(p.is_synthetic, 0) = 0");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [countRow, rows, counts] = await Promise.all([
      db.prepare(`SELECT COUNT(*) total FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid ${where}`)
        .bind(...bindings).first<Record<string, unknown>>(),
      db.prepare(`SELECT p.*, a.business_name supplier_name, a.email supplier_email,
        (SELECT COUNT(*) FROM supplier_product_links l WHERE l.product_id = p.id) linked_count
        FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid ${where}
        ORDER BY ${SORTS[sort] || SORTS["priority-desc"]} LIMIT ? OFFSET ?`)
        .bind(...bindings, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) approved,
        SUM(CASE WHEN review_status = 'approved' AND listing_status = 'published' THEN 1 ELSE 0 END) live
        FROM supplier_products`).first<Record<string, unknown>>(),
    ]);
    const total = Number(countRow?.total || 0);
    return adminJson({ ok: true, products: rows.results.map((row: Record<string, unknown>) => ({
      id: row.id, firebaseUid: row.firebase_uid, supplierName: row.supplier_name, supplierEmail: row.supplier_email,
      modelNumber: row.model_number, brand: row.brand, name: row.name, category: row.category, description: row.description,
      unitPriceCentsExGst: Number(row.unit_price_cents_ex_gst), minOrderQty: Number(row.min_order_qty), stockStatus: row.stock_status,
      leadTimeDays: Number(row.lead_time_days), warrantyYears: Number(row.warranty_years), listingStatus: row.listing_status,
      reviewStatus: row.review_status, reviewNote: row.review_note, linkedCount: Number(row.linked_count), updatedAt: row.updated_at,
      isSynthetic: Boolean(row.is_synthetic),
    })), counts: { total: Number(counts?.total || 0), pending: Number(counts?.pending || 0), approved: Number(counts?.approved || 0), live: Number(counts?.live || 0) },
      pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) } });
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
