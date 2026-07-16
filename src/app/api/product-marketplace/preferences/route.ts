import { getD1 } from "../../../../../db";
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
const SORT_KEYS = new Set(["name-asc", "name-desc", "brand-asc", "supplier-asc", "price-asc", "price-desc", "lead-asc", "model-asc"]);
const COLUMN_KEYS = ["supplier", "brand", "model", "name", "category", "price", "ordering", "stock", "lead", "warranty", "states", "kit", "actions"];
const COLUMN_SET = new Set(COLUMN_KEYS);

type PreferencePayload = {
  search?: unknown;
  modelSearch?: unknown;
  category?: unknown;
  supplierUid?: unknown;
  brand?: unknown;
  serviceState?: unknown;
  stockStatus?: unknown;
  minimumPriceCents?: unknown;
  maximumPriceCents?: unknown;
  maximumLeadDays?: unknown;
  minimumWarrantyYears?: unknown;
  sortKey?: unknown;
  pageSize?: unknown;
  visibleColumns?: unknown;
};

const defaults = {
  search: "",
  modelSearch: "",
  category: "",
  supplierUid: "",
  brand: "",
  serviceState: "",
  stockStatus: "",
  minimumPriceCents: 0,
  maximumPriceCents: 0,
  maximumLeadDays: -1,
  minimumWarrantyYears: 0,
  sortKey: "name-asc",
  pageSize: 25,
  visibleColumns: COLUMN_KEYS,
};

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function parseColumns(value: unknown) {
  let values: unknown = value;
  if (typeof value === "string") {
    try { values = JSON.parse(value); } catch { values = []; }
  }
  if (!Array.isArray(values) || values.includes("supply")) return [...COLUMN_KEYS];
  const selected = values.filter((column): column is string => typeof column === "string" && COLUMN_SET.has(column));
  return selected.length ? selected : [...COLUMN_KEYS];
}

function rowPreferences(row?: Record<string, unknown> | null) {
  if (!row) return { ...defaults, visibleColumns: [...defaults.visibleColumns] };
  return {
    search: String(row.search || ""),
    modelSearch: String(row.model_search || ""),
    category: String(row.category || ""),
    supplierUid: String(row.supplier_uid || ""),
    brand: String(row.brand || ""),
    serviceState: String(row.service_state || ""),
    stockStatus: String(row.stock_status || ""),
    minimumPriceCents: Number(row.minimum_price_cents || 0),
    maximumPriceCents: Number(row.maximum_price_cents || 0),
    maximumLeadDays: Number(row.maximum_lead_days ?? -1),
    minimumWarrantyYears: Number(row.minimum_warranty_years || 0),
    sortKey: SORT_KEYS.has(String(row.sort_key)) ? String(row.sort_key) : defaults.sortKey,
    pageSize: PAGE_SIZES.has(Number(row.page_size)) ? Number(row.page_size) : defaults.pageSize,
    visibleColumns: parseColumns(row.visible_columns),
  };
}

async function authorisedInstaller(request: Request) {
  if (!sameOrigin(request)) return { response: adminJson({ ok: false, error: "Request origin was not accepted." }, 403) };
  let identity;
  try { identity = await requireFirebaseIdentity(request); }
  catch { return { response: adminJson({ ok: false, error: "Sign in to continue." }, 401) }; }
  const account = await getD1().prepare(
    "SELECT partner_type, account_status, billing_status FROM trade_accounts WHERE firebase_uid = ?",
  ).bind(identity.uid).first<Record<string, unknown>>();
  if (!account || account.account_status !== "active" || account.partner_type !== "installer") {
    return { response: adminJson({ ok: false, error: "An active installer account is required." }, 403) };
  }
  if (!await accountHasFeature(identity.uid, "installer", account.billing_status, "installer_marketplace")) {
    return { response: adminJson({ ok: false, error: "Catalogue preferences require installer marketplace access." }, 403) };
  }
  return { identity };
}

