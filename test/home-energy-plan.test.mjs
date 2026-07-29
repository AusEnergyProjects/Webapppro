import assert from "node:assert/strict";
import test from "node:test";
import {
  createCustomerProjectPlan,
  customerProjectOptions,
} from "../src/lib/customer-projects.mjs";

test("the public quick plan combines multiple goals through the canonical advisor engine", () => {
  const plan = createCustomerProjectPlan({
    goals: ["move-from-gas", "improve-comfort", "healthier-home"],
    pace: "whole-home",
    situation: "owner",
    approvalContext: "none",
    features: [
      "draughty",
      "condensation-moisture",
      "single-glazing",
      "gas-heating",
      "gas-hot-water",
      "gas-cooking",
    ],
  });
  const ids = plan.items.map((item) => item.id);
  assert.deepEqual(plan.goals, [
    "move-from-gas",
    "improve-comfort",
    "healthier-home",
  ]);
  assert.match(plan.title, /priorities/i);
  assert.ok(ids.indexOf("moisture-ventilation") < ids.indexOf("heating"));
  assert.ok(ids.indexOf("draught-proofing") < ids.indexOf("heating"));
  assert.ok(ids.includes("windows-glazing"));
  assert.ok(ids.includes("hot-water"));
  assert.ok(ids.includes("cooking"));
});

test("ownership and shared-property approval remain separate inputs", () => {
  const renter = createCustomerProjectPlan({
    goals: ["add-solar-storage"],
    situation: "renter",
    approvalContext: "none",
  });
  const strataOwner = createCustomerProjectPlan({
    goals: ["add-solar-storage"],
    situation: "owner",
    approvalContext: "strata",
  });
  assert.equal(renter.situation, "renter");
  assert.equal(renter.approvalContext, "none");
  assert.equal(renter.items[0].id, "renter-friendly-actions");
  assert.equal(strataOwner.situation, "owner");
  assert.equal(strataOwner.approvalContext, "strata");
  assert.equal(strataOwner.items[0].id, "authority");
});

test("the selected planning budget changes the canonical roadmap without claiming a price", () => {
  for (const [budgetRange, itemId] of [
    ["under_2k", "budget-under-2k"],
    ["2_10k", "budget-2-10k"],
    ["10k_plus", "budget-10k-plus"],
  ]) {
    const plan = createCustomerProjectPlan({
      goals: ["improve-comfort"],
      situation: "owner",
      approvalContext: "none",
      budgetRange,
    });
    const budgetItem = plan.items.find((item) => item.id === itemId);
    assert.ok(budgetItem);
    assert.match(budgetItem.text, /price promise|quote|quotes/i);
  }
});

test("the canonical quick plan accepts every current controlled home feature", () => {
  const features = customerProjectOptions.homeFeatures.map(([value]) => value);
  const plan = createCustomerProjectPlan({
    goals: ["improve-comfort", "move-from-gas", "improve-resilience"],
    situation: "owner",
    approvalContext: "none",
    features,
  });
  assert.deepEqual(plan.features, features);
  assert.ok(plan.items.some((item) => item.id === "windows-glazing"));
  assert.ok(plan.items.some((item) => item.id === "window-shading"));
  assert.ok(plan.items.some((item) => item.id === "existing-reverse-cycle"));
  assert.ok(plan.items.some((item) => item.id === "existing-heat-pump-hot-water"));
});

test("unknown quick-plan inputs are discarded at the canonical boundary", () => {
  const plan = createCustomerProjectPlan({
    goals: ["lower-bills", "unsafe-goal"],
    pace: "instant",
    situation: "unknown",
    approvalContext: "unknown",
    budgetRange: "unlimited",
    features: ["solar", "nmi", "email"],
  });
  assert.deepEqual(plan.goals, ["lower-bills"]);
  assert.equal(plan.pace, "staged");
  assert.equal(plan.situation, "");
  assert.equal(plan.approvalContext, "none");
  assert.deepEqual(plan.features, ["solar"]);
  assert.equal(plan.items.some((item) => item.id.startsWith("budget-")), false);
});

test("storage is not recommended without existing solar evidence", () => {
  const withoutSolar = createCustomerProjectPlan({
    goals: ["add-solar-storage"],
    situation: "owner",
    approvalContext: "none",
    features: [],
  });
  const withSolar = createCustomerProjectPlan({
    goals: ["add-solar-storage"],
    situation: "owner",
    approvalContext: "none",
    features: ["solar"],
  });
  assert.equal(
    withoutSolar.items.some((item) => item.id === "battery"),
    false,
  );
  assert.equal(withSolar.items.some((item) => item.id === "battery"), true);
});
