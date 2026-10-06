import type { WattzunAccess } from './wattzun-portal-access-server';
import { isWattzunPortal } from './wattzun-portal';
import { wattzunUsagePeriod, type WattzunUsage, type WattzunUsageKind } from './wattzun-usage';

export class WattzunUsageError extends Error {
  constructor(readonly code: 'unavailable' | 'conflict') { super(`WATTZUN_USAGE_${code.toUpperCase()}`); }
}
export type WattzunUsageRecord = { access: WattzunAccess; requestId: string; kind: WattzunUsageKind };
function validAccess(access: WattzunAccess) {
  if (!access.actorUid || access.actorUid.length > 180 || !isWattzunPortal(access.scope.portal)
    || !/^[A-Za-z0-9:_-]{1,128}$/.test(access.scope.scopeId)) throw new WattzunUsageError('unavailable');
}
/** Counts a prepared assistant reply, not listening time or successful speaker playback.
 * No conversation content or provider estimates are retained. */
export async function recordWattzunUsage({ access, requestId, kind }: WattzunUsageRecord, now = new Date()): Promise<void> {
  validAccess(access);
  if (!/^[A-Za-z0-9:_-]{16,72}$/.test(requestId) || (kind !== 'text' && kind !== 'voice') || !Number.isFinite(now.getTime())) {
    throw new WattzunUsageError('unavailable');
  }
  try {
    const result = await access.db.prepare(`INSERT INTO wattzun_usage_events (actor_uid, portal, scope_id, request_id, kind, completed_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(actor_uid, portal, scope_id, request_id) DO NOTHING`)
      .bind(access.actorUid, access.scope.portal, access.scope.scopeId, requestId, kind, now.toISOString()).run();
    const changes = result.meta.changes;
    if (!result.success || typeof changes !== 'number' || !Number.isSafeInteger(changes) || changes < 0 || changes > 1) throw new WattzunUsageError('unavailable');
    if (changes === 1) return;
    const existing = await access.db.prepare(`SELECT kind FROM wattzun_usage_events
      WHERE actor_uid = ? AND portal = ? AND scope_id = ? AND request_id = ?`)
      .bind(access.actorUid, access.scope.portal, access.scope.scopeId, requestId).first<{ kind: string }>();
    if (!existing) throw new WattzunUsageError('unavailable');
    if (existing.kind !== kind) throw new WattzunUsageError('conflict');
  } catch (error) { if (error instanceof WattzunUsageError) throw error; throw new WattzunUsageError('unavailable'); }
}
export async function readWattzunUsage(access: WattzunAccess, now = new Date()): Promise<WattzunUsage> {
  validAccess(access);
  try {
    const period = wattzunUsagePeriod(now);
    const row = await access.db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind = 'text' THEN 1 ELSE 0 END), 0) text_messages,
      COALESCE(SUM(CASE WHEN kind = 'voice' THEN 1 ELSE 0 END), 0) voice_exchanges FROM wattzun_usage_events
      WHERE actor_uid = ? AND portal = ? AND scope_id = ? AND completed_at >= ? AND completed_at < ?`)
      .bind(access.actorUid, access.scope.portal, access.scope.scopeId, period.startsAt, period.endsAt)
      .first<{ text_messages: number; voice_exchanges: number }>();
    if (!row || !Number.isSafeInteger(row.text_messages) || row.text_messages < 0
      || !Number.isSafeInteger(row.voice_exchanges) || row.voice_exchanges < 0) throw new WattzunUsageError('unavailable');
    return { portal: access.scope.portal, scopeId: access.scope.scopeId, month: period.month, monthBasis: 'UTC', audience: 'personal',
      textMessages: row.text_messages, voiceExchanges: row.voice_exchanges };
  } catch (error) { if (error instanceof WattzunUsageError) throw error; throw new WattzunUsageError('unavailable'); }
}
