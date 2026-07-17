import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, parseJsonList, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import {
  FEATURE_KEYS,
  resolveEntitlements,
  type FeatureGrant,
  type FeatureKey,
  type PartnerType,
} from "@/lib/direct-trade-entitlements";
import { decodeKeysetCursor, encodeKeysetCursor, keysetAfter, type KeysetDirection } from "@/lib/keyset-pagination";
import { performanceJson, routeTimer } from "@/lib/route-performance";
import { ftsPrefixQuery } from "@/lib/fts-search";

export const runtime = "edge";

const ACCOUNT_STATUSES = new Set(["active", "suspended", "closed"]);
const VERIFICATION_STATUSES = new Set(["not_started", "submitted", "under_review", "needs_information", "approved", "rejected", "expired"]);
const AVAILABILITY_STATUSES = new Set(["open", "limited", "paused"]);
const PLAN_KEYS = new Set(["unselected", "installer_annual", "installer_monthly", "supplier_annual", "supplier_monthly"]);
const BILLING_STATUSES = new Set(["not_connected", "processing", "trial", "active", "active_cancels_at_period_end", "past_due", "paused", "cancelled"]);
const PAGE_SIZES = new Set([25, 50, 100]);
type AccountSortTerm = { expression: string; direction: KeysetDirection; rowKey: string };
type AccountSort = { orderBy: string; terms: AccountSortTerm[] };
const term = (expression: string, direction: KeysetDirection, rowKey: string): AccountSortTerm => ({ expression, direction, rowKey });
const makeSort = (terms: AccountSortTerm[]): AccountSort => {
  const stable = [...terms, term("firebase_uid", terms.at(-1)?.direction || "asc", "firebase_uid")];
  return { orderBy: stable.map((item) => `${item.expression} ${item.direction.toUpperCase()}`).join(", "), terms: stable };
};
const SORTS: Record<string, AccountSort> = {
  "updated-desc": makeSort([term("updated_at", "desc", "updated_at")]),
  "updated-asc": makeSort([term("updated_at", "asc", "updated_at")]),
  "name-asc": makeSort([term("business_name COLLATE NOCASE", "asc", "business_name"), term("updated_at", "desc", "updated_at")]),
  "name-desc": makeSort([term("business_name COLLATE NOCASE", "desc", "business_name"), term("updated_at", "desc", "updated_at")]),
  "type-asc": makeSort([term("partner_type COLLATE NOCASE", "asc", "partner_type"), term("business_name COLLATE NOCASE", "asc", "business_name")]),
  "type-desc": makeSort([term("partner_type COLLATE NOCASE", "desc", "partner_type"), term("business_name COLLATE NOCASE", "asc", "business_name")]),
  "verification-asc": makeSort([term("verification_status COLLATE NOCASE", "asc", "verification_status"), term("business_name COLLATE NOCASE", "asc", "business_name")]),
  "status-asc": makeSort([term("account_status COLLATE NOCASE", "asc", "account_status"), term("business_name COLLATE NOCASE", "asc", "business_name")]),
  "status-desc": makeSort([term("account_status COLLATE NOCASE", "desc", "account_status"), term("business_name COLLATE NOCASE", "asc", "business_name")]),
};

function cursorValues(sort: AccountSort, row: Record<string, unknown>) {
  return sort.terms.map((item) => String(row[item.rowKey] || ""));
}

function shapeAccount(row: Record<string, unknown>) {
  return {
    firebaseUid: row.firebase_uid,
    email: row.email,
    businessName: row.business_name,
    abn: row.abn,
    contactName: row.contact_name,
    phone: row.phone,
    partnerType: row.partner_type,
    businessWebsite: row.business_website,
    addressLine1: row.address_line_1,
    suburb: row.suburb,
    addressState: row.address_state,
    postcode: row.postcode,
    serviceStates: parseJsonList(row.service_states),
    capabilities: parseJsonList(row.capabilities),
    summary: row.summary,
    accountStatus: row.account_status,
    verificationStatus: row.verification_status,
    planKey: row.plan_key,
    billingStatus: row.billing_status,
    availabilityStatus: row.availability_status,
    serviceBasePostcode: row.service_base_postcode || row.postcode,
    serviceRadiusKm: Number(row.service_radius_km || 50),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    membershipActive: ["trial", "active", "active_cancels_at_period_end"].includes(String(row.billing_status)),
    isSynthetic: Boolean(row.is_synthetic),
  };
}

