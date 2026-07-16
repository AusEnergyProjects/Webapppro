import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";

export const runtime = "edge";

const PAGE_SIZES = new Set([25, 50, 100]);
const CATEGORIES = new Set([
  "assessment", "solar", "battery", "heating-cooling", "hot-water",
  "insulation-draughts", "ev-charging", "electrical", "plumbing",
  "mounting-hardware", "controls", "other",
]);
const STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const STOCK_STATES = new Set(["in_stock", "limited", "order_in", "unavailable"]);
const SORTS: Record<string, string> = {
  "name-asc": "p.name COLLATE NOCASE ASC, p.brand COLLATE NOCASE ASC, p.model_number COLLATE NOCASE ASC",
  "name-desc": "p.name COLLATE NOCASE DESC, p.brand COLLATE NOCASE ASC, p.model_number COLLATE NOCASE ASC",
  "brand-asc": "p.brand COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC, p.model_number COLLATE NOCASE ASC",
  "supplier-asc": "a.business_name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC, p.model_number COLLATE NOCASE ASC",
  "price-asc": "p.unit_price_cents_ex_gst ASC, p.name COLLATE NOCASE ASC",
  "price-desc": "p.unit_price_cents_ex_gst DESC, p.name COLLATE NOCASE ASC",
  "lead-asc": "p.lead_time_days ASC, p.name COLLATE NOCASE ASC",
  "model-asc": "p.model_number COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC",
};

const eligibleSupplierSql = `p.listing_status = 'published' AND p.review_status = 'approved'
  AND a.partner_type = 'supplier' AND a.account_status = 'active' AND a.verification_status = 'approved'
  AND (a.billing_status IN ('trial', 'active', 'active_cancels_at_period_end') OR EXISTS (
    SELECT 1 FROM trade_account_feature_grants fg WHERE fg.firebase_uid = a.firebase_uid
      AND fg.feature_key = 'supplier_visibility' AND fg.status = 'active'
      AND (fg.expires_at = '' OR fg.expires_at > ?)
  ))`;

