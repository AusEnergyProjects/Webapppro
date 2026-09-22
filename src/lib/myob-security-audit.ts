/** Fixed event fields deliberately exclude financial data, credentials and error payloads. */
export const MYOB_SECURITY_ACTIONS = [
  "accounting.read", "invoice.export", "invoice.refresh", "oauth.connect",
  "oauth.callback", "oauth.disconnect", "access.denied", "retention.review", "admin.access", "compliance.access",
] as const;
export const MYOB_SECURITY_OUTCOMES = ["attempt", "success", "denied", "failure"] as const;

export type MyobSecurityEvent = {
  actorUid: string;
  ownerUid: string;
  action: typeof MYOB_SECURITY_ACTIONS[number];
  resourceId?: string;
  outcome?: typeof MYOB_SECURITY_OUTCOMES[number];
};

function eventIdentifier(value: string, optional = false) {
  if (optional && value === "") return value;
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(value)) throw new Error("INVALID_SECURITY_EVENT_IDENTIFIER");
  return value;
}

export function myobSecurityEventStatement(db: D1Database, event: MyobSecurityEvent, afterPreviousChange = false) {
  if (!(MYOB_SECURITY_ACTIONS as readonly string[]).includes(event.action)
    || !(MYOB_SECURITY_OUTCOMES as readonly string[]).includes(event.outcome || "success")) {
    throw new Error("INVALID_SECURITY_EVENT");
  }
  return db.prepare(`INSERT INTO myob_security_events
    (id, actor_uid, owner_uid, action, resource_id, outcome)
    ${afterPreviousChange ? "SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1" : "VALUES (?, ?, ?, ?, ?, ?)"}`)
    .bind(crypto.randomUUID(), eventIdentifier(event.actorUid), eventIdentifier(event.ownerUid),
      event.action, eventIdentifier(event.resourceId || "", true), event.outcome || "success");
}

/** A failed audit write stops the caller before any provider operation. */
export async function writeMyobSecurityEvent(db: D1Database, event: MyobSecurityEvent) {
  await myobSecurityEventStatement(db, event).run();
}

export async function hasMyobIntegrationData(db: D1Database) {
  const row = await db.prepare(`SELECT 1 AS present FROM trade_crm_integrations WHERE provider = 'myob'
    UNION ALL SELECT 1 AS present FROM trade_crm_accounting_documents WHERE provider = 'myob' LIMIT 1`)
    .first<{ present: number }>();
  return Boolean(row);
}

/** Expired OAuth state cannot be used; remove its metadata on the existing minute cron. */
export async function removeExpiredIntegrationStates(db: D1Database) {
  return db.prepare("DELETE FROM trade_crm_oauth_states WHERE expires_at <= ?")
    .bind(new Date().toISOString()).run();
}
