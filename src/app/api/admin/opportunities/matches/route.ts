import { getD1 } from "../../../../../../db";
import {
  adminError,
  adminJson,
  cleanAdminText,
  requireAdminIdentity,
  sameOrigin,
  writeAdminAudit,
} from "@/lib/admin-server";
import { parseJsonList } from "@/lib/admin-server";
import {
  canonicalMarketplaceState,
  MAX_VISIBLE_INSTALLERS,
} from "@/lib/opportunity-server";
import { postcodeDistanceKm } from "@/lib/postcode-distance";

export const runtime = "edge";
const MATCH_STATUSES = new Set([
  "offered",
  "viewed",
  "interested",
  "declined",
  "connected",
  "closed",
]);

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return adminJson(
      { ok: false, error: "Request origin was not accepted." },
      403,
    );
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return adminJson({ ok: false, error: "Invalid match." }, 400);
    }
    const opportunityId = cleanAdminText(body.opportunityId, 180);
    const firebaseUid = cleanAdminText(body.firebaseUid, 180);
    const adminNote = cleanAdminText(body.adminNote, 800);
    if (!opportunityId || !firebaseUid)
      return adminJson(
        { ok: false, error: "Choose an opportunity and business." },
        400,
      );
    const db = getD1();
    const [opportunity, account] = await Promise.all([
      db
        .prepare(
          "SELECT id, title, status, postcode, state, service_categories FROM trade_opportunities WHERE id = ?",
        )
        .bind(opportunityId)
        .first<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT firebase_uid, business_name, account_status, partner_type, verification_status, availability_status,
        postcode, service_base_postcode, service_radius_km, service_states, capabilities
        FROM trade_accounts WHERE firebase_uid = ?`,
        )
        .bind(firebaseUid)
        .first<Record<string, unknown>>(),
    ]);
    if (!opportunity || !account)
      return adminJson(
        { ok: false, error: "The opportunity or business could not be found." },
        404,
      );
    if (opportunity.status !== "open")
      return adminJson(
        { ok: false, error: "Only open opportunities can be assigned." },
        409,
      );
    if (account.account_status !== "active")
      return adminJson(
        {
          ok: false,
          error: "Only active business accounts can receive opportunities.",
        },
        409,
      );
    if (account.partner_type !== "installer")
      return adminJson(
        {
          ok: false,
          error: "Wholesaler accounts cannot receive household opportunities.",
        },
        403,
      );
    if (
      account.verification_status !== "approved" ||
      !["open", "limited"].includes(String(account.availability_status))
    )
      return adminJson(
        {
          ok: false,
          error:
            "The installer must be approved and available before receiving an opportunity.",
        },
        409,
      );
    const serviceStates = parseJsonList(account.service_states);
    const categories = parseJsonList(opportunity.service_categories);
    const capabilities = parseJsonList(account.capabilities);
    const matchedCategories = categories.filter((item) =>
      capabilities.includes(item),
    );
    if (
      !serviceStates.includes(canonicalMarketplaceState(opportunity.state)) ||
      !matchedCategories.length
    )
      return adminJson(
        {
          ok: false,
          error: "The installer does not cover this location and work type.",
        },
        409,
      );
    const distanceKm = postcodeDistanceKm(
      String(account.service_base_postcode || account.postcode),
      String(opportunity.postcode),
    );
    if (
      distanceKm === null ||
      distanceKm > Number(account.service_radius_km || 50)
    )
      return adminJson(
        {
          ok: false,
          error: "The opportunity is outside this installer’s service radius.",
        },
        409,
      );
    const active = await db
      .prepare(
        `SELECT COUNT(*) count FROM trade_opportunity_matches
      WHERE opportunity_id = ? AND status IN ('offered', 'viewed', 'interested', 'connected')`,
      )
      .bind(opportunityId)
      .first<{ count: number }>();
    const existing = await db
      .prepare(
        "SELECT id FROM trade_opportunity_matches WHERE opportunity_id = ? AND firebase_uid = ?",
      )
      .bind(opportunityId, firebaseUid)
      .first();
    if (!existing && Number(active?.count || 0) >= MAX_VISIBLE_INSTALLERS)
      return adminJson(
        {
          ok: false,
          error:
            "This opportunity has already reached its six-installer visibility limit.",
        },
        409,
      );
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO trade_opportunity_matches
      (id, opportunity_id, firebase_uid, status, admin_note, partner_note, matched_categories, distance_metres,
       allocation_rank, match_source, contact_attempt_count, last_contact_at, connected_at, matched_by_uid, matched_at, updated_at)
      VALUES (?, ?, ?, 'offered', ?, '', ?, ?, ?, 'manual', 0, '', '', ?, ?, ?)
      ON CONFLICT(opportunity_id, firebase_uid) DO UPDATE SET admin_note = excluded.admin_note, updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        opportunityId,
        firebaseUid,
        adminNote,
        JSON.stringify(matchedCategories),
        Math.round(distanceKm * 1000),
        Number(active?.count || 0) + 1,
        admin.uid,
        now,
        now,
      )
      .run();
    await writeAdminAudit(
      admin,
      "opportunity.assign",
      "trade_opportunity",
      opportunityId,
      `Assigned opportunity to ${account.business_name}.`,
      { firebaseUid },
    );
    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request))
    return adminJson(
      { ok: false, error: "Request origin was not accepted." },
      403,
    );
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return adminJson({ ok: false, error: "Invalid match update." }, 400);
    }
    const id = cleanAdminText(body.id, 180);
    const status = cleanAdminText(body.status, 30);
    const adminNote = cleanAdminText(body.adminNote, 800);
    if (!id || !MATCH_STATUSES.has(status))
      return adminJson(
        { ok: false, error: "Choose a valid assignment status." },
        400,
      );
    const db = getD1();
    const current = await db
      .prepare(
        `SELECT m.status, m.opportunity_id, o.status opportunity_status, o.maximum_connected_installers
      FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id WHERE m.id = ?`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!current)
      return adminJson({ ok: false, error: "Assignment not found." }, 404);
    if (status === "connected") {
      if (
        current.status !== "interested" ||
        current.opportunity_status !== "open"
      )
        return adminJson(
          {
            ok: false,
            error:
              "Only an interested installer on an open opportunity can progress to customer handover.",
          },
          409,
        );
      const connected = await db
        .prepare(
          "SELECT COUNT(*) count FROM trade_opportunity_matches WHERE opportunity_id = ? AND status = 'connected'",
        )
        .bind(current.opportunity_id)
        .first<{ count: number }>();
      if (
        Number(connected?.count || 0) >=
        Number(current.maximum_connected_installers || 3)
      )
        return adminJson(
          {
            ok: false,
            error: "This opportunity has reached its installer handover limit.",
          },
          409,
        );
    }
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `UPDATE trade_opportunity_matches SET status = ?, admin_note = ?,
      connected_at = CASE WHEN ? = 'connected' THEN ? ELSE connected_at END, updated_at = ? WHERE id = ?`,
      )
      .bind(status, adminNote, status, now, now, id)
      .run();
    if (!result.meta.changes)
      return adminJson({ ok: false, error: "Assignment not found." }, 404);
    await writeAdminAudit(
      admin,
      "opportunity.assignment_status",
      "trade_opportunity_match",
      id,
      `Changed assignment status to ${status}.`,
    );
    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error);
  }
}
