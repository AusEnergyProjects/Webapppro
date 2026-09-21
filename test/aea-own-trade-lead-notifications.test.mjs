import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as routing from '../src/lib/aea-trade-routing.mjs';
import * as publicSite from '../src/lib/public-site.ts';
import * as tradeAbn from '../src/lib/trade-abn.ts';
import * as notices from '../src/lib/public-plan-enquiry.mjs';
import * as quickNotices from '../src/lib/quick-upgrade-enquiry.mjs';
import * as locality from '../src/lib/customer-matching-locality.mjs';
import * as notifications from '../src/lib/opportunity-notifications.ts';

function load(name, dependencies) {
  const output = ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', output)(specifier => {
    assert.ok(dependencies[specifier], `Unexpected dependency: ${specifier}`); return dependencies[specifier];
  }, loaded, loaded.exports);
  return loaded.exports;
}
// Use the real verification SQL. Unused authentication/service dependencies are
// isolated; no identity, provider or production database is contacted by tests.
const access = load('trade-access-server', { '../../db': {}, './firebase-server': {}, './creditex-schema-guards': {}, './trade-abn': {} });
const owner = load('aea-trade-owner-server', { './aea-trade-routing.mjs': routing, './public-site': publicSite, './trade-abn': tradeAbn });
const eligibility = load('trade-certificate-leads', { './aea-trade-owner-server': owner, './aea-trade-routing.mjs': routing });
const retry = load('opportunity-notification-retry', { './aea-trade-owner-server.ts': owner });

