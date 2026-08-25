import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-work-pack-schema-guards.ts";

const workPackGuardSql = CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS
  .map((definition) => definition.sql)
  .join("\n");

const files = {
  component: new URL(
    "../src/components/CreditexOutputActions.tsx",
    import.meta.url,
  ),
  sharedRoute: new URL(
    "../src/app/api/creditex/output-actions/_shared.ts",
    import.meta.url,
  ),
  creditexRoute: new URL(
    "../src/app/api/creditex/output-actions/route.ts",
    import.meta.url,
  ),
  adminRoute: new URL(
    "../src/app/api/admin/compliance-output-actions/route.ts",
    import.meta.url,
  ),
  creditexPortal: new URL(
    "../src/components/CreditexCompliancePortal.tsx",
    import.meta.url,
  ),
  adminPortal: new URL(
    "../src/components/AdminOperationsPortal.tsx",
    import.meta.url,
  ),
  migration: new URL(
    "../drizzle/0144_creditex_output_actions.sql",
    import.meta.url,
  ),
  service: new URL(
    "../src/lib/creditex-output-action-server.ts",
    import.meta.url,
  ),
  sresMigration: new URL(
    "../drizzle/0146_creditex_sres_certificate_activation_evidence.sql",
    import.meta.url,
  ),
  sresService: new URL(
    "../src/lib/creditex-sres-certificate-activation-server.ts",
    import.meta.url,
  ),
};

async function source(name) {
  return readFile(files[name], "utf8");
}

function loadSharedRouteForTest(calls) {
  const routeSource = readFileSync(files.sharedRoute, "utf8");
  const output = ts.transpileModule(routeSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "creditex-output-actions-shared.ts",
  }).outputText;
  class TestOutputActionError extends Error {
    constructor(code, status, message) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  class TestAccessError extends Error {}
  class TestBoundedRequestError extends Error {}
  class TestSresActivationError extends Error {}
  const unexpectedServiceCall = (name) => async () => {
    calls.push(name);
    throw new Error(`Unexpected service call: ${name}`);
  };
  const mocks = {
    "@/lib/bounded-json-request": {
      BoundedJsonRequestError: TestBoundedRequestError,
      async readBoundedJsonRequest(request) {
        return request.json();
      },
    },
    "@/lib/creditex-output-action-server": {
      CreditexOutputActionError: TestOutputActionError,
      listCreditexOutputActions: unexpectedServiceCall("list actions"),
      listCreditexOutputActionCandidates: unexpectedServiceCall("list candidates"),
      listCreditexOutputActionReceipts: unexpectedServiceCall("list receipts"),
      loadCreditexOutputAction: unexpectedServiceCall("load action"),
      loadCreditexOutputActionReceipt: unexpectedServiceCall("load receipt"),
      prepareCreditexCertificateAction: unexpectedServiceCall("prepare certificate"),
      prepareCreditexOperationalOutputAction: unexpectedServiceCall("prepare operational"),
      recordManualCreditexOutputProviderOutcome: unexpectedServiceCall("record outcome"),
      recordManualCreditexOutputSubmission: unexpectedServiceCall("record submission"),
      reviewCreditexOutputAction: unexpectedServiceCall("review"),
    },
    "@/lib/compliance-access-server": {
      ComplianceAccessError: TestAccessError,
    },
    "@/lib/creditex-sres-certificate-activation-server": {
      CreditexSresActivationError: TestSresActivationError,
      freezeCreditexSresActivationSnapshot: unexpectedServiceCall("freeze activation"),
      listCreditexSresActivationEvidenceOptions: unexpectedServiceCall("list activation options"),
      loadCreditexSresActivationState: unexpectedServiceCall("load activation"),
      recordCreditexSresActivationEvidence: unexpectedServiceCall("record activation"),
      reviewCreditexSresActivationEvidence: unexpectedServiceCall("review activation"),
    },
  };
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

test("Creditex and admin expose one governed server-driven output workspace", async () => {
  const [component, creditexPortal, adminPortal] = await Promise.all([
    source("component"),
    source("creditexPortal"),
    source("adminPortal"),
  ]);

  assert.match(creditexPortal, /CreditexOutputActions/);
  assert.match(creditexPortal, /endpoint="\/api\/creditex\/output-actions"/);
  assert.match(adminPortal, /CreditexOutputActions/);
  assert.match(adminPortal, /endpoint="\/api\/admin\/compliance-output-actions"/);
  assert.match(creditexPortal, /CreditexActivityWorkPackGovernance/);
  assert.match(adminPortal, /CreditexActivityWorkPackGovernance/);

  assert.match(component, /Find a completed job/);
  assert.match(component, /Search job, customer, programme or activity/);
  assert.match(component, /candidate\.blockers\.map/);
  assert.match(component, /Prepare immutable packet/);
  assert.match(component, /Tradable certificate/);
  assert.match(component, /Programme output/);
  assert.doesNotMatch(component, /Activity template ID/);
  assert.doesNotMatch(component, /Work-pack instance ID/);
});

test("both authorised portals share the exact lifecycle without a trade route", async () => {
  const [shared, creditex, admin] = await Promise.all([
    source("sharedRoute"),
    source("creditexRoute"),
    source("adminRoute"),
  ]);

  for (const route of [creditex, admin]) {
    assert.match(route, /sameOrigin\(request\)/);
    assert.match(route, /handleCreditexOutputActionRequest/);
  }
  assert.match(creditex, /requireComplianceAccess/);
  assert.match(creditex, /actorKind: "compliance"/);
  assert.match(admin, /requireAdminIdentity/);
  assert.match(admin, /actorKind: "admin"/);

  for (const action of [
    "prepare_certificate",
    "prepare_operational",
    "review",
    "record_manual_submission",
    "record_provider_outcome",
    "record_sres_activation",
    "review_sres_activation",
    "freeze_sres_activation",
  ]) assert.match(shared, new RegExp(`action === "${action}"`));
  assert.match(shared, /listCreditexOutputActionCandidates/);
  assert.match(shared, /listCreditexOutputActionReceipts/);
});

test("the public output route rejects the unavailable adapter action without invoking a provider service", async () => {
  const calls = [];
  const route = loadSharedRouteForTest(calls);
  const request = new Request("https://example.test/api/creditex/output-actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "submit_with_adapter",
      packetId: "packet-1",
      expectedPacketSha256: `sha256:${"a".repeat(64)}`,
    }),
  });

  await assert.rejects(
    route.handleCreditexOutputActionRequest(request, {}, {
      actorUid: "compliance-operator",
      organisationId: "creditex",
      actorKind: "compliance",
    }),
    (error) => error.code === "OUTPUT_ACTION_REQUEST_INVALID"
      && error.status === 400,
  );
  assert.deepEqual(calls, []);
});

