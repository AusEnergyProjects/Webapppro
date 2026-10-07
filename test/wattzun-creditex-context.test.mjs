import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const contextTypes = load('../src/lib/wattzun-work-context.ts', {
  './wattzun-portal-path.ts': load('../src/lib/wattzun-portal-path.ts', {}),
});
const navigation = load('../src/lib/creditex-workspace-navigation.ts', {});
class AuditError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}

const request = new Request('https://example.test/api/wattzun/portal', { method: 'POST' });
const reference = { kind: 'creditex_audit', recordId: 'synthetic-audit' };
const identity = () => ({ uid: 'synthetic-reviewer', organisationId: 'synthetic-creditex', membershipId: 'synthetic-member',
  organisationCode: 'CREDITEX', role: 'reviewer', displayName: 'Synthetic reviewer', permissions: ['jobs', 'audit'] });
const workspace = () => ({ target: { intentId: reference.recordId, activityTitle: 'Synthetic inspection', activityDate: '2026-10-07',
  customerName: 'Excluded customer', customerPhone: 'Excluded phone', siteAddress: 'Excluded address' }, sourceSha256: 'a'.repeat(64),
  records: [{ id: 'form-one', kind: 'field', title: 'Inspection answers', revision: 1, status: 'submitted',
    answers: [{ label: 'Inspection date', section: 'Activity', value: '2026-10-06' }] }],
  requirements: [{ id: 'requirement-one', title: 'Recorded date', description: 'Record the inspection date.' }],
  files: [{ id: 'photo-one', kind: 'field_evidence', parentId: 'form-one', label: 'Synthetic inspection.jpg', contentType: 'image/jpeg',
    sizeBytes: 123, sha256: 'b'.repeat(64), capturedAt: '2026-10-07', previewPath: '/excluded-private-preview', objectKey: 'excluded-storage-key' },
  { id: 'restricted', kind: 'case_evidence', label: 'Excluded restricted metadata', unavailableReason: 'Reviewer assignment required' }],
  findings: [{ id: 'finding-one', requirementTitle: 'Recorded date', description: 'Confirm the recorded date.', status: 'open', severity: 'minor' },
    { id: 'resolved', description: 'Excluded resolved finding', status: 'resolved' }], capabilities: { canSave: true } });

function load(path, imports) {
  const exported = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in imports, `Unexpected import ${name}`); return imports[name];
  }, exported, exported.exports);
  return exported.exports;
}

function fixture(options = {}) {
  let selected = identity(), current = workspace(), identityCalls = 0;
  const calls = [], access = { db: {}, actorUid: selected.uid, scope: { portal: 'creditex', scopeId: selected.organisationId, label: 'Synthetic Creditex' } };
  const projection = load('../src/lib/creditex-job-audit-ai-server.ts', { 'node:crypto': { createHash },
    './workflow-ai-server': { requestWorkflowAi: () => { throw new Error('No provider calls permitted in context loading'); } },
    './creditex-job-audit-server': {} });
  const service = load('../src/lib/wattzun-creditex-context-server.ts', {
    'node:crypto': { createHash }, './trade-compliance-intent': { CREDITEX_PARTNER_ORGANISATION_CODE: 'CREDITEX' },
    './wattzun-work-context': contextTypes, './creditex-job-audit-ai-server': projection,
    './creditex-workspace-navigation': navigation,
    './compliance-access-server': { requireComplianceAccess: async (incoming, rules, db) => {
      identityCalls++; calls.push({ kind: 'identity', incoming, rules, db });
      if (options.denyAt === identityCalls) throw new Error('MFA_REQUIRED');
      options.onIdentity?.(selected, identityCalls);
      return structuredClone(selected);
    } },
    './creditex-job-audit-server': { CreditexJobAuditError: AuditError, loadCreditexJobAudit: async (db, actor, intentId) => {
      calls.push({ kind: 'audit', db, actor, intentId });
      if (options.auditFailure) throw options.auditFailure;
      return structuredClone(current);
    } },
  });
  return { service, access, calls, identity: () => selected, workspace: () => current,
    load: () => service.loadWattzunCreditexContext(request, access, reference) };
}

test('selected audit context uses current exact organisation permission and shared limited sources', async () => {
  const f = fixture(), result = await f.load();
  const checks = f.calls.filter(call => call.kind === 'identity');
  assert.equal(checks.length, 2);
  for (const check of checks) {
    assert.equal(check.incoming, request); assert.equal(check.db, f.access.db);
    assert.equal(check.rules.organisationId, f.access.scope.scopeId); assert.equal(check.rules.requiredPermission, 'audit');
    assert.equal(check.rules.claimPendingInvitation, false);
  }
  const audit = f.calls.find(call => call.kind === 'audit');
  assert.deepEqual(audit.actor, { kind: 'compliance', uid: 'synthetic-reviewer', organisationId: 'synthetic-creditex', memberId: 'synthetic-member', name: 'Synthetic reviewer', role: 'reviewer' });
  assert.equal(audit.intentId, reference.recordId); assert.deepEqual(result.reference, reference);
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/); assert.notEqual(result.sourceSha256, f.workspace().sourceSha256);
  assert.equal(result.title, 'Synthetic inspection'); assert.ok(result.sources.length <= 6);
  assert.equal(result.sources.length, 5); assert.equal(new Set(result.sources.map(source => source.id)).size, 5);
  for (const source of result.sources) assert.equal(navigation.creditexAuditFromSearch(new URL(source.href, request.url).search), reference.recordId);
  assert.match(JSON.stringify(result.facts), /Inspection date|photo-one|finding-one/);
  assert.doesNotMatch(JSON.stringify(result), /Excluded|excluded-storage-key|excluded-private-preview|customerPhone|siteAddress|objectKey/);
  assert.match(result.limitations.join(' '), /No file bytes/); assert.match(result.limitations.join(' '), /cannot mark audited/);
});