function fixture(t, { scope = ['assessment', 'solar'], status = 'open' } = {}) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,email TEXT,business_name TEXT,abn TEXT,partner_type TEXT,account_status TEXT,verification_status TEXT,verified_abn TEXT,verification_review_id TEXT,verification_reviewed_at TEXT,verification_reviewed_by_uid TEXT,consent_at TEXT,email_opportunities INTEGER,availability_status TEXT,capabilities TEXT);
    CREATE TABLE admin_users(firebase_uid TEXT PRIMARY KEY,status TEXT,role TEXT);
    CREATE TABLE trade_account_verification_reviews(id TEXT PRIMARY KEY,firebase_uid TEXT,abn TEXT,business_name TEXT,partner_type TEXT,decision TEXT,review_method TEXT,reviewed_by_uid TEXT,reviewed_at TEXT);
    CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY,service_categories TEXT,suburb TEXT,postcode TEXT,state TEXT,timing TEXT,expires_at TEXT,created_at TEXT,status TEXT,source_reference TEXT);
    CREATE TABLE trade_opportunity_matches(id TEXT PRIMARY KEY,opportunity_id TEXT,firebase_uid TEXT,status TEXT,matched_categories TEXT,matched_at TEXT);
    CREATE TABLE public_trade_lead_contact_releases(id TEXT PRIMARY KEY,opportunity_id TEXT,status TEXT,notice_version TEXT,consent_purpose TEXT,disclosed_fields TEXT,customer_first_name TEXT,customer_last_name TEXT,customer_street_address TEXT,customer_suburb TEXT,customer_address_state TEXT,postcode TEXT,customer_message TEXT,customer_email TEXT,customer_phone TEXT,granted_at TEXT,withdrawn_at TEXT);
    CREATE TABLE customer_projects(id TEXT,firebase_uid TEXT,opportunity_id TEXT);
    CREATE TABLE customer_consent_receipts(id TEXT,project_id TEXT,firebase_uid TEXT,purpose TEXT,notice_version TEXT,granted_at TEXT,withdrawn_at TEXT);
    CREATE TABLE customer_project_evidence(id TEXT,project_id TEXT,customer_uid TEXT,status TEXT,sharing_scope TEXT);
    CREATE TABLE creditex_current_business_jurisdictions(owner_uid TEXT,state TEXT);`);
  sql.exec(fs.readFileSync('drizzle/0087_trade_opportunity_notifications.sql', 'utf8'));
  const now = new Date().toISOString();
  for (const [uid, abn, name] of [['aea', publicSite.PUBLIC_SITE.abn.replace(/\D/g, ''), publicSite.PUBLIC_SITE.legalName], ['external', '53004085616', 'External Solar']]) {
    sql.prepare('INSERT INTO trade_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid, `${uid}@example.test`, name, abn, 'installer', 'active', 'approved', abn, `${uid}-review`, now, 'reviewer', now, 0, 'open', '["assessment","solar"]');
    sql.prepare('INSERT INTO trade_account_verification_reviews VALUES (?,?,?,?,?,?,?,?,?)').run(`${uid}-review`, uid, abn, name, 'installer', 'approved', 'official_abr_lookup', 'reviewer', now);
    sql.prepare('INSERT INTO creditex_current_business_jurisdictions VALUES (?,?)').run(uid, 'VIC');
  }
  sql.exec(`ALTER TABLE trade_accounts ADD COLUMN service_states TEXT NOT NULL DEFAULT '["VIC"]'`);
  sql.exec("INSERT INTO admin_users VALUES ('aea','active','owner')");
  sql.prepare('INSERT INTO trade_opportunities VALUES (?,?,?,?,?,?,?,?,?,?)').run('opportunity', JSON.stringify(scope), 'Private suburb', '3000', 'VIC', 'planning', '2099-01-01T00:00:00.000Z', now, status, 'public-enquiry');
  sql.prepare('INSERT INTO public_trade_lead_contact_releases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('release', 'opportunity', 'active', notices.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, notices.PUBLIC_PLAN_CONSENT_PURPOSE, '["customer_email","postcode","service_categories"]', '', '', '', '', '', '3000', '', 'private-customer@example.test', '', now, '');
  for (const uid of ['aea', 'external']) sql.prepare('INSERT INTO trade_opportunity_matches VALUES (?,?,?,?,?,?)').run(`match-${uid}`, 'opportunity', uid, 'offered', JSON.stringify(scope), now);
  const sent = []; const db = { beforeClaim: null };
  const statement = (query, values = []) => ({
    query, values, bind: (...bindings) => statement(query, bindings),
    first: async () => sql.prepare(query).get(...values) || null,
    all: async () => ({ results: sql.prepare(query).all(...values) }),
    run: async () => {
      if (query.includes("SET status = 'sending'")) { const hook = db.beforeClaim; db.beforeClaim = null; hook?.(); }
      return { success: true, meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
    },
  });
  db.prepare = query => statement(query);
  db.batch = async statements => { sql.exec('BEGIN'); try { const results = []; for (const item of statements) results.push(await item.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } };
  const server = load('opportunity-notification-server', {
    '../../db': { getD1: () => db }, '@/lib/aea-trade-routing.mjs': routing, '@/lib/aea-trade-owner-server': owner,
    '@/lib/opportunity-notifications': notifications, '@/lib/customer-matching-locality.mjs': locality,
    '@/lib/public-plan-enquiry.mjs': notices, '@/lib/quick-upgrade-enquiry.mjs': quickNotices,
    '@/lib/opportunity-notification-retry': retry, '@/lib/trade-access-server': access, '@/lib/trade-certificate-leads': eligibility,
    '@/lib/service-reminder-delivery': { serviceReminderProviderConfiguration: () => ({ email: { configured: true } }), sendServiceReminderProviderMessage: async message => { sent.push(message); return { provider: 'resend', providerMessageId: `test-${sent.length}`, providerStatus: 'accepted' }; } },
  });
  return { sql, db, server, sent, now, drain: () => server.drainOpportunityNotificationDeliveries({ opportunityId: 'opportunity' }) };
}

test('reserved assessment and mixed notifications enqueue only the verified AEA recipient and send one consent-bounded notification', async t => {
  for (const scope of [['assessment'], ['assessment', 'solar']]) {
    const f = fixture(t, { scope });
    f.sql.exec('DELETE FROM trade_opportunity_notification_deliveries');
    assert.deepEqual(await f.server.ensureOpportunityNotificationDeliveries('opportunity'), { activeMatchCount: 1, deliveryCount: 1 });
    assert.deepEqual(await f.server.ensureOpportunityNotificationDeliveries('opportunity'), { activeMatchCount: 1, deliveryCount: 1 });
    assert.equal(f.sql.prepare('SELECT match_id FROM trade_opportunity_notification_deliveries').get().match_id, 'match-aea');
    assert.equal((await f.drain()).sent, 1); assert.equal(f.sent[0].recipient, 'aea@example.test');
    assert.doesNotMatch(f.sent[0].body, /private-customer@example|Private suburb/);
    assert.equal((await f.drain()).attempted, 0);
  }
});

test('pre-existing external matches never receive reserved data and ordinary service delivery is unchanged', async t => {
  const restricted = fixture(t); const result = await restricted.drain();
  assert.equal(result.sent, 1); assert.equal(result.skipped, 1); assert.deepEqual(restricted.sent.map(message => message.recipient), ['aea@example.test']);
  const ordinary = fixture(t, { scope: ['solar'] }); assert.equal((await ordinary.drain()).sent, 2);
});

test('draft, malformed scope, withdrawn consent, unavailable owner and revoked authority fail closed', async t => {
  for (const change of [
    "UPDATE trade_opportunities SET status='draft'",
    "UPDATE trade_opportunities SET service_categories='[\"assessment\",null]'",
    "UPDATE public_trade_lead_contact_releases SET withdrawn_at='2026-09-22T00:00:00Z'",
    "UPDATE public_trade_lead_contact_releases SET notice_version='unrecognised'",
    "UPDATE trade_accounts SET availability_status='paused' WHERE firebase_uid='aea'",
    "UPDATE trade_accounts SET service_states='[\"NSW\"]' WHERE firebase_uid='aea'",
    "UPDATE admin_users SET status='suspended' WHERE firebase_uid='aea'",
    "UPDATE admin_users SET role='reviewer' WHERE firebase_uid='aea'",
    "UPDATE trade_accounts SET account_status='closed' WHERE firebase_uid='aea'",
    "UPDATE trade_accounts SET abn='53004085616' WHERE firebase_uid='aea'",
    "UPDATE trade_account_verification_reviews SET decision='rejected' WHERE firebase_uid='aea'",
  ]) {
    const f = fixture(t); f.sql.exec(change); assert.equal((await f.drain()).sent, 0, change); assert.equal(f.sent.length, 0, change);
  }
});

test('final atomic send claim rechecks owner authority, customer consent and exact recipient after the context read', async t => {
  for (const change of [
    "UPDATE admin_users SET status='suspended' WHERE firebase_uid='aea'",
    "UPDATE trade_account_verification_reviews SET decision='rejected' WHERE firebase_uid='aea'",
    "UPDATE public_trade_lead_contact_releases SET withdrawn_at='2026-09-22T00:00:00Z'",
    "UPDATE trade_accounts SET email='different@example.test' WHERE firebase_uid='aea'",
    "UPDATE trade_opportunities SET status='draft'",
  ]) {
    const f = fixture(t); f.db.beforeClaim = () => f.sql.exec(change); await f.drain();
    assert.equal(f.sent.length, 0, change);
    assert.equal(f.sql.prepare("SELECT attempts FROM trade_opportunity_notification_deliveries WHERE match_id='match-aea'").get().attempts, 0, change);
  }
});

test('manual retry and recoverable zero-attempt skips remain owner scoped and consent bounded', async t => {
  const f = fixture(t); f.sql.exec("UPDATE trade_opportunity_notification_deliveries SET status='failed'");
  assert.deepEqual(await f.server.prepareOpportunityNotificationDeliveriesForManualRetry('opportunity'), { prepared: 1 });
  assert.equal(f.sql.prepare("SELECT status FROM trade_opportunity_notification_deliveries WHERE match_id='match-external'").get().status, 'failed');
  f.sql.exec("UPDATE trade_opportunity_notification_deliveries SET status='failed'; UPDATE admin_users SET status='suspended'");
  assert.deepEqual(await f.server.prepareOpportunityNotificationDeliveriesForManualRetry('opportunity'), { prepared: 0 });
  const recovered = fixture(t); recovered.sql.exec("UPDATE trade_opportunity_notification_deliveries SET status='skipped',eligibility_reason='Optional opportunity emails are disabled.'");
  assert.equal((await recovered.drain()).sent, 1); assert.deepEqual(recovered.sent.map(message => message.recipient), ['aea@example.test']);
  const withdrawn = fixture(t); withdrawn.sql.exec("UPDATE trade_opportunity_notification_deliveries SET status='skipped',eligibility_reason='Optional opportunity emails are disabled.'; UPDATE public_trade_lead_contact_releases SET withdrawn_at='2026-09-22T00:00:00Z'");
  assert.equal((await withdrawn.drain()).attempted, 0); assert.equal(withdrawn.sent.length, 0);
});
