import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as maps from '../src/lib/trade-map-dataset-server.ts';
import * as permissions from '../src/lib/creditex-permissions.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, dependencies) {
  const output = {}; const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', code)(name => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; }, output); return output;
}
class AccessError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const errors = { CreditexJobAuditError: AccessError };
const connect = load('src/lib/portal-customer-connect-server.ts', { './trade-compliance-intent': { CREDITEX_PARTNER_ORGANISATION_CODE: 'CREDITEX-AU' }, './creditex-job-audit-server': errors, './creditex-permissions': permissions });
const directory = load('src/lib/creditex-customer-directory-server.ts', { './portal-customer-connect-server': connect, './trade-map-dataset-server': maps, './creditex-job-audit-server': errors });

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE admin_users(id TEXT PRIMARY KEY,firebase_uid TEXT,role TEXT,status TEXT);
    CREATE TABLE compliance_organisations(id TEXT PRIMARY KEY,organisation_code TEXT,status TEXT);
    CREATE TABLE compliance_users(id TEXT PRIMARY KEY,organisation_id TEXT,firebase_uid TEXT,role TEXT,status TEXT,permissions_json TEXT DEFAULT NULL);
    CREATE TABLE compliance_case_assignments(organisation_id TEXT,case_id TEXT,compliance_user_id TEXT,status TEXT);
    CREATE TABLE compliance_cases(id TEXT PRIMARY KEY,organisation_id TEXT,installer_uid TEXT,work_order_id TEXT,compliance_intent_id TEXT);
    CREATE TABLE trade_work_order_compliance_intents(id TEXT PRIMARY KEY,compliance_organisation_id TEXT,installer_uid TEXT,work_order_id TEXT,compliance_case_id TEXT,status TEXT,intent_snapshot TEXT,registry_activity_code TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,source_type TEXT,record_status TEXT,work_number TEXT,title TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,customer_source TEXT,crm_customer_id TEXT,service_site_id TEXT);
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT,first_name TEXT,last_name TEXT,business_name TEXT,email TEXT,phone TEXT,customer_number TEXT,address_line_1 TEXT,address_line_2 TEXT,suburb TEXT,address_state TEXT,postcode TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT PRIMARY KEY,firebase_uid TEXT,customer_id TEXT,record_status TEXT,address_line_1 TEXT,address_line_2 TEXT,suburb TEXT,address_state TEXT,postcode TEXT);
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT);
    CREATE TABLE trade_map_location_cache(owner_uid TEXT,address_key TEXT,provider TEXT,status TEXT,lat REAL,lng REAL,approximate INTEGER,PRIMARY KEY(owner_uid,address_key,provider));
    INSERT INTO compliance_organisations VALUES('creditex','CREDITEX-AU','active'),('foreign','OTHER','active');
    INSERT INTO compliance_users(id,organisation_id,firebase_uid,role,status) VALUES('member','creditex','user','auditor','active'),('manager','creditex','manager-user','admin','active');
    INSERT INTO admin_users VALUES('admin','platform-user','owner','active');`);
  function insert(table, values) { const columns = Object.keys(values); sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values)); }
  const db = { prepare(sql) { return { bind(...values) { return { first: async () => sqlite.prepare(sql).get(...values) || null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) }; } }; } };
  const actor = { kind: 'compliance', organisationId: 'creditex', memberId: 'member', uid: 'user', role: 'admin', name: 'User' };
  function add(id, options = {}) {
    const owner = options.owner || `owner-${id}`, customer = options.customer || `customer-${id}`, org = options.org || 'creditex';
    const caseId = options.caseId || '', site = options.site || `site-${id}`;
    if (!sqlite.prepare('SELECT id FROM trade_crm_customers WHERE id=?').get(customer)) insert('trade_crm_customers', { id: customer, firebase_uid: owner, record_status: 'active', first_name: options.name || id, last_name: 'Customer', business_name: '', email: `${id}@customer.test`, phone: '0400111222', customer_number: `C-${id}`, address_line_1: options.address || '12 Shared Street', address_line_2: '', suburb: 'Melbourne', address_state: 'VIC', postcode: '3000' });
    if (!sqlite.prepare('SELECT firebase_uid FROM trade_accounts WHERE firebase_uid=?').get(owner)) insert('trade_accounts', { firebase_uid: owner, business_name: options.installer || `Business ${owner}` });
    insert('trade_work_orders', { id, firebase_uid: owner, partner_type: 'installer', source_type: 'internal', record_status: 'active', work_number: `JOB-${id}`, title: `Work ${id}` });
    insert('trade_crm_service_sites', { id: site, firebase_uid: owner, customer_id: customer, record_status: 'active', address_line_1: options.siteAddress || '34 Job Street', address_line_2: '', suburb: 'Melbourne', address_state: 'VIC', postcode: '3000' });
    insert('trade_crm_job_details', { work_order_id: id, firebase_uid: owner, customer_source: 'trade_owned', crm_customer_id: customer, service_site_id: site });
    insert('trade_work_order_compliance_intents', { id: `intent-${id}`, compliance_organisation_id: org, installer_uid: owner, work_order_id: id, compliance_case_id: caseId, status: caseId ? 'case_linked' : 'planned', intent_snapshot: JSON.stringify({ activity: { title: 'Safety check' } }), registry_activity_code: '45' });
    if (caseId) { insert('compliance_cases', { id: caseId, organisation_id: org, installer_uid: owner, work_order_id: id, compliance_intent_id: `intent-${id}` }); if (options.assigned) insert('compliance_case_assignments', { organisation_id: org, case_id: caseId, compliance_user_id: 'member', status: 'assigned' }); }
    return { id, owner, customer, caseId, site };
  }
  const list = (params = {}, who = actor) => directory.loadCreditexCustomers(db, who, new URLSearchParams(params));
  const detail = (id, params = {}, who = actor) => directory.loadCreditexCustomer(db, who, id, new URLSearchParams(params));
  const map = (params = {}, who = actor) => { const query = new URLSearchParams(params); return maps.loadTradeMapDataset(db, who.uid, directory.creditexMapDataset(who, query), new URL(`https://example.test/api/creditex/map?${query}`)); };
  function cache(owner, address, lat, lng) { insert('trade_map_location_cache', { owner_uid: owner, address_key: address.toLowerCase(), provider: 'gnaf', status: 'located', lat, lng, approximate: 0 }); }
  return { sqlite, insert, db, actor, add, list, detail, map, cache };
}

