import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalEvidencePhotoCapture } from '../src/lib/trade-rental-evidence.mjs';

const capturedAt = '2026-09-01T03:04:05.000Z';
const captureTime = Date.parse(capturedAt);
const sevenDays = 7 * 24 * 60 * 60 * 1000;
const at = (offset) => new Date(captureTime + offset).toISOString();
const envelope = () => ({
  source: 'in_app_camera',
  capture: { captureObservedAtUtc: capturedAt, utcOffsetMinutes: 600, timeZone: 'Australia/Sydney' },
  location: { state: 'captured', observedAtUtc: capturedAt, latitude: -37.8, longitude: 144.9, accuracyMetres: 12, mocked: false },
});

test('delayed rental delivery preserves original evidence through the inclusive seven-day boundary', () => {
  for (const delay of [60 * 60 * 1000, 24 * 60 * 60 * 1000, sevenDays]) {
    const input = envelope();
    const before = structuredClone(input);
    const capture = rentalEvidencePhotoCapture(input, { receivedAtUtc: at(delay) });
    assert.equal(capture?.capturedAtUtc, capturedAt);
    assert.equal(capture?.locationObservedAtUtc, capturedAt);
    assert.equal(capture?.metadataBasis, 'device_reported');
    assert.deepEqual(input, before);
  }
  assert.equal(rentalEvidencePhotoCapture(envelope(), { receivedAtUtc: at(sevenDays + 1) }), null);
  const olderLocation = envelope(); olderLocation.location.observedAtUtc = at(-1);
  assert.equal(rentalEvidencePhotoCapture(olderLocation, { receivedAtUtc: at(sevenDays) }), null);
});

test('offline allowance retains capture-to-GPS, accuracy, mock and future-clock limits', () => {
  const receipt = { receivedAtUtc: at(24 * 60 * 60 * 1000) };
  const boundary = envelope();
  boundary.location.observedAtUtc = at(2 * 60 * 1000);
  boundary.location.accuracyMetres = 100;
  assert.ok(rentalEvidencePhotoCapture(boundary, receipt));
  for (const change of [
    (value) => { value.location.observedAtUtc = at(2 * 60 * 1000 + 1); },
    (value) => { value.location.observedAtUtc = at(-2 * 60 * 1000 - 1); },
    (value) => { value.location.accuracyMetres = 100.1; },
    (value) => { value.location.mocked = true; },
    (value) => { value.location.state = 'unavailable'; },
    (value) => { value.capture.captureObservedAtUtc = 'invalid'; },
  ]) {
    const input = envelope(); change(input);
    assert.equal(rentalEvidencePhotoCapture(input, receipt), null);
  }
  assert.ok(rentalEvidencePhotoCapture(envelope(), { receivedAtUtc: at(-5 * 60 * 1000) }));
  assert.equal(rentalEvidencePhotoCapture(envelope(), { receivedAtUtc: at(-5 * 60 * 1000 - 1) }), null);
  const futureLocation = envelope(); futureLocation.location.observedAtUtc = at(1);
  assert.equal(rentalEvidencePhotoCapture(futureLocation, { receivedAtUtc: at(-5 * 60 * 1000) }), null);
  assert.equal(rentalEvidencePhotoCapture(envelope(), { receivedAtUtc: 'invalid' }), null);
});

test('later linking uses the original receipt and report rendering does not age accepted evidence', () => {
  const acceptedReceipt = at(24 * 60 * 60 * 1000);
  assert.ok(rentalEvidencePhotoCapture(envelope(), { receivedAtUtc: acceptedReceipt }));
  assert.ok(rentalEvidencePhotoCapture(envelope()));
  assert.equal(rentalEvidencePhotoCapture(envelope(), { receivedAtUtc: at(sevenDays + 1) }), null);
});
