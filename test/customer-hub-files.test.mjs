import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { migratedDataforceD1 } from './helpers/trade-dataforce-database.mjs';
import { certificateTestDependency } from './helpers/creditex-training-fixture.mjs';
import * as consent from '../src/lib/public-plan-enquiry.mjs';
import * as catalogue from '../src/lib/energy-service-catalogue.mjs';
import * as collaboration from '../src/lib/trade-job-collaboration.ts';
import * as profiles from '../src/lib/customer-hub-business-profile.ts';
import * as images from '../src/lib/private-image-evidence.ts';

function load(path, dependencies) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function('require', 'exports', source)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
// Real migrated D1 and production authority/notification SQL. Only the environment
// encryption, signed-in identity and R2 boundaries are replaced with synthetic data.
const protection = { encryptProtectedPayload: async value => JSON.stringify(value), decryptProtectedPayload: async value => JSON.parse(value) };
const quoteLinks = load('../src/lib/trade-quote-links.ts', { '@/lib/trade-integration-crypto': protection });
const links = load('../src/lib/customer-hub-links.ts', {
  './trade-integration-crypto': protection, './trade-quote-links': quoteLinks, './public-plan-enquiry.mjs': consent,
});
const hubServer = load('../src/lib/customer-quote-hub-server.ts', {
  './customer-hub-business-profile': profiles,
  './trade-access-server': certificateTestDependency('trade-access-server'),
  './aea-trade-owner-server': certificateTestDependency('aea-trade-owner-server'),
  './trade-certificate-leads': certificateTestDependency('trade-certificate-leads'),
  './public-plan-enquiry.mjs': consent, './energy-service-catalogue.mjs': catalogue,
  './customer-hub-links': links, './trade-quote-links': quoteLinks,
  './trade-quote-decision-server': { storedQuoteDecision: async () => null },
});
const tradeServer = load('../src/lib/trade-customer-hub-server.ts', {
  './customer-quote-hub-server': hubServer, './trade-job-collaboration': collaboration,
});
const origin = 'https://ausenergyassessments.com';
const unexpected = () => { throw new Error('No provider delivery or workflow creation is expected.'); };

