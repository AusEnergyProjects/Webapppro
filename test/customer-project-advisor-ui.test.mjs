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
const planPdf = read("../src/lib/customer-plan-pdf.mjs");
const planPdfClient = read("../src/lib/customer-plan-pdf-client.ts");
const planPdfButton = read("../src/components/DownloadCustomerPlanPdfButton.tsx");
const planPdfRoute = read("../src/app/api/customer-plan-pdf/route.ts");
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
  assert.match(dashboard, /customerHomeFeatureSections as rawCustomerHomeFeatureSections/);
  assert.match(dashboard, /<HomeFeatureIntake/);
  assert.match(dashboard, /What budget should the plan work around\?/);
  assert.match(dashboard, /This only changes sequence and scope/);
  assert.match(dashboard, /Do not enter a roof space, remove a cover or guess/);
  assert.match(dashboard, /goal: "",\s*goals: \[\]/);
  assert.match(dashboard, /priorities: \[\]/);
});

test("home answers and linked evidence remain distinct and never claim verification", () => {
  assert.match(dashboard, /Answers are recorded as household supplied, not professionally verified/);
  assert.match(dashboard, /What this file supports/);
  assert.match(dashboard, /Private to this plan/);
  assert.match(dashboard, /A linked file remains available for review, not verified/);
  assert.match(dashboard, /Mark remaining questions Not sure/);
  assert.doesNotMatch(dashboard, /updateFactEvidence\(/);
  assert.doesNotMatch(dashboard, /customerAdvisorOptions\.evidenceSources\.map/);
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
  assert.match(dashboard, /target\?\.querySelector<HTMLElement>/);
  assert.match(dashboard, /id="customer-property-roof"/);
  assert.match(dashboard, /id="customer-property-switchboard"/);
  assert.match(dashboard, /HomeFeatureIntake/);
  assert.match(dashboard, /Mark remaining questions Not sure/);
  assert.doesNotMatch(dashboard, /updateFactEvidence/);
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

test("optional professional review is explicit, self-declared and customer-facing", () => {
  assert.match(dashboard, /Optional professional review/);
  assert.match(dashboard, /Preparing this plan as an accredited adviser\?/);
  assert.match(dashboard, /customer-professional-review-declaration/);
  assert.match(dashboard, /declarationAccepted: event\.target\.checked/);
  assert.match(dashboard, /resetCustomerProfessionalReviewDeclaration/);
  assert.match(dashboard, /confirmsCurrentDeclaration/);
  assert.match(
    dashboard,
    /declarationVersion:\s*CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION/,
  );
  assert.match(
    dashboard,
    /advisorProfile: affectsAdvice[\s\S]{0,120}resetProfessionalReviewDeclaration/,
  );
  assert.match(
    projectPlan,
    /supplied\.declarationVersion[\s\S]{0,160}CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION/,
  );
  assert.match(
    dashboard,
    /Australian Energy Assessments has not checked my[\s\S]{0,120}identity, accreditation, reference or observations/,
  );
  assert.match(dashboard, /Adviser notes for the customer report/);
  assert.match(planShareDialog, /Professional review, self-declared/);
  assert.match(
    planDocument,
    /not an Australian Energy Assessments credential check, site assessment, NatHERS assessment or endorsement/,
  );
});

test("everyday actions stay outside the ordered roadmap in account and report views", () => {
  const accountEverydaySection = dashboard.indexOf(
    'className="customer-everyday-actions"',
  );
  const accountRoadmap = dashboard.indexOf(
    '<ol className="customer-roadmap-preview">',
  );
  assert.ok(accountEverydaySection >= 0, "account everyday section is present");
  assert.ok(accountRoadmap > accountEverydaySection, "account roadmap follows everyday section");
  assert.match(
    dashboard.slice(accountEverydaySection, accountRoadmap),
    /<\/section>\s*\)\}/,
  );

  const reportEverydaySection = planShareDialog.indexOf(
    'className="customer-plan-print-everyday"',
  );
  const reportRoadmap = planShareDialog.indexOf(
    'className="customer-plan-print-roadmap"',
  );
  assert.ok(reportEverydaySection >= 0, "report everyday section is present");
  assert.ok(reportRoadmap > reportEverydaySection, "report roadmap follows everyday section");
  assert.match(
    planShareDialog.slice(reportEverydaySection, reportRoadmap),
    /<\/section>\s*\)\}/,
  );
  assert.match(projectPlan, /everydayActions,\s*everydayActionsBoundary:[\s\S]{0,100}\s*items,/);
});

