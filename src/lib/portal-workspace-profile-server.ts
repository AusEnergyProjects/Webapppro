import type { PortalWorkspace, PortalWorkspaceProfile } from "./portal-workspace-profile";
import { DEFAULT_PORTAL_PROFILE, portalProfileInput } from "./portal-workspace-profile";
import { requireAdminIdentity } from "./admin-server";
import { requireComplianceAccess } from "./compliance-access-server";

type ProfileActor = { workspace: PortalWorkspace; tenantId: string; memberId: string; uid: string; displayName: string };
export async function requirePortalProfileActor(request: Request, database: D1Database): Promise<ProfileActor> {
  const workspace = new URL(request.url).searchParams.get("workspace");
  if (workspace === "admin") {
    const actor = await requireAdminIdentity(request);
    return { workspace, tenantId: "operations", memberId: actor.adminId, uid: actor.uid, displayName: actor.displayName || actor.email };
  }
  if (workspace === "creditex") {
    const actor = await requireComplianceAccess(request, {}, database);
    return { workspace, tenantId: actor.organisationId, memberId: actor.membershipId, uid: actor.uid, displayName: actor.displayName || actor.email };
  }
  throw new Error("PORTAL_WORKSPACE_INVALID");
}

function activeGuard(actor: ProfileActor) {
  return actor.workspace === "admin" ? {
    sql: "EXISTS (SELECT 1 FROM admin_users WHERE id = ? AND firebase_uid = ? AND status = 'active')",
    values: [actor.memberId, actor.uid],
  } : {
    sql: `EXISTS (SELECT 1 FROM compliance_users member JOIN compliance_organisations organisation ON organisation.id = member.organisation_id
      WHERE member.id = ? AND member.firebase_uid = ? AND member.organisation_id = ? AND member.status = 'active' AND organisation.status = 'active')`,
    values: [actor.memberId, actor.uid, actor.tenantId],
  };
}

export async function loadPortalProfile(database: D1Database, actor: ProfileActor): Promise<PortalWorkspaceProfile> {
  const guard = activeGuard(actor);
  const row = await database.prepare(`SELECT profile.display_name, profile.theme_key, profile.colour_mode
    FROM (SELECT 1) current_actor LEFT JOIN portal_workspace_profiles profile ON profile.workspace = ? AND profile.tenant_id = ? AND profile.member_id = ?
    WHERE ${guard.sql}`).bind(actor.workspace, actor.tenantId, actor.memberId, ...guard.values)
    .first<{ display_name: string | null; theme_key: string | null; colour_mode: string | null }>();
  if (!row) throw new Error("PORTAL_ACCESS_CHANGED");
  return portalProfileInput({ displayName: row.display_name || actor.displayName, themeKey: row.theme_key || DEFAULT_PORTAL_PROFILE.themeKey,
    colourMode: row.colour_mode || DEFAULT_PORTAL_PROFILE.colourMode }) || { ...DEFAULT_PORTAL_PROFILE, displayName: actor.displayName };
}

export async function savePortalProfile(database: D1Database, actor: ProfileActor, profile: PortalWorkspaceProfile) {
  const guard = activeGuard(actor);
  // The personal display label never changes the authoritative membership or named-owner identity.
  const result = await database.prepare(`INSERT INTO portal_workspace_profiles (workspace, tenant_id, member_id, display_name, theme_key, colour_mode, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}
    ON CONFLICT (workspace, tenant_id, member_id) DO UPDATE SET display_name = excluded.display_name,
      theme_key = excluded.theme_key, colour_mode = excluded.colour_mode, updated_at = excluded.updated_at`)
    .bind(actor.workspace, actor.tenantId, actor.memberId, profile.displayName, profile.themeKey, profile.colourMode, new Date().toISOString(), ...guard.values).run();
  if (result.meta.changes !== 1) throw new Error("PORTAL_ACCESS_CHANGED");
  return profile;
}
