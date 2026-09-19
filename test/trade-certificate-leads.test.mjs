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
test('untrained owners and field members can receive leads before passing activity training', () => {
  const f = fixture();
  try {
    assert.equal(f.eligible(), true);
    f.sql.exec('DELETE FROM trade_training_completions; DELETE FROM trade_training_attempts; DELETE FROM trade_training_module_reviews');
    assert.equal(f.eligible(), true, 'learning completion is required for booking, not lead receipt');
  } finally { f.sql.close(); }
});
test('staff service selections and missing personal training do not prevent business lead receipt', () => {
  const f = fixture();
  try {
    f.sql.exec("INSERT INTO trade_team_members(id,owner_uid,member_uid,status,capabilities) VALUES ('office','owner','office-user','active','[]')");
    assert.equal(f.eligible(), true, 'an office-only member has no installation training requirement');
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"heating-cooling\"]' WHERE id='office'");
    assert.equal(f.eligible(), true, 'declaring on-site work does not withhold incoming leads while training is unfinished');
    f.sql.exec("UPDATE trade_team_members SET capabilities='[]' WHERE id='office'");
    assert.equal(f.eligible(), true, 'returning to office-only work removes the installation requirement');
    f.sql.exec("DELETE FROM trade_training_completions WHERE member_id='worker' AND module_id='veu-6'");
    assert.equal(f.eligible(), true, 'an untrained technician is checked separately before booking');
  } finally { f.sql.close(); }
});

test('business approval and current declared services remain mandatory regardless of owner training', () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE creditex_business_onboarding SET status='submitted'");
    assert.equal(f.eligible(), false);
    f.sql.exec("UPDATE creditex_business_onboarding SET status='approved'");
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE member_id='owner-member' AND module_id='veu-6'");
    assert.equal(f.eligible(), true, 'a revoked quiz pass does not suspend incoming leads');
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='' WHERE member_id='owner-member'");
    f.sql.exec("UPDATE trade_accounts SET capabilities='[\"hot-water\"]'");
    assert.equal(f.eligible(), false);
  } finally { f.sql.close(); }
});
test('staff training and capabilities do not change the business service scope for leads', () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE module_id LIKE 'act-%' OR module_id LIKE 'sa-%'");
    assert.equal(f.eligible(), true);
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"hot-water\"]' WHERE id='worker'");
    f.sql.exec("DELETE FROM trade_training_completions WHERE member_id='worker' AND module_id='veu-6'");
    assert.equal(f.eligible(), true);
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"heating-cooling\"]' WHERE id='worker'");
    assert.equal(f.eligible(), true);
  } finally { f.sql.close(); }
});

test('lead disclosure always requires an active business owner, including categories without a course requirement', () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE trade_accounts SET capabilities='[\"heating-cooling\",\"plumbing\"]'");
    const categories = [['heating-cooling'], ['plumbing']];
    for (const category of categories) assert.equal(f.eligible(category), true);
    f.sql.exec("UPDATE trade_team_members SET status='inactive' WHERE id='owner-member'");
    for (const category of categories) assert.equal(f.eligible(category), false);
    f.sql.exec("DELETE FROM trade_team_members WHERE id='owner-member'");
    for (const category of categories) assert.equal(f.eligible(category), false);
  } finally { f.sql.close(); }
});

