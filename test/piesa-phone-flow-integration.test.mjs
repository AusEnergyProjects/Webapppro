import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';
import { migratedDataforceSqlite } from './helpers/trade-dataforce-database.mjs';
import { certificateTestDependency } from './helpers/creditex-training-fixture.mjs';
import { electricalFixture } from './helpers/veu-electrical-fixture.mjs';
import * as activity from '../src/lib/trade-activity-forms.ts';
import * as flow from '../src/lib/trade-activity-form-flow.ts';
import * as form from '../src/lib/veu-electrical-safety-form.ts';
import * as pdf from '../src/lib/veu-electrical-safety-pdf.ts';
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
import * as safetyEmail from '../src/lib/safety-check-email.ts';
import * as integrationState from '../src/lib/trade-integration-state.ts';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const compiled = new Map();
function load(relative, dependencies = {}) {
  if (!compiled.has(relative)) compiled.set(relative, ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  }).outputText);
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', compiled.get(relative))(specifier => {
    const dependency = dependencies[specifier] ?? certificateTestDependency(specifier);
    assert.ok(dependency, `Unwired production dependency ${specifier}`);
    return dependency;
  }, loaded, loaded.exports);
  return loaded.exports;
}

const worker = {
  ownerUid: 'piesa-synthetic-owner', actorUid: 'piesa-synthetic-worker-uid', memberId: 'piesa-synthetic-worker',
  isOwner: false, displayName: 'Casey Synthetic Electrician', jobScope: 'own',
  canViewFieldEvidence: true, canManageFieldEvidence: true,
};
const jobId = 'piesa-synthetic-job';
const ink = [{ points: [
  { x: 0.05, y: 0.7 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.8 }, { x: 0.6, y: 0.4 }, { x: 0.9, y: 0.5 },
] }];

