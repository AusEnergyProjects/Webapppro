import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runInNewContext } from "node:vm";
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

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function plainJavaScriptFunction(source, functionName) {
  const functionSource = source.match(new RegExp(
    `function ${functionName}\\([\\s\\S]*?\\n\\}`,
  ))?.[0];
  assert.ok(functionSource, `Missing plain JavaScript helper: ${functionName}`);
  return runInNewContext(`(${functionSource})`);
}

function assertEveryAwaitIsRequestGuarded(handlerSource) {
  const successPath = sourceBetween(handlerSource, "try {", "} catch (");
  const awaits = [...successPath.matchAll(/\bawait\b/g)];
  assert.ok(awaits.length > 0, "Expected an asynchronous success path");

  for (let index = 0; index < awaits.length; index += 1) {
    const awaitIndex = awaits[index].index;
    const guardIndex = successPath.indexOf(
      "if (!requestIsCurrent()) return;",
      awaitIndex,
    );
    const nextAwaitIndex = awaits[index + 1]?.index ?? Number.POSITIVE_INFINITY;
    const protectedWrite = /\bset(?:Opportunities|OpportunityStatus|OpportunityBusy|OpportunityNavigationStatus|Workspace)\s*\(/g;
    protectedWrite.lastIndex = awaitIndex;
    const nextWriteIndex = protectedWrite.exec(successPath)?.index
      ?? Number.POSITIVE_INFINITY;

    assert.ok(guardIndex > awaitIndex, "Each await must be followed by a request guard");
    assert.ok(
      guardIndex < Math.min(nextAwaitIndex, nextWriteIndex),
      "The request guard must run before another await or protected state write",
    );
  }
}

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
  assert.match(opportunityRoute, /o\.suburb opportunity_suburb/);
  assert.match(
    opportunityRoute,
    /o\.source_reference = 'customer-project:' \|\| p\.id/,
  );
  assert.match(
    opportunityRoute,
    /notice_version = '\$\{CUSTOMER_MATCHING_NOTICE_VERSION\}'/,
  );
  assert.match(opportunityRoute, /suburb: matchingLocality\.suburb/);
  assert.match(
    opportunityRoute,
    /postcode: matchingLocality\.postcode/,
  );
  assert.doesNotMatch(opportunityRoute, /JOIN customer_accounts|LEFT JOIN customer_accounts/);
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

test("protected lead photos open inline with an accessible closeable lightbox", () => {
  assert.match(dashboard, /function ProtectedPhotoThumbnail/);
  assert.match(dashboard, /aria-label=\{`View full image: \$\{alt\}`\}/);
  assert.match(dashboard, /onViewPhoto\(\s*item,\s*photoUrls\[item\.id\]/);
  assert.match(dashboard, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(dashboard, /aria-label="Close full image"/);
  assert.match(
    dashboard,
    /event\.target === event\.currentTarget\) setPhotoLightbox\(null\)/,
  );
  assert.ok(
    (dashboard.match(/event\.target === event\.currentTarget\) setPhotoLightbox\(null\)/g) || []).length >= 3,
  );
  assert.match(
    dashboard,
    /event\.key === "Escape"[\s\S]*setPhotoLightbox\(null\)/,
  );
  assert.match(
    dashboard,
    /event\.key !== "Tab"[\s\S]*document\.activeElement === first[\s\S]*last\.focus\(\)[\s\S]*document\.activeElement === last[\s\S]*first\.focus\(\)/,
  );
  assert.match(dashboard, /photoLightboxCloseButton\.current\?\.focus\(\)/);
  assert.match(dashboard, /if \(opener\?\.isConnected\) opener\.focus\(\)/);
  assert.match(dashboard, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dashboard, /document\.body\.style\.overflow = previousBodyOverflow/);
  assert.match(dashboard, /status: "loading"/);
  assert.match(dashboard, /current\?\.item\.id === photoLightbox\.item\.id[\s\S]*status: "ready"/);
  assert.match(dashboard, /role="alert"/);
  assert.match(
    dashboard,
    /if \(!url \|\| !evidenceObjectUrls\.current\.has\(url\)\) return/,
  );
  assert.match(dashboard, /The full image reuses the authenticated, audited object URL/);
  assert.match(styles, /\.dashboard-photo-lightbox-backdrop/);
  assert.match(styles, /\.dashboard-photo-lightbox-stage img/);
  assert.match(styles, /cursor: zoom-in/);
});

test("lead summaries explain both public-plan consent and protected customer-account projects", () => {
  assert.match(dashboard, /function opportunityBroadLocation/);
  assert.match(dashboard, /opportunity\.suburb, opportunity\.postcode/);
  assert.match(
    dashboard,
    /\{opportunityBroadLocation\(opportunity\)\} \| \{opportunity\.distanceBand\}/,
  );
  assert.match(
    dashboard,
    /Quick upgrade requests include the postcode, selected services, any written message and full property address\. Email, name and phone appear only when selected/,
  );
  assert.match(
    dashboard,
    /Customer account project contact and street details stay protected until the customer chooses this business/,
  );
  assert.match(
    dashboard,
    /Suburb, postcode and state are shown for service-area planning\.[\s\S]*street and unit address/,
  );
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
    /const previousUid = protectedIdentityUid\.current;[\s\S]*if \(resetTradeDashboardStateOnUidChange\([\s\S]*previousUid,[\s\S]*nextUid,[\s\S]*clearProtectedInstallerState,[\s\S]*\)\) \{[\s\S]*protectedIdentityRevision\.current \+= 1;[\s\S]*\}[\s\S]*setUser\(nextUser\)/,
  );
  assert.ok(
    authTransition.indexOf("resetTradeDashboardStateOnUidChange(") <
      authTransition.indexOf("setUser(nextUser);"),
  );
  assert.ok(
    authTransition.indexOf("clearProtectedInstallerState,") <
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

test("stale old-UID lead continuations cannot write after an identity switch", async () => {
  const identityIsCurrent = plainJavaScriptFunction(
    dashboard,
    "protectedIdentityContinuationIsCurrent",
  );
  let currentIdentity = { uid: "installer-a", revision: 11 };
  let releaseContinuation = () => {};
  const pendingAwait = new Promise((resolve) => {
    releaseContinuation = resolve;
  });
  const protectedWrites = [];

  const staleContinuation = (async () => {
    const capturedIdentity = { ...currentIdentity };
    await pendingAwait;
    if (!identityIsCurrent(
      capturedIdentity.uid,
      capturedIdentity.revision,
      currentIdentity.uid,
      currentIdentity.revision,
    )) return;
    protectedWrites.push("old-account-write");
  })();

  currentIdentity = { uid: "installer-b", revision: 12 };
  releaseContinuation();
  await staleContinuation;

  assert.deepEqual(protectedWrites, []);
  assert.equal(identityIsCurrent("installer-b", 12, "installer-b", 12), true);
  assert.equal(identityIsCurrent("installer-b", 11, "installer-b", 12), false);
  assert.equal(identityIsCurrent(), false);
});

test("opportunity deep links are scrubbed only when leaving an authenticated UID", () => {
  const shouldClearDeepLink = plainJavaScriptFunction(
    dashboard,
    "shouldClearOpportunityDeepLink",
  );
  assert.equal(shouldClearDeepLink("", "installer-a"), false);
  assert.equal(shouldClearDeepLink("installer-a", "installer-a"), false);
  assert.equal(shouldClearDeepLink("installer-a", "installer-b"), true);
  assert.equal(shouldClearDeepLink("installer-a", ""), true);

  const navigationScrub = sourceBetween(
    dashboard,
    "const scrubProtectedOpportunityNavigation",
    "const clearProtectedInstallerState",
  );
  const protectedClear = sourceBetween(
    dashboard,
    "const clearProtectedInstallerState",
    "useEffect(() => {",
  );
  const authTransition = sourceBetween(
    dashboard,
    "onAuthStateChanged(firebaseAuth",
    "  useEffect(() => {",
  );

  assert.match(navigationScrub, /initialOpportunityMatchId\.current = "";/);
  assert.match(navigationScrub, /searchParams\.delete\("matchId"\)/);
  assert.match(
    navigationScrub,
    /searchParams\.get\("workspace"\) === "leads"[\s\S]*searchParams\.set\("workspace", "work"\)/,
  );
  assert.match(
    navigationScrub,
    /nextUrl\.hash === "#opportunity-inbox"[\s\S]*nextUrl\.hash = ""/,
  );
  assert.match(navigationScrub, /window\.history\.replaceState\(/);
  assert.doesNotMatch(protectedClear, /initialOpportunityMatchId\.current/);
  assert.match(
    authTransition,
    /const previousUid = protectedIdentityUid\.current;[\s\S]*shouldClearOpportunityDeepLink\([\s\S]*previousUid \|\| "",[\s\S]*nextUid \|\| ""[\s\S]*scrubProtectedOpportunityNavigation\(\);[\s\S]*protectedIdentityUid\.current = nextUid;/,
  );
  assert.ok(
    authTransition.indexOf("scrubProtectedOpportunityNavigation();")
      < authTransition.indexOf("setUser(nextUser);"),
  );
});

test("lead open, respond and conversion continuations guard every protected write", () => {
  const openHandler = sourceBetween(
    dashboard,
    "const openOpportunityNotification",
    "useEffect(() => {",
  );
  const respondHandler = sourceBetween(
    dashboard,
    "async function respondToOpportunity",
    "async function convertOpportunity",
  );
  const convertHandler = sourceBetween(
    dashboard,
    "async function convertOpportunity",
    "async function toggleOpportunityPhotos",
  );

  for (const handler of [openHandler, respondHandler, convertHandler]) {
    assert.match(
      handler,
      /const activeUser = user;[\s\S]*protectedIdentityUid\.current !== activeUser\.uid[\s\S]*const identityUid = activeUser\.uid;[\s\S]*const identityRevision = protectedIdentityRevision\.current;/,
    );
    assert.match(handler, /protectedIdentityContinuationIsCurrent\(/);
    assert.match(
      handler,
      /const controller = new AbortController\(\);[\s\S]*protectedOpportunityRequestControllers\.current\.add\(controller\);/,
    );
    assert.match(
      handler,
      /const requestIsCurrent = \(\) =>\s*identityIsCurrent\(\) && !controller\.signal\.aborted;/,
    );
    assert.match(handler, /signal: controller\.signal/);
    assert.match(
      handler,
      /catch \([^)]*\) \{\s*if \(!requestIsCurrent\(\)\) return;/,
    );
    assert.match(
      handler,
      /finally \{[\s\S]*protectedOpportunityRequestControllers\.current\.delete\(controller\);/,
    );
    assertEveryAwaitIsRequestGuarded(handler);
  }

  assert.match(
    dashboard,
    /const abortProtectedOpportunityRequests = useCallback\([\s\S]*controller\.abort\(\);[\s\S]*protectedOpportunityRequestControllers\.current\.clear\(\)/,
  );
  assert.match(
    dashboard,
    /const clearProtectedInstallerState = useCallback\(\(\) => \{\s*abortProtectedOpportunityRequests\(\);/,
  );
  for (const handler of [respondHandler, convertHandler]) {
    assert.match(
      handler,
      /finally \{[\s\S]*if \(requestIsCurrent\(\)\) setOpportunityBusy\(""\);/,
    );
  }
});

test("stale photo continuations revoke new object URLs before they can persist", () => {
  const photoHandler = sourceBetween(
    dashboard,
    "async function toggleOpportunityPhotos",
    "async function installerPlanReport",
  );

  assert.match(
    photoHandler,
    /const controller = new AbortController\(\);[\s\S]*protectedOpportunityRequestControllers\.current\.add\(controller\);/,
  );
  assert.match(
    photoHandler,
    /const requestIsCurrent = \(\) =>\s*identityIsCurrent\(\) && !controller\.signal\.aborted;/,
  );
  assert.match(
    photoHandler,
    /const token = await activeUser\.getIdToken\(\);\s*if \(!requestIsCurrent\(\)\) return;/,
  );
  assert.match(photoHandler, /signal: controller\.signal/);
  assert.match(
    photoHandler,
    /const response = await fetch\([\s\S]*?\);\s*if \(!requestIsCurrent\(\)\) return null;/,
  );
  assert.match(
    photoHandler,
    /const result = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!requestIsCurrent\(\)\) return null;/,
  );
  assert.match(
    photoHandler,
    /const blob = await response\.blob\(\);\s*if \(!requestIsCurrent\(\)\) return null;\s*const url = URL\.createObjectURL\(blob\);\s*if \(!requestIsCurrent\(\)\) \{\s*URL\.revokeObjectURL\(url\);\s*return null;\s*\}\s*evidenceObjectUrls\.current\.add\(url\);/,
  );
  assert.match(
    photoHandler,
    /const results = await Promise\.allSettled[\s\S]*?if \(!requestIsCurrent\(\)\) \{\s*for \(const url of createdUrls\) revokeEvidenceObjectUrl\(url\);\s*return;/,
  );
  assert.match(
    photoHandler,
    /finally \{\s*protectedOpportunityRequestControllers\.current\.delete\(controller\);\s*if \(requestIsCurrent\(\)\) setEvidencePhotoBusy\(""\);/,
  );
});
