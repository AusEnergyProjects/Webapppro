import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as policy from '../src/lib/trade-customer-delivery-exceptions.ts';

const source = fs.readFileSync(new URL('../src/app/api/trade-customer-delivery-exceptions/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(access, { origin = true, authError } = {}) {
  const calls = [], exports = {};
  const services = {
    '../../../../db': { getD1: () => 'database' },
    '@/lib/admin-server': { sameOrigin: () => origin, adminJson: (body, status = 200) => Response.json(body, { status }) },
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async request => { calls.push(['auth', request]); if (authError) throw authError; return access; } },
    '@/lib/trade-customer-delivery-exceptions': policy,
    '@/lib/trade-customer-delivery-exceptions-server': { loadCustomerDeliveryExceptions: async (...args) => { calls.push(['load', ...args]); return { items: [], total: 0, page: 1, hasNext: false }; }, customerDeliveryFailureDiagnostic: () => ({ code: 'test' }) },
    '@/lib/trade-email-api': { tradeEmailApiError: error => Response.json({ ok: false, error: error.message }, { status: error.message === 'EMAIL_INPUT_INVALID' ? 400 : 403 }) },
  };
  Function('require', 'exports', compiled)(id => { assert.ok(services[id], id); return services[id]; }, exports);
  return { calls, async get(query = '') { return exports.GET(new Request(`https://tlink.test/api/trade-customer-delivery-exceptions${query}`)); } };
}
const identity = { ownerUid: 'selected-business', actorUid: 'office-user', memberId: 'office', isOwner: false };

test('delivery API accepts existing quote, finance and booking grants and uses authenticated business scope', async () => {
  for (const grant of [{ isOwner: true }, { canViewQuotes: true, canSendQuotes: true }, { canViewInvoices: true, canManageInvoices: true }, { canViewCustomers: true, canRescheduleJobs: true }]) {
    const access = { ...identity, ...grant }, f = fixture(access);
    const result = await f.get('?workOrderId=job-one&page=2&ownerUid=foreign&memberId=other');
    assert.equal(result.status, 200);
    assert.deepEqual(f.calls[1], ['load', 'database', access, { workOrderId: 'job-one', page: 2 }]);
  }
});

test('read-only, field and crew roles cannot use the delivery exceptions API', async () => {
  for (const grant of [{}, { canViewQuotes: true }, { canViewInvoices: true }, { canViewInvoices: true, canManageInvoices: true, crewLead: true }]) {
    const f = fixture({ ...identity, ...grant }); assert.equal((await f.get()).status, 403);
    assert.equal(f.calls.length, 1);
  }
});

test('origin, revoked login and invalid job ID checks stop before querying private receipts', async () => {
  const origin = fixture(identity, { origin: false }); assert.equal((await origin.get()).status, 403); assert.deepEqual(origin.calls, []);
  const revoked = fixture(identity, { authError: new Error('TEAM_ACCESS_RECORD_REQUIRED') }); assert.equal((await revoked.get()).status, 403); assert.equal(revoked.calls.length, 1);
  const invalid = fixture({ ...identity, canViewInvoices: true, canManageInvoices: true }); assert.equal((await invalid.get('?workOrderId=%00')).status, 400); assert.equal(invalid.calls.length, 1);
});
