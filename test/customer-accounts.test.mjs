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
const accountRoute = read("../src/app/api/customer-account/route.ts");
const projectsRoute = read("../src/app/api/customer-projects/route.ts");
const customerOpportunityDispatch = read("../src/lib/customer-opportunity-dispatch-server.ts");
const publicLeadRoute = read("../src/app/api/leads/route.js");
const tradeRoute = read("../src/app/api/trade-opportunities/route.ts");
const accountPanel = read("../src/components/FirebaseAccountPanel.tsx");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const legacyComparator = read("../public/electricity-comparator.html");

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
  assert.match(accountRoute, /accountTier: "Always free"/);
  assert.match(dashboard, /All household project tools are included at no cost/);
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
  assert.match(projectsRoute, /address_line_1 AS addressLine1/);
  assert.match(projectsRoute, /address_state AS addressState/);
  assert.match(
    projectsRoute,
    /customerContactReadiness\(\s*authoritativeContact,\s*current,\s*\)/,
  );
});

test("customer auth supports Google, email, verification and password recovery", () => {
  assert.match(accountPanel, /GoogleAuthProvider/);
  assert.match(accountPanel, /signInWithPopup/);
  assert.match(accountPanel, /createUserWithEmailAndPassword/);
  assert.match(accountPanel, /signInWithEmailAndPassword/);
  assert.match(accountPanel, /sendEmailVerification/);
  assert.match(accountPanel, /sendPasswordResetEmail/);
  assert.match(projectsRoute, /if \(!user\.emailVerified && !Boolean\(current\.is_synthetic\)\)/);
  assert.match(projectsRoute, /COALESCE\(is_synthetic, 0\) is_synthetic/);
});

test("public plan handoff explains the protected trade enquiry without asking for answers twice", () => {
  assert.match(dashboard, /const hasPlannerHandoff = Boolean/);
  assert.match(dashboard, /Your private trade enquiry/);
  assert.match(dashboard, /Your current answers are carried across automatically/);
  assert.match(dashboard, /intent=\{hasPlannerHandoff \? "trade-enquiry" : "account"\}/);
  assert.match(accountPanel, /Your plan choices are already carried across/);
  assert.match(accountPanel, /Verified trades first receive a useful scope, not your identity/);
  assert.match(accountPanel, /You choose the business that can contact you/);
  assert.match(
    dashboard,
    /addressState:\s*profile\s*\?\s*profile\.addressState \|\| ""\s*:\s*plannerSelection\?\.addressState \|\| ""/,
  );
  assert.match(
    dashboard,
    /plannerSelection=\{\s*account\.profile \? undefined : initialPlannerSelection\s*\}/,
  );
});

test("customer projects are owner scoped and support separate saved roadmaps", () => {
  assert.equal(MAX_CUSTOMER_PROJECTS, 40);
  assert.match(schema, /sqliteTable\("customer_accounts"/);
  assert.match(schema, /sqliteTable\("customer_projects"/);
  assert.match(schema, /sqliteTable\("customer_consent_receipts"/);
  assert.match(schema, /sqliteTable\("customer_project_quotes"/);
  assert.match(projectsRoute, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(projectsRoute, /action === "duplicate"/);
  assert.match(projectsRoute, /action === "toggle_milestone"/);
  assert.match(projectsRoute, /action === "archive"/);
  assert.match(projectsRoute, /MAX_CUSTOMER_PROJECTS/);
});

test("new customer project creation is retry safe", () => {
  assert.match(projectsRoute, /const clientCreateId = cleanId\(raw\.clientCreateId\)/);
  assert.match(projectsRoute, /UUID_PATTERN\.test\(clientCreateId\)/);
  assert.match(projectsRoute, /id: clientCreateId,[\s\S]{0,80}created: false/);
  assert.match(
    projectsRoute,
    /\$\{clientCreateId \? "INSERT OR IGNORE" : "INSERT"\} INTO customer_projects/,
  );
  assert.match(
    projectsRoute,
    /const revisionId = clientCreateId \? `\$\{id\}:created` : crypto\.randomUUID\(\)/,
  );
  assert.match(projectsRoute, /created \? 201 : 200/);
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

test("state and postcode integrity is checked before records or opportunities are written", () => {
  assert.match(accountRoute, /postcodeMatchesState\(profile\.postcode, profile\.addressState\)/);
  assert.match(projectsRoute, /postcodeMatchesState\(project\.postcode, project\.addressState\)/);
  assert.match(projectsRoute, /postcodeCoordinate\(project\.postcode\)/);
  assert.match(projectsRoute, /buildAnonymizedOpportunity/);
});

test("customer enquiries bypass the public lead relay and use explicit consent receipts", () => {
  assert.match(projectsRoute, /requireFirebaseIdentity/);
  assert.match(projectsRoute, /if \(!sameOrigin\(request\)\)/);
  assert.match(projectsRoute, /customer-project-submit:\$\{id\}/);
  assert.match(projectsRoute, /anonymized_installer_matching/);
  assert.match(projectsRoute, /INSERT INTO customer_opportunity_dispatch_jobs/);
  assert.match(projectsRoute, /CUSTOMER_OPPORTUNITY_DISPATCH_HEADER/);
  assert.doesNotMatch(projectsRoute, /await allocateNearestInstallers/);
  assert.match(customerOpportunityDispatch, /await allocateNearestInstallers/);
  assert.doesNotMatch(projectsRoute, /\/api\/leads|LEAD_WEBHOOK|script\.google\.com/);
  assert.match(publicLeadRoute, /raw\?\.submissionType !== "comparison"/);
  assert.match(publicLeadRoute, /Upgrade projects must be created inside a free private customer account/);
  assert.doesNotMatch(publicLeadRoute, /createOpportunityFromLead/);
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
  assert.match(projectsRoute, /optionLabel: `Verified installer option/);
  assert.match(projectsRoute, /action === "release_contact"/);
  assert.match(projectsRoute, /raw\.confirmContactRelease !== true/);
  assert.match(projectsRoute, /customer_decision !== "shortlisted"/);
  assert.match(projectsRoute, /verifiedTradeAccountPredicate\("a"\)/);
  assert.match(projectsRoute, /matched_installer_contact_release:/);
  assert.match(projectsRoute, /customer_project_contact_release_events/);
  assert.doesNotMatch(projectsRoute, /partner_note/);
});

test("Account access is always visible in both comparison shells", () => {
  assert.match(chrome, /href="\/account"[\s\S]*?Account/);
  assert.match(legacyComparator, /href="\/account"[\s\S]*?Account/);
});

test("new customer-facing sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(accountPanel + dashboard + chrome + accountRoute + projectsRoute, /[\u2013\u2014]/);
});
