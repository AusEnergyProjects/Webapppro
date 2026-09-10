import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { draftComplianceDeletionGuardDefinitions, draftWorkPackDeletionGuardDefinitions, retainedDraftComplianceBlockerSql, draftComplianceDeletionStatements } from '../src/lib/trade-job-draft-compliance-deletion.ts';
import { JOB_DELETION_SCHEMA_GUARDS, upgradeJobDeletionGuards } from '../src/lib/trade-job-deletion-schema-guards.ts';
import { canonicalCreditexWorkPackSchemaGuardSql } from '../src/lib/creditex-work-pack-schema-guards.ts';

const NOW = '2026-09-10T01:00:00.000Z';
const HASH = 'a'.repeat(64);
const SHA = `sha256:${HASH}`;
function fixture(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec('PRAGMA foreign_keys = ON');
  for (const name of fs.readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => /^\d{4}_.+\.sql$/.test(name) && !name.startsWith('0044_')).sort()) {
    sql.exec(fs.readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  // Seed representative persisted rows under the real migrated table CHECK/FK
  // constraints, then install the production deletion guards being exercised.
  // Creation/publication governance is covered by the work-pack runtime suite.
  for (const { name } of sql.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all()) sql.exec(`DROP TRIGGER \`${name}\``);
  const insert = (table, values) => sql.prepare(`INSERT INTO ${table} (${Object.keys(values)}) VALUES (${Object.keys(values).map(() => '?')})`).run(...Object.values(values));
  const add = (id = 'job', owner = 'owner') => {
    const caseId = `${id}-case`; const intentId = `${id}-intent`;
    insert('trade_work_orders', { id, firebase_uid: owner, partner_type: 'installer', work_number: id, title: id, stage: 'no_show', revision: 4, created_at: NOW, updated_at: NOW });
    insert('trade_crm_job_details', { id: `${id}-details`, work_order_id: id, firebase_uid: owner, customer_source: 'trade_owned', created_at: NOW, updated_at: NOW });
    insert('trade_work_order_compliance_intents', { id: intentId, work_order_id: id, installer_uid: owner, compliance_organisation_id: 'org', program_template_id: 'program', activity_template_id: 'activity', program_code: 'VEU', service_category: 'heating', site_jurisdiction: 'VIC', catalogue_reviewed_on: '2026-09-10', intent_snapshot: JSON.stringify({ contract: 'tlink-creditex-job-intent-v1', program: { templateId: 'program', programCode: 'VEU' }, activity: { templateId: 'activity', serviceCategory: 'heating' }, siteJurisdiction: 'VIC', catalogueReviewedOn: '2026-09-10' }), intent_snapshot_sha256: HASH, status: 'case_linked', compliance_case_id: caseId, created_by_uid: owner, created_at: NOW, updated_at: NOW });
    insert('compliance_cases', { id: caseId, case_number: caseId, organisation_id: 'org', program_id: 'program', work_order_id: id, installer_uid: owner, activity_version_id: 'activity', evidence_policy_version_id: 'policy', compliance_intent_id: intentId, activity_date: '2026-09-10', site_jurisdiction: 'VIC', activity_snapshot: '{}', status: 'draft', evidence_status: 'in_progress', created_by_type: 'installer', created_by_uid: owner, created_at: NOW, updated_at: NOW });
    insert('compliance_case_events', { id: `${id}-event`, case_id: caseId, organisation_id: 'org', event_type: 'case_created', actor_type: 'installer', actor_uid: owner, summary: 'Automatic draft', created_at: NOW });
    insert('compliance_manual_policy_composition_locks', { id: `${id}-lock`, organisation_id: 'org', binding_id: 'binding', binding_version: 1, binding_snapshot_sha256: HASH, activity_template_id: 'activity', activity_version_id: 'activity', reference_type: 'compliance_case', reference_id: caseId, reference_activity_date: '2026-09-10', reference_updated_at: NOW, reference_snapshot_sha256: HASH, revision: 1, composition_snapshot: JSON.stringify({ contract: 'creditex-manual-evidence-form-v2', bindingId: 'binding', bindingVersion: 1, bindingSnapshotSha256: HASH, bindingSnapshot: { activityTemplate: { templateId: 'activity' }, activity: { id: 'activity' } }, activityReference: { referenceType: 'compliance_case', referenceId: caseId, activityDate: '2026-09-10', referenceUpdatedAt: NOW, referenceSnapshotSha256: HASH } }), composition_sha256: HASH, diff_snapshot: '[]', diff_sha256: HASH, locked_by_uid: owner, locked_at: NOW });
    const response = { contract: 'creditex-activity-work-pack-instance/v1', prefill: { contract: 'creditex-activity-work-pack-prefill/v1', customerContext: { contract: 'creditex-activity-work-pack-customer-context/v1', editable: false, contextSha256: SHA, customerId: '', siteId: '', contactId: '', customerRevision: '', siteRevision: '', contactRevision: '' } }, response: { contract: 'creditex-activity-work-pack-response/v1', schemaSha256: SHA, answers: { condition: 'partly answered' }, repeatableSections: {}, dependencyResolutions: {} }, declarations: {}, finalisation: null, compositionLockId: '', compositionSha256: '', definitionSha256: SHA, prefillSha256: SHA, responseSha256: SHA, declarationsSha256: SHA };
    response.compositionLockId = `${id}-lock`; response.compositionSha256 = HASH;
    for (const revision of [1, 2]) insert('compliance_activity_work_pack_instances', { id: `${id}-pack-${revision}`, instance_key: `${id}-pack`, organisation_id: 'org', compliance_case_id: caseId, work_order_id: id, compliance_intent_id: intentId, work_pack_version_id: 'published-version', manual_policy_composition_lock_id: `${id}-lock`, manual_policy_composition_sha256: HASH, activity_date: '2026-09-10', revision, supersedes_instance_id: revision === 1 ? '' : `${id}-pack-1`, status: revision === 1 ? 'not_started' : 'in_progress', response_snapshot: JSON.stringify(response), response_sha256: SHA, created_by_uid: owner, created_at: NOW });
    insert('compliance_case_evidence', { id: `${id}-evidence`, organisation_id: 'org', case_id: caseId, requirement_id: 'photo', source_type: 'field_app', status: 'received', object_key: `${id}/evidence.jpg`, file_name: 'evidence.jpg', content_type: 'image/jpeg', size_bytes: 12, original_sha256: HASH, evidence_envelope: '{}', received_by_type: 'installer', received_by_uid: owner, received_at: NOW, created_at: NOW, updated_at: NOW });
    insert('compliance_evidence_integrity_receipts', { id: `${id}-integrity`, organisation_id: 'org', evidence_id: `${id}-evidence`, request_id: `${id}-request`, object_key: `${id}/evidence.jpg`, expected_sha256: HASH, observed_sha256: HASH, expected_size_bytes: 12, observed_size_bytes: 12, expected_content_type: 'image/jpeg', observed_content_type: 'image/jpeg', result: 'matched', verified_by_uid: owner, verified_at: NOW });
    insert('compliance_activity_work_pack_artifacts', { id: `${id}-artifact`, organisation_id: 'org', instance_key: `${id}-pack`, case_instance_id: `${id}-pack-2`, prompt_key: 'photo', artifact_kind: 'photo', object_key: `${id}/artifact.jpg`, original_file_name: 'artifact.jpg', content_type: 'image/jpeg', size_bytes: 12, original_sha256: HASH, metadata_snapshot: JSON.stringify({ contract: 'creditex-work-pack-artifact-metadata/v1', originalSha256: HASH, deviceId: 'phone', capturedAt: NOW }), metadata_sha256: SHA, integrity_receipt_id: `${id}-integrity`, captured_device_id: 'phone', captured_by_uid: owner, captured_at: NOW, created_at: NOW });
    insert('compliance_activity_work_pack_browser_upload_receipts', { id: `${id}-upload`, contract: 'creditex-activity-work-pack-browser-upload/v1', organisation_id: 'org', instance_key: `${id}-pack`, case_instance_id: `${id}-pack-2`, owner_uid: owner, actor_uid: owner, member_id: 'member', work_order_id: id, client_upload_id: `${id}-upload-client`, prompt_key: 'photo', purpose: 'artifact', artifact_kind: 'photo', device_id: 'phone', object_key: `${id}/artifact.jpg`, file_name: 'artifact.jpg', content_type: 'image/jpeg', size_bytes: 12, original_sha256: HASH, metadata_snapshot: '{}', metadata_sha256: SHA, captured_at: NOW, created_at: NOW });
  };
  add(); add('other', 'other-owner');
  for (const definition of [...JOB_DELETION_SCHEMA_GUARDS, ...draftComplianceDeletionGuardDefinitions, ...draftWorkPackDeletionGuardDefinitions]) {
    sql.exec(`DROP TRIGGER IF EXISTS ${definition.name}`); sql.exec(definition.sql);
  }
  const db = { prepare(query) { return { bind(...values) { return { query, values }; } }; } };
  // Named SQL operands avoid repeated positional bindings inside the predicate.
  const isBlocked = () => Boolean(sql.prepare(`WITH target(job,owner) AS (VALUES ('job','owner')) SELECT (${retainedDraftComplianceBlockerSql('(SELECT job FROM target)', '(SELECT owner FROM target)')}) blocked`).get().blocked);
  const permit = (owner = 'owner', revision = 5) => {
    sql.exec("UPDATE trade_work_orders SET revision=5 WHERE id='job'");
    insert('trade_crm_write_guards', { id: 'delete-permit', firebase_uid: owner, operation_id: `job-delete:job:${revision}`, step_number: 1, verified: 1, created_at: NOW });
  };
  const cascade = (before = () => {}) => {
    sql.exec('BEGIN');
    try { permit(); before(); for (const s of draftComplianceDeletionStatements(db, 'job', 'owner')) sql.prepare(s.query).run(...s.values); sql.exec("DELETE FROM trade_work_order_compliance_intents WHERE work_order_id='job'; DELETE FROM trade_crm_write_guards WHERE id='delete-permit'; DELETE FROM trade_crm_job_details WHERE work_order_id='job'; DELETE FROM trade_work_orders WHERE id='job'; COMMIT"); }
    catch (e) { sql.exec('ROLLBACK'); throw e; }
  };
  return { sql, insert, isBlocked, cascade, permit };
}

test('auto-created partial case and workpack revisions cascade, preserving other owner and staging all files', t => {
  const f = fixture(t); assert.equal(f.isBlocked(), false); f.cascade();
  for (const table of ['compliance_cases', 'compliance_case_events', 'compliance_case_evidence', 'compliance_evidence_integrity_receipts', 'compliance_manual_policy_composition_locks', 'compliance_activity_work_pack_instances', 'compliance_activity_work_pack_artifacts', 'compliance_activity_work_pack_browser_upload_receipts']) {
    const ids = f.sql.prepare(`SELECT id FROM ${table}`).all().map(r => r.id); assert.ok(ids.length, table); assert.ok(ids.every(id => id.startsWith('other-')), table);
  }
  assert.deepEqual(f.sql.prepare('SELECT object_key FROM trade_crm_job_media_cleanup ORDER BY object_key').all().map(r => r.object_key), ['job/artifact.jpg', 'job/evidence.jpg']);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_crm_write_guards').get().n, 0);
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(), []);
});

