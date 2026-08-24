import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const appConfig = read("../mobile/app.json");
const database = read("../mobile/src/lib/database.ts");
const encryption = read("../mobile/src/lib/encrypted-files.ts");
const sync = read("../mobile/src/lib/sync.ts");
const api = read("../mobile/src/lib/api.ts");
const uploads = read("../mobile/src/lib/uploads.ts");
const background = read("../mobile/src/lib/background.ts");
const device = read("../mobile/src/lib/device.ts");
const fieldSession = read("../mobile/src/lib/field-session.ts");
const provider = read("../mobile/src/providers/app-provider.tsx");
const work = read("../mobile/src/app/(tabs)/work.tsx");
const newJob = read("../mobile/src/app/new-job.tsx");
const job = read("../mobile/src/app/job/[id].tsx");
const syncScreen = read("../mobile/src/app/(tabs)/sync.tsx");
const readme = read("../mobile/README.md");

test("native field app requires encrypted custom iOS and Android builds", () => {
  assert.match(appConfig, /"name": "TLink"/);
  assert.match(appConfig, /"version": "1\.0\.1"/);
  assert.match(appConfig, /"userInterfaceStyle": "dark"/);
  assert.match(appConfig, /"bundleIdentifier": "au\.com\.australianenergyassessments\.field"/);
  assert.match(appConfig, /"package": "au\.com\.australianenergyassessments\.field"/);
  assert.match(appConfig, /"useSQLCipher": true/);
  assert.match(appConfig, /"allowBackup": false/);
  assert.match(readme, /custom development build/);
  assert.match(readme, /Expo Go cannot run the SQLCipher/);
  assert.deepEqual(
    fs.readFileSync(new URL("../mobile/assets/images/icon.png", import.meta.url)),
    fs.readFileSync(new URL("../public/tlink-icon-512.png", import.meta.url)),
  );
});

test("offline records, actions and addresses use the encrypted database policy", () => {
  assert.match(database, /PRAGMA key/);
  assert.ok(database.indexOf("PRAGMA key") < database.indexOf("PRAGMA journal_mode"));
  assert.match(database, /CREATE TABLE IF NOT EXISTS jobs/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS action_queue/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS upload_queue/);
  assert.match(database, /ADDRESS_MAX_AGE_MS/);
  assert.match(database, /job\.serviceAddress = ''/);
  assert.match(database, /changes\.filter\(\(item\) => item\.operation === 'delete'\)/);
  assert.ok(database.indexOf("for (const change of changes.filter((item) => item.operation === 'delete'))")
    < database.indexOf("for (const change of changes.filter((item) => item.operation === 'upsert'"));
  assert.match(database, /deleteDatabaseAsync/);
  assert.match(database, /purgeEncryptionKey/);
});

test("field evidence is authenticated encrypted and resumable by part", () => {
  assert.match(encryption, /AESEncryptionKey/);
  assert.match(encryption, /aesEncryptAsync/);
  assert.match(encryption, /AESSealedData\.fromCombined/);
  assert.match(encryption, /aesDecryptAsync/);
  assert.match(encryption, /UPLOAD_PART_BYTES/);
  assert.match(encryption, /SecureStore\.setItemAsync/);
  assert.match(uploads, /action: 'initiate'/);
  assert.match(uploads, /action', 'upload_part'/);
  assert.match(uploads, /decryptQueuedPart/);
  assert.match(uploads, /completed\.has\(partNumber\)/);
  assert.match(uploads, /action: 'complete'/);
});

test("sync registers the device, safely replays work and handles revocation", () => {
  assert.match(sync, /registerDevice/);
  assert.match(sync, /sendActions/);
  assert.match(sync, /fetchChanges/);
  assert.match(sync, /response\.hasMore/);
  assert.match(sync, /DEVICE_REVOKED/);
  assert.match(sync, /DEVICE_REAUTHORISATION_REQUIRED/);
  assert.match(sync, /status === 426/);
  assert.match(device, /getDevicePushTokenAsync/);
  assert.match(device, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(background, /TaskManager\.defineTask/);
  assert.match(background, /minimumInterval: 15/);
  assert.match(provider, /NetInfo\.addEventListener/);
  assert.match(provider, /addNotificationResponseReceivedListener/);
  assert.match(provider, /addPushTokenListener/);
});

test("post-PIN access verification cannot stall before the secure API", () => {
  assert.match(provider, /NETWORK_STATUS_TIMEOUT_MS = 1_500/);
  assert.match(provider, /Promise\.race\(\[NetInfo\.fetch\(\)\.catch\(\(\) => null\), fallback\]\)/);
  assert.match(provider, /const verified = await verifyFieldAccess\(\);[\s\S]{0,300}setAccess\(approvedAccess\);\s*await prepareLocalDataOwner\(localOwnerKey\)/);
  assert.match(provider, /updateFieldPrincipalDisplayName\(verified\.fieldUsername\)/);
  assert.match(provider, /setLoading\(false\);[\s\S]{0,120}void syncNow\(\);/);
  assert.match(api, /JSON_REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(api, /controller\.abort\(\)/);
  assert.match(api, /'NETWORK_TIMEOUT'/);
  assert.match(sync, /MAX_SYNC_PAGES = 100/);
  assert.match(sync, /response\.hasMore && nextCursor === cursor/);
  assert.match(sync, /'SYNC_CURSOR_STALLED'/);
});

test("completed sync stays settled and new-job inputs remain readable", () => {
  assert.match(fieldSession, /principal\.displayName === nextDisplayName\) return null/);
  assert.match(provider, /const signedIn = Boolean\(user\)/);
  assert.match(provider, /if \(online && signedIn\) void syncNow\(\)/);
  assert.doesNotMatch(provider, /\[handleAccessError, syncNow, user\]/);
  assert.match(newJob, /backgroundColor: colours\.surfaceRaised/);
  assert.match(newJob, /color: colours\.ink/);
  assert.match(newJob, /placeholderTextColor=\{colours\.muted\}/);
  assert.match(newJob, /selectionColor=\{colours\.green\}/);
});

test("technician UI stays focused while retaining full field capability", () => {
  assert.match(work, /MY SCHEDULE/);
  assert.match(work, /router\.push\('\/new-job'\)/);
  assert.match(work, /setSelectedDate/);
  assert.match(work, /Australian Energy Assessments protected/);
  assert.match(job, /job\.workNumber/);
  assert.doesNotMatch(job, /setWorkNumber|changeWorkNumber|editWorkNumber/);
  assert.match(job, /advance_field_job/);
  assert.match(job, /set_task_status/);
  assert.match(job, /add_time_entry/);
  assert.match(job, /launchCameraAsync/);
  assert.match(job, /getDocumentAsync/);
  assert.match(syncScreen, /Apply to latest/);
  assert.match(syncScreen, /Discard/);
});

test("native field source and copy avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${appConfig}\n${database}\n${encryption}\n${sync}\n${uploads}\n${provider}\n${work}\n${job}\n${syncScreen}\n${readme}`, /[\u2013\u2014]/);
});
