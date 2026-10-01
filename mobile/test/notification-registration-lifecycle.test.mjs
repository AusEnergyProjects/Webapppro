import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('app-provider.tsx', readFileSync(new URL('../src/providers/app-provider.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map(); const effects = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(source) === 'useCallback') callbacks.set(node.name.getText(source), node.initializer.arguments[0].getText(source));
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') effects.push(node.arguments[0].getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const principal = { localOwnerKey: 'firebase:alex:business-a:member-a', authMode: 'firebase', ownerId: 'business-a', memberId: 'member-a' };
const identity = { uid: 'alex', email: 'alex@example.test' };
const business = { ownerUid: 'business-a', memberId: 'member-a', businessName: 'Synthetic business', role: 'member' };

function harness(overrides = {}) {
  const state = { events: [], requests: [], registrations: [], invalidations: 0, nativeEnabled: true, serverToken: '', modes: ['trade_team'], sync: {}, tokenListener: null };
  const refs = { switching: { current: false }, authGeneration: { current: 1 }, notificationRegistrations: { current: new Set() }, localWrites: { current: 0 } };
  const dependencies = {
    ...refs, signedIn: true, access: { status: 'approved' }, user: principal,
    APP_VERSION: '1.0.2', MOBILE_PLATFORM: 'ios', firebaseAuth: { currentUser: identity },
    checkingAccess: { status: 'checking' }, approvedAccess: { status: 'approved' }, signedOutAccess: { status: 'signed_out' }, emptySync: {},
    ApiError: class extends Error {},
    DeviceEventEmitter: { emit: event => { assert.equal(event, 'tlink:call-identity-invalidated'); state.invalidations++; } },
    networkVerificationRequired: { status: 'network_verification_required' },
    deviceRegistration: async options => { state.registrations.push(options); return { pushToken: 'message-token', voipPushToken: 'call-token', nativeCallCapable: true }; },
    resolveFieldAccessModes: async () => state.modes,
    apiRequest: async (path, init = {}, _user, options) => {
      const body = init.body ? JSON.parse(init.body) : {};
      state.requests.push({ path, body, options, method: init.method });
      if (path.endsWith('/devices')) { state.serverToken = body.pushToken || ''; state.events.push(body.pushToken ? 'registered' : 'cleared'); }
      return { ok: true };
    },
    disableNativeCalls: async () => { state.events.push('native-disabled'); state.nativeEnabled = false; },
    handleAccessError: async () => false,
    unregisterBackgroundSync: async () => {}, registerBackgroundSync: async () => {}, waitForActiveSync: async () => {},
    getFieldSessionToken: async () => '', getFieldPrincipal: async () => null,
    getDeviceId: async () => 'synthetic-device', getDeviceName: () => 'Synthetic phone',
    forgetPushToken: async () => {}, purgeLocalData: async () => {}, clearFieldSession: async () => {},
    clearBusinessSession: async () => { state.events.push('session-cleared'); }, firebaseSignOut: async () => { state.events.push('signed-out'); },
    queueCounts: async () => ({ actions: 0, uploads: 0, conflicts: 0 }), pauseBusinessSession: () => {},
    setUser: value => { state.user = value; }, setAccess: value => { state.access = value; }, setJobs: () => {},
    setLoading: () => {}, setChoosingBusiness: () => {}, setBusinessError: () => {},
    setSync: value => { state.sync = typeof value === 'function' ? value(state.sync) : value; },
    loadBusinesses: async () => { state.events.push('businesses-loaded'); }, syncNow: async () => {},
    businessPrincipal: () => principal, legacyLocalWork: async () => null,
    getBusinessSession: async () => ({ business, principal }), prepareLocalDataOwner: async () => {}, saveBusinessSession: async () => {},
    NetInfo: { addEventListener: () => () => {} },
    Notifications: {
      unregisterForNotificationsAsync: async () => {}, dismissAllNotificationsAsync: async () => {}, clearLastNotificationResponseAsync: async () => {},
      addNotificationResponseReceivedListener: () => ({ remove() {} }), addPushTokenListener: callback => { state.pushListener = callback; return { remove() {} }; },
    },
    AppState: { currentState: 'active', addEventListener: (_name, callback) => { state.foreground = callback; return { remove() {} }; } },
    subscribeNativeCallToken: callback => { state.tokenListener = callback; return () => { state.tokenListener = null; }; },
    getRememberedPushToken: async () => 'cached-message-token', notificationDeviceState: async () => ({ granted: true, muted: false }), rememberPushToken: async () => {},
    requestNotificationPermissionOnce: async () => {},
    onAuthStateChanged: (_auth, callback) => { state.authCallback = callback; return () => {}; },
    ...overrides,
  };
  const registrationExports = {};
  const registrationSource = readFileSync(new URL('../src/lib/device-registration.ts', import.meta.url), 'utf8');
  new Function('require', 'exports', compile(registrationSource))(id => {
    assert.equal(id, '@/lib/device');
    return { deviceRegistration: options => dependencies.deviceRegistration(options) };
  }, registrationExports);
  Object.assign(dependencies, registrationExports);
  const names = ['stopNotificationRegistration', 'registerNotificationDevice', 'signOut', 'openBusinessChooser', 'activateBusiness'];
  const bodies = names.map(name => { assert.ok(callbacks.has(name), name); return `const ${name} = ${callbacks.get(name)};`; }).join('\n');
  const auth = effects.find(code => code.includes('onAuthStateChanged'));
  const tokens = effects.find(code => code.includes('Notifications.addPushTokenListener'));
  const permission = effects.find(code => code.includes('requestNotificationPermissionOnce'));
  assert.ok(auth && tokens && permission);
  const api = new Function(...Object.keys(dependencies), compile(`${bodies}
    return { ${names.join(',')}, authEffect: ${auth}, tokenEffect: ${tokens}, permissionEffect: ${permission} };`))(...Object.values(dependencies));
  return { state, ...refs, api, dependencies };
}

test('sign-out drains an already sent registration before disabling native calls and clearing server tokens', async () => {
  const request = deferred(); let h;
  h = harness({ apiRequest: async (path, init) => {
    const body = JSON.parse(init.body || '{}');
    if (body.pushToken) { h.state.events.push('registration-started'); await request.promise; h.state.serverToken = body.pushToken; h.state.events.push('registered'); }
    else if (path.endsWith('/devices')) { h.state.serverToken = ''; h.state.events.push('cleared'); }
    return { ok: true };
  } });
  const registering = h.api.registerNotificationDevice(); await settle();
  const logout = h.api.signOut(); await settle();
  assert.ok(h.state.invalidations > 0, 'call session is stopped before account credentials can change');
  assert.deepEqual(h.state.events, ['registration-started']);
  request.resolve(); await Promise.all([registering, logout]);
  assert.ok(h.state.events.indexOf('registered') < h.state.events.indexOf('native-disabled'));
  assert.ok(h.state.events.indexOf('native-disabled') < h.state.events.indexOf('cleared'));
  assert.equal(h.state.serverToken, ''); assert.equal(h.state.nativeEnabled, false);
  assert.equal(h.notificationRegistrations.current.size, 0);
});

test('business switching waits for delayed device preparation, then disables it without posting old-scope tokens', async () => {
  const prepare = deferred(); let h;
  h = harness({ deviceRegistration: async () => { await prepare.promise; h.state.nativeEnabled = true; h.state.events.push('native-enabled'); return { pushToken: 'stale-token' }; } });
  const registration = h.api.registerNotificationDevice(); await settle();
  const switching = h.api.openBusinessChooser(); await settle(); assert.equal(h.state.requests.length, 0);
  prepare.resolve(); await Promise.all([registration, switching]);
  assert.equal(h.state.nativeEnabled, false); assert.equal(h.state.serverToken, '');
  assert.equal(h.state.requests.length, 1); assert.equal(h.state.requests[0].body.nativeCallCapable, false);
  assert.ok(h.state.events.indexOf('native-enabled') < h.state.events.indexOf('native-disabled'));
});

test('one failed lane cannot let another pending registration escape the sign-out barrier', async () => {
  const manual = deferred(); let h;
  h = harness({ resolveFieldAccessModes: async () => ['trade_team', 'creditex_manual'], apiRequest: async (path, init) => {
    const body = JSON.parse(init.body || '{}');
    if (body.pushToken && path.includes('trade-team')) throw new Error('Trade registration unavailable');
    if (body.pushToken) { await manual.promise; h.state.events.push('manual-registered'); }
    else h.state.events.push('cleared');
    return { ok: true };
  } });
  const registration = h.api.registerNotificationDevice(); await settle();
  const logout = h.api.signOut(); await settle(); assert.equal(h.state.events.includes('native-disabled'), false);
  manual.resolve(); await Promise.all([registration, logout]);
  assert.ok(h.state.events.indexOf('manual-registered') < h.state.events.indexOf('native-disabled'));
});

test('access-error recovery removes its own registration before waiting on the barrier', { timeout: 1000 }, async () => {
  let h; h = harness({ apiRequest: async () => { throw new Error('Access denied'); }, handleAccessError: async () => {
    h.switching.current = true; await h.api.stopNotificationRegistration(); return true;
  } });
  await h.api.registerNotificationDevice(); assert.equal(h.notificationRegistrations.current.size, 0); assert.equal(h.state.nativeEnabled, false);
});

test('normal registration pins its authorised business and skips work while changing identity', async () => {
  const h = harness(); await h.api.registerNotificationDevice();
  assert.equal(h.state.requests[0].options.expectedBusinessKey, principal.localOwnerKey);
  h.switching.current = true; await h.api.registerNotificationDevice(); assert.equal(h.state.requests.length, 1);
});

test('same-business cold start retains pending system ringing while restoring the principal', async () => {
  const h = harness(); await h.api.activateBusiness(identity, business);
  assert.equal(h.state.nativeEnabled, true); assert.equal(h.state.events.includes('native-disabled'), false);
  assert.equal(h.state.user, principal);
});

test('an obsolete signed-out auth callback cannot disable the newer authenticated session', async () => {
  const oldRead = deferred(); let reads = 0;
  const h = harness({ getFieldPrincipal: () => ++reads === 1 ? oldRead.promise : Promise.resolve(null) });
  h.api.authEffect(); const obsolete = h.state.authCallback(null);
  await h.state.authCallback(identity); oldRead.resolve(null); await obsolete;
  assert.deepEqual(h.state.events, ['businesses-loaded']); assert.equal(h.state.nativeEnabled, true);
});

test('locked cold launch defers private workspace reads and retains native calls until unlock', async () => {
  let reads = 0;
  const h = harness({ getFieldPrincipal: async () => { reads++; return { ...principal, authMode: 'field_pin' }; } });
  h.dependencies.AppState.currentState = 'background';
  const cleanup = h.api.authEffect();
  await h.state.authCallback(null);
  assert.equal(reads, 0);
  assert.equal(h.state.nativeEnabled, true);
  h.dependencies.AppState.currentState = 'active';
  h.state.foreground('active'); await settle();
  assert.equal(reads, 1);
  assert.equal(h.state.user.memberId, principal.memberId);
  assert.equal(h.state.nativeEnabled, true);
  cleanup();
});

test('an obsolete failed private restore cannot overwrite a newer authenticated session', async () => {
  const oldRead = deferred(); let reads = 0;
  const h = harness({ getFieldPrincipal: () => ++reads === 1 ? oldRead.promise : Promise.resolve(null) });
  const cleanup = h.api.authEffect(); const obsolete = h.state.authCallback(null);
  await h.state.authCallback(identity); oldRead.reject(new Error('Keychain locked')); await obsolete;
  assert.equal(h.state.access?.status === 'network_verification_required', false);
  assert.equal(h.state.nativeEnabled, true);
  cleanup();
});

test('native token events reuse cached ordinary tokens and never reconfigure native registration recursively', async () => {
  let h; h = harness({ deviceRegistration: async options => {
    h.state.registrations.push(options);
    if (options?.refreshNativeCalls !== false) h.state.tokenListener?.();
    return { pushToken: options?.pushToken || 'initial-token', voipPushToken: 'call-token', nativeCallCapable: true };
  } });
  const cleanup = h.api.tokenEffect(); await h.api.registerNotificationDevice(); await settle();
  assert.deepEqual(h.state.registrations, [undefined, { pushToken: 'cached-message-token', refreshNativeCalls: false }]);
  cleanup(); assert.equal(h.state.tokenListener, null);
});

test('permission preparation never registers after its approved screen is disposed', async () => {
  const permission = deferred(); const h = harness({ requestNotificationPermissionOnce: () => permission.promise });
  const cleanup = h.api.permissionEffect(); cleanup(); permission.resolve(); await settle();
  assert.equal(h.state.registrations.length, 0); assert.equal(h.state.requests.length, 0);
});
