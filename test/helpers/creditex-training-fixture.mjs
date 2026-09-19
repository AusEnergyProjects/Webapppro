import fs from 'node:fs';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as curriculum from '../../src/data/creditex-training-curriculum.ts';
import * as catalogue from '../../src/lib/australian-government-program-catalogue.ts';
import * as onboarding from '../../src/lib/creditex-onboarding-server.ts';
import * as energyServices from '../../src/lib/energy-service-catalogue.mjs';
import * as teamServiceStates from '../../src/lib/trade-team-service-states.ts';
import * as trainingSections from '../../src/lib/training-service-sections.mjs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const modules = { 'node:crypto': crypto, 'creditex-training-curriculum': curriculum,
  'australian-government-program-catalogue': catalogue, 'creditex-onboarding-server': onboarding, 'energy-service-catalogue.mjs': energyServices, 'trade-team-service-states': teamServiceStates, 'training-service-sections.mjs': trainingSections };
export function certificateTestDependency(specifier) {
  return modules[specifier] || modules[specifier.split('/').at(-1).replace(/\.ts$/, '')];
}
for (const name of ['training-questionnaire-store', 'trade-training-server', 'trade-certificate-eligibility', 'trade-certificate-leads']) {
  const output = ts.transpileModule(read(`src/lib/${name}.ts`), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)((specifier) => {
    const dependency = certificateTestDependency(specifier);
    if (!dependency) throw new Error(`Unresolved training fixture dependency: ${specifier}`);
    return dependency;
  }, loaded, loaded.exports);
  modules[name] = loaded.exports;
}

/** Explicitly qualifies test businesses and people under the new production gate.
 * Uses the real schema, exact current curriculum hashes and real predicate code.
 * Call after inserting a fixture's people; revoke/delete rows to exercise denial.
 */