test('directory groups each business-owned customer once while counting distinct accessible jobs', async t => {
  const f = fixture(t); f.add('one', { customer: 'laura', owner: 'business', name: 'Laura' }); f.add('two', { customer: 'laura', owner: 'business' });
  f.insert('trade_work_order_compliance_intents', { id: 'extra-activity', compliance_organisation_id: 'creditex', installer_uid: 'business', work_order_id: 'one', compliance_case_id: '', status: 'planned', intent_snapshot: '{}', registry_activity_code: '48' });
  const result = await f.list(); assert.equal(result.total, 1); assert.equal(result.customers[0].jobCount, 2);
  const detail = await f.detail('laura'); assert.equal(detail.customer.name, 'Laura Customer'); assert.equal(detail.jobs.length, 3);
  assert.deepEqual(new Set(detail.jobs.map(job => job.number)), new Set(['JOB-one', 'JOB-two']));
});

test('directory and details use actual member role, tenant ownership and current assignment', async t => {
  const f = fixture(t); f.add('planned'); f.add('assigned', { caseId: 'assigned-case', assigned: true }); f.add('unassigned', { caseId: 'unassigned-case' }); f.add('foreign', { org: 'foreign' });
  assert.deepEqual((await f.list()).customers.map(customer => customer.id), ['customer-assigned', 'customer-planned']);
  await assert.rejects(f.detail('customer-unassigned'), error => error.status === 404);
  await assert.rejects(f.detail('customer-foreign'), error => error.status === 404);
  f.sqlite.exec("UPDATE compliance_case_assignments SET status='released'");
  assert.equal((await f.list()).total, 1); await assert.rejects(f.detail('customer-assigned'), error => error.status === 404);
  assert.equal((await f.list({}, { ...f.actor, memberId: 'manager', uid: 'manager-user' })).total, 3);
  f.sqlite.exec("UPDATE compliance_users SET status='suspended' WHERE id='member'"); assert.equal((await f.list()).total, 0);
  await assert.rejects(f.detail('customer-planned'), error => error.status === 404);
});

