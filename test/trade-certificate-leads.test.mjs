import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { certificateTestDependency, installCreditexTrainingFixture } from './helpers/creditex-training-fixture.mjs';

const { certificateLeadEligibilitySql, certificateLeadEligibleOwners } = certificateTestDependency('trade-certificate-leads');
function fixture() {
  const sql = new DatabaseSync(':memory:');
  installCreditexTrainingFixture(sql, { qualified: false });
  sql.exec(`INSERT INTO trade_accounts(firebase_uid,abn,business_name) VALUES ('owner','53004085616','Test Pty Ltd');
    INSERT INTO trade_team_members(id,owner_uid,member_uid,status) VALUES
      ('owner-member','owner','owner','active'),('worker','owner','worker-user','active');`);
  installCreditexTrainingFixture(sql);
  const predicate = certificateLeadEligibilitySql('lead.owner_uid', 'lead.categories', 'lead.state');
  return { sql, predicate, eligible(categories = ['heating-cooling'], state = 'VIC') {
    return Boolean(sql.prepare(`SELECT 1 FROM (SELECT ? owner_uid, ? categories, ? state) lead WHERE ${predicate}`)
      .get('owner', JSON.stringify(categories), state));
  } };
}
test('full catalogue lead predicate executes and requires every applicable programme course', () => {
  const f = fixture();
  try {
    assert.equal(f.eligible(), true);
    f.sql.prepare("DELETE FROM trade_training_completions WHERE member_id='worker' AND module_id='veu-6'").run();
    assert.equal(f.eligible(), false, 'other passed heating courses cannot replace activity 6');
  } finally { f.sql.close(); }
});
test('business approval, owner completion and current declared capability remain mandatory', () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE creditex_business_onboarding SET status='submitted'");
    assert.equal(f.eligible(), false);
    f.sql.exec("UPDATE creditex_business_onboarding SET status='approved'");
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE member_id='owner-member' AND module_id='veu-6'");
    assert.equal(f.eligible(), false);
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='' WHERE member_id='owner-member'");
    f.sql.exec("UPDATE trade_accounts SET capabilities='[\"hot-water\"]'");
    assert.equal(f.eligible(), false);
  } finally { f.sql.close(); }
});
test('unrelated jurisdictions and unrelated workers do not unlock or block an activity category', () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE module_id LIKE 'act-%' OR module_id LIKE 'sa-%'");
    assert.equal(f.eligible(), true);
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"hot-water\"]' WHERE id='worker'");
    f.sql.exec("DELETE FROM trade_training_completions WHERE member_id='worker' AND module_id='veu-6'");
    assert.equal(f.eligible(), true);
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"heating-cooling\"]' WHERE id='worker'");
    assert.equal(f.eligible(), false);
  } finally { f.sql.close(); }
});
test('review expiry, content drift and latest completion revocation block lead disclosure', () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE trade_training_module_reviews SET review_expires_on='2000-01-01' WHERE module_id='veu-6'");
    assert.equal(f.eligible(), false);
    f.sql.prepare("UPDATE trade_training_module_reviews SET review_expires_on='2099-12-31',content_hash=? WHERE module_id='veu-6'").run('f'.repeat(64));
    assert.equal(f.eligible(), false);
    const completion = f.sql.prepare("SELECT * FROM trade_training_completions WHERE module_id='veu-6' AND member_id='worker'").get();
    f.sql.prepare("UPDATE trade_training_module_reviews SET content_hash=? WHERE module_id='veu-6'").run(completion.content_hash);
    installCreditexTrainingFixture(f.sql);
    f.sql.exec(`UPDATE trade_training_completions SET passed_at='2098-01-01',revoked_at='2098-01-02'
      WHERE id=(SELECT id FROM trade_training_completions WHERE module_id='veu-6' AND member_id='worker' ORDER BY rowid DESC LIMIT 1)`);
    assert.equal(f.eligible(), false, 'an earlier unrevoked pass must not replace a later revoked completion');
  } finally { f.sql.close(); }
});
test('allocation predicate rechecks eligibility at the database mutation', () => {
  const f = fixture();
  try {
    assert.equal(f.eligible(), true);
    f.sql.exec("CREATE TABLE allocations(owner_uid TEXT); UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE module_id='veu-6'");
    const result = f.sql.prepare(`INSERT INTO allocations SELECT lead.owner_uid
      FROM (SELECT ? owner_uid, ? categories, ? state) lead WHERE ${f.predicate}`)
      .run('owner', '["heating-cooling"]', 'VIC');
    assert.equal(Number(result.changes), 0);
    assert.equal(f.eligible([]), false);
  } finally { f.sql.close(); }
});
test('SQL identifiers must be static qualified columns', () => {
  assert.throws(() => certificateLeadEligibilitySql('owner OR 1=1', 'lead.categories', 'lead.state'));
});

test('insulation leads require a qualified installer without treating a trained office owner as an onsite installer', () => {
  const f = fixture();
  try {
    assert.equal(f.eligible(['insulation']), false);
    f.sql.prepare('INSERT INTO trade_team_member_files VALUES (?,?,?,?,?,?)').run('credential-file','owner','worker','active','2099-12-31','training');
    f.sql.prepare('INSERT INTO trade_training_external_credentials VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('credential','owner','worker','veu-48','credential-file','EEC-CII','ESC-registration','2099-12-31','reviewer','Registers verified','','2026-09-18');
    assert.equal(f.eligible(['insulation']), true);
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE member_id='owner-member' AND module_id='veu-48'");
    assert.equal(f.eligible(['insulation']), false, 'the office owner still needs their quiz pass');
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='' WHERE member_id='owner-member'");
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"hot-water\"]' WHERE id='worker'");
    assert.equal(f.eligible(['insulation']), false, 'the credential holder must be within the insulation team');
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"insulation\"]' WHERE id='worker'");
    f.sql.exec("UPDATE trade_team_member_files SET status='deleted'");
    assert.equal(f.eligible(['insulation']), false, 'the credential evidence must remain current');
  } finally { f.sql.close(); }
});

test('bulk allocation checks are bounded and preserve live activity qualification', async () => {
  const f = fixture(); let queries = 0;
  try {
    const db = { prepare(query) { return { bind(state, rows) {
      assert.ok(JSON.parse(rows).length <= 100); queries += 1;
      return { async all() { return { results: f.sql.prepare(query).all(state, rows) }; } };
    } }; } };
    const candidates = Array.from({ length: 205 }, (_, index) => ({
      firebaseUid: index === 0 ? 'owner' : `unapproved-${index}`, matchedCategories: ['heating-cooling'],
    }));
    assert.deepEqual([...await certificateLeadEligibleOwners(db, candidates, 'VIC')], ['owner']);
    assert.equal(queries, 3);
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE module_id='veu-6'");
    assert.equal((await certificateLeadEligibleOwners(db, candidates.slice(0, 1), 'VIC')).size, 0);
  } finally { f.sql.close(); }
});
