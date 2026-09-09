import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const linkQuoteRoute = read("../src/app/api/quote-review/[token]/route.ts");
const linkDecisionServer = read("../src/lib/trade-quote-decision-server.ts");
const jobInformationRoute = read("../src/app/api/job-information/[token]/route.ts");

function predicateCallCount(source) {
  return (source.match(/verifiedTradeAccountPredicate\("[A-Za-z_]+"\)/g) || []).length;
}

test("customer evidence and public job uploads require the shared reviewed ABN gate", () => {
  assert.equal(predicateCallCount(jobInformationRoute), 1);
  assert.match(jobInformationRoute, /authorisedRequest[\s\S]*verifiedTradeAccountPredicate\("a"\)/);
});

test("account and secure-link quote decisions stop when current trade access is revoked", () => {
  const decisionPost = linkQuoteRoute.slice(linkQuoteRoute.indexOf("export async function POST"));
  assert.match(
    decisionPost,
    /authoriseTradeQuoteDecisionLink\(token, \{\s*requireCurrentTradeAccess: true/,
  );
  assert.equal(predicateCallCount(linkDecisionServer), 1);
  assert.match(
    linkDecisionServer,
    /const tradeAccessPredicate = options\.requireCurrentTradeAccess[\s\S]*verifiedTradeAccountPredicate\("trade"\)[\s\S]*"trade\.account_status = 'active'"/,
  );
  assert.match(
    linkDecisionServer,
    /JOIN trade_accounts trade[\s\S]*AND \$\{tradeAccessPredicate\}/,
  );
});
