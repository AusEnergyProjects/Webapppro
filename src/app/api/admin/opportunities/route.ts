import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, parseJsonList, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";

const STATES = new Set(["ACT", "NSW", "NT", "Qld", "SA", "Tas", "Vic", "WA"]);
const CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "other"]);
const STATUSES = new Set(["draft", "open", "paused", "closed"]);
const PRIORITIES = new Set(["standard", "priority", "urgent"]);
const TIMINGS = new Set(["planning", "within_3_months", "within_30_days", "urgent"]);

function cleanCategories(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && CATEGORIES.has(item)))] : [];
}

function shape(row: Record<string, unknown>) {
  return { id: row.id, title: row.title, projectType: row.project_type, postcode: row.postcode, state: row.state,
    serviceCategories: parseJsonList(row.service_categories), priority: row.priority, timing: row.timing,
    summary: row.summary, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    matchCount: Number(row.match_count || 0), interestedCount: Number(row.interested_count || 0) };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const rows = await getD1().prepare(`SELECT o.*,
      COUNT(m.id) match_count,
      SUM(CASE WHEN m.status = 'interested' THEN 1 ELSE 0 END) interested_count
      FROM trade_opportunities o LEFT JOIN trade_opportunity_matches m ON m.opportunity_id = o.id
      GROUP BY o.id ORDER BY o.updated_at DESC LIMIT 100`).all<Record<string, unknown>>();
    return adminJson({ ok: true, opportunities: rows.results.map(shape) });
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
      (id, title, project_type, postcode, state, service_categories, priority, timing, summary, status, created_by_uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, title, projectType, postcode, state, JSON.stringify(serviceCategories), priority, timing, summary, status, admin.uid, now, now).run();
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
    const result = await getD1().prepare("UPDATE trade_opportunities SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, new Date().toISOString(), id).run();
    if (!result.meta.changes) return adminJson({ ok: false, error: "Opportunity not found." }, 404);
    await writeAdminAudit(admin, "opportunity.status", "trade_opportunity", id, `Changed opportunity status to ${status}.`);
    return adminJson({ ok: true });
  } catch (error) { return adminError(error); }
}

