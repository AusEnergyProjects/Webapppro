import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/app/creditex/compliance/page.tsx");
const portal = read("../src/components/CreditexCompliancePortal.tsx");
const operations = read("../src/components/CreditexOperationsWorkspace.tsx");
const sessionRoute = read("../src/app/api/creditex/session/route.ts");
const caseRoute = read("../src/app/api/creditex/cases/route.ts");
const activityRoute = read("../src/app/api/creditex/activities/route.ts");
const evidenceRoute = read("../src/app/api/creditex/evidence/[id]/route.ts");
const schemaGuards = read("../src/lib/creditex-schema-guards.ts");
const routeSource = `${sessionRoute}\n${caseRoute}\n${activityRoute}`;
const surfaceSource = `${page}\n${portal}\n${routeSource}`;

test("Creditex compliance page is excluded from search and archival", () => {
  for (const directive of [
    /index:\s*false/,
    /follow:\s*false/,
    /noarchive:\s*true/,
    /nosnippet:\s*true/,
    /noimageindex:\s*true/,
  ]) assert.match(page, directive);
});

test("portal uses Firebase sign-in without public registration or bootstrap", () => {
  for (const contract of [
    /onAuthStateChanged/,
    /signInWithEmailAndPassword/,
    /signInWithPopup/,
    /sendPasswordResetEmail/,
    /There is no public registration/,
  ]) assert.match(portal, contract);
  assert.doesNotMatch(surfaceSource, /createUserWithEmailAndPassword|signUp|bootstrap|seed_/i);
  assert.doesNotMatch(sessionRoute, /export async function POST/);
});

test("first access installs schema guards in quota-safe batches and retries visibly", () => {
  assert.match(schemaGuards, /const SCHEMA_INSTALL_BATCH_SIZE = 40/);
  assert.match(schemaGuards, /missing\.slice\(0, SCHEMA_INSTALL_BATCH_SIZE\)/);
  assert.match(schemaGuards, /CREDITEX_SCHEMA_GUARDS_INSTALLING/);
  assert.match(sessionRoute, /code: "CREDITEX_SCHEMA_GUARDS_INSTALLING"/);
  assert.match(sessionRoute, /"Retry-After": "1"/);
  assert.match(portal, /for \(let attempt = 0; attempt < 6; attempt \+= 1\)/);
  assert.match(portal, /result\.code === "CREDITEX_SCHEMA_GUARDS_INSTALLING"/);
});

