import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const installerDashboard = read("../src/components/DirectTradeDashboard.tsx");
const adminDirectory = read("../src/components/AdminAccountDirectory.tsx");
const adminDirectoryRoute = read("../src/app/api/admin/directory/route.ts");
const styles = read("../src/app/globals.css");
const projectPreparationGuide = read("../src/app/guides/project-preparation/page.tsx");
const projectPlan = read("../src/lib/customer-projects.mjs");
const homePlan = read("../src/lib/home-energy-plan.mjs");
const planShareDialog = read("../src/components/CustomerPlanShareDialog.tsx");
const planDocument = read("../src/lib/customer-plan-document.mjs");
const planEmailRoute = read("../src/app/api/customer-project-plan-email/route.ts");

test("the customer project wizard exposes every stage as an accessible button", () => {
  assert.match(dashboard, /\["Home", "Goals", "Your plan", "Work", "Privacy"\]/);
  assert.match(dashboard, /aria-current=\{step === index \+ 1 \? "step"/);
  assert.match(dashboard, /onClick=\{\(\) => openStep\(index \+ 1\)\}/);
  assert.match(dashboard, /<nav[\s\S]{0,100}aria-label="Project builder steps"/);
});

test("advisor intake supports multiple goals, tenure, budget and detailed home facts", () => {
  assert.match(dashboard, /Do you own or rent this home\?/);
  assert.match(dashboard, /Strata or common-property approval/);
  assert.match(dashboard, /Main goals, choose all that apply/);
  assert.match(dashboard, /type="checkbox"[\s\S]{0,120}checked=\{draft\.goals\.includes\(value\)\}/);
  assert.match(dashboard, /customerProjectOptions\.homeFeatures/);
  assert.match(dashboard, /What budget should the plan work around\?/);
  assert.match(dashboard, /This only changes sequence and scope/);
  assert.match(dashboard, /Do not enter a roof space, remove a cover or guess/);
  assert.match(dashboard, /goal: "",\s*goals: \[\]/);
  assert.match(dashboard, /priorities: \[\]/);
});

test("advisor evidence labels remain explicit and never claim uploaded files were verified", () => {
  assert.match(dashboard, /How well is each important home fact supported\?/);
  assert.match(dashboard, /Record the source, not a confidence score/);
  assert.match(
    dashboard,
    /does not mean a file is linked[\s\S]{0,80}verified the fact/,
  );
  assert.match(dashboard, /not proof that a[\s\S]{0,80}file is attached/);
  assert.match(dashboard, /customerAdvisorOptions\.evidenceSources/);
  assert.match(dashboard, /updateFactEvidence\(/);
  assert.doesNotMatch(dashboard, /Automatically verified|Evidence verified/);
});

test("postcode planning and room comfort stay bounded and planning only", () => {
  assert.match(dashboard, /derivePlanningClimateProfile\(/);
  assert.match(dashboard, /Broad postcode planning guide/);
  assert.match(dashboard, /planningClimate\.disclaimer/);
  assert.match(dashboard, /Room-by-room comfort profile/);
  assert.match(
    dashboard,
    /Private room names[\s\S]{0,60}not\s+sent to installers/,
  );
  assert.match(dashboard, /rooms\.length >= 12/);
  assert.match(dashboard, /customerAdvisorOptions\.comfortConcerns/);
  assert.match(dashboard, /customerAdvisorOptions\.usePeriods/);
  assert.match(dashboard, /maxLength=\{60\}/);
  assert.match(dashboard, /if \(affectsAdvice && planEdited\) setPlanInputsChanged\(true\)/);
  assert.match(projectPreparationGuide, /not a NatHERS climate zone/);
});

test("permission checklist is generated from the editable plan and exported without private location data", () => {
  assert.match(dashboard, /Property permission checklist/);
  assert.match(dashboard, /Build from current plan/);
  assert.match(
    dashboard,
    /classification: previous\?\.classification \|\| "not-sure" as const/,
  );
  assert.match(dashboard, /title: item\.title/);
  assert.match(dashboard, /previous\?\.classification/);
  assert.doesNotMatch(dashboard, /return existing\.get\(id\) \|\|/);
  assert.match(dashboard, /PermissionPackSectionKey/);
  assert.match(dashboard, /Review what the download will contain/);
  assert.match(dashboard, /optional approval note stays in this signed-in project/);
  assert.match(
    dashboard,
    /replaced by a private-note reminder in the download/,
  );
  assert.match(dashboard, /planItems: visiblePlanItems/);
  assert.match(dashboard, /permissionPackPreview\.sections\.map/);
  assert.match(dashboard, /Download permission checklist/);
  assert.match(dashboard, /property-permission-checklist\.txt/);
  assert.match(dashboard, /createCustomerPermissionPack\(/);
  assert.doesNotMatch(
    dashboard.match(/function permissionPackText[\s\S]*?function downloadPermissionPack/)?.[0] || "",
    /postcode|privateNotes|addressLine/,
  );
  assert.match(projectPreparationGuide, /planning checklist, not legal or/);
  assert.match(projectPreparationGuide, /id="evidence-first"/);
});

test("the customer can reorder, remove and add private plan steps", () => {
  assert.match(dashboard, /draggable/);
  assert.match(dashboard, /onDrop=\{\(\) => dropPlanItem\(item\.id\)\}/);
  assert.match(dashboard, /Move \$\{item\.title\} earlier/);
  assert.match(dashboard, /Remove \$\{item\.title\} from the plan/);
  assert.match(dashboard, /Add a home-specific step/);
  assert.match(dashboard, /Reset advisor suggestions/);
  assert.match(dashboard, /Array\.isArray\(initial\.planSnapshot\?\.items\)/);
  assert.match(dashboard, /planSnapshotConflict/);
  assert.match(dashboard, /Reset the advisor suggestions before saving/);
  assert.match(dashboard, /item\.href && item\.action/);
  assert.match(dashboard, /Your edited plan is preserved/);
  assert.match(dashboard, /Refresh advisor suggestions/);
  assert.match(dashboard, /Keep my edited steps/);
  assert.match(dashboard, /preserveEditedPlanItems\(/);
  assert.match(dashboard, /if \(planEdited\) setPlanInputsChanged\(true\)/);
  assert.match(dashboard, /if \(planInputsChanged\)/);
});

test("recommendations explain uncertainty and next questions return to controlled inputs", () => {
  assert.match(dashboard, /Why this is in your plan/);
  assert.match(dashboard, />Based on</);
  assert.match(dashboard, />Still uncertain</);
  assert.match(dashboard, />Could change if</);
  assert.match(dashboard, /Up to three questions that could change the plan/);
  assert.match(dashboard, /Not sure is allowed/);
  assert.match(dashboard, /openPlanQuestion\(question\)/);
  assert.match(dashboard, /getElementById\(question\.targetAnchor\)/);
  assert.match(dashboard, /id=\{`advisor-fact-\$\{factKey\}`\}/);
  assert.match(dashboard, /id="customer-add-room"/);
});

test("the private review worksheet never represents authenticated assessor authorship", () => {
  assert.match(dashboard, /Private review worksheet/);
  assert.match(dashboard, /Everything here is labelled Recorded by you/);
  assert.match(dashboard, /does not[\s\S]{0,100}assessor authored, approved or verified/);
  assert.match(dashboard, /customer-recorded-feedback/);
  assert.match(dashboard, /Add as private plan step/);
  assert.match(dashboard, /item\.status === "accepted"/);
  assert.match(dashboard, /after your explicit confirmation/);
  assert.doesNotMatch(dashboard, /Verified by assessor|Assessor approved/);
});

test("plan email and print actions use one saved privacy-filtered report", () => {
  assert.match(dashboard, /Email this plan/);
  assert.match(dashboard, /Print or save PDF/);
  assert.match(dashboard, /await savePlanForSharing\(\)/);
  assert.match(dashboard, /customer-project-plan-email/);
  assert.match(dashboard, /consentConfirmed: true/);
  assert.match(dashboard, /key=\{shareRequestId \|\| "plan-share"\}/);
  assert.match(dashboard, /CustomerPlanPrintReport document=\{shareablePlanDocument\}/);
  assert.match(planShareDialog, /role="dialog"/);
  assert.match(planShareDialog, /aria-modal="true"/);
  assert.match(planShareDialog, /event\.key === "Escape"/);
  assert.match(planShareDialog, /returnFocusRef/);
  assert.match(planShareDialog, /PrintReport/);
  assert.match(planShareDialog, /href=\{action\.guideHref\}/);
  assert.match(planDocument, /customerPlanDocumentHtml/);
  assert.match(planDocument, /customerPlanDocumentText/);
  assert.match(planEmailRoute, /status: "accepted"/);
  assert.doesNotMatch(planEmailRoute, /delivered successfully|email was delivered/i);
});

test("draft save state and plan sharing controls are readable and phone safe", () => {
  assert.match(dashboard, /<small role="status" aria-live="polite">/);
  assert.match(styles, /\.customer-editor-actions small \{ color: #4b6258; font-size: \.7rem; font-weight: 700/);
  assert.match(styles, /\.customer-plan-dialog-backdrop/);
  assert.match(styles, /@page \{ margin: 12mm; size: A4; \}/);
  assert.match(styles, /\.customer-plan-print-roadmap > ol > li[\s\S]{0,180}break-inside: avoid/);
  assert.match(styles, /\.customer-plan-toolbar-actions,[\s\S]{0,80}width: 100%/);
});

test("quote preparation is simpler, safer and keeps errors beside the action", () => {
  assert.doesNotMatch(dashboard, /Usual access timing/);
  assert.doesNotMatch(installerDashboard, /Access timing|propertyContext\.occupancy/);
  assert.match(installerDashboard, /Approval context/);
  assert.match(installerDashboard, /Site considerations/);
  assert.match(dashboard, /Not sure is a valid answer/);
  assert.match(dashboard, /Recommended photo and document checklist/);
  assert.equal((dashboard.match(/type="file"/g) || []).length, 1);
  assert.match(dashboard, /customer-action-error/);
  assert.match(dashboard, /storedEvidenceCount \+ pendingEvidence\.length > 0/);
  assert.match(
    dashboard,
    /12 - storedEvidenceCount - pendingEvidence\.length/,
  );
  assert.match(dashboard, /useState\(evidenceSharingConsent\)/);
  assert.match(dashboard, /form\.set\(\s*"confirmInstallerPhotoSharing"/);
  assert.match(dashboard, /Generated installer summary/);
  assert.match(dashboard, /Site considerations/);
  assert.match(styles, /\.customer-project-editor textarea \{[\s\S]*background: #fff/);
  assert.match(styles, /\.customer-action-error \{/);
});

test("preview navigation reports completed work instead of the open stage", () => {
  assert.match(dashboard, /completedStepCount \* 20/);
  assert.match(dashboard, /completedSteps\.has\(index \+ 1\)/);
  assert.match(dashboard, /setCompletedSteps\(\(current\) => new Set\(current\)\.add\(step\)\)/);
  assert.doesNotMatch(dashboard, /step \* 20/);
  assert.doesNotMatch(dashboard, /step > index \+ 1/);
});

test("roadmap preparation links explain requirements instead of opening another project", () => {
  for (const anchor of [
    "urgent-replacement",
    "permissions",
    "budget-under-2k",
    "budget-2-10k",
    "budget-10k-plus",
  ]) {
    assert.match(projectPreparationGuide, new RegExp(`id="${anchor}"`));
  }
  assert.match(homePlan, /\/guides\/project-preparation#urgent-replacement/);
  assert.match(homePlan, /\/guides\/project-preparation#permissions/);
  assert.match(projectPlan, /\/guides\/project-preparation#budget-under-2k/);
  assert.match(projectPlan, /\/guides\/project-preparation#budget-2-10k/);
  assert.match(projectPlan, /\/guides\/project-preparation#budget-10k-plus/);
});

test("account tenure remains owner or renter throughout customer administration", () => {
  assert.match(adminDirectory, /\['owner','renter'\]\.map/);
  assert.doesNotMatch(adminDirectory, /\['owner','renter','strata','planning-building'\]/);
  assert.match(adminDirectoryRoute, /HOUSEHOLD_SITUATIONS = new Set\(\["owner", "renter"\]\)/);
});

test("the retired Home records surface cannot return through customer navigation", () => {
  assert.doesNotMatch(dashboard, /Home records|\/account\/assets|CustomerAssetOwnershipCentre/);
  assert.equal(
    fs.existsSync(new URL("../src/app/account/assets/page.tsx", import.meta.url)),
    false,
  );
  assert.equal(
    fs.existsSync(
      new URL(
        "../src/components/CustomerAssetOwnershipCentre.tsx",
        import.meta.url,
      ),
    ),
    false,
  );
});
