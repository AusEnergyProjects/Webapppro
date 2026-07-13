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
    top3: [{ rank: 1, brand: 'Example Energy', plan: 'Example Saver', annual: 1400, monthly: 117, link: 'https://example.com/plan' }],
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
  payload.top3 = new Array(6).fill(null).map((_, index) => ({ rank: index + 1, brand: 'Brand', plan: 'Plan', annual: 1200 + index }));
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

test('comparison emails require complete usage and plan results', async () => {
  const { validateLeadPayload } = await validationModule;
  const noPlans = validComparison();
  noPlans.top3 = [];
  assert.equal(validateLeadPayload(noPlans).ok, false);

  const noUsage = validComparison();
  noUsage.annualKwh = 0;
  assert.equal(validateLeadPayload(noUsage).ok, false);
});

test('gas and electricity upgrade enquiries retain their scenario values', async () => {
  const { validateLeadPayload } = await validationModule;
  const electricity = validComparison();
  electricity.submissionType = 'upgrade';
  electricity.enquiry = 'electricity-battery';
  electricity.batteryKwh = 13.5;
  electricity.installedCost = 8900;
  electricity.annualSaving = 1280;
  const electricityResult = validateLeadPayload(electricity);
  assert.equal(electricityResult.ok, true);
  assert.equal(electricityResult.value.installedCost, 8900);

  const gas = validComparison();
  gas.submissionType = 'upgrade';
  gas.enquiry = 'gas-hot-water';
  gas.annualMj = 58000;
  gas.installedCost = 3200;
  gas.annualSaving = 740;
  const gasResult = validateLeadPayload(gas);
  assert.equal(gasResult.ok, true);
  assert.equal(gasResult.value.annualMj, 58000);
});

test('direct trade project briefs retain only allowlisted project fields', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.submissionType = 'upgrade';
  payload.enquiry = 'direct-trade-project';
  payload.state = 'Vic';
  payload.projectCategories = ['solar', 'battery', 'not-a-service'];
  payload.propertyType = 'house';
  payload.propertyRelationship = 'owner-occupier';
  payload.projectPriorities = ['lower-running-costs', 'improve-comfort', 'not-allowed'];
  payload.projectStage = 'assessment-ready';
  payload.timeframe = 'one-three-months';
  payload.preferredContact = 'email';
  payload.projectNotes = 'Interested in a staged upgrade.';
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.projectCategories, ['solar', 'battery']);
  assert.equal(result.value.state, 'Vic');
  assert.equal(result.value.propertyType, 'house');
  assert.equal(result.value.propertyRelationship, 'owner-occupier');
  assert.deepEqual(result.value.projectPriorities, ['lower-running-costs', 'improve-comfort']);
  assert.equal(result.value.projectNotes, 'Interested in a staged upgrade.');
});

test('direct trade project briefs require location, service and project details', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.submissionType = 'upgrade';
  payload.enquiry = 'direct-trade-project';
  payload.state = 'Vic';
  payload.projectCategories = ['not-a-service'];
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /service/i);
});

test('direct trade project briefs reject a known postcode and state mismatch', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.submissionType = 'upgrade';
  payload.enquiry = 'direct-trade-project';
  payload.state = 'NSW';
  payload.projectCategories = ['solar'];
  payload.propertyType = 'house';
  payload.projectStage = 'seeking-quotes';
  payload.timeframe = 'one-three-months';
  payload.preferredContact = 'email';
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /usually in Victoria/i);
});

test('direct trade project briefs require a property role and matching priority', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.submissionType = 'upgrade';
  payload.enquiry = 'direct-trade-project';
  payload.state = 'VIC';
  payload.projectCategories = ['heating-cooling'];
  payload.propertyType = 'house';
  payload.propertyRelationship = 'owner-occupier';
  payload.projectPriorities = ['not-allowed'];
  payload.projectStage = 'researching';
  payload.timeframe = 'later';
  payload.preferredContact = 'phone';
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /project priority/i);
});

test('direct trade partner enquiries retain allowlisted participation fields', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.submissionType = 'upgrade';
  payload.enquiry = 'direct-trade-partner';
  payload.partnerType = 'supplier';
  payload.businessName = 'Example Energy Supply';
  payload.businessWebsite = 'https://example.com.au';
  payload.serviceStates = ['Vic', 'NSW', 'not-a-state'];
  payload.projectCategories = ['battery', 'hot-water', 'not-a-category'];
  payload.partnerNotes = 'National warranty support and local stock.';
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, true);
  assert.equal(result.value.partnerType, 'supplier');
  assert.equal(result.value.businessName, 'Example Energy Supply');
  assert.deepEqual(result.value.serviceStates, ['Vic', 'NSW']);
  assert.deepEqual(result.value.projectCategories, ['battery', 'hot-water']);
});

test('direct trade partner enquiries require business coverage and capability', async () => {
  const { validateLeadPayload } = await validationModule;
  const payload = validComparison();
  payload.submissionType = 'upgrade';
  payload.enquiry = 'direct-trade-partner';
  payload.partnerType = 'installer';
  payload.businessName = 'Example Electrical';
  payload.serviceStates = [];
  payload.projectCategories = ['solar'];
  const result = validateLeadPayload(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /service area/i);
});