async function fixture(t) {
  const runtime = await migratedDataforceD1(); t.after(() => runtime.close());
  const native = runtime.db;
  let beforeBatch, afterBatch, duringGet, failDelete = false;
  const statement = (sql, value = native.prepare(sql)) => ({
    native: value, bind: (...values) => statement(sql, value.bind(...values)),
    first: (...args) => value.first(...args), all: () => value.all(), run: () => value.run(),
  });
  const db = { prepare: sql => statement(sql), batch: async statements => {
    const before = beforeBatch; beforeBatch = null; await before?.();
    const result = await native.batch(statements.map(item => item.native));
    const after = afterBatch; afterBatch = null; await after?.();
    return result;
  } };
  const insert = async (table, input) => {
    const values = {};
    for (const column of (await native.prepare(`PRAGMA table_info(${table})`).all()).results) {
      if (column.notnull && column.dflt_value === null) values[column.name] = /INT/i.test(column.type) ? 0 : '';
    }
    Object.assign(values, input);
    await native.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).bind(...Object.values(values)).run();
  };
  const now = new Date().toISOString(), services = '["solar","hot-water"]', email = 'customer@example.invalid';
  for (const suffix of ['', '-foreign']) {
    await insert('trade_opportunities', { id: `opportunity${suffix}`, title: 'Synthetic enquiry', project_type: 'residential', state: 'VIC', postcode: '3000',
      status: 'open', service_categories: services, source_reference: `source${suffix}`, expires_at: '2099-12-31T23:59:59.000Z', created_at: now, updated_at: now });
    await insert('public_trade_lead_contact_releases', { id: `release${suffix}`, opportunity_id: `opportunity${suffix}`, source_reference: `source${suffix}`, customer_email: email,
      postcode: '3000', notice_version: consent.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, consent_purpose: consent.PUBLIC_PLAN_CONSENT_PURPOSE,
      disclosed_fields: '["customer_email","postcode","service_categories"]', granted_at: now, created_at: now, updated_at: now });
  }
  await insert('trade_accounts', { firebase_uid: 'owner', email: 'owner@example.invalid', business_name: 'Verified Ordinary Trade', partner_type: 'installer',
    account_status: 'active', abn: '53004085616', verified_abn: '53004085616', verification_status: 'approved', verification_review_id: 'review',
    verification_reviewed_at: now, verification_reviewed_by_uid: 'reviewer', capabilities: services, service_states: '["VIC"]', created_at: now, updated_at: now });
  await insert('trade_account_verification_reviews', { id: 'review', firebase_uid: 'owner', abn: '53004085616', business_name: 'Verified Ordinary Trade',
    partner_type: 'installer', decision: 'approved', review_method: 'official_abr_lookup', reviewed_by_uid: 'reviewer', reviewed_at: now });
  await insert('trade_opportunity_matches', { id: 'match', opportunity_id: 'opportunity', firebase_uid: 'owner', status: 'interested',
    matched_categories: '["solar"]', matched_at: now, updated_at: now });
  await insert('customer_hub_interests', { match_id: 'match', opportunity_id: 'opportunity', interested: 1, interested_since: now, updated_at: now, updated_by_uid: 'owner' });
  await insert('trade_crm_customers', { id: 'customer', firebase_uid: 'owner', customer_number: 'CUS-1', email, created_at: now, updated_at: now });
  await insert('trade_work_orders', { id: 'work', firebase_uid: 'owner', partner_type: 'installer', work_number: 'JOB-1', title: 'Synthetic job',
    source_type: 'public_lead', source_reference: 'match', service_categories: services, assignee_member_id: 'staff', created_at: now, updated_at: now });
  await insert('trade_crm_job_details', { id: 'detail', work_order_id: 'work', firebase_uid: 'owner', customer_source: 'public_lead_released', crm_customer_id: 'customer', created_at: now, updated_at: now });
  await insert('trade_team_members', { id: 'staff', owner_uid: 'owner', member_uid: 'staff-uid', email: 'staff@example.invalid', role: 'member', status: 'active',
    can_view_quotes: 1, can_manage_quotes: 1, can_view_customers: 1, can_receive_customer_qa_notifications: 1, job_scope: 'own', created_at: now, updated_at: now });
  await insert('customer_hub_questions', { id: 'question', opportunity_id: 'opportunity', match_id: 'match', service_categories_json: '["solar"]',
    kind: 'document', prompt: 'Share a supporting document.', created_at: now, updated_at: now });
  const token = decodeURIComponent(new URL(await links.customerHubEmailUrl(db, 'opportunity', email)).pathname.split('/').at(-1));
  const foreignToken = decodeURIComponent(new URL(await links.customerHubEmailUrl(db, 'opportunity-foreign', email)).pathname.split('/').at(-1));
  const authority = await links.authoriseCustomerHub(db, token);
  const owner = { ownerUid: 'owner', actorUid: 'owner', isOwner: true, memberId: '', canViewQuotes: true, canManageQuotes: true,
    canViewCustomers: true, canReceiveCustomerQaNotifications: true, jobScope: 'team' };
  let access = owner;
  const objects = new Map(), deleted = [];
  const bucket = {
    put: async (key, bytes) => { objects.set(key, new Uint8Array(bytes)); },
    get: async key => { const body = objects.get(key); const hook = duringGet; duringGet = null; await hook?.(); return body ? { body } : null; },
    delete: async key => { deleted.push(key); if (failDelete) throw new Error('Synthetic R2 failure'); objects.delete(key); },
  };
  const admin = { sameOrigin: request => request.headers.get('origin') === new URL(request.url).origin, mfaErrorResponse: () => null };
  const route = load('../src/app/api/customer-hub/[token]/files/route.ts', {
    '../../../../../../db': { getD1: () => db }, '@/lib/admin-server': admin,
    '@/lib/customer-hub-links': links, '@/lib/customer-quote-hub-server': hubServer,
    '@/lib/customer-project-evidence-bucket': { getCustomerProjectEvidenceBucket: () => bucket }, '@/lib/private-image-evidence': images,
  });
  const tradeRoute = load('../src/app/api/trade-customer-hub/route.ts', {
    '../../../../db': { getD1: () => db }, '@/lib/admin-server': admin, '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => access },
    '@/lib/trade-customer-hub-server': tradeServer, '@/lib/customer-quote-hub-server': hubServer, '@/lib/customer-hub-links': links,
    '@/lib/customer-project-evidence-bucket': { getCustomerProjectEvidenceBucket: () => bucket },
    '@/lib/customer-hub-email-server': { hubEmailStatement: unexpected, drainCustomerHubEmails: unexpected },
    '@/lib/public-lead-quote-workflow-server': { startPublicLeadQuoteWorkflow: unexpected }, '@/lib/opportunity-server': { syncMarketplaceEnquiries: unexpected },
  });
  const context = capability => ({ params: Promise.resolve({ token: capability }) });
  const get = (id, capability = token) => route.GET(new Request(`${origin}/api/customer-hub/${capability}/files?id=${id}`), context(capability));
  const remove = (id, capability = token, requestOrigin = origin) => route.DELETE(new Request(`${origin}/api/customer-hub/${capability}/files?id=${id}`, {
    method: 'DELETE', headers: { origin: requestOrigin },
  }), context(capability));
  const upload = async (contents = '%PDF-1.4 synthetic document') => {
    const form = new FormData(); form.set('questionId', 'question'); form.set('file', new File([contents], 'customer.pdf', { type: 'application/pdf' }));
    return route.POST(new Request(`${origin}/api/customer-hub/${token}/files`, { method: 'POST', headers: { origin }, body: form }), context(token));
  };
  const row = id => db.prepare('SELECT * FROM customer_hub_files WHERE id=?').bind(id).first();
  const firstFile = async () => { const response = await upload(); assert.equal(response.status, 201, await response.clone().text()); return (await response.json()).hub.questions[0].files[0].id; };
  return { db, native, insert, token, foreignToken, authority, owner, objects, deleted, get, remove, upload, row, firstFile,
    tradeGet: id => tradeRoute.GET(new Request(`${origin}/api/trade-customer-hub?workOrderId=work&fileId=${id}`)),
    setAccess: value => { access = value; }, beforeBatch: hook => { beforeBatch = hook; }, afterBatch: hook => { afterBatch = hook; },
    duringGet: hook => { duringGet = hook; }, failDelete: value => { failDelete = value; },
    notifications: () => tradeServer.hubTradeNotifications(db, access),
    view: () => hubServer.loadCustomerQuoteHub(db, authority), tradeView: () => tradeServer.tradeHubView(db, access, 'work'),
  };
}

