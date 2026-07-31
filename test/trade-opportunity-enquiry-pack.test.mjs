import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInstallerEnquiryPack,
  INSTALLER_ENQUIRY_PACK_VERSION,
} from "../src/lib/customer-plan-document.mjs";
import {
  CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
} from "../src/lib/customer-projects.mjs";

const read = (path) => fs.readFileSync(
  new URL(path, import.meta.url),
  "utf8",
);

const opportunityRoute = read("../src/app/api/trade-opportunities/route.ts");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const styles = read("../src/app/globals.css");

const privateProject = {
  id: "private-project-id",
  firebase_uid: "private-owner-id",
  title: "SECRET PROJECT NAME",
  home_nickname: "SECRET HOME NAME",
  private_notes: "SECRET PRIVATE NOTE",
  goal: "improve-comfort",
  goals: JSON.stringify(["improve-comfort", "lower-bills"]),
  pace: "staged",
  postcode: "3006",
  address_state: "VIC",
  property_type: "house",
  household_situation: "renter",
  existing_features: JSON.stringify(["draughty", "single-glazing"]),
  service_categories: JSON.stringify(["glazing", "draught-proofing"]),
  budget_range: "under_2k",
  property_context: JSON.stringify({
    storeys: "two",
    ageBand: "pre_1960",
    floorArea: "100_199",
    roofType: "metal",
    switchboard: "older_fuses",
    approvalContext: "not_sure",
  }),
  advisor_profile: JSON.stringify({
    factEvidence: [
      { factKey: "glazing", source: "customer-reported" },
      { factKey: "draughts", source: "photo-supported" },
    ],
    rooms: [{
      id: "secret-room",
      name: "SECRET BEDROOM NAME",
      roomType: "bedroom",
      concerns: ["too-cold", "draughty"],
      usePeriods: ["overnight"],
    }],
    permissionItems: [{
      id: "secret-permission",
      title: "SECRET PERMISSION TITLE",
      note: "SECRET PERMISSION NOTE",
      classification: "permission-needed",
    }],
    reviewItems: [{
      id: "secret-review",
      text: "SECRET CUSTOMER REVIEW",
      status: "open",
    }],
    professionalReview: {
      enabled: true,
      role: "accredited-energy-adviser",
      adviserName: "SECRET ADVISER NAME",
      accreditationScheme: "SECRET ADVISER SCHEME",
      accreditationReference: "SECRET-REFERENCE",
      notes: "SECRET PROFESSIONAL REVIEW NOTE",
      declarationAccepted: true,
      declarationVersion: CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
    },
  }),
  plan_snapshot: JSON.stringify({
    version: "saved-plan",
    items: [
      { id: "budget-under-2k" },
      {
        id: "custom:secret",
        stage: "SECRET CUSTOM STAGE",
        title: "SECRET CUSTOM TITLE",
        text: "SECRET CUSTOM TEXT",
      },
      { id: "draught-proofing" },
    ],
  }),
  completed_plan_items: JSON.stringify([]),
};

test("installer enquiry pack is derived from the safe plan and remains non-identifying", () => {
  const pack = createInstallerEnquiryPack(privateProject, {
    preparedAt: "2026-07-31T00:00:00.000Z",
    evidence: [{
      sharing_scope: "allocated-installers",
      fact_keys: JSON.stringify(["draughts"]),
      file_name: "SECRET-NMI-NEM12.csv",
    }],
  });

  assert.equal(pack.version, INSTALLER_ENQUIRY_PACK_VERSION);
  assert.deepEqual(pack.goals, [
    "Feel warmer in winter and cooler in summer",
    "Lower energy bills",
  ]);
  assert.equal(pack.planBoundary.pace, "Stage improvements over time");
  assert.equal(pack.planBoundary.budget, "Under $2,000");
  assert.equal(pack.homeContext.propertyType, "Detached house");
  assert.equal(pack.homeContext.tenure, "I rent the home");
  assert.equal(pack.homeContext.state, "VIC");
  assert.ok(pack.readiness.total > 0);
  assert.ok(pack.firstSteps.length > 0);
  assert.ok(pack.firstSteps.length <= 3);
  assert.ok(pack.firstSteps.every((step) => !step.title.startsWith("SECRET")));

  const serialized = JSON.stringify(pack);
  for (const privateValue of [
    "3006",
    "private-owner-id",
    "SECRET PROJECT NAME",
    "SECRET HOME NAME",
    "SECRET PRIVATE NOTE",
    "SECRET BEDROOM NAME",
    "overnight",
    "SECRET PERMISSION TITLE",
    "SECRET PERMISSION NOTE",
    "SECRET CUSTOMER REVIEW",
    "SECRET ADVISER NAME",
    "SECRET ADVISER SCHEME",
    "SECRET-REFERENCE",
    "SECRET PROFESSIONAL REVIEW NOTE",
    "SECRET CUSTOM STAGE",
    "SECRET CUSTOM TITLE",
    "SECRET CUSTOM TEXT",
    "SECRET-NMI-NEM12.csv",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue));
  }
});

test("verified exact-match opportunity API projects the pack and approved file count", () => {
  assert.match(opportunityRoute, /requireVerifiedTradeAccess\(request, \{ partnerTypes: \["installer"\] \}\)/);
  assert.match(opportunityRoute, /accountHasFeature\(user\.uid, "installer", "installer_leads"\)/);
  assert.match(opportunityRoute, /WHERE m\.firebase_uid = \?/);
  assert.match(opportunityRoute, /createInstallerEnquiryPack/);
  assert.match(
    opportunityRoute,
    /enquiryPack: platformOnly[\s\S]*installerEnquiryPack\(row, sharedEvidence\)/,
  );
  assert.match(opportunityRoute, /approvedSharedFileCount: evidence\.length/);
  assert.match(opportunityRoute, /e\.sharing_scope = 'allocated-installers'/);
  assert.match(opportunityRoute, /purpose = 'installer_evidence_sharing'/);
  assert.match(opportunityRoute, /fileName: installerEvidenceName\(item\)/);
  assert.doesNotMatch(opportunityRoute, /p\.title|p\.home_nickname|p\.private_notes/);
  assert.doesNotMatch(opportunityRoute, /fileName: item\.file_name/);
});

test("lead card puts the enquiry pack before actions and lazy opens only selected lead photos", () => {
  const leadCard = dashboard.slice(
    dashboard.indexOf("visibleLeadOpportunities.map"),
  );
  const packPosition = leadCard.indexOf("<EnquiryPack");
  const actionPosition = leadCard.indexOf(
    'className="dashboard-opportunity-actions"',
  );

  assert.ok(packPosition > -1);
  assert.ok(actionPosition > packPosition);
  assert.match(dashboard, /Show approved photos/);
  assert.match(dashboard, /toggleOpportunityPhotos\(opportunity/);
  assert.match(
    dashboard,
    /customer-project-evidence\?download=\$\{encodeURIComponent\(item\.id\)\}/,
  );
  assert.match(dashboard, /URL\.createObjectURL\(await response\.blob\(\)\)/);
  assert.match(dashboard, /Protected PDF download/);
  assert.match(
    dashboard,
    /No customer-approved photos or documents are shared with this\s+enquiry\./,
  );
  assert.match(
    dashboard,
    /dashboardWorkspaceFromSearch\(window\.location\.search\)/,
  );
  assert.match(dashboard, /"leads",/);
  assert.match(styles, /\.dashboard-enquiry-pack/);
  assert.match(styles, /\.dashboard-enquiry-thumbnails img/);
});
