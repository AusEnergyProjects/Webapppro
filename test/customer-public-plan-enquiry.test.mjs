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
const enquiryForm = fs.readFileSync(
  new URL("../src/components/PublicPlanEnquiryForm.tsx", import.meta.url),
  "utf8",
);
const enquiryStyles = fs.readFileSync(
  new URL("../src/components/PublicPlanEnquiryForm.module.css", import.meta.url),
  "utf8",
);

test("the public plan offers one clear no-account enquiry without promoting an account", () => {
  assert.equal(planner.match(/<PublicPlanEnquiryForm\b/g)?.length, 1);
  assert.match(planner, /id="plan-enquiry"/);
  assert.match(planner, /suggestedInterests=\{enquiryInterests\}/);
  assert.match(planner, /planHref=\{printablePlanHref\}/);
  assert.doesNotMatch(planner, /planner-result-account-option/);
  assert.doesNotMatch(planner, /Create a free account/);
  assert.match(
    enquiryStyles,
    /@container \(max-width: 34rem\) \{[\s\S]*\.root \{[\s\S]*padding: 0\.75rem;[\s\S]*\.addressFields,[\s\S]*\.serviceChoices \{[\s\S]*padding: 0\.75rem;[\s\S]*\.quotePreparation > summary,[\s\S]*\.quotePreparationBody \{[\s\S]*padding: 0\.75rem;/,
  );
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
    "ageBand",
    "floorArea",
    "occupants",
    "sharedWalls",
    "roofType",
    "roofColour",
    "roofForm",
    "roofCondition",
    "switchboard",
    "wallConstruction",
    "floorConstruction",
  ]) {
    assert.match(
      planner,
      new RegExp(`if \\(${field}\\) params\\.set\\("${field}", ${field}\\)`),
    );
  }
  assert.match(planner, /const printablePlanHref = `\/plan\/print\?\$\{selectionParams\.toString\(\)\}`/);
  assert.match(planner, /planHref=\{printablePlanHref\}/);
  assert.match(planner, /href=\{printablePlanHref\}/);
});

test("the enquiry captures the private address and supports one, several or all services", () => {
  assert.match(enquiryForm, /const \[customerFirstName, setCustomerFirstName\] = useState\(""\)/);
  assert.match(enquiryForm, /const \[customerLastName, setCustomerLastName\] = useState\(""\)/);
  assert.match(enquiryForm, /required autoComplete="given-name" maxLength=\{60\}/);
  assert.match(enquiryForm, /required autoComplete="family-name" maxLength=\{60\}/);
  assert.match(enquiryForm, /Enter your first name for Australian Energy Assessments records/);
  assert.match(enquiryForm, /Enter your last name for Australian Energy Assessments records/);
  assert.match(enquiryForm, /const \[customerUnitNumber, setCustomerUnitNumber\] = useState\(""\)/);
  assert.match(enquiryForm, /const \[customerStreetAddress, setCustomerStreetAddress\] = useState\(""\)/);
  assert.match(enquiryForm, /const \[customerSuburb, setCustomerSuburb\] = useState\(""\)/);
  assert.match(enquiryForm, /const \[customerState, setCustomerState\] = useState\(""\)/);
  assert.match(enquiryForm, /fetch\(`\/api\/address-localities\?postcode=\$\{encodeURIComponent\(postcode\)\}`/);
  assert.match(enquiryForm, /setCustomerSuburb\(""\)/);
  assert.match(enquiryForm, /setCustomerState\(""\)/);
  assert.match(enquiryForm, /controller\.abort\(\)/);
  assert.match(enquiryForm, /result\.postcode !== postcode/);
  assert.match(enquiryForm, /record\.suburb/);
  assert.match(enquiryForm, /record\.state/);
  assert.match(enquiryForm, /function localityOptionValue\(locality: AddressLocality\)/);
  assert.match(enquiryForm, /function changeLocality\(nextLocalityValue: string\)/);
  assert.match(enquiryForm, /localityOptionValue\(locality\) === nextLocalityValue/);
  assert.match(enquiryForm, /setCustomerSuburb\(selected\?\.suburb \|\| ""\)/);
  assert.match(enquiryForm, /setCustomerState\(selected\?\.state \|\| ""\)/);
  assert.match(enquiryForm, /value=\{localityOptionValue\(locality\)\}/);
  assert.match(enquiryForm, /locality\.suburb === customerSuburb && locality\.state === customerState/);
  assert.match(enquiryForm, /State or territory/);
  assert.match(enquiryForm, /readOnly/);
  assert.match(enquiryForm, /showLocalityStates \? ` \(\$\{locality\.state\}\)`/);
  assert.match(enquiryForm, /Unit number/);
  assert.match(enquiryForm, /Street address/);
  assert.match(enquiryForm, /autoComplete="address-line2" maxLength=\{40\}/);
  assert.match(enquiryForm, /autoComplete="address-line1" maxLength=\{140\}/);
  assert.ok(enquiryForm.indexOf("autoComplete=\"address-line1\"") < enquiryForm.indexOf("autoComplete=\"address-line2\""));
  assert.match(enquiryForm, /customerUnitNumber,/);
  assert.match(enquiryForm, /customerStreetAddress,/);
  assert.match(enquiryForm, /customerSuburb,/);
  assert.match(enquiryForm, /customerState,/);
  assert.doesNotMatch(enquiryForm, /customerAddress,/);
  assert.match(enquiryForm, /projectCategories: interests/);
  assert.match(enquiryForm, /Which services would you like help with\?/);
  assert.match(enquiryForm, /Select all services/);
  assert.match(enquiryForm, /toggleAllInterests/);
  assert.match(enquiryForm, /INTEREST_OPTIONS\.map/);
  assert.match(enquiryForm, /aria-required="true"/);
  assert.match(enquiryForm, /aria-invalid=\{serviceSelectionInvalid\}/);
  assert.match(enquiryForm, /Choose at least one service/);
  assert.match(enquiryStyles, /\.serviceGrid \{/);
  assert.match(enquiryStyles, /\.serviceChoices\[aria-invalid="true"\]/);
  assert.match(enquiryStyles, /\.addressGrid \{/);
  assert.match(enquiryStyles, /\.readOnlyControl \{/);
});

test("the enquiry keeps admin contact data private unless each field is selected for sharing", () => {
  assert.match(enquiryForm, /name: shareName/);
  assert.match(enquiryForm, /phone: sharePhone/);
  assert.match(enquiryForm, /address: shareAddress/);
  assert.match(enquiryForm, /Also share my first and last name/);
  assert.match(enquiryForm, /Also share my phone number/);
  assert.match(enquiryForm, /Also share my full property address/);
  assert.match(enquiryForm, /email: true/);
  assert.match(enquiryForm, /postcode: true/);
  assert.doesNotMatch(enquiryForm, /shareMessage|Also share my message/);
});

test("the retry key binds the exact address tuple and keeps plan state separate", () => {
  const retryKey = enquiryForm.match(
    /function submissionCoreKey\([\s\S]*?\n\}\n\nexport function PublicPlanEnquiryForm/,
  )?.[0] || "";
  assert.match(retryKey, /customerFirstName: customerFirstName\.trim\(\)/);
  assert.match(retryKey, /customerLastName: customerLastName\.trim\(\)/);
  assert.doesNotMatch(retryKey, /\bname: name\.trim/);
  assert.match(retryKey, /customerUnitNumber: customerUnitNumber\.trim\(\)/);
  assert.match(retryKey, /customerStreetAddress: customerStreetAddress\.trim\(\)/);
  assert.match(retryKey, /customerSuburb: customerSuburb\.trim\(\)/);
  assert.match(retryKey, /customerState: customerState\.trim\(\)/);
  assert.match(retryKey, /postcode: postcode\.trim\(\)/);
  assert.doesNotMatch(retryKey, /resolvedAddressState/);
  assert.match(retryKey, /addressState: planSnapshot\.addressState/);

  const submittedPayload = enquiryForm.match(/body: JSON\.stringify\(\{[\s\S]*?\n\s*\}\),\n\s*\}\);/)?.[0] || "";
  assert.match(submittedPayload, /customerFirstName,/);
  assert.match(submittedPayload, /customerLastName,/);
  assert.doesNotMatch(submittedPayload, /\n\s*name,/);
  assert.match(submittedPayload, /customerUnitNumber,/);
  assert.match(submittedPayload, /customerStreetAddress,/);
  assert.match(submittedPayload, /customerSuburb,/);
  assert.match(submittedPayload, /customerState,/);
  assert.match(submittedPayload, /postcode,/);
  assert.match(submittedPayload, /address: shareAddress/);
  assert.doesNotMatch(submittedPayload, /resolvedAddressState/);
});

test("successful submission opens an accessible four-way next-step gateway", () => {
  assert.match(enquiryForm, /<dialog/);
  assert.match(enquiryForm, /aria-labelledby="public-plan-next-steps-title"/);
  assert.match(enquiryForm, /dialog\.showModal\(\)/);
  assert.match(enquiryForm, /gatewayFirstActionRef\.current\?\.focus\(\)/);
  assert.match(enquiryForm, /onCancel=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?closeGateway\(\);/);
  assert.match(enquiryForm, /aria-label="Close next steps"/);
  assert.match(enquiryForm, /href="\/compare\?from=home-plan"/);
  assert.match(enquiryForm, /href="\/gas-compare\?from=home-plan"/);
  assert.match(enquiryForm, /href="\/calculator"/);
  assert.match(enquiryForm, /href=\{planHref\}/);
  assert.match(enquiryForm, /downloadPublicPlanPdf\(input\)/);
  assert.match(enquiryForm, /onClick=\{downloadSubmittedPlan\}/);
  assert.match(enquiryForm, /name: \[customerFirstName\.trim\(\), customerLastName\.trim\(\)\]/);
  assert.match(enquiryForm, /projectCategories: \[\.\.\.interests\]/);
  assert.match(enquiryForm, /successfulPdfInput\.current = \{/);
  assert.match(enquiryForm, /preparedAtFromReference/);
  assert.match(enquiryForm, /Download the same PDF prepared for your email/);
  assert.doesNotMatch(enquiryForm, /new URLSearchParams\(\{[^}]*customerFirstName/);
  assert.equal(enquiryForm.match(/className=\{styles\.gatewayActions\}/g)?.length, 1);
  assert.doesNotMatch(enquiryForm, /[\u2013\u2014]/);
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
  assert.match(planner, /focusKey=\{currentStep\.id === "features"/);
  assert.match(planner, /currentStep\.id === "property"/);
  assert.match(planner, /<section className="planner-quick-wins"/);
  assert.match(planner, /Quick wins for your home/);
  assert.match(planner, /plan\.everydayActions\.map/);
  assert.doesNotMatch(planner, /Questions that could refine this plan/);
  assert.match(planner, /href="\/compare\?from=home-plan"/);
  assert.match(planner, /href="\/gas-compare\?from=home-plan"/);
  assert.match(planner, /href="\/calculator"/);
  assert.match(planner, /href="\/rebates"/);
});

test("shared property and complete home facts stay clear and one-at-a-time", () => {
  assert.match(
    planner,
    /Does the home have strata, a body corporate, an owners corporation or shared common property\?/,
  );
  assert.match(planner, /apartments, units, townhouses, villas, duplexes and other housing complexes/);
  assert.doesNotMatch(planner, /currentStep\.id === "home-basics"/);
  for (const key of [
    "propertyType",
    "storeys",
    "floorArea",
    "occupants",
    "sharedWalls",
    "ageBand",
    "wallConstruction",
    "floorConstruction",
    "roofType",
    "roofColour",
    "roofForm",
    "roofCondition",
    "switchboard",
  ]) {
    assert.match(planner, new RegExp(`propertyKey: "${key}"`));
  }
  assert.match(planner, /planSnapshot=\{\{/);
  assert.match(planner, /const enquiryPropertyContext = \{/);
  assert.match(planner, /propertyContext: enquiryPropertyContext/);
  for (const field of [
    "propertyType",
    "storeys",
    "ageBand",
    "floorArea",
    "occupants",
    "sharedWalls",
    "roofType",
    "roofColour",
    "roofForm",
    "roofCondition",
    "switchboard",
    "wallConstruction",
    "floorConstruction",
  ]) {
    assert.match(planPage, new RegExp(`${field}: value\\(params\\.${field}\\)`));
  }
  assert.match(planPage, /One clear step at a time\. Your plan starts here\./);
  assert.match(planPage, /no follow-up homework/i);
  assert.doesNotMatch(planner, /\u2013|\u2014/);
});
