import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const panel = read("../src/components/TradeActivityWorkPackPanel.tsx");
const pad = read("../src/components/TradeWorkPackSignaturePad.tsx");
const styles = read("../src/components/TradeActivityWorkPackPanel.module.css");
const field = read("../src/components/TradeFieldWorkPanel.tsx");

test("assigned trades open governed work packs in the field record", () => {
  assert.match(field, /import \{ TradeActivityWorkPackPanel \}/);
  assert.match(field, /<TradeActivityWorkPackPanel key=\{workOrderId\} user=\{user\} workOrderId=\{workOrderId\}/);
  assert.match(field, /onPresenceChange=\{setHasGovernedPacks\}/);
  assert.match(field, /hasGovernedPacks === false && <section className="crm-field-card wide"/);
  assert.match(field, /Supporting acknowledgement/);
  assert.match(panel, /\/api\/trade-team\/work-packs/);
  assert.match(panel, /\?workOrderId=\$\{encodeURIComponent\(workOrderId\)\}/);
  assert.match(panel, /readOnly=\{readOnly\}/);
});

test("the guided web form autosaves exact CAS revisions and reloads conflicts", () => {
  assert.match(panel, /expectedResponseSha256: packRef\.current\.instance\.responseSha256/);
  assert.match(
    panel,
    /idempotency: \{[\s\S]*clientActionId,[\s\S]*deviceId: idempotencyDeviceId,[\s\S]*payloadHash/,
  );
  assert.match(panel, /setTimeout\(\(\) => \{[\s\S]*void flushDirty\(\);[\s\S]*\}, 700\)/);
  assert.match(panel, /saving\[key\] !== patch/);
  assert.match(panel, /Saving latest changes/);
  assert.match(panel, /WORK_PACK_REVISION_CONFLICT/);
  assert.match(panel, /The current saved version has been reloaded/);
  assert.match(panel, /firstIncompleteWorkPackPage/);
  assert.match(panel, /className=\{styles\.stepCount\}>Step/);
  assert.match(panel, /setMessage\("Saving\.\.\."\)/);
  assert.match(panel, /Back<\/button>/);
  assert.match(panel, />Continue<\/button>/);
});

test("repeat sections, references, dependencies and customer corrections stay in one flow", () => {
  assert.match(panel, /Add \{section\.repeatability\.itemLabel\}/);
  assert.match(panel, /Remove selected/);
  assert.match(panel, /referenceAcknowledgements/);
  assert.match(panel, /openedReferences\.has\(referenceKey\(document\)\)/);
  assert.match(panel, /Open before confirming/);
  assert.match(panel, /x-creditex-sha256/);
  assert.match(panel, /x-creditex-custody-receipt/);
  assert.match(panel, /browserRawSha256\(bytes\)/);
  assert.match(panel, /Products, scenarios and calculations/);
  assert.match(panel, /work_pack_select_scenario/);
  assert.match(panel, /Choose the job scenario/);
  assert.match(panel, /dependency\.scenarioCodes\.map/);
  assert.match(panel, /officialProductDependencyKey/);
  assert.match(panel, /work_pack_select_official_products/);
  assert.match(panel, /Find the exact installed product/);
  assert.match(panel, /Brand, model or approval number/);
  assert.match(panel, /selectionId: product\.selectionId/);
  assert.match(panel, /snapshotId: product\.snapshotId/);
  assert.match(panel, /Approved installed product saved and verified/);
  assert.match(panel, /work_pack_run_calculator/);
  assert.match(panel, /Calculate governed result/);
  assert.match(panel, /Creditex independent review is required before the governed result can be shown or used/);
  assert.match(panel, /pack\.calculatorPendingReviews\.find/);
  assert.match(panel, /Verified \{calculatorOutput\.claimOutputLabel\}: \{calculatorOutput\.quantity\} \{calculatorOutput\.unit\}/);
  assert.match(panel, /correct \{calculatorOutput\.claimOutputCode\} action remains separate/);
  assert.doesNotMatch(panel, /Verified certificate quantity/);
  assert.match(panel, /This is the exact governed result for this job/);
  assert.match(panel, /calculatorOutput\.executionReceiptSha256\.slice\(0, 19\)/);
  assert.match(panel, /Creditex verification required/);
  assert.match(panel, /Creditex or dispatch must verify this prompt/);
  assert.doesNotMatch(panel, /Complete this prompt(?:'|&apos;)s product, scenario or calculation setup first/);
  assert.doesNotMatch(panel, /estimate(?:d)? certificate|calculation estimate/i);
  assert.match(panel, /update_customer_context/);
  assert.match(panel, /Existing signatures were invalidated by the server/);
});

test("browser evidence uses exact server custody before linking to the governed response", () => {
  assert.match(panel, /fetch\(`\$\{ENDPOINT\}\/upload`/);
  assert.match(panel, /creditex-activity-work-pack-browser-upload\/v1/);
  for (const fieldName of [
    "caseInstanceId",
    "sectionKey",
    "repeatInstanceKey",
    "promptKey",
    "clientUploadId",
    "purpose",
    "file",
  ]) assert.match(panel, new RegExp(`formData\\.set\\("${fieldName}"`));
  assert.match(panel, /upload\.sha256 !== sha256/);
  assert.match(panel, /upload\.sizeBytes !== file\.size/);
  assert.match(panel, /responseValue\.status === 201 && result\.status === "applied"/);
  assert.match(panel, /responseValue\.status === 200 && result\.status === "duplicate"/);
  assert.match(panel, /result\.ok !== true/);
  assert.match(panel, /upload\.fileName !== file\.name/);
  assert.match(panel, /upload\.promptKey !== responseKey\(context\)/);
  assert.match(panel, /artifactLinks: \[\{/);
  assert.match(panel, /clientUploadId: upload\.clientUploadId/);
  assert.match(panel, /deviceId: upload\.deviceId/);
  assert.doesNotMatch(panel, /temporaryMultipartAction|work_pack_upload_artifact/);
});

test("provider, installer, technician, customer and site identities are visible but locked", () => {
  for (const label of [
    "Authorised provider",
    "Installer business",
    "Assigned technician",
    "Customer and site",
  ]) assert.match(panel, new RegExp(label));
  assert.match(panel, /pack\.executionContext\.provider/);
  assert.match(panel, /pack\.executionContext\.installerBusiness/);
  assert.match(panel, /pack\.executionContext\.assignment/);
  assert.match(panel, /pack\.customerContext/);
  assert.doesNotMatch(panel, /name="authorisedProvider"|name="installerBusiness"|name="assignedTechnician"/);
});

test("visible vector signatures bind after prepare and final PDFs remain server rendered", () => {
  assert.match(panel, /prepare_signing/);
  assert.match(panel, /capture_signatures/);
  assert.match(panel, /packets: \[\{/);
  assert.match(panel, /sessionId: upload\.sessionId/);
  assert.match(panel, /await action\("work_pack_capture_signatures", \{[\s\S]*\}, upload\.deviceId\)/);
  assert.doesNotMatch(panel, /signaturePackets|uploadSessionId/);
  assert.match(panel, /CreditexActivityWorkPackSignaturePayload/);
  assert.match(panel, /<TradeWorkPackSignaturePad/);
  assert.match(panel, /signature\.signaturePayload\.strokes/);
  assert.match(panel, /signerName: binding\.signerName/);
  assert.match(panel, /fields: \{ \.\.\.binding\.fields \}/);
  assert.match(panel, /Signer fixed from this job/);
  assert.doesNotMatch(panel, /name="signerName"|placeholder="Enter signer/);
  assert.match(panel, /Save this visible signature/);
  assert.match(pad, /<polyline key=\{index\} points=\{strokePoints\(stroke\)\}/);
  assert.match(styles, /touch-action: none/);
  assert.match(panel, /finalize/);
  assert.match(panel, /record\.downloadUrl/);
  assert.match(panel, /record\.pdfSha256/);
  assert.match(panel, /Finish and create signed PDF/);
  assert.doesNotMatch(
    panel,
    /from ["']pdf-lib["']|PDFDocument\.create\s*\(|createFinalPdf\s*\(/,
  );
});

test("the field form is visually distinct from governance and works at phone width", () => {
  assert.match(styles, /--pack-green: #087f5b/);
  assert.match(styles, /--pack-ink: #18312b/);
  assert.match(styles, /\.identity dl \{[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(styles, /min-height: 46px/);
  assert.match(styles, /\.signatureSurface \{[\s\S]*touch-action: none/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*\.prompt input,[\s\S]*\.customerForm input \{[\s\S]*font-size: 16px/,
  );
  assert.match(styles, /@media \(max-width: 420px\)/);
  assert.match(styles, /\.navigation \{[\s\S]*position: sticky/);
  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*\.navigation button \{[\s\S]*min-height: 48px/,
  );
  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*\.signatureSurface \{[\s\S]*height: 220px/,
  );
  assert.match(styles, /\.previewDialog/);
  assert.doesNotMatch(`${panel}\n${field}`, /âœ|â€¢|[✓•]/);
});
