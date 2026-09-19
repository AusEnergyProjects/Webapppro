const STATES = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);

export function validateMemberServiceStates(value: unknown, businessStates: readonly string[]): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8
    || value.some(state => typeof state !== 'string')) throw new Error('MEMBER_SERVICE_STATES_INVALID');
  const states = value.map(state => state.trim().toUpperCase());
  if (new Set(states).size !== states.length || states.some(state => !STATES.has(state) || !businessStates.includes(state))) {
    throw new Error('MEMBER_SERVICE_STATES_INVALID');
  }
  return states.sort();
}

export function memberServiceStateProjection(stored: unknown, businessStates: readonly string[], isOwner: boolean) {
  const assignedServiceStates: string[] | null = isOwner || stored == null ? null : JSON.parse(String(stored));
  return { assignedServiceStates, serviceStates: businessStates.filter(state => assignedServiceStates === null || assignedServiceStates.includes(state)) };
}

export async function getBusinessServiceStates(db: D1Database, ownerUid: string): Promise<string[]> {
  return (await db.prepare('SELECT state FROM trade_training_served_jurisdictions WHERE owner_uid=? ORDER BY state')
    .bind(ownerUid).all<{ state: string }>()).results.map(row => row.state);
}

export function memberServiceStatesSql(member: string, account: string) {
  if (![member, account].every(alias => /^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))) throw new Error('A static SQL alias is required.');
  return `(SELECT json_group_array(served.state) FROM trade_training_served_jurisdictions served
    WHERE served.owner_uid=${account}.firebase_uid AND (${member}.member_uid=${member}.owner_uid
      OR ${member}.service_states IS NULL OR EXISTS(SELECT 1 FROM json_each(${member}.service_states) assigned_state WHERE assigned_state.value=served.state)))`;
}
