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
const cooking = read("../src/app/guides/cooking/page.tsx");
const evCharging = read("../src/app/guides/ev-charging/page.tsx");
const homeUpgrades = read("../src/app/guides/home-energy-upgrades/page.tsx");
const diagnostics = read("../src/app/blower-door-thermal-imaging/page.tsx");
const assessments = read("../src/app/assessments/page.tsx");
const start = read("../src/components/GettingStarted.tsx");
const navigation = read("../src/components/ResponsiveSiteNav.tsx");
const rebates = read("../src/components/RebatesHub.tsx");

test("solar and battery guides are connected to the shared journey", () => {
  assert.match(overview, /import Link from "next\/link"/);
  assert.doesNotMatch(overview, /<a\s+href="\//);
  assert.match(navigation, /\["\/guides", "Guides"\]/);
  assert.match(overview, /href="\/guides\/solar"/);
  assert.match(overview, /href="\/guides\/batteries"/);
  assert.match(overview, /href="\/guides\/heating"/);
  assert.match(overview, /href="\/guides\/hot-water"/);
  assert.match(overview, /href="\/guides\/insulation-draught-proofing"/);
  assert.match(overview, /href="\/guides\/cooking"/);
  assert.match(overview, /href="\/guides\/ev-charging"/);
  assert.match(overview, /href="\/plan"/);
  assert.match(start, /"\/guides\/solar"/);
  assert.match(start, /"\/guides\/batteries"/);
  assert.match(start, /"\/guides\/heating"/);
  assert.match(start, /"\/guides\/hot-water"/);
  assert.match(start, /"\/guides\/insulation-draught-proofing"/);
  assert.match(start, /href="\/rebates"/);
  assert.match(overview, /href="\/rebates"/);
  assert.match(rebates, /href="\/guides"/);
});

test("cooking and EV charging guides cover enabling work and authority", () => {
  assert.match(cooking, /electrical capacity/);
  assert.match(cooking, /Gas isolation, capping and appliance removal/);
  assert.match(cooking, /Australian Government electrification guidance/);
  assert.match(evCharging, /daily driving/);
  assert.match(evCharging, /load management/);
  assert.match(evCharging, /owners corporation approval/);
  assert.match(evCharging, /Australian Government charging guidance/);
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

test("home upgrade guidance puts the scope before incentives", () => {
  assert.match(homeUpgrades, /Home Electrification and Energy Upgrades/);
  assert.match(homeUpgrades, /Plan appliance replacement before something fails/);
  assert.match(homeUpgrades, /The final gas appliance/);
  assert.match(homeUpgrades, /Australian Government electrification guidance/);
  assert.match(homeUpgrades, /One clear sequence, with the right specialists/);
  assert.match(homeUpgrades, /Independent evidence first/);
  assert.match(homeUpgrades, /RACE for 2030 one-stop shop research/);
  assert.match(homeUpgrades, /reviewedIso="2026-09-04"/);
  assert.match(homeUpgrades, /rebates and finance after the scope is clear/i);
  assert.match(homeUpgrades, /Do not assume two incentives can be combined/);
  assert.match(homeUpgrades, /Household Energy Upgrades Fund/);
  assert.match(homeUpgrades, /href: "\/plan"/);
});

test("building diagnostics guidance is actionable, bounded and connected", () => {
  assert.match(diagnostics, /path: "\/blower-door-thermal-imaging"/);
  assert.match(diagnostics, /parent=\{\{ name: "Assessments", href: "\/assessments", active: "assessments" \}\}/);
  assert.match(diagnostics, /outer shell/);
  assert.match(diagnostics, /leakage rate for each square metre/);
  assert.match(diagnostics, /where framing or another path carries heat around the insulation/);
  assert.match(diagnostics, /thermogram, or thermal image/);
  assert.match(diagnostics, /calibrated fan and pressure measurements/);
  assert.match(diagnostics, /image does not prove the cause on its own/);
  assert.match(diagnostics, /Conditions affect the image/);
  assert.match(diagnostics, /combustion appliances before pressure testing/);
  assert.match(diagnostics, /Separate diagnostics from formal ratings/);
  assert.match(diagnostics, /Your Home ventilation and airtightness/);
  assert.match(diagnostics, /CSIRO air infiltration research/);
  for (const source of [overview, insulation, start, navigation, assessments]) {
    assert.match(source, /\/blower-door-thermal-imaging/);
  }
  assert.match(assessments, /A diagnostic test is not automatically a formal rating/);
  assert.match(read("../src/components/AuthoritativeGuidePage.tsx"), /Sources and official guidance/);
});

test("heating and hot water copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${heating}${hotWater}${insulation}${diagnostics}`, /\u2013|\u2014/);
});

test("guide copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${overview}${solar}${batteries}${cooking}${evCharging}${homeUpgrades}`, /[–—]/);
});
