import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { Miniflare } from 'miniflare';
import { certificateTestDependency, installCreditexTrainingFixture } from './helpers/creditex-training-fixture.mjs';
import * as routing from '../src/lib/aea-trade-routing.mjs';
import * as publicSite from '../src/lib/public-site.ts';
import * as tradeAbn from '../src/lib/trade-abn.ts';
import * as notices from '../src/lib/public-plan-enquiry.mjs';
import * as quickNotices from '../src/lib/quick-upgrade-enquiry.mjs';
import * as locality from '../src/lib/customer-matching-locality.mjs';
import * as notifications from '../src/lib/opportunity-notifications.ts';
import { aeaServiceContactConsentAllows } from '../src/lib/public-trade-lead-access.mjs';

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
const access = load('trade-access-server', { '../../db': {}, './firebase-server': {}, './creditex-schema-guards': {}, './trade-abn': {}, './trade-mfa-server': certificateTestDependency('./trade-mfa-server') });
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
    CREATE TABLE customer_project_evidence(id TEXT,project_id TEXT,customer_uid TEXT,status TEXT,sharing_scope TEXT);`);
  sql.exec(fs.readFileSync('drizzle/0087_trade_opportunity_notifications.sql', 'utf8'));
  const now = new Date().toISOString();
  for (const [uid, abn, name] of [['aea', publicSite.PUBLIC_SITE.abn.replace(/\D/g, ''), publicSite.PUBLIC_SITE.legalName], ['external', '53004085616', 'External Solar']]) {
    sql.prepare('INSERT INTO trade_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid, `${uid}@example.test`, name, abn, 'installer', 'active', 'approved', abn, `${uid}-review`, now, 'reviewer', now, 0, 'open', '["assessment","solar"]');
    sql.prepare('INSERT INTO trade_account_verification_reviews VALUES (?,?,?,?,?,?,?,?,?)').run(`${uid}-review`, uid, abn, name, 'installer', 'approved', 'official_abr_lookup', 'reviewer', now);
  }
  // Real onboarding/jurisdiction views matter: D1 expands them when compiling
  // notification guards, which contributes to its 100-level expression limit.
  installCreditexTrainingFixture(sql, { qualified: false });
  for (const uid of ['aea', 'external']) {
    sql.prepare("INSERT INTO trade_team_members(id,owner_uid,member_uid,status) VALUES (?,?,?,'active')").run(`owner-${uid}`, uid, uid);
    sql.prepare(`INSERT INTO creditex_business_onboarding
      (owner_uid,status,revision,application_json,business_abn,business_name,insurance_expires_on,agreement_reference,reviewed_by_uid,reviewed_at,updated_at)
      SELECT firebase_uid,'approved',1,'{}',abn,business_name,'2099-12-31','test-agreement','test-reviewer',?,?
      FROM trade_accounts WHERE firebase_uid=?`).run(now, now, uid);
  }
  sql.exec("INSERT INTO admin_users VALUES ('aea','active','owner')");
  sql.prepare('INSERT INTO trade_opportunities VALUES (?,?,?,?,?,?,?,?,?,?)').run('opportunity', JSON.stringify(scope), 'Private suburb', '3000', 'VIC', 'planning', '2099-01-01T00:00:00.000Z', now, status, 'public-enquiry');
  sql.prepare('INSERT INTO public_trade_lead_contact_releases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('release', 'opportunity', 'active', notices.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, notices.PUBLIC_PLAN_CONSENT_PURPOSE, '["customer_email","postcode","service_categories"]', 'Private', 'Customer', '', '', '', '3000', '', 'private-customer@example.test', '0412345678', now, '');
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
    '@/lib/public-trade-lead-access.mjs': { aeaServiceContactConsentAllows },
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

function quickReceipt(f, { shareEmail = false, current = false } = {}) {
  f.sql.prepare(`UPDATE public_trade_lead_contact_releases SET notice_version=?, consent_purpose=?,
    disclosed_fields=?, customer_street_address='10 Private Street', customer_suburb='Melbourne', customer_address_state='VIC'`)
    .run(current ? quickNotices.QUICK_UPGRADE_CONSENT_NOTICE_VERSION : quickNotices.AEA_SERVICE_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
      current ? quickNotices.QUICK_UPGRADE_CONSENT_PURPOSE : quickNotices.AEA_SERVICE_QUICK_UPGRADE_CONSENT_PURPOSE,
      JSON.stringify(['postcode', 'service_categories', 'customer_address', ...(shareEmail ? ['customer_email'] : [])]));
}

test('quick notification requires deliverable email consent and preserves AEA v3 handling', async t => {
  for (const current of [false, true]) {
    const aea = fixture(t); quickReceipt(aea, { current, shareEmail: current });
    assert.equal((await aea.drain()).sent, 1);
    assert.deepEqual(aea.sent.map(message => message.recipient), ['aea@example.test']);
    assert.match(aea.sent[0].body, /No home plan or PDF was created/);
    assert.doesNotMatch(aea.sent[0].body, /private-customer@example|0412345678|10 Private Street|Private Customer/);
  }
  const withheld = fixture(t, { scope: ['solar'] }); quickReceipt(withheld);
  assert.equal((await withheld.drain()).sent, 0);
  assert.equal(withheld.sent.length, 0);
  const shared = fixture(t, { scope: ['solar'] }); quickReceipt(shared, { shareEmail: true });
  assert.equal((await shared.drain()).sent, 2);
});

test('AEA quick notification rejects incomplete retained contact and changed sharing at final claim', async t => {
  for (const field of ['customer_first_name', 'customer_last_name', 'customer_email', 'customer_phone']) {
    const f = fixture(t); quickReceipt(f);
    f.sql.exec(`UPDATE public_trade_lead_contact_releases SET ${field}=''`);
    assert.equal((await f.drain()).sent, 0, field);
  }
  const changed = fixture(t, { scope: ['solar'] }); quickReceipt(changed, { shareEmail: true });
  changed.db.beforeClaim = () => quickReceipt(changed);
  assert.equal((await changed.drain()).sent, 0);
  assert.equal(changed.sent.length, 0);
  const removedPhone = fixture(t); quickReceipt(removedPhone);
  removedPhone.db.beforeClaim = () => removedPhone.sql.exec("UPDATE public_trade_lead_contact_releases SET customer_phone=''");
  assert.equal((await removedPhone.drain()).sent, 0);
  assert.equal(removedPhone.sent.length, 0);
  const changedScope = fixture(t); quickReceipt(changedScope);
  changedScope.db.beforeClaim = () => changedScope.sql.exec("UPDATE trade_opportunities SET service_categories='[\"solar\"]'");
  assert.equal((await changedScope.drain()).sent, 0);
  assert.equal(changedScope.sent.length, 0);
});

test('pre-existing external matches never receive reserved data and ordinary service delivery is unchanged', async t => {
  const restricted = fixture(t); const result = await restricted.drain();
  assert.equal(result.sent, 1); assert.equal(result.skipped, 1); assert.deepEqual(restricted.sent.map(message => message.recipient), ['aea@example.test']);
  const ordinary = fixture(t, { scope: ['solar'] }); assert.equal((await ordinary.drain()).sent, 2);
});

test('verified AEA receives reserved enquiries nationwide without exposing them to external trades', async t => {
  const f = fixture(t);
  f.sql.exec("UPDATE trade_accounts SET service_states='[\"NSW\"]' WHERE firebase_uid='aea'");
  const result = await f.drain();
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(f.sent.map(message => message.recipient), ['aea@example.test']);
});

test('draft, malformed scope, withdrawn consent, unavailable owner and revoked authority fail closed', async t => {
  for (const change of [
    "UPDATE trade_opportunities SET status='draft'",
    "UPDATE trade_opportunities SET service_categories='[\"assessment\",null]'",
    "UPDATE public_trade_lead_contact_releases SET withdrawn_at='2026-09-22T00:00:00Z'",
    "UPDATE public_trade_lead_contact_releases SET notice_version='unrecognised'",
    "UPDATE trade_accounts SET availability_status='paused' WHERE firebase_uid='aea'",
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

test('Cloudflare D1 compiles and executes notification recovery, context and atomic claims with real eligibility views', async t => {
  const f = fixture(t);
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };',
    compatibilityDate: '2026-05-22', d1Databases: { DB: 'notification-depth-check' } });
  t.after(() => runtime.dispose());
  const d1 = await runtime.getD1Database('DB');
  const schema = f.sql.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  for (const row of schema.filter(row => row.type === 'table')) await d1.prepare(row.sql).run();
  for (const table of schema.filter(row => row.type === 'table')) {
    const identifier = `"${table.name.replaceAll('"', '""')}"`;
    for (const row of f.sql.prepare(`SELECT * FROM ${identifier}`).all()) {
      const columns = Object.keys(row).map(name => `"${name.replaceAll('"', '""')}"`).join(',');
      await d1.prepare(`INSERT INTO ${identifier} (${columns}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
    }
  }
  for (const row of schema.filter(row => row.type !== 'table')) await d1.prepare(row.sql).run();
  const runtimeStatement = (query, native = d1.prepare(query)) => ({
    native,
    bind: (...values) => runtimeStatement(query, native.bind(...values)),
    first: () => native.first(), all: () => native.all(),
    run: async () => {
      if (query.includes("SET status = 'sending'")) {
        const hook = f.db.beforeClaim; f.db.beforeClaim = null; await hook?.();
      }
      return native.run();
    },
  });
  f.db.prepare = query => runtimeStatement(query);
  f.db.batch = statements => d1.batch(statements.map(statement => statement.native));
  await d1.prepare('UPDATE trade_accounts SET service_states=? WHERE firebase_uid=?').bind('["NSW"]', 'aea').run();
  await d1.prepare('DELETE FROM trade_opportunity_notification_deliveries').run();
  assert.deepEqual(await f.server.ensureOpportunityNotificationDeliveries('opportunity'), { activeMatchCount: 1, deliveryCount: 1 });
  await d1.prepare("UPDATE trade_opportunity_notification_deliveries SET status='skipped',eligibility_reason='Optional opportunity emails are disabled.'").run();
  assert.equal((await f.drain()).sent, 1);
  assert.deepEqual(f.sent.map(message => message.recipient), ['aea@example.test']);
  await d1.prepare("UPDATE trade_opportunity_notification_deliveries SET status='failed'").run();
  assert.deepEqual(await f.server.prepareOpportunityNotificationDeliveriesForManualRetry('opportunity'), { prepared: 1 });
  await d1.prepare("UPDATE admin_users SET status='suspended'").run();
  assert.equal((await f.drain()).sent, 0);
  assert.equal(f.sent.length, 1);

  await d1.prepare("UPDATE admin_users SET status='active'").run();
  await d1.prepare('UPDATE trade_accounts SET service_states=? WHERE firebase_uid=?').bind('["VIC"]', 'aea').run();
  await d1.prepare('UPDATE trade_opportunities SET service_categories=?').bind('["solar"]').run();
  await d1.prepare('UPDATE trade_opportunity_matches SET matched_categories=?').bind('["solar"]').run();
  await d1.prepare('DELETE FROM trade_opportunity_notification_deliveries').run();
  assert.deepEqual(await f.server.ensureOpportunityNotificationDeliveries('opportunity'), { activeMatchCount: 2, deliveryCount: 2 });
  assert.equal((await f.drain()).sent, 2);
  assert.equal(f.sent.length, 3);

  await d1.prepare('UPDATE trade_opportunities SET service_categories=?').bind('["assessment","solar"]').run();
  await d1.prepare('UPDATE trade_opportunity_matches SET matched_categories=?').bind('["assessment","solar"]').run();
  for (const [revoke, restore] of [
    ["UPDATE admin_users SET status='suspended'", "UPDATE admin_users SET status='active'"],
    ["UPDATE trade_account_verification_reviews SET decision='rejected' WHERE firebase_uid='aea'", "UPDATE trade_account_verification_reviews SET decision='approved' WHERE firebase_uid='aea'"],
    ["UPDATE public_trade_lead_contact_releases SET withdrawn_at='2026-09-22T00:00:00Z'", "UPDATE public_trade_lead_contact_releases SET withdrawn_at=''"],
    ["UPDATE trade_accounts SET email='changed@example.test' WHERE firebase_uid='aea'", "UPDATE trade_accounts SET email='aea@example.test' WHERE firebase_uid='aea'"],
    ["UPDATE trade_opportunities SET status='draft'", "UPDATE trade_opportunities SET status='open'"],
  ]) {
    await d1.prepare('DELETE FROM trade_opportunity_notification_deliveries').run();
    await f.server.ensureOpportunityNotificationDeliveries('opportunity');
    f.db.beforeClaim = () => d1.prepare(revoke).run();
    assert.equal((await f.drain()).sent, 0, revoke);
    assert.equal((await d1.prepare("SELECT attempts FROM trade_opportunity_notification_deliveries WHERE match_id='match-aea'").first()).attempts, 0, revoke);
    await d1.prepare(restore).run();
  }
  assert.equal(f.sent.length, 3);
});
