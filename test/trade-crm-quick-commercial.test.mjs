import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as rental from '../src/lib/trade-rental-assessment.mjs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
function moduleAt(path, mocks = {}) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => mocks[name] || {}, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const deniedSideEffect = () => { throw new Error('Quick quote invoked a scheduling or compliance side effect'); };
function fixture(overrides = {}) {
  const database = new DatabaseSync(':memory:');
  const tables = {
    trade_accounts: 'firebase_uid address_state',
    trade_crm_customers: 'id firebase_uid customer_number customer_type first_name last_name business_name business_number email phone address_line_1 address_line_2 suburb address_state postcode tags private_notes record_status created_at updated_at',
    trade_crm_customer_contacts: 'id firebase_uid customer_id first_name last_name role_label email phone is_primary record_status created_at updated_at',
    trade_crm_service_sites: 'id firebase_uid customer_id site_label address_line_1 address_line_2 suburb address_state postcode address_entry_mode address_provider address_provider_reference address_formatted address_verified_at access_instructions parking_instructions hazard_notes is_primary record_status created_at updated_at',
    trade_crm_site_contacts: 'id firebase_uid service_site_id customer_contact_id role_label is_primary record_status created_at updated_at',
    trade_work_orders: 'id firebase_uid partner_type work_type source_type source_reference work_number title service_category site_area stage priority scheduled_start scheduled_end assignee_member_id assignee_label record_status created_at updated_at',
    trade_crm_job_details: 'id work_order_id firebase_uid crm_customer_id service_site_id customer_source pipeline_stage building_type description customer_reference next_action tags estimated_value_cents quoted_value_cents invoiced_value_cents paid_value_cents quote_status invoice_status payment_due_at created_at updated_at',
    trade_work_order_events: 'id work_order_id firebase_uid event_type summary created_at',
    trade_work_order_tasks: 'id work_order_id firebase_uid title due_at status completed_at revision sort_order created_at updated_at',
    trade_team_sync_changes: 'owner_uid audience_member_id entity_type entity_id operation revision changed_at',
    trade_crm_appointments: 'id work_order_id firebase_uid starts_at ends_at status created_at',
    trade_work_order_compliance_intents: 'id work_order_id installer_uid intent_snapshot status revision created_at',
    trade_handover_packs: 'id work_order_id firebase_uid status updated_at',
    compliance_cases: 'id work_order_id installer_uid status evidence_status',
    trade_crm_quotes: 'id work_order_id firebase_uid current_version_number',
    trade_crm_quote_versions: 'id quote_id firebase_uid version_number subtotal_cents',
    trade_crm_quote_acceptances: 'id quote_id quote_version_id work_order_id firebase_uid decision selected_subtotal_cents',
    trade_crm_quote_choices: 'id quote_version_id firebase_uid choice_kind group_key recommended position subtotal_cents',
  };
  for (const [name, columns] of Object.entries(tables)) database.exec(`CREATE TABLE ${name} (${columns.split(' ').map(column => `${column} TEXT ${column === 'id' ? 'PRIMARY KEY' : ''} DEFAULT ''`).join(',')})`);
  database.exec("INSERT INTO trade_accounts VALUES ('owner-1', 'VIC'), ('owner-2', 'VIC')");
  const queries = [];
  function statement(sql, values = []) {
    return { bind: (...parameters) => statement(sql, parameters),
      async first() { queries.push(sql); return database.prepare(sql).get(...values) || null; },
      async all() { queries.push(sql); return { results: database.prepare(sql).all(...values) }; },
      async run() { queries.push(sql); return { meta: { changes: Number(database.prepare(sql).run(...values).changes) } }; },
    };
  }
  const d1 = { prepare: sql => statement(sql), async batch(statements) {
    database.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  } };
  const access = { ownerUid: 'owner-1', actorUid: 'worker-1', actorEmail: 'worker@example.test', memberId: 'member-1',
    businessName: 'Trade business', isOwner: false, canCreateJobs: true, canManageQuotes: true,
    canManageJobs: false, canManageCustomers: false, canViewCustomers: false, canSearchCustomers: false,
    jobScope: 'team', scheduleScope: 'team', ...overrides };
  class DomainError extends Error {}
  let numbers = 0;
  const route = moduleAt('../src/app/api/trade-crm/route.ts', {
    '../../../../db': { getD1: () => d1 },
    '@/lib/admin-server': { adminJson: (body, status = 200) => Response.json(body, { status }), cleanAdminText: clean, sameOrigin: () => true },
    '@/lib/trade-access-server': { TradeAccessError: DomainError },
    '@/lib/route-performance': { routeTimer: () => ({ database: async value => value, startedAt: 0, dbDurationMs: 0 }), performanceJson: body => Response.json(body) },
    '@/lib/keyset-pagination': moduleAt('../src/lib/keyset-pagination.ts'),
    '@/lib/trade-crm-job-index-sql': moduleAt('../src/lib/trade-crm-job-index-sql.ts'),
    '@/lib/creditex-dataforce-job-csv': { projectInstallerWorkOrderToDataforceRecord: input => input },
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => access,
      canCreateJobs: current => current.isOwner || current.canCreateJobs,
      canManageQuotes: current => current.isOwner || current.canManageQuotes,
      canManageJobs: current => current.isOwner || current.canManageJobs,
      canAssignJob: deniedSideEffect, assignedJob: deniedSideEffect },
    '@/lib/trade-crm-job-register': moduleAt('../src/lib/trade-crm-job-register.ts'),
    '@/lib/trade-crm-register-sort-sql': moduleAt('../src/lib/trade-crm-register-sort-sql.ts'),
    '@/lib/trade-team-sync-server': moduleAt('../src/lib/trade-team-sync-server.ts'),
    '@/lib/trade-customer-dedup-server': moduleAt('../src/lib/trade-customer-dedup-server.ts'),
    '@/lib/trade-job-number-server': { nextTlinkJobNumber: async () => `TLJ-TEST-${++numbers}` },
    '@/lib/trade-integrations-server': { integrationEnvironment: () => ({}) },
    '@/lib/trade-address-verification': { TradeAddressVerificationError: DomainError,
      resolveTradeAddressProvenance: async input => ({ ...Object.fromEntries(['addressLine1', 'addressLine2', 'suburb', 'addressState', 'postcode'].map(key => [key, clean(input[key], 180)])), addressEntryMode: 'manual_pending_review' }) },
    '@/lib/trade-compliance-intent': { TradeComplianceIntentError: DomainError, resolveTradeComplianceIntents: deniedSideEffect },
    '@/lib/creditex-compliance-server': { ComplianceDomainError: DomainError, autoOpenReadyPlannedComplianceWorkPacks: deniedSideEffect },
    '@/lib/trade-calendar-sync-server': { syncCreatedAppointmentToConnectedCalendars: deniedSideEffect },
    '@/lib/direct-appointment-invite-server': { sendDirectAppointmentCalendarInvite: deniedSideEffect },
    '@/lib/scheduled-activity-customer-documents-server': { sendScheduledActivityCustomerDocuments: deniedSideEffect },
    '@/lib/trade-rental-assessment.mjs': rental,
    '@/lib/trade-schedule-server': { isTradeJobScheduleEligibilityConflict: () => false },
    '@/lib/trade-compliance-intent-replan-server': { isTradeComplianceIntentScheduleConflict: () => false },
    '@/lib/trade-rental-assignment-server': { isRentalInspectionAssignmentConflict: () => false },
    '@/lib/trade-rental-credentials': { rentalAssignmentRequiredGates: () => [] },
    '@/lib/energy-service-catalogue.mjs': { ENERGY_SERVICE_IDS: ['hot-water'], ENERGY_SERVICE_LABELS: { 'hot-water': 'Hot water' } },
  });
  function insertCustomer(id = 'customer-1', owner = 'owner-1', values = {}) {
    const customer = { id, firebase_uid: owner, customer_number: id.toUpperCase(), customer_type: 'residential', first_name: 'Alex', last_name: 'Customer', email: `${id}@example.test`, phone: '(0412) 345-678', record_status: 'active', updated_at: '2026-09-08', ...values };
    database.prepare(`INSERT INTO trade_crm_customers (${Object.keys(customer).join(',')}) VALUES (${Object.keys(customer).map(() => '?').join(',')})`).run(...Object.values(customer));
    database.prepare("INSERT INTO trade_crm_service_sites (id,firebase_uid,customer_id,site_label,address_line_1,suburb,address_state,postcode,is_primary,record_status) VALUES (?,?,?,'Home','12 Main St','Melbourne','VIC','3000','1','active')").run(`site-${id}`, owner, id);
    return customer;
  }
  async function post(body) {
    const response = await route.POST(new Request('https://example.test/api/trade-crm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  }
  async function getInvoiceJobs(parameters = {}) {
    const url = new URL('https://example.test/api/trade-crm');
    url.search = new URLSearchParams({ mode: 'index', resource: 'jobs', commercial: 'invoice', filter: 'all', ...parameters }).toString();
    const response = await route.GET(new Request(url));
    return { status: response.status, body: await response.json() };
  }
  function insertJob(id, customerId, owner = 'owner-1', fields = {}) {
    const { customer_source = 'trade_owned', ...workFields } = fields;
    const work = { id, firebase_uid: owner, partner_type: 'installer', work_type: 'job', source_type: 'internal',
      work_number: id.toUpperCase(), title: 'Customer work', service_category: 'hot-water', stage: 'completed',
      assignee_member_id: 'member-1', record_status: 'active', updated_at: '2026-09-08', ...workFields };
    database.prepare(`INSERT INTO trade_work_orders (${Object.keys(work).join(',')}) VALUES (${Object.keys(work).map(() => '?').join(',')})`).run(...Object.values(work));
    database.prepare('INSERT INTO trade_crm_job_details (id,work_order_id,firebase_uid,crm_customer_id,service_site_id,customer_source) VALUES (?,?,?,?,?,?)')
      .run('detail-'+id, id, owner, customerId, 'site-'+customerId, customer_source);
  }
  return { database, post, insertCustomer, queries, access, getInvoiceJobs, insertJob };
}
const quick = overrides => ({ action: 'create_quick_quote_job', clientRequestId: 'phone-request-0000001', customerMode: 'new', firstName: 'Casey', lastName: 'Client', email: 'casey@example.test', phone: '0412 345 678',
  addressLine1: '12 Main St', suburb: 'Melbourne', addressState: 'VIC', postcode: '3000', serviceCategory: 'hot-water', description: 'Supply and install unit', ...overrides });

test('quick customer search is owner scoped, bounded, literal and accepts normalized phone numbers', async () => {
  const { database, post, insertCustomer, queries } = fixture();
  try {
    insertCustomer('target', 'owner-1', { first_name: 'Target_100%', email: 'target@example.test' });
    insertCustomer('foreign', 'owner-2', { first_name: 'Target_100%' });
    insertCustomer('inactive', 'owner-1', { first_name: 'Target_100%', record_status: 'inactive' });
    const before = queries.length;
    assert.deepEqual((await post({ action: 'find_quick_quote_customers', search: 't' })).body.matches, []);
    assert.equal(queries.slice(before).some(sql => sql.includes('FROM trade_crm_customers')), false);
    for (const search of ['target@example', '0412345678', 'Target_100%']) {
      const response = await post({ action: 'find_quick_quote_customers', search });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.matches.map(item => item.customerId), ['target']);
    }
    for (const search of ['%%', 'unknown0412345678']) assert.deepEqual((await post({ action: 'find_quick_quote_customers', search })).body.matches, []);
    for (let i = 0; i < 12; i++) insertCustomer(`many-${i}`, 'owner-1', { first_name: 'Batch', phone: '' });
    assert.equal((await post({ action: 'find_quick_quote_customers', search: 'batch' })).body.matches.length, 10);
  } finally { database.close(); }
});

test('both quick quote actions require create-job and manage-quote permissions', async () => {
  for (const permissions of [{ canCreateJobs: false }, { canManageQuotes: false }, { canCreateJobs: false, canManageQuotes: false }]) {
    const { database, post } = fixture(permissions);
    try {
      for (const body of [{ action: 'find_quick_quote_customers', search: 'alex' }, quick()]) {
        const result = await post(body);
        assert.equal(result.status, 403, JSON.stringify(result.body));
      }
      assert.equal(database.prepare('SELECT COUNT(*) count FROM trade_work_orders').get().count, 0);
    } finally { database.close(); }
  }
});

test('new-customer quick quote creates an unscheduled unassigned job once and ignores scheduling/activity payloads', async () => {
  const { database, post } = fixture();
  try {
    const body = quick({ scheduledStart: '2099-01-01T10:00', scheduledEnd: '2099-01-01T11:00', startsAt: '2099-01-01T10:00',
      templateId: 'unrelated-template', sourceEnquiryId: 'unrelated-enquiry', assigneeMemberId: 'other-person', emailCalendarInvite: true, complianceActivitiesJson: '[{"activityTemplateId":"veu-6"}]', complianceIntentMode: 'program' });
    const first = await post(body);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.quickQuote, true); assert.equal(first.body.appointmentId, '');
    const work = database.prepare('SELECT * FROM trade_work_orders WHERE id = ?').get(first.body.id);
    for (const field of ['scheduled_start', 'scheduled_end', 'assignee_member_id', 'assignee_label']) assert.equal(work[field], '');
    for (const table of ['trade_crm_appointments', 'trade_work_order_compliance_intents']) assert.equal(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0);
    const customer = database.prepare('SELECT * FROM trade_crm_customers').get();
    assert.equal(customer.email, 'casey@example.test'); assert.equal(customer.phone, '0412 345 678'); assert.equal(customer.address_line_1, '12 Main St');
    assert.equal(customer.suburb, 'Melbourne'); assert.equal(customer.address_state, 'VIC'); assert.equal(customer.postcode, '3000');
    const replay = await post(body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.id, first.body.id); assert.equal(replay.body.idempotentReplay, true);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM trade_work_orders').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM trade_crm_customers').get().count, 1);
  } finally { database.close(); }
});

