import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { electricalFixture } from '../../test/helpers/veu-electrical-fixture.mjs';
import { VEU_ELECTRICAL_SIGNER_FIELDS, veuElectricalCompletion } from '../../src/lib/veu-electrical-safety-form.ts';
import { activityHash, activityMissing, activitySigningScope, normaliseActivityAnswers } from '../../src/lib/trade-activity-forms.ts';
import * as flow from '../../src/lib/trade-activity-form-flow.ts';

// Reuse the established hook/API boundary fixtures without importing their test
// registrations. All rendered components and job callbacks execute current source.
// Server PDF custody, reconciliation and provider delivery are independently exercised
// by test/piesa-phone-flow-integration.test.mjs. No real device or provider is used here.
const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const visit = node => Array.isArray(node) ? node.flatMap(visit)
  : !node || typeof node !== 'object' ? [] : [node, ...visit(node.props?.children)];

function functions(relative, names, dependencies = {}) {
  dependencies = { exports: {}, ...dependencies };
  const file = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = names.map(name => {
    let result;
    const find = node => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node;
      if (!result) ts.forEachChild(node, find);
    };
    find(file); assert.ok(result, `Established runtime helper ${name}`); return result.getText(file);
  });
  const code = compile(declarations.join('\n'));
  return Function(...Object.keys(dependencies), `${code};return {${names.join(',')}};`)(...Object.values(dependencies));
}

const inkExports = functions('../src/lib/activity-form-completion.ts', ['activitySignatureStrokesAreValid']);
const wizard = functions('./field-veu-electrical-assessment-wizard.test.mjs', ['fixture', 'presentation', 'harness', 'load'], {
  assert, electricalFixture, VEU_ELECTRICAL_SIGNER_FIELDS, veuElectricalCompletion,
  activityHash, activityMissing, activitySigningScope, normaliseActivityAnswers, flow,
  clone: structuredClone, compile, flush, inkExports,
  source: read('../src/components/FieldVeuElectricalAssessmentWizard.tsx'),
});
const record = wizard.fixture();
const picker = functions('./field-veu-electrical-assessment-picker.test.mjs', ['harness'], {
  assert, flush, record,
  picker: compile(read('../src/components/field-veu-electrical-assessment-picker.tsx')),
  cataloguePicker: compile(read('../src/components/field-job-activity-picker.tsx')),
}).harness;
const draw = functions('./signature-capture-gestures.test.mjs', ['fixture'], {
  assert, visit, compiled: compile(read('../src/components/SignatureCapture.tsx')),
}).fixture;
const jobActions = functions('../src/app/job/[id].tsx', ['jobCompletionMessage', 'jobHasNoRequiredForms'], {
  complianceCasesForJob: job => job.complianceCases || [],
});
const touch = (x, y, count = 1) => ({ nativeEvent: {
  locationX: x, locationY: y, force: 0.5, touches: Array.from({ length: count }, () => ({})),
} });

