import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as supportErrors from '../src/lib/admin-job-read-error.ts';
import * as collaboration from '../src/lib/trade-job-collaboration.ts';
import * as bounded from '../src/lib/bounded-json-request.ts';

function load(path, dependencies) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected reader dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT,partner_type TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,record_status TEXT,
      source_type TEXT,source_reference TEXT,assignee_member_id TEXT,assignee_label TEXT,stage TEXT,service_category TEXT,revision INTEGER);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,customer_source TEXT);
    CREATE TABLE trade_crm_job_media(id TEXT PRIMARY KEY,firebase_uid TEXT,work_order_id TEXT,object_key TEXT,file_name TEXT,content_type TEXT);
    INSERT INTO trade_accounts VALUES ('business-a','Applied Trade Services','installer'),('business-b','Other business','installer');
    INSERT INTO trade_work_orders VALUES
      ('job-a','business-a','installer','active','internal','','','','completed','rental-inspection',3),
      ('job-other','business-a','installer','active','internal','','','','scheduled','rental-inspection',4),
      ('job-foreign','business-b','installer','active','internal','','','','scheduled','rental-inspection',1);
    INSERT INTO trade_crm_job_media VALUES
      ('photo-a','business-a','job-a','private/a','ceiling.jpg','image/jpeg'),
      ('photo-other','business-a','job-other','private/other','other.jpg','image/jpeg'),
      ('photo-foreign','business-b','job-foreign','private/foreign','foreign.jpg','image/jpeg');`);
  const reads = [], audits = [];
  let active = true;
  const database = { prepare(sql) {
    assert.match(sql.trim(), /^SELECT\b/i, 'Opening support records cannot change trade data');
    const statement = (values = []) => ({ bind: (...next) => statement(next),
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; } });
    return statement();
  } };
  const db = { getD1: () => database };
  const admin = {
    adminJson: (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
    mfaErrorResponse: supportErrors.adminJobReadError,
    sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin,
    cleanAdminText: (value, maximum) => typeof value === 'string' ? value.trim().slice(0, maximum) : '',
    async requireAdminIdentity(_request, roles) { assert.ok(roles.includes('support')); if (!active) throw new Error('ADMIN_SUSPENDED'); return { uid: 'actual-support-admin', email: 'admin@example.test', displayName: 'Admin', role: 'support' }; },
    adminError: error => Response.json({ ok: false, error: error.message }, { status: 403 }),
    async writeAdminAudit(...entry) { audits.push(entry); },
  };
  const support = load('src/lib/admin-job-read-access.ts', { '../../db': db, './admin-server': admin, './admin-job-read-error': supportErrors });
  const team = load('src/lib/trade-team-server.ts', {
    '../../db': db, './admin-job-read-access': support, './trade-job-collaboration': collaboration,
    './firebase-server': {}, './trade-mfa-server': {}, './trade-access-server': {}, './trade-business-context-server': {},
    './creditex-schema-guards': {}, './trade-team-permission-policy.mjs': {}, './trade-crews-server': {}, './trade-field-session-server': {},
  });
  class ComplianceError extends Error {}
  const route = load('src/app/api/trade-field-work/route.ts', {
    '../../../../db': db, '@/lib/admin-job-read-access': support, '@/lib/admin-server': admin,
    '@/lib/trade-team-server': team, '@/lib/trade-job-collaboration': collaboration,
    'cloudflare:workers': { env: { EVIDENCE: { async get(key) { reads.push(key); return { body: `saved bytes:${key}`, httpMetadata: { contentType: 'image/jpeg' } }; } } } },
    '@/lib/creditex-onboarding-server': { CreditexComplianceError: ComplianceError, creditexMutationConflict: () => null },
    '@/lib/bounded-json-request': bounded,
    '@/lib/trade-form-job-progress': {}, '@/lib/trade-certificate-eligibility': {}, '@/lib/trade-field-completion-policy': {},
    '@/lib/trade-activity-forms-completion': {}, '@/lib/trade-team-sync-server': {}, '@/lib/photo-request-review-server': {},
    '@/lib/trade-photo-requests': {}, '@/lib/trade-crm-job-media-cleanup': {}, '@/lib/trade-rental-image-dimensions.mjs': {}, '@/lib/trade-rental-evidence.mjs': {},
  });
  return { route, team, support, reads, audits, sqlite, db, admin, revoke: () => { active = false; }, close: () => sqlite.close() };
}

function rentalFixture() {
  const f = fixture();
  const bytes = new TextEncoder().encode('%PDF-1.7 retained rental inspection report');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const objectKey = `trade-issued-documents/rental-report/report-a/revision-1/${hash}.pdf`;
  f.sqlite.exec(`CREATE TABLE trade_rental_inspections(id TEXT,firebase_uid TEXT,work_order_id TEXT,status TEXT,issued_report_id TEXT,assessor_member_id TEXT);
    CREATE TABLE trade_rental_reports(id TEXT,firebase_uid TEXT,inspection_id TEXT,report_number TEXT,revision INTEGER,status TEXT,
      pdf_object_key TEXT,pdf_sha256 TEXT,pdf_size_bytes INTEGER,issued_at TEXT);
    CREATE TABLE trade_rental_inspection_events(inspection_id TEXT,firebase_uid TEXT,report_id TEXT,event_type TEXT,actor_type TEXT,actor_uid TEXT,metadata TEXT);
    CREATE TABLE trade_rental_report_links(id TEXT,firebase_uid TEXT,inspection_id TEXT,report_id TEXT,status TEXT,expires_at TEXT,
      view_count INTEGER,download_count INTEGER,token_issue INTEGER,token_hash TEXT,encrypted_token TEXT,created_at TEXT);
    INSERT INTO trade_rental_inspections VALUES
      ('inspection-a','business-a','job-a','issued','report-a','assessor-a'),
      ('inspection-other','business-a','job-other','issued','report-other','assessor-a'),
      ('inspection-foreign','business-b','job-foreign','issued','report-foreign','assessor-b');
    INSERT INTO trade_rental_report_links VALUES
      ('share-a','business-a','inspection-a','report-a','active','2999-12-31',2,3,1,'private-token-hash','encrypted-private-secret','2026-10-26');`);
  for (const [id, owner, inspection] of [
    ['report-a', 'business-a', 'inspection-a'], ['report-other', 'business-a', 'inspection-other'], ['report-foreign', 'business-b', 'inspection-foreign'],
  ]) f.sqlite.prepare('INSERT INTO trade_rental_reports VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, owner, inspection, `RMS-${id}`, 1, 'issued', objectKey, hash, bytes.byteLength, '2026-10-26');
  const workers = { env: { EVIDENCE: { async get(key) { f.reads.push(key); return { arrayBuffer: async () => bytes.buffer }; } } } };
  const immutable = load('src/lib/trade-issued-document-store.ts', { 'cloudflare:workers': workers });
  const report = load('src/lib/trade-rental-report-server.ts', {
    'cloudflare:workers': workers, '../../db': f.db, '@/lib/trade-team-server': f.team,
    '@/lib/trade-team-sync-server': {}, '@/lib/trade-rental-assessment.mjs': {}, '@/lib/trade-issued-document-store': immutable,
    '@/lib/trade-rental-report-links': { recoverRentalReportSecret() { assert.fail('Support cannot recover a customer share secret'); } },
    '@/lib/customer-plan-pdf-fonts': {}, '@/lib/trade-rental-evidence.mjs': {}, '@/lib/rental-assessor-workflow.mjs': {},
    '@/lib/trade-rental-credentials': {}, '@/lib/rental-report-answer.mjs': {}, '@/lib/rental-report-branding.mjs': {},
    '@/lib/rental-quotation.mjs': {}, '@/lib/trade-rental-schema-guards': {},
  });
  const reportRoute = load('src/app/api/trade-rental-inspections/report/[reportId]/pdf/route.ts', {
    '@/lib/admin-server': f.admin, '@/lib/trade-team-server': f.team,
    '@/lib/admin-job-read-access': f.support, '@/lib/trade-rental-report-server': report,
  });
  return { ...f, report, reportRoute, bytes, objectKey };
}

const request = (query, method = 'GET') => new Request(`https://example.test/api/trade-field-work?${query}`, {
  method, headers: { Authorization: 'Bearer admin', 'X-TLink-Admin-Job': 'job-a' },
});

