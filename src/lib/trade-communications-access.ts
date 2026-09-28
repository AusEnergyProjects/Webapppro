import { getD1 } from "../../db";
import { requireInstallerTeamAccess, type TeamAccess } from "./trade-team-server";
import { encryptProtectedPayload, decryptProtectedPayload, integrationStateHash } from "./trade-integration-crypto";
import { messageParticipantGuard } from "./trade-message-media-access";

export const COMMUNICATION_COOKIE = "__Host-tlink-comms";
const allowedPaths = new Set(["/api/trade-messages", "/api/trade-message-media", "/api/trade-team-calls", "/api/trade-push", "/api/trade-team-handoff"]);
const opaque = /^[A-Za-z0-9_-]{43}$/;
const recordId = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
type HandoffRow = { id: string; owner_uid: string; member_id: string; encrypted_auth: string; thread_id: string; call_id: string; expires_at: string };
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
export function communicationCookie(request: Request) {
  const value = (request.headers.get("cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${COMMUNICATION_COOKIE}=`))?.slice(COMMUNICATION_COOKIE.length + 1) || "";
  return opaque.test(value) ? value : "";
}
export function communicationCookieHeader(value: string, maxAge = 3600) {
  return `${COMMUNICATION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
export const communicationSessionSummary = (actor: TeamAccess) => ({ memberId: actor.memberId, name: actor.displayName, businessName: actor.businessName });

async function assertDevice(actor: TeamAccess, deviceId: string) {
  if (!deviceId) { if (actor.fieldSessionId) throw new Error("AUTH_REQUIRED"); return; }
  const active = await getD1().prepare("SELECT id FROM trade_mobile_devices WHERE owner_uid=? AND member_id=? AND device_id=? AND status='active'")
    .bind(actor.ownerUid, actor.memberId, deviceId).first();
  if (!active) throw new Error("AUTH_REQUIRED");
}

async function originalAccess(row: HandoffRow, request: Request): Promise<TeamAccess> {
  const stored = await decryptProtectedPayload(row.encrypted_auth);
  if (typeof stored.authorization !== "string" || typeof stored.deviceId !== "string") throw new Error("AUTH_REQUIRED");
  const headers = new Headers();
  headers.set("Authorization", stored.authorization);
  if (stored.deviceId) headers.set("x-aea-device-id", stored.deviceId);
  // Delegate all account, ABN, member, device session and MFA checks to the
  // existing authority on every request. A browser handoff never extends it.
  const actor = await requireInstallerTeamAccess(new Request(request.url, { headers }));
  if (actor.ownerUid !== row.owner_uid || actor.memberId !== row.member_id) throw new Error("AUTH_REQUIRED");
  await assertDevice(actor, stored.deviceId);
  return actor;
}

export async function requireTeamCommunicationAccess(request: Request): Promise<TeamAccess> {
  if (!allowedPaths.has(new URL(request.url).pathname)) throw new Error("AUTH_REQUIRED");
  if (request.headers.has("authorization")) {
    const actor = await requireInstallerTeamAccess(request);
    await assertDevice(actor, request.headers.get("x-aea-device-id") || "");
    return actor;
  }
  const token = communicationCookie(request);
  if (!token) throw new Error("AUTH_REQUIRED");
  const row = await getD1().prepare(`SELECT * FROM trade_communication_handoffs WHERE session_hash=? AND consumed_at<>'' AND expires_at>?`)
    .bind(await integrationStateHash(token), new Date().toISOString()).first<HandoffRow>();
  if (!row || request.headers.get("x-tlink-comms-member") !== row.member_id) throw new Error("AUTH_REQUIRED");
  const actor = await originalAccess(row, request);
  if (row.expires_at <= new Date().toISOString()) throw new Error("AUTH_REQUIRED");
  return actor;
}

export async function issueCommunicationHandoff(request: Request, input: Record<string, unknown>) {
  // Only the signed-in native app can mint a new handoff. Existing handoff
  // cookies cannot renew themselves or create further sessions.
  if (!request.headers.get("authorization")) throw new Error("AUTH_REQUIRED");
  const actor = await requireInstallerTeamAccess(request), db = getD1();
  await assertDevice(actor, request.headers.get("x-aea-device-id") || "");
  const threadId = input.threadId === undefined ? "" : String(input.threadId);
  const callId = input.callId === undefined ? "" : String(input.callId);
  if ((threadId && !recordId.test(threadId)) || (callId && (!threadId || !recordId.test(callId)))) throw new Error("HANDOFF_INVALID");
  if (threadId) {
    const guard = messageParticipantGuard(actor, threadId);
    if (!await db.prepare(`SELECT 1 allowed WHERE ${guard.sql}`).bind(...guard.values).first()) throw new Error("HANDOFF_ACCESS_REQUIRED");
    if (callId && !await db.prepare("SELECT id FROM trade_team_calls WHERE id=? AND thread_id=? AND owner_uid=?").bind(callId, threadId, actor.ownerUid).first()) throw new Error("HANDOFF_ACCESS_REQUIRED");
  }
  const token = randomToken(), now = Date.now(), nowIso = new Date(now).toISOString();
  const redeemBefore = new Date(now + 60000).toISOString(), expiresAt = new Date(now + 3600000).toISOString();
  const encrypted = await encryptProtectedPayload({ authorization: request.headers.get("authorization"), deviceId: request.headers.get("x-aea-device-id") || "" });
  await db.prepare("DELETE FROM trade_communication_handoffs WHERE expires_at<=? OR (consumed_at='' AND redeem_before<=?)").bind(nowIso, nowIso).run();
  const result = await db.prepare(`INSERT INTO trade_communication_handoffs(id,owner_uid,member_id,code_hash,encrypted_auth,thread_id,call_id,created_at,redeem_before,expires_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM trade_communication_handoffs WHERE owner_uid=? AND member_id=? AND created_at>?)<10`)
    .bind(crypto.randomUUID(), actor.ownerUid, actor.memberId, await integrationStateHash(token), encrypted, threadId, callId, nowIso, redeemBefore, expiresAt,
      actor.ownerUid, actor.memberId, new Date(now - 60000).toISOString()).run();
  if (!result.meta.changes) throw new Error("HANDOFF_RATE_LIMIT");
  return { url: `${new URL(request.url).origin}/direct-trade/messages#handoff=${token}`, expiresAt: redeemBefore };
}

export async function redeemCommunicationHandoff(request: Request, code: unknown) {
  if (typeof code !== "string" || !opaque.test(code)) throw new Error("HANDOFF_INVALID");
  const db = getD1(), hash = await integrationStateHash(code), now = new Date().toISOString();
  const row = await db.prepare("SELECT * FROM trade_communication_handoffs WHERE code_hash=? AND consumed_at='' AND redeem_before>?").bind(hash, now).first<HandoffRow>();
  if (!row) throw new Error("HANDOFF_EXPIRED");
  const actor = await originalAccess(row, request), token = randomToken();
  const changed = await db.prepare("UPDATE trade_communication_handoffs SET session_hash=?,consumed_at=? WHERE id=? AND consumed_at='' AND redeem_before>?")
    .bind(await integrationStateHash(token), new Date().toISOString(), row.id, new Date().toISOString()).run();
  if (changed.meta.changes !== 1) throw new Error("HANDOFF_EXPIRED");
  return { actor, cookie: communicationCookieHeader(token), threadId: row.thread_id, callId: row.call_id };
}

export async function closeCommunicationSession(request: Request) {
  const token = communicationCookie(request);
  if (token) {
    const actor = await requireTeamCommunicationAccess(request);
    await getD1().prepare("DELETE FROM trade_communication_handoffs WHERE session_hash=? AND member_id=?").bind(await integrationStateHash(token), actor.memberId).run();
  }
}
