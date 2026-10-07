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
import * as quoteHelper from '../src/lib/wattzun-existing-quote-server.ts';
import * as formHelper from '../src/lib/wattzun-form-server.ts';
import { turnAuthorityContract } from './helpers/wattzun-turn-authority-fixture.mjs';
import * as formGuide from '../src/lib/wattzun-form-guide.ts';
import * as workflowReply from '../src/lib/wattzun-workflow-reply.ts';
import * as workContext from '../src/lib/wattzun-work-context.ts';

class AccessError extends Error { constructor(status, message) { super(message); this.status = status; } }
const QuoteError = quoteHelper.WattzunExistingQuoteError;
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
  if (name === './wattzun-existing-quote-server') return quoteHelper;
  if (name === './wattzun-form-server') return formHelper;
  if (name === './wattzun-turn-authority-server') return turnAuthorityContract;
  if (name === './wattzun-form-guide') return formGuide;
  if (name === './wattzun-workflow-reply') return workflowReply;
  if (name === './wattzun-work-context') return workContext;
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
  let currentTime = Date.parse('2026-10-07T02:00:00Z'), accessCalls = 0, teamCalls = 0, decryptCalls = 0;
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
    team: async request => { teamCalls++; assert.equal(request.headers.get('X-TLink-Business'), 'business-one');
      if (options.teamRevokeAt === teamCalls) throw new AccessError(403, 'Access revoked.');
      options.onTeam?.(database, team, teamCalls); return structuredClone(team); },
    encrypt: async payload => { const id = 'synthetic-cipher-' + crypto.randomUUID(); cipher.set(id, structuredClone(payload)); return id; },
    decrypt: async id => { decryptCalls++; return structuredClone(cipher.get(id)); },
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
    quoteAuthority: quoteHelper.wattzunExistingQuoteAuthoritySha256,
  };
  async function post(payload, extraHeaders = {}) {
    const response = await workflowModule.postWattzunWorkflow(new Request('https://example.test/api/wattzun/workflows', { method: 'POST',
      headers: { Origin: 'https://example.test', Authorization: 'Bearer synthetic', 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(payload) }), deps);
    return { status: response.status, body: await response.json() };
  }
  const prepare = (proposal = customerMessage, requestId = 'synthetic-request-0001') => post({ stage: 'prepare', portal: 'trade', scopeId: 'business-one', requestId, proposal });
  const portalPrepare = (proposal = customerMessage, requestId = 'synthetic-request-0001') => workflowModule.prepareWattzunWorkflowForPortal(
    new Request('https://example.test/api/wattzun/portal'), access, proposal, requestId, deps);
  const execute = reviewId => post({ stage: 'execute', portal: 'trade', scopeId: 'business-one', requestId: 'synthetic-execute-0001', reviewId, reviewed: true });
  const invoice = (id = 'invoice-one', overrides = {}) => database.prepare("INSERT INTO trade_crm_quick_invoices(id,firebase_uid,work_order_id,crm_customer_id,invoice_number,total_cents,due_at,updated_at,status) VALUES(?,'business-one','job-one','customer-job-one',?,10000,'2026-10-02','2026-10-06',?)")
    .run(id, overrides.number || 'INV-001', overrides.status || 'issued');
  return { database, db, access, team, deps, statements, calls, addJob, prepare, portalPrepare, execute, post, invoice, cipher, decryptCalls: () => decryptCalls,
    authorityCalls: () => ({ access: accessCalls, team: teamCalls }), advance: milliseconds => { currentTime += milliseconds; } };
}