test("plan email saves before delivery while PDF download is mutation-free and browser native", () => {
  const downloadPlanSource = dashboard.match(
    /function downloadPlanPdf\(\)[\s\S]*?async function submitProject\(\)/,
  )?.[0] || "";
  assert.match(dashboard, /Email this plan/);
  assert.match(dashboard, /Download PDF/);
  assert.match(dashboard, /const projectId = await savePlanForSharing\(\)/);
  assert.match(dashboard, /customer-project-plan-email/);
  assert.match(dashboard, /consentConfirmed: true/);
  assert.match(dashboard, /key=\{shareRequestId \|\| "plan-share"\}/);
  assert.doesNotMatch(
    downloadPlanSource,
    /savePlanForSharing|onSave|onUploadEvidence/,
  );
  assert.match(downloadPlanSource, /downloadCustomerPlanPdf\(report\)/);
  assert.match(
    downloadPlanSource,
    /Your private draft and evidence were not changed/,
  );
  assert.match(
    downloadPlanSource,
    /createCustomerPlanReportView\(\s*shareablePlanDocument,\s*\)/,
  );
  assert.match(planPdf, /export async function createCustomerPlanPdfBytes\(/);
  assert.match(planPdf, /export function customerPlanPdfFileName\(report/);
  assert.match(planPdfClient, /export function downloadCustomerPlanPdf\(/);
  assert.match(planPdfClient, /createElement\("form"\)/);
  assert.match(planPdfClient, /form\.method = "POST"/);
  assert.match(planPdfClient, /form\.action = "\/api\/customer-plan-pdf"/);
  assert.match(planPdfClient, /input\.name = "report"/);
  assert.match(planPdfClient, /form\.submit\(\)/);
  assert.doesNotMatch(
    planPdfClient,
    /new Worker|new Blob|createObjectURL|anchor\.click/,
  );
  assert.match(planPdfRoute, /createCustomerPlanPdfBytes\(report\)/);
  assert.match(planPdfRoute, /Content-Disposition/);
  assert.match(planPdfRoute, /application\/pdf/);
  assert.match(planPdfRoute, /"Cache-Control": "no-store"/);
  assert.match(planPdfButton, /downloadCustomerPlanPdf\(report\)/);
  assert.match(planPdfButton, /if \(downloadingRef\.current\) return/);
  assert.match(planPdfButton, /downloadingRef\.current = true/);
  assert.match(planPdfButton, /downloadingRef\.current = false/);
  assert.match(planPdfButton, /disabled=\{busy\}/);
  assert.match(planPdfButton, /Download PDF/);
  assert.match(downloadPlanSource, /if \(activePdfDownload\.current\) return/);
  assert.match(downloadPlanSource, /activePdfDownload\.current = true/);
  assert.match(downloadPlanSource, /activePdfDownload\.current = false/);
  assert.doesNotMatch(dashboard, /createCustomerPlanPrintFrame/);
  assert.doesNotMatch(dashboard, /activePrintCleanup/);
  assert.doesNotMatch(dashboard, /customerPlanDocumentHtml/);
  assert.doesNotMatch(dashboard, /printView\.print\(\)/);
  assert.doesNotMatch(dashboard, /window\.print\(\)/);
  assert.doesNotMatch(
    dashboard,
    /afterprint|createElement\("iframe"\)|srcdoc/,
  );
  assert.doesNotMatch(planPdfClient, /(?:window|contentWindow)\.print\(\)/);
  assert.doesNotMatch(planPdfButton, /(?:window|contentWindow)\.print\(\)/);
  assert.doesNotMatch(planPdfClient, /createElement\("iframe"\)|srcdoc/);
  assert.doesNotMatch(dashboard, /<CustomerPlanPrintReport(?:\s|>)/);
  assert.doesNotMatch(styles, /body:has\(\.customer-plan-print-report\)/);
  assert.doesNotMatch(styles, /\.customer-plan-print-report \{ display: none; \}/);
  assert.doesNotMatch(planShareDialog, /document\?: PlanDocument|visible\?: boolean/);
  assert.doesNotMatch(planShareDialog, /createCustomerPlanReportView/);
  assert.match(planShareDialog, /role="dialog"/);
  assert.match(planShareDialog, /aria-modal="true"/);
  assert.match(planShareDialog, /event\.key === "Escape"/);
  assert.match(planShareDialog, /returnFocusRef/);
  assert.match(planShareDialog, /Review home details/);
  assert.match(planShareDialog, /readiness\.missingLabels\.map/);
  assert.match(dashboard, /readiness=\{shareablePlanDocument\.readiness\}/);
  assert.match(dashboard, /onReviewHomeDetails=\{reviewHomeDetailsBeforeSharing\}/);
  assert.match(planShareDialog, /PrintReport/);
  assert.match(
    planShareDialog,
    /<h2>Professional review, self-declared<\/h2>/,
  );
  assert.match(
    planShareDialog,
    /<h2>Helpful things you can try now<\/h2>/,
  );
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
  assert.match(
    styles,
    /\.customer-plan-print-professional-review blockquote p \{[^}]*overflow-wrap: anywhere/,
  );
  assert.match(
    planDocument,
    /overflow-wrap:anywhere;word-break:break-word;">\$\{escapeHtml\(professional\.title\)\}/,
  );
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
  assert.match(dashboard, /storedInstallerEvidenceCount \+ pendingInstallerEvidenceCount > 0/);
  assert.match(dashboard, /sharingScope === "private-plan"/);
  assert.match(dashboard, /homeFeatureQuestions\.length/);
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
