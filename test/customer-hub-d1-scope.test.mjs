import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { migratedDataforceD1 } from './helpers/trade-dataforce-database.mjs';
import { certificateTestDependency } from './helpers/creditex-training-fixture.mjs';
import * as consent from '../src/lib/public-plan-enquiry.mjs';
import * as catalogue from '../src/lib/energy-service-catalogue.mjs';
import * as collaboration from '../src/lib/trade-job-collaboration.ts';
import * as businessProfile from '../src/lib/customer-hub-business-profile.ts';

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
// Only environment encryption is substituted. Every authority predicate and SQL
// statement uses the production implementation against Miniflare's D1 runtime.
const protection = { encryptProtectedPayload: async value => JSON.stringify(value), decryptProtectedPayload: async value => JSON.parse(value) };
const quoteLinks = load('../src/lib/trade-quote-links.ts', { '@/lib/trade-integration-crypto': protection });
const links = load('../src/lib/customer-hub-links.ts', {
  './trade-integration-crypto': protection, './trade-quote-links': quoteLinks, './public-plan-enquiry.mjs': consent,
});
const hubServer = load('../src/lib/customer-quote-hub-server.ts', {
  './customer-hub-business-profile': businessProfile,
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
const quoteEmail = load('../src/lib/trade-quote-hub-email-server.ts', {
  './customer-quote-hub-server': hubServer, './customer-hub-links': links,
  './trade-integration-crypto': protection, './trade-quote-links': quoteLinks,
});
const unexpected = () => { throw new Error('No workflow creation, object storage or provider send is expected.'); };

async function fixture(t) {
  const runtime = await migratedDataforceD1(); t.after(() => runtime.close());
  const db = runtime.db;
  const insert = async (table, input) => {
    const values = {};
    for (const column of (await db.prepare(`PRAGMA table_info(${table})`).all()).results) {
      if (column.notnull && column.dflt_value === null) values[column.name] = /INT/i.test(column.type) ? 0 : '';
    }
    Object.assign(values, input);
    await db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).bind(...Object.values(values)).run();
  };
  const now = new Date().toISOString(), services = '["assessment","solar"]', email = 'customer@example.invalid';
  await insert('trade_accounts', { firebase_uid: 'owner', email: 'owner@example.invalid', business_name: 'Verified Ordinary Trade', partner_type: 'installer',
    account_status: 'active', abn: '53004085616', verified_abn: '53004085616', verification_status: 'approved', verification_review_id: 'review',
    verification_reviewed_at: now, verification_reviewed_by_uid: 'reviewer', capabilities: services, service_states: '["VIC"]', created_at: now, updated_at: now });
  await insert('trade_account_verification_reviews', { id: 'review', firebase_uid: 'owner', abn: '53004085616', business_name: 'Verified Ordinary Trade',
    partner_type: 'installer', decision: 'approved', review_method: 'official_abr_lookup', reviewed_by_uid: 'reviewer', reviewed_at: now });
  await insert('trade_opportunities', { id: 'opportunity', title: 'Synthetic enquiry', project_type: 'residential', state: 'VIC', postcode: '3000',
    status: 'open', service_categories: services, source_reference: 'source', expires_at: '2099-12-31T23:59:59.000Z', created_at: now, updated_at: now });
  await insert('public_trade_lead_contact_releases', { id: 'release', opportunity_id: 'opportunity', source_reference: 'source', customer_email: email,
    postcode: '3000', notice_version: consent.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, consent_purpose: consent.PUBLIC_PLAN_CONSENT_PURPOSE,
    disclosed_fields: '["customer_email","postcode","service_categories"]', granted_at: now, created_at: now, updated_at: now });
  await insert('trade_opportunity_matches', { id: 'match', opportunity_id: 'opportunity', firebase_uid: 'owner', status: 'interested',
    matched_categories: services, matched_at: now, updated_at: now });
  await insert('trade_crm_customers', { id: 'customer', firebase_uid: 'owner', customer_number: 'CUS-1', email, created_at: now, updated_at: now });
  await insert('trade_work_orders', { id: 'work', firebase_uid: 'owner', partner_type: 'installer', work_number: 'JOB-1', title: 'Synthetic job',
    source_type: 'public_lead', source_reference: 'match', service_categories: services, assignee_member_id: 'staff', created_at: now, updated_at: now });
  await insert('trade_crm_job_details', { id: 'detail', work_order_id: 'work', firebase_uid: 'owner', customer_source: 'public_lead_released', crm_customer_id: 'customer',
    accepted_disclosure_sha256: 'a'.repeat(64), accepted_disclosure_snapshot: JSON.stringify({ contract: 'tlink-public-lead-accepted-disclosure-v1',
      source: { opportunityMatchId: 'match', sourceReference: 'source', releaseId: 'release' }, customer: { email } }), created_at: now, updated_at: now });
  await insert('trade_team_members', { id: 'staff', owner_uid: 'owner', member_uid: 'staff-uid', email: 'staff@example.invalid', role: 'member', status: 'active',
    can_view_quotes: 1, can_manage_quotes: 1, job_scope: 'own', created_at: now, updated_at: now });
  let access = { ownerUid: 'owner', actorUid: 'owner', isOwner: true, memberId: '', canViewQuotes: true, canManageQuotes: true, jobScope: 'team' };
  let beforeWrite = null;
  const statement = (query, native = db.prepare(query)) => ({ native,
    bind: (...values) => statement(query, native.bind(...values)), first: () => native.first(), all: () => native.all(),
    run: async () => { if (query.startsWith('INSERT INTO customer_hub_interests')) { const hook = beforeWrite; beforeWrite = null; await hook?.(); } return native.run(); },
  });
  const routedDb = { prepare: query => statement(query), batch: statements => db.batch(statements.map(item => item.native)) };
  const route = load('../src/app/api/trade-customer-hub/route.ts', {
    '../../../../db': { getD1: () => routedDb }, '@/lib/admin-server': { sameOrigin: () => true, mfaErrorResponse: () => null },
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => access },
    '@/lib/trade-customer-hub-server': tradeServer, '@/lib/customer-quote-hub-server': hubServer,
    '@/lib/customer-hub-links': links, '@/lib/customer-project-evidence-bucket': { getCustomerProjectEvidenceBucket: unexpected },
    '@/lib/customer-hub-email-server': { hubEmailStatement: unexpected, drainCustomerHubEmails: unexpected },
    '@/lib/public-lead-quote-workflow-server': { startPublicLeadQuoteWorkflow: unexpected }, '@/lib/opportunity-server': { syncMarketplaceEnquiries: unexpected },
  });
  const get = (query = 'matchId=match') => route.GET(new Request(`https://ausenergyassessments.com/api/trade-customer-hub?${query}`));
  const patch = (interested, revision, ids = { matchId: 'match' }) => route.PATCH(new Request('https://ausenergyassessments.com/api/trade-customer-hub', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ids, interested, revision }),
  }));
  return { db, route, get, patch, owner: access, setAccess: value => { access = value; }, beforeWrite: hook => { beforeWrite = hook; },
    recipient: { ownerUid: 'owner', workOrderId: 'work', customerId: 'customer', recipientEmail: email } };
}

