import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CUSTOMER_PROJECT_PHOTO_GUIDE_LIMIT,
  CUSTOMER_PROJECT_PHOTO_GUIDE_VERSION,
  customerProjectPhotoGuide,
} from "../src/lib/customer-project-photo-guide.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const component = read("../src/components/CustomerProjectPhotoCapture.tsx");
const componentStyles = read(
  "../src/components/CustomerProjectPhotoCapture.module.css",
);
const dashboard = read("../src/components/CustomerDashboard.tsx");

test("guided project photos are deterministic, bounded and round-robin project work", () => {
  const categories = ["hot-water", "glazing", "solar", "battery", "insulation"];
  const first = customerProjectPhotoGuide(categories);
  const second = customerProjectPhotoGuide(categories);
  assert.deepEqual(first, second);
  assert.ok(first.length <= CUSTOMER_PROJECT_PHOTO_GUIDE_LIMIT);
  assert.deepEqual(
    first.slice(0, 5).map((item) => item.serviceCategory),
    categories,
  );
  assert.equal(new Set(first.map((item) => item.id)).size, first.length);
  assert.equal(first.filter((item) => item.id === "shared:switchboard").length, 1);
  assert.match(CUSTOMER_PROJECT_PHOTO_GUIDE_VERSION, /^2026-07-30-/);
});

test("guided photos carry safe server-owned evidence presets", () => {
  const hotWater = customerProjectPhotoGuide(["hot-water"]);
  assert.ok(
    hotWater.every(
      (item) =>
        item.evidenceCategory === "existing-equipment"
        && item.factKeys[0] === "hot-water",
    ),
  );
  const insulation = customerProjectPhotoGuide(["insulation"]);
  assert.ok(
    insulation
      .filter((item) => item.id !== "insulation:insulation-area-context")
      .every((item) => item.factKeys[0] === "ceiling-insulation"),
  );
  assert.deepEqual(
    insulation.find(
      (item) => item.id === "insulation:insulation-area-context",
    )?.factKeys,
    [],
  );
  assert.match(insulation[0].guidance, /Do not enter a roof space/);
  const glazing = customerProjectPhotoGuide(["glazing"]);
  assert.ok(glazing.every((item) => item.factKeys[0] === "glazing"));
});

test("customer meter-box guidance keeps the enclosure closed", () => {
  const meterBox = customerProjectPhotoGuide(["solar"]).find(
    (item) => item.id === "solar:meter-box",
  );
  assert.ok(meterBox);
  assert.equal(meterBox.label, "Closed meter box exterior");
  assert.match(meterBox.guidance, /Keep the enclosure closed/);
  assert.doesNotMatch(meterBox.guidance, /open meter enclosure/i);
});

test("capture interface blocks inputs behind explicit safety and privacy checks", () => {
  assert.match(component, /Before opening the camera, confirm all three/);
  assert.match(component, /const canAdd = ready && remainingSlots > 0/);
  assert.match(component, /disabled=\{!canAdd\}/);
  assert.match(component, /disabled=\{!ready \|\| replacementLocked\}/);
  assert.match(component, /capture="environment"/);
  assert.match(component, /never enter a roof space or crawl under a home/);
  assert.match(component, /No people, mail, street numbers, number plates, bills, NMI/);
  assert.match(component, /Photos are optional/);
  assert.match(component, /save privately first/);
});

