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

export type OnlineChildMutationGuard = {
  childKind: "task" | "form";
  childId: string;
  childRevision: number;
  jobRevision: number;
  jobStage: string;
  ownerUid: string;
  updatedAt: string;
  workOrderId: string;
};

async function runGuardedOnlineMutationBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
  finalGuard: D1PreparedStatement,
) {
  try {
    return await db.batch([...statements, finalGuard]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("NOT NULL")
      && message.includes("trade_work_order_events.summary")
    ) {
      throw new Error("ONLINE_MUTATION_CONFLICT");
    }
    throw error;
  }
}

function onlineMutationFailureGuard(
  db: D1Database,
  ownerUid: string,
  workOrderId: string,
  updatedAt: string,
  successCondition: string,
  successValues: unknown[],
) {
  return db.prepare(`INSERT INTO trade_work_order_events
    (id, work_order_id, firebase_uid, event_type, summary, created_at)
    SELECT ?, ?, ?, 'online_mutation_guard', NULL, ?
    WHERE NOT (${successCondition})`).bind(
      crypto.randomUUID(),
      workOrderId,
      ownerUid,
      updatedAt,
      ...successValues,
    );
}

export async function guardedOnlineChildMutationBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
  guard: OnlineChildMutationGuard,
) {
  const childTable = guard.childKind === "task"
    ? "trade_work_order_tasks"
    : "trade_job_forms";
  const finalGuard = onlineMutationFailureGuard(
    db,
    guard.ownerUid,
    guard.workOrderId,
    guard.updatedAt,
    `EXISTS (
      SELECT 1
      FROM trade_work_orders work_order
      JOIN ${childTable} child
        ON child.work_order_id = work_order.id
        AND child.firebase_uid = work_order.firebase_uid
      WHERE work_order.id = ?
        AND work_order.firebase_uid = ?
        AND work_order.record_status = 'active'
        AND work_order.stage = ?
        AND work_order.stage NOT IN ('completed', 'cancelled')
        AND work_order.revision = ?
        AND work_order.updated_at = ?
        AND child.id = ?
        AND child.revision = ?
        AND child.updated_at = ?
    )`,
    [
      guard.workOrderId,
      guard.ownerUid,
      guard.jobStage,
      guard.jobRevision,
      guard.updatedAt,
      guard.childId,
      guard.childRevision,
      guard.updatedAt,
    ],
  );
  return runGuardedOnlineMutationBatch(db, statements, finalGuard);
}

export type OnlineJobMutationGuard =
  | {
    kind: "stage";
    jobRevision: number;
    jobStage: string;
    ownerUid: string;
    updatedAt: string;
    workOrderId: string;
  }
  | {
    kind: "assignment";
    assigneeLabel: string;
    assigneeMemberId: string;
    jobRevision: number;
    jobStage: string;
    ownerUid: string;
    updatedAt: string;
    workOrderId: string;
  }
  | {
    kind: "work_order";
    assigneeLabel: string;
    assigneeMemberId: string;
    jobPriority: string;
    jobRevision: number;
    jobStage: string;
    ownerUid: string;
    scheduledEnd: string;
    scheduledStart: string;
    updatedAt: string;
    workOrderId: string;
  };

export async function guardedOnlineJobMutationBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
  guard: OnlineJobMutationGuard,
) {
  const resultChecks = guard.kind === "assignment"
    ? "AND assignee_member_id = ? AND assignee_label = ?"
    : guard.kind === "work_order"
      ? `AND priority = ? AND scheduled_start = ? AND scheduled_end = ?
        AND assignee_member_id = ? AND assignee_label = ?`
      : "";
  const resultValues = guard.kind === "assignment"
    ? [guard.assigneeMemberId, guard.assigneeLabel]
    : guard.kind === "work_order"
      ? [
        guard.jobPriority,
        guard.scheduledStart,
        guard.scheduledEnd,
        guard.assigneeMemberId,
        guard.assigneeLabel,
      ]
      : [];
  const finalGuard = onlineMutationFailureGuard(
    db,
    guard.ownerUid,
    guard.workOrderId,
    guard.updatedAt,
    `EXISTS (
      SELECT 1 FROM trade_work_orders
      WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
        AND stage = ? AND revision = ? AND updated_at = ?
        ${resultChecks}
    )`,
    [
      guard.workOrderId,
      guard.ownerUid,
      guard.jobStage,
      guard.jobRevision,
      guard.updatedAt,
      ...resultValues,
    ],
  );
  return runGuardedOnlineMutationBatch(db, statements, finalGuard);
}
