import { canonicalTlinkSchemaGuardSql } from './tlink-schema-guards.ts';

export type Definition = { readonly name: string; readonly sql: string };

export function guard(name: string, event: string, table: string, invalid: string, message: string): Definition {
  return { name, sql: `CREATE TRIGGER IF NOT EXISTS \`${name}\` BEFORE ${event} ON \`${table}\` FOR EACH ROW${invalid ? ` WHEN ${invalid}` : ''} BEGIN SELECT RAISE(ABORT, '${message}'); END;` };
}

export function correctionSourceValid(correction: string) {
  return `EXISTS (SELECT 1 FROM trade_rental_inspections original
    JOIN trade_rental_reports source ON source.inspection_id=original.id AND source.firebase_uid=original.firebase_uid
    WHERE original.id=${correction}.source_inspection_id AND original.firebase_uid=${correction}.firebase_uid
      AND original.work_order_id=${correction}.work_order_id AND original.status='issued'
      AND source.id=${correction}.source_report_id AND source.status='issued'
      AND source.pdf_sha256=${correction}.source_report_sha256 AND source.source_snapshot_sha256=${correction}.source_snapshot_sha256
      AND NOT EXISTS (SELECT 1 FROM trade_rental_reports later WHERE later.inspection_id=original.id
        AND later.firebase_uid=original.firebase_uid AND later.status='issued' AND later.id<>${correction}.issued_report_id AND later.revision>source.revision))`;
}

export function snapshotLineage(report: string, correction: string) {
  return `json_extract(${report}.report_snapshot,'$.report.assessmentCorrection.correctionId')=${correction}.id
    AND json_extract(${report}.report_snapshot,'$.report.assessmentCorrection.sourceReportId')=${correction}.source_report_id
    AND json_extract(${report}.report_snapshot,'$.report.assessmentCorrection.sourceReportPdfSha256')=${correction}.source_report_sha256
    AND json_extract(${report}.report_snapshot,'$.report.assessmentCorrection.sourceSnapshotSha256')=${correction}.source_snapshot_sha256`;
}

const correctionReportIssueAllowed = `EXISTS (SELECT 1 FROM trade_rental_corrections correction
  WHERE correction.source_inspection_id=NEW.inspection_id AND correction.firebase_uid=NEW.firebase_uid
    AND correction.status='issuing' AND correction.issued_report_id=NEW.id
    AND correction.assessor_member_id=NEW.issued_by_member_id
    AND ${snapshotLineage('NEW', 'correction')} AND ${correctionSourceValid('correction')}
    AND NEW.issued_at=json_extract(NEW.report_snapshot,'$.report.issuedAt')
    AND json(NEW.issuer_snapshot)=json(json_extract(NEW.report_snapshot,'$.issuer')))`;

const correctionReportLinkAllowed = `EXISTS (SELECT 1 FROM trade_rental_corrections correction
  JOIN trade_rental_reports report ON report.id=correction.issued_report_id
    AND report.inspection_id=correction.source_inspection_id AND report.firebase_uid=correction.firebase_uid
  WHERE correction.source_inspection_id=NEW.inspection_id AND correction.firebase_uid=NEW.firebase_uid
    AND correction.status='issued' AND report.id=NEW.report_id AND report.status='issued'
    AND ${snapshotLineage('report', 'correction')})`;

/** The original locks remain authoritative; only these exact additive alternatives are accepted. */
export function rentalCorrectionReportGuardDefinition(base: Definition): Definition | null {
  if (base.name === 'trade_rental_reports_transition_guard') return {
    name: base.name,
    sql: base.sql.replace("OR (OLD.status = 'staged' AND NEW.status = 'failed'", `OR (OLD.status = 'staged' AND NEW.status = 'issued' AND ${correctionReportIssueAllowed}) OR (OLD.status = 'staged' AND NEW.status = 'failed'`),
  };
  if (base.name === 'trade_rental_report_links_parent_guard_insert' || base.name === 'trade_rental_report_links_parent_guard_update') return guard(
    base.name, base.name.endsWith('_insert') ? 'INSERT' : 'UPDATE OF report_id, inspection_id, firebase_uid', 'trade_rental_report_links',
    `NEW.status <> 'active' OR NOT ((EXISTS (SELECT 1 FROM trade_rental_reports report
      JOIN trade_rental_inspections inspection ON inspection.id=report.inspection_id AND inspection.firebase_uid=report.firebase_uid
      WHERE report.id=NEW.report_id AND report.inspection_id=NEW.inspection_id AND report.firebase_uid=NEW.firebase_uid
        AND report.status='issued' AND inspection.status='issued' AND inspection.issued_report_id=report.id)) OR ${correctionReportLinkAllowed})`,
    'rental report link parent mismatch');
  return null;
}

export function isRentalCorrectionReportGuardSql(sql: string, base: Definition) {
  const extended = rentalCorrectionReportGuardDefinition(base);
  return Boolean(extended && canonicalTlinkSchemaGuardSql(sql) === canonicalTlinkSchemaGuardSql(extended.sql));
}