function integerParam(value: string | null, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

async function installerAccount(firebaseUid: string) {
  const account = await getD1().prepare(
    "SELECT partner_type, account_status, billing_status FROM trade_accounts WHERE firebase_uid = ?",
  ).bind(firebaseUid).first<Record<string, unknown>>();
  if (!account || account.account_status !== "active") return { error: "An active business account is required." };
  if (account.partner_type !== "installer") return { error: "The trade product marketplace is reserved for installer accounts." };
  if (!await accountHasFeature(firebaseUid, "installer", account.billing_status, "installer_marketplace")) {
    return { error: "The wholesale product marketplace is available with paid membership or an administrator feature grant." };
  }
  return { account };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  let identity;
  try { identity = await requireFirebaseIdentity(request); }
  catch { return adminJson({ ok: false, error: "Sign in to continue." }, 401); }
  const access = await installerAccount(identity.uid);
  if (access.error) return adminJson({ ok: false, error: access.error }, 403);

  const url = new URL(request.url);
  const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
  const modelSearch = cleanAdminText(url.searchParams.get("model"), 100).toLowerCase();
  const categoryValue = cleanAdminText(url.searchParams.get("category"), 40);
  const category = CATEGORIES.has(categoryValue) ? categoryValue : "";
  const supplierUid = cleanAdminText(url.searchParams.get("supplier"), 160);
  const brand = cleanAdminText(url.searchParams.get("brand"), 100);
  const serviceStateValue = cleanAdminText(url.searchParams.get("state"), 12).toUpperCase();
  const serviceState = STATES.has(serviceStateValue) ? serviceStateValue : "";
  const stockValue = cleanAdminText(url.searchParams.get("stock"), 30);
  const stock = STOCK_STATES.has(stockValue) ? stockValue : "";
  const minimumPriceCents = integerParam(url.searchParams.get("minPrice"), 0, 0, 100_000_000);
  const maximumPriceCents = integerParam(url.searchParams.get("maxPrice"), 0, 0, 100_000_000);
  const maximumLeadDays = integerParam(url.searchParams.get("maxLead"), -1, -1, 3650);
  const minimumWarrantyYears = integerParam(url.searchParams.get("minWarranty"), 0, 0, 100);
  const sortValue = cleanAdminText(url.searchParams.get("sort"), 30);
  const sort = SORTS[sortValue] ? sortValue : "name-asc";
  const requestedPage = integerParam(url.searchParams.get("page"), 1, 1, 100_000);
  const requestedPageSize = integerParam(url.searchParams.get("pageSize"), 25, 1, 100);
  const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
  const now = new Date().toISOString();

  const conditions = [eligibleSupplierSql];
  const bindings: unknown[] = [now];
  if (category) { conditions.push("p.category = ?"); bindings.push(category); }
  if (supplierUid) { conditions.push("a.firebase_uid = ?"); bindings.push(supplierUid); }
  if (brand) { conditions.push("p.brand = ?"); bindings.push(brand); }
  if (serviceState) { conditions.push("a.service_states LIKE ?"); bindings.push(`%\"${serviceState}\"%`); }
  if (stock) { conditions.push("p.stock_status = ?"); bindings.push(stock); }
  if (minimumPriceCents) { conditions.push("p.unit_price_cents_ex_gst >= ?"); bindings.push(minimumPriceCents); }
  if (maximumPriceCents) { conditions.push("p.unit_price_cents_ex_gst <= ?"); bindings.push(maximumPriceCents); }
  if (maximumLeadDays >= 0) { conditions.push("p.lead_time_days <= ?"); bindings.push(maximumLeadDays); }
  if (minimumWarrantyYears) { conditions.push("p.warranty_years >= ?"); bindings.push(minimumWarrantyYears); }
  if (search) {
    conditions.push("LOWER(p.name) LIKE ?");
    bindings.push(`%${search}%`);
  }
  if (modelSearch) { conditions.push("LOWER(p.model_number) LIKE ?"); bindings.push(`%${modelSearch}%`); }
  const whereSql = conditions.join(" AND ");
  const db = getD1();
  const count = await db.prepare(`SELECT COUNT(*) total FROM supplier_products p
    JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid WHERE ${whereSql}`)
    .bind(...bindings).first<{ total: number }>();
  const total = Number(count?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const rowOffset = (page - 1) * pageSize;

  const rows = await db.prepare(`SELECT p.id, p.model_number, p.brand, p.name, p.category, p.description,
    p.unit_price_cents_ex_gst, p.min_order_qty, p.order_increment, p.unit_label, p.stock_status,
    p.lead_time_days, p.warranty_years, p.datasheet_url, a.firebase_uid supplier_uid,
    a.business_name supplier_name, a.business_website supplier_website, a.service_states supplier_service_states
    FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
    WHERE ${whereSql} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`)
    .bind(...bindings, pageSize, rowOffset).all<Record<string, unknown>>();

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

  const [supplierRows, brandRows, stateRows, stockRows] = await Promise.all([
    db.prepare(`SELECT DISTINCT a.firebase_uid supplier_uid, a.business_name supplier_name
      FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
      WHERE ${eligibleSupplierSql} ORDER BY a.business_name COLLATE NOCASE`).bind(now).all<Record<string, unknown>>(),
    db.prepare(`SELECT DISTINCT p.brand, a.firebase_uid supplier_uid
      FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
      WHERE ${eligibleSupplierSql} ORDER BY p.brand COLLATE NOCASE`).bind(now).all<Record<string, unknown>>(),
    db.prepare(`SELECT DISTINCT a.service_states FROM supplier_products p
      JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid WHERE ${eligibleSupplierSql}`).bind(now).all<Record<string, unknown>>(),
    db.prepare(`SELECT DISTINCT p.stock_status FROM supplier_products p
      JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid WHERE ${eligibleSupplierSql}
      ORDER BY p.stock_status COLLATE NOCASE`).bind(now).all<Record<string, unknown>>(),
  ]);
  const states = new Set<string>();
  stateRows.results.forEach((row) => {
    try {
      const values = JSON.parse(String(row.service_states || "[]"));
      if (Array.isArray(values)) values.forEach((value) => { if (STATES.has(String(value))) states.add(String(value)); });
    } catch { /* Ignore malformed legacy service-state values. */ }
  });

  return adminJson({
    ok: true,
    products: rows.results.map((row) => ({
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
    })),
    pagination: { page, pageSize, pageCount, total },
    facets: {
      suppliers: supplierRows.results.map((row) => ({ uid: String(row.supplier_uid), name: String(row.supplier_name) })),
      brands: brandRows.results.map((row) => ({ name: String(row.brand), supplierUid: String(row.supplier_uid) })),
      states: [...states].sort((left, right) => left.localeCompare(right)),
      stocks: stockRows.results.map((row) => String(row.stock_status)),
    },
  });
}
