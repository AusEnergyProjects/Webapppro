import { getD1 } from "../../db";
import { tradeAccountProjection } from "./trade-access-server";
import type { TeamAccess } from "./trade-team-server";
import {
  FIELD_ACCESS_LOCK_MS,
  FIELD_ACCESS_MAX_ATTEMPTS,
  FIELD_SESSION_TTL_MS,
  FIELD_SETUP_PIN_TTL_MS,
  fieldAccessAttemptState,
  normalizeFieldAccessName,
  validFieldSetupPin,
} from "./trade-field-access-policy.mjs";

const encoder = new TextEncoder();
const FIELD_AUTH_SCHEME = "TLinkField";
const FIELD_PIN_PEPPER_MINIMUM_LENGTH = 32;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MemberAccessRow = Record<string, unknown> & {
  owner_uid: string;
  team_member_id: string;
  display_name: string;
  email: string;
  business_name: string;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function randomBytes(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomPin() {
  const digits: number[] = [];
  while (digits.length < 6) {
    const bytes = randomBytes(12);
    for (const value of bytes) {
      if (value < 250) digits.push(value % 10);
      if (digits.length === 6) break;
    }
  }
  return digits.join("");
}

function fieldPinPepper(runtime: Record<string, string | undefined> = process.env) {
  const value = String(runtime.TLINK_FIELD_PIN_PEPPER || "").trim();
  if (value.length < FIELD_PIN_PEPPER_MINIMUM_LENGTH) throw new Error("FIELD_ACCESS_NOT_CONFIGURED");
  return value;
}

async function derivePinHash(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(fieldPinPepper()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${bytesToBase64Url(salt)}:${pin}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

function timingSafeHexEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^TLinkField\s+([A-Za-z0-9_-]{40,200})$/i.exec(authorization.trim());
  return match?.[1] || "";
}

export function isFieldSessionRequest(request: Request) {
  return request.headers.get("authorization")?.trim().toLowerCase().startsWith(`${FIELD_AUTH_SCHEME.toLowerCase()} `) === true;
}

function accessFromRow(row: MemberAccessRow, sessionId: string): TeamAccess {
  const memberId = String(row.team_member_id || row.id || "");
  return {
    ownerUid: String(row.owner_uid),
    actorUid: `field-member:${memberId}`,
    actorEmail: String(row.email || ""),
    memberId,
    displayName: String(row.display_name || "Field worker"),
    isOwner: false,
    businessName: String(row.business_name || "Installer business"),
    canCreateJobs: Boolean(row.can_create_jobs),
    canManageJobs: Boolean(row.can_manage_jobs),
    canAssignJobs: Boolean(row.can_assign_jobs),
    jobScope: row.job_scope === "team" ? "team" : "own",
    canViewCustomers: Boolean(row.can_view_customers),
    canManageCustomers: Boolean(row.can_manage_customers),
    canViewQuotes: Boolean(row.can_view_quotes),
    canManageQuotes: Boolean(row.can_manage_quotes),
    canSendQuotes: Boolean(row.can_send_quotes),
    canViewInvoices: Boolean(row.can_view_invoices),
    canManageInvoices: Boolean(row.can_manage_invoices),
    canViewPriceBook: Boolean(row.can_view_price_book),
    canManagePriceBook: Boolean(row.can_manage_price_book),
    canApplyDiscounts: Boolean(row.can_apply_discounts),
    scheduleScope: row.schedule_scope === "team" ? "team" : "own",
    canRescheduleJobs: Boolean(row.can_reschedule_jobs),
    canManageTeam: Boolean(row.can_manage_team),
    canEditTeamPermissions: Boolean(row.can_edit_team_permissions),
    canViewFieldEvidence: Boolean(row.can_view_field_evidence),
    canManageFieldEvidence: Boolean(row.can_manage_field_evidence),
    canRunReports: Boolean(row.can_run_reports),
    canSearchCustomers: Boolean(row.can_search_customers),
    fieldSessionId: sessionId,
  } as TeamAccess & { fieldSessionId: string };
}

const MEMBER_ACCESS_COLUMNS = `m.id team_member_id, m.owner_uid, m.email, m.display_name,
  m.can_create_jobs, m.can_manage_jobs, m.can_assign_jobs, m.job_scope,
  m.can_view_customers, m.can_manage_customers, m.can_view_quotes, m.can_manage_quotes,
  m.can_send_quotes, m.can_view_invoices, m.can_manage_invoices, m.can_view_price_book,
  m.can_manage_price_book, m.can_apply_discounts, m.schedule_scope, m.can_reschedule_jobs,
  m.can_manage_team, m.can_edit_team_permissions, m.can_view_field_evidence,
  m.can_manage_field_evidence, m.can_run_reports, m.can_search_customers, a.business_name`;

async function approvedInstallerAccount(ownerUid: string) {
  const account = await tradeAccountProjection(ownerUid);
  if (!account || account.partnerType !== "installer") throw new Error("INSTALLER_ONLY");
  if (account.accountStatus !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (!account.approvedAbnAccess) throw new Error("ABN_REVIEW_REQUIRED");
  return account;
}

export async function issueFieldSetupPin(input: {
  ownerUid: string;
  actorUid: string;
  teamMemberId: string;
}) {
  const db = getD1();
  const member = await db.prepare(`SELECT id, email, display_name, field_username, field_username_normalized, status FROM trade_team_members
    WHERE id = ? AND owner_uid = ?`).bind(input.teamMemberId, input.ownerUid)
    .first<Record<string, unknown>>();
  if (!member) throw new Error("MEMBER_NOT_FOUND");
  if (member.status !== "active") throw new Error("MEMBER_INACTIVE");
  const username = String(member.field_username || "").trim();
  const normalizedName = normalizeFieldAccessName(String(member.field_username_normalized || username));
  if (!username || !normalizedName) throw new Error("FIELD_USERNAME_REQUIRED");
  const recipientEmail = String(member.email || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(recipientEmail)) throw new Error("FIELD_EMAIL_REQUIRED");
  const pin = randomPin();
  const salt = randomBytes(18);
  const pinHash = await derivePinHash(pin, salt);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + FIELD_SETUP_PIN_TTL_MS).toISOString();
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`UPDATE trade_field_access_codes SET status = 'revoked', updated_at = ?
      WHERE owner_uid = ? AND team_member_id = ? AND status = 'active'`)
      .bind(nowIso, input.ownerUid, input.teamMemberId),
    db.prepare(`INSERT INTO trade_field_access_codes
      (id, owner_uid, team_member_id, normalized_name, pin_salt, pin_hash, status, expires_at,
       consumed_at, created_by_uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '', ?, ?, ?)`)
      .bind(id, input.ownerUid, input.teamMemberId, normalizedName, bytesToBase64Url(salt), pinHash,
        expiresAt, input.actorUid, nowIso, nowIso),
  ]);
  return {
    id,
    displayName: String(member.display_name || username),
    username,
    pin,
    expiresAt,
    recipientEmail,
  };
}