function formWorkflowFixture() {
  const f = fixture({ team: { canViewFieldEvidence: true, canManageFieldEvidence: true, canViewCustomers: false } });
  const state = { failBeforeSave: false, failAfterSave: false };
  const saved = { id: 'form-one', templateName: 'Synthetic installation form', status: 'draft', revision: 1,
    template: { fields: [{ key: 'site_notes', label: 'Site notes', type: 'text', required: true, maxLength: 240 }, { key: 'next_question', label: 'How many units?', type: 'text', required: true, maxLength: 240 }] }, answers: {} };
  const formDeps = { team: async () => structuredClone(f.team), job: async () => ({ id: 'job-one', stage: 'ready', revision: 1 }),
    getJobForms: async () => Response.json({ ok: true, forms: [structuredClone(saved)] }),
    saveJobForm: async request => { const payload = await request.json(); assert.equal(typeof payload.complete, 'boolean'); assert.equal(payload.baseRevision, saved.revision);
      if (state.failBeforeSave) throw new Error('Connection lost before canonical save');
      saved.answers = payload.answers; saved.revision++; if (payload.complete) saved.status = 'complete'; f.calls.push({ kind: 'form', payload });
      if (state.failAfterSave) throw new Error('Connection lost after canonical save');
      return Response.json({ ok: true, forms: [saved] }); } };
  f.deps.prepareForm = (request, access, proposal) => formHelper.prepareWattzunForm(request, access, proposal, formDeps);
  f.deps.executeForm = (request, access, prepared, id) => formHelper.executeWattzunForm(request, access, prepared, id, formDeps);
  f.deps.formAccess = (request, access, prepared) => formHelper.verifyWattzunFormAccess(request, access, prepared, formDeps);
  f.deps.formReceipt = (request, access, prepared) => formHelper.reconcileWattzunFormReceipt(request, access, prepared, formDeps);
  f.deps.prepareGuidedForm = (request, access, proposal, input, team) => formHelper.prepareWattzunGuidedFormForTurn(request, access, proposal, input, team, formDeps);
  f.deps.prepareTurnForm = (request, access, proposal, team) => formHelper.prepareWattzunFormForTurn(request, access, proposal, team, formDeps);
  f.deps.formTurnAccess = (request, access, prepared, team) => formHelper.verifyWattzunFormAccessForTurn(request, access, prepared, team, formDeps);
  f.deps.prepareCompletion = (request, access, proposal) => formHelper.prepareWattzunFormCompletion(request, access, proposal, formDeps);
  f.deps.prepareTurnCompletion = (request, access, proposal, team) => formHelper.prepareWattzunFormCompletionForTurn(request, access, proposal, team, formDeps);
  f.deps.executeCompletion = (request, access, prepared, id) => formHelper.executeWattzunFormCompletion(request, access, prepared, id, formDeps);
  f.deps.completionAccess = (request, access, prepared) => formHelper.verifyWattzunFormCompletionAccess(request, access, prepared, formDeps);
  f.deps.completionTurnAccess = (request, access, prepared, team) => formHelper.verifyWattzunFormCompletionAccessForTurn(request, access, prepared, team, formDeps);
  f.deps.completionReceipt = (request, access, prepared) => formHelper.reconcileWattzunFormCompletionReceipt(request, access, prepared, formDeps);
  f.deps.guide = (request, access, reference, input, team) => formHelper.loadWattzunFormGuideForTurn(request, access, reference, input, team, formDeps);
  f.deps.prepareFormStep = (request, access, proposal) => formHelper.prepareWattzunFormStep(request, access, proposal, formDeps);
  f.deps.prepareTurnFormStep = (request, access, proposal, team) => formHelper.prepareWattzunFormStepForTurn(request, access, proposal, team, formDeps);
  f.deps.executeFormStep = (request, access, prepared, id) => formHelper.executeWattzunFormStep(request, access, prepared, id, formDeps);
  f.deps.formStepAccess = (request, access, prepared) => formHelper.verifyWattzunFormStepAccess(request, access, prepared, formDeps);
  f.deps.formStepTurnAccess = (request, access, prepared, team) => formHelper.verifyWattzunFormStepAccessForTurn(request, access, prepared, team, formDeps);
  f.deps.verifyTurnFormStep = (request, access, prepared, team) => formHelper.verifyWattzunFormStepForTurn(request, access, prepared, team, formDeps);
  f.deps.formStepReceipt = (request, access, prepared) => formHelper.reconcileWattzunFormStepReceipt(request, access, prepared, formDeps);
  const review = id => workflowModule.loadWattzunWorkflowReview(new Request('https://example.test/api/wattzun/voice'), f.access, id, f.deps);
  return { ...f, saved, state, formDeps, review, proposal: { kind: 'fill_form', jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one', answers: [{ fieldKey: 'site_notes', value: '  Access via side gate.  ' }] } };
}

async function guidedWorkflowFixture() {
  const f = formWorkflowFixture(), request = new Request('https://example.test/api/wattzun/voice');
  const access = { ...f.access, scope: { ...f.access.scope, label: f.team.businessName } }, initial = { access, tradeTeam: structuredClone(f.team) };
  const reference = { kind: 'trade_form', formKind: 'job_form', jobId: 'job-one', recordId: 'form-one' };
  const session = { sessionId: '00000000-0000-4000-8000-000000000001', stage: 'resume', authorization: 'ordinary_form_answers', skippedFieldKeys: [] };
  const progress = () => formHelper.loadWattzunFormGuideForTurn(request, access, reference, session, f.team, f.formDeps);
  const currentInput = async () => { const { guide } = await progress(); return { ...session, stage: 'continue', sourceSha256: guide.sourceSha256, questionKey: guide.next?.fieldKey || '' }; };
  const executeGuided = (proposal, input, requestId, consent = '') => workflowModule.executeWattzunGuidedFormForTurn(request, initial, reference, proposal, input, requestId, consent, f.deps);
  const recover = (input, requestId, changes = {}) => workflowModule.recoverWattzunGuidedFormForTurn(request, initial, reference, { ...input, ...changes }, requestId, f.deps);
  return { ...f, request, initial, reference, session, progress, currentInput, executeGuided, recover };
}

async function governedWorkflowFixture() {
  const f = await guidedWorkflowFixture();
  const reference = { kind: 'trade_form', formKind: 'work_pack', jobId: 'job-one', recordId: 'pack-original' };
  const pack = { instance: { id: 'pack-current', workOrderId: 'job-one', instanceKey: 'stable-pack', revision: 3, status: 'in_progress', responseSha256: 'sha256:' + 'a'.repeat(64) },
    definition: { title: 'Synthetic product form', schema: { sections: [{ sectionKey: 'general', repeatability: null, prompts: [] }],
      dependencies: [{ kind: 'product', dependencyKey: 'products', label: 'Installed product', required: true, minimumCount: 1, maximumCount: 2 }] } },
    signatureBindings: { definitionSha256: 'a', prefillSha256: 'b' }, response: { answers: {}, repeatableSections: {}, dependencyResolutions: {} },
    completion: { visiblePromptKeys: [], ready: false, blockers: [] }, referenceDocuments: [], calculatorPendingReviews: [] };
  const products = [{ selectionId: 'product-one', snapshotId: 'snapshot-one', brand: 'Example', manufacturer: 'Example Manufacturing', model: 'X1', sourceSha256: 'a'.repeat(64) }], receipts = new Map();
  f.formDeps.loadPack = async () => structuredClone(pack);
  f.formDeps.steps = {
    products: async () => structuredClone(products),
    selectProducts: async (_db, payload) => {
      assert.equal(payload.caseInstanceId, pack.instance.id); assert.equal(payload.expectedResponseSha256, pack.instance.responseSha256);
      const base = pack.instance.revision; f.calls.push({ kind: 'product', payload: structuredClone(payload) });
      pack.response.dependencyResolutions[payload.dependencyKey] = { status: 'resolved', reference: payload.selections[0].selectionId };
      pack.instance.id = 'pack-next'; pack.instance.revision++; pack.instance.responseSha256 = 'sha256:' + 'b'.repeat(64);
      receipts.set(payload.idempotency.clientActionId, { base, result: pack.instance.revision, idempotency: structuredClone(payload.idempotency) });
      if (f.state.failAfterSave) throw new Error('Lost acknowledgement after canonical product selection');
      return { action: 'work_pack_select_official_products', status: 'applied', projection: structuredClone(pack) };
    },
    receipt: async (_db, payload) => {
      const saved = receipts.get(payload.idempotency.clientActionId); if (!saved) return null;
      assert.equal(payload.action, 'work_pack_select_official_products'); assert.equal(payload.baseRevision, saved.base); assert.deepEqual(payload.idempotency, saved.idempotency);
      if (pack.instance.revision !== saved.result) throw new formHelper.WattzunFormError(409, 'Later canonical revision');
      return { action: payload.action, status: 'duplicate', projection: structuredClone(pack) };
    },
  };
  f.session.productSearch = { dependencyKey: 'products', search: 'heat pump' };
  const proposal = { kind: 'form_step', jobQuery: '', jobId: 'job-one', formKind: 'work_pack', formId: 'pack-current',
    step: { kind: 'official_product', dependencyKey: 'products', search: 'heat pump', selections: [{ selectionId: 'product-one', snapshotId: 'snapshot-one', quantity: 1 }] } };
  const progress = () => formHelper.loadWattzunFormGuideForTurn(f.request, f.initial.access, reference, f.session, f.team, f.formDeps);
  return { ...f, reference, pack, products, proposal, progress };
}

test('a scoped official product selection uses the real encrypted journal and recovers its exact native receipt without another selection', async () => {
  const f = await governedWorkflowFixture(), { guide } = await f.progress();
  assert.equal(guide.next.step.kind, 'official_product');
  const input = { ...f.session, productSearch: guide.productSearch, stage: 'continue', sourceSha256: guide.sourceSha256, questionKey: guide.next.fieldKey };
  for (const phrase of ['Save this quote', 'I used X1 yesterday', 'Maybe X1']) await assert.rejects(
    workflowModule.executeWattzunGuidedFormForTurn(f.request, f.initial, f.reference, f.proposal, input, 'guided-product-request-0001', phrase, f.deps), error => error.status === 400);
  assert.equal(f.database.prepare('SELECT count(*) n FROM admin_audit_log').get().n, 0); assert.equal(f.calls.length, 0);
  f.state.failAfterSave = true;
  await assert.rejects(workflowModule.executeWattzunGuidedFormForTurn(f.request, f.initial, f.reference, f.proposal, input, 'guided-product-request-0001', 'Use X1', f.deps), /Lost acknowledgement/);
  assert.equal(f.calls.length, 1); assert.equal(f.pack.instance.revision, 4); f.state.failAfterSave = false;
  const recovered = await workflowModule.recoverWattzunGuidedFormForTurn(f.request, f.initial, f.reference, input, 'guided-product-request-0001', f.deps);
  assert.equal(recovered.state, 'saved'); assert.equal(recovered.result.receipt.kind, 'form_step'); assert.equal(recovered.result.receipt.id, 'pack-next');
  assert.match(recovered.result.receipt.message, /selected official products/); assert.equal(f.calls.length, 1);
  await assert.rejects(workflowModule.recoverWattzunGuidedFormForTurn(f.request, f.initial, f.reference, { ...input, sessionId: '00000000-0000-4000-8000-000000000002' }, 'guided-product-request-0001', f.deps), error => error.status === 403);
  f.pack.instance.revision++;
  await assert.rejects(workflowModule.recoverWattzunGuidedFormForTurn(f.request, f.initial, f.reference, input, 'guided-product-request-0001', f.deps), error => error.status === 409);
  assert.equal(f.calls.length, 1);
});

test('final review handoff rejects changed official registry metadata even when the form source remains identical', async () => {
  const f = await governedWorkflowFixture();
  const candidate = await workflowModule.prepareWattzunWorkflowForTurn(f.request, f.initial, f.proposal, 'product-review-request-0001', f.deps);
  assert.equal(candidate.state, 'review'); const formSource = (await f.progress()).guide.sourceSha256;
  await assert.rejects(workflowModule.loadWattzunWorkflowReviewForTurn(f.request, f.initial, candidate.reviewId, async () => {
    f.products[0].manufacturer = 'Registry correction'; return f.initial;
  }, f.deps), error => error.status === 409);
  assert.equal((await f.progress()).guide.sourceSha256, formSource); assert.equal(f.calls.length, 0);
});

for (const kind of ['fill_form', 'complete_form', 'form_step']) {
  test(`${kind}: completed turn handoff keeps all three target loads and reuses each immediately fresh authority`, async () => {
    const f = kind === 'form_step' ? await governedWorkflowFixture() : await guidedWorkflowFixture();
    if (kind === 'complete_form') f.saved.answers = { site_notes: 'Side gate', next_question: '2' };
    const { guide } = await f.progress(), proposal = kind === 'complete_form'
      ? { kind, jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one' } : f.proposal;
    const input = { ...f.session, productSearch: guide.productSearch, stage: 'continue', sourceSha256: guide.sourceSha256, questionKey: guide.next?.fieldKey || '' };
    const executed = await workflowModule.executeWattzunGuidedFormForTurn(f.request, f.initial, f.reference, proposal, input,
      `authority-reuse-${kind}-0001`, kind === 'complete_form' ? 'Complete this form now' : kind === 'form_step' ? 'Use X1' : '', f.deps);
    const savedWrites = f.calls.length, events = [], originalTeam = f.deps.team, originalDecrypt = f.deps.decrypt, originalJob = f.formDeps.job;
    const nativeMethod = kind === 'form_step' ? 'loadPack' : 'getJobForms', originalLoad = f.formDeps[nativeMethod];
    f.deps.team = async request => { events.push('authority'); return originalTeam(request); };
    f.deps.decrypt = async value => { events.push('journal'); return originalDecrypt(value); };
    f.formDeps.team = async () => { throw new Error('The target must reuse the immediately fresh server team.'); };
    f.formDeps.job = async (...args) => { events.push('assigned-job'); return originalJob(...args); };
    f.formDeps[nativeMethod] = async (...args) => { events.push('snapshot'); return originalLoad(...args); };
    const refreshed = await workflowModule.loadWattzunWorkflowReviewForTurn(f.request, f.initial, executed.reviewId, async () => {
      events.push('final-refresh');
      return { access: f.initial.access, tradeTeam: await f.deps.team(new Request(f.request, { headers: { 'X-TLink-Business': 'business-one' } })) };
    }, f.deps);
    assert.deepEqual(refreshed.result, executed.result); assert.equal(f.calls.length, savedWrites);
    assert.deepEqual(events, ['journal', 'assigned-job', 'snapshot', 'authority', 'assigned-job', 'snapshot', 'journal', 'final-refresh', 'authority', 'assigned-job', 'snapshot']);
  });
}

test('receipt handoff reads its final journal before refreshing authority and denies revocation during that read', async () => {
  const f = await guidedWorkflowFixture(), executed = await f.executeGuided(f.proposal, await f.currentInput(), 'journal-revocation-answer-0001');
  let reads = 0, targets = 0, refreshes = 0;
  const originalDecrypt = f.deps.decrypt, originalJob = f.formDeps.job;
  f.deps.decrypt = async value => { const payload = await originalDecrypt(value); if (++reads === 2) f.team.canManageFieldEvidence = false; return payload; };
  f.formDeps.job = async (...args) => { targets++; return originalJob(...args); };
  f.formDeps.team = async () => { throw new Error('No duplicate target authority lookup is permitted.'); };
  await assert.rejects(workflowModule.loadWattzunWorkflowReviewForTurn(f.request, f.initial, executed.reviewId, async () => {
    refreshes++; assert.equal(reads, 2, 'The final journal read completed before fresh authorization');
    return { access: f.initial.access, tradeTeam: structuredClone(f.team) };
  }, f.deps), error => error.status === 403);
  assert.equal(targets, 2, 'Revoked final authority cannot reach the last target read'); assert.equal(refreshes, 1); assert.equal(f.calls.length, 1);
});

test('fresh completed-receipt authority still precedes current assignment and full form target validation', async () => {
  for (const changed of ['assignment', 'form']) {
    const f = await guidedWorkflowFixture(), executed = await f.executeGuided(f.proposal, await f.currentInput(), `receipt-target-${changed}-0001`);
    let targetChanged = false, lastTargetChecked = false;
    const originalJob = f.formDeps.job, originalForms = f.formDeps.getJobForms;
    f.formDeps.job = async (...args) => { if (targetChanged && changed === 'assignment') { lastTargetChecked = true; throw new AccessError(403, 'Job assignment revoked.'); } return originalJob(...args); };
    f.formDeps.getJobForms = async (...args) => { if (targetChanged && changed === 'form') { lastTargetChecked = true; return Response.json({ ok: true, forms: [] }); } return originalForms(...args); };
    f.formDeps.team = async () => { throw new Error('No duplicate target authority lookup is permitted.'); };
    await assert.rejects(workflowModule.loadWattzunWorkflowReviewForTurn(f.request, f.initial, executed.reviewId, async () => {
      targetChanged = true; return { access: f.initial.access, tradeTeam: structuredClone(f.team) };
    }, f.deps), error => error.status === (changed === 'assignment' ? 403 : 404));
    assert.equal(lastTargetChecked, true); assert.equal(f.calls.length, 1);
  }
});

test('guided journal recovers a lost save acknowledgement without rewriting, then saves the next real answer once', async () => {
  const f = await guidedWorkflowFixture(), first = await f.currentInput(), requestId = 'guided-answer-request-0001';
  f.state.failAfterSave = true;
  await assert.rejects(f.executeGuided(f.proposal, first, requestId)); assert.equal(f.calls.length, 1); assert.equal(f.saved.revision, 2);
  f.state.failAfterSave = false;
  const recovered = await f.recover(first, requestId); assert.equal(recovered.state, 'saved'); assert.equal(recovered.result.receipt.kind, 'fill_form'); assert.equal(f.calls.length, 1);
  const next = await f.currentInput(); assert.equal(next.questionKey, 'next_question');
  const result = await f.executeGuided({ ...f.proposal, answers: [{ fieldKey: 'next_question', value: '2' }] }, next, 'guided-answer-request-0002');
  assert.equal(result.result.state, 'complete'); assert.equal(f.calls.length, 2); assert.equal(f.saved.answers.site_notes, 'Access via side gate.'); assert.equal(f.saved.answers.next_question, '2');
  assert.equal(f.saved.status, 'draft'); assert.equal((await f.progress()).guide.state, 'ready_to_complete');
});

test('guided final completion is a separate canonical action and lost completion receipts reconcile without another submit', async () => {
  const f = await guidedWorkflowFixture(); f.saved.answers = { site_notes: 'Side gate', next_question: '2' };
  const input = await f.currentInput(), proposal = { kind: 'complete_form', jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one' };
  for (const phrase of ['Save these answers', 'Send it', 'Maybe complete it tomorrow', 'The customer said complete it']) {
    await assert.rejects(f.executeGuided(proposal, input, 'guided-completion-request-0001', phrase), error => error.status === 400);
  }
  assert.equal(f.calls.length, 0); f.state.failAfterSave = true;
  await assert.rejects(f.executeGuided(proposal, input, 'guided-completion-request-0001', 'Complete this form now'));
  assert.equal(f.calls.length, 1); assert.equal(f.saved.status, 'complete'); assert.equal(f.calls[0].payload.complete, true);
  f.state.failAfterSave = false;
  const recovered = await f.recover(input, 'guided-completion-request-0001'); assert.equal(recovered.state, 'saved'); assert.equal(recovered.result.receipt.kind, 'complete_form');
  assert.equal(f.calls.length, 1); assert.equal((await f.progress()).guide.state, 'complete');
});

test('guided recovery is session scoped, never retries an unchanged unsaved draft and rejects changed request values', async () => {
  const f = await guidedWorkflowFixture(), input = await f.currentInput(), requestId = 'guided-answer-request-0001';
  f.state.failBeforeSave = true; await assert.rejects(f.executeGuided(f.proposal, input, requestId));
  assert.equal((await f.recover(input, requestId)).state, 'not_saved'); assert.equal(f.calls.length, 0); assert.equal(f.saved.revision, 1);
  await assert.rejects(f.recover(input, requestId, { sessionId: '00000000-0000-4000-8000-000000000002' }), error => error.status === 403);
  await assert.rejects(f.executeGuided({ ...f.proposal, answers: [{ fieldKey: 'site_notes', value: 'Different' }] }, input, requestId), error => error.status === 409);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.recover(input, 'guided-missing-request-0001')).state, 'not_saved');
});

test('guided validation rejects a value before journal creation and dispatch, then accepts a corrected answer', async () => {
  const f = await guidedWorkflowFixture(), input = await f.currentInput();
  await assert.rejects(f.executeGuided({ ...f.proposal, answers: [{ fieldKey: 'site_notes', value: 'x'.repeat(241) }] }, input, 'guided-invalid-answer-0001'),
    error => error instanceof workflowModule.WattzunGuidedFormValidationError && error.status === 400);
  assert.equal(f.database.prepare('SELECT count(*) n FROM admin_audit_log').get().n, 0); assert.equal(f.calls.length, 0); assert.equal(f.saved.revision, 1);
  const saved = await f.executeGuided(f.proposal, input, 'guided-valid-answer-00002'); assert.equal(saved.result.receipt.status, 'saved'); assert.equal(f.calls.length, 1);
});

test('a new guided answer retains canonical prewrite and postwrite checks with seven snapshots through its final handoff', async () => {
  const f = await guidedWorkflowFixture(), getForms = f.formDeps.getJobForms; let snapshots = 0, canonicalAuthorities = 0;
  f.formDeps.getJobForms = async (...args) => { snapshots++; return getForms(...args); };
  f.formDeps.team = async () => { canonicalAuthorities++; return structuredClone(f.team); };
  f.deps.team = async () => { throw new Error('New private guided execution must use the canonical executor authority, not a duplicate review authority.'); };
  const input = await f.currentInput(), requestId = 'guided-snapshot-request-0001';
  const saved = await f.executeGuided(f.proposal, input, requestId); assert.equal(snapshots, 4); assert.equal(canonicalAuthorities, 2);
  const next = await f.progress(); assert.equal(next.guide.next.fieldKey, 'next_question'); assert.equal(snapshots, 5);
  let refreshed = 0; const decrypts = f.decryptCalls();
  const checked = await workflowModule.verifyWattzunGuidedReceiptForTurn(f.request, f.initial, f.reference, f.session, requestId, saved.reviewId, async () => {
    refreshed++; assert.ok(f.decryptCalls() > decrypts, 'The exact journal is decrypted before final authority refresh');
    return f.initial;
  }, f.deps);
  assert.deepEqual(checked.result, saved.result); assert.equal(refreshed, 1); assert.equal(snapshots, 6); assert.equal(canonicalAuthorities, 3);
  const finalGuide = await f.progress(); assert.equal(finalGuide.context.sourceSha256, next.context.sourceSha256); assert.equal(snapshots, 7);
  assert.equal(f.calls.length, 1); assert.equal(f.saved.revision, 2); assert.equal(f.saved.status, 'draft');
});

test('new private guided execution still denies current source changes or revoked canonical authority before its write', async () => {
  for (const reason of ['source', 'permission', 'cipher']) {
    const f = await guidedWorkflowFixture(), input = await f.currentInput(), encrypt = f.deps.encrypt;
    f.deps.encrypt = async value => {
      const encrypted = await encrypt(value);
      if (reason === 'source') { f.saved.answers.site_notes = 'New office edit'; f.saved.revision++; }
      if (reason === 'permission') f.team.canManageFieldEvidence = false;
      if (reason === 'cipher') for (const payload of f.cipher.values()) payload.prepared.proposal.answers[0].value = 'Changed frozen proposal';
      return encrypted;
    };
    await assert.rejects(f.executeGuided(f.proposal, input, `guided-new-${reason}-request-0001`), error => error.status >= 400);
    assert.equal(f.calls.length, 0); assert.notEqual(f.saved.answers.site_notes, 'Access via side gate.');
  }
});

test('guided final receipt verification binds original actor request and session before refresh and denies final source or grant changes', async () => {
  const f = await guidedWorkflowFixture(), input = await f.currentInput(), requestId = 'guided-final-request-0001';
  const saved = await f.executeGuided(f.proposal, input, requestId); let refreshed = 0;
  const check = (reference = f.reference, guide = f.session, original = requestId, refresh = async () => { refreshed++; return f.initial; }) =>
    workflowModule.verifyWattzunGuidedReceiptForTurn(f.request, f.initial, reference, guide, original, saved.reviewId, refresh, f.deps);
  await assert.rejects(check(f.reference, f.session, 'wrong-original-request-0001'), error => error.status === 403);
  await assert.rejects(check(f.reference, { ...f.session, sessionId: '00000000-0000-4000-8000-000000000002' }), error => error.status === 403);
  await assert.rejects(check({ ...f.reference, recordId: 'another-form' }), error => error.status === 403); assert.equal(refreshed, 0);
  await assert.rejects(check(f.reference, f.session, requestId, async () => ({ ...f.initial, access: { ...f.initial.access, actorUid: 'another-actor' } })), error => error.status === 403);
  await assert.rejects(check(f.reference, f.session, requestId, async () => {
    f.team.canManageFieldEvidence = false; return { ...f.initial, tradeTeam: structuredClone(f.team) };
  }), error => error.status === 403); f.team.canManageFieldEvidence = true;
  await assert.rejects(check(f.reference, f.session, requestId, async () => {
    f.saved.answers.site_notes = 'Changed after journal read'; f.saved.revision++; return f.initial;
  }), error => error.status === 409); assert.equal(f.calls.length, 1);
});

test('guided final receipt verification never writes while reconciling prepared or executing journal states', async () => {
  for (const state of ['prepared', 'executing']) for (const saved of [false, true]) {
    const f = await guidedWorkflowFixture(), input = await f.currentInput(), requestId = `guided-${state}-${saved}-request-0001`;
    f.state.failAfterSave = true; await assert.rejects(f.executeGuided(f.proposal, input, requestId)); f.state.failAfterSave = false;
    const row = f.database.prepare('SELECT id,metadata FROM admin_audit_log').get(), metadata = JSON.parse(row.metadata);
    metadata.state = state; delete metadata.receipt; f.database.prepare('UPDATE admin_audit_log SET metadata=? WHERE id=?').run(JSON.stringify(metadata), row.id);
    if (!saved) { f.saved.answers = {}; f.saved.revision = 1; }
    const verify = () => workflowModule.verifyWattzunGuidedReceiptForTurn(f.request, f.initial, f.reference, f.session, requestId, row.id, async () => f.initial, f.deps);
    if (saved) assert.equal((await verify()).result.receipt.status, 'saved');
    else await assert.rejects(verify(), error => error.status === 409);
    assert.equal(f.calls.length, 1); assert.equal(JSON.parse(f.database.prepare('SELECT metadata FROM admin_audit_log').get().metadata).state, state);
  }
});

test('guided declarations require their native control and spoken agreement never creates a journal or signature', async () => {
  const f = await guidedWorkflowFixture();
  f.saved.template.fields.unshift({ key: 'consent', label: 'I personally declare these supplied facts are correct.', type: 'checkbox', required: true });
  f.saved.answers = { site_notes: 'Side gate', next_question: '2', consent: false };
  const progress = await f.progress(); assert.equal(progress.guide.state, 'manual');
  assert.match(formGuide.wattzunFormGuideNarration(progress.guide), /(?:sign|declaration|form control)/i);
  const input = { ...f.session, stage: 'continue', sourceSha256: progress.guide.sourceSha256, questionKey: 'consent' };
  for (const proposal of [
    { kind: 'form_step', jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one', step: { kind: 'declaration', fieldKey: 'consent', acknowledged: true } },
    { ...f.proposal, answers: [{ fieldKey: 'consent', value: true }] },
  ]) await assert.rejects(f.executeGuided(proposal, input, 'guided-declaration-000001', 'I confirm this declaration'), error => error.status >= 400);
  assert.equal(f.database.prepare('SELECT count(*) n FROM admin_audit_log').get().n, 0); assert.equal(f.calls.length, 0); assert.equal(f.saved.answers.consent, false);
  // The native form control produces the real saved declaration; speech resumes from that saved source.
  f.saved.answers.consent = true; f.saved.revision++;
  const resumed = await f.progress(); assert.equal(resumed.guide.state, 'ready_to_complete'); assert.equal(f.saved.status, 'draft'); assert.equal(f.calls.length, 0);
});

test('closing a guided call during canonical team verification stops before the business save', async () => {
  const f = await guidedWorkflowFixture(), input = await f.currentInput(), controller = new AbortController();
  f.formDeps.team = async () => { controller.abort(); return f.team; };
  await assert.rejects(workflowModule.executeWattzunGuidedFormForTurn(new Request(f.request.url, { signal: controller.signal }), f.initial, f.reference, f.proposal, input, 'guided-closed-call-000001', '', f.deps), error => error.name === 'AbortError' || error.status === 409);
  assert.equal(f.calls.length, 0); assert.equal(f.saved.revision, 1);
});

test('an explicit false answer and lost acknowledgement preserve the current checkbox deferral without declaring the form ready', async () => {
  const f = await guidedWorkflowFixture();
  f.saved.template.fields.unshift({ key: 'checked', label: 'Is the test complete?', type: 'checkbox', required: true }); f.saved.answers.checked = false;
  const input = await f.currentInput(); assert.equal(input.questionKey, 'checked'); f.state.failAfterSave = true;
  await assert.rejects(f.executeGuided({ ...f.proposal, answers: [{ fieldKey: 'checked', value: false }] }, input, 'guided-false-answer-000001'));
  f.state.failAfterSave = false;
  const recovered = await f.recover(input, 'guided-false-answer-000001'); assert.equal(recovered.state, 'saved'); assert.deepEqual(recovered.deferredFieldKeys, ['checked']); assert.equal(f.calls.length, 1);
  f.session.skippedFieldKeys = recovered.deferredFieldKeys;
  const progress = await f.progress(); assert.equal(progress.guide.next.fieldKey, 'site_notes'); assert.equal(progress.guide.completion.ready, false);
});

test('guided work-pack lost-save recovery binds the original selector while canonical record id and revision advance', async () => {
  const f = await guidedWorkflowFixture(), original = { kind: 'trade_form', formKind: 'work_pack', jobId: 'job-one', recordId: 'pack-original' };
  const prompt = key => ({ promptKey: key, label: key, type: 'text', required: true, options: [], dependencyKeys: [], attestation: null, fileRequirement: null, referenceDocument: null, signerRoleKey: '', minimumLength: null, maximumLength: null, minimumNumber: null, maximumNumber: null, numberStep: null });
  const pack = { instance: { id: 'pack-current', workOrderId: 'job-one', instanceKey: 'stable-pack', revision: 3, status: 'in_progress', responseSha256: 'sha256:' + 'a'.repeat(64) },
    definition: { title: 'Synthetic work pack', schema: { sections: [{ sectionKey: 'general', repeatability: null, prompts: [prompt('notes'), prompt('serial')] }] } },
    signatureBindings: { definitionSha256: 'a', prefillSha256: 'b' }, response: { answers: {}, repeatableSections: {} }, completion: { visiblePromptKeys: ['notes', 'serial'] } };
  f.formDeps.loadPack = async () => structuredClone(pack);
  f.formDeps.savePack = async (_db, payload) => {
    assert.equal(payload.expectedResponseSha256, pack.instance.responseSha256); assert.equal(payload.caseInstanceId, pack.instance.id);
    for (const patch of payload.sectionPatches) Object.assign(pack.response.answers, patch.answers);
    pack.instance.id = 'pack-next'; pack.instance.revision++; pack.instance.responseSha256 = 'sha256:' + 'b'.repeat(64); f.calls.push({ kind: 'pack', payload });
    throw new Error('Lost acknowledgement after canonical work-pack commit');
  };
  const { guide } = await formHelper.loadWattzunFormGuideForTurn(f.request, f.initial.access, original, f.session, f.team, f.formDeps);
  assert.equal(guide.recordId, 'pack-current');
  const input = { ...f.session, stage: 'continue', sourceSha256: guide.sourceSha256, questionKey: 'notes' };
  const proposal = { kind: 'fill_form', jobQuery: '', jobId: 'job-one', formKind: 'work_pack', formId: guide.recordId, answers: [{ fieldKey: 'notes', value: 'Side gate' }] };
  await assert.rejects(workflowModule.executeWattzunGuidedFormForTurn(f.request, f.initial, original, proposal, input, 'guided-pack-lost-00000001', '', f.deps), /Lost acknowledgement/);
  assert.equal(f.calls.length, 1); assert.equal(pack.instance.revision, 4);
  const recovered = await workflowModule.recoverWattzunGuidedFormForTurn(f.request, f.initial, original, input, 'guided-pack-lost-00000001', f.deps);
  assert.equal(recovered.state, 'saved'); assert.equal(recovered.result.receipt.id, 'pack-next'); assert.equal(f.calls.length, 1);
  await assert.rejects(workflowModule.recoverWattzunGuidedFormForTurn(f.request, f.initial, { ...original, recordId: 'another-pack' }, input, 'guided-pack-lost-00000001', f.deps), error => error.status === 403);
  pack.instance.revision++; pack.response.answers.serial = 'Office edit';
  await assert.rejects(workflowModule.recoverWattzunGuidedFormForTurn(f.request, f.initial, original, input, 'guided-pack-lost-00000001', f.deps), error => error.status === 409);
  assert.equal(f.calls.length, 1);
});

function turnFixture(options = {}) {
  const f = fixture(options), request = new Request('https://example.test/api/wattzun/voice');
  const access = { ...f.access, scope: { ...f.access.scope, label: f.team.businessName } };
  const snapshot = () => ({ access, tradeTeam: structuredClone(f.team) });
  const initial = snapshot();
  return { ...f, request, initial, snapshot,
    turnPrepare: (proposal = price, requestId = 'synthetic-turn-request-0001') => workflowModule.prepareWattzunWorkflowForTurn(request, initial, proposal, requestId, f.deps),
    turnReview: (reviewId, refresh) => workflowModule.loadWattzunWorkflowReviewForTurn(request, initial, reviewId, refresh || (async () => snapshot()), f.deps) };
}

test('private turn preparation reuses only its completed authority while final handoff refreshes once after frozen source rebuilding', async () => {
  const f = turnFixture();
  f.deps.team = async () => { throw new Error('An internal duplicate authority read is not permitted in this price-book turn.'); };
  const candidate = await f.turnPrepare(); assert.equal(candidate.state, 'review'); assert.equal(f.calls.length, 0);
  let refreshes = 0;
  const checked = await f.turnReview(candidate.reviewId, async () => {
    refreshes++; assert.ok(f.decryptCalls() >= 2); assert.equal(f.calls.length, 0); return f.snapshot();
  });
  assert.deepEqual(checked.result, candidate); assert.equal(refreshes, 1); assert.equal(f.calls.length, 0);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_price_book_items').get().n, 0);
});

test('turn final handoff still denies changed grants, source target and corrupt frozen payloads before private disclosure', async () => {
  for (const reason of ['grant', 'archive', 'cipher']) {
    const f = turnFixture(), candidate = await f.turnPrepare(reason === 'grant' ? price : customerMessage);
    if (reason === 'cipher') for (const value of f.cipher.values()) value.prepared.review.lines = [{ label: 'Bad', value: { private: true } }];
    await assert.rejects(f.turnReview(candidate.reviewId, async () => {
      if (reason === 'grant') { f.team.isOwner = false; f.team.canManagePriceBook = false; }
      if (reason === 'archive') f.database.exec("UPDATE trade_work_orders SET record_status='archived' WHERE id='job-one'");
      return f.snapshot();
    }), error => error.status === (reason === 'cipher' ? 503 : 403));
    assert.equal(f.calls.length, 0);
  }
});

test('turn choices refresh grants after source rebuilding and never expose private matches after revocation', async () => {
  const f = turnFixture(); f.addJob('job-two');
  const candidate = await f.turnPrepare(customerMessage); assert.equal(candidate.state, 'choose_job');
  let refreshed = false;
  await assert.rejects(workflowModule.verifyWattzunWorkflowForTurn(f.request, f.initial, customerMessage, 'synthetic-turn-request-0001', async () => {
    refreshed = true; assert.ok(f.statements.filter(sql => sql.includes('FROM trade_work_orders w')).length >= 2);
    f.team.canViewCustomers = false; return f.snapshot();
  }, f.deps), error => error.status === 403);
  assert.equal(refreshed, true); assert.equal(f.calls.length, 0);
});

test('turn candidates reject same request changed payloads and cancellation without executing a business action', async () => {
  const f = turnFixture(); await f.turnPrepare();
  await assert.rejects(f.turnPrepare({ ...price, unitPrice: '99.00' }), error => error.status === 409);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(workflowModule.prepareWattzunWorkflowForTurn(new Request(f.request.url, { signal: controller.signal }), f.initial, price, 'synthetic-turn-request-0001', f.deps), error => error.name === 'AbortError');
  assert.equal(f.calls.length, 0);
});

test('next voice review load reconciles a saved form after its outer receipt was lost without writing again', async () => {
  const f=formWorkflowFixture(), prepared=await f.prepare(f.proposal), id=prepared.body.result.reviewId;
  f.state.failAfterSave=true; assert.equal((await f.execute(id)).status,503); assert.equal(f.calls.length,1);
  const before=f.database.prepare('SELECT metadata FROM admin_audit_log WHERE id=?').get(id).metadata;
  assert.equal(JSON.parse(before).state,'executing');
  const recovered=await f.review(id);assert.equal(recovered.state,'complete');assert.equal(recovered.receipt.status,'saved');
  assert.match(recovered.receipt.message,/Next question: How many units/);assert.equal(f.calls.length,1);
  assert.equal(f.database.prepare('SELECT metadata FROM admin_audit_log WHERE id=?').get(id).metadata,before,'Review reconciliation is read-only');
  assert.deepEqual(await f.review(id),recovered);assert.equal(f.calls.length,1);
  const retried=await f.execute(id);assert.equal(retried.status,200);assert.deepEqual(retried.body.result,recovered);assert.equal(f.calls.length,1);
});

test('a pre-save form failure retains the same unchanged review until explicit approval retries the frozen write', async () => {
  const f=formWorkflowFixture(), prepared=await f.prepare(f.proposal), id=prepared.body.result.reviewId;
  f.state.failBeforeSave=true;assert.equal((await f.execute(id)).status,503);assert.equal(f.calls.length,0);
  assert.deepEqual(await f.review(id),prepared.body.result);assert.equal(f.calls.length,0);
  f.state.failBeforeSave=false;
  assert.deepEqual(await f.review(id),prepared.body.result);assert.equal(f.calls.length,0,'Loading a review is never execution approval');
  assert.equal((await f.execute(id)).status,200);assert.equal(f.calls.length,1);assert.equal(f.saved.answers.site_notes,'Access via side gate.');
});

test('executing form recovery rejects changed drafts, revoked access and tampered frozen payloads', async () => {
  for(const reason of ['changed','revoked','tampered']){
    const f=formWorkflowFixture(), prepared=await f.prepare(f.proposal), id=prepared.body.result.reviewId;
    f.state.failBeforeSave=true;assert.equal((await f.execute(id)).status,503);
    if(reason==='changed'){f.saved.answers.site_notes='Newer manual answer';f.saved.revision++;}
    else if(reason==='revoked')f.team.canManageFieldEvidence=false;
    else for(const encrypted of f.cipher.values())encrypted.prepared.form.payload.answers.next_question='Unreviewed answer';
    await assert.rejects(f.review(id),error=>error.status===(reason==='revoked'?403:409));assert.equal(f.calls.length,0);
  }
});

test('expired executing forms recover only an existing exact receipt and never save an unchanged draft', async () => {
  for(const saved of [false,true]){
    const f=formWorkflowFixture(), prepared=await f.prepare(f.proposal), id=prepared.body.result.reviewId;
    f.state.failBeforeSave=!saved;f.state.failAfterSave=saved;assert.equal((await f.execute(id)).status,503);
    f.state.failBeforeSave=false;f.state.failAfterSave=false;f.advance(16*60_000);
    if(saved){const recovered=await f.review(id);assert.equal(recovered.state,'complete');assert.equal((await f.execute(id)).status,200);}
    else{await assert.rejects(f.review(id),error=>error.status===409);assert.equal((await f.execute(id)).status,409);}
    assert.equal(f.calls.length,saved?1:0);
  }
});

test('reviewed form workflow saves native draft answers once and continues with the next question without customer access', async () => {
  const f = formWorkflowFixture();
  const review = await f.prepare(f.proposal);
  assert.equal(review.status, 200); assert.equal(review.body.result.kind, 'fill_form');
  assert.deepEqual(review.body.result.lines, [{ label: 'Site notes', value: 'Access via side gate.' }]);
  assert.equal(f.calls.length, 0);
  const result = await f.execute(review.body.result.reviewId);
  assert.equal(result.status, 200); assert.equal(result.body.result.receipt.kind, 'fill_form');
  assert.match(result.body.result.receipt.message, /saved.*Next question: How many units/);
  assert.deepEqual(f.saved.answers, { site_notes: 'Access via side gate.', next_question: '' }); assert.equal(f.saved.status, 'draft');
  assert.equal((await f.execute(review.body.result.reviewId)).status, 200);
  assert.equal(f.calls.length, 1);
  assert.ok(!f.statements.some(sql => sql.includes('JOIN trade_crm_customers')));
  f.database.close();
});

test('form workflow rejects changed answers, lost permission and tampered frozen target before saving', async () => {
  for (const scenario of ['changed', 'permission', 'tampered']) {
    const f = formWorkflowFixture(), review = await f.prepare(f.proposal);
    assert.equal(review.status, 200);
    if (scenario === 'changed') { f.saved.answers.site_notes = 'Manual newer answer'; f.saved.revision++; }
    if (scenario === 'permission') f.team.canManageFieldEvidence = false;
    if (scenario === 'tampered') for (const payload of f.cipher.values()) payload.prepared.proposal.formId = 'other-form';
    const result = await f.execute(review.body.result.reviewId);
    assert.ok([403, 409, 503].includes(result.status)); assert.equal(f.calls.length, 0);
    if (scenario === 'changed') assert.equal(f.saved.answers.site_notes, 'Manual newer answer');
    f.database.close();
  }
});

async function quoteWorkflowFixture(options = {}) {
  const f = fixture({ ...options, team: { isOwner: false, jobScope: 'own', canViewQuotes: true, canManageQuotes: true,
    canViewPriceBook: true, canApplyDiscounts: true, ...options.team } });
  const proposal = { kind: 'draft_job_quote', jobQuery: '', jobId: 'job-one', mode: 'append', description: 'Add cable',
    lines: [{ lineType: 'product', description: 'Cable', quantity: '1', unitPrice: '12.50', taxCode: 'gst' }] };
  let quoteReads = 0; let revision = 1;
  const authoritySha256 = await quoteHelper.wattzunExistingQuoteAuthoritySha256(f.team, { scopeId: 'business-one', actorUid: 'actor-one' });
  f.deps.prepareQuote = async (_request, input) => {
    assert.equal(input.proposal.jobId, 'job-one'); quoteReads++;
    const job = f.database.prepare(`SELECT w.revision,c.first_name,c.last_name,s.address_line_1,s.suburb FROM trade_work_orders w
      JOIN trade_crm_job_details d ON d.work_order_id=w.id JOIN trade_crm_customers c ON c.id=d.crm_customer_id
      JOIN trade_crm_service_sites s ON s.id=d.service_site_id WHERE w.id='job-one'`).get();
    return { sourceSha256: await hash({ job, revision }), authoritySha256,
      job: { id: 'job-one', workNumber: 'JOB-job-one', customerName: `${job.first_name} ${job.last_name}`, siteSummary: `${job.address_line_1}, ${job.suburb}` },
      original: { quoteId: 'quote-one', versionId: 'version-one', updatedAt: '2026-10-06', roofImageSha256: null },
      savePayload: { action: 'save_draft', workOrderId: 'job-one', expectedVersionId: 'version-one', expectedUpdatedAt: '2026-10-06',
        lines: [{ ...proposal.lines[0], sectionHeading: '', priceBookItemId: '', jobPacketId: '', jobPacketLineId: '' }], choices: [],
        customerEmail: 'john@example.test', terms: 'Keep saved terms', customerMessage: 'Keep saved message', validUntil: '2026-10-30', equipment: { common: [], choices: [] }, designId: '' },
      review: { title: 'Save existing quote draft', summary: 'Append supplied Cable line', fields: [{ label: 'Added line', value: 'Cable $12.50 excluding GST' }] } };
  };
  return { ...f, proposal, quoteReads: () => quoteReads, changeQuote: () => { revision++; } };
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
test('workflow boundaries read fresh canonical team authority without repeating the portal authority lookup', async () => {
  const f = fixture(); const result = await f.prepare(); assert.equal(result.status, 200);
  assert.deepEqual(f.authorityCalls(), { access: 1, team: 4 });
  const request = new Request('https://example.test/api/wattzun/portal');
  assert.equal((await workflowModule.loadWattzunWorkflowReview(request, f.access, result.body.result.reviewId, f.deps)).state, 'review');
  assert.deepEqual(f.authorityCalls(), { access: 1, team: 6 });
});

test('new strict and portal reviews read and decrypt their frozen row once without skipping its guards', async () => {
  for (const portal of [false, true]) {
    const f = fixture(); const result = portal ? await f.portalPrepare() : (await f.prepare()).body.result;
    assert.equal(result.state, 'review'); assert.equal(f.decryptCalls(), 1);
    assert.equal(f.statements.filter(sql => sql.startsWith('SELECT id,admin_uid,entity_id,action,metadata FROM admin_audit_log')).length, 2);
    assert.equal(f.calls.length, 0);
  }
});

test('portal post-model quote preparation defers one rebuild to the strict final review loader', async () => {
  const f = await quoteWorkflowFixture(); const result = await f.portalPrepare(f.proposal);
  assert.equal(result.state, 'review'); assert.equal(f.quoteReads(), 1);
  const final = await workflowModule.loadWattzunWorkflowReview(new Request('https://example.test/api/wattzun/portal'), f.access, result.reviewId, f.deps);
  assert.deepEqual(final, result); assert.equal(f.quoteReads(), 2); assert.equal(f.calls.length, 0);
  const strict = await quoteWorkflowFixture(); assert.equal((await strict.prepare(strict.proposal)).status, 200); assert.equal(strict.quoteReads(), 2);
});

test('only a newly inserted portal review reuses its preparation authority before a fresh final check', async () => {
  const f = fixture(); const review = await f.portalPrepare(price);
  assert.equal(review.state, 'review'); assert.deepEqual(f.authorityCalls(), { access: 0, team: 3 });
  assert.equal(f.decryptCalls(), 1); assert.equal(f.calls.length, 0);
  await f.portalPrepare(price);
  assert.deepEqual(f.authorityCalls(), { access: 0, team: 6 }, 'reused reviews retain their full strict loader');
  const strict = fixture(); assert.equal((await strict.prepare(price)).status, 200);
  assert.deepEqual(strict.authorityCalls(), { access: 1, team: 4 }, 'standalone preparation keeps every existing check');
});

test('new portal review denies revocation at each retained authority boundary', async () => {
  for (const teamRevokeAt of [1, 2, 3]) {
    const f = fixture({ teamRevokeAt });
    await assert.rejects(f.portalPrepare(price), error => error.status === 403);
    assert.equal(f.authorityCalls().team, teamRevokeAt); assert.equal(f.calls.length, 0);
  }
});

test('new portal review still rejects authority changes during encryption before returning internally', async () => {
  for (const mutation of [{ actorUid: 'other-actor' }, { ownerUid: 'other-business' },
    { isOwner: false, canManagePriceBook: false }]) {
    const f = fixture(); const encrypt = f.deps.encrypt;
    f.deps.encrypt = async payload => { const value = await encrypt(payload); Object.assign(f.team, mutation); return value; };
    await assert.rejects(f.portalPrepare(price), error => error.status === 403);
    assert.equal(f.calls.length, 0);
  }
});

test('new portal review checks current grants after reading its encrypted row', async () => {
  const f = fixture(); const decrypt = f.deps.decrypt;
  f.deps.decrypt = async encrypted => {
    const value = await decrypt(encrypted);
    f.team.isOwner = false; f.team.canManagePriceBook = false;
    return value;
  };
  await assert.rejects(f.portalPrepare(price), error => error.status === 403);
  assert.equal(f.decryptCalls(), 1); assert.equal(f.calls.length, 0);
});

test('standalone preparation still rejects a source changed while freezing the review', async () => {
  const f = await quoteWorkflowFixture(); const encrypt = f.deps.encrypt;
  f.deps.encrypt = async payload => { const value = await encrypt(payload); f.changeQuote(); return value; };
  const result = await f.prepare(f.proposal); assert.equal(result.status, 409); assert.equal(result.body.ok, false);
  assert.equal(f.quoteReads(), 2); assert.equal(f.decryptCalls(), 1); assert.equal(f.calls.length, 0);
});

test('portal reviews cannot bypass a changed quote or customer source at the final strict handoff', async () => {
  for (const change of [f => f.changeQuote(), f => f.database.exec("UPDATE trade_crm_customers SET last_name='Changed'"),
    f => f.database.exec("UPDATE trade_crm_service_sites SET address_line_1='14 Changed Street'")]) {
    const f = await quoteWorkflowFixture(); const encrypt = f.deps.encrypt;
    f.deps.encrypt = async payload => { const value = await encrypt(payload); change(f); return value; };
    const review = await f.portalPrepare(f.proposal); assert.equal(review.state, 'review'); assert.equal(f.quoteReads(), 1);
    await assert.rejects(workflowModule.loadWattzunWorkflowReview(new Request('https://example.test/api/wattzun/portal'), f.access, review.reviewId, f.deps), error => error.status === 409);
    assert.equal(f.quoteReads(), 2); assert.equal(f.calls.length, 0);
  }
});

test('portal preparation checks fresh quote grants and every shared quote authority field before returning internally', async () => {
  for (const change of [team => { team.canManageQuotes = false; }, team => { team.canViewQuotes = false; },
    team => { team.canApplyDiscounts = false; }, team => { team.crewId = 'changed-crew'; }]) {
    const f = await quoteWorkflowFixture(); const encrypt = f.deps.encrypt;
    f.deps.encrypt = async payload => { const value = await encrypt(payload); change(f.team); return value; };
    await assert.rejects(f.portalPrepare(f.proposal), error => error.status === 403);
    assert.equal(f.quoteReads(), 1); assert.equal(f.calls.length, 0);
  }
});

test('portal preparation still denies archived or reassigned jobs after encryption', async () => {
  for (const sql of ["UPDATE trade_work_orders SET record_status='archived'", "UPDATE trade_work_orders SET assignee_member_id='another-member'"]) {
    const f = await quoteWorkflowFixture(); const encrypt = f.deps.encrypt;
    f.deps.encrypt = async payload => { const value = await encrypt(payload); f.database.exec(sql); return value; };
    await assert.rejects(f.portalPrepare(f.proposal), error => error.status === 403); assert.equal(f.calls.length, 0);
  }
});

test('portal request replay is strict and rejects source changes or a reused fingerprint with different details', async () => {
  const f = await quoteWorkflowFixture(); await f.portalPrepare(f.proposal); f.changeQuote();
  await assert.rejects(f.portalPrepare(f.proposal), error => error.status === 409); assert.equal(f.quoteReads(), 2);
  await assert.rejects(f.portalPrepare({ ...f.proposal, description: 'Different task' }), error => error.status === 409);
  assert.equal(f.quoteReads(), 2); assert.equal(f.calls.length, 0);
});

test('only this call creating a row can defer, and a competing same-request row must match its fingerprint and fresh source', async () => {
  for (const differentFingerprint of [true, false]) {
    const f = await quoteWorkflowFixture(); const encrypt = f.deps.encrypt;
    f.deps.encrypt = async payload => {
      const encrypted = await encrypt(payload); const prepared = payload.prepared;
      const saved = { fingerprint: differentFingerprint ? 'c'.repeat(64) : await hash(f.proposal), expiresAt: prepared.review.expiresAt,
        kind: prepared.proposal.kind, sourceSha256: prepared.sourceSha256, encrypted, state: 'prepared' };
      f.database.prepare("INSERT INTO admin_audit_log VALUES(?,'actor-one','wattzun.workflow_review','trade_business','business-one','Synthetic competing row',?,'2026-10-07')")
        .run(prepared.review.reviewId, JSON.stringify(saved));
      f.changeQuote(); return encrypted;
    };
    await assert.rejects(f.portalPrepare(f.proposal), error => error.status === 409);
    assert.equal(f.quoteReads(), differentFingerprint ? 1 : 2); assert.equal(f.calls.length, 0);
  }
});

test('portal expired and submitted reviews stay in strict no-resend recovery', async () => {
  const f = await quoteWorkflowFixture(); const review = await f.portalPrepare(f.proposal); assert.equal(review.state, 'review'); f.advance(30 * 60_000);
  await assert.rejects(f.portalPrepare(f.proposal), error => error.status === 409); assert.equal(f.quoteReads(), 1);
  const expired = await quoteWorkflowFixture(); const savedReview = await expired.portalPrepare(expired.proposal); assert.equal(savedReview.state, 'review');
  expired.database.exec("UPDATE admin_audit_log SET metadata=json_set(metadata,'$.state','executing')"); expired.advance(30 * 60_000);
  let recoveryCalls = 0;
  expired.deps.executeQuote = async (_request, input) => { assert.equal(input.allowSave, false); recoveryCalls++; throw new QuoteError(409, 'No matching saved target.'); };
  await assert.rejects(expired.portalPrepare(expired.proposal), error => error.status === 409);
  assert.equal(recoveryCalls, 1); assert.equal(expired.quoteReads(), 1); assert.equal(expired.calls.length, 0);
  const message = fixture(); const first = await message.portalPrepare(); await message.execute(first.reviewId);
  const result = await message.portalPrepare(); assert.equal(result.state, 'complete'); assert.equal(message.calls.length, 1);
});

test('portal deferral cannot hide an invalid encrypted quote payload', async () => {
  const f = await quoteWorkflowFixture(); const encrypt = f.deps.encrypt;
  f.deps.encrypt = async payload => { const value = await encrypt(payload); f.cipher.get(value).prepared.quote.savePayload.lines[0].quantity = 42; return value; };
  await assert.rejects(f.portalPrepare(f.proposal), error => error.status === 503);
  assert.equal(f.quoteReads(), 1); assert.equal(f.calls.length, 0);
});
test('canonical team revocation at each preparation boundary prevents disclosure and any operational send', async () => {
  for (const teamRevokeAt of [1, 2, 3, 4]) {
    const f = fixture({ teamRevokeAt }); const result = await f.prepare(); assert.equal(result.status, 403);
    assert.equal(result.body.result, undefined); assert.equal(f.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /John Smith|Fake Street|john@example/);
    assert.deepEqual(f.authorityCalls(), { access: 1, team: teamRevokeAt });
  }
});
test('fresh canonical team actor and business must continue matching authenticated portal scope', async () => {
  for (const mutation of [{ actorUid: 'other-actor' }, { ownerUid: 'other-business' }]) {
    const f = fixture({ onTeam: (_database, team, count) => { if (count === 2) Object.assign(team, mutation); } });
    const result = await f.prepare(); assert.equal(result.status, 403);
    assert.equal(result.body.result, undefined); assert.equal(f.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /John Smith|Fake Street/);
  }
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
test('raw pending price details do not reserve the same-request review before the canonical corrected proposal', async () => {
  const f = fixture(), requestId = 'synthetic-price-correction-0001';
  const pending = { ...price, name: 'Example Ceiling Fan Installation', description: 'Standard ceiling fan installation',
    itemType: 'labour', unitLabel: 'per installation', unitPrice: '165', supplierCost: null };
  const originalPending = structuredClone(pending);
  try {
    const initial = await f.prepare(pending, requestId);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.result.state, 'needs_details');
    assert.deepEqual(initial.body.result.questions, ['How is it charged: each, hour, metre or another unit?']);
    assert.equal(f.database.prepare('SELECT COUNT(*) count FROM admin_audit_log').get().count, 0);
    assert.equal(f.cipher.size, 0); assert.equal(f.calls.length, 0);

    // The shared provider boundary supplies this canonical corrected action;
    // the workflow service must keep both preparations on the same request ID.
    const current = { ...pending, unitLabel: 'each', unitPrice: '175' };
    const prepared = await f.prepare(current, requestId);
    assert.equal(prepared.status, 200); assert.equal(prepared.body.result.state, 'review');
    const review = prepared.body.result;
    assert.equal(review.lines.find(line => line.label === 'Sell price excluding GST').value, '$175.00');
    assert.equal(review.lines.find(line => line.label === 'Type / unit').value, 'labour / each');
    const rows = f.database.prepare('SELECT id,metadata FROM admin_audit_log').all();
    assert.equal(rows.length, 1); assert.equal(rows[0].id, review.reviewId);
    const saved = JSON.parse(rows[0].metadata), frozen = f.cipher.get(saved.encrypted).prepared;
    assert.equal(saved.fingerprint, await hash(current));
    assert.deepEqual(frozen.proposal, current);
    assert.equal(frozen.price.payload.unitLabel, 'each'); assert.equal(frozen.price.payload.sellPrice, '175');
    assert.deepEqual(pending, originalPending); assert.equal(f.calls.length, 0);

    assert.equal((await f.prepare({ ...current, unitPrice: '185' }, requestId)).status, 409);
    assert.equal(f.database.prepare('SELECT metadata FROM admin_audit_log WHERE id=?').get(review.reviewId).metadata, rows[0].metadata);
    assert.equal(f.calls.length, 0);
    const executed = await f.execute(review.reviewId);
    assert.equal(executed.status, 200); assert.equal(executed.body.result.receipt.status, 'saved');
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'price');
    assert.equal(f.calls[0].body.unitLabel, 'each'); assert.equal(f.calls[0].body.sellPrice, '175');
    const items = f.database.prepare('SELECT unit_label,sell_price_cents_ex_gst FROM trade_price_book_items').all();
    assert.equal(items.length, 1); assert.equal(items[0].unit_label, 'each'); assert.equal(items[0].sell_price_cents_ex_gst, 17500);
    assert.equal((await f.execute(review.reviewId)).status, 200); assert.equal(f.calls.length, 1);
    assert.deepEqual(pending, originalPending);
  } finally { f.database.close(); }
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
