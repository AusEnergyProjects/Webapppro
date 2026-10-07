import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as formClient from '../src/lib/wattzun-form-client.ts';
import * as jsx from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/TradeActivityWorkPackPanel.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(`${source}\nexport { WorkPack };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = (node, check) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap((child) => nodes(child, check)) : [...(check(node) ? [node] : []), ...nodes(node.props?.children, check)];
const content = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : content(node?.props?.children || '');
const basePack = () => ({ instance: { id: 'revision-1', instanceKey: 'pack', workOrderId: 'job', responseSha256: '1'.repeat(64), status: 'in_progress', activityDate: '2026-09-30' },
  definition: { title: 'Shared activity', version: 1, schema: { dependencies: [], signerRoles: [], sections: [
    { sectionKey: 'work', title: 'Work', order: 1, prompts: [{ promptKey: 'model', type: 'text' }, { promptKey: 'note', type: 'text' }] },
  ] } }, response: { answers: {}, repeatableSections: {}, dependencyResolutions: {} }, completion: { blockers: [{ key: 'model' }] } });
const revision = (id, answers) => ({ ...basePack(), instance: { ...basePack().instance, id: `revision-${id}`, responseSha256: String(id).repeat(64) },
  response: { ...basePack().response, answers } });
const reply = (pack) => ({ ok: true, json: async () => ({ result: { projection: pack } }) });
const conflictReply = (id, mergedPatches = []) => ({ ok: false, json: async () => ({ code: 'WORK_PACK_ANSWER_CONFLICT', error: 'Conflicting model',
  currentInstance: { id: `revision-${id}`, responseSha256: String(id).repeat(64) }, mergedPatches,
  conflicts: [{ sectionKey: 'work', promptKey: 'model', label: 'Model', base: null, local: 'Mine', saved: 'Saved' }] }) });

function harness(responder, latest = revision(2, { model: 'Saved' })) {
  const slots = [], effects = [], callbacks = [], pending = [], timers = new Map(), requests = [];
  let cursor = 0, timerId = 0, reloads = 0; const listeners = new Map();
  const changed = (prior, next) => !prior || next.some((value, index) => prior[index] !== value);
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn, deps) { const i = cursor++; if (changed(callbacks[i]?.deps, deps)) callbacks[i] = { fn, deps }; return callbacks[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (changed(effects[i]?.deps, deps)) { effects[i] = { deps }; pending.push(fn); } },
  };
  const exports = {};
  const fetch = async (_url, init) => { const payload = JSON.parse(init.body); requests.push(payload); return responder(payload, requests.length); };
  const imports = (name) => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx
    : name === './TradeBusinessProvider' ? { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => ({ ownerUid: 'business' }) }
    : name === '@/lib/wattzun-form-client' ? formClient
    : name === './WattzunFormAssistButton' ? { WattzunFormAssistButton: () => null }
    : name === './TradeWorkTimeTracking' ? { useFormTimeTracking: () => ({ bind: {}, markCompleted() {} }), WorkTimeStatus: () => null }
    : name === '@/lib/creditex-activity-work-pack' ? { creditexActivityWorkPackVisibilityMatches: () => true,
      creditexActivityWorkPackCompletion: () => ({ blockers: [{ key: 'model' }], ready: false }) }
    : name.endsWith('.module.css') ? { default: {} } : {};
  Function('require', 'exports', 'window', 'setTimeout', 'clearTimeout', compiled)(imports, exports,
    { localStorage: { getItem: () => 'fixture-browser-device', setItem() {} }, addEventListener(name, handler) { listeners.set(name, handler); }, removeEventListener(name) { listeners.delete(name); } },
    (fn) => { const id = ++timerId; timers.set(id, fn); return id; }, (id) => timers.delete(id));
  const props = { user: { getIdToken: async () => 'token' }, initialPack: basePack(), readOnly: false, initiallyOpen: true,
    onReplace() {}, onReload: async () => { reloads++; return [latest]; } };
  const render = () => { cursor = 0; const tree = exports.WorkPack(props); pending.splice(0).forEach((fn) => fn()); return tree; };
  return { requests, render,
    async assist() { return nodes(render(), node => node.type?.name === 'WattzunFormAssistButton')[0].props.beforeOpen(); },
    answers() { return nodes(render(), node => node.type?.name === 'SectionPage')[0].props.pack.response.answers; },
    reloads() { return reloads; },
    setLatest(value) { latest = value; },
    saved(detail = {}) { listeners.get(formClient.WATTZUN_FORM_SAVED_EVENT)?.(new CustomEvent(formClient.WATTZUN_FORM_SAVED_EVENT, { detail: { portal: 'trade', scopeId: 'business', formKind: 'work_pack', formId: 'revision-1', jobId: 'job', ...detail } })); },
    change(key, value) { nodes(render(), (node) => node.type?.name === 'SectionPage')[0].props.onChange('', key, value); render(); },
    click(label) { const button = nodes(render(), (node) => node.type === 'button' && content(node) === label)[0]; assert.ok(button, label); button.props.onClick(); render(); },
    advance() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); },
    async settle() { for (let i = 0; i < 12; i++) { await new Promise((resolve) => setImmediate(resolve)); render(); } },
  };
}

test('choosing a conflicting web answer saves against the reviewed revision', async () => {
  const h = harness((_payload, attempt) => attempt === 1 ? conflictReply(2) : reply(revision(3, { model: 'Mine' })));
  h.change('model', 'Mine'); h.advance(); await h.settle();
  h.click('Use my answer'); h.advance(); await h.settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].caseInstanceId, 'revision-2');
  assert.deepEqual(h.requests[1].sectionPatches[0].answers, { model: 'Mine' });
});

test('check latest changes retries the original draft when a conflict snapshot changed again', async () => {
  const h = harness((_payload, attempt) => conflictReply(attempt === 1 ? 2 : 3), revision(3, { model: 'Saved' }));
  h.change('model', 'Mine'); h.advance(); await h.settle();
  h.click('Check latest changes'); await h.settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].caseInstanceId, 'revision-1');
  h.click('Use saved answer');
});

test('an edit made during a rejected save is rechecked and retained through conflict resolution', async () => {
  let release;
  const h = harness((_payload, attempt) => attempt === 1 ? new Promise((resolve) => { release = resolve; })
    : attempt === 2 ? conflictReply(2, [{ sectionKey: 'work', answers: { note: 'Typed while saving' } }])
      : reply(revision(3, { model: 'Saved', note: 'Typed while saving' })));
  h.change('model', 'Mine'); h.advance(); await h.settle();
  h.change('note', 'Typed while saving'); release(conflictReply(2)); await h.settle();
  h.advance(); await h.settle();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].sectionPatches[0].answers, { model: 'Mine', note: 'Typed while saving' });
  h.click('Use saved answer'); h.advance(); await h.settle();
  assert.deepEqual(h.requests[2].sectionPatches[0].answers, { note: 'Typed while saving' });
});


test('work pack assistant flushes canonical autosave and selects its new saved instance id', async () => {
  const h = harness(() => reply(revision(2, { model: 'Manual model' })));
  h.change('model', 'Manual model');
  assert.equal(await h.assist(), 'revision-2');
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].action, 'work_pack_commit');
  assert.deepEqual(h.requests[0].sectionPatches[0].answers, { model: 'Manual model' });
});

test('work pack assistant refuses unsaved answers after a failed autosave', async () => {
  const h = harness(() => ({ ok: false, json: async () => ({ error: 'Save unavailable' }) }));
  h.change('model', 'Keep this draft'); assert.equal(await h.assist(), null);
  assert.deepEqual(h.answers(), { model: 'Keep this draft' });
});

test('confirmed assistant save refreshes only the scoped work pack using its stable instance key', async () => {
  const h = harness(() => reply(revision(2, {})), revision(2, { model: 'Wattzun answer' }));
  h.render(); h.saved({ scopeId: 'other-business' }); await h.settle(); assert.equal(h.reloads(), 0);
  h.saved({ formId: 'other-form' }); await h.settle(); assert.equal(h.reloads(), 0);
  h.saved(); await h.settle(); assert.equal(h.reloads(), 1); assert.deepEqual(h.answers(), { model: 'Wattzun answer' });
});

test('assistant refresh waits while a work pack has a newer manual draft', async () => {
  const h = harness(() => ({ ok: false, json: async () => ({ error: 'Save unavailable' }) }), revision(2, { model: 'Saved answer' }));
  h.change('model', 'New manual draft'); h.saved(); await h.settle();
  assert.equal(h.reloads(), 0); assert.deepEqual(h.answers(), { model: 'New manual draft' });
});

test('successive assistant saves refresh the same work pack through its originally selected revision', async () => {
  const h = harness(() => reply(revision(2, {})), revision(2, { model: 'First answer' }));
  h.render(); h.saved(); await h.settle();
  assert.deepEqual(h.answers(), { model: 'First answer' });
  h.setLatest(revision(3, { model: 'First answer', note: 'Second answer' }));
  h.saved(); await h.settle();
  assert.equal(h.reloads(), 2); assert.deepEqual(h.answers(), { model: 'First answer', note: 'Second answer' });
  h.setLatest(revision(4, { model: 'Updated answer', note: 'Second answer' }));
  h.saved({ formId: 'revision-2' }); await h.settle();
  assert.equal(h.reloads(), 3); assert.deepEqual(h.answers(), { model: 'Updated answer', note: 'Second answer' });
  h.saved({ formId: 'unseen-revision' }); h.saved({ jobId: 'other-job' }); await h.settle();
  assert.equal(h.reloads(), 3);
});
