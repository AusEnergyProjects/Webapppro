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