export async function revokeIssuedFieldSetupPin(ownerUid: string, teamMemberId: string, codeId: string) {
  const now = new Date().toISOString();
  await getD1().prepare(`UPDATE trade_field_access_codes SET status = 'revoked', updated_at = ?
    WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status = 'active'`)
    .bind(now, codeId, ownerUid, teamMemberId).run();
}

async function recordFailedAttempt(keyHash: string, current: Record<string, unknown> | null, nowMs: number) {
  const state = fieldAccessAttemptState(current, nowMs);
  const attempts = Math.min(100, state.attempts + 1);
  const now = new Date(nowMs).toISOString();
  const lockedUntil = attempts >= FIELD_ACCESS_MAX_ATTEMPTS
    ? new Date(nowMs + FIELD_ACCESS_LOCK_MS).toISOString()
    : "";
  const windowStartedAt = state.attempts ? String(current?.window_started_at || now) : now;
  await getD1().prepare(`INSERT INTO trade_field_access_attempts
    (key_hash, attempts, window_started_at, locked_until, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key_hash) DO UPDATE SET attempts = excluded.attempts,
      window_started_at = excluded.window_started_at, locked_until = excluded.locked_until,
      updated_at = excluded.updated_at`)
    .bind(keyHash, attempts, windowStartedAt, lockedUntil, now).run();
}