test('ordinary delete, other owner permit and stale revision permit remain blocked', t => {
  const f = fixture(t);
  for (const [table, id] of [['compliance_cases', 'job-case'], ['compliance_case_events', 'job-event'], ['compliance_case_evidence', 'job-evidence'], ['compliance_evidence_integrity_receipts', 'job-integrity'], ['compliance_manual_policy_composition_locks', 'job-lock'], ['compliance_activity_work_pack_instances', 'job-pack-2'], ['compliance_activity_work_pack_artifacts', 'job-artifact'], ['compliance_activity_work_pack_browser_upload_receipts', 'job-upload']]) {
    assert.throws(() => f.sql.prepare(`DELETE FROM ${table} WHERE id=?`).run(id), /deleted|append-only|DELETE/);
  }
  f.permit('other-owner'); assert.throws(() => f.sql.exec("DELETE FROM compliance_cases WHERE id='job-case'"), /cannot be deleted/);
  f.sql.exec('DELETE FROM trade_crm_write_guards'); f.permit('owner', 4); assert.throws(() => f.sql.exec("DELETE FROM compliance_cases WHERE id='job-case'"), /cannot be deleted/);
});

for (const [label, mutate] of [
  ['submitted case', f => f.sql.exec("UPDATE compliance_cases SET status='submitted' WHERE id='job-case'")],
  ['completed evidence', f => f.sql.exec("UPDATE compliance_cases SET evidence_status='complete' WHERE id='job-case'")],
  ['completed workpack revision', f => f.sql.exec("UPDATE compliance_activity_work_pack_instances SET status='completed' WHERE id='job-pack-1'")],
  ['ready-to-sign workpack', f => f.sql.exec("UPDATE compliance_activity_work_pack_instances SET status='ready_to_sign' WHERE id='job-pack-2'")],
  ['reviewed evidence', f => f.sql.exec("UPDATE compliance_case_evidence SET status='accepted',reviewed_by_uid='reviewer',reviewed_at='2026-09-10' WHERE id='job-evidence'")],
  ['legal hold', f => f.sql.exec("UPDATE compliance_case_evidence SET legal_hold=1 WHERE id='job-evidence'")],
  ['signature upload', f => f.sql.exec("UPDATE compliance_activity_work_pack_browser_upload_receipts SET purpose='signature',artifact_kind='' WHERE id='job-upload'")],
  ['finalised response', f => f.sql.exec("UPDATE compliance_activity_work_pack_instances SET response_snapshot=json_set(response_snapshot,'$.finalisation',json('{}')) WHERE id='job-pack-2'")],
  ['missing finalisation state', f => f.sql.exec("UPDATE compliance_activity_work_pack_instances SET response_snapshot=json_remove(response_snapshot,'$.finalisation') WHERE id='job-pack-2'")],
  ['manual case without planned intent', f => f.sql.exec("UPDATE compliance_cases SET compliance_intent_id='' WHERE id='job-case'")],
  ['audit record', f => f.insert('compliance_audit_events', { id: 'audit', organisation_id: 'org', actor_type: 'compliance', actor_uid: 'auditor', event_type: 'case.viewed', target_type: 'case', target_id: 'job-case', summary: 'Audited', metadata: '{}', created_at: NOW })],
  ['recorded decision', f => f.insert('compliance_case_decisions', { id: 'decision', organisation_id: 'org', case_id: 'job-case', case_revision: 1, decision_type: 'evidence_complete', outcome: 'approved', basis_snapshot: '{}', primary_reviewer_uid: 'reviewer', decided_at: NOW, created_at: NOW })],
]) test(`${label} blocks preflight and rolls back an in-transaction race`, t => {
  const f = fixture(t); mutate(f); assert.equal(f.isBlocked(), true);
  assert.throws(() => f.cascade(), /deleted|append-only|DELETE/);
  assert.equal(f.sql.prepare("SELECT revision FROM trade_work_orders WHERE id='job'").get().revision, 4);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM compliance_activity_work_pack_artifacts WHERE id='job-artifact'").get().n, 1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_crm_job_media_cleanup').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_crm_write_guards').get().n, 0);
});

