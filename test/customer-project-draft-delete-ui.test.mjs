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
  assert.match(
    dashboard,
    /project\.deletionPending[\s\S]*`Finish deleting draft \$\{project\.title\}`[\s\S]*`Delete draft \$\{project\.title\}`/,
  );
  assert.match(
    dashboard,
    /project\.deletionPending[\s\S]*\? "Finish deleting"[\s\S]*: "Delete draft"/,
  );
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

test("dashboard explains and exposes retryable paused draft cleanup", () => {
  assert.match(dashboard, /deletionPending\?: boolean/);
  assert.match(
    dashboard,
    /project\.deletionPending && \([\s\S]*className="customer-project-delete-pending"[\s\S]*role="status"/,
  );
  assert.match(
    dashboard,
    /File cleanup paused before this draft was fully[\s\S]*Finish deleting to complete it safely\./,
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
  assert.match(
    dashboard,
    /result\.code === "PROJECT_DELETE_CLEANUP_RETRY"[\s\S]*cache: "no-store"[\s\S]*setProjects\(refreshedProjects\)[\s\S]*setDraftToDelete\(refreshedDraft\)/,
  );
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
    /recovery=\{Boolean\(draftToDelete\?\.deletionPending\)\}/,
  );
  assert.match(
    dashboard,
    /returnFocus=\{deleteDraftReturnFocus\}/,
  );
  assert.match(dashboard, /onConfirm=\{\(\) => void deleteDraftProject\(\)\}/);
});

test("a deletion-locked draft cannot re-enter editing or active recommendations", () => {
  assert.match(
    dashboard,
    /const activeProjects = projects\.filter\([\s\S]*!project\.deletionPending/,
  );
  assert.match(
    dashboard,
    /const deletionBlockedProject =[\s\S]*editing\?\.deletionPending[\s\S]*selected\?\.deletionPending/,
  );
  assert.match(
    dashboard,
    /deletionBlockedProject \? \([\s\S]*className="customer-project-delete-recovery"[\s\S]*Finish deleting/,
  );
  assert.match(
    dashboard,
    /!project\.deletionPending && \(\s*<a[\s\S]*className="customer-project-card-open"/,
  );
});
