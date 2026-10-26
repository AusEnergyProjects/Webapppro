import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as errors from '../src/lib/admin-job-read-error.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT,partner_type TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,record_status TEXT);
    INSERT INTO trade_accounts VALUES ('trade-a','Applied Trade Services','installer'),('trade-b','Other business','installer');
    INSERT INTO trade_work_orders VALUES ('job-a','trade-a','installer','active'),('job-b','trade-b','installer','active'),('old-job','trade-a','installer','archived');`);
  const audits = [], authCalls = [];
  let failure = '', auditFailure = false;
  const admin = { uid: 'real-admin', email: 'support@example.test', displayName: 'Support', role: 'support' };
  const d1 = { prepare(sql) { return { bind(...values) { return { async first() { return sqlite.prepare(sql).get(...values) || null; } }; } }; } };
  const dependencies = {
    '../../db': { getD1: () => d1 }, './admin-job-read-error': errors,
    './admin-server': {
      adminJson: (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
      sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin,
      async requireAdminIdentity(request, allowedRoles) {
        authCalls.push({ authorization: request.headers.get('authorization'), allowedRoles });
        if (failure) throw new Error(failure);
        if (!allowedRoles.includes(admin.role)) throw new Error('ROLE_REQUIRED');
        return admin;
      },
      adminError: error => Response.json({ ok: false, error: error.message }, { status: error.message === 'AUTH_REQUIRED' ? 401 : 403, headers: { 'Cache-Control': 'no-store' } }),
      async writeAdminAudit(...entry) { if (auditFailure) throw new Error('audit unavailable'); audits.push(entry); },
    },
  };
  const source = fs.readFileSync(new URL('../src/lib/admin-job-read-access.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(specifier => {
    assert.ok(dependencies[specifier], `Unexpected support dependency: ${specifier}`);
    return dependencies[specifier];
  }, loaded, loaded.exports);
  return { ...loaded.exports, admin, audits, authCalls, close: () => sqlite.close(),
    failAuth: value => { failure = value; }, failAudit: () => { auditFailure = true; } };
}

const request = (path = '/api/trade-crm?mode=detail&resource=job&id=job-a', options = {}) => new Request(`https://example.test${path}`, {
  ...options, headers: { Authorization: 'Bearer real-admin-token', 'X-TLink-Admin-Job': 'job-a', ...options.headers },
});
const denied = status => error => error instanceof errors.AdminJobReadError && error.response.status === status;

test('support derives the business from the selected job, keeps the real admin actor and audits every read', async () => {
  const f = fixture();
  try {
    const access = await f.requireAdminJobReadAccess(request(undefined, { headers: { 'X-TLink-Business': 'trade-b' } }));
    assert.equal(access.ownerUid, 'trade-a'); assert.equal(access.actorUid, 'real-admin');
    assert.equal(access.supportWorkOrderId, 'job-a'); assert.equal(access.isOwner, false); assert.equal(access.memberId, '');
    for (const [key, value] of Object.entries(access)) {
      if (/^can(?:Manage|Create|Assign|Send|Edit|Apply|Reschedule|Run|Search)/.test(key)) assert.equal(value, false, key);
    }
    assert.equal(access.canViewFieldEvidence, true);
    assert.deepEqual(f.authCalls[0].allowedRoles, ['owner', 'admin', 'support']);
    assert.equal(f.authCalls[0].authorization, 'Bearer real-admin-token');
    assert.equal(f.audits[0][0].uid, 'real-admin'); assert.equal(f.audits[0][3], 'job-a');
    await f.requireAdminJobReadAccess(request('/api/trade-rental-inspections?workOrderId=job-a'));
    assert.equal(f.audits.length, 2);
  } finally { f.close(); }
});

test('ordinary trade requests cannot gain support access and support cannot fall through to ordinary trade auth', async () => {
  const f = fixture();
  try {
    assert.equal(await f.requireAdminJobReadAccess(new Request('https://example.test/api/trade-crm')), null);
    assert.equal(f.authCalls.length, 0);
    assert.throws(() => f.rejectAdminJobAccess(request()), denied(403));
    assert.throws(() => f.rejectAdminJobMutation(request(undefined, { method: 'POST' })), denied(403));
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD']) {
      await assert.rejects(f.requireAdminJobReadAccess(request(undefined, { method })), denied(403));
    }
    assert.equal(f.audits.length, 0);
  } finally { f.close(); }
});

test('job scope rejects alternate jobs, broad indexes, unknown endpoints, malformed ids and foreign origins', async () => {
  const f = fixture();
  try {
    for (const path of [
      '/api/trade-crm?mode=bootstrap', '/api/trade-crm?mode=detail&resource=customer&id=job-a',
      '/api/trade-crm?mode=detail&resource=job&id=job-b', '/api/trade-rental-inspections?workOrderId=job-b',
      '/api/trade-team/work-packs?workOrderId=job-a&workOrderId=job-b', '/api/trade-businesses',
    ]) await assert.rejects(f.requireAdminJobReadAccess(request(path)), denied(403));
    await assert.rejects(f.requireAdminJobReadAccess(request(undefined, { headers: { Origin: 'https://foreign.test' } })), denied(403));
    await assert.rejects(f.requireAdminJobReadAccess(request(undefined, { headers: { 'X-TLink-Admin-Job': '../job-a' } })), denied(400));
    assert.equal(f.audits.length, 0);
  } finally { f.close(); }
});

test('revoked admin, MFA failures, unavailable jobs and audit failures cannot release a support capability', async () => {
  const f = fixture();
  try {
    for (const code of ['AUTH_REQUIRED', 'ADMIN_REQUIRED', 'ADMIN_SUSPENDED', 'MFA_REQUIRED']) {
      f.failAuth(code);
      await assert.rejects(f.requireAdminJobReadAccess(request()), denied(code === 'AUTH_REQUIRED' ? 401 : 403));
    }
    f.failAuth(''); f.admin.role = 'reviewer';
    await assert.rejects(f.requireAdminJobReadAccess(request()), denied(403));
    f.admin.role = 'owner';
    for (const id of ['missing', 'old-job']) await assert.rejects(f.requireAdminJobReadAccess(request(`/api/trade-rental-inspections?workOrderId=${id}`, { headers: { 'X-TLink-Admin-Job': id } })), denied(404));
    f.failAudit(); await assert.rejects(f.requireAdminJobReadAccess(request()), /audit unavailable/);
    assert.equal(f.audits.length, 0);
  } finally { f.close(); }
});
