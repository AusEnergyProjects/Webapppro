import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { parseJsonList } from "@/lib/admin-server";
import {
  allocateNearestInstallers,
  expireStaleOpportunities,
} from "@/lib/opportunity-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";

export const runtime = "edge";
const PARTNER_STATUSES = new Set(["viewed", "interested", "declined"]);

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function identity(request: Request) {
  try {
    return await requireFirebaseIdentity(request);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const db = getD1();
  const account = await db
    .prepare(
      "SELECT account_status, partner_type, billing_status FROM trade_accounts WHERE firebase_uid = ?",
    )
    .bind(user.uid)
    .first<Record<string, unknown>>();
  if (!account)
    return json(
      { ok: false, error: "Complete the business profile first." },
      404,
    );
  if (account.partner_type !== "installer")
    return json(
      {
        ok: false,
        error:
          "Household opportunities are never available to wholesaler accounts.",
      },
      403,
    );
  if (account.account_status !== "active")
    return json(
      { ok: false, error: "This business account is not active." },
      403,
    );
  if (!await accountHasFeature(user.uid, "installer", account.billing_status, "installer_leads"))
    return json(
      { ok: false, error: "Opportunity leads are available with paid membership or an administrator feature grant." },
      403,
    );
  await expireStaleOpportunities();
  const rows = await db
    .prepare(
      `SELECT m.id match_id, m.status match_status, m.partner_note, m.matched_categories,
    m.distance_metres, m.allocation_rank, m.contact_attempt_count, m.last_contact_at, m.connected_at, m.matched_at, m.updated_at,
    o.id, o.title, o.project_type, o.postcode, o.state, o.service_categories, o.priority, o.timing, o.summary, o.status,
    o.contact_limit, o.maximum_connected_installers, o.expires_at
    FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
    WHERE m.firebase_uid = ? AND o.status IN ('open', 'paused') AND m.status != 'closed'
    ORDER BY CASE m.status WHEN 'offered' THEN 0 WHEN 'viewed' THEN 1 WHEN 'interested' THEN 2 WHEN 'connected' THEN 3 ELSE 4 END, m.updated_at DESC
    LIMIT 100`,
    )
    .bind(user.uid)
    .all<Record<string, unknown>>();
  return json({
    ok: true,
    opportunities: rows.results.map((row: Record<string, unknown>) => ({
      matchId: row.match_id,
      matchStatus: row.match_status,
      partnerNote: row.partner_note,
      matchedCategories: parseJsonList(row.matched_categories),
      distanceKm: Number(row.distance_metres || 0) / 1000,
      allocationRank: Number(row.allocation_rank || 0),
      contactAttemptCount: Number(row.contact_attempt_count || 0),
      contactLimit: Number(row.contact_limit || 2),
      lastContactAt: row.last_contact_at,
      connectedAt: row.connected_at,
      expiresAt: row.expires_at,
      matchedAt: row.matched_at,
      updatedAt: row.updated_at,
      id: row.id,
      title: row.title,
      projectType: row.project_type,
      postcode: row.postcode,
      state: row.state,
      serviceCategories: parseJsonList(row.service_categories),
      priority: row.priority,
      timing: row.timing,
      summary: row.summary,
      opportunityStatus: row.status,
    })),
  });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid opportunity response." }, 400);
  }
  const matchId =
    typeof body.matchId === "string" ? body.matchId.trim().slice(0, 180) : "";
  const action = typeof body.action === "string" ? body.action : "respond";
  const status = typeof body.status === "string" ? body.status : "";
  const partnerNote =
    typeof body.partnerNote === "string"
      ? body.partnerNote.trim().slice(0, 800)
      : "";
  if (!matchId)
    return json({ ok: false, error: "Choose a valid opportunity." }, 400);
  const db = getD1();
  const account = await db
    .prepare(
      "SELECT account_status, partner_type, billing_status FROM trade_accounts WHERE firebase_uid = ?",
    )
    .bind(user.uid)
    .first<Record<string, unknown>>();
  if (!account || account.account_status !== "active")
    return json(
      { ok: false, error: "An active installer account is required." },
      403,
    );
  if (account.partner_type !== "installer")
    return json(
      {
        ok: false,
        error:
          "Wholesalers cannot access or respond to household opportunities.",
      },
      403,
    );
  if (!await accountHasFeature(user.uid, "installer", account.billing_status, "installer_leads"))
    return json(
      { ok: false, error: "Opportunity responses require paid lead access." },
      403,
    );
  await expireStaleOpportunities();
  const now = new Date().toISOString();
  if (action === "record_contact") {
    const result = await db
      .prepare(
        `UPDATE trade_opportunity_matches SET contact_attempt_count = contact_attempt_count + 1,
      last_contact_at = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status = 'connected'
        AND contact_attempt_count < (SELECT contact_limit FROM trade_opportunities WHERE id = trade_opportunity_matches.opportunity_id)
        AND opportunity_id IN (SELECT id FROM trade_opportunities WHERE status = 'open' AND expires_at > ?)`,
      )
      .bind(now, now, matchId, user.uid, now)
      .run();
    if (!result.meta.changes)
      return json(
        {
          ok: false,
          error:
            "The contact allowance is unavailable or has already been used.",
        },
        409,
      );
    const updated = await db
      .prepare(
        "SELECT contact_attempt_count FROM trade_opportunity_matches WHERE id = ? AND firebase_uid = ?",
      )
      .bind(matchId, user.uid)
      .first<{ contact_attempt_count: number }>();
    return json({
      ok: true,
      contactAttemptCount: Number(updated?.contact_attempt_count || 0),
    });
  }
  if (!PARTNER_STATUSES.has(status))
    return json(
      { ok: false, error: "Choose a valid opportunity response." },
      400,
    );
  const result = await db
    .prepare(
      `UPDATE trade_opportunity_matches SET status = ?, partner_note = ?, updated_at = ?
    WHERE id = ? AND firebase_uid = ? AND status NOT IN ('closed', 'connected')
      AND opportunity_id IN (SELECT id FROM trade_opportunities WHERE status = 'open' AND expires_at > ?)`,
    )
    .bind(status, partnerNote, now, matchId, user.uid, now)
    .run();
  if (!result.meta.changes)
    return json(
      { ok: false, error: "The opportunity could not be updated." },
      404,
    );
  if (status === "declined") {
    const match = await db
      .prepare(
        "SELECT opportunity_id FROM trade_opportunity_matches WHERE id = ? AND firebase_uid = ?",
      )
      .bind(matchId, user.uid)
      .first<{ opportunity_id: string }>();
    if (match?.opportunity_id)
      await allocateNearestInstallers(
        match.opportunity_id,
        "automatic-decline-refill",
      ).catch(() => null);
  }
  return json({ ok: true });
}
