import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { verifiedTradeAccountPredicate } from "./trade-access-server";
import { postcodeCoordinate, postcodeDistanceKm } from "./postcode-distance";
import { postcodeMatchesState } from "./australian-postcodes.mjs";
import { closestQualifyingTradeServiceArea } from "./trade-service-area-matching.mjs";
import { australianRegulatorDate } from "./creditex-australian-regulator-date";
import {
  NETWORK_PAGE_SIZE, NetworkError, networkId, networkInvalid, networkRevision, networkText,
  normalizeNetworkAvailability, normalizeNetworkContact, normalizeNetworkMinimumRates, normalizeNetworkPost, type NetworkAvailability, type NetworkContact, type NetworkEnquiry,
  type NetworkLead, type NetworkLeadNotification, type NetworkPost, type NetworkPostInput, type NetworkWorkspace, type NetworkWorkPostAllowance,
} from "./trade-network";

type Row = Record<string, unknown>;
const CONSENT_VERSION = "tlink-private-trade-network-v1";
const POST_LIMIT = 20;
const DAILY_WORK_LIMIT = 5;
const publicationGuard = `(SELECT COUNT(*) FROM trade_network_work_publications WHERE owner_uid=? AND publication_day=?) < ${DAILY_WORK_LIMIT}`;
async function workPostAllowance(ownerUid: string, now: string): Promise<NetworkWorkPostAllowance> {
  const day = australianRegulatorDate(now);
  const row = await getD1().prepare("SELECT COUNT(*) used FROM trade_network_work_publications WHERE owner_uid=? AND publication_day=?").bind(ownerUid, day).first<Row>();
  return { limit: DAILY_WORK_LIMIT, remaining: Math.max(0, DAILY_WORK_LIMIT - Number(row?.used || 0)), day, timeZone: "Australia/Sydney" };
}
function publicationStatement(access: TeamAccess, id: string, hash: string, now: string) {
  return getD1().prepare(`INSERT INTO trade_network_work_publications (owner_uid,request_hash,post_id,publication_day,created_at)
    SELECT owner_uid,?,?,?,? FROM trade_network_posts WHERE id=? AND owner_uid=? AND kind='work' AND last_request_hash=?
    ON CONFLICT(owner_uid,request_hash) DO NOTHING`).bind(hash, id, australianRegulatorDate(now), now, id, access.ownerUid, hash);
}
async function enforceDailyLimit(ownerUid: string, now: string) {
  if ((await workPostAllowance(ownerUid, now)).remaining === 0) throw new NetworkError("NETWORK_DAILY_WORK_LIMIT", "You have used your 5 work posts for today. You can post again after midnight Sydney time.", 409);
}
const verifiedAccount = `account.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("account")}`;
function verifiedOwnerSql(ownerExpression: string) {
  return `EXISTS (SELECT 1 FROM trade_accounts account WHERE account.firebase_uid = ${ownerExpression} AND ${verifiedAccount})`;
}
function enabledOwnerSql(ownerExpression: string) {
  return `EXISTS (SELECT 1 FROM trade_network_members membership WHERE membership.owner_uid = ${ownerExpression} AND membership.enabled = 1) AND ${verifiedOwnerSql(ownerExpression)}`;
}
const unavailable = () => new NetworkError("NETWORK_UNAVAILABLE", "This listing or enquiry is no longer available. Refresh the network.", 404);
const conflict = () => new NetworkError("NETWORK_CONFLICT", "This record changed in another window. Refresh before trying again.", 409);

