import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { certificateTestDependency, installCreditexTrainingFixture } from './helpers/creditex-training-fixture.mjs';
import * as scope from '../src/lib/aea-trade-routing.mjs';
import { requiresAeaDelivery } from '../src/lib/aea-service-identity.mjs';
import { matchedServiceCategories } from '../src/lib/trade-service-matching.mjs';
import { closestQualifyingTradeServiceArea } from '../src/lib/trade-service-area-matching.mjs';
import { selectEveryQualifiedTradeRecipient } from '../src/lib/direct-trade-matching.mjs';
import { publicPlanContactReleaseAccessSql, PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE } from '../src/lib/public-plan-enquiry.mjs';

const source = fs.readFileSync(new URL('../src/lib/opportunity-server.ts', import.meta.url), 'utf8');
const allocationCode = ts.transpileModule(source.slice(source.indexOf('export function qualifyingServiceArea(')), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(categories = ['assessment']) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY, business_name TEXT, postcode TEXT,
    service_base_postcode TEXT, service_radius_km INTEGER, service_states TEXT, capabilities TEXT,
    availability_status TEXT, is_synthetic INTEGER);
    CREATE TABLE trade_account_service_areas(firebase_uid TEXT, postcode TEXT, radius_km INTEGER, record_status TEXT);
    CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY, title TEXT, postcode TEXT, state TEXT, service_categories TEXT,
      status TEXT, expires_at TEXT, is_synthetic INTEGER, source_reference TEXT, updated_at TEXT);
    CREATE TABLE trade_opportunity_matches(id TEXT PRIMARY KEY, opportunity_id TEXT, firebase_uid TEXT, status TEXT,
      admin_note TEXT, partner_note TEXT, matched_categories TEXT, distance_metres INTEGER, allocation_rank INTEGER,
      match_source TEXT, contact_attempt_count INTEGER, last_contact_at TEXT, connected_at TEXT, matched_by_uid TEXT,
      matched_at TEXT, updated_at TEXT, UNIQUE(opportunity_id, firebase_uid));
    CREATE TABLE public_trade_lead_contact_releases(opportunity_id TEXT, source_reference TEXT, postcode TEXT,
      status TEXT, withdrawn_at TEXT, granted_at TEXT, notice_version TEXT, consent_purpose TEXT,
      disclosed_fields TEXT, customer_email TEXT);
    INSERT INTO trade_accounts VALUES ('aea','Australian Energy Assessments','3000','3000',50,'["VIC"]','["solar"]','open',0);
    INSERT INTO trade_accounts VALUES ('other','External trade','3000','3000',50,'["VIC"]','["solar","assessment"]','open',0);`);
  installCreditexTrainingFixture(sql, { qualified: false });
  for (const uid of ['aea', 'other']) {
    const abn = uid === 'aea' ? '73675233557' : '53004085616';
    sql.prepare(`UPDATE trade_accounts SET abn=?, partner_type='installer', account_status='active', verification_status='approved',
      verified_abn=?, verification_review_id=?, verification_reviewed_at='2026-09-01', verification_reviewed_by_uid='reviewer' WHERE firebase_uid=?`)
      .run(abn, abn, `review-${uid}`, uid);
    sql.prepare(`INSERT INTO trade_account_verification_reviews(id,firebase_uid,abn,business_name,partner_type,decision,review_method,reviewed_by_uid,reviewed_at)
      SELECT verification_review_id,firebase_uid,abn,business_name,partner_type,'approved','official_abr_lookup',verification_reviewed_by_uid,verification_reviewed_at
      FROM trade_accounts WHERE firebase_uid=?`).run(uid);
  }
  sql.exec("INSERT INTO admin_users(id,firebase_uid,status,role) VALUES ('admin','aea','active','owner')");
  sql.prepare("INSERT INTO trade_opportunities VALUES ('lead','Energy assessment','3000','VIC',?,'draft','2099-01-01',0,'AEA-test','2026-09-01')").run(JSON.stringify(categories));
  sql.prepare("INSERT INTO public_trade_lead_contact_releases VALUES ('lead','AEA-test','3000','active','','2026-09-01',?,?,?,?)")
    .run(PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE, '["customer_email","postcode","service_categories"]', 'test@example.test');
  const db = {
    prepare(query) {
      let bindings = [];
      return { bind(...values) { bindings = values; return this; },
        async first() { return sql.prepare(query).get(...bindings) || null; },
        async all() { return { results: sql.prepare(query).all(...bindings) }; },
        async run() { return { meta: sql.prepare(query).run(...bindings) }; } };
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
  const dependencies = {
    ...scope, ...certificateTestDependency('aea-trade-owner-server'), ...certificateTestDependency('trade-access-server'),
    ...certificateTestDependency('trade-certificate-leads'),
    requiresAeaDelivery, matchedServiceCategories, closestQualifyingTradeServiceArea, selectEveryQualifiedTradeRecipient,
    publicPlanContactReleaseAccessSql,
    parseJsonList: value => JSON.parse(value || '[]'), canonicalMarketplaceState: value => value,
    postcodeDistanceKm: (from, to) => from === to ? 0 : 1000,
    getD1: () => db, expireStaleOpportunities: async () => {},
    syncMarketplaceEnquiries: async () => {}, ensureOpportunityNotificationDeliveries: async () => {},
    ACTIVE_MATCH_STATUSES: new Set(['offered','viewed','interested','connected']), D1_ALLOCATION_WRITE_BATCH_SIZE: 50,
  };
  const loaded = { exports: {} };
  new Function('exports', ...Object.keys(dependencies), allocationCode)(loaded.exports, ...Object.values(dependencies));
  return { sql, ...loaded.exports };
}

test('retained assessment and mixed scope route only to verified AEA and replay exactly once', async () => {
  for (const categories of [['assessment'], ['solar','assessment']]) {
    const f = fixture(categories);
    try {
      const first = await f.routeAeaServiceOpportunity('lead','admin');
      assert.equal(first.allocated.length,1);
      assert.deepEqual(first.allocated[0].matchedCategories,categories);
      assert.equal(first.allocated[0].firebaseUid,'aea');
      assert.equal(f.sql.prepare("SELECT status FROM trade_opportunities").get().status,'open');
      assert.equal((await f.routeAeaServiceOpportunity('lead','admin')).allocated.length,0);
      assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_opportunity_matches").get().count,1);
    } finally { f.sql.close(); }
  }
});

test('reserved draft remains held when consent, AEA authority, availability, area or data partition is wrong', async () => {
  for (const change of [
    "UPDATE public_trade_lead_contact_releases SET withdrawn_at='2026-09-02'",
    "UPDATE public_trade_lead_contact_releases SET source_reference='different'",
    "UPDATE public_trade_lead_contact_releases SET disclosed_fields='[]'",
    "DELETE FROM admin_users",
    "UPDATE trade_account_verification_reviews SET decision='rejected'",
    "UPDATE trade_accounts SET availability_status='closed' WHERE firebase_uid='aea'",
    "UPDATE trade_accounts SET service_states='[\"NSW\"]' WHERE firebase_uid='aea'",
    "UPDATE trade_accounts SET service_base_postcode='2000' WHERE firebase_uid='aea'",
    "UPDATE trade_accounts SET is_synthetic=1 WHERE firebase_uid='aea'",
    "UPDATE trade_opportunities SET expires_at='2000-01-01'",
  ]) {
    const f = fixture();
    try {
      f.sql.exec(change);
      assert.equal((await f.routeAeaServiceOpportunity('lead','admin')).allocated.length,0,change);
      assert.equal(f.sql.prepare('SELECT status FROM trade_opportunities').get().status,'draft',change);
      assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_opportunity_matches').get().count,0,change);
    } finally { f.sql.close(); }
  }
});

test('AEA recovery does not open ordinary drafts or paused/closed enquiries', async () => {
  for (const [categories,status] of [[['solar'],'draft'],[['solar'],'open'],[['assessment'],'paused'],[['assessment'],'closed']]) {
    const f = fixture(categories);
    try {
      f.sql.prepare('UPDATE trade_opportunities SET status=?').run(status);
      await assert.rejects(f.routeAeaServiceOpportunity('lead','admin'), categories.includes('assessment') ? /OPPORTUNITY_NOT_OPEN/ : /AEA_SERVICE_REQUIRED/);
      assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_opportunity_matches').get().count,0);
    } finally { f.sql.close(); }
  }
});
