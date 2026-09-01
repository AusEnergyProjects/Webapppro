/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const comparator = fs.readFileSync(path.resolve(__dirname, '../public/electricity-comparator.html'), 'utf8');
const route = fs.readFileSync(path.resolve(__dirname, '../src/app/api/electricity-plans/route.js'), 'utf8');

test('browser requests normalized electricity plans only from the same-origin API', () => {
  assert.match(comparator, /const PLAN_API = '\/api\/electricity-plans'/);
  assert.match(comparator, /electricity-provenance-v2:/);
  assert.doesNotMatch(comparator, /energy-prd-endpoints\.json/);
  assert.doesNotMatch(comparator, /cds-au\/v1\/energy\/plans\?fuelType=ELECTRICITY/);
});

test('same-origin API uses the bounded electricity plan cache', () => {
  assert.match(route, /createElectricityPlanCache/);
  assert.match(route, /s-maxage=3600/);
  assert.match(route, /loadElectricityPlans\(\{ postcode, customerType \}\)/);
  assert.match(route, /planCache\.get\(query\.postcode, query\.customerType\)/);
  assert.match(route, /last_known_good/);
  assert.match(route, /s-maxage=60, stale-while-revalidate=300/);
  assert.match(route, /Warning: '110 - "Response is stale"'/);
  assert.match(route, /status: 502[\s\S]*?"Cache-Control": "no-store"/);
});

test('plan API emits privacy-safe operational metrics and a correlation ID', () => {
  assert.match(route, /createOperationalRecorder\(\{ event: "api\.electricity_plans" \}\)/);
  assert.match(route, /"X-Request-Id": operations\.requestId/);
  assert.match(route, /detailPlansRejected/);
  assert.match(route, /detailPlansUnavailable/);
  assert.match(route, /listSourcesTimedOut/);
  assert.match(route, /detailPlansTimedOut/);
  assert.match(route, /detailPlansSkipped/);
  assert.match(route, /cacheFallback/);
});

test('comparison discloses tariff freshness and partial source coverage', () => {
  assert.match(comparator, /Tariff source check:/);
  assert.match(comparator, /detailPlansSucceeded/);
  assert.match(comparator, /may not represent the complete market/);
  assert.match(comparator, /Current CDR plan records, retrieved within the last hour/);
  assert.match(comparator, /Retrieval time does not replace the retailer/);
  assert.match(comparator, /Calculation engine/);
  assert.match(comparator, /Source evidence/);
  assert.match(comparator, /failed tariff validation/);
  assert.match(comparator, /timed out/);
  assert.match(comparator, /last successful/);
});
