import type { CustomerProjectEvidenceBucket } from "./customer-project-evidence-bucket";
import { inspectMessageMedia } from "./trade-message-media";
import { loadPortalProfile, portalProfileActiveGuard, type ProfileActor } from "./portal-workspace-profile-server";
import { creditexPermissionSql } from "./creditex-permissions";

type AvatarBucket = Pick<CustomerProjectEvidenceBucket, "put" | "get" | "delete">;
type AvatarRecord = { avatar_revision: string; avatar_object_key: string; avatar_content_type: string };
export class PortalAvatarError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function readPortalAvatar(database: D1Database, actor: ProfileActor, memberId = actor.memberId, revision = "") {
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(memberId) || (revision && !/^[a-f0-9-]{36}$/.test(revision))) throw new PortalAvatarError(400, "Choose a valid profile photo.");
  const guard = portalProfileActiveGuard(actor);
  const visibility = actor.workspace === "creditex" && memberId !== actor.memberId
    ? `AND EXISTS (SELECT 1 FROM compliance_users viewer WHERE viewer.id=? AND viewer.firebase_uid=? AND viewer.organisation_id=? AND ${creditexPermissionSql("messages", "viewer")})` : "";
  const target = actor.workspace === "admin"
    ? "EXISTS (SELECT 1 FROM admin_users person WHERE person.id = profile.member_id AND person.status = 'active' AND person.role IN ('owner','admin','reviewer','support') AND person.firebase_uid <> '' AND person.firebase_uid NOT LIKE 'pending:%')"
    : "EXISTS (SELECT 1 FROM compliance_users person WHERE person.id = profile.member_id AND person.organisation_id = profile.tenant_id AND person.status = 'active' AND person.role IN ('admin','case_manager','reviewer','auditor') AND person.firebase_uid <> '' AND person.firebase_uid NOT LIKE 'pending:%')";
  return database.prepare(`SELECT profile.avatar_revision, profile.avatar_object_key, profile.avatar_content_type
    FROM portal_workspace_profiles profile WHERE profile.workspace = ? AND profile.tenant_id = ? AND profile.member_id = ?
      AND (? = '' OR profile.avatar_revision = ?) AND ${target} AND ${guard.sql} ${visibility}`)
    .bind(actor.workspace, actor.tenantId, memberId, revision, revision, ...guard.values,
      ...(visibility ? [actor.memberId, actor.uid, actor.tenantId] : [])).first<AvatarRecord>();
}

export async function savePortalAvatar(database: D1Database, bucket: AvatarBucket, actor: ProfileActor, input: { bytes: Uint8Array; contentType: string }) {
  const profile = await loadPortalProfile(database, actor);
  const previous = await readPortalAvatar(database, actor);
  let photo: ReturnType<typeof inspectMessageMedia>;
  try { photo = inspectMessageMedia(input.bytes, input.contentType, true); }
  catch { throw new PortalAvatarError(400, "Choose a valid JPEG or PNG profile photo up to 512 pixels and 3 MB."); }
  const revision = crypto.randomUUID();
  const key = `portal-profiles/${actor.workspace}/${revision}`;
  const guard = portalProfileActiveGuard(actor);
  await bucket.put(key, new Uint8Array(photo.bytes).buffer, { httpMetadata: { contentType: photo.contentType } });
  try {
    const saved = await database.prepare(`INSERT INTO portal_workspace_profiles
      (workspace, tenant_id, member_id, display_name, theme_key, colour_mode, updated_at, avatar_revision, avatar_object_key, avatar_content_type)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}
      ON CONFLICT(workspace, tenant_id, member_id) DO UPDATE SET avatar_revision = excluded.avatar_revision,
        avatar_object_key = excluded.avatar_object_key, avatar_content_type = excluded.avatar_content_type, updated_at = excluded.updated_at
      WHERE portal_workspace_profiles.avatar_revision = ?`)
      .bind(actor.workspace, actor.tenantId, actor.memberId, profile.displayName, profile.themeKey, profile.colourMode,
        new Date().toISOString(), revision, key, photo.contentType, ...guard.values, previous?.avatar_revision || "").run();
    if (saved.meta.changes !== 1) throw new PortalAvatarError(409, "Your profile photo or access changed. Refresh and try again.");
  } catch (error) { await bucket.delete(key); throw error; }
  if (previous?.avatar_object_key) await bucket.delete(previous.avatar_object_key);
  return { memberId: actor.memberId, revision };
}

export async function removePortalAvatar(database: D1Database, bucket: AvatarBucket, actor: ProfileActor, revision: string) {
  await loadPortalProfile(database, actor);
  if (!revision) throw new PortalAvatarError(400, "Choose the current profile photo.");
  const previous = await readPortalAvatar(database, actor, actor.memberId, revision);
  if (!previous?.avatar_revision) throw new PortalAvatarError(409, "Your photo changed. Refresh before removing it.");
  const guard = portalProfileActiveGuard(actor);
  const result = await database.prepare(`UPDATE portal_workspace_profiles SET avatar_revision = '', avatar_object_key = '', avatar_content_type = '', updated_at = ?
    WHERE workspace = ? AND tenant_id = ? AND member_id = ? AND avatar_revision = ? AND ${guard.sql}`)
    .bind(new Date().toISOString(), actor.workspace, actor.tenantId, actor.memberId, revision, ...guard.values).run();
  if (result.meta.changes !== 1) throw new PortalAvatarError(409, "Your photo or access changed. Refresh before removing it.");
  await bucket.delete(previous.avatar_object_key);
  return { memberId: actor.memberId, revision: "" };
}

export async function readPortalAvatarUpload(request: Request): Promise<Uint8Array> {
  const maximum = 3 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > maximum) throw new PortalAvatarError(413, "Profile photos must be under 3 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new PortalAvatarError(400, "Choose a profile photo.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const item = await reader.read(); if (item.done) break;
    length += item.value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new PortalAvatarError(413, "Profile photos must be under 3 MB."); }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
