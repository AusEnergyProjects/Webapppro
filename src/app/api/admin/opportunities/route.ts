import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, parseJsonList, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import { DEFAULT_CONNECTED_INSTALLERS, DEFAULT_CONTACT_LIMIT, expireStaleOpportunities, opportunityExpiry } from "@/lib/opportunity-server";

export const runtime = "edge";

const STATES = new Set(["ACT", "NSW", "NT", "Qld", "SA", "Tas", "Vic", "WA"]);
const CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "other"]);
const STATUSES = new Set(["draft", "open", "paused", "closed", "expired"]);
const PRIORITIES = new Set(["standard", "priority", "urgent"]);
const TIMINGS = new Set(["planning", "within_3_months", "within_30_days", "urgent"]);
const PAGE_SIZES = new Set([25, 50, 100]);
const SORTS: Record<string, string> = {
  "updated-desc": "o.updated_at DESC",
  "updated-asc": "o.updated_at ASC",
  "title-asc": "o.title COLLATE NOCASE ASC, o.updated_at DESC",
  "title-desc": "o.title COLLATE NOCASE DESC, o.updated_at DESC",
  "status-asc": "o.status COLLATE NOCASE ASC, o.updated_at DESC",
  "state-asc": "o.state COLLATE NOCASE ASC, o.postcode ASC, o.updated_at DESC",
  "expires-asc": "o.expires_at ASC, o.updated_at DESC",
};

function cleanCategories(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && CATEGORIES.has(item)))] : [];
}

