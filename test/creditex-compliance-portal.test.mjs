import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  requestWithCreditexTokenRecovery,
} from "../src/lib/creditex-auth-token.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/app/creditex/compliance/page.tsx");
const portal = read("../src/components/CreditexCompliancePortal.tsx");
const evidenceGovernance = read(
  "../src/components/CreditexEvidencePolicyGovernance.tsx",
);
const evidenceGovernanceStyles = read(
  "../src/components/CreditexEvidencePolicyGovernance.module.css",
);
const officialSourceWorkbench = read(
  "../src/components/CreditexOfficialSourceWorkbench.tsx",
);
const operations = read("../src/components/CreditexOperationsWorkspace.tsx");
const operationsStyles = read(
  "../src/components/CreditexOperationsWorkspace.module.css",
);
const jobAuditStyles = read(
  "../src/components/CreditexVeuJobAuditWorkspace.module.css",
);
const governmentCatalogue = read(
  "../src/lib/australian-government-program-catalogue.ts",
);
const tradeNewJobForm = read("../src/components/TradeNewJobForm.tsx");
const tradeComplianceIntake = read(
  "../src/components/TradeComplianceIntake.tsx",
);
const tradeComplianceRoute = read("../src/app/api/trade-compliance/route.ts");
const tradeCrmRoute = read("../src/app/api/trade-crm/route.ts");
const tradeComplianceIntent = read(
  "../src/lib/trade-compliance-intent.ts",
);
const plannedIntakeQueue = read(
  "../src/components/CreditexPlannedIntakeQueue.tsx",
);
const plannedJobIntentRoute = read(
  "../src/app/api/creditex/job-intents/route.ts",
);
const plannedJobAuditRoute = read(
  "../src/app/api/creditex/job-intents/[intentId]/route.ts",
);
const sessionRoute = read("../src/app/api/creditex/session/route.ts");
const caseRoute = read("../src/app/api/creditex/cases/route.ts");
const activityRoute = read("../src/app/api/creditex/activities/route.ts");
const evidencePolicyRoute = read(
  "../src/app/api/creditex/evidence-policies/route.ts",
);
const evidenceRoute = read("../src/app/api/creditex/evidence/[id]/route.ts");
const schemaGuards = read("../src/lib/creditex-schema-guards.ts");
const routeSource =
  `${sessionRoute}\n${caseRoute}\n${activityRoute}\n${evidencePolicyRoute}\n${plannedJobIntentRoute}\n${plannedJobAuditRoute}`;
const surfaceSource =
  `${page}\n${portal}\n${evidenceGovernance}\n${officialSourceWorkbench}\n${routeSource}`;

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
  assert.doesNotMatch(
    portal.slice(
      portal.indexOf("async function signInEmail"),
      portal.indexOf("async function resetPassword"),
    ),
    /await loadWorkspace\(\)/,
  );
  assert.match(
    portal,
    /onAuthStateChanged[\s\S]*if \(nextUser\)[\s\S]*void loadWorkspace\(\)/,
  );
});

test("Creditex requests use the cached token first without forcing refresh", async () => {
  const tokenCalls = [];
  const requestTokens = [];
  const user = {
    uid: "creditex-user",
    getIdToken: async (...args) => {
      tokenCalls.push(args);
      return "cached-token";
    },
  };

  const result = await requestWithCreditexTokenRecovery({
    user,
    currentUid: () => "creditex-user",
    request: async (idToken) => {
      requestTokens.push(idToken);
      return { status: 200 };
    },
    isUnauthorized: (attempt) => attempt.status === 401,
  });

  assert.deepEqual(result, { status: 200 });
  assert.deepEqual(tokenCalls, [[]]);
  assert.deepEqual(requestTokens, ["cached-token"]);
});

