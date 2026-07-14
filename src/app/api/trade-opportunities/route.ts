import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { parseJsonList } from "@/lib/admin-server";

export const runtime = "edge";
const PARTNER_STATUSES = new Set(["viewed", "interested", "declined"]);

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function identity(request: Request) {
  try { return await requireFirebaseIdentity(request); }
  catch { return null; }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const db = getD1();
  const account = await db.prepare("SELECT account_status FROM trade_accounts WHERE firebase_uid = ?").bind(user.uid).first<Record<string, unknown>>();
  if (!account) return json({ ok: false, error: "Complete the business profile first." }, 404);
  const rows = await db.prepare(`SELECT m.id match_id, m.status match_status, m.partner_note, m.matched_at, m.updated_at,
    o.id, o.title, o.project_type, o.postcode, o.state, o.service_categories, o.priority, o.timing, o.summary, o.status
    FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
    WHERE m.firebase_uid = ? AND o.status IN ('open', 'paused', 'closed')
    ORDER BY CASE m.status WHEN 'offered' THEN 0 WHEN 'viewed' THEN 1 WHEN 'interested' THEN 2 ELSE 3 END, m.updated_at DESC
    LIMIT 100`).bind(user.uid).all<Record<string, unknown>>();
  return json({ ok: true, opportunities: rows.results.map((row: Record<string, unknown>) => ({
    matchId: row.match_id, matchStatus: row.match_status, partnerNote: row.partner_note,
    matchedAt: row.matched_at, updatedAt: row.updated_at, id: row.id, title: row.title,
    projectType: row.project_type, postcode: row.postcode, state: row.state,
    serviceCategories: parseJsonList(row.service_categories), priority: row.priority, timing: row.timing,
    summary: row.summary, opportunityStatus: row.status,
  })) });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: "Invalid opportunity response." }, 400); }
  const matchId = typeof body.matchId === "string" ? body.matchId.trim().slice(0, 180) : "";
  const status = typeof body.status === "string" ? body.status : "";
  const partnerNote = typeof body.partnerNote === "string" ? body.partnerNote.trim().slice(0, 800) : "";
  if (!matchId || !PARTNER_STATUSES.has(status)) return json({ ok: false, error: "Choose a valid opportunity response." }, 400);
  const result = await getD1().prepare(`UPDATE trade_opportunity_matches SET status = ?, partner_note = ?, updated_at = ?
    WHERE id = ? AND firebase_uid = ? AND status NOT IN ('closed')`)
    .bind(status, partnerNote, new Date().toISOString(), matchId, user.uid).run();
  if (!result.meta.changes) return json({ ok: false, error: "The opportunity could not be updated." }, 404);
  return json({ ok: true });
}
