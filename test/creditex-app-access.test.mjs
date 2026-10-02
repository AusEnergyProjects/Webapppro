import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as permissions from '../src/lib/creditex-permissions.ts';

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
class ComplianceAccessError extends Error { constructor(code, status, message) { super(message); this.code = code; this.status = status; } }
const member = { membershipId: 'staff', uid: 'named-user', organisationId: 'creditex', organisationCode: 'CREDITEX-AU', organisationTradingName: 'Creditex', organisationLegalName: 'Creditex Pty Ltd', displayName: 'Alex Staff', email: 'alex@example.test', role: 'reviewer' };
const projection = {};
new Function('require', 'exports', compile('../src/lib/creditex-app-access-server.ts'))(id => {
  if (id === './compliance-access-server') return { ComplianceAccessError };
  if (id === './creditex-permissions') return permissions;
  if (id === './trade-compliance-intent') return { CREDITEX_PARTNER_ORGANISATION_CODE: 'CREDITEX-AU' };
  throw new Error(id);
}, projection);
test('native access projection preserves the named identity and never grants trade PIN access', () => {
  const result = projection.creditexAppAccess({ ...member, permissions: ['jobs', 'messages', 'tasks'] });
  assert.equal(result.member.uid, member.uid); assert.equal(result.member.id, member.membershipId);
  assert.equal(result.workspace, 'creditex'); assert.equal(result.signInMethod, 'named_account');
  assert.equal(result.capabilities.jobs, true); assert.equal(result.capabilities.sendMessages, false);
  assert.equal(result.capabilities.createTasks, false); assert.equal(result.capabilities.completeTasks, false);
  assert.equal(result.capabilities.calculator, true); assert.equal('pin' in result, false);
});
test('native actions preserve granular dependencies and separate task creation from assignment', () => {
  const result = projection.creditexAppAccess({ ...member, permissions: ['tasks', 'tasks_create', 'messages_send'] });
  assert.equal(result.capabilities.createTasks, true); assert.equal(result.capabilities.assignTasks, false);
  assert.equal(result.capabilities.sendMessages, false); assert.equal(result.capabilities.messages, false);
  const assigned = projection.creditexAppAccess({ ...member, permissions: ['tasks', 'tasks_create', 'tasks_assign'] });
  assert.equal(assigned.capabilities.createTasks, true); assert.equal(assigned.capabilities.assignTasks, true);
  const assignOnly = projection.creditexAppAccess({ ...member, permissions: ['tasks', 'tasks_assign'] });
  assert.equal(assignOnly.capabilities.createTasks, false); assert.equal(assignOnly.capabilities.assignTasks, true);
  const empty = projection.creditexAppAccess({ ...member, permissions: [] });
  assert.equal(empty.capabilities.jobs, false); assert.equal(empty.capabilities.map, false);
});
test('other compliance organisations cannot enter the Creditex app', () => {
  assert.throws(() => projection.creditexAppAccess({ ...member, organisationCode: 'OTHER' }), error => error.code === 'CREDITEX_PARTNER_REQUIRED' && error.status === 403);
});

function routeHarness() {
  const state = { calls: 0, error: null }, exports = {};
  new Function('require', 'exports', compile('../src/app/api/creditex/app-access/route.ts'))(id => {
    if (id === '@/lib/admin-server') return { sameOrigin: request => !request.headers.has('origin') || request.headers.get('origin') === new URL(request.url).origin,
      adminJson: (body, status = 200) => Response.json(body, { status }), adminError: () => Response.json({ ok: false }, { status: 500 }) };
    if (id === '@/lib/compliance-access-server') return { ComplianceAccessError, requireComplianceAccess: async () => { state.calls++; if (state.error) throw state.error; return member; } };
    if (id === '@/lib/creditex-app-access-server') return projection;
    throw new Error(id);
  }, exports);
  return { ...exports, state };
}
test('app endpoint reuses current compliance authentication and does not suppress membership or MFA denial', async () => {
  const route = routeHarness();
  for (const code of ['COMPLIANCE_MEMBERSHIP_INACTIVE', 'MFA_REQUIRED', 'EMAIL_VERIFICATION_REQUIRED']) {
    route.state.error = new ComplianceAccessError(code, 403, 'Access denied');
    const response = await route.GET(new Request('https://tlink.test/api/creditex/app-access'));
    assert.equal(response.status, 403); assert.equal((await response.json()).code, code);
  }
  assert.equal(route.state.calls, 3);
});
test('cross-origin app discovery is rejected before membership lookup', async () => {
  const route = routeHarness();
  assert.equal((await route.GET(new Request('https://tlink.test/api/creditex/app-access', { headers: { origin: 'https://other.test' } }))).status, 403);
  assert.equal(route.state.calls, 0);
});
