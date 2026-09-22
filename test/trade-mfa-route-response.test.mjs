import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE, MFA_SETUP_URL } from '../src/lib/firebase-mfa.ts';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function compileFunctions(path, names, dependencies) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const declarations = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length, `Missing tested function in ${path}`);
  const output = ts.transpileModule(declarations.map(node => node.getText()).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  return new Function('exports', ...Object.keys(dependencies),
    `${output}\nreturn { ${names.join(', ')} };`)(moduleRecord.exports, ...Object.values(dependencies));
}

// Exercise the real response translation. Production authentication/DB tests
// live separately; this fixture checks that rejected access reaches the caller
// as an actionable HTTP response before any financial read or write begins.
const admin = compileFunctions('src/lib/admin-server.ts',
  ['adminJson', 'mfaErrorResponse', 'sameOrigin', 'cleanAdminText'],
  { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE, MFA_SETUP_URL });

function deniedRoute(routeName, error) {
  let guardCalls = 0;
  let databaseCalls = 0;
  class OtherDomainError extends Error {}
  const dependencies = {
    ...admin,
    requireInstallerTeamAccess: async () => { guardCalls += 1; throw error; },
    getD1: () => { databaseCalls += 1; throw new Error('Financial storage must not be touched'); },
    creditexMutationConflict: () => null,
    isTradeJobScheduleEligibilityConflict: () => false,
    isTradeComplianceIntentScheduleConflict: () => false,
    isRentalInspectionAssignmentConflict: () => false,
    CreditexComplianceError: OtherDomainError,
    TradeAddressVerificationError: OtherDomainError,
    TradeComplianceIntentError: OtherDomainError,
    ComplianceDomainError: OtherDomainError,
    TradeAccessError: OtherDomainError,
  };
  const names = ['GET', 'POST', 'PATCH', 'errorResponse'];
  if (routeName === 'trade-crm') names.push('crmIdentity');
  const route = compileFunctions(`src/app/api/${routeName}/route.ts`, names, dependencies);
  return { route, calls: () => ({ guardCalls, databaseCalls }) };
}

for (const routeName of ['trade-crm', 'trade-team']) {
  for (const method of ['GET', 'POST', 'PATCH']) {
    test(`${method} ${routeName} returns MFA setup instructions before data access`, async () => {
      const fixture = deniedRoute(routeName, new FirebaseMfaRequiredError());
      const response = await fixture.route[method](new Request(`https://example.test/api/${routeName}`, {
        method,
        ...(method === 'GET' ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'synthetic_denied_action' }),
        }),
      }));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        ok: false, code: 'MFA_REQUIRED', error: MFA_REQUIRED_MESSAGE, setupUrl: '/direct-trade/security',
      });
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(fixture.calls(), { guardCalls: 1, databaseCalls: 0 });
    });
  }

  test(`${routeName} preserves the unauthenticated response`, async () => {
    const fixture = deniedRoute(routeName, new Error('AUTH_REQUIRED'));
    const response = await fixture.route.GET(new Request(`https://example.test/api/${routeName}`));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: 'Sign in to continue.' });
    assert.deepEqual(fixture.calls(), { guardCalls: 1, databaseCalls: 0 });
  });
}
