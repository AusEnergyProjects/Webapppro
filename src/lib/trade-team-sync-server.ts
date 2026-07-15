export type SyncOperation = "upsert" | "delete";

type SyncJobChange = {
  ownerUid: string;
  workOrderId: string;
  revision: number;
  changedAt: string;
  audienceMemberId?: string;
  previousAudienceMemberId?: string;
  operation?: SyncOperation;
};

function statement(
  db: D1Database,
  change: SyncJobChange,
  audienceMemberId: string,
  operation: SyncOperation,
) {
  return db.prepare(`INSERT INTO trade_team_sync_changes
    (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
    VALUES (?, ?, 'job', ?, ?, ?, ?)`)
    .bind(change.ownerUid, audienceMemberId, change.workOrderId, operation, change.revision, change.changedAt);
}

function pushStatement(db: D1Database, change: SyncJobChange, audienceMemberId: string, operation: SyncOperation) {
  const eventKey = `${change.ownerUid}:${audienceMemberId}:${change.workOrderId}:${change.revision}:${operation}`;
  return db.prepare(`INSERT OR IGNORE INTO trade_mobile_push_outbox
    (id, owner_uid, audience_member_id, event_key, event_type, entity_type, entity_id, payload,
     status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'job', ?, ?, 'pending', 0, '', ?, ?)`).bind(
    crypto.randomUUID(), change.ownerUid, audienceMemberId, eventKey,
    operation === "delete" ? "job_removed" : "job_changed", change.workOrderId,
    JSON.stringify({ contractVersion: 2, reason: "sync_required" }), change.changedAt, change.changedAt,
  );
}

export function jobSyncChangeStatements(db: D1Database, change: SyncJobChange) {
  const operation = change.operation || "upsert";
  const currentAudience = change.audienceMemberId || "";
  const previousAudience = change.previousAudienceMemberId || "";
  const statements = [statement(db, change, "", operation)];
  if (previousAudience && previousAudience !== currentAudience) {
    statements.push(statement(db, change, previousAudience, "delete"));
    statements.push(pushStatement(db, change, previousAudience, "delete"));
  }
  if (currentAudience) {
    statements.push(statement(db, change, currentAudience, operation));
    statements.push(pushStatement(db, change, currentAudience, operation));
  }
  return statements;
}

export function nextJobRevision(value: unknown) {
  const current = Number(value);
  return Number.isSafeInteger(current) && current > 0 ? current + 1 : 2;
}
