import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const planner = fs.readFileSync(
  new URL("../src/components/HomeEnergyPlanner.tsx", import.meta.url),
  "utf8",
);

test("the public plan offers one clear no-account enquiry and a separate account option", () => {
  assert.equal(planner.match(/<PublicPlanEnquiryForm\b/g)?.length, 1);
  assert.match(planner, /id="plan-enquiry"/);
  assert.match(planner, /suggestedInterests=\{enquiryInterests\}/);
  assert.match(planner, /Want to save the full plan first\?/);
  assert.match(planner, /An account is not required to enquire/);
  assert.match(planner, />Create a free account<\/a>/);
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
    /const accountProjectHref = `\/account\/projects\/new\?\$\{selectionParams\.toString\(\)\}`/,
  );
  assert.equal(
    planner.match(/href=\{accountProjectHref\}/g)?.length,
    1,
  );
});

test("the enquiry handoff keeps independent plan actions available without implying a transaction", () => {
  assert.match(planner, /Open my printable plan/);
  assert.match(planner, /Start over/);

  const handoff = planner.match(
    /<section className="planner-result-decision"[\s\S]+?<\/section>/,
  )?.[0];
  assert.ok(handoff);
  assert.doesNotMatch(
    handoff,
    /\b(?:accept(?:ed|s|ing)?|payment|contract|authorise(?:d|s|ing)?|guarantee(?:d|s)?)\b/i,
  );
});

test("the result leads with a progressing home journey and visible answer-specific quick wins", () => {
  assert.match(planner, /<PlannerHomeJourney/);
  assert.match(planner, /focusKey=\{currentStep\.id === "features" \? currentStep\.featureQuestion : currentStep\.id\}/);
  assert.match(planner, /<section className="planner-quick-wins"/);
  assert.match(planner, /Quick wins for your home/);
  assert.match(planner, /plan\.everydayActions\.map/);
  assert.doesNotMatch(planner, /<summary>Optional ways to refine or use this plan<\/summary>/);
});