test('inactive and broken work/customer/site/case relationships cannot leak through directory or map', async t => {
  const f = fixture(t);
  for (const id of ['good', 'work', 'customer', 'site', 'intent', 'cross-owner']) f.add(id);
  f.add('broken-case', { caseId: 'case', assigned: true });
  f.sqlite.exec("UPDATE trade_work_orders SET record_status='archived' WHERE id='work'; UPDATE trade_crm_customers SET record_status='archived' WHERE id='customer-customer'; UPDATE trade_crm_service_sites SET record_status='archived' WHERE id='site-site'; UPDATE trade_work_order_compliance_intents SET status='superseded' WHERE id='intent-intent'; UPDATE trade_crm_customers SET firebase_uid='wrong-owner' WHERE id='customer-cross-owner'; UPDATE compliance_cases SET compliance_intent_id='wrong-intent' WHERE id='case';");
  assert.deepEqual((await f.list()).customers.map(customer => customer.id), ['customer-good']);
  assert.deepEqual((await f.map()).items.map(item => item.id), ['customer-good']);
  assert.deepEqual((await f.map({ resource: 'jobs' })).items.map(item => item.id), ['intent-good']);
});

test('pagination counts distinct customers and customer details count only accessible activity rows', async t => {
  const f = fixture(t); for (let i = 0; i < 65; i++) f.add(`person${i.toString().padStart(2, '0')}`);
  const first = await f.list(), second = await f.list({ page: '2' }), third = await f.list({ page: '3' });
  assert.equal(first.total, 65); assert.equal(first.totalPages, 3); assert.equal(first.customers.length, 30); assert.equal(second.customers.length, 30); assert.equal(third.customers.length, 5);
  assert.equal(new Set([...first.customers, ...second.customers, ...third.customers].map(customer => customer.id)).size, 65);
  assert.equal((await f.list({ page: '-1' })).page, 1); assert.equal((await f.list({ page: '999999' })).page, 3);
  for (let i = 0; i < 34; i++) f.add(`shared${i}`, { customer: 'shared', owner: 'same-owner' });
  f.add('private', { customer: 'shared', owner: 'same-owner', caseId: 'private-case' });
  const jobs = await f.detail('shared'), more = await f.detail('shared', { page: '2' });
  assert.equal(jobs.customer.jobCount, 34); assert.equal(jobs.totalPages, 2); assert.equal(jobs.jobs.length, 30); assert.equal(more.jobs.length, 4);
  assert.ok([...jobs.jobs, ...more.jobs].every(job => job.id !== 'intent-private'));
});

test('map aggregates all filtered customers beyond either customer or map list page one', async t => {
  const f = fixture(t); for (let i = 0; i < 65; i++) { const job = f.add(`row${i.toString().padStart(2, '0')}`); f.cache(job.owner, '12 Shared Street, Melbourne, VIC, 3000, Australia', -37.8 + i / 1000, 144.9 + i / 1000); }
  const directoryPage = await f.list(); assert.equal(directoryPage.customers.length, 30);
  const first = await f.map(), second = await f.map({ mapPage: '2' });
  assert.equal(first.total, 65); assert.equal(first.mapped, 65); assert.equal(first.items.length, 50); assert.equal(first.hasMore, true); assert.equal(second.items.length, 15);
  assert.equal(first.markers.reduce((total, marker) => total + marker.count, 0), 65);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 65);
  assert.equal((await f.map({ search: 'row64' })).total, 1);
});

test('identical addresses resolve only against the owning business coordinate cache', async t => {
  const f = fixture(t); const a = f.add('alpha'), b = f.add('beta'); const address = '12 Shared Street, Melbourne, VIC, 3000, Australia';
  f.cache(a.owner, address, -37.1, 144.1); f.cache(b.owner, address, -38.2, 145.2); f.cache(f.actor.uid, address, 0, 0);
  const result = await f.map(); const points = Object.fromEntries(result.items.map(item => [item.id, item.position]));
  assert.deepEqual(points['customer-alpha'], { lat: -37.1, lng: 144.1 }); assert.deepEqual(points['customer-beta'], { lat: -38.2, lng: 145.2 });
  assert.equal(result.bounds.north, -37.1); assert.equal(result.bounds.south, -38.2);
  const jobAddress = '34 Job Street, Melbourne, VIC, 3000, Australia'; f.cache(a.owner, jobAddress, -37.3, 144.3); f.cache(b.owner, jobAddress, -38.4, 145.4);
  const jobs = await f.map({ resource: 'jobs' }); assert.equal(jobs.total, 2); assert.deepEqual(jobs.items.find(job => job.id === 'intent-alpha').position, { lat: -37.3, lng: 144.3 });
});

