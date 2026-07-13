/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const validationModule = import('../src/lib/lead-validation.mjs');

function validComparison() {
  return {
    submissionType: 'comparison',
    name: 'Test Customer',
    email: 'test@example.com',
    postcode: '3000',
    annualKwh: 5000,
    hasControlledLoad: true,
    provenance: {
      engineVersion: 'aea-electricity-engine-2.2.0',
      tariffSchemaVersion: 'aea-electricity-tariff-1.0.0',
      sourceHash: 'sha256:abc123',
      sourceFetchedAt: '2026-07-13T10:00:00.000Z',
      annualSource: 'meter-measured',
      meterConfidence: 'high',
      conditionalDiscountsAssumed: false,
    },
    consent: {
      accepted: true,
      purpose: 'Email comparison results',
      noticeVersion: '2026-07-13',
      grantedAt: new Date().toISOString(),
    },
  };
}

test('lead validation accepts a consented comparison request', async () => {
  const { validateLeadPayload } = await validationModule;
  const result = validateLeadPayload(validComparison());
  assert.equal(result.ok, true);
  assert.equal(result.value.email, 'test@example.com');
  assert.equal(result.value.submissionType, 'comparison');
  assert.equal(result.value.provenance.engineVersion, 'aea-electricity-engine-2.2.0');
  assert.equal(result.value.provenance.annualSource, 'meter-measured');
  assert.equal(result.value.hasControlledLoad, true);
});

test('lead validation rejects a request without consent evidence', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  delete payload.consent;
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /confirm/i);
});

test('upgrade enquiries require at least one contact method', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.submissionType = 'upgrade';
  payload.email = '';
  payload.phone = '';
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /email address or phone/i);
});

test('only three plan summaries are accepted', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.top3 = new Array(6).fill(null).map((_, index) => ({ rank: index + 1, brand: 'Brand', plan: 'Plan' }));
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, true);
  assert.equal(result.value.top3.length, 3);
});

test('lead validation drops meter identifiers and interval data', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.nmi = '6407123456';
  payload.filename = 'private-meter.csv';
  payload.intervals = [{ timestamp: '2026-01-01T00:00:00', kwh: 1.2 }];
  payload.overrideReason = 'private household detail';
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, true);
  assert.equal('nmi' in result.value, false);
  assert.equal('filename' in result.value, false);
  assert.equal('intervals' in result.value, false);
  assert.equal('overrideReason' in result.value, false);
});
