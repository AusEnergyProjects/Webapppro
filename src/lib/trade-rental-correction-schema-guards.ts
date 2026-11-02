import { canonicalTlinkSchemaGuardSql } from './tlink-schema-guards.ts';
import { ensureTradeRentalSchemaGuards, TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS } from './trade-rental-schema-guards.ts';

import { guard, correctionSourceValid, snapshotLineage, rentalCorrectionReportGuardDefinition, type Definition } from './trade-rental-correction-report-guards.ts';

const families = {
  trade_rental_inspections: 'trade_rental_corrections',
  trade_rental_inspection_modules: 'trade_rental_correction_modules',
  trade_rental_inspection_items: 'trade_rental_correction_items',
  trade_rental_findings: 'trade_rental_correction_findings',
  trade_rental_evidence_links: 'trade_rental_correction_evidence_links',
  trade_rental_inspection_events: 'trade_rental_correction_events',
} as const;

function correctionDefinitions(columns: string[]): Definition[] {
  const fixed = columns.filter(column => !['status', 'revision', 'issued_report_id', 'submitted_at', 'issued_at', 'superseded_at', 'updated_at'].includes(column));
  const mutableChanged = columns.map(column => `NEW.\`${column}\` IS NOT OLD.\`${column}\``).join(' OR ');
  const allComplete = `EXISTS (SELECT 1 FROM trade_rental_correction_modules module WHERE module.inspection_id=NEW.id AND module.firebase_uid=NEW.firebase_uid)
    AND NOT EXISTS (SELECT 1 FROM trade_rental_correction_modules module WHERE module.inspection_id=NEW.id AND module.firebase_uid=NEW.firebase_uid
      AND (module.status<>'complete' OR coalesce(datetime(module.completed_at),'')<datetime(NEW.created_at)
        OR coalesce(json_extract(module.answers,'$.assessorDeclaration'),0) NOT IN (1,'true')
        OR coalesce(json_extract(module.credential_snapshot,'$.assessorMemberId'),'')<>NEW.assessor_member_id
        OR coalesce(json_extract(module.credential_snapshot,'$.confirmedAt'),'')<>module.completed_at))`;
  const definitions: Definition[] = [
    guard('trade_rental_correction_source_insert', 'INSERT', 'trade_rental_corrections', `NOT (${correctionSourceValid('NEW')})`, 'rental correction source mismatch'),
    guard('trade_rental_correction_identity_immutable', 'UPDATE', 'trade_rental_corrections', fixed.map(column => `NEW.\`${column}\` IS NOT OLD.\`${column}\``).join(' OR '), 'rental correction identity is immutable'),
    guard('trade_rental_correction_terminal_immutable', 'UPDATE', 'trade_rental_corrections', `OLD.status IN ('issued','superseded','withdrawn') AND (${mutableChanged})`, 'issued rental correction is immutable'),
    guard('trade_rental_correction_retained', 'DELETE', 'trade_rental_corrections', '', 'rental correction history is retained'),
    guard('trade_rental_correction_issue_claim', 'UPDATE', 'trade_rental_corrections', `NEW.status='issuing' AND NOT (
      OLD.status IN ('draft','scheduled','in_progress','submitted') AND NEW.revision=OLD.revision+1
      AND ${correctionSourceValid('NEW')} AND ${allComplete}
      AND EXISTS (SELECT 1 FROM trade_rental_reports report WHERE report.id=NEW.issued_report_id
        AND report.inspection_id=NEW.source_inspection_id AND report.firebase_uid=NEW.firebase_uid
        AND report.status='staged' AND ${snapshotLineage('report', 'NEW')}))`, 'rental correction issue claim is invalid'),
    guard('trade_rental_correction_issue_finish', 'UPDATE', 'trade_rental_corrections', `NEW.status='issued' AND NOT (
      OLD.status='issuing' AND NEW.revision=OLD.revision+1 AND NEW.issued_report_id=OLD.issued_report_id
      AND ${correctionSourceValid('NEW')} AND EXISTS (SELECT 1 FROM trade_rental_reports report
        WHERE report.id=NEW.issued_report_id AND report.inspection_id=NEW.source_inspection_id
          AND report.firebase_uid=NEW.firebase_uid AND report.status='issued' AND report.issued_at=NEW.issued_at
          AND ${snapshotLineage('report', 'NEW')}))`, 'rental correction issue finish is invalid'),
    guard('trade_rental_correction_issue_release', 'UPDATE', 'trade_rental_corrections', `OLD.status='issuing' AND NEW.status<>'issued' AND NOT (
      NEW.status='in_progress' AND NEW.issued_report_id='' AND NEW.revision=OLD.revision+1
      AND EXISTS (SELECT 1 FROM trade_rental_reports report WHERE report.id=OLD.issued_report_id
        AND report.inspection_id=OLD.source_inspection_id AND report.firebase_uid=OLD.firebase_uid AND report.status='failed'))`, 'rental correction issue release is invalid'),
  ];
  const children = Object.entries(families).filter(([original]) => !['trade_rental_inspections', 'trade_rental_inspection_events'].includes(original));
  for (const definition of TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS) {
    if (!children.some(([original]) => definition.sql.includes(`ON \`${original}\``)) || !/(parent_guard|issued_lock)/.test(definition.name)) continue;
    let sql = definition.sql;
    for (const [original, corrected] of Object.entries(families).sort((left, right) => right[0].length-left[0].length)) sql = sql.replaceAll(original, corrected);
    const name = definition.name.replace(/^trade_rental_/, 'trade_rental_correction_');
    sql = sql.replace(`\`${definition.name}\``, `\`${name}\``);
    definitions.push({ name, sql });
  }
  const eventMismatch = `NOT EXISTS (SELECT 1 FROM trade_rental_corrections correction WHERE correction.id=NEW.inspection_id
    AND correction.firebase_uid=NEW.firebase_uid AND (NEW.report_id='' OR EXISTS (SELECT 1 FROM trade_rental_reports report
      WHERE report.id=NEW.report_id AND report.inspection_id=correction.source_inspection_id AND report.firebase_uid=correction.firebase_uid))
    AND (NEW.report_link_id='' OR EXISTS (SELECT 1 FROM trade_rental_report_links link WHERE link.id=NEW.report_link_id
      AND link.inspection_id=correction.source_inspection_id AND link.firebase_uid=correction.firebase_uid
      AND (NEW.report_id='' OR link.report_id=NEW.report_id))))`;
  definitions.push(guard('trade_rental_correction_events_parent', 'INSERT', 'trade_rental_correction_events', eventMismatch, 'rental correction event parent mismatch'),
    guard('trade_rental_assessment_correction_issued_event', 'INSERT', 'trade_rental_inspection_events', `NEW.event_type='report_assessment_correction_issued' AND NOT EXISTS (
      SELECT 1 FROM trade_rental_corrections correction JOIN trade_rental_reports report ON report.id=correction.issued_report_id
      WHERE correction.id=json_extract(NEW.metadata,'$.correctionId') AND correction.source_inspection_id=NEW.inspection_id
        AND correction.firebase_uid=NEW.firebase_uid AND correction.status='issued' AND report.id=NEW.report_id
        AND report.status='issued' AND report.issued_by_uid=NEW.actor_uid AND NEW.actor_type='assessor'
        AND ${snapshotLineage('report', 'correction')}
        AND correction.source_report_id=json_extract(NEW.metadata,'$.sourceReportId')
        AND correction.source_report_sha256=json_extract(NEW.metadata,'$.sourceReportPdfSha256')
        AND correction.source_snapshot_sha256=json_extract(NEW.metadata,'$.sourceSnapshotSha256'))`, 'rental assessment correction issue event is invalid'),
    guard('trade_rental_correction_events_append_only_update', 'UPDATE', 'trade_rental_correction_events', '', 'rental correction events are append only'),
    guard('trade_rental_correction_events_append_only_delete', 'DELETE', 'trade_rental_correction_events', '', 'rental correction events are append only'));
  return definitions;
}