function fixture(t) {
  const { sqlite } = migratedDataforceSqlite();
  t.after(() => sqlite.close());
  const now = new Date().toISOString();
  const insert = (table, values) => {
    const keys = Object.keys(values);
    sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
      .run(...keys.map(key => values[key]));
  };
  insert('trade_accounts', {
    firebase_uid: worker.ownerUid, email: 'office@example.test', business_name: 'Synthetic Electrical Pty Ltd',
    contact_name: 'Casey Synthetic Electrician', partner_type: 'installer', account_status: 'active',
    verification_status: 'approved', abn: '51824753556', verified_abn: '51824753556',
    verification_review_id: 'piesa-synthetic-review', verification_reviewed_at: now,
    verification_reviewed_by_uid: 'synthetic-reviewer', consent_version: 'synthetic-consent', consent_at: now,
    address_state: 'VIC', service_states: '["VIC"]', is_synthetic: 1, created_at: now, updated_at: now,
  });
  insert('trade_account_verification_reviews', {
    id: 'piesa-synthetic-review', firebase_uid: worker.ownerUid, abn: '51824753556',
    business_name: 'Synthetic Electrical Pty Ltd', partner_type: 'installer', legal_entity_name: 'Synthetic Electrical Pty Ltd',
    decision: 'approved', review_method: 'official_abr_lookup', note: 'Synthetic fixture review only.',
    reviewed_by_uid: 'synthetic-reviewer', reviewed_at: now,
  });
  insert('trade_team_members', {
    id: worker.memberId, owner_uid: worker.ownerUid, member_uid: worker.actorUid, email: 'worker@example.test',
    display_name: worker.displayName, role: 'member', status: 'active', can_view_field_evidence: 1,
    can_manage_field_evidence: 1, job_scope: 'own', invited_at: now, created_at: now, updated_at: now,
  });
  insert('trade_work_orders', {
    id: jobId, firebase_uid: worker.ownerUid, partner_type: 'installer', work_number: 'PIESA-SYNTHETIC-001',
    title: 'Synthetic insulation electrical assessment', source_type: 'direct', stage: 'in_progress',
    assignee_member_id: worker.memberId, record_status: 'active', created_at: now, updated_at: now,
  });
  insert('trade_crm_customers', {
    id: 'piesa-synthetic-customer', firebase_uid: worker.ownerUid, customer_number: 'SYNTHETIC-CUSTOMER-001',
    first_name: 'Sam', last_name: 'Synthetic Owner', email: 'customer@example.test', created_at: now, updated_at: now,
  });
  insert('trade_crm_service_sites', {
    id: 'piesa-synthetic-site', firebase_uid: worker.ownerUid, customer_id: 'piesa-synthetic-customer',
    address_line_1: '12 Synthetic Street', suburb: 'Frankston', address_state: 'VIC', postcode: '3199',
    created_at: now, updated_at: now,
  });
  insert('trade_crm_job_details', {
    id: 'piesa-synthetic-details', work_order_id: jobId, firebase_uid: worker.ownerUid,
    crm_customer_id: 'piesa-synthetic-customer', service_site_id: 'piesa-synthetic-site',
    customer_source: 'trade_owned', pipeline_stage: 'in_progress', created_at: now, updated_at: now,
  });
  let loseCommit = false;
  let failProgressRead = false;
  let providerMode = 'accept';
  const objects = new Map(), providerRequests = [];
  const queryHook = query => {
    if (failProgressRead && query.includes('SELECT current_job.id, current_job.stage')) {
      failProgressRead = false;
      throw new Error('SYNTHETIC_PROGRESS_READ_INTERRUPTED');
    }
  };
  const statement = (query, values = []) => ({
    bind: (...bindings) => statement(query, bindings),
    first: async () => { queryHook(query); return sqlite.prepare(query).get(...values) || null; },
    all: async () => { queryHook(query); return { success: true, results: sqlite.prepare(query).all(...values) }; },
    run: async () => { queryHook(query); return { success: true, meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }; },
  });
  const db = { prepare: statement, async batch(statements) {
    sqlite.exec('BEGIN');
    let results;
    try { results = []; for (const item of statements) results.push(await item.run()); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    if (loseCommit) { loseCommit = false; throw new Error('SYNTHETIC_LOST_COMMIT_ACK'); }
    return results;
  } };
  const bucket = {
    async put(key, bytes, metadata) { objects.set(key, { bytes: new Uint8Array(bytes), metadata }); },
    async get(key) { const object = objects.get(key); return object ? { arrayBuffer: async () => object.bytes.slice().buffer } : null; },
    async delete(key) { objects.delete(key); },
  };
  const runtime = { RESEND_API_KEY: 'synthetic-provider-key-only', RESEND_FROM_EMAIL: 'Synthetic TLink <test@example.test>' };
  const providerFetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    providerRequests.push({ body: JSON.parse(init.body), headers: init.headers });
    if (providerMode === 'reject') return Response.json({ message: 'Synthetic provider rejection' }, { status: 400 });
    if (providerMode === 'uncertain') throw new TypeError('Synthetic transport disconnect after dispatch');
    return Response.json({ id: `synthetic-mail-${providerRequests.length}` });
  };
  const crypto = load('../src/lib/trade-integration-crypto.ts', {
    'cloudflare:workers': { env: {} }, '@/lib/trade-integration-state': integrationState,
  });
  const email = load('../src/lib/trade-email-server.ts', {
    'cloudflare:workers': { env: {} }, '../../db': { getD1: () => db }, './trade-integration-crypto': crypto,
    './trade-access-server': predicates, './trade-email-provider': emailProvider,
    './service-reminder-delivery': {
      ...reminder,
      serviceReminderProviderConfiguration: () => reminder.serviceReminderProviderConfiguration(runtime),
      sendServiceReminderProviderMessage: message => reminder.sendServiceReminderProviderMessage(message, { runtime, fetchImpl: providerFetch }),
    },
  });
  const sync = load('../src/lib/trade-team-sync-server.ts', { './trade-job-collaboration.ts': membership });
  const photoServer = load('../src/lib/photo-request-review-server.ts', {
    '../../db': { getD1: () => db }, '@/lib/photo-request-review': photoReview,
  });
  const progress = load('../src/lib/trade-form-job-progress.ts', {
    '../../db': { getD1: () => db }, './creditex-onboarding-server': onboarding,
    './trade-job-collaboration': membership, './trade-message-media-access': actorGuard,
    './trade-team-sync-server': sync, './trade-activity-forms-completion': completion,
    './photo-request-review-server': photoServer, './trade-photo-requests': photos,
  });
  const fonts = load('../src/lib/customer-plan-pdf-fonts.ts', {
    '../../public/fonts/LiberationSans-Regular.ttf?inline': { default: `data:font/ttf;base64,${fs.readFileSync(new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url)).toString('base64')}` },
    '../../public/fonts/LiberationSans-Bold.ttf?inline': { default: `data:font/ttf;base64,${fs.readFileSync(new URL('../public/fonts/LiberationSans-Bold.ttf', import.meta.url)).toString('base64')}` },
  });
  const service = load('../src/lib/trade-veu-electrical-assessment-server.ts', {
    'cloudflare:workers': { env: { EVIDENCE: bucket } }, '../../db': { getD1: () => db },
    './trade-job-collaboration': membership, './trade-account-predicates': predicates,
    './trade-activity-forms': activity, './trade-activity-form-flow': flow, './veu-electrical-safety-form': form,
    './veu-electrical-assessment': load('../src/lib/veu-electrical-assessment.ts'),
    './trade-veu-electrical-schema-guards': load('../src/lib/trade-veu-electrical-schema-guards.ts', { './tlink-schema-guards': schemaGuards }),
    './trade-veu-electrical-draft': load('../src/lib/trade-veu-electrical-draft.ts', { './trade-activity-forms': activity, './veu-electrical-safety-form': form }),
    './trade-email-server': email, './safety-check-email': safetyEmail, './service-reminder-delivery': reminder, './trade-form-job-progress': progress,
    './veu-electrical-safety-pdf': pdf, './customer-plan-pdf-fonts': fonts,
  });
  const state = () => ({
    job: sqlite.prepare('SELECT stage,revision FROM trade_work_orders WHERE id=?').get(jobId),
    assessment: sqlite.prepare('SELECT * FROM trade_veu_electrical_assessments WHERE work_order_id=?').get(jobId),
    deliveries: sqlite.prepare('SELECT * FROM trade_veu_electrical_deliveries ORDER BY recipient_role').all(),
    submissions: sqlite.prepare('SELECT * FROM trade_email_submissions ORDER BY recipient_email').all(),
    events: sqlite.prepare("SELECT * FROM trade_work_order_events WHERE work_order_id=? AND event_type='job_completed'").all(jobId),
  });
  async function signed() {
    let record = await service.startPiesaRecord(worker, jobId);
    assert.equal((await service.startPiesaRecord(worker, jobId)).id, record.id);
    const answers = electricalFixture().answers;
    answers.initial_correct = false;
    record = await service.savePiesaAnswers(worker, record.id, record.revision, answers, 'synthetic-answers');
    record = await service.attestPiesaInitial(worker, record.id, record.revision, activity.activitySigningScope(record, 'before'), true, 'synthetic-initial');
    for (const declaration of record.form.declarations.filter(item => activity.activityConditionMet(item.condition, record.answers, record.form))) {
      record = await service.signPiesaDeclaration(worker, record.id, record.revision, {
        declarationKey: declaration.key, signerName: record.answers[form.VEU_ELECTRICAL_SIGNER_FIELDS[declaration.key]],
        strokes: ink, accepted: true, scopeSha256: activity.activitySigningScope(record, declaration.phase),
      }, `synthetic-sign-${declaration.key}`);
    }
    assert.equal(form.veuElectricalCompletion(record).ready, true);
    assert.equal(state().assessment.status, 'draft');
    assert.equal(providerRequests.length, 0);
    return record;
  }
  return { sqlite, db, service, progress, objects, providerRequests, state, signed, insert,
    loseCommitOnce() { loseCommit = true; }, failProgressOnce() { failProgressRead = true; },
    provider(mode) { providerMode = mode; },
  };
}

