import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const builder = read("../src/components/CreditexActivityWorkPackGovernance.tsx");
const css = read("../src/components/CreditexActivityWorkPackGovernance.module.css");
const documentOutputs = read("../src/components/CreditexWorkPackDocumentOutputEditor.tsx");
const documentOutputCss = read("../src/components/CreditexWorkPackDocumentOutputEditor.module.css");
const creditex = read("../src/components/CreditexCompliancePortal.tsx");
const admin = read("../src/components/AdminOperationsPortal.tsx");

test("Creditex and AEA admin share one governed activity form builder", () => {
  assert.match(creditex, /id="creditex-tab-forms"/);
  assert.match(creditex, /endpoint="\/api\/creditex\/work-packs"/);
  assert.match(creditex, /sourceEndpoint="\/api\/creditex\/official-sources"/);
  assert.match(creditex, /canCaptureSource=\{\["admin", "case_manager"\]/);
  assert.match(creditex, /onDownloadSource=\{downloadOfficialSource\}/);
  assert.match(admin, /tab === "form-governance"/);
  assert.match(admin, /endpoint="\/api\/admin\/compliance-work-packs"/);
  assert.match(admin, /sourceEndpoint="\/api\/admin\/compliance-official-sources"/);
  assert.match(admin, /canCaptureSource=\{\["owner", "admin"\]/);
  assert.match(admin, /onDownloadSource=\{downloadOfficialSource\}/);
  assert.match(admin, /!\(init\.body instanceof FormData\)/);
  assert.match(admin, /Supporting non-program field templates/);
});

test("Forms can capture and inspect one governed source artifact without making it selectable early", () => {
  assert.match(builder, /api\(`\$\{sourceEndpoint\}\?pageSize=100`\)/);
  assert.match(builder, /const form = new FormData\(\)/);
  assert.match(builder, /form\.set\("sourceFile", sourceFile\)/);
  assert.doesNotMatch(builder, /form\.set\("targetType"/);
  assert.doesNotMatch(builder, /form\.set\("targetId"/);
  assert.doesNotMatch(builder, /form\.set\("citationLocation"/);
  assert.match(builder, /queued for independent Creditex artifact review/);
  assert.match(builder, /sourceCustodyQueue/);
  assert.match(builder, /Open retained document/);
  assert.match(
    builder,
    /await onDownloadSource\(artifact\.id, artifact\.originalFileName\)/,
  );
  assert.match(builder, /snapshot\.sourceArtifacts\.map/);
  assert.match(builder, /Choose an exact approved source/);
  assert.match(css, /\.sourceUploadForm/);
  assert.match(css, /\.sourceCustodyQueue/);
});

test("the builder exposes the complete generic activity workflow vocabulary", () => {
  for (const type of [
    "text",
    "textarea",
    "number",
    "date",
    "select",
    "multiselect",
    "checkbox",
    "photo",
    "document",
    "reference_document",
    "signature",
  ]) assert.match(builder, new RegExp(`"${type}"`));

  assert.match(builder, /Add question, document or signature/);
  assert.match(builder, /Use an earlier answer to control visibility/);
  assert.match(builder, /Show this whole section only when earlier answers match/);
  assert.match(builder, /candidateSectionIndex < sectionIndex && !candidateSection\.repeatability/);
  assert.match(builder, /Repeat this section for multiple products or activities/);
  assert.match(builder, /Product, scenario and calculator dependencies/);
  assert.match(builder, /CREDITEX_OFFICIAL_PRODUCT_KINDS/);
  assert.match(builder, /Governed product type/);
  assert.match(builder, /officialProductKindLabel/);
  assert.match(builder, /productKind: event\.target\.value/);
  assert.match(builder, /identitySource/);
  assert.match(builder, /sourceBindingTargetKey/);
  assert.match(builder, /Reusable activity definition/);
  assert.match(
    builder,
    /server-resolved Creditex provider, installer business, customer,/,
  );
  assert.match(builder, /identity labels are\s*not editable in the form definition/);
  assert.match(css, /\.previewIdentityBoundary/);
});

test("draft editing and independent governance use exact hash CAS actions", () => {
  assert.match(builder, /expectedSchemaSha256/);
  assert.match(builder, /action: draft\.id \? "update_draft" : "create_draft"/);
  assert.match(builder, /action: "create_sourced_draft"/);
  assert.match(builder, /forms-sourced-draft:\$\{crypto\.randomUUID\(\)\}/);
  assert.match(builder, /originKind === "source_candidate"/);
  assert.match(builder, /Retained source-candidate map/);
  assert.match(builder, /Artifact review shown here is custody evidence only/);
  assert.doesNotMatch(builder, /createCreditexSourcedWorkPackDraft/);
  assert.match(builder, /action: "add_source_binding"/);
  assert.match(builder, /"review_source_binding"/);
  assert.match(builder, /"review_calculation_run"/);
  assert.match(builder, /calculationRunId: governanceAction\.action === "review_calculation_run"/);
  assert.match(builder, /Independent calculation review/);
  assert.match(builder, /Approve exact run/);
  assert.match(builder, /different authorised reviewer reruns and approves/);
  assert.match(builder, /inputSha256/);
  assert.match(builder, /outputSha256/);
  assert.match(builder, /"publish_version"/);
  assert.match(builder, /"withdraw_version"/);
  assert.match(builder, /"abandon_draft"/);
  assert.doesNotMatch(builder, /request_review/);
});

test("Forms shows every current catalogue gap even before an activity version exists", () => {
  assert.match(builder, /activityTemplateId: text\(item\.activityTemplateId\)/);
  assert.match(builder, /activityVersionId: text\(item\.activityVersionId\) \|\| null/);
  assert.match(builder, /snapshot\.coverage\.length/);
  assert.match(builder, /missingActivityVersions/);
  assert.match(builder, /Current governed activity version required/);
  assert.match(css, /\.unregisteredActivity/);
});

test("effective dates use the delegated range picker and governance decisions require a recorded note", () => {
  assert.match(builder, /data-date-range-group=/);
  assert.match(builder, /data-date-range-role="start"/);
  assert.match(builder, /data-date-range-role="end"/);
  assert.match(builder, /minLength=\{10\}/);
  assert.match(builder, /Record decision/);
  assert.match(css, /\.governanceDialog/);
  assert.match(css, /\.calculationReviewRows/);
  assert.match(css, /\.sectionVisibility/);
  assert.match(css, /@media \(max-width: 720px\)/);
});

test("Forms maps exact approved PDFs, job data and visible signer boxes before publication", () => {
  assert.match(builder, /CreditexWorkPackDocumentOutputEditor/);
  assert.match(builder, /documentOutputs: \[\.\.\.documentOutputs\]/);
  assert.match(documentOutputs, /Completed final PDF and visible signatures/);
  assert.match(documentOutputs, /one required completed record/);
  assert.match(documentOutputs, /Supporting documents belong in governed document questions/);
  assert.match(documentOutputs, /value\.length === 0/);
  assert.match(documentOutputs, /One completed final PDF per activity work pack/);
  assert.match(documentOutputs, /Approved blank PDF source target/);
  assert.match(documentOutputs, /sourceBindingTargetKey/);
  assert.match(documentOutputs, /CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION/);
  assert.match(documentOutputs, /\/prefill\/providerContext\/legalName/);
  assert.match(documentOutputs, /\/prefill\/installerBusinessContext\/businessName/);
  assert.match(documentOutputs, /\/prefill\/assignmentContext\/displayName/);
  assert.match(documentOutputs, /\/prefill\/customerSnapshot\/firstName/);
  assert.match(documentOutputs, /\/response\/answers\//);
  assert.match(documentOutputs, /Signature question/);
  assert.match(documentOutputs, /Signer role/);
  assert.match(documentOutputs, /From left %/);
  assert.match(documentOutputs, /From top %/);
  assert.match(documentOutputs, /PagePreview/);
  assert.match(documentOutputs, /type="radio" name="creditex-required-final-pdf"/);
  assert.match(documentOutputs, /required: index === outputIndex/);
  assert.match(documentOutputs, /Use as the one required final record before the technician can finish/);
  assert.match(documentOutputCss, /\.signaturePlacement/);
  assert.match(documentOutputCss, /@media \(max-width: 760px\)/);
});
