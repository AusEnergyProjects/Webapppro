import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as entitlements from '../src/lib/direct-trade-entitlements.ts';
import * as postcodes from '../src/lib/australian-postcodes.mjs';
import * as googleProfile from '../src/lib/trade-google-business-profile.mjs';
import { certificateTestDependency } from './helpers/creditex-training-fixture.mjs';
import { migratedDataforceSqlite } from './helpers/trade-dataforce-database.mjs';

const output = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/trade-profile/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const reviewTime = '2026-10-08T02:00:00.000Z';
const ordinaryAccount = { firebase_uid: 'business-owner', email: 'owner@fixture.invalid', business_name: 'Fixture Trade Pty Ltd',
  contact_name: 'Fixture Owner', abn: '53004085616', verified_abn: '53004085616', partner_type: 'installer', account_status: 'active',
  verification_status: 'approved', verification_review_id: 'review-owner', verification_reviewed_at: reviewTime,
  verification_reviewed_by_uid: 'reviewer', consent_version: 'fixture', consent_at: reviewTime, created_at: reviewTime, updated_at: reviewTime };

function insert(database, table, row) {
  const fields = Object.keys(row);
  database.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...fields.map(field => row[field]));
}
function setup(t, { account = {}, review = {}, missingReview = false, emailVerified = true, identityError } = {}) {
  const { sqlite } = migratedDataforceSqlite(); t.after(() => sqlite.close());
  const savedAccount = { ...ordinaryAccount, ...account };
  insert(sqlite, 'trade_accounts', savedAccount);
  if (!missingReview) insert(sqlite, 'trade_account_verification_reviews', { id: savedAccount.verification_review_id || 'unbound-review',
    firebase_uid: savedAccount.firebase_uid, abn: savedAccount.verified_abn, business_name: savedAccount.business_name,
    partner_type: savedAccount.partner_type, legal_entity_name: savedAccount.business_name, decision: 'approved', review_method: 'official_abr_lookup',
    source_reference: 'https://abr.business.gov.au/ABN/View?abn=53004085616', note: 'Synthetic reviewed fixture', reviewed_by_uid: 'reviewer', reviewed_at: reviewTime, ...review });
  const calls = [];
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { calls.push({ sql: this.sql, values: this.values }); return sqlite.prepare(this.sql).get(...this.values) || null; }
    async all() { calls.push({ sql: this.sql, values: this.values }); return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    async run() { throw new Error('Profile GET must never mutate records.'); }
  }
  const binding = { prepare: sql => new Statement(sql), batch: async () => { throw new Error('Profile GET must never mutate records.'); } };
  const identity = { uid: savedAccount.firebase_uid, email: savedAccount.email, emailVerified, authTime: 1, signInProvider: 'password' };
  const dependencies = {
    '../../../../db': { getD1: () => binding },
    '@/lib/firebase-server': { requireFirebaseIdentity: async () => { if (identityError) throw identityError; return identity; } },
    '@/lib/postcode-distance': { postcodeCoordinate: () => { throw new Error('Not used by profile GET.'); } },
    '@/lib/admin-notifications': { adminNotificationStatement: () => { throw new Error('Profile GET must not notify.'); } },
    '@/lib/direct-trade-entitlements': entitlements,
    '@/lib/australian-postcodes.mjs': postcodes,
    '@/lib/trade-google-business-profile.mjs': googleProfile,
  };
  const moduleRecord = { exports: {} };
  new Function('require', 'module', 'exports', output)(specifier => {
    const dependency = dependencies[specifier] || certificateTestDependency(specifier);
    assert.ok(dependency, `Unknown dependency ${specifier}`); return dependency;
  }, moduleRecord, moduleRecord.exports);
  const get = headers => moduleRecord.exports.GET(new Request('https://fixture.invalid/api/trade-profile', { headers }));
  return { sqlite, get, calls, identity, savedAccount };
}

for (const businessApproved of [true, false]) for (const emailVerified of [true, false]) {
  test(`profile GET separates business approval ${businessApproved} from email verification ${emailVerified}`, async t => {
    const f = setup(t, { emailVerified, missingReview: !businessApproved });
    const before = f.sqlite.prepare('SELECT * FROM trade_accounts').all();
    const response = await f.get(); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { profile } = await response.json();
    assert.equal(profile.businessApprovalApproved, businessApproved);
    assert.equal(profile.emailVerified, emailVerified);
    assert.equal(profile.accessApproved, businessApproved && emailVerified);
    assert.deepEqual(profile.entitlements, entitlements.resolveEntitlements('installer', businessApproved && emailVerified));
    assert.deepEqual(f.calls.map(call => call.values), [['business-owner'], ['business-owner']]);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM trade_accounts').all(), before);
  });
}

for (const [name, options] of [
  ['checksum-invalid ABN', { account: { abn: '53004085617', verified_abn: '53004085617' } }],
  ['suspended account', { account: { account_status: 'suspended' } }],
  ['under-review account', { account: { verification_status: 'under_review' } }],
  ['mismatched verified ABN', { account: { verified_abn: '51824753556' } }],
  ['unbound review ID', { account: { verification_review_id: '' } }],
  ['review for another identity', { review: { firebase_uid: 'another-owner' } }],
  ['review for another business name', { review: { business_name: 'Another business Pty Ltd' } }],
  ['review without official ABR method', { review: { review_method: 'other_evidence' } }],
  ['reviewer mismatch', { review: { reviewed_by_uid: 'another-reviewer' } }],
]) test(`profile projection never treats ${name} as approved`, async t => {
  const f = setup(t, options), response = await f.get();
  assert.equal(response.status, 200);
  const { profile } = await response.json();
  assert.equal(profile.businessApprovalApproved, false); assert.equal(profile.emailVerified, true);
  assert.equal(profile.accessApproved, false); assert.deepEqual(profile.entitlements, entitlements.resolveEntitlements('installer', false));
});

test('fresh identity verification changes only the email projection and gated access', async t => {
  const f = setup(t, { emailVerified: false });
  assert.equal((await (await f.get()).json()).profile.accessApproved, false);
  f.identity.emailVerified = true;
  const { profile } = await (await f.get()).json();
  assert.equal(profile.businessApprovalApproved, true); assert.equal(profile.emailVerified, true); assert.equal(profile.accessApproved, true);
});

test('owner profile cannot project an employer account selected by a team member', async t => {
  const f = setup(t);
  const response = await f.get({ 'X-TLink-Business': 'employer-owner' });
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'BUSINESS_OWNER_CONTEXT_REQUIRED');
  assert.deepEqual(f.calls, []);
});

test('missing own profile is not replaced by another approved business', async t => {
  const f = setup(t); f.identity.uid = 'invited-team-member';
  const response = await f.get(); assert.equal(response.status, 200); assert.equal((await response.json()).profile, null);
  assert.deepEqual(f.calls.map(call => call.values), [['invited-team-member']]);
});

test('cross-origin and unauthenticated profile reads disclose no approval', async t => {
  const f = setup(t, { identityError: new Error('AUTH_REQUIRED') });
  assert.equal((await f.get({ origin: 'https://other.invalid' })).status, 403);
  assert.equal((await f.get()).status, 401); assert.deepEqual(f.calls, []);
});
