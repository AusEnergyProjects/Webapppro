import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = path => ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function module(path, dependencies, fetch) { const exports = {}; new Function('require', 'exports', 'fetch', compile(path))(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports, fetch); return exports; }

function apiHarness() {
  const state = { calls: [], response: { ok: true }, status: 200, duringToken: null, duringResponse: null };
  const user = { uid: 'named-creditex-user', getIdToken: async () => { state.duringToken?.(); return 'synthetic-named-firebase-token'; } };
  const auth = { currentUser: user }, lifetime = new AbortController();
  const exported = module('../src/lib/creditex-api.ts', { '@/lib/auth': { firebaseAuth: auth }, '@/lib/config': { API_BASE_URL: 'https://tlink.test' } }, async (url, init) => {
    state.calls.push({ url, init }); state.duringResponse?.(); return new Response(JSON.stringify(state.response), { status: state.status });
  });
  return { ...exported, state, auth, user, lifetime, api: exported.createCreditexApi(user, lifetime.signal) };
}
test('Creditex native requests use named Firebase only and force the Creditex team workspace', async () => {
  const h = apiHarness(); await h.api('/api/portal-team-workspace?workspace=admin&mode=messages');
  assert.equal(h.state.calls[0].url, 'https://tlink.test/api/portal-team-workspace?workspace=creditex&mode=messages');
  assert.equal(h.state.calls[0].init.headers.Authorization, 'Bearer synthetic-named-firebase-token');
  assert.equal(h.state.calls[0].init.headers['X-TLink-Business'], undefined);
});
test('Creditex API rejects arbitrary origins, trade APIs and file endpoints before credentials leave the client', async () => {
  const h = apiHarness();
  for (const path of ['https://other.test/api/creditex/app-access', '/api/trade-team/messages', '/api/field/session', '/api/creditex/job-audit/file']) await assert.rejects(h.api(path), /not part/);
  assert.equal(h.state.calls.length, 0);
});
test('account switches during token refresh and response cannot read or mutate another identity', async () => {
  const before = apiHarness(); before.state.duringToken = () => { before.auth.currentUser = { uid: 'other' }; };
  await assert.rejects(before.api('/api/creditex/app-access'), error => error.code === 'AUTH_REQUIRED'); assert.equal(before.state.calls.length, 0);
  const after = apiHarness(); after.state.duringResponse = () => { after.auth.currentUser = null; };
  await assert.rejects(after.api('/api/creditex/app-access'), error => error.code === 'AUTH_REQUIRED');
});
test('revoked membership and MFA requirements remain errors instead of cached access', async () => {
  const h = apiHarness(); h.state.status = 403; h.state.response = { ok: false, code: 'COMPLIANCE_MEMBERSHIP_INACTIVE', error: 'Membership inactive' };
  await assert.rejects(h.api('/api/creditex/app-access'), error => error.status === 403 && error.code === 'COMPLIANCE_MEMBERSHIP_INACTIVE');
  h.lifetime.abort(); await assert.rejects(h.api('/api/creditex/notifications'), error => error.code === 'AUTH_REQUIRED');
  assert.equal(h.state.calls.length, 1);
});

test('TOTP challenge only accepts one of this resolver’s enrolled authenticators and refreshes verified identity', async () => {
  class FirebaseError extends Error { constructor(code) { super(code); this.code = code; } }
  const calls = [], resolver = { hints: [{ uid: 'own-factor', factorId: 'totp' }, { uid: 'phone-factor', factorId: 'phone' }], resolveSignIn: async assertion => { calls.push(assertion); return { user: { getIdToken: async force => calls.push(force) } }; } };
  const h = module('../src/lib/creditex-auth.ts', {
    'firebase/app': { FirebaseError }, 'firebase/auth': { getMultiFactorResolver: () => resolver, TotpMultiFactorGenerator: { FACTOR_ID: 'totp', assertionForSignIn: (uid, code) => ({ uid, code }) } },
    '@/lib/auth': { firebaseAuth: {}, emailSignIn: async () => { throw new FirebaseError('auth/multi-factor-auth-required'); } },
  });
  assert.equal(await h.creditexEmailSignIn('staff@example.test', 'synthetic'), resolver);
  for (const [uid, code] of [['someone-else', '123456'], ['phone-factor', '123456'], ['own-factor', '12']]) await assert.rejects(h.verifyCreditexAuthenticator(resolver, uid, code));
  assert.equal(calls.length, 0); await h.verifyCreditexAuthenticator(resolver, 'own-factor', '123456');
  assert.deepEqual(calls, [{ uid: 'own-factor', code: '123456' }, true]);
});

test('background field work never runs under the Creditex office workspace', async () => {
  let task, runs = 0, mode = 'creditex';
  module('../src/lib/background.ts', {
    'expo-background-task': { BackgroundTaskResult: { Success: 'ok', Failed: 'failed' } },
    'expo-task-manager': { defineTask: (_id, run) => { task = run; } },
    '@/lib/auth': { firebaseAuth: { currentUser: { uid: 'person' } } }, '@/lib/field-session': { getFieldPrincipal: async () => null },
    '@/lib/sync': { runSync: async () => { runs++; } }, '@/lib/rental-save-queue': { processRentalSaveQueue: async () => { runs++; } },
    '@/lib/native-workspace': { readNativeWorkspace: async () => mode },
  });
  assert.equal(await task(), 'ok'); assert.equal(runs, 0); mode = 'trade'; assert.equal(await task(), 'ok'); assert.equal(runs, 2);
});

