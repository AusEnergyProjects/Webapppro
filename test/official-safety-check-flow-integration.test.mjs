import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as pdfLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { migratedDataforceSqlite } from './helpers/trade-dataforce-database.mjs';
import { certificateTestDependency } from './helpers/creditex-training-fixture.mjs';
import * as activity from '../src/lib/trade-activity-forms.ts';
import * as flow from '../src/lib/trade-activity-form-flow.ts';
import * as forms from '../src/lib/official-safety-check-forms.ts';
import * as membership from '../src/lib/trade-job-collaboration.ts';
import * as actorGuard from '../src/lib/trade-message-media-access.ts';
import * as onboarding from '../src/lib/creditex-onboarding-server.ts';
import * as completion from '../src/lib/trade-activity-forms-completion.ts';
import * as schemaGuards from '../src/lib/tlink-schema-guards.ts';
import * as predicates from '../src/lib/trade-account-predicates.ts';
import * as photos from '../src/lib/trade-photo-requests.ts';
import * as photoReview from '../src/lib/photo-request-review.ts';
import * as reminder from '../src/lib/service-reminder-delivery.ts';
import * as emailProvider from '../src/lib/trade-email-provider.ts';
import * as integrationState from '../src/lib/trade-integration-state.ts';
import * as rentalCredentials from '../src/lib/trade-rental-credentials.ts';
import * as draftEmail from '../src/lib/safety-check-email.ts';
import { rentalImageWithinReportLimit } from '../src/lib/trade-rental-image-dimensions.mjs';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url));
const compiled = new Map();
function load(relative, dependencies = {}) {
  if (!compiled.has(relative)) compiled.set(relative, ts.transpileModule(read(relative).toString(), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: relative,
  }).outputText);
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', compiled.get(relative))(specifier => {
    const dependency = dependencies[specifier] ?? certificateTestDependency(specifier);
    assert.ok(dependency, `Unwired production dependency ${specifier}`); return dependency;
  }, loaded, loaded.exports);
  return loaded.exports;
}
const validatorSource = ts.createSourceFile('validator.ts', read('../src/lib/trade-activity-forms-pdf.ts').toString(), ts.ScriptTarget.Latest, true);
const records = load('../src/lib/job-safety-check.ts');
const validatorDeclaration = validatorSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'validateActivityEvidenceBytes');
const validatorCode = ts.transpileModule(validatorDeclaration.getText(validatorSource).replace('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
// Execute the authoritative byte validator. Only the external provider HTTP boundary is replaced below.
const validateActivityEvidenceBytes = new Function('PDFDocument', 'rentalImageWithinReportLimit',
  `${validatorCode}; return validateActivityEvidenceBytes;`)(pdfLib.PDFDocument, rentalImageWithinReportLimit);
const officialPdf = load('../src/lib/official-safety-check-pdf.ts', new Proxy({
  'pdf-lib': pdfLib, '@pdf-lib/fontkit': fontkit, './official-safety-check-forms': forms,
  './trade-activity-forms': activity, './trade-activity-form-flow': flow,
  './trade-activity-forms-pdf': { validateActivityEvidenceBytes },
}, { get(target, specifier) {
  if (typeof specifier === 'string' && specifier.endsWith('?inline')) {
    const file = specifier.slice(0, -7).replace('../../public/', '../public/');
    return `data:${file.endsWith('.pdf') ? 'application/pdf' : 'image/png'};base64,${read(file).toString('base64')}`;
  }
  return target[specifier];
} }));
const worker = {
  ownerUid: 'official-synthetic-owner', actorUid: 'official-synthetic-worker-uid', memberId: 'official-synthetic-worker',
  isOwner: false, displayName: 'Casey Synthetic Inspector', jobScope: 'own', canViewFieldEvidence: true, canManageFieldEvidence: true,
};
const jobId = 'official-synthetic-job';
const ink = [{ points: [{ x: .05, y: .7 }, { x: .2, y: .2 }, { x: .3, y: .8 }, { x: .6, y: .4 }, { x: .9, y: .5 }] }];
const photo = read('../public/tlink-icon-192.png');

function fixture(t) {
  const { sqlite } = migratedDataforceSqlite(); t.after(() => sqlite.close());
  const now = new Date().toISOString();
  const insert = (table, values) => {
    const keys = Object.keys(values); sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
      .run(...keys.map(key => values[key]));
  };
  insert('trade_accounts', {
    firebase_uid: worker.ownerUid, email: 'office@example.test', business_name: 'Synthetic Safety Pty Ltd',
    contact_name: worker.displayName, partner_type: 'installer', account_status: 'active', verification_status: 'approved',
    abn: '51824753556', verified_abn: '51824753556', verification_review_id: 'official-synthetic-review',
    verification_reviewed_at: now, verification_reviewed_by_uid: 'synthetic-reviewer', consent_version: 'synthetic-consent', consent_at: now,
    address_state: 'VIC', service_states: '["VIC"]', is_synthetic: 1, created_at: now, updated_at: now,
  });
  insert('trade_account_verification_reviews', {
    id: 'official-synthetic-review', firebase_uid: worker.ownerUid, abn: '51824753556', business_name: 'Synthetic Safety Pty Ltd',
    partner_type: 'installer', legal_entity_name: 'Synthetic Safety Pty Ltd', decision: 'approved', review_method: 'official_abr_lookup',
    note: 'Synthetic fixture review only.', reviewed_by_uid: 'synthetic-reviewer', reviewed_at: now,
  });
  insert('trade_team_members', {
    id: worker.memberId, owner_uid: worker.ownerUid, member_uid: worker.actorUid, email: 'worker@example.test',
    display_name: worker.displayName, role: 'member', status: 'active', can_view_field_evidence: 1, can_manage_field_evidence: 1,
    job_scope: 'own', invited_at: now, created_at: now, updated_at: now,
  });
  for (const [gate, number] of [['licensed_electrician', 'SYNTHETIC-ELEC-ONLY'], ['licensed_gasfitter', 'SYNTHETIC-GAS-ONLY']]) {
    insert('trade_team_member_files', {
      id: `synthetic-file-${gate}`, owner_uid: worker.ownerUid, team_member_id: worker.memberId, category: 'licence',
      file_name: 'synthetic-licence.png', content_type: 'image/png', size_bytes: photo.length, sha256: activity.activityHash(photo),
      object_key: `synthetic-only/${gate}`, status: 'active', uploaded_by_uid: worker.ownerUid, created_at: now, updated_at: now,
    });
    sqlite.prepare('UPDATE trade_team_member_files SET expires_at=? WHERE id=?').run('2030-12-31', `synthetic-file-${gate}`);
    insert('trade_team_member_credentials', {
      id: `synthetic-${gate}`, owner_uid: worker.ownerUid, team_member_id: worker.memberId, credential_type: 'licence',
      name: 'Synthetic licence fixture only', credential_number: number, issuer: 'Synthetic fixture', jurisdiction: 'VIC',
      expires_at: '2030-12-31', status: 'active', file_id: `synthetic-file-${gate}`, rental_gate: gate, created_at: now, updated_at: now,
    });
  }
  insert('trade_work_orders', {
    id: jobId, firebase_uid: worker.ownerUid, partner_type: 'installer', work_number: 'OFFICIAL-SYNTHETIC-001',
    title: 'Synthetic official rental safety check', source_type: 'direct', stage: 'in_progress', assignee_member_id: worker.memberId,
    record_status: 'active', created_at: now, updated_at: now,
  });
  insert('trade_crm_customers', {
    id: 'official-synthetic-customer', firebase_uid: worker.ownerUid, customer_number: 'SYNTHETIC-CUSTOMER-001',
    first_name: 'Sam', last_name: 'Synthetic Owner', email: 'customer@example.test', created_at: now, updated_at: now,
  });
  insert('trade_crm_service_sites', {
    id: 'official-synthetic-site', firebase_uid: worker.ownerUid, customer_id: 'official-synthetic-customer', address_line_1: '12 Synthetic Street',
    suburb: 'Frankston', address_state: 'VIC', postcode: '3199', created_at: now, updated_at: now,
  });
  insert('trade_crm_job_details', {
    id: 'official-synthetic-details', work_order_id: jobId, firebase_uid: worker.ownerUid,
    crm_customer_id: 'official-synthetic-customer', service_site_id: 'official-synthetic-site', customer_source: 'trade_owned',
    pipeline_stage: 'in_progress', created_at: now, updated_at: now,
  });
  let loseCommit = false, failProgressRead = false, providerMode = 'accept', beforeObjectWrite;
  const objects = new Map(), providerRequests = [];
  const queryHook = query => {
    if (failProgressRead && query.includes('SELECT current_job.id, current_job.stage')) {
      failProgressRead = false; throw new Error('SYNTHETIC_PROGRESS_READ_INTERRUPTED');
    }
  };
  const statement = (query, values = []) => ({
    bind: (...bindings) => statement(query, bindings),
    first: async () => { queryHook(query); return sqlite.prepare(query).get(...values) || null; },
    all: async () => { queryHook(query); return { success: true, results: sqlite.prepare(query).all(...values) }; },
    run: async () => { queryHook(query); return { success: true, meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }; },
  });
  const db = { prepare: statement, async batch(statements) {
    sqlite.exec('BEGIN'); let results;
    try { results = []; for (const item of statements) results.push(await item.run()); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    if (loseCommit) { loseCommit = false; throw new Error('SYNTHETIC_LOST_COMMIT_ACK'); } return results;
  } };
  const bucket = {
    async put(key, bytes, metadata) { if (beforeObjectWrite) await beforeObjectWrite(key); objects.set(key, { bytes: new Uint8Array(bytes), metadata }); },
    async get(key) { const object = objects.get(key); return object ? { arrayBuffer: async () => object.bytes.slice().buffer } : null; },
    async delete(key) { objects.delete(key); },
  };
  const runtime = { RESEND_API_KEY: 'synthetic-provider-key-only', RESEND_FROM_EMAIL: 'Synthetic TLink <test@example.test>' };
  const providerFetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails'); providerRequests.push({ body: JSON.parse(init.body), headers: init.headers });
    if (providerMode === 'reject') return Response.json({ message: 'Synthetic rejection' }, { status: 400 });
    if (providerMode === 'uncertain') throw new TypeError('Synthetic transport disconnect after dispatch');
    return Response.json({ id: `synthetic-mail-${providerRequests.length}` });
  };
  const crypto = load('../src/lib/trade-integration-crypto.ts', { 'cloudflare:workers': { env: {} }, '@/lib/trade-integration-state': integrationState });
  const email = load('../src/lib/trade-email-server.ts', {
    'cloudflare:workers': { env: {} }, '../../db': { getD1: () => db }, './trade-integration-crypto': crypto,
    './trade-access-server': predicates, './trade-email-provider': emailProvider,
    './service-reminder-delivery': { ...reminder, serviceReminderProviderConfiguration: () => reminder.serviceReminderProviderConfiguration(runtime),
      sendServiceReminderProviderMessage: message => reminder.sendServiceReminderProviderMessage(message, { runtime, fetchImpl: providerFetch }) },
  });
  const sync = load('../src/lib/trade-team-sync-server.ts', { './trade-job-collaboration.ts': membership });
  const photoServer = load('../src/lib/photo-request-review-server.ts', { '../../db': { getD1: () => db }, '@/lib/photo-request-review': photoReview });
  const progress = load('../src/lib/trade-form-job-progress.ts', {
    '../../db': { getD1: () => db }, './creditex-onboarding-server': onboarding, './trade-job-collaboration': membership,
    './trade-message-media-access': actorGuard, './trade-team-sync-server': sync, './trade-activity-forms-completion': completion,
    './photo-request-review-server': photoServer, './trade-photo-requests': photos,
  });
  const fonts = load('../src/lib/customer-plan-pdf-fonts.ts', {
    '../../public/fonts/LiberationSans-Regular.ttf?inline': `data:font/ttf;base64,${read('../public/fonts/LiberationSans-Regular.ttf').toString('base64')}`,
    '../../public/fonts/LiberationSans-Bold.ttf?inline': `data:font/ttf;base64,${read('../public/fonts/LiberationSans-Bold.ttf').toString('base64')}`,
  });
  const service = load('../src/lib/trade-safety-checks-server.ts', {
    'cloudflare:workers': { env: { EVIDENCE: bucket } }, '../../db': { getD1: () => db }, './trade-job-collaboration': membership,
    './trade-account-predicates': predicates, './trade-activity-forms': activity, './trade-activity-form-flow': flow,
    './official-safety-check-forms': forms, './job-safety-check': records,
    './trade-safety-check-schema-guards': load('../src/lib/trade-safety-check-schema-guards.ts', { './tlink-schema-guards': schemaGuards }),
    './trade-rental-credentials': rentalCredentials, './safety-check-email': draftEmail, './trade-email-server': email,
    './service-reminder-delivery': reminder, './trade-form-job-progress': progress,
    './trade-activity-forms-pdf': { validateActivityEvidenceBytes }, './official-safety-check-pdf': officialPdf,
    './customer-plan-pdf-fonts': fonts, './trade-quote-pdf-server': { async loadBrandAsset() { throw new Error('No logo requested by synthetic fixture'); } },
  });
  const state = id => ({
    job: sqlite.prepare('SELECT stage,revision FROM trade_work_orders WHERE id=?').get(jobId),
    assessment: sqlite.prepare('SELECT * FROM trade_safety_checks WHERE id=?').get(id),
    deliveries: sqlite.prepare('SELECT * FROM trade_safety_check_deliveries WHERE record_id=? ORDER BY recipient_role').all(id),
    submissions: sqlite.prepare('SELECT * FROM trade_email_submissions ORDER BY recipient_email').all(),
    events: sqlite.prepare("SELECT * FROM trade_work_order_events WHERE work_order_id=? AND event_type='job_completed'").all(jobId),
  });
  async function answersAndEvidence(kind, repeats = 1, answerPatch = {}) {
    let record = await service.startSafetyCheckRecord(worker, jobId, kind); const answers = { ...record.answers, ...answerFixture(record.form, kind, repeats), ...answerPatch };
    answers.inspector_name = worker.displayName; answers.inspector_licence = kind === 'electrical' ? 'SYNTHETIC-ELEC-ONLY' : 'SYNTHETIC-GAS-ONLY';
    record = await service.saveSafetyCheckAnswers(worker, record.id, record.revision, answers, `synthetic-answers-${kind}`);
    const support = await pdfLib.PDFDocument.create(); support.addPage(); const supportBytes = await support.save();
    for (const field of flow.expandedActivityFields(record.form, answers).filter(field => ['photo', 'document'].includes(field.type) && field.required)) {
      const bytes = field.type === 'photo' ? photo : supportBytes, contentType = field.type === 'photo' ? 'image/png' : 'application/pdf';
      record = await service.uploadSafetyCheckEvidence(worker, record.id, record.revision, field.key,
        new File([bytes], `${field.key}.${field.type === 'photo' ? 'png' : 'pdf'}`, { type: contentType }), `synthetic-file-${field.key.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    }
    return record;
  }
  async function signed(kind, repeats = 1, answerPatch = {}) {
    let record = await answersAndEvidence(kind, repeats, answerPatch);
    for (const declaration of record.form.declarations) record = await service.signSafetyCheckDeclaration(worker, record.id, record.revision, {
      declarationKey: declaration.key, signerName: worker.displayName, strokes: ink, accepted: true,
      scopeSha256: activity.activitySigningScope(record, declaration.phase),
    }, `synthetic-sign-${declaration.key}`);
    assert.equal(service.safetyCheckCompletion(record).ready, true); assert.equal(providerRequests.length, 0); return record;
  }
  return { sqlite, db, service, progress, objects, providerRequests, state, signed, answersAndEvidence, insert,
    loseCommitOnce() { loseCommit = true; }, failProgressOnce() { failProgressRead = true; }, provider(mode) { providerMode = mode; },
    onObjectWrite(callback) { beforeObjectWrite = callback; } };
}
function answerFixture(form, kind, repeats = 1) {
  const answers = { [`$repeat.${kind === 'gas' ? 'appliances' : 'circuits'}`]: repeats };
  for (const field of flow.expandedActivityFields(form, answers)) {
    if (['photo', 'document'].includes(field.type)) continue;
    answers[field.key] = field.type === 'date' ? field.key.includes('next') ? field.key.includes('smoke') ? '2027-10-13' : '2028-10-13' : '2026-10-13'
      : field.type === 'boolean' ? true : field.type === 'number' ? 1 : field.type === 'select' ? field.options[0] : `Synthetic ${field.label}`;
  }
  answers.property_address = '12 Synthetic Street, Frankston VIC 3199'; return answers;
}
async function assertCompleted(h, record, expectedJobStage = 'completed') {
  const state = h.state(record.id); assert.equal(record.status, 'complete'); assert.equal(state.assessment.status, 'complete');
  assert.equal(state.job.stage, expectedJobStage); assert.equal(state.events.length, expectedJobStage === 'completed' ? 1 : 0);
  assert.equal(state.submissions.length, 2); assert.ok(state.submissions.every(row => row.status === 'accepted'));
  assert.ok(state.deliveries.every(row => row.status === 'accepted'));
  assert.deepEqual(h.providerRequests.map(item => item.body.to).sort(), [['customer@example.test'], ['office@example.test']]);
  const final = await h.service.readSafetyCheckPdf(worker, record.id); assert.equal(activity.activityHash(final.bytes), state.assessment.pdf_sha256);
  assert.equal(final.bytes.length, state.assessment.pdf_size_bytes); const pdf = await pdfLib.PDFDocument.load(final.bytes);
  assert.ok(pdf.getPageCount() >= 2); assert.equal(pdf.getForm().getFields().length, 0);
  const credential = JSON.parse(state.assessment.credential_snapshot); assert.equal(credential.assessorMemberId, worker.memberId);
  assert.equal(credential.confirmedAt, record.completedAt); assert.equal(credential.credentialNumber, record.answers.inspector_licence);
  for (const item of h.providerRequests) {
    assert.match(item.body.html, /Synthetic Safety Pty Ltd/); assert.match(item.body.html, /TLink/);
    assert.equal(item.body.attachments.length, 1 + record.evidence.length); assert.equal(item.body.attachments[0].filename, final.fileName);
    assert.deepEqual(new Uint8Array(Buffer.from(item.body.attachments[0].content, 'base64')), final.bytes);
    for (let i = 0; i < record.evidence.length; i++) {
      const evidence = await h.service.readSafetyCheckEvidence(worker, record.id, record.evidence[i].id);
      assert.deepEqual(new Uint8Array(Buffer.from(item.body.attachments[i + 1].content, 'base64')), evidence.bytes);
    }
  }
  return { final, pages: pdf.getPageCount(), state };
}

for (const kind of ['electrical', 'gas']) test(`${kind} true phone-flow chain retains its official PDF, named ink and every separate evidence attachment, emails both copies and closes the job once`, async t => {
  const h = fixture(t), signed = await h.signed(kind), result = await h.service.completeSafetyCheckRecordWithProgress(worker, signed.id, signed.revision, 'synthetic-complete');
  const proof = await assertCompleted(h, result.record); assert.equal(result.jobProgress.stage, 'completed');
  const keys = [...h.objects.keys()], before = h.state(signed.id);
  const repeated = await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-complete');
  await h.service.retrySafetyCheckDelivery(worker, signed.id, repeated.revision);
  assert.equal(repeated.revision, result.record.revision); assert.deepEqual([...h.objects.keys()], keys);
  assert.deepEqual(h.state(signed.id).assessment, before.assessment); assert.equal(h.providerRequests.length, 2);
  assert.equal(h.state(signed.id).events.length, 1);
  const dir = process.env.SAFETY_FLOW_EVIDENCE_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `synthetic-${kind}-completed.pdf`), proof.final.bytes);
    fs.writeFileSync(path.join(dir, `${kind}-chain-proof.json`), JSON.stringify({ synthetic: true, kind, revision: result.record.revision,
      sourceSha256: signed.form.sources.map(source => source.sha256), signedDeclarations: signed.signatures.map(signature => signature.declarationKey),
      pdfSha256: proof.state.assessment.pdf_sha256, pdfBytes: proof.final.bytes.length, pdfPages: proof.pages, jobStage: proof.state.job.stage,
      jobCompletionEvents: proof.state.events.length, attachmentsPerEmail: 1 + signed.evidence.length,
      deliveries: proof.state.deliveries.map(row => ({ role: row.recipient_role, status: row.status })), requestsAfterReplay: h.providerRequests.length }, null, 2));
  }
});
test('both official assessments remain independent job requirements; the last real signed PDF closes the job', async t => {
  const h = fixture(t), electrical = await h.signed('electrical'), gas = await h.signed('gas');
  const first = await h.service.completeSafetyCheckRecordWithProgress(worker, electrical.id, electrical.revision, 'synthetic-first-complete');
  assert.equal(first.jobProgress.stage, 'in_progress'); assert.equal(h.state(electrical.id).job.stage, 'in_progress');
  assert.equal(h.state(electrical.id).events.length, 0); assert.equal(h.providerRequests.length, 2);
  const second = await h.service.completeSafetyCheckRecordWithProgress(worker, gas.id, gas.revision, 'synthetic-second-complete');
  assert.equal(second.jobProgress.stage, 'completed'); assert.equal(h.state(gas.id).events.length, 1); assert.equal(h.providerRequests.length, 4);
});
test('exact completion replay recovers a lost database commit acknowledgement without another PDF or email', async t => {
  const h = fixture(t), signed = await h.signed('gas'); h.loseCommitOnce();
  const complete = await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-lost-ack');
  await assertCompleted(h, complete); const keys = [...h.objects.keys()];
  await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-lost-ack');
  assert.deepEqual([...h.objects.keys()], keys); assert.equal(h.providerRequests.length, 2);
});
test('save and upload use exact mutation receipts and reject a request key reused with different content', async t => {
  const h = fixture(t); let record = await h.service.startSafetyCheckRecord(worker, jobId, 'electrical');
  const answers = { ...record.answers, inspection_date: '2026-10-13' }, base = record.revision; h.loseCommitOnce();
  record = await h.service.saveSafetyCheckAnswers(worker, record.id, base, answers, 'synthetic-lost-save');
  assert.equal((await h.service.saveSafetyCheckAnswers(worker, record.id, base, answers, 'synthetic-lost-save')).revision, record.revision);
  await assert.rejects(h.service.saveSafetyCheckAnswers(worker, record.id, base, { ...answers, inspection_date: '2026-10-12' }, 'synthetic-lost-save'), error => error.code === 'SAFETY_CHECK_REQUEST_CONFLICT');
  const uploadBase = record.revision, file = new File([photo], 'switchboard.png', { type: 'image/png' }); h.loseCommitOnce();
  record = await h.service.uploadSafetyCheckEvidence(worker, record.id, uploadBase, 'electrical.switchboard_photo', file, 'synthetic-lost-upload');
  const keys = [...h.objects.keys()];
  assert.equal((await h.service.uploadSafetyCheckEvidence(worker, record.id, uploadBase, 'electrical.switchboard_photo', file, 'synthetic-lost-upload')).revision, record.revision);
  assert.deepEqual([...h.objects.keys()], keys); assert.equal(record.evidence.length, 1);
  await assert.rejects(h.service.saveSafetyCheckAnswers(worker, record.id, base, answers, 'synthetic-stale-save'), error => error.code === 'SAFETY_CHECK_REVISION_CONFLICT');
});
test('unsigned answers and attachments cannot substitute for actual named consent and a drawn inspector signature', async t => {
  const h = fixture(t), unsigned = await h.answersAndEvidence('electrical');
  await assert.rejects(h.service.completeSafetyCheckRecord(worker, unsigned.id, unsigned.revision, 'synthetic-unsigned'), error => error.code === 'SAFETY_CHECK_INCOMPLETE');
  for (const patch of [{ accepted: false }, { signerName: 'Someone Else' }, { strokes: [] }, { scopeSha256: '0'.repeat(64) }]) {
    await assert.rejects(h.service.signSafetyCheckDeclaration(worker, unsigned.id, unsigned.revision, {
      declarationKey: unsigned.form.declarations[0].key, signerName: worker.displayName, strokes: ink, accepted: true,
      scopeSha256: activity.activitySigningScope(unsigned, 'after'), ...patch,
    }, `synthetic-invalid-${Object.keys(patch)[0]}`));
  }
  assert.equal(h.state(unsigned.id).assessment.status, 'draft'); assert.equal(h.providerRequests.length, 0);
});
test('signed answers and required evidence are immutable before completion', async t => {
  const h = fixture(t), signed = await h.signed('gas');
  await assert.rejects(h.service.saveSafetyCheckAnswers(worker, signed.id, signed.revision, { ...signed.answers, 'gas.outcome': 'unsafe' }, 'synthetic-edit-signed'), error => error.code === 'SAFETY_CHECK_SIGNED_SCOPE_LOCKED');
  await assert.rejects(h.service.uploadSafetyCheckEvidence(worker, signed.id, signed.revision, 'gas.appliance.identifying_photo', new File([photo], 'later.png'), 'synthetic-later-photo'), error => error.code === 'SAFETY_CHECK_SIGNED_SCOPE_LOCKED');
  assert.equal(h.state(signed.id).assessment.status, 'draft'); assert.equal(h.providerRequests.length, 0);
});
test('cross-business and unassigned access cannot read private records, evidence, final PDF or mutate the report', async t => {
  const h = fixture(t), signed = await h.signed('electrical');
  const complete = await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-private-complete');
  const foreign = { ...worker, ownerUid: 'unrelated-synthetic-business' };
  for (const action of [() => h.service.readSafetyCheckRecord(foreign, signed.id),
    () => h.service.readSafetyCheckEvidence(foreign, signed.id, signed.evidence[0].id), () => h.service.readSafetyCheckPdf(foreign, signed.id)]) {
    await assert.rejects(action(), error => error.code === 'SAFETY_CHECK_NOT_FOUND');
  }
  const presentation = await h.service.safetyCheckPresentation(worker, complete);
  assert.equal('ownerUid' in presentation, false); assert.equal(presentation.evidence.some(item => 'objectKey' in item || 'previewObjectKey' in item), false);
  h.sqlite.prepare('UPDATE trade_work_orders SET assignee_member_id=? WHERE id=?').run('different-synthetic-worker', jobId);
  await assert.rejects(h.service.readSafetyCheckRecord(worker, signed.id), error => error.code === 'SAFETY_CHECK_ACCESS_REQUIRED');
  await assert.rejects(h.service.retrySafetyCheckDelivery(worker, signed.id), error => error.code === 'SAFETY_CHECK_ACCESS_REQUIRED');
  assert.equal(h.providerRequests.length, 2);
});
for (const revoked of ['licence', 'file', 'identity', 'permission', 'business']) test(`completion rechecks actual current ${revoked} after signing and cannot send an unauthorised report`, async t => {
  const h = fixture(t), signed = await h.signed('electrical');
  if (revoked === 'licence') h.sqlite.prepare("UPDATE trade_team_member_credentials SET status='suspended' WHERE rental_gate='licensed_electrician'").run();
  if (revoked === 'file') h.sqlite.prepare("UPDATE trade_team_member_files SET status='deleted' WHERE id='synthetic-file-licensed_electrician'").run();
  if (revoked === 'identity') h.sqlite.prepare("UPDATE trade_team_members SET display_name='Changed Inspector' WHERE id=?").run(worker.memberId);
  if (revoked === 'permission') h.sqlite.prepare('UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id=?').run(worker.memberId);
  if (revoked === 'business') h.sqlite.prepare("UPDATE trade_accounts SET verification_status='pending' WHERE firebase_uid=?").run(worker.ownerUid);
  await assert.rejects(h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, `synthetic-revoked-${revoked}`),
    error => ['SAFETY_CHECK_CREDENTIAL_REQUIRED', 'SAFETY_CHECK_ACCESS_REQUIRED'].includes(error.code));
  assert.equal(h.state(signed.id).assessment.status, 'draft'); assert.equal(h.state(signed.id).job.stage, 'in_progress');
  assert.equal(h.providerRequests.length, 0); assert.equal(h.state(signed.id).deliveries.length, 0);
});
test('credential changes during real PDF rendering cannot commit or email the completed report', async t => {
  const h = fixture(t), signed = await h.signed('gas');
  h.onObjectWrite(key => { if (key.includes('/completed/')) h.sqlite.prepare("UPDATE trade_team_member_credentials SET issuer='Changed Authority' WHERE rental_gate='licensed_gasfitter'").run(); });
  await assert.rejects(h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-late-credential-change'), error => error.code === 'SAFETY_CHECK_CREDENTIAL_CHANGED');
  assert.equal(h.state(signed.id).assessment.status, 'draft'); assert.equal(h.providerRequests.length, 0);
  assert.equal([...h.objects.keys()].some(key => key.includes('/completed/')), false, 'uncommitted PDF must be cleaned without touching retained evidence');
});
test('definite email rejection retains the real official PDF and completed job, then retries both immutable attachment packages once', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T12:00:00Z') }); const h = fixture(t), signed = await h.signed('gas'); h.provider('reject');
  const complete = await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-rejected');
  assert.equal(h.state(signed.id).job.stage, 'completed'); assert.ok(h.state(signed.id).deliveries.every(row => row.status === 'failed'));
  const bytes = (await h.service.readSafetyCheckPdf(worker, signed.id)).bytes; h.provider('accept'); t.mock.timers.tick(61_000);
  await Promise.all([h.service.retrySafetyCheckDelivery(worker, signed.id, complete.revision), h.service.retrySafetyCheckDelivery(worker, signed.id, complete.revision)]);
  assert.ok(h.state(signed.id).deliveries.every(row => row.status === 'accepted')); assert.equal(h.providerRequests.length, 4);
  assert.deepEqual((await h.service.readSafetyCheckPdf(worker, signed.id)).bytes, bytes);
  await h.service.retrySafetyCheckDelivery(worker, signed.id, complete.revision); assert.equal(h.providerRequests.length, 4);
});
test('uncertain email transport retains the official report and never blindly resends to either recipient', async t => {
  const h = fixture(t), signed = await h.signed('electrical'); h.provider('uncertain');
  const complete = await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-uncertain');
  assert.equal(h.state(signed.id).job.stage, 'completed'); assert.ok(h.state(signed.id).deliveries.every(row => row.status === 'reconciliation_required'));
  const before = h.state(signed.id); h.provider('accept'); await h.service.retrySafetyCheckDelivery(worker, signed.id, complete.revision);
  assert.equal(h.providerRequests.length, 2); assert.deepEqual(h.state(signed.id), before);
});
test('interrupted job progress is recoverable without changing its official record, signatures, PDF, attachments or emails', async t => {
  const h = fixture(t), signed = await h.signed('gas'); h.failProgressOnce();
  const result = await h.service.completeSafetyCheckRecordWithProgress(worker, signed.id, signed.revision, 'synthetic-pending-progress');
  assert.equal(result.jobProgress.pending, true); assert.equal(h.state(signed.id).job.stage, 'in_progress');
  const before = h.state(signed.id), keys = [...h.objects.keys()];
  await h.service.safetyCheckPresentation(worker, await h.service.readSafetyCheckRecord(worker, signed.id));
  assert.equal(h.state(signed.id).job.stage, 'in_progress', 'ordinary reads must never complete jobs');
  await assert.rejects(h.service.recoverSafetyCheckJobProgress(worker, signed.id, result.record.revision + 1), error => error.code === 'SAFETY_CHECK_REVISION_CONFLICT');
  const recovered = await h.service.recoverSafetyCheckJobProgress(worker, signed.id, result.record.revision);
  assert.equal(recovered.jobProgress.stage, 'completed'); assert.deepEqual(recovered.record, result.record);
  assert.deepEqual(h.state(signed.id).assessment, before.assessment); assert.deepEqual(h.state(signed.id).deliveries, before.deliveries);
  assert.deepEqual([...h.objects.keys()], keys); assert.equal(h.providerRequests.length, 2);
});
test('tampered retained photo or PDF blocks delivery/recovery and cannot be substituted in an accepted email', async t => {
  const h = fixture(t), signed = await h.signed('gas'); h.failProgressOnce(); h.provider('reject');
  const complete = await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-integrity');
  const evidence = signed.evidence[0], object = h.objects.get(evidence.objectKey); h.objects.set(evidence.objectKey, { ...object, bytes: new Uint8Array(object.bytes.length) });
  h.provider('accept'); await assert.rejects(h.service.retrySafetyCheckDelivery(worker, signed.id), error => error.code === 'SAFETY_CHECK_EVIDENCE_INTEGRITY');
  assert.equal(h.providerRequests.length, 2); h.objects.set(evidence.objectKey, object);
  const key = h.state(signed.id).assessment.pdf_object_key, pdf = h.objects.get(key); h.objects.set(key, { ...pdf, bytes: new Uint8Array(pdf.bytes.length) });
  await assert.rejects(h.service.recoverSafetyCheckJobProgress(worker, signed.id, complete.revision), error => error.code === 'SAFETY_CHECK_PDF_INTEGRITY');
  assert.equal(h.state(signed.id).job.stage, 'in_progress');
});
test('completed record, version and mutation history remain database immutable', async t => {
  const h = fixture(t), signed = await h.signed('electrical'); await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-retention');
  for (const sql of ['UPDATE trade_safety_checks SET revision=revision+1 WHERE id=?', 'DELETE FROM trade_safety_checks WHERE id=?',
    'UPDATE trade_safety_check_versions SET recorded_at=recorded_at WHERE record_id=?', 'DELETE FROM trade_safety_check_versions WHERE record_id=?',
    'UPDATE trade_safety_check_mutations SET actor_uid=actor_uid WHERE record_id=?', 'DELETE FROM trade_safety_check_mutations WHERE record_id=?']) {
    assert.throws(() => h.sqlite.prepare(sql).run(signed.id), /SAFETY_CHECK_(IMMUTABLE|RETAINED)/);
  }
});
test('maximum supported gas appliance count can retain every mandatory photo and its full servicing record', async t => {
  const h = fixture(t), signed = await h.signed('gas', 20); assert.equal(signed.evidence.length, 21);
  const complete = await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-max-appliances');
  await assertCompleted(h, complete);
});
test('uploads which lose their CAS race remove only their unretained file; previously committed evidence remains intact', async t => {
  const h = fixture(t); let record = await h.service.startSafetyCheckRecord(worker, jobId, 'electrical');
  record = await h.service.uploadSafetyCheckEvidence(worker, record.id, record.revision, 'electrical.switchboard_photo', new File([photo], 'first.png'), 'synthetic-first-photo');
  const retained = record.evidence[0].objectKey, original = h.objects.get(retained).bytes;
  h.onObjectWrite(async key => { if (key.includes('/evidence/')) await h.service.saveSafetyCheckAnswers(worker, record.id, record.revision, { ...record.answers, inspection_date: '2026-10-13' }, 'synthetic-racing-save'); });
  await assert.rejects(h.service.uploadSafetyCheckEvidence(worker, record.id, record.revision, 'electrical.test_evidence_photo', new File([photo], 'unretained.png'), 'synthetic-racing-photo'), error => error.code === 'SAFETY_CHECK_REVISION_CONFLICT');
  assert.deepEqual([...h.objects.keys()], [retained]); assert.deepEqual(h.objects.get(retained).bytes, original);
});
test('official scope is checked again when a current service address or customer access changes after signing', async t => {
  const h = fixture(t), signed = await h.signed('gas'); h.sqlite.prepare("UPDATE trade_crm_service_sites SET address_state='NSW' WHERE id='official-synthetic-site'").run();
  await assert.rejects(h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, 'synthetic-wrong-jurisdiction'), error => error.code === 'SAFETY_CHECK_JURISDICTION_REQUIRED');
  assert.equal(h.state(signed.id).assessment.status, 'draft'); assert.equal(h.providerRequests.length, 0);
});
test('non-compliant and unsafe gas findings remain completable with actual fault/action records and clear customer attention', async t => {
  for (const outcome of ['non_compliant', 'unsafe']) {
    const h = fixture(t), signed = await h.signed('gas', 1, { 'gas.outcome': outcome, 'gas.fault.description': 'Synthetic reported defect',
      'gas.fault.remedial_action': 'Synthetic inspecting gasfitter follow-up action' });
    const complete = await h.service.completeSafetyCheckRecord(worker, signed.id, signed.revision, `synthetic-${outcome}`);
    await assertCompleted(h, complete);
    assert.match(h.providerRequests[0].body.html, outcome === 'unsafe' ? /immediately|Urgent/i : /Contact the inspecting gasfitter about the recorded faults and remedial actions/i);
  }
});
test('source inspection limitations, defects and recurring check dates are required before a report may be signed', async t => {
  const h = fixture(t), unsigned = await h.answersAndEvidence('electrical');
  const cases = [
    [{ 'electrical.scope.kitchen': 'not_included', 'electrical.scope.limitations': '' }, 'electrical.scope.limitations'],
    [{ 'electrical.rcd.time_test': 'fail', 'electrical.observations': '' }, 'electrical.observations'],
    [{ 'electrical.smoke_alarms': 'no', 'electrical.observations': '' }, 'electrical.observations'],
    [{ next_safety_check_due: '2028-10-14' }, 'next_safety_check_due'],
    [{ next_safety_check_due: '2026-10-13' }, 'next_safety_check_due'],
    [{ 'electrical.next_smoke_alarm_check_due': '2027-10-14' }, 'electrical.next_smoke_alarm_check_due'],
  ];
  for (const [patch, key] of cases) {
    const record = { ...unsigned, answers: { ...unsigned.answers, ...patch } };
    assert.ok(h.service.safetyCheckCompletion(record).missing.some(item => item.key === key && item.kind === 'policy'), key);
  }
  const bad = await h.service.saveSafetyCheckAnswers(worker, unsigned.id, unsigned.revision, {
    ...unsigned.answers, 'electrical.scope.kitchen': 'not_included', 'electrical.scope.limitations': '',
  }, 'synthetic-exclusion-no-explanation');
  await assert.rejects(h.service.signSafetyCheckDeclaration(worker, bad.id, bad.revision, {
    declarationKey: bad.form.declarations[0].key, signerName: worker.displayName, strokes: ink, accepted: true,
    scopeSha256: activity.activitySigningScope(bad, 'after'),
  }, 'synthetic-sign-unexplained-exclusion'), error => error.code === 'SAFETY_CHECK_SIGNING_NOT_READY');
});
test('failed gas tests and unsafe findings require actual comments and matched fault/action details', async t => {
  const h = fixture(t), unsigned = await h.answersAndEvidence('gas');
  const cases = [
    [{ 'gas.outcome': 'unsafe', 'gas.fault.description': '', 'gas.fault.remedial_action': '' }, 'gas.fault.remedial_action'],
    [{ 'gas.installation_leakage_test': 'fail', 'gas.installation_comments': '', 'gas.fault.description': '' }, 'gas.installation_comments'],
    [{ 'gas.appliance.electrically_safe': 'no', 'gas.appliance.comments': '', 'gas.fault.description': '' }, 'gas.appliance.comments'],
    [{ next_safety_check_due: '2028-10-14' }, 'next_safety_check_due'],
  ];
  for (const [patch, key] of cases) assert.ok(h.service.safetyCheckCompletion({ ...unsigned, answers: { ...unsigned.answers, ...patch } }).missing.some(item => item.key === key && item.kind === 'policy'), key);
  await assert.rejects(h.service.uploadSafetyCheckEvidence(worker, unsigned.id, unsigned.revision, 'gas.as4575_consumer_record', new File([photo], 'not-a-pdf.png'), 'synthetic-invalid-consumer-record'), error => error.code === 'SAFETY_CHECK_FILE_INVALID');
});
test('HTTP boundary uses the real authoritative flow, strict input, private binary headers and explicit progress without GET side effects', async t => {
  const h = fixture(t), bounded = load('../src/lib/bounded-json-request.ts'); let actor = worker, acceptedOrigin = true;
  const route = load('../src/app/api/trade-safety-checks/route.ts', {
    '@/lib/admin-server': { adminJson: (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } }),
      sameOrigin: () => acceptedOrigin, mfaErrorResponse: () => null },
    '@/lib/trade-team-server': { async requireInstallerTeamAccess() { if (!actor) throw new Error('AUTH_REQUIRED'); return actor; } },
    '@/lib/bounded-json-request': bounded, '@/lib/job-safety-check': records, '@/lib/official-safety-check-forms': forms,
    '@/lib/trade-safety-checks-server': h.service,
  });
  const json = (body, method = 'POST') => new Request('https://test.example/api/trade-safety-checks', { method,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await route.POST(json({ action: 'start', kind: 'invented', workOrderId: jobId }))).status, 400);
  acceptedOrigin = false;
  assert.equal((await route.POST(json({ action: 'start', kind: 'gas', workOrderId: jobId }))).status, 403); acceptedOrigin = true;
  actor = { ...worker, canManageFieldEvidence: false };
  assert.equal((await route.POST(json({ action: 'start', kind: 'gas', workOrderId: jobId }))).status, 403); actor = worker;
  const catalogue = await (await route.GET(new Request('https://test.example/api?view=catalogue'))).json();
  assert.deepEqual(catalogue.forms.map(form => form.id), ['official-vic-electrical-safety-check', 'official-vic-gas-safety-check']);
  assert.deepEqual(catalogue.forms.map(form => form.sources[0].sha256), ['electrical', 'gas'].map(kind => forms.createOfficialSafetyCheckForm(kind).sources[0].sha256));
  const initial = await (await route.POST(json({ action: 'start', kind: 'gas', workOrderId: jobId }))).json();
  assert.equal(initial.record.kind, 'gas'); assert.equal('ownerUid' in initial.record, false);
  assert.equal((await route.PATCH(json({ recordId: initial.record.id, baseRevision: '1', answers: {} }, 'PATCH'))).status, 400);
  assert.equal((await route.PATCH(json({ recordId: initial.record.id, baseRevision: 1, answers: { property_address: 'x'.repeat(270_000) } }, 'PATCH'))).status, 413);
  const signed = await h.signed('gas'); h.failProgressOnce();
  const completed = await route.POST(json({ action: 'complete', recordId: signed.id, baseRevision: signed.revision, requestId: 'synthetic-http-complete' }));
  assert.equal(completed.status, 200); const data = await completed.json();
  assert.equal(data.record.jobProgress.pending, true); assert.equal(data.record.status, 'complete');
  const get = await route.GET(new Request(`https://test.example/api?recordId=${signed.id}`)); assert.equal(get.status, 200);
  assert.equal('jobProgress' in (await get.json()).record, false); assert.equal(h.state(signed.id).job.stage, 'in_progress');
  const final = await route.GET(new Request(`https://test.example/api?recordId=${signed.id}&view=pdf`));
  assert.equal(final.headers.get('Cache-Control'), 'private, no-store'); assert.equal(final.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await final.arrayBuffer()), (await h.service.readSafetyCheckPdf(worker, signed.id)).bytes);
  const recovered = await route.POST(json({ action: 'recover_progress', recordId: signed.id, baseRevision: data.record.revision }));
  assert.equal((await recovered.json()).record.jobProgress.stage, 'completed'); assert.equal(h.providerRequests.length, 2);
  actor = { ...worker, ownerUid: 'foreign-business' };
  assert.equal((await route.GET(new Request(`https://test.example/api?recordId=${signed.id}&view=pdf`))).status, 404);
  actor = null; assert.equal((await route.GET(new Request('https://test.example/api?view=catalogue'))).status, 403);
});
