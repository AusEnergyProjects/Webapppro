import {
  stableTradeComplianceIntentJson,
  TRADE_COMPLIANCE_INTENT_CONTRACT,
  type TradeComplianceIntentSnapshot,
} from "./trade-compliance-intent";

type PlannedComplianceIntentRow = {
  id: string;
  work_order_id: string;
  intent_key: string;
  installer_uid: string;
  compliance_organisation_id: string;
  program_template_id: string;
  activity_template_id: string;
  program_code: string;
  registry_activity_code: string;
  service_category: string;
  site_jurisdiction: string;
  planned_start: string;
  catalogue_reviewed_on: string;
  intent_snapshot: string;
  intent_snapshot_sha256: string;
  revision: number;
  updated_at: string;
};

export function isTradeComplianceIntentScheduleConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("trade_crm_write_guard_verified_check")
    || message.includes(
      "NOT NULL constraint failed: trade_work_order_compliance_intents.id",
    )
    || (
      message.includes("UNIQUE constraint failed")
      && message.includes("trade_work_order_compliance_intents.work_order_id")
      && message.includes("trade_work_order_compliance_intents.intent_key")
    );
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function intentSnapshot(
  row: PlannedComplianceIntentRow,
): TradeComplianceIntentSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.intent_snapshot);
  } catch {
    throw new Error("COMPLIANCE_INTENT_SNAPSHOT_INVALID");
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || (parsed as Record<string, unknown>).contract
      !== TRADE_COMPLIANCE_INTENT_CONTRACT
    || String((parsed as Record<string, unknown>).plannedStart || "")
      !== row.planned_start
  ) {
    throw new Error("COMPLIANCE_INTENT_SNAPSHOT_INVALID");
  }
  return parsed as TradeComplianceIntentSnapshot;
}

export function previousTradeScheduleMutationGuardStatement(
  database: D1Database,
  input: {
    changedAt: string;
    ownerUid: string;
  },
) {
  return database.prepare(`
    INSERT INTO trade_crm_write_guards (
      id,
      firebase_uid,
      operation_id,
      step_number,
      verified,
      created_at
    ) VALUES (
      ?, ?, ?, 1, CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?
    )
  `).bind(
    crypto.randomUUID(),
    input.ownerUid,
    `schedule-mutation:${crypto.randomUUID()}`,
    input.changedAt,
  );
}

export async function plannedComplianceIntentReplanStatements(
  database: D1Database,
  input: {
    actorUid: string;
    changedAt: string;
    ownerUid: string;
    plannedStart: string;
    workOrderId: string;
  },
): Promise<D1PreparedStatement[]> {
  const rows = await database.prepare(`
    SELECT
      id,
      work_order_id,
      intent_key,
      installer_uid,
      compliance_organisation_id,
      program_template_id,
      activity_template_id,
      program_code,
      registry_activity_code,
      service_category,
      site_jurisdiction,
      planned_start,
      catalogue_reviewed_on,
      intent_snapshot,
      intent_snapshot_sha256,
      revision,
      updated_at
    FROM trade_work_order_compliance_intents
    WHERE work_order_id = ?
      AND installer_uid = ?
      AND status = 'planned'
      AND compliance_case_id = ''
    ORDER BY intent_key, revision
  `).bind(input.workOrderId, input.ownerUid)
    .all<PlannedComplianceIntentRow>();
  const changedRows = rows.results.filter(
    (row) => String(row.planned_start || "") !== input.plannedStart,
  );
  const statements: D1PreparedStatement[] = [];

  for (const row of changedRows) {
    const snapshot = intentSnapshot(row);
    const sourceHash = await sha256Text(row.intent_snapshot);
    if (sourceHash !== row.intent_snapshot_sha256) {
      throw new Error("COMPLIANCE_INTENT_SNAPSHOT_HASH_MISMATCH");
    }
    const replacementSnapshot = stableTradeComplianceIntentJson({
      ...snapshot,
      plannedStart: input.plannedStart,
    });
    const replacementHash = await sha256Text(replacementSnapshot);
    const replacementId = crypto.randomUUID();
    const replacementRevision = Number(row.revision) + 1;
    const activityLabel = row.registry_activity_code
      || row.activity_template_id;

    statements.push(
      database.prepare(`
        UPDATE trade_work_order_compliance_intents
        SET status = 'superseded', updated_at = ?
        WHERE id = ?
          AND work_order_id = ?
          AND installer_uid = ?
          AND intent_key = ?
          AND status = 'planned'
          AND compliance_case_id = ''
          AND revision = ?
          AND planned_start = ?
          AND intent_snapshot = ?
          AND intent_snapshot_sha256 = ?
          AND updated_at = ?
      `).bind(
        input.changedAt,
        row.id,
        row.work_order_id,
        row.installer_uid,
        row.intent_key,
        row.revision,
        row.planned_start,
        row.intent_snapshot,
        row.intent_snapshot_sha256,
        row.updated_at,
      ),
      database.prepare(`
        INSERT INTO trade_work_order_compliance_intents (
          id,
          work_order_id,
          intent_key,
          installer_uid,
          compliance_organisation_id,
          program_template_id,
          activity_template_id,
          program_code,
          registry_activity_code,
          service_category,
          site_jurisdiction,
          planned_start,
          catalogue_reviewed_on,
          intent_snapshot,
          intent_snapshot_sha256,
          status,
          compliance_case_id,
          revision,
          created_by_uid,
          created_at,
          updated_at
        ) VALUES (
          CASE WHEN changes() = 1 THEN ? ELSE NULL END,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'planned', '', ?, ?, ?, ?
        )
      `).bind(
        replacementId,
        row.work_order_id,
        row.intent_key,
        row.installer_uid,
        row.compliance_organisation_id,
        row.program_template_id,
        row.activity_template_id,
        row.program_code,
        row.registry_activity_code,
        row.service_category,
        row.site_jurisdiction,
        input.plannedStart,
        row.catalogue_reviewed_on,
        replacementSnapshot,
        replacementHash,
        replacementRevision,
        input.actorUid,
        input.changedAt,
        input.changedAt,
      ),
      database.prepare(`
        INSERT INTO trade_work_order_events (
          id,
          work_order_id,
          firebase_uid,
          event_type,
          summary,
          created_at
        ) VALUES (?, ?, ?, 'compliance_intent_replanned', ?, ?)
      `).bind(
        crypto.randomUUID(),
        row.work_order_id,
        row.installer_uid,
        `${row.program_code} ${activityLabel} compliance plan revised for ${input.plannedStart || "an unscheduled date"}.`,
        input.changedAt,
      ),
    );
  }

  statements.push(
    database.prepare(`
      INSERT INTO trade_crm_write_guards (
        id,
        firebase_uid,
        operation_id,
        step_number,
        verified,
        created_at
      ) VALUES (
        ?, ?, ?, 1,
        CASE WHEN NOT EXISTS (
          SELECT 1
          FROM trade_work_order_compliance_intents
          WHERE work_order_id = ?
            AND installer_uid = ?
            AND status = 'planned'
            AND planned_start <> ?
        ) THEN 1 ELSE 0 END,
        ?
      )
    `).bind(
      crypto.randomUUID(),
      input.ownerUid,
      `compliance-intent-replan:${crypto.randomUUID()}`,
      input.workOrderId,
      input.ownerUid,
      input.plannedStart,
      input.changedAt,
    ),
  );

  return statements;
}