async function assertCompleted(h, record) {
  const state = h.state();
  assert.equal(record.status, 'complete');
  assert.equal(state.assessment.status, 'complete');
  assert.equal(state.job.stage, 'completed');
  assert.equal(state.events.length, 1);
  assert.equal(state.submissions.length, 2);
  assert.ok(state.submissions.every(row => row.status === 'accepted'));
  assert.ok(state.deliveries.every(row => row.status === 'accepted'));
  assert.deepEqual(h.providerRequests.map(item => item.body.to).sort(), [['customer@example.test'], ['office@example.test']]);
  const final = await h.service.readPiesaPdf(worker, record.id);
  assert.equal(activity.activityHash(final.bytes), state.assessment.pdf_sha256);
  assert.equal(final.bytes.length, state.assessment.pdf_size_bytes);
  const report = await PDFDocument.load(final.bytes);
  assert.ok(report.getPageCount() >= 8);
  assert.match(report.getSubject(), /no_rectification/);
  assert.equal(report.getPages().some(page => page.node.Annots()?.size()), false);
  for (const item of h.providerRequests) {
    assert.match(item.body.html, /Prepared and delivered through TLink/);
    assert.equal(item.body.attachments.length, 1);
    assert.equal(item.body.attachments[0].filename, final.fileName);
    assert.deepEqual(new Uint8Array(Buffer.from(item.body.attachments[0].content, 'base64')), final.bytes);
  }
  return { final, pages: report.getPageCount(), state };
}

