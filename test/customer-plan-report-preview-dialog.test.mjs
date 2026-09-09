import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dialog = read("../src/components/CustomerPlanReportPreviewDialog.tsx");
const report = read("../src/components/CustomerPlanReportPreview.tsx");

test("the account plan opens the complete customer report without leaving the editor", () => {
  assert.match(dialog, /<CustomerPlanReportPreview report=\{report\}/);
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
