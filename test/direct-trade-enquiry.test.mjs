import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const route = read("../src/app/direct-trade/page.tsx");
const brief = read("../src/components/DirectTradeProjectBrief.tsx");
const homepage = read("../src/components/GettingStarted.tsx");
const upgradeModal = read("../src/components/UpgradeEnquiryModal.tsx");
const postcodeRules = read("../src/lib/australian-postcodes.mjs");
const leadValidation = read("../src/lib/lead-validation.mjs");

test("Direct Trade household project brief is routed from the homepage", () => {
  assert.match(route, /DirectTradeProjectBrief/);
  assert.match(route, /Direct Trade Project Brief/);
  assert.match(homepage, /href="\/direct-trade">Start a project brief/);
  assert.doesNotMatch(homepage, /direct-trade-status|Live service, expanding tool/);
});

test("project brief uses the same-origin consented lead route", () => {
  assert.match(brief, /fetch\("\/api\/leads"/);
  assert.match(brief, /submissionType: "upgrade"/);
  assert.match(brief, /enquiry: "direct-trade-project"/);
  assert.match(brief, /Respond to this Direct Trade household project brief/);
  assert.match(brief, /projectCategories: selectedServices/);
  assert.match(brief, /Do not include your street address, NMI, meter file, energy bill/);
  assert.doesNotMatch(brief, /script\.google\.com|mode: "no-cors"/);
});

test("existing gas upgrade enquiries use the protected lead route and consent", () => {
  assert.match(upgradeModal, /fetch\("\/api\/leads"/);
  assert.match(upgradeModal, /consent: \{ accepted: true/);
  assert.doesNotMatch(upgradeModal, /script\.google\.com|mode: "no-cors"/);
});

test("Direct Trade project copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(route + brief, /\u2013|\u2014/);
});

test("project location is checked before trade matching", () => {
  assert.match(brief, /residentialStateFromPostcode/);
  assert.match(brief, /locationMismatch/);
  assert.match(brief, /Location check:/);
  assert.match(brief, /Postcode.*is usually in/);
  assert.match(leadValidation, /postcodeMatchesState/);
  assert.match(leadValidation, /Please check the postcode or state/);
  assert.match(postcodeRules, /return "ACT"/);
  assert.match(postcodeRules, /return "NSW"/);
  assert.match(postcodeRules, /return "NT"/);
  assert.match(postcodeRules, /return "VIC"/);
  assert.match(postcodeRules, /return "QLD"/);
  assert.match(postcodeRules, /return "SA"/);
  assert.match(postcodeRules, /return "WA"/);
  assert.match(postcodeRules, /return "TAS"/);
});

test("project briefs capture structured matching priorities and show a review summary", () => {
  assert.match(brief, /const priorities =/);
  assert.match(brief, /const propertyRelationships =/);
  assert.match(brief, /Choose at least one project priority/);
  assert.match(brief, /propertyRelationship,/);
  assert.match(brief, /projectPriorities,/);
  assert.match(brief, /className="direct-trade-review"/);
  assert.match(brief, /Project brief summary/);
  assert.match(brief, /Planning before authority is confirmed/);
  assert.match(leadValidation, /PROPERTY_RELATIONSHIPS/);
  assert.match(leadValidation, /PROJECT_PRIORITIES/);
});