test("each guided prompt keeps every pending and saved photo in place", () => {
  assert.match(component, /function evidenceByCaptureSlot/);
  assert.match(component, /pendingBySlot/);
  assert.match(component, /storedBySlot/);
  assert.doesNotMatch(
    component,
    /new Map\(pendingEvidence\.map\(\(item\) => \[item\.captureSlot, item\]\)\)/,
  );
  assert.match(component, /promptStored\.map/);
  assert.match(component, /pendingAdditions\.map/);
  assert.match(component, /Add another photo/);
  assert.match(component, /Choose another photo/);
  assert.match(component, /photos"} in this section/);
  assert.match(component, /Ready to save with this plan/);
  assert.match(component, /Saved privately in this photo section/);
  assert.match(component, /Location and camera metadata removed/);
  assert.match(component, /Retake this photo/);
  assert.match(component, /Retake selected photo/);
  assert.match(component, /Choose replacement/);
  assert.match(component, /replaceEvidenceId: stored\.id/);
  assert.match(component, /expectedEvidenceRevision: stored\.revision/);
  assert.match(component, /replacePendingId: pending\.id/);
  assert.match(componentStyles, /\.photoList\s*\{/);
  assert.match(componentStyles, /\.photoItem\s*\{/);
  assert.match(componentStyles, /\.limitNote\s*\{/);
});

test("saved photos from earlier work selections remain visible and actionable", () => {
  assert.match(
    component,
    /const guideSlots = useMemo\([\s\S]*new Set\(guide\.map\(\(item\) => item\.id\)\)/,
  );
  assert.match(
    component,
    /storedEvidence\.filter\([\s\S]*!guideSlots\.has\(item\.captureSlot\)/,
  );
  assert.match(
    component,
    /pendingEvidence\.filter\([\s\S]*!guideSlots\.has\(item\.captureSlot\)/,
  );
  assert.match(component, /Saved from an earlier selection/);
  assert.match(
    component,
    /earlierSlots\.map\(\(captureSlot\)[\s\S]*slotStored\.map\(\(stored, index\)/,
  );
  assert.match(
    component,
    /const chooseStoredReplacement = \([\s\S]*replaceEvidenceId: stored\.id[\s\S]*expectedEvidenceRevision: stored\.revision/,
  );
  assert.match(component, /onRemoveStored\(stored\)/);
  assert.match(componentStyles, /\.earlierSelection\s*\{/);
  assert.match(componentStyles, /\.earlierSelectionItem\s*\{/);
});

test("generic other evidence and PDFs are not duplicated in the guided fallback", () => {
  const earlierFilter = component.slice(
    component.indexOf("const earlierStoredEvidence = useMemo"),
    component.indexOf("\n\n  const chooseNew =", component.indexOf(
      "const earlierStoredEvidence = useMemo",
    )),
  );

  assert.match(earlierFilter, /Boolean\(item\.captureSlot\)/);
  assert.match(
    earlierFilter,
    /!item\.captureSlot\.startsWith\("other:"\)/,
  );
  assert.match(
    earlierFilter,
    /item\.contentType\.startsWith\("image\/"\)/,
  );
  assert.match(earlierFilter, /!guideSlots\.has\(item\.captureSlot\)/);
});

test("new same-prompt photos append while exact pending replacements stay bounded", () => {
  const addEvidence = dashboard.slice(
    dashboard.indexOf("const addEvidence = ("),
    dashboard.indexOf("const removePendingEvidence"),
  );
  assert.match(addEvidence, /replacePendingId/);
  assert.match(
    addEvidence,
    /item\.replaceEvidenceId === preset\.replaceEvidenceId/,
  );
  assert.match(
    addEvidence,
    /!item\.replaceEvidenceId[\s\S]*item\.id !== replacePendingId/,
  );
  assert.match(
    addEvidence,
    /item\.id !== replacePendingId/,
  );
  assert.doesNotMatch(
    addEvidence,
    /item\.captureSlot !== preset\?\.captureSlot/,
  );
  assert.match(
    dashboard,
    /pendingEvidence\.filter\([\s\S]*\(item\) => !item\.replaceEvidenceId/,
  );
});

test("repeated photo controls remain contextual and quota feedback stays adjacent", () => {
  assert.match(component, /aria-label=\{`Remove \$\{evidence\.fileName\} from \$\{contextLabel\}`\}/);
  assert.match(component, /aria-label=\{`Retake \$\{contextLabel\}`\}/);
  assert.match(component, /aria-label=\{`Change selected \$\{contextLabel\}`\}/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /All 12 file spaces are used/);
  assert.match(component, /Replace or remove a photo to add/);
});

test("private draft and sharing saves keep unconfirmed installer files dirty", () => {
  const saveDraft = dashboard.slice(
    dashboard.indexOf("async function saveDraft()"),
    dashboard.indexOf("function planShareBlocker()"),
  );
  const savePlanForSharing = dashboard.slice(
    dashboard.indexOf("async function savePlanForSharing()"),
    dashboard.indexOf("function openShareDialog()"),
  );

  for (const source of [saveDraft, savePlanForSharing]) {
    assert.match(
      source,
      /pendingInstallerEvidence = pendingEvidence\.filter\([\s\S]*sharingScope === "allocated-installers"/,
    );
    assert.match(
      source,
      /setDirty\(pendingInstallerEvidence\.length > 0\)/,
    );
    assert.match(
      source,
      /will not upload until you confirm sharing when requesting responses/,
    );
  }
  assert.match(
    saveDraft,
    /storePendingEvidence\(saved\.id, privateEvidence, false\)/,
  );
  assert.match(
    savePlanForSharing,
    /storePendingEvidence\(id, privatePlanEvidence, false\)/,
  );
});

test("stored photo previews keep stable loaders across unrelated renders", () => {
  assert.match(
    dashboard,
    /const loadStoredEvidencePreview = useCallback\([\s\S]*onLoadEvidencePreview\(summary\)[\s\S]*\[onLoadEvidencePreview\]/,
  );
  assert.doesNotMatch(
    dashboard.slice(
      dashboard.indexOf("const loadStoredEvidencePreview = useCallback"),
      dashboard.indexOf("const updateEvidenceUploadProgress"),
    ),
    /\[onLoadEvidencePreview, visibleStoredEvidence\]/,
  );
  assert.match(
    dashboard,
    /const loadProjectEvidencePreview = useCallback\([\s\S]*\n    \[user\],\n  \);/,
  );
});

test("saved photo deletion changes local state only after confirmed API success", () => {
  const editorDeletion = dashboard.slice(
    dashboard.indexOf("const removeStoredEvidence = async"),
    dashboard.indexOf("const loadStoredEvidencePreview"),
  );
  const apiDeletion = dashboard.slice(
    dashboard.indexOf("async function deleteProjectEvidence"),
    dashboard.indexOf("async function updateProjectEvidence"),
  );
  const detailStart = dashboard.indexOf("function ProjectDetail");
  const detailDeletion = dashboard.slice(
    dashboard.indexOf("function confirmEvidenceDeletion", detailStart),
    dashboard.indexOf("\n\n  return (", detailStart),
  );

  assert.ok(
    editorDeletion.indexOf("await onDeleteEvidence(evidence)")
      < editorDeletion.indexOf("setUploadedEvidence"),
  );
  assert.match(apiDeletion, /throw failure/);
  assert.match(
    detailDeletion,
    /window\.confirm\([\s\S]*item\.fileName[\s\S]*cannot be undone/,
  );
  assert.ok(
    detailDeletion.indexOf("window.confirm")
      < detailDeletion.indexOf("onDeleteEvidence(item)"),
  );
});
