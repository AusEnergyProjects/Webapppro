import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  let identity;
  try { identity = await requireFirebaseIdentity(request); }
  catch { return adminJson({ ok: false, error: "Sign in to continue." }, 401); }
  const db = getD1();
  const account = await db.prepare("SELECT partner_type, account_status, billing_status FROM trade_accounts WHERE firebase_uid = ?").bind(identity.uid).first<Record<string, unknown>>();
  if (!account || account.account_status !== "active") return adminJson({ ok: false, error: "An active business account is required." }, 403);
  if (account.partner_type !== "installer") return adminJson({ ok: false, error: "The trade product marketplace is reserved for installer accounts." }, 403);
  if (!await accountHasFeature(identity.uid, "installer", account.billing_status, "installer_marketplace")) {
    return adminJson({ ok: false, error: "The wholesale product marketplace is available with paid membership or an administrator feature grant." }, 403);
  }

  const url = new URL(request.url);
  const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
  const category = cleanAdminText(url.searchParams.get("category"), 40);
  const rows = await db.prepare(`SELECT p.id, p.model_number, p.brand, p.name, p.category, p.description,
    p.unit_price_cents_ex_gst, p.min_order_qty, p.order_increment, p.unit_label, p.stock_status,
    p.lead_time_days, p.warranty_years, p.datasheet_url, a.firebase_uid supplier_uid,
    a.business_name supplier_name, a.business_website supplier_website, a.service_states supplier_service_states
    FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
    WHERE p.listing_status = 'published' AND p.review_status = 'approved'
      AND a.partner_type = 'supplier' AND a.account_status = 'active' AND a.verification_status = 'approved'
      AND (a.billing_status IN ('trial', 'active', 'active_cancels_at_period_end') OR EXISTS (
        SELECT 1 FROM trade_account_feature_grants fg WHERE fg.firebase_uid = a.firebase_uid
          AND fg.feature_key = 'supplier_visibility' AND fg.status = 'active'
          AND (fg.expires_at = '' OR fg.expires_at > ?)
      ))
      AND (? = '' OR p.category = ?)
      AND (? = '' OR LOWER(p.model_number || ' ' || p.brand || ' ' || p.name || ' ' || p.description || ' ' || a.business_name) LIKE ?)
    ORDER BY p.name COLLATE NOCASE, p.brand COLLATE NOCASE, p.model_number COLLATE NOCASE LIMIT 300`)
    .bind(new Date().toISOString(), category, category, search, `%${search}%`).all<Record<string, unknown>>();
  const ids = rows.results.map((row) => String(row.id));
  const linkedProducts: Record<string, unknown>[] = [];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    const links = await db.prepare(`SELECT l.product_id, l.relationship, l.default_qty, l.note,
      p.id linked_product_id, p.model_number, p.brand, p.name, p.unit_price_cents_ex_gst
      FROM supplier_product_links l JOIN supplier_products p ON p.id = l.linked_product_id
      WHERE l.product_id IN (${batch.map(() => "?").join(",")}) AND p.listing_status = 'published' AND p.review_status = 'approved'`)
      .bind(...batch).all<Record<string, unknown>>();
    linkedProducts.push(...links.results);
  }
  return adminJson({ ok: true, products: rows.results.map((row) => ({
    id: row.id, modelNumber: row.model_number, brand: row.brand, name: row.name, category: row.category,
    description: row.description, unitPriceCentsExGst: Number(row.unit_price_cents_ex_gst), minOrderQty: Number(row.min_order_qty),
    orderIncrement: Number(row.order_increment), unitLabel: row.unit_label, stockStatus: row.stock_status,
    leadTimeDays: Number(row.lead_time_days), warrantyYears: Number(row.warranty_years), datasheetUrl: row.datasheet_url,
    supplierUid: row.supplier_uid, supplierName: row.supplier_name, supplierWebsite: row.supplier_website,
    serviceStates: (() => { try { const value = JSON.parse(String(row.supplier_service_states || "[]")); return Array.isArray(value) ? value.map(String) : []; } catch { return []; } })(),
    dependencies: linkedProducts.filter((link) => link.product_id === row.id).map((link) => ({
      relationship: link.relationship, defaultQty: Number(link.default_qty), note: link.note,
      productId: link.linked_product_id, modelNumber: link.model_number, brand: link.brand, name: link.name,
      unitPriceCentsExGst: Number(link.unit_price_cents_ex_gst),
    })),
  })) });
}