const ready = new WeakSet<object>();
export async function ensureTradeRentalCorrectionSchemaGuards(db: D1Database) {
  if (ready.has(db)) return;
  await ensureTradeRentalSchemaGuards(db);
  let headerColumns: string[] = [];
  for (const [original, corrected] of Object.entries(families)) {
    const originalColumns = (await db.prepare(`PRAGMA table_xinfo(\`${original}\`)`).all<{name:string}>()).results.map(row => row.name);
    const columns = (await db.prepare(`PRAGMA table_xinfo(\`${corrected}\`)`).all<{name:string}>()).results.map(row => row.name);
    const required = original === 'trade_rental_inspections' ? [...originalColumns, 'source_inspection_id', 'source_report_id', 'source_report_sha256', 'source_snapshot_sha256', 'correction_reason'] : originalColumns;
    if (!columns.length || required.some(column => !columns.includes(column))) throw new Error('TRADE_RENTAL_CORRECTION_MIGRATION_REQUIRED');
    if (original === 'trade_rental_inspections') headerColumns=columns;
  }
  const installed = new Map((await db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all<{name:string;sql:string}>()).results.map(row => [row.name,row.sql]));
  const replacements = TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.flatMap(base => { const extended=rentalCorrectionReportGuardDefinition(base); return extended ? [{base,extended}] : []; });
  const commands: D1PreparedStatement[]=[];
  for (const {base,extended} of replacements) {
    const sql=installed.get(base.name)||'';
    if (canonicalTlinkSchemaGuardSql(sql)===canonicalTlinkSchemaGuardSql(extended.sql)) continue;
    if (canonicalTlinkSchemaGuardSql(sql)!==canonicalTlinkSchemaGuardSql(base.sql)) throw new Error(`TRADE_RENTAL_SCHEMA_GUARD_MISMATCH:${base.name}`);
    commands.push(db.prepare(`DROP TRIGGER \`${base.name}\``),db.prepare(extended.sql));
  }
  const definitions=correctionDefinitions(headerColumns);
  for (const definition of definitions) {
    const sql=installed.get(definition.name);
    if (sql && canonicalTlinkSchemaGuardSql(sql)!==canonicalTlinkSchemaGuardSql(definition.sql)) throw new Error(`TRADE_RENTAL_SCHEMA_GUARD_MISMATCH:${definition.name}`);
    if (!sql) commands.push(db.prepare(definition.sql));
  }
  if (commands.length) await db.batch(commands);
  const verified=new Map((await db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all<{name:string;sql:string}>()).results.map(row=>[row.name,row.sql]));
  for (const definition of [...definitions,...replacements.map(({extended})=>extended)]) {
    if (canonicalTlinkSchemaGuardSql(verified.get(definition.name)||'')!==canonicalTlinkSchemaGuardSql(definition.sql)) throw new Error(`TRADE_RENTAL_SCHEMA_GUARDS_UNAVAILABLE:${definition.name}`);
  }
  ready.add(db);
}

export const ensureRentalCorrectionSchemaGuards = ensureTradeRentalCorrectionSchemaGuards;
