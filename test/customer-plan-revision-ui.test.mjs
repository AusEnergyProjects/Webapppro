import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const history = read("../src/components/CustomerPlanRevisionHistory.tsx");
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
  assert.match(
    dashboard,
    /disabled=\{!emailVerified \|\| busy \|\| shareBusy \|\| pdfBusy\}/,
  );
  assert.match(route, /code: "PLAN_REVISION_CONFLICT"/);
  assert.match(route, /return planRevisionConflict\(/);
});

test("history compares meaningful changes and restores only after confirmation", () => {
  assert.match(history, /compareCustomerPlanRevisions/);
  assert.match(history, /Goals added after version/);
  assert.match(history, /Home details removed later/);
  assert.match(history, /Steps moved later/);
  assert.match(history, /Advisor plan version changed/);
  assert.match(history, /Restore this roadmap as a new version/);
  assert.match(history, /private notes,[\s\S]{0,120}evidence/i);
  assert.match(history, /disabled=\{busy \|\| !confirmed\}/);
  assert.match(dashboard, /action === "restore_plan_revision"/);
  assert.match(dashboard, /confirmRestore: true/);
  assert.match(dashboard, /expectedPlanRevision: project\.planRevision/);
  assert.match(dashboard, /expectedPlanRevision: saved\.planRevision/);
});