test('permissions are rechecked in every customer and map query, independently for jobs', async t => {
  const f = fixture(t); f.add('job');
  f.sqlite.exec(`UPDATE compliance_users SET permissions_json='["jobs"]' WHERE id='member'`);
  assert.equal((await f.list()).total, 0); await assert.rejects(f.detail('customer-job'), error => error.status === 404); assert.equal((await f.map()).total, 0); assert.equal((await f.map({ resource: 'jobs' })).total, 1);
  f.sqlite.exec(`UPDATE compliance_users SET permissions_json='["customers"]' WHERE id='member'`);
  assert.equal((await f.list()).total, 1); assert.equal((await f.map()).total, 1); assert.equal((await f.map({ resource: 'jobs' })).total, 0);
  f.sqlite.exec(`UPDATE compliance_users SET permissions_json='[]' WHERE id='member'`); assert.equal((await f.map()).total, 0);
});

test('customer directory search and map search preserve the same customer filter', async t => {
  const f = fixture(t); f.add('target', { name: 'Laura', installer: 'Unique electrical business', address: '44 Target Road' }); f.add('other');
  for (const search of ['Laura', 'target@customer.test', 'Unique electrical', '44 Target Road', '%', "' OR 1=1 --"]) {
    const list = await f.list({ search }), map = await f.map({ search });
    assert.equal(map.total, list.total, `Search parity for ${search}`); assert.deepEqual(map.items.map(item => item.id), list.customers.map(customer => customer.id));
  }
  assert.equal((await f.list({ search: 'Unique electrical' })).total, 1);
});

test('map validates bounded page, viewport and status inputs before records are returned', async t => {
  const f = fixture(t); f.add('job');
  for (const params of [{ mapPage: '-1' }, { mapPage: '1.5' }, { mapPage: '1000001' }, { mapLocationStatus: 'private' }, { north: '10' }, { north: '91', south: '-40', east: '150', west: '140' }, { mapAddressKey: 'x'.repeat(1001) }]) await assert.rejects(f.map(params), maps.TradeMapInputError);
  const empty = await f.map({ mapLocationStatus: 'located' }); assert.equal(empty.total, 1); assert.equal(empty.listTotal, 0); assert.equal(empty.items.length, 0);
});

test('customer and map routes request the correct capability and retain shared private error responses', async () => {
  const calls = []; const dependencies = {
    '../../../../../db': { getD1: () => 'db' },
    '@/lib/creditex-job-audit-route-server': { requireJobAuditActor: async (_request, _db, permission) => { calls.push(permission); return { uid: 'uid' }; }, jobAuditJson: (body, status = 200) => Response.json(body, { status }), jobAuditError: () => Response.json({ ok: false }, { status: 403 }) },
    '@/lib/creditex-customer-directory-server': { loadCreditexCustomers: async () => ({ customers: [] }), loadCreditexCustomer: async () => ({ customer: {} }), creditexMapDataset: () => ({}) },
    '@/lib/trade-map-dataset-server': { ...maps, loadTradeMapDataset: async () => ({ items: [] }) },
    '@/lib/trade-map-configuration': { tlinkMapConfiguration: () => ({}) },
    '@/lib/gnaf-directory-server': { gnafDirectoryStatus: async () => ({}), getGnafDirectory: async () => ({ resolve: async () => [] }) },
    '@/lib/bounded-json-request': { readBoundedJsonRequest: async request => request.json() },
  };
  const customers = load('src/app/api/creditex/customers/route.ts', dependencies), map = load('src/app/api/creditex/map/route.ts', dependencies);
  assert.equal((await customers.GET(new Request('https://example.test/api/creditex/customers'))).status, 200);
  assert.equal((await map.GET(new Request('https://example.test/api/creditex/map?resource=jobs'))).status, 200);
  assert.equal((await map.GET(new Request('https://example.test/api/creditex/map?resource=customers'))).status, 200);
  assert.deepEqual(calls, ['customers', 'jobs', 'customers']);
});
