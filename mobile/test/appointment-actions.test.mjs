import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/appointment-actions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', code)(exports);
const { appointmentTimeParts, appointmentTimeValue, appointmentFormValues, appointmentContactLinks, appointmentSavedMessage } = exports;

test('rescheduling supports the whole day without switching noon and midnight', () => {
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of ['00', '15', '30', '45', '07']) {
      const time = `${String(hour).padStart(2, '0')}:${minute}`;
      const parts = appointmentTimeParts(time);
      assert.equal(appointmentTimeValue(parts.hour, parts.minute, parts.period), time);
    }
  }
});

test('rescheduling retains duration and worker while aligning an old start to a valid quarter-hour', () => {
  const appointment = { id: 'visit', memberId: 'worker-b', startsAt: '2026-09-10T13:07:00', endsAt: '2026-09-10T14:37:00' };
  assert.deepEqual(appointmentFormValues(appointment), { date: '2026-09-10', time: '13:15', durationMinutes: 90, memberId: 'worker-b' });
  assert.deepEqual(appointmentFormValues({ ...appointment, startsAt: '2026-09-10T23:59:00', endsAt: '2026-09-11T00:59:00' }),
    { date: '2026-09-11', time: '00:00', durationMinutes: 60, memberId: 'worker-b' });
  assert.deepEqual(appointmentFormValues(null, new Date(2026, 8, 10, 20)), { date: '2026-09-10', time: '09:00', durationMinutes: 60, memberId: '' });
});

test('contact actions respect protected jobs and encode contact addresses', () => {
  const job = { protectedJob: false, serviceAddress: '1 A & B Street, VIC', customerPhone: '0400 123 456' };
  const customer = { phone: '+61 (400) 111 222', email: 'test+tenant@example.com' };
  const links = appointmentContactLinks(job, customer);
  assert.equal(links.call, 'tel:+61400111222');
  assert.equal(links.email, 'mailto:test%2Btenant%40example.com');
  assert.equal(new URL(links.directions).searchParams.get('destination'), job.serviceAddress);
  assert.deepEqual(appointmentContactLinks({ ...job, protectedJob: true }, customer), { directions: '', call: '', email: '' });
  assert.equal(appointmentContactLinks(job, { phone: '', email: 'not an email' }).call, '', 'a cleared server contact must not fall back to stale cached personal details');
  assert.equal(appointmentContactLinks(job, { phone: '', email: 'not an email' }).email, '');
});

test('appointment success keeps email and calendar failures visible instead of claiming delivery', () => {
  const result = { ok: true, jobPatch: {}, email: { status: 'failed', message: 'Customer email could not be sent.' }, calendarSync: { failed: 1 } };
  const message = appointmentSavedMessage('reschedule', result);
  assert.match(message, /^Appointment rescheduled\./);
  assert.match(message, /Customer email could not be sent/);
  assert.match(message, /Google Calendar could not be updated/);
  assert.doesNotMatch(message, /email sent|calendar updated/i);
  assert.match(appointmentSavedMessage('no_show', { ok: true, jobPatch: {} }), /Ready to reschedule/);
});

test('confirmed deletion remains successful when device cleanup needs a sync retry', () => {
  assert.equal(appointmentSavedMessage('delete', { ok: true, jobPatch: {}, deviceCleanupPending: true }),
    'Job deleted. Customer details kept. Device cleanup will retry on Sync.');
});