test('current served states govern pending lead disclosure and allocation with legacy address fallback only', () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE trade_accounts SET service_states='[\"VIC\"]',address_state='NSW'");
    assert.equal(f.eligible(), true);
    assert.equal(f.eligible(['heating-cooling'], 'NSW'), false, 'the address cannot add an undeclared service state');
    f.sql.exec("UPDATE trade_accounts SET service_states='[\"NSW\"]',address_state='VIC'");
    assert.equal(f.eligible(), false, 'saved completions cannot preserve disclosure after VIC is removed');
    f.sql.exec('CREATE TABLE state_allocations(owner_uid TEXT)');
    const inserted = f.sql.prepare(`INSERT INTO state_allocations SELECT lead.owner_uid
      FROM (SELECT ? owner_uid, ? categories, ? state) lead WHERE ${f.predicate}`)
      .run('owner', '["heating-cooling"]', 'VIC');
    assert.equal(Number(inserted.changes), 0, 'the same state rule is checked at the allocation mutation');
    f.sql.exec("UPDATE trade_accounts SET service_states='[\" vic \",\"VIC\",\"NSW\"]'");
    assert.equal(f.eligible(), true);
    assert.equal(f.eligible(['heating-cooling'], 'NSW'), true);
    f.sql.exec("UPDATE trade_accounts SET service_states='[]'");
    assert.equal(f.eligible(), true, 'only undeclared legacy accounts use their address state');
    assert.equal(f.eligible(['heating-cooling'], 'NSW'), false);
  } finally { f.sql.close(); }
});
test('course withdrawals, source changes and training revocations do not block lead disclosure', () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE trade_training_module_reviews SET review_expires_on='2000-01-01' WHERE module_id='veu-6'");
    assert.equal(f.eligible(), true, 'optional curriculum review expiry does not expire an actual current pass');
    f.sql.prepare("UPDATE trade_training_module_reviews SET review_expires_on='2099-12-31',content_hash=? WHERE module_id='veu-6'").run('f'.repeat(64));
    assert.equal(f.eligible(), true, 'optional review content cannot override deployed source-backed curriculum');
    f.sql.exec("DELETE FROM trade_training_module_reviews");
    assert.equal(f.eligible(), true, 'no curriculum review records are required');
    const completion = f.sql.prepare("SELECT * FROM trade_training_completions WHERE module_id='veu-6' AND member_id='worker'").get();
    f.sql.prepare("UPDATE trade_training_completions SET content_hash=? WHERE id=?").run('e'.repeat(64), completion.id);
    assert.equal(f.eligible(), true, 'a stale course completion is not a lead restriction');
    f.sql.prepare("UPDATE trade_training_completions SET content_hash=? WHERE id=?").run(completion.content_hash, completion.id);
    installCreditexTrainingFixture(f.sql);
    f.sql.exec("UPDATE trade_training_module_reviews SET status='withdrawn' WHERE module_id='veu-6'");
    assert.equal(f.eligible(), true, 'withdrawn training remains a booking restriction');
    f.sql.exec("UPDATE trade_training_module_reviews SET status='active'");
    f.sql.exec(`UPDATE trade_training_completions SET passed_at='2098-01-01',revoked_at='2098-01-02'
      WHERE id=(SELECT id FROM trade_training_completions WHERE module_id='veu-6' AND member_id='worker' ORDER BY rowid DESC LIMIT 1)`);
    assert.equal(f.eligible(), true, 'revoked training remains a booking restriction');
  } finally { f.sql.close(); }
});
test('allocation predicate rechecks eligibility at the database mutation', () => {
  const f = fixture();
  try {
    assert.equal(f.eligible(), true);
    f.sql.exec("CREATE TABLE allocations(owner_uid TEXT); UPDATE creditex_business_onboarding SET status='suspended'");
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

test('insulation leads are received before training and credential completion with booking checks separate', () => {
  const f = fixture();
  try {
    assert.equal(f.eligible(['insulation']), true, 'lead receipt does not require an installer credential');
    f.sql.prepare('INSERT INTO trade_team_member_files VALUES (?,?,?,?,?,?)').run('credential-file','owner','worker','active','2099-12-31','training');
    f.sql.prepare('INSERT INTO trade_training_external_credentials VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('credential','owner','worker','veu-48','credential-file','EEC-CII','ESC-registration','2099-12-31','reviewer','Registers verified','','2026-09-18');
    assert.equal(f.eligible(['insulation']), true);
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE member_id='owner-member' AND module_id='veu-48'");
    assert.equal(f.eligible(['insulation']), true, 'the office owner can receive leads before their quiz pass');
    f.sql.exec("UPDATE trade_training_completions SET revoked_at='' WHERE member_id='owner-member'");
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"hot-water\"]' WHERE id='worker'");
    assert.equal(f.eligible(['insulation']), true, 'assignment eligibility is checked when selecting the installer');
    f.sql.exec("UPDATE trade_team_members SET capabilities='[\"insulation\"]' WHERE id='worker'");
    f.sql.exec("UPDATE trade_team_member_files SET status='deleted'");
    assert.equal(f.eligible(['insulation']), true, 'credential validity is checked before the installation is booked');
  } finally { f.sql.close(); }
});

test('bulk allocation remains bounded and excludes unapproved businesses without requiring training', async () => {
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
    assert.deepEqual([...await certificateLeadEligibleOwners(db, candidates.slice(0, 1), 'VIC')], ['owner']);
    f.sql.exec("UPDATE creditex_business_onboarding SET status='suspended'");
    assert.equal((await certificateLeadEligibleOwners(db, candidates.slice(0, 1), 'VIC')).size, 0);
  } finally { f.sql.close(); }
});


test('lead categories must be nonempty saved service arrays and malformed account services fail closed', () => {
  const f = fixture();
  try {
    assert.equal(f.eligible(['made-up-service']), false);
    assert.equal(f.eligible(['heating-cooling', 'made-up-service']), false);
    assert.equal(f.eligible([null]), false); assert.equal(f.eligible([1]), false);
    for (const capabilities of ['not-json', 'null', '{}', '"heating-cooling"', '[]']) {
      f.sql.prepare('UPDATE trade_accounts SET capabilities=?').run(capabilities);
      assert.equal(f.eligible(), false, capabilities);
    }
  } finally { f.sql.close(); }
});


test('removing the training prerequisite does not bypass business insurance or signed agreement requirements', () => {
  const f = fixture();
  try {
    f.sql.exec('DELETE FROM trade_training_completions; DELETE FROM trade_training_attempts');
    assert.equal(f.eligible(), true);
    f.sql.exec("UPDATE creditex_business_onboarding SET insurance_expires_on='2000-01-01'");
    assert.equal(f.eligible(), false);
    assert.throws(() => f.sql.exec("UPDATE creditex_business_onboarding SET insurance_expires_on='2099-12-31',agreement_reference=''"), /CHECK constraint failed/);
    f.sql.exec("UPDATE creditex_business_onboarding SET status='draft',insurance_expires_on='2099-12-31',agreement_reference=''");
    assert.equal(f.eligible(), false);
  } finally { f.sql.close(); }
});
