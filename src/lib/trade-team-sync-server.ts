import { jobMemberSql } from "./trade-job-collaboration.ts";

export type SyncOperation = "upsert" | "delete";

type SyncJobChange = { ownerUid: string; workOrderId: string; revision: number; changedAt: string;
  audienceMemberId?: string; previousAudienceMemberId?: string; operation?: SyncOperation };

export function jobSyncChangeStatements(db: D1Database, change: SyncJobChange, guard?: { sql: string; values: unknown[] }) {
  const operation = change.operation || "upsert";
  const guardSql = guard ? ` AND (${guard.sql})` : "";
  const guardValues = guard?.values || [];
  // Include former audiences for removal; each remaining participant receives an upsert.
  const audienceSql = `SELECT DISTINCT member_id FROM (
    SELECT assignee_member_id member_id FROM trade_work_orders WHERE id = ? AND firebase_uid = ?
    UNION SELECT assignee_member_id FROM trade_crm_appointments WHERE work_order_id = ? AND firebase_uid = ?
      AND status IN ('scheduled','en_route','arrived','in_progress','completed')
    UNION SELECT audience_member_id FROM trade_team_sync_changes WHERE entity_type = 'job' AND entity_id = ? AND owner_uid = ?
    UNION SELECT ? UNION SELECT ?
  ) WHERE member_id <> ''`;
  const audienceValues = [change.workOrderId, change.ownerUid, change.workOrderId, change.ownerUid,
    change.workOrderId, change.ownerUid, change.audienceMemberId || "", change.previousAudienceMemberId || ""];
  const operationSql = operation === "delete" ? "'delete'" : `CASE WHEN EXISTS (
    SELECT 1 FROM trade_work_orders current_job WHERE current_job.id = ? AND current_job.firebase_uid = ?
      AND current_job.record_status = 'active' AND ${jobMemberSql("current_job", "audience.member_id")}
    ) THEN 'upsert' ELSE 'delete' END`;
  const operationValues = operation === "delete" ? [] : [change.workOrderId, change.ownerUid];
  const changedAudienceSql = `SELECT audience.member_id, ${operationSql} operation FROM (${audienceSql}) audience`;
  return [
    db.prepare(`INSERT INTO trade_team_sync_changes
      (owner_uid,audience_member_id,entity_type,entity_id,operation,revision,changed_at)
      SELECT ?, '', 'job', ?, ?, ?, ? WHERE 1=1${guardSql}`)
      .bind(change.ownerUid, change.workOrderId, operation, change.revision, change.changedAt, ...guardValues),
    db.prepare(`INSERT INTO trade_team_sync_changes
      (owner_uid,audience_member_id,entity_type,entity_id,operation,revision,changed_at)
      SELECT ?, member_id, 'job', ?, operation, ?, ? FROM (${changedAudienceSql}) WHERE 1=1${guardSql}`)
      .bind(change.ownerUid, change.workOrderId, change.revision, change.changedAt, ...operationValues, ...audienceValues, ...guardValues),
    db.prepare(`INSERT OR IGNORE INTO trade_mobile_push_outbox
      (id,owner_uid,audience_member_id,event_key,event_type,entity_type,entity_id,payload,status,attempts,next_attempt_at,created_at,updated_at)
      SELECT ? || ':' || member_id, ?, member_id, ? || ':' || member_id || ':' || operation,
        CASE operation WHEN 'delete' THEN 'job_removed' ELSE 'job_changed' END, 'job', ?, ?, 'pending', 0, '', ?, ?
      FROM (${changedAudienceSql}) push_audience WHERE EXISTS (
        SELECT 1 FROM trade_team_members push_member WHERE push_member.id=push_audience.member_id
          AND push_member.owner_uid=? AND push_member.status='active' AND push_member.can_view_field_evidence=1
      )${guardSql}`)
      .bind(crypto.randomUUID(), change.ownerUid, `${change.ownerUid}:${change.workOrderId}:${change.revision}`, change.workOrderId,
        JSON.stringify({contractVersion:2,reason:"sync_required"}), change.changedAt, change.changedAt,
        ...operationValues, ...audienceValues, change.ownerUid, ...guardValues),
  ];
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
        AND (stage <> 'completed' OR NOT EXISTS (SELECT 1 FROM trade_crm_appointments open_visit
          WHERE open_visit.work_order_id = trade_work_orders.id AND open_visit.firebase_uid = trade_work_orders.firebase_uid
            AND open_visit.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')))
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
