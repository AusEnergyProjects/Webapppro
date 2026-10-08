import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { normalizeTradeFormAnswers, tradeFormCompletion } from '../../src/lib/trade-form-library.mjs';

const source = fs.readFileSync(new URL('../src/app/job/[id].tsx', import.meta.url), 'utf8');
function action(name, dependencies) {
  const ast = ts.createSourceFile('job.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

test('document picking excludes double taps and clears its guard after cancellation or picker failure', async () => {
  for (const fail of [false, true]) {
    let finishPicker;
    let pickerCalls = 0;
    const alerts = [];
    const busy = [];
    const pickingDocument = { current: false };
    const choose = action('chooseDocument', {
      job: { id: 'job' }, pickingDocument, evidenceIdentifiers: () => ({}),
      evidenceBusyKey: () => 'document:general', setBusy: (value) => busy.push(value), setSavedMessage: () => {},
      ALLOWED_EVIDENCE_TYPES: new Set(['application/pdf']), DEFAULT_DOCUMENT_TYPES: ['application/pdf'],
      DocumentPicker: { getDocumentAsync: () => { pickerCalls++; return new Promise((resolve, reject) => { finishPicker = () => fail ? reject(new Error('Picker failed')) : resolve({ canceled: true }); }); } },
      Alert: { alert: (...args) => alerts.push(args) },
    });
    const first = choose();
    await choose();
    assert.equal(pickerCalls, 1);
    assert.equal(pickingDocument.current, true);
    finishPicker();
    await first;
    assert.equal(pickingDocument.current, false);
    assert.deepEqual(busy, ['document:general', '']);
    assert.equal(alerts.length, fail ? 1 : 0);
  }
});

test('time saving preserves input on failure and releases busy state', async () => {
  const busy = [];
  const alerts = [];
  let cleared = false;
  const addTime = action('addTime', {
    job: { id: 'job', revision: 4 }, duration: '60', notes: 'Work complete',
    setBusy: (value) => busy.push(value), setSavedMessage: () => {}, localWorkDate: () => '2026-09-10',
    saveAction: async () => { throw new Error('Device storage unavailable'); },
    setDuration: () => { cleared = true; }, setNotes: () => { cleared = true; },
    Alert: { alert: (...args) => alerts.push(args) },
  });
  await addTime();
  assert.equal(cleared, false);
  assert.deepEqual(busy, ['time', '']);
  assert.equal(alerts[0][0], 'Time could not be saved');
});

test('an incomplete required form rejects the save instead of advancing its caller', async () => {
  let wrote = false;
  const save = action('saveForm', { job: { id: 'job' }, normalizeTradeFormAnswers, tradeFormCompletion, saveAction: async () => { wrote = true; } });
  await assert.rejects(save({ template: { fields: [{ key: 'name', label: 'Name', required: true, type: 'text' }] } }, { name: ' ' }, true), /Finish the required fields: Name/);
  assert.equal(wrote, false);
});


function renderJobCard(title, overrides = {}) {
  const ast = ts.createSourceFile('job.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let card;
  function find(node) {
    if (ts.isJsxElement(node) && node.openingElement.getText(ast) === '<View style={styles.card}>'
      && node.children.some(child => ts.isJsxElement(child) && child.getText(ast).includes('>' + title + '</Text>'))) card = node;
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(card, title);
  const destinations = [];
  const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
  const dependencies = { React: { createElement: jsx, Fragment: 'Fragment' }, View: 'View', Text: 'Text', TextInput: 'TextInput', FieldButton: 'FieldButton', Pressable: 'Pressable',
    FieldSwmsFiles: 'FieldSwmsFiles', FieldVeuElectricalAssessmentPicker: 'FieldVeuElectricalAssessmentPicker', setElectricalAssessmentId() {},
    syncNow: async () => {}, load: async () => {}, styles: {}, job: { id: 'job', media: [] }, busy: '', syntheticManual: false, complianceCases: [], creditexManual: false,
    sync: { online: true }, duration: '', notes: '', setDuration() {}, setNotes() {}, chooseDocument() {},
    finishBlockers: [], formlessJob: false, completionState: { finish: null }, completionPending: false, completionProblem: false,
    completionLabel: 'Complete job', jobCompletionMessage, completeJob() {}, WorkTimeStatus: 'WorkTimeStatus',
    setActiveFormId: value => destinations.push(value), ...overrides };
  const code = ts.transpileModule('const tree = (' + card.getText(ast) + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const tree = Function(...Object.keys(dependencies), code + ';return tree;')(...Object.values(dependencies));
  const flatten = value => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [];
  const label = value => Array.isArray(value) ? value.map(label).join('') : value && typeof value === 'object' ? label(value.props?.children) : typeof value === 'string' ? value : '';
  return { destinations, text: label(tree), button: name => flatten(tree).find(node => node.type === 'FieldButton' && label(node) === name) };
}

const jobCompletionMessage = action('jobCompletionMessage', {});
const jobFinishLocalBlockers = action('jobFinishLocalBlockers', {});
const jobHasNoRequiredForms = action('jobHasNoRequiredForms', {
  complianceCasesForJob: job => job.complianceCases || (job.compliance ? [job.compliance] : []),
});
const emptyAssessment = { workOrderId: 'job', state: 'empty' };
function formlessFixture(overrides = {}) {
  return { id: 'job', stage: 'scheduled', revision: 4, tasks: [], forms: [], media: [], openIssues: 0,
    appointmentId: 'visit-1', appointmentStatus: 'scheduled', appointmentRevision: 2, ...overrides };
}

test('explicit finish requires verified same-job absence of every form source', () => {
  const job = formlessFixture();
  assert.equal(jobHasNoRequiredForms(job, emptyAssessment), true);
  for (const assessment of [null, { ...emptyAssessment, workOrderId: 'other-job' },
    ...['loading', 'unavailable', 'attached'].map(state => ({ ...emptyAssessment, state }))]) {
    assert.equal(jobHasNoRequiredForms(job, assessment), false);
  }
  for (const requirement of [{ forms: [{ status: 'complete' }] }, { rentalInspection: { status: 'issued' } },
    { complianceIntents: [{ status: 'completed' }] }, { activityWorkPacks: [{}] },
    { complianceCases: [{}] }, { compliance: {} }, { fieldLane: 'creditex_manual' }]) {
    assert.equal(jobHasNoRequiredForms({ ...job, ...requirement }, emptyAssessment), false);
  }
});

function completionHarness({ job = formlessFixture(), currentJob = job, currentQueue = { finish: null },
  updatedJob = { ...currentJob, stage: 'completed' }, updatedQueue = { finish: null }, saveError } = {}) {
  let jobReads = 0, queueReads = 0;
  const writes = [], alerts = [], messages = [], busy = [], projections = [];
  const finishingJob = { current: false };
  const complete = action('completeJob', {
    job, busy: '', finishingJob, setBusy: value => busy.push(value), setSavedMessage: value => messages.push(value),
    findJob: async () => ++jobReads === 1 ? currentJob : updatedJob,
    getJobCompletionQueueState: async () => ++queueReads === 1 ? currentQueue : updatedQueue,
    setCompletionQueue: value => projections.push(value), setJob() {},
    jobHasNoRequiredForms, electricalAssessmentState: emptyAssessment, jobFinishLocalBlockers, jobCompletionMessage,
    saveAction: async value => { writes.push(value); if (saveError) throw saveError; },
    Alert: { alert: (...args) => alerts.push(args) },
  });
  return { complete, writes, alerts, messages, busy, projections, finishingJob };
}

test('a form-less scheduled visit completes directly with current job and visit revisions', async () => {
  const run = completionHarness({ currentJob: formlessFixture({ revision: 7, appointmentRevision: 6 }) });
  await run.complete();
  assert.deepEqual(run.writes, [{ type: 'advance_field_job', transition: 'finish', workOrderId: 'job',
    baseRevision: 7, appointmentId: 'visit-1', baseAppointmentRevision: 6 }]);
  assert.equal(run.messages.at(-1), 'Job completed and synced to TLink.');
  assert.equal(run.alerts.length, 0);
  assert.deepEqual(run.busy, ['finish', '']);
  assert.equal(run.finishingJob.current, false);
});

test('a form-less unscheduled job finishes without inventing or altering an ended visit', async () => {
  for (const visit of [{ appointmentId: '', appointmentStatus: '' },
    ...['completed', 'cancelled', 'no_show'].map(appointmentStatus => ({ appointmentId: 'ended-visit', appointmentStatus }))]) {
    const run = completionHarness({ currentJob: formlessFixture({ stage: 'ready', ...visit }) });
    await run.complete();
    assert.deepEqual(run.writes, [{ type: 'advance_field_job', transition: 'finish', workOrderId: 'job', baseRevision: 4 }]);
  }
});

test('completion rejects new forms, tasks, issues, missing assignment and invalid current visit revision', async () => {
  for (const currentJob of [null, formlessFixture({ forms: [{ status: 'draft' }] }),
    formlessFixture({ tasks: [{ status: 'pending' }] }), formlessFixture({ openIssues: 1 }),
    formlessFixture({ appointmentRevision: undefined }), formlessFixture({ id: 'other-job' })]) {
    const run = completionHarness({ currentJob });
    await run.complete();
    assert.equal(run.writes.length, 0);
    assert.equal(run.alerts[0][0], 'Job completion needs attention');
    assert.equal(run.finishingJob.current, false);
    assert.equal(run.messages.includes('Job completed and synced to TLink.'), false);
  }
});

test('pending and rejected completion never claim optimistic local completed stage as server success', async () => {
  for (const status of ['queued', 'retry', 'rejected', 'conflict']) {
    const queue = { finish: { status, errorCode: 'JOB_COMPLETION_BLOCKED', errorMessage: 'A required form was added.' } };
    const run = completionHarness({ updatedQueue: queue });
    await run.complete();
    assert.equal(run.writes.length, 1);
    assert.equal(run.messages.includes('Job completed and synced to TLink.'), false);
    assert.match(run.messages.at(-1), ['queued', 'retry'].includes(status) ? /Waiting for TLink/ : /not accepted.*required form/);
    assert.equal(run.projections.at(-1).state, queue);
  }
  const pending = completionHarness({ currentJob: formlessFixture({ stage: 'completed' }),
    currentQueue: { finish: { status: 'queued', errorCode: '', errorMessage: '' } } });
  await pending.complete();
  assert.equal(pending.writes.length, 0);
  assert.match(pending.messages.at(-1), /Waiting for TLink/);
});

test('failed persistence reports the actual error and leaves completion retryable', async () => {
  const run = completionHarness({ saveError: new Error('Device storage unavailable') });
  await run.complete();
  assert.equal(run.alerts[0][1], 'Device storage unavailable');
  assert.equal(run.messages.includes('Job completed and synced to TLink.'), false);
  assert.equal(run.finishingJob.current, false);
});

test('completion double taps share one durable action', async () => {
  let release, reads = 0;
  const writes = [], finishingJob = { current: false };
  const job = formlessFixture();
  const complete = action('completeJob', {
    job, busy: '', finishingJob, setBusy() {}, setSavedMessage() {}, setCompletionQueue() {}, setJob() {},
    findJob: async () => { if (++reads === 1) await new Promise(resolve => { release = resolve; }); return job; },
    getJobCompletionQueueState: async () => ({ finish: null }),
    jobHasNoRequiredForms, electricalAssessmentState: emptyAssessment, jobFinishLocalBlockers, jobCompletionMessage,
    saveAction: async value => writes.push(value), Alert: { alert: (...args) => assert.fail(args.join(': ')) },
  });
  const first = complete();
  await complete();
  assert.equal(reads, 1);
  release(); await first;
  assert.equal(writes.length, 1);
  assert.equal(finishingJob.current, false);
});

test('form jobs retain automatic workflow while form-less completion has explicit pending and terminal states', () => {
  const job = formlessFixture();
  assert.equal(renderJobCard('Work progress', { job }).button('Complete job'), undefined);
  const ready = renderJobCard('Work progress', { job, formlessJob: true });
  assert.equal(ready.button('Complete job').props.disabled, false);
  assert.equal(renderJobCard('Work progress', { job, formlessJob: true, finishBlockers: ['assigned tasks'] }).button('Complete job').props.disabled, true);
  const pending = renderJobCard('Work progress', { job: { ...job, stage: 'completed' }, formlessJob: true,
    completionPending: true, completionState: { finish: { status: 'queued' } } });
  assert.equal(pending.button('Complete job'), undefined);
  assert.match(pending.text, /Waiting for TLink/);
  assert.doesNotMatch(pending.text, /Job completed and synced|All required work is complete/);
  assert.equal(renderJobCard('Work progress', { job: { ...job, stage: 'cancelled' }, formlessJob: true }).button('Complete job'), undefined);
  assert.equal(renderJobCard('Work progress', { job: { ...job, collaborativeJob: true, appointmentStatus: 'completed' }, formlessJob: true }).button('Complete job'), undefined);
  const shared = renderJobCard('Work progress', { job: { ...job, collaborativeJob: true }, formlessJob: true, completionLabel: 'Complete visit' });
  assert.ok(shared.button('Complete visit'));
});

test('Upload file is available from job actions before and after completion and uses the existing uploader', () => {
  for (const stage of ['scheduled', 'completed']) {
    let picked = 0;
    const actions = renderJobCard('Job actions', { job: formlessFixture({ stage }), chooseDocument: () => { picked++; } });
    actions.button('Upload file').props.onPress();
    assert.equal(picked, 1);
    actions.button('Files').props.onPress();
    assert.deepEqual(actions.destinations, ['files']);
  }
  assert.equal(renderJobCard('Job actions', { syntheticManual: true }).button('Upload file'), undefined);
});

test('general PDFs queue into canonical job uploads before or after completion and synced names appear in Files', async () => {
  for (const stage of ['scheduled', 'completed']) {
    const job = formlessFixture({ stage, media: [{ id: 'media-1', fileName: 'Energy assessment.pdf', caption: 'Final assessment' }] });
    const writes = [], messages = [];
    const envelope = { identifiers: { jobId: job.id }, source: 'document_picker' };
    const choose = action('chooseDocument', {
      job, pickingDocument: { current: false }, evidenceIdentifiers: () => ({ jobId: job.id }),
      evidenceBusyKey: () => 'document:general', setBusy() {}, setSavedMessage: value => messages.push(value),
      ALLOWED_EVIDENCE_TYPES: new Set(['application/pdf']), DEFAULT_DOCUMENT_TYPES: ['application/pdf'], MAX_EVIDENCE_BYTES: 50 * 1024 * 1024,
      DocumentPicker: { getDocumentAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///assessment.pdf', name: 'Energy assessment.pdf', mimeType: 'application/pdf' }] }) },
      File: class { exists = true; size = 1500; type = 'application/pdf'; },
      captureSessionId: () => 'capture-1', buildEvidenceEnvelope: async () => envelope, evidenceCaption: () => '',
      saveUpload: async value => writes.push(value), Alert: { alert: (...args) => assert.fail(args.join(': ')) },
    });
    await choose();
    assert.deepEqual(writes, [{ workOrderId: 'job', uri: 'file:///assessment.pdf', fileName: 'Energy assessment.pdf',
      contentType: 'application/pdf', sizeBytes: 1500, category: 'document', caption: '', evidenceEnvelope: envelope }]);
    assert.match(messages.at(-1), /saved on this device.*Sync/);
    assert.match(renderJobCard('Photos and documents', { job }).text, /Energy assessment.pdf.*Final assessment/);
  }
});

test('job actions prioritise Files while optional manual time lives inside Files', () => {
  const overview = renderJobCard('Job actions');
  assert.equal(overview.button('Record time'), undefined);
  assert.equal(overview.button('Add manual time'), undefined);
  overview.button('Files').props.onPress(); assert.deepEqual(overview.destinations, ['files']);
  const files = renderJobCard('Photos and documents');
  files.button('Add manual time').props.onPress(); assert.deepEqual(files.destinations, ['time']);
  assert.equal(renderJobCard('Photos and documents', { creditexManual: true }).button('Add manual time'), undefined);
  const time = renderJobCard('Add manual time');
  time.button('Back to Files').props.onPress(); assert.deepEqual(time.destinations, ['files']);
});