export function installCreditexTrainingFixture(database, { qualified = true } = {}) {
  database.exec(`CREATE TABLE IF NOT EXISTS trade_accounts(firebase_uid TEXT PRIMARY KEY, abn TEXT, business_name TEXT);
    CREATE TABLE IF NOT EXISTS trade_team_members(id TEXT PRIMARY KEY, owner_uid TEXT, member_uid TEXT, status TEXT);
    CREATE TABLE IF NOT EXISTS trade_team_member_files(id TEXT PRIMARY KEY, owner_uid TEXT, team_member_id TEXT, status TEXT, expires_at TEXT, category TEXT);
    CREATE TABLE IF NOT EXISTS trade_work_order_compliance_intents(id TEXT PRIMARY KEY, installer_uid TEXT, work_order_id TEXT, activity_template_id TEXT, status TEXT);
    CREATE TABLE IF NOT EXISTS trade_crm_write_guards(id TEXT PRIMARY KEY,firebase_uid TEXT,operation_id TEXT,step_number INTEGER,verified INTEGER CHECK(verified=1),created_at TEXT);`);
  const columns = new Set(database.prepare('PRAGMA table_info(trade_accounts)').all().map((row) => row.name));
  if (!columns.has('abn')) database.exec("ALTER TABLE trade_accounts ADD COLUMN abn TEXT NOT NULL DEFAULT '53004085616'");
  if (!columns.has('business_name')) database.exec("ALTER TABLE trade_accounts ADD COLUMN business_name TEXT NOT NULL DEFAULT 'Training fixture Pty Ltd'");
  const categories = JSON.stringify([...new Set(catalogue.GOVERNMENT_ACTIVITY_TEMPLATES.map(activity => activity.serviceCategory))]);
  if (!columns.has('capabilities')) database.exec(`ALTER TABLE trade_accounts ADD COLUMN capabilities TEXT NOT NULL DEFAULT '${categories}'`);
  if (!columns.has('service_states')) database.exec(`ALTER TABLE trade_accounts ADD COLUMN service_states TEXT NOT NULL DEFAULT '["ACT","NSW","NT","QLD","SA","TAS","VIC","WA"]'`);
  if (!columns.has('address_state')) database.exec("ALTER TABLE trade_accounts ADD COLUMN address_state TEXT NOT NULL DEFAULT 'VIC'");
  const memberColumns = new Set(database.prepare('PRAGMA table_info(trade_team_members)').all().map(row => row.name));
  if (!memberColumns.has('member_uid')) database.exec("ALTER TABLE trade_team_members ADD COLUMN member_uid TEXT NOT NULL DEFAULT ''");
  if (!memberColumns.has('display_name')) database.exec("ALTER TABLE trade_team_members ADD COLUMN display_name TEXT NOT NULL DEFAULT 'Fixture technician'");
  if (!memberColumns.has('capabilities')) database.exec(`ALTER TABLE trade_team_members ADD COLUMN capabilities TEXT NOT NULL DEFAULT '${categories}'`);
  const fileColumns = new Set(database.prepare('PRAGMA table_info(trade_team_member_files)').all().map(row => row.name));
  const intentColumns = new Set(database.prepare('PRAGMA table_info(trade_work_order_compliance_intents)').all().map(row => row.name));
  if (!intentColumns.has('site_jurisdiction')) database.exec("ALTER TABLE trade_work_order_compliance_intents ADD COLUMN site_jurisdiction TEXT NOT NULL DEFAULT 'VIC'");
  if (!fileColumns.has('expires_at')) database.exec("ALTER TABLE trade_team_member_files ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''");
  if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='creditex_business_onboarding'").get()) {
    database.exec(read('drizzle/0176_creditex_onboarding_training.sql'));
  }
  database.exec(read('drizzle/0177_autonomous_activity_training.sql'));
  if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='creditex_onboarding_completions'").get()) {
    database.exec(read('drizzle/0178_autonomous_business_onboarding.sql'));
  }
  if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trade_training_questionnaires'").get()) {
    database.exec(read('drizzle/0179_training_questionnaires.sql'));
  }
  if (!memberColumns.has('service_states')) database.exec(read('drizzle/0180_team_member_service_states.sql'));
  if (!qualified) return;
  const now = new Date().toISOString();
  const accounts = database.prepare('SELECT firebase_uid, abn, business_name FROM trade_accounts').all();
  for (const account of accounts) {
    if (!database.prepare('SELECT id FROM trade_team_members WHERE owner_uid=? AND member_uid=?').get(account.firebase_uid, account.firebase_uid)) {
      const owner = { id: `training-owner-${account.firebase_uid}`, owner_uid: account.firebase_uid, member_uid: account.firebase_uid,
        email: `training-owner-${account.firebase_uid}@fixture.example`, display_name: 'Fixture business owner', first_name: 'Fixture', last_name: 'Owner',
        phone: '', field_username: '', field_username_normalized: '', schedule_colour: 'emerald', job_scope: 'team', schedule_scope: 'team', last_active_at: now,
        capabilities: categories, role: 'owner', status: 'active', invited_at: now, accepted_at: now, created_at: now, updated_at: now };
      const available = new Set(database.prepare('PRAGMA table_info(trade_team_members)').all().map(row => row.name));
      for (const field of available) if (field.startsWith('can_')) owner[field] = 1;
      const fields = Object.keys(owner).filter(field => available.has(field));
      database.prepare(`INSERT INTO trade_team_members (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...fields.map(field => owner[field]));
    }
    database.prepare(`INSERT OR IGNORE INTO creditex_business_onboarding
      (owner_uid,status,revision,application_json,business_abn,business_name,insurance_expires_on,agreement_reference,reviewed_by_uid,reviewed_at,updated_at)
      VALUES (?,'approved',1,'{}',?,?,'2099-12-31','TEST-SIGNED-AGREEMENT','test-creditex-reviewer',?,?)`)
      .run(account.firebase_uid, account.abn || '', account.business_name || '', now, now);
  }
  for (const course of curriculum.TRAINING_MODULES) {
    const hash = modules['trade-training-server'].getTrainingModuleHash(course);
    database.prepare(`INSERT OR IGNORE INTO trade_training_module_reviews
      (module_id,version,content_hash,status,source_reviewed_on,review_expires_on,scheme_authority_reference,reviewed_by_uid,review_note,updated_at)
      VALUES (?,?,?,'active',?,'2099-12-31','TEST-SCHEME-AUTHORITY','test-creditex-reviewer','Explicit authorised test fixture',?)`)
      .run(course.id, course.version, hash, now.slice(0, 10), now);
    for (const member of database.prepare("SELECT id,owner_uid,member_uid FROM trade_team_members WHERE status='active'").all()) {
      const attemptId = crypto.randomUUID();
      database.prepare(`INSERT INTO trade_training_attempts
        (id,owner_uid,member_id,actor_uid,module_id,version,content_hash,status,started_at,expires_at,submitted_at,assessment_json,score_percent,critical_passed)
        VALUES (?,?,?,?,?,?,?,'passed',?,'2099-12-31T23:59:59.000Z',?,?,100,1)`)
        .run(attemptId, member.owner_uid, member.id, member.member_uid || member.id, course.id, course.version, hash, now, now,
          JSON.stringify(course.questions.map(question => ({ questionId: question.id,
            options: question.options.map(option => ({ token: crypto.randomUUID(), optionId: option.id })) }))));
      database.prepare(`INSERT INTO trade_training_completions
        (id,attempt_id,owner_uid,member_id,module_id,version,content_hash,reference,passed_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,'2099-12-31T23:59:59.000Z')`)
        .run(crypto.randomUUID(), attemptId, member.owner_uid, member.id, course.id, course.version, hash, `TEST-${attemptId}`, now);
    }
  }
}
