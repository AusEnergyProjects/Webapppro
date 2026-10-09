import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  createPlannerComparisonIntent,
  readPlannerComparisonHandoff,
  mapPlannerComparisonFacts,
  PLANNER_COMPARISON_INTENT_KEY,
  PLANNER_COMPARISON_MAX_AGE_MS,
} from "../src/lib/planner-comparison-handoff.ts";
import { HOME_ENERGY_ASSESSMENT_STORAGE_KEY } from "../src/lib/home-energy-assessment-storage.ts";
import { buildComparisonToolLink } from "../src/lib/comparison-navigation.ts";
import { createHomeEnergyPlannerSession, defaultHomeEnergyPlannerDraft, sanitizeHomeEnergyPlannerDraft } from "../src/lib/home-energy-planner-schema.ts";

const now = 1_800_000_000_000;
function draft(overrides = {}) {
  return defaultHomeEnergyPlannerDraft(sanitizeHomeEnergyPlannerDraft({
    goals: ["lower-bills"], situation: "owner", postcode: "3006", propertyType: "house",
    occupants: "two", pace: "staged", budgetRange: "not_set", gasConnection: "connected", features: [], ...overrides,
  }));
}
function storage(serialized, target = "electricity", time = now) {
  const local = new Map([[HOME_ENERGY_ASSESSMENT_STORAGE_KEY, serialized]]);
  const tab = new Map([[HOME_ENERGY_ASSESSMENT_STORAGE_KEY, serialized], [PLANNER_COMPARISON_INTENT_KEY, createPlannerComparisonIntent(serialized, target, time)]]);
  const api = (map) => ({ getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) });
  return { local: api(local), tab: api(tab), localValues: local, tabValues: tab };
}
const session = (overrides = {}, stage = 4) => JSON.stringify(createHomeEnergyPlannerSession(draft(overrides), stage));

test("cross-tool links carry only a valid current postcode and leave unknown values out", () => {
  for (const [target, route] of [["gas", "/gas-compare"], ["electricity", "/compare"]]) {
    assert.equal(buildComparisonToolLink(target, "3006"), `${route}?pc=3006`);
    assert.equal(buildComparisonToolLink(target, " 0800 "), `${route}?pc=0800`);
    for (const value of ["", "300", "9999", "3006&mj=50000", "../../../plan"]) assert.equal(buildComparisonToolLink(target, value), route);
    assert.deepEqual([...new URL(buildComparisonToolLink(target, "3006"), "https://example.invalid").searchParams.keys()], ["pc"]);
  }
});

test("a fresh intentional handoff reads only the matching canonical session and is consumed once", () => {
  const saved = storage(session());
  assert.equal(readPlannerComparisonHandoff("?from=home-plan", "electricity", saved, now).postcode, "3006");
  assert.equal(saved.tab.getItem(PLANNER_COMPARISON_INTENT_KEY), null);
  assert.equal(readPlannerComparisonHandoff("?from=home-plan", "electricity", saved, now), null);
  const intent = JSON.parse(createPlannerComparisonIntent(session(), "gas", now));
  assert.deepEqual(Object.keys(intent).sort(), ["createdAt", "fingerprint", "target", "version"]);
  assert.doesNotMatch(JSON.stringify(intent), /3006|gas-heating|owner|features|occupants/);
});

test("ordinary visits, wrong target, missing or corrupt sessions and stale intents never inherit answers", () => {
  for (const [search, target, elapsed] of [["", "electricity", 0], ["?from=other", "electricity", 0], ["?from=home-plan", "gas", 0], ["?from=home-plan", "electricity", PLANNER_COMPARISON_MAX_AGE_MS + 1], ["?from=home-plan", "electricity", -1]]) {
    assert.equal(readPlannerComparisonHandoff(search, target, storage(session()), now + elapsed), null);
  }
  for (const mutation of [
    (saved) => saved.tabValues.delete(PLANNER_COMPARISON_INTENT_KEY),
    (saved) => saved.tabValues.set(PLANNER_COMPARISON_INTENT_KEY, "{broken"),
    (saved) => { saved.localValues.clear(); saved.tabValues.delete(HOME_ENERGY_ASSESSMENT_STORAGE_KEY); },
    (saved) => saved.localValues.set(HOME_ENERGY_ASSESSMENT_STORAGE_KEY, "{broken"),
    (saved) => saved.localValues.set(HOME_ENERGY_ASSESSMENT_STORAGE_KEY, session({ postcode: "2000" })),
    (saved) => saved.tabValues.set(PLANNER_COMPARISON_INTENT_KEY, JSON.stringify({ ...JSON.parse(saved.tab.getItem(PLANNER_COMPARISON_INTENT_KEY)), version: 2 })),
  ]) {
    const saved = storage(session()); mutation(saved);
    assert.equal(readPlannerComparisonHandoff("?from=home-plan", "electricity", saved, now), null);
  }
});

test("unreviewed defaults and incompatible canonical versions cannot create handoff intents", () => {
  assert.equal(createPlannerComparisonIntent(session({}, 0), "electricity", now), null);
  assert.equal(createPlannerComparisonIntent(session({ postcode: "9999" }), "electricity", now), null);
  assert.equal(createPlannerComparisonIntent(JSON.stringify({ ...JSON.parse(session()), version: 2 }), "electricity", now), null);
});

test("explicit URL postcode or business context cannot receive a different residential household's equipment", () => {
  for (const query of ["?from=home-plan&pc=2000", "?from=home-plan&postcode=2000", "?from=home-plan&cust=BUSINESS"]) {
    assert.equal(readPlannerComparisonHandoff(query, "electricity", storage(session()), now), null);
  }
  assert.equal(readPlannerComparisonHandoff("?from=home-plan&pc=3006", "electricity", storage(session()), now).postcode, "3006");
});

