import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const library = compile('../src/lib/updates.ts'), component = compile('../src/components/dashboard-app-update.tsx');
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const policy = (platform = 'ios', overrides = {}) => ({ ok: true, policy: {
  platform, minimumVersion: '1.0.0', latestVersion: '1.1.0', updateUrl: 'https://ausenergyassessments.com/direct-trade/field-app', ...overrides,
} });

function updatesHarness({ platform = 'ios', version = '1.0.2', response = policy(platform), enabled = true } = {}) {
  const state = { requests: [], events: [], response, ota: { isAvailable: true }, downloaded: { isNew: true }, enabled };
  const updates = { get isEnabled() { return state.enabled; },
    checkForUpdateAsync: async () => { state.events.push('ota-check'); if (state.otaError) throw state.otaError; return state.ota; },
    fetchUpdateAsync: async () => { state.events.push('ota-fetch'); if (state.fetchError) throw state.fetchError; return state.downloaded; },
    reloadAsync: async () => { state.events.push('restart'); },
  };
  const dependencies = { 'expo-updates': updates, '@/lib/config': { APP_VERSION: version, MOBILE_PLATFORM: platform },
    '@/lib/api': { publicApiRequest: async (path, init) => { state.events.push('policy'); state.requests.push({ path, init });
      if (state.apiError) throw state.apiError; return state.response; } } };
  const exports = {};
  new Function('require', 'exports', library)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports);
  return { ...exports, state };
}

for (const platform of ['ios', 'android']) test(`${platform} 1.0.2 offers native 1.1.0 before an available compatible OTA`, async () => {
  const h = updatesHarness({ platform });
  const result = await h.checkForAppUpdate();
  assert.equal(result.kind, 'download'); assert.match(result.message, /1\.1\.0/);
  assert.equal(result.url, policy(platform).policy.updateUrl);
  assert.deepEqual(h.state.events, ['policy']);
  assert.equal(h.state.requests[0].path, `/api/field/app-release?platform=${platform}`);
  assert.equal(h.state.requests[0].init.cache, 'no-store');
  assert.equal(h.state.requests[0].init.headers['Cache-Control'], 'no-cache');
});

test('missing, malformed, inconsistent or other-platform policy never reports current or attempts OTA', async () => {
  for (const response of [null, [], {}, { ok: false, ...{ policy: policy().policy } }, { ok: true }, { ok: true, policy: [] },
    policy('android'), policy('ios', { latestVersion: '' }), policy('ios', { latestVersion: '1.1.0garbage' }),
    policy('ios', { latestVersion: 123 }), policy('ios', { minimumVersion: 'invalid' }), policy('ios', { minimumVersion: '2.0.0' }),
    policy('ios', { updateUrl: '' }), policy('ios', { updateUrl: '/download' }), policy('ios', { updateUrl: 'http://unsafe.test' }),
    policy('ios', { updateUrl: 'javascript:alert(1)' }), policy('ios', { updateUrl: 'https://user:secret@example.test' }),
    policy('ios', { updateUrl: 'https://example.test/#private' })]) {
    const h = updatesHarness({ response });
    const result = await h.checkForAppUpdate();
    assert.equal(result.kind, 'unavailable', JSON.stringify(response)); assert.doesNotMatch(result.message, /up to date/);
    assert.deepEqual(h.state.events, ['policy']);
  }
});

test('release and OTA failures never become a successful current result', async () => {
  const api = updatesHarness(); api.state.apiError = new Error('Offline');
  assert.equal((await api.checkForAppUpdate()).kind, 'unavailable'); assert.deepEqual(api.state.events, ['policy']);
  for (const failure of ['otaError', 'fetchError']) {
    const h = updatesHarness({ response: policy('ios', { latestVersion: '1.0.2' }) }); h.state[failure] = new Error('EAS unavailable');
    assert.equal((await h.checkForAppUpdate()).kind, 'unavailable'); assert.equal(h.state.events[0], 'policy');
  }
});

