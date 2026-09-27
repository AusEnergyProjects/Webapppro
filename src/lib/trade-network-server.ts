import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { verifiedTradeAccountPredicate } from "./trade-access-server";
import {
  NETWORK_PAGE_SIZE, NetworkError, networkId, networkInvalid, networkRevision, networkText,
  normalizeNetworkContact, normalizeNetworkPost, type NetworkContact, type NetworkEnquiry,
  type NetworkPost, type NetworkPostInput, type NetworkWorkspace,
} from "./trade-network";

type Row = Record<string, unknown>;
const CONSENT_VERSION = "tlink-private-trade-network-v1";
const POST_LIMIT = 20;
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
export async function listNetwork(access: TeamAccess, filters: Record<string, unknown> = {}): Promise<NetworkWorkspace> {
  await accountAccess(access);
  const db = getD1(), now = new Date().toISOString();
  const membership = await db.prepare("SELECT enabled FROM trade_network_members WHERE owner_uid = ?").bind(access.ownerUid).first<Row>();
  const enabled = membership?.enabled === 1;
  const kind = networkText(filters.kind, 12), trade = networkText(filters.trade, 60), state = networkText(filters.state, 3), search = networkText(filters.search, 100);
  if (kind && kind !== "work" && kind !== "available") return networkInvalid();
  const feedOffset = offset(filters.offset), myOffset = offset(filters.myOffset), enquiryOffset = offset(filters.enquiryOffset);
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
  return { enabled, canManageMembership: access.isOwner, posts: posts.results.slice(0, NETWORK_PAGE_SIZE).map(row => postProjection(row, access)),
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
      consent_at = excluded.consent_at, updated_by_uid = excluded.updated_by_uid, updated_at = excluded.updated_at`)
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
  const hash = await requestHash({ action: "save_post", id, expectedRevision, post }), db = getD1(), now = new Date().toISOString();
  const previous = await ownPost(access, id);
  if (previous?.last_request_hash === hash) return postProjection(previous, access);
  if (expectedRevision > 0 && (!previous || Number(previous.revision) !== expectedRevision)) throw previous ? conflict() : unavailable();
  if (expectedRevision === 0) {
    const result = await db.prepare(`INSERT INTO trade_network_posts
      (id,owner_uid,kind,title,trade,suburb,postcode,state,details,rate_cents,rate_unit,starts_on,ends_on,status,revision,expires_at,last_request_hash,created_by_uid,updated_by_uid,created_at,updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ? WHERE ${enabledOwnerSql("?")}
      AND (SELECT COUNT(*) FROM trade_network_posts WHERE owner_uid = ? AND status = 'active' AND expires_at > ?) < ${POST_LIMIT}
      ON CONFLICT(id) DO NOTHING`).bind(id, access.ownerUid, ...postValues(post), new Date(Date.now() + 30 * 86_400_000).toISOString(), hash, access.actorUid, access.actorUid, now, now, access.ownerUid, access.ownerUid, access.ownerUid, now).run();
    if (Number(result.meta.changes) !== 1) {
      const retry = await ownPost(access, id);
      if (retry?.last_request_hash === hash) return postProjection(retry, access);
      throw new NetworkError("NETWORK_POST_LIMIT", "Could not publish. Refresh the network or close an old listing if you already have 20 active listings.", 409);
    }
  } else {
    const result = await db.prepare(`UPDATE trade_network_posts SET kind=?,title=?,trade=?,suburb=?,postcode=?,state=?,details=?,rate_cents=?,rate_unit=?,starts_on=?,ends_on=?,
      revision=revision+1,last_request_hash=?,updated_by_uid=?,updated_at=? WHERE id=? AND owner_uid=? AND revision=? AND ${enabledOwnerSql("trade_network_posts.owner_uid")}`)
      .bind(...postValues(post), hash, access.actorUid, now, id, access.ownerUid, expectedRevision).run();
    if (Number(result.meta.changes) !== 1) {
      const retry = await ownPost(access, id);
      if (retry?.last_request_hash === hash) return postProjection(retry, access);
      throw conflict();
    }
  }
  const saved = await ownPost(access, id);
  if (!saved) throw unavailable();
  return postProjection(saved, access);
}
export async function changeNetworkPost(access: TeamAccess, action: "close_post" | "renew_post", rawId: unknown, revision: unknown) {
  await accountAccess(access, action === "renew_post");
  const id = networkId(rawId), expectedRevision = networkRevision(revision), hash = await requestHash({ action, id, expectedRevision });
  const previous = await ownPost(access, id);
  if (!previous) throw unavailable();
  if (previous.last_request_hash === hash) return postProjection(previous, access);
  if (Number(previous.revision) !== expectedRevision) throw conflict();
  const now = new Date().toISOString(), renew = action === "renew_post";
  const result = await getD1().prepare(`UPDATE trade_network_posts SET status=?, expires_at=?, revision=revision+1,last_request_hash=?,updated_by_uid=?,updated_at=?
    WHERE id=? AND owner_uid=? AND revision=? AND ${renew ? enabledOwnerSql("trade_network_posts.owner_uid") : verifiedOwnerSql("trade_network_posts.owner_uid")}
    ${renew ? `AND (SELECT COUNT(*) FROM trade_network_posts other WHERE other.owner_uid = trade_network_posts.owner_uid AND other.id <> trade_network_posts.id AND other.status='active' AND other.expires_at > ?) < ${POST_LIMIT}` : ""}`)
    .bind(renew ? "active" : "closed", renew ? new Date(Date.now() + 30 * 86_400_000).toISOString() : previous.expires_at, hash, access.actorUid, now, id, access.ownerUid, expectedRevision, ...(renew ? [now] : [])).run();
  const saved = await ownPost(access, id);
  if (Number(result.meta.changes) !== 1 && saved?.last_request_hash !== hash) throw conflict();
  if (!saved) throw unavailable();
  return postProjection(saved, access);
}
export async function createNetworkEnquiry(access: TeamAccess, body: Record<string, unknown>): Promise<NetworkEnquiry> {
  const businessName = await accountAccess(access, true), id = networkId(body.id), postId = networkId(body.postId);
  const message = networkText(body.message, 1200, true, true), contact = normalizeNetworkContact(body.contact, body.confirmSharing);
  const hash = await requestHash({ action: "enquire", postId, message, contact });
  const prior = await getD1().prepare("SELECT * FROM trade_network_enquiries WHERE post_id=? AND sender_owner_uid=?").bind(postId, access.ownerUid).first<Row>();
  if (prior) { if (prior.message === message && prior.sender_contact_json === JSON.stringify(contact)) return enquiryProjection(prior, access); throw new NetworkError("NETWORK_ALREADY_ENQUIRED", "You have already sent an enquiry for this listing. Open it in Enquiries.", 409); }
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
  return enquiryProjection(saved, access);
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