export async function GET(request: Request) {
  const access = await authorisedInstaller(request);
  if (access.response || !access.identity) return access.response;
  const row = await getD1().prepare(
    "SELECT * FROM installer_catalogue_preferences WHERE firebase_uid = ?",
  ).bind(access.identity.uid).first<Record<string, unknown>>();
  return adminJson({ ok: true, preferences: rowPreferences(row), saved: Boolean(row) });
}

export async function PATCH(request: Request) {
  const access = await authorisedInstaller(request);
  if (access.response || !access.identity) return access.response;
  let raw: PreferencePayload;
  try { raw = await request.json() as PreferencePayload; }
  catch { return adminJson({ ok: false, error: "Invalid catalogue preferences." }, 400); }

  const categoryValue = cleanAdminText(raw.category, 40);
  const serviceStateValue = cleanAdminText(raw.serviceState, 12).toUpperCase();
  const stockValue = cleanAdminText(raw.stockStatus, 30);
  const sortValue = cleanAdminText(raw.sortKey, 30);
  const preferences = {
    search: cleanAdminText(raw.search, 100),
    modelSearch: cleanAdminText(raw.modelSearch, 100),
    category: CATEGORIES.has(categoryValue) ? categoryValue : "",
    supplierUid: cleanAdminText(raw.supplierUid, 160),
    brand: cleanAdminText(raw.brand, 100),
    serviceState: STATES.has(serviceStateValue) ? serviceStateValue : "",
    stockStatus: STOCK_STATES.has(stockValue) ? stockValue : "",
    minimumPriceCents: boundedInteger(raw.minimumPriceCents, 0, 0, 100_000_000),
    maximumPriceCents: boundedInteger(raw.maximumPriceCents, 0, 0, 100_000_000),
    maximumLeadDays: boundedInteger(raw.maximumLeadDays, -1, -1, 3650),
    minimumWarrantyYears: boundedInteger(raw.minimumWarrantyYears, 0, 0, 100),
    sortKey: SORT_KEYS.has(sortValue) ? sortValue : defaults.sortKey,
    pageSize: PAGE_SIZES.has(Number(raw.pageSize)) ? Number(raw.pageSize) : defaults.pageSize,
    visibleColumns: parseColumns(raw.visibleColumns),
  };
  if (preferences.maximumPriceCents && preferences.minimumPriceCents > preferences.maximumPriceCents) {
    return adminJson({ ok: false, error: "Maximum price must be greater than minimum price." }, 400);
  }
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO installer_catalogue_preferences
    (firebase_uid, search, model_search, category, supplier_uid, brand, service_state, stock_status,
      minimum_price_cents, maximum_price_cents, maximum_lead_days, minimum_warranty_years,
      sort_key, page_size, visible_columns, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(firebase_uid) DO UPDATE SET
      search = excluded.search, model_search = excluded.model_search, category = excluded.category, supplier_uid = excluded.supplier_uid,
      brand = excluded.brand, service_state = excluded.service_state, stock_status = excluded.stock_status,
      minimum_price_cents = excluded.minimum_price_cents, maximum_price_cents = excluded.maximum_price_cents,
      maximum_lead_days = excluded.maximum_lead_days, minimum_warranty_years = excluded.minimum_warranty_years,
      sort_key = excluded.sort_key, page_size = excluded.page_size,
      visible_columns = excluded.visible_columns, updated_at = excluded.updated_at`)
    .bind(
      access.identity.uid, preferences.search, preferences.modelSearch, preferences.category, preferences.supplierUid,
      preferences.brand, preferences.serviceState, preferences.stockStatus,
      preferences.minimumPriceCents, preferences.maximumPriceCents, preferences.maximumLeadDays,
      preferences.minimumWarrantyYears, preferences.sortKey, preferences.pageSize,
      JSON.stringify(preferences.visibleColumns), now,
    ).run();
  return adminJson({ ok: true, preferences, saved: true });
}

export async function DELETE(request: Request) {
  const access = await authorisedInstaller(request);
  if (access.response || !access.identity) return access.response;
  await getD1().prepare(
    "DELETE FROM installer_catalogue_preferences WHERE firebase_uid = ?",
  ).bind(access.identity.uid).run();
  return adminJson({ ok: true, preferences: rowPreferences(), saved: false });
}
