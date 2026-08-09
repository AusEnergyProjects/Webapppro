import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const planner = fs.readFileSync(
  new URL("../src/components/HomeEnergyPlanner.tsx", import.meta.url),
  "utf8",
);

test("the public plan offers one optional privacy-first trade enquiry after the roadmap", () => {
  assert.equal(planner.match(/<PlannerTradeEnquiry\b/g)?.length, 1);
  assert.match(planner, /Optional next step/);
  assert.match(planner, /Enquire with verified trades only when you are ready/);
  assert.match(planner, /free private\s+account saves this plan and carries every current answer across/);
  assert.match(planner, /This is not required to view your plan/);
  assert.match(planner, /Your name, phone number\s+and exact address stay hidden during matching/);
  assert.match(planner, /Contact details are released\s+only to the one business you choose/);
});

test("the optional enquiry preserves every supported planner selection without double entry", () => {
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
    1,
  );
});

test("the enquiry handoff keeps independent plan actions available without implying a transaction", () => {
  assert.match(planner, /Open my printable plan/);
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
