import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { hasCreditexPermission } from '../src/lib/creditex-permissions.ts';

function load(path, dependencies) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  Function('require', 'exports', output)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports);
  return exports;
}
class AccessError extends Error { constructor(code, status, message) { super(message); this.code = code; this.status = status; } }
class ComplianceError extends Error { constructor(code, message, status = 403) { super(message); this.code = code; this.status = status; } }
function fixture({ permissions = [], admin = false, verified = true, organisation = 'CREDITEX-AU' } = {}) {
  let writes = 0, reads = 0; const options = [];
  const identity = { uid: 'reviewer', role: 'reviewer', organisationCode: organisation, governanceIdentityVerified: verified, permissions };
  const helper = load('../src/lib/creditex-onboarding-api.ts', {
    '../../db': {}, './firebase-server': {}, './trade-team-server': {},
    './compliance-access-server': { ComplianceAccessError: AccessError, requireComplianceAccess: async (_request, requested) => {
      options.push(requested);
      if (!hasCreditexPermission(identity, requested.requiredPermission)) throw new AccessError('COMPLIANCE_PERMISSION_REQUIRED', 403, 'Permission required.');
      return identity;
    } },
    './creditex-onboarding-server': { CreditexComplianceError: ComplianceError, creditexMutationConflict: () => null },
    './bounded-json-request': { BoundedJsonRequestError: class extends Error {} },
    './trade-team-member-files-server': { TeamMemberFileError: class extends Error {} },
    './trade-field-session-server': {}, './trade-access-server': { TradeAccessError: class extends Error {} },
    './firebase-mfa': { FirebaseMfaRequiredError: class extends Error {} },
  });
  const saved = async () => { writes++; return {}; };
  const route = load('../src/app/api/creditex-training-questionnaires/route.ts', {
    '../../../../db': { getD1: () => ({}) },
    '@/lib/admin-server': { sameOrigin: () => true, requireAdminIdentity: async () => { if (!admin) throw new Error('ADMIN_REQUIRED'); return { uid: 'actual-platform-admin' }; } },
    '@/lib/bounded-json-request': { readBoundedJsonRequest: request => request.json() },
    '@/lib/creditex-onboarding-api': helper,
    '@/lib/creditex-onboarding-server': { CreditexComplianceError: ComplianceError, record: value => value, textField: value => value || '' },
    '@/lib/australian-government-program-catalogue': { GOVERNMENT_PROGRAM_TEMPLATES: [] },
    '@/lib/energy-service-catalogue.mjs': { ENERGY_SERVICE_CATALOGUE: [] },
    '@/lib/training-questionnaire-store': { listTrainingQuestionnaires: async () => { reads++; return []; }, saveTrainingQuestionnaire: saved, publishTrainingQuestionnaire: saved, deleteTrainingQuestionnaireDraft: saved, retireTrainingQuestionnaire: saved },
  });
  return { helper, route, options, writes: () => writes, reads: () => reads };
}
const request = action => new Request('https://example.test/api/creditex-training-questionnaires', action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) } : {});

test('a verified Creditex reviewer without forms permission cannot read or mutate training questionnaires', async () => {
  const f = fixture({ permissions: ['governance'] });
  assert.equal((await f.route.GET(request())).status, 403);
  for (const action of ['save_draft', 'publish', 'delete_draft', 'delete_module']) assert.equal((await f.route.POST(request(action))).status, 403);
  assert.equal(f.reads(), 0); assert.equal(f.writes(), 0);
  assert.ok(f.options.every(options => options.requiredPermission === 'forms' && options.claimPendingInvitation === false));
});

test('forms permission retains Creditex named reviewer and organisation checks', async () => {
  for (const options of [{ verified: false }, { organisation: 'OTHER' }]) {
    const f = fixture({ permissions: ['forms'], ...options });
    assert.equal((await f.route.POST(request('save_draft'))).status, 403); assert.equal(f.writes(), 0);
  }
  const f = fixture({ permissions: ['forms'] });
  assert.equal((await f.route.GET(request())).status, 200); assert.equal((await f.route.POST(request('save_draft'))).status, 200);
  assert.equal(f.reads(), 1); assert.equal(f.writes(), 1);
});

test('onboarding documents and training governance default to the governance capability', async () => {
  const denied = fixture({ permissions: ['forms'] });
  await assert.rejects(denied.helper.requireCreditexTrainingReviewer(request()), error => error.code === 'COMPLIANCE_PERMISSION_REQUIRED');
  const allowed = fixture({ permissions: ['governance'] });
  assert.equal((await allowed.helper.requireCreditexTrainingReviewer(request())).uid, 'reviewer');
  assert.equal(allowed.options[0].requiredPermission, 'governance');
});

test('actual platform administrators retain independent training editor authority', async () => {
  const f = fixture({ admin: true, permissions: [] });
  assert.equal((await f.route.GET(request())).status, 200); assert.equal((await f.route.POST(request('publish'))).status, 200);
  assert.equal(f.options.length, 0); assert.equal(f.writes(), 1);
});
