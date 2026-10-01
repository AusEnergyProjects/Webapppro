import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { parseStringPromise } = require('xml2js');
const withCalls = require('../plugins/with-tlink-calls.js');
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const native = read('../modules/tlink-calls/android/src/main/java/au/com/australianenergyassessments/calls/TLinkCallsModule.kt');
const library = await parseStringPromise(read('../modules/tlink-calls/android/src/main/AndroidManifest.xml'));
const expo = await parseStringPromise(read('../node_modules/expo-notifications/android/src/main/AndroidManifest.xml'));
const messagingAction = 'com.google.firebase.MESSAGING_EVENT';
const expoNamespace = read('../node_modules/expo-notifications/android/build.gradle').match(/namespace\s+["']([^"']+)/)[1];
const expoService = expo.manifest.application[0].service.find(service => service['intent-filter']?.some(filter => filter.action.some(action => action.$['android:name'] === messagingAction)));
const expoServiceName = expoService.$['android:name'].startsWith('.') ? `${expoNamespace}${expoService.$['android:name']}` : expoService.$['android:name'];

async function apply(manifest) {
  const config = withCalls({ name: 'TLink', slug: 'test' });
  return (await config.mods.android.manifest({ ...config, modRequest: {}, modResults: manifest })).modResults;
}

test('FCM routing removes the installed Expo service and retains one private native call handler', async () => {
  const config = JSON.parse(read('../app.json')).expo;
  assert.ok(config.plugins.includes('./plugins/with-tlink-calls'));
  const result = await apply({ manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' } }] } });
  assert.deepEqual(result.manifest.application[0].service, [{ $: { 'android:name': expoServiceName, 'tools:node': 'remove' } }]);
  const handlers = library.manifest.application[0].service.filter(service => service['intent-filter']?.some(filter => filter.action.some(action => action.$['android:name'] === messagingAction)));
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0].$['android:name'], '.TLinkCallMessagingService');
  assert.equal(handlers[0].$['android:exported'], 'false');
  assert.ok(Number(handlers[0]['intent-filter'][0].$['android:priority']) > Number(expoService['intent-filter'][0].$['android:priority']));
  assert.match(native, /class TLinkCallMessagingService : ExpoFirebaseMessagingService\(\)/);
  assert.match(native, /else -> super\.onMessageReceived\(message\)/, 'ordinary notifications retain Expo delivery');
});

test('call prebuild is idempotent and preserves unrelated services and permissions', async () => {
  const unrelated = { $: { 'android:name': 'example.UnrelatedService', 'android:exported': 'false' } };
  const input = { manifest: { $: {}, 'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }], application: [{ $: { 'android:name': '.MainApplication' }, service: [unrelated, { $: { 'android:name': expoServiceName } }] }] } };
  const once = await apply(input), snapshot = structuredClone(once);
  assert.deepEqual(await apply(once), snapshot);
  assert.deepEqual(once.manifest.application[0].service[0], unrelated);
  const permissions = once.manifest['uses-permission'].map(item => item.$['android:name']);
  for (const name of ['INTERNET', 'POST_NOTIFICATIONS', 'USE_FULL_SCREEN_INTENT', 'VIBRATE', 'FOREGROUND_SERVICE_MICROPHONE']) assert.ok(permissions.includes(`android.permission.${name}`));
  assert.equal(permissions.includes('android.permission.SYSTEM_ALERT_WINDOW'), false);
});

test('incoming call Activity can show on a locked screen without becoming publicly launchable', () => {
  const activity = library.manifest.application[0].activity.find(item => item.$['android:name'] === '.TLinkIncomingCallActivity').$;
  assert.equal(activity['android:showWhenLocked'], 'true');
  assert.equal(activity['android:turnScreenOn'], 'true');
  assert.equal(activity['android:exported'], 'false');
  assert.match(native, /if \(fromPush && !enabled\(context\)\) return/);
});

// Native API contracts complement the signed Android build and device tests;
// these assertions cannot simulate notification policy or hardware ringing.
test('incoming notification retains Android denied-FSI fallback and pre-channel sound with bounded ringing', () => {
  const incoming = native.slice(native.indexOf('@Synchronized fun incoming('), native.indexOf('@Synchronized fun answer('));
  assert.match(incoming, /builder\.setFullScreenIntent\(open, true\)/);
  assert.doesNotMatch(incoming, /canUseFullScreenIntent/, 'Android decides between full-screen and expanded heads-up display');
  assert.match(incoming, /\.setSound\(RingtoneManager\.getDefaultUri\(RingtoneManager\.TYPE_RINGTONE\)\)/);
  assert.match(incoming, /\.setVibrate\(longArrayOf\(/);
  assert.match(incoming, /NotificationCompat\.CallStyle\.forIncomingCall/);
  assert.match(incoming, /\.coerceIn\(1, 45_000\)/);
  assert.match(incoming, /\.setTimeoutAfter\(remaining\)/);
  assert.match(incoming, /Notification\.FLAG_INSISTENT/);
  assert.match(incoming, /getLong\("answerUntil", 0\) <= System\.currentTimeMillis\(\)/);
});

test('Android carries caller identity without persisting the invitation capability', () => {
  assert.match(native, /Person\.Builder\(\)\.setName\(call\.callerName\)/);
  assert.match(native, /setContentTitle\(call\.callerName\)/);
  assert.match(native, /text = invitation\.callerName/);
  const json = native.slice(native.indexOf('fun json()'), native.indexOf('fun connecting()'));
  assert.match(json, /"callerName" to callerName/);
  assert.doesNotMatch(json, /answerToken/);
  assert.match(native, /answerTokens\.remove\(id\)/);
  assert.match(native, /AsyncFunction\("acknowledgeEvents"\)/);
});
