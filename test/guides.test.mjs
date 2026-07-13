import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIO_COST_ASSUMPTIONS } from "../src/lib/electricity/energy-flow.ts";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const overview = read("../src/app/guides/page.tsx");
const solar = read("../src/app/guides/solar/page.tsx");
const batteries = read("../src/app/guides/batteries/page.tsx");
const heating = read("../src/app/guides/heating/page.tsx");
const hotWater = read("../src/app/guides/hot-water/page.tsx");
const insulation = read("../src/app/guides/insulation-draught-proofing/page.tsx");
const start = read("../src/components/GettingStarted.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const rebates = read("../src/components/RebatesHub.tsx");

test("solar and battery guides are connected to the shared journey", () => {
  assert.match(chrome, /href: "\/guides"/);
  assert.match(overview, /href="\/guides\/solar"/);
  assert.match(overview, /href="\/guides\/batteries"/);
  assert.match(overview, /href="\/guides\/heating"/);
  assert.match(overview, /href="\/guides\/hot-water"/);
  assert.match(overview, /href="\/guides\/insulation-draught-proofing"/);
  assert.match(start, /href="\/guides\/solar"/);
  assert.match(start, /href="\/guides\/batteries"/);
  assert.match(start, /href="\/guides\/heating"/);
  assert.match(start, /href="\/guides\/hot-water"/);
  assert.match(start, /href="\/guides\/insulation-draught-proofing"/);
  assert.match(start, /href="\/rebates"/);
  assert.match(overview, /href="\/rebates"/);
  assert.match(rebates, /href="\/guides"/);
});

test("solar guidance distinguishes household use, exports and written quote evidence", () => {
  assert.match(solar, /Solar used in the home/);
  assert.match(solar, /Solar exported to the grid/);
  assert.match(solar, /site-specific layout/);
  assert.match(solar, /Small-scale technology certificates/);
  assert.match(solar, /Solar Accreditation Australia/);
});

test("battery guidance matches the dated federal support assumptions", () => {
  assert.equal(SCENARIO_COST_ASSUMPTIONS.version, "2026-07-14");
  assert.equal(SCENARIO_COST_ASSUMPTIONS.batteryStcFactor, 6.8);
  assert.equal(SCENARIO_COST_ASSUMPTIONS.batterySupportedUsableKwh, 50);
  assert.match(batteries, /5 to 100 kWh/);
  assert.match(batteries, /First 50 kWh/);
  assert.match(batteries, /6\.8 per supported kWh/);
  assert.match(batteries, /100% through 14 kWh, 60% above 14 through 28 kWh, and 15% above 28 through 50 kWh/);
  assert.match(batteries, /Backup is not automatic/);
});

test("heating guidance separates building load, climate performance and quote evidence", () => {
  assert.match(heating, /Seal and insulate/);
  assert.match(heating, /Zoned Energy Rating Label/);
  assert.match(heating, /3 to 6 units/);
  assert.match(heating, /Do not size from floor area alone/);
  assert.match(heating, /location and eligibility dependent/);
});

test("hot water guidance covers demand, performance and current certificate checks", () => {
  assert.match(hotWater, /rated hot water delivery/);
  assert.match(hotWater, /about 30% of the energy/);
  assert.match(hotWater, /no mandatory Energy Rating Label/);
  assert.match(hotWater, /Small-scale Technology Certificates/);
  assert.match(hotWater, /exact model must be on the Clean Energy Regulator register/);
});

test("insulation guidance covers building fabric, ventilation and safety boundaries", () => {
  assert.match(insulation, /Reduce the building load before replacing equipment/);
  assert.match(insulation, /Product R value is not the whole result/);
  assert.match(insulation, /thermal bridges/);
  assert.match(insulation, /licensed electrician assess wiring/);
  assert.match(insulation, /Do not block ventilation required for an unflued gas heater/);
  assert.match(insulation, /Airtightness and ventilation are different/);
  assert.match(insulation, /Australian Government household guide/);
  assert.match(insulation, /Your Home ventilation and airtightness/);
});

test("heating and hot water copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${heating}${hotWater}${insulation}`, /\u2013|\u2014/);
});

test("guide copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${overview}${solar}${batteries}`, /[–—]/);
});
