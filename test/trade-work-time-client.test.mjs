import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { WorkTimeRecorder, WorkTimeQueue, WORK_TIME_IDLE_MS, parseStoredWorkTime, workTimePageKey } from '../src/lib/trade-work-time-client.ts';

const start = Date.parse('2026-10-02T00:00:00.000Z');
const app = { kind: 'app', formKind: '', formId: '', workOrderId: '', pageKey: '', pageTitle: '' };
const form = { kind: 'form', formKind: 'job_form', formId: 'form-1', workOrderId: 'job-1', pageKey: 'site-check', pageTitle: 'Site check' };
function fixture() {
  let now = start;
  let id = 0;
  const emitted = [];
  const opened = [];
  const recorder = new WorkTimeRecorder({ source: 'native', now: () => now, uuid: () => `session-${++id}`, emit: value => {
    if (value.startedAt === value.endedAt) opened.push(value); else emitted.push(value);
  } });
  return { recorder, emitted, opened, advance: ms => { now += ms; }, setTime: value => { now = value; } };
}

test('each page opening is retained immediately even when the camera backgrounds the app before a heartbeat', () => {
  const f = fixture();
  f.recorder.setContext('form', form); f.recorder.setForeground(true);
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0].startedAt, new Date(start).toISOString());
  assert.equal(f.opened[0].endedAt, f.opened[0].startedAt);
  f.recorder.setForeground(false);
  f.advance(600_000); f.recorder.setForeground(true);
  assert.equal(f.opened[1].pageKey, form.pageKey, 'resume preserves page identity for elapsed-time grouping');
  assert.equal(f.opened[1].startedAt, new Date(start + 600_000).toISOString());
  f.recorder.setContext('form', { ...form, pageKey: 'after-photo', pageTitle: 'After photo' });
  assert.equal(f.opened[2].pageKey, 'after-photo');
});

test('foreground spans update the same identity and background time is excluded', () => {
  const f = fixture();
  f.recorder.setContext('app', app);
  f.recorder.setForeground(true);
  f.advance(30_000); f.recorder.checkpoint();
  f.advance(12_000); f.recorder.setForeground(false);
  assert.equal(f.emitted[0].id, f.emitted[1].id);
  assert.equal(f.emitted[1].endedAt, new Date(start + 42_000).toISOString());
  f.advance(300_000); f.recorder.checkpoint();
  assert.equal(f.emitted.length, 2);
  f.recorder.setForeground(true);
  f.advance(30_000); f.recorder.checkpoint();
  assert.notEqual(f.emitted[2].id, f.emitted[0].id);
  assert.equal(f.emitted[2].startedAt, new Date(start + 342_000).toISOString());
});

test('idle boundary is exact even when a suspended timer wakes late', () => {
  const f = fixture();
  f.recorder.setContext('form', form); f.recorder.setForeground(true);
  f.advance(7 * 60_000); f.recorder.checkpoint();
  assert.equal(f.emitted[0].endedAt, new Date(start + WORK_TIME_IDLE_MS).toISOString());
  f.recorder.activity(); f.advance(10_000); f.recorder.checkpoint();
  assert.notEqual(f.emitted[1].id, f.emitted[0].id);
  assert.equal(f.emitted[1].startedAt, new Date(start + 7 * 60_000).toISOString());
});

test('ordinary input extends activity without a durable write for every keystroke', () => {
  const f = fixture();
  f.recorder.setContext('app', app); f.recorder.setForeground(true);
  for (let i = 0; i < 250; i++) { f.advance(100); f.recorder.activity(); }
  assert.equal(f.emitted.length, 0);
  f.recorder.checkpoint();
  assert.equal(f.emitted.length, 1);
  assert.equal(Date.parse(f.emitted[0].endedAt) - start, 25_000);
});

test('form exit stops its span and job switches retain the previous app attribution', () => {
  const f = fixture();
  f.recorder.setContext('app', { ...app, workOrderId: 'job-1' });
  f.recorder.setContext('form', form); f.recorder.setForeground(true);
  f.advance(20_000); f.recorder.setContext('form', null);
  f.advance(10_000); f.recorder.setContext('app', { ...app, workOrderId: 'job-2' });
  f.advance(15_000); f.recorder.checkpoint();
  const forms = f.emitted.filter(value => value.kind === 'form');
  assert.equal(forms.length, 1);
  assert.equal(Date.parse(forms[0].endedAt) - start, 20_000);
  assert.equal(f.emitted.at(-1).workOrderId, 'job-2');
  assert.equal(Date.parse(f.emitted.at(-1).startedAt) - start, 30_000);
});