test('PIESA phone flow signs the official assessment, retains its real PDF, automatically emails both copies and closes the assigned job once', async t => {
  const h = fixture(t), signed = await h.signed();
  const complete = await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-complete');
  const proof = await assertCompleted(h, complete);
  const objectKeys = [...h.objects.keys()];
  const repeated = await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-complete');
  await h.service.retryPiesaDelivery(worker, signed.id);
  assert.equal(repeated.revision, complete.revision);
  assert.deepEqual([...h.objects.keys()], objectKeys);
  assert.equal(h.providerRequests.length, 2);
  assert.equal(h.state().events.length, 1);
  const evidence = process.env.PIESA_PHONE_FLOW_EVIDENCE_DIR;
  if (evidence) {
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, 'synthetic-completed-piesa.pdf'), proof.final.bytes);
    fs.writeFileSync(path.join(evidence, 'chain-proof.json'), JSON.stringify({
      synthetic: true, recordId: complete.id, recordRevision: complete.revision,
      signedDeclarations: complete.signatures.map(signature => signature.declarationKey),
      pdfSha256: proof.state.assessment.pdf_sha256, pdfBytes: proof.final.bytes.length, pdfPages: proof.pages,
      jobStage: proof.state.job.stage, jobCompletionEvents: proof.state.events.length,
      deliveries: proof.state.deliveries.map(row => ({ role: row.recipient_role, status: row.status, provider: row.provider })),
      providerRequestsAfterRetries: h.providerRequests.length,
    }, null, 2));
  }
});

test('PIESA exact completion replay recovers a lost commit acknowledgement without duplicate PDF, email or job completion', async t => {
  const h = fixture(t), signed = await h.signed();
  h.loseCommitOnce();
  const complete = await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-lost-ack');
  await assertCompleted(h, complete);
  const keys = [...h.objects.keys()];
  await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-lost-ack');
  assert.deepEqual([...h.objects.keys()], keys);
  assert.equal(h.providerRequests.length, 2);
  assert.equal(h.state().events.length, 1);
});

test('PIESA exposes interrupted progress and explicit recovery closes its job without changing the report, signatures or deliveries', async t => {
  const h = fixture(t), signed = await h.signed();
  h.failProgressOnce();
  const result = await h.service.completePiesaRecordWithProgress(worker, signed.id, signed.revision, 'synthetic-pending-progress');
  const complete = result.record;
  assert.equal(complete.status, 'complete');
  assert.equal(result.jobProgress.pending, true);
  assert.equal(result.jobProgress.blockers[0].key, 'job_progress_pending');
  assert.equal(h.state().job.stage, 'in_progress');
  assert.ok(h.state().deliveries.every(row => row.status === 'accepted'));
  const before = h.state(), keys = [...h.objects.keys()];
  const readOnly = await h.service.piesaPresentation(worker, await h.service.readPiesaRecord(worker, signed.id));
  assert.equal('jobProgress' in readOnly, false);
  assert.equal(h.state().job.stage, 'in_progress', 'ordinary reads must not complete a job');
  const recovered = await h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision);
  assert.equal(recovered.jobProgress.stage, 'completed');
  assert.equal(recovered.jobProgress.changed, true);
  assert.deepEqual(recovered.record, complete);
  assert.deepEqual(h.state().assessment, before.assessment);
  assert.deepEqual(h.state().deliveries, before.deliveries);
  assert.deepEqual(h.state().submissions, before.submissions);
  assert.deepEqual([...h.objects.keys()], keys);
  assert.equal(h.providerRequests.length, 2);
  const repeated = await h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision);
  assert.equal(repeated.jobProgress.changed, false);
  assert.equal(repeated.jobProgress.stage, 'completed');
  await assertCompleted(h, complete);
});