test('admin media download uses canonical job scope, exact retained bytes and private response headers', async () => {
  const f = fixture();
  try {
    const response = await f.route.GET(request('download=photo-a'));
    assert.equal(response.status, 200); assert.equal(await response.text(), 'saved bytes:private/a');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="ceiling.jpg"');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(f.reads, ['private/a']);
    assert.equal(f.audits[0][0].uid, 'actual-support-admin');
    assert.equal(f.audits[0][3], 'job-a');
  } finally { f.close(); }
});

test('admin cannot read a sibling job or another business file even with a valid selected job', async () => {
  const f = fixture();
  try {
    for (const query of ['preview=photo-other', 'download=photo-foreign', 'download=photo-a&workOrderId=job-other']) {
      const response = await f.route.GET(request(query));
      assert.ok([403, 404].includes(response.status), query);
    }
    assert.deepEqual(f.reads, []);
    const access = await f.support.requireAdminJobReadAccess(request('download=photo-a'));
    await assert.rejects(f.team.assignedJob(access, 'job-other'), /JOB_NOT_ASSIGNED/);
    await assert.rejects(f.team.requireAssignedJob(access, 'job-other', { id: 'job-other' }), /JOB_NOT_ASSIGNED/);
  } finally { f.close(); }
});

test('revoked admin and every media mutation remain denied before stored bytes or business writes', async () => {
  const f = fixture();
  try {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      if (typeof f.route[method] !== 'function') continue;
      const response = await f.route[method](request('download=photo-a', method));
      assert.equal(response.status, 403, method);
    }
    assert.deepEqual(f.reads, []); assert.equal(f.audits.length, 0);
    f.revoke();
    assert.equal((await f.route.GET(request('download=photo-a'))).status, 403);
    assert.deepEqual(f.reads, []); assert.equal(f.audits.length, 0);
  } finally { f.close(); }
});

