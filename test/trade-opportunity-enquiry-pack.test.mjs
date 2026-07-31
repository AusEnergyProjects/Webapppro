import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInstallerEnquiryPack,
  createInstallerPlanReportView,
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
const opportunityPlanRoute = read("../src/app/api/trade-opportunity-plan/route.ts");
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
  assert.ok(pack.actionCount > 0);
  assert.equal("firstSteps" in pack, false);

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

test("complete installer report includes every controlled step and removes professional identity", () => {
  const completePlanProject = {
    ...privateProject,
    plan_snapshot: JSON.stringify({}),
  };
  const report = createInstallerPlanReportView(completePlanProject, {
    preparedAt: "2026-07-31T00:00:00.000Z",
  });
  const pack = createInstallerEnquiryPack(completePlanProject, {
    preparedAt: "2026-07-31T00:00:00.000Z",
  });

  assert.equal(report.actions.length, pack.actionCount);
  assert.ok(report.actions.length > 3);
  assert.equal(report.professionalReview, null);
  assert.equal(report.professionalPresentation, null);
  assert.match(report.privacyNote, /professional adviser identity or notes/);
  for (const privateValue of [
    "3006",
    "private-owner-id",
    "SECRET ADVISER NAME",
    "SECRET ADVISER SCHEME",
    "SECRET-REFERENCE",
    "SECRET PROFESSIONAL REVIEW NOTE",
    "SECRET PROJECT NAME",
    "SECRET HOME NAME",
    "SECRET PRIVATE NOTE",
    "SECRET BEDROOM NAME",
    "overnight",
    "SECRET PERMISSION TITLE",
    "SECRET PERMISSION NOTE",
    "SECRET CUSTOMER REVIEW",
    "SECRET CUSTOM STAGE",
    "SECRET CUSTOM TITLE",
    "SECRET CUSTOM TEXT",
    "SECRET-NMI-NEM12.csv",
  ]) {
    assert.doesNotMatch(JSON.stringify(report), new RegExp(privateValue));
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
  assert.match(opportunityRoute, /purpose = 'anonymized_installer_matching'/);
});

test("complete plan endpoint keeps exact-match and privacy boundaries", () => {
  assert.match(opportunityPlanRoute, /requireVerifiedTradeAccess\(request, \{[\s\S]*partnerTypes: \["installer"\]/);
  assert.match(opportunityPlanRoute, /accountHasFeature\([\s\S]*"installer_leads"/);
  assert.match(opportunityPlanRoute, /m\.id = \? AND m\.firebase_uid = \?/);
  assert.match(opportunityPlanRoute, /m\.status IN \('offered', 'viewed', 'interested', 'connected'\)/);
  assert.match(opportunityPlanRoute, /o\.status IN \('open', 'paused'\)/);
  assert.match(opportunityPlanRoute, /purpose = 'anonymized_installer_matching'/);
  assert.match(opportunityPlanRoute, /withdrawn_at = ''/);
  assert.match(opportunityPlanRoute, /createInstallerPlanReportView/);
  assert.match(opportunityPlanRoute, /Household plans are never available to wholesaler accounts/);
  assert.match(opportunityPlanRoute, /ACCOUNT_INACTIVE/);
  assert.doesNotMatch(opportunityPlanRoute, /p\.title|p\.home_nickname|p\.private_notes/);
});

test("lead card opens the complete plan and represents every returned shared file", () => {
  const leadCard = dashboard.slice(
    dashboard.indexOf("visibleLeadOpportunities.map"),
  );
  const packPosition = leadCard.indexOf("<EnquiryPack");
  const actionPosition = leadCard.indexOf(
    'className="dashboard-opportunity-actions"',
  );

  assert.ok(packPosition > -1);
  assert.ok(actionPosition > packPosition);
  assert.match(dashboard, /Open complete plan/);
  assert.match(dashboard, /Download complete plan PDF/);
  assert.match(dashboard, /trade-opportunity-plan\?matchId=/);
  assert.match(dashboard, /downloadCustomerPlanPdf\(report\)/);
  assert.match(dashboard, /Show all shared photos/);
  assert.match(dashboard, /toggleOpportunityPhotos\(opportunity/);
  assert.match(dashboard, /Promise\.allSettled\(missingPhotos\.map/);
  assert.match(dashboard, /photos\.map\(\(item\) =>/);
  assert.match(dashboard, /documents\.map\(\(item\) =>/);
  assert.match(
    dashboard,
    /customer-project-evidence\?download=\$\{encodeURIComponent\(item\.id\)\}/,
  );
  assert.match(dashboard, /URL\.createObjectURL\(await response\.blob\(\)\)/);
  assert.match(dashboard, /Protected PDF download/);
  assert.match(
    dashboard,
    /No photos or documents are shared with this enquiry\./,
  );
  assert.match(
    dashboard,
    /dashboardWorkspaceFromSearch\(window\.location\.search\)/,
  );
  assert.match(dashboard, /"leads",/);
  assert.match(styles, /\.dashboard-enquiry-pack/);
  assert.match(styles, /\.dashboard-enquiry-thumbnails img/);
});

test("protected installer plan and evidence state is cleared before an auth identity transition renders", () => {
  const authTransition = dashboard.slice(
    dashboard.indexOf("onAuthStateChanged(firebaseAuth"),
    dashboard.indexOf("useEffect(() => {\n    if (!user) return;"),
  );
  const clearState = dashboard.slice(
    dashboard.indexOf("const clearProtectedInstallerState"),
    dashboard.indexOf("useEffect(() => {\n    const frame"),
  );
  const revokeAllUrls = dashboard.slice(
    dashboard.indexOf("const revokeAllEvidenceObjectUrls"),
    dashboard.indexOf("const clearProtectedInstallerState"),
  );

  assert.match(
    authTransition,
    /if \(protectedIdentityUid\.current !== nextUid\) \{[\s\S]*protectedIdentityRevision\.current \+= 1;[\s\S]*clearProtectedInstallerState\(\);[\s\S]*\}[\s\S]*setUser\(nextUser\)/,
  );
  assert.ok(
    authTransition.indexOf("clearProtectedInstallerState();") <
      authTransition.indexOf("setUser(nextUser);"),
  );
  for (const stateReset of [
    "setInstallerPlanPreview(null)",
    'setInstallerPlanBusy("")',
    "setInstallerPlanErrors({})",
    "setVisibleEvidenceMatches({})",
    "setEvidencePhotoUrls({})",
    'setEvidencePhotoBusy("")',
    "setEvidencePhotoErrors({})",
  ]) {
    assert.match(clearState, new RegExp(stateReset.replace(/[(){}]/g, "\\$&")));
  }
  assert.match(
    revokeAllUrls,
    /for \(const url of evidenceObjectUrls\.current\) URL\.revokeObjectURL\(url\);[\s\S]*evidenceObjectUrls\.current\.clear\(\)/,
  );
  assert.match(clearState, /revokeAllEvidenceObjectUrls\(\)/);
  assert.equal(
    (dashboard.match(/evidenceObjectUrls\.current\.add\(url\)/g) || []).length,
    2,
  );
  assert.match(
    dashboard,
    /\{authReady && user && installerPlanPreview && \(/,
  );
  assert.doesNotMatch(
    dashboard,
    /\{installerPlanPreview && \(/,
  );
});
