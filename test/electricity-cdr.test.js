/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

test('postcode matching supports exact entries and inclusive ranges', async () => {
  const { postcodeMatches } = await import('../src/lib/electricity-cdr.mjs');
  assert.equal(postcodeMatches('3000', ['3000']), true);
  assert.equal(postcodeMatches('3000', ['2990-3010']), true);
  assert.equal(postcodeMatches('3011', ['2990-3010']), false);
});

test('CDR base validation permits HTTPS and rejects local or private targets', async () => {
  const { safeCdrBase } = await import('../src/lib/electricity-cdr.mjs');
  assert.equal(safeCdrBase('https://cdr.energymadeeasy.gov.au/agl/'), 'https://cdr.energymadeeasy.gov.au/agl');
  assert.equal(safeCdrBase('http://example.com/api'), null);
  assert.equal(safeCdrBase('https://localhost/api'), null);
  assert.equal(safeCdrBase('https://127.0.0.1/api'), null);
  assert.equal(safeCdrBase('https://172.20.0.1/api'), null);
  assert.equal(safeCdrBase('https://192.168.1.10/api'), null);
});

test('retailer customer links never fall back to CDR API namespaces', async () => {
  const { resolveCustomerPlanUrl, retailerWebsite, safeCustomerUrl } = await import('../src/lib/retailer-links.mjs');
  assert.equal(retailerWebsite('https://cdr.energymadeeasy.gov.au/ovo-energy', 'OVO Energy'), 'https://www.ovoenergy.com.au/');
  assert.equal(safeCustomerUrl('https://cdr.energymadeeasy.gov.au/ovo-energy'), null);
  assert.equal(safeCustomerUrl('javascript:alert(1)'), null);
  assert.equal(resolveCustomerPlanUrl(['https://cdr.energymadeeasy.gov.au/ovo-energy'], 'https://www.ovoenergy.com.au/'), 'https://www.ovoenergy.com.au/');
  assert.equal(resolveCustomerPlanUrl(['https://www.ovoenergy.com.au/electricity'], 'https://www.ovoenergy.com.au/'), 'https://www.ovoenergy.com.au/electricity');
});

test('plan summaries enforce customer, fuel and postcode eligibility', async () => {
  const { normalizePlanSummary } = await import('../src/lib/electricity-cdr.mjs');
  const retailer = { name: 'Example Energy', logo: null, base: 'https://cdr.example.com', retailerUrl: 'https://www.example.com/' };
  const plan = {
    planId: 'plan-1',
    displayName: 'Time Saver',
    customerType: 'RESIDENTIAL',
    fuelType: 'ELECTRICITY',
    geography: { includedPostcodes: ['3000-3005'], excludedPostcodes: ['3002'], distributors: ['CitiPower Pty Ltd'] },
    lastUpdated: '2026-07-10T00:00:00Z',
  };
  assert.equal(normalizePlanSummary(plan, retailer, '3002', 'RESIDENTIAL'), null);
  assert.equal(normalizePlanSummary(plan, retailer, '3000', 'BUSINESS'), null);
  assert.equal(normalizePlanSummary({ ...plan, fuelType: 'GAS' }, retailer, '3000', 'RESIDENTIAL'), null);
  const normalized = normalizePlanSummary(plan, retailer, '3000', 'RESIDENTIAL');
  assert.deepEqual(normalized.distributors, ['CitiPower']);
  assert.equal(normalized.lastUpdated, '2026-07-10T00:00:00Z');
  assert.equal(normalized.retailerUrl, 'https://www.example.com/');
  assert.equal(normalizePlanSummary({ ...plan, effectiveFrom: '2999-01-01T00:00:00Z' }, retailer, '3000', 'RESIDENTIAL'), null);
  assert.equal(normalizePlanSummary({ ...plan, effectiveTo: '2000-01-01T00:00:00Z' }, retailer, '3000', 'RESIDENTIAL'), null);
});

test('plan details retain the full contract used by interval pricing', async () => {
  const { normalizePlanDetail } = await import('../src/lib/electricity-cdr.mjs');
  const summary = { planId: 'plan-1', name: 'Time Saver', app: null, info: null, type: 'MARKET' };
  const contract = { tariffPeriod: [{ dailySupplyCharge: 1 }], eligibility: [{ type: 'EV' }], fees: [{ name: 'Late fee' }] };
  const normalized = normalizePlanDetail(summary, {
    data: { electricityContract: contract, additionalInformation: { overviewUri: 'https://example.com/plan' } },
  });
  assert.equal(normalized.contract, contract);
  assert.equal(normalized.link, 'https://example.com/plan');
  assert.equal(normalized.fees, 1);
  assert.equal(normalizePlanDetail(summary, { data: {} }), null);
});

