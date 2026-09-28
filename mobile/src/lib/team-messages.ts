export type TeamNotificationTarget = { threadId: string; callId?: string };

function reference(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : '';
}

export function teamNotificationTarget(data: unknown): TeamNotificationTarget | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (value.type !== 'team_message' && value.type !== 'team_call') return null;
  const threadId = reference(value.threadId);
  if (!threadId) return null;
  const callId = value.type === 'team_call' ? reference(value.callId) : '';
  return { threadId, ...(callId ? { callId } : {}) };
}