test("the output UI exposes only the retained manual provider submission lifecycle", async () => {
  const component = await source("component");

  assert.match(component, /submissionMethod: "manual"/);
  assert.match(component, /value="Manual provider pack" readOnly/);
  assert.match(component, /action: "record_manual_submission"/);
  assert.match(component, /action: "record_provider_outcome"/);
  assert.doesNotMatch(component, /Provider adapter/);
  assert.doesNotMatch(component, /value="adapter"/);
});

test("adapter submission remains an internal non-null service boundary and is not a public action", async () => {
  const [shared, service, sresService] = await Promise.all([
    source("sharedRoute"),
    source("service"),
    source("sresService"),
  ]);

  assert.doesNotMatch(shared, /submit_with_adapter/);
  assert.doesNotMatch(shared, /submitCreditexOutputAction/);
  assert.match(service, /adapter: CreditexOutputActionAdapter,/);
  assert.doesNotMatch(service, /adapter: CreditexOutputActionAdapter \| null/);
  assert.doesNotMatch(service, /OUTPUT_ACTION_ADAPTER_NOT_CONFIGURED/);
  assert.match(sresService, /if \(submissionMethod !== "manual"\)/);
  assert.match(sresService, /resultCode: "manual_submission_contract_current"/);
  assert.doesNotMatch(sresService, /Choose the retained manual or adapter submission contract/);
});

test("SRES certificates require eight current independently reviewed activation gates", async () => {
  const [component, shared, service] = await Promise.all([
    source("component"),
    source("sharedRoute"),
    source("sresService"),
  ]);
  for (const evidenceKind of [
    "rec_registry_submission_contract",
    "declaration_snapshot",
    "component_recall_status",
    "calculator_vector_suite",
    "registered_agent_assignment",
    "component_eligibility",
    "installer_accreditation",
    "designer_accreditation",
  ]) {
    assert.match(service, new RegExp(`"${evidenceKind}"`));
  }
  assert.match(component, /SRES certificate activation/);
  assert.match(component, /Replace rejected evidence/);
  assert.match(shared, /supersedesRecordId: body\.supersedesRecordId/);
  assert.match(service, /SRES_ACTIVATION_CALCULATOR_SOURCE_MISMATCH/);
  assert.match(service, /sres_activation_snapshot_stale_or_invalid/);
  assert.match(workPackGuardSql, /compliance_sres_output_action_activation_guard/);
  assert.match(workPackGuardSql, /json_each\(activation\.snapshot_json, '\$\.records'\)/);
  assert.match(workPackGuardSql, /COMPLIANCE_SRES_OUTPUT_ACTIVATION_INVALID/);
});

test("exact packets and provider responses are authenticated no-store downloads", async () => {
  const [component, shared, service] = await Promise.all([
    source("component"),
    source("sharedRoute"),
    source("service"),
  ]);

  assert.match(component, /download=packet/);
  assert.match(component, /download=receipt/);
  assert.match(component, /Download exact provider response/);
  assert.match(component, /firebaseAuth\.currentUser/);
  assert.match(component, /Authorization: `Bearer \$\{token\}`/);
  assert.match(shared, /loadCreditexOutputActionReceipt/);
  assert.match(shared, /"Cache-Control": "private, no-store"/);
  assert.match(shared, /"X-Content-Type-Options": "nosniff"/);
  assert.match(shared, /Content-Disposition/);
  assert.doesNotMatch(shared, /object_key|objectKey|bucket|storage topology/i);
  assert.match(service, /creditexCanonicalSha256\(response\) !== row\.response_sha256/);
  assert.match(service, /response,\s*\n\s*\}\);/);
});

test("the database enforces dual work-pack hashes and one action per final record", async () => {
  const migration = await source("migration");

  assert.match(migration, /`work_pack_instance_sha256` text NOT NULL/);
  assert.match(migration, /`work_pack_response_sha256` text NOT NULL/);
  assert.match(workPackGuardSql, /final_record\.`instance_sha256` = NEW\.`work_pack_instance_sha256`/);
  assert.match(workPackGuardSql, /final_record\.`response_sha256` = NEW\.`work_pack_response_sha256`/);
  assert.match(migration, /`compliance_output_action_final_record_idx`/);
  assert.match(
    migration,
    /\(`organisation_id`, `work_pack_final_record_id`\)/,
  );
  assert.match(
    workPackGuardSql,
    /CASE NEW\.`actor_kind`\s+WHEN 'adapter' THEN 'platform'\s+ELSE 'compliance'/,
  );
  assert.doesNotMatch(migration, /operational_output_evidence/);
});
