import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as actions from '../src/lib/wattzun-actions.ts';
import * as portal from '../src/lib/wattzun-portal.ts';
import * as address from '../src/lib/trade-address-verification.ts';
import * as quote from '../src/lib/trade-quote.ts';
import * as duplicates from '../src/lib/trade-customer-dedup-server.ts';
import * as bounded from '../src/lib/bounded-json-request.ts';

class AccessError extends Error { constructor(status, message) { super(message); this.status = status; } }
const route = {};
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/wattzun-actions-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
Function('require', 'exports', source)(name => {
  if (name === './wattzun-actions') return actions;
  if (name === './wattzun-portal') return portal;
  if (name === './trade-address-verification') return address;
  if (name === './trade-quote') return quote;
  if (name === './trade-customer-dedup-server') return duplicates;
  if (name === './bounded-json-request') return bounded;
  if (name === './wattzun-portal-access-server') return { wattzunAccessFailure: error => error instanceof AccessError ? { status: error.status, message: error.message } : null };
  if (name === './trade-team-server') return { canCreateJobs: current => current.isOwner || current.canCreateJobs, canManageQuotes: current => current.isOwner || current.canManageQuotes };
  if (name === './energy-service-catalogue.mjs') return { ENERGY_SERVICE_IDS: ['hot-water'] };
  if (name === './trade-integrations-server' || name.startsWith('@/app/api/')) return {};
  throw new Error(name);
}, route);
const secret = Buffer.alloc(32, 19).toString('base64url');
const selection = { addressLine1: '12 Main Street', addressLine2: '', suburb: 'Richmond', addressState: 'VIC', postcode: '3121', provider: 'google-places', providerReference: 'synthetic-google-place', formattedAddress: '12 Main Street, Richmond VIC 3121, Australia' };
const proposal = { kind: 'prepare_quote', firstName: 'Alex', lastName: 'Customer', email: 'alex@example.test', phone: '0412345678', addressQuery: '12 Main Street', serviceCategory: 'hot-water', description: 'Replace the supplied hot water system', lines: [{ lineType: 'product', description: 'Supply and install agreed system', quantity: '1', unitPrice: '1000.00', taxCode: 'gst' }] };

test('spoken email normalisation uses only explicit separators and individual spelled characters', () => {
  for (const [input, expected] of [
    ['Alex.Smith@example.com.au', 'Alex.Smith@example.com.au'],
    ['alex dot smith at example dot com dot au', 'alex.smith@example.com.au'],
    ['a l e x dot s m i t h at g m a i l dot c o m', 'alex.smith@gmail.com'],
    ['alex underscore smith plus work at example dot com', 'alex_smith+work@example.com'],
    ['alex dash smith at example dot com', 'alex-smith@example.com'],
  ]) assert.equal(actions.normaliseWattzunSpokenEmail(input), expected);
  for (const input of ['alex', 'alex at gmail', 'alex smith at example dot com', 'alex at gee mail dot com',
    'alex at example dot com or gmail dot com', 'my email is alex at example dot com', 'alex@@example.com', 'alex@example.com.',
    'alex dot at example dot com', 'alex at example dot dot com', 'alex at example dash dot com',
    '.alex@example.com', 'alex.@example.com', 'alex..smith@example.com', 'alex@example..com', 'alex@example-.com', 'alex@-example.com']) {
    assert.equal(actions.normaliseWattzunSpokenEmail(input), null, input);
  }
  assert.equal(actions.normaliseWattzunSpokenEmail('a'.repeat(169) + '@example.com'), null, 'Mailbox exceeds the proposal email bound');
  assert.equal(actions.normaliseWattzunSpokenEmail('a'.repeat(168) + '@example.com'), 'a'.repeat(168) + '@example.com');
});

