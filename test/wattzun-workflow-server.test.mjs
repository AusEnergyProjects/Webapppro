import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as contract from '../src/lib/wattzun-workflow.ts';
import * as priceBook from '../src/lib/trade-price-book.ts';
import * as sms from '../src/lib/trade-sms.ts';
import * as bounded from '../src/lib/bounded-json-request.ts';
import * as schedule from '../src/lib/trade-schedule.ts';
import * as equipment from '../src/lib/trade-quote-equipment.ts';
import * as invoiceRegister from '../src/lib/trade-invoice-register.ts';

class AccessError extends Error { constructor(status, message) { super(message); this.status = status; } }
class QuoteError extends Error { constructor(status, message) { super(message); this.status = status; } }
class ProviderError extends Error { constructor(outcome) { super(outcome); this.outcome = outcome; } }
const workflowModule = {};
const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/lib/wattzun-workflow-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
Function('require', 'exports', compiled)(name => {
  if (name === './wattzun-workflow') return contract;
  if (name === './trade-price-book') return priceBook;
  if (name === './trade-sms') return sms;
  if (name === './bounded-json-request') return bounded;
  if (name === './trade-schedule') return schedule;
  if (name === './trade-quote-equipment') return equipment;
  if (name === './trade-invoice-register') return invoiceRegister;
  if (name === './wattzun-portal-access-server') return { wattzunAccessFailure: error => error instanceof AccessError ? { status: error.status, message: error.message } : null };
  if (name === './trade-job-collaboration') return { jobMemberSql: alias => `${alias}.assignee_member_id=?` };
  if (name === './service-reminder-delivery') return { normalizeAustralianMobile: value => /^04\d{8}$/.test(value) ? '+61' + value.slice(1) : '', ReminderProviderDeliveryError: ProviderError };
  if (name === './trade-sms-billing') return { SMS_PART_PRICE_MICRO: 99000 };
  if (name === './wattzun-existing-quote-server') return { WattzunExistingQuoteError: QuoteError };
  if (name === './trade-team-server' || name === './trade-integration-crypto' || name === './trade-sms-server' || name === './trade-email-server'
    || name === './trade-email-recipient-server' || name === './trade-sms-wallet-server' || name.startsWith('@/app/api/')) return {};
  throw new Error(name);
}, workflowModule);
const customerMessage = { kind: 'customer_message', jobQuery: 'Frankston', jobId: '', channel: 'sms', subject: '', body: 'We will arrive at 9 tomorrow.' };
const reminder = { kind: 'invoice_reminder', jobQuery: '', jobId: 'job-one', invoiceId: '', channel: 'sms', body: '' };
const price = { kind: 'add_price_book_item', name: 'Cable', description: '', itemType: 'material', unitLabel: 'metre', unitPrice: '12.50', supplierCost: '6.00', taxCode: 'gst' };
async function hash(value) { return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))).toString('hex'); }
function fixture(options = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,admin_uid TEXT,action TEXT,entity_type TEXT,entity_id TEXT,summary TEXT,metadata TEXT,created_at TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,work_number TEXT,title TEXT,revision INTEGER,updated_at TEXT,partner_type TEXT,work_type TEXT,record_status TEXT,source_type TEXT,assignee_member_id TEXT,created_at TEXT);
    CREATE TABLE trade_crm_job_details(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,service_site_id TEXT,customer_source TEXT,updated_at TEXT,paid_value_cents INTEGER);
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,first_name TEXT,last_name TEXT,business_name TEXT,email TEXT,phone TEXT,updated_at TEXT,record_status TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT PRIMARY KEY,firebase_uid TEXT,customer_id TEXT,address_line_1 TEXT,address_line_2 TEXT,suburb TEXT,address_state TEXT,postcode TEXT,updated_at TEXT,record_status TEXT);
    CREATE TABLE trade_crm_appointments(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,starts_at TEXT,completed_at TEXT,status TEXT);
    CREATE TABLE trade_sms_connections(id TEXT PRIMARY KEY,firebase_uid TEXT,phone_number TEXT,provider TEXT,status TEXT,daily_limit INTEGER);
    CREATE TABLE trade_sms_recipients(connection_id TEXT,firebase_uid TEXT,phone_number TEXT,customer_id TEXT,consent_at TEXT,opted_out_at TEXT);
    CREATE TABLE trade_sms_messages(id TEXT PRIMARY KEY,firebase_uid TEXT,request_id TEXT,direction TEXT,status TEXT,customer_id TEXT,work_order_id TEXT,actor_uid TEXT,body TEXT,purpose TEXT,segments INTEGER,created_at TEXT);
    CREATE TABLE trade_email_submissions(id TEXT PRIMARY KEY,owner_uid TEXT,request_key TEXT,actor_uid TEXT,status TEXT,content_hash TEXT,provider_message_id TEXT,sender_email TEXT,recipient_email TEXT);
    CREATE TABLE trade_crm_quick_invoices(id TEXT PRIMARY KEY,firebase_uid TEXT,work_order_id TEXT,crm_customer_id TEXT,invoice_number TEXT,total_cents INTEGER,due_at TEXT,updated_at TEXT,status TEXT);
    CREATE TABLE trade_crm_quick_invoice_credits(invoice_id TEXT,total_cents INTEGER,status TEXT);
    CREATE TABLE trade_crm_accepted_invoices(id TEXT PRIMARY KEY,firebase_uid TEXT,work_order_id TEXT,crm_customer_id TEXT,invoice_number TEXT,total_cents INTEGER,due_at TEXT,updated_at TEXT,status TEXT);
    CREATE TABLE trade_crm_accounting_documents(id TEXT PRIMARY KEY,firebase_uid TEXT,work_order_id TEXT,document_type TEXT,external_number TEXT,external_document_id TEXT,amount_cents INTEGER,paid_amount_cents INTEGER,due_at TEXT,updated_at TEXT,status TEXT);`);
  database.exec(`ALTER TABLE trade_crm_job_details ADD invoiced_value_cents INTEGER DEFAULT 0; ALTER TABLE trade_crm_job_details ADD payment_due_at TEXT DEFAULT '';
    ALTER TABLE trade_crm_accepted_invoices ADD commercial_handoff_id TEXT DEFAULT ''; ALTER TABLE trade_crm_accepted_invoices ADD acceptance_id TEXT DEFAULT '';
    ALTER TABLE trade_crm_accepted_invoices ADD quote_version_id TEXT DEFAULT ''; ALTER TABLE trade_crm_accepted_invoices ADD created_at TEXT DEFAULT '2026-10-06';
    ALTER TABLE trade_crm_accepted_invoices ADD issue_blocker_code TEXT DEFAULT '';
    CREATE TABLE trade_crm_commercial_handovers(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,acceptance_id TEXT,quote_version_id TEXT,total_cents INTEGER,accepted_at TEXT);
    ALTER TABLE trade_crm_accounting_documents ADD provider TEXT DEFAULT 'myob'; ALTER TABLE trade_crm_accounting_documents ADD created_at TEXT DEFAULT '2026-10-06'; ALTER TABLE trade_crm_accounting_documents ADD last_error TEXT DEFAULT '';
    ALTER TABLE trade_crm_quick_invoices ADD delivery_status TEXT DEFAULT 'provider_accepted'; ALTER TABLE trade_crm_quick_invoices ADD sent_at TEXT DEFAULT '2026-10-06'; ALTER TABLE trade_crm_quick_invoices ADD last_error TEXT DEFAULT '';
    CREATE UNIQUE INDEX quick_invoice_one_per_job ON trade_crm_quick_invoices(firebase_uid,work_order_id);
    CREATE TABLE trade_price_book_items(id TEXT PRIMARY KEY,firebase_uid TEXT,name TEXT,description TEXT,item_type TEXT,unit_label TEXT,supplier_cost_cents_ex_gst INTEGER,sell_price_cents_ex_gst INTEGER,
      tax_code TEXT,expected_duration_minutes INTEGER,required_skill TEXT,supplier_name TEXT,supplier_sku TEXT,supplier_product_id TEXT,category TEXT,record_status TEXT,price_revision INTEGER,created_by_uid TEXT,solar_panel_json TEXT,coverage_m2_per_unit_milli INTEGER);`);
  const statements = [], calls = [], cipher = new Map(), savedPrices = new Map();
  function statement(sql, params = []) { return { bind: (...values) => statement(sql, values),
    async first() { statements.push(sql); return database.prepare(sql).get(...params) || null; },
    async all() { statements.push(sql); return { results: database.prepare(sql).all(...params) }; },
    async run() { statements.push(sql); return { meta: { changes: Number(database.prepare(sql).run(...params).changes) } }; } }; }
  const db = { prepare: sql => statement(sql) };
  const access = { db, actorUid: 'actor-one', scope: { portal: 'trade', scopeId: 'business-one', label: 'Synthetic Business' } };
  const team = { ownerUid: 'business-one', actorUid: 'actor-one', memberId: 'member-one', isOwner: true, displayName: 'Alex', businessName: 'Synthetic Trade',
    jobScope: 'team', canViewCustomers: true, canManageCustomers: true, canManageJobs: true, canSendQuotes: true, canSendSms: true,
    canViewInvoices: true, canManageInvoices: true, canManagePriceBook: true, ...options.team };
  let currentTime = Date.parse('2026-10-07T02:00:00Z'), accessCalls = 0, teamCalls = 0;
  function addJob(id = 'job-one', overrides = {}) {
    const owner = overrides.owner || 'business-one', customerId = `customer-${id}`, siteId = `site-${id}`;
    database.prepare("INSERT INTO trade_work_orders VALUES(?,?,?,?,1,'2026-10-06','installer','job','active',?,?,'2026-09-01')").run(id, owner, `JOB-${id}`, overrides.title || 'Install heat pump', overrides.source || 'internal', overrides.assignee || 'member-one');
    database.prepare("INSERT INTO trade_crm_job_details(id,work_order_id,firebase_uid,crm_customer_id,service_site_id,customer_source,updated_at,paid_value_cents) VALUES(?,?,?,?,?,?,'2026-10-06',0)").run(`detail-${id}`, id, owner, customerId, siteId, overrides.customerSource || 'trade_owned');
    database.prepare("INSERT INTO trade_crm_customers VALUES(?,?,'John',?,'','john@example.test','0412345678','2026-10-06','active')").run(customerId, owner, overrides.name || 'Smith');
    database.prepare("INSERT INTO trade_crm_service_sites VALUES(?,?,?,?,'',?,'VIC','3199','2026-10-06','active')").run(siteId, owner, customerId, overrides.address || '12 Fake Street', overrides.suburb || 'Frankston');
    database.prepare("INSERT INTO trade_crm_appointments VALUES(?,?,?,'2026-10-01T09:00:00+10:00','2026-10-01T10:00:00+10:00','completed')").run(`visit-${id}`, id, owner);
  }
  addJob();
  database.prepare("INSERT INTO trade_sms_connections VALUES('sms-connection','business-one','+61400000000',?,'connected',1000)").run(options.smsProvider || 'twilio');
  database.exec("INSERT INTO trade_sms_recipients VALUES('sms-connection','business-one','+61412345678','customer-job-one','2026-10-01','')");
  const deps = { authenticate: async () => { if (options.authError) throw new AccessError(401, 'Sign in.'); },
    access: async () => { accessCalls++; if (options.revokeAt === accessCalls) throw new AccessError(403, 'Access revoked.'); return access; },
    team: async request => { teamCalls++; assert.equal(request.headers.get('X-TLink-Business'), 'business-one'); options.onTeam?.(database, team, teamCalls); return structuredClone(team); },
    encrypt: async payload => { const id = 'synthetic-cipher-' + crypto.randomUUID(); cipher.set(id, structuredClone(payload)); return id; },
    decrypt: async id => structuredClone(cipher.get(id)),
    now: () => currentTime,
    wallet: async () => ({ balanceMicro: options.balance ?? 10_000_000, reservedMicro: 0 }),
    emailSettings: async () => ({ providers: [{ id: 'google', available: true }], connection: options.disconnected ? null : { email: 'office@example.test', provider: 'google', status: 'connected' } }),
    emailRecipient: async (_, target) => database.prepare('SELECT c.email FROM trade_crm_customers c JOIN trade_crm_job_details d ON d.crm_customer_id=c.id WHERE d.work_order_id=?').get(target.workOrderId).email,
    sms: async (actor, customerId, body, requestId, jobId, _db, _fetch, sendOptions) => {
      if (options.smsError) throw new Error('SMS_CONNECTION_REQUIRED');
      options.smsBeforeSend?.(database, team);
      await sendOptions.beforeSend();
      calls.push({ kind: 'sms', body, requestId, jobId, customerId });
      const full = sms.tradeSmsBody(body, actor.businessName) + '\nJob JOB-' + jobId;
      database.prepare("INSERT OR IGNORE INTO trade_sms_messages VALUES('message-one',?,?,'outbound',?,?,?,?,?,'service',1,'2026-10-07')")
        .run(actor.ownerUid, requestId, options.smsStatus || 'queued', customerId, jobId, actor.actorUid, full);
      if (options.smsLostAck) throw new Error('Lost ack');
      return { id: 'message-one', status: options.smsStatus || 'queued' };
    },
    email: async (owner, actor, message, sendOptions) => {
      calls.push({ kind: 'email', message }); await sendOptions.beforeSend();
      if (options.emailBeforeSend) options.emailBeforeSend(database);
      const content = await hash({ recipient: message.recipient, subject: message.subject, body: message.body, html: '', attachments: [] });
      database.prepare("INSERT OR IGNORE INTO trade_email_submissions VALUES('email-one',?,?,?,?,?,'provider-one','office@example.test',?)")
        .run(owner, message.idempotencyKey, actor, options.emailUncertain ? 'uncertain' : 'accepted', content, message.recipient);
      if (options.emailLostAck) throw new Error('Lost ack');
      if (options.emailUncertain) throw new ProviderError('indeterminate');
      return { providerMessageId: 'provider-one' };
    },
    priceBook: async request => {
      const body = await request.json(); assert.equal(request.headers.get('Origin'), 'https://example.test'); calls.push({ kind: 'price', body });
      const id = savedPrices.get(body.clientRequestId) || 'price-book-request-' + (await hash([team.ownerUid, team.actorUid, body.clientRequestId])).slice(0, 48); savedPrices.set(body.clientRequestId, id);
      const input = priceBook.normalisePriceBookInput(body, (value, length) => String(value ?? '').trim().slice(0, length));
      database.prepare("INSERT OR IGNORE INTO trade_price_book_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',1,?,'null',NULL)")
        .run(id, team.ownerUid, input.name, input.description, input.itemType, input.unitLabel, input.supplierCostCentsExGst, input.sellPriceCentsExGst, input.taxCode,
          input.expectedDurationMinutes, input.requiredSkill, input.supplierName, input.supplierSku, input.supplierProductId, input.category || '', team.actorUid);
      if (options.priceLostAck && calls.filter(call => call.kind === 'price').length === 1) throw new Error('Lost ack');
      return Response.json({ ok: true, item: { id } }, { status: 201 });
    },
    prepareQuote: async () => { throw new QuoteError(409, 'Immutable quote.'); }, executeQuote: async () => { throw new Error('not requested'); },
  };
  async function post(payload, extraHeaders = {}) {
    const response = await workflowModule.postWattzunWorkflow(new Request('https://example.test/api/wattzun/workflows', { method: 'POST',
      headers: { Origin: 'https://example.test', Authorization: 'Bearer synthetic', 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(payload) }), deps);
    return { status: response.status, body: await response.json() };
  }
  const prepare = (proposal = customerMessage, requestId = 'synthetic-request-0001') => post({ stage: 'prepare', portal: 'trade', scopeId: 'business-one', requestId, proposal });
  const execute = reviewId => post({ stage: 'execute', portal: 'trade', scopeId: 'business-one', requestId: 'synthetic-execute-0001', reviewId, reviewed: true });
  const invoice = (id = 'invoice-one', overrides = {}) => database.prepare("INSERT INTO trade_crm_quick_invoices(id,firebase_uid,work_order_id,crm_customer_id,invoice_number,total_cents,due_at,updated_at,status) VALUES(?,'business-one','job-one','customer-job-one',?,10000,'2026-10-02','2026-10-06',?)")
    .run(id, overrides.number || 'INV-001', overrides.status || 'issued');
  return { database, db, access, team, deps, statements, calls, addJob, prepare, execute, post, invoice, cipher, advance: milliseconds => { currentTime += milliseconds; } };
}

test('prepare is read-only except encrypted review receipt and displays the exact service SMS', async () => {
  const f = fixture(); const result = await f.prepare(); assert.equal(result.status, 200); assert.equal(result.body.result.state, 'review');
  const review = result.body.result;
  assert.equal(review.target.customerName, 'John Smith'); assert.equal(review.target.address, '12 Fake Street, Frankston, VIC, 3199');
  assert.match(review.preview.body, /^Synthetic Trade: We will arrive at 9 tomorrow\.\nReply STOP to unsubscribe\.\nJob JOB-job-one$/);
  assert.equal(f.calls.length, 0);
  const audit = f.database.prepare('SELECT metadata FROM admin_audit_log').get().metadata;
  assert.doesNotMatch(audit, /John|Fake Street|We will arrive|john@example/);
  assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_sms_messages').get().count, 0);
});
test('ambiguous matching jobs ask with actual names and addresses and disclose at most five', async () => {
  const f = fixture(); for (let index = 2; index <= 7; index++) f.addJob('job-' + index, { name: 'Smith-' + index, address: index + ' Fake Street' });
  const { body } = await f.prepare(); assert.equal(body.result.state, 'choose_job'); assert.equal(body.result.choices.length, 5);
  assert.match(body.result.question, /Several/); assert.equal(f.database.prepare('SELECT COUNT(*) count FROM admin_audit_log').get().count, 0);
  assert.equal(f.calls.length, 0);
});
test('partial job choices never disclose customer names or streets after archive, reassignment or customer-access revocation', async () => {
  for (const mutate of [
    database => database.exec("UPDATE trade_crm_customers SET record_status='archived'"),
    database => database.exec("UPDATE trade_work_orders SET assignee_member_id='another-member'"),
    (_database, team) => { team.canViewCustomers = false; },
  ]) {
    const f = fixture({ team: { isOwner: false, jobScope: 'own' }, onTeam: (database, team, count) => { if (count === 2) mutate(database, team); } });
    f.addJob('job-two'); const result = await f.prepare(); assert.ok([403, 409].includes(result.status));
    assert.doesNotMatch(JSON.stringify(result.body), /John Smith|Fake Street/); assert.equal(f.calls.length, 0);
  }
});
test('partial invoice questions are rebuilt before disclosing amounts or invoice numbers', async () => {
  const f = fixture({ onTeam: (database, _team, count) => { if (count === 2) database.exec('UPDATE trade_crm_job_details SET paid_value_cents=1000'); } });
  f.database.exec(`INSERT INTO trade_crm_accounting_documents(id,firebase_uid,work_order_id,document_type,external_number,external_document_id,amount_cents,paid_amount_cents,due_at,updated_at,status,provider)
    VALUES('accounting-one','business-one','job-one','invoice','INV-001','external-one',10000,0,'2026-10-02','2026-10-06','issued','myob'),
      ('accounting-two','business-one','job-one','invoice','INV-002','external-two',12000,0,'2026-10-02','2026-10-06','issued','xero')`);
  const result = await f.prepare(reminder); assert.equal(result.status, 409); assert.doesNotMatch(JSON.stringify(result.body), /INV-001|INV-002|\$100|\$120/);
  assert.equal(f.calls.length, 0);
});
test('name street and last-week appointment matching resolves a single exact job', async () => {
  const f = fixture(); f.addJob('other-job', { suburb: 'Richmond', name: 'Jones' });
  const { body } = await f.prepare({ ...customerMessage, jobQuery: 'John Smith at 12 Fake Street in Frankston last week' });
  assert.equal(body.result.state, 'review'); assert.equal(body.result.target.jobId, 'job-one');
});
test('last-week selection uses civil appointments and DST-correct Sydney UTC completion/creation boundaries', async () => {
  for (const [instant, expected] of [
    ['2026-09-27T13:59:00Z', false], ['2026-09-27T14:00:00Z', true],
    ['2026-10-04T12:59:00Z', true], ['2026-10-04T13:00:00Z', false],
  ]) {
    const f = fixture(); f.advance(Date.parse('2026-10-04T13:30:00Z') - Date.parse('2026-10-07T02:00:00Z'));
    f.database.prepare("UPDATE trade_crm_appointments SET starts_at='2026-09-22T09:00',completed_at=?").run(instant);
    const { body } = await f.prepare({ ...customerMessage, jobQuery: 'Frankston last week' });
    assert.equal(body.result.state, expected ? 'review' : 'choose_job', instant);
  }
  const f = fixture(); f.database.exec("DELETE FROM trade_crm_appointments; UPDATE trade_work_orders SET created_at='2026-10-01T02:00:00Z'");
  assert.equal((await f.prepare({ ...customerMessage, jobQuery: 'Frankston last week' })).body.result.state, 'review');
});
test('cross-business jobs protected leads and unassigned member jobs never become choices', async () => {
  const f = fixture({ team: { isOwner: false, jobScope: 'own' } });
  f.addJob('cross-business', { owner: 'business-two' }); f.addJob('protected', { customerSource: 'platform_private' });
  f.addJob('public-released', { source: 'public_lead', customerSource: 'public_lead_released' }); f.addJob('unassigned', { assignee: 'another-member' });
  const { body } = await f.prepare(); assert.equal(body.result.state, 'review'); assert.equal(body.result.target.jobId, 'job-one');
});
test('missing channel and message content are asked together rather than invented', async () => {
  const f = fixture(); const { body } = await f.prepare({ ...customerMessage, channel: null, body: '' });
  assert.equal(body.result.state, 'needs_details'); assert.equal(body.result.questions.length, 2); assert.equal(f.calls.length, 0);
});
for (const [name, sql] of [
  ['missing service consent', "UPDATE trade_sms_recipients SET consent_at=''"],
  ['customer opt out', "UPDATE trade_sms_recipients SET opted_out_at='2026-10-07'"],
  ['invalid mobile', "UPDATE trade_crm_customers SET phone='0399999999'"],
  ['disconnected SMS', "UPDATE trade_sms_connections SET status='disconnected'"],
]) test(`prepare blocks ${name} without sending`, async () => {
  const f = fixture(); f.database.exec(sql); const { status } = await f.prepare(); assert.equal(status, 409); assert.equal(f.calls.length, 0);
});
test('managed SMS checks wallet and shows actual parts and charge', async () => {
  const blocked = fixture({ smsProvider: 'clicksend', balance: 0 }); assert.equal((await blocked.prepare()).status, 409);
  const f = fixture({ smsProvider: 'clicksend' }); const { body } = await f.prepare();
  assert.match(body.result.lines.find(line => line.label === 'SMS parts / cost').value, /including GST/);
});
test('email uses only the connected owner mailbox and exact saved job recipient', async () => {
  const proposal = { ...customerMessage, channel: 'email', subject: 'Tomorrow’s visit' };
  const blocked = fixture({ disconnected: true }); assert.equal((await blocked.prepare(proposal)).status, 409);
  const f = fixture(); const { body } = await f.prepare(proposal);
  assert.equal(body.result.lines.find(line => line.label === 'Recipient').value, 'john@example.test');
  assert.equal(body.result.lines.find(line => line.label === 'From').value, 'office@example.test');
  assert.equal(f.calls.length, 0);
});
test('invoice reminder uses issued invoice less recorded credit and payments, not draft totals', async () => {
  const f = fixture(); f.invoice(); f.database.exec("INSERT INTO trade_crm_quick_invoice_credits VALUES('invoice-one',2000,'issued'); UPDATE trade_crm_job_details SET paid_value_cents=3000");
  const { status, body } = await f.prepare(reminder); assert.equal(status, 200); assert.equal(body.result.state, 'review');
  assert.match(body.result.preview.body, /INV-001/); assert.match(body.result.preview.body, /\$50\.00/);
  assert.equal(body.result.lines.find(line => line.label === 'Outstanding').value, '$50.00');
});
test('paid and draft invoices are not chased and multiple issued invoices need selection', async () => {
  for (const status of ['draft', 'issued']) {
    const f = fixture(); f.invoice('invoice-one', { status }); if (status === 'issued') f.database.exec('UPDATE trade_crm_job_details SET paid_value_cents=10000');
    assert.equal((await f.prepare(reminder)).body.result.state, 'needs_details'); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.database.exec(`INSERT INTO trade_crm_accounting_documents(id,firebase_uid,work_order_id,document_type,external_number,external_document_id,amount_cents,paid_amount_cents,due_at,updated_at,status,provider)
    VALUES('accounting-one','business-one','job-one','invoice','INV-001','external-one',10000,0,'2026-10-02','2026-10-06','issued','myob'),
      ('accounting-two','business-one','job-one','invoice','INV-002','external-two',12000,0,'2026-10-02','2026-10-06','issued','xero')`);
  const { body } = await f.prepare(reminder); assert.equal(body.result.state, 'needs_details'); assert.match(body.result.questions[0], /INV-001.*INV-002/);
  assert.equal((await f.prepare({ ...reminder, invoiceId: 'INV-002' }, 'another-invoice-0002')).body.result.state, 'review');
});
test('accepted invoices and their accounting exports use the same Finance priority and exact outstanding balance', async () => {
  const f = fixture(); f.database.exec(`INSERT INTO trade_crm_commercial_handovers VALUES('handover-one','job-one','business-one','customer-job-one','acceptance-one','version-one',10000,'2026-10-01');
    INSERT INTO trade_crm_accepted_invoices(id,firebase_uid,work_order_id,crm_customer_id,invoice_number,total_cents,due_at,updated_at,status,commercial_handoff_id,acceptance_id,quote_version_id)
      VALUES('accepted-one','business-one','job-one','customer-job-one','INV-001',10000,'2026-10-02','2026-10-06','issued','handover-one','acceptance-one','version-one');
    INSERT INTO trade_crm_accounting_documents(id,firebase_uid,work_order_id,document_type,external_number,external_document_id,amount_cents,paid_amount_cents,due_at,updated_at,status)
      VALUES('accounting-one','business-one','job-one','invoice','INV-001','external-one',10000,3000,'2026-10-02','2026-10-06','part_paid');
    UPDATE trade_crm_job_details SET paid_value_cents=1000`);
  const result = await f.prepare({ ...reminder, invoiceId: 'inv-001' }); assert.equal(result.status, 200); assert.equal(result.body.result.state, 'review');
  assert.equal(result.body.result.lines.find(line => line.label === 'Outstanding').value, '$70.00');
  assert.match(result.body.result.preview.body, /\$70\.00/);
  const finance = invoiceRegister.projectTradeInvoiceRegisterFinance({ accounting_document_id: 'accounting-one', external_number: 'INV-001', accounting_amount_cents: 10000, accounting_paid_amount_cents: 3000, paid_value_cents: 1000, accounting_status: 'part_paid', accepted_invoice_number: 'INV-001', accepted_invoice_total_cents: 10000, accepted_invoice_status: 'issued' });
  assert.equal(finance.outstandingCents, 7000);
  f.invoice(); f.database.exec("INSERT INTO trade_crm_quick_invoice_credits VALUES('invoice-one',2000,'issued')");
  const quick = await f.prepare(reminder, 'quick-priority-request-0002'); assert.equal(quick.body.result.state, 'review');
  assert.equal(quick.body.result.lines.find(line => line.label === 'Outstanding').value, '$50.00');
});
test('price-book review preserves supplied ex GST and visibly accepts optional canonical defaults', async () => {
  const f = fixture(); const { body } = await f.prepare({ ...price, supplierCost: null, unitLabel: null });
  assert.equal(body.result.state, 'review'); assert.equal(body.result.lines.find(line => line.label === 'Sell price excluding GST').value, '$12.50');
  assert.match(body.result.lines.find(line => line.label === 'Supplier cost excluding GST').value, /Not supplied.*default.*\$0\.00/);
  assert.match(body.result.lines.find(line => line.label === 'Unit').value, /default is each/);
  assert.equal(f.calls.length, 0);
});
test('unknown price type and GST are bundled and no hidden price save occurs', async () => {
  const f = fixture(); const { body } = await f.prepare({ ...price, itemType: null, taxCode: null, unitPrice: null });
  assert.equal(body.result.state, 'needs_details'); assert.equal(body.result.questions.length, 3); assert.equal(f.calls.length, 0);
});
test('price-book receipts open the actual owner Finance or team Products workspace', async () => {
  for (const isOwner of [true, false]) {
    const f = fixture({ team: { isOwner } }); const review = (await f.prepare(price)).body.result;
    const receipt = (await f.execute(review.reviewId)).body.result.receipt;
    assert.equal(receipt.href, isOwner ? '/direct-trade/dashboard?workspace=finance&financeView=pricebook' : '/direct-trade/team?workspace=pricebook');
  }
});
test('execute requires explicit reviewed confirmation and exact frozen review fields', async () => {
  const f = fixture(); const prepared = (await f.prepare()).body.result;
  const payload = { stage: 'execute', portal: 'trade', scopeId: 'business-one', requestId: 'synthetic-execute-0001', reviewId: prepared.reviewId, reviewed: false };
  assert.equal((await f.post(payload)).status, 400);
  assert.equal((await f.post({ ...payload, reviewed: true, body: 'Injected content' })).status, 400);
  assert.equal(f.calls.length, 0);
  const sent = await f.execute(prepared.reviewId); assert.equal(sent.status, 200); assert.equal(sent.body.result.receipt.status, 'queued');
  assert.equal(f.calls[0].body, customerMessage.body); assert.equal(f.calls[0].customerId, 'customer-job-one');
  assert.match(sent.body.result.receipt.message, /Delivery is not yet confirmed/);
});
for (const [name, sql] of [
  ['job revision', 'UPDATE trade_work_orders SET revision=2'], ['phone', "UPDATE trade_crm_customers SET phone='0499999999'"],
  ['email', "UPDATE trade_crm_customers SET email='changed@example.test'"], ['street', "UPDATE trade_crm_service_sites SET address_line_1='14 Fake Street'"],
  ['sender number', "UPDATE trade_sms_connections SET phone_number='+61400000001'"],
]) test(`changed ${name} invalidates the frozen action`, async () => {
  const f = fixture(); const review = (await f.prepare()).body.result; f.database.exec(sql);
  assert.equal((await f.execute(review.reviewId)).status, 409); assert.equal(f.calls.length, 0);
});
test('a payment made after reminder review prevents chasing a now paid invoice', async () => {
  const f = fixture(); f.invoice(); const review = (await f.prepare(reminder)).body.result;
  f.database.exec('UPDATE trade_crm_job_details SET paid_value_cents=10000');
  assert.equal((await f.execute(review.reviewId)).status, 409); assert.equal(f.calls.length, 0);
});
for (const [name, sql, operation] of [
  ['payment during SMS preflight', 'UPDATE trade_crm_job_details SET paid_value_cents=10000', reminder],
  ['recipient during SMS preflight', "UPDATE trade_crm_customers SET phone='0499999999'", customerMessage],
  ['invoice total during SMS preflight', 'UPDATE trade_crm_quick_invoices SET total_cents=15000', reminder],
  ['sender during SMS preflight', "UPDATE trade_sms_connections SET phone_number='+61400000001'", customerMessage],
]) test(`a changed ${name} stops the provider and cannot return false completion`, async () => {
  const f = fixture({ smsBeforeSend: database => database.exec(sql) });
  if (operation.kind === 'invoice_reminder') f.invoice();
  const review = (await f.prepare(operation)).body.result;
  assert.equal(review.state, 'review');
  const response = await f.execute(review.reviewId);
  assert.equal(response.status, 409); assert.equal(response.body.ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_sms_messages').get().count, 0);
  const saved = JSON.parse(f.database.prepare('SELECT metadata FROM admin_audit_log WHERE id=?').get(review.reviewId).metadata);
  assert.equal(saved.state, 'executing'); assert.equal(saved.receipt, undefined);
});
test('revoked assignment or send capability denies execution and old receipts', async () => {
  const f = fixture({ team: { isOwner: false, jobScope: 'own' } }); const review = (await f.prepare()).body.result;
  f.database.exec("UPDATE trade_work_orders SET assignee_member_id='another-member'"); assert.equal((await f.execute(review.reviewId)).status, 403);
  assert.equal(f.calls.length, 0);
  const second = fixture({ team: { isOwner: false, jobScope: 'own' } }); const prepared = (await second.prepare()).body.result;
  await second.execute(prepared.reviewId); second.team.canSendSms = false; assert.equal((await second.execute(prepared.reviewId)).status, 403);
});
test('reviews expire, stay actor/business bound and reject changed proposal reuse', async () => {
  const f = fixture(); const review = (await f.prepare()).body.result;
  assert.equal((await f.prepare({ ...customerMessage, body: 'Changed message' })).status, 409);
  f.access.actorUid = 'another-actor'; f.team.actorUid = 'another-actor'; assert.equal((await f.execute(review.reviewId)).status, 404);
  f.access.actorUid = 'actor-one'; f.team.actorUid = 'actor-one'; f.advance(15 * 60_000); assert.equal((await f.execute(review.reviewId)).status, 409);
  assert.equal(f.calls.length, 0);
});
test('retry after lost SMS acknowledgement reads durable original send and never sends a second copy', async () => {
  const f = fixture({ smsLostAck: true }); const review = (await f.prepare()).body.result;
  assert.equal((await f.execute(review.reviewId)).status, 503);
  f.database.exec("UPDATE trade_sms_connections SET status='disconnected'; UPDATE trade_sms_recipients SET opted_out_at='2026-10-07'; UPDATE trade_sms_messages SET status='delivered'");
  const retry = await f.execute(review.reviewId); assert.equal(retry.status, 200); assert.equal(retry.body.result.receipt.status, 'delivered');
  assert.equal(f.calls.length, 1);
});
test('expired submitted or unknown SMS and email reviews recover only canonical journal status', async () => {
  for (const options of [{ smsLostAck: true, smsStatus: 'unknown' }, { emailLostAck: true }, { emailUncertain: true }]) {
    const f = fixture(options); const proposal = options.smsLostAck ? customerMessage : { ...customerMessage, channel: 'email', subject: 'Visit' };
    const review = (await f.prepare(proposal)).body.result; await f.execute(review.reviewId); f.advance(30 * 60_000);
    const retry = await f.execute(review.reviewId); assert.equal(retry.status, 200); assert.equal(retry.body.result.state, 'complete');
    assert.equal(retry.body.result.receipt.status, options.smsLostAck || options.emailUncertain ? 'unknown' : 'submitted'); assert.equal(f.calls.length, 1);
    const read = await workflowModule.loadWattzunWorkflowReview(new Request('https://example.test/api/wattzun/portal'), f.access, review.reviewId, f.deps);
    assert.equal(read.state, 'complete'); assert.equal(f.calls.length, 1);
  }
});
test('expired executing review without a transport journal never starts a fresh send', async () => {
  const f = fixture({ smsError: true }); const review = (await f.prepare()).body.result;
  let attempts = 0; const originalSms = f.deps.sms;
  f.deps.sms = (...args) => { attempts++; return originalSms(...args); };
  assert.equal((await f.execute(review.reviewId)).status, 409); f.advance(30 * 60_000);
  assert.equal((await f.execute(review.reviewId)).status, 409); assert.equal(attempts, 1); assert.equal(f.calls.length, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_sms_messages').get().count, 0);
});
test('expired price-book lost acknowledgement reconciles the exact saved item without another create call', async () => {
  const f = fixture({ priceLostAck: true }); const review = (await f.prepare(price)).body.result;
  assert.equal((await f.execute(review.reviewId)).status, 503); f.advance(30 * 60_000);
  const retry = await f.execute(review.reviewId); assert.equal(retry.status, 200); assert.equal(retry.body.result.receipt.status, 'saved'); assert.equal(f.calls.length, 1);
  f.database.exec("UPDATE trade_price_book_items SET sell_price_cents_ex_gst=1300");
  assert.equal((await f.execute(review.reviewId)).status, 409); assert.equal(f.calls.length, 1);
});
test('email lost acknowledgement and indeterminate receipt are checked without another provider call', async () => {
  for (const options of [{ emailLostAck: true }, { emailUncertain: true }]) {
    const f = fixture(options); const review = (await f.prepare({ ...customerMessage, channel: 'email', subject: 'Visit' })).body.result;
    await f.execute(review.reviewId); const retry = await f.execute(review.reviewId);
    assert.equal(retry.status, 200); assert.equal(retry.body.result.receipt.status, options.emailUncertain ? 'unknown' : 'submitted'); assert.equal(f.calls.length, 1);
  }
});
test('same confirmed price review retry uses a stable canonical service request ID', async () => {
  const f = fixture({ priceLostAck: true }); const review = (await f.prepare(price)).body.result;
  assert.equal((await f.execute(review.reviewId)).status, 503); assert.equal((await f.execute(review.reviewId)).body.result.receipt.status, 'saved');
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].body.clientRequestId, f.calls[1].body.clientRequestId);
  assert.equal(f.calls[1].body.sellPrice, price.unitPrice); assert.equal(f.calls[1].body.supplierCost, price.supplierCost);
});
test('prepare cannot execute a model confirmation, unsupported portals, cross origin or extra proposals', async () => {
  const f = fixture();
  assert.equal((await f.prepare({ kind: 'confirm_workflow', reviewId: 'wr_' + 'a'.repeat(48) })).status, 400);
  assert.equal((await f.post({ stage: 'prepare', portal: 'council', scopeId: 'business-one', requestId: 'synthetic-request-0001', proposal: price })).status, 400);
  assert.equal((await f.prepare({ ...customerMessage, arbitraryCommand: 'delete' })).status, 400);
  assert.equal((await f.post({}, { Origin: 'https://other.test' })).status, 403);
  assert.equal(f.calls.length, 0);
});
test('gateway review loader returns only current reviewed/complete results and immutable quote errors remain actionable', async () => {
  const f = fixture(); const review = (await f.prepare()).body.result;
  const request = new Request('https://example.test/api/wattzun/portal', { headers: { Origin: 'https://example.test' } });
  assert.equal((await workflowModule.loadWattzunWorkflowReview(request, f.access, review.reviewId, f.deps)).state, 'review');
  await f.execute(review.reviewId);
  assert.equal((await workflowModule.loadWattzunWorkflowReview(request, f.access, review.reviewId, f.deps)).state, 'complete');
  const quote = await f.prepare({ kind: 'draft_job_quote', jobQuery: '', jobId: 'job-one', mode: 'append', description: '', lines: [{ lineType: 'product', description: 'Cable', quantity: '1', unitPrice: '12.50', taxCode: 'gst' }] }, 'quote-request-00001');
  assert.equal(quote.status, 409); assert.match(quote.body.error, /Immutable quote/);
});
test('encrypted frozen fields are validated completely before an operational action runs', async () => {
  for (const mutate of [
    prepared => { prepared.message.job.customer_id = 42; },
    prepared => { prepared.message.sms.phone = '+61499999999'; },
    prepared => { prepared.message.channel = 'shell'; },
    prepared => { prepared.proposal.arbitraryCommand = 'delete'; },
    prepared => { prepared.message.job.revision = 'not-a-revision'; },
  ]) {
    const f = fixture(); const review = (await f.prepare()).body.result;
    const saved = JSON.parse(f.database.prepare('SELECT metadata FROM admin_audit_log').get().metadata);
    mutate(f.cipher.get(saved.encrypted).prepared);
    assert.equal((await f.execute(review.reviewId)).status, 503); assert.equal(f.calls.length, 0);
  }
});
test('the quote workflow freezes the complete helper payload and saves it through its authoritative boundary', async () => {
  const f = fixture(); const proposal = { kind: 'draft_job_quote', jobQuery: 'Frankston', jobId: '', mode: 'append', description: 'Add cable', lines: [{ lineType: 'product', description: 'Cable', quantity: '1', unitPrice: '12.50', taxCode: 'gst' }] };
  const frozen = { sourceSha256: 'a'.repeat(64), authoritySha256: 'b'.repeat(64), job: { id: 'job-one', workNumber: 'JOB-job-one', customerName: 'John Smith', siteSummary: '12 Fake Street' },
    original: { quoteId: 'quote-one', versionId: 'version-one', updatedAt: '2026-10-06', roofImageSha256: null },
    savePayload: { action: 'save_draft', workOrderId: 'job-one', expectedVersionId: 'version-one', expectedUpdatedAt: '2026-10-06', lines: [{ ...proposal.lines[0], sectionHeading: '', priceBookItemId: '', jobPacketId: '', jobPacketLineId: '' }], choices: [], customerEmail: 'john@example.test', terms: 'Keep saved terms', customerMessage: 'Keep saved message', validUntil: '2026-10-30', equipment: { common: [], choices: [] }, designId: '' },
    review: { title: 'Save existing quote draft', summary: 'Append supplied Cable line', fields: [{ label: 'Added line', value: 'Cable $12.50 excluding GST' }] } };
  f.deps.prepareQuote = async (_request, input) => { assert.equal(input.proposal.jobId, 'job-one'); return structuredClone(frozen); };
  let recoveryCalls = 0;
  f.deps.executeQuote = async (_request, input) => { assert.deepEqual(input.prepared, frozen); assert.equal(input.expectedSourceSha256, frozen.sourceSha256); if (input.allowSave === false) recoveryCalls++; else f.calls.push({ kind: 'quote' }); return { kind: 'quote_draft', id: 'quote-one', workOrderId: 'job-one', versionId: 'version-one', href: '/direct-trade/dashboard?workspace=work&jobId=job-one&jobTab=quote', label: 'Open quote draft' }; };
  const prepared = await f.prepare(proposal); assert.equal(prepared.status, 200); assert.equal(prepared.body.result.state, 'review');
  assert.equal(prepared.body.result.heading, frozen.review.title); assert.equal(prepared.body.result.savePayload, undefined);
  const result = await f.execute(prepared.body.result.reviewId); assert.equal(result.status, 200); assert.equal(result.body.result.receipt.status, 'saved');
  assert.equal(f.calls.length, 1); await f.execute(prepared.body.result.reviewId); assert.equal(f.calls.length, 1);
  f.advance(30 * 60_000);
  const recovered = await f.execute(prepared.body.result.reviewId);
  assert.equal(recovered.status, 200); assert.equal(recovered.body.result.receipt.status, 'saved');
  assert.equal(recoveryCalls, 1); assert.equal(f.calls.length, 1);
});

function priceApiFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT,capabilities TEXT);
    INSERT INTO trade_accounts VALUES('business-one','[]');
    CREATE TABLE trade_price_book_items(id TEXT PRIMARY KEY,firebase_uid TEXT,item_code TEXT,name TEXT,description TEXT,item_type TEXT,unit_label TEXT,
      supplier_cost_cents_ex_gst INTEGER,sell_price_cents_ex_gst INTEGER,tax_code TEXT,markup_basis_points INTEGER,margin_basis_points INTEGER,
      expected_duration_minutes INTEGER,required_skill TEXT,supplier_name TEXT,supplier_sku TEXT,supplier_product_id TEXT,record_status TEXT,
      price_revision INTEGER,created_by_uid TEXT,updated_by_uid TEXT,created_at TEXT,updated_at TEXT,solar_panel_json TEXT,category TEXT,coverage_m2_per_unit_milli INTEGER);
    CREATE UNIQUE INDEX price_book_owner_code ON trade_price_book_items(firebase_uid,item_code);
    CREATE TABLE trade_price_book_price_history(id TEXT PRIMARY KEY,price_book_item_id TEXT,firebase_uid TEXT,price_revision INTEGER,
      supplier_cost_cents_ex_gst INTEGER,sell_price_cents_ex_gst INTEGER,tax_code TEXT,markup_basis_points INTEGER,margin_basis_points INTEGER,
      change_type TEXT,changed_by_uid TEXT,changed_at TEXT);`);
  function statement(sql, params = []) { return { bind: (...values) => statement(sql, values),
    async first() { return database.prepare(sql).get(...params) || null; },
    async all() { return { results: database.prepare(sql).all(...params) }; },
    async run() { return { meta: { changes: Number(database.prepare(sql).run(...params).changes) } }; } }; }
  const db = { prepare: sql => statement(sql), batch: async statements => { database.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec('COMMIT'); return results; } catch (error) { database.exec('ROLLBACK'); throw error; } } };
  const route = {}, team = { ownerUid: 'business-one', actorUid: 'actor-one', isOwner: true };
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/trade-price-book/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function('require', 'exports', source)(name => {
    if (name === '../../../../db') return { getD1: () => db };
    if (name === '@/lib/admin-server') return { adminJson: (body, status = 200) => Response.json(body, { status }), sameOrigin: () => true, mfaErrorResponse: () => null, cleanAdminText: (value, length) => String(value || '').trim().slice(0, length) };
    if (name === '@/lib/trade-price-book') return priceBook;
    if (name === '@/lib/trade-team-server') return { requireInstallerTeamAccess: async () => team };
    if (name === '@/lib/trade-access-server') return {};
    throw new Error(name);
  }, route);
  async function post(overrides = {}) {
    const response = await route.POST(new Request('https://example.test/api/trade-price-book', { method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', name: 'Cable', itemType: 'material', unitLabel: 'metre', sellPrice: '12.50', supplierCost: '6.00', taxCode: 'gst', clientRequestId: 'synthetic-price-request-0001', ...overrides }) }));
    return { status: response.status, body: await response.json() };
  }
  return { database, team, post };
}
test('actual price-book service retries the same frozen creation with one item and history row', async () => {
  const f = priceApiFixture(); const first = await f.post(), retry = await f.post();
  assert.equal(first.status, 201); assert.equal(retry.status, 201); assert.equal(first.body.item.id, retry.body.item.id);
  assert.equal(retry.body.item.sellPriceCentsExGst, 1250); assert.equal(retry.body.item.supplierCostCentsExGst, 600);
  assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_price_book_items').get().count, 1);
  assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_price_book_price_history').get().count, 1);
});
test('actual price-book service rejects changed-price reused key and later edited or archived item', async () => {
  const f = priceApiFixture(); await f.post(); assert.equal((await f.post({ sellPrice: '20.00' })).status, 409);
  f.database.exec("UPDATE trade_price_book_items SET name='Edited item'"); assert.equal((await f.post()).status, 409);
  f.database.exec("UPDATE trade_price_book_items SET name='Cable',record_status='archived'"); assert.equal((await f.post()).status, 409);
  assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_price_book_items').get().count, 1);
});
test('actual price-book request dedup is actor and business scoped and optional for manual creation', async () => {
  const f = priceApiFixture(); const first = await f.post(); f.team.actorUid = 'actor-two'; const second = await f.post();
  assert.equal(second.status, 201); assert.notEqual(first.body.item.id, second.body.item.id);
  assert.notEqual(first.body.item.itemCode, second.body.item.itemCode);
  assert.equal((await f.post({ clientRequestId: undefined })).status, 201);
  assert.equal((await f.post({ clientRequestId: 'bad' })).status, 400);
  assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_price_book_items').get().count, 3);
});
