import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { requestWithCreditexTokenRecovery } from '../src/lib/creditex-auth-token.ts';

// Execute the actual portal request callback, including its token-recovery boundary.
const source = fs.readFileSync(new URL('../src/components/CreditexCompliancePortal.tsx', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('  const api = useCallback('), source.indexOf('  const downloadOfficialSource = useCallback('));
const compiled = ts.transpileModule(callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(fetch, getIdToken = async () => 'test-token') {
  const timers = new Map(); let id = 0;
  const window = { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); } };
  const api = Function('useCallback', 'firebaseAuth', 'requestWithCreditexTokenRecovery', 'fetch', 'window', 'setLoadingMessage', `${compiled}\nreturn api;`)(
    fn => fn, { currentUser: { uid: 'test-user', getIdToken } }, requestWithCreditexTokenRecovery, fetch, window, () => {},
  );
  return { api, timers, expire() { for (const fn of [...timers.values()]) fn(); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('superseding a request aborts its fetch without reporting a service timeout', async () => {
  let requestSignal;
  const h = harness(async (_path, init) => new Promise((_resolve, reject) => {
    requestSignal = init.signal;
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  const caller = new AbortController();
  const pending = h.api('/api/creditex/job-intents', { signal: caller.signal });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError' && !/20 seconds/.test(error.message));
  await flush(); caller.abort(); await rejected;
  assert.equal(requestSignal.aborted, true); assert.equal(h.timers.size, 0);
});

test('cancellation during token loading prevents a superseded HTTP request', async () => {
  let release; let calls = 0;
  const h = harness(async () => { calls++; }, () => new Promise(resolve => { release = resolve; }));
  const caller = new AbortController(); const pending = h.api('/api/creditex/job-intents', { signal: caller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  caller.abort(); release('test-token'); await rejected; assert.equal(calls, 0);
});

test('timeout covers response-body loading and stays distinct from caller cancellation', async () => {
  const h = harness(async (_path, init) => ({ status: 200, ok: true, json: () => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }) }));
  const pending = h.api('/api/creditex/job-intents');
  const rejected = assert.rejects(pending, /did not respond within 20 seconds/);
  await flush(); h.expire(); await rejected; assert.equal(h.timers.size, 0);
});

test('successful requests release their cancellation listener and timeout', async () => {
  let requestSignal;
  const h = harness(async (_path, init) => { requestSignal = init.signal; return Response.json({ ok: true, items: [] }); });
  const caller = new AbortController();
  assert.deepEqual(await h.api('/api/creditex/job-intents', { signal: caller.signal }), { ok: true, items: [] });
  caller.abort(); assert.equal(requestSignal.aborted, false); assert.equal(h.timers.size, 0);
});
