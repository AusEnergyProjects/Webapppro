import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCouncilEnquiries } from '../src/lib/council-enquiries-server.ts';
import { migratedDataforceD1 } from './helpers/trade-dataforce-database.mjs';

const now = new Date('2026-10-08T02:00:00Z');
const postcodes = '3169,3172,3182,3183,3184,3186,3187,3188,3189,3190,3191,3192,3193,3194,3195,3196,3197,3202,3205,3206,3207,3804,3805,3806,3807,3808,3809,3810,3812,3813,3814,3815,3910,3911,3912,3913,3915,3916,3918,3919,3922,3925,3926,3927,3928,3929,3930,3931,3933,3934,3936,3939,3940,3941,3942,3943,3944,3953,3956,3959,3975,3976,3977,3978,3979,3980,3981,3984,3991,3992,3995,3996'.split(',');
const scope = { councilId: 'fixture-council', name: 'Synthetic council', state: 'VIC', postcodes, period: 'year' };

test('council enquiry aggregates preserve both privacy dimensions within actual D1 SQL limits', async t => {
  const runtime = await migratedDataforceD1();
  t.after(() => runtime.close());
  const db = runtime.db;
  const add = async (id, { sector = 'unclassified', postcode = '3169', date = '2026-10-02T02:00:00Z' } = {}) => {
    await db.batch([
      db.prepare(`INSERT INTO trade_opportunities
        (id,title,project_type,postcode,state,summary,created_by_uid,created_at,updated_at,source_reference,customer_sector)
        VALUES (?,'Synthetic enquiry','residential',?,'VIC','','lead-intake',?,?,?,?)`).bind(id, postcode, date, date, id, sector),
      db.prepare(`INSERT INTO public_trade_lead_contact_releases
        (id,opportunity_id,source_reference,notice_version,consent_purpose,customer_name,customer_email,postcode,granted_at,created_at,updated_at)
        VALUES (?,?,?,'synthetic-notice','synthetic-purpose','Synthetic person',?,?,?,?,?)`).bind(`release-${id}`, id, id, `${id}@example.invalid`, postcode, date, date, date),
    ]);
  };

  await t.test('empty one, ten and 72-postcode scopes execute for every fixed period', async () => {
    for (const size of [1, 10, 72]) for (const period of ['quarter', 'year', 'all']) {
      const report = await loadCouncilEnquiries(db, { ...scope, postcodes: postcodes.slice(0, size), period }, now);
      assert.equal(report.total, 0);
      assert.equal(report.suppressed, false);
      assert.deepEqual(report.sectors.rows.map(row => row.count), [0, 0, 0]);
    }
  });

  await t.test('safe recorded sectors reconcile across current and older privacy bands', async () => {
    for (const sector of ['business', 'residential', 'unclassified']) for (let index = 0; index < 5; index++) {
      await add(`${sector}-${index}`, { sector });
    }
    for (let index = 0; index < 5; index++) await add(`older-business-${index}`, { sector: 'business', date: '2025-09-02T02:00:00Z' });
    for (const period of ['quarter', 'year', 'all']) {
      const report = await loadCouncilEnquiries(db, { ...scope, period }, now);
      assert.equal(report.total, period === 'all' ? 20 : 15);
      assert.equal(report.suppressed, false);
      assert.equal(report.sectors.suppressed, false);
      assert.deepEqual(report.sectors.rows.map(row => row.count), period === 'all' ? [10, 5, 5] : [5, 5, 5]);
      assert.doesNotMatch(JSON.stringify(report), /@example\.invalid|Synthetic person|release-/);
    }
  });

  await t.test('a small sector intersection still hides sectors when the combined cell is safe', async () => {
    for (let index = 0; index < 5; index++) await add(`september-residential-${index}`, { sector: 'residential', date: '2026-09-02T02:00:00Z' });
    await add('september-small-business', { sector: 'business', date: '2026-09-02T02:00:00Z' });
    const report = await loadCouncilEnquiries(db, scope, now);
    assert.equal(report.total, 21);
    assert.equal(report.suppressed, false);
    assert.equal(report.sectors.suppressed, true);
    assert.ok(report.sectors.rows.every(row => row.count === null));
  });

  await t.test('a small older postcode complement still hides the complete aggregate family', async () => {
    await add('old-small-postcode', { postcode: '3172', date: '2024-05-02T02:00:00Z' });
    for (const period of ['quarter', 'year', 'all']) {
      const report = await loadCouncilEnquiries(db, { ...scope, period }, now);
      assert.equal(report.total, null);
      assert.equal(report.suppressed, true);
      assert.deepEqual(report.trend, []);
      assert.ok(report.postcodes.every(row => row.count === null));
      assert.ok(report.sectors.rows.every(row => row.count === null));
    }
  });
});
