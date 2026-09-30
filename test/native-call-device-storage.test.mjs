import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as push from '../src/lib/trade-push.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../drizzle/0221_native_call_devices.sql');
const legacyTrade = read('../drizzle/0027_handy_the_anarchist.sql').split('CREATE TABLE `trade_mobile_push_outbox`')[0];
const legacyManual = 'CREATE TABLE `compliance_manual_field_devices`'
  + read('../drizzle/0112_creditex_manual_field_capture.sql').split('CREATE TABLE `compliance_manual_field_devices`')[1]
    .split('CREATE TABLE `compliance_manual_field_upload_sessions`')[0];
const compiled = ts.transpileModule(read('../src/lib/creditex-manual-field-server.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const member = { uid: 'tester-a', organisationId: 'organisation-a' };
const token = 'ab'.repeat(32);
const registration = { deviceId: 'review-device-001', platform: 'ios', deviceName: 'Test phone', appVersion: '1.0.2',
  isPhysicalDevice: true, pushProvider: 'apns', pushToken: '', voipPushToken: token, nativeCallCapable: true };

function harness({ beforeRun } = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(legacyTrade); database.exec(legacyManual); database.exec(migration);
  const d1 = { prepare(sql) {
    let values = [];
    return {
      bind(...bindings) { values = bindings; return this; },
      async first() { return database.prepare(sql).get(...values) || null; },
      async run() { beforeRun?.(database, sql); const result = database.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    };
  } };
  const exports = {};
  new Function('require', 'exports', compiled)(name => {
    if (name === './trade-push.ts') return push;
    if (name === './trade-mobile-server.ts') return {
      appVersionAccepted: (_platform, version) => version === '1.0.2', mobileAppPolicy: platform => ({ platform, minimumVersion: '1.0.0' }),
    };
    if (['./firebase-server.ts', './creditex-manual-evidence-lab.ts'].includes(name)) return {};
    throw new Error(`Unexpected module ${name}`);
  }, exports);
  const row = (identity = member) => database.prepare('SELECT * FROM compliance_manual_field_devices WHERE organisation_id = ? AND firebase_uid = ? AND device_id = ?')
    .get(identity.organisationId, identity.uid, registration.deviceId);
  return { database, d1, server: exports, row };
}

test('additive call-device migration preserves old registrations with disabled defaults and boolean checks', () => {
  const database = new DatabaseSync(':memory:'); database.exec(legacyTrade); database.exec(legacyManual);
  database.exec(`INSERT INTO trade_mobile_devices (id,owner_uid,actor_uid,device_id,platform,app_version,registered_at,last_seen_at,updated_at)
    VALUES ('old','owner','actor','old-device','ios','1.0.2','','','');
    INSERT INTO compliance_manual_field_devices (id,organisation_id,firebase_uid,device_id,platform,device_name,app_version,registered_at,last_seen_at,updated_at)
    VALUES ('old','org','actor','old-device','android','Phone','1.0.2','','','');`);
  database.exec(migration);
  for (const table of ['trade_mobile_devices', 'compliance_manual_field_devices']) {
    assert.deepEqual({ ...database.prepare(`SELECT app_version,voip_push_token,native_call_capable FROM ${table}`).get() },
      { app_version: '1.0.2', voip_push_token: '', native_call_capable: 0 });
    assert.throws(() => database.exec(`UPDATE ${table} SET native_call_capable = 2`), /CHECK constraint/);
  }
});

test('manual registration stores validated native call fields without returning tokens in registration or device projections', async () => {
  const h = harness();
  const result = await h.server.registerManualFieldDevice(h.d1, member, registration);
  assert.equal(result.registered, true); assert.equal(h.row().voip_push_token, token); assert.equal(h.row().native_call_capable, 1);
  const projected = await h.server.requireManualFieldDevice(new Request('https://test.invalid', { headers: { 'x-aea-app-version': '1.0.2' } }),
    h.d1, member, registration.deviceId);
  for (const value of [result, projected]) {
    assert.equal('voip_push_token' in value, false); assert.equal('voipPushToken' in value, false);
    assert.equal(JSON.stringify(value).includes(token), false);
  }
});

test('mute and legacy-client refresh clear stale call delivery capability', async () => {
  const h = harness();
  await h.server.registerManualFieldDevice(h.d1, member, registration);
  await h.server.registerManualFieldDevice(h.d1, member, { ...registration, voipPushToken: '', nativeCallCapable: false });
  assert.equal(h.row().voip_push_token, ''); assert.equal(h.row().native_call_capable, 0);
  await h.server.registerManualFieldDevice(h.d1, member, registration);
  const legacy = { ...registration };
  delete legacy.voipPushToken; delete legacy.nativeCallCapable;
  await h.server.registerManualFieldDevice(h.d1, member, legacy);
  assert.equal(h.row().voip_push_token, ''); assert.equal(h.row().native_call_capable, 0);
});

test('invalid call tokens and capabilities fail before touching an existing registration', async () => {
  const h = harness(); await h.server.registerManualFieldDevice(h.d1, member, registration);
  for (const invalid of [{ nativeCallCapable: 'true' }, { voipPushToken: 'not-a-token' }, { platform: 'android', pushProvider: 'fcm' }, { pushProvider: 'fcm' }]) {
    await assert.rejects(h.server.registerManualFieldDevice(h.d1, member, { ...registration, ...invalid }),
      error => error.code === 'MANUAL_FIELD_DEVICE_INVALID' && error.status === 400);
    assert.equal(h.row().voip_push_token, token); assert.equal(h.row().native_call_capable, 1);
  }
});

test('manual logout clears calls only for its organisation, tester and device and cannot be re-registered', async () => {
  const h = harness(); const other = { ...member, uid: 'tester-b' }; const otherOrg = { ...member, organisationId: 'organisation-b' };
  for (const identity of [member, other, otherOrg]) await h.server.registerManualFieldDevice(h.d1, identity, registration);
  await h.server.revokeManualFieldDevice(h.d1, member, registration);
  assert.equal(h.row().status, 'revoked'); assert.equal(h.row().voip_push_token, ''); assert.equal(h.row().native_call_capable, 0);
  for (const identity of [other, otherOrg]) { assert.equal(h.row(identity).status, 'active'); assert.equal(h.row(identity).voip_push_token, token); }
  assert.equal((await h.server.revokeManualFieldDevice(h.d1, member, registration)).reused, true);
  await assert.rejects(h.server.registerManualFieldDevice(h.d1, member, registration), error => error.code === 'DEVICE_REAUTHORISATION_REQUIRED');
});

test('a concurrent revoke wins over registration and cannot resurrect its private call token', async () => {
  let race = false;
  const h = harness({ beforeRun(database, sql) {
    if (race && sql.startsWith('INSERT INTO compliance_manual_field_devices')) {
      database.exec("UPDATE compliance_manual_field_devices SET status = 'revoked', voip_push_token = '', native_call_capable = 0");
    }
  } });
  await h.server.registerManualFieldDevice(h.d1, member, registration); race = true;
  await assert.rejects(h.server.registerManualFieldDevice(h.d1, member, registration), error => error.code === 'DEVICE_REAUTHORISATION_REQUIRED');
  assert.equal(h.row().status, 'revoked'); assert.equal(h.row().voip_push_token, ''); assert.equal(h.row().native_call_capable, 0);
});
