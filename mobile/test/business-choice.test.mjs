import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const choice = (ownerUid, memberId = 'member-1') => ({ ownerUid, memberId, displayName: 'Alex', businessName: ownerUid, role: 'member' });

function sessionHarness() {
  const storage = new Map();
  const exports = {};
  const secure = { getItemAsync: async key => storage.get(key) || null, setItemAsync: async (key, value) => storage.set(key, value),
    deleteItemAsync: async key => storage.delete(key), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'locked' };
  new Function('require', 'exports', compile(read('../src/lib/business-session.ts')))(id => {
    assert.equal(id, 'expo-secure-store'); return secure;
  }, exports);
  return { ...exports, storage };
}

test('one Firebase login gets separate cache ownership for every business and member', () => {
  const h = sessionHarness();
  const first = h.businessPrincipal('alex', 'alex@example.test', choice('business-a'));
  const second = h.businessPrincipal('alex', 'alex@example.test', choice('business-b'));
  const otherMember = h.businessPrincipal('alex', 'alex@example.test', choice('business-a', 'member-2'));
  assert.equal(new Set([first.localOwnerKey, second.localOwnerKey, otherMember.localOwnerKey]).size, 3);
  assert.equal(first.ownerId, 'business-a');
  assert.equal(first.memberId, 'member-1');
  const own = { ...choice('business-a'), role: 'owner', memberId: '' };
  assert.equal(h.businessPrincipal('alex', '', own).localOwnerKey,
    h.businessPrincipal('alex', '', { ...own, memberId: 'bootstrapped-owner' }).localOwnerKey);
});

test('business sessions cannot be used by another Firebase identity or while choosing', async () => {
  const h = sessionHarness(); const business = choice('business-a');
  await h.saveBusinessSession('alex', business, h.businessPrincipal('alex', '', business));
  assert.equal((await h.getBusinessSession('alex')).business.ownerUid, 'business-a');
  assert.equal(await h.getBusinessSession('another-person'), null);
  h.pauseBusinessSession(true);
  assert.equal(await h.getBusinessSession('alex'), null);
  assert.equal((await h.getBusinessSession('alex', true)).business.ownerUid, 'business-a');
  h.pauseBusinessSession(false);
  await h.clearBusinessSession(); assert.equal(await h.getBusinessSession('alex'), null);
});

test('corrupt or mismatched stored principal cannot unlock another cache', async () => {
  const h = sessionHarness(); const business = choice('business-a');
  await h.saveBusinessSession('alex', business, { ...h.businessPrincipal('alex', '', business), localOwnerKey: 'firebase:alex:business-b:member-1' });
  assert.equal(await h.getBusinessSession('alex'), null);
});

function apiHarness() {
  const state = { session: null, field: '', requests: [], revision: 0, beforeToken: null };
  const user = { uid: 'alex', getIdToken: async () => { state.beforeToken?.(); return 'firebase-token'; } };
  const dependencies = {
    'expo-crypto': {}, 'expo/fetch': {}, '@/lib/config': { API_BASE_URL: 'https://tlink.test', APP_VERSION: '1.0.2', MOBILE_PLATFORM: 'android' },
    '@/lib/device': { getDeviceId: async () => 'phone-1' }, '@/lib/auth': { firebaseAuth: { currentUser: user } },
    '@/lib/field-session': { getFieldSessionToken: async () => state.field },
    '@/lib/business-session': { getBusinessSession: async () => state.session, businessSessionRevision: () => state.revision },
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', compile(read('../src/lib/api.ts')))(id => {
    assert.ok(dependencies[id], id); return dependencies[id];
  }, exports, async (url, init) => { state.requests.push({ url, init }); return new Response('{"ok":true}'); });
  return { ...exports, state };
}

test('authenticated mobile API requires choice, while discovery is allowed without one', async () => {
  const h = apiHarness();
  await assert.rejects(h.apiRequest('/api/trade-team/messages'), error => error.code === 'BUSINESS_SELECTION_REQUIRED');
  assert.equal(h.state.requests.length, 0);
  await h.apiRequest('/api/trade-businesses'); assert.equal(h.state.requests.length, 1);
  assert.equal(h.state.requests[0].init.headers.has('X-TLink-Business'), false);
});

test('API cannot override active business and PIN sessions remain bound to the token tenant', async () => {
  const h = apiHarness(); h.state.session = { business: choice('business-a') };
  await h.apiRequest('/api/trade-team', { headers: { 'X-TLink-Business': 'business-b' } });
  assert.equal(h.state.requests[0].init.headers.get('X-TLink-Business'), 'business-a');
  h.state.field = 'pin-token';
  await h.apiRequest('/api/trade-team', { headers: { 'X-TLink-Business': 'business-b' } });
  assert.equal(h.state.requests[1].init.headers.has('X-TLink-Business'), false);
  assert.equal(h.state.requests[1].init.headers.get('Authorization'), 'TLinkField pin-token');
});

