import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PUBLIC_SITE } from '../src/lib/public-site.ts';
import { AEA_RESERVED_SERVICE_IDS } from '../src/lib/aea-service-identity.mjs';
import { certificateTestDependency, installAeaTradeOwnerFixtureSchema, installCreditexTrainingFixture } from './helpers/creditex-training-fixture.mjs';
import { expandCreditexLeadSql } from './helpers/creditex-training-sql.mjs';

const { aeaTradeOwnerSql, tradeOpportunityOwnerScopeSql, isAeaTradeOwner } = certificateTestDependency('aea-trade-owner-server');
const { verifiedTradeAccountPredicate } = certificateTestDependency('trade-access-server');
const { certificateLeadEligibilitySql } = certificateTestDependency('trade-certificate-leads');
const AEA_ABN = PUBLIC_SITE.abn.replace(/\D/g, '');
const OTHER_ABN = '53004085616';
const reviewedAt = '2026-09-22T00:00:00.000Z';

function database() { const db = new DatabaseSync(':memory:'); installAeaTradeOwnerFixtureSchema(db); return db; }
function insert(db, table, values) {
  const fields = Object.keys(values);
  db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...Object.values(values));
}
function approvedAccount(db, uid, { abn = AEA_ABN, account = {}, review = {}, admin = {} } = {}) {
  insert(db, 'trade_accounts', { firebase_uid: uid, abn, business_name: PUBLIC_SITE.legalName, partner_type: 'installer', account_status: 'active', verification_status: 'approved', verified_abn: abn,
    verification_review_id: `review-${uid}`, verification_reviewed_at: reviewedAt, verification_reviewed_by_uid: 'official-reviewer', ...account });
  if (review !== null) insert(db, 'trade_account_verification_reviews', { id: `review-${uid}`, firebase_uid: uid, abn, business_name: PUBLIC_SITE.legalName, partner_type: 'installer', decision: 'approved',
    review_method: 'official_abr_lookup', reviewed_by_uid: 'official-reviewer', reviewed_at: reviewedAt, ...review });
  if (admin !== null) insert(db, 'admin_users', { id: `admin-${uid}`, firebase_uid: uid, role: 'owner', status: 'active', ...admin });
}
const ownerAllowed = (db, uid) => Boolean(db.prepare(`SELECT ${aeaTradeOwnerSql('recipient.owner_uid')} allowed FROM (SELECT ? owner_uid) recipient`).get(uid).allowed);
function scopeAllowed(db, uid, categories, predicate = tradeOpportunityOwnerScopeSql('opportunity', 'recipient.owner_uid')) {
  return Boolean(db.prepare(`SELECT ${predicate} allowed FROM (SELECT ? owner_uid) recipient, (SELECT ? service_categories) opportunity`).get(uid, categories).allowed);
}
const adapter = db => ({ prepare(sql) { const statement = db.prepare(sql); return { bind(...bindings) { return { first: async () => statement.get(...bindings) || null }; } }; } });

test('AEA owner access requires the exact verified ABN and a bound active owner or admin identity', async () => {
  for (const role of ['owner', 'admin']) {
    const db = database(); approvedAccount(db, 'aea-owner', { admin: { role } });
    assert.equal(ownerAllowed(db, 'aea-owner'), true); assert.equal(await isAeaTradeOwner(adapter(db), 'aea-owner'), true);
    assert.equal(ownerAllowed(db, 'unknown-owner'), false); assert.equal(await isAeaTradeOwner(adapter(db), 'unknown-owner'), false); db.close();
  }
});

test('external trades, same-ABN accounts without a bound admin and other-ABN admins never receive AEA ownership', () => {
  const db = database();
  approvedAccount(db, 'external', { abn: OTHER_ABN, admin: null });
  approvedAccount(db, 'same-abn-unbound', { admin: null });
  approvedAccount(db, 'other-abn-admin', { abn: OTHER_ABN });
  approvedAccount(db, 'wrong-admin-binding', { admin: { firebase_uid: 'someone-else' } });
  for (const uid of ['external', 'same-abn-unbound', 'other-abn-admin', 'wrong-admin-binding']) assert.equal(ownerAllowed(db, uid), false, uid);
  db.close();
});