test('cross-platform and unusable Apple release links cannot advertise a native upgrade or enable OTA', async () => {
  for (const [platform, updateUrl] of [
    ['ios', 'https://expo.dev/artifacts/eas/tlink.apk'], ['ios', 'https://example.com/download'],
    ['ios', 'https://testflight.apple.com.evil.test/join/AbC123'], ['ios', 'https://apps.apple.com/au/'],
    ['ios', 'https://testflight.apple.com:444/join/AbC123'],
    ['ios', 'https://ausenergyassessments.com/direct-trade/field-app?platform=android'],
    ['android', 'https://testflight.apple.com/join/AbC123'], ['android', 'https://apps.apple.com/au/app/tlink/id123456'],
  ]) {
    const h = updatesHarness({ platform, response: policy(platform, { updateUrl }) });
    assert.equal((await h.checkForAppUpdate()).kind, 'unavailable', `${platform} ${updateUrl}`);
    assert.deepEqual(h.state.events, ['policy']);
  }
});

test('platform-specific downloads and the shared TLink installation guide remain usable', async () => {
  for (const [platform, updateUrl] of [
    ['ios', 'https://testflight.apple.com/join/AbC123'], ['ios', 'https://apps.apple.com/au/app/tlink/id123456'],
    ['ios', policy().policy.updateUrl], ['android', policy().policy.updateUrl],
    ['android', 'https://expo.dev/artifacts/eas/tlink.apk'],
  ]) {
    const h = updatesHarness({ platform, response: policy(platform, { updateUrl }) });
    const result = await h.checkForAppUpdate();
    assert.equal(result.kind, 'download'); assert.equal(result.url, updateUrl); assert.deepEqual(h.state.events, ['policy']);
  }
});

test('a verified current binary can download OTA and requires explicit restart', async () => {
  const h = updatesHarness({ response: policy('ios', { latestVersion: '1.0.2' }) });
  assert.equal((await h.checkForAppUpdate()).kind, 'ready');
  assert.deepEqual(h.state.events, ['policy', 'ota-check', 'ota-fetch']);
  await h.restartIntoUpdate(); assert.equal(h.state.events.at(-1), 'restart');
  h.state.downloaded = { isNew: false, isRollBackToEmbedded: false };
  assert.equal((await h.checkForAppUpdate()).kind, 'unavailable');
  h.state.ota = { isAvailable: false, isRollBackToEmbedded: true };
  h.state.downloaded = { isNew: false, isRollBackToEmbedded: true };
  assert.equal((await h.checkForAppUpdate()).kind, 'ready');
  h.state.ota = { isAvailable: false, isRollBackToEmbedded: false };
  assert.equal((await h.checkForAppUpdate()).kind, 'current');
});

test('native policy remains available with Expo updates disabled or deferred', async () => {
  for (const enabled of [true, false]) {
    const h = updatesHarness({ enabled });
    assert.equal((await h.checkForAppUpdate({ checkOta: false })).kind, 'download');
    assert.deepEqual(h.state.events, ['policy']);
  }
});

test('cancelling a policy check prevents late OTA fetches and results', async () => {
  const response = deferred(), controller = new AbortController();
  const h = updatesHarness({ response: response.promise });
  const check = h.checkForAppUpdate({ signal: controller.signal });
  assert.equal(h.state.requests[0].init.signal, controller.signal);
  controller.abort(); response.resolve(policy('ios', { latestVersion: '1.0.2' }));
  await assert.rejects(check, /cancelled/); assert.deepEqual(h.state.events, ['policy']);
});