test('page changes close exact spans and revisits accumulate without counting a different form', () => {
  const f = fixture();
  f.recorder.setContext('form', form); f.recorder.setForeground(true);
  f.advance(15_000); f.recorder.setContext('form', { ...form, pageKey: 'photos', pageTitle: 'Photos' });
  f.advance(25_000); f.recorder.setContext('form', form);
  f.advance(10_000); f.recorder.setContext('form', { ...form, formId: 'form-2' });
  f.advance(5_000); f.recorder.setContext('form', null);
  assert.equal(new Set(f.emitted.map(item => item.id)).size, 4);
  const totals = new Map();
  for (const item of f.emitted) {
    const key = `${item.formId}:${item.pageKey}`;
    totals.set(key, (totals.get(key) || 0) + Date.parse(item.endedAt) - Date.parse(item.startedAt));
  }
  assert.equal(totals.get('form-1:site-check'), 25_000);
  assert.equal(totals.get('form-1:photos'), 25_000);
  assert.equal(totals.get('form-2:site-check'), 5_000);
  assert.equal(f.emitted[1].startedAt, f.emitted[0].endedAt);
});

test('long page keys remain bounded and preserve distinguishing suffixes', () => {
  const prefix = 'long-section-key:'.repeat(15);
  assert.ok(workTimePageKey(prefix + 'a').length <= 180);
  assert.notEqual(workTimePageKey(prefix + 'a'), workTimePageKey(prefix + 'b'));
  assert.equal(workTimePageKey('field.site_address'), 'field.site_address');
});

test('continuous interaction rolls sessions at 24 hours and never emits a longer span', () => {
  const f = fixture();
  f.recorder.setContext('app', app); f.recorder.setForeground(true);
  for (let minute = 0; minute < 1441; minute++) {
    f.advance(60_000); f.recorder.activity(); f.recorder.checkpoint();
  }
  assert.equal(new Set(f.emitted.map(item => item.id)).size, 2);
  assert.ok(f.emitted.every(item => Date.parse(item.endedAt) - Date.parse(item.startedAt) <= 86_400_000));
  assert.equal(f.emitted.at(-1).startedAt, new Date(start + 86_400_000).toISOString());
});

function queueFixture({ send = async () => {}, canSend = () => true, store = new Map() } = {}) {
  const messages = [];
  const storage = { list: async () => [...store.values()], put: async item => { store.set(item.id, structuredClone(item)); }, remove: async id => { store.delete(id); } };
  const queue = new WorkTimeQueue({ storage, send, canSend, status: value => messages.push(value), now: () => start + 60_000 });
  return { queue, messages, store, storage };
}
const interval = (seconds = 30) => ({ ...form, source: 'native', id: 'session-1', startedAt: new Date(start).toISOString(), endedAt: new Date(start + seconds * 1000).toISOString() });

test('offline queue coalesces by session and survives recorder recreation', async () => {
  const store = new Map();
  const offline = queueFixture({ store, canSend: () => false });
  offline.queue.enqueue(interval()); offline.queue.enqueue(interval(60));
  await new Promise(resolve => setImmediate(resolve));
  await offline.queue.flush();
  assert.equal(store.size, 1);
  assert.equal(store.get('session-1').endedAt, interval(60).endedAt);
  const sent = [];
  const restored = queueFixture({ store, send: async batch => { sent.push(batch); } });
  await restored.queue.flush();
  assert.equal(sent[0][0].startedAt, interval().startedAt, 'observed timestamps are not replaced by sync time');
  assert.equal(store.size, 0);
});

test('an older in-flight receipt cannot delete an interval extended during upload', async () => {
  let release;
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const f = queueFixture({ send: async () => { entered(); await new Promise(resolve => { release = resolve; }); } });
  f.queue.enqueue(interval());
  const flushing = f.queue.flush(); await began;
  f.queue.enqueue(interval(60)); release(); await flushing;
  assert.equal(f.store.get('session-1').endedAt, interval(60).endedAt);
});

