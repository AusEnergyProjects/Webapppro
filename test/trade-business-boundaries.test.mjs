import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE, MFA_SETUP_URL } from '../src/lib/firebase-mfa.ts';

function functions(path, names, dependencies = {}) {
  const source = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const nodes = source.statements.filter(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && names.includes(node.name?.text));
  assert.equal(nodes.length, names.length);
  const compiled = ts.transpileModule(nodes.map(node => node.getText()).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('exports', ...Object.keys(dependencies), `${compiled}\nreturn {${names.join(',')}};`)({}, ...Object.values(dependencies));
}

const shared = functions('src/lib/admin-server.ts', ['adminJson', 'mfaErrorResponse', 'sameOrigin'],
  { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE, MFA_SETUP_URL });
const owner = functions('src/lib/trade-access-server.ts', ['TradeAccessError', 'assertTradeOwnerContext']);
const request = selected => new Request('https://tlink.test/api/field/access', {
  headers: selected === undefined ? {} : { 'X-TLink-Business': selected },
});

test('owner-only tools cannot act on the actors own business while another team is selected', async () => {
  let reads = 0;
  const guard = functions('src/lib/trade-access-server.ts', ['requireVerifiedTradeAccess'], {
    requireFirebaseIdentity: async () => ({ uid: 'owned-business' }),
    assertTradeOwnerContext: owner.assertTradeOwnerContext,
    requireVerifiedTradeIdentity: async identity => { reads++; return identity; },
  });
  for (const selected of ['another-team', '', 'owned-business,another-team']) {
    await assert.rejects(guard.requireVerifiedTradeAccess(request(selected)), error => error.code === 'BUSINESS_OWNER_CONTEXT_REQUIRED');
  }
  assert.equal(reads, 0);
  await guard.requireVerifiedTradeAccess(request('owned-business'));
  await guard.requireVerifiedTradeAccess(request());
  assert.equal(reads, 2);
});

test('business context errors remain actionable at shared API response boundaries', async () => {
  for (const [code, status] of [['BUSINESS_SELECTION_REQUIRED', 409], ['BUSINESS_ACCESS_REQUIRED', 403], ['BUSINESS_OWNER_CONTEXT_REQUIRED', 403]]) {
    const response = shared.mfaErrorResponse(Object.assign(new Error('private provider details'), { code }));
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(body.error, /private provider/);
  }
  assert.equal(shared.mfaErrorResponse(new Error('unrelated')), null);
});

function fieldFixture(trade) {
  let manualReads = 0;
  const api = functions('src/app/api/field/access/route.ts', ['GET', 'sameOrigin', 'json'], {
    requireInstallerTeamAccess: async () => { if (trade instanceof Error) throw trade; return trade; },
    tradeFieldPermissions: () => ({ canViewCustomers: true }),
    mfaErrorResponse: shared.mfaErrorResponse,
    getD1: () => ({}),
    requireManualFieldMember: async () => { manualReads++; return { displayName: 'Reviewer', organisationTradingName: 'Compliance org' }; },
    hasManualFieldAssignment: async () => true,
  });
  return { api, manualReads: () => manualReads };
}

test('selected mobile business returns exact principal and never mixes compliance organisation jobs', async () => {
  const fixture = fieldFixture({ ownerUid: 'team-b', memberId: 'member-b', isOwner: false, businessName: 'Business B', displayName: 'Jane' });
  const response = await fixture.api.GET(request('team-b'));
  const body = await response.json();
  assert.deepEqual(body.modes, ['trade_team']);
  assert.equal(body.ownerUid, 'team-b');
  assert.equal(body.memberId, 'member-b');
  assert.equal(body.isOwner, false);
  assert.equal(fixture.manualReads(), 0);
});

test('ambiguous or revoked selection cannot fall back to compliance access', async () => {
  for (const code of ['BUSINESS_SELECTION_REQUIRED', 'BUSINESS_ACCESS_REQUIRED']) {
    const fixture = fieldFixture(Object.assign(new Error(code), { code }));
    const response = await fixture.api.GET(request());
    assert.equal((await response.json()).code, code);
    assert.equal(fixture.manualReads(), 0);
  }
});

test('manual-only users retain their existing assigned compliance access without a trade selection', async () => {
  const fixture = fieldFixture(new Error('TEAM_ACCESS_RECORD_REQUIRED'));
  const response = await fixture.api.GET(request());
  const body = await response.json();
  assert.deepEqual(body.modes, ['creditex_manual']);
  assert.equal(body.businessName, 'Compliance org');
  assert.equal('ownerUid' in body, false);
});

test('communication handoff is revalidated in the business stored on the handoff', async () => {
  let checked;
  const actor = { ownerUid: 'team-b', memberId: 'member-b' };
  const handoff = functions('src/lib/trade-communications-access.ts', ['originalAccess'], {
    decryptProtectedPayload: async () => ({ authorization: 'Bearer test-token', deviceId: '' }),
    requireInstallerTeamAccess: async input => { checked = input; return actor; },
    assertDevice: async () => {},
  });
  await handoff.originalAccess({ owner_uid: 'team-b', member_id: 'member-b', encrypted_auth: 'encrypted' }, request('team-a'));
  assert.equal(checked.headers.get('X-TLink-Business'), 'team-b');
  actor.ownerUid = 'team-a';
  await assert.rejects(handoff.originalAccess({ owner_uid: 'team-b', member_id: 'member-b' }, request()), /AUTH_REQUIRED/);
});

test('expired selected-business authentication returns sign-in required without probing another organisation', async () => {
  const fixture = fieldFixture(new Error('AUTH_REQUIRED'));
  const response = await fixture.api.GET(request('team-b'));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'AUTH_REQUIRED');
  assert.equal(fixture.manualReads(), 0);
});