test('admin rental report downloads verified saved bytes and retains customer share secrets and counters', async () => {
  const f = rentalFixture();
  try {
    const before = f.sqlite.prepare('SELECT * FROM trade_rental_report_links').all();
    const reports = await f.report.ownerRentalReportPresentation({ ownerUid: 'business-a', inspectionId: 'inspection-a',
      origin: 'https://example.test', includeSecret: false, includeInternalPdf: true });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].link.shareUrl, ''); assert.equal(reports[0].link.pdfUrl, '');
    assert.doesNotMatch(JSON.stringify(reports), /private-token-hash|encrypted-private-secret/);
    const response = await f.reportRoute.GET(new Request(reports[0].internalPdfUrl, {
      headers: { Authorization: 'Bearer admin', 'X-TLink-Admin-Job': 'job-a' },
    }), { params: Promise.resolve({ reportId: 'report-a' }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.bytes);
    assert.deepEqual(f.reads, [f.objectKey]);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM trade_rental_report_links').all(), before);
    for (const id of ['report-other', 'report-foreign']) {
      const denied = await f.reportRoute.GET(new Request(`https://example.test/api/trade-rental-inspections/report/${id}/pdf?workOrderId=job-a`, {
        headers: { Authorization: 'Bearer admin', 'X-TLink-Admin-Job': 'job-a' },
      }), { params: Promise.resolve({ reportId: id }) });
      assert.equal(denied.status, 404);
    }
    assert.deepEqual(f.reads, [f.objectKey], 'Other reports never reach private object storage');
  } finally { f.close(); }
});

test('admin quote photos use the selected job and do not write trade view events', async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`ALTER TABLE trade_crm_job_media ADD COLUMN source TEXT DEFAULT 'accepted_public_lead';
      ALTER TABLE trade_crm_job_media ADD COLUMN caption TEXT DEFAULT 'Customer photo';
      ALTER TABLE trade_crm_job_media ADD COLUMN size_bytes INTEGER DEFAULT 1;
      ALTER TABLE trade_crm_job_media ADD COLUMN created_at TEXT DEFAULT '2026-10-26';`);
    const route = load('src/app/api/trade-job-quote-photos/route.ts', {
      '../../../../db': f.db, '@/lib/admin-server': f.admin,
      '@/lib/admin-job-read-access': f.support, '@/lib/trade-team-server': f.team,
      'cloudflare:workers': { env: { EVIDENCE: { async get(key) { f.reads.push(key); return { body: 'saved customer photo' }; } } } },
    });
    const photoRequest = query => new Request(`https://example.test/api/trade-job-quote-photos?${query}`, {
      headers: { Authorization: 'Bearer admin', 'X-TLink-Admin-Job': 'job-a' },
    });
    const listing = await route.GET(photoRequest('workOrderId=job-a'));
    assert.equal(listing.status, 200);
    assert.deepEqual((await listing.json()).acceptedPhotos.map(photo => photo.id), ['photo-a']);
    const photo = await route.GET(photoRequest('workOrderId=job-a&mediaId=photo-a'));
    assert.equal(photo.status, 200); assert.equal(await photo.text(), 'saved customer photo');
    for (const query of ['workOrderId=job-a&mediaId=photo-other', 'workOrderId=job-a&mediaId=photo-foreign', 'workOrderId=job-other']) {
      assert.ok([403, 404].includes((await route.GET(photoRequest(query))).status), query);
    }
    assert.deepEqual(f.reads, ['private/a']);
    assert.equal(f.audits[1][0].uid, 'actual-support-admin');
  } finally { f.close(); }
});
