import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  resetTradeDashboardStateOnUidChange,
  tradeRebatePreparingMessage,
} from "../src/components/trade-rebate-calculator-state.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const workspace = read("../src/components/TradeRebateCalculatorWorkspace.tsx");
const calculator = read("../src/components/CreditexAllProgramCalculator.tsx");
const sresCalculator = read("../src/components/CreditexSresCalculator.tsx");
const access = read("../src/lib/creditex-calculator-access-server.ts");
const programEstimateRoute = read("../src/app/api/creditex/program-estimates/route.ts");
const stcEstimateRoute = read("../src/app/api/creditex/stc-estimates/route.ts");
const officialProductsRoute = read("../src/app/api/creditex/official-products/route.ts");
const stcProductsRoute = read("../src/app/api/creditex/stc-products/route.ts");

test("verified installers can open the governed rebate calculator from the trade rail", () => {
  assert.match(dashboard, /"calculator"/);
  assert.match(dashboard, />Calculator</);
  assert.match(dashboard, /Rebates for quotes and invoices/);
  assert.match(dashboard, /workspace === "calculator"/);
  assert.match(dashboard, /<TradeRebateCalculatorWorkspace key=\{user\.uid\} user=\{user\}/);
  assert.match(dashboard, /profile\?\.partnerType === "supplier" && workspace === "calculator"/);
  assert.match(workspace, /Calculate before you quote/);
  assert.match(workspace, /<CreditexAllProgramCalculator api=\{api\} role="trade"/);
  assert.match(workspace, /requestWithCreditexTokenRecovery/);
});

test("Firebase UID transitions synchronously reset protected dashboard state", () => {
  const events = [];
  const changed = resetTradeDashboardStateOnUidChange(
    "installer-a",
    "installer-b",
    () => events.push("reset"),
  );
  assert.equal(changed, true);
  assert.deepEqual(events, ["reset"]);

  const unchanged = resetTradeDashboardStateOnUidChange(
    "installer-b",
    "installer-b",
    () => events.push("unexpected"),
  );
  assert.equal(unchanged, false);
  assert.deepEqual(events, ["reset"]);

  assert.match(dashboard, /const previousUid = protectedIdentityUid\.current;[\s\S]*resetTradeDashboardStateOnUidChange\([\s\S]*previousUid,[\s\S]*nextUid,[\s\S]*clearProtectedInstallerState/);
  for (const reset of [
    /setProfile\(null\)/,
    /setOpportunities\(\[\]\)/,
    /setWorkspace\("work"\)/,
    /setCommandTarget\(null\)/,
    /setInstallerPlanPreview\(null\)/,
  ]) {
    assert.match(dashboard, reset);
  }
});

test("calculator preparation state has deterministic retry and terminal values", () => {
  assert.equal(
    tradeRebatePreparingMessage(1),
    "Preparing governed calculator controls (1 of 10)...",
  );
  assert.equal(
    tradeRebatePreparingMessage(9),
    "Preparing governed calculator controls (9 of 10)...",
  );
  assert.equal(tradeRebatePreparingMessage(null), "");
  assert.match(
    workspace,
    /try \{[\s\S]*requestWithCreditexTokenRecovery[\s\S]*\} finally \{\s*setPreparingMessage\(tradeRebatePreparingMessage\(null\)\);\s*\}/,
  );
  assert.match(workspace, /catch \(error\) \{[\s\S]*AbortError[\s\S]*throw new Error/);
  assert.match(workspace, /assertActiveIdentity\(\);[\s\S]*continue;/);
});

test("calculator APIs accept compliance users or verified installers and nothing broader", () => {
  assert.match(access, /requireComplianceIdentity\(identity/);
  assert.match(access, /requireVerifiedTradeIdentity\(identity/);
  assert.match(access, /partnerTypes: \["installer"\]/);
  assert.match(access, /CREDITEX_CALCULATOR_ACCESS_REQUIRED/);
  for (const route of [
    programEstimateRoute,
    stcEstimateRoute,
    officialProductsRoute,
    stcProductsRoute,
  ]) {
    assert.match(route, /requireCreditexCalculatorAccess\(request, database\)/);
  }
});

test("trade access remains estimate-only and cannot refresh an official registry", () => {
  assert.match(calculator, /role: "admin" \| "case_manager" \| "reviewer" \| "auditor" \| "trade"/);
  assert.match(sresCalculator, /role === "admin" && !productBlocker/);
  assert.match(workspace, /do not create,[\s\S]*register or trade certificates/);
  assert.match(officialProductsRoute, /allowedRoles: \["admin"\]/);
  assert.match(stcProductsRoute, /allowedRoles: \["admin"\]/);
  assert.doesNotMatch(workspace, /refreshRegistry|Refresh now/);
});