test('real D1 removes files for everyone, preserves history, notifies interest and allows a fresh reupload', async t => {
  const f = await fixture(t), id = await f.firstFile(), original = await f.row(id);
  assert.equal((await f.get(id)).status, 200); assert.equal((await f.tradeGet(id)).status, 200);
  const response = await f.remove(id), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.cleanupPending, false);
  assert.deepEqual(body.hub.questions[0].files, []); assert.deepEqual((await f.tradeView()).questions[0].files, []);
  assert.equal((await f.get(id)).status, 404); assert.equal((await f.tradeGet(id)).status, 404);
  assert.ok((await f.row(id)).removed_at); assert.ok((await f.row(id)).storage_deleted_at);
  assert.equal(f.objects.has(original.object_key), false);
  assert.equal((await f.db.prepare("SELECT count(*) n FROM customer_hub_events WHERE event_type='file_added'").first()).n, 1);
  const notification = (await f.notifications()).find(item => item.title === 'Customer removed a shared file');
  assert.equal(notification.targetId, 'customer'); assert.equal(notification.workOrderId, 'work');
  assert.doesNotMatch(JSON.stringify(notification), /customer\.pdf|object_key|customer-hub\//);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM customer_hub_email_deliveries').first()).n, 0);
  await f.db.prepare("UPDATE customer_hub_interests SET interested=0 WHERE match_id='match'").run();
  assert.deepEqual(await f.notifications(), []);
  const next = await f.firstFile(); assert.notEqual(next, id);
  assert.equal((await f.get(id)).status, 404); assert.equal((await f.get(next)).status, 200);
  await f.db.prepare(`WITH RECURSIVE removed(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM removed WHERE n<60)
    INSERT INTO customer_hub_files(id,question_id,opportunity_id,file_name,content_type,size_bytes,object_key,sha256,created_at,removed_at,storage_deleted_at)
    SELECT 'old-'||n,'question','opportunity','old.pdf','application/pdf',10,'old-key-'||n,'old-hash-'||n,'old','removed','cleaned' FROM removed`).run();
  assert.equal((await f.upload('%PDF-1.4 another active file')).status, 201, 'removed rows consume neither project nor question upload limits');
});

