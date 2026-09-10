import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('sync.ts', readFileSync(new URL('../src/lib/sync.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function fixture({ mode = 'trade_team', failCleanup = false, reassigned = false } = {}) {
  const calls = [];
  const names = ['removeDeletedFieldJob', 'fetchChanges', 'cursorSetting', 'syncPath'];
  const code = ts.transpileModule(names.map((name) => source.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === name).getText(source).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies = {
    getSetting: async () => 'before', getDeviceId: async () => 'device', MOBILE_PLATFORM: 'android', APP_VERSION: 'test', MAX_SYNC_PAGES: 100,
    apiRequest: async () => ({ changes: [reassigned ? { operation: 'upsert', entityId: 'restored', entity: { id: 'restored' } } : { operation: 'delete', entityId: 'removed' }], bootstrap: false, serverTime: 'now', nextCursor: 'after', hasMore: false }),
    purgeDeletedRentalJob: async (id) => { calls.push(['purge', id]); if (failCleanup) throw new Error('Storage unavailable'); },
    restoreRentalJobAccess: async (id) => calls.push(['restore', id]),
    applyChanges: async (changes, _bootstrap, _time, lane) => calls.push(['apply', changes[0].entityId, lane]),
    setSetting: async (key, value) => calls.push(['cursor', key, value]), ApiError: Error,
  };
  const api = new Function(...Object.keys(dependencies), `${code}; return {fetchChanges, removeDeletedFieldJob};`)(...Object.values(dependencies));
  return { calls, run: () => api.fetchChanges(mode), remove: api.removeDeletedFieldJob };
}

test('server removals purge rental work before acknowledging the sync cursor', async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.calls, [['purge', 'removed'], ['apply', 'removed', 'trade_team'], ['cursor', 'sync_cursor_trade_team', 'after']]);
});

test('failed local cleanup leaves the cursor untouched so deletion is replayed', async () => {
  const f = fixture({ failCleanup: true }); await assert.rejects(f.run(), /Storage unavailable/);
  assert.deepEqual(f.calls, [['purge', 'removed']]);
});

test('manual-field removals do not purge a trade-team rental with the same ID', async () => {
  const f = fixture({ mode: 'creditex_manual' }); await f.run();
  assert.deepEqual(f.calls, [['apply', 'removed', 'creditex_manual'], ['cursor', 'sync_cursor_creditex_manual', 'after']]);
});

test('successful explicit deletion removes the local job immediately without a network sync', async () => {
  const f = fixture(); await f.remove('selected-job');
  assert.deepEqual(f.calls, [['purge', 'selected-job'], ['apply', 'selected-job', 'trade_team']]);
});

test('authoritative reassignment permits the returned rental job to open again', async () => {
  const f = fixture({ reassigned: true }); await f.run();
  assert.deepEqual(f.calls, [['restore', 'restored'], ['apply', 'restored', 'trade_team'], ['cursor', 'sync_cursor_trade_team', 'after']]);
});
