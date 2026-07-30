import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dashboard = fs.readFileSync(
  new URL("../src/components/CustomerDashboard.tsx", import.meta.url),
  "utf8",
);

test("dashboard offers permanent deletion only from draft project cards", () => {
  assert.match(
    dashboard,
    /project\.status === "draft" && \(\s*<button[\s\S]*?className="customer-project-card-delete"/,
  );
  assert.match(dashboard, /aria-label=\{`Delete draft \$\{project\.title\}`\}/);
  assert.match(dashboard, />\s*Delete draft\s*</);
  assert.match(dashboard, /className="customer-project-card-open"/);
  assert.match(
    dashboard,
    /\["withdrawn", "completed"\]\.includes\(project\.status\)/,
  );
  assert.doesNotMatch(
    dashboard,
    /\["draft", "withdrawn", "completed"\]\.includes\(project\.status\)/,
  );
});

test("dashboard sends a confirmed, stale-safe draft deletion request", () => {
  assert.match(dashboard, /async function deleteDraftProject\(\)/);
  assert.match(
    dashboard,
    /fetch\("\/api\/customer-projects", \{[\s\S]*?method: "DELETE"/,
  );
  assert.match(dashboard, /confirmDelete: true/);
  assert.match(
    dashboard,
    /expectedPlanRevision: draftToDelete\.planRevision/,
  );
  assert.match(dashboard, /expectedUpdatedAt: draftToDelete\.updatedAt/);
  assert.match(dashboard, /setProjects\(result\.projects \|\| \[\]\)/);
  assert.match(dashboard, /projectListHeadingRef\.current\?\.focus\(\)/);
});

test("dashboard integrates the safe accessible confirmation dialog", () => {
  assert.match(
    dashboard,
    /import \{ CustomerDraftDeleteDialog \} from "\.\/CustomerDraftDeleteDialog"/,
  );
  assert.match(dashboard, /<CustomerDraftDeleteDialog/);
  assert.match(dashboard, /open=\{Boolean\(draftToDelete\)\}/);
  assert.match(dashboard, /busy=\{deleteDraftBusy\}/);
  assert.match(dashboard, /error=\{deleteDraftError\}/);
  assert.match(
    dashboard,
    /returnFocus=\{deleteDraftReturnFocus\}/,
  );
  assert.match(dashboard, /onConfirm=\{\(\) => void deleteDraftProject\(\)\}/);
});
