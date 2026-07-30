import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const dialog = read("../src/components/CustomerPlanReportPreviewDialog.tsx");
const report = read("../src/components/CustomerPlanReportPreview.tsx");

test("the account plan opens the complete customer report without leaving the editor", () => {
  assert.match(dashboard, /Preview full report/);
  assert.match(dashboard, /setReportPreviewOpen\(true\)/);
  assert.match(dashboard, /<CustomerPlanReportPreviewDialog/);
  assert.match(dashboard, /createCustomerPlanReportView\(shareablePlanDocument\)/);
  assert.match(dialog, /<CustomerPlanReportPreview report=\{report\}/);
  assert.equal((dashboard.match(/Preview full report/g) || []).length, 2);
  assert.equal((dashboard.match(/Email this plan/g) || []).length, 2);
  assert.equal((dashboard.match(/Download PDF/g) || []).length, 2);
  assert.match(dashboard, /customer-plan-toolbar-bottom/);
});

test("the report preview is a keyboard-dismissible modal with focus restoration", () => {
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /querySelectorAll<HTMLElement>/);
  assert.match(dialog, /event\.shiftKey/);
  assert.match(dialog, /previouslyFocused\?\.focus\(\)/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(report, /data-aea-report-design=\{report\.designVersion\}/);
  assert.match(report, /target="_blank"/);
  assert.match(report, /rel="noreferrer"/);
});
