import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/app/creditex/compliance/page.tsx");
const portal = read("../src/components/CreditexCompliancePortal.tsx");
const evidenceGovernance = read(
  "../src/components/CreditexEvidencePolicyGovernance.tsx",
);
const evidenceGovernanceStyles = read(
  "../src/components/CreditexEvidencePolicyGovernance.module.css",
);
const operations = read("../src/components/CreditexOperationsWorkspace.tsx");
const operationsStyles = read(
  "../src/components/CreditexOperationsWorkspace.module.css",
);
const governmentCatalogue = read(
  "../src/lib/australian-government-program-catalogue.ts",
);
const tradeNewJobForm = read("../src/components/TradeNewJobForm.tsx");
const tradeComplianceRoute = read("../src/app/api/trade-compliance/route.ts");
const sessionRoute = read("../src/app/api/creditex/session/route.ts");
const caseRoute = read("../src/app/api/creditex/cases/route.ts");
const activityRoute = read("../src/app/api/creditex/activities/route.ts");
const evidencePolicyRoute = read(
  "../src/app/api/creditex/evidence-policies/route.ts",
);
const evidenceRoute = read("../src/app/api/creditex/evidence/[id]/route.ts");
const schemaGuards = read("../src/lib/creditex-schema-guards.ts");
const routeSource =
  `${sessionRoute}\n${caseRoute}\n${activityRoute}\n${evidencePolicyRoute}`;
const surfaceSource =
  `${page}\n${portal}\n${evidenceGovernance}\n${routeSource}`;

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
  assert.match(portal, /authUidRef = useRef\(""\)/);
  assert.match(portal, /workspaceLoadRef = useRef<\{[\s\S]*uid: string;[\s\S]*promise: Promise<void>/);
  assert.match(portal, /workspaceLoadRef\.current\?\.uid === activeUid/);
  assert.match(portal, /firebaseAuth\.currentUser\?\.uid !== activeUid/);
  assert.match(portal, /identityChanged[\s\S]*setSession\(null\)[\s\S]*setCases\(\[\]\)[\s\S]*setPrograms\(\[\]\)/);
  assert.match(portal, /await signInWithEmailAndPassword[\s\S]*await loadWorkspace\(\)/);
  assert.match(portal, /await signInWithPopup[\s\S]*await loadWorkspace\(\)/);
});

test("first access installs schema guards in quota-safe batches and retries visibly", () => {
  assert.match(schemaGuards, /const SCHEMA_INSTALL_BATCH_SIZE = 40/);
  assert.match(schemaGuards, /missing\.slice\(0, SCHEMA_INSTALL_BATCH_SIZE\)/);
  assert.match(schemaGuards, /CREDITEX_SCHEMA_GUARDS_INSTALLING/);
  assert.match(sessionRoute, /code: "CREDITEX_SCHEMA_GUARDS_INSTALLING"/);
  assert.match(sessionRoute, /"Retry-After": "1"/);
  assert.match(portal, /for \(let attempt = 0; attempt < 10; attempt \+= 1\)/);
  assert.match(portal, /result\.code === "CREDITEX_SCHEMA_GUARDS_INSTALLING"/);
  assert.match(portal, /response\.headers\.get\("Retry-After"\)/);
  assert.match(portal, /Preparing governed compliance controls/);
  assert.match(portal, /Retry workspace/);
  assert.match(sessionRoute, /CREDITEX_SCHEMA_GUARD_REVIEW_REQUIRED/);
});