function jobWizardProps(assessment, { syncNow = async () => {}, load = async () => {}, setRecord = () => {} } = {}) {
  const source = read('../src/app/job/[id].tsx');
  const file = ts.createSourceFile('job.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node;
  const find = item => {
    if (ts.isJsxSelfClosingElement(item) && item.tagName.getText(file) === 'FieldVeuElectricalAssessmentWizard') node = item;
    ts.forEachChild(item, find);
  };
  find(file); assert.ok(node, 'The actual native job page mounts the PIESA wizard');
  const dependencies = {
    React: { createElement: (type, props) => ({ type, props }) },
    FieldVeuElectricalAssessmentWizard: 'Wizard', job: { id: assessment.workOrderId },
    electricalAssessmentId: assessment.id, sync: { online: true },
    setElectricalAssessmentId: setRecord, load, syncNow,
  };
  const code = ts.transpileModule(`const tree = (${node.getText(file)});`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  return Function(...Object.keys(dependencies), `${code};return tree.props;`)(...Object.values(dependencies));
}

async function loaded(h) { await wizard.load(h); return h; }
async function pressPicker(h, name) {
  const button = h.button(name); assert.ok(button, name); assert.notEqual(button.props.disabled, true, `${name} enabled`);
  button.props.onPress(); h.render(); await flush(); h.render();
}
function padFor(h, key) { return h.nodes().find(node => node.type === 'SignatureCapture' && node.props.signerRole.roleKey === key); }
function consentFor(h, key) {
  const declaration = h.state.record.form.declarations.find(item => item.key === key);
  const container = h.nodes().find(node => node.type === 'View' && node.props.children?.[0]?.props?.children === declaration.title);
  return visit(container).find(node => node.type === 'Pressable' && node.props.accessibilityRole === 'checkbox');
}
function scrollEnabled(h) { return h.nodes().find(node => node.type === 'Scroll').props.scrollEnabled; }
function syncPad(h, pad, key) { h.render(); pad.update(padFor(h, key).props); }

async function signWithActualTouch(h, key) {
  let node = padFor(h, key); assert.ok(node); assert.equal(node.props.disabled, true, 'Named consent must precede ink');
  const ignored = draw(node.props), ignoredPan = ignored.responder();
  assert.equal(ignoredPan.onStartShouldSetPanResponderCapture(touch(20, 30)), false);
  ignoredPan.onPanResponderGrant(touch(20, 30)); ignoredPan.onPanResponderMove(touch(80, 100));
  ignoredPan.onPanResponderRelease(touch(80, 100, 0)); ignored.render();
  assert.deepEqual(ignored.strokes(), []); assert.equal(scrollEnabled(h), true); ignored.unmount();
  const consent = consentFor(h, key); assert.equal(consent.props.disabled, false); consent.props.onPress(); h.render();
  node = padFor(h, key); assert.equal(node.props.disabled, false);
  const pad = draw(node.props), pan = pad.responder(), callback = node.props.onDrawingChange;
  pan.onPanResponderGrant(touch(20, 150)); syncPad(h, pad, key);
  assert.equal(scrollEnabled(h), false, 'Real widget gesture locks parent scrolling');
  assert.equal(padFor(h, key).props.onDrawingChange, callback, 'Rerender preserves the gesture callback');
  assert.equal(pad.responder(), pan, 'Parent rerender does not replace the active native responder');
  pan.onPanResponderMove(touch(100, 50)); pad.render();
  pan.onPanResponderMove(touch(170, 170)); pad.render();
  pan.onPanResponderRelease(touch(240, 100, 0)); syncPad(h, pad, key);
  assert.equal(scrollEnabled(h), true, 'Release restores ordinary page scrolling');
  const packet = structuredClone(padFor(h, key).props.value.strokes);
  assert.equal(inkExports.activitySignatureStrokesAreValid(packet), true);
  assert.equal(packet[0].points.length, 4, 'Saved ink comes from four actual touch positions');
  pad.unmount();
  const declaration = h.state.record.form.declarations.find(item => item.key === key);
  await h.press(`Save ${declaration.role === 'customer' ? 'owner' : 'electrician'} signature`);
  const request = h.state.requests.at(-1).body;
  assert.equal(request.action, 'sign'); assert.equal(request.declarationKey, key);
  assert.equal(request.signerName, h.state.record.answers[VEU_ELECTRICAL_SIGNER_FIELDS[key]]);
  assert.equal(request.accepted, true);
  assert.deepEqual(request.strokes, packet.map(stroke => ({ points: stroke.points.map(point => ({ x: point.x, y: point.y })) })));
  assert.equal(request.scopeSha256, activitySigningScope(h.state.record, declaration.phase));
}

async function answerSequentially(h, target) {
  for (const section of [...new Set(target.form.fields.map(field => field.section))]) {
    assert.equal(h.select('Assessment section').props.value, section, 'Answers follow the visible section order');
    for (const field of flow.expandedActivityFields(target.form, target.answers).filter(field => field.section === section && field.required)) {
      if (field.key === 'initial_correct') await h.press('Confirm initial assessment declaration');
      else h.answer(field, target.answers[field.key]);
    }
    await h.press(section === target.form.fields.at(-1).section ? 'Continue to sign off' : 'Next');
    assert.notEqual(h.select('Assessment section').props.value, section, `Saved section advances: ${section}`);
  }
  assert.equal(h.select('Assessment section').props.value, 'signatures');
  assert.equal(veuElectricalCompletion(h.state.record).missing.some(item => item.kind !== 'signature'), false);
}

test('phone journey directly adds PIESA despite another catalogue failing, reloads saved answers, signs actual ink and explicitly finishes', async t => {
  const outer = picker({ code: compile(read('../src/components/field-job-activity-picker.tsx')), entry: 'FieldJobActivityPicker' });
  t.after(() => outer.cleanup()); outer.state.loadError = new Error('Unrelated catalogue unavailable'); await loaded(outer);
  const entry = outer.nodes().find(node => node.type === 'FieldVeuElectricalAssessmentPicker'); assert.ok(entry);
  const add = picker(); t.after(() => add.cleanup()); Object.assign(add.state.props, entry.props); await loaded(add);
  await pressPicker(add, 'Add PIESA to this job');
  assert.deepEqual(outer.state.opened, [record.id]); assert.equal(outer.state.changes, 1);
  assert.equal(add.state.requests.filter(item => item.init.method === 'POST').length, 1);
  const start = add.state.requests.find(item => item.init.method === 'POST');
  assert.deepEqual(JSON.parse(start.init.body), { action: 'start', workOrderId: record.workOrderId });

  let h = await loaded(wizard.harness({ record: structuredClone(record) }));
  const target = electricalFixture(); const first = target.form.fields[0].section;
  for (const field of flow.expandedActivityFields(target.form, target.answers).filter(item => item.section === first && item.required)) h.answer(field, target.answers[field.key]);
  await h.press('Next'); const saved = structuredClone(h.state.record); const revision = saved.revision;
  assert.equal(saved.answers.life_support, false); await h.press('Back to job'); assert.equal(h.state.left, 1); h.cleanup();
  h = await loaded(wizard.harness({ record: saved })); t.after(() => h.cleanup());
  assert.equal(h.state.record.revision, revision); assert.equal(h.select('Job Reference ID').props.value, target.answers.job_reference);
  await answerSequentially(h, target);
  assert.equal(h.state.record.initialAttestation.scopeSha256, activitySigningScope(h.state.record, 'before'));
  assert.equal(h.nodes().filter(node => node.type === 'SignatureCapture').length, 1, 'No unnecessary rectifying-electrician signature');
  await h.press('Review & finish'); assert.equal(h.select('Assessment section').props.value, 'signatures');
  await signWithActualTouch(h, 'property_owner'); await h.press('Review & finish');
  assert.equal(h.select('Assessment section').props.value, 'review'); assert.equal(h.state.record.status, 'draft');
  assert.equal(h.state.requests.some(item => item.body?.action === 'complete'), false, 'Review alone never completes or sends');
  await h.press('Complete assessment and email PDF');
  assert.equal(h.state.record.status, 'complete'); assert.equal(h.state.changed, 1);
  assert.equal(h.state.requests.filter(item => item.body?.action === 'complete').length, 1);
  assert.match(h.texts(), /Customer copy.*accepted/); assert.match(h.texts(), /Business copy.*failed/);
  assert.ok(h.button('Save completed assessment PDF on phone')); assert.ok(h.button('Retry email delivery'));
  assert.equal(h.button('Complete assessment and email PDF'), undefined);
});

test('rectification phone journey signs both named declarations with touch ink and cannot finish with only one', async t => {
  const value = electricalFixture({ assessment_outcome: 'rectification_required', work_other: true,
    rectification_notes: 'Synthetic rectification only', electrical_works_performed: false }); value.status = 'draft';
  const h = await loaded(wizard.harness({ record: value })); t.after(() => h.cleanup());
  await h.press('Sign off'); assert.equal(h.nodes().filter(node => node.type === 'SignatureCapture').length, 2);
  await signWithActualTouch(h, 'rectification_electrician');
  await h.press('Finish & email PDF'); assert.equal(h.select('Assessment section').props.value, 'signatures');
  assert.equal(h.state.record.status, 'draft'); assert.equal(h.state.requests.some(item => item.body?.action === 'complete'), false);
  await signWithActualTouch(h, 'property_owner'); await h.press('Finish & email PDF');
  assert.equal(h.select('Assessment section').props.value, 'review');
  await h.press('Complete assessment and email PDF');
  assert.deepEqual(h.state.record.signatures.map(item => item.declarationKey).sort(), ['property_owner', 'rectification_electrician']);
  assert.equal(h.state.record.status, 'complete');
});

test('saved PIESA refreshes the actual job callbacks and completed files reopen without another start or completion', async t => {
  const value = electricalFixture(); value.status = 'draft';
  const h = await loaded(wizard.harness({ record: value })); t.after(() => h.cleanup());
  const events = [], job = { id: value.workOrderId, stage: 'in_progress', forms: [], tasks: [], media: [], complianceCases: [], openIssues: 0 };
  const props = jobWizardProps(value, {
    setRecord: id => events.push(['selected', id]), syncNow: async () => events.push(['sync']),
    // This is the protected API projection boundary; backend reconciliation is tested separately.
    load: async () => { events.push(['load']); if (h.state.record.status === 'complete') job.stage = 'completed'; },
  });
  Object.assign(h.state.props, props); h.render();
  assert.equal(props.workOrderId, value.workOrderId); assert.equal(props.recordId, value.id);
  await h.press('Sign off'); await signWithActualTouch(h, 'property_owner'); await h.press('Finish & email PDF');
  await h.press('Complete assessment and email PDF'); assert.deepEqual(events, [['sync'], ['load']]);
  assert.equal(job.stage, 'completed'); assert.equal(jobActions.jobCompletionMessage(job, { finish: null }), 'Job completed and synced to TLink.');
  await h.press('Back to job'); assert.deepEqual(events.slice(-2), [['selected', null], ['load']]);
  const files = picker({ response: { records: [h.state.record], canManage: true } }); t.after(() => files.cleanup());
  files.state.props.mode = 'files'; await loaded(files); await pressPicker(files, 'View completed PIESA');
  assert.deepEqual(files.state.opened, [value.id]); assert.equal(files.state.requests.some(item => item.init.method === 'POST'), false);
  const reopened = await loaded(wizard.harness({ record: h.state.record })); t.after(() => reopened.cleanup());
  assert.equal(reopened.select('Assessment section').props.value, 'review'); assert.ok(reopened.button('Save completed assessment PDF on phone'));
  assert.equal(reopened.button('Complete assessment and email PDF'), undefined);
  assert.equal(reopened.state.requests.some(item => item.body), false);
  assert.equal(jobActions.jobHasNoRequiredForms(job, { workOrderId: job.id, state: 'attached' }), false, 'Existing PIESA uses canonical form completion, never a duplicate formless finish');
});

test('interrupted autosave retains answers and exact retry identity, then reconnect and reload preserve the saved result', async t => {
  const value = electricalFixture(); value.status = 'draft'; const owner = value.form.fields.find(item => item.key === 'owner_name');
  const h = await loaded(wizard.harness({ record: value })); t.after(() => h.cleanup()); await h.section(owner.section);
  h.answer(owner, 'Changed Synthetic Owner'); h.state.writeError = new Error('Synthetic connection interrupted');
  await h.press('Back'); const failed = h.state.requests.at(-1).body;
  assert.equal(h.select('Assessment section').props.value, owner.section); assert.equal(h.select(owner.label).props.value, 'Changed Synthetic Owner');
  assert.equal(h.state.record.answers.owner_name, 'Sam Owner'); assert.match(h.texts(), /Synthetic connection interrupted/);
  h.state.props.online = false; await loaded(h);
  assert.equal(h.button('Back').props.disabled, true); assert.equal(h.select(owner.label).props.editable, false);
  const writes = h.state.requests.filter(item => item.body).length;
  await h.press('Sign off'); assert.equal(h.select('Assessment section').props.value, owner.section);
  assert.equal(h.state.requests.filter(item => item.body).length, writes);
  assert.equal(h.select(owner.label).props.value, 'Changed Synthetic Owner');
  h.state.props.online = true; h.state.writeError = null; await loaded(h); await h.press('Back');
  assert.equal(h.state.requests.at(-1).body.requestId, failed.requestId); assert.equal(h.state.record.answers.owner_name, 'Changed Synthetic Owner');
  const reopened = await loaded(wizard.harness({ record: h.state.record })); t.after(() => reopened.cleanup());
  await reopened.section(owner.section); assert.equal(reopened.select(owner.label).props.value, 'Changed Synthetic Owner');
  assert.equal(reopened.state.record.signatures.length, 0); assert.equal(reopened.state.record.status, 'draft');
});

test('picker retries actual load/start failures and an existing assessment never starts a duplicate', async t => {
  const h = picker(); t.after(() => h.cleanup()); h.state.loadError = new Error('Assessment service unavailable'); await loaded(h);
  assert.equal(h.button('Add PIESA to this job'), undefined); assert.match(h.texts(), /Assessment service unavailable/);
  h.state.loadError = null; await pressPicker(h, 'Refresh assessment');
  h.state.writeError = new Error('Add request rejected'); await pressPicker(h, 'Add PIESA to this job');
  assert.deepEqual(h.state.opened, []); assert.equal(h.state.changes, 0); assert.match(h.texts(), /Add request rejected/);
  h.state.writeError = null; h.state.writeResponse = { record: { ...record, workOrderId: 'foreign-job' } };
  await pressPicker(h, 'Add PIESA to this job'); assert.deepEqual(h.state.opened, []); assert.match(h.texts(), /could not be verified/);
  h.state.writeResponse = null; await pressPicker(h, 'Add PIESA to this job'); assert.deepEqual(h.state.opened, [record.id]);
  assert.equal(h.button('Add PIESA to this job'), undefined);
  const existing = picker({ response: { records: [record], canManage: true } }); t.after(() => existing.cleanup()); await loaded(existing);
  await pressPicker(existing, 'Open PIESA'); existing.appState('background'); existing.appState('active'); await loaded(existing);
  await pressPicker(existing, 'Open PIESA'); assert.deepEqual(existing.state.opened, [record.id, record.id]);
  assert.equal(existing.state.requests.some(item => item.init.method === 'POST'), false);
});

test('real pad cancellation and disconnect release parent scroll without saving partial or stale signatures', async t => {
  const value = electricalFixture(); value.status = 'draft'; const h = await loaded(wizard.harness({ record: value })); t.after(() => h.cleanup());
  await h.press('Sign off'); consentFor(h, 'property_owner').props.onPress(); h.render();
  const key = 'property_owner'; const pad = draw(padFor(h, key).props); t.after(() => pad.unmount());
  let pan = pad.responder(); pan.onPanResponderGrant(touch(20, 100)); syncPad(h, pad, key); assert.equal(scrollEnabled(h), false);
  pan.onPanResponderMove(touch(100, 150)); pad.render(); pad.pad().props.onTouchCancel(); syncPad(h, pad, key);
  assert.equal(scrollEnabled(h), true); assert.deepEqual(padFor(h, key).props.value.strokes, []);
  pan = pad.responder(); pan.onPanResponderGrant(touch(20, 100)); syncPad(h, pad, key); assert.equal(scrollEnabled(h), false);
  pan.onPanResponderMove(touch(100, 150)); pad.render(); h.state.props.online = false; await loaded(h); syncPad(h, pad, key); h.render();
  assert.equal(scrollEnabled(h), true); assert.equal(padFor(h, key).props.disabled, true);
  pan.onPanResponderMove(touch(200, 70)); pan.onPanResponderRelease(touch(240, 100, 0)); pad.render(); h.render();
  assert.deepEqual(padFor(h, key).props.value.strokes, []); assert.equal(h.state.record.signatures.length, 0);
  assert.equal(h.button('Save owner signature').props.disabled, true);
  assert.equal(h.state.requests.some(item => item.body?.action === 'sign'), false);
});

test('unconfirmed completion cannot show a completed PDF, and a later confirmed completion preserves failed-delivery truth', async t => {
  const value = electricalFixture(); value.status = 'draft'; const h = await loaded(wizard.harness({ record: value })); t.after(() => h.cleanup());
  await h.press('Sign off'); await signWithActualTouch(h, 'property_owner'); await h.press('Finish & email PDF');
  h.state.writeResponse = { record: wizard.presentation(h.state.record), canManage: true }; await h.press('Complete assessment and email PDF');
  const first = h.state.requests.at(-1).body; assert.equal(h.state.record.status, 'draft'); assert.equal(h.state.changed, 0);
  assert.equal(h.button('Save completed assessment PDF on phone'), undefined); assert.match(h.texts(), /Completion was not confirmed/);
  h.state.writeResponse = null; h.state.changedError = new Error('Job refresh unavailable'); await h.press('Complete assessment and email PDF');
  assert.equal(h.state.requests.at(-1).body.requestId, first.requestId); assert.equal(h.state.record.status, 'complete');
  assert.match(h.texts(), /Refresh the job to update its progress/); assert.match(h.texts(), /Customer copy.*accepted/); assert.match(h.texts(), /Business copy.*failed/);
  await h.press('Retry email delivery'); assert.equal(h.state.requests.at(-1).body.action, 'retry_delivery');
  assert.equal(h.state.record.status, 'complete'); assert.match(h.texts(), /Business copy.*failed/, 'Retry acknowledgement alone is never invented inbox delivery');
  assert.ok(h.button('Save completed assessment PDF on phone'));
});

test('completed assessment offers an explicit same-revision job recovery without recreating its report or resending email', async t => {
  const h = await loaded(wizard.harness({ record: electricalFixture() })); t.after(() => h.cleanup());
  assert.ok(h.button('Update job progress')); assert.equal(h.state.requests.some(item => item.body), false, 'GET never performs recovery');
  const saved = structuredClone(h.state.record), snapshot = wizard.presentation(saved);
  const blocked = { changed: false, stage: 'in_progress', blockers: [{ key: 'task:synthetic-task', label: 'Complete the remaining synthetic task.', target: 'forms' }] };
  h.state.writeResponse = { record: { ...snapshot, jobProgress: blocked }, canManage: true }; await h.press('Update job progress');
  const write = h.state.requests.at(-1); assert.equal(write.body.action, 'recover_progress'); assert.equal(write.body.baseRevision, saved.revision);
  assert.equal(write.body.recordId, saved.id); assert.equal(write.init.method, 'POST'); assert.equal(h.state.changed, 1);
  assert.match(h.texts(), /Complete the remaining synthetic task/); assert.doesNotMatch(h.texts(), /Job completed in TLink/);
  assert.ok(h.button('Update job progress')); assert.ok(h.button('Save completed assessment PDF on phone'));
  assert.match(h.texts(), /Customer copy.*accepted/); assert.match(h.texts(), /Business copy.*failed/);
  h.state.writeResponse = { record: { ...snapshot, jobProgress: { changed: true, stage: 'completed', revision: 12, blockers: [] } }, canManage: true };
  await h.press('Update job progress'); assert.match(h.texts(), /Job completed in TLink/); assert.equal(h.button('Update job progress'), undefined);
  assert.equal(h.state.changed, 2); assert.deepEqual(h.state.record, saved, 'Local API fixture never changes the immutable assessment');
  assert.ok(h.state.requests.filter(item => item.body).every(item => item.body.action === 'recover_progress'));
});

test('job progress failures retain the completed PDF and exact recovery retry identity; malformed confirmation is rejected', async t => {
  const h = await loaded(wizard.harness({ record: electricalFixture() })); t.after(() => h.cleanup());
  h.state.writeError = new Error('Job progress service unavailable'); await h.press('Update job progress'); const failed = h.state.requests.at(-1).body;
  assert.match(h.texts(), /Job progress service unavailable/); assert.ok(h.button('Save completed assessment PDF on phone')); assert.equal(h.state.changed, 0);
  h.state.writeError = null; const snapshot = wizard.presentation(h.state.record);
  for (const result of [
    snapshot,
    { ...snapshot, revision: snapshot.revision + 1, jobProgress: { changed: false, stage: 'completed', blockers: [] } },
    { ...snapshot, reportUrl: '/foreign-pdf', jobProgress: { changed: false, stage: 'completed', blockers: [] } },
    { ...snapshot, jobProgress: { changed: false, stage: 'completed', blockers: [{ key: 'bad', label: 'Not a valid blocker', target: 1 }] } },
  ]) {
    h.state.writeResponse = { record: result, canManage: true }; await h.press('Update job progress');
    assert.equal(h.state.requests.at(-1).body.requestId, failed.requestId);
    assert.equal(h.state.changed, 0); assert.ok(h.button('Update job progress')); assert.ok(h.button('Save completed assessment PDF on phone'));
    assert.doesNotMatch(h.texts(), /Job completed in TLink/);
  }
  h.state.writeResponse = { record: { ...snapshot, jobProgress: { changed: false, stage: '', pending: true,
    blockers: [{ key: 'job_progress_pending', label: 'The form is saved. Job status is waiting to sync.', target: 'sync' }] } }, canManage: true };
  await h.press('Update job progress'); assert.match(h.texts(), /Job progress still needs updating/); assert.match(h.texts(), /Job status is waiting to sync/);
  assert.equal(h.state.changed, 1); assert.ok(h.button('Update job progress')); assert.ok(h.button('Save completed assessment PDF on phone'));
});

test('job progress recovery retains permission, connectivity and completed-stage guards without automatic writes', async t => {
  for (const canManage of [false, true]) {
    const h = await loaded(wizard.harness({ record: electricalFixture(), canManage })); t.after(() => h.cleanup());
    assert.equal(Boolean(h.button('Update job progress')), canManage);
    assert.equal(h.state.requests.some(item => item.body), false);
    if (canManage) { h.state.props.online = false; await loaded(h); assert.equal(h.button('Update job progress').props.disabled, true); }
  }
  for (const stage of ['completed', 'cancelled']) {
    const value = electricalFixture(), h = wizard.harness({ record: value }); t.after(() => h.cleanup());
    h.state.loadResponse = { record: { ...wizard.presentation(value), jobProgress: { changed: false, stage, blockers: [] } }, canManage: true };
    await loaded(h); assert.equal(h.button('Update job progress'), undefined); assert.ok(h.button('Save completed assessment PDF on phone'));
    assert.equal(h.state.requests.some(item => item.body), false);
  }
});
