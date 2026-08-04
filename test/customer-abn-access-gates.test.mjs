import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const evidenceRoute = read("../src/app/api/customer-project-evidence/route.ts");
const projectsRoute = read("../src/app/api/customer-projects/route.ts");
const accountQuoteRoute = read("../src/app/api/customer-trade-quotes/route.ts");
const linkQuoteRoute = read("../src/app/api/quote-review/[token]/route.ts");
const linkQuoteServer = read("../src/lib/trade-quote-review-server.ts");
const jobInformationRoute = read("../src/app/api/job-information/[token]/route.ts");

function predicateCallCount(source) {
  return (source.match(/verifiedTradeAccountPredicate\("[A-Za-z_]+"\)/g) || []).length;
}

test("customer evidence and public job uploads require the shared reviewed ABN gate", () => {
  assert.equal(predicateCallCount(evidenceRoute), 1);
  assert.match(evidenceRoute, /installerCanAccess[\s\S]*verifiedTradeAccountPredicate\("a"\)/);
  assert.equal(predicateCallCount(jobInformationRoute), 1);
  assert.match(jobInformationRoute, /authorisedRequest[\s\S]*verifiedTradeAccountPredicate\("a"\)/);
  assert.doesNotMatch(
    `${evidenceRoute}\n${jobInformationRoute}`,
    /a\.account_status = 'active'[\s\S]{0,100}a\.verification_status = 'approved'/,
  );
});

test("customer project contact, arrival and quote mutations require current reviewed ABN access", () => {
  assert.equal(predicateCallCount(projectsRoute), 6);
  for (const action of [
    "release_contact",
    "select_arrival_window",
    "select_installer_contact",
    "acknowledge_arrival_preparation",
    "quote_decision",
  ]) {
    const start = projectsRoute.indexOf(`action === "${action}"`);
    assert.notEqual(start, -1, `missing ${action} action`);
    const nextAction = projectsRoute.indexOf('} else if (action === "', start + 20);
    const block = projectsRoute.slice(start, nextAction === -1 ? undefined : nextAction);
    assert.match(block, /verifiedTradeAccountPredicate\("(?:a|account)"\)/, `${action} must use the shared trade gate`);
  }
  assert.match(
    projectsRoute,
    /CASE WHEN \$\{verifiedTradeAccountPredicate\("a"\)\} THEN 'approved' ELSE 'unavailable'/,
  );
});

test("account and secure-link quote decisions stop when current trade access is revoked", () => {
  assert.equal(predicateCallCount(accountQuoteRoute), 2);
  assert.match(
    accountQuoteRoute,
    /v\.status = 'issued'[\s\S]*v\.version_number = q\.current_version_number/,
  );
  assert.match(linkQuoteRoute, /authoriseTradeQuoteLink/);
  assert.equal(predicateCallCount(linkQuoteServer), 1);
  assert.match(linkQuoteServer, /authoriseTradeQuoteLink[\s\S]*verifiedTradeAccountPredicate\("trade"\)/);
});

test("customer-owned decided quote history remains readable without reopening quote actions", () => {
  assert.match(
    accountQuoteRoute,
    /acceptance\.id IS NOT NULL OR \(\$\{verifiedTradeAccountPredicate\("trade"\)\}\)/,
  );
  assert.match(
    accountQuoteRoute,
    /JOIN trade_accounts trade[\s\S]*verifiedTradeAccountPredicate\("trade"\)[\s\S]*WHERE v\.id = \?/,
  );
});
