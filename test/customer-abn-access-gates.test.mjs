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
  const initial = jobInformationRoute.slice(jobInformationRoute.indexOf("async function authorisedRequest"), jobInformationRoute.indexOf("function currentScope"));
  const current = jobInformationRoute.slice(jobInformationRoute.indexOf("function currentScope"), jobInformationRoute.indexOf("function writeGuard"));
  assert.equal(predicateCallCount(initial), 1);
  assert.equal(predicateCallCount(current), 1);
  for (const scope of [initial, current]) {
    assert.match(scope, /JOIN trade_accounts a ON a\.firebase_uid\s*=\s*r\.firebase_uid/);
    assert.match(scope, /a\.partner_type\s*=\s*'installer' AND \$\{verifiedTradeAccountPredicate\("a"\)\}/);
  }
  const guard = jobInformationRoute.slice(jobInformationRoute.indexOf("function writeGuard"), jobInformationRoute.indexOf("async function publicPayload"));
  assert.match(guard, /currentScope\(record, context\)/);
  assert.match(guard, /NULL[\s\S]*WHERE NOT \(\$\{scope\.sql\}\)/);
  const payload = jobInformationRoute.slice(jobInformationRoute.indexOf("async function publicPayload"), jobInformationRoute.indexOf("function publicError"));
  assert.match(payload, /currentScope\(record, context\)[\s\S]*SELECT 1 WHERE \$\{scope\.sql\}[\s\S]*throw new Error\("REQUEST_REVOKED"\)/);
});

test("shared customer hub participants require the same authoritative reviewed ABN predicate", () => {
  const hub = read("../src/lib/customer-quote-hub-server.ts");
  const participantJoins = hub.slice(hub.indexOf("export const hubParticipantJoins"), hub.indexOf("export function hubJson"));
  assert.equal(predicateCallCount(participantJoins), 1);
  assert.match(participantJoins, /JOIN trade_accounts trade ON trade\.firebase_uid=match\.firebase_uid AND trade\.partner_type='installer' AND \$\{verifiedTradeAccountPredicate\("trade"\)\}/);
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
