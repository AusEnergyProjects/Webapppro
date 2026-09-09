import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as guards from "../public/electricity-tariff-guards.mjs";

const html = fs.readFileSync(new URL("../public/electricity-comparator.html", import.meta.url), "utf8");
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const tree = ts.createSourceFile("legacy.js", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionSource = (name) => tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree);
const estimate = new Function(...Object.keys(guards), `${functionSource("estimateContract")}; return estimateContract;`)(...Object.values(guards));
const annual = { startDate: "01-01", endDate: "12-31", rateBlockUType: "singleRate", dailySupplyCharge: 1, singleRate: { rates: [{ unitPrice: 0.25 }] } };

test("legacy and native rankings share fail-closed seasonal, solar and availability rules", () => {
  for (const contract of [
    { tariffPeriod: [{ ...annual, endDate: "01-31" }] },
    { tariffPeriod: [annual, annual] },
    { tariffPeriod: [annual], solarFeedInTariff: [{ singleTariff: { rates: [{ unitPrice: 0.12, volume: 5 }, { unitPrice: 0.02 }] } }] },
    { tariffPeriod: [annual], solarFeedInTariff: [{ startDate: "2026-09-01", singleTariff: { rates: [{ unitPrice: 0.12 }] } }] },
    { tariffPeriod: [annual], solarFeedInTariff: [{ timeVaryingTariffs: [{ rates: [{ unitPrice: 0.12 }] }] }] },
  ]) assert.equal(estimate(contract, 4000, 3650, [], { exportProfile: [] }), null);
  assert.equal(estimate({ tariffPeriod: [annual] }, 4000, 0, [], { plan: { effectiveTo: "2000-01-01" } }), null);
});

test("legacy recomputation removes expired offers instead of retaining their previous total", () => {
  const state = { inputs: {}, plans: [{ name: "expired", effectiveTo: "2000-01-01", contract: {}, est: { total: 1 } }, { name: "current", contract: {}, est: { total: 2 } }] };
  const recompute = new Function("S", "$", "num", "estimateContract", `${functionSource("recompute")}; return recompute;`)(
    state, () => ({ checked: false }), Number,
    (_contract, _annual, _exports, _profile, options) => guards.isElectricityPlanAvailable(options.plan) ? { total: 3 } : null,
  );
  recompute();
  assert.deepEqual(state.plans.map((plan) => [plan.name, plan.est.total]), [["current", 3]]);
});
