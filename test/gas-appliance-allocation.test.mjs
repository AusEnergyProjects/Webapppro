import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { gasApplianceAllocationStatus } from "../src/lib/gas-appliance-allocation.ts";

const facts = { heating: ["gas-ducted"], hotWater: "gas-storage", people: "2" };

test("generic heating cannot allocate the full gas bill to known hot water", () => {
  const status = gasApplianceAllocationStatus({ ...facts, heating: ["gas-unspecified"] });
  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ["your gas heating type (ducted, slab or room)"]);
});

test("unknown hot water cannot allocate the full gas bill to known heating", () => {
  const status = gasApplianceAllocationStatus({ ...facts, hotWater: "" });
  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ["your hot-water type"]);
});

test("ranged or missing household answers do not invent hot-water allocation", () => {
  for (const people of ["", "three_four", "five_plus", "0", "1.5", "9"]) {
    const status = gasApplianceAllocationStatus({ ...facts, people });
    assert.equal(status.ready, false);
    assert.deepEqual(status.missing, ["the number of people in your household"]);
  }
  for (const people of ["1", "2", "8"]) assert.equal(gasApplianceAllocationStatus({ ...facts, people }).ready, true);
});

test("missing heating is distinct from an explicit None and non-gas hot water needs no household benchmark", () => {
  assert.equal(gasApplianceAllocationStatus({ ...facts, heating: [] }).ready, false);
  assert.equal(gasApplianceAllocationStatus({ ...facts, heating: ["none"] }).ready, true);
  assert.equal(gasApplianceAllocationStatus({ ...facts, hotWater: "electric", people: "" }).ready, true);
  assert.equal(gasApplianceAllocationStatus({ ...facts, hotWater: "heat-pump", people: "" }).ready, true);
});

test("the shared allocation guard pauses all appliance savings without blocking tariff comparison", () => {
  const questionnaire = fs.readFileSync(new URL("../src/components/GasUpgradeQuestionnaire.tsx", import.meta.url), "utf8");
  const comparator = fs.readFileSync(new URL("../src/components/GasComparator.tsx", import.meta.url), "utf8");
  assert.match(questionnaire, /const billScale = allocation\.ready && benchmarkGasMj > 0 \? use \/ benchmarkGasMj : 0;/);
  assert.match(questionnaire, /!allocation\.ready && <p className="note" role="status">Confirm/);
  assert.match(questionnaire, /Gas plans still use the bill usage you enter/);
  assert.ok(questionnaire.indexOf("!allocation.ready && <p") < questionnaire.indexOf("<div hidden={!questionsVisible}>"), "the explanation remains visible beside tariff results");
  assert.doesNotMatch(comparator, /gasApplianceAllocationStatus|allocation\.ready/);
  assert.match(comparator, /if \(!gasHeating\)/);
});
