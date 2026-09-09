import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/schedule.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', code)(exports);
const { effectiveJobStart, isUnscheduledJob } = exports;

test('schedule uses the actual appointment consistently and falls back only to a valid job date', () => {
  const job = { stage: 'scheduled', appointmentStartsAt: '2026-09-10T02:00:00Z', scheduledStart: '2026-09-09T01:00:00Z' };
  assert.equal(effectiveJobStart(job), job.appointmentStartsAt);
  assert.equal(effectiveJobStart({ ...job, appointmentStartsAt: 'bad' }), job.scheduledStart);
  assert.equal(effectiveJobStart({ ...job, appointmentStartsAt: '', scheduledStart: 'bad' }), '');
});
test('undated active assignments are reachable while terminal work does not fill the unscheduled list', () => {
  for (const stage of ['backlog', 'ready', 'in_progress', 'blocked']) assert.equal(isUnscheduledJob({ stage }), true);
  for (const stage of ['completed', 'cancelled']) assert.equal(isUnscheduledJob({ stage }), false);
  assert.equal(isUnscheduledJob({ stage: 'in_progress', lifecycleStatus: 'audited' }), false);
  assert.equal(isUnscheduledJob({ stage: 'ready', scheduledStart: '2026-09-09T01:00:00Z' }), false);
});