function dashboardHarness() {
  const slots = [], effects = [], pending = [], listeners = new Set(); let cursor = 0, tree, unmounted = false;
  const state = { pathname: '/work', sync: { running: false, online: true }, access: { status: 'approved' },
    updates: { isUpdatePending: false, isStartupProcedureRunning: false }, checks: [], links: [], restarts: 0,
    result: { kind: 'download', url: policy().policy.updateUrl, message: 'TLink 1.1.0 is ready to install.' } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { assert.equal(unmounted, false, 'No state updates after unmount'); slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || !same(effects[i].deps, deps)) { const old = effects[i];
      effects[i] = { deps }; pending.push(() => { old?.cleanup?.(); effects[i].cleanup = fn(); }); } },
  };
  const dependencies = { react, 'expo-router': { usePathname: () => state.pathname },
    'expo-updates': { isEnabled: false, useUpdates: () => state.updates },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: value => value },
      AppState: { currentState: 'active', addEventListener: (_type, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } },
      Linking: { openURL: async url => { state.links.push(url); if (state.linkError) throw state.linkError; } } },
    '@/components/field-button': { FieldButton: 'FieldButton' }, '@/lib/theme': { colours: {}, spacing: {} },
    '@/providers/app-provider': { useApp: () => ({ sync: state.sync, access: state.access }) },
    '@/lib/updates': { checkForAppUpdate: async options => { state.checks.push(options); return state.result; },
      restartIntoUpdate: async () => { state.restarts++; } },
  };
  const exports = {};
  new Function('require', 'exports', component)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports);
  function render() { cursor = 0; tree = exports.DashboardAppUpdate(); while (pending.length) pending.shift()(); return tree; }
  const visit = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(2).flatMap(visit)];
  const nodes = () => visit(tree);
  return { state, render, nodes, button: () => nodes().find(node => node.type === 'FieldButton'),
    appState: value => { for (const listener of listeners) listener(value); },
    cleanup: () => { for (const effect of effects) effect?.cleanup?.(); unmounted = true; assert.equal(listeners.size, 0); } };
}

test('dashboard prioritises the native install link over pending OTA without automatic restart', async () => {
  const h = dashboardHarness(); h.state.updates.isUpdatePending = true; h.render(); await flush(); h.render();
  assert.equal(h.state.checks[0].checkOta, false); assert.equal(h.button().props.children, 'Open app update');
  assert.deepEqual(h.state.links, []); assert.equal(h.state.restarts, 0);
  h.button().props.onPress(); await flush(); assert.deepEqual(h.state.links, [policy().policy.updateUrl]); assert.equal(h.state.restarts, 0);
  h.cleanup();
});

test('dashboard keeps OTA installation explicit and disabled during sync', async () => {
  const h = dashboardHarness(); h.state.result = { kind: 'current', message: 'Current' }; h.state.updates.isUpdatePending = true;
  h.render(); await flush(); h.render(); assert.equal(h.button().props.children, 'Install now'); assert.equal(h.state.restarts, 0);
  h.state.sync.running = true; h.render(); assert.equal(h.button().props.disabled, true);
  h.button().props.onPress(); await flush(); assert.equal(h.state.restarts, 0);
  h.state.sync.running = false; h.render(); h.button().props.onPress(); await flush(); assert.equal(h.state.restarts, 1);
  h.cleanup();
});

test('dashboard never offers a pending OTA before verifying the release policy', async () => {
  const h = dashboardHarness(); h.state.result = { kind: 'unavailable', message: 'Check failed' }; h.state.updates.isUpdatePending = true;
  h.render(); await flush(); assert.equal(h.render(), null); assert.equal(h.state.restarts, 0); h.cleanup();
});

test('dashboard cleanup aborts the request and ignores its late native release result', async () => {
  const h = dashboardHarness(), request = deferred(); h.state.result = request.promise; h.render();
  h.cleanup(); assert.equal(h.state.checks[0].signal.aborted, true);
  request.resolve({ kind: 'download', message: 'Late', url: policy().policy.updateUrl }); await flush();
  assert.deepEqual(h.state.links, []); assert.equal(h.state.restarts, 0);
});

test('leaving the dashboard cancels a check and does not throttle the next visit', async () => {
  const h = dashboardHarness(), request = deferred(); h.state.result = request.promise; h.render();
  h.state.pathname = '/messages'; h.render(); assert.equal(h.state.checks[0].signal.aborted, true);
  h.state.result = { kind: 'download', message: 'Current release', url: policy().policy.updateUrl };
  h.state.pathname = '/work'; h.render(); await flush(); h.render(); assert.equal(h.state.checks.length, 2);
  request.resolve({ kind: 'current', message: 'Obsolete response' }); await flush(); h.render();
  assert.equal(h.button().props.children, 'Open app update'); h.cleanup();
});

test('dashboard link failures remain visible and never fall back to restarting OTA', async () => {
  const h = dashboardHarness(); h.state.linkError = new Error('No handler'); h.render(); await flush(); h.render();
  h.button().props.onPress(); await flush(); h.render();
  assert.ok(h.nodes().some(node => node.type === 'Text' && /could not open/.test(node.props.children)));
  assert.equal(h.state.restarts, 0); h.cleanup();
});