test('failed delivery preserves durable data and the retry is idempotent', async () => {
  let failing = true;
  const batches = [];
  const f = queueFixture({ send: async batch => { batches.push(batch); if (failing) throw new Error('offline'); } });
  f.queue.enqueue(interval()); await f.queue.flush();
  assert.equal(f.store.size, 1); assert.match(f.messages.at(-1), /waiting to sync/);
  failing = false; await f.queue.flush();
  assert.deepEqual(batches[0], batches[1]); assert.equal(f.store.size, 0);
});

test('scope loss during loading prevents sending under another account', async () => {
  let allowed = true;
  let sends = 0;
  const queue = new WorkTimeQueue({ storage: { list: async () => { allowed = false; return [interval()]; }, put: async () => {}, remove: async () => {} },
    canSend: () => allowed, send: async () => { sends++; }, status: () => {}, now: () => start });
  await queue.flush(); assert.equal(sends, 0);
});

test('old offline intervals remain locally available while newer intervals can sync', async () => {
  const f = queueFixture();
  f.store.set('too-old', { ...interval(), id: 'too-old', startedAt: new Date(start - 15 * 86_400_000).toISOString() });
  f.queue.enqueue(interval()); await f.queue.flush();
  assert.equal(f.store.size, 1); assert.ok(f.store.has('too-old')); assert.match(f.messages.at(-1), /older than 14 days/);
});

test('local queue decoder rejects invalid structures and times', () => {
  for (const value of [null, 'garbage', '{}', JSON.stringify({ ...interval(), endedAt: 'yesterday' })]) assert.equal(parseStoredWorkTime(value), null);
  assert.deepEqual(parseStoredWorkTime(JSON.stringify(interval())), interval());
});

test('successful completion records the observed finish even while backgrounded and never resumes the completed form', () => {
  const f = fixture();
  f.recorder.setContext('app', app); f.recorder.setContext('form', form); f.recorder.setForeground(true);
  f.advance(10_000); f.recorder.setForeground(false);
  f.advance(600_000); f.recorder.completeForm(form);
  const marker = f.opened.find(value => value.completedAt);
  assert.equal(marker.completedAt, new Date(start + 610_000).toISOString());
  assert.equal(marker.startedAt, marker.endedAt);
  assert.equal(marker.completedAt, marker.endedAt);
  assert.notEqual(marker.id, f.opened[1].id);
  f.recorder.setForeground(true); f.advance(30_000); f.recorder.checkpoint();
  assert.equal(f.emitted.filter(value => value.kind === 'form').length, 1);
  assert.equal(f.emitted.at(-1).kind, 'app', 'App usage continues after form completion');
});

test('offline completion survives storage and later sync without replacing the observed finish', async () => {
  const observed = new Date(start).toISOString();
  const marker = { ...interval(0), completedAt: observed };
  assert.deepEqual(parseStoredWorkTime(JSON.stringify(marker)), marker);
  assert.equal(parseStoredWorkTime(JSON.stringify({ ...marker, completedAt: new Date(start + 1000).toISOString() })), null);
  assert.equal(parseStoredWorkTime(JSON.stringify({ ...marker, kind: 'app' })), null);
  const store = new Map();
  const offline = queueFixture({ store, canSend: () => false });
  offline.queue.enqueue(marker); await new Promise(resolve => setImmediate(resolve));
  const sent = [];
  const restored = queueFixture({ store, send: async batch => sent.push(...batch) });
  await restored.queue.flush();
  assert.equal(sent[0].completedAt, observed);
  assert.equal(store.size, 0);
});

test('optional SWMS page and completion timing survives the shared web and native offline queue', async () => {
  const entry = { ...interval(0), formKind: 'swms', formId: 'swms-1', pageKey: 'controls', pageTitle: 'Risk controls', completedAt: new Date(start).toISOString() };
  const store = new Map();
  const offline = queueFixture({ store, canSend: () => false });
  offline.queue.enqueue(entry);
  await new Promise(resolve => setImmediate(resolve));
  const restored = parseStoredWorkTime(JSON.stringify(store.get(entry.id)));
  assert.deepEqual(restored, entry);
  const sent = [];
  const online = queueFixture({ store: new Map([[entry.id, restored]]), send: async batch => sent.push(...batch) });
  await online.queue.flush();
  assert.deepEqual(sent, [entry]);
  assert.equal(online.store.size, 0);
});

