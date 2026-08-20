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
  assert.match(workspace, /<CreditexAllProgramCalculator[\s\S]*api=\{api\}[\s\S]*role="trade"[\s\S]*documentDraftOwnerUid=\{user\.uid\}/);
  assert.match(workspace, /requestWithCreditexTokenRecovery/);
  assert.match(
    workspace,
    /options: \{ requestTimeoutMs\?: number \} = \{\}/,
  );
  assert.match(workspace, /options\.requestTimeoutMs \?\? 20_000/);
  assert.match(workspace, /requestTimeoutMs \/ 1_000/);
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

test("calculator preparation retries fleet work without presenting a fake attempt total", () => {
  const preparing =
    "Updating the exact official product register. Product choices will load automatically.";
  assert.equal(
    tradeRebatePreparingMessage(1),
    preparing,
  );
  assert.equal(
    tradeRebatePreparingMessage(9),
    preparing,
  );
  assert.equal(
    tradeRebatePreparingMessage(20),
    preparing,
  );
  assert.equal(tradeRebatePreparingMessage(null), "");
  assert.doesNotMatch(preparing, /\d+\s+of\s+\d+/i);
  assert.match(
    workspace,
    /try \{[\s\S]*requestWithCreditexTokenRecovery[\s\S]*\} finally \{\s*setPreparingMessage\(tradeRebatePreparingMessage\(null\)\);\s*\}/,
  );
  assert.match(workspace, /catch \(error\) \{[\s\S]*AbortError[\s\S]*throw new Error/);
  assert.match(workspace, /result\.code === "CREDITEX_SCHEMA_GUARDS_INSTALLING"/);
  assert.match(workspace, /result\.code === "OFFICIAL_PRODUCT_FLEET_BUSY"/);
  assert.match(workspace, /response\.headers\.get\("Retry-After"\)/);
  assert.match(workspace, /assertActiveIdentity\(\);[\s\S]*continue;/);
  assert.doesNotMatch(workspace, /Preparing governed calculator controls \([^)]*of[^)]*\)/);
});

test("calculator APIs keep trade access verified while public reads are quote-only", () => {
  assert.match(access, /requireComplianceIdentity\(identity/);
  assert.match(access, /requireVerifiedTradeIdentity\(identity/);
  assert.match(access, /partnerTypes: \["installer"\]/);
  assert.match(access, /CREDITEX_CALCULATOR_ACCESS_REQUIRED/);
  assert.match(access, /verified trade workspace account is required/);
  assert.doesNotMatch(access, /active Creditex membership/);
  for (const route of [programEstimateRoute, stcEstimateRoute]) {
    assert.match(route, /requireCreditexCalculatorAccess\(request, database, \{/);
    assert.match(route, /allowPublicQuote: [a-zA-Z]+ === "quote"/);
  }
  for (const route of [officialProductsRoute, stcProductsRoute]) {
    assert.match(route, /allowPublicQuote: true/);
  }
});

test("trade calculator separates exact governed results from certificate and provider outcomes", () => {
  assert.match(calculator, /role: "admin" \| "case_manager" \| "reviewer" \| "auditor" \| "trade"/);
  assert.match(calculator, /role === "admin" && registryRefreshContract/);
  assert.match(calculator, /Refresh NSW official products/);
  assert.match(calculator, /registryCodes: \["veu-approved-products"\]/);
  assert.match(
    calculator,
    /registryCodes: \["nsw-tessa-products", "gems-products"\]/,
  );
  assert.match(calculator, /for \(const registryCode of contract\.registryCodes\)/);
  assert.match(calculator, /requestTimeoutMs: 25_000/);
  assert.doesNotMatch(calculator, /registryCode: "all"/);
  assert.match(sresCalculator, /role === "admin" && !productBlocker/);
  assert.match(
    workspace,
    /Successful governed results are exact for[\s\S]*approved product snapshot[\s\S]*formula\/source\s*version/,
  );
  assert.match(
    workspace,
    /do not create or trade certificates[\s\S]*do not record[\s\S]*provider acceptance/,
  );
  assert.doesNotMatch(workspace, /Results remain estimates|CERTIFICATE ESTIMATES/);
  assert.match(officialProductsRoute, /allowedRoles: \["admin"\]/);
  assert.match(stcProductsRoute, /allowedRoles: \["admin"\]/);
  assert.doesNotMatch(workspace, /refreshRegistry|Refresh now/);
});

test("accepted official registry updates keep polling until every queued registry is current", () => {
  assert.match(
    calculator,
    /CREDITEX_REGISTRY_STATUS_POLL_INITIAL_DELAY_MS = 5_000/,
  );
  assert.match(
    calculator,
    /CREDITEX_REGISTRY_STATUS_POLL_INTERVAL_MS = 15_000/,
  );
  assert.match(
    calculator,
    /CREDITEX_REGISTRY_STATUS_POLL_TIMEOUT_MS = 30 \* 60_000/,
  );
  assert.match(
    calculator,
    /continueRegistry=\$\{encodeURIComponent\(registryCode\)\}/,
  );
  assert.match(
    calculator,
    /result\.refreshQueued === true[\s\S]*creditexAutomaticRegistryPollState\([\s\S]*if \(pollState === "complete"\)[\s\S]*setRegistryRefreshVersion\(\(current\) => current \+ 1\)/,
  );
  assert.match(
    calculator,
    /catch \{[\s\S]*latest status check failed[\s\S]*schedule\(CREDITEX_REGISTRY_STATUS_POLL_INTERVAL_MS\)/,
  );
  assert.match(
    calculator,
    /const contractChanged = role !== "admin"[\s\S]*registryStatusPoll\.programCode !== programCode[\s\S]*registryStatusPollGenerationRef\.current \+= 1/,
  );
  assert.match(
    calculator,
    /return \(\) => \{[\s\S]*active = false;[\s\S]*window\.clearTimeout\(timer\);[\s\S]*controller\?\.abort\(\)/,
  );

  const acceptedRefresh = calculator.slice(
    calculator.indexOf("async function refreshAutomaticProductRegistry"),
    calculator.indexOf("return (", calculator.indexOf(
      "async function refreshAutomaticProductRegistry",
    )),
  );
  assert.match(acceptedRefresh, /setRegistryStatusPoll\(\{/);
  assert.doesNotMatch(acceptedRefresh, /setRegistryRefreshVersion/);
  assert.doesNotMatch(
    acceptedRefresh,
    /certificate creation|provider acceptance/i,
  );
});