export function assertNetworkAccess(access: TeamAccess, ownerOnly = false) {
  if (access.fieldSessionId || !(access.isOwner || (!ownerOnly && access.canManageJobs && access.jobScope === "team"))) {
    throw new NetworkError("NETWORK_ACCESS_REQUIRED", ownerOnly ? "Only the business owner can turn the trade network on or off." : "Business owner or team-wide job management access is required.", 403);
  }
}
async function accountAccess(access: TeamAccess, enabled = false) {
  assertNetworkAccess(access);
  const row = await getD1().prepare(`SELECT account.business_name FROM trade_accounts account
    WHERE account.firebase_uid = ? AND ${verifiedAccount}
    ${enabled ? "AND EXISTS (SELECT 1 FROM trade_network_members membership WHERE membership.owner_uid = account.firebase_uid AND membership.enabled = 1)" : ""}`)
    .bind(access.ownerUid).first<Row>();
  if (!row) throw new NetworkError(enabled ? "NETWORK_DISABLED" : "NETWORK_ACCESS_REQUIRED", enabled ? "Turn on the trade network before posting or connecting." : "Approved business access is required.", 403);
  return String(row.business_name);
}
async function requestHash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function postProjection(row: Row, access: TeamAccess): NetworkPost {
  return {
    id: String(row.id), kind: row.kind === "work" ? "work" : "available", title: String(row.title), trade: String(row.trade),
    suburb: String(row.suburb), postcode: String(row.postcode), state: String(row.state), details: String(row.details),
    rateCents: row.rate_cents === null ? null : Number(row.rate_cents), rateUnit: row.rate_unit === "day" ? "day" : row.rate_unit === "job" ? "job" : "hour",
    startsOn: String(row.starts_on), endsOn: String(row.ends_on), businessName: String(row.business_name), isOwn: row.owner_uid === access.ownerUid,
    status: row.status === "closed" ? "closed" : String(row.expires_at) <= new Date().toISOString() ? "expired" : "active",
    revision: Number(row.revision), expiresAt: String(row.expires_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at), enquiryId: String(row.enquiry_id || ""),
  };
}
function enquiryProjection(row: Row, access: TeamAccess): NetworkEnquiry {
  const incoming = row.recipient_owner_uid === access.ownerUid;
  return {
    id: String(row.id), postId: String(row.post_id), postTitle: String(row.post_title), postKind: row.post_kind === "work" ? "work" : "available",
    businessName: String(incoming ? row.sender_business_name : row.recipient_business_name), direction: incoming ? "incoming" : "outgoing",
    message: String(row.message), senderContact: JSON.parse(String(row.sender_contact_json)) as NetworkContact,
    recipientContact: row.recipient_contact_json ? JSON.parse(String(row.recipient_contact_json)) as NetworkContact : null,
    status: row.status === "connected" ? "connected" : row.status === "closed" ? "closed" : "pending",
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
async function ownPost(access: TeamAccess, id: string) {
  return getD1().prepare(`SELECT post.*, account.business_name FROM trade_network_posts post
    JOIN trade_accounts account ON account.firebase_uid = post.owner_uid WHERE post.id = ? AND post.owner_uid = ?`)
    .bind(id, access.ownerUid).first<Row>();
}
async function ownEnquiry(access: TeamAccess, id: string) {
  return getD1().prepare(`SELECT * FROM trade_network_enquiries WHERE id = ? AND (sender_owner_uid = ? OR recipient_owner_uid = ?)`)
    .bind(id, access.ownerUid, access.ownerUid).first<Row>();
}
function offset(value: unknown) {
  const result = value === undefined || value === null || value === "" ? 0 : Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 1_000_000) return networkInvalid();
  return result;
}

function serviceAreasSql(ownerExpression: string) {
  return `COALESCE((SELECT json_group_array(json_object('postcode',configured.postcode,'radiusKm',configured.radius_km))
    FROM (SELECT postcode,radius_km FROM trade_account_service_areas WHERE firebase_uid=${ownerExpression}
      AND record_status='active' ORDER BY position,id) configured),'[]')`;
}
const recipientColumns = `account.firebase_uid recipient_uid,account.service_states,account.availability_status,
  account.postcode,account.service_base_postcode,account.service_radius_km,
  membership.enabled,membership.open_to_work,membership.work_trades_json,
  membership.minimum_hour_cents,membership.minimum_day_cents,membership.minimum_job_cents,
  ${serviceAreasSql("account.firebase_uid")} active_service_areas`;
const recipientEligibility = `membership.enabled=1 AND membership.open_to_work=1
  AND account.availability_status IN ('open','limited') AND ${verifiedAccount}`;
function strings(value: unknown): string[] {
  try { const parsed: unknown = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}
function availabilityProjection(row: Row): NetworkAvailability {
  const configured: unknown = JSON.parse(String(row.active_service_areas || "[]"));
  const serviceAreas: NetworkAvailability["serviceAreas"] = Array.isArray(configured) && configured.length ? configured.flatMap(area => {
    if (!area || typeof area !== "object" || typeof area.postcode !== "string" || typeof area.radiusKm !== "number") return [];
    return [{ postcode: area.postcode, radiusKm: area.radiusKm }];
  }) : [{ postcode: String(row.service_base_postcode || row.postcode || ""), radiusKm: Number(row.service_radius_km || 50) }];
  return { openToWork: row.open_to_work === 1, workTrades: strings(row.work_trades_json), serviceAreas,
    minimumRates: { hour: row.minimum_hour_cents == null ? null : Number(row.minimum_hour_cents), day: row.minimum_day_cents == null ? null : Number(row.minimum_day_cents), job: row.minimum_job_cents == null ? null : Number(row.minimum_job_cents) },
    serviceStates: strings(row.service_states), paused: !["open", "limited"].includes(String(row.availability_status)) };
}
async function networkRecipient(ownerUid: string): Promise<Row | null> {
  return getD1().prepare(`SELECT ${recipientColumns} FROM trade_accounts account
    LEFT JOIN trade_network_members membership ON membership.owner_uid=account.firebase_uid
    WHERE account.firebase_uid=? AND ${verifiedAccount}`).bind(ownerUid).first<Row>();
}
function pricedPost(post: Row): boolean {
  return typeof post.rate_cents === "number" && Number.isSafeInteger(post.rate_cents) && post.rate_cents >= 1 && post.rate_cents <= 100_000_000
    && ["hour", "day", "job"].includes(String(post.rate_unit));
}
function recipientMatchesPost(recipient: Row, post: Row): boolean {
  if (!pricedPost(post)) return false;
  const minimum = recipient[`minimum_${post.rate_unit}_cents`];
  if (minimum != null && Number(post.rate_cents) < Number(minimum)) return false;
  if (recipient.enabled !== 1 || recipient.open_to_work !== 1 || !["open", "limited"].includes(String(recipient.availability_status))
    || !strings(recipient.work_trades_json).includes(String(post.trade)) || !strings(recipient.service_states).includes(String(post.state))
    || !postcodeCoordinate(String(post.postcode)) || !postcodeMatchesState(String(post.postcode), String(post.state))) return false;
  return Boolean(closestQualifyingTradeServiceArea({ activeServiceAreas: recipient.active_service_areas,
    legacyPostcode: recipient.service_base_postcode || recipient.postcode, legacyRadiusKm: recipient.service_radius_km,
    destinationPostcode: post.postcode }, postcodeDistanceKm));
}
/** Every matching preference must still be current when a lead is persisted or exposed. */
function recipientSnapshotGuard(recipient: Row) {
  return {
    sql: `EXISTS (SELECT 1 FROM trade_accounts account JOIN trade_network_members membership ON membership.owner_uid=account.firebase_uid
      WHERE account.firebase_uid=? AND ${recipientEligibility} AND membership.work_trades_json=? AND account.service_states=?
      AND membership.minimum_hour_cents IS ? AND membership.minimum_day_cents IS ? AND membership.minimum_job_cents IS ?
      AND account.postcode=? AND account.service_base_postcode=? AND account.service_radius_km=? AND ${serviceAreasSql("account.firebase_uid")}=?)`,
    bindings: [String(recipient.recipient_uid), String(recipient.work_trades_json), String(recipient.service_states),
      recipient.minimum_hour_cents == null ? null : Number(recipient.minimum_hour_cents), recipient.minimum_day_cents == null ? null : Number(recipient.minimum_day_cents), recipient.minimum_job_cents == null ? null : Number(recipient.minimum_job_cents), String(recipient.postcode),
      String(recipient.service_base_postcode), Number(recipient.service_radius_km), String(recipient.active_service_areas)],
  };
}
function deliveryStatement(post: Row, recipient: Row, now: string) {
  const guard = recipientSnapshotGuard(recipient);
  return getD1().prepare(`INSERT INTO trade_network_leads (post_id,recipient_owner_uid,post_revision,status,matched_at,updated_at)
    SELECT post.id,?,post.revision,'new',?,? FROM trade_network_posts post
    WHERE post.id=? AND post.revision=? AND post.owner_uid<>? AND post.kind='work' AND post.status='active' AND post.expires_at>?
      AND ${enabledOwnerSql("post.owner_uid")} AND ${guard.sql}
    ON CONFLICT(post_id,recipient_owner_uid) DO UPDATE SET post_revision=excluded.post_revision,updated_at=excluded.updated_at
      WHERE trade_network_leads.post_revision<>excluded.post_revision`)
    .bind(String(recipient.recipient_uid), now, now, String(post.id), Number(post.revision), String(recipient.recipient_uid), now, ...guard.bindings);
}
async function deliverNetworkPost(post: Row) {
  if (!pricedPost(post) || post.kind !== "work" || post.status !== "active" || String(post.expires_at) <= new Date().toISOString()) return;
  const db = getD1(), now = new Date().toISOString();
  let cursor = "";
  for (;;) {
    const page = await db.prepare(`SELECT ${recipientColumns} FROM trade_accounts account
      JOIN trade_network_members membership ON membership.owner_uid=account.firebase_uid
      WHERE ${recipientEligibility} AND account.firebase_uid<>? AND account.firebase_uid>?
        AND EXISTS (SELECT 1 FROM json_each(membership.work_trades_json) WHERE value=?)
        AND EXISTS (SELECT 1 FROM json_each(account.service_states) WHERE value=?)
        AND NOT EXISTS (SELECT 1 FROM trade_network_leads lead WHERE lead.post_id=? AND lead.recipient_owner_uid=account.firebase_uid AND lead.post_revision=?)
      ORDER BY account.firebase_uid LIMIT 100`).bind(String(post.owner_uid), cursor, String(post.trade), String(post.state), String(post.id), Number(post.revision)).all<Row>();
    const matches = page.results.filter(recipient => recipientMatchesPost(recipient, post));
    for (let i = 0; i < matches.length; i += 25) await db.batch(matches.slice(i, i + 25).map(recipient => deliveryStatement(post, recipient, now)));
    if (page.results.length < 100) return;
    cursor = String(page.results.at(-1)?.recipient_uid);
  }
}
async function reconcileRecipient(recipient: Row) {
  if (recipient.enabled !== 1 || recipient.open_to_work !== 1 || !["open", "limited"].includes(String(recipient.availability_status))) return;
  const db = getD1(), now = new Date().toISOString();
  let cursor = "";
  for (;;) {
    const page = await db.prepare(`SELECT post.* FROM trade_network_posts post WHERE post.id>? AND post.owner_uid<>?
      AND post.kind='work' AND post.status='active' AND post.expires_at>?
      AND EXISTS (SELECT 1 FROM json_each(?) WHERE value=post.trade) AND EXISTS (SELECT 1 FROM json_each(?) WHERE value=post.state)
      AND ${enabledOwnerSql("post.owner_uid")}
      AND NOT EXISTS (SELECT 1 FROM trade_network_leads lead WHERE lead.post_id=post.id AND lead.recipient_owner_uid=? AND lead.post_revision=post.revision)
      ORDER BY post.id LIMIT 100`).bind(cursor, String(recipient.recipient_uid), now, String(recipient.work_trades_json), String(recipient.service_states), String(recipient.recipient_uid)).all<Row>();
    const matches = page.results.filter(post => recipientMatchesPost(recipient, post));
    for (let i = 0; i < matches.length; i += 25) await db.batch(matches.slice(i, i + 25).map(post => deliveryStatement(post, recipient, now)));
    if (page.results.length < 100) return;
    cursor = String(page.results.at(-1)?.id);
  }
}
function leadProjection(row: Row, access: TeamAccess): NetworkLead {
  return { ...postProjection(row, access), leadStatus: row.lead_status === "viewed" ? "viewed" : row.lead_status === "dismissed" ? "dismissed" : "new", receivedAt: String(row.matched_at) };
}
async function readNetworkLeads(access: TeamAccess, recipient: Row, start = 0, exactId = "") {
  const leads: NetworkLead[] = [];
  let leadCount = 0, eligibleCount = 0, cursorTime = "9999", cursorId = "";
  if (recipient.enabled !== 1 || recipient.open_to_work !== 1 || !["open", "limited"].includes(String(recipient.availability_status))) return { leads, leadCount, leadsHasMore: false };
  const guard = recipientSnapshotGuard(recipient), now = new Date().toISOString();
  for (;;) {
    const page = await getD1().prepare(`SELECT post.*,account.business_name,lead.status lead_status,lead.matched_at,
      (SELECT enquiry.id FROM trade_network_enquiries enquiry WHERE enquiry.post_id=post.id AND enquiry.sender_owner_uid=lead.recipient_owner_uid) enquiry_id
      FROM trade_network_leads lead JOIN trade_network_posts post ON post.id=lead.post_id JOIN trade_accounts account ON account.firebase_uid=post.owner_uid
      WHERE lead.recipient_owner_uid=? AND lead.status<>'dismissed' AND post.kind='work' AND post.status='active' AND post.expires_at>?
        AND post.owner_uid<>lead.recipient_owner_uid AND ${enabledOwnerSql("post.owner_uid")} AND ${guard.sql}
        AND (lead.matched_at,post.id)<(?,?)
      ORDER BY lead.matched_at DESC,post.id DESC LIMIT 100`).bind(access.ownerUid, now, ...guard.bindings, cursorTime, cursorId).all<Row>();
    for (const row of page.results) {
      if (!recipientMatchesPost(recipient, row)) continue;
      if (row.lead_status === "new") leadCount++;
      if (exactId) { if (row.id === exactId) leads.push(leadProjection(row, access)); }
      else if (eligibleCount >= start && leads.length < NETWORK_PAGE_SIZE) leads.push(leadProjection(row, access));
      eligibleCount++;
    }
    if (page.results.length < 100) break;
    cursorTime = String(page.results.at(-1)?.matched_at); cursorId = String(page.results.at(-1)?.id);
  }
  return { leads, leadCount, leadsHasMore: !exactId && eligibleCount > start + NETWORK_PAGE_SIZE };
}
export async function setNetworkAvailability(access: TeamAccess, openToWork: unknown, workTrades: unknown, minimumRates?: unknown) {
  await accountAccess(access, true);
  const preferences = normalizeNetworkAvailability(openToWork, workTrades), recipient = await networkRecipient(access.ownerUid);
  const minimums = normalizeNetworkMinimumRates(minimumRates);
  if (!recipient) throw unavailable();
  const current = availabilityProjection(recipient);
  if (preferences.openToWork && (!current.serviceStates.length || !current.serviceAreas.some(area => postcodeCoordinate(area.postcode) && Number.isFinite(area.radiusKm) && area.radiusKm >= 1))) {
    throw new NetworkError("NETWORK_SERVICE_AREA_REQUIRED", "Set your service areas in Business settings before turning on work leads.", 409);
  }
  const result = await getD1().prepare(`UPDATE trade_network_members SET open_to_work=?,work_trades_json=?,updated_by_uid=?,updated_at=?
    ,minimum_hour_cents=CASE WHEN ? THEN ? ELSE minimum_hour_cents END
    ,minimum_day_cents=CASE WHEN ? THEN ? ELSE minimum_day_cents END
    ,minimum_job_cents=CASE WHEN ? THEN ? ELSE minimum_job_cents END
    WHERE owner_uid=? AND enabled=1 AND ${verifiedOwnerSql("trade_network_members.owner_uid")}`)
    .bind(preferences.openToWork ? 1 : 0, JSON.stringify(preferences.workTrades), access.actorUid, new Date().toISOString(),
      Object.hasOwn(minimums, "hour") ? 1 : 0, minimums.hour ?? null, Object.hasOwn(minimums, "day") ? 1 : 0, minimums.day ?? null,
      Object.hasOwn(minimums, "job") ? 1 : 0, minimums.job ?? null, access.ownerUid).run();
  if (Number(result.meta.changes) !== 1) throw unavailable();
  const saved = await networkRecipient(access.ownerUid);
  if (!saved) throw unavailable();
  await reconcileRecipient(saved);
  return { availability: availabilityProjection(saved) };
}
export async function setNetworkLeadStatus(access: TeamAccess, rawId: unknown, status: unknown) {
  await accountAccess(access, true);
  const id = networkId(rawId);
  if (status !== "viewed" && status !== "dismissed") return networkInvalid();
  const recipient = await networkRecipient(access.ownerUid);
  if (!recipient) throw unavailable();
  const current = await readNetworkLeads(access, recipient, 0, id);
  if (!current.leads.length) {
    const existing = await getD1().prepare("SELECT status FROM trade_network_leads WHERE post_id=? AND recipient_owner_uid=?").bind(id, access.ownerUid).first<Row>();
    if (existing?.status === status) return { id, status };
    throw unavailable();
  }
  const guard = recipientSnapshotGuard(recipient);
  const result = await getD1().prepare(`UPDATE trade_network_leads SET status=?,updated_at=?
    WHERE post_id=? AND recipient_owner_uid=? AND status<>'dismissed' AND ${guard.sql}
      AND EXISTS (SELECT 1 FROM trade_network_posts post WHERE post.id=trade_network_leads.post_id AND post.revision=? AND post.status='active'
        AND post.kind='work' AND post.expires_at>? AND ${enabledOwnerSql("post.owner_uid")})`)
    .bind(status, new Date().toISOString(), id, access.ownerUid, ...guard.bindings, current.leads[0].revision, new Date().toISOString()).run();
  if (Number(result.meta.changes) !== 1) throw unavailable();
  return { id, status };
}
export async function listNetworkLeadNotifications(access: TeamAccess): Promise<NetworkLeadNotification[]> {
  if (access.fieldSessionId || !(access.isOwner || (access.canManageJobs && access.jobScope === "team"))) return [];
  const recipient = await networkRecipient(access.ownerUid);
  if (!recipient || recipient.enabled !== 1 || recipient.open_to_work !== 1) return [];
  await reconcileRecipient(recipient);
  const { leads } = await readNetworkLeads(access, recipient);
  return leads.map(lead => ({ id: lead.id, title: lead.title, summary: `${lead.trade} · ${lead.suburb}, ${lead.state} ${lead.postcode} · ${lead.businessName}`, createdAt: lead.receivedAt }));
}
export async function listNetwork(access: TeamAccess, filters: Record<string, unknown> = {}): Promise<NetworkWorkspace> {
  await accountAccess(access);
  const db = getD1(), now = new Date().toISOString();
  const membership = await db.prepare("SELECT enabled FROM trade_network_members WHERE owner_uid = ?").bind(access.ownerUid).first<Row>();
  const enabled = membership?.enabled === 1;
  const kind = networkText(filters.kind, 12), trade = networkText(filters.trade, 60), state = networkText(filters.state, 3), search = networkText(filters.search, 100);
  if (kind && kind !== "work" && kind !== "available") return networkInvalid();
  const feedOffset = offset(filters.offset), myOffset = offset(filters.myOffset), enquiryOffset = offset(filters.enquiryOffset);
  const leadsOffset = offset(filters.leadsOffset), leadPostId = filters.leadPostId ? networkId(filters.leadPostId) : "";
  const recipient = await networkRecipient(access.ownerUid);
  if (!recipient) throw unavailable();
  await reconcileRecipient(recipient);
  const leadInbox = await readNetworkLeads(access, recipient, leadsOffset, leadPostId);
  const feedBindings: (string | number)[] = [access.ownerUid, access.ownerUid, now, access.ownerUid, access.ownerUid];
  const predicates = [enabledOwnerSql("post.owner_uid"), "post.owner_uid <> ?", "post.status = 'active'", "post.expires_at > ?", enabledOwnerSql("?")];
  if (kind) { predicates.push("post.kind = ?"); feedBindings.push(kind); }
  if (trade) { predicates.push("post.trade = ?"); feedBindings.push(trade); }
  if (state) { predicates.push("post.state = ?"); feedBindings.push(state); }
  if (search) { predicates.push("(post.title || ' ' || post.details || ' ' || post.suburb || ' ' || post.postcode || ' ' || account.business_name) LIKE ? ESCAPE '\\'"); feedBindings.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`); }
  const posts = enabled ? await db.prepare(`SELECT post.*, account.business_name,
      (SELECT enquiry.id FROM trade_network_enquiries enquiry WHERE enquiry.post_id = post.id AND enquiry.sender_owner_uid = ?) enquiry_id
    FROM trade_network_posts post JOIN trade_accounts account ON account.firebase_uid = post.owner_uid
    WHERE ${predicates.join(" AND ")} ORDER BY post.updated_at DESC, post.id LIMIT ? OFFSET ?`)
    .bind(...feedBindings, NETWORK_PAGE_SIZE + 1, feedOffset).all<Row>() : { results: [] as Row[] };
  const mine = await db.prepare(`SELECT post.*, account.business_name FROM trade_network_posts post JOIN trade_accounts account ON account.firebase_uid = post.owner_uid
    WHERE post.owner_uid = ? ORDER BY post.updated_at DESC, post.id LIMIT ? OFFSET ?`).bind(access.ownerUid, NETWORK_PAGE_SIZE + 1, myOffset).all<Row>();
  const enquiries = await db.prepare(`SELECT * FROM trade_network_enquiries WHERE sender_owner_uid = ? OR recipient_owner_uid = ?
    ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`).bind(access.ownerUid, access.ownerUid, NETWORK_PAGE_SIZE + 1, enquiryOffset).all<Row>();
  return { enabled, canManageMembership: access.isOwner, availability: availabilityProjection(recipient), workPostAllowance: await workPostAllowance(access.ownerUid, now), ...leadInbox, posts: posts.results.slice(0, NETWORK_PAGE_SIZE).map(row => postProjection(row, access)),
    myPosts: mine.results.slice(0, NETWORK_PAGE_SIZE).map(row => postProjection(row, access)), enquiries: enquiries.results.slice(0, NETWORK_PAGE_SIZE).map(row => enquiryProjection(row, access)),
    hasMore: posts.results.length > NETWORK_PAGE_SIZE, myHasMore: mine.results.length > NETWORK_PAGE_SIZE, enquiriesHasMore: enquiries.results.length > NETWORK_PAGE_SIZE };
}
export async function setNetworkMembership(access: TeamAccess, enabled: unknown) {
  assertNetworkAccess(access, true);
  await accountAccess(access);
  if (typeof enabled !== "boolean") return networkInvalid();
  const db = getD1(), now = new Date().toISOString();
  const statements = [db.prepare(`INSERT INTO trade_network_members (owner_uid,enabled,consent_version,consent_at,updated_by_uid,updated_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE ${verifiedOwnerSql("?")}
    ON CONFLICT(owner_uid) DO UPDATE SET enabled = excluded.enabled, consent_version = excluded.consent_version,
      consent_at = excluded.consent_at, updated_by_uid = excluded.updated_by_uid, updated_at = excluded.updated_at,
      open_to_work = CASE WHEN excluded.enabled=0 THEN 0 ELSE trade_network_members.open_to_work END`)
    .bind(access.ownerUid, enabled ? 1 : 0, CONSENT_VERSION, enabled ? now : "", access.actorUid, now, access.ownerUid)];
  if (!enabled) statements.push(db.prepare(`UPDATE trade_network_posts SET status = 'closed', revision = revision + 1,
    last_request_hash = '', updated_by_uid = ?, updated_at = ? WHERE owner_uid = ? AND status = 'active'
    AND EXISTS (SELECT 1 FROM trade_network_members WHERE owner_uid = ? AND enabled = 0)`).bind(access.actorUid, now, access.ownerUid, access.ownerUid));
  const result = await db.batch(statements);
  if (Number(result[0].meta.changes) !== 1) throw unavailable();
  return { enabled };
}
const postValues = (post: NetworkPostInput) => [post.kind, post.title, post.trade, post.suburb, post.postcode, post.state, post.details, post.rateCents, post.rateUnit, post.startsOn, post.endsOn];
export async function saveNetworkPost(access: TeamAccess, rawId: unknown, revision: unknown, rawPost: unknown): Promise<NetworkPost> {
  await accountAccess(access, true);
  const id = networkId(rawId), expectedRevision = networkRevision(revision), post = normalizeNetworkPost(rawPost);
  if (!postcodeCoordinate(post.postcode) || !postcodeMatchesState(post.postcode, post.state)) return networkInvalid("Choose a recognised postcode and its matching state.");
  const hash = await requestHash({ action: "save_post", id, expectedRevision, post }), db = getD1(), now = new Date().toISOString();
  const previous = await ownPost(access, id);
  if (previous?.last_request_hash === hash) { await deliverNetworkPost(previous); return postProjection(previous, access); }
  if (expectedRevision > 0 && (!previous || Number(previous.revision) !== expectedRevision)) throw previous ? conflict() : unavailable();
  const publication = post.kind === "work" && (expectedRevision === 0 || (previous?.kind !== "work" && previous?.status === "active" && String(previous.expires_at) > now));
  const publicationBindings = publication ? [access.ownerUid, australianRegulatorDate(now)] : [];
  if (expectedRevision === 0) {
    const statement = db.prepare(`INSERT INTO trade_network_posts
      (id,owner_uid,kind,title,trade,suburb,postcode,state,details,rate_cents,rate_unit,starts_on,ends_on,status,revision,expires_at,last_request_hash,created_by_uid,updated_by_uid,created_at,updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ? WHERE ${enabledOwnerSql("?")}
      AND (SELECT COUNT(*) FROM trade_network_posts WHERE owner_uid = ? AND status = 'active' AND expires_at > ?) < ${POST_LIMIT}
      ${publication ? `AND ${publicationGuard}` : ""}
      ON CONFLICT(id) DO NOTHING`).bind(id, access.ownerUid, ...postValues(post), new Date(Date.now() + 30 * 86_400_000).toISOString(), hash, access.actorUid, access.actorUid, now, now, access.ownerUid, access.ownerUid, access.ownerUid, now, ...publicationBindings);
    const result = publication ? (await db.batch([statement, publicationStatement(access, id, hash, now)]))[0] : await statement.run();
    if (Number(result.meta.changes) !== 1) {
      const retry = await ownPost(access, id);
      if (retry?.last_request_hash === hash) { await deliverNetworkPost(retry); return postProjection(retry, access); }
      if (publication) await enforceDailyLimit(access.ownerUid, now);
      throw new NetworkError("NETWORK_POST_LIMIT", "Could not publish. Refresh the network or close an old listing if you already have 20 active listings.", 409);
    }
  } else {
    const statement = db.prepare(`UPDATE trade_network_posts SET kind=?,title=?,trade=?,suburb=?,postcode=?,state=?,details=?,rate_cents=?,rate_unit=?,starts_on=?,ends_on=?,
      revision=revision+1,last_request_hash=?,updated_by_uid=?,updated_at=? WHERE id=? AND owner_uid=? AND revision=? AND ${enabledOwnerSql("trade_network_posts.owner_uid")}
      ${publication ? `AND ${publicationGuard}` : ""}`)
      .bind(...postValues(post), hash, access.actorUid, now, id, access.ownerUid, expectedRevision, ...publicationBindings);
    const result = publication ? (await db.batch([statement, publicationStatement(access, id, hash, now)]))[0] : await statement.run();
    if (Number(result.meta.changes) !== 1) {
      const retry = await ownPost(access, id);
      if (retry?.last_request_hash === hash) { await deliverNetworkPost(retry); return postProjection(retry, access); }
      if (publication) await enforceDailyLimit(access.ownerUid, now);
      throw conflict();
    }
  }
  const saved = await ownPost(access, id);
  if (!saved) throw unavailable();
  await deliverNetworkPost(saved);
  return postProjection(saved, access);
}
export async function changeNetworkPost(access: TeamAccess, action: "close_post" | "renew_post", rawId: unknown, revision: unknown) {
  await accountAccess(access, action === "renew_post");
  const id = networkId(rawId), expectedRevision = networkRevision(revision), hash = await requestHash({ action, id, expectedRevision });
  const previous = await ownPost(access, id);
  if (!previous) throw unavailable();
  if (action === "renew_post" && !pricedPost(previous)) return networkInvalid("Edit this post to add a price greater than zero before renewing.");
  if (action === "renew_post" && (!postcodeCoordinate(String(previous.postcode)) || !postcodeMatchesState(String(previous.postcode), String(previous.state)))) return networkInvalid("Edit this post to choose a recognised postcode and its matching state before renewing.");
  if (previous.last_request_hash === hash) { await deliverNetworkPost(previous); return postProjection(previous, access); }
  if (Number(previous.revision) !== expectedRevision) throw conflict();
  const now = new Date().toISOString(), renew = action === "renew_post";
  const publication = renew && previous.kind === "work";
  const statement = getD1().prepare(`UPDATE trade_network_posts SET status=?, expires_at=?, revision=revision+1,last_request_hash=?,updated_by_uid=?,updated_at=?
    WHERE id=? AND owner_uid=? AND revision=? AND ${renew ? enabledOwnerSql("trade_network_posts.owner_uid") : verifiedOwnerSql("trade_network_posts.owner_uid")}
    ${renew ? `AND (SELECT COUNT(*) FROM trade_network_posts other WHERE other.owner_uid = trade_network_posts.owner_uid AND other.id <> trade_network_posts.id AND other.status='active' AND other.expires_at > ?) < ${POST_LIMIT}` : ""}
    ${publication ? `AND ${publicationGuard}` : ""}`)
    .bind(renew ? "active" : "closed", renew ? new Date(Date.now() + 30 * 86_400_000).toISOString() : previous.expires_at, hash, access.actorUid, now, id, access.ownerUid, expectedRevision, ...(renew ? [now] : []), ...(publication ? [access.ownerUid, australianRegulatorDate(now)] : []));
  const result = publication ? (await getD1().batch([statement, publicationStatement(access, id, hash, now)]))[0] : await statement.run();
  const saved = await ownPost(access, id);
  if (Number(result.meta.changes) !== 1 && saved?.last_request_hash !== hash) { if (publication) await enforceDailyLimit(access.ownerUid, now); throw conflict(); }
  if (!saved) throw unavailable();
  await deliverNetworkPost(saved);
  return postProjection(saved, access);
}
export async function createNetworkEnquiry(access: TeamAccess, body: Record<string, unknown>): Promise<NetworkEnquiry> {
  const businessName = await accountAccess(access, true), id = networkId(body.id), postId = networkId(body.postId);
  const message = networkText(body.message, 1200, true, true), contact = normalizeNetworkContact(body.contact, body.confirmSharing);
  const hash = await requestHash({ action: "enquire", postId, message, contact });
  const prior = await getD1().prepare("SELECT * FROM trade_network_enquiries WHERE post_id=? AND sender_owner_uid=?").bind(postId, access.ownerUid).first<Row>();
  if (prior) { if (prior.message === message && prior.sender_contact_json === JSON.stringify(contact)) { await markRespondedLead(access, postId); return enquiryProjection(prior, access); } throw new NetworkError("NETWORK_ALREADY_ENQUIRED", "You have already sent an enquiry for this listing. Open it in Enquiries.", 409); }
  const now = new Date().toISOString();
  const result = await getD1().prepare(`INSERT INTO trade_network_enquiries
    (id,post_id,sender_owner_uid,recipient_owner_uid,post_title,post_kind,sender_business_name,recipient_business_name,message,sender_contact_json,recipient_contact_json,status,revision,last_request_hash,created_by_uid,updated_by_uid,created_at,updated_at)
    SELECT ?,post.id,?,post.owner_uid,post.title,post.kind,?,account.business_name,?,?,'','pending',1,?,?,?,?,?
    FROM trade_network_posts post JOIN trade_accounts account ON account.firebase_uid=post.owner_uid
    WHERE post.id=? AND post.owner_uid<>? AND post.status='active' AND post.expires_at>?
      AND ${enabledOwnerSql("post.owner_uid")} AND ${enabledOwnerSql("?")}
      AND (SELECT COUNT(*) FROM trade_network_enquiries WHERE post_id=post.id) < 100
    ON CONFLICT DO NOTHING`)
    .bind(id, access.ownerUid, businessName, message, JSON.stringify(contact), hash, access.actorUid, access.actorUid, now, now,
      postId, access.ownerUid, now, access.ownerUid, access.ownerUid).run();
  const saved = await getD1().prepare("SELECT * FROM trade_network_enquiries WHERE post_id=? AND sender_owner_uid=?").bind(postId, access.ownerUid).first<Row>();
  if (!saved || (Number(result.meta.changes) !== 1 && saved.last_request_hash !== hash)) throw unavailable();
  await markRespondedLead(access, postId);
  return enquiryProjection(saved, access);
}
async function markRespondedLead(access: TeamAccess, postId: string) {
  await getD1().prepare(`UPDATE trade_network_leads SET status='viewed',updated_at=? WHERE post_id=? AND recipient_owner_uid=? AND status='new'
    AND EXISTS (SELECT 1 FROM trade_network_enquiries enquiry WHERE enquiry.post_id=trade_network_leads.post_id AND enquiry.sender_owner_uid=trade_network_leads.recipient_owner_uid)`)
    .bind(new Date().toISOString(), postId, access.ownerUid).run();
}
export async function changeNetworkEnquiry(access: TeamAccess, action: "connect" | "close_enquiry", body: Record<string, unknown>) {
  await accountAccess(access, action === "connect");
  const id = networkId(body.id), expectedRevision = networkRevision(body.expectedRevision);
  const contact = action === "connect" ? normalizeNetworkContact(body.contact, body.confirmSharing) : null;
  const hash = await requestHash({ action, id, expectedRevision, contact }), previous = await ownEnquiry(access, id);
  if (!previous) throw unavailable();
  if (action === "connect" && previous.recipient_owner_uid !== access.ownerUid) throw unavailable();
  if (previous.last_request_hash === hash) return enquiryProjection(previous, access);
  if (Number(previous.revision) !== expectedRevision || previous.status === "closed" || (action === "connect" && previous.status !== "pending")) throw conflict();
  const result = await getD1().prepare(`UPDATE trade_network_enquiries SET status=?, recipient_contact_json=?,revision=revision+1,last_request_hash=?,updated_by_uid=?,updated_at=?
    WHERE id=? AND revision=? AND (sender_owner_uid=? OR recipient_owner_uid=?) AND ${verifiedOwnerSql("?")}
    ${action === "connect" ? `AND recipient_owner_uid=? AND status='pending' AND ${enabledOwnerSql("sender_owner_uid")} AND ${enabledOwnerSql("recipient_owner_uid")}` : "AND status<>'closed'"}`)
    .bind(action === "connect" ? "connected" : "closed", contact ? JSON.stringify(contact) : String(previous.recipient_contact_json), hash, access.actorUid, new Date().toISOString(),
      id, expectedRevision, access.ownerUid, access.ownerUid, access.ownerUid, ...(action === "connect" ? [access.ownerUid] : [])).run();
  const saved = await ownEnquiry(access, id);
  if (Number(result.meta.changes) !== 1 && saved?.last_request_hash !== hash) throw conflict();
  if (!saved) throw unavailable();
  return enquiryProjection(saved, access);
}
