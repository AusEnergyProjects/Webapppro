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

test('same-origin API caches by postcode and customer type', () => {
  assert.match(route, /postcode \+ ":" \+ customerType/);
  assert.match(route, /s-maxage=3600/);
  assert.match(route, /loadElectricityPlans\(\{ postcode, customerType \}\)/);
});

test('comparison discloses tariff freshness and partial source coverage', () => {
  assert.match(comparator, /Tariff source check:/);
  assert.match(comparator, /detailPlansSucceeded/);
  assert.match(comparator, /may not represent the complete market/);
  assert.match(comparator, /refreshes automatically every hour/);
  assert.match(comparator, /Calculation engine/);
  assert.match(comparator, /Source evidence/);
  assert.match(comparator, /failed tariff validation/);
});
