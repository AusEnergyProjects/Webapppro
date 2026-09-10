import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const rentalSource = readFileSync(new URL('../src/lib/rental-inspection.ts', import.meta.url), 'utf8');
const rentalCode = ts.transpileModule(rentalSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const rental = {};
new Function('exports', rentalCode)(rental);
const database = ts.createSourceFile('database.ts', readFileSync(new URL('../src/lib/database.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const functions = ['rentalResultSettingKey', 'withCachedRentalResult', 'listJobs', 'getJob'];
const databaseCode = ts.transpileModule(functions.map((name) => database.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === name)
  .getText(database).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const jobSource = ts.createSourceFile('job.tsx', readFileSync(new URL('../src/app/job/[id].tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const blockerCode = ts.transpileModule(jobSource.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === 'jobFinishLocalBlockers').getText(jobSource),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const finishBlockers = new Function(blockerCode + '; return jobFinishLocalBlockers;')();
const eligibilityCode = ts.transpileModule(jobSource.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === 'canCompleteFieldJob').getText(jobSource),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const canComplete = new Function('completableAppointmentStatuses', eligibilityCode + '; return canCompleteFieldJob;')(new Set(['scheduled', 'en_route', 'arrived', 'in_progress']));

function fixture() {
  const job = { id: 'job-1', fieldLane: 'trade_team', revision: 77, stage: 'scheduled', appointmentStatus: 'scheduled', tasks: [], forms: [], openIssues: 0,
    rentalInspection: { id: 'inspection-1', revision: 2, status: 'draft', inspectionNumber: 'RMS-1', rulesEffectiveFrom: '2027-03-01',
      selectedModules: ['minimum_standards'], issuedReportId: '', issuedAt: '', progress: { completeModules: 0, moduleTotal: 1, savedItems: 0, evidenceFiles: 0 }, permissions: { canEdit: true, canIssue: true } } };
  const result = { inspection: { id: 'inspection-1', revision: 58, status: 'issued', inspectionNumber: 'RMS-1', rulesEffectiveFrom: '2027-03-01',
    issuedReportId: 'report-1', issuedAt: '2026-09-10T10:34:00Z' }, modules: [{ id: 'module-1', key: 'minimum_standards', status: 'complete' }],
    items: [{ id: 'saved' }], evidence: [{ status: 'active' }, { status: 'removed' }], permissions: { canEdit: false, canIssue: false } };
  return { job, result };
}

function readers(job, result) {
  const owner = { key: 'firebase:alice', epoch: 1 };
  const store = new Map(result ? [[`rental-result:${encodeURIComponent(owner.key)}:${job.id}`, JSON.stringify(result)]] : []);
  const dependencies = { rentalJobWithResult: rental.rentalJobWithResult, purgeExpiredAddresses: async () => {},
    getLocalDataOwner: async () => owner, assertLocalDataOwner: (value) => assert.equal(value, owner),
    readRentalSetting: async (value, key) => { assert.equal(value, owner); return store.get(key) || ''; },
    getDatabase: async () => ({ getAllAsync: async () => [{ payload: JSON.stringify(job) }], getFirstAsync: async () => ({ payload: JSON.stringify(job) }) }) };
  return { ...new Function(...Object.keys(dependencies), databaseCode + '; return { getJob, listJobs };')(...Object.values(dependencies)), store };
}

test('job details and schedule read the newer authenticated issued rental result while general sync is offline', async () => {
  const { job, result } = fixture();
  const local = readers(job, result);
  for (const updated of [await local.getJob(job.id), ...(await local.listJobs())]) {
    assert.equal(updated.rentalInspection.status, 'issued');
    assert.equal(updated.rentalInspection.progress.completeModules, 1);
    assert.equal(updated.rentalInspection.progress.moduleTotal, 1);
    assert.equal(updated.rentalInspection.progress.evidenceFiles, 1);
    assert.equal(updated.rentalInspection.issuedReportId, 'report-1');
    assert.deepEqual(finishBlockers(updated), [], 'The issued report no longer disables Complete job');
    assert.equal(updated.stage, 'scheduled', 'The assessor must still explicitly complete the job');
    assert.equal(updated.revision, 77, 'Job CAS revision remains the authoritative work-order revision');
  }
  assert.equal(job.rentalInspection.progress.completeModules, 0, 'The stale sync payload is not mutated');
});

test('newer summaries, another inspection and another account cannot be overwritten by a cached rental result', async () => {
  const { job, result } = fixture();
  job.rentalInspection.revision = 59;
  assert.equal(rental.rentalJobWithResult(job, result), job);
  job.rentalInspection.revision = 2;
  assert.equal(rental.rentalJobWithResult(job, { ...result, inspection: { ...result.inspection, id: 'another-inspection' } }), job);
  const local = readers(job, null);
  local.store.set(`rental-result:${encodeURIComponent('firebase:bob')}:${job.id}`, JSON.stringify(result));
  assert.equal((await local.getJob(job.id)).rentalInspection.status, 'draft');
});

test('pending or absent rental results retain actual blockers and never manufacture completion', async () => {
  const { job, result } = fixture();
  assert.deepEqual(finishBlockers(await readers(job, null).getJob(job.id)), ['the issued rental assessment report']);
  const pending = { ...result, inspection: { ...result.inspection, status: 'in_progress', issuedReportId: '' }, modules: [{ id: 'module-1', key: 'minimum_standards', status: 'draft' }] };
  assert.deepEqual(finishBlockers(await readers(job, pending).getJob(job.id)), ['the issued rental assessment report']);
  job.forms = [{ status: 'draft' }];
  assert.deepEqual(finishBlockers(await readers(job, result).getJob(job.id)), ['required forms']);
});

test('issued rental jobs can finish after a cancelled or missing appointment without reopening terminal jobs', () => {
  const { job, result } = fixture();
  for (const appointmentStatus of ['cancelled', 'completed', 'no_show', '']) {
    const draft = { ...job, appointmentStatus };
    assert.equal(canComplete(draft), false);
    const issued = rental.rentalJobWithResult(draft, result);
    assert.equal(canComplete(issued), true);
    assert.deepEqual(finishBlockers(issued), []);
    assert.equal(canComplete({ ...issued, stage: 'cancelled' }), false);
    assert.equal(canComplete({ ...issued, stage: 'completed' }), false);
  }
});
