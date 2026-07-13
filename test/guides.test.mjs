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
const start = read("../src/components/GettingStarted.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");

test("solar and battery guides are connected to the shared journey", () => {
  assert.match(chrome, /href: "\/guides"/);
  assert.match(overview, /href="\/guides\/solar"/);
  assert.match(overview, /href="\/guides\/batteries"/);
  assert.match(start, /href="\/guides\/solar"/);
  assert.match(start, /href="\/guides\/batteries"/);
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

test("guide copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${overview}${solar}${batteries}`, /[–—]/);
});