test('revoked identity, inactive accounts and stale or unofficial ABN reviews fail closed', () => {
  const denials = [
    ['revoked admin', { admin: { status: 'revoked' } }],
    ['support role', { admin: { role: 'support' } }],
    ['inactive trade', { account: { account_status: 'suspended' } }],
    ['supplier', { account: { partner_type: 'supplier' }, review: { partner_type: 'supplier' } }],
    ['pending verification', { account: { verification_status: 'under_review' } }],
    ['different verified ABN', { account: { verified_abn: OTHER_ABN } }],
    ['missing review', { review: null }],
    ['missing review pointer', { account: { verification_review_id: '' } }],
    ['old review pointer', { account: { verification_review_id: 'different-review' } }],
    ['changed business name', { account: { business_name: 'Changed legal entity' } }],
    ['wrong reviewed account', { review: { firebase_uid: 'someone-else' } }],
    ['wrong review ABN', { review: { abn: OTHER_ABN } }],
    ['rejected review', { review: { decision: 'rejected' } }],
    ['unofficial review', { review: { review_method: 'self_attested' } }],
    ['stale review time', { review: { reviewed_at: '2026-01-01T00:00:00.000Z' } }],
    ['stale reviewer', { review: { reviewed_by_uid: 'different-reviewer' } }],
    ['missing reviewer', { account: { verification_reviewed_by_uid: '' } }],
    ['missing approval date', { account: { verification_reviewed_at: '' } }],
  ];
  for (const [label, options] of denials) {
    const db = database(); approvedAccount(db, 'aea-owner', options);
    assert.equal(ownerAllowed(db, 'aea-owner'), false, label); db.close();
  }
});

test('the fixture executes the real ABN checksum and review SQL rather than a legacy approved flag', () => {
  const db = database();
  approvedAccount(db, 'valid'); approvedAccount(db, 'invalid', { abn: '73675233558' });
  const query = db.prepare(`SELECT ${verifiedTradeAccountPredicate('account')} approved FROM trade_accounts account WHERE account.firebase_uid=?`);
  assert.equal(query.get('valid').approved, 1); assert.equal(query.get('invalid').approved, 0);
  db.close();
});

test('all reserved and mixed service scopes require current AEA ownership and revocation takes effect immediately', () => {
  const db = database(); approvedAccount(db, 'aea-owner'); approvedAccount(db, 'external', { abn: OTHER_ABN, admin: null });
  for (const service of AEA_RESERVED_SERVICE_IDS) {
    for (const values of [[service], ['solar', service], [` ${service.toUpperCase()} `]]) {
      const categories = JSON.stringify(values);
      assert.equal(scopeAllowed(db, 'aea-owner', categories), true, categories);
      assert.equal(scopeAllowed(db, 'external', categories), false, categories);
    }
  }
  assert.equal(scopeAllowed(db, 'external', '["solar"]'), true, 'ordinary scope remains available to otherwise authorised trades');
  db.prepare("UPDATE admin_users SET status='revoked' WHERE firebase_uid='aea-owner'").run();
  assert.equal(scopeAllowed(db, 'aea-owner', JSON.stringify([AEA_RESERVED_SERVICE_IDS[0]])), false); db.close();
});

test('malformed or empty scopes are never authority, even for the verified AEA owner', () => {
  const db = database(); approvedAccount(db, 'aea-owner');
  const reserved = AEA_RESERVED_SERVICE_IDS[0];
  for (const categories of ['', '{', 'null', '{}', '[]', '[1]', '[""]', '[" "]', '["solar",null]', JSON.stringify([reserved, {}]), JSON.stringify([reserved, ''])]) {
    assert.equal(scopeAllowed(db, 'aea-owner', categories), false, categories);
    assert.equal(scopeAllowed(db, 'external', categories), false, categories);
  }
  db.close();
});

test('shared fixture migration is idempotent and never converts an ordinary approved fixture into an AEA owner', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY, partner_type TEXT, approved INTEGER); INSERT INTO trade_accounts VALUES ('ordinary','installer',1)");
  installCreditexTrainingFixture(db, { qualified: false }); installAeaTradeOwnerFixtureSchema(db);
  const account = db.prepare("SELECT * FROM trade_accounts WHERE firebase_uid='ordinary'").get();
  assert.equal(account.approved, 1); assert.equal(account.account_status, ''); assert.equal(account.verification_status, ''); assert.equal(account.verified_abn, '');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM admin_users').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM trade_account_verification_reviews').get().count, 0);
  db.prepare('UPDATE trade_accounts SET abn=? WHERE firebase_uid=?').run(AEA_ABN, 'ordinary');
  assert.equal(ownerAllowed(db, 'ordinary'), false); db.close();
});