test("an authentication 401 triggers exactly one forced token refresh", async () => {
  const tokenCalls = [];
  const requestTokens = [];
  const user = {
    uid: "creditex-user",
    getIdToken: async (...args) => {
      tokenCalls.push(args);
      return args[0] === true ? "refreshed-token" : "cached-token";
    },
  };

  const result = await requestWithCreditexTokenRecovery({
    user,
    currentUid: () => "creditex-user",
    request: async (idToken) => {
      requestTokens.push(idToken);
      return { status: requestTokens.length === 1 ? 401 : 200 };
    },
    isUnauthorized: (attempt) => attempt.status === 401,
  });

  assert.deepEqual(result, { status: 200 });
  assert.deepEqual(tokenCalls, [[], [true]]);
  assert.deepEqual(requestTokens, ["cached-token", "refreshed-token"]);
});

test("governed source uploads and retained-byte downloads preserve browser and identity boundaries", () => {
  assert.match(portal, /!\(init\.body instanceof FormData\)/);
  assert.match(portal, /CreditexOfficialSourceWorkbench/);
  assert.match(
    portal,
    /canCapture=\{\s*session\.role === "admin"\s*\|\| session\.role === "case_manager"/,
  );
  assert.match(
    portal,
    /session\.role === "admin"\s*&& session\.governanceIdentityVerified/,
  );
  assert.match(portal, /onDownload=\{downloadOfficialSource\}/);
  assert.match(
    portal,
    /\/api\/creditex\/official-sources\/\$\{encodeURIComponent\(artifactId\)\}/,
  );
  assert.match(portal, /requestWithCreditexTokenRecovery<Response>/);
  assert.match(portal, /response\.blob\(\)/);
  assert.match(portal, /X-Creditex-Official-Source-Receipt/);
  assert.match(portal, /return accessReceipt/);
  assert.match(portal, /URL\.createObjectURL\(blob\)/);
  assert.match(portal, /firebaseAuth\.currentUser\?\.uid !== activeUid/);
  assert.match(officialSourceWorkbench, /new FormData\(\)/);
  assert.match(officialSourceWorkbench, /"sourceFile"/);
});

test("network failures preserve the signed-in identity and expose workspace recovery", async () => {
  let currentUid = "creditex-user";
  const user = {
    uid: currentUid,
    getIdToken: async () => "cached-token",
  };

  await assert.rejects(
    requestWithCreditexTokenRecovery({
      user,
      currentUid: () => currentUid,
      request: async () => {
        const error = new Error("network unavailable");
        error.code = "auth/network-request-failed";
        throw error;
      },
      isUnauthorized: () => false,
    }),
    /network unavailable/,
  );

  assert.equal(currentUid, "creditex-user");
  assert.match(portal, /network-request-failed/);
  assert.match(portal, /retry the workspace/);
  assert.match(portal, /Firebase is signed in as \{user\.email/);
  assert.match(portal, /Retry workspace/);
});

test("workspace failures are not labelled as invalid credentials", () => {
  const workspaceMessageSource = portal.slice(
    portal.indexOf("function workspaceMessage"),
    portal.indexOf("function caseMatches"),
  );
  const workspaceLoaderSource = portal.slice(
    portal.indexOf("const loadWorkspace"),
    portal.indexOf("useEffect(", portal.indexOf("const loadWorkspace")),
  );

  assert.doesNotMatch(workspaceMessageSource, /email or password/i);
  assert.match(workspaceLoaderSource, /setNotice\(workspaceMessage\(error\)\)/);
  assert.doesNotMatch(workspaceLoaderSource, /setNotice\(authMessage\(error\)\)/);
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
  assert.match(sessionRoute, /CREDITEX_SCHEMA_MIGRATIONS_REQUIRED/);
});

test("every Creditex endpoint enforces same-origin no-store verified membership access", () => {
  for (const route of [
    sessionRoute,
    caseRoute,
    activityRoute,
    evidencePolicyRoute,
    plannedJobIntentRoute,
    plannedJobAuditRoute,
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

test("planned intake exposes private job context only to the exact Creditex organisation", () => {
  assert.match(
    tradeComplianceIntent,
    /CREDITEX_PARTNER_ORGANISATION_CODE = "CREDITEX-AU"/,
  );
  for (const contract of [
    /requireComplianceAccess\(request, \{\}, database\)/,
    /access\.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE/,
    /"CREDITEX_PARTNER_REQUIRED",\s*403/,
    /WHERE intent\.compliance_organisation_id = \?/,
    /queueBindings\(\s*access\.organisationId,\s*status,/,
  ]) assert.match(plannedJobIntentRoute, contract);
  assert.doesNotMatch(
    plannedJobIntentRoute,
    /export async function (POST|PUT|PATCH|DELETE)/,
  );
  assert.ok(
    plannedJobIntentRoute.indexOf(
      "access.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE",
    ) < plannedJobIntentRoute.indexOf("database.prepare(`SELECT"),
    "The exact Creditex organisation gate must run before private queue data is queried.",
  );
  for (const privateJoin of [
    /LEFT JOIN trade_crm_job_details details[\s\S]*details\.firebase_uid = work\.firebase_uid[\s\S]*details\.customer_source = 'trade_owned'/,
    /LEFT JOIN trade_crm_customers customer[\s\S]*customer\.firebase_uid = work\.firebase_uid/,
    /LEFT JOIN trade_crm_service_sites site[\s\S]*site\.firebase_uid = work\.firebase_uid[\s\S]*site\.customer_id = customer\.id/,
  ]) assert.match(plannedJobIntentRoute, privateJoin);
  assert.doesNotMatch(
    plannedJobIntentRoute,
    /(?:work|customer|site)\.record_status = 'active'/,
  );
  assert.match(plannedJobIntentRoute, /const PAGE_SIZE = 75/);
  assert.match(plannedJobIntentRoute, /count\(\*\) total/);
  assert.match(plannedJobIntentRoute, /totalPages/);
  assert.match(plannedJobIntentRoute, /value === "superseded"/);

  const projection = plannedJobIntentRoute.slice(
    plannedJobIntentRoute.indexOf("items: rows.results.map"),
    plannedJobIntentRoute.indexOf("} catch (error)"),
  );
  for (const field of [
    "id",
    "jobId",
    "jobNumber",
    "jobTitle",
    "jobStage",
    "jobPriority",
    "workRecordStatus",
    "jobDetailRecordStatus",
    "scheduledStart",
    "scheduledEnd",
    "assigneeLabel",
    "pipelineStage",
    "buildingType",
    "jobDescription",
    "nextAction",
    "jobTags",
    "estimatedValueCents",
    "quotedValueCents",
    "invoicedValueCents",
    "paidValueCents",
    "quoteStatus",
    "invoiceStatus",
    "installerBusiness",
    "customerNumber",
    "customerType",
    "customerName",
    "businessNumber",
    "customerEmail",
    "customerPhone",
    "customerTags",
    "customerPrivateNotes",
    "customerRecordStatus",
    "siteLabel",
    "serviceAddress",
    "accessInstructions",
    "parkingInstructions",
    "hazardNotes",
    "siteRecordStatus",
    "planningCurrent",
    "siteJurisdiction",
    "plannedStart",
    "programCode",
    "claimOutputCode",
    "claimOutputLabel",
    "registryActivityCode",
    "activityKey",
    "activityTitle",
    "serviceCategory",
    "catalogueReviewedOn",
    "status",
    "complianceCaseId",
    "updatedAt",
  ]) assert.match(projection, new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(
    plannedJobIntentRoute,
    /trade_crm_job_media|object_key|firebase_id_token|refresh_token|password_hash|session_cookie/i,
  );
  for (const contract of [
    /Creditex can inspect every assigned installer job, customer, service site and retained workflow record from planning onward/,
    /Open full audit workspace/,
    /All retained records/,
    /Superseded planning history/,
    /requestSequence/,
    /aria-expanded=\{expandedId === item\.id\}/,
    /item\.customerName/,
    /item\.customerPhone, item\.customerEmail/,
    /item\.serviceAddress/,
    /item\.customerPrivateNotes/,
    /item\.accessInstructions/,
    /item\.parkingInstructions/,
    /item\.hazardNotes/,
    /item\.estimatedValueCents/,
    /item\.quotedValueCents/,
    /item\.invoicedValueCents/,
    /item\.paidValueCents/,
    /Re-plan required/,
    /Planning snapshot:/,
  ]) assert.match(plannedIntakeQueue, contract);

  for (const contract of [
    /requireComplianceAccess\(request, \{\}, database\)/,
    /access\.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE/,
    /WHERE id = \? AND compliance_organisation_id = \?/,
    /AND partner_type = 'installer'[\s\S]*AND source_type = 'internal'/,
    /AND customer_source = 'trade_owned'/,
    /WHERE id = \? AND firebase_uid = \? AND customer_id = \?/,
    /const enquiryIdsSql = `SELECT id FROM trade_crm_enquiries[\s\S]*AND id = \?[\s\S]*AND customer_id = \?[\s\S]*AND service_site_id = \?`/,
    /CREDITEX_JOB_GRAPH_INCOMPLETE/,
    /CREDITEX_JOB_GRAPH_MISMATCH/,
    /trade_crm_enquiry_messages/,
    /trade_work_order_tasks/,
    /trade_crm_appointments/,
    /trade_crm_job_notes/,
    /trade_crm_job_media/,
    /trade_crm_quote_versions/,
    /trade_crm_quick_invoice_revisions/,
    /trade_installed_assets/,
    /compliance_case_evidence/,
    /PRIVATE_SERVER_FIELDS/,
    /PRIVATE_GROUP_FIELDS/,
    /privateServerField/,
    /"encrypted_token"/,
    /"object_key"/,
    /"idempotency_key"/,
    /field\.endsWith\("_token"\)/,
    /field\.endsWith\("_uid"\)/,
    /photoRequestDeliveries: new Set\(\["provider_message_id", "last_error"\]\)/,
    /accountingDocuments: new Set\(\[/,
    /const AUDIT_GROUP_PAGE_SIZE = 50/,
    /const cursorSql = cursor/,
    /ORDER BY \$\{sortField\} DESC, id DESC LIMIT \?/,
    /cursorValue/,
    /cursorId/,
    /const requestedGroup = requestedGroupKey[\s\S]*groups\.find/,
    /requestedGroup\.statement\.all<Row>\(\)/,
    /loaded: group\.key === requestedGroupKey/,
    /hasMore: group\.key === requestedGroupKey && requestedHasMore/,
    /job\.audit_workspace_opened/,
    /job\.audit_group_page_viewed/,
    /returnedRows: returnedRows\.length/,
    /INSERT INTO compliance_audit_events/,
  ]) assert.match(plannedJobAuditRoute, contract);
  assert.doesNotMatch(
    plannedJobAuditRoute,
    /groups\.map\(\(group\) => group\.statement\)/,
  );
  for (const lazyUiContract of [
    /const loadAuditGroup = useCallback/,
    /group: groupKey/,
    /event\.currentTarget\.open[\s\S]*!group\.loaded/,
    /Open to load/,
    /Load 50 more records/,
    /retryCursor: cursor/,
  ]) assert.match(plannedIntakeQueue, lazyUiContract);
  for (const provenanceContract of [
    /function addressProvenance\(serviceSite: Row\)/,
    /serviceSite\.address_entry_mode \|\| "manual_pending_review"/,
    /serviceSite\.address_provider_reference/,
    /serviceSite\.address_formatted/,
    /serviceSite\.address_verified_at/,
    /status: providerVerified[\s\S]*"provider_verified"[\s\S]*"manual_review_required"/,
    /reviewRequired: !providerVerified/,
    /serviceSiteAddressProvenance: requestedGroup[\s\S]*addressProvenance\(serviceSite\)/,
  ]) assert.match(plannedJobAuditRoute, provenanceContract);
  for (const reviewContract of [
    /serviceSiteAddressProvenance: ServiceSiteAddressProvenance/,
    /Manual address: review required/,
    /Creditex must compare it with the job evidence before relying on it for compliance/,
    /Provider-selected address/,
    /provenance\.providerReference/,
    /provenance\.formattedAddress/,
    /provenance\.verifiedAt/,
    /<AddressProvenanceView provenance=\{audit\.serviceSiteAddressProvenance\} \/>/,
  ]) assert.match(plannedIntakeQueue, reviewContract);
  assert.doesNotMatch(
    plannedJobAuditRoute,
    /customer_id = \?[\s\S]{0,100}\(\? = '' OR service_site_id = \?\)/,
  );
  assert.match(
    plannedJobAuditRoute,
    /Object\.entries\(row\)\.filter\(\(\[field\]\) => !privateServerField\(field, groupKey\)\)/,
  );
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
    /GOVERNMENT_CATALOGUE_REVIEWED_ON = "2026-08-08"/,
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

test("governed installer intake uses controlled dropdowns and binds the exact source version", () => {
  for (const contract of [
    /const \[programId, setProgramId\]/,
    /const \[activityKey, setActivityKey\]/,
    /const \[productCategory, setProductCategory\]/,
    /const \[scenario, setScenario\]/,
    /<span>Program<\/span>/,
    /<span>Activity<\/span>/,
    /<span>Product category<\/span>/,
    /<span>Activity scenario<\/span>/,
    /<span>Effective source version<\/span>/,
    /activityVersionId: effectiveActivityVersionId/,
    /pin the exact government source, activity, product/,
  ]) assert.match(tradeComplianceIntake, contract);
  assert.doesNotMatch(tradeNewJobForm, /complianceActivityVersionId/);
  assert.match(
    tradeNewJobForm,
    /assigned compliance team can review the customer, site, activity and schedule/,
  );
  assert.match(tradeComplianceRoute, /programId: activity\.programId/);
  assert.match(
    tradeComplianceIntake,
    /!initialIntent\.registryActivityCode[\s\S]*item\.registryActivityCode === initialIntent\.registryActivityCode[\s\S]*!initialIntent\.activityKey[\s\S]*item\.activityKey === initialIntent\.activityKey/,
  );
  assert.doesNotMatch(
    tradeComplianceRoute,
    /organisationName:\s*activity\.organisationName/,
  );
  assert.doesNotMatch(
    tradeComplianceIntake,
    /selectedActivity\.organisationName/,
  );
  assert.match(
    tradeComplianceIntake,
    /The assigned compliance team will audit this case/,
  );
  assert.doesNotMatch(tradeComplianceRoute, /ensureAcceptedCommercialHandoff/);
  assert.match(tradeComplianceRoute, /actorType: "installer"/);
  assert.doesNotMatch(
    `${tradeNewJobForm}\n${tradeComplianceIntake}`,
    /6\(23\)|synthetic/i,
  );
});

test("planned activity stays non-regulated until an exact governed chain promotes the same job", () => {
  const createJobStart = tradeCrmRoute.indexOf(
    'if (action === "create_job" || action === "create_scheduled_job")',
  );
  const createJobEnd = tradeCrmRoute.indexOf(
    "const workOrderId = cleanAdminText(body.workOrderId",
    createJobStart,
  );
  assert.ok(createJobStart >= 0 && createJobEnd > createJobStart);
  const createJobSource = tradeCrmRoute.slice(createJobStart, createJobEnd);

  for (const contract of [
    /resolveTradeComplianceIntents\(/,
    /INSERT INTO trade_work_order_compliance_intents/,
    /'planned', '', 1/,
    /compliance_intent_planned/,
    /No regulated case was created/,
    /complianceIntentPlanned: complianceIntents\.length > 0/,
  ]) assert.match(createJobSource, contract);
  assert.doesNotMatch(
    createJobSource,
    /INSERT INTO compliance_cases|INSERT INTO compliance_case_evidence|appendLiveComplianceCaseStatements/,
  );
  assert.match(
    tradeComplianceIntent,
    /governance:\s*\{[\s\S]*state: "setup_required"[\s\S]*exact published government rule and evidence policy/,
  );
  assert.match(
    tradeNewJobForm,
    /regulated case opens only when the exact published rule, product, evidence policy and calculation pathway are ready/,
  );

  const compliancePost = tradeComplianceRoute.slice(
    tradeComplianceRoute.indexOf("export async function POST"),
  );
  const createRegulatedCase = compliancePost.indexOf(
    "appendLiveComplianceCaseStatements(",
  );
  assert.ok(createRegulatedCase >= 0);
  assert.doesNotMatch(compliancePost, /ensureAcceptedCommercialHandoff|ACCEPTED_HANDOFF_REQUIRED/);
  assert.match(
    compliancePost,
    /optionalCommercialHandoff\(body\)[\s\S]*actorType: "installer"/,
  );
  assert.match(
    compliancePost,
    /UPDATE trade_work_order_compliance_intents[\s\S]*SET status = 'case_linked', compliance_case_id = \?/,
  );
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
  const portalStyles = read(
    "../src/components/CreditexCompliancePortal.module.css",
  );
  assert.match(portal, /role="tablist"/);
  assert.match(portal, /aria-controls="creditex-panel-cases"/);
  assert.match(portal, /aria-controls="creditex-panel-sources"/);
  assert.match(portal, /aria-controls="creditex-panel-governance"/);
  assert.match(portal, /Official sources/);
  assert.match(portal, /Official source custody/);
  assert.match(
    portal,
    /setTab\(session\.role === "admin" \? "governance" : "sources"\)/,
  );
  assert.ok(
    portal.indexOf('id="creditex-tab-sources"')
      < portal.indexOf('{session.role === "admin" && ('),
    "Every authorised compliance role must reach the source custody tab.",
  );
  assert.match(portal, /role="tabpanel"/);
  assert.match(portal, /handleWorkspaceTabKeyDown/);
  assert.ok(
    portal.indexOf('className={styles.tabs}')
      < portal.indexOf('{tab !== "pilot" && ('),
    "The permanent workspace tabs must render before tab-specific content.",
  );
  assert.match(
    portalStyles,
    /\.shell\s*\{[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*hidden/,
  );
  assert.match(
    portalStyles,
    /\.frame\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/,
  );
  assert.match(portalStyles, /--portal-ink:\s*#f4fbff/);
  assert.match(portalStyles, /--portal-soft:\s*#071b2a/);
  assert.match(operationsStyles, /shared protected Creditex palette/);
  assert.match(evidenceGovernanceStyles, /shared protected Creditex palette/);
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
    /\.empty,\s*\.unavailable\s*\{[^}]*background: #092331;[^}]*color: #b7cbd1;/s,
  ]) assert.match(operationsStyles, contract);
  for (const contract of [
    /\.privateRecordNote\s*\{[^}]*background: #352a16;[^}]*color: #f1d38e;/s,
    /\.mobileContext\s*\{[^}]*background: #092331;/s,
    /@media print[\s\S]*\.privateRecordNote\s*\{[^}]*background: #fff9e9;/s,
  ]) assert.match(jobAuditStyles, contract);
});

test("named member access can be changed without enabling shared team credentials", () => {
  assert.match(operations, /"update_member_access"/);
  assert.match(operations, /Apply access change/);
  assert.match(operations, /at least two named administrators are active/);
  assert.match(operations, /suspend the bootstrap[\s\S]*mailbox membership/i);
  assert.match(operations, /"revoke_invitation"/);
  assert.match(operations, /Shared or role-based mailboxes are rejected/);
});
