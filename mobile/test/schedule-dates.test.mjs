import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/schedule.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', code)(exports);
const { effectiveJobStart, isUnscheduledJob, isVisibleScheduleJob, matchesJobSearch, localWorkDate } = exports;

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

test('a no-show leaves the appointment date and stays ready for rescheduling even with an old cached date', () => {
  const job = { stage: 'no_show', scheduledStart: '2026-09-09T01:00:00Z', appointmentStartsAt: '2026-09-09T01:00:00Z' };
  assert.equal(effectiveJobStart(job), '');
  assert.equal(isUnscheduledJob(job), true);
  assert.equal(isVisibleScheduleJob(job), true);
  assert.equal(effectiveJobStart({ ...job, stage: 'in_progress', lifecycleStatus: 'no_show' }), '');
});

test('cancelled jobs disappear from schedule and search immediately after a confirmed server change', () => {
  const job = { stage: 'cancelled', appointmentStartsAt: '2026-09-09T01:00:00Z' };
  assert.equal(effectiveJobStart(job), '');
  assert.equal(isUnscheduledJob(job), false);
  assert.equal(isVisibleScheduleJob(job), false);
  assert.equal(isVisibleScheduleJob({ stage: 'in_progress', lifecycleStatus: 'cancelled' }), false);
  assert.equal(isVisibleScheduleJob({ stage: 'completed' }), true);
});

test('job search finds downloaded work by multiple words regardless of appointment date', () => {
  const job = { workNumber: 'TL-204', title: 'Switchboard repair', protectedJob: false, customerName: 'Jane Smith', serviceAddress: '14 Queen Street Ballarat', siteArea: 'VIC', customerEmail: 'jane@example.com', customerPhone: '0412345678' };
  for (const query of [' jane BALLARAT ', 'tl-204', 'switchboard smith', 'jane@example.com', '0412345678', '']) assert.equal(matchesJobSearch(job, query), true, query);
  for (const query of ['jane melbourne', 'tl-999']) assert.equal(matchesJobSearch(job, query), false, query);
  const protectedJob = { ...job, protectedJob: true };
  for (const query of ['jane', 'queen', '0412345678', 'example.com']) assert.equal(matchesJobSearch(protectedJob, query), false, query);
  assert.equal(matchesJobSearch(protectedJob, 'tl-204 vic'), true);
});

test('time entries use the worker local calendar day including around midnight', () => {
  for (const [year, month, day, hour] of [[2026, 8, 10, 0], [2026, 8, 10, 23], [2027, 0, 1, 0]]) {
    const date = new Date(year, month, day, hour, 5);
    assert.equal(localWorkDate(date), `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
});