test("tab fallback matches the planner and unavailable storage stays optional", () => {
  const saved = storage(session(), "gas"); saved.localValues.clear();
  assert.equal(readPlannerComparisonHandoff("?source=home-plan", "gas", saved, now).postcode, "3006");
  const blockedLocal = storage(session()); blockedLocal.local.getItem = () => { throw new Error("blocked"); };
  assert.equal(readPlannerComparisonHandoff("?from=home-plan", "electricity", blockedLocal, now).postcode, "3006");
  const blockedTab = storage(session()); blockedTab.tab.getItem = () => { throw new Error("blocked"); };
  assert.equal(readPlannerComparisonHandoff("?from=home-plan", "electricity", blockedTab, now), null);
});

test("only confirmed existing solar combinations map; no capacity, bill volume or home EV charging is invented", () => {
  const mappings = [["solar-none", "battery-none", "none"], ["solar", "battery-none", "solar"], ["solar", "battery", "battery"], ["solar", "battery-unknown", undefined], ["solar-unknown", "battery-none", undefined], ["solar-none", "battery", undefined]];
  for (const [solar, battery, expected] of mappings) {
    const mapped = mapPlannerComparisonFacts(draft({ features: [solar, battery, "ev"] }));
    assert.equal(mapped.electricitySetup, expected);
    for (const guessed of ["solarKw", "batteryKwh", "annualKwh", "annualMj", "hasEv"]) assert.equal(guessed in mapped, false);
  }
  assert.equal(mapPlannerComparisonFacts(draft({ goals: ["add-solar-storage"] })).electricitySetup, "none");
});

test("generic gas heating stays generic and unknown water type or broad household ranges stay unanswered", () => {
  const mapped = mapPlannerComparisonFacts(draft({ features: ["gas-heating", "gas-hot-water-type-unknown", "mixed-cooking"], occupants: "three_four" }));
  assert.deepEqual(mapped.gasEquipment, { heating: ["gas-unspecified"], hotWater: "", gasCooking: true, people: "" });
  assert.equal(mapped.gasSupply, "mains");
  assert.equal(mapPlannerComparisonFacts(draft({ gasConnection: "bottled-lpg" })).gasSupply, "lpg");
  assert.equal(mapPlannerComparisonFacts(draft({ gasConnection: "not-connected" })).gasSupply, undefined);
  const ambiguous = mapPlannerComparisonFacts(draft({ features: ["reverse-cycle", "hydronic-heating", "solar-hot-water", "cooking-unknown"], occupants: "five_plus" }));
  assert.deepEqual(ambiguous.gasEquipment, { heating: [], hotWater: "", gasCooking: undefined, people: "" });
});

test("exact known hot-water and cooking answers map without changing their fuel or subtype", () => {
  for (const [feature, expected] of [["gas-storage-hot-water", "gas-storage"], ["gas-continuous-flow-hot-water", "gas-instant"], ["heat-pump-hot-water", "heat-pump"], ["electric-storage-hot-water", "electric"], ["electric-instant-hot-water", "electric"], ["hot-water-other", "other"]]) {
    const mapped = mapPlannerComparisonFacts(draft({ features: [feature, "induction-cooking", "wood-heating"], occupants: "one" }));
    assert.equal(mapped.gasEquipment.hotWater, expected);
    assert.equal(mapped.gasEquipment.gasCooking, false);
    assert.equal(mapped.gasEquipment.people, "1");
    assert.deepEqual(mapped.gasEquipment.heating, ["other"]);
  }
});

test("UI handoffs preserve URL restoration and skip late hydration after customer edits", () => {
  const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const electricity = read("../src/components/electricity/NativeElectricityComparator.tsx");
  const gas = read("../src/components/GasComparator.tsx");
  const planner = read("../src/components/HomeEnergyPlanner.tsx");
  const questionnaire = read("../src/components/GasUpgradeQuestionnaire.tsx");
  for (const source of [electricity, gas]) {
    assert.match(source, /if \(cancelled \|\| comparisonEditedRef\.current\) return;/);
    assert.match(source, /onChangeCapture=\{\(\) => \{ comparisonEditedRef\.current = true;/);
    assert.match(source, /void import\("@\/lib\/planner-comparison-handoff"\)/);
  }
  assert.match(electricity, /if \(!restored\.postcode\) setPostcode\(handoff\.postcode\)/);
  assert.match(electricity, /if \(!restored\.setupMode\)/);
  assert.match(electricity, /if \(!restored\.batteryKwh\) setBatteryKwh\(""\)/);
  assert.match(electricity, /if \(plannerSetupNeedsConfirmation\) \{ setError/);
  const inputKey = electricity.slice(electricity.indexOf("const comparisonInputKey ="), electricity.indexOf("useLayoutEffect(() =>"));
  assert.match(inputKey, /setupMode,\s*plannerSetupNeedsConfirmation,/);
  assert.match(inputKey, /\}\), \[[^\]]*plannerSetupNeedsConfirmation/);
  assert.match(electricity, /if \(comparisonInputKeyRef\.current !== requestedInputKey\)/);
  assert.match(planner, /onComparisonStart=\{startComparison\}/);
  assert.match(planner, /onClick=\{\(\) => startComparison\("electricity"\)\}/);
  assert.match(planner, /onClick=\{\(\) => startComparison\("gas"\)\}/);
  assert.match(questionnaire, /HOT_WATER_GAS_MJ\[hotWaterType\] && Number\(people\) > 0/);
  const profiles = questionnaire.slice(questionnaire.indexOf("const heatingProfiles ="), questionnaire.indexOf("const heatingBenchmark ="));
  assert.doesNotMatch(profiles, /gas-unspecified/);
});
