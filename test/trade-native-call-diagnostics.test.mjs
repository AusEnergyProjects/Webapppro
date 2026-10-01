import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeCallDiagnosticSnapshot } from '../src/lib/trade-native-call-diagnostics.ts';

const now = Date.parse('2026-10-01T10:00:00.000Z');
const event = {
 timestamp: new Date(now).toISOString(), stage: 'push_received', localEnabled: true, appState: 'background',
 managedCallCount: 1, managedConnectedCount: 0, systemCallCount: 1, systemConnectedCount: 0,
};
const snapshot = (events = [event], version = '1.3.4', clock = now) => nativeCallDiagnosticSnapshot(events, version, clock);

test('native diagnostics reconstruct only approved non-identifying fields', () => {
 const input = { ...event, stage: 'call_report_failed', errorDomain: 'callkit_incoming', errorCode: 3,
  callerName: 'Private person', callId: 'private-id', token: 'private-token', error: { message: 'private-error' } };
 assert.deepEqual(snapshot([input]), { appVersion: '1.3.4', events: [{ ...event, stage: 'call_report_failed', errorDomain: 'callkit_incoming', errorCode: 3 }] });
 assert.equal(JSON.stringify(snapshot([input])).includes('private'), false);
 assert.notEqual(snapshot([input]).events[0], input);
});

test('all native stages, application states and rejection reasons are accepted', () => {
 for (const stage of ['native_start', 'configuration_changed', 'push_received', 'push_rejected', 'call_reported', 'call_report_failed', 'duplicate_reported', 'duplicate_report_failed']) {
  assert.equal(snapshot([{ ...event, stage }]).events[0].stage, stage);
 }
 for (const appState of ['active', 'inactive', 'background', 'unknown']) {
  assert.equal(snapshot([{ ...event, appState }]).events[0].appState, appState);
 }
 for (const rejectionReason of ['disabled', 'invalid_call_id', 'invalid_thread_id', 'invalid_mode', 'invalid_expiry', 'expired']) {
  assert.equal(snapshot([{ ...event, rejectionReason }]).events[0].rejectionReason, rejectionReason);
 }
 assert.equal(snapshot([{ ...event, localEnabled: false, errorDomain: 'other' }]).events[0].localEnabled, false);
});

test('malformed or excessive snapshots are discarded without partially logging their content', () => {
 for (const value of [undefined, null, {}, 'secret', [], new Array(13).fill(event), [event, null], [event, []], [event, {}]]) {
  assert.equal(nativeCallDiagnosticSnapshot(value, '1.3.4', now), null);
 }
 assert.equal(snapshot(new Array(12).fill(event)).events.length, 12);
 for (const [key, values] of Object.entries({
  timestamp: [null, 123, '2026-10-01', 'now', '2026-10-01T10:00:00'],
  stage: ['private-stage', '', null], appState: ['private-state', '', null], localEnabled: [1, 'true', null],
  rejectionReason: ['private-reason', '', null], errorDomain: ['private-domain', '', null], errorCode: [-2, 101, 0.5, '3', null],
 })) {
  for (const invalid of values) assert.equal(snapshot([event, { ...event, [key]: invalid }]), null, `${key}: ${invalid}`);
 }
 for (const key of ['timestamp', 'stage', 'localEnabled', 'appState', 'managedCallCount', 'managedConnectedCount', 'systemCallCount', 'systemConnectedCount']) {
  const invalid = { ...event }; delete invalid[key]; assert.equal(snapshot([invalid]), null, key);
 }
});

test('call counts and error codes accept only bounded integers', () => {
 for (const key of ['managedCallCount', 'managedConnectedCount', 'systemCallCount', 'systemConnectedCount']) {
  for (const value of [0, 32]) assert.equal(snapshot([{ ...event, [key]: value }]).events[0][key], value);
  for (const value of [-1, 33, 0.5, '0', null, NaN, Infinity]) assert.equal(snapshot([{ ...event, [key]: value }]), null);
 }
 for (const errorCode of [-1, 0, 100]) assert.equal(snapshot([{ ...event, errorCode }]).events[0].errorCode, errorCode);
});

test('diagnostic timestamps are canonicalised and limited to the last day plus five minutes of clock skew', () => {
 for (const age of [-24 * 60 * 60 * 1000, 0, 5 * 60 * 1000]) {
  const timestamp = new Date(now + age).toISOString(); assert.equal(snapshot([{ ...event, timestamp }]).events[0].timestamp, timestamp);
 }
 for (const age of [-24 * 60 * 60 * 1000 - 1, 5 * 60 * 1000 + 1]) {
  assert.equal(snapshot([{ ...event, timestamp: new Date(now + age).toISOString() }]), null);
 }
 assert.equal(snapshot([{ ...event, timestamp: '2026-10-01T20:00:00+10:00' }]).events[0].timestamp, event.timestamp);
 assert.equal(snapshot([{ ...event, timestamp: '2026-10-01T10:00:00.123456Z' }]).events[0].timestamp, '2026-10-01T10:00:00.123Z');
 for (const timestamp of ['2026-09-31T10:00:00Z', '2026-10-01T24:00:00Z', '2026-10-01T10:00:60Z', '2026-10-01T10:00:00+99:00']) {
  assert.equal(snapshot([{ ...event, timestamp }]), null);
 }
 assert.equal(snapshot([event], '1.3.4', NaN), null);
});

test('diagnostics cannot smuggle text through the application version', () => {
 for (const version of ['', null, 134, '1.3', '01.3.4', '1.3.4 private', '1.3.4\n', '10000.3.4', '1.3.4+private', '1.3.4-private']) {
  assert.equal(snapshot([event], version), null);
 }
 for (const version of ['0.0.0', '1.3.4', '9999.9999.9999']) assert.equal(snapshot([event], version).appVersion, version);
});
