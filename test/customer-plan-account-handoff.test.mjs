import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { normalizePublicPlanSnapshot } from "../src/lib/public-plan-enquiry.mjs";

const accountHandoffPage = fs.readFileSync(
  new URL("../src/app/account/projects/new/page.tsx", import.meta.url),
  "utf8",
);
const customerDashboard = fs.readFileSync(
  new URL("../src/components/CustomerDashboard.tsx", import.meta.url),
  "utf8",
);
const enquiryForm = fs.readFileSync(
  new URL("../src/components/PublicPlanEnquiryForm.tsx", import.meta.url),
  "utf8",
);

const completeContext = {
  propertyType: "townhouse",
  storeys: "two",
  ageBand: "1960_1999",
  floorArea: "100_199",
  occupants: "three_four",
  sharedWalls: "one_side",
  roofType: "tile",
  roofColour: "dark",
  roofForm: "pitched",
  roofCondition: "weathered",
  switchboard: "older_fuses",
  wallConstruction: "brick_veneer",
  floorConstruction: "suspended_timber",
};

test("the no-account enquiry preserves every complete home-context answer", () => {
  const result = normalizePublicPlanSnapshot({
    goals: ["lower-bills"],
    pace: "staged",
    situation: "owner",
    approvalContext: "none",
    budgetRange: "not_set",
    addressState: "VIC",
    features: [],
    propertyContext: completeContext,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.propertyContext, completeContext);
  for (const key of Object.keys(completeContext)) {
    assert.match(enquiryForm, new RegExp(`${key}: planSnapshot\\.propertyContext\\?\\.${key}`));
  }
});

test("the free-account handoff restores every complete home-context answer", () => {
  for (const key of Object.keys(completeContext)) {
    assert.match(
      accountHandoffPage,
      new RegExp(`${key}: controlledValue\\([\\s\\S]*?query\\.${key}`),
    );
  }
  for (const key of Object.keys(completeContext).filter(
    (value) => value !== "propertyType",
  )) {
    assert.match(
      customerDashboard,
      new RegExp(
        `${key}:\\s*selection\\.${key}\\s*\\|\\|\\s*draft\\.propertyContext\\.${key}`,
      ),
    );
  }
  assert.match(customerDashboard, /propertyType: selection\.propertyType \|\| draft\.propertyType/);
});

test("unsupported home-context values fail closed instead of being restored", () => {
  const result = normalizePublicPlanSnapshot({
    goals: ["lower-bills"],
    pace: "staged",
    situation: "owner",
    approvalContext: "none",
    budgetRange: "not_set",
    addressState: "VIC",
    features: [],
    propertyContext: {
      ...completeContext,
      roofType: "made-up-roof",
      switchboard: "opened-live-board",
    },
  });

  assert.equal(result.ok, true);
  assert.equal("roofType" in result.value.propertyContext, false);
  assert.equal("switchboard" in result.value.propertyContext, false);
  assert.equal(result.value.propertyContext.ageBand, "1960_1999");
});
