import { getD1 } from "../../db";
import { cleanAdminText } from "@/lib/admin-server";

export const PAGE_SIZES = new Set([25, 50, 100]);

export const TRADE_LIST_VIEWS = new Set([
  "supplier-products",
  "installer-jobs",
  "installer-customers",
  "purchasing-orders",
]);

export const ADMIN_LIST_VIEWS = new Set(["admin-accounts"]);

type ListViewDefaults = {
  search: string;
  filter: string;
  sort: string;
  pageSize: number;
  type: string;
  synthetic: string;
  customer?: string;
  service?: string;
  pipeline?: string;
  stage?: string;
  location?: string;
  street?: string;
  phone?: string;
  postcode?: string;
  suburb?: string;
  state?: string;
  jobId?: string;
  model?: string;
  brand?: string;
  category?: string;
  stock?: string;
  minPrice?: string;
  maxPrice?: string;
};

const defaultsByView: Record<string, ListViewDefaults> = {
  "supplier-products": { search: "", filter: "all", sort: "updated-desc", pageSize: 25, type: "", synthetic: "" },
  "installer-jobs": { search: "", filter: "active", sort: "updated-desc", pageSize: 25, type: "", synthetic: "" },
  "installer-customers": { search: "", filter: "all", sort: "name-asc", pageSize: 25, type: "", synthetic: "" },
  "purchasing-orders": { search: "", filter: "active", sort: "updated-desc", pageSize: 25, type: "", synthetic: "" },
  "admin-accounts": { search: "", filter: "all", sort: "updated-desc", pageSize: 25, type: "", synthetic: "" },
};

const filtersByView: Record<string, Set<string>> = {
  "supplier-products": new Set(["all", "draft", "pending", "approved", "rejected", "archived"]),
  "installer-jobs": new Set(["active", "attention", "platform", "completed", "all"]),
  "installer-customers": new Set(["all"]),
  "purchasing-orders": new Set(["active", "claims", "complete", "all"]),
  "admin-accounts": new Set(["all", "active", "suspended", "closed"]),
};

const sortsByView: Record<string, Set<string>> = {
  "supplier-products": new Set(["updated-desc", "name-asc", "name-desc", "price-asc", "price-desc"]),
  "installer-jobs": new Set(["updated-desc", "number-asc", "number-desc", "date-asc"]),
  "installer-customers": new Set(["name-asc", "name-desc", "updated-desc"]),
  "purchasing-orders": new Set(["updated-desc", "number-asc", "number-desc", "value-desc"]),
  "admin-accounts": new Set(["updated-desc", "name-asc", "name-desc"]),
};

export function defaultListView(viewKey: string): ListViewDefaults {
  return { ...(defaultsByView[viewKey] || { search: "", filter: "all", sort: "updated-desc", pageSize: 25, type: "", synthetic: "" }) };
}

export function cleanListView(viewKey: string, raw: Record<string, unknown>) {
  const defaults = defaultListView(viewKey);
  const filter = cleanAdminText(raw.filter, 40);
  const sort = cleanAdminText(raw.sort, 40);
  const pageSize = Number(raw.pageSize);
  return {
    search: cleanAdminText(raw.search, 100),
    filter: filtersByView[viewKey]?.has(filter) ? filter : defaults.filter,
    sort: sortsByView[viewKey]?.has(sort) ? sort : defaults.sort,
    pageSize: PAGE_SIZES.has(pageSize) ? pageSize : defaults.pageSize,
    type: ["", "customer", "installer", "supplier", "admin"].includes(String(raw.type || "")) ? String(raw.type || "") : "",
    synthetic: ["", "exclude", "only"].includes(String(raw.synthetic || "")) ? String(raw.synthetic || "") : "",
    customer: cleanAdminText(raw.customer, 100),
    service: cleanAdminText(raw.service, 40),
    pipeline: cleanAdminText(raw.pipeline, 40),
    stage: cleanAdminText(raw.stage, 40),
    location: cleanAdminText(raw.location, 100),
    street: cleanAdminText(raw.street, 120),
    phone: cleanAdminText(raw.phone, 50),
    postcode: cleanAdminText(raw.postcode, 12),
    suburb: cleanAdminText(raw.suburb, 100),
    state: cleanAdminText(raw.state, 12),
    jobId: cleanAdminText(raw.jobId, 80),
    model: cleanAdminText(raw.model, 100),
    brand: cleanAdminText(raw.brand, 100),
    category: cleanAdminText(raw.category, 40),
    stock: cleanAdminText(raw.stock, 30),
    minPrice: cleanAdminText(raw.minPrice, 20),
    maxPrice: cleanAdminText(raw.maxPrice, 20),
  };
}

export async function readListView(ownerUid: string, ownerScope: string, viewKey: string) {
  const row = await getD1().prepare(`SELECT preferences FROM workspace_list_views
    WHERE owner_uid = ? AND owner_scope = ? AND view_key = ?`)
    .bind(ownerUid, ownerScope, viewKey).first<Record<string, unknown>>();
  if (!row) return { preferences: defaultListView(viewKey), saved: false };
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(String(row.preferences || "{}")) as Record<string, unknown>; } catch { parsed = {}; }
  return { preferences: cleanListView(viewKey, parsed), saved: true };
}

export async function saveListView(ownerUid: string, ownerScope: string, viewKey: string, raw: Record<string, unknown>) {
  const preferences = cleanListView(viewKey, raw);
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO workspace_list_views
    (id, owner_uid, owner_scope, view_key, preferences, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_uid, owner_scope, view_key) DO UPDATE SET
      preferences = excluded.preferences, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), ownerUid, ownerScope, viewKey, JSON.stringify(preferences), now).run();
  return preferences;
}

export async function deleteListView(ownerUid: string, ownerScope: string, viewKey: string) {
  await getD1().prepare(`DELETE FROM workspace_list_views
    WHERE owner_uid = ? AND owner_scope = ? AND view_key = ?`)
    .bind(ownerUid, ownerScope, viewKey).run();
  return defaultListView(viewKey);
}