test('progression after a passing preflight rolls back all staged deletion work', t => {
  const f = fixture(t); assert.equal(f.isBlocked(), false);
  assert.throws(() => f.cascade(() => f.sql.exec("UPDATE compliance_cases SET status='submitted' WHERE id='job-case'")), /DELETE/);
  assert.equal(f.sql.prepare("SELECT status FROM compliance_cases WHERE id='job-case'").get().status, 'draft');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_crm_job_media_cleanup').get().n, 0);
});

test('exact prior case and workpack delete guards upgrade atomically and reject unknown replacements', async t => {
  const f = fixture(t);
  const definitions = [...draftComplianceDeletionGuardDefinitions, ...draftWorkPackDeletionGuardDefinitions];
  for (const d of definitions) { f.sql.exec(`DROP TRIGGER ${d.name}`); f.sql.exec(d.legacySql); }
  const batches = [];
  const db = { prepare(query) { return { query, async all() { return { results: f.sql.prepare(query).all() }; } }; }, async batch(statements) {
    batches.push(statements); f.sql.exec('BEGIN');
    try { for (const s of statements) f.sql.exec(s.query); f.sql.exec('COMMIT'); } catch (error) { f.sql.exec('ROLLBACK'); throw error; }
  } };
  await upgradeJobDeletionGuards(db, definitions, canonicalCreditexWorkPackSchemaGuardSql);
  assert.equal(batches.length, 1); assert.equal(batches[0].length, definitions.length * 2);
  assert.equal(f.isBlocked(), false); f.cascade();
  f.sql.exec("DROP TRIGGER compliance_cases_no_delete; CREATE TRIGGER compliance_cases_no_delete BEFORE DELETE ON compliance_cases BEGIN SELECT RAISE(ABORT,'unknown policy'); END;");
  await assert.rejects(() => upgradeJobDeletionGuards(db, definitions, canonicalCreditexWorkPackSchemaGuardSql), /JOB_DELETION_SCHEMA_GUARD_MISMATCH:compliance_cases_no_delete/);
});