test('PIESA definite email rejection preserves the real PDF and completed job, then retries each original delivery safely', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T12:00:00Z') });
  const h = fixture(t), signed = await h.signed();
  h.provider('reject');
  const complete = await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-provider-rejection');
  assert.equal(complete.status, 'complete');
  assert.equal(h.state().job.stage, 'completed');
  assert.ok(h.state().submissions.every(row => row.status === 'failed'));
  assert.ok(h.state().deliveries.every(row => row.status === 'failed'));
  const bytes = (await h.service.readPiesaPdf(worker, signed.id)).bytes;
  h.provider('accept');
  t.mock.timers.tick(61_000);
  await Promise.all([
    h.service.retryPiesaDelivery(worker, signed.id),
    h.service.retryPiesaDelivery(worker, signed.id),
  ]);
  assert.ok(h.state().deliveries.every(row => row.status === 'accepted'));
  assert.equal(h.state().submissions.length, 2);
  assert.equal(h.providerRequests.length, 4);
  assert.deepEqual((await h.service.readPiesaPdf(worker, signed.id)).bytes, bytes);
  await h.service.retryPiesaDelivery(worker, signed.id);
  assert.equal(h.providerRequests.length, 4);
});

test('a rejected PIESA email from the preceding release replays its journalled payload after rebranding', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T12:00:00Z') });
  const h = fixture(t), signed = await h.signed(); h.provider('reject');
  await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'old-email-replay');
  const pdf = await h.service.readPiesaPdf(worker, signed.id);
  const subject = `${signed.recordNumber} | Pre-installation electrical safety assessment`;
  const body = `The completed pre-installation electrical safety assessment ${signed.recordNumber} is attached. Read the recorded outcome, conditions and required controls in the assessment before arranging insulation work. Keep this document with the job records.`;
  for (const row of h.state().submissions) {
    const payload = { recipient: row.recipient_email, subject, body, html: '', attachments: [{filename:pdf.fileName,content:Buffer.from(pdf.bytes).toString('base64'),contentType:'application/pdf'}] };
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))).toString('base64url');
    h.sqlite.prepare('UPDATE trade_email_submissions SET subject=?,content_hash=? WHERE id=?').run(subject,hash,row.id);
  }
  t.mock.timers.tick(61_000); h.provider('accept');
  await h.service.retryPiesaDelivery(worker,signed.id);
  assert.ok(h.state().deliveries.every(row=>row.status==='accepted'));
  for (const request of h.providerRequests.slice(2)) { assert.equal(request.body.subject,subject); assert.equal(request.body.text,body); assert.equal(request.body.html,undefined); }
  assert.equal(h.state().submissions.length,2); assert.equal(h.state().events.length,1);
});

test('PIESA uncertain transport retains the final report and requires reconciliation instead of risking duplicate customer emails', async t => {
  const h = fixture(t), signed = await h.signed();
  h.provider('uncertain');
  const complete = await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-provider-uncertain');
  assert.equal(complete.status, 'complete');
  assert.equal(h.state().job.stage, 'completed');
  assert.ok(h.state().submissions.every(row => row.status === 'uncertain'));
  assert.ok(h.state().deliveries.every(row => row.status === 'reconciliation_required'));
  h.provider('accept');
  await h.service.retryPiesaDelivery(worker, signed.id);
  await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-provider-uncertain');
  assert.equal(h.providerRequests.length, 2);
  assert.ok((await h.service.readPiesaPdf(worker, signed.id)).bytes.length > 4);
});

test('PIESA completion and explicit recovery hold unfinished task blockers, while its PDF emails independently', async t => {
  const h = fixture(t), signed = await h.signed();
  const columns = h.sqlite.prepare('PRAGMA table_info(trade_work_order_tasks)').all();
  const values = { id: 'piesa-synthetic-task', work_order_id: jobId, firebase_uid: worker.ownerUid, title: 'Synthetic required task',
    status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  for (const column of columns) if (column.notnull && column.dflt_value === null && !(column.name in values)) {
    throw new Error(`Task fixture needs explicit ${column.name}`);
  }
  h.insert('trade_work_order_tasks', values);
  const complete = await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-blocked-task');
  assert.equal(complete.status, 'complete');
  assert.equal(h.state().job.stage, 'in_progress');
  assert.equal(h.state().events.length, 0);
  assert.ok(h.state().deliveries.every(row => row.status === 'accepted'));
  const blocked = await h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision);
  assert.equal(blocked.jobProgress.stage, 'in_progress');
  assert.equal(blocked.jobProgress.changed, false);
  assert.equal(blocked.jobProgress.blockers[0].key, 'requirements');
  assert.equal(h.providerRequests.length, 2);
  h.sqlite.prepare("UPDATE trade_work_order_tasks SET status='done' WHERE id=?").run(values.id);
  await h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision);
  await assertCompleted(h, complete);
});

