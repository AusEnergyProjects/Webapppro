import { getD1 } from '../../db';
import type { TeamAccess } from './trade-team-server';
import { messageActorGuard } from './trade-message-media-access';

type PersonalActor = Pick<TeamAccess, 'ownerUid' | 'actorUid' | 'memberId' | 'isOwner' | 'fieldSessionId'>;
export type TradePersonalProfile = { name: string; phone: string; isOwner: boolean };

export function personalName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('PERSONAL_NAME_INVALID');
  }
  return value.replace(/\s+/g, ' ').trim();
}

export function personalPhone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('PERSONAL_PHONE_INVALID');
  }
  const raw = value.normalize('NFKC').trim();
  if (!raw) return '';
  if (!/^[+0-9() .-]+$/.test(raw) || (raw.includes('+') && !raw.startsWith('+'))
    || (raw.match(/\+/g) || []).length > 1) throw new Error('PERSONAL_PHONE_INVALID');
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 6 || digits.length > 15) throw new Error('PERSONAL_PHONE_INVALID');
  if (raw.startsWith('+') || raw.startsWith('00')) return `+${digits}`;
  if (/^0[23478]\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  return digits;
}

export async function readTradePersonalProfile(actor: PersonalActor, db: D1Database = getD1()): Promise<TradePersonalProfile> {
  const guard = messageActorGuard(actor);
  const row = await db.prepare(`SELECT CASE WHEN ? THEN a.manager_name ELSE m.display_name END name, m.phone
    FROM trade_team_members m JOIN trade_accounts a ON a.firebase_uid=m.owner_uid
    WHERE m.id=? AND m.owner_uid=? AND (m.member_uid=m.owner_uid)=? AND ${guard.sql}`)
    .bind(actor.isOwner ? 1 : 0, actor.memberId, actor.ownerUid, actor.isOwner ? 1 : 0, ...guard.values)
    .first<{ name: string; phone: string }>();
  if (!row) throw new Error('PERSONAL_PROFILE_ACCESS_REQUIRED');
  return { name: row.name, phone: row.phone, isOwner: actor.isOwner };
}

export async function updateTradePersonalProfile(actor: PersonalActor, value: unknown, db: D1Database = getD1()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('name' in value)
    || Object.keys(value).some(key => key !== 'name' && key !== 'phone')) throw new Error('PERSONAL_PROFILE_INVALID');
  const name = personalName(value.name);
  if (!name && !actor.isOwner) throw new Error('PERSONAL_NAME_REQUIRED');
  const phone = 'phone' in value ? personalPhone(value.phone) : undefined;
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
          FROM trade_accounts WHERE firebase_uid=?),phone=CASE WHEN ? THEN ? ELSE phone END,updated_at=?
        WHERE id=? AND owner_uid=? AND member_uid=owner_uid AND owner_uid=? AND ${guard.sql}`)
        .bind(actor.ownerUid, phone === undefined ? 0 : 1, phone ?? '', now, actor.memberId, actor.ownerUid, actor.actorUid, ...guard.values),
    ]);
    if (!result.meta.changes) throw new Error('PERSONAL_PROFILE_ACCESS_REQUIRED');
  } else {
    // No target member can be supplied. A staff actor can only change their own
    // active membership, including a field-session login without a Firebase UID.
    const result = await db.prepare(`UPDATE trade_team_members SET display_name=?,phone=CASE WHEN ? THEN ? ELSE phone END,updated_at=?
      WHERE id=? AND owner_uid=? AND member_uid<>owner_uid AND ${guard.sql}`)
      .bind(name, phone === undefined ? 0 : 1, phone ?? '', now, actor.memberId, actor.ownerUid, ...guard.values).run();
    if (!result.meta.changes) throw new Error('PERSONAL_PROFILE_ACCESS_REQUIRED');
  }
  return readTradePersonalProfile(actor, db);
}
