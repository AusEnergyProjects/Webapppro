import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { canManageTeam, requireInstallerTeamAccess } from "@/lib/trade-team-server";
import {
  appVersionAccepted,
  mobileAppPolicy,
  MOBILE_CLIENT_ID_PATTERN,
  MOBILE_PLATFORMS,
  mobileErrorResponse,
} from "@/lib/trade-mobile-server";

export const runtime = "edge";

const PUSH_PROVIDERS = new Set(["fcm", "apns"]);

type EvidenceBucket = {
  resumeMultipartUpload(key: string, uploadId: string): { abort(): Promise<void> };
  head(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
};

async function abortDeviceUploads(ownerUid: string, deviceId: string) {
  const store = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!store) return;
  const rows = await getD1().prepare(`SELECT object_key, upload_id, status FROM trade_mobile_upload_sessions
    WHERE owner_uid = ? AND device_id = ? AND status IN ('initiated', 'uploading', 'completing') LIMIT 50`)
    .bind(ownerUid, deviceId).all<Record<string, unknown>>();
  for (const row of rows.results) {
    try {
      if (row.status === "completing" && await store.head(String(row.object_key))) await store.delete(String(row.object_key));
      else await store.resumeMultipartUpload(String(row.object_key), String(row.upload_id)).abort();
    } catch { /* revocation continues even when an expired upload is already absent */ }
  }
}