function shapeGrant(row: Record<string, unknown>): FeatureGrant {
  return {
    featureKey: String(row.feature_key) as FeatureKey,
    status: String(row.status) as "active" | "revoked",
    expiresAt: String(row.expires_at || ""),
    note: String(row.note || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const db = getD1();
    const url = new URL(request.url);
    const uid = cleanAdminText(url.searchParams.get("uid"), 180);
    if (uid) {
      const account = await db.prepare("SELECT * FROM trade_accounts WHERE firebase_uid = ? LIMIT 1").bind(uid).first<Record<string, unknown>>();
      if (!account) return adminJson({ ok: false, error: "Business account not found." }, 404);
      const [documents, notes, matches, grantRows] = await Promise.all([
        db.prepare(`SELECT id, category, file_name, content_type, size_bytes, expiry_date, status, created_at, updated_at
          FROM verification_documents WHERE firebase_uid = ? ORDER BY created_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>(),
        db.prepare(`SELECT n.id, n.note, n.created_at, COALESCE(a.display_name, a.email, 'Operations team') author
          FROM trade_account_notes n LEFT JOIN admin_users a ON a.firebase_uid = n.created_by_uid
          WHERE n.firebase_uid = ? ORDER BY n.created_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>(),
        db.prepare(`SELECT m.id, m.status match_status, m.admin_note, m.partner_note, m.matched_at, m.updated_at,
          o.id opportunity_id, o.title, o.project_type, o.state, o.postcode, o.priority, o.timing, o.status opportunity_status
          FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
          WHERE m.firebase_uid = ? ORDER BY m.updated_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>(),
        db.prepare(`SELECT feature_key, status, expires_at, note, updated_at
          FROM trade_account_feature_grants WHERE firebase_uid = ? ORDER BY feature_key`).bind(uid).all<Record<string, unknown>>(),
      ]);
      const featureGrants = grantRows.results.map(shapeGrant);
      return adminJson({
        ok: true,
        account: shapeAccount(account),
        documents: documents.results,
        notes: notes.results,
        matches: matches.results,
        featureGrants,
        entitlements: resolveEntitlements(
          String(account.partner_type) as PartnerType,
          account.billing_status,
          featureGrants,
          account.verification_status === "approved",
        ),
      });
    }

    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const partnerType = cleanAdminText(url.searchParams.get("partnerType"), 20);
    const verification = cleanAdminText(url.searchParams.get("verification"), 30);
    const synthetic = cleanAdminText(url.searchParams.get("synthetic"), 20);
    const timer = routeTimer();
    const sortValue = cleanAdminText(url.searchParams.get("sort"), 30);
    const sort = SORTS[sortValue] ? sortValue : "updated-desc";
    const requestedPage = Number(url.searchParams.get("page"));
    const requestedPageSize = Number(url.searchParams.get("pageSize"));
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
    const includeTotal = url.searchParams.get("total") !== "0";
    const cursorInput = cleanAdminText(url.searchParams.get("cursor"), 2000);
    const clauses: string[] = [];
    const bindings: unknown[] = [];
    if (search) {
      clauses.push("firebase_uid IN (SELECT entity_id FROM tlink_account_search WHERE tlink_account_search MATCH ?)");
      bindings.push(ftsPrefixQuery(search));
    }
    if (ACCOUNT_STATUSES.has(status)) { clauses.push("account_status = ?"); bindings.push(status); }
    if (["installer", "supplier"].includes(partnerType)) { clauses.push("partner_type = ?"); bindings.push(partnerType); }
    if (VERIFICATION_STATUSES.has(verification)) { clauses.push("verification_status = ?"); bindings.push(verification); }
    if (synthetic === "only") clauses.push("COALESCE(is_synthetic, 0) = 1");
    if (synthetic === "exclude") clauses.push("COALESCE(is_synthetic, 0) = 0");
    const selectedSort = SORTS[sort];
    let cursor;
    try { cursor = decodeKeysetCursor(cursorInput, sort, selectedSort.terms.length); }
    catch { return adminJson({ ok: false, error: "This account page link has expired. Start again from the first page." }, 400); }
    if (page > 1 && !cursor) return adminJson({ ok: false, error: "This account page link has expired. Start again from the first page." }, 400);
    const rowClauses = [...clauses];
    const rowBindings = [...bindings];
    if (cursor) { const after = keysetAfter(selectedSort.terms, cursor); rowClauses.push(`(${after.sql})`); rowBindings.push(...after.bindings); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rowWhere = rowClauses.length ? `WHERE ${rowClauses.join(" AND ")}` : "";
    const [countRow, rows, counts] = await timer.databases([
      includeTotal ? db.prepare(`SELECT COUNT(*) total FROM trade_accounts ${where}`).bind(...bindings).first<Record<string, unknown>>() : Promise.resolve(null),
      db.prepare(`SELECT firebase_uid, email, business_name, abn, contact_name, phone, partner_type,
      address_state, postcode, service_states, capabilities, account_status, verification_status,
      plan_key, billing_status, availability_status, service_base_postcode, service_radius_km, is_synthetic, created_at, updated_at
      FROM trade_accounts ${rowWhere} ORDER BY ${selectedSort.orderBy} LIMIT ?`)
        .bind(...rowBindings, pageSize + 1).all<Record<string, unknown>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN billing_status IN ('trial', 'active', 'active_cancels_at_period_end') THEN 1 ELSE 0 END) paid,
        SUM(CASE WHEN billing_status NOT IN ('trial', 'active', 'active_cancels_at_period_end') THEN 1 ELSE 0 END) free,
        SUM(CASE WHEN partner_type = 'supplier' AND billing_status NOT IN ('trial', 'active', 'active_cancels_at_period_end') THEN 1 ELSE 0 END) hidden_suppliers,
        SUM(CASE WHEN partner_type = 'installer' AND billing_status NOT IN ('trial', 'active', 'active_cancels_at_period_end') THEN 1 ELSE 0 END) lead_locked_installers
        FROM trade_accounts`).first<Record<string, unknown>>(),
    ]);
    const total = countRow ? Number(countRow.total || 0) : undefined;
    const hasNext = rows.results.length > pageSize;
    const pageRows = rows.results.slice(0, pageSize);
    const nextCursor = hasNext && pageRows.length ? encodeKeysetCursor(sort, cursorValues(selectedSort, pageRows.at(-1)!)) : "";
    return performanceJson({
      ok: true,
      accounts: pageRows.map(shapeAccount),
      counts: {
        total: Number(counts?.total || 0), paid: Number(counts?.paid || 0), free: Number(counts?.free || 0),
        hiddenSuppliers: Number(counts?.hidden_suppliers || 0), leadLockedInstallers: Number(counts?.lead_locked_installers || 0),
      },
      pagination: { page, pageSize, total, pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)), hasNext, nextCursor },
    }, { db, routeKey: "admin.accounts", startedAt: timer.startedAt, dbDurationMs: timer.dbDurationMs, resultCount: pageRows.length, cursorUsed: Boolean(cursor) });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid account update." }, 400); }
    const uid = cleanAdminText(body.firebaseUid, 180);
    if (!uid) return adminJson({ ok: false, error: "Choose a business account." }, 400);

    const db = getD1();
    const current = await db.prepare(`SELECT account_status, verification_status, availability_status, plan_key, billing_status
      FROM trade_accounts WHERE firebase_uid = ?`).bind(uid).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Business account not found." }, 404);

    const accountStatus = cleanAdminText(body.accountStatus, 30) || String(current.account_status);
    const verificationStatus = cleanAdminText(body.verificationStatus, 30) || String(current.verification_status);
    const availabilityStatus = cleanAdminText(body.availabilityStatus, 30) || String(current.availability_status);
    const planKey = cleanAdminText(body.planKey, 40) || String(current.plan_key);
    const billingStatus = cleanAdminText(body.billingStatus, 30) || String(current.billing_status);
    if (!ACCOUNT_STATUSES.has(accountStatus) || !VERIFICATION_STATUSES.has(verificationStatus) || !AVAILABILITY_STATUSES.has(availabilityStatus) || !PLAN_KEYS.has(planKey) || !BILLING_STATUSES.has(billingStatus)) {
      return adminJson({ ok: false, error: "One or more account settings are invalid." }, 400);
    }
    if (admin.role === "reviewer" && (accountStatus !== current.account_status || availabilityStatus !== current.availability_status || planKey !== current.plan_key || billingStatus !== current.billing_status)) {
      return adminJson({ ok: false, error: "Reviewers can update verification status and internal notes only." }, 403);
    }

    const rawFeatureGrants = body.featureGrants;
    if (rawFeatureGrants !== undefined && !["owner", "admin"].includes(admin.role)) {
      return adminJson({ ok: false, error: "Only owners and administrators can change premium feature access." }, 403);
    }
    if (rawFeatureGrants !== undefined && (!Array.isArray(rawFeatureGrants) || rawFeatureGrants.length > FEATURE_KEYS.size)) {
      return adminJson({ ok: false, error: "Premium feature settings are invalid." }, 400);
    }
    const featureGrants = Array.isArray(rawFeatureGrants)
      ? rawFeatureGrants.map((item) => {
          const grant = item && typeof item === "object" ? item as Record<string, unknown> : {};
          const featureKey = cleanAdminText(grant.featureKey, 80) as FeatureKey;
          const status = grant.enabled === true ? "active" : "revoked";
          const expiresAt = cleanAdminText(grant.expiresAt, 40);
          const note = cleanAdminText(grant.note, 500);
          if (!FEATURE_KEYS.has(featureKey) || (expiresAt && !Number.isFinite(Date.parse(expiresAt)))) throw new Error("INVALID_FEATURE_GRANT");
          return { featureKey, status, expiresAt, note };
        })
      : [];

    const note = cleanAdminText(body.note, 1200);
    const now = new Date().toISOString();
    await db.prepare(`UPDATE trade_accounts SET account_status = ?, verification_status = ?, availability_status = ?,
      plan_key = ?, billing_status = ?, updated_at = ? WHERE firebase_uid = ?`)
      .bind(accountStatus, verificationStatus, availabilityStatus, planKey, billingStatus, now, uid).run();
    if (Array.isArray(rawFeatureGrants) && featureGrants.length) {
      await db.batch(featureGrants.map((grant) => db.prepare(`INSERT INTO trade_account_feature_grants
        (id, firebase_uid, feature_key, status, expires_at, note, granted_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(firebase_uid, feature_key) DO UPDATE SET status = excluded.status,
          expires_at = excluded.expires_at, note = excluded.note, granted_by_uid = excluded.granted_by_uid,
          updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), uid, grant.featureKey, grant.status, grant.expiresAt, grant.note, admin.uid, now, now)));
    }
    if (note) await db.prepare(`INSERT INTO trade_account_notes (id, firebase_uid, note, created_by_uid, created_at)
      VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), uid, note, admin.uid, now).run();
    if (["approved", "needs_information", "rejected"].includes(verificationStatus)) {
      await db.prepare(`UPDATE admin_notifications SET status = 'resolved', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
        read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, resolved_at = ?, resolved_by_uid = ?,
        resolution_note = ?, updated_at = ? WHERE actor_uid = ? AND category = 'approval' AND status != 'resolved'
          AND event_type IN ('trade.signup', 'trade.verification_evidence_uploaded')`)
        .bind(now, admin.uid, now, admin.uid, `Verification review: ${verificationStatus}`, now, uid).run();
    }
    await writeAdminAudit(admin, "trade_account.update", "trade_account", uid, "Updated business account moderation settings.", {
      before: current,
      after: { accountStatus, verificationStatus, availabilityStatus, planKey, billingStatus, featureGrants },
      noteAdded: Boolean(note),
    });
    return adminJson({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_FEATURE_GRANT") {
      return adminJson({ ok: false, error: "Premium feature settings are invalid." }, 400);
    }
    return adminError(error);
  }
}