test('wrong portal, actor, organisation or partner cannot read an audit', async () => {
  for (const change of [f => { f.access.scope.portal = 'trade'; }, f => { f.identity().uid = 'other-actor'; },
    f => { f.identity().organisationId = 'other-org'; }, f => { f.identity().organisationCode = 'OTHER'; }]) {
    const f = fixture(); change(f);
    await assert.rejects(f.load(), error => error instanceof contextTypes.WattzunWorkContextError && error.status === 403);
    assert.equal(f.calls.filter(call => call.kind === 'audit').length, 0);
  }
});

test('existing audit access errors propagate and inactive or mismatched audit context is rejected', async () => {
  const failure = new Error('Existing assignment gate rejected access'), denied = fixture({ auditFailure: failure });
  await assert.rejects(denied.load(), error => error === failure);
  const inactive = fixture(); inactive.workspace().capabilities.canSave = false;
  await assert.rejects(inactive.load(), error => error.status === 403);
  const mismatch = fixture(); mismatch.workspace().target.intentId = 'other-audit';
  await assert.rejects(mismatch.load(), error => error.status === 409);
});

test('assignment loss and mid-read access revocation retain actionable private-access status without exposing job details', async () => {
  for (const error of [new AuditError('AUDIT_NOT_FOUND', 'Excluded private record detail', 404),
    new AuditError('AUDIT_ACCESS_CHANGED', 'Excluded private access detail', 403)]) {
    const f = fixture({ auditFailure: error });
    await assert.rejects(f.load(), failure => {
      assert.ok(failure instanceof contextTypes.WattzunWorkContextError); assert.equal(failure.status, 403);
      assert.match(failure.message, /Reopen an assigned job/); assert.doesNotMatch(failure.message, /Excluded/); return true;
    });
    assert.equal(f.calls.filter(call => call.kind === 'identity').length, 1);
  }
});

test('audit source changes remain recoverable and preserve the current-source action', async () => {
  const f = fixture({ auditFailure: new AuditError('AUDIT_SOURCE_CHANGED', 'Excluded source details', 409) });
  await assert.rejects(f.load(), error => {
    assert.ok(error instanceof contextTypes.WattzunWorkContextError); assert.equal(error.status, 409);
    assert.match(error.message, /Refresh the audit/); assert.match(error.message, /call can continue/);
    assert.doesNotMatch(error.message, /Excluded/); return true;
  });
});

test('MFA, sign-in loss and current role or permission changes cannot yield context', async () => {
  for (const denyAt of [1, 2]) await assert.rejects(fixture({ denyAt }).load(), /MFA_REQUIRED/);
  for (const onIdentity of [selected => { selected.uid = 'changed-user'; }, selected => { selected.role = 'auditor'; },
    selected => { selected.permissions = ['jobs']; }, selected => { selected.membershipId = 'changed-member'; }]) {
    const f = fixture({ onIdentity: (selected, call) => { if (call === 2) onIdentity(selected); } });
    await assert.rejects(f.load(), error => error.status === 403 || error.status === 409);
  }
});

test('context identity changes with audit source, structured answers, accessible metadata, requirements, findings and actor authority', async () => {
  const original = await fixture().load();
  for (const change of [f => { f.workspace().sourceSha256 = 'c'.repeat(64); }, f => { f.workspace().records[0].answers[0].value = '2026-10-07'; },
    f => { f.workspace().files[0].sha256 = 'c'.repeat(64); }, f => { f.workspace().requirements[0].description = 'Changed recorded requirement'; },
    f => { f.workspace().findings[0].description = 'Changed recorded finding'; }, f => { f.identity().role = 'auditor'; },
    f => { f.identity().permissions.push('corrections'); }]) {
    const f = fixture(); change(f); assert.notEqual((await f.load()).sourceSha256, original.sourceSha256);
  }
  const stable = fixture(); stable.identity().permissions.reverse(); assert.equal((await stable.load()).sourceSha256, original.sourceSha256);
  stable.workspace().target.customerPhone = 'Changed excluded contact'; stable.workspace().files[1].label = 'Changed excluded restricted file';
  assert.equal((await stable.load()).sourceSha256, original.sourceSha256);
});

test('oversized UTF8 audit facts fail closed without truncating sources', async () => {
  const f = fixture(); f.workspace().records[0].answers[0].value = '🛠'.repeat(7_000);
  await assert.rejects(f.load(), error => error.status === 413);
  assert.equal(f.workspace().records[0].answers[0].value.length, 14_000);
  const title = fixture(); title.workspace().target.activityTitle = 'a'.repeat(241);
  await assert.rejects(title.load(), error => error.status === 413);
});
