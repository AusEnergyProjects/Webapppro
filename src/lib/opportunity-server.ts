import { getD1 } from "../../db";
import { parseJsonList } from "@/lib/admin-server";
import { postcodeDistanceKm } from "@/lib/postcode-distance";
import { canonicalAustralianState } from "@/lib/australian-postcodes.mjs";

export const MAX_VISIBLE_INSTALLERS = 6;
export const DEFAULT_CONNECTED_INSTALLERS = 3;
export const DEFAULT_CONTACT_LIMIT = 2;
export const OPPORTUNITY_LIFETIME_DAYS = 30;

const ACTIVE_MATCH_STATUSES = new Set([
  "offered",
  "viewed",
  "interested",
  "connected",
]);
const CATEGORY_LABELS: Record<string, string> = {
  assessment: "energy assessment",
  solar: "rooftop solar",
  battery: "home battery",
  "heating-cooling": "heating and cooling",
  "hot-water": "hot water",
  "insulation-draughts": "insulation and draught control",
  "ev-charging": "EV charging",
  other: "energy upgrade",
};

export function canonicalMarketplaceState(value: unknown) {
  return canonicalAustralianState(value) || "";
}

export function opportunityExpiry(createdAt = new Date()) {
  return new Date(
    createdAt.getTime() + OPPORTUNITY_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export async function expireStaleOpportunities() {
  const db = getD1();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE trade_opportunities SET status = 'expired', expired_at = ?, updated_at = ?
      WHERE status IN ('open', 'paused') AND (
        (expires_at != '' AND expires_at <= ?)
        OR (expires_at = '' AND datetime(created_at, '+30 days') <= ?)
      )`,
      )
      .bind(now, now, now, now),
    db
      .prepare(
        `UPDATE trade_opportunity_matches SET status = 'closed', updated_at = ?
      WHERE status IN ('offered', 'viewed', 'interested', 'connected')
      AND opportunity_id IN (SELECT id FROM trade_opportunities WHERE status = 'expired')`,
      )
      .bind(now),
  ]);
}

type DirectTradeLead = {
  eventType?: string;
  reference?: string;
  submittedAt?: string;
  postcode?: string;
  state?: string;
  projectCategories?: string[];
  propertyType?: string;
  projectStage?: string;
  projectPriorities?: string[];
  timeframe?: string;
  directTradeTriage?: { status?: string; autoSend?: boolean };
};

function readable(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function createOpportunityFromLead(payload: DirectTradeLead) {
  if (payload.eventType !== "direct_trade.project") return null;
  const postcode = String(payload.postcode || "");
  const state = canonicalMarketplaceState(payload.state);
  const categories = Array.isArray(payload.projectCategories)
    ? payload.projectCategories.filter((item) => CATEGORY_LABELS[item])
    : [];
  if (!/^\d{4}$/.test(postcode) || !state || !categories.length) return null;

  const reference = String(payload.reference || "").slice(0, 80);
  const db = getD1();
  if (reference) {
    const existing = await db
      .prepare(
        "SELECT id FROM trade_opportunities WHERE source_reference = ? LIMIT 1",
      )
      .bind(reference)
      .first();
    if (existing) return existing;
  }
  const submittedAt = Number.isFinite(
    Date.parse(String(payload.submittedAt || "")),
  )
    ? new Date(String(payload.submittedAt))
    : new Date();
  const categoryNames = categories.map((item) => CATEGORY_LABELS[item]);
  const priorities = Array.isArray(payload.projectPriorities)
    ? payload.projectPriorities.slice(0, 7).map(readable)
    : [];
  const property = readable(String(payload.propertyType || "home"));
  const stage = readable(String(payload.projectStage || "planning"));
  const summary = `${property} project at the ${stage.toLowerCase()} stage. ${priorities.length ? `Priorities: ${priorities.join(", ")}. ` : ""}Detailed household notes and contact details remain in the protected enquiry record and are not displayed in the opportunity feed.`;
  const title =
    categoryNames.length === 1
      ? `${readable(categoryNames[0])} project`
      : `${readable(categoryNames.slice(0, -1).join(", "))} and ${readable(categoryNames.at(-1) || "upgrade")} project`;
  const timing =
    payload.timeframe === "urgent"
      ? "urgent"
      : payload.timeframe === "one-three-months"
        ? "within_3_months"
        : "planning";
  const priority = payload.timeframe === "urgent" ? "urgent" : "standard";
  const id = crypto.randomUUID();
  const createdAt = submittedAt.toISOString();
  const opportunityStatus =
    payload.directTradeTriage?.autoSend === false ? "draft" : "open";
  await db
    .prepare(
      `INSERT INTO trade_opportunities
    (id, title, project_type, postcode, state, service_categories, priority, timing, summary, status,
     source_reference, contact_limit, maximum_connected_installers, expires_at, expired_at,
     created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'lead-intake', ?, ?)`,
    )
    .bind(
      id,
      title,
      `${property} · ${stage}`,
      postcode,
      state,
      JSON.stringify(categories),
      priority,
      timing,
      summary,
      opportunityStatus,
      reference,
      DEFAULT_CONTACT_LIMIT,
      DEFAULT_CONNECTED_INSTALLERS,
      opportunityExpiry(submittedAt),
      createdAt,
      createdAt,
    )
    .run();
  const allocation =
    opportunityStatus === "open"
      ? await allocateNearestInstallers(id, "automatic-lead-intake").catch(
          () => ({ allocated: [], activeCount: 0, eligibleCount: 0 }),
        )
      : { allocated: [], activeCount: 0, eligibleCount: 0 };
  return { id, allocation };
}

export type InstallerCandidate = {
  firebaseUid: string;
  businessName: string;
  distanceKm: number;
  distanceBand: number;
  matchedCategories: string[];
  radiusKm: number;
  recentAssignments: number;
  activeAssignments: number;
  fairnessLoad: number;
};

function candidateFromRow(
  row: Record<string, unknown>,
  opportunity: Record<string, unknown>,
): InstallerCandidate | null {
  const serviceStates = parseJsonList(row.service_states).map(canonicalMarketplaceState).filter(Boolean);
  const capabilities = parseJsonList(row.capabilities);
  const categories = parseJsonList(opportunity.service_categories);
  const state = canonicalMarketplaceState(opportunity.state);
  const matchedCategories = categories.filter((item) =>
    capabilities.includes(item),
  );
  if (!serviceStates.includes(state) || !matchedCategories.length) return null;
  const basePostcode = String(row.service_base_postcode || row.postcode || "");
  const distanceKm = postcodeDistanceKm(
    basePostcode,
    String(opportunity.postcode || ""),
  );
  const radiusKm = Number(row.service_radius_km || 50);
  if (
    distanceKm === null ||
    !Number.isFinite(radiusKm) ||
    distanceKm > radiusKm
  )
    return null;
  const recentAssignments = Number(row.recent_assignments || 0);
  const activeAssignments = Number(row.active_assignments || 0);
  return {
    firebaseUid: String(row.firebase_uid),
    businessName: String(row.business_name),
    distanceKm,
    distanceBand: Math.floor(distanceKm / 10),
    matchedCategories,
    radiusKm,
    recentAssignments,
    activeAssignments,
    fairnessLoad:
      recentAssignments +
      activeAssignments * 2 +
      (row.availability_status === "limited" ? 2 : 0),
  };
}

export async function allocateNearestInstallers(
  opportunityId: string,
  matchedByUid: string,
) {
  await expireStaleOpportunities();
  const db = getD1();
  const opportunity = await db
    .prepare(
      `SELECT id, title, postcode, state, service_categories, status, expires_at, COALESCE(is_synthetic, 0) is_synthetic
    FROM trade_opportunities WHERE id = ?`,
    )
    .bind(opportunityId)
    .first<Record<string, unknown>>();
  if (!opportunity) throw new Error("OPPORTUNITY_NOT_FOUND");
  if (opportunity.status !== "open") throw new Error("OPPORTUNITY_NOT_OPEN");
  if (
    postcodeDistanceKm(
      String(opportunity.postcode),
      String(opportunity.postcode),
    ) === null
  )
    throw new Error("POSTCODE_CENTROID_UNAVAILABLE");

  const existing = await db
    .prepare(
      `SELECT firebase_uid, status FROM trade_opportunity_matches WHERE opportunity_id = ?`,
    )
    .bind(opportunityId)
    .all<Record<string, unknown>>();
  const previouslyMatched = new Set(
    existing.results.map((item: Record<string, unknown>) => String(item.firebase_uid)),
  );
  const activeCount = existing.results.filter((item: Record<string, unknown>) =>
    ACTIVE_MATCH_STATUSES.has(String(item.status)),
  ).length;
  const lifetimeRecipientCount = existing.results.length;
  const openSlots = Math.max(0, MAX_VISIBLE_INSTALLERS - lifetimeRecipientCount);
  if (!openSlots) return { allocated: [], activeCount, eligibleCount: 0 };

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare(
      `SELECT a.firebase_uid, a.business_name, a.postcode, a.service_base_postcode,
    a.service_radius_km, a.service_states, a.capabilities, a.availability_status,
    (SELECT COUNT(*) FROM trade_opportunity_matches rm WHERE rm.firebase_uid = a.firebase_uid AND rm.matched_at >= ?) recent_assignments,
    (SELECT COUNT(*) FROM trade_opportunity_matches am JOIN trade_opportunities ao ON ao.id = am.opportunity_id
      WHERE am.firebase_uid = a.firebase_uid AND am.status IN ('offered', 'viewed', 'interested', 'connected') AND ao.status = 'open') active_assignments
    FROM trade_accounts a
    WHERE a.partner_type = 'installer' AND a.account_status = 'active' AND a.verification_status = 'approved'
      AND COALESCE(a.is_synthetic, 0) = ?
      AND a.availability_status IN ('open', 'limited')`,
    )
    .bind(cutoff, Number(opportunity.is_synthetic || 0))
    .all<Record<string, unknown>>();

  const candidates = rows.results
    .filter((row: Record<string, unknown>) => !previouslyMatched.has(String(row.firebase_uid)))
    .map((row: Record<string, unknown>) => candidateFromRow(row, opportunity))
    .filter((item: InstallerCandidate | null): item is InstallerCandidate => Boolean(item))
    .sort(
      (left: InstallerCandidate, right: InstallerCandidate) =>
        left.distanceBand - right.distanceBand ||
        left.fairnessLoad - right.fairnessLoad ||
        left.distanceKm - right.distanceKm ||
        left.businessName.localeCompare(right.businessName),
    );

  const selected = candidates.slice(0, openSlots);
  const now = new Date().toISOString();
  if (selected.length)
    await db.batch(
      selected.map((candidate: InstallerCandidate, index: number) =>
        db
          .prepare(
            `INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, admin_note, partner_note, matched_categories,
     distance_metres, allocation_rank, match_source, contact_attempt_count, last_contact_at, connected_at,
     matched_by_uid, matched_at, updated_at)
    VALUES (?, ?, ?, 'offered', '', '', ?, ?, ?, 'automatic', 0, '', '', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            opportunityId,
            candidate.firebaseUid,
            JSON.stringify(candidate.matchedCategories),
            Math.round(candidate.distanceKm * 1000),
            lifetimeRecipientCount + index + 1,
            matchedByUid,
            now,
            now,
          ),
      ),
    );
  return {
    allocated: selected,
    activeCount: activeCount + selected.length,
    eligibleCount: candidates.length,
  };
}