test('PIESA answers and initial attestation never substitute for the required drawn declaration or trigger a report email', async t => {
  const h = fixture(t);
  let record = await h.service.startPiesaRecord(worker, jobId);
  const answers = { ...electricalFixture().answers, initial_correct: false };
  record = await h.service.savePiesaAnswers(worker, record.id, record.revision, answers, 'synthetic-unsigned-answers');
  record = await h.service.attestPiesaInitial(worker, record.id, record.revision,
    activity.activitySigningScope(record, 'before'), true, 'synthetic-unsigned-initial');
  assert.ok(form.veuElectricalCompletion(record).missing.some(item => item.kind === 'signature'));
  await assert.rejects(
    h.service.completePiesaRecord(worker, record.id, record.revision, 'synthetic-unsigned-complete'),
    error => error.code === 'PIESA_INCOMPLETE',
  );
  assert.equal(h.state().assessment.status, 'draft');
  assert.equal(h.state().job.stage, 'in_progress');
  assert.equal(h.objects.size, 0);
  assert.equal(h.providerRequests.length, 0);
  assert.equal(h.state().deliveries.length, 0);
});

test('PIESA completion rechecks actual field permissions after signing and cannot generate or email a report after access is removed', async t => {
  const h = fixture(t), signed = await h.signed();
  h.sqlite.prepare('UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id=?').run(worker.memberId);
  await assert.rejects(
    h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-access-revoked'),
    error => error.code === 'PIESA_ACCESS_REQUIRED',
  );
  assert.equal(h.state().assessment.status, 'draft');
  assert.equal(h.state().job.stage, 'in_progress');
  assert.equal(h.objects.size, 0);
  assert.equal(h.providerRequests.length, 0);
  assert.equal(h.state().deliveries.length, 0);
});

test('PIESA explicit recovery requires the exact completed revision and intact immutable PDF before advancing its job', async t => {
  const h = fixture(t), signed = await h.signed();
  await assert.rejects(h.service.recoverPiesaJobProgress(worker, signed.id, signed.revision), error => error.code === 'PIESA_PDF_NOT_READY');
  h.failProgressOnce();
  const complete = await h.service.completePiesaRecord(worker, signed.id, signed.revision, 'synthetic-recovery-proof');
  const before = h.state(), key = before.assessment.pdf_object_key, object = h.objects.get(key);
  await assert.rejects(h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision + 1), error => error.code === 'PIESA_REVISION_CONFLICT');
  h.objects.delete(key);
  await assert.rejects(h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision), error => error.code === 'PIESA_PDF_UNAVAILABLE');
  h.objects.set(key, { ...object, bytes: new Uint8Array(object.bytes.length) });
  await assert.rejects(h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision), error => error.code === 'PIESA_PDF_INTEGRITY');
  assert.equal(h.state().job.stage, 'in_progress');
  assert.deepEqual(h.state().assessment, before.assessment);
  assert.deepEqual(h.state().deliveries, before.deliveries);
  assert.equal(h.providerRequests.length, 2);
  h.objects.set(key, object);
  await h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision);
  await assertCompleted(h, complete);
});

for (const revoked of ['permission', 'assignment']) test(`PIESA explicit progress recovery reauthorizes current ${revoked} and preserves all completed artifacts when denied`, async t => {
  const h = fixture(t), signed = await h.signed();
  h.failProgressOnce();
  const complete = await h.service.completePiesaRecord(worker, signed.id, signed.revision, `synthetic-recovery-${revoked}`);
  const before = h.state(), keys = [...h.objects.keys()];
  if (revoked === 'permission') h.sqlite.prepare('UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id=?').run(worker.memberId);
  else h.sqlite.prepare('UPDATE trade_work_orders SET assignee_member_id=? WHERE id=?').run('different-synthetic-worker', jobId);
  await assert.rejects(h.service.recoverPiesaJobProgress(worker, signed.id, complete.revision), error => error.code === 'PIESA_ACCESS_REQUIRED');
  assert.equal(h.state().job.stage, 'in_progress');
  assert.deepEqual(h.state().assessment, before.assessment);
  assert.deepEqual(h.state().deliveries, before.deliveries);
  assert.deepEqual(h.state().submissions, before.submissions);
  assert.deepEqual([...h.objects.keys()], keys);
  assert.equal(h.providerRequests.length, 2);
});
