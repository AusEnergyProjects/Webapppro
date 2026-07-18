import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";

export const runtime = "edge";

type Row = Record<string, unknown>;

function jsonList(value: unknown) {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  let identity;
  try { identity = await requireFirebaseIdentity(request); }
  catch { return adminJson({ ok: false, error: "Sign in to continue." }, 401); }
  const installer = await getD1().prepare(`SELECT partner_type, account_status, billing_status FROM trade_accounts
    WHERE firebase_uid = ?`).bind(identity.uid).first<Row>();
  if (!installer || installer.partner_type !== "installer" || installer.account_status !== "active"
    || !await accountHasFeature(identity.uid, "installer", installer.billing_status, "installer_marketplace")) {
    return adminJson({ ok: false, error: "An active verified installer account is required." }, 403);
  }
  const supplierUid = cleanAdminText(new URL(request.url).searchParams.get("supplierUid"), 180);
  const supplier = await getD1().prepare(`SELECT firebase_uid, email, business_name, abn, address_line_1, suburb,
      address_state, postcode, contact_name, phone, business_website, service_states, capabilities, summary
    FROM trade_accounts WHERE firebase_uid = ? AND partner_type = 'supplier' AND account_status = 'active'
      AND verification_status = 'approved'`).bind(supplierUid).first<Row>();
  if (!supplier) return adminJson({ ok: false, error: "This wholesaler profile is not available." }, 404);
  const [locations, products, totals] = await Promise.all([
    getD1().prepare(`SELECT id, location_name, location_type, address_line_1, suburb, address_state, postcode,
        sales_email, contact_number, dispatch_notes, service_states_json
      FROM trade_supplier_locations WHERE firebase_uid = ? AND record_status = 'active'
      ORDER BY location_type = 'head_office' DESC, location_name COLLATE NOCASE`).bind(supplierUid).all<Row>(),
    getD1().prepare(`SELECT id, model_number, brand, name, category, unit_price_cents_ex_gst, stock_status,
        lead_time_days, warranty_years, datasheet_url
      FROM supplier_products WHERE firebase_uid = ? AND listing_status = 'published' AND review_status = 'approved'
      ORDER BY name COLLATE NOCASE, model_number COLLATE NOCASE LIMIT 200`).bind(supplierUid).all<Row>(),
    getD1().prepare(`SELECT COUNT(*) product_count, COUNT(DISTINCT brand) brand_count,
        COUNT(DISTINCT category) category_count FROM supplier_products
      WHERE firebase_uid = ? AND listing_status = 'published' AND review_status = 'approved'`).bind(supplierUid).first<Row>(),
  ]);
  const fallbackLocation = {
    id: "registered", locationName: "Registered location", locationType: "head_office",
    addressLine1: String(supplier.address_line_1 || ""), suburb: String(supplier.suburb || ""),
    addressState: String(supplier.address_state || ""), postcode: String(supplier.postcode || ""),
    salesEmail: String(supplier.email || ""), contactNumber: String(supplier.phone || ""), dispatchNotes: "",
    serviceStates: jsonList(supplier.service_states),
  };
  return adminJson({ ok: true, supplier: {
    uid: supplier.firebase_uid, businessName: supplier.business_name, abn: supplier.abn,
    summary: supplier.summary, website: supplier.business_website, salesEmail: supplier.email,
    contactName: supplier.contact_name, contactNumber: supplier.phone,
    serviceStates: jsonList(supplier.service_states), capabilities: jsonList(supplier.capabilities),
    locations: locations.results.length ? locations.results.map((row) => ({
      id: row.id, locationName: row.location_name, locationType: row.location_type,
      addressLine1: row.address_line_1, suburb: row.suburb, addressState: row.address_state, postcode: row.postcode,
      salesEmail: row.sales_email, contactNumber: row.contact_number, dispatchNotes: row.dispatch_notes,
      serviceStates: jsonList(row.service_states_json),
    })) : [fallbackLocation],
    productCount: Number(totals?.product_count || 0), brandCount: Number(totals?.brand_count || 0),
    categoryCount: Number(totals?.category_count || 0),
    products: products.results.map((row) => ({ id: row.id, modelNumber: row.model_number, brand: row.brand,
      name: row.name, category: row.category, unitPriceCentsExGst: Number(row.unit_price_cents_ex_gst),
      stockStatus: row.stock_status, leadTimeDays: Number(row.lead_time_days), warrantyYears: Number(row.warranty_years),
      datasheetUrl: row.datasheet_url })),
  } });
}
