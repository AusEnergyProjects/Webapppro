import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as supportErrors from '../src/lib/admin-job-read-error.ts';
import * as supportFixture from './helpers/admin-job-read-fixture.mjs';

function compile(path, dependencies) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function d1(sqlite) {
  return { prepare(sql) {
    return { bind(...values) { return {
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { throw new Error(`A document read tried to write: ${sql}`); },
    }; } };
  } };
}
const support = { ownerUid: 'owner-a', actorUid: 'real-admin', memberId: '', supportWorkOrderId: 'job-a',
  isOwner: false, canViewInvoices: true, canViewFieldEvidence: true, jobScope: 'team', canManageFieldEvidence: false };
// These tests start after the separately tested admin/MFA/audit boundary. Use
// the actual assigned-job reader and real SQL to test document ID isolation.
const supportAccess = { ...supportFixture, requireAdminJobReadAccess: async () => support };
const adminServer = { adminJson: (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
  cleanAdminText: (value, maximum) => typeof value === 'string' ? value.trim().slice(0, maximum) : '',
  sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin,
  mfaErrorResponse: supportErrors.adminJobReadError };
function request(path, method = 'GET') {
  return new Request(`https://example.test${path}`, { method, headers: { 'X-TLink-Admin-Job': 'job-a' } });
}
function assignedJobs(db) {
  const unused = new Proxy({}, { get: (_object, key) => { throw new Error(`Unexpected authentication or mutation dependency: ${String(key)}`); } });
  return compile('src/lib/trade-team-server.ts', {
    '../../db': { getD1: () => db }, './admin-job-read-access': supportFixture,
    './trade-job-collaboration': unused, './firebase-server': unused, './trade-mfa-server': unused,
    './trade-access-server': unused, './trade-business-context-server': unused, './creditex-schema-guards': unused,
    './trade-team-permission-policy.mjs': unused, './trade-crews-server': unused, './trade-field-session-server': unused,
  });
}

test('support invoice downloads bind an invoice ID to the selected job before loading retained bytes', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE trade_crm_quick_invoices(id TEXT,firebase_uid TEXT,work_order_id TEXT);
    CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,partner_type TEXT,record_status TEXT,source_type TEXT,source_reference TEXT,assignee_member_id TEXT,assignee_label TEXT,stage TEXT,service_category TEXT,revision INTEGER);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,customer_source TEXT);
    INSERT INTO trade_crm_quick_invoices VALUES ('invoice-a','owner-a','job-a'),('invoice-b','owner-a','job-b'),('invoice-x','owner-x','job-x');
    INSERT INTO trade_work_orders VALUES ('job-a','owner-a','installer','active','internal','','worker','Worker','completed','rental-inspection',1);`);
  const db = d1(sqlite), loaded = [];
  const route = compile('src/app/api/trade-quick-invoices/[invoiceId]/pdf/route.ts', {
    '@/lib/admin-server': adminServer, '@/lib/admin-job-read-access': supportAccess,
    '../../../../../../db': { getD1: () => db }, '@/lib/trade-team-server': assignedJobs(db),
    '@/lib/trade-quick-invoice-server': { issuedQuickInvoicePdf: async (ownerUid, invoiceId) => {
      loaded.push({ ownerUid, invoiceId }); return { snapshot: {}, bytes: new TextEncoder().encode('%PDF-retained') };
    } },
    '@/lib/trade-quick-invoice-pdf-server': { tradeQuickInvoicePdfFilename: () => 'invoice.pdf' },
  });
  const get = invoiceId => route.GET(request(`/api/trade-quick-invoices/${invoiceId}/pdf`), { params: Promise.resolve({ invoiceId }) });
  const result = await get('invoice-a'); assert.equal(result.status, 200); assert.equal(await result.text(), '%PDF-retained');
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal((await get('invoice-b')).status, 403);
  assert.equal((await get('invoice-x')).status, 404);
  assert.equal((await get('missing')).status, 404);
  assert.deepEqual(loaded, [{ ownerUid: 'owner-a', invoiceId: 'invoice-a' }]);
});

test('support handover downloads reject another job or business and cannot upload or delete files', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE trade_handover_packs(id TEXT,work_order_id TEXT,firebase_uid TEXT,status TEXT);
    CREATE TABLE trade_handover_documents(id TEXT,file_name TEXT,content_type TEXT,object_key TEXT,customer_visible INTEGER,handover_pack_id TEXT);
    INSERT INTO trade_handover_packs VALUES ('pack-a','job-a','owner-a','draft'),('pack-b','job-b','owner-a','published'),('pack-x','job-x','owner-x','published');
    INSERT INTO trade_handover_documents VALUES ('doc-a','report.pdf','application/pdf','object-a',0,'pack-a'),('doc-b','other.pdf','application/pdf','object-b',1,'pack-b'),('doc-x','private.pdf','application/pdf','object-x',1,'pack-x');`);
  const reads = [], db = d1(sqlite);
  const route = compile('src/app/api/trade-handover/documents/route.ts', {
    'cloudflare:workers': { env: { EVIDENCE: { async get(key) { reads.push(key); return { body: '%PDF-retained' }; } } } },
    '../../../../../db': { getD1: () => db }, '@/lib/admin-job-read-access': supportAccess,
    '@/lib/firebase-server': { requireFirebaseIdentity: async () => ({ uid: 'real-admin' }) },
    '@/lib/trade-handover.mjs': { HANDOVER_DOCUMENT_CATEGORIES: [] },
    '@/lib/admin-server': { requireAdminIdentity: () => { throw new Error('Support must retain its scoped access'); }, writeAdminAudit: () => { throw new Error('Already audited at the selected-job boundary'); } },
    '@/lib/customer-asset-ownership-server': { canCustomerAccessHandover: () => false },
    '@/lib/trade-access-server': { requireVerifiedTradeAccess: () => { throw new Error('Support is not a trade login'); }, TradeAccessError: class extends Error {} },
  });
  const result = await route.GET(request('/api/trade-handover/documents?download=doc-a'));
  assert.equal(result.status, 200); assert.equal(await result.text(), '%PDF-retained');
  assert.match(result.headers.get('cache-control'), /no-store/);
  for (const id of ['doc-b', 'doc-x']) assert.equal((await route.GET(request(`/api/trade-handover/documents?download=${id}`))).status, 403);
  for (const method of ['POST', 'DELETE']) assert.equal((await route[method](request('/api/trade-handover/documents', method))).status, 403);
  assert.deepEqual(reads, ['object-a']);
});

