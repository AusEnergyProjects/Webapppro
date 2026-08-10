import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const planner = fs.readFileSync(
  new URL("../src/components/HomeEnergyPlanner.tsx", import.meta.url),
  "utf8",
);
const planPage = fs.readFileSync(
  new URL("../src/app/plan/page.tsx", import.meta.url),
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
  for (const field of [
    "propertyType",
    "storeys",
    "floorArea",
    "occupants",
    "sharedWalls",
  ]) {
    assert.match(
      planner,
      new RegExp(`if \\(${field}\\) params\\.set\\("${field}", ${field}\\)`),
    );
  }
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

test("shared property and home basics stay clear and compact", () => {
  assert.match(
    planner,
    /Does the home have strata, a body corporate, an owners corporation or shared common property\?/,
  );
  assert.match(planner, /apartments, units, townhouses, villas, duplexes and other housing complexes/);
  assert.equal(
    planner.match(/currentStep\.id === "home-basics"/g)?.length,
    1,
  );
  for (const label of [
    "Type of home",
    "Storeys inside your home",
    "Approximate internal floor area",
    "People who usually live here",
    "Walls shared with another dwelling",
  ]) {
    assert.match(planner, new RegExp(`aria-label="${label}"`));
  }
  assert.match(planner, /planSnapshot=\{\{/);
  assert.match(planner, /propertyContext:\s*\{\s*propertyType,\s*storeys,\s*floorArea,\s*occupants,\s*sharedWalls,/);
  for (const field of [
    "propertyType",
    "storeys",
    "floorArea",
    "occupants",
    "sharedWalls",
  ]) {
    assert.match(planPage, new RegExp(`${field}: value\\(params\\.${field}\\)`));
  }
  assert.match(planPage, /One clear step at a time\. Your plan starts here\./);
  assert.doesNotMatch(planner, /\u2013|\u2014/);
});