test('compliance-only fallback has a distinct cache and no trade selector header', async () => {
  const session = sessionHarness(); const business = { ...choice('compliance:alex'), manualOnly: true };
  assert.equal(session.businessPrincipal('alex', '', business).localOwnerKey, 'firebase:alex:compliance');
  const h = apiHarness(); h.state.session = { business };
  await h.apiRequest('/api/field/access');
  assert.equal(h.state.requests[0].init.headers.has('X-TLink-Business'), false);
});

test('switch during asynchronous Firebase token preparation rejects before sending under the new tenant', async () => {
  const h = apiHarness(); h.state.session = { business: choice('business-a') };
  h.state.beforeToken = () => { h.state.revision++; h.state.session = { business: choice('business-b') }; };
  await assert.rejects(h.apiRequest('/api/trade-messages', { method: 'POST', body: '{}' }), error => error.code === 'BUSINESS_CHANGED');
  assert.equal(h.state.requests.length, 0);
});

test('a delayed old screen action cannot target the currently selected business', async () => {
  const h = apiHarness();
  h.state.session = { business: choice('business-b'), principal: { localOwnerKey: 'firebase:alex:business-b:member-1' } };
  await assert.rejects(h.apiRequest('/api/trade-price-book', { method: 'POST', body: '{}' }, undefined,
    { expectedBusinessKey: 'firebase:alex:business-a:member-1' }), error => error.code === 'BUSINESS_CHANGED');
  assert.equal(h.state.requests.length, 0);
});

test('component-bound API rejects a delayed dialog after its business screen unmounts', async () => {
  let cleanup; const calls = [];
  const dependencies = {
    react: { useCallback: fn => fn, useRef: value => ({ current: value }), useEffect: fn => { cleanup = fn(); } },
    '@/providers/app-provider': { useApp: () => ({ user: { localOwnerKey: 'firebase:alex:business-a:member-1' } }) },
    '@/lib/api': { ApiError: class extends Error { constructor(message, status, code) { super(message); this.code = code; } },
      apiRequest: async (...args) => { calls.push(args); return { ok: true }; } },
  };
  const exports = {};
  new Function('require', 'exports', compile(read('../src/lib/use-business-api.ts')))(id => dependencies[id], exports);
  const request = exports.useBusinessApi();
  await request('/api/trade-price-book');
  assert.equal(calls[0][3].expectedBusinessKey, 'firebase:alex:business-a:member-1');
  cleanup();
  await assert.rejects(request('/api/trade-price-book', { method: 'POST', body: '{}' }), error => error.code === 'BUSINESS_CHANGED');
  assert.equal(calls.length, 1);
});