const text = node => !node || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
function uiHarness(path, remote) {
  const state = []; let cursor = 0;
  const hooks = { useState: initial => { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; }, useRef: value => ({ current: value }), useEffect: () => {}, useMemo: fn => fn() };
  const deps = { react: hooks, 'react/jsx-runtime': jsx, 'expo-crypto': { randomUUID: () => 'a9be7de5-905b-4714-b182-38ab9d818d12' },
    'react-native': { ActivityIndicator: 'ActivityIndicator', AppState: { currentState: 'active' }, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View', Modal: 'Modal', ScrollView: 'ScrollView', Linking: {} },
    '@/components/field-button': { FieldButton: 'FieldButton' }, '@/components/field-select': { FieldSelect: 'FieldSelect' }, '@/components/field-date-picker': { FieldDatePicker: 'FieldDatePicker' }, '@/components/screen': { Screen: 'Screen' },
    '@/components/creditex-styles': { creditexStyles: {} }, '@/components/creditex-remote': { useCreditexRemote: (_api, path) => ({ data: remote(path), loading: false, error: '', refresh: () => {} }) }, '@/lib/theme': { colours: {} },
    '@expo/vector-icons/MaterialCommunityIcons': { default: 'Icon' }, 'firebase/auth': {}, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    '@/components/creditex-sign-in': { CreditexSignIn: 'CreditexSignIn' }, '@/components/creditex-team': { CreditexConnect: 'CreditexConnect', CreditexTasks: 'CreditexTasks' }, '@/lib/creditex-api': {}, '@/lib/auth': {}, '@/lib/config': { API_BASE_URL: 'https://tlink.test' }, '@/providers/native-workspace-provider': {},
  };
  const exports = module(path, deps); return { ...exports, render: (component, props) => { cursor = 0; return component(props); } };
}
const access = { member: { id: 'me', uid: 'uid', name: 'Alex', email: 'alex@example.test', organisationName: 'Creditex' }, capabilities: { jobs: true, messages: true, sendMessages: true, tasks: true, createTasks: true, assignTasks: true, editTasks: true, completeTasks: true } };
test('native bell is a popover above the current tab and message notification opens that teammate', async () => {
  const calls = [], api = async (...args) => { calls.push(args); return { ok: true }; };
  const h = uiHarness('../src/components/creditex-native-app.tsx', () => ({ items: [{ id: 'notice', title: 'New team message', detail: 'Alex', createdAt: '2026-10-02T00:00:00Z', read: false, target: { kind: 'message', peerId: 'peer' } }], unreadCount: 1, totalPages: 1 }));
  const props = { access, api, onSignOut: async () => {}, signingOut: false, signOutError: '' };
  let tree = h.render(h.CreditexWorkspace, props);
  assert.equal(nodes(tree, node => node.type === 'Modal')[0].props.visible, false);
  nodes(tree, node => node.props?.accessibilityLabel === 'Notifications, 1 unread')[0].props.onPress(); tree = h.render(h.CreditexWorkspace, props);
  assert.equal(nodes(tree, node => node.type === 'Modal')[0].props.visible, true);
  nodes(tree, node => node.type === 'Pressable' && text(node).startsWith('New team message'))[0].props.onPress();
  await new Promise(resolve => setImmediate(resolve)); tree = h.render(h.CreditexWorkspace, props);
  assert.equal(nodes(tree, node => node.type === 'Modal')[0].props.visible, false);
  assert.equal(nodes(tree, node => node.type === 'CreditexConnect')[0].props.initialPeerId, 'peer');
  assert.deepEqual(calls[0], ['/api/creditex/notifications', { action: 'read', ids: ['notice'] }]);
});
test('native task actions require current server capability, not just stale initial grants', () => {
  const remote = { tasks: [{ id: 'task', title: 'Check work', status: 'open', assigneeName: 'Alex', creatorName: 'Manager', canEdit: false, canComplete: false }], canCreate: false, page: 1, totalPages: 1 };
  const h = uiHarness('../src/components/creditex-team.tsx', () => remote);
  let tree = h.render(h.CreditexTasks, { api: async () => {}, access });
  assert.equal(nodes(tree, node => node.type === 'FieldButton' && ['New task', 'Edit', 'Mark done'].includes(text(node))).length, 0);
  remote.canCreate = true; remote.tasks[0].canComplete = true; tree = h.render(h.CreditexTasks, { api: async () => {}, access });
  assert.equal(nodes(tree, node => node.type === 'FieldButton' && text(node) === 'New task').length, 1);
  assert.equal(nodes(tree, node => node.type === 'FieldButton' && text(node) === 'Mark done').length, 1);
});
