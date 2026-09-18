import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { certificateTestDependency, installCreditexTrainingFixture } from './helpers/creditex-training-fixture.mjs';

const route = fs.readFileSync(new URL('../src/app/api/trade-compliance/route.ts', import.meta.url), 'utf8');
const guard = route.match(/statements\.push\(creditexWriteGuard\(database, access\.identity\.uid,\s*`([^`]+)`/);
assert.ok(guard, 'the intake batch must guard the exact assignment that was checked');
const { creditexWriteGuard } = certificateTestDependency('creditex-onboarding-server');
const workPack = fs.readFileSync(new URL('../src/lib/creditex-activity-work-pack-server.ts', import.meta.url), 'utf8');
const workPackGuard = workPack.match(/statements\.push\(creditexWriteGuard\(database, input\.scope\.ownerUid,\s*`([^`]+)`/);
assert.ok(workPackGuard, 'work-pack mutations must guard the job assignment used for training');

for (const [name, predicate] of [['intake', guard[1]], ['work-pack mutation', workPackGuard[1]]]) {
test(`${name} rolls back if assignment or job revision changes after the training precheck`, () => {
  for (const change of ["assignee_member_id='untrained-worker'", 'revision=2', "record_status='archived'"]) {
    const database = new DatabaseSync(':memory:');
    try {
      installCreditexTrainingFixture(database, { qualified: false });
      database.exec(`CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,assignee_member_id TEXT,revision INTEGER,record_status TEXT);
        CREATE TABLE created_cases(id TEXT);
        INSERT INTO trade_work_orders VALUES ('job','business','trained-worker',1,'active');`);
      const d1 = { prepare(sql) { return { bind(...values) { return { run() { return database.prepare(sql).run(...values); } }; } }; } };
      const statement = creditexWriteGuard(d1, 'business', predicate, ['job','business','trained-worker',1]);
      assert.doesNotThrow(() => statement.run());
      database.exec(`UPDATE trade_work_orders SET ${change}`);
      database.exec('BEGIN');
      database.exec("INSERT INTO created_cases VALUES ('must-rollback')");
      assert.throws(() => statement.run(), /CHECK constraint failed/);
      database.exec('ROLLBACK');
      assert.equal(database.prepare('SELECT count(*) count FROM created_cases').get().count, 0);
    } finally { database.close(); }
  }
});
}
