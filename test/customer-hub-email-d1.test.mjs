import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { migratedDataforceD1 } from './helpers/trade-dataforce-database.mjs';
import { certificateTestDependency } from './helpers/creditex-training-fixture.mjs';
import * as consent from '../src/lib/public-plan-enquiry.mjs';
import * as catalogue from '../src/lib/energy-service-catalogue.mjs';
import * as businessProfile from '../src/lib/customer-hub-business-profile.ts';
import * as emailContent from '../src/lib/customer-hub-email.mjs';

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

// Real authority SQL, hub capabilities, AES-GCM and provider serialization run.
// Only the environment key and provider HTTP transport use synthetic fixtures.
const protection = load('../src/lib/trade-integration-crypto.ts', {
  'cloudflare:workers': { env: { CRM_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url') } },
  '@/lib/trade-integration-state': { calendarIntegrationState: () => { throw new Error('No calendar operation expected.'); } },
});
const quoteLinks = load('../src/lib/trade-quote-links.ts', { '@/lib/trade-integration-crypto': protection });
const links = load('../src/lib/customer-hub-links.ts', {
  './trade-integration-crypto': protection, './trade-quote-links': quoteLinks, './public-plan-enquiry.mjs': consent,
});
const participant = load('../src/lib/customer-quote-hub-server.ts', {
  './customer-hub-business-profile': businessProfile,
  './trade-access-server': certificateTestDependency('trade-access-server'),
  './aea-trade-owner-server': certificateTestDependency('aea-trade-owner-server'),
  './trade-certificate-leads': certificateTestDependency('trade-certificate-leads'),
  './public-plan-enquiry.mjs': consent, './energy-service-catalogue.mjs': catalogue,
  './customer-hub-links': links, './trade-quote-links': quoteLinks, './trade-quote-decision-server': {},
});
const provider = load('../src/lib/service-reminder-delivery.ts', {});

test('actual D1 sends and safely recovers current enquiry Q&A with legacy account updates off', async t => {
  const runtime = await migratedDataforceD1();
  t.after(() => runtime.close());
  const db = runtime.db, sent = [];
  const providerRuntime = { RESEND_API_KEY: 'synthetic-provider-key', RESEND_FROM_EMAIL: 'sender@example.invalid' };
  const server = load('../src/lib/customer-hub-email-server.ts', {
    './customer-quote-hub-server': participant, './customer-hub-links': links,
    './trade-integration-crypto': protection, './customer-hub-email.mjs': emailContent,
    './service-reminder-delivery': {
      serviceReminderProviderConfiguration: () => provider.serviceReminderProviderConfiguration(providerRuntime),
      serviceReminderRetryAt: provider.serviceReminderRetryAt,
      sendServiceReminderProviderMessage: input => provider.sendServiceReminderProviderMessage(input, {
        runtime: providerRuntime,
        fetchImpl: async (url, init) => {
          assert.equal(url, 'https://api.resend.com/emails');
          sent.push({ body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
          return Response.json({ id: `synthetic-provider-${sent.length}` });
        },
      }),
    },
  });
  const insert = async (table, input) => {
    const values = {};
    for (const column of (await db.prepare(`PRAGMA table_info(${table})`).all()).results) {
      if (column.notnull && column.dflt_value === null) values[column.name] = /INT/i.test(column.type) ? 0 : '';
    }
    Object.assign(values, input);
    await db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`)
      .bind(...Object.values(values)).run();
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
  await insert('customer_accounts', { firebase_uid: 'customer', email, display_name: 'Synthetic Customer', account_updates: 0,
    consent_version: '2026-07-15', consent_at: now, created_at: now, updated_at: now });
  await links.ensureCustomerHubForReleasedLead(db, 'opportunity', 'release', email);
  const queue = async id => db.batch([
    db.prepare(`INSERT INTO customer_hub_questions(id,opportunity_id,match_id,service_categories_json,kind,prompt,created_at,updated_at)
      VALUES (?,'opportunity','match',?,'text','PRIVATE QUESTION',?,?)`).bind(`question-${id}`, services, now, now),
    db.prepare(`INSERT INTO customer_hub_events(id,opportunity_id,question_id,event_type,author_match_id,created_at)
      VALUES (?,'opportunity',?,'asked','match',?)`).bind(id, `question-${id}`, now),
    server.hubEmailStatement(db, id, 'opportunity', now),
  ]);
  const row = id => db.prepare('SELECT * FROM customer_hub_email_deliveries WHERE event_id=?').bind(id).first();

  await queue('first');
  await server.drainCustomerHubEmails(db, 'first');
  assert.equal((await row('first')).status, 'accepted');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.html, /section=qa&amp;question=question-first/);
  assert.deepEqual(sent[0].body.to, [email]);
  assert.match(sent[0].body.html, /Open my quotes &amp; questions/);
  assert.doesNotMatch(JSON.stringify(sent), /PRIVATE QUESTION/);
  const payload = await protection.decryptProtectedPayload((await row('first')).encrypted_payload);
  assert.equal((await links.authoriseCustomerHub(db, decodeURIComponent(new URL(payload.link).pathname.split('/').at(-1)))).release_id, 'release');

  await queue('recovered');
  await db.prepare("UPDATE customer_hub_email_deliveries SET status='stopped',attempts=1,first_attempt_at=? WHERE event_id='recovered'").bind(now).run();
  const retries = await Promise.all([server.retryCustomerHubEmail(db, 'recovered'), server.retryCustomerHubEmail(db, 'recovered')]);
  assert.equal(retries.filter(result => result.ok).length, 1);
  assert.equal((await row('recovered')).status, 'accepted');
  assert.equal((await row('recovered')).attempts, 2);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].key, 'customer-hub-recovered');
  assert.deepEqual(await server.retryCustomerHubEmail(db, 'recovered'), { ok: false, error: 'DELIVERY_NOT_RETRYABLE' });

  await queue('suppressed');
  await insert('public_plan_customer_email_suppressions', { email_hash: await quoteLinks.hashQuoteLinkSecret(email), reason: 'complained',
    provider_status: 'complained', suppressed_at: now, created_at: now, updated_at: now });
  await server.drainCustomerHubEmails(db, 'suppressed');
  assert.equal((await row('suppressed')).status, 'stopped');
  assert.deepEqual(await server.retryCustomerHubEmail(db, 'suppressed'), { ok: true, status: 'stopped' });
  assert.equal(sent.length, 2);
});
