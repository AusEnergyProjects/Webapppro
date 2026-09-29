import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const authSource = read('../src/lib/auth.ts');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function authHarness(provider = async () => new Response('{"ok":true}', { status: 202 }), timers = { setTimeout, clearTimeout }) {
  const requests = [];
  const dependencies = {
    '@react-native-async-storage/async-storage': {},
    'firebase/app': { getApps: () => [], initializeApp: () => ({}) },
    'firebase/auth': { initializeAuth: () => ({ currentUser: null }), getReactNativePersistence: () => ({}) },
    '@/lib/config': { API_BASE_URL: 'https://configured-tlink.example', firebaseConfig: {} },
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', 'setTimeout', 'clearTimeout', compile(authSource))(id => {
    assert.ok(dependencies[id], `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exports, async (url, init) => {
    requests.push({ url, init });
    return provider(url, init);
  }, timers.setTimeout, timers.clearTimeout);
  return { ...exports, requests };
}

test('password reset uses the configured TLink service without login or business context', async () => {
  const h = authHarness();
  await h.resetPassword('  Person@Example.com  ');
  assert.equal(h.requests.length, 1);
  const { url, init } = h.requests[0];
  assert.equal(url, 'https://configured-tlink.example/api/auth/password-reset');
  assert.equal(init.method, 'POST');
  assert.deepEqual(JSON.parse(init.body), { email: 'person@example.com', continuePath: '/direct-trade/team' });
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json' });
  assert.equal(init.signal.aborted, false);
  assert.doesNotMatch(authSource, /sendPasswordResetEmail/);
});

test('invalid email does not send a password reset request', async () => {
  const h = authHarness();
  for (const email of ['', 'person', 'a@example.com\nother@example.com', `${'a'.repeat(250)}@example.com`]) {
    await assert.rejects(h.resetPassword(email), /Enter a valid email address/);
  }
  assert.equal(h.requests.length, 0);
});

test('backend rejection uses safe status messages without displaying server details', async () => {
  for (const [status, message] of [
    [400, 'Enter a valid email address before resetting your password.'],
    [429, 'Please wait before requesting another password reset.'],
    [500, 'The password reset service is temporarily unavailable. Please try again.'],
  ]) {
    const h = authHarness(async () => new Response(JSON.stringify({ error: 'Internal provider details: <unsafe> person@example.com' }), { status }));
    await assert.rejects(h.resetPassword('person@example.com'), { message });
    assert.equal(h.requests.length, 1);
  }
});

test('an unsuccessful HTTP status cannot acknowledge a reset even with ok true', async () => {
  const h = authHarness(async () => new Response('{"ok":true}', { status: 500 }));
  await assert.rejects(h.resetPassword('person@example.com'), /temporarily unavailable/);
});

test('network failure never reports that email was sent', async () => {
  const h = authHarness(async () => { throw new TypeError('Network request failed'); });
  await assert.rejects(h.resetPassword('person@example.com'), /could not request a password reset.*connection/);
});

test('a stalled password reset aborts and clears its request timeout', async () => {
  let triggerTimeout;
  const cleared = [];
  const h = authHarness((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), {
    setTimeout: (callback, duration) => {
      assert.equal(duration, 20_000);
      triggerTimeout = callback;
      return 7;
    },
    clearTimeout: timeout => cleared.push(timeout),
  });
  const request = h.resetPassword('person@example.com');
  triggerTimeout();
  await assert.rejects(request, /could not request a password reset.*connection/);
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.deepEqual(cleared, [7]);
});

test('malformed or unsuccessful responses cannot become successful requests', async () => {
  for (const body of ['{}', '{"ok":false}', '{"ok":"true"}', 'null', '[]', 'service offline', '{"error":"Internal provider details"}']) {
    const h = authHarness(async () => new Response(body));
    await assert.rejects(h.resetPassword('person@example.com'), /could not request|did not respond correctly/);
  }
});

function resetScreenHarness(provider) {
  const source = read('../src/app/index.tsx');
  const start = source.indexOf('  async function reset() {');
  const end = source.indexOf('\n\n  return (', start);
  assert.ok(start > 0 && end > start);
  const messages = [];
  const busy = [];
  const reset = new Function('email', 'resetPassword', 'setMessage', 'setBusy', `${source.slice(start, end)}\nreturn reset;`)(
    'person@example.com', provider, message => messages.push(message), value => busy.push(value),
  );
  return { reset, messages, busy };
}

test('sign-in acknowledgment identifies the branded email without exposing account existence or claiming delivery', async () => {
  const h = resetScreenHarness(async () => {});
  await h.reset();
  assert.match(h.messages.at(-1), /^If this email has a login/);
  assert.match(h.messages.at(-1), /"Reset your TLink password" from TLink/);
  assert.match(h.messages.at(-1), /tap Reset password/);
  assert.doesNotMatch(h.messages.at(-1), /have been sent|delivered|firebaseapp/);
  assert.deepEqual(h.busy, [true, false]);
});

test('sign-in screen shows reset errors instead of a misleading sign-in error or success', async () => {
  const h = resetScreenHarness(async () => { throw new Error('Reset email is temporarily unavailable. Please try again.'); });
  await h.reset();
  assert.equal(h.messages.at(-1), 'Reset email is temporarily unavailable. Please try again.');
  assert.deepEqual(h.busy, [true, false]);
});
