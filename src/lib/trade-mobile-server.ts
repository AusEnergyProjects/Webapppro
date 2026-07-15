import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";

export const MOBILE_CONTRACT_VERSION = 3;
export const MOBILE_CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
export const MOBILE_PLATFORMS = new Set(["ios", "android"]);

type MobileDevice = {
  id: string;
  owner_uid: string;
  actor_uid: string;
  member_id: string;
  device_id: string;
  platform: string;
  device_name: string;
  app_version: string;
  status: string;
};

function configured(name: string, fallback: string) {
  const value = String((env as unknown as Record<string, unknown>)[name] || "").trim();
  return value || fallback;
}

function versionParts(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
}

export function compareAppVersions(left: string, right: string) {
  const leftParts = versionParts(left); const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return Number.NaN;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

export function mobileAppPolicy(platform: string) {
  const normalised = MOBILE_PLATFORMS.has(platform) ? platform : "ios";
  const minimumVersion = normalised === "android"
    ? configured("AEA_MOBILE_MIN_ANDROID_VERSION", "1.0.0")
    : configured("AEA_MOBILE_MIN_IOS_VERSION", "1.0.0");
  return {
    contractVersion: MOBILE_CONTRACT_VERSION,
    platform: normalised,
    minimumVersion,
    encryptedStorageRequired: true,
    purgeOnSignOut: true,
    protectedCustomerContactDataAllowed: false,
    directAddressMaxAgeSeconds: 86_400,
    nonPersonalJobMaxAgeSeconds: 604_800,
  };
}

export function appVersionAccepted(platform: string, appVersion: string) {
  if (!MOBILE_PLATFORMS.has(platform)) return false;
  const comparison = compareAppVersions(appVersion, mobileAppPolicy(platform).minimumVersion);
  return Number.isFinite(comparison) && comparison >= 0;
}

export async function requireRegisteredMobileDevice(
  request: Request,
  access: TeamAccess,
  deviceId: string,
  suppliedPlatform = "",
  suppliedVersion = "",
) {
  if (!MOBILE_CLIENT_ID_PATTERN.test(deviceId)) throw new Error("DEVICE_ID_REQUIRED");
  const device = await getD1().prepare(`SELECT id, owner_uid, actor_uid, member_id, device_id, platform,
      device_name, app_version, status FROM trade_mobile_devices WHERE owner_uid = ? AND device_id = ?`)
    .bind(access.ownerUid, deviceId).first<MobileDevice>();
  if (!device || device.actor_uid !== access.actorUid || device.member_id !== access.memberId) throw new Error("DEVICE_NOT_REGISTERED");
  if (device.status !== "active") throw new Error("DEVICE_REVOKED");
  const platform = suppliedPlatform || request.headers.get("x-aea-platform") || device.platform;
  const appVersion = suppliedVersion || request.headers.get("x-aea-app-version") || "";
  if (!appVersion) throw new Error("APP_VERSION_REQUIRED");
  if (platform !== device.platform) throw new Error("DEVICE_PLATFORM_MISMATCH");
  if (!appVersionAccepted(platform, appVersion)) throw new Error(`APP_UPDATE_REQUIRED:${mobileAppPolicy(platform).minimumVersion}`);
  const now = new Date().toISOString();
  await getD1().prepare(`UPDATE trade_mobile_devices SET app_version = ?, last_seen_at = ?, updated_at = ?
    WHERE id = ? AND owner_uid = ? AND status = 'active'`).bind(appVersion, now, now, device.id, access.ownerUid).run();
  return { id: device.id, deviceId: device.device_id, platform, appVersion, deviceName: device.device_name };
}

export function mobileErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code.startsWith("APP_UPDATE_REQUIRED:")) return { status: 426, code: "APP_UPDATE_REQUIRED",
    error: "Update the field app before syncing.", minimumVersion: code.split(":")[1] };
  if (code === "DEVICE_ID_REQUIRED") return { status: 400, code, error: "Register a stable device ID before continuing." };
  if (code === "DEVICE_NOT_REGISTERED") return { status: 403, code, error: "Register this device before using field sync." };
  if (code === "DEVICE_REVOKED") return { status: 403, code, error: "This device has been signed out remotely. Remove its local work data." };
  if (code === "DEVICE_PLATFORM_MISMATCH") return { status: 409, code, error: "The registered device platform does not match this request." };
  if (code === "APP_VERSION_REQUIRED") return { status: 400, code, error: "Include the installed field app version with every mobile request." };
  return null;
}
