import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as catalogue from '../src/lib/australian-government-program-catalogue.ts';
import * as permissions from '../src/lib/creditex-permissions.ts';
import { requestWithCreditexTokenRecovery } from '../src/lib/creditex-auth-token.ts';

const source = fs.readFileSync(new URL('../src/components/CreditexCompliancePortal.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const invite = 'fedc2268-1c62-4fb6-bc35-f818f2377fe7';
const flush = () => new Promise(resolve => setImmediate(resolve));

function runtime(search, initialUser = null, mfa = false) {
  const slots = [], effects = [], queued = [], requests = [], tokens = [];
  let cursor = 0, authCallback, unsubscribeCount = 0;
  const firebaseAuth = { currentUser: initialUser };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(callback) { cursor++; return callback; },
    useMemo(callback) { cursor++; return callback(); },
    useEffectEvent(callback) { cursor++; return callback; },
    useEffect(callback, deps) { const i = cursor++; if (!effects[i]) { effects[i] = { deps }; queued.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const component = name => Object.assign(() => null, { displayName: name });
  const setup = component('CreditexInvitationSetup');
  const security = component('FirebaseAccountSecurity');
  const window = {
    location: { href: `https://test.invalid/creditex/compliance${search}#keep`, search },
    history: { state: { retained: true }, replaceState(state, _title, value) {
      this.state = state; const url = new URL(value, 'https://test.invalid');
      window.location.href = url.href; window.location.search = url.search;
    } },
    requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
  };
  const fetch = async (path, init) => {
    requests.push(path); tokens.push(init.headers.get('Authorization'));
    return mfa ? Response.json({ ok: false, code: 'MFA_REQUIRED', error: 'Set up your security.' }, { status: 403 })
      : Response.json({ ok: true, member: { email: 'invitee@example.invalid', displayName: 'Invitee', role: 'case_manager',
        permissions: [], organisation: { code: 'CREDITEX-AU', legalName: 'Creditex', tradingName: 'Creditex' } } });
  };
  const require = id => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return jsx;
    if (id === 'firebase/auth') return {
      onAuthStateChanged(_auth, callback) { authCallback = callback; callback(firebaseAuth.currentUser); return () => { unsubscribeCount++; }; },
    };
    if (id === '@/lib/firebase-client') return { firebaseAuth };
    if (id === '@/lib/creditex-auth-token') return { requestWithCreditexTokenRecovery };
    if (id === '@/lib/australian-government-program-catalogue') return catalogue;
    if (id === '@/lib/creditex-permissions') return permissions;
    if (id === './FirebaseMfa') return { useFirebaseMfaChallenge: () => ({ resolver: null }), FirebaseAccountSecurity: security };
    if (id === './CreditexInvitationSetup') return { CreditexInvitationSetup: setup };
    if (id === './PortalWorkspacePreferences') return { usePortalWorkspacePreferences: () => ({ rootProps: {}, profile: {} }) };
    if (id === 'next/dynamic') return { default: () => component('DynamicPanel') };
    if (id.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    return new Proxy({}, { get: (_, key) => component(String(key)) });
  };
  const exports = {};
  Function('require', 'exports', 'window', 'document', 'fetch', compiled)(require, exports, window,
    { getElementById: () => null }, fetch);
  const render = () => { cursor = 0; const tree = exports.CreditexCompliancePortal();
    for (const run of queued.splice(0)) run(); return tree; };
  const walk = (node, type) => !node || typeof node !== 'object' ? null
    : node.type === type ? node : (Array.isArray(node) ? node : [node.props?.children]).flat(Infinity).map(child => walk(child, type)).find(Boolean);
  return { render, requests, setup, security, firebaseAuth, window,
    find: (type) => walk(render(), type) || null,
    auth(user) { firebaseAuth.currentUser = user; authCallback(user); },
    async mount() { render(); await flush(); return render(); },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); },
    get unsubscribeCount() { return unsubscribeCount; },
  };
}

function user(verified = false) { return { uid: 'new-creditex-user', email: 'invitee@example.invalid', emailVerified: verified,
  tokenCalls: [], async getIdToken(force) { this.tokenCalls.push(force); return force ? 'fresh-token' : 'cached-token'; } }; }

test('cached sign-in and account auto-sign-in cannot open a private session during invitation setup', async () => {
  const account = user(); const h = runtime(`?invite=${invite}`, account);
  await h.mount(); assert.equal(h.find(h.setup)?.props.invitationId, invite); assert.deepEqual(h.requests, []);
  h.auth(user()); h.render(); assert.deepEqual(h.requests, []);
  await assert.rejects(h.find(h.setup).props.onComplete(), /Verify your invited email/);
  assert.deepEqual(h.requests, []); h.cleanup(); assert.equal(h.unsubscribeCount, 1);
});

test('empty or repeated invitation parameters stay in setup instead of opening cached workspace access', async () => {
  for (const query of ['?invite=', `?invite=${invite}&invite=${invite}`]) {
    const h = runtime(query, user(true)); await h.mount();
    assert.equal(h.find(h.setup)?.props.invitationId, ''); assert.deepEqual(h.requests, []); h.cleanup();
  }
});

test('verified completion refreshes the token, retains unrelated URL state and uses the existing MFA gate', async () => {
  const account = user(true); const h = runtime(`?audit=job-1&invite=${invite}`, account, true);
  await h.mount(); await h.find(h.setup).props.onComplete();
  assert.equal(account.tokenCalls[0], true);
  assert.deepEqual(h.requests, ['/api/creditex/session']);
  assert.equal(h.window.location.href, 'https://test.invalid/creditex/compliance?audit=job-1#keep');
  assert.deepEqual(h.window.history.state, { retained: true });
  assert.equal(h.find(h.setup), null); assert.ok(h.find(h.security)); h.cleanup();
});

test('an account change while refreshing the verification token blocks completion and retains the invitation', async () => {
  const account = user(true); let release;
  account.getIdToken = () => new Promise(resolve => { release = resolve; });
  const h = runtime(`?invite=${invite}`, account); await h.mount();
  const pending = h.find(h.setup).props.onComplete();
  h.auth({ ...user(true), uid: 'different-user' }); release('fresh-token');
  await assert.rejects(pending, /signed-in account changed/);
  assert.deepEqual(h.requests, []); assert.match(h.window.location.search, /invite=/); h.cleanup();
});

test('normal Creditex sign-in without an invitation keeps its existing session flow', async () => {
  const h = runtime('', user(true)); await h.mount();
  assert.deepEqual(h.requests, ['/api/creditex/session']); assert.equal(h.find(h.setup), null); h.cleanup();
});
