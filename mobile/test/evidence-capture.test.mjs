import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const jobScreen = read('../src/app/job/[id].tsx');
const evidence = read('../src/lib/evidence.ts');
const database = read('../src/lib/database.ts');
const encryptedFiles = read('../src/lib/encrypted-files.ts');
const uploads = read('../src/lib/uploads.ts');
const types = read('../src/lib/types.ts');
const syncScreen = read('../src/app/(tabs)/sync.tsx');
const syncRoute = read('../../src/app/api/trade-team/sync/route.ts');
const app = JSON.parse(read('../app.json'));

test('camera capture preserves the picker output and explicitly requests available EXIF', () => {
  assert.match(jobScreen, /allowsEditing:\s*false/);
  assert.match(jobScreen, /quality:\s*1/);
  assert.match(jobScreen, /exif:\s*true/);
  assert.match(jobScreen, /CameraType\.back/);
  assert.doesNotMatch(jobScreen, /quality:\s*0\.82|exif:\s*false/);
});

test('capture envelope records governed identifiers, observed time, permissions, location and provenance', () => {
  for (const field of [
    'captureSessionId',
    'complianceCaseId',
    'complianceActivityVersionId',
    'evidencePolicyVersionId',
    'evidenceRequirementId',
    'evidenceRequirementCode',
    'observedAtUtc',
    'utcOffsetMinutes',
    'timeZone',
    'cameraPermission',
    'locationPermission',
    'accuracyMetres',
    'altitudeMetres',
    'headingDegrees',
    'installationId',
    'nativeBuildVersion',
  ]) {
    assert.match(evidence, new RegExp(`\\b${field}\\b`), `missing ${field}`);
  }
  assert.match(evidence, /status:\s*'not_assessed'/);
  assert.match(evidence, /compliance review/);
});

test('compliance jobs expose exact activity and evidence requirement contracts', () => {
  assert.match(types, /complianceCases\?:\s*FieldJobCompliance\[\]/);
  assert.match(types, /compliance\?:\s*FieldJobCompliance/);
  assert.match(types, /evidencePolicyVersionId:\s*string/);
  assert.match(types, /requirements:\s*ComplianceEvidenceRequirement\[\]/);
  assert.match(jobScreen, /complianceCases\.map/);
  assert.match(jobScreen, /timing\.startsWith\('pre_'\)/);
  assert.match(jobScreen, /timing\.startsWith\('post_'\)/);
  assert.match(jobScreen, /GPS required/);
  assert.match(jobScreen, /requirement\.gpsRequired \|\| requirement\.metadataRequired/);
  assert.match(types, /description:\s*string/);
  assert.match(types, /acceptedCount:\s*number/);
  assert.match(types, /submittedCount:\s*number/);
  assert.match(types, /allowedContentTypes:\s*string\[\]/);
  assert.match(types, /captureModes:\s*Array<'camera' \| 'document'>/);
  assert.match(types, /requiresConditionEvaluation:\s*boolean/);
  assert.match(types, /requiresSignatureCapture:\s*boolean/);
  assert.match(types, /requiresDynamicFieldSchema:\s*boolean/);
  assert.match(syncRoute, /r\.description requirement_description/);
  assert.match(syncRoute, /r\.allowed_content_types/);
  assert.match(syncRoute, /r\.installer_signature_required/);
  assert.match(syncRoute, /r\.customer_signature_required/);
  assert.match(syncRoute, /r\.condition_snapshot/);
  assert.match(syncRoute, /r\.field_schema/);
  assert.match(syncRoute, /acceptedCount/);
  assert.match(syncRoute, /submittedCount/);
  assert.match(jobScreen, /maximumReached\(requirement\)/);
  assert.match(jobScreen, /captureModes\.includes\('camera'\)/);
  assert.match(jobScreen, /captureModes\.includes\('document'\)/);
  assert.match(jobScreen, /The policy maximum has been submitted/);
  assert.match(jobScreen, /Capture date and time required/);
  assert.match(jobScreen, /compatibilityBlockers\.map/);
  assert.match(jobScreen, /No governed evidence requirements have been assigned/);
});

