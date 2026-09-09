import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const database = read('../src/lib/database.ts');
const schedule = read('../src/app/(tabs)/work.tsx');
const jobDetails = read('../src/app/job/[id].tsx');

test('completed jobs remain in the local schedule while cancelled jobs stay hidden', () => {
  assert.match(database, /SELECT payload FROM jobs\s+WHERE stage <> 'cancelled'/);
  assert.match(database, /json_extract\(payload, '\$\.lifecycleStatus'\)[\s\S]*<> 'cancelled'/);
  assert.doesNotMatch(database, /stage NOT IN \('completed', 'cancelled'\)/);
});

test('schedule cards use field-friendly lifecycle labels', () => {
  assert.match(schedule, /backlog: 'Unscheduled'/);
  assert.match(schedule, /ready: 'Unscheduled'/);
  assert.match(schedule, /scheduled: 'Scheduled'/);
  assert.match(schedule, /in_progress: 'Partial'/);
  assert.match(schedule, /blocked: 'Partial'/);
  assert.match(schedule, /completed: 'Completed'/);
  assert.match(schedule, /cancelled: 'Cancelled'/);
  assert.match(schedule, /JOB_STAGE_LABELS\[value\]/);
  assert.match(schedule, /job\.lifecycleStatus \|\| job\.stage/);
  assert.match(schedule, /Audited \| \$\{outcome\}/);
  assert.match(jobDetails, /job\.lifecycleStatus \|\| job\.stage/);
  assert.match(jobDetails, /activityRecords\.some\(\(record\) => record\.status !== 'not_started' \|\| record\.lifecycleStatus === 'partial'\)/);
  assert.match(jobDetails, /lifecycleLabel\(job, activityRecords\)/);
  assert.match(jobDetails, /job\.auditOutcome/);
});