test('paused projects support concurrent and repeated removal with exactly one removal event', async t => {
  const f = await fixture(t), id = await f.firstFile();
  await f.db.prepare('UPDATE customer_quote_hubs SET accepting=0 WHERE id=?').bind(f.authority.id).run();
  const responses = await Promise.all([f.remove(id), f.remove(id), f.remove(id)]);
  for (const response of responses) { assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).hub.accepting, false); }
  assert.equal((await f.db.prepare("SELECT count(*) n FROM customer_hub_events WHERE event_type='file_removed'").first()).n, 1);
  assert.equal((await f.remove(id)).status, 200);
});

test('origin, foreign hub and stale transaction authority cannot remove an active file', async t => {
  const f = await fixture(t), id = await f.firstFile();
  assert.equal((await f.remove(id, f.token, 'https://foreign.invalid')).status, 403);
  assert.equal((await f.remove(id, f.foreignToken)).status, 404);
  f.beforeBatch(() => f.native.prepare("UPDATE customer_quote_hubs SET revoked_at='revoked' WHERE id=?").bind(f.authority.id).run());
  assert.equal((await f.remove(id)).status, 404);
  assert.equal((await f.row(id)).removed_at, ''); assert.equal(f.deleted.length, 0);
  assert.equal((await f.db.prepare("SELECT count(*) n FROM customer_hub_events WHERE event_type='file_removed'").first()).n, 0);
});

test('contact withdrawal during deletion rolls back the file and notification together', async t => {
  const f = await fixture(t), id = await f.firstFile();
  f.beforeBatch(() => f.native.prepare("UPDATE public_trade_lead_contact_releases SET withdrawn_at='withdrawn' WHERE id='release'").run());
  assert.equal((await f.remove(id)).status, 404); assert.equal((await f.row(id)).removed_at, ''); assert.equal(f.deleted.length, 0);
});

test('R2 cleanup failure keeps removal effective and later authorised file activity retries safely', async t => {
  const f = await fixture(t), id = await f.firstFile(), original = await f.row(id);
  f.failDelete(true);
  const response = await f.remove(id); assert.equal(response.status, 200); assert.equal((await response.json()).cleanupPending, true);
  assert.ok((await f.row(id)).removed_at); assert.equal((await f.row(id)).storage_deleted_at, ''); assert.ok(f.objects.has(original.object_key));
  assert.deepEqual((await f.view()).questions[0].files, []); assert.equal((await f.tradeGet(id)).status, 404);
  f.failDelete(false);
  const next = await f.firstFile();
  assert.ok((await f.row(id)).storage_deleted_at); assert.equal(f.objects.has(original.object_key), false);
  assert.equal((await f.get(next)).status, 200); assert.equal((await f.get(id)).status, 404);
  assert.equal((await f.db.prepare("SELECT count(*) n FROM customer_hub_events WHERE event_type='file_removed'").first()).n, 1);
});