test('support handover reads retain exact job scope and reject state-changing methods', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,partner_type TEXT,record_status TEXT,source_type TEXT,source_reference TEXT,assignee_member_id TEXT,assignee_label TEXT,stage TEXT,service_category TEXT,revision INTEGER,work_number TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,customer_source TEXT);
    CREATE TABLE trade_handover_packs(id TEXT,work_order_id TEXT,firebase_uid TEXT,customer_project_id TEXT,service_category TEXT,status TEXT,submitted_at TEXT,published_at TEXT,review_note TEXT,created_at TEXT,updated_at TEXT);
    INSERT INTO trade_work_orders VALUES ('job-a','owner-a','installer','active','internal','','worker','Worker','completed','rental-inspection',1,'JOB-A');`);
  const db = d1(sqlite), route = compile('src/app/api/trade-handover/route.ts', {
    '../../../../db': { getD1: () => db }, '@/lib/admin-server': adminServer,
    '@/lib/admin-job-read-access': supportAccess, '@/lib/trade-team-server': assignedJobs(db),
    '@/lib/trade-access-server': { TradeAccessError: class extends Error {} },
    '@/lib/trade-handover.mjs': { HANDOVER_ASSET_CATEGORIES: [] },
    '@/lib/direct-trade-entitlements-server': {}, '@/lib/admin-notifications': {}, '@/lib/admin-notification-delivery': {},
  });
  const selected = await route.GET(request('/api/trade-handover?workOrderId=job-a'));
  assert.equal(selected.status, 200); assert.equal((await selected.json()).pack, null);
  assert.equal((await route.GET(request('/api/trade-handover?workOrderId=job-b'))).status, 403);
  sqlite.exec("UPDATE trade_work_orders SET record_status = 'archived' WHERE id = 'job-a'");
  assert.equal((await route.GET(request('/api/trade-handover?workOrderId=job-a'))).status, 404);
  for (const method of ['POST', 'PATCH']) assert.equal((await route[method](request('/api/trade-handover', method))).status, 403);
});

test('read-only quote PDF access uses retained bytes and never backfills a missing artifact', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE trade_crm_quote_versions(id TEXT,quote_id TEXT,firebase_uid TEXT,version_number INTEGER,status TEXT,issued_pdf_object_key TEXT,issued_pdf_sha256 TEXT,issued_pdf_size_bytes INTEGER);
    INSERT INTO trade_crm_quote_versions VALUES ('saved','quote-a','owner-a',1,'issued','retained.pdf','${'a'.repeat(64)}',13),('legacy','quote-a','owner-a',2,'issued','','',0);`);
  const reads = [], writes = [];
  const server = compile('src/lib/trade-quote-issued-pdf-server.ts', {
    '../../db': { getD1: () => d1(sqlite) }, '@/lib/trade-issued-document-store': {
      readImmutableIssuedPdf: async (reference, identity) => { reads.push({ reference, identity }); return new TextEncoder().encode('%PDF-retained'); },
      storeImmutableIssuedPdf: async input => { writes.push(input); throw new Error('Support must never store an issued PDF'); },
    },
  });
  const input = id => ({ ownerUid: 'owner-a', quoteVersionId: id, snapshot: { quoteVersionId: id }, origin: 'https://example.test', allowBackfill: false });
  const result = await server.issuedTradeQuotePdf(input('saved'));
  assert.equal(new TextDecoder().decode(result.bytes), '%PDF-retained');
  await assert.rejects(server.issuedTradeQuotePdf(input('legacy')), /QUOTE_ISSUED_PDF_UNAVAILABLE/);
  await assert.rejects(server.issuedTradeQuotePdf({ ...input('saved'), ownerUid: 'owner-x' }), /QUOTE_ISSUED_PDF_UNAVAILABLE/);
  assert.equal(reads.length, 1); assert.equal(writes.length, 0);
  assert.equal(sqlite.prepare("SELECT issued_pdf_object_key FROM trade_crm_quote_versions WHERE id='legacy'").get().issued_pdf_object_key, '');
});
