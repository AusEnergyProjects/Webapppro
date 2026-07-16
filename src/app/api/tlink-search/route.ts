import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";

const RESULT_LIMIT = 32;
const KIND_LIMIT = 8;
const KINDS = new Set(["all", "job", "customer", "product", "order", "team"]);

type SearchKind = "job" | "customer" | "product" | "order" | "team";
type SearchRecord = { id: string; kind: SearchKind; label: string; title: string; detail: string; meta: string; query: string };

const readable = (value: unknown) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the business profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This business account is not active." }, 403);
  if (code === "TRADE_REQUIRED") return adminJson({ ok: false, error: "TLink search is available to installer and wholesaler accounts." }, 403);
  return adminJson({ ok: false, error: "TLink search could not be completed." }, 500);
}

function matches(kind: SearchKind, selected: string) {
  return selected === "all" || selected === kind;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireFirebaseIdentity(request);
    const db = getD1();
    const account = await db.prepare(`SELECT partner_type, account_status, billing_status
      FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
    if (!account) throw new Error("PROFILE_REQUIRED");
    if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
    const partnerType = String(account.partner_type);
    if (!new Set(["installer", "supplier"]).has(partnerType)) throw new Error("TRADE_REQUIRED");

    const url = new URL(request.url);
    const rawQuery = cleanAdminText(url.searchParams.get("q"), 80).replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
    const selectedKind = cleanAdminText(url.searchParams.get("kind"), 20).toLowerCase() || "all";
    if (!KINDS.has(selectedKind)) return adminJson({ ok: false, error: "Search category was not recognised." }, 400);
    if (rawQuery.length < 2) return adminJson({ ok: true, query: rawQuery, records: [], limit: RESULT_LIMIT });

    const entitlements = await accountEntitlements(identity.uid, partnerType as "installer" | "supplier", account.billing_status);
    const term = `%${rawQuery.toLowerCase()}%`;
    const now = new Date().toISOString();
    const searches: Array<Promise<SearchRecord[]>> = [];

    if (partnerType === "installer" && entitlements.features.business_operations && matches("job", selectedKind)) {
      searches.push(db.prepare(`SELECT id, work_number, title, service_category, site_area, stage, priority, assignee_label
        FROM trade_work_orders
        WHERE firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active'
          AND LOWER(work_number || ' ' || title || ' ' || service_category || ' ' || site_area || ' ' || assignee_label) LIKE ?
        ORDER BY CASE WHEN LOWER(work_number) = LOWER(?) THEN 0 ELSE 1 END, updated_at DESC LIMIT ${KIND_LIMIT}`)
        .bind(identity.uid, term, rawQuery).all<Record<string, unknown>>().then((rows: { results: Record<string, unknown>[] }) => rows.results.map((row: Record<string, unknown>) => ({
          id: String(row.id), kind: "job" as const, label: "JB", title: String(row.title || "Untitled job"),
          detail: String(row.work_number || "Job"), meta: [readable(row.stage), row.site_area, row.assignee_label].filter(Boolean).join(" | "),
          query: String(row.work_number || row.title || ""),
        }))));
    }

    if (partnerType === "installer" && entitlements.features.business_operations && matches("customer", selectedKind)) {
      searches.push(db.prepare(`SELECT id, customer_number, customer_type, first_name, last_name, business_name,
          email, phone, suburb, address_state, postcode
        FROM trade_crm_customers
        WHERE firebase_uid = ? AND record_status = 'active'
          AND LOWER(customer_number || ' ' || first_name || ' ' || last_name || ' ' || business_name || ' ' || email || ' ' || phone || ' ' || suburb || ' ' || address_state || ' ' || postcode) LIKE ?
        ORDER BY updated_at DESC LIMIT ${KIND_LIMIT}`).bind(identity.uid, term).all<Record<string, unknown>>().then((rows: { results: Record<string, unknown>[] }) => rows.results.map((row: Record<string, unknown>) => {
          const displayName = String(row.business_name || `${String(row.first_name || "")} ${String(row.last_name || "")}`.trim() || row.customer_number || "Customer");
          return { id: String(row.id), kind: "customer" as const, label: "CU", title: displayName,
            detail: String(row.customer_number || readable(row.customer_type) || "Direct customer"),
            meta: [row.suburb, row.address_state, row.phone].filter(Boolean).join(" | "), query: displayName };
        })));
    }

    if (partnerType === "installer" && entitlements.features.installer_marketplace && matches("product", selectedKind)) {
      searches.push(db.prepare(`SELECT p.id, p.model_number, p.brand, p.name, p.category, p.unit_price_cents_ex_gst,
          p.stock_status, p.lead_time_days, a.business_name supplier_name
        FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
        WHERE p.listing_status = 'published' AND p.review_status = 'approved'
          AND a.partner_type = 'supplier' AND a.account_status = 'active' AND a.verification_status = 'approved'
          AND (a.billing_status IN ('trial', 'active', 'active_cancels_at_period_end') OR EXISTS (
            SELECT 1 FROM trade_account_feature_grants fg WHERE fg.firebase_uid = a.firebase_uid
              AND fg.feature_key = 'supplier_visibility' AND fg.status = 'active'
              AND (fg.expires_at = '' OR fg.expires_at > ?)))
          AND LOWER(p.model_number || ' ' || p.brand || ' ' || p.name || ' ' || p.category || ' ' || a.business_name) LIKE ?
        ORDER BY CASE WHEN LOWER(p.model_number) = LOWER(?) THEN 0 ELSE 1 END,
          p.name COLLATE NOCASE, p.brand COLLATE NOCASE LIMIT ${KIND_LIMIT}`)
        .bind(now, term, rawQuery).all<Record<string, unknown>>().then((rows: { results: Record<string, unknown>[] }) => rows.results.map((row: Record<string, unknown>) => ({
          id: String(row.id), kind: "product" as const, label: "PR", title: String(row.name || row.model_number || "Product"),
          detail: [row.brand, row.model_number].filter(Boolean).join(" "),
          meta: [row.supplier_name, readable(row.stock_status), money.format(Number(row.unit_price_cents_ex_gst || 0) / 100)].filter(Boolean).join(" | "),
          query: String(row.model_number || row.name || ""),
        }))));
    }

    if (partnerType === "supplier" && matches("product", selectedKind)) {
      searches.push(db.prepare(`SELECT id, model_number, brand, name, category, unit_price_cents_ex_gst,
          stock_status, listing_status, review_status
        FROM supplier_products WHERE firebase_uid = ?
          AND LOWER(model_number || ' ' || brand || ' ' || name || ' ' || category || ' ' || stock_status || ' ' || listing_status || ' ' || review_status) LIKE ?
        ORDER BY CASE WHEN LOWER(model_number) = LOWER(?) THEN 0 ELSE 1 END,
          name COLLATE NOCASE, brand COLLATE NOCASE LIMIT ${KIND_LIMIT}`)
        .bind(identity.uid, term, rawQuery).all<Record<string, unknown>>().then((rows: { results: Record<string, unknown>[] }) => rows.results.map((row: Record<string, unknown>) => ({
          id: String(row.id), kind: "product" as const, label: "PR", title: String(row.name || row.model_number || "Product"),
          detail: [row.brand, row.model_number].filter(Boolean).join(" "),
          meta: [readable(row.listing_status), readable(row.review_status), readable(row.stock_status), money.format(Number(row.unit_price_cents_ex_gst || 0) / 100)].filter(Boolean).join(" | "),
          query: String(row.model_number || row.name || ""),
        }))));
    }

    if (entitlements.features.business_operations && matches("order", selectedKind)) {
      const ownerColumn = partnerType === "supplier" ? "supplier_uid" : "installer_uid";
      searches.push(db.prepare(`SELECT po.id, po.order_number, po.status, po.installer_reference, po.supplier_reference,
          po.total_cents_inc_gst, l.name list_name, ia.business_name installer_business, sa.business_name supplier_business
        FROM trade_purchase_orders po
        JOIN installer_product_lists l ON l.id = po.list_id
        JOIN trade_accounts ia ON ia.firebase_uid = po.installer_uid
        JOIN trade_accounts sa ON sa.firebase_uid = po.supplier_uid
        WHERE po.${ownerColumn} = ?
          AND LOWER(po.order_number || ' ' || po.status || ' ' || po.installer_reference || ' ' || po.supplier_reference || ' ' || l.name || ' ' || ia.business_name || ' ' || sa.business_name) LIKE ?
        ORDER BY po.updated_at DESC LIMIT ${KIND_LIMIT}`)
        .bind(identity.uid, term).all<Record<string, unknown>>().then((rows: { results: Record<string, unknown>[] }) => rows.results.map((row: Record<string, unknown>) => ({
          id: String(row.id), kind: "order" as const, label: "PO", title: String(row.list_name || "Purchase order"),
          detail: String(row.order_number || "Order"),
          meta: [partnerType === "supplier" ? row.installer_business : row.supplier_business, readable(row.status), money.format(Number(row.total_cents_inc_gst || 0) / 100)].filter(Boolean).join(" | "),
          query: String(row.order_number || row.list_name || ""),
        }))));
    }

    if (partnerType === "installer" && entitlements.features.team_access && matches("team", selectedKind)) {
      searches.push(db.prepare(`SELECT id, email, display_name, role, status FROM trade_team_members
        WHERE owner_uid = ? AND status <> 'removed'
          AND LOWER(display_name || ' ' || email || ' ' || role || ' ' || status) LIKE ?
        ORDER BY status = 'active' DESC, display_name COLLATE NOCASE, email COLLATE NOCASE LIMIT ${KIND_LIMIT}`)
        .bind(identity.uid, term).all<Record<string, unknown>>().then((rows: { results: Record<string, unknown>[] }) => rows.results.map((row: Record<string, unknown>) => ({
          id: String(row.id), kind: "team" as const, label: "TM", title: String(row.display_name || row.email || "Team member"),
          detail: readable(row.role), meta: [row.email, readable(row.status)].filter(Boolean).join(" | "),
          query: String(row.display_name || row.email || ""),
        }))));
    }

    const records = (await Promise.all(searches)).flat().slice(0, RESULT_LIMIT);
    return adminJson({ ok: true, query: rawQuery, records, limit: RESULT_LIMIT });
  } catch (error) {
    return errorResponse(error);
  }
}