test('new-customer quick quote allows a separate customer with matching contact and address details', async () => {
  const { database, post, insertCustomer } = fixture();
  try {
    insertCustomer('existing', 'owner-1', {
      first_name: 'Casey', last_name: 'Client', email: 'casey@example.test', phone: '0412 345 678',
    });
    const result = await post(quick({
      clientRequestId: 'duplicate-customer-0001', phone: '0412 345 678',
      addressLine1: '12 Main St', suburb: 'Melbourne', addressState: 'VIC', postcode: '3000',
    }));
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_customers WHERE firebase_uid = 'owner-1'").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(DISTINCT id) count FROM trade_crm_customers WHERE firebase_uid = 'owner-1' AND email = 'casey@example.test'").get().count, 2);
  } finally { database.close(); }
});

test('existing-customer quick quote needs matching owner/site/email without customer-management permission', async () => {
  const { database, post, insertCustomer } = fixture();
  try {
    insertCustomer(); insertCustomer('foreign', 'owner-2');
    const body = quick({ customerMode: 'existing', crmCustomerId: 'customer-1', serviceSiteId: 'site-customer-1', email: 'customer-1@example.test' });
    const response = await post(body);
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.customerId, 'customer-1');
    const wrongEmail = await post({ ...body, clientRequestId: 'wrong-email-0000001', email: 'wrong@example.test' });
    assert.equal(wrongEmail.status, 403, JSON.stringify(wrongEmail.body));
    const foreign = await post({ ...body, clientRequestId: 'foreign-owner-000001', crmCustomerId: 'foreign', serviceSiteId: 'site-foreign', email: 'foreign@example.test' });
    assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
    assert.equal(database.prepare('SELECT COUNT(*) count FROM trade_work_orders').get().count, 1);
  } finally { database.close(); }
});

