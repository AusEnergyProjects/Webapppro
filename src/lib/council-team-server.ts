import type { CouncilRole } from "./council-access-server";
import type { CouncilTeam, CouncilTeamAction, CouncilTeamMember } from "./council-team";

type TeamRow = {
  id: string; email: string; display_name: string; role: CouncilRole;
  status: "active" | "suspended"; pending: number; is_self: number;
  created_at: string; accepted_at: string | null; updated_at: string; actor_role: CouncilRole;
};
const readSql = `SELECT m.id,m.email,m.display_name,m.role,m.status,
  m.firebase_uid IS NULL AS pending,m.firebase_uid=actor.firebase_uid AS is_self,
  m.created_at,m.accepted_at,m.updated_at,actor.role AS actor_role
  FROM council_memberships m JOIN council_organisations c ON c.id=m.council_id AND c.status='active'
  JOIN council_memberships actor ON actor.council_id=c.id AND actor.firebase_uid=? AND actor.status='active'
  WHERE c.id=? ORDER BY m.status,CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,m.email`;
const ownerGuard = `EXISTS (SELECT 1 FROM council_memberships actor JOIN council_organisations c ON c.id=actor.council_id
  WHERE c.id=? AND c.status='active' AND actor.firebase_uid=? AND actor.status='active' AND actor.role='owner')`;

function toTeam(councilId: string, rows: TeamRow[]): CouncilTeam | null {
  if (!rows.length) return null;
  const members: CouncilTeamMember[] = rows.map(row => ({ id: row.id, email: row.email, displayName: row.display_name,
    role: row.role, status: row.status, pending: Boolean(row.pending), isSelf: Boolean(row.is_self),
    createdAt: row.created_at, acceptedAt: row.accepted_at, updatedAt: row.updated_at }));
  return { councilId, members, canManage: rows[0].actor_role === "owner", invitationPath: "/council" };
}

export async function readCouncilTeam(db: D1Database, councilId: string, actorUid: string): Promise<CouncilTeam | null> {
  return toTeam(councilId, (await db.prepare(readSql).bind(actorUid, councilId).all<TeamRow>()).results);
}

export type CouncilTeamWriteResult = { ok: true; team: CouncilTeam } | { ok: false; status: 403 | 409; error: string };

export async function changeCouncilTeam(db: D1Database, councilId: string, actorUid: string, input: CouncilTeamAction): Promise<CouncilTeamWriteResult> {
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const memberId = input.action === "invite" ? crypto.randomUUID() : input.membershipId;
  const auditPrefix = `INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at)`;
  let audit: D1PreparedStatement;
  let mutation: D1PreparedStatement;
  if (input.action === "invite") {
    audit = db.prepare(`${auditPrefix}
      SELECT ?,?,'council.member_invited','council',?,'Invited a council team member.',?,?
      WHERE ${ownerGuard} AND NOT EXISTS (SELECT 1 FROM council_memberships WHERE council_id=? AND email=?)`)
      .bind(auditId, actorUid, councilId, JSON.stringify({ memberId, email: input.email, role: input.role }), now, councilId, actorUid, councilId, input.email);
    mutation = db.prepare(`INSERT INTO council_memberships(id,council_id,email,display_name,role,status,invited_by_uid,created_at,updated_at)
      SELECT ?,?,?,?,?,'active',?,?,? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE id=? AND admin_uid=?)`)
      .bind(memberId, councilId, input.email, input.displayName, input.role, actorUid, now, now, auditId, actorUid);
  } else {
    const nextStatus = input.action === "revoke" ? "suspended" : "active";
    const role = input.action === "role" ? input.role : null;
    audit = db.prepare(`${auditPrefix}
      SELECT ?,?,'council.member_updated','council',?,'Updated council team access.',
        json_object('memberId',m.id,'operation',?,'before',json_object('role',m.role,'status',m.status),
          'after',json_object('role',COALESCE(?,m.role),'status',?)),?
      FROM council_memberships m WHERE m.id=? AND m.council_id=?
        AND (m.firebase_uid IS NULL OR m.firebase_uid<>?) AND m.status=?
        AND (? IS NULL OR m.role<>?) AND ${ownerGuard}
        AND (m.role<>'owner' OR m.status<>'active' OR EXISTS (
          SELECT 1 FROM council_memberships remaining WHERE remaining.council_id=m.council_id AND remaining.id<>m.id
            AND remaining.role='owner' AND remaining.status='active' AND remaining.firebase_uid IS NOT NULL))`)
      .bind(auditId, actorUid, councilId, input.action, role, nextStatus, now, memberId, councilId, actorUid,
        input.action === "restore" ? "suspended" : "active", role, role, councilId, actorUid);
    mutation = db.prepare(`UPDATE council_memberships SET role=COALESCE(?,role),status=?,updated_at=?
      WHERE id=? AND council_id=? AND EXISTS (SELECT 1 FROM admin_audit_log WHERE id=? AND admin_uid=?)`)
      .bind(role, nextStatus, now, memberId, councilId, auditId, actorUid);
  }
  // D1 executes the batch as one transaction. The guarded audit is also the write
  // authorisation, so a revoked/downgraded actor cannot produce either side alone.
  const result = await db.batch<TeamRow>([audit, mutation, db.prepare(readSql).bind(actorUid, councilId)]);
  const team = toTeam(councilId, result[2].results);
  if (!team?.canManage) return { ok: false, status: 403, error: "Your owner access has changed. Reload the council workspace." };
  if (!result[1].meta.changes) return { ok: false, status: 409, error: input.action === "invite"
    ? "This email is already on the team. Restore its access if needed."
    : "This change was not permitted. Keep an accepted owner and ask another owner to change your own access. Refresh the team list to see current access." };
  return { ok: true, team };
}