export async function redeemFieldSetupPin(input: {
  request: Request;
  displayName: string;
  pin: string;
  deviceId: string;
  platform: "ios" | "android";
  appVersion: string;
  deviceName: string;
}) {
  const normalizedName = normalizeFieldAccessName(input.displayName);
  const pin = String(input.pin || "").trim();
  if (!normalizedName || !validFieldSetupPin(pin)) throw new Error("FIELD_CREDENTIALS_INVALID");
  const clientAddress = input.request.headers.get("cf-connecting-ip")
    || input.request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    || "unknown";
  // Do not include the client-controlled device ID in the throttle key. A caller
  // must not be able to reset the PIN-attempt window by rotating that value.
  const attemptKey = await sha256(`${normalizedName}\n${clientAddress}`);
  const db = getD1();
  const attempt = await db.prepare(`SELECT attempts, window_started_at, locked_until, updated_at
    FROM trade_field_access_attempts WHERE key_hash = ?`).bind(attemptKey).first<Record<string, unknown>>();
  const attemptState = fieldAccessAttemptState(attempt);
  if (attemptState.locked) throw new Error("FIELD_ACCESS_RATE_LIMITED");
  const now = new Date();
  const nowIso = now.toISOString();
  const candidates = await db.prepare(`SELECT c.id code_id, c.owner_uid, c.team_member_id,
      c.pin_salt, c.pin_hash, c.expires_at, ${MEMBER_ACCESS_COLUMNS}
    FROM trade_field_access_codes c
    JOIN trade_team_members m ON m.id = c.team_member_id AND m.owner_uid = c.owner_uid
    JOIN trade_accounts a ON a.firebase_uid = c.owner_uid
    WHERE c.normalized_name = ? AND c.status = 'active' AND c.expires_at > ?
      AND m.status = 'active' AND a.account_status = 'active' AND a.partner_type = 'installer'
    ORDER BY c.created_at DESC LIMIT 16`).bind(normalizedName, nowIso).all<MemberAccessRow>();
  const matches: MemberAccessRow[] = [];
  for (const candidate of candidates.results) {
    const candidateHash = await derivePinHash(pin, base64UrlToBytes(String(candidate.pin_salt || "")));
    if (timingSafeHexEqual(candidateHash, String(candidate.pin_hash || ""))) {
      matches.push(candidate);
    }
  }
  if (!candidates.results.length) {
    await derivePinHash(pin, base64UrlToBytes("AAAAAAAAAAAAAAAAAAAAAAAA"));
  }
  if (matches.length !== 1) {
    await recordFailedAttempt(attemptKey, attempt || null, now.getTime());
    throw new Error("FIELD_CREDENTIALS_INVALID");
  }
  const matched = matches[0];
  await approvedInstallerAccount(String(matched.owner_uid));
  const existingDevice = await db.prepare(`SELECT actor_uid, member_id, status FROM trade_mobile_devices
    WHERE owner_uid = ? AND device_id = ?`).bind(matched.owner_uid, input.deviceId).first<Record<string, unknown>>();
  const actorUid = `field-member:${matched.team_member_id}`;
  if (existingDevice?.status === "revoked"
    || (existingDevice && (existingDevice.actor_uid !== actorUid || existingDevice.member_id !== matched.team_member_id))) {
    throw new Error("DEVICE_REAUTHORISATION_REQUIRED");
  }
  const sessionToken = bytesToBase64Url(randomBytes(32));
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + FIELD_SESSION_TTL_MS).toISOString();
  const deviceRowId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`UPDATE trade_field_access_codes SET status = 'consumed', consumed_at = ?, updated_at = ?
      WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status = 'active' AND expires_at > ?`)
      .bind(nowIso, nowIso, matched.code_id, matched.owner_uid, matched.team_member_id, nowIso),
    db.prepare(`INSERT INTO trade_field_sessions
      (id, owner_uid, team_member_id, token_hash, device_id, platform, app_version, device_name,
       status, expires_at, last_seen_at, revoked_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, '', ?, ? WHERE changes() = 1`)
      .bind(sessionId, matched.owner_uid, matched.team_member_id, await sha256(sessionToken), input.deviceId,
        input.platform, input.appVersion, input.deviceName, expiresAt, nowIso, nowIso, nowIso),
    db.prepare(`INSERT INTO trade_mobile_devices
      (id, owner_uid, actor_uid, member_id, device_id, platform, device_name, app_version,
       push_provider, push_token, push_token_updated_at, status, registered_at, last_seen_at,
       revoked_at, revoked_by_uid, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'fcm', '', '', 'active', ?, ?, '', '', ? WHERE changes() = 1
      ON CONFLICT(owner_uid, device_id) DO UPDATE SET actor_uid = excluded.actor_uid,
        member_id = excluded.member_id, platform = excluded.platform, device_name = excluded.device_name,
        app_version = excluded.app_version, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`)
      .bind(deviceRowId, matched.owner_uid, actorUid, matched.team_member_id, input.deviceId, input.platform,
        input.deviceName, input.appVersion, nowIso, nowIso, nowIso),
    db.prepare(`DELETE FROM trade_field_access_attempts WHERE key_hash = ?`).bind(attemptKey),
  ]);
  if (!results[0]?.meta.changes || !results[1]?.meta.changes) throw new Error("FIELD_CREDENTIALS_INVALID");
  const access = accessFromRow(matched, sessionId);
  return {
    token: sessionToken,
    expiresAt,
    principal: {
      ownerId: access.ownerUid,
      memberId: access.memberId,
      displayName: access.displayName,
      email: access.actorEmail,
      businessName: access.businessName,
      permissions: {
        canCreateJobs: access.canCreateJobs,
        canManageCustomers: access.canManageCustomers,
        canViewCustomers: access.canViewCustomers,
      },
    },
  };
}

