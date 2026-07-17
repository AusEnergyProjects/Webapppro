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
const customerDashboard = read("../src/components/CustomerDashboard.tsx");
const newProjectRoute = read("../src/app/account/projects/new/page.tsx");
const customerProjectsRoute = read("../src/app/api/customer-projects/route.ts");
const tradeOpportunitiesRoute = read("../src/app/api/trade-opportunities/route.ts");
const customerProjectRules = read("../src/lib/customer-projects.mjs");

test("Direct Trade household projects are routed through the private account gateway", () => {
  assert.match(route, /DirectTradeProjectBrief/);
  assert.match(route, /Direct Trade Project Brief/);
  assert.match(homepage, /href="\/direct-trade">Start a project brief/);
  assert.match(brief, /href="\/account\/projects\/new">Create a free private project/);
  assert.match(brief, /href="\/account">Open my account/);
  assert.match(brief, /No public lead form/);
  assert.match(brief, /Always free for households/);
  assert.doesNotMatch(homepage, /direct-trade-status|Live service, expanding tool/);
});

test("public project and upgrade entry points do not submit household lead records", () => {
  assert.doesNotMatch(brief, /fetch\("\/api\/leads"|script\.google\.com|mode: "no-cors"/);
  assert.doesNotMatch(brief, /<form|type="email"|type="tel"/);
  assert.match(brief, /Customer-authored names and notes never enter it/);
  assert.match(brief, /contact details withheld during matching/);

  assert.doesNotMatch(upgradeModal, /fetch\("\/api\/leads"|script\.google\.com|mode: "no-cors"/);
  assert.doesNotMatch(upgradeModal, /type="email"|type="tel"/);
  assert.match(upgradeModal, /new URLSearchParams/);
  assert.match(upgradeModal, /href=\{`\/account\/projects\/new\?\$\{params\.toString\(\)\}`\}/);
  assert.match(upgradeModal, /Creating a project does not submit an enquiry/);
});

test("customer project records require an authenticated owner and stay out of the lead relay", () => {
  assert.match(customerProjectsRoute, /requireFirebaseIdentity/);
  assert.match(customerProjectsRoute, /if \(!sameOrigin\(request\)\)/);
  assert.match(customerProjectsRoute, /customer_accounts WHERE firebase_uid = \?/);
  assert.match(customerProjectsRoute, /customer_projects WHERE id = \? AND firebase_uid = \?/);
  assert.match(customerProjectsRoute, /WHERE firebase_uid = \? ORDER BY/);
  assert.match(customerProjectsRoute, /if \(!user\.emailVerified && !Boolean\(current\.is_synthetic\)\)/);
  assert.match(customerProjectsRoute, /COALESCE\(is_synthetic, 0\) is_synthetic/);
  assert.match(customerProjectsRoute, /buildAnonymizedOpportunity/);
  assert.match(customerProjectsRoute, /const opportunityId = `customer-project:\$\{id\}`/);
  assert.match(customerProjectsRoute, /allocateNearestInstallers/);
  assert.doesNotMatch(customerProjectsRoute, /\/api\/leads|script\.google\.com|LEAD_WEBHOOK/);
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
  assert.match(opportunity.summary, /Identity, exact location, contact details, private notes and usage records are withheld/);
  assert.doesNotMatch(JSON.stringify(opportunity), /Jamie|Taylor|0400 000 000|Our exact home name/);
  assert.equal("privateNotes" in opportunity, false);
});

test("installer matching masks location and releases contact only through exact customer consent", () => {
  assert.match(tradeOpportunitiesRoute, /function distanceBand/);
  assert.match(tradeOpportunitiesRoute, /distanceBand: distanceBand\(row\.distance_metres\)/);
  assert.match(tradeOpportunitiesRoute, /postcode: ""/);
  assert.match(tradeOpportunitiesRoute, /Household opportunities are never available to wholesaler accounts/);
  assert.match(tradeOpportunitiesRoute, /if \(action === "record_contact"\)/);
  assert.match(tradeOpportunitiesRoute, /customer_project_contact_releases/);
  assert.match(tradeOpportunitiesRoute, /r\.installer_uid = m\.firebase_uid AND r\.status = 'active'/);
  assert.match(tradeOpportunitiesRoute, /if \(action === "submit_quote"\)/);
  assert.match(tradeOpportunitiesRoute, /normalizePlatformQuote/);
  assert.match(tradeOpportunitiesRoute, /customer_project_quotes/);
  assert.match(customerProjectRules, /Choose at least one included service/);
});

test("the customer dashboard supports guided, saved and separately managed projects", () => {
  assert.match(customerDashboard, /Project builder step \$\{step\} of 5/);
  assert.match(customerDashboard, /\["Home", "Goals", "Your plan", "Work", "Privacy"\]/);
  assert.match(customerDashboard, /Answer one small step at a time/);
  assert.match(customerDashboard, /Build more than one project/);
  assert.match(customerDashboard, /fetch\("\/api\/customer-projects"/);
  assert.match(customerDashboard, /Duplicate as a new draft/);
  assert.match(customerDashboard, /tick off completed steps/i);
  assert.match(customerDashboard, /Review exactly what installers can see/);
  assert.match(customerDashboard, /Your name, email, home nickname, project name, private notes and\s+exact postcode stay hidden/);
  assert.match(customerDashboard, /Every photo and supporting document is shared with all\s+verified installers allocated to this enquiry/);
  assert.match(customerDashboard, /confirmContactRelease: true/);
  assert.match(customerDashboard, /Other\s+installers remain anonymised/);
  assert.match(customerDashboard, /No paid tier, lead fee or feature paywall/);
});

test("comparison handoffs prefill only controlled project planning choices", () => {
  assert.match(newProjectRoute, /goal: typeof query\.goal === "string"/);
  assert.match(newProjectRoute, /pace: typeof query\.pace === "string"/);
  assert.match(newProjectRoute, /situation: typeof query\.situation === "string"/);
  assert.match(newProjectRoute, /features: values\(query\.feature\)/);
  assert.match(newProjectRoute, /categories: values\(query\.category\)/);
  assert.match(newProjectRoute, /postcode: typeof query\.postcode === "string"/);
  assert.doesNotMatch(newProjectRoute, /query\.(?:email|phone|name|address|notes|nmi|meter)/i);
});

test("project postcodes are checked before installer allocation", () => {
  assert.match(customerProjectsRoute, /postcodeCoordinate\(project\.postcode\)/);
  assert.match(customerProjectsRoute, /Enter a recognised Australian project postcode/);
  assert.match(customerProjectRules, /Enter a four digit project postcode/);
  assert.match(customerProjectRules, /states: AUSTRALIAN_STATE_CODES/);
});

test("private customer project copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(
    route + brief + upgradeModal + customerDashboard + newProjectRoute,
    /\u2013|\u2014/,
  );
});
