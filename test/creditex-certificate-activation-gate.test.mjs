import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  CREDITEX_CERTIFICATE_ACTIVATION_ACTIVITY_COUNT,
  CREDITEX_CERTIFICATE_ACTIVATION_ENDPOINT,
  fetchCreditexCertificateActivationPayload,
  parseCreditexCertificateActivationArguments,
  validateCreditexCertificateActivationPayload,
} from "../scripts/validate-creditex-certificate-activation.mjs";
import {
  CREDITEX_WORK_PACK_COVERAGE,
} from "../src/lib/creditex-work-pack-coverage.ts";
import {
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";

const AS_AT_DATE = "2026-08-15";
const EFFECTIVE_FROM = "2026-01-01";
const EFFECTIVE_TO = "2099-12-31";
const TIMESTAMP = "2026-08-15T00:00:00.000Z";
const programByCode = new Map(GOVERNMENT_PROGRAM_TEMPLATES.map((program) => [
  program.programCode,
  program,
]));
function sha256(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function sourceBinding(activityId, role, index) {
  return {
    id: `${activityId}-source-${role}`,
    role,
    targetKey: `${role}-target`,
    artifactId: `${activityId}-artifact-${role}`,
    artifactSha256: sha256(`${activityId}:${role}:artifact`),
    createdByUid: `${activityId}-source-author-${index}`,
    reviewedByUid: `${activityId}-source-reviewer-${index}`,
    reviewedAt: TIMESTAMP,
  };
}

function readyRow(catalogue, index) {
  const activityId = catalogue.activityTemplateId;
  const activityVersionId = `${activityId}-activity-version`;
  const versionId = `${activityId}-work-pack-version`;
  const schemaSha256 = sha256(`${activityId}:schema`);
  const responseSha256 = sha256(`${activityId}:response`);
  const program = programByCode.get(catalogue.programCode);
  assert.ok(program);
  const certificateOutput = program.outcomeClass === "tradable_certificate";
  const sourceBindings = [
    sourceBinding(activityId, "requirement", index),
    sourceBinding(activityId, "product", index),
    sourceBinding(activityId, "scenario", index),
    sourceBinding(activityId, "calculator", index),
  ];
  const operationalSource = sourceBindings[1];
  return {
    activityTemplateId: activityId,
    programCode: catalogue.programCode,
    activityCode: catalogue.activityKey,
    title: catalogue.title,
    catalogueState: catalogue.catalogueState,
    activityVersionId,
    ready: true,
    versionId,
    schemaSha256,
    blockers: [],
    currentActivityVersionReady: true,
    independentlyApprovedPackReady: true,
    approvedExactSourcesReady: true,
    productRegistrySnapshotReady: true,
    scenarioRulesReady: true,
    authoritativeCalculatorReady: true,
    fieldCollectionReady: true,
    completionReady: true,
    externalSubmissionReady: certificateOutput,
    certificateActionEnabled: certificateOutput,
    certificateBlockers: certificateOutput
      ? []
      : ["certificate_action_not_applicable_for_output_class"],
    outputClass: program.outcomeClass,
    outputActionReady: !certificateOutput,
    outputActionBlockers: certificateOutput
      ? ["output_action_not_applicable_for_tradable_certificate"]
      : [],
    operationalOutputDefinition: certificateOutput
      ? null
      : {
          outputClass: program.outcomeClass,
          outputCode: program.claimOutputCode,
          sourceBindingId: operationalSource.id,
          sourceArtifactId: operationalSource.artifactId,
          sourceSha256: operationalSource.artifactSha256,
          effectiveFrom: EFFECTIVE_FROM,
          effectiveTo: EFFECTIVE_TO,
          authoredByUid: operationalSource.createdByUid,
          reviewedByUid: operationalSource.reviewedByUid,
          reviewedAt: operationalSource.reviewedAt,
        },
    activationEvidence: {
      activityVersion: {
        id: activityVersionId,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: EFFECTIVE_TO,
      },
      workPackVersion: {
        id: versionId,
        schemaSha256,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: EFFECTIVE_TO,
        authoredByUid: `${activityId}-pack-author-${index}`,
        reviewedByUid: `${activityId}-pack-reviewer-${index}`,
        reviewedAt: TIMESTAMP,
      },
      manualPolicy: {
        id: `${activityId}-manual-policy`,
        version: "1",
        sha256: sha256(`${activityId}:manual-policy`),
        requestedByUid: `${activityId}-policy-author-${index}`,
        approvedByUid: `${activityId}-policy-reviewer-${index}`,
        approvedAt: TIMESTAMP,
      },
      evidencePolicy: {
        id: `${activityId}-evidence-policy`,
        version: "1",
        sha256: sha256(`${activityId}:evidence-policy`),
      },
      sourceBindings,
      productRegistrySnapshot: {
        selectionId: `${activityId}-product-selection`,
        snapshotId: `${activityId}-product-snapshot`,
        registryCode: `${catalogue.programCode}-registry`,
        productId: `${activityId}-product`,
        productKind: "approved_product",
        sourceSha256: sha256(`${activityId}:product-source`),
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: EFFECTIVE_TO,
        installationDate: AS_AT_DATE,
        selectedByUid: `${activityId}-product-selector-${index}`,
        verifiedByUid: `${activityId}-product-verifier-${index}`,
        verifiedAt: TIMESTAMP,
      },
      scenarioRules: {
        resolutionId: `${activityId}-scenario-resolution`,
        scenarioBindingId: `${activityId}-scenario-binding`,
        scenarioCode: "governed-scenario",
        sourceArtifactId: `${activityId}-scenario-artifact`,
        sourceSha256: sha256(`${activityId}:scenario-source`),
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: EFFECTIVE_TO,
        authoredByUid: `${activityId}-scenario-author-${index}`,
        reviewedByUid: `${activityId}-scenario-reviewer-${index}`,
        reviewedAt: TIMESTAMP,
      },
      authoritativeCalculator: {
        runId: `${activityId}-calculator-run`,
        dependencyKey: `${activityId}-calculator-dependency`,
        catalogueFormulaKey: `${activityId}-official-formula/v1`,
        engineCalculatorKey: "governed_calculator",
        engineCalculatorVersion: 1,
        specificationId: `${activityId}-calculator-specification`,
        specificationVersion: "1.0.0",
        specificationSha256: sha256(`${activityId}:calculator-specification`),
        inputSha256: sha256(`${activityId}:calculator-input`),
        outputSha256: sha256(`${activityId}:calculator-output`),
        engineContractSha256: sha256(`${activityId}:engine-contract`),
        receiptSha256: sha256(`${activityId}:calculator-receipt`),
        sourceBindingId: `${activityId}-calculator-source-binding`,
        sourceArtifactId: `${activityId}-calculator-source-artifact`,
        sourceSha256: sha256(`${activityId}:calculator-source`),
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: EFFECTIVE_TO,
        runByUid: `${activityId}-calculator-runner-${index}`,
        verifiedByUid: `${activityId}-calculator-verifier-${index}`,
        verifiedAt: TIMESTAMP,
        certificateQuantity: "1",
        certificateUnit: program.claimOutputCode,
      },
      fieldCollection: {
        instanceId: `${activityId}-instance`,
        instanceKey: `${activityId}-instance-key`,
        revision: 1,
        definitionSha256: sha256(`${activityId}:definition`),
        prefillSha256: sha256(`${activityId}:prefill`),
        responseSha256,
        completedByUid: `${activityId}-field-worker-${index}`,
        completedAt: TIMESTAMP,
      },
      completion: {
        caseInstanceId: `${activityId}-case-instance`,
        finalRecordId: `${activityId}-final-record`,
        instanceSha256: sha256(`${activityId}:instance`),
        responseSha256,
        signatureManifestSha256: sha256(`${activityId}:signatures`),
        pdfSha256: sha256(`${activityId}:pdf`),
        integrityReceiptId: `${activityId}-integrity-receipt`,
        finalisedByUid: `${activityId}-finaliser-${index}`,
        finalisedAt: TIMESTAMP,
      },
      externalSubmission: certificateOutput
        ? {
            submissionId: `${activityId}-submission`,
            submissionReference: `${activityId}-provider-reference`,
            submittedPayloadSha256: sha256(`${activityId}:submitted-payload`),
            providerReceiptSha256: sha256(`${activityId}:provider-receipt`),
            status: "accepted",
            submittedByUid: `${activityId}-submitter-${index}`,
            verifiedByUid: `${activityId}-submission-verifier-${index}`,
            submittedAt: TIMESTAMP,
            verifiedAt: TIMESTAMP,
          }
        : null,
    },
  };
}

function readyPayload() {
  return {
    ok: true,
    coverage: CREDITEX_WORK_PACK_COVERAGE.map(readyRow),
  };
}

test("activation gate accepts exactly 192 fully evidenced current or limited activities", () => {
  const payload = readyPayload();
  assert.equal(
    CREDITEX_WORK_PACK_COVERAGE.length,
    CREDITEX_CERTIFICATE_ACTIVATION_ACTIVITY_COUNT,
  );
  assert.equal(
    payload.coverage.filter((row) => row.certificateActionEnabled).length,
    85,
  );
  assert.equal(
    payload.coverage.filter((row) => row.outputActionReady).length,
    107,
  );
  assert.deepEqual(
    validateCreditexCertificateActivationPayload(payload, {
      asAtDate: AS_AT_DATE,
    }),
    { activityCount: 192, asAtDate: AS_AT_DATE },
  );
});

test("activation gate fails when one catalogue activity is missing", () => {
  const payload = readyPayload();
  const missing = payload.coverage.pop();
  assert.throws(
    () => validateCreditexCertificateActivationPayload(payload, {
      asAtDate: AS_AT_DATE,
    }),
    new RegExp(`exactly 192 rows.*missing activity ${missing.activityTemplateId}`, "s"),
  );
});

test("activation gate fails on a duplicate activity even when row count stays 192", () => {
  const payload = readyPayload();
  const duplicateId = payload.coverage[0].activityTemplateId;
  payload.coverage[payload.coverage.length - 1] = structuredClone(
    payload.coverage[0],
  );
  assert.throws(
    () => validateCreditexCertificateActivationPayload(payload, {
      asAtDate: AS_AT_DATE,
    }),
    new RegExp(`duplicate activity ${duplicateId}`),
  );
});

test("activation gate fails on any certificate blocker", () => {
  const payload = readyPayload();
  const certificateRow = payload.coverage.find(
    (row) => row.outputClass === "tradable_certificate",
  );
  assert.ok(certificateRow);
  certificateRow.certificateBlockers = ["provider_receipt_required"];
  assert.throws(
    () => validateCreditexCertificateActivationPayload(payload, {
      asAtDate: AS_AT_DATE,
    }),
    /certificateBlockers must be an empty array/,
  );
});

test("activation gate fails when any dynamic readiness boolean is false", () => {
  const payload = readyPayload();
  payload.coverage[0].authoritativeCalculatorReady = false;
  assert.throws(
    () => validateCreditexCertificateActivationPayload(payload, {
      asAtDate: AS_AT_DATE,
    }),
    /authoritativeCalculatorReady must be true/,
  );
});

test("activation gate remains red for the current governance-only snapshot", () => {
  const payload = readyPayload();
  const row = payload.coverage[0];
  row.productRegistrySnapshotReady = false;
  row.scenarioRulesReady = false;
  row.authoritativeCalculatorReady = false;
  row.fieldCollectionReady = false;
  row.completionReady = false;
  row.activationEvidence.productRegistrySnapshot = null;
  row.activationEvidence.scenarioRules = null;
  row.activationEvidence.authoritativeCalculator = null;
  row.activationEvidence.fieldCollection = null;
  row.activationEvidence.completion = null;
  assert.throws(
    () => validateCreditexCertificateActivationPayload(payload, {
      asAtDate: AS_AT_DATE,
    }),
    /productRegistrySnapshotReady must be true.*productRegistrySnapshot is required/s,
  );
});

test("activation gate fails when exact runtime evidence identity is missing", () => {
  const payload = readyPayload();
  payload.coverage[0].activationEvidence.authoritativeCalculator.receiptSha256 = "";
  assert.throws(
    () => validateCreditexCertificateActivationPayload(payload, {
      asAtDate: AS_AT_DATE,
    }),
    /authoritativeCalculator\.receiptSha256 must contain an exact SHA-256 identity/,
  );
});

test("activation gate fails when an author self-reviews", () => {
  const payload = readyPayload();
  const workPack = payload.coverage[0].activationEvidence.workPackVersion;
  workPack.reviewedByUid = workPack.authoredByUid;
  assert.throws(
    () => validateCreditexCertificateActivationPayload(payload, {
      asAtDate: AS_AT_DATE,
    }),
    /workPackVersion must have independent author and reviewer actors/,
  );
});

test("activation command requires an explicit HTTPS deployment and reads the bearer token from an environment variable", () => {
  assert.throws(
    () => parseCreditexCertificateActivationArguments([], {}),
    /explicit deployed candidate URL/,
  );
  assert.deepEqual(
    parseCreditexCertificateActivationArguments(
      ["--base-url", "https://candidate.example/", "--token-env", "QA_TOKEN"],
      { QA_TOKEN: "authorised-token" },
    ),
    {
      baseUrl: "https://candidate.example",
      bearerToken: "authorised-token",
      tokenEnvironmentName: "QA_TOKEN",
    },
  );
});

test("activation request uses the frozen endpoint and bearer authentication", async () => {
  let request;
  const payload = { ok: true, coverage: [] };
  const result = await fetchCreditexCertificateActivationPayload({
    baseUrl: "https://candidate.example",
    bearerToken: "authorised-token",
    async fetchImplementation(url, options) {
      request = { url: String(url), options };
      return Response.json(payload);
    },
  });
  assert.equal(
    request.url,
    `https://candidate.example${CREDITEX_CERTIFICATE_ACTIVATION_ENDPOINT}`,
  );
  assert.equal(request.options.headers.Authorization, "Bearer authorised-token");
  assert.equal(request.options.redirect, "error");
  assert.deepEqual(result, payload);
});

test("certificate activation remains a separate launch command", () => {
  const packageJson = JSON.parse(fs.readFileSync(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  assert.ok(packageJson.scripts["validate:creditex-certificate-activation"]);
  assert.doesNotMatch(
    packageJson.scripts.validate,
    /creditex-certificate-activation/,
  );
});
