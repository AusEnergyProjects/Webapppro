import assert from "node:assert/strict";
import test from "node:test";
import { createHomeEnergyPlan } from "../src/lib/home-energy-plan.mjs";

test("whole-home gas planning puts assessment and fabric before equipment", () => {
  const plan = createHomeEnergyPlan({ goal: "move-from-gas", pace: "whole-home", situation: "owner", features: ["draughty", "gas-heating", "gas-hot-water", "gas-cooking"] });
  const ids = plan.items.map((item) => item.id);
  assert.ok(ids.indexOf("assessment") < ids.indexOf("heating"));
  assert.ok(ids.indexOf("fabric") < ids.indexOf("heating"));
  assert.ok(ids.includes("hot-water"));
  assert.ok(ids.includes("cooking"));
  assert.equal(ids.at(-1), "brief");
});

test("urgent replacements lead with safety and a project-ready scope", () => {
  const plan = createHomeEnergyPlan({ goal: "replace-now", pace: "one-step", situation: "owner", features: ["gas-hot-water"] });
  assert.equal(plan.items[0].id, "urgent");
  assert.match(plan.title, /Move quickly/);
});

test("renters and strata households see approval before upgrade recommendations", () => {
  for (const situation of ["renter", "strata"]) {
    const plan = createHomeEnergyPlan({ goal: "add-solar-storage", situation, features: [] });
    assert.equal(plan.items[0].id, "authority");
  }
});

test("storage is not recommended without existing solar evidence", () => {
  const withoutSolar = createHomeEnergyPlan({ goal: "add-solar-storage", features: [] });
  const withSolar = createHomeEnergyPlan({ goal: "add-solar-storage", features: ["solar"] });
  assert.equal(withoutSolar.items.some((item) => item.id === "battery"), false);
  assert.equal(withSolar.items.some((item) => item.id === "battery"), true);
});

test("unknown planner inputs are discarded", () => {
  const plan = createHomeEnergyPlan({ goal: "unsafe", pace: "instant", situation: "unknown", features: ["solar", "nmi", "email"] });
  assert.equal(plan.goal, "lower-bills");
  assert.deepEqual(plan.features, ["solar"]);
});

test("active mains gas is compared separately from electricity", () => {
  const plan = createHomeEnergyPlan({ goal: "lower-bills", features: ["gas-heating"] });
  const ids = plan.items.map((item) => item.id);
  assert.ok(ids.includes("compare"));
  assert.ok(ids.includes("compare-gas"));
});

test("a detailed whole-home roadmap never drops the final project brief", () => {
  const plan = createHomeEnergyPlan({ goal: "replace-now", pace: "whole-home", features: ["draughty", "gas-heating", "gas-hot-water", "gas-cooking", "solar", "ev"] });
  assert.equal(plan.items.at(-1).id, "brief");
  assert.ok(plan.items.some((item) => item.id === "ev"));
});
