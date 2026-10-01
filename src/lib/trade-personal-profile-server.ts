import { getD1 } from '../../db';
import type { TeamAccess } from './trade-team-server';
import { messageActorGuard } from './trade-message-media-access';

type PersonalActor = Pick<TeamAccess, 'ownerUid' | 'actorUid' | 'memberId' | 'isOwner' | 'fieldSessionId'>;

export function personalName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('PERSONAL_NAME_INVALID');
  }
  return value.replace(/\s+/g, ' ').trim();
}

export async function readTradePersonalProfile(actor: PersonalActor, db: D1Database = getD1()) {
  const guard = messageActorGuard(actor);
  const row = await db.prepare(`SELECT CASE WHEN ? THEN a.manager_name ELSE m.display_name END name
    FROM trade_team_members m JOIN trade_accounts a ON a.firebase_uid=m.owner_uid
    WHERE m.id=? AND m.owner_uid=? AND (m.member_uid=m.owner_uid)=? AND ${guard.sql}`)
    .bind(actor.isOwner ? 1 : 0, actor.memberId, actor.ownerUid, actor.isOwner ? 1 : 0, ...guard.values)
    .first<{ name: string }>();
  if (!row) throw new Error('PERSONAL_PROFILE_ACCESS_REQUIRED');
  return { name: row.name, isOwner: actor.isOwner };
}

export async function updateTradePersonalProfile(actor: PersonalActor, value: unknown, db: D1Database = getD1()) {
  const name = personalName(value);
  if (!name && !actor.isOwner) throw new Error('PERSONAL_NAME_REQUIRED');
  const guard = messageActorGuard(actor), now = new Date().toISOString();
  if (actor.isOwner) {
    // Keep the team's owner display projection atomic with its authoritative
    // personal field. Existing conversation and call reads then see it immediately.
    const [result] = await db.batch([
      db.prepare(`UPDATE trade_accounts SET manager_name=?,updated_at=? WHERE firebase_uid=?
        AND firebase_uid=? AND ${guard.sql}
        AND EXISTS(SELECT 1 FROM trade_team_members own WHERE own.id=? AND own.owner_uid=trade_accounts.firebase_uid AND own.member_uid=trade_accounts.firebase_uid)`)
        .bind(name, now, actor.ownerUid, actor.actorUid, ...guard.values, actor.memberId),
      db.prepare(`UPDATE trade_team_members SET display_name=(SELECT COALESCE(NULLIF(manager_name,''),NULLIF(business_name,''),'Business owner')
          FROM trade_accounts WHERE firebase_uid=?),updated_at=?
        WHERE id=? AND owner_uid=? AND member_uid=owner_uid AND owner_uid=? AND ${guard.sql}`)
        .bind(actor.ownerUid, now, actor.memberId, actor.ownerUid, actor.actorUid, ...guard.values),
    ]);
    if (!result.meta.changes) throw new Error('PERSONAL_PROFILE_ACCESS_REQUIRED');
  } else {
    // No target member can be supplied. A staff actor can only change their own
    // active membership, including a field-session login without a Firebase UID.
    const result = await db.prepare(`UPDATE trade_team_members SET display_name=?,updated_at=?
      WHERE id=? AND owner_uid=? AND member_uid<>owner_uid AND ${guard.sql}`)
      .bind(name, now, actor.memberId, actor.ownerUid, ...guard.values).run();
    if (!result.meta.changes) throw new Error('PERSONAL_PROFILE_ACCESS_REQUIRED');
  }
  return readTradePersonalProfile(actor, db);
}