test('exact bytes are SHA-256 hashed, encrypted and stored with a durable envelope', () => {
  assert.match(encryptedFiles, /source\.bytes\(\)/);
  assert.match(encryptedFiles, /digest\(CryptoDigestAlgorithm\.SHA256,\s*plaintext\)/);
  assert.match(encryptedFiles, /plaintext\.subarray/);
  assert.match(database, /evidence_envelope TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(database, /ALTER TABLE upload_queue ADD COLUMN evidence_envelope/);
  assert.match(database, /completeEvidenceEnvelope/);
  assert.match(database, /JSON\.stringify\(evidenceEnvelope\)/);
  assert.match(database, /withTransactionAsync/);
  assert.match(database, /input\.clearSettingKey/);
});

test('resumable upload initiation sends the persisted evidence envelope', () => {
  assert.match(uploads, /evidenceEnvelope:\s*evidenceEnvelope\(row\)/);
  assert.match(uploads, /row\.session_id\s*\?\s*await resume\(row,\s*mode\)\s*:\s*await initiate\(row,\s*mode\)/);
  assert.match(uploads, /'EVIDENCE_LOCATION_INVALID'/);
  assert.match(uploads, /'EVIDENCE_GPS_MOCKED'/);
  assert.match(uploads, /'EVIDENCE_MAXIMUM_REACHED'/);
  assert.match(uploads, /'EVIDENCE_REQUIREMENT_UNSUPPORTED'/);
  assert.match(jobScreen, /ImagePicker\.getPendingResultAsync\(\)/);
  assert.match(jobScreen, /PENDING_PHOTO_SETTING/);
});

test('location is foreground-only and uses an explicit evidence permission message', () => {
  const locationPlugin = app.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-location');
  assert.ok(locationPlugin);
  assert.equal(locationPlugin[1].isIosBackgroundLocationEnabled, false);
  assert.equal(locationPlugin[1].isAndroidBackgroundLocationEnabled, false);
  assert.equal(locationPlugin[1].isAndroidForegroundServiceEnabled, false);
  assert.match(locationPlugin[1].locationWhenInUsePermission, /installation location.*field evidence/i);
  assert.match(evidence, /requestForegroundPermissionsAsync/);
  assert.doesNotMatch(evidence, /requestBackgroundPermissionsAsync/);
});

test('camera recovery retains the observations persisted before picker launch', () => {
  const recovery = jobScreen.match(
    /const recoverPendingPhoto[\s\S]*?(?=\n  useFocusEffect)/,
  )?.[0];
  const pendingProcessor = jobScreen.match(
    /const processPendingPhoto[\s\S]*?(?=\n  const recoverPendingPhoto)/,
  )?.[0];
  const cameraCapture = jobScreen.match(
    /async function capturePhoto[\s\S]*?(?=\n  async function chooseDocument)/,
  )?.[0];

  assert.ok(recovery);
  assert.ok(pendingProcessor);
  assert.ok(cameraCapture);
  assert.match(pendingProcessor, /const location = pending\.preCaptureLocation/);
  assert.match(
    pendingProcessor,
    /const locationPermission = pending\.preCaptureLocationPermission/,
  );
  assert.doesNotMatch(pendingProcessor, /observeLocation\(/);
  assert.doesNotMatch(recovery, /observedTime\(\)/);
  assert.doesNotMatch(
    cameraCapture,
    /pending = \{\s*\.\.\.pending,\s*\.\.\.observedTime\(\)/,
  );
  assert.ok(
    cameraCapture.indexOf('...observedTime()')
      < cameraCapture.indexOf('ImagePicker.launchCameraAsync'),
    'the capture observation must be persisted before picker launch',
  );
});

test('GPS governed capture rejects mocked or imprecise locations before queueing', () => {
  const blocker = jobScreen.match(
    /function gpsPreflightBlocker[\s\S]*?(?=\nfunction pendingPhoto)/,
  )?.[0];
  const cameraCapture = jobScreen.match(
    /async function capturePhoto[\s\S]*?(?=\n  async function chooseDocument)/,
  )?.[0];

  assert.ok(blocker);
  assert.ok(cameraCapture);
  assert.match(blocker, /location\.mocked === true/);
  assert.match(blocker, /location\.accuracyMetres > 100/);
  assert.match(blocker, /location\.accuracyMetres === null/);
  assert.match(
    cameraCapture,
    /gpsPreflightBlocker\(preCaptureLocation\.location\)/,
  );
  assert.ok(
    cameraCapture.indexOf('gpsPreflightBlocker(preCaptureLocation.location)')
      < cameraCapture.indexOf(
        "setSetting(PENDING_PHOTO_SETTING, JSON.stringify(pending))",
      ),
    'GPS preflight must run before the pending capture is queued',
  );
});

test('manual compliance jobs cannot show or queue unsupported time entries', () => {
  const addTime = jobScreen.match(
    /async function addTime[\s\S]*?(?=\n  async function saveForm)/,
  )?.[0];

  assert.ok(addTime);
  assert.match(
    addTime,
    /job\.fieldLane === 'creditex_manual'/,
  );
  assert.ok(
    addTime.indexOf("job.fieldLane === 'creditex_manual'")
      < addTime.indexOf("type: 'add_time_entry'"),
    'the manual-lane guard must run before the time action is queued',
  );
  assert.match(
    jobScreen,
    /\{!creditexManual \? <View style=\{styles\.card\}>[\s\S]*TIME ENTRY[\s\S]*<\/View> : null\}/,
  );
});

test('assigned work packs identify Creditex only inside the governed activity workflow', () => {
  assert.match(jobScreen, /Dispatch or Creditex must resolve it before regulated work starts/);
  assert.match(jobScreen, /return pack \? <ActivityWorkPackWizard/);
  assert.doesNotMatch(jobScreen, /Creditex[^\n]*customer identity|send[^\n]*Creditex[^\n]*customer/i);
  assert.doesNotMatch(syncScreen, /Creditex/);
});

test('conflict retry uses the current child revision for tasks and forms', () => {
  assert.match(
    syncScreen,
    /action\.type === 'set_task_status'[\s\S]*job\.tasks\.find/,
  );
  assert.match(
    syncScreen,
    /action\.type === 'save_job_form'[\s\S]*job\.forms\.find/,
  );
});

test('conflict retry atomically replaces the queued action without a deletion gap', () => {
  const storageHelper = database.match(
    /export async function retryConflict[\s\S]*?(?=\nexport async function discardAction)/,
  )?.[0];
  const screenRetry = syncScreen.match(
    /async function retry\(item: QueueRow\)[\s\S]*?(?=\n  function discard)/,
  )?.[0];

  assert.ok(storageHelper);
  assert.ok(screenRetry);
  assert.match(storageHelper, /UPDATE action_queue[\s\S]*SET id = \?, work_order_id = \?, field_lane = \?, payload = \?/);
  assert.match(storageHelper, /WHERE id = \? AND work_order_id = \? AND field_lane = \? AND status = 'conflict'/);
  assert.match(storageHelper, /result\.changes !== 1/);
  assert.doesNotMatch(storageHelper, /\bDELETE\b|\bINSERT\b/);
  assert.match(screenRetry, /await retryConflict\(item\.id,/);
  assert.doesNotMatch(screenRetry, /await discardAction|await queueAction/);
});
