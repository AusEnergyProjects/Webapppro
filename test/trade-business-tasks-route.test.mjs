import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { BusinessTaskError } from '../src/lib/trade-business-tasks.ts';
import * as boundedJson from '../src/lib/bounded-json-request.ts';

const source = readFileSync(new URL('../src/app/api/trade-tasks/route.ts', import.meta.url), 'utf8');
const executable = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class TradeBusinessContextError extends Error {
  constructor(code, status, publicMessage) { super(code); Object.assign(this, { code, status, publicMessage }); }
}
function fixture({ authError, operationError, sameOrigin = true } = {}) {
  const calls = [];
  const access = { ownerUid: 'selected-business', memberId: 'staff', actorUid: 'signed-in-user' };
  const services = {
    '@/lib/admin-server': {
      adminJson: (body, status = 200) => Response.json(body, { status }),
      sameOrigin: () => sameOrigin,
      mfaErrorResponse: error => error.message === 'MFA_REQUIRED' ? Response.json({ code: 'MFA_REQUIRED' }, { status: 403 }) : null,
    },
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async request => {
      calls.push(['auth', request]); if (authError) throw authError; return access;
    } },
    '@/lib/trade-business-tasks': { BusinessTaskError },
    '@/lib/bounded-json-request': boundedJson,
    '@/lib/trade-business-context-server': { TradeBusinessContextError },
    '@/lib/trade-business-tasks-server': Object.fromEntries(['listBusinessTasks', 'saveBusinessTask', 'taskPeople'].map(name => [name, async (...args) => {
      calls.push([name, ...args]); if (operationError) throw operationError; return name === 'saveBusinessTask' ? { id: 'saved' } : { tasks: [], people: [] };
    }])),
  };
  const moduleRecord = { exports: {} };
  new Function('require', 'module', 'exports', executable)(name => {
    assert.ok(services[name], `Unexpected import ${name}`); return services[name];
  }, moduleRecord, moduleRecord.exports);
  const request = (method = 'GET', query = '', body) => new Request(`https://example.test/api/trade-tasks${query}`, {
    method, headers: { Authorization: 'Bearer test', 'X-TLink-Business': 'selected-business', 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  return { ...moduleRecord.exports, calls, access, request };
}

test('both task methods reject a foreign origin before authentication or database work', async () => {
  const f = fixture({ sameOrigin: false });
  for (const method of ['GET', 'POST']) assert.equal((await f[method](f.request(method, '', {}))).status, 403);
  assert.deepEqual(f.calls, []);
});

test('task operations keep sign-in, verified business and MFA requirements', async () => {
  for (const [message, status] of [['AUTH_REQUIRED', 401], ['EMAIL_VERIFICATION_REQUIRED', 403], ['TEAM_ACCESS_RECORD_REQUIRED', 403], ['ABN_REVIEW_REQUIRED', 403], ['MFA_REQUIRED', 403]]) {
    const f = fixture({ authError: new Error(message) });
    for (const method of ['GET', 'POST']) {
      const response = await f[method](f.request(method, '', {})); assert.equal(response.status, status, message);
    }
    assert.ok(f.calls.every(call => call[0] === 'auth'));
  }
});

test('business selection failures preserve their public recovery code', async () => {
  const f = fixture({ authError: new TradeBusinessContextError('BUSINESS_ACCESS_REQUIRED', 403, 'Choose your business.') });
  const response = await f.GET(f.request());
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, code: 'BUSINESS_ACCESS_REQUIRED', error: 'Choose your business.' });
});

test('list and people search receive the authenticated business context', async () => {
  const f = fixture();
  await f.GET(f.request('GET', '?view=delegated&status=done&page=2'));
  assert.deepEqual(f.calls[1], ['listBusinessTasks', f.access, { view: 'delegated', status: 'done', page: '2' }]);
  await f.GET(f.request('GET', '?mode=people&q=Sam'));
  assert.deepEqual(f.calls[3], ['taskPeople', f.access, 'Sam']);
});

test('body-supplied business or actor cannot replace authenticated task scope', async () => {
  const f = fixture(); const body = { action: 'create', ownerUid: 'foreign', actorUid: 'other', title: 'Task' };
  const response = await f.POST(f.request('POST', '', body));
  assert.equal(response.status, 200); assert.deepEqual(f.calls[1], ['saveBusinessTask', f.access, body]);
});

test('malformed JSON, arrays, null and scalar payloads do not reach task writes', async () => {
  for (const body of ['{bad', '[]', 'null', '42', '"text"']) {
    const f = fixture(); assert.equal((await f.POST(f.request('POST', '', body))).status, 400);
    assert.equal(f.calls.length, 1);
  }
});

test('conflicts preserve an actionable status and internal errors remain private', async () => {
  const conflict = fixture({ operationError: new BusinessTaskError(409, 'Refresh before saving.') });
  const response = await conflict.POST(conflict.request('POST', '', {}));
  assert.equal(response.status, 409); assert.equal((await response.json()).error, 'Refresh before saving.');
  const broken = fixture({ operationError: new Error('SQL secret connection details') });
  const failure = await broken.GET(broken.request());
  assert.equal(failure.status, 500); assert.doesNotMatch(JSON.stringify(await failure.json()), /SQL|secret/);
});

test('oversized task requests fail before a write, including multibyte payloads', async () => {
  const f = fixture();
  const response = await f.POST(f.request('POST', '', { title: 'x', detail: '界'.repeat(6000) }));
  assert.equal(response.status, 413); assert.equal(f.calls.length, 1);
});
