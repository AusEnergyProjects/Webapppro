import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
const source = fs.readFileSync(new URL('../src/components/TradeQuoteProductDocuments.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node, match) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, match)) : [...(match(node) ? [node] : []), ...nodes(node.props?.children, match)];
test('complete PDF viewer retries failed requests, exposes download and removes stale cross-job assets', async t => {
  const state = [], effects = [], pending = [], revoked = [], requests = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useEffect(callback, deps) { const index = cursor++, old = effects[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); effects[index] = { deps }; pending.push(() => { effects[index].cleanup = callback(); }); } },
  };
  const fetch = async (url, init) => { requests.push({ url, init }); if (requests.length === 1) return { ok: false, json: async () => ({ error: 'Storage temporarily unavailable' }) }; return { ok: true, blob: async () => new Blob(['%PDF-test'], { type: 'application/pdf' }) }; };
  const exports = {};
  Function('require', 'exports', 'fetch', 'URL', compiled)(id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? jsx : { default: {} }, exports, fetch, { createObjectURL: () => 'blob:private-quote', revokeObjectURL: url => revoked.push(url) });
  const props = { user: { uid: 'owner', getIdToken: async () => 'owner-token' }, workOrderId: 'job-one', versionId: 'version-one', expectedUpdatedAt: 'revision-one', dirty: false, revisionKey: 'documents-one' };
  const render = () => { cursor = 0; const tree = exports.QuoteCompletePdfPreview(props); for (const work of pending.splice(0)) work(); return tree; };
  const settle = async () => { let tree; for (let i = 0; i < 4; i++) { tree = render(); await new Promise(resolve => setImmediate(resolve)); } return tree; };
  t.after(() => effects.forEach(effect => effect?.cleanup?.()));
  let tree = render(); nodes(tree, node => node.type === 'button')[0].props.onClick(); tree = await settle();
  assert.equal(nodes(tree, node => node.props?.role === 'alert')[0].props.children, 'Storage temporarily unavailable');
  nodes(tree, node => node.type === 'button')[0].props.onClick(); tree = await settle();
  assert.equal(requests.length, 2); assert.match(requests[1].url, /expectedUpdatedAt=revision-one/);
  assert.equal(requests[1].init.headers.Authorization, 'Bearer owner-token');
  assert.equal(nodes(tree, node => node.type === 'a' && node.props.download)[0].props.href, 'blob:private-quote');
  assert.equal(nodes(tree, node => node.type === 'iframe').length, 1);
  props.workOrderId = 'job-two'; tree = render();
  assert.equal(nodes(tree, node => node.type === 'iframe').length, 0); assert.deepEqual(revoked, ['blob:private-quote']);
  props.dirty = true; tree = render(); assert.equal(nodes(tree, node => node.type === 'button').length, 0);
});
