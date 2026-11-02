import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { rentalAssessmentTemplateSnapshot } from '../src/lib/trade-rental-assessment.mjs';
import * as actorGuards from '../src/lib/trade-message-media-access.ts';
import * as accountPredicates from '../src/lib/trade-account-predicates.ts';
import * as assessment from '../src/lib/trade-rental-assessment.mjs';
import * as quotation from '../src/lib/rental-quotation.mjs';
import * as workflow from '../src/lib/rental-assessor-workflow.mjs';
import * as evidence from '../src/lib/trade-rental-evidence.mjs';
import { mfaErrorResponse } from './helpers/admin-response-fixture.mjs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compiled = ts.transpileModule(read('src/lib/trade-rental-correction-drafts.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleRecord = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === './trade-message-media-access') return actorGuards;
  if (name === './trade-account-predicates') return accountPredicates;
  assert.equal(name, './trade-rental-correction-schema-guards');
  return { ensureRentalCorrectionSchemaGuards: async () => {} };
}, moduleRecord, moduleRecord.exports);
const api = moduleRecord.exports;
const now = '2026-11-03T00:00:00.000Z';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,assignee_member_id TEXT,record_status TEXT,stage TEXT,revision INTEGER);
    CREATE TABLE trade_team_members(id TEXT,owner_uid TEXT,member_uid TEXT,status TEXT,can_manage_field_evidence INTEGER,can_view_field_evidence INTEGER,can_run_reports INTEGER);
    CREATE TABLE trade_accounts(firebase_uid TEXT,partner_type TEXT,account_status TEXT,verification_status TEXT,abn TEXT,verified_abn TEXT,verification_review_id TEXT,verification_reviewed_at TEXT,verification_reviewed_by_uid TEXT,business_name TEXT);
    CREATE TABLE trade_account_verification_reviews(id TEXT,firebase_uid TEXT,abn TEXT,business_name TEXT,partner_type TEXT,decision TEXT,review_method TEXT,reviewed_by_uid TEXT,reviewed_at TEXT);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_crm_job_media(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT);
    CREATE TABLE trade_crm_write_guards(id TEXT,firebase_uid TEXT,operation_id TEXT,step_number INTEGER,verified INTEGER CHECK(verified=1),created_at TEXT);
    INSERT INTO trade_work_orders VALUES('job','owner','worker','active','completed',9);
    INSERT INTO trade_team_members VALUES('worker','owner','worker-user','active',1,1,1);
    INSERT INTO trade_accounts VALUES('owner','installer','active','approved','53004085616','53004085616','review','2026-11-01','admin','Applied Test');
    INSERT INTO trade_account_verification_reviews VALUES('review','owner','53004085616','Applied Test','installer','approved','official_abr_lookup','admin','2026-11-01');
    INSERT INTO trade_crm_job_media VALUES('media','job','owner');`);
  for (const statement of read('drizzle/0160_trade_rental_inspections.sql').split('--> statement-breakpoint')) {
    if (/^\s*CREATE TABLE `trade_rental_/.test(statement)) sql.exec(statement);
  }
  for (const statement of read('drizzle/0161_trade_field_access_and_rental_scope.sql').split('--> statement-breakpoint')) {
    if (/^\s*ALTER TABLE `trade_rental_/.test(statement)) sql.exec(statement);
  }
  sql.exec(read('drizzle/0171_trade_rental_assessment_scope.sql'));
  sql.exec(read('drizzle/0263_trade_rental_report_corrections.sql'));
  sql.exec("ALTER TABLE trade_work_orders ADD COLUMN updated_at TEXT DEFAULT 'before'");
  for (const column of ['file_name TEXT', 'content_type TEXT', 'size_bytes INTEGER', 'evidence_envelope TEXT', 'created_at TEXT']) sql.exec(`ALTER TABLE trade_crm_job_media ADD COLUMN ${column}`);
  sql.exec("UPDATE trade_crm_job_media SET file_name='original.jpg',content_type='image/jpeg',size_bytes=10,evidence_envelope='{}',created_at='2026-11-03T00:00:00.000Z'");
  const put = (table, row) => sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  put('trade_rental_inspections', { id: 'inspection', work_order_id: 'job', firebase_uid: 'owner', inspection_number: 'RMS-TEST', status: 'issued',
    template_key: 'vic-rental-minimum-standards', template_version: 1, rules_effective_from: '2026-06-30', module_selection_snapshot: '["minimum_standards"]',
    selected_modules_snapshot: '["minimum_standards"]', assessor_member_id: 'worker', issued_report_id: 'report', issued_at: now, created_by_uid: 'worker-user', created_at: now, updated_at: now });
  const snapshot = JSON.stringify({ schemaVersion: 'tlink-rental-report-v1', report: { id: 'report', revision: 1 } });
  put('trade_rental_reports', { id: 'report', inspection_id: 'inspection', firebase_uid: 'owner', report_number: 'RMS-TEST-R1', revision: 1, status: 'issued',
    report_snapshot: snapshot, source_snapshot_sha256: createHash('sha256').update(snapshot).digest('hex'), pdf_object_key: 'original.pdf', pdf_sha256: 'a'.repeat(64), pdf_size_bytes: 10,
    issued_by_uid: 'worker-user', issued_by_member_id: 'worker', staged_at: now, issued_at: now, created_at: now, updated_at: now });
  put('trade_rental_inspection_modules', { id: 'module', inspection_id: 'inspection', firebase_uid: 'owner', module_key: 'minimum_standards', required: 1, selected_required: 1,
    status: 'complete', template_version: 1, template_name: 'Full assessment', required_capability: 'assigned_assessor', template_snapshot: JSON.stringify(rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards),
    answers: '{"coverageConfirmed":true,"assessorDeclaration":true,"credentialConfirmed":true,"occupancy":"vacant"}', credential_snapshot: '{"originalSignature":true}',
    completed_by_uid: 'worker-user', completed_at: now, created_at: now, updated_at: now });
  put('trade_rental_inspection_items', { id: 'item', inspection_id: 'inspection', module_id: 'module', firebase_uid: 'owner', item_key: 'minimum_standards:bathroom:bathroom_facilities:property',
    section_key: 'bathroom', check_key: 'bathroom_facilities', instance_key: 'property', outcome: 'meets', public_notes: 'Original recorded answer', created_at: now, updated_at: now });
  put('trade_rental_evidence_links', { id: 'evidence', inspection_id: 'inspection', module_id: 'module', item_id: 'item', job_media_id: 'media', firebase_uid: 'owner',
    requirement_key: 'minimum_standards:bathroom:bathroom_facilities:property', evidence_type: 'photo', created_by_uid: 'worker-user', created_at: now, updated_at: now });
  let beforeBatch;
  const statement = (query, values = []) => ({ bind: (...next) => statement(query, next),
    first: async () => sql.prepare(query).get(...values) || null, all: async () => ({ results: sql.prepare(query).all(...values) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...values).changes) } }) });
  const db = { prepare: statement, async batch(statements) { beforeBatch?.(); beforeBatch = undefined; sql.exec('BEGIN');
    try { const result = []; for (const entry of statements) result.push(await entry.run()); sql.exec('COMMIT'); return result; }
    catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  const context = { workOrderId: 'job', job: sql.prepare('SELECT * FROM trade_work_orders').get(), inspection: sql.prepare('SELECT * FROM trade_rental_inspections').get(),
    access: { ownerUid: 'owner', actorUid: 'worker-user', memberId: 'worker', canManageFieldEvidence: true, canRunReports: true } };
  const begin = (overrides = {}) => api.beginRentalCorrection(db, context, { reportId: 'report', expectedRevision: 1, reason: 'Correct recorded answers', ...overrides });
  return { sql, db, context, begin, beforeBatch(callback) { beforeBatch = callback; } };
}

function routeFor(f) {
  const dependencies = {
    'cloudflare:workers': { waitUntil(promise) { void promise.catch(() => {}); } },
    '../../../../db': { getD1: () => f.db },
    '@/lib/admin-job-read-access': { requireAdminJobReadAccess: async () => null },
    '@/lib/trade-form-job-progress': { reconcileTradeFormJobProgress: async () => { throw new Error('A correction must preserve the original completed job stage'); } },
    '@/lib/admin-server': { mfaErrorResponse, sameOrigin: () => true, cleanAdminText: (value, max) => String(value ?? '').trim().slice(0, max), adminJson: (body, status = 200) => Response.json(body, { status }) },
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => ({ ...f.context.access, canViewFieldEvidence: true }),
      assignedJob: async (access, id) => { const row = f.sql.prepare('SELECT * FROM trade_work_orders WHERE id=? AND firebase_uid=?').get(id, access.ownerUid); if (!row) throw new Error('JOB_NOT_FOUND'); return row; } },
    '@/lib/trade-team-sync-server': { nextJobRevision: revision => Number(revision) + 1, jobSyncChangeStatements: () => [],
      guardedOnlineJobMutationBatch: async (_db, statements, expected) => { await f.db.batch(statements); assert.equal(f.sql.prepare('SELECT revision FROM trade_work_orders').get().revision, expected.jobRevision); } },
    '@/lib/trade-rental-assessment.mjs': assessment, '@/lib/rental-quotation.mjs': quotation, '@/lib/rental-assessor-workflow.mjs': workflow,
    '@/lib/trade-rental-evidence.mjs': evidence,
    '@/lib/trade-rental-credentials': { rentalModuleProfileAnswers: async () => ({}), currentRentalModuleCredentialSnapshot: async args => ({ verificationBasis: 'assigned_team_member', gate: 'assigned_assessor', assessorMemberId: args.assessorMemberId, confirmedAt: args.confirmedAt }) },
    '@/lib/trade-rental-schema-guards': { ensureTradeRentalSchemaGuards: async () => {} },
    '@/lib/trade-rental-correction-drafts': api,
    '@/lib/bounded-json-request': { BoundedJsonRequestError: class extends Error {}, readBoundedJsonRequest: request => request.json() },
    '@/lib/trade-rental-report-server': { ownerRentalReportPresentation: async () => f.sql.prepare('SELECT id,report_number reportNumber,revision,status FROM trade_rental_reports ORDER BY revision DESC').all() },
    '@/lib/trade-rental-report-email-server': { rentalReportDeliveryRecipient: async () => null, rentalReportDeliveryState: async () => null, rentalReportDeliveryReview: async () => null },
  };
  const record = { exports: {} };
  const output = ts.transpileModule(read('src/app/api/trade-rental-inspections/route.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', output)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, record, record.exports);
  return { get: () => record.exports.GET(new Request('https://test/api/trade-rental-inspections?workOrderId=job')),
    post: body => record.exports.POST(new Request('https://test/api/trade-rental-inspections', { method: 'POST', body: JSON.stringify({ workOrderId: 'job', ...body }) })) };
}

test('issued report corrections clone frozen assessment answers and evidence without changing any original record', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  const originals = ['trade_rental_inspections', 'trade_rental_reports', 'trade_rental_inspection_modules', 'trade_rental_inspection_items', 'trade_rental_evidence_links'];
  const before = originals.map(table => f.sql.prepare(`SELECT * FROM ${table}`).all());
  const header = await f.begin();
  assert.equal(header.source_inspection_id, 'inspection'); assert.equal(header.source_report_id, 'report'); assert.equal(header.source_report_sha256, 'a'.repeat(64));
  assert.equal(header.status, 'in_progress'); assert.equal(header.issued_report_id, '');
  const clonedModule = f.sql.prepare('SELECT * FROM trade_rental_correction_modules').get();
  const clonedItem = f.sql.prepare('SELECT * FROM trade_rental_correction_items').get();
  const clonedEvidence = f.sql.prepare('SELECT * FROM trade_rental_correction_evidence_links').get();
  assert.notEqual(clonedModule.id, 'module'); assert.notEqual(clonedItem.id, 'item');
  assert.equal(clonedItem.module_id, clonedModule.id); assert.equal(clonedEvidence.item_id, clonedItem.id); assert.equal(clonedEvidence.job_media_id, 'media');
  assert.equal(clonedModule.status, 'draft'); assert.equal(clonedModule.completed_at, ''); assert.deepEqual(JSON.parse(clonedModule.credential_snapshot), {});
  assert.deepEqual(JSON.parse(clonedModule.answers), { occupancy: 'vacant' }); assert.equal(clonedItem.public_notes, 'Original recorded answer');
  assert.deepEqual(originals.map(table => f.sql.prepare(`SELECT * FROM ${table}`).all()), before);
  assert.equal((await api.latestRentalCorrection(f.db, 'owner', 'job')).id, header.id);
  assert.equal(await api.latestRentalCorrection(f.db, 'other', 'job'), null);
  await assert.rejects(f.begin(), /RENTAL_MUTATION_CONFLICT/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_rental_corrections').get().n, 1);
});

test('correction start rejects stale revisions, another assessor, invalid source snapshots and current access races atomically', async t => {
  for (const scenario of ['stale', 'assessor', 'snapshot', 'revision-race', 'permission-race', 'identity-race', 'account-race', 'session-race']) {
    const f = fixture(); t.after(() => f.sql.close());
    if (scenario === 'assessor') f.context.access.memberId = 'other';
    if (scenario === 'snapshot') f.sql.exec("UPDATE trade_rental_reports SET source_snapshot_sha256='" + 'b'.repeat(64) + "'");
    if (scenario === 'revision-race') f.beforeBatch(() => f.sql.exec('UPDATE trade_work_orders SET revision=10'));
    if (scenario === 'permission-race') f.beforeBatch(() => f.sql.exec('UPDATE trade_team_members SET can_run_reports=0'));
    if (scenario === 'identity-race') f.beforeBatch(() => f.sql.exec("UPDATE trade_team_members SET member_uid='reassigned-user'"));
    if (scenario === 'account-race') f.beforeBatch(() => f.sql.exec("UPDATE trade_accounts SET account_status='suspended'"));
    if (scenario === 'session-race') {
      f.context.access.fieldSessionId = 'session'; f.context.access.actorUid = 'field-member:worker';
      f.sql.exec("INSERT INTO trade_field_sessions VALUES('session','owner','worker','active','2099-01-01')");
      f.beforeBatch(() => f.sql.exec("UPDATE trade_field_sessions SET status='revoked'"));
    }
    await assert.rejects(f.begin(scenario === 'stale' ? { expectedRevision: 2 } : {}), undefined, scenario);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_rental_corrections').get().n, 0, scenario);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_rental_correction_modules').get().n, 0, scenario);
    assert.equal(f.sql.prepare('SELECT status FROM trade_rental_inspections').get().status, 'issued');
  }
});

test('a general draft preserves the latest frozen controlled answer correction instead of restoring its older source answer', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  f.sql.exec(`UPDATE trade_rental_inspection_items SET section_key='cooling',check_key='cooling_2027_readiness',
    response_json='{"applianceType":"No fixed cooling","accessStatus":"Not accessed"}'`);
  const snapshot = { schemaVersion: 'tlink-rental-report-v1', report: { id: 'report', revision: 1,
    answerCorrection: { field: 'accessStatus', checkKey: 'cooling_2027_readiness', itemId: 'public-cooling', fromValue: 'Not accessed', toValue: 'Clear access' } },
    modules: [{ key: 'minimum_standards', sections: [{ key: 'cooling', items: [{ id: 'public-cooling', checkKey: 'cooling_2027_readiness', instanceKey: 'property', response: { accessStatus: 'Clear access' } }] }] }] };
  const json = JSON.stringify(snapshot);
  f.sql.prepare('UPDATE trade_rental_reports SET report_snapshot=?,source_snapshot_sha256=?').run(json, createHash('sha256').update(json).digest('hex'));
  await f.begin();
  assert.equal(JSON.parse(f.sql.prepare('SELECT response_json FROM trade_rental_correction_items').get().response_json).accessStatus, 'Clear access');
  assert.equal(JSON.parse(f.sql.prepare('SELECT response_json FROM trade_rental_inspection_items').get().response_json).accessStatus, 'Not accessed');
});

test('a second general correction inherits the preceding issued correction rather than the original answers', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  const first = await f.begin();
  f.sql.prepare("UPDATE trade_rental_correction_items SET public_notes='First corrected answer' WHERE inspection_id=?").run(first.id);
  f.sql.exec(`UPDATE trade_rental_correction_modules SET status='complete',completed_by_uid='worker-user',completed_at='${now}'`);
  const report = f.sql.prepare("SELECT * FROM trade_rental_reports WHERE id='report'").get();
  const snapshot = JSON.stringify({ schemaVersion: 'tlink-rental-report-v1', report: { id: 'report-2', revision: 2, assessmentCorrection: { correctionId: first.id } } });
  const secondReport = { ...report, id: 'report-2', revision: 2, report_number: 'RMS-TEST-R2', report_snapshot: snapshot,
    source_snapshot_sha256: createHash('sha256').update(snapshot).digest('hex'), pdf_object_key: 'corrected.pdf', pdf_sha256: 'b'.repeat(64) };
  f.sql.prepare(`INSERT INTO trade_rental_reports(${Object.keys(secondReport).join(',')}) VALUES(${Object.keys(secondReport).map(() => '?').join(',')})`).run(...Object.values(secondReport));
  f.sql.prepare("UPDATE trade_rental_corrections SET status='issued',issued_report_id='report-2',issued_at=?,revision=3 WHERE id=?").run(now, first.id);
  const context = { ...f.context, correction: true, inspection: f.sql.prepare('SELECT * FROM trade_rental_corrections WHERE id=?').get(first.id) };
  const second = await api.beginRentalCorrection(f.db, context, { reportId: 'report-2', expectedRevision: 3, reason: 'Second correction' });
  assert.equal(second.source_report_id, 'report-2');
  assert.equal(f.sql.prepare('SELECT public_notes FROM trade_rental_correction_items WHERE inspection_id=?').get(second.id).public_notes, 'First corrected answer');
  assert.equal(f.sql.prepare('SELECT public_notes FROM trade_rental_inspection_items').get().public_notes, 'Original recorded answer');
});

test('discard retains correction history and returns to issued reports even when a later source version prevents reissue', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  const header = await f.begin(); const context = { ...f.context, correction: true, inspection: header };
  const newer = { ...f.sql.prepare('SELECT * FROM trade_rental_reports').get(), id: 'later-report', revision: 2, report_number: 'RMS-TEST-R2' };
  f.sql.prepare(`INSERT INTO trade_rental_reports(${Object.keys(newer).join(',')}) VALUES(${Object.keys(newer).map(() => '?').join(',')})`).run(...Object.values(newer));
  const source = f.sql.prepare('SELECT * FROM trade_rental_reports').all();
  await assert.rejects(api.discardRentalCorrection(f.db, context, 2), /RENTAL_MUTATION_CONFLICT/);
  await api.discardRentalCorrection(f.db, context, 1);
  const discarded = f.sql.prepare('SELECT * FROM trade_rental_corrections').get();
  assert.equal(discarded.status, 'withdrawn'); assert.equal(discarded.revision, 2);
  assert.equal(await api.latestRentalCorrection(f.db, 'owner', 'job'), null);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_rental_correction_items').get().n, 1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM trade_rental_correction_events WHERE event_type='correction_discarded'").get().n, 1);
  assert.deepEqual(f.sql.prepare('SELECT * FROM trade_rental_reports').all(), source);
  await assert.rejects(api.discardRentalCorrection(f.db, { ...context, inspection: { ...header, status: 'issued' } }, 1), /RENTAL_INSPECTION_LOCKED/);
});

test('the correction API edits cloned answers on the same completed job, retains the issued original and discards without deleting history', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  const route = routeFor(f);
  const opened = await route.post({ action: 'begin_report_correction', reportId: 'report', expectedInspectionRevision: 1 });
  assert.equal(opened.status, 200, JSON.stringify(await opened.clone().json()));
  const result = await opened.json(); const assessmentModule = result.modules[0], item = result.items[0];
  assert.equal(result.permissions.canEdit, true); assert.equal(result.correction.sourceReportId, 'report');
  const saved = await route.post({ action: 'save_item', moduleId: assessmentModule.id, expectedModuleRevision: assessmentModule.revision, expectedItemRevision: item.revision,
    sectionKey: item.sectionKey, checkKey: item.checkKey, instanceKey: item.instanceKey, outcome: 'meets', response: {}, publicNotes: 'Corrected observation' });
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const latest = await saved.json(); assert.equal(latest.items[0].publicNotes, 'Corrected observation');
  assert.equal(f.sql.prepare('SELECT public_notes FROM trade_rental_inspection_items').get().public_notes, 'Original recorded answer');
  assert.equal(f.sql.prepare('SELECT stage FROM trade_work_orders').get().stage, 'completed');
  assert.equal((await route.post({ action: 'save_item', moduleId: assessmentModule.id, expectedModuleRevision: assessmentModule.revision, expectedItemRevision: item.revision,
    sectionKey: item.sectionKey, checkKey: item.checkKey, outcome: 'meets' })).status, 409);
  const discarded = await route.post({ action: 'discard_report_correction', expectedInspectionRevision: latest.inspection.revision });
  assert.equal(discarded.status, 200, JSON.stringify(await discarded.clone().json()));
  const original = await discarded.json(); assert.equal(original.correction, null); assert.equal(original.inspection.issuedReportId, 'report');
  assert.equal(f.sql.prepare('SELECT public_notes FROM trade_rental_correction_items').get().public_notes, 'Corrected observation');
  assert.equal(f.sql.prepare('SELECT pdf_object_key FROM trade_rental_reports').get().pdf_object_key, 'original.pdf');
});

test('correction editing requires the assigned assessor current report permission before exposing editable answers', async t => {
  for (const accessPatch of [{ canRunReports: false }, { memberId: 'another-assessor' }]) {
    const f = fixture(); t.after(() => f.sql.close());
    const header = await f.begin();
    Object.assign(f.context.access, accessPatch);
    const route = routeFor(f);
    const current = await route.get();
    assert.equal(current.status, 200, JSON.stringify(await current.clone().json()));
    const result = await current.json();
    assert.equal(result.permissions.canEdit, false);
    const assessmentModule = result.modules[0];
    const before = f.sql.prepare('SELECT * FROM trade_rental_correction_modules').all();
    const saved = await route.post({ action: 'save_module_answers', moduleId: assessmentModule.id,
      expectedRevision: assessmentModule.revision, answers: { assessorDeclaration: true } });
    assert.equal(saved.status, 403, JSON.stringify(await saved.clone().json()));
    assert.deepEqual(f.sql.prepare('SELECT * FROM trade_rental_correction_modules').all(), before);
    assert.equal(f.sql.prepare('SELECT revision FROM trade_rental_corrections WHERE id=?').get(header.id).revision, 1);
  }
});

test('correction save, metadata, reopen and completion transactions recheck account, session and permission races', async t => {
  for (const action of ['save_item', 'save_module_answers', 'reopen_module', 'complete_module']) {
    for (const race of ['account', 'session', 'permission']) {
      const f = fixture(); t.after(() => f.sql.close());
      const header = await f.begin();
      const assessmentModule = f.sql.prepare('SELECT * FROM trade_rental_correction_modules').get();
      const item = f.sql.prepare('SELECT * FROM trade_rental_correction_items').get();
      const simple = { key: 'minimum_standards', credentialGate: 'assigned_assessor', templateVersion: 1, metadataFields: [{ key: 'assessorDeclaration', type: 'checkbox', required: true }],
        sections: [{ key: 'bathroom', title: 'Bathroom', checks: [{ key: 'bathroom_facilities', required: true, prompt: 'Bathroom facilities', repeatBy: 'property', requiredEvidenceCount: 0 }] }] };
      f.sql.prepare('UPDATE trade_rental_correction_modules SET template_snapshot=?,answers=?').run(JSON.stringify(simple), '{"assessorDeclaration":true}');
      if (action === 'reopen_module') f.sql.prepare("UPDATE trade_rental_correction_modules SET status='complete',completed_by_uid='worker-user',completed_at=?").run(now);
      f.context.access.fieldSessionId = 'session'; f.context.access.actorUid = 'field-member:worker';
      f.sql.exec("INSERT INTO trade_field_sessions VALUES('session','owner','worker','active','2099-01-01')");
      const before = f.sql.prepare('SELECT * FROM trade_rental_correction_modules').all();
      f.beforeBatch(() => f.sql.exec(race === 'account' ? "UPDATE trade_accounts SET account_status='suspended'" : race === 'session'
        ? "UPDATE trade_field_sessions SET status='revoked'" : 'UPDATE trade_team_members SET can_manage_field_evidence=0'));
      const body = action === 'save_item' ? { action, moduleId: assessmentModule.id, expectedModuleRevision: 1, expectedItemRevision: 1,
        sectionKey: item.section_key, checkKey: item.check_key, instanceKey: item.instance_key, outcome: 'meets', response: {}, publicNotes: 'Changed' }
        : { action, moduleId: assessmentModule.id, expectedRevision: 1, answers: { assessorDeclaration: true } };
      const response = await routeFor(f).post(body);
      assert.equal(response.status, 409, `${action}/${race}: ${JSON.stringify(await response.clone().json())}`);
      assert.deepEqual(f.sql.prepare('SELECT * FROM trade_rental_correction_modules').all(), before, `${action}/${race}`);
      assert.equal(f.sql.prepare('SELECT revision FROM trade_rental_corrections WHERE id=?').get(header.id).revision, 1);
      assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_rental_correction_events').get().n, 1);
    }
  }
});
