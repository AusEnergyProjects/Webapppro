/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

function validContract() {
  return {
    tariffPeriod: [{
      startDate: '01-01', endDate: '12-31', dailySupplyCharge: '1.05', rateBlockUType: 'timeOfUseRates',
      timeOfUseRates: [{
        type: 'PEAK', period: 'P1D', rates: [{ unitPrice: '0.31' }],
        timeOfUse: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], startTime: '15:00', endTime: '21:00' }],
      }],
    }],
  };
}

test('strict validation accepts a priceable time of use contract', async () => {
  const { validateElectricityTariff } = await import('../src/lib/electricity-tariff-validation.mjs');
  assert.deepEqual(validateElectricityTariff(validContract()), {
    valid: true,
    schemaVersion: 'aea-electricity-tariff-1.1.0',
    errors: [],
    limitations: [],
  });
});

test('strict validation rejects missing or malformed usage rates', async () => {
  const { validateElectricityTariff } = await import('../src/lib/electricity-tariff-validation.mjs');
  const missingRates = validContract();
  missingRates.tariffPeriod[0].timeOfUseRates[0].rates = [];
  assert.equal(validateElectricityTariff(missingRates).valid, false);
  const negativeRate = validContract();
  negativeRate.tariffPeriod[0].timeOfUseRates[0].rates[0].unitPrice = '-0.20';
  assert.match(validateElectricityTariff(negativeRate).errors.join(' '), /unitPrice is invalid/);
});

test('strict validation rejects unknown rate blocks instead of allowing a zero usage charge', async () => {
  const { validateElectricityTariff } = await import('../src/lib/electricity-tariff-validation.mjs');
  const contract = validContract();
  contract.tariffPeriod[0].rateBlockUType = 'futureTariffShape';
  assert.equal(validateElectricityTariff(contract).valid, false);
  assert.match(validateElectricityTariff(contract).errors.join(' '), /rateBlockUType is unsupported/);
});

test('known but unpriced features are classified as limitations', async () => {
  const { validateElectricityTariff } = await import('../src/lib/electricity-tariff-validation.mjs');
  const contract = validContract();
  contract.fees = [{ name: 'Late fee' }];
  contract.incentives = [{ name: 'Credit' }];
  contract.discounts = [{ methodUType: 'futureDiscount' }];
  assert.deepEqual(validateElectricityTariff(contract).limitations, [
    'fees_not_costed', 'incentives_not_costed', 'unsupported_discount_not_costed',
  ]);
});

test('controlled-load and supported demand tariffs pass strict priceability validation', async () => {
  const { validateElectricityTariff } = await import('../src/lib/electricity-tariff-validation.mjs');
  const contract = validContract();
  contract.controlledLoad = [{
    displayName: 'Controlled load 1', dailyCharge: '0.10', rateBlockUType: 'singleRate',
    singleRate: { period: 'P1D', rates: [{ unitPrice: '0.15' }] },
  }];
  contract.tariffPeriod.push({
    startDate: '01-01', endDate: '12-31', rateBlockUType: 'demandCharges',
    demandCharges: [{ amount: '0.20', startTime: '15:00', endTime: '21:00', days: ['MON', 'TUE'], measurementPeriod: 'MONTH', chargePeriod: 'DAY' }],
  });
  assert.deepEqual(validateElectricityTariff(contract), {
    valid: true,
    schemaVersion: 'aea-electricity-tariff-1.1.0',
    errors: [],
    limitations: [],
  });
});

test('unsupported demand periods and malformed controlled-load rates are rejected', async () => {
  const { validateElectricityTariff } = await import('../src/lib/electricity-tariff-validation.mjs');
  const contract = validContract();
  contract.controlledLoad = [{ rateBlockUType: 'singleRate', singleRate: { rates: [] } }];
  contract.tariffPeriod.push({ rateBlockUType: 'demandCharges', demandCharges: [{ amount: 0.2, startTime: '15:00', endTime: '21:00', days: ['MON'], measurementPeriod: 'YEAR', chargePeriod: 'MONTH' }] });
  const result = validateElectricityTariff(contract);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /controlledLoad\[0\].singleRate.rates is required/);
  assert.match(result.errors.join(' '), /measurementPeriod and chargePeriod are unsupported/);
});

test('tariff hashes are deterministic across object key order and change with rates', async () => {
  const { sha256, tariffSourceHash } = await import('../src/lib/electricity-tariff-validation.mjs');
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
  assert.notEqual(sha256({ rate: 0.2 }), sha256({ rate: 0.3 }));
  const first = tariffSourceHash([{ planId: 'b', tariffHash: '2' }, { planId: 'a', tariffHash: '1' }]);
  const second = tariffSourceHash([{ planId: 'a', tariffHash: '1' }, { planId: 'b', tariffHash: '2' }]);
  assert.equal(first, second);
});