test('uncertain commit recovery only cleans a committed tombstone and retains one event', async t => {
  const f = await fixture(t), id = await f.firstFile();
  f.afterBatch(() => { throw new Error('Synthetic lost response after committed transaction'); });
  assert.equal((await f.remove(id)).status, 200); assert.ok((await f.row(id)).storage_deleted_at);
  assert.equal((await f.remove(id)).status, 200);
  assert.equal((await f.db.prepare("SELECT count(*) n FROM customer_hub_events WHERE event_type='file_removed'").first()).n, 1);
});

test('customer and trade downloads reject files removed while R2 was being read', async t => {
  const f = await fixture(t), first = await f.firstFile();
  f.duringGet(async () => assert.equal((await f.remove(first)).status, 200));
  assert.equal((await f.get(first)).status, 404);
  const second = await f.firstFile();
  f.duringGet(async () => assert.equal((await f.remove(second)).status, 200));
  assert.equal((await f.tradeGet(second)).status, 404);
});

test('download boundaries recheck current token, service scope and live staff access', async t => {
  const f = await fixture(t), id = await f.firstFile();
  f.duringGet(() => f.db.prepare("UPDATE customer_quote_hubs SET token_hash='rotated' WHERE id=?").bind(f.authority.id).run());
  assert.equal((await f.get(id)).status, 404);
  await f.db.prepare('UPDATE customer_quote_hubs SET token_hash=? WHERE id=?').bind(f.authority.token_hash, f.authority.id).run();
  f.duringGet(() => f.db.prepare("UPDATE trade_opportunity_matches SET matched_categories='[\"hot-water\"]' WHERE id='match'").run());
  assert.equal((await f.tradeGet(id)).status, 404);
  await f.db.prepare("UPDATE trade_opportunity_matches SET matched_categories='[\"solar\"]' WHERE id='match'").run();
  f.setAccess({ ...f.owner, actorUid: 'staff-uid', isOwner: false, memberId: 'staff', jobScope: 'own' });
  assert.equal((await f.tradeGet(id)).status, 200);
  f.duringGet(() => f.db.prepare("UPDATE trade_team_members SET can_view_quotes=0 WHERE id='staff'").run());
  assert.equal((await f.tradeGet(id)).status, 404);
});

test('migration preserves populated files, event authors and event identities', t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const statements = name => readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean);
  for (const sql of statements('0245_customer_quote_hub.sql').filter(sql => /^CREATE (?:TABLE|(?:UNIQUE )?INDEX) customer_hub_files/.test(sql))) sqlite.exec(sql);
  sqlite.exec(statements('0247_customer_hub_conversations.sql').find(sql => sql.startsWith('CREATE TABLE customer_hub_events_next')).replace('customer_hub_events_next', 'customer_hub_events'));
  sqlite.exec("CREATE INDEX customer_hub_events_opportunity ON customer_hub_events(opportunity_id,created_at)");
  sqlite.exec("INSERT INTO customer_hub_files VALUES('file','question','opportunity','name.pdf','application/pdf',10,'object','hash','created')");
  sqlite.exec("INSERT INTO customer_hub_events VALUES('event','opportunity','question','asked','original-author','created')");
  for (const sql of statements('0249_customer_hub_file_removal.sql')) sqlite.exec(sql);
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM customer_hub_events').get() }, {
    id: 'event', opportunity_id: 'opportunity', question_id: 'question', event_type: 'asked', author_match_id: 'original-author', created_at: 'created',
  });
  assert.deepEqual({ ...sqlite.prepare('SELECT object_key,sha256,removed_at,storage_deleted_at FROM customer_hub_files').get() }, {
    object_key: 'object', sha256: 'hash', removed_at: '', storage_deleted_at: '',
  });
  assert.throws(() => sqlite.exec("INSERT INTO customer_hub_events VALUES('bad','opportunity','question',NULL,'','created')"), /NOT NULL/);
});