test('saved-work callback captures the original business and refuses the replacement cache', async () => {
  const source = ts.createSourceFile('provider.tsx', read('../src/providers/app-provider.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'savedWorkOwner') initializer = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(initializer);
  const code = ts.transpileModule(`const callback = ${initializer.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const current = { key: 'firebase:alex:business-a:member-1', epoch: 1 };
  const switching = { current: false };
  const callback = new Function('user', 'switching', 'getLocalDataOwner', `${code}; return callback;`)(
    { localOwnerKey: current.key }, switching, async () => ({ ...current }));
  assert.equal((await callback()).key, current.key);
  current.key = 'firebase:alex:business-b:member-1'; current.epoch++;
  await assert.rejects(callback(), /business changed/);
  switching.current = true;
  await assert.rejects(callback(), /Choose your business/);
});

function prepareHarness(counts) {
  const source = ts.createSourceFile('database.ts', read('../src/lib/database.ts'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'prepareLocalDataOwner');
  const state = { owner: 'firebase:alex:business-a:member-1', purged: false };
  const secure = { getItemAsync: async () => state.owner, setItemAsync: async (_key, value) => { state.owner = value; }, WHEN_UNLOCKED_THIS_DEVICE_ONLY: '' };
  const prepare = new Function('SecureStore', 'DATABASE_OWNER_KEY', 'queueCounts', 'purgeLocalData', 'exports',
    `${compile(fn.getText(source))}; return prepareLocalDataOwner;`)(secure, 'owner', async () => counts, async () => { state.purged = true; }, {});
  return { prepare, state };
}

test('switching with queued work, photos or conflicts keeps the original cache and evidence intact', async () => {
  for (const counts of [{ actions: 1, uploads: 0, conflicts: 0 }, { actions: 0, uploads: 1, conflicts: 0 }, { actions: 0, uploads: 0, conflicts: 1 }]) {
    const h = prepareHarness(counts);
    await assert.rejects(h.prepare('firebase:alex:business-b:member-2'), /Sync or resolve/);
    assert.equal(h.state.purged, false); assert.equal(h.state.owner, 'firebase:alex:business-a:member-1');
    await h.prepare(h.state.owner); assert.equal(h.state.purged, false);
  }
});

test('fully synced cache is cleared before the new business owns the device data', async () => {
  const h = prepareHarness({ actions: 0, uploads: 0, conflicts: 0 });
  await h.prepare('firebase:alex:business-b:member-2');
  assert.equal(h.state.purged, true); assert.equal(h.state.owner, 'firebase:alex:business-b:member-2');
});

function legacyHarness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE jobs (id TEXT, field_lane TEXT); CREATE TABLE action_queue (work_order_id TEXT, field_lane TEXT);
    CREATE TABLE upload_queue (work_order_id TEXT, field_lane TEXT); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  const source = ts.createSourceFile('database.ts', read('../src/lib/database.ts'), ts.ScriptTarget.Latest, true);
  const functions = ['legacyLocalWork', 'changeRentalOwner', 'migrateLegacyLocalOwner'].map(name =>
    source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source)).join('\n');
  const state = { owner: 'firebase:alex', failOwnerWrite: false };
  const secure = { getItemAsync: async () => state.owner, setItemAsync: async (_key, value) => {
    if (state.failOwnerWrite) throw new Error('Interrupted secure store write'); state.owner = value;
  }, WHEN_UNLOCKED_THIS_DEVICE_ONLY: '' };
  const adapter = { getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args), runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
    withTransactionAsync: async fn => { db.exec('BEGIN'); try { await fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } } };
  const exports = {};
  new Function('SecureStore', 'DATABASE_OWNER_KEY', 'queueCounts', 'getDatabase', 'exports',
    `let localOwnerEpoch = 0; const localOwnerListeners = new Set(); ${compile(functions)}`)(secure, 'owner',
    async () => ({ actions: 1, uploads: 0, conflicts: 0 }), async () => adapter, exports);
  return { ...exports, state, db, add: (key, value) => db.prepare('INSERT INTO settings VALUES (?, ?)').run(key, JSON.stringify(value)) };
}

test('legacy proof includes jobs from every queue and retained document, not just visible cached jobs', async () => {
  const h = legacyHarness();
  try {
    h.db.exec("INSERT INTO jobs VALUES ('cached', 'trade_team'); INSERT INTO action_queue VALUES ('action', 'trade_team'); INSERT INTO upload_queue VALUES ('photo', 'trade_team');");
    h.add('rental-save:old:pending', { workOrderId: 'rental', ownerKey: 'firebase:alex' });
    h.add('activity-form:job:intent', { record: { workOrderId: 'activity' } });
    h.add('rental-documents:job', [{ workOrderId: 'document', ownerKey: 'firebase:alex' }]);
    const result = await h.legacyLocalWork('alex');
    assert.deepEqual(result.workOrderIds.sort(), ['action', 'activity', 'cached', 'document', 'photo', 'rental']);
    assert.deepEqual(result.lanes, ['trade_team']);
    assert.equal(await h.legacyLocalWork('another-user'), null);
  } finally { h.db.close(); }
});

test('legacy recovery preserves queue rows and image bytes references while relabelling rental ownership', async () => {
  const h = legacyHarness(); const next = 'firebase:alex:business-a:member-1';
  try {
    h.db.exec("INSERT INTO upload_queue VALUES ('photo', 'trade_team');");
    h.add('rental-save:firebase%3Aalex:one', { ownerKey: 'firebase:alex', workOrderId: 'photo', photos: [{ uri: 'file:///encrypted/original.jpg' }] });
    h.add('rental-result:firebase%3Aalex:photo', { issuedReportId: 'report-1' });
    h.add('rental-documents:photo', [{ ownerKey: 'firebase:alex', workOrderId: 'photo', envelope: 'unchanged signed capture envelope' }]);
    h.add('other-setting', { ownerKey: 'keep-other-contract' });
    await h.migrateLegacyLocalOwner('alex', next);
    assert.equal(h.state.owner, next);
    const row = JSON.parse(h.db.prepare('SELECT value FROM settings WHERE key = ?').get(`rental-save:${encodeURIComponent(next)}:one`).value);
    assert.equal(row.ownerKey, next); assert.equal(row.photos[0].uri, 'file:///encrypted/original.jpg');
    assert.equal(h.db.prepare('SELECT COUNT(*) count FROM upload_queue').get().count, 1);
    assert.equal(JSON.parse(h.db.prepare("SELECT value FROM settings WHERE key = 'rental-documents:photo'").get().value)[0].envelope,
      'unchanged signed capture envelope');
    assert.equal(JSON.parse(h.db.prepare("SELECT value FROM settings WHERE key = 'other-setting'").get().value).ownerKey, 'keep-other-contract');
  } finally { h.db.close(); }
});

test('interrupted legacy owner write can resume without duplicating or deleting saved records', async () => {
  const h = legacyHarness(); const next = 'firebase:alex:business-a:member-1';
  try {
    h.add('rental-save:firebase%3Aalex:one', { ownerKey: 'firebase:alex', workOrderId: 'job' });
    h.state.failOwnerWrite = true;
    await assert.rejects(h.migrateLegacyLocalOwner('alex', next), /Interrupted/);
    assert.equal(h.state.owner, 'firebase:alex');
    h.state.failOwnerWrite = false;
    await h.migrateLegacyLocalOwner('alex', next);
    assert.equal(h.state.owner, next);
    assert.equal(h.db.prepare('SELECT COUNT(*) count FROM settings').get().count, 1);
  } finally { h.db.close(); }
});
