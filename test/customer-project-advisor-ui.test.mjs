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
