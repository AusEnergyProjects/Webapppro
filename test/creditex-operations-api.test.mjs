import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const server = read("../src/lib/creditex-operations-server.ts");
const operationsRoute = read("../src/app/api/creditex/operations/route.ts");
const accessRoute = read("../src/app/api/creditex/access/route.ts");
const migration = [
  "../drizzle/0094_creditex_operations_control.sql",
  "../drizzle/0095_creditex_operations_workflows.sql",
  "../drizzle/0096_creditex_operations_integrity.sql",
  "../drizzle/0097_creditex_operations_lifecycle.sql",
].map(read).join("\n--> statement-breakpoint\n");
const schemaGuards = read("../src/lib/creditex-schema-guards.ts");
const complianceDomain = read("../src/lib/creditex-compliance-server.ts");
const tradeAccess = read("../src/lib/trade-access-server.ts");
const tradeTeam = read("../src/lib/trade-team-server.ts");
const publicJobInformation = read("../src/app/api/job-information/[token]/route.ts");

function loadServer() {
  const output = ts.transpileModule(server, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "creditex-operations-server.ts",
  }).outputText;
  const record = { exports: {} };
  const require = (specifier) => {
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    record,
    record.exports,
  );
  return record.exports;
}

const operationsModule = loadServer();

test("Creditex operations routes enforce same-origin, no-store and verified membership access", () => {
  for (const route of [operationsRoute, accessRoute]) {
    assert.match(route, /if \(!sameOrigin\(request\)\)/);
    assert.match(route, /"Cache-Control": "private, no-store"/);
    assert.match(route, /requireFirebaseIdentity\(request\)/);
    assert.match(route, /requireComplianceIdentity\(identity/);
    assert.match(route, /ComplianceAccessError/);
    assert.doesNotMatch(route, /export async function (PUT|PATCH|DELETE)/);
  }
  assert.match(
    operationsRoute,
    /allowedRoles: \["admin", "case_manager", "reviewer", "auditor"\]/,
  );
  assert.match(accessRoute, /allowedRoles: \["admin"\]/);
});

test("operations filters are activity-agnostic, bounded, and cover the authoritative case dimensions", () => {
  const filters = operationsModule.parseCreditexOperationsFilters(
    new URLSearchParams([
      ["program", "VEU"],
      ["program", "SRES"],
      ["activity", "6(23)"],
      ["activity", "HPHW-1"],
      ["status", "in_review"],
      ["evidenceStatus", "changes_required"],
      ["workType", "job"],
      ["serviceCategory", "hot-water"],
      ["createdBy", "Reviewer One"],
      ["createdByType", "compliance"],
      ["fieldWorker", "Crew A"],
      ["customer", "Example customer"],
      ["customerType", "residential"],
      ["address", "Melbourne"],
      ["installer", "Example installer"],
      ["identifier", "JOB-1042"],
      ["jobSource", "internal"],
      ["workStage", "scheduled"],
      ["pipelineStage", "approved"],
      ["priority", "high"],
      ["issueStatus", "open"],
      ["appointmentStatus", "scheduled"],
      ["appointmentType", "installation"],
      ["auditState", "attention"],
      ["certificateState", "pending"],
      ["batchState", "draft"],
      ["submissionStatus", "staged"],
      ["quoteStatus", "accepted"],
      ["invoiceStatus", "issued"],
      ["product", "heat pump"],
      ["productCategory", "heat-pump-water-heater"],
      ["tag", "priority"],
      ["tag", "veu"],
      ["tagMatch", "all"],
      ["installedFrom", "2026-01-01"],
      ["installedTo", "2026-12-31"],
      ["appointmentFrom", "2026-02-01"],
      ["appointmentTo", "2026-11-30"],
      ["pageSize", "100"],
    ]),
  );
  assert.deepEqual(filters.programs, ["VEU", "SRES"]);
  assert.deepEqual(filters.activities, ["6(23)", "HPHW-1"]);
  assert.deepEqual(filters.lifecycleStatuses, ["in_review"]);
  assert.deepEqual(filters.evidenceStatuses, ["changes_required"]);
  assert.deepEqual(filters.workTypes, ["job"]);
  assert.deepEqual(filters.serviceCategories, ["hot-water"]);
  assert.equal(filters.createdByText, "Reviewer One");
  assert.deepEqual(filters.createdByTypes, ["compliance"]);
  assert.equal(filters.fieldWorkerText, "Crew A");
  assert.equal(filters.customerText, "Example customer");
  assert.deepEqual(filters.customerTypes, ["residential"]);
  assert.equal(filters.addressText, "Melbourne");
  assert.equal(filters.installerText, "Example installer");
  assert.equal(filters.identifierText, "JOB-1042");
  assert.deepEqual(filters.jobSources, ["internal"]);
  assert.deepEqual(filters.workStages, ["scheduled"]);
  assert.deepEqual(filters.pipelineStages, ["approved"]);
  assert.deepEqual(filters.priorities, ["high"]);
  assert.deepEqual(filters.issueStatuses, ["open"]);
  assert.deepEqual(filters.appointmentStatuses, ["scheduled"]);
  assert.deepEqual(filters.appointmentTypes, ["installation"]);
  assert.deepEqual(filters.auditStates, ["attention"]);
  assert.deepEqual(filters.certificateStatuses, ["pending"]);
  assert.deepEqual(filters.batchStatuses, ["draft"]);
  assert.deepEqual(filters.submissionStatuses, ["staged"]);
  assert.deepEqual(filters.quoteStatuses, ["accepted"]);
  assert.deepEqual(filters.invoiceStatuses, ["issued"]);
  assert.equal(filters.productText, "heat pump");
  assert.deepEqual(filters.productCategories, ["heat-pump-water-heater"]);
  assert.deepEqual(filters.tags, ["priority", "veu"]);
  assert.equal(filters.tagMatch, "all");
  assert.equal(filters.installedFrom, "2026-01-01");
  assert.equal(filters.installedTo, "2026-12-31");
  assert.equal(filters.appointmentFrom, "2026-02-01");
  assert.equal(filters.appointmentTo, "2026-11-30");
  assert.equal(filters.pageSize, 100);
  assert.throws(
    () => operationsModule.parseCreditexOperationsFilters(
      new URLSearchParams({ status: "invented" }),
    ),
    (error) => error.code === "CREDITEX_FILTER_INVALID" && error.status === 400,
  );
  assert.throws(
    () => operationsModule.parseCreditexOperationsFilters(
      new URLSearchParams({
        installedFrom: "2026-12-31",
        installedTo: "2026-01-01",
      }),
    ),
    (error) => (
      error.code === "CREDITEX_DATE_RANGE_INVALID" && error.status === 400
    ),
  );
  for (const invalid of [
    { serviceCategory: "invented" },
    { customerType: "government" },
    { appointmentType: "invented" },
    { quoteStatus: "invented" },
    { invoiceStatus: "invented" },
    { submissionStatus: "invented" },
    { tagMatch: "invented" },
    { pageSize: "500" },
  ]) {
    assert.throws(
      () => operationsModule.parseCreditexOperationsFilters(
        new URLSearchParams(invalid),
      ),
      (error) => (
        error.code === "CREDITEX_FILTER_INVALID" && error.status === 400
      ),
    );
  }
});

test("Dataforce-equivalent filters use authoritative case links and declare unsupported relationships", () => {
  for (const sqlBoundary of [
    /work\.work_type/,
    /activity\.service_category/,
    /compliance_case\.created_by_type/,
    /case_creator\.firebase_uid = compliance_case\.created_by_uid/,
    /work\.assignee_label/,
    /customer\.customer_type/,
    /work\.source_type/,
    /work\.stage/,
    /job\.pipeline_stage/,
    /work\.priority/,
    /filtered_issue\.note_type = 'issue'/,
    /filtered_issue\.issue_status IN/,
    /filtered_appointment\.appointment_type IN/,
    /filtered_submission\.status IN/,
    /job\.quote_status/,
    /job\.invoice_status/,
    /activity\.product_category/,
    /filters\.tagMatch === "all"/,
  ]) assert.match(server, sqlBoundary);
  for (const unavailableReason of [
    /No authoritative client-to-case relationship is stored/,
    /no authoritative agent-to-case relationship is stored/,
    /no separate outcome field/,
    /no authoritative audit-completed flag/,
    /No additional authoritative appointment filter fields are stored/,
    /no authoritative Dataforce-equivalent product-type field/,
    /generic catch-all filter cannot be mapped safely/,
  ]) assert.match(server, unavailableReason);
  assert.match(server, /returnedInDefaultList: false/);
});

test("operations GET passes the full membership scope and exposes data-driven program and activity workspaces", () => {
  assert.match(operationsRoute, /parseCreditexOperationsFilters\(searchParams\)/);
  assert.match(
    operationsRoute,
    /loadCreditexOperationsDashboard\(\s*database,\s*member,\s*filters/,
  );
  assert.match(
    operationsRoute,
    /loadCreditexCaseWorkspace\(\s*database,\s*member,\s*caseId/,
  );
  assert.match(server, /programWorkspaceRows/);
  assert.match(server, /activityWorkspaceRows/);
  assert.match(server, /workspace:\s*\{\s*programs:/);
  assert.match(server, /activityVersionId:/);
  assert.match(server, /registryActivityCode:/);
  assert.match(server, /scenarioCode:/);
  assert.doesNotMatch(server, /activityKey\s*===\s*["']6\(23\)["']/);
});

test("non-admin operations remain assignment-scoped while Creditex admins retain organisation-wide visibility", () => {
  assert.match(server, /if \(scope\.role !== "admin"\)/);
  assert.match(server, /visible_assignment\.status = 'assigned'/);
  assert.match(server, /visible_member\.firebase_uid = \?/);
  assert.match(server, /visible_member\.status = 'active'/);
  assert.match(server, /scope\.role === "admin" \? 1 : 0/);
  assert.match(
    server,
    /The compliance case is unavailable or is not assigned to you/,
  );
  for (const action of [
    "assign_case",
    "release_case_assignment",
    "create_task",
    "complete_task",
    "create_finding",
    "resolve_finding",
    "review_evidence",
    "record_decision",
    "add_equipment",
    "stage_batch_item",
    "remove_batch_item",
  ]) {
    const start = server.indexOf(`action === "${action}"`);
    const next = server.indexOf("if (action ===", start + 1);
    assert.match(
      server.slice(start, next < 0 ? server.length : next),
      /requireOwnedCase\(/,
      `${action} must recheck the actor's active assignment scope`,
    );
  }
  assert.match(server, /No authoritative participant-to-case relationship is stored/);
  assert.match(server, /No authoritative claim-state record is stored/);
});

test("case lists stay privacy-minimised and authorised private detail reads are audited", () => {
  const dashboardSource = server.slice(
    server.indexOf("export async function loadCreditexOperationsDashboard"),
    server.indexOf("export async function loadCreditexCaseWorkspace"),
  );
  assert.doesNotMatch(dashboardSource, /firstName:/);
  assert.doesNotMatch(dashboardSource, /customerEmail:/);
  assert.match(dashboardSource, /privateDetailsAvailable: true/);
  assert.match(server, /privateDetails:\s*\{/);
  assert.match(server, /defaultListPrivacyMinimised: true/);
  assert.match(server, /"case\.private_details_viewed"/);
  assert.match(server, /purpose: "compliance_case_review"/);
  assert.match(server, /privateNotes:/);
  assert.match(server, /accessInstructions:/);
  assert.match(server, /hazardNotes:/);
});

test("compliance-sensitive installer and public mutation boundaries initialise schema guards", () => {
  assert.match(
    complianceDomain,
    /appendLiveComplianceCaseStatements[\s\S]+await ensureCreditexSchemaGuards\(database\)/,
  );
  assert.match(
    tradeAccess,
    /requireVerifiedTradeIdentity[\s\S]+await ensureCreditexSchemaGuards\(getD1\(\)\)/,
  );
  assert.match(
    tradeTeam,
    /requireInstallerTeamAccess[\s\S]+await ensureCreditexSchemaGuards\(db\)/,
  );
  assert.match(
    publicJobInformation,
    /export async function DELETE[\s\S]+await ensureCreditexSchemaGuards\(getD1\(\)\)/,
  );
});

test("every supported write has a fixed role policy and forbidden roles fail before data access", async () => {
  const expectedActions = [
    "assign_case",
    "release_case_assignment",
    "create_task",
    "complete_task",
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
    "record_certificate_lot",
    "record_trade",
    "record_settlement",
  ];
  assert.deepEqual(operationsModule.CREDITEX_OPERATION_ACTIONS, expectedActions);
  assert.deepEqual(operationsModule.CREDITEX_OPERATION_ROLES.record_trade, ["admin"]);
  assert.deepEqual(
    operationsModule.CREDITEX_OPERATION_ROLES.record_decision,
    ["admin", "reviewer"],
  );
  for (const roles of Object.values(operationsModule.CREDITEX_OPERATION_ROLES)) {
    assert.equal(roles.includes("auditor"), false, "auditors must remain read-only");
  }
  await assert.rejects(
    operationsModule.executeCreditexOperation(null, {
      uid: "reviewer-uid",
      role: "reviewer",
      organisationId: "org-a",
    }, {
      action: "record_trade",
    }),
    (error) => error.code === "CREDITEX_ROLE_REQUIRED" && error.status === 403,
  );
});

test("queries and writes are organisation scoped and dashboard coverage spans every operations domain", () => {
  for (const table of [
    "compliance_invitations",
    "compliance_audit_events",
    "compliance_write_guards",
    "compliance_evidence_policy_versions",
    "compliance_evidence_requirements",
    "compliance_participants",
    "compliance_participant_abilities",
    "compliance_case_assignments",
    "compliance_case_tasks",
    "compliance_case_evidence",
    "compliance_case_findings",
    "compliance_case_decisions",
    "compliance_decision_requests",
    "compliance_equipment_records",
    "compliance_calculator_versions",
    "compliance_calculator_test_vectors",
    "compliance_calculation_runs",
    "compliance_submission_batches",
    "compliance_submission_batch_items",
    "compliance_submission_artifacts",
    "compliance_submission_responses",
    "compliance_certificate_lots",
    "compliance_trades",
    "compliance_settlements",
  ]) assert.match(server, new RegExp(`\\b${table}\\b`));
  assert.match(server, /WHERE id = \? AND organisation_id = \?/);
  assert.match(server, /WHERE case_id = \? AND organisation_id = \?/);
  assert.match(server, /identity\.organisationId/g);
  assert.doesNotMatch(server, /SELECT \*/);
  assert.doesNotMatch(server, /\bobject_key\b/);
  assert.doesNotMatch(server, /\bevidence_envelope\b/);
  assert.doesNotMatch(server, /event\.summary,\s*event\.actor_uid/);
  assert.doesNotMatch(
    server,
    /SELECT id, decision_type, outcome,\s*primary_reviewer_uid/,
  );
  assert.ok(
    (server.match(/compliance_case\.id case_id/g) || []).length >= 5,
    "each case-linked dashboard queue should expose the safe opaque case id",
  );
  assert.match(server, /async function loadOrganisationDomainCounts\(/);
  assert.match(
    server,
    /\(SELECT COUNT\(\*\) FROM compliance_invitations\s+WHERE organisation_id = \?\) invitations/,
  );
  assert.doesNotMatch(
    server,
    /WITH context\(organisation_id\) AS \(VALUES \(\?\)\)/,
  );
  assert.doesNotMatch(server, /evidence\.file_name/);
  assert.match(server, /truncatedDomains/);
});

test("successful mutation paths append an immutable audit event and immutable ledgers are insert-only", () => {
  assert.match(server, /function writeWithAudit\(/);
  assert.match(
    server,
    /const guardedWrites = writes\.flatMap/,
  );
  assert.match(server, /CASE WHEN changes\(\) = 1 THEN 1 ELSE 0 END/);
  assert.match(server, /\.\.\.guardedWrites/);
  assert.match(server, /INSERT INTO compliance_audit_events/);
  for (const action of operationsModule.CREDITEX_OPERATION_ACTIONS) {
    const start = server.indexOf(`action === "${action}"`);
    assert.notEqual(start, -1, `${action} handler should exist`);
    const nextStarts = operationsModule.CREDITEX_OPERATION_ACTIONS
      .map((candidate) => server.indexOf(`action === "${candidate}"`, start + 1))
      .filter((index) => index > start);
    const end = nextStarts.length ? Math.min(...nextStarts) : server.length;
    assert.match(
      server.slice(start, end),
      /writeWithAudit\(/,
      `${action} must use the audited write boundary`,
    );
  }
  for (const table of [
    "compliance_audit_events",
    "compliance_case_decisions",
    "compliance_calculation_runs",
    "compliance_submission_artifacts",
    "compliance_submission_responses",
  ]) {
    assert.doesNotMatch(server, new RegExp(`UPDATE ${table}\\b`, "i"));
    assert.doesNotMatch(server, new RegExp(`DELETE FROM ${table}\\b`, "i"));
  }
  assert.doesNotMatch(server, /DELETE FROM /i);
  for (const trigger of [
    "compliance_audit_events_no_update",
    "compliance_audit_events_no_delete",
    "compliance_case_decisions_no_update",
    "compliance_case_decisions_no_delete",
    "compliance_calculation_runs_no_update",
    "compliance_calculation_runs_no_delete",
    "compliance_submission_artifacts_no_update",
    "compliance_submission_artifacts_no_delete",
    "compliance_submission_responses_no_update",
    "compliance_submission_responses_no_delete",
  ]) assert.match(schemaGuards, new RegExp(trigger));
});

test("external execution is hard-disabled and local records do not imply registry success", async () => {
  for (const action of [
    "run_calculator",
    "calculate_certificates",
    "submit_batch",
    "submit_to_registry",
    "sync_registry",
    "record_manual_response",
    "execute_trade",
    "settle_trade",
  ]) {
    await assert.rejects(
      operationsModule.executeCreditexOperation(null, {
        uid: "admin-uid",
        role: "admin",
        organisationId: "org-a",
      }, { action }),
      (error) => (
        error.code === "CREDITEX_EXTERNAL_ACTION_DISABLED"
        && error.status === 409
      ),
    );
  }
  assert.match(server, /registrySubmissionEnabled: false/);
  assert.match(server, /calculatorExecutionEnabled: false/);
  assert.match(server, /certificateTradingExecutionEnabled: false/);
  assert.doesNotMatch(server, /"submission_outcome", "case_closure"/);
  assert.doesNotMatch(`${server}\n${operationsRoute}`, /\bfetch\s*\(/);
});

test("access management is admin-only and rejects shared mailbox invitations", async () => {
  assert.match(server, /identity\.role !== "admin"/);
  assert.match(server, /SHARED_EMAIL_LOCAL_PARTS/);
  assert.match(server, /nameParts\.length < 2/);
  await assert.rejects(
    operationsModule.executeCreditexAccessAction(null, {
      uid: "admin-uid",
      role: "admin",
      organisationId: "org-a",
    }, {
      action: "create_invitation",
      email: "info@example.com",
      displayName: "Creditex Admin",
      role: "admin",
    }),
    (error) => error.code === "CREDITEX_NAMED_USER_REQUIRED",
  );
  await assert.rejects(
    operationsModule.executeCreditexAccessAction(null, {
      uid: "reviewer-uid",
      role: "reviewer",
      organisationId: "org-a",
    }, {
      action: "revoke_invitation",
      invitationId: "invitation-a",
    }),
    (error) => error.code === "CREDITEX_ROLE_REQUIRED",
  );
});

test("approved eligibility and ready-to-submit decisions require dual control", () => {
  assert.match(
    server,
    /decisionType === "eligibility" \|\| decisionType === "ready_to_submit"/,
  );
  assert.match(server, /INSERT INTO compliance_decision_requests/);
  assert.match(server, /status = 'pending'/);
  assert.match(server, /request\.primary_reviewer_uid\) === identity\.uid/);
  assert.match(server, /UPDATE compliance_decision_requests/);
  assert.match(server, /primary_reviewer_uid, secondary_reviewer_uid/);
  assert.match(server, /request\.case_revision/);
  assert.match(server, /requireEvidenceReady/);
  assert.match(server, /requireLatestApprovedDecision/);
  assert.match(server, /requireVerifiedCalculation/);
  assert.match(server, /latest\.case_revision = \?/);
  assert.match(migration, /secondary_reviewer_uid` <> `primary_reviewer_uid/);
});

test("evidence outcomes and decision bases are bound to audited authoritative state", () => {
  assert.match(server, /body\.evidenceAccessReceiptId/);
  assert.match(server, /event_type = 'evidence\.viewed'/);
  assert.match(server, /target_type = 'compliance_case_evidence'/);
  assert.match(server, /target_id = \?/);
  assert.match(server, /actor_uid = \?/);
  assert.match(server, /created_at >= \?/);
  assert.match(server, /created_at <= \?/);
  assert.match(server, /30 \* 60 \* 1_000/);
  assert.match(server, /CREDITEX_EVIDENCE_ACCESS_REQUIRED/);
  assert.match(server, /CREDITEX_CASE_ASSIGNMENT_REQUIRED/);
  assert.match(server, /assignment\.status = 'assigned'/);
  assert.match(server, /function buildDecisionBasisSnapshot/);
  assert.match(server, /creditex-decision-basis-v1/);
  assert.match(server, /policy\.official_source_sha256/);
  assert.match(server, /evidence\.original_sha256/);
  assert.match(server, /replacement\.supersedes_evidence_id = evidence\.id/);
  assert.match(server, /calculation\.calculator_source_sha256/);
  assert.doesNotMatch(server, /jsonObject\(body\.basisSnapshot/);
  assert.match(
    server,
    /policy\.publish_state IN \('published', 'withdrawn'\)/,
  );
  assert.match(server, /CREDITEX_POLICY_WITHDRAWN/);
  assert.match(server, /valueText\(request\.basis_snapshot\)/);
});
