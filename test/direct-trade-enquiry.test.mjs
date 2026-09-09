import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnonymizedOpportunity } from "../src/lib/customer-projects.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const route = read("../src/app/direct-trade/page.tsx");
const brief = read("../src/components/DirectTradeProjectBrief.tsx");
const homepage = read("../src/components/GettingStarted.tsx");
const upgradeModal = read("../src/components/UpgradeEnquiryModal.tsx");
const customerOpportunityDispatch = read("../src/lib/customer-opportunity-dispatch-server.ts");
const tradeOpportunitiesRoute = read("../src/app/api/trade-opportunities/route.ts");
const customerProjectRules = read("../src/lib/customer-projects.mjs");

test("Direct Trade uses the account-free consented enquiry while the homepage preserves planning paths", () => {
  assert.match(route, /DirectTradeProjectBrief/);
  assert.match(route, /Direct Trade Project Brief/);
  assert.match(homepage, /href="\/plan">Build my home energy plan/);
  assert.match(homepage, /QuickUpgradeEnquiry/);
  assert.match(homepage, /Send one quick request without creating an account/);
  assert.match(homepage, /You choose whether matching businesses receive your email, name or phone/);
  assert.match(brief, /PublicPlanEnquiryForm/);
  assert.match(brief, /No customer account is required/);
  assert.doesNotMatch(homepage, /direct-trade-status|Live service, expanding tool/);
});

test("public project and upgrade entry points do not submit household lead records", () => {
  assert.doesNotMatch(brief, /fetch\("\/api\/leads"|script\.google\.com|mode: "no-cors"/);
  assert.doesNotMatch(brief, /<form|type="email"|type="tel"/);
  assert.match(brief, /Review who can receive your details before sending/);


  assert.doesNotMatch(upgradeModal, /fetch\("\/api\/leads"|script\.google\.com|mode: "no-cors"/);
  assert.doesNotMatch(upgradeModal, /type="email"|type="tel"/);
  assert.match(upgradeModal, /new URLSearchParams/);
  assert.match(upgradeModal, /href=\{`\/plan\?\$\{params\.toString\(\)\}`\}/);
  assert.match(upgradeModal, /Opening the planner does not send an enquiry/);
});

test("customer project records require an authenticated owner and stay out of the lead relay", () => {
  assert.match(customerOpportunityDispatch, /await allocateNearestInstallers/);
});

test("anonymised matching is built only from controlled project choices", () => {
  const opportunity = buildAnonymizedOpportunity({
    title: "Jamie and Taylor's solar plan",
    homeNickname: "Our exact home name",
    postcode: "3000",
    addressState: "Vic",
    propertyType: "house",
    householdSituation: "owner",
    serviceCategories: ["solar", "battery"],
    priorities: ["lower-bills", "resilience"],
    projectStage: "ready-for-pricing",
    timing: "within_3_months",
    pace: "staged",
    privateNotes: "Call Jamie after 6pm on 0400 000 000",
  }, "project-123");

  assert.equal(opportunity.title, "Multi-upgrade home project");
  assert.equal(opportunity.sourceReference, "customer-project:project-123");
  assert.deepEqual(opportunity.serviceCategories, ["solar", "battery"]);
  assert.match(opportunity.summary, /Identity, contact details, street and unit address, private notes and usage records are withheld/);
  assert.doesNotMatch(JSON.stringify(opportunity), /Jamie|Taylor|0400 000 000|Our exact home name/);
  assert.equal("privateNotes" in opportunity, false);
});

test("installer matching limits location to locality and releases contact only through exact customer consent", () => {
  assert.match(tradeOpportunitiesRoute, /function distanceBand/);
  assert.match(tradeOpportunitiesRoute, /distanceBand: distanceBand\(row\.distance_metres\)/);
  assert.match(tradeOpportunitiesRoute, /suburb: matchingLocality\.suburb/);
  assert.match(tradeOpportunitiesRoute, /postcode: matchingLocality\.postcode/);
  assert.match(tradeOpportunitiesRoute, /notice_version = '\$\{CUSTOMER_MATCHING_NOTICE_VERSION\}'/);
  assert.match(tradeOpportunitiesRoute, /Household opportunities are never available to wholesaler accounts/);
  assert.match(tradeOpportunitiesRoute, /if \(action === "record_contact"\)/);
  assert.match(tradeOpportunitiesRoute, /customer_project_contact_releases/);
  assert.match(tradeOpportunitiesRoute, /r\.installer_uid = m\.firebase_uid AND r\.status = 'active'/);
  assert.match(tradeOpportunitiesRoute, /if \(action === "submit_quote"\)/);
  assert.match(tradeOpportunitiesRoute, /normalizePlatformQuote/);
  assert.match(tradeOpportunitiesRoute, /customer_project_quotes/);
  assert.match(customerProjectRules, /Choose at least one included service/);
});

test("project postcodes are checked before installer allocation", () => {
  assert.match(customerProjectRules, /Enter a four digit project postcode/);
  assert.match(customerProjectRules, /states: AUSTRALIAN_STATE_CODES/);
});