function trackingHook(path, native = false) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hook = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useFormTimeTracking');
  const code = ts.transpileModule(hook.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = [], cleanups = [], completions = [];
  const effect = callback => { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); };
  const dependencies = { Context: {}, useContext: () => ({ form: (...args) => calls.push(args), complete: value => completions.push(value), activity: () => {} }), useRef: value => ({ current: value }), useCallback: callback => callback,
    ...(native ? { useFocusEffect: effect } : { useEffect: effect }), workTimePageKey };
  const exports = {};
  new Function('exports', ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
  return { hook: exports.useFormTimeTracking, calls, cleanups, completions };
}

for (const [platform, path, native] of [['web', '../src/components/TradeWorkTimeTracking.tsx', false], ['native', '../mobile/src/components/work-time-tracking.tsx', true]]) {
  test(`${platform} form hook excludes review-only and closed forms and clears only its own form`, () => {
    const f = trackingHook(path, native);
    f.hook({ ...form, enabled: false });
    assert.equal(f.calls.length, 0);
    f.cleanups.pop()();
    assert.deepEqual(f.calls.pop(), [null, form.formId]);
    f.hook({ ...form, enabled: true });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][0].pageKey, form.pageKey);
    assert.equal(f.calls[0][0].formId, form.formId);
    f.cleanups.pop()();
    assert.deepEqual(f.calls.at(-1), [null, form.formId]);
  });
  test(`${platform} completion is explicit, idempotent, and prevents stale editor activation`, () => {
    const f = trackingHook(path, native);
    const timing = f.hook({ ...form, enabled: true });
    assert.equal(f.completions.length, 0);
    timing.markCompleted(); timing.markCompleted();
    assert.equal(f.completions.length, 1);
    assert.equal(f.completions[0].formId, form.formId);
    const calls = f.calls.length;
    if (!native) timing.bind.onFocusCapture();
    assert.equal(f.calls.length, calls);
  });
}

test('a multi-form web list starts timing only the editor the user focuses', () => {
  const f = trackingHook('../src/components/TradeWorkTimeTracking.tsx');
  const events = f.hook({ ...form, enabled: true, activateOnOpen: false });
  assert.equal(f.calls.length, 0);
  events.bind.onFocusCapture();
  assert.equal(f.calls[0][0].formId, form.formId);
});

function editorFunction(path, name, environment) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let target;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) target = node; ts.forEachChild(node, visit); };
  visit(source);
  assert.ok(target, `${name} exists in the actual editor`);
  const code = ts.transpileModule(target.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(environment), `${code}; return ${name};`)(...Object.values(environment));
}

test('web supporting form observes completion only after a successful complete save', async () => {
  let accepted = false;
  const calls = [];
  const complete = editorFunction('../src/components/TradeJobFormsPanel.tsx', 'completeForm', {
    form: { id: 'form-1', revision: 4 }, answers: {},
    onSave: async (...args) => { calls.push(args); return accepted; }, timing: { markCompleted: () => calls.push('completed') },
  });
  await complete(); assert.equal(calls.includes('completed'), false);
  accepted = true; await complete();
  assert.equal(calls.at(-1), 'completed');
  assert.equal(calls[1][3], true);
});

test('native activity finish observes completion after durable local acceptance and never on a failed local save', async () => {
  let fail = true;
  const events = [];
  const finish = editorFunction('../mobile/src/components/ActivityFieldFormWizard.tsx', 'finishImmediately', {
    cacheRef: { current: { record: { id: 'record-1' } } },
    remember: async () => { if (fail) throw new Error('Storage full'); events.push('durable'); },
    timing: { markCompleted: () => events.push('completed') }, onReturnToJob: () => events.push('exit'),
    processActivityFormCompletionQueue: async () => events.push('sync'), cacheKey: 'scoped-cache', onChanged: async () => {},
    setError: () => events.push('error'),
  });
  await finish(); assert.deepEqual(events, ['error']);
  fail = false; events.length = 0; await finish();
  assert.deepEqual(events.slice(0, 3), ['durable', 'completed', 'exit']);
});
