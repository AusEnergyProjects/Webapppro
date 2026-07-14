import { getD1 } from "../../../../../db";
import {
  adminError,
  adminJson,
  cleanAdminText,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const url = new URL(request.url);
    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const clauses: string[] = [];
    const bindings: string[] = [];
    if (["new", "viewed", "responded", "closed"].includes(status)) {
      clauses.push("e.status = ?");
      bindings.push(status);
    }
    if (search) {
      clauses.push("(LOWER(i.business_name) LIKE ? OR LOWER(s.business_name) LIKE ? OR LOWER(l.name) LIKE ? OR l.project_postcode LIKE ?)");
      const term = `%${search}%`;
      bindings.push(term, term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const statement = getD1().prepare(`SELECT e.id, e.status, e.message, e.supplier_note, e.created_at, e.updated_at,
      l.id list_id, l.name list_name, l.project_postcode,
      i.business_name installer_business, i.email installer_email,
      s.business_name supplier_business, s.email supplier_email,
      (SELECT COUNT(*) FROM installer_product_list_items li WHERE li.list_id = e.list_id AND li.supplier_uid = e.supplier_uid) item_count,
      (SELECT COALESCE(SUM(li.quantity * li.unit_price_cents_ex_gst), 0) FROM installer_product_list_items li WHERE li.list_id = e.list_id AND li.supplier_uid = e.supplier_uid) subtotal_cents_ex_gst
      FROM supplier_product_enquiries e
      JOIN installer_product_lists l ON l.id = e.list_id
      JOIN trade_accounts i ON i.firebase_uid = e.installer_uid
      JOIN trade_accounts s ON s.firebase_uid = e.supplier_uid
      ${where}
      ORDER BY CASE e.status WHEN 'new' THEN 0 WHEN 'viewed' THEN 1 WHEN 'responded' THEN 2 ELSE 3 END, e.updated_at DESC
      LIMIT 200`);
    const rows = bindings.length
      ? await statement.bind(...bindings).all<Record<string, unknown>>()
      : await statement.all<Record<string, unknown>>();
    return adminJson({ ok: true, enquiries: rows.results.map((row: Record<string, unknown>) => ({
      id: row.id,
      status: row.status,
      message: row.message,
      supplierNote: row.supplier_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      listId: row.list_id,
      listName: row.list_name,
      projectPostcode: row.project_postcode,
      installerBusiness: row.installer_business,
      installerEmail: row.installer_email,
      supplierBusiness: row.supplier_business,
      supplierEmail: row.supplier_email,
      itemCount: Number(row.item_count),
      subtotalCentsExGst: Number(row.subtotal_cents_ex_gst),
    })) });
  } catch (error) {
    return adminError(error);
  }
}
