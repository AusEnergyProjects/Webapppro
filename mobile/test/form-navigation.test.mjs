import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const rental = readFileSync(new URL('../src/components/rental-inspection-workflow.tsx', import.meta.url), 'utf8');
const job = readFileSync(new URL('../src/app/job/[id].tsx', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../src/components/ActivityFieldFormWizard.tsx', import.meta.url), 'utf8');
const workPack = readFileSync(new URL('../src/components/ActivityWorkPackWizard.tsx', import.meta.url), 'utf8');

function methods(source, componentName, names, environment) {
  const file = ts.createSourceFile('form.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === componentName);
  assert.ok(component, componentName);
  const declarations = component.body.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text));
  assert.equal(declarations.length, names.length);
  const code = ts.transpileModule(declarations.map((statement) => statement.getText(file)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function('environment', `with (environment) { ${code}; return { ${names.join(', ')} }; }`)(environment);
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('rental system back and fixed header use the same sections-first handler for saved and dirty forms', () => {
  assert.match(rental, /usePreventRemove\(true, \(\) => backToSectionsOrJob\(\)\)/);
  assert.match(rental, /accessibilityLabel=\{page === 'categories' \? 'Back to job' : 'Back to assessment sections'\}/);
  assert.match(rental, /onPress=\{backToSectionsOrJob\}/);
  assert.doesNotMatch(rental, /navigation\.dispatch|usePreventRemove\(Boolean\(busy\) \|\| hasDraft/);
});

test('every rental question, metadata, review and recovery page returns to sections without upload or discard', async () => {
  for (const page of ['answer', 'details', 'finding', 'safety', 'metadata', 'review', 'earlier']) {
    const draft = { answer: 'working', photos: Array.from({ length: 50 }, (_, id) => ({ uri: `local-photo-${id}` })) };
    const environment = {
      page, busyRef: { current: false }, draft,
      leave() { assert.fail('Question back must not leave the form'); },
    };
    environment.setPage = (next) => { environment.page = next; };
    const subject = methods(rental, 'RentalInspectionWorkflow', ['backToSectionsOrJob'], environment);
    subject.backToSectionsOrJob();
    assert.equal(environment.page, 'categories');
    assert.equal(environment.draft, draft);
    assert.equal(draft.photos.length, 50);
    await settle();
  }
});

test('second rental back waits only for durable draft storage before returning to the job', async () => {
  const calls = [];
  let stored;
  const storage = new Promise((resolve) => { stored = resolve; });
  const environment = {
    page: 'categories', busyRef: { current: false },
    perform: async (_label, action) => action(),
    persist: () => { calls.push('save draft'); return storage; },
    onReturnToJob: () => calls.push('job'),
  };
  const subject = methods(rental, 'RentalInspectionWorkflow', ['leave', 'backToSectionsOrJob'], environment);
  subject.backToSectionsOrJob();
  assert.deepEqual(calls, ['save draft']);
  stored(); await settle();
  assert.deepEqual(calls, ['save draft', 'job']);
});

test('rental local-storage failure leaves the form and its photos available for recovery', async () => {
  const errors = [];
  const environment = {
    busyRef: { current: false }, mounted: { current: true }, setBusy() {}, setError: (error) => errors.push(error),
    persist: async () => { throw new Error('Local storage full'); },
    onReturnToJob: () => assert.fail('Must not unmount a draft that failed to save'),
  };
  const subject = methods(rental, 'RentalInspectionWorkflow', ['perform', 'leave'], environment);
  await subject.leave();
  assert.ok(errors.includes('Local storage full'));
});

test('supporting forms return to their question list before saving and returning to the job', async () => {
  const calls = [];
  const answers = { heating: 'working' };
  const environment = {
    overview: false, busy: false, leaving: { current: false }, dirty: true, answers, form: { id: 'form-1' },
    setOverview: (value) => { environment.overview = value; },
    onSave: async (form, values, complete) => { calls.push('save'); assert.equal(values, answers); assert.equal(complete, false); },
    onReturnToJob: () => calls.push('job'),
    Alert: { alert: () => assert.fail('No error expected') },
  };
  const subject = methods(job, 'JobFieldForm', ['leave', 'backToSectionsOrJob'], environment);
  subject.backToSectionsOrJob();
  assert.equal(environment.overview, true);
  assert.deepEqual(calls, []);
  subject.backToSectionsOrJob(); await settle();
  assert.deepEqual(calls, ['save', 'job']);
  assert.match(job, /usePreventRemove\(true, \(\) => backToSectionsOrJob\(\)\)/);
});

test('a failed supporting-form save retains the question list and answers', async () => {
  const errors = [];
  const environment = {
    busy: false, leaving: { current: false }, dirty: true, answers: { condition: 'working' }, form: { id: 'form-1' },
    onSave: async () => { throw new Error('Storage unavailable'); },
    onReturnToJob: () => assert.fail('Must not leave after a failed local save'),
    Alert: { alert: (_title, error) => errors.push(error) },
  };
  const subject = methods(job, 'JobFieldForm', ['leave'], environment);
  await subject.leave();
  assert.deepEqual(errors, ['Storage unavailable']);
  assert.equal(environment.leaving.current, false);
});

test('work-pack native back opens its sections and preserves pending local patches before leaving', async () => {
  const calls = [];
  const environment = {
    overview: false, busy: '', leaving: { current: false }, saveTimer: { current: null },
    setOverview: (value) => { environment.overview = value; }, setOpen: (value) => calls.push(['open', value]),
    run: async (action) => action(), flushDirty: async () => calls.push('save patches'), onReturnToJob: () => calls.push('job'),
  };
  const subject = methods(workPack, 'ActivityWorkPackWizard', ['leave', 'backToSectionsOrJob'], environment);
  subject.backToSectionsOrJob();
  assert.deepEqual(calls, [['open', true]]);
  subject.backToSectionsOrJob(); await settle();
  assert.deepEqual(calls, [['open', true], 'save patches', 'job']);
  assert.match(workPack, /usePreventRemove\(true, \(\) => backToSectionsOrJob\(\)\)/);
});

test('activity form returns to the job after local storage without waiting for a stalled upload or refresh', async () => {
  const calls = [];
  const environment = {
    writes: { current: Promise.resolve() }, syncs: { current: new Promise(() => {}) },
    onReturnToJob: () => calls.push('job'), onChanged: () => { calls.push('refresh'); return new Promise(() => {}); },
  };
  const subject = methods(activity, 'ActivityFieldFormWizard', ['leave'], environment);
  await subject.leave();
  assert.deepEqual(calls, ['job', 'refresh']);
});
