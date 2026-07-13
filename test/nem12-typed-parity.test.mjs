import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { allocateNem12Registers, parseNem12 as parseTyped, scaleNem12AnnualAllocation } from "../src/lib/electricity/nem12.ts";
import { buildNem12ChartModel } from "../src/lib/electricity/nem12-chart.ts";

const require = createRequire(import.meta.url);
const legacy = require("../public/electricity-model.js");

function record300(date, values, quality = "A") {
  return ["300", date, ...values.map(String), quality, "", "", "", ""].join(",");
}

function fixture(days) {
  const rows = ["100,NEM12,202607112215,FROM,TO"];
  rows.push("200,6400000000,E1,E1,E1,,METER1,kWh,30,");
  days.forEach((date, index) => rows.push(record300(date, new Array(48).fill(index % 2 ? 0.5 : 1))));
  rows.push("200,6400000000,E2,E2,E2,,METER1,kWh,30,");
  days.forEach((date) => rows.push(record300(date, new Array(48).fill(0.2))));
  rows.push("900");
  return rows.join("\r\n");
}

function assertParity(source) {
  const typed = parseTyped(source);
  const compatibility = legacy.parseNem12(source);
  assert.equal(typed.ok, compatibility.ok);
  assert.equal(typed.ok, true);
  assert.equal(compatibility.ok, true);
  assert.equal(typed.nmi, compatibility.nmi);
  assert.equal(typed.spanDays, compatibility.spanDays);
  assert.equal(typed.dateSpanDays, compatibility.dateSpanDays);
  assert.ok(Math.abs(typed.importKwh - compatibility.importKwh) < 1e-9);
  assert.ok(Math.abs(typed.annualImport - compatibility.annualImport) < 1e-9);
  assert.ok(Math.abs(typed.actualPct - compatibility.actualPct) < 1e-9);
  assert.deepEqual(typed.qualityCounts, compatibility.qualityCounts);
  assert.deepEqual(typed.intervalLengths, compatibility.intervalLengths);
  assert.deepEqual(typed.grid, compatibility.grid);
  assert.deepEqual(typed.registers.map(({ id, suffix, observedKwh, suggestedRole }) => ({ id, suffix, observedKwh, suggestedRole })),
    compatibility.registers.map(({ id, suffix, observedKwh, suggestedRole }) => ({ id, suffix, observedKwh, suggestedRole })));
  return typed;
}

test("typed NEM12 parser stays in parity with the compatibility parser", () => {
  const source = fixture(["20260105", "20260106", "20260107", "20260108", "20260109", "20260110", "20260111"]);
  const typed = assertParity(source);
  const chart = buildNem12ChartModel(typed);
  assert.equal(chart.weekday.length, 48);
  assert.equal(chart.weekend?.length, 48);
  assert.equal(chart.peakPercent + chart.shoulderPercent + chart.offPeakPercent, 100);
});

test("typed register allocation requires confirmation and stays in compatibility parity", () => {
  const typed = parseTyped(fixture(["20260105", "20260106", "20260107", "20260108", "20260109", "20260110", "20260111"]));
  assert.equal(typed.ok, true);
  const unresolved = allocateNem12Registers(typed.registers, {});
  assert.equal(unresolved.ok, false);
  assert.deepEqual(unresolved.unresolved, typed.registers.map((register) => register.id));
  const roles = { [typed.registers[0].id]: "general", [typed.registers[1].id]: "controlled" };
  const allocated = allocateNem12Registers(typed.registers, roles);
  const compatibility = legacy.allocateRegisters(typed.registers, roles);
  assert.equal(allocated.ok, true);
  assert.equal(compatibility.ok, true);
  assert.deepEqual(allocated.series, compatibility.series);
  assert.equal(allocated.annualGeneralKwh, compatibility.annualGeneralKwh);
  assert.equal(allocated.annualControlledKwh, compatibility.annualControlledKwh);
  assert.deepEqual(allocated.generalProfile, compatibility.generalProfile);
  assert.deepEqual(allocated.controlledProfile, compatibility.controlledProfile);
  assert.deepEqual(allocated.controlledRegisterIds, [typed.registers[1].id]);
});

test("reasoned annual overrides scale register totals without changing their allocation ratio", () => {
  const allocation = {
    ok: true,
    series: [],
    generalObservedKwh: 80,
    controlledObservedKwh: 20,
    annualGeneralKwh: 4000,
    annualControlledKwh: 1000,
    generalProfile: [],
    controlledProfile: [],
    controlledRegisterIds: ["controlled"],
  };
  const scaled = scaleNem12AnnualAllocation(allocation, 6000);
  assert.deepEqual(scaled, { scale: 1.2, annualGeneralKwh: 4800, annualControlledKwh: 1200 });
  assert.equal(scaleNem12AnnualAllocation(allocation, 0), null);
});

const suppliedFixture = process.env.NEM12_FIXTURE;
test("typed parser matches the compatibility parser for the supplied Origin fixture", { skip: !suppliedFixture }, () => {
  assertParity(fs.readFileSync(path.resolve(suppliedFixture), "utf8"));
});