test('quick quote requires valid email, mobile and full property details before writing', async () => {
  const { database, post } = fixture();
  try {
    for (const body of [quick({ email: '' }), quick({ email: 'bad' }), quick({ clientRequestId: '' }), quick({ clientRequestId: 'short' }),
      quick({ phone: '' }), quick({ phone: '123' }), quick({ addressLine1: '' }), quick({ suburb: '' }), quick({ addressState: '' }), quick({ postcode: '' })]) {
      const result = await post(body); assert.equal(result.status, 400, JSON.stringify(result.body));
    }
    assert.equal(database.prepare('SELECT COUNT(*) count FROM trade_work_orders').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM trade_crm_customers').get().count, 0);
  } finally { database.close(); }
});

test('own-job-only staff cannot create an inaccessible unassigned quick quote', async () => {
  const { database, post } = fixture({ jobScope: 'own' });
  try { const result = await post(quick()); assert.equal(result.status, 403, JSON.stringify(result.body));
    assert.equal(database.prepare('SELECT COUNT(*) count FROM trade_work_orders').get().count, 0);
  } finally { database.close(); }
});

test('rental quote can be priced before compliance activities are scheduled', async () => {
  const { database, post } = fixture();
  try { const result = await post(quick({ serviceCategory: rental.RENTAL_INSPECTION_SERVICE_CATEGORY }));
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(database.prepare('SELECT COUNT(*) count FROM trade_work_order_compliance_intents').get().count, 0);
  } finally { database.close(); }
});

test('invoice job GET finds names, emails, addresses and normalized mobile numbers within the business', async () => {
  const { database, insertCustomer, insertJob, getInvoiceJobs } = fixture({ canManageInvoices: true });
  try {
    insertCustomer('customer-1'); insertJob('direct-job', 'customer-1');
    insertCustomer('foreign', 'owner-2'); insertJob('foreign-job', 'foreign', 'owner-2');
    for (const search of ['Alex Customer', 'customer-1@example.test', '12 Main St', '0412345678', '(0412) 345-678']) {
      const result = await getInvoiceJobs({ search });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(result.body.items.map(item => item.id), ['direct-job']);
      assert.equal(result.body.pagination.total, 1);
      assert.equal(result.body.items[0].customerDisplayName, 'Alex Customer');
      assert.equal(result.body.items[0].jobRegister.contactNumber, '(0412) 345-678');
      assert.equal(result.body.items[0].jobRegister.email, 'customer-1@example.test');
      assert.equal(result.body.items[0].jobRegister.streetAddress, '12 Main St');
    }
    const noFalsePhoneMatch = await getInvoiceJobs({ search: 'unmatched0412345678' });
    assert.equal(noFalsePhoneMatch.status, 200, JSON.stringify(noFalsePhoneMatch.body));
    assert.deepEqual(noFalsePhoneMatch.body.items, []);
  } finally { database.close(); }
});

test('invoice eligibility is filtered before pagination and preserves own-job scope', async () => {
  const { database, insertCustomer, insertJob, getInvoiceJobs } = fixture({ canManageInvoices: true, jobScope: 'own' });
  try {
    insertCustomer(); insertJob('own-job', 'customer-1');
    insertJob('other-worker', 'customer-1', 'owner-1', { assignee_member_id: 'member-2' });
    for (let i = 0; i < 30; i++) insertJob('excluded-'+i, 'customer-1', 'owner-1', { updated_at: '2099-01-01',
      ...(i % 3 === 0 ? { source_type: 'opportunity' } : i % 3 === 1 ? { customer_source: 'platform_private' } : { stage: 'cancelled' }) });
    const result = await getInvoiceJobs({ pageSize: '25' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.items.map(item => item.id), ['own-job']);
    assert.equal(result.body.pagination.total, 1); assert.equal(result.body.pagination.hasNext, false);
    assert.equal(result.body.pagination.nextCursor, '');
  } finally { database.close(); }
});

test('invoice picker GET requires manage-invoices permission even when the actor can quote', async () => {
  const { database, getInvoiceJobs } = fixture({ canManageInvoices: false });
  try { const result = await getInvoiceJobs({ search: 'Alex' }); assert.equal(result.status, 403, JSON.stringify(result.body)); }
  finally { database.close(); }
});
