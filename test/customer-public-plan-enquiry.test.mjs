import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const planner = fs.readFileSync(
  new URL("../src/components/HomeEnergyPlanner.tsx", import.meta.url),
  "utf8",
);

test("the public plan offers one clear privacy-first trade enquiry in both decision points", () => {
  assert.equal(planner.match(/<PlannerTradeEnquiry\b/g)?.length, 2);
  assert.match(planner, /placement="summary"/);
  assert.match(planner, /placement="footer"/);
  assert.match(
    planner,
    /<\/section>\s*<\/section>\s*<PlannerTradeEnquiry\s+href=\{tradeEnquiryHref\}\s+placement="footer"/,
  );
  assert.match(planner, /Enquire with verified trades/);
  assert.match(planner, /Create or sign in to a free private account/);
  assert.match(planner, /save this plan and carry\s+every current answer across/);
  assert.match(planner, /Your name, phone number and exact address stay hidden during matching/);
  assert.match(planner, /Contact details are released only to the one business you choose/);
  assert.doesNotMatch(planner, /Continue in my free account/);
});

test("both enquiry placements preserve every supported planner selection without double entry", () => {
  assert.match(
    planner,
    /new URLSearchParams\(\{\s*pace,\s*situation,\s*approvalContext,\s*budgetRange,\s*\}\)/,
  );
  assert.match(planner, /appendValues\(params, "goal", goals\)/);
  assert.match(planner, /appendValues\(params, "feature", features\)/);
  assert.match(
    planner,
    /if \(addressState\) params\.set\("addressState", addressState\)/,
  );
  assert.match(
    planner,
    /const tradeEnquiryHref = `\/account\/projects\/new\?\$\{selectionParams\.toString\(\)\}`/,
  );
  assert.equal(
    planner.match(/href=\{tradeEnquiryHref\}/g)?.length,
    2,
  );
});

test("the enquiry handoff keeps independent plan actions available without implying a transaction", () => {
  assert.match(planner, /Preview and download PDF/);
  assert.match(planner, /Start over/);

  const handoff = planner.match(
    /function PlannerTradeEnquiry\([\s\S]+?\n}\n\nexport function HomeEnergyPlanner/,
  )?.[0];
  assert.ok(handoff);
  assert.doesNotMatch(
    handoff,
    /\b(?:accept(?:ed|s|ing)?|payment|contract|authorise(?:d|s|ing)?|guarantee(?:d|s)?)\b/i,
  );
});