function partialDependencies(f) {
  f.insert('compliance_equipment_records', { id: 'job-product', organisation_id: 'org', case_id: 'job-case', record_type: 'installed', status: 'installed', recorded_by_uid: 'owner', recorded_at: NOW, created_at: NOW, updated_at: NOW });
  f.insert('compliance_calculation_runs', { id: 'job-calculation', organisation_id: 'org', case_id: 'job-case', case_revision: 1, calculator_version_id: 'calculator', input_snapshot: '{}', output_snapshot: '{}', status: 'calculated', run_by_uid: 'owner', run_at: NOW, created_at: NOW });
  f.sql.exec(`UPDATE compliance_activity_work_pack_instances SET response_snapshot=json_set(response_snapshot,
    '$.response.dependencyResolutions.product', json('{"status":"resolved","referenceIds":["job-product"]}'),
    '$.response.dependencyResolutions.calculation', json('{"status":"blocked","referenceIds":["job-calculation"]}')) WHERE id='job-pack-2'`);
}

test('partial form product selection and unreviewed calculation are deleted with their draft', t => {
  const f = fixture(t); partialDependencies(f); assert.equal(f.isBlocked(), false); f.cascade();
  assert.equal(f.sql.prepare('SELECT count(*) n FROM compliance_equipment_records').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM compliance_calculation_runs').get().n, 0);
});

test('reviewed calculation or unrelated equipment cannot be removed as a partial form answer', t => {
  const f = fixture(t); partialDependencies(f);
  f.sql.exec("UPDATE compliance_calculation_runs SET status='verified',verified_by_uid='reviewer',verified_at='2026-09-10' WHERE id='job-calculation'");
  assert.equal(f.isBlocked(), true); assert.throws(() => f.cascade(), /DELETE/);
  f.sql.exec("UPDATE compliance_calculation_runs SET status='calculated',verified_by_uid='',verified_at='' WHERE id='job-calculation'; UPDATE compliance_activity_work_pack_instances SET response_snapshot=json_remove(response_snapshot,'$.response.dependencyResolutions.product') WHERE id='job-pack-2'");
  assert.equal(f.isBlocked(), true); assert.throws(() => f.cascade(), /DELETE/);
});