test('partial customer and quote intake selects one missing field without losing supplied details', () => {
  const empty = { ...proposal, firstName: '', lastName: '', email: '', phone: '', addressQuery: '', serviceCategory: '', description: '', lines: [] };
  let current = empty;
  for (const [field, supplied, question] of [
    ['firstName', 'Alex', /full name/], ['email', 'alex dot smith at example dot com', /email address/],
    ['phone', '0412345678', /mobile number/], ['addressQuery', '12 Main Street', /street address/],
    ['serviceCategory', 'electrical', /type of trade work/], ['description', 'Replace lights', /work should the quote cover/],
    ['lines', [{ lineType: 'labour', description: 'Replace lights', quantity: null, unitPrice: null, taxCode: null }], /first item/],
  ]) {
    const before = structuredClone(current);
    assert.match(actions.wattzunActionNextQuestion(current), question);
    assert.deepEqual(current, before);
    current = { ...current, [field]: supplied };
  }
  assert.match(actions.wattzunActionNextQuestion(current), /quantity.*item 1/);
  current.lines[0].quantity = '2'; assert.match(actions.wattzunActionNextQuestion(current), /unit price before GST.*item 1/);
  current.lines[0].unitPrice = '0'; assert.match(actions.wattzunActionNextQuestion(current), /GST apply.*item 1/);
  current.lines[0].taxCode = 'none'; assert.equal(actions.wattzunActionNextQuestion(current), null);
  const customer = { ...proposal, kind: 'create_customer', serviceCategory: '', description: '', lines: [] };
  assert.equal(actions.wattzunActionNextQuestion(customer), null);
  assert.throws(() => actions.parseWattzunActionProposal({ kind: 'prepare_quote', firstName: 'Alex' }), portal.WattzunInputError);
  assert.throws(() => actions.parseWattzunActionProposal({ ...proposal, lines: [{ ...proposal.lines[0], quantity: 1 }] }), portal.WattzunInputError);
});
async function reviewed(overrides = {}) {
  const chosen = { ...selection, ...overrides.selection };
  const proof = await address.issueTradeAddressSelectionProof(chosen, { ownerUid: overrides.proofOwner || 'business-one', secret });
  const action = { ...proposal, customerMode: 'new', customerId: '', serviceSiteId: '', customerName: 'Alex Customer', ...overrides.action,
    address: { addressLine1: chosen.addressLine1, addressLine2: chosen.addressLine2, suburb: chosen.suburb, addressState: chosen.addressState, postcode: chosen.postcode,
      addressProvider: chosen.provider, addressProviderReference: chosen.providerReference, addressFormatted: chosen.formattedAddress, addressSelectionProof: proof, ...overrides.address } };
  return { portal: 'trade', scopeId: 'business-one', requestId: 'synthetic-reviewed-request-0001', action,
    confirmation: { reviewed: true, name: action.customerName, address: chosen.formattedAddress, ...overrides.confirmation }, ...overrides.input };
}
async function hash(text) { return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex'); }
function fixture(options = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,admin_uid TEXT,action TEXT,entity_type TEXT,entity_id TEXT,summary TEXT,metadata TEXT,created_at TEXT);
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,customer_number TEXT,customer_type TEXT,first_name TEXT,last_name TEXT,business_name TEXT,business_number TEXT,email TEXT,phone TEXT,record_status TEXT,updated_at TEXT);
    CREATE TABLE trade_crm_customer_contacts(id TEXT PRIMARY KEY,firebase_uid TEXT,customer_id TEXT,email TEXT,phone TEXT,record_status TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT PRIMARY KEY,firebase_uid TEXT,customer_id TEXT,site_label TEXT,address_line_1 TEXT,address_line_2 TEXT,suburb TEXT,address_state TEXT,postcode TEXT,record_status TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,source_reference TEXT,record_status TEXT,partner_type TEXT,work_type TEXT,source_type TEXT,service_category TEXT);
    CREATE TABLE trade_crm_job_details(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,service_site_id TEXT,description TEXT,customer_source TEXT);
    CREATE TABLE trade_crm_quotes(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,service_site_id TEXT,status TEXT,current_version_number INTEGER);
    CREATE TABLE trade_crm_quote_versions(id TEXT PRIMARY KEY,quote_id TEXT,firebase_uid TEXT,version_number INTEGER,status TEXT,acceptance_email TEXT,terms TEXT,customer_message TEXT,valid_until TEXT);
    CREATE TABLE trade_crm_quote_items(id TEXT PRIMARY KEY,quote_version_id TEXT,firebase_uid TEXT,line_type TEXT,description TEXT,quantity_milli INTEGER,unit_price_cents INTEGER,tax_code TEXT,quote_choice_id TEXT,position INTEGER);`);
  const calls = [], statements = [];
  function statement(sql, parameters = []) { return { bind: (...values) => statement(sql, values),
    async first() { statements.push(sql); return database.prepare(sql).get(...parameters) || null; },
    async all() { statements.push(sql); return { results: database.prepare(sql).all(...parameters) }; },
    async run() { statements.push(sql); return { meta: { changes: Number(database.prepare(sql).run(...parameters).changes) } }; },
  }; }
  const db = { prepare: sql => statement(sql) };
  const access = { db, actorUid: 'actor-one', scope: { portal: 'trade', scopeId: 'business-one', label: 'Synthetic business' } };
  const team = { ownerUid: 'business-one', actorUid: 'actor-one', isOwner: true, canManageCustomers: true, canCreateJobs: true, canManageQuotes: true, jobScope: 'team', ...options.team };
  let accessCalls = 0, failures = options.quoteFailures || 0;
  function customer(id, name = 'Alex', owner = 'business-one') {
    database.prepare(`INSERT OR IGNORE INTO trade_crm_customers VALUES(?,?,?,'residential',?,'Customer','','','alex@example.test','0412345678','active','2026-10-06')`).run(id, owner, id, name);
    database.prepare(`INSERT OR IGNORE INTO trade_crm_service_sites VALUES(?,?,?,'Primary site','12 Main Street','','Richmond','VIC','3121','active')`).run(`${id}-site`, owner, id);
  }
  const deps = { authenticate: async () => { if (options.authError) throw new AccessError(401, 'Sign in.'); },
    access: async () => { accessCalls++; if (options.revokeAt === accessCalls) throw new AccessError(403, 'Access revoked.'); return access; },
    team: async request => { assert.equal(request.headers.get('X-TLink-Business'), 'business-one'); return team; },
    address: address.resolveTradeAddressProvenance, secret: () => secret,
    crm: async request => {
      const body = await request.json(); calls.push({ endpoint: 'crm', body });
      assert.equal(request.headers.get('X-TLink-Business'), 'business-one');
      assert.equal(request.headers.get('Origin'), 'https://example.test');
      assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-token');
      if (options.crmFailure) return Response.json({ ok: false, error: 'CRM unavailable.' }, { status: 503 });
      if (body.action === 'create_customer') {
        const id = `customer-request-${(await hash(`business-one|actor-one|${body.clientRequestId}`)).slice(0, 48)}`;
        if (!options.fakeSuccess) customer(id);
        return Response.json({ ok: true, id }, { status: 201 });
      }
      assert.equal(body.action, 'create_quick_quote_job');
      const id = `quick-quote-${(await hash(`business-one|${body.clientRequestId}`)).slice(0, 48)}`;
      if (!options.fakeSuccess) {
        const customerId = body.customerMode === 'existing' ? body.crmCustomerId : `customer-${id}`;
        if (body.customerMode === 'new') customer(customerId);
        database.prepare("INSERT OR IGNORE INTO trade_work_orders VALUES(?,?,?,'active','installer','job','internal',?)").run(id, 'business-one', `quick-quote:${body.clientRequestId}`, body.serviceCategory);
        database.prepare("INSERT OR IGNORE INTO trade_crm_job_details VALUES(?,?,?,?,?,?,'trade_owned')").run(`details-${id}`, id, 'business-one', customerId, body.customerMode === 'existing' ? body.serviceSiteId : `${customerId}-site`, body.description);
      }
      return Response.json({ ok: true, id }, { status: 201 });
    },
    quotes: async request => {
      const body = await request.json(); calls.push({ endpoint: 'quotes', body });
      assert.equal(body.action, 'save_draft'); assert.equal(body.expectedVersionId, '');
      assert.equal(body.expectedUpdatedAt, ''); assert.equal(body.consentConfirmed, undefined);
      if (failures-- > 0) return Response.json({ ok: false, error: 'Quote save unavailable.' }, { status: 503 });
      const id = `quote-${body.workOrderId}`, versionId = `version-${body.workOrderId}`;
      const details = database.prepare('SELECT crm_customer_id,service_site_id FROM trade_crm_job_details WHERE work_order_id=?').get(body.workOrderId);
      database.prepare("INSERT INTO trade_crm_quotes VALUES(?,?,?,?,?,'draft',1)").run(id, body.workOrderId, 'business-one', details.crm_customer_id, details.service_site_id);
      database.prepare("INSERT INTO trade_crm_quote_versions VALUES(?,?,?,1,'draft',?,'','','')").run(versionId, id, 'business-one', body.customerEmail);
      quote.normaliseTradeQuoteLines(body.lines, value => String(value || '').trim()).lines.forEach((line, i) => database.prepare("INSERT INTO trade_crm_quote_items VALUES(?,?,?,?,?,?,?,?,?,?)").run(`${versionId}-${i}`, versionId, 'business-one', line.lineType, line.description, line.quantityMilli, line.unitPriceCents, line.taxCode, '', i));
      return Response.json({ ok: true, draftVersionId: versionId });
    },
  };
  async function post(input, extra = {}) {
    const response = await route.postWattzunAction(new Request('https://example.test/api/wattzun/actions', { method: 'POST',
      headers: { origin: 'https://example.test', 'content-type': 'application/json', Authorization: 'Bearer synthetic-token', ...extra.headers },
      body: JSON.stringify(input), ...extra.request }), deps);
    return { status: response.status, body: await response.json(), response };
  }
  return { database, calls, statements, deps, post, customer };
}

test('proposals preserve unknown prices, quantities and GST without defaults', () => {
  const unknown = actions.parseWattzunActionProposal({ ...proposal, lines: [{ ...proposal.lines[0], quantity: null, unitPrice: null, taxCode: null }] });
  assert.equal(unknown.lines[0].quantity, null); assert.equal(unknown.lines[0].unitPrice, null); assert.equal(unknown.lines[0].taxCode, null);
  assert.equal(actions.parseWattzunActionProposal({ ...proposal, description: 'Supply agreed system.\nRemove the existing system.' }).description, 'Supply agreed system.\nRemove the existing system.');
  for (const invalid of [{ ...proposal, send: true }, { ...proposal, lines: new Array(31).fill(proposal.lines[0]) }, { ...proposal, lines: [{ ...proposal.lines[0], unitPrice: 0 }] }]) assert.throws(() => actions.parseWattzunActionProposal(invalid), portal.WattzunInputError);
});
test('the actual App Router handler keeps its framework context outside the action dependency boundary', async () => {
  const entry = {}, calls = [];
  const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/wattzun/actions/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function('require', 'exports', compiled)(name => {
    assert.equal(name, '@/lib/wattzun-actions-server');
    return { postWattzunAction: (...args) => { calls.push(args); return Response.json({ ok: true }); } };
  }, entry);
  const request = new Request('https://example.test/api/wattzun/actions');
  const response = await entry.POST(request, { params: Promise.resolve({}) });
  assert.equal(response.status, 200); assert.deepEqual(calls, [[request]]);
});
test('confirmed actions bind exact spelling, selected Google address and reviewed details', async () => {
  assert.equal(actions.parseWattzunConfirmedAction(await reviewed()).confirmation.name, 'Alex Customer');
  for (const input of [await reviewed({ confirmation: { reviewed: false } }), await reviewed({ confirmation: { name: 'Alec Customer' } }), await reviewed({ address: { addressProvider: 'neutral' } }), await reviewed({ action: { lines: [{ ...proposal.lines[0], taxCode: null }] } }), await reviewed({ input: { portal: 'council' } })]) assert.throws(() => actions.parseWattzunConfirmedAction(input), portal.WattzunInputError);
});
test('quote creation delegates authorised handlers, persists real draft and safely replays without rewriting', async () => {
  const f = fixture(); try {
    const input = await reviewed(), first = await f.post(input);
    assert.equal(first.status, 201, JSON.stringify(first.body)); assert.equal(first.body.receipt.kind, 'quote_draft');
    assert.ok(first.body.receipt.id && first.body.receipt.versionId && first.body.receipt.href.endsWith('&jobTab=quote'));
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_crm_quotes').get().n, 1);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_work_orders').get().n, 1);
    const again = await f.post(input); assert.equal(again.status, 200); assert.deepEqual(again.body.receipt, first.body.receipt);
    assert.equal(f.calls.filter(call => call.endpoint === 'quotes').length, 1);
    const audit = JSON.parse(f.database.prepare('SELECT metadata FROM admin_audit_log').get().metadata);
    assert.deepEqual(Object.keys(audit).sort(), ['fingerprint', 'kind']); assert.match(audit.fingerprint, /^[a-f0-9]{64}$/);
  } finally { f.database.close(); }
});
test('a changed price or name cannot reuse an already reviewed request', async () => {
  const f = fixture(); try {
    const input = await reviewed(); assert.equal((await f.post(input)).status, 201);
    for (const change of [{ ...input.action, lines: [{ ...proposal.lines[0], unitPrice: '5000.00' }] }, { ...input.action, firstName: 'Alec', customerName: 'Alec Customer' }]) {
      const response = await f.post({ ...input, action: change, confirmation: { ...input.confirmation, name: change.customerName } });
      assert.equal(response.status, 409); assert.match(response.body.error, /different details/);
    }
    assert.equal(f.calls.length, 2); assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_work_orders').get().n, 1);
  } finally { f.database.close(); }
});
test('second-step failure reports the actual saved job and retry recovers the same priced draft', async () => {
  const f = fixture({ quoteFailures: 1 }); try {
    const input = await reviewed(), failed = await f.post(input);
    assert.equal(failed.status, 503); assert.equal(failed.body.ok, false); assert.ok(failed.body.partial.workOrderId); assert.equal(failed.body.receipt, undefined);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_work_orders').get().n, 1); assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_crm_quotes').get().n, 0);
    const retry = await f.post(input); assert.equal(retry.status, 201, JSON.stringify(retry.body)); assert.equal(retry.body.receipt.workOrderId, failed.body.partial.workOrderId);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_work_orders').get().n, 1);
  } finally { f.database.close(); }
});
test('saved quote edits are detected rather than overwritten on recovery', async () => {
  const f = fixture(); try {
    const input = await reviewed(); assert.equal((await f.post(input)).status, 201);
    f.database.exec('UPDATE trade_crm_quote_items SET unit_price_cents=12345');
    const response = await f.post(input); assert.equal(response.status, 409); assert.ok(response.body.partial); assert.match(response.body.error, /draft has changed/);
    assert.equal(f.calls.filter(call => call.endpoint === 'quotes').length, 1);
  } finally { f.database.close(); }
});

test('recovery refuses edited job scope, customer facts and same-details customer or property relinks', async () => {
  for (const mutate of [
    f => f.database.exec("UPDATE trade_crm_job_details SET description='Changed work scope'"),
    f => f.database.exec("UPDATE trade_work_orders SET service_category='other'"),
    f => f.database.exec("UPDATE trade_crm_customers SET first_name='Someone Else'"),
    f => f.database.exec("UPDATE trade_crm_service_sites SET address_line_1='14 Main Street'"),
    f => { f.customer('different-same-details-customer'); f.database.exec("UPDATE trade_crm_job_details SET crm_customer_id='different-same-details-customer',service_site_id='different-same-details-customer-site'"); },
    f => { const id = f.database.prepare('SELECT crm_customer_id FROM trade_crm_job_details').get().crm_customer_id;
      f.database.prepare("INSERT INTO trade_crm_service_sites SELECT 'different-same-details-site',firebase_uid,customer_id,site_label,address_line_1,address_line_2,suburb,address_state,postcode,record_status FROM trade_crm_service_sites WHERE customer_id=?").run(id);
      f.database.exec("UPDATE trade_crm_job_details SET service_site_id='different-same-details-site'"); },
  ]) {
    const f = fixture({ quoteFailures: 1 }); try {
      const input = await reviewed(), first = await f.post(input); assert.equal(first.status, 503);
      mutate(f);
      const recovered = await f.post(input); assert.equal(recovered.status, 409, JSON.stringify(recovered.body));
      assert.equal(recovered.body.receipt, undefined); assert.equal(recovered.body.partial.workOrderId, first.body.partial.workOrderId);
      assert.equal(f.calls.filter(call => call.endpoint === 'quotes').length, 1);
      assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_crm_quotes').get().n, 0);
      const binding = JSON.parse(f.database.prepare("SELECT metadata FROM admin_audit_log WHERE action='wattzun.verified_job_binding'").get().metadata);
      assert.deepEqual(Object.keys(binding), ['fingerprint']); assert.match(binding.fingerprint, /^[a-f0-9]{64}$/);
    } finally { f.database.close(); }
  }
});

test('recovery refuses changed quote customer/site, terms, message and expiry even when prices are unchanged', async () => {
  for (const statement of ["UPDATE trade_crm_quotes SET crm_customer_id='changed'", "UPDATE trade_crm_quotes SET service_site_id='changed'",
    "UPDATE trade_crm_quote_versions SET terms='Changed terms'", "UPDATE trade_crm_quote_versions SET customer_message='Changed message'", "UPDATE trade_crm_quote_versions SET valid_until='2026-12-31'"]) {
    const f = fixture(); try {
      const input = await reviewed(); assert.equal((await f.post(input)).status, 201); f.database.exec(statement);
      const response = await f.post(input); assert.equal(response.status, 409, JSON.stringify(response.body));
      assert.equal(response.body.receipt, undefined); assert.ok(response.body.partial);
      assert.equal(f.calls.filter(call => call.endpoint === 'quotes').length, 1);
    } finally { f.database.close(); }
  }
});

test('a refreshed proof for the same canonical Google address safely recovers a partial review after expiry', async () => {
  const f = fixture({ quoteFailures: 1 }); try {
    const input = await reviewed(); assert.equal((await f.post(input)).status, 503);
    const expired = await address.issueTradeAddressSelectionProof(selection, { ownerUid: input.scopeId, secret, now: Date.now() - 1_000, ttlMs: 1 });
    const expiredResponse = await f.post({ ...input, action: { ...input.action, address: { ...input.action.address, addressSelectionProof: expired } } });
    assert.equal(expiredResponse.status, 400); assert.equal(expiredResponse.body.receipt, undefined);
    const refreshed = await reviewed();
    assert.equal((await f.post(refreshed)).status, 201);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_work_orders').get().n, 1);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_crm_quotes').get().n, 1);
  } finally { f.database.close(); }
});
test('cross-business or edited Google proofs cannot freeze a review or write a record', async () => {
  const f = fixture(); try {
    for (const input of [await reviewed({ proofOwner: 'foreign-business' }), await reviewed({ address: { addressLine1: '14 Main Street' } })]) {
      const response = await f.post(input); assert.equal(response.status, 400); assert.equal(response.body.receipt, undefined);
    }
    assert.equal(f.calls.length, 0); assert.equal(f.database.prepare('SELECT COUNT(*) n FROM admin_audit_log').get().n, 0);
  } finally { f.database.close(); }
});
test('current permissions and revoked access are checked again before any mutation', async () => {
  for (const options of [{ team: { isOwner: false, canManageQuotes: false } }, { team: { isOwner: false, jobScope: 'own' } }, { team: { canManageCustomers: false } }, { revokeAt: 3 }]) {
    const f = fixture(options); try { const response = await f.post(await reviewed()); assert.equal(response.status, 403, JSON.stringify(response.body)); assert.equal(f.calls.length, 0); }
    finally { f.database.close(); }
  }
});
test('existing customers are read from the selected business and require exact saved names/sites', async () => {
  const f = fixture(); try {
    f.customer('saved-customer');
    const input = await reviewed({ action: { customerMode: 'existing', customerId: 'saved-customer', serviceSiteId: 'saved-customer-site' } });
    assert.equal((await f.post(input)).status, 201);
    const other = await f.post(await reviewed({ input: { requestId: 'synthetic-reviewed-request-0002' }, action: { customerMode: 'existing', customerId: 'saved-customer', serviceSiteId: 'saved-customer-site', customerName: 'Wrong Person' } }));
    assert.equal(other.status, 409); assert.match(other.body.error, /details changed/);
    const edited = await f.post(await reviewed({ input: { requestId: 'synthetic-reviewed-request-0003' }, action: { customerMode: 'existing', customerId: 'saved-customer', serviceSiteId: 'saved-customer-site' }, selection: { addressLine1: '14 Main Street' } }));
    assert.equal(edited.status, 409); assert.match(edited.body.error, /differs from this saved property/);
  } finally { f.database.close(); }
});
test('customer creation confirms a persisted record and reuses existing idempotent handler', async () => {
  const f = fixture(); try {
    const input = await reviewed({ action: { kind: 'create_customer', lines: [], serviceCategory: '', description: '' } });
    const response = await f.post(input); assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.receipt.kind, 'customer');
    assert.match(response.body.receipt.href, /workspace=work&customerId=/);
    const retry = await f.post(input); assert.equal(retry.status, 201, JSON.stringify(retry.body)); assert.deepEqual(retry.body.receipt, response.body.receipt);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM trade_crm_customers').get().n, 1);
  } finally { f.database.close(); }
});
test('missing persistence never produces a fake success or fake partial saved-job link', async () => {
  for (const kind of ['prepare_quote', 'create_customer']) {
    const f = fixture({ fakeSuccess: true }); try {
      const response = await f.post(await reviewed({ action: kind === 'create_customer' ? { kind, lines: [], serviceCategory: '', description: '' } : {} }));
      assert.equal(response.status, 503); assert.equal(response.body.receipt, undefined); assert.equal(response.body.partial, undefined);
    } finally { f.database.close(); }
  }
});
test('revoked access after a save or on draft recovery never returns a protected record receipt', async () => {
  for (const kind of ['prepare_quote', 'create_customer']) {
    const f = fixture({ revokeAt: kind === 'prepare_quote' ? 6 : 5 }); try {
      const response = await f.post(await reviewed({ action: kind === 'create_customer' ? { kind, lines: [], serviceCategory: '', description: '' } : {} }));
      assert.equal(response.status, 403); assert.equal(response.body.receipt, undefined); assert.equal(response.body.partial, undefined);
      assert.equal(f.database.prepare(`SELECT COUNT(*) n FROM ${kind === 'prepare_quote' ? 'trade_crm_quotes' : 'trade_crm_customers'}`).get().n, 1);
    } finally { f.database.close(); }
  }
});

test('revoked access during a failed save or a conflicting recovery never returns a partial job identity', async () => {
  const failed = fixture({ quoteFailures: 1, revokeAt: 6 }); try {
    const response = await failed.post(await reviewed()); assert.equal(response.status, 403);
    assert.equal(response.body.receipt, undefined); assert.equal(response.body.partial, undefined);
    assert.equal(failed.database.prepare('SELECT COUNT(*) n FROM trade_work_orders').get().n, 1);
  } finally { failed.database.close(); }
  const recovery = fixture(); try {
    const input = await reviewed(); assert.equal((await recovery.post(input)).status, 201);
    recovery.database.exec("UPDATE trade_crm_quote_versions SET status='issued'");
    const currentAccess = recovery.deps.access;
    recovery.deps.access = async (...args) => { if (recovery.calls.length > 2) throw new AccessError(403, 'Access revoked.'); return currentAccess(...args); };
    const response = await recovery.post(input); assert.equal(response.status, 403); assert.equal(response.body.receipt, undefined); assert.equal(response.body.partial, undefined);
  } finally { recovery.database.close(); }
});
test('origin, media type, oversized bodies and unsupported portal actions fail before writes', async () => {
  const f = fixture(); try {
    assert.equal((await f.post(await reviewed(), { headers: { origin: 'https://foreign.test' } })).status, 403);
    assert.equal((await f.post(await reviewed(), { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await f.post({ padding: 'x'.repeat(40_001) })).status, 413);
    assert.equal((await f.post(await reviewed({ input: { portal: 'creditex' } }))).status, 400);
    assert.equal(f.calls.length, 0);
  } finally { f.database.close(); }
});
