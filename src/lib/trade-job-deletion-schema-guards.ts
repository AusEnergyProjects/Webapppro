export type JobDeletionGuard = {
  readonly name: string;
  readonly sql: string;
  readonly legacySql: string;
  readonly legacySqlVariants?: readonly string[];
};

// Only the owner-scoped deletion transaction creates this permit, after its
// revision/protected-history CAS. It removes the permit in the same transaction.
export function jobDeletionPermitSql(jobSql: string, ownerSql: string) {
  return `EXISTS (SELECT 1 FROM trade_crm_write_guards permit
    JOIN trade_work_orders deleting_job ON deleting_job.id = ${jobSql}
      AND deleting_job.firebase_uid = ${ownerSql}
    JOIN trade_crm_job_details deleting_detail ON deleting_detail.work_order_id = deleting_job.id
      AND deleting_detail.firebase_uid = deleting_job.firebase_uid
    WHERE permit.firebase_uid = deleting_job.firebase_uid
      AND permit.operation_id = 'job-delete:' || deleting_job.id || ':' || deleting_job.revision
      AND permit.step_number = 1 AND permit.verified = 1 AND permit.created_at = deleting_job.updated_at
      AND deleting_job.record_status = 'active' AND deleting_job.partner_type = 'installer'
      AND deleting_job.source_type <> 'opportunity' AND deleting_job.stage <> 'completed'
      AND deleting_detail.customer_source IN ('trade_owned', 'public_lead_released'))`;
}

function guard(name: string, table: string, allowed: string, message: string, legacySql: string, legacySqlVariants?: readonly string[]): JobDeletionGuard {
  return { name, legacySql, legacySqlVariants, sql: `CREATE TRIGGER IF NOT EXISTS \`${name}\` BEFORE DELETE ON \`${table}\` FOR EACH ROW
    WHEN COALESCE((${allowed}), 0) = 0 BEGIN SELECT RAISE(ABORT, '${message}'); END;` };
}

const draftRecord = (alias: string) => `${alias}.status = 'draft' AND ${alias}.submitted_at = ''
  AND ${alias}.pdf_object_key = '' AND ${alias}.pdf_sha256 = ''
  AND NOT EXISTS (SELECT 1 FROM trade_activity_field_report_links link WHERE link.record_id = ${alias}.id)`;

export const JOB_DELETION_SCHEMA_GUARDS: readonly JobDeletionGuard[] = [
  guard('trade_compliance_intent_delete_guard', 'trade_work_order_compliance_intents',
    `${jobDeletionPermitSql('OLD.work_order_id', 'OLD.installer_uid')}
      AND NOT EXISTS (SELECT 1 FROM compliance_cases c WHERE c.work_order_id = OLD.work_order_id AND c.installer_uid = OLD.installer_uid)
      AND NOT EXISTS (SELECT 1 FROM trade_activity_field_records r WHERE r.intent_id = OLD.id)`,
    'TRADE_COMPLIANCE_INTENT_DELETE_BLOCKED',
    "CREATE TRIGGER IF NOT EXISTS `trade_compliance_intent_delete_guard` BEFORE DELETE ON `trade_work_order_compliance_intents` FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'TRADE_COMPLIANCE_INTENT_DELETE_BLOCKED'); END;",
    // The 569 Creditex runtime installer used unquoted identifiers; the SQL
    // migration used backticks. Keep both exact prior contracts explicit.
    ["CREATE TRIGGER IF NOT EXISTS trade_compliance_intent_delete_guard BEFORE DELETE ON trade_work_order_compliance_intents FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'TRADE_COMPLIANCE_INTENT_DELETE_BLOCKED'); END;"]),
  guard('trade_activity_field_record_no_delete', 'trade_activity_field_records',
    `${draftRecord('OLD')} AND ${jobDeletionPermitSql('OLD.work_order_id', 'OLD.owner_uid')}`,
    'Field record history must be retained.',
    "CREATE TRIGGER trade_activity_field_record_no_delete BEFORE DELETE ON trade_activity_field_records BEGIN SELECT RAISE(ABORT, 'Field record history must be retained.'); END;"),
  guard('trade_activity_field_record_version_no_delete', 'trade_activity_field_record_versions',
    `json_extract(OLD.payload, '$.status') = 'draft' AND EXISTS (SELECT 1 FROM trade_activity_field_records r
      WHERE r.id = OLD.record_id AND ${draftRecord('r')} AND ${jobDeletionPermitSql('r.work_order_id', 'r.owner_uid')})`,
    'Field record audit versions must be retained.',
    "CREATE TRIGGER trade_activity_field_record_version_no_delete BEFORE DELETE ON trade_activity_field_record_versions BEGIN SELECT RAISE(ABORT, 'Field record audit versions must be retained.'); END;"),
  guard('trade_crm_job_media_accepted_lead_delete_guard', 'trade_crm_job_media',
    `OLD.source <> 'accepted_public_lead' OR ${jobDeletionPermitSql('OLD.work_order_id', 'OLD.firebase_uid')}`,
    'accepted public lead job file is retained with job history',
    "CREATE TRIGGER IF NOT EXISTS `trade_crm_job_media_accepted_lead_delete_guard` BEFORE DELETE ON `trade_crm_job_media` FOR EACH ROW WHEN OLD.source = 'accepted_public_lead' BEGIN SELECT RAISE(ABORT, 'accepted public lead job file is retained with job history'); END;"),
  guard('trade_rental_events_append_only_delete', 'trade_rental_inspection_events',
    `EXISTS (SELECT 1 FROM trade_rental_inspections i WHERE i.id = OLD.inspection_id AND i.firebase_uid = OLD.firebase_uid
      AND i.status IN ('draft', 'scheduled', 'in_progress') AND i.issued_report_id = ''
      AND NOT EXISTS (SELECT 1 FROM trade_rental_inspection_modules m WHERE m.inspection_id = i.id AND m.status = 'complete')
      AND ${jobDeletionPermitSql('i.work_order_id', 'i.firebase_uid')})`,
    'rental inspection events are append only',
    "CREATE TRIGGER IF NOT EXISTS `trade_rental_events_append_only_delete` BEFORE DELETE ON `trade_rental_inspection_events` FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'rental inspection events are append only'); END;"),
];

// Sites installs trigger bodies via D1 prepared statements. Migrate only the
// exact previous contract; unexpected installed SQL remains a hard error.
export async function upgradeJobDeletionGuards(database: D1Database, definitions: readonly JobDeletionGuard[], canonical: (sql: string) => string) {
  const read = async () => new Map((await database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'")
    .all<{ name: string; sql: string | null }>()).results.map((row) => [row.name, row.sql || '']));
  const installed = await read();
  const statements: D1PreparedStatement[] = [];
  for (const definition of definitions) {
    const current = installed.get(definition.name);
    if (current && canonical(current) === canonical(definition.sql)) continue;
    const knownPrevious = [definition.legacySql, ...(definition.legacySqlVariants || [])];
    if (current && !knownPrevious.some((sql) => canonical(current) === canonical(sql))) {
      throw new Error(`JOB_DELETION_SCHEMA_GUARD_MISMATCH:${definition.name}`);
    }
    if (current) statements.push(database.prepare(`DROP TRIGGER \`${definition.name}\``));
    statements.push(database.prepare(definition.sql));
  }
  if (statements.length) await database.batch(statements);
  const verified = await read();
  for (const definition of definitions) {
    if (canonical(verified.get(definition.name) || '') !== canonical(definition.sql)) {
      throw new Error(`JOB_DELETION_SCHEMA_GUARD_UNAVAILABLE:${definition.name}`);
    }
  }
}