test('calculator cannot silently use the actors compliance organisation or own business from a selected team', async () => {
  let complianceReads = 0;
  let ownerReads = 0;
  class ComplianceAccessError extends Error {}
  const calculator = functions('src/lib/creditex-calculator-access-server.ts', ['requireCreditexCalculatorAccess', 'CreditexCalculatorAccessError'], {
    assertTradeOwnerContext: owner.assertTradeOwnerContext,
    TradeAccessError: owner.TradeAccessError,
    ComplianceAccessError,
    requireFirebaseIdentity: async () => ({ uid: 'owned-business' }),
    requireComplianceIdentity: async () => { complianceReads++; return { organisationId: 'compliance-org' }; },
    requireVerifiedTradeIdentity: async () => { ownerReads++; return { firebaseUid: 'owned-business' }; },
  });
  await assert.rejects(calculator.requireCreditexCalculatorAccess(request('team-b')), error => error.code === 'BUSINESS_OWNER_CONTEXT_REQUIRED');
  assert.equal(ownerReads, 0);
  assert.equal(complianceReads, 0);
  const result = await calculator.requireCreditexCalculatorAccess(request('owned-business'));
  assert.equal(result.accessType, 'installer');
  assert.equal(complianceReads, 0);
  assert.equal(ownerReads, 1);
});

test('business profile access cannot read or modify the actors own profile from another selected team', async () => {
  const profile = functions('src/app/api/trade-profile/route.ts', ['identityOrResponse'], {
    requireFirebaseIdentity: async () => ({ uid: 'own-business' }),
    assertTradeOwnerContext: owner.assertTradeOwnerContext,
    TradeAccessError: owner.TradeAccessError,
    json: shared.adminJson,
  });
  const denied = await profile.identityOrResponse(request('employer'));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'BUSINESS_OWNER_CONTEXT_REQUIRED');
  assert.deepEqual(await profile.identityOrResponse(request('own-business')), { uid: 'own-business' });
});

test('onboarding uses selected team membership even when the actor owns another pending business', async () => {
  let teamReads = 0;
  const onboarding = functions('src/lib/creditex-onboarding-api.ts', ['requireCreditexOnboardingAccess'], {
    isFieldSessionRequest: () => false,
    requireFirebaseIdentity: async () => ({ uid: 'own-business', emailVerified: true }),
    getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => ({ business_name: 'Own pending business' }) }) }) }),
    requireInstallerTeamAccess: async input => { teamReads++; assert.equal(input.headers.get('X-TLink-Business'), 'employer'); return { ownerUid: 'employer', actorUid: 'own-business', isOwner: false, displayName: 'Installer', memberId: 'team-member' }; },
  });
  assert.equal((await onboarding.requireCreditexOnboardingAccess(request('employer'))).ownerUid, 'employer');
  assert.equal(teamReads, 1);
  assert.equal((await onboarding.requireCreditexOnboardingAccess(request('own-business'))).ownerUid, 'own-business');
  assert.equal(teamReads, 1);
});
