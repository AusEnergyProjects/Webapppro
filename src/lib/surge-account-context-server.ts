import {
  parseSurgeStarterProfile,
  type SurgeStarterProfile,
} from "./surge-assessor-profile.ts";

const MAX_ACCOUNT_CONTEXT_BYTES = 32_768;

function cleanUid(value: string) {
  const uid = value.trim();
  if (!uid || uid.length > 180) throw new Error("INVALID_ACCOUNT_CONTEXT_OWNER");
  return uid;
}

export async function loadSurgeAccountContext(
  database: D1Database,
  firebaseUid: string,
): Promise<SurgeStarterProfile | null> {
  const row = await database.prepare(`SELECT profile_json
    FROM surge_account_context
    WHERE firebase_uid = ?`)
    .bind(cleanUid(firebaseUid))
    .first<{ profile_json?: unknown }>();
  if (!row || typeof row.profile_json !== "string") return null;
  try {
    return parseSurgeStarterProfile(JSON.parse(row.profile_json));
  } catch {
    return null;
  }
}

export async function saveSurgeAccountContext(
  database: D1Database,
  firebaseUid: string,
  value: unknown,
  now = new Date(),
) {
  const profile = parseSurgeStarterProfile(value);
  const profileJson = JSON.stringify(profile);
  if (new TextEncoder().encode(profileJson).byteLength > MAX_ACCOUNT_CONTEXT_BYTES) {
    throw new Error("ACCOUNT_CONTEXT_TOO_LARGE");
  }
  const timestamp = now.toISOString();
  await database.prepare(`INSERT INTO surge_account_context
    (firebase_uid, profile_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(firebase_uid) DO UPDATE SET
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at`)
    .bind(cleanUid(firebaseUid), profileJson, timestamp, timestamp)
    .run();
  return profile;
}

export async function deleteSurgeAccountContext(
  database: D1Database,
  firebaseUid: string,
) {
  await database.prepare("DELETE FROM surge_account_context WHERE firebase_uid = ?")
    .bind(cleanUid(firebaseUid))
    .run();
}