test("every Creditex endpoint enforces same-origin no-store verified membership access", () => {
  for (const route of [
    sessionRoute,
    caseRoute,
    activityRoute,
    evidencePolicyRoute,
  ]) {
    assert.match(route, /if \(!sameOrigin\(request\)\)/);
    assert.match(route, /requireComplianceAccess\(request/);
    assert.match(route, /"Cache-Control": "private, no-store"/);
    assert.match(route, /ComplianceAccessError/);
  }
  assert.match(sessionRoute, /"admin", "case_manager", "reviewer", "auditor"/);
  assert.match(caseRoute, /"admin", "case_manager", "reviewer", "auditor"/);
  assert.match(activityRoute, /allowedRoles: \["admin"\]/);
  assert.match(evidencePolicyRoute, /allowedRoles: \["admin"\]/);
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
  assert.match(portal, /session\.governanceIdentityVerified/);
  assert.match(sessionRoute, /governanceIdentityVerified: member\.governanceIdentityVerified/);
  assert.doesNotMatch(portal, /SHARED_GOVERNANCE_EMAIL_LOCAL_PARTS/);
  assert.match(portal, /window\.confirm\(warning\)/);
  for (const action of [
    "create_program",
    "create_activity",
    "request_program_publication",
    "approve_program_publication",
    "reject_program_publication",
    "request_activity_publication",
    "approve_activity_publication",
    "reject_activity_publication",
    "publish_program",
    "withdraw_program",
    "publish_activity",
    "withdraw_activity",
    "delete_draft_program",
    "delete_draft_activity",
  ]) assert.match(activityRoute, new RegExp(`"${action}"`));
  for (const helper of [
    "prepareComplianceProgramCreateStatement",
    "prepareComplianceProgramWithdrawStatement",
    "prepareComplianceActivityCreateStatement",
    "prepareComplianceActivityWithdrawStatement",
    "prepareComplianceProgramDraftDeleteStatement",
    "prepareComplianceActivityDraftDeleteStatement",
    "prepareCompliancePublicationRequestStatements",
    "prepareCompliancePublicationDecisionStatements",
    "runComplianceGovernanceMutation",
  ]) assert.match(activityRoute, new RegExp(helper));
  assert.match(activityRoute, /COMPLIANCE_DUAL_CONTROL_REQUIRED/);
  assert.match(
    activityRoute,
    /await prepareComplianceProgramWithdrawStatement/,
  );
  assert.match(
    activityRoute,
    /await prepareComplianceActivityWithdrawStatement/,
  );
  assert.match(
    evidencePolicyRoute,
    /await prepareComplianceEvidencePolicyWithdrawStatement/,
  );
  assert.match(
    portal,
    /disabled=\{\s*Boolean\(busy\) \|\| !canRequestPublication\s*\}/,
  );
  assert.match(
    evidenceGovernance,
    /disabled=\{Boolean\(busy\) \|\| !canRequestPublication\}/,
  );
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

test("operations UI requires deliberate case selection and discloses bounded queues", () => {
  assert.doesNotMatch(operations, /setSelectedCaseKey\(firstCase\.id\)/);
  assert.match(operations, /if \(item\.id\) void loadOperations\(item\.id\)/);
  assert.match(operations, /const queueCase = selectedCaseKey/);
  assert.match(operations, /operationsRequestRef\.current\[requestKind\]/);
  assert.match(operations, /requestId !== operationsRequestRef\.current\[requestKind\]/);
  assert.match(operations, /if \(!item\.detailsLoaded\)/);
  assert.match(operations, /first\(workspace, \["pagination"\]\)/);
  assert.match(operations, /operations\.workspace\.total/);
  assert.match(operations, /operations\.workspace\.hasNext/);
  assert.match(operations, /limited to the selected case/);
});

test("operations UI is activity-agnostic with program tabs and Dataforce-parity filters", () => {
  for (const contract of [
    /className=\{styles\.programTabs\}/,
    /aria-label="Compliance program workspaces"/,
    /operations\.workspace\.programs\.map/,
    /chooseProgram\(program\.programId\)/,
    /className=\{styles\.activityTabRow\}/,
    /chooseActivity\(activity\.activityVersionId\)/,
    /activity\.activityVersionId/,
    /Dataforce-parity search/,
    /Status filters/,
    /Work &amp; personnel/,
    /Client &amp; agent/,
    /Customer &amp; address/,
    /Job filters/,
    /Appointment filters/,
    /Tag filters/,
    /Product filters/,
    /Audit filters/,
    /Other filters/,
    /Creditex verifies and[\s\S]*activates a government-source program record/,
  ]) assert.match(operations, contract);
  assert.doesNotMatch(operations, /6\(23\)/);
});

test("government catalogue distinguishes national outcomes and remains discovery-only", () => {
  for (const contract of [
    /GOVERNMENT_CATALOGUE_REVIEWED_ON = "2026-08-01"/,
    /"tradable_certificate"/,
    /"retailer_obligation_credit"/,
    /"rebate"/,
    /"grant"/,
    /"loan"/,
    /"project_credit"/,
    /"tariff_only"/,
    /"procurement_only"/,
    /programCode: "SRES"/,
    /programCode: "VEU"/,
    /programCode: "NSW-ESS"/,
    /programCode: "NSW-PDRS"/,
    /programCode: "ACT-EEIS"/,
    /programCode: "SA-REPS"/,
    /jurisdiction: "QLD"/,
    /jurisdiction: "WA"/,
    /jurisdiction: "TAS"/,
    /jurisdiction: "NT"/,
    /catalogueState: "closed"/,
    /catalogueState: "future"/,
    /catalogueState: "specialist"/,
  ]) assert.match(governmentCatalogue, contract);
  assert.match(portal, /A template is not an activated rule/);
  assert.match(portal, /does not author the rule/);
  assert.match(portal, /Creditex accreditation or connector[\s\S]*restriction/);
  assert.match(portal, /Government program template/);
  assert.match(portal, /Government activity template/);
  assert.match(portal, /COMPLIANCE_OUTCOME_CLASSES\.map/);
  assert.doesNotMatch(
    `${portal}\n${governmentCatalogue}\n${evidenceGovernance}`,
    /private rule|private national rule|Creditex private authority/i,
  );
  assert.doesNotMatch(
    governmentCatalogue,
    /certificateQuantity|certificateCount|estimatedCertificates|rebateAmount|incentiveAmount/,
  );
  assert.equal(
    (governmentCatalogue.match(/activity\("VEU", "6",/g) || []).length,
    1,
    "Part 6 must be one controlled template, not a special-case workflow",
  );
  assert.doesNotMatch(governmentCatalogue, /6\(23\)/);
});

test("installer intake uses chained governed dropdowns and binds the exact source version", () => {
  for (const contract of [
    /const \[complianceProgramId, setComplianceProgramId\]/,
    /const \[complianceActivityKey, setComplianceActivityKey\]/,
    /const \[complianceProductCategory, setComplianceProductCategory\]/,
    /const \[complianceScenario, setComplianceScenario\]/,
    /<span>Program<\/span><select/,
    /<span>Activity<\/span><select/,
    /<span>Product category<\/span><select/,
    /<span>Activity scenario<\/span><select/,
    /<span>Effective source version<\/span><select/,
    /name="complianceActivityVersionId"/,
    /exact government source, activity, product category, scenario and evidence requirement version/,
  ]) assert.match(tradeNewJobForm, contract);
  assert.match(tradeComplianceRoute, /programId: activity\.programId/);
  assert.doesNotMatch(tradeNewJobForm, /6\(23\)/);
});

test("authorised case detail renders private CRM data only after audited case access", () => {
  assert.match(portal, /Queue lists minimise private data/);
  assert.match(
    portal,
    /customer, installer, site,[\s\S]*appointments, evidence originals and[\s\S]*captured metadata/,
  );
  for (const contract of [
    /privateDetails: OperationPrivateDetails \| null/,
    /privateDetails: first\(actual/,
    /<PrivateCaseDetails details=\{item\.privateDetails\} \/>/,
    /Purpose-bound private access/,
    /Customer, installer and job workspace/,
    /Access audit recorded/,
    /Private notes/,
    /Exact address/,
    /Commercial state/,
    /Appointments/,
  ]) assert.match(operations, contract);
  assert.match(operations, /Government activity sources/);
  assert.match(operations, /submission and external outcome workflow/);
  assert.doesNotMatch(operations, /submission and certificate workflow/);
  assert.doesNotMatch(portal, /remain outside this queue/);
  assert.doesNotMatch(
    operations.slice(
      operations.indexOf("function PrivateCaseDetails"),
      operations.indexOf("function CaseReview"),
    ),
    /firebase_uid|object_key|original_filename/i,
  );
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

test("governance keeps program workspaces separate with scoped pagination and decision history", () => {
  for (const contract of [
    /className=\{styles\.governanceProgramTabs\}/,
    /aria-label="Governance program and activity workspaces"/,
    /chooseGovernanceProgram\(program\.id\)/,
    /governanceActivityId/,
    /visibleGovernanceActivities/,
    /selectedProgramId=\{selectedGovernanceProgram\?\.id \|\| ""\}/,
    /selectedActivityVersionId=\{effectiveGovernanceActivityId\}/,
  ]) assert.match(portal, contract);
  for (const contract of [
    /programId: query\.programId/,
    /activityVersionId: query\.activityVersionId/,
    /page: query\.policyPage/,
    /page: query\.requestPage/,
    /pageSize: query\.pageSize/,
    /publicationRequests\.items/,
    /policies\.items\.map/,
    /policies: policies\.pagination/,
    /publicationRequests: publicationRequests\.pagination/,
  ]) assert.match(evidencePolicyRoute, contract);
  for (const contract of [
    /policyPage: String\(policyPage\)/,
    /requestPage: String\(requestPage\)/,
    /query\.set\("programId", selectedProgramId\)/,
    /query\.set\("activityVersionId", selectedActivityVersionId\)/,
    /Immutable publication decision history/,
    /request\.reviewedByName/,
    /request\.reviewedAt \|\| request\.updatedAt/,
    /request\.reviewNote/,
    /request\.sealedSnapshotSha256/,
    /Previous requests/,
    /Next requests/,
    /Previous policies/,
    /Next policies/,
    /Waiting for review/,
  ]) assert.match(evidenceGovernance, contract);
  assert.match(evidenceGovernanceStyles, /:focus-visible/);
  assert.doesNotMatch(`${portal}\n${evidenceGovernance}`, /6\(23\)/);
  assert.doesNotMatch(
    `${portal}\n${evidenceGovernance}`,
    /Dataforce-parity|automatically eligible|certificate quantity/i,
  );
});

test("governance fails closed when scoped records are loading or unavailable", () => {
  for (const contract of [
    /type GovernanceLoadState = "loading" \| "loaded" \| "blocked"/,
    /setLoadState\("loading"\)/,
    /setLoadState\("loaded"\)/,
    /setLoadState\("blocked"\)/,
    /aria-busy=\{loadState === "loading"\}/,
    /loadState === "loaded" && \(/,
    /No empty-state or policy count is shown/,
    /Authoring and publication controls remain locked/,
    /Retry governed records/,
    /role=\{noticeKind === "error" \? "alert" : "status"\}/,
    /if \(loadState !== "loaded"\)/,
  ]) assert.match(evidenceGovernance, contract);
  assert.match(evidenceGovernanceStyles, /\.loadState button:focus-visible/);
});

test("Creditex program rails remain reachable and critical audit text is legible", () => {
  assert.match(portal, /className=\{`\$\{styles\.panel\} \$\{styles\.governancePanel\}`\}/);
  for (const contract of [
    /\.governancePanel\s*\{[^}]*padding-bottom:/s,
    /\.governanceProgramTabs\s*\{[^}]*position: fixed;/s,
    /\.governanceProgramTabs\s*\{[^}]*width: min\(/s,
    /\.governanceProgramTabs\s*\{[^}]*env\(safe-area-inset-bottom\)/s,
  ]) assert.match(
    read("../src/components/CreditexCompliancePortal.module.css"),
    contract,
  );
  for (const contract of [
    /\.workspace\s*\{[^}]*padding-bottom:/s,
    /\.programTabs\s*\{[^}]*position: fixed;/s,
    /\.programTabs\s*\{[^}]*width: min\(/s,
    /\.programTabs button span\s*\{[^}]*font-size: \.75rem/s,
    /\.programTabs button small\s*\{[^}]*font-size: \.7rem/s,
    /\.privateDetailGrid dt\s*\{[^}]*font-size: \.7rem/s,
    /\.privateDetailGrid dd\s*\{[^}]*font-size: \.75rem/s,
  ]) assert.match(operationsStyles, contract);
});

test("named member access can be changed without enabling shared team credentials", () => {
  assert.match(operations, /"update_member_access"/);
  assert.match(operations, /Apply access change/);
  assert.match(operations, /at least two named administrators are active/);
  assert.match(operations, /suspend the bootstrap[\s\S]*mailbox membership/i);
  assert.match(operations, /"revoke_invitation"/);
  assert.match(operations, /Shared or role-based mailboxes are rejected/);
});
