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
  assert.match(evidence, /Creditex review/);
});

test('compliance jobs expose exact activity and evidence requirement contracts', () => {
  assert.match(types, /compliance\?:\s*FieldJobCompliance/);
  assert.match(types, /evidencePolicyVersionId:\s*string/);
  assert.match(types, /requirements:\s*ComplianceEvidenceRequirement\[\]/);
  assert.match(jobScreen, /complianceRequirements\.map/);
  assert.match(jobScreen, /timing\.startsWith\('pre_'\)/);
  assert.match(jobScreen, /timing\.startsWith\('post_'\)/);
  assert.match(jobScreen, /GPS required/);
  assert.match(jobScreen, /requirement\.gpsRequired \|\| requirement\.metadataRequired/);
  assert.match(jobScreen, /Camera required/);
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
  assert.match(uploads, /row\.session_id\s*\?\s*await resume\(row\)\s*:\s*await initiate\(row\)/);
  assert.match(uploads, /'EVIDENCE_LOCATION_INVALID'/);
  assert.match(uploads, /'EVIDENCE_GPS_MOCKED'/);
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
