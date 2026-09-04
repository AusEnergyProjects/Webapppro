import test from "node:test";
import assert from "node:assert/strict";
import { NEM_INTERVAL_MS } from "../src/lib/nem-wholesale.ts";
import { MIN_RELIABLE_PRICE_INTERVALS, wholesalePriceSnapshot } from "../src/lib/wholesale-price-snapshot.ts";

const electricityPoints = (count = 288, price = 10) => Array.from({ length: count }, (_, index) => ({
  time: (index + 1) * NEM_INTERVAL_MS,
  centsPerKwh: price,
}));

const gasPoint = (time, validUntil, centsPerKwh, status = "verified") => ({
  time,
  validUntil,
  centsPerKwh,
  dollarsPerGj: centsPerKwh / 0.36,
  basis: "schedule",
  status,
});

test("a reliable snapshot uses matched interval midpoints and the same price window for both fuels", () => {
  const count = MIN_RELIABLE_PRICE_INTERVALS;
  const electricity = electricityPoints().map((point, index) => ({ ...point, centsPerKwh: index < count ? 10 : 1_000 }));
  const result = wholesalePriceSnapshot(electricity, [
    gasPoint(0, NEM_INTERVAL_MS, 1),
    gasPoint(NEM_INTERVAL_MS, count * NEM_INTERVAL_MS, 3),
  ]);
  assert.equal(result.hasReliableGasWindow, true);
  assert.equal(result.matchedIntervalCount, count);
  assert.equal(result.electricityIntervalCount, 288);
  assert.equal(result.verifiedGasIntervalCount, count);
  assert.equal(result.forecastGasIntervalCount, 0);
  assert.equal(result.gasPriceUsesForecast, false);
  assert.equal(result.electricityPrice, 10);
  assert.notEqual(result.gasPrice, null);
  assert.equal(Number(result.gasPrice.toFixed(6)), Number(((1 + (count - 1) * 3) / count).toFixed(6)));
});

test("a published gas forecast completes the current snapshot and remains explicit in the result", () => {
  const verifiedCount = 240;
  const forecastCount = 48;
  const result = wholesalePriceSnapshot(electricityPoints(), [
    gasPoint(0, verifiedCount * NEM_INTERVAL_MS, 2),
    gasPoint(verifiedCount * NEM_INTERVAL_MS, (verifiedCount + forecastCount) * NEM_INTERVAL_MS, 4, "forecast"),
  ]);
  assert.equal(result.hasReliableGasWindow, true);
  assert.equal(result.matchedIntervalCount, 288);
  assert.equal(result.verifiedGasIntervalCount, verifiedCount);
  assert.equal(result.forecastGasIntervalCount, forecastCount);
  assert.equal(result.gasPriceUsesForecast, true);
  assert.equal(result.gasPrice, (verifiedCount * 2 + forecastCount * 4) / 288);
});

test("sparse windows do not become 24-hour cost comparisons", () => {
  const sparseCount = MIN_RELIABLE_PRICE_INTERVALS - 1;
  const sparseElectricity = wholesalePriceSnapshot(electricityPoints(sparseCount), null);
  assert.equal(sparseElectricity.hasReliableElectricityWindow, false);
  assert.equal(sparseElectricity.electricityPrice, null);

  const sparseGas = wholesalePriceSnapshot(electricityPoints(), [gasPoint(0, sparseCount * NEM_INTERVAL_MS, 2)]);
  assert.equal(sparseGas.hasReliableGasWindow, false);
  assert.equal(sparseGas.gasPrice, null);
  assert.equal(sparseGas.gasPriceUsesForecast, false);
  assert.equal(sparseGas.electricityPrice, 10);
});

test("a forecast-only window cannot be presented as a comparable gas snapshot", () => {
  const result = wholesalePriceSnapshot(electricityPoints(), [gasPoint(0, 288 * NEM_INTERVAL_MS, 2, "forecast")]);
  assert.equal(result.matchedIntervalCount, 288);
  assert.equal(result.verifiedGasIntervalCount, 0);
  assert.equal(result.forecastGasIntervalCount, 288);
  assert.equal(result.hasReliableGasWindow, false);
  assert.equal(result.gasPrice, null);
  assert.equal(result.gasPriceUsesForecast, false);
});

test("electricity-only regions retain a reliable snapshot and negative prices", () => {
  const result = wholesalePriceSnapshot(electricityPoints(288, -2), null);
  assert.equal(result.hasReliableElectricityWindow, true);
  assert.equal(result.hasReliableGasWindow, false);
  assert.equal(result.electricityPrice, -2);
  assert.equal(result.gasPrice, null);
  assert.equal(result.forecastGasIntervalCount, 0);
  assert.equal(result.verifiedGasIntervalCount, 0);
  assert.equal(result.matchedIntervalCount, 0);
});
