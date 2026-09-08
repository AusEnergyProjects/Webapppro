import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('../src/app/api/trade-team/sync/route.ts');
const types = read('../mobile/src/lib/types.ts');

test('field sync sends the canonical job lifecycle and audit outcome', () => {
  assert.match(route, /tradeJobAuditOutcomeSql/);
  assert.match(route, /tradeJobLifecycleStatusSql/);
  assert.match(route, /lifecycleStatus: row\.lifecycle_status/);
  assert.match(route, /auditOutcome: row\.lifecycle_status === "audited"/);
  assert.match(route, /NOT \$\{syncJobCancelledSql\("cohort", "cohort_detail"\)\}/);
  assert.match(route, /NOT \$\{syncJobCancelledSql\("w", "d"\)\}/);
  assert.match(types, /lifecycleStatus\?: JobLifecycleStatus/);
  assert.match(types, /auditOutcome\?: JobAuditOutcome \| ''/);
});
