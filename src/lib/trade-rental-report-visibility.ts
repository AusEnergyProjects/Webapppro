/** Issued source PDFs and audited revisions retain their own immutable sharing links. */
export function rentalIssuedReportVisibilitySql(report = 'report', inspection = 'inspection') {
  if (![report, inspection].every(alias => /^[A-Za-z_][A-Za-z_0-9]*$/.test(alias))) throw new Error('RENTAL_REPORT_SQL_ALIAS_INVALID');
  return `(${inspection}.issued_report_id=${report}.id OR EXISTS (
    SELECT 1 FROM trade_rental_inspection_events correction
    JOIN trade_rental_reports corrected ON corrected.id=correction.report_id AND corrected.inspection_id=correction.inspection_id
      AND corrected.firebase_uid=correction.firebase_uid AND corrected.status='issued'
    WHERE correction.inspection_id=${inspection}.id AND correction.firebase_uid=${inspection}.firebase_uid
      AND correction.event_type IN ('report_formatting_revision_issued','report_answer_revision_issued')
      AND correction.actor_type='owner' AND correction.actor_uid=${inspection}.firebase_uid
      AND json_extract(correction.metadata,'$.sourceReportId')=${report}.id) OR EXISTS (
    SELECT 1 FROM trade_rental_inspection_events correction
    WHERE correction.inspection_id=${inspection}.id AND correction.firebase_uid=${inspection}.firebase_uid
      AND correction.report_id=${report}.id AND correction.event_type='report_assessment_correction_issued'
      AND correction.actor_uid=${report}.issued_by_uid
      AND json_extract(correction.metadata,'$.correctionId')=json_extract(${report}.report_snapshot,'$.report.assessmentCorrection.correctionId')
      AND json_extract(correction.metadata,'$.sourceReportId')=json_extract(${report}.report_snapshot,'$.report.assessmentCorrection.sourceReportId')))`;
}

/** New delivery always names the latest issued revision; historical receipts stay readable. */
export function rentalCurrentIssuedReportSql(report = 'report', inspection = 'inspection') {
  return `(${rentalIssuedReportVisibilitySql(report, inspection)} AND NOT EXISTS (
    SELECT 1 FROM trade_rental_reports newer WHERE newer.inspection_id=${report}.inspection_id
      AND newer.firebase_uid=${report}.firebase_uid AND newer.status='issued' AND newer.revision>${report}.revision))`;
}