test('shared source expansion retains real owner checks and rejects unsafe SQL identifiers', () => {
  const db = database(); approvedAccount(db, 'aea-owner');
  const sql = expandCreditexLeadSql('SELECT ${aeaTradeOwnerSql("recipient.owner_uid")} owner, ${tradeOpportunityOwnerScopeSql("opportunity", "recipient.owner_uid")} scope FROM (SELECT ? owner_uid) recipient, (SELECT ? service_categories) opportunity');
  assert.doesNotMatch(sql, /\$\{/); assert.match(sql, /trade_account_verification_reviews/);
  assert.deepEqual({ ...db.prepare(sql).get('aea-owner', JSON.stringify([AEA_RESERVED_SERVICE_IDS[0]])) }, { owner: 1, scope: 1 });
  for (const identifier of ['owner_uid', 'r.owner_uid OR 1=1', 'r.owner_uid;', 'r.owner_uid.other', 'r."owner_uid"']) assert.throws(() => aeaTradeOwnerSql(identifier), /static qualified SQL column/);
  assert.throws(() => tradeOpportunityOwnerScopeSql('o; SELECT 1', 'r.owner_uid'), /Invalid opportunity SQL alias/);
  db.close();
});

test('verified AEA reserved lead eligibility covers all Australian jurisdictions without a service-state gate', () => {
  const db = database();
  approvedAccount(db, 'aea-owner');
  approvedAccount(db, 'external', { abn: OTHER_ABN, admin: null });
  installCreditexTrainingFixture(db);
  db.exec(`UPDATE trade_accounts SET service_states='["VIC"]',address_state='VIC';
    UPDATE creditex_business_onboarding SET status='submitted' WHERE owner_uid='aea-owner'`);
  const states = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
  const predicate = certificateLeadEligibilitySql('lead.owner_uid', 'lead.categories', 'lead.state');
  const eligible = db.prepare(`SELECT 1 FROM (SELECT ? owner_uid, ? categories, ? state) lead WHERE ${predicate}`);
  for (const state of states) {
    for (const id of AEA_RESERVED_SERVICE_IDS) {
      assert.ok(eligible.get('aea-owner', JSON.stringify([id]), state), `${id} must reach verified AEA in ${state}`);
      assert.equal(eligible.get('external', JSON.stringify([id]), state), undefined, `${id} remains private to AEA in ${state}`);
    }
    assert.ok(eligible.get('aea-owner', '["assessment","solar"]', state), `mixed reserved scope remains with AEA in ${state}`);
  }
  db.exec("UPDATE admin_users SET status='suspended' WHERE firebase_uid='aea-owner'");
  for (const state of states) assert.equal(eligible.get('aea-owner', '["assessment"]', state), undefined, `current AEA authority remains mandatory in ${state}`);
  db.close();
});

test('ordinary lead eligibility retains declared state, service and business approval gates for every business', () => {
  const db = database();
  approvedAccount(db, 'aea-owner');
  approvedAccount(db, 'external', { abn: OTHER_ABN, admin: null });
  installCreditexTrainingFixture(db);
  db.exec(`UPDATE trade_accounts SET service_states='["VIC"]',address_state='VIC',capabilities='["heating-cooling"]'`);
  const predicate = certificateLeadEligibilitySql('lead.owner_uid', 'lead.categories', 'lead.state');
  const eligible = db.prepare(`SELECT 1 FROM (SELECT ? owner_uid, ? categories, ? state) lead WHERE ${predicate}`);
  for (const uid of ['aea-owner', 'external']) {
    for (const state of ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']) {
      assert.equal(Boolean(eligible.get(uid, '["heating-cooling"]', state)), state === 'VIC', `${uid} ordinary coverage remains limited to its saved state`);
    }
    assert.equal(eligible.get(uid, '["solar"]', 'VIC'), undefined, 'undeclared ordinary services stay ineligible');
  }
  db.exec("UPDATE creditex_business_onboarding SET status='submitted'");
  for (const uid of ['aea-owner', 'external']) assert.equal(eligible.get(uid, '["heating-cooling"]', 'VIC'), undefined, 'ordinary leads retain current business approval');
  db.close();
});