function deviceError(error: unknown) {
  const mobile = mobileErrorResponse(error);
  if (mobile) return adminJson({ ok: false, code: mobile.code, error: mobile.error,
    ...(mobile.minimumVersion ? { minimumVersion: mobile.minimumVersion } : {}) }, mobile.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_MEMBERSHIP_REQUIRED") return adminJson({ ok: false, error: "No active installer team membership was found." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Mobile devices require team access on the installer account." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Mobile field access is available to installer teams only." }, 403);
  if (code === "DEVICE_REAUTHORISATION_REQUIRED") return adminJson({ ok: false, code,
    error: "This device was revoked. The business owner must authorise it again before local data can be restored." }, 403);
  if (code === "DEVICE_NOT_FOUND") return adminJson({ ok: false, error: "Device not found." }, 404);
  if (code === "OWNER_REQUIRED") return adminJson({ ok: false, error: "Only the business owner can manage another person's device." }, 403);
  return adminJson({ ok: false, error: "The mobile device request could not be completed." }, 500);
}

async function devicePayload(ownerUid: string, actorUid: string, ownerView: boolean) {
  const rows = await getD1().prepare(`SELECT d.id, d.actor_uid, d.member_id, d.device_id, d.platform, d.device_name,
      d.app_version, d.push_provider, d.push_token <> '' push_connected, d.status, d.registered_at,
      d.last_seen_at, d.revoked_at, d.updated_at, COALESCE(m.display_name, '') member_name,
      COALESCE(m.email, '') member_email
    FROM trade_mobile_devices d LEFT JOIN trade_team_members m ON m.id = d.member_id AND m.owner_uid = d.owner_uid
    WHERE d.owner_uid = ? AND (? = 1 OR d.actor_uid = ?) ORDER BY d.status = 'active' DESC, d.last_seen_at DESC`)
    .bind(ownerUid, ownerView ? 1 : 0, actorUid).all<Record<string, unknown>>();
  const pending = await getD1().prepare(`SELECT COUNT(*) count FROM trade_mobile_push_outbox
    WHERE owner_uid = ? AND status = 'pending'`).bind(ownerUid).first<Record<string, unknown>>();
  return {
    devices: rows.results.map((row) => ({
      id: row.id, deviceId: row.device_id, deviceName: row.device_name, platform: row.platform,
      appVersion: row.app_version, pushProvider: row.push_provider, pushConnected: Boolean(row.push_connected),
      status: row.status, memberId: row.member_id, memberName: row.member_name || (row.member_id ? "Team member" : "Business owner"),
      memberEmail: row.member_email, registeredAt: row.registered_at, lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at, updatedAt: row.updated_at,
    })),
    pendingPushEvents: Number(pending?.count || 0),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const platform = cleanAdminText(new URL(request.url).searchParams.get("platform"), 20);
    const policyPlatform = MOBILE_PLATFORMS.has(platform) ? platform : "ios";
    return adminJson({ ok: true, policy: mobileAppPolicy(policyPlatform),
      ...(await devicePayload(access.ownerUid, access.actorUid, canManageTeam(access))) });
  } catch (error) { return deviceError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "The device registration is invalid." }, 400); }
    const deviceId = cleanAdminText(body.deviceId, 120);
    const platform = cleanAdminText(body.platform, 20);
    const appVersion = cleanAdminText(body.appVersion, 40);
    const deviceName = cleanAdminText(body.deviceName, 100) || "Field device";
    const pushProviderValue = cleanAdminText(body.pushProvider, 20);
    const pushProvider = PUSH_PROVIDERS.has(pushProviderValue) ? pushProviderValue : "fcm";
    const pushToken = cleanAdminText(body.pushToken, 4096);
    if (!MOBILE_CLIENT_ID_PATTERN.test(deviceId) || !MOBILE_PLATFORMS.has(platform)) {
      return adminJson({ ok: false, error: "Add a stable device ID and choose iOS or Android." }, 400);
    }
    if (!appVersionAccepted(platform, appVersion)) {
      const policy = mobileAppPolicy(platform);
      return adminJson({ ok: false, code: "APP_UPDATE_REQUIRED", error: "Update the field app before registering this device.",
        minimumVersion: policy.minimumVersion, policy }, 426);
    }
    const db = getD1(); const now = new Date().toISOString();
    const current = await db.prepare(`SELECT id, actor_uid, member_id, status FROM trade_mobile_devices
      WHERE owner_uid = ? AND device_id = ?`).bind(access.ownerUid, deviceId).first<Record<string, unknown>>();
    if (current?.status === "revoked") throw new Error("DEVICE_REAUTHORISATION_REQUIRED");
    if (current && (current.actor_uid !== access.actorUid || current.member_id !== access.memberId)) {
      throw new Error("DEVICE_REAUTHORISATION_REQUIRED");
    }
    await db.prepare(`INSERT INTO trade_mobile_devices
      (id, owner_uid, actor_uid, member_id, device_id, platform, device_name, app_version, push_provider,
       push_token, push_token_updated_at, status, registered_at, last_seen_at, revoked_at, revoked_by_uid, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, '', '', ?)
      ON CONFLICT(owner_uid, device_id) DO UPDATE SET platform = excluded.platform,
        device_name = excluded.device_name, app_version = excluded.app_version,
        push_provider = excluded.push_provider, push_token = excluded.push_token,
        push_token_updated_at = CASE WHEN excluded.push_token <> trade_mobile_devices.push_token THEN excluded.updated_at ELSE trade_mobile_devices.push_token_updated_at END,
        last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`)
      .bind(current?.id || crypto.randomUUID(), access.ownerUid, access.actorUid, access.memberId, deviceId,
        platform, deviceName, appVersion, pushProvider, pushToken, pushToken ? now : "", now, now, now).run();
    return adminJson({ ok: true, registered: true, policy: mobileAppPolicy(platform),
      ...(await devicePayload(access.ownerUid, access.actorUid, canManageTeam(access))) }, 201);
  } catch (error) { return deviceError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "The device update is invalid." }, 400); }
    const action = cleanAdminText(body.action, 40); const id = cleanAdminText(body.id, 180);
    const current = await getD1().prepare(`SELECT id, actor_uid, status FROM trade_mobile_devices
      WHERE id = ? AND owner_uid = ?`).bind(id, access.ownerUid).first<Record<string, unknown>>();
    if (!current) throw new Error("DEVICE_NOT_FOUND");
    const ownDevice = current.actor_uid === access.actorUid;
    if (!ownDevice && !canManageTeam(access)) throw new Error("OWNER_REQUIRED");
    const now = new Date().toISOString();
    if (action === "revoke_device") {
      const device = await getD1().prepare(`SELECT device_id FROM trade_mobile_devices WHERE id = ? AND owner_uid = ?`)
        .bind(id, access.ownerUid).first<Record<string, unknown>>();
      await abortDeviceUploads(access.ownerUid, String(device?.device_id || ""));
      await getD1().batch([
        getD1().prepare(`UPDATE trade_mobile_devices SET status = 'revoked', push_token = '', push_token_updated_at = ?,
          revoked_at = ?, revoked_by_uid = ?, updated_at = ? WHERE id = ? AND owner_uid = ?`)
          .bind(now, now, access.actorUid, now, id, access.ownerUid),
        getD1().prepare(`UPDATE trade_mobile_upload_sessions SET status = 'aborted', last_error = 'device_revoked', updated_at = ?
          WHERE owner_uid = ? AND device_id = (SELECT device_id FROM trade_mobile_devices WHERE id = ?) AND status IN ('initiated', 'uploading')`)
          .bind(now, access.ownerUid, id),
      ]);
    } else if (action === "authorise_device") {
      if (!canManageTeam(access)) throw new Error("OWNER_REQUIRED");
      await getD1().prepare(`UPDATE trade_mobile_devices SET status = 'active', revoked_at = '', revoked_by_uid = '',
        last_seen_at = ?, updated_at = ? WHERE id = ? AND owner_uid = ?`).bind(now, now, id, access.ownerUid).run();
    } else if (action === "update_push_token") {
      if (!ownDevice || current.status !== "active") throw new Error("DEVICE_REVOKED");
      const pushToken = cleanAdminText(body.pushToken, 4096);
      const pushProviderValue = cleanAdminText(body.pushProvider, 20);
      if (!PUSH_PROVIDERS.has(pushProviderValue)) return adminJson({ ok: false, error: "Choose a supported push provider." }, 400);
      await getD1().prepare(`UPDATE trade_mobile_devices SET push_provider = ?, push_token = ?, push_token_updated_at = ?,
        last_seen_at = ?, updated_at = ? WHERE id = ? AND owner_uid = ? AND actor_uid = ? AND status = 'active'`)
        .bind(pushProviderValue, pushToken, now, now, now, id, access.ownerUid, access.actorUid).run();
    } else return adminJson({ ok: false, error: "Unsupported device update." }, 400);
    return adminJson({ ok: true, ...(await devicePayload(access.ownerUid, access.actorUid, canManageTeam(access))) });
  } catch (error) { return deviceError(error); }
}