test('loader reports partial source coverage without discarding successful plans', async () => {
  const { ELECTRICITY_CDR_DIRECTORY_URL, loadElectricityPlans } = await import('../src/lib/electricity-cdr.mjs');
  const responses = new Map([
    [ELECTRICITY_CDR_DIRECTORY_URL, { data: [
      { brandName: 'Good Energy', industries: ['energy'], productReferenceDataBaseUri: 'https://good.example/cdr' },
      { brandName: 'Unavailable Energy', industries: ['energy'], productReferenceDataBaseUri: 'https://bad.example/cdr' },
    ] }],
    ['https://good.example/cdr/cds-au/v1/energy/plans?fuelType=ELECTRICITY&effective=CURRENT&page-size=1000&page=1', {
      data: { plans: [{ planId: 'p1', displayName: 'Good TOU', customerType: 'RESIDENTIAL', fuelType: 'ELECTRICITY', type: 'MARKET', lastUpdated: '2026-07-10T00:00:00Z', geography: { includedPostcodes: ['3000'], distributors: ['CitiPower'] } }] },
      meta: { totalPages: 1 },
    }],
    ['https://good.example/cdr/cds-au/v1/energy/plans/p1', {
      data: { electricityContract: { tariffPeriod: [{ dailySupplyCharge: '1', rateBlockUType: 'singleRate', singleRate: { rates: [{ unitPrice: '0.25' }] } }] }, additionalInformation: { overviewUri: 'https://good.example/plan' } },
    }],
  ]);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (!responses.has(url)) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => responses.get(url) };
  };
  const result = await loadElectricityPlans({ postcode: '3000', customerType: 'RESIDENTIAL', fetchImpl, timeoutMs: 100 });
  assert.equal(result.plans.length, 1);
  assert.equal(result.source.retailersDiscovered, 2);
  assert.equal(result.source.listSourcesSucceeded, 1);
  assert.equal(result.source.listSourcesFailed, 1);
  assert.equal(result.source.partial, true);
  assert.equal(result.source.detailApiVersion, '3');
  assert.equal(result.source.plansWithLastUpdated, 1);
  assert.equal(result.source.plansMissingLastUpdated, 0);
  assert.equal(result.source.oldestPlanUpdatedAt, '2026-07-10T00:00:00.000Z');
  assert.deepEqual(result.source.retailerCoverage, [
    { retailer: 'Good Energy', listAvailable: true, candidatePlans: 1, detailsPassed: 1, detailsRejected: 0, detailsUnavailable: 0 },
    { retailer: 'Unavailable Energy', listAvailable: false, candidatePlans: 0, detailsPassed: 0, detailsRejected: 0, detailsUnavailable: 0 },
  ]);
  assert.deepEqual(calls.find((call) => call.url.includes('/energy/plans?')).headers, { 'x-v': '1', 'x-min-v': '1' });
  assert.deepEqual(calls.find((call) => call.url.endsWith('/energy/plans/p1')).headers, { 'x-v': '3', 'x-min-v': '3' });
  assert.match(result.sourceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.tariffSchemaVersion, 'aea-electricity-tariff-1.1.0');
});

test('loader rejects malformed tariffs and reports validation separately from unavailable details', async () => {
  const { ELECTRICITY_CDR_DIRECTORY_URL, loadElectricityPlans } = await import('../src/lib/electricity-cdr.mjs');
  const listUrl = 'https://strict.example/cdr/cds-au/v1/energy/plans?fuelType=ELECTRICITY&effective=CURRENT&page-size=1000&page=1';
  const detailUrl = 'https://strict.example/cdr/cds-au/v1/energy/plans/bad-plan';
  const fetchImpl = async (url) => {
    if (url === ELECTRICITY_CDR_DIRECTORY_URL) return { ok: true, json: async () => ({ data: [{ brandName: 'Strict Energy', industries: ['energy'], productReferenceDataBaseUri: 'https://strict.example/cdr' }] }) };
    if (url === listUrl) return { ok: true, json: async () => ({ data: { plans: [{ planId: 'bad-plan', customerType: 'RESIDENTIAL', fuelType: 'ELECTRICITY', geography: { includedPostcodes: ['3000'] } }] } }) };
    if (url === detailUrl) return { ok: true, json: async () => ({ data: { electricityContract: { tariffPeriod: [{ dailySupplyCharge: '1', rateBlockUType: 'singleRate', singleRate: { rates: [] } }] } } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const result = await loadElectricityPlans({ postcode: '3000', customerType: 'RESIDENTIAL', fetchImpl, timeoutMs: 100 });
  assert.equal(result.plans.length, 0);
  assert.equal(result.source.detailPlansRejected, 1);
  assert.equal(result.source.detailPlansUnavailable, 0);
  assert.equal(result.source.validationFailures['tariffPeriod[].singleRate.rates is required'], 1);
});