function shape(row: Record<string, unknown>) {
  return { id: row.id, title: row.title, projectType: row.project_type, postcode: row.postcode, state: row.state,
    serviceCategories: parseJsonList(row.service_categories), priority: row.priority, timing: row.timing,
    summary: row.summary, status: row.status, sourceReference: row.source_reference,
    contactLimit: Number(row.contact_limit || DEFAULT_CONTACT_LIMIT), maximumConnectedInstallers: Number(row.maximum_connected_installers || DEFAULT_CONNECTED_INSTALLERS),
    isSynthetic: Boolean(row.is_synthetic),
    expiresAt: row.expires_at, expiredAt: row.expired_at, createdAt: row.created_at, updatedAt: row.updated_at,
    matchCount: Number(row.match_count || 0), interestedCount: Number(row.interested_count || 0), connectedCount: Number(row.connected_count || 0) };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    await expireStaleOpportunities();
    const db = getD1();
    const url = new URL(request.url);
    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const status = cleanAdminText(url.searchParams.get("status"), 20);
    const service = cleanAdminText(url.searchParams.get("service"), 40);
    const state = cleanAdminText(url.searchParams.get("state"), 12);
    const synthetic = cleanAdminText(url.searchParams.get("synthetic"), 20);
    const sort = cleanAdminText(url.searchParams.get("sort"), 30) || "updated-desc";
    const requestedPage = Number(url.searchParams.get("page"));
    const requestedPageSize = Number(url.searchParams.get("pageSize"));
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
    const clauses: string[] = [];
    const bindings: unknown[] = [];
    if (search) {
      clauses.push("LOWER(o.title || ' ' || o.summary || ' ' || o.project_type || ' ' || o.postcode) LIKE ?");
      bindings.push(`%${search}%`);
    }
    if (STATUSES.has(status)) { clauses.push("o.status = ?"); bindings.push(status); }
    if (CATEGORIES.has(service)) { clauses.push("o.service_categories LIKE ?"); bindings.push(`%\"${service}\"%`); }
    if (STATES.has(state)) { clauses.push("o.state = ?"); bindings.push(state); }
    if (synthetic === "only") clauses.push("COALESCE(o.is_synthetic, 0) = 1");
    if (synthetic === "exclude") clauses.push("COALESCE(o.is_synthetic, 0) = 0");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const orderBy = SORTS[sort] || SORTS["updated-desc"];
    const [countRow, rows, openOptions] = await Promise.all([
      db.prepare(`SELECT COUNT(*) total FROM trade_opportunities o ${where}`).bind(...bindings).first<Record<string, unknown>>(),
      db.prepare(`SELECT o.*,
      COUNT(m.id) match_count,
      SUM(CASE WHEN m.status = 'interested' THEN 1 ELSE 0 END) interested_count,
      SUM(CASE WHEN m.status = 'connected' THEN 1 ELSE 0 END) connected_count
      FROM trade_opportunities o LEFT JOIN trade_opportunity_matches m ON m.opportunity_id = o.id
      ${where} GROUP BY o.id ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .bind(...bindings, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
      db.prepare(`SELECT id, title, state, postcode FROM trade_opportunities
        WHERE status = 'open' ORDER BY updated_at DESC LIMIT 1000`).all<Record<string, unknown>>(),
    ]);
    const allocationRows = rows.results.length
      ? await db.prepare(`SELECT m.id, m.opportunity_id, m.firebase_uid, m.status, m.matched_categories,
          m.distance_metres, m.allocation_rank, m.match_source, m.contact_attempt_count, m.last_contact_at, m.connected_at, m.matched_at,
          a.business_name, a.address_state, a.postcode
          FROM trade_opportunity_matches m JOIN trade_accounts a ON a.firebase_uid = m.firebase_uid
          WHERE a.partner_type = 'installer'
            AND m.opportunity_id IN (SELECT o.id FROM trade_opportunities o ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?)
          ORDER BY m.opportunity_id, m.allocation_rank, m.matched_at`)
          .bind(...bindings, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    const total = Number(countRow?.total || 0);
    return adminJson({ ok: true, opportunities: rows.results.map((row) => ({ ...shape(row), allocations: allocationRows.results.filter((item) => item.opportunity_id === row.id).map((item) => ({
      id: item.id, firebaseUid: item.firebase_uid, businessName: item.business_name, status: item.status,
      matchedCategories: parseJsonList(item.matched_categories), distanceKm: Number(item.distance_metres || 0) / 1000,
      allocationRank: Number(item.allocation_rank || 0), matchSource: item.match_source,
      contactAttemptCount: Number(item.contact_attempt_count || 0), lastContactAt: item.last_contact_at,
      connectedAt: item.connected_at, matchedAt: item.matched_at,
    })) })), openOptions: openOptions.results.map((row) => ({ id: row.id, title: row.title, state: row.state, postcode: row.postcode })),
      pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (error) { return adminError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid opportunity." }, 400); }
    const title = cleanAdminText(body.title, 160);
    const projectType = cleanAdminText(body.projectType, 100);
    const postcode = cleanAdminText(body.postcode, 4);
    const state = cleanAdminText(body.state, 12);
    const summary = cleanAdminText(body.summary, 1600);
    const priority = cleanAdminText(body.priority, 30) || "standard";
    const timing = cleanAdminText(body.timing, 30) || "planning";
    const status = cleanAdminText(body.status, 20) || "draft";
    const serviceCategories = cleanCategories(body.serviceCategories);
    if (!title || !projectType || !summary || !STATES.has(state) || (postcode && !/^\d{4}$/.test(postcode)) || !serviceCategories.length || !PRIORITIES.has(priority) || !TIMINGS.has(timing) || !STATUSES.has(status)) {
      return adminJson({ ok: false, error: "Complete the title, region, service category, timing and privacy-safe project summary." }, 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await getD1().prepare(`INSERT INTO trade_opportunities
      (id, title, project_type, postcode, state, service_categories, priority, timing, summary, status,
       source_reference, contact_limit, maximum_connected_installers, expires_at, expired_at, created_by_uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, '', ?, ?, ?)`)
      .bind(id, title, projectType, postcode, state, JSON.stringify(serviceCategories), priority, timing, summary, status,
        DEFAULT_CONTACT_LIMIT, DEFAULT_CONNECTED_INSTALLERS, opportunityExpiry(), admin.uid, now, now).run();
    await writeAdminAudit(admin, "opportunity.create", "trade_opportunity", id, `Created opportunity: ${title}.`, { state, postcode, status });
    return adminJson({ ok: true, opportunity: { id } }, 201);
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid opportunity update." }, 400); }
    const id = cleanAdminText(body.id, 180);
    const status = cleanAdminText(body.status, 20);
    if (!id || !STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid opportunity and status." }, 400);
    if (status === "expired") return adminJson({ ok: false, error: "Expiry is automatic and cannot be applied manually." }, 400);
    const db = getD1();
    const current = await db.prepare("SELECT status, expires_at FROM trade_opportunities WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Opportunity not found." }, 404);
    if (status === "open" && current.expires_at && new Date(String(current.expires_at)).getTime() <= Date.now()) {
      await expireStaleOpportunities();
      return adminJson({ ok: false, error: "This opportunity has reached its 30 day limit and cannot be reopened." }, 409);
    }
    const now = new Date().toISOString();
    const statements = [db.prepare("UPDATE trade_opportunities SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, id)];
    if (status === "closed") statements.push(db.prepare(`UPDATE trade_opportunity_matches SET status = 'closed', updated_at = ?
      WHERE opportunity_id = ? AND status IN ('offered', 'viewed', 'interested', 'connected')`).bind(now, id));
    const [result] = await db.batch(statements);
    if (!result.meta.changes) return adminJson({ ok: false, error: "Opportunity not found." }, 404);
    await writeAdminAudit(admin, "opportunity.status", "trade_opportunity", id, `Changed opportunity status to ${status}.`);
    return adminJson({ ok: true });
  } catch (error) { return adminError(error); }
}