test("every Creditex endpoint enforces same-origin no-store verified membership access", () => {
  for (const route of [sessionRoute, caseRoute, activityRoute]) {
    assert.match(route, /if \(!sameOrigin\(request\)\)/);
    assert.match(route, /requireComplianceAccess\(request/);
    assert.match(route, /"Cache-Control": "private, no-store"/);
    assert.match(route, /ComplianceAccessError/);
  }
  assert.match(sessionRoute, /"admin", "case_manager", "reviewer", "auditor"/);
  assert.match(caseRoute, /"admin", "case_manager", "reviewer", "auditor"/);
  assert.match(activityRoute, /allowedRoles: \["admin"\]/);
});

test("case queue is read-only and returns only the approved privacy-minimised projection", () => {
  assert.doesNotMatch(caseRoute, /export async function (POST|PUT|PATCH|DELETE)/);
  for (const field of [
    "caseId",
    "caseNumber",
    "jobNumber",
    "installerBusiness",
    "jurisdiction",
    "activityDate",
    "programName",
    "activityKey",
    "registryActivityCode",
    "version",
    "specificationPart",
    "productCategory",
    "scenarioCode",
    "scenario",
    "effectiveFrom",
    "effectiveTo",
    "officialSourceVersion",
    "evidenceStatus",
    "workflowStatus",
    "createdAt",
    "updatedAt",
  ]) assert.match(caseRoute, new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(
    caseRoute,
    /trade_crm_customers|trade_crm_service_sites|trade_crm_job_media|address_line|postcode|customer_name|latitude|longitude|object_key/i,
  );
  for (const contract of [
    /decodeKeysetCursor/,
    /keysetAfter/,
    /encodeKeysetCursor/,
    /pageSize \+ 1/,
    /hasNext/,
    /nextCursor/,
    /ORDER BY \$\{CASE_SORT\.orderBy\}/,
  ]) assert.match(caseRoute, contract);
  assert.match(caseRoute, /const status = [^;]+ \|\| "open"/);
  assert.match(caseRoute, /status !== "open"[\s\S]*status !== "all"/);
  for (const openStatus of [
    "draft",
    "ready_for_submission",
    "submitted",
    "in_review",
    "changes_requested",
  ]) assert.match(caseRoute, new RegExp(`"${openStatus}"`));
  assert.doesNotMatch(
    caseRoute.slice(
      caseRoute.indexOf("const OPEN_CASE_STATUSES"),
      caseRoute.indexOf("const PAGE_SIZES"),
    ),
    /accepted|rejected|closed/,
  );
  assert.match(portal, /casePagination\.nextCursor/);
  assert.match(portal, /Load next \$\{casePagination\.pageSize\}/);
  assert.match(portal, /useState<\(typeof CASE_STATUSES\)\[number\]>\("open"\)/);
});

test("governance is admin-only with bounded draft, publish and withdraw actions", () => {
  assert.match(portal, /session\.role === "admin"/);
  assert.match(portal, /window\.confirm\(warning\)/);
  for (const action of [
    "create_program",
    "create_activity",
    "publish_program",
    "withdraw_program",
    "publish_activity",
    "withdraw_activity",
    "delete_draft_program",
    "delete_draft_activity",
  ]) assert.match(activityRoute, new RegExp(`"${action}"`));
  for (const helper of [
    "prepareComplianceProgramCreateStatement",
    "prepareComplianceProgramPublishStatement",
    "prepareComplianceProgramWithdrawStatement",
    "prepareComplianceActivityCreateStatement",
    "prepareComplianceActivityPublishStatement",
    "prepareComplianceActivityWithdrawStatement",
    "prepareComplianceProgramDraftDeleteStatement",
    "prepareComplianceActivityDraftDeleteStatement",
  ]) assert.match(activityRoute, new RegExp(helper));
  assert.match(activityRoute, /calculationApprovalState: "not_assessed"/);
  assert.match(portal, /Permanently delete this draft program/);
  assert.match(portal, /Permanently delete this draft activity version/);
  assert.match(portal, /void deleteDraft\("program", program\.id\)/);
  assert.match(portal, /void deleteDraft\("activity", activity\.id\)/);
});

test("portal never exposes automated outcome, value or submission-success claims", () => {
  assert.doesNotMatch(
    surfaceSource,
    /certificateCount|certificateQuantity|estimatedCertificates|eligibilityResult|eligible:\s*true|incentiveAmount|rebateAmount|submissionSuccess|successfully submitted/i,
  );
  assert.doesNotMatch(surfaceSource, /[\u2013\u2014]/);
  assert.doesNotMatch(operations, /[\u2013\u2014]/);
});

test("operations UI preserves unknown evidence policy fields and private evidence boundaries", () => {
  assert.match(operations, /function optionalBooleanValue/);
  assert.match(operations, /if \(value === undefined\) return null/);
  assert.match(operations, /function requirementFlag/);
  assert.match(operations, /Unknown \(not returned by the case API\)/);
  assert.doesNotMatch(operations, /not flagged/i);
  assert.doesNotMatch(operations, /fileName|file_name|originalSha256|original_sha256/);
  assert.match(operations, /Open audited evidence/);
  assert.match(operations, /Audited evidence viewer/);
  assert.match(operations, /No private storage key or original file name reaches the UI/);
  assert.match(operations, /reviewNote/);
  assert.match(operations, /case evidence state was recalculated/);
  assert.doesNotMatch(operations, /case-level evidence state was not changed/);
});

test("evidence viewer is assignment-bound, audited before return and never discloses storage names", () => {
  assert.match(evidenceRoute, /if \(!sameOrigin\(request\)\)/);
  assert.match(evidenceRoute, /requireComplianceAccess\(request/);
  assert.match(
    evidenceRoute,
    /allowedRoles:\s*\["admin", "reviewer", "auditor"\]/,
  );
  assert.doesNotMatch(
    evidenceRoute.slice(
      evidenceRoute.indexOf("allowedRoles:"),
      evidenceRoute.indexOf("}, database"),
    ),
    /case_manager/,
  );
  for (const contract of [
    /assignment\.assignment_role IN \(\s*'primary_reviewer', 'secondary_reviewer'/,
    /assignment\.assignment_role = 'auditor'/,
    /assignment\.status = 'assigned'/,
    /assignment\.compliance_user_id = \?/,
    /evidence\.organisation_id = \?/,
    /bucket\(\)\.get\(record\.object_key\)/,
    /'evidence\.viewed'/,
    /'compliance_case_evidence'/,
    /"X-Creditex-Evidence-Receipt"/,
    /"Cache-Control": "private, no-store"/,
    /"Content-Security-Policy": "sandbox; default-src 'none'"/,
    /"X-Frame-Options": "SAMEORIGIN"/,
    /headers\.set\("Content-Disposition", "inline"\)/,
  ]) assert.match(evidenceRoute, contract);
  assert.ok(
    evidenceRoute.indexOf("INSERT INTO compliance_audit_events")
      < evidenceRoute.indexOf("return new Response(object.body"),
    "the immutable evidence.viewed audit event must be inserted before bytes return",
  );
  assert.doesNotMatch(evidenceRoute, /file_name/);
  assert.doesNotMatch(evidenceRoute, /filename=/i);
});

test("portal holds per-evidence view receipts and gates writable review controls", () => {
  for (const contract of [
    /Authorization: `Bearer \$\{await activeUser\.getIdToken\(\)\}`/,
    /URL\.createObjectURL\(blob\)/,
    /URL\.revokeObjectURL\(objectUrl\)/,
    /X-Creditex-Evidence-Receipt/,
    /setEvidenceAccessReceipts/,
    /\{ \.\.\.evidenceReviewForm, evidenceAccessReceiptId \}/,
    /!selectedEvidenceAccessReceipt/,
    /Open this exact evidence item in the audited viewer before any review control is enabled/,
    /role="dialog"/,
    /aria-modal="true"/,
    /sandbox=""/,
    /reported by the stored evidence envelope/,
    /Unknown means the viewer did not receive that fact/,
  ]) assert.match(operations, contract);
  assert.match(
    operations,
    /const canReviewCompliance = \["admin", "reviewer"\]\.includes/,
  );
  assert.doesNotMatch(
    operations.slice(
      operations.indexOf("const canReviewCompliance"),
      operations.indexOf("const canRecordDecision"),
    ),
    /auditor/,
  );
});

test("operations UI parses full case workflow and wires bounded local actions", () => {
  for (const responseContract of [
    "assignments",
    "decisionRequests",
    "calculationRuns",
    "batchItems",
    "actorName",
  ]) assert.match(operations, new RegExp(`"${responseContract}"`));
  for (const action of [
    "assign_case",
    "release_case_assignment",
    "create_finding",
    "resolve_finding",
    "review_evidence",
    "record_decision",
    "add_participant",
    "add_participant_ability",
    "add_equipment",
    "create_draft_batch",
    "stage_batch_item",
    "remove_batch_item",
  ]) assert.match(operations, new RegExp(`runOperation\\(\\s*"${action}"`));
  assert.match(operations, /reviewerNote: decisionForm\.basis\.trim\(\)/);
  assert.doesNotMatch(operations, /basisSnapshot:\s*\{\s*reviewerBasis/);
  for (const disabledExternalAction of [
    "record_manual_response",
    "submit_batch",
    "submit_to_registry",
    "execute_trade",
    "settle_trade",
  ]) {
    assert.doesNotMatch(
      operations,
      new RegExp(`runOperation\\(\\s*"${disabledExternalAction}"`),
    );
  }
  assert.match(operations, /pendingDecisionRequests/);
  assert.match(operations, /Complete independent review/);
  assert.match(operations, /decisionType: "evidence_complete"/);
  assert.match(operations, /value="eligibility"/);
  assert.match(operations, /value="ready_to_submit"/);
  assert.match(operations, /decision\.caseRevision === selectedCase\.revision/);
  assert.match(operations, /request\.caseRevision !== selectedCase\.revision/);
  assert.match(operations, /server revalidates every requirement/i);
  assert.doesNotMatch(operations, /Ready-to-submit approval remains unavailable/);
});

test("operations UI automatically loads case detail and discloses bounded queues", () => {
  assert.match(operations, /setSelectedCaseKey\(firstCase\.id\)/);
  assert.match(operations, /void loadOperations\(firstCase\.id\)/);
  assert.match(operations, /if \(!item\.detailsLoaded\)/);
  assert.match(operations, /at most 50 records per category/);
  assert.match(operations, /does not provide pagination or a complete-result flag/);
  assert.match(operations, /limited to the selected case/);
});

test("portal tabs and disabled actions expose accessible semantics", () => {
  assert.match(portal, /role="tablist"/);
  assert.match(portal, /aria-controls="creditex-panel-cases"/);
  assert.match(portal, /aria-controls="creditex-panel-governance"/);
  assert.match(portal, /role="tabpanel"/);
  assert.match(portal, /handleWorkspaceTabKeyDown/);
  assert.match(operations, /aria-describedby=\{reasonId\}/);
  assert.match(operations, /className=\{styles\.disabledReason\}/);
});

test("named member access can be changed without enabling shared team credentials", () => {
  assert.match(operations, /"update_member_access"/);
  assert.match(operations, /Apply access change/);
  assert.match(operations, /at least two named administrators are active/);
  assert.match(operations, /suspend the bootstrap[\s\S]*mailbox membership/i);
  assert.match(operations, /"revoke_invitation"/);
  assert.match(operations, /Shared or role-based mailboxes are rejected/);
});