test('actual D1 executes new all-qualified hub GET, interest PATCH and exact quote email scopes without Creditex approval', async t => {
  const f = await fixture(t);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM creditex_business_onboarding').first()).n, 0);
  assert.equal(await quoteEmail.tradeQuoteCustomerHubEmailUrl(f.db, f.recipient), undefined);
  const before = await (await f.get()).json();
  assert.equal(before.available, true); assert.equal(before.interested, false); assert.equal(before.customerId, 'customer');
  const response = await f.patch(true, 0);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const interested = await response.json();
  assert.equal(interested.interested, true); assert.equal(interested.workOrderId, 'work'); assert.equal(interested.customerId, 'customer');
  const url = await quoteEmail.tradeQuoteCustomerHubEmailUrl(f.db, f.recipient);
  assert.ok(url.startsWith('https://ausenergyassessments.com/customer-hub/'));
  assert.equal(await quoteEmail.tradeQuoteCustomerHubEmailUrl(f.db, { ...f.recipient, customerId: 'foreign' }), undefined);
  assert.equal(await quoteEmail.tradeQuoteCustomerHubEmailUrl(f.db, { ...f.recipient, recipientEmail: 'foreign@example.invalid' }), undefined);
  assert.equal((await f.patch(true, 0)).status, 200, 'replay retains revision and job');
  assert.equal((await (await f.patch(false, 1)).json()).interested, false);
  assert.equal((await (await f.patch(true, 2)).json()).interested, true);
  assert.equal(await quoteEmail.tradeQuoteCustomerHubEmailUrl(f.db, f.recipient), url);
  assert.doesNotMatch(JSON.stringify(interested), /customer-hub\/|encrypted_token|token_hash/);

  f.setAccess({ ...f.owner, isOwner: false, actorUid: 'staff-uid', memberId: 'staff', jobScope: 'own' });
  const staffRead = await f.get('workOrderId=work');
  assert.equal(staffRead.status, 200, JSON.stringify(await staffRead.clone().json()));
  assert.equal((await staffRead.json()).available, true);
  assert.equal((await f.patch(false, 3, { workOrderId: 'work' })).status, 200);
  await f.db.prepare("UPDATE trade_work_orders SET assignee_member_id='' WHERE id='work'").run();
  assert.equal((await (await f.get('workOrderId=work')).json()).available, false);
  assert.equal((await f.patch(true, 4, { workOrderId: 'work' })).status, 404);

  f.setAccess(f.owner);
  f.beforeWrite(() => f.db.prepare("UPDATE public_trade_lead_contact_releases SET postcode='3001' WHERE id='release'").run());
  assert.equal((await f.patch(true, 4)).status, 409, 'the live D1 CAS rechecks disclosure at mutation');
  const unchanged = await f.db.prepare("SELECT interested,revision FROM customer_hub_interests WHERE match_id='match'").first();
  assert.deepEqual(unchanged, { interested: 0, revision: 4 });
  assert.equal(await quoteEmail.tradeQuoteCustomerHubEmailUrl(f.db, f.recipient), undefined);
  assert.equal((await (await f.get()).json()).available, false);
});
