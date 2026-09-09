import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildAnonymizedOpportunity,
  CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION,
  MAX_CUSTOMER_PROJECTS,
  customerContactReadiness,
  normalizeCustomerProject,
  normalizePlatformQuote,
  validateCustomerProfile,
} from "../src/lib/customer-projects.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const customerOpportunityDispatch = read("../src/lib/customer-opportunity-dispatch-server.ts");
const publicLeadRoute = `${read("../src/app/api/leads/route.js")}\n${read("../src/lib/lead-route-handler.mjs")}`;
const tradeRoute = read("../src/app/api/trade-opportunities/route.ts");

test("customer profiles are private, free and optional updates default off", () => {
  const profile = validateCustomerProfile({
    displayName: "Jamie Household",
    postcode: "3000",
    addressState: "Vic",
    propertyType: "house",
    householdSituation: "owner",
    consent: true,
  });
  assert.equal(profile.ok, true);
  assert.equal(profile.profile.accountUpdates, false);
  assert.match(schema, /accountUpdates: integer\("account_updates"[\s\S]*?default\(false\)/);
});

test("trade-seeking profiles require private contact details that match the project location", () => {
  const incomplete = customerContactReadiness({ postcode: "3000", addressState: "VIC" }, { postcode: "3000", addressState: "VIC" });
  assert.equal(incomplete.ok, false);
  const ready = customerContactReadiness({
    phone: "0400 000 000",
    addressLine1: "12 Example Street",
    suburb: "Melbourne",
    postcode: "3000",
    addressState: "VIC",
  }, { postcode: "3000", addressState: "VIC" });
  assert.equal(ready.ok, true);
  const wrongProject = customerContactReadiness({
    phone: "0400 000 000",
    addressLine1: "12 Example Street",
    suburb: "Melbourne",
    postcode: "3000",
    addressState: "VIC",
  }, { postcode: "2000", addressState: "NSW" });
  assert.equal(wrongProject.ok, false);
  assert.equal(CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, "2026-07-18");
  assert.match(schema, /phone: text\("phone"\).*?default\(""\)/);
  assert.match(schema, /addressLine1: text\("address_line_1"\).*?default\(""\)/);
});

test("customer projects are owner scoped and support separate saved roadmaps", () => {
  assert.equal(MAX_CUSTOMER_PROJECTS, 40);
  assert.match(schema, /sqliteTable\("customer_accounts"/);
  assert.match(schema, /sqliteTable\("customer_projects"/);
  assert.match(schema, /sqliteTable\("customer_consent_receipts"/);
  assert.match(schema, /sqliteTable\("customer_project_quotes"/);
});

test("project normalization keeps notes private and rejects uncontrolled selections", () => {
  const result = normalizeCustomerProject({
    title: "My exact project name",
    homeNickname: "Home on Smith Street",
    postcode: "3000",
    addressState: "Vic",
    propertyType: "house",
    householdSituation: "owner",
    goal: "lower-bills",
    pace: "staged",
    serviceCategories: ["solar", "not-a-service"],
    priorities: ["replace-failed", "not-a-priority"],
    projectStage: "ready-for-pricing",
    timing: "within_3_months",
    privateNotes: "Jamie, 0400 000 000, call after 6pm",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.project.serviceCategories, ["solar"]);
  assert.deepEqual(result.project.priorities, ["lower-bills"]);
  const opportunity = buildAnonymizedOpportunity(result.project, "safe-project");
  assert.doesNotMatch(JSON.stringify(opportunity), /Jamie|0400 000 000|Smith Street|My exact project name/);
  assert.equal("privateNotes" in opportunity, false);
  assert.match(opportunity.summary, /Identity, contact details, street and unit address, private notes and usage records are withheld/);
});

test("public enquiries retain the consented relay and protected allocation boundary", () => {
  assert.match(customerOpportunityDispatch, /await allocateNearestInstallers/);
  assert.match(publicLeadRoute, /isPublicPlanEnquiry/);
  assert.match(publicLeadRoute, /raw\?\.submissionType !== "comparison" && !publicPlanEnquiry/);
  assert.match(publicLeadRoute, /Use the home energy planner or upgrade enquiry form/);
  assert.match(publicLeadRoute, /createOpportunityFromLead/);
  assert.match(publicLeadRoute, /enqueuePublicPlanDelivery/);
  assert.match(publicLeadRoute, /confirmPublicPlanIntakeOpportunity/);
});

test("installer responses stay anonymous until an exact customer-authorised match release", () => {
  const invalid = normalizePlatformQuote({ inclusions: [], labourCentsExGst: 0 });
  assert.equal(invalid.ok, false);
  const valid = normalizePlatformQuote({
    quoteType: "indicative",
    inclusions: ["site-assessment", "installation-commissioning", "free-text"],
    startWindow: "1_3_months",
    labourCentsExGst: 250000,
    otherCentsExGst: 50000,
    durationWeeks: 2,
    workmanshipWarrantyYears: 5,
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.quote.inclusions, ["site-assessment", "installation-commissioning"]);
  assert.match(tradeRoute, /Household opportunities are never available to wholesaler accounts/);
  assert.match(tradeRoute, /suburb: matchingLocality\.suburb/);
  assert.match(tradeRoute, /postcode: matchingLocality\.postcode/);
  assert.match(tradeRoute, /notice_version = '\$\{CUSTOMER_MATCHING_NOTICE_VERSION\}'/);
  assert.match(tradeRoute, /distanceBand: distanceBand/);
  assert.match(tradeRoute, /customer_project_contact_releases r ON r\.opportunity_match_id = m\.id/);
  assert.match(tradeRoute, /r\.installer_uid = m\.firebase_uid AND r\.status = 'active'/);
  assert.match(tradeRoute, /customerContact: row\.contact_release_id/);
  assert.match(tradeRoute, /normalizePlatformQuote/);
});
