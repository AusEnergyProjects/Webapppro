import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const history = read("../src/components/CustomerPlanHistoryProgress.tsx");
const historyRoute = read("../src/app/api/customer-project-history/route.ts");
const route = read("../src/app/api/customer-projects/route.ts");

test("draft saves carry the current plan revision token", () => {
  assert.match(dashboard, /existingPlanRevision=\{editing\?\.planRevision\}/);
  assert.match(dashboard, /savedPlanRevision/);
  assert.match(dashboard, /expectedPlanRevision/);
  assert.match(
    dashboard,
    /\{ \.\.\.draft, id, action: "update", expectedPlanRevision \}/,
  );
  assert.match(dashboard, /response\.status === 409/);
  assert.match(dashboard, /result\.code === "PLAN_REVISION_CONFLICT"/);
  assert.match(dashboard, /fetch\("\/api\/customer-projects"/);
  assert.match(dashboard, /setProjectConflictVersion\(\(current\) => current \+ 1\)/);
  assert.match(dashboard, /projectConflictVersion/);
  assert.match(dashboard, /Your unsaved edits are still here/);
  assert.match(
    dashboard,
    /Discard my unsaved edits and load the latest saved version/,
  );
  assert.match(dashboard, /onReloadLatest/);
  assert.match(dashboard, /editGeneration\.current/);
  assert.match(dashboard, /noNewerEdits/);
  assert.match(dashboard, /createRequestId\.current \|\|= crypto\.randomUUID\(\)/);
  assert.match(dashboard, /\{ \.\.\.draft, clientCreateId \}/);
  assert.match(dashboard, /result\.created === false/);
  assert.match(dashboard, /canUpdateReplayedCustomerDraft\(savedProject\)/);
  assert.match(
    dashboard,
    /expectedPlanRevision: savedProject\.planRevision/,
  );
  assert.match(
    dashboard,
    /expectedUpdatedAt: savedProject\.updatedAt/,
  );
  const updateBranch = route.slice(
    route.indexOf('action === "update"'),
    route.indexOf('action === "restore_plan_revision"'),
  );
  assert.match(updateBranch, /expectedUpdatedAtProvided/);
  assert.match(
    updateBranch,
    /expectedUpdatedAt !== currentUpdatedAt/,
  );
  assert.ok(
    updateBranch.indexOf("expectedUpdatedAt !== currentUpdatedAt")
      < updateBranch.indexOf("normalizeCustomerProject(raw)"),
    "the server must reject a changed replay snapshot before normalizing or updating it",
  );
  assert.match(
    updateBranch,
    /AND plan_revision = \? AND updated_at = \?/,
  );
  assert.match(
    dashboard,
    /disabled=\{!emailVerified \|\| busy \|\| shareBusy \|\| pdfBusy\}/,
  );
  assert.match(route, /code: "PLAN_REVISION_CONFLICT"/);
  assert.match(route, /return planRevisionConflict\(/);
});

test("the extracted history workspace compares, exports and restores safely", () => {
  assert.match(history, /compareCustomerPlanRevisions/);
  assert.match(history, /customerPlanRevisionLabel/);
  assert.match(history, /Goals added/);
  assert.match(history, /Home details removed/);
  assert.match(history, /Ordered roadmap/);
  assert.match(history, /Download selected summary/);
  assert.match(history, /Restore version/);
  assert.match(history, /private notes,[\s\S]{0,120}evidence/i);
  assert.match(history, /disabled=\{busy \|\| !restoreConfirmed\}/);
  assert.match(history, /project\.status === "draft"/);
  assert.match(historyRoute, /expectedPlanRevision/);
  assert.match(historyRoute, /expectedUpdatedAt/);
  assert.match(historyRoute, /PLAN_REVISION_CONFLICT/);
  assert.match(dashboard, /CustomerPlanHistoryProgress/);
  assert.doesNotMatch(dashboard, /CustomerPlanRevisionHistory/);
  assert.match(dashboard, /action === "restore_plan_revision"/);
  assert.match(dashboard, /confirmRestore: true/);
  assert.match(dashboard, /expectedPlanRevision: project\.planRevision/);
  assert.match(dashboard, /onRecordOutcome=\{\(input\)/);
  assert.match(
    dashboard,
    /onRequestInstallerResponses\(\s*saved\.id,\s*saved\.planRevision,/,
  );
});