export async function requireFieldSessionAccess(request: Request): Promise<TeamAccess> {
  const token = tokenFromRequest(request);
  if (!token) throw new Error("AUTH_REQUIRED");
  const deviceId = request.headers.get("x-aea-device-id")?.trim() || "";
  if (!deviceId) throw new Error("AUTH_REQUIRED");
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await getD1().prepare(`SELECT s.id session_id, s.owner_uid, s.team_member_id,
      s.device_id, s.expires_at, ${MEMBER_ACCESS_COLUMNS}
    FROM trade_field_sessions s
    JOIN trade_team_members m ON m.id = s.team_member_id AND m.owner_uid = s.owner_uid
    JOIN trade_accounts a ON a.firebase_uid = s.owner_uid
    WHERE s.token_hash = ? AND s.device_id = ? AND s.status = 'active' AND s.expires_at > ?
      AND m.status = 'active' AND a.account_status = 'active' AND a.partner_type = 'installer'
    LIMIT 1`).bind(tokenHash, deviceId, now).first<MemberAccessRow>();
  if (!row) throw new Error("AUTH_REQUIRED");
  await approvedInstallerAccount(String(row.owner_uid));
  await getD1().batch([
    getD1().prepare(`UPDATE trade_field_sessions SET last_seen_at = ?, updated_at = ?
      WHERE id = ? AND token_hash = ? AND status = 'active'`).bind(now, now, row.session_id, tokenHash),
    getD1().prepare(`UPDATE trade_team_members SET last_active_at = ?
      WHERE id = ? AND owner_uid = ? AND status = 'active'`).bind(now, row.team_member_id, row.owner_uid),
  ]);
  return accessFromRow(row, String(row.session_id));
}

export async function revokeCurrentFieldSession(request: Request) {
  const token = tokenFromRequest(request);
  if (!token) return;
  const now = new Date().toISOString();
  await getD1().prepare(`UPDATE trade_field_sessions SET status = 'revoked', revoked_at = ?, updated_at = ?
    WHERE token_hash = ? AND status = 'active'`).bind(now, now, await sha256(token)).run();
}

export async function revokeMemberFieldAccess(ownerUid: string, teamMemberId: string, actorUid: string) {
  const now = new Date().toISOString();
  const db = getD1();
  const member = await db.prepare(`SELECT id FROM trade_team_members WHERE id = ? AND owner_uid = ?`)
    .bind(teamMemberId, ownerUid).first();
  if (!member) throw new Error("MEMBER_NOT_FOUND");
  await db.batch([
    db.prepare(`UPDATE trade_field_access_codes SET status = 'revoked', updated_at = ?
      WHERE owner_uid = ? AND team_member_id = ? AND status = 'active'`).bind(now, ownerUid, teamMemberId),
    db.prepare(`UPDATE trade_field_sessions SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE owner_uid = ? AND team_member_id = ? AND status = 'active'`).bind(now, now, ownerUid, teamMemberId),
    db.prepare(`UPDATE trade_mobile_devices SET status = 'revoked', push_token = '', push_token_updated_at = ?,
      revoked_at = ?, revoked_by_uid = ?, updated_at = ?
      WHERE owner_uid = ? AND member_id = ? AND status = 'active'`)
      .bind(now, now, actorUid, now, ownerUid, teamMemberId),
  ]);
}
