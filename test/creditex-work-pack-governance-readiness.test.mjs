import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

import * as activityWorkPack from "../src/lib/creditex-activity-work-pack.ts";
import * as interchangePreflight from "../src/lib/creditex-interchange-preflight.ts";
import * as manualPolicy from "../src/lib/creditex-manual-policy-merge.ts";
import * as governmentCatalogue from "../src/lib/australian-government-program-catalogue.ts";
import * as workPackCoverage from "../src/lib/creditex-work-pack-coverage.ts";
import * as calculationCoverage from "../src/lib/creditex-calculation-coverage.ts";
import * as calculatorEngine from "../src/lib/creditex-calculator-engine.ts";
import * as sourceLookupReview from "../src/lib/creditex-source-lookup-review-server.ts";
import * as veuCalculatorCatalogue from "../src/lib/creditex-veu-calculator-catalogue.ts";
import * as nswProgramCatalogue from "../src/lib/creditex-nsw-program-catalogue.ts";
import * as officialProductRegistry from "../src/lib/creditex-official-product-registry.ts";
import * as currentWorkPackContent from "../src/data/creditex-current-work-pack-content.ts";
import * as workPackContentDraft from "../src/lib/creditex-work-pack-content-draft.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

function loadTypescriptModule(path, mocks) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
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

const server = loadTypescriptModule(
  "../src/lib/creditex-activity-work-pack-server.ts",
  {
    "./creditex-activity-work-pack.ts": activityWorkPack,
    "./creditex-interchange-preflight.ts": interchangePreflight,
    "./creditex-manual-policy-merge.ts": manualPolicy,
    "./australian-government-program-catalogue.ts": governmentCatalogue,
    "./creditex-work-pack-coverage.ts": workPackCoverage,
    "./creditex-calculation-coverage.ts": calculationCoverage,
    "./creditex-calculator-engine.ts": calculatorEngine,
    "./creditex-source-lookup-review-server.ts": sourceLookupReview,
    "./creditex-veu-calculator-catalogue.ts": veuCalculatorCatalogue,
    "./creditex-nsw-program-catalogue.ts": nswProgramCatalogue,
    "./creditex-official-product-registry.ts": officialProductRegistry,
    "../data/creditex-current-work-pack-content.ts": currentWorkPackContent,
    "./creditex-work-pack-content-draft.ts": workPackContentDraft,
    "./creditex-sres-certificate-activation-server.ts": {
      loadCreditexSresActivationState() {
        throw new Error("SRES activation is outside this VEU governance-list test.");
      },
    },
    "./creditex-custody-bucket.ts": {
      getCreditexCustodyBucket() {
        throw new Error("Custody access is outside this governance-list test.");
      },
    },
    "./jpeg-exif-verifier.ts": { verifyJpegExif() {} },
    "./creditex-activity-work-pack-pdf-renderer.ts": {
      renderCreditexActivityWorkPackPdf() {
        throw new Error("PDF rendering is outside this governance-list test.");
      },
    },
  },
);

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function testD1(database) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
  };
}

const ORGANISATION_ID = "org-creditex";
const ACTIVITY_VERSION_ID = "activity-current";
const WORK_PACK_VERSION_ID = "work-pack-current";
const MANUAL_BINDING_ID = "manual-binding-current";
const POLICY_ID = "policy-current";
const PROGRAM_ID = "program-current";
const PROGRAM_HASH = "1".repeat(64);
const ACTIVITY_HASH = "2".repeat(64);
const POLICY_HASH = "3".repeat(64);
const ARTIFACT_HASH = "4".repeat(64);
const OTHER_HASH = "5".repeat(64);
const NOW = "2026-08-15T00:00:00.000Z";
const ACTIVITY = governmentCatalogue.GOVERNMENT_ACTIVITY_TEMPLATES.find(
  (candidate) => candidate.templateId
    === workPackCoverage.CREDITEX_WORK_PACK_COVERAGE[0].activityTemplateId,
);
const PROGRAM = governmentCatalogue.GOVERNMENT_PROGRAM_TEMPLATES.find(
  (candidate) => candidate.programCode === ACTIVITY.programCode,
);
const CALCULATION = calculationCoverage.CREDITEX_CALCULATION_COVERAGE.find(
  (candidate) => candidate.activityTemplateId === ACTIVITY.templateId,
);
const ACTOR = Object.freeze({
  actorUid: "admin-reader",
  actorKind: "admin",
  organisationId: ORGANISATION_ID,
});

function governanceDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE admin_users (
      firebase_uid text PRIMARY KEY,
      display_name text NOT NULL,
      role text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_organisations (
      id text PRIMARY KEY,
      organisation_code text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_users (
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      display_name text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      governance_identity_verified integer NOT NULL,
      governance_identity_verified_by_uid text NOT NULL
    );
    CREATE TABLE compliance_programs (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      program_code text NOT NULL,
      name text NOT NULL,
      scheme_kind text NOT NULL,
      jurisdiction text NOT NULL,
      administering_body text NOT NULL,
      official_source_url text NOT NULL,
      official_source_title text NOT NULL,
      official_source_version text NOT NULL,
      official_source_sha256 text NOT NULL,
      official_source_checked_at text NOT NULL,
      publish_state text NOT NULL,
      publication_request_id text NOT NULL,
      publication_snapshot_sha256 text NOT NULL,
      published_by_uid text NOT NULL,
      published_at text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY,
      program_id text NOT NULL,
      activity_key text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      service_category text NOT NULL,
      registry_activity_code text NOT NULL,
      specification_part text NOT NULL,
      product_category text NOT NULL,
      scenario_code text NOT NULL,
      scenario text NOT NULL,
      jurisdiction text NOT NULL,
      effective_from text NOT NULL,
      effective_to text NOT NULL,
      official_source_url text NOT NULL,
      official_source_title text NOT NULL,
      official_source_version text NOT NULL,
      official_source_sha256 text NOT NULL,
      official_source_checked_at text NOT NULL,
      publish_state text NOT NULL,
      publication_request_id text NOT NULL,
      publication_snapshot_sha256 text NOT NULL,
      published_by_uid text NOT NULL,
      published_at text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      official_source_url text NOT NULL,
      official_source_title text NOT NULL,
      official_source_version text NOT NULL,
      official_source_sha256 text NOT NULL,
      official_source_checked_at text NOT NULL,
      requirements_complete integer NOT NULL,
      publish_state text NOT NULL,
      publication_request_id text NOT NULL,
      publication_snapshot_sha256 text NOT NULL,
      content_revision integer NOT NULL,
      published_by_uid text NOT NULL,
      published_at text NOT NULL
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      policy_version_id text NOT NULL,
      requirement_code text NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      evidence_type text NOT NULL,
      capture_timing text NOT NULL,
      minimum_count integer NOT NULL,
      maximum_count integer NOT NULL,
      original_required integer NOT NULL,
      metadata_required integer NOT NULL,
      gps_required integer NOT NULL,
      date_stamp_required integer NOT NULL,
      installer_signature_required integer NOT NULL,
      customer_signature_required integer NOT NULL,
      allowed_content_types text NOT NULL,
      condition_snapshot text NOT NULL,
      field_schema text NOT NULL,
      source_citation text NOT NULL,
      sort_order integer NOT NULL
    );
    CREATE TABLE compliance_manual_policy_bindings (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_template_id text NOT NULL,
      activity_version_id text NOT NULL,
      evidence_policy_version_id text NOT NULL,
      version integer NOT NULL,
      binding_snapshot text NOT NULL,
      binding_snapshot_sha256 text NOT NULL,
      lifecycle_state text NOT NULL,
      requested_by_uid text NOT NULL,
      approved_by_uid text NOT NULL,
      approved_at text NOT NULL
    );
    CREATE TABLE compliance_official_source_artifacts (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      source_url text NOT NULL,
      source_host text NOT NULL,
      source_title text NOT NULL,
      source_version text NOT NULL,
      original_file_name text NOT NULL,
      content_type text NOT NULL,
      size_bytes integer NOT NULL,
      sha256 text NOT NULL,
      object_key text NOT NULL,
      retrieval_method text NOT NULL,
      asserted_retrieved_at text NOT NULL,
      captured_by_uid text NOT NULL,
      captured_at text NOT NULL
    );
    CREATE TABLE compliance_official_source_review_decisions (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      subject_type text NOT NULL,
      subject_id text NOT NULL,
      artifact_id text NOT NULL,
      artifact_sha256 text NOT NULL,
      artifact_object_key text NOT NULL,
      decision text NOT NULL,
      reviewed_by_uid text NOT NULL,
      reviewed_at text NOT NULL
    );
    CREATE TABLE compliance_activity_work_pack_versions (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      activity_template_id text NOT NULL,
      manual_policy_binding_id text NOT NULL,
      manual_policy_binding_version integer NOT NULL,
      manual_policy_binding_sha256 text NOT NULL,
      evidence_policy_version_id text NOT NULL,
      evidence_policy_version integer NOT NULL,
      evidence_policy_source_sha256 text NOT NULL,
      version integer NOT NULL,
      contract text NOT NULL,
      title text NOT NULL,
      schema_snapshot text NOT NULL,
      schema_sha256 text NOT NULL,
      effective_from text NOT NULL,
      effective_to text NOT NULL,
      publish_state text NOT NULL,
      authored_by_uid text NOT NULL,
      authored_at text NOT NULL,
      updated_by_uid text NOT NULL,
      updated_at text NOT NULL,
      reviewed_by_uid text NOT NULL,
      reviewed_at text NOT NULL,
      review_note text NOT NULL,
      withdrawn_by_uid text NOT NULL,
      withdrawn_at text NOT NULL,
      withdrawal_note text NOT NULL,
      abandoned_by_uid text NOT NULL,
      abandoned_at text NOT NULL,
      abandonment_note text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE compliance_activity_work_pack_source_bindings (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      work_pack_version_id text NOT NULL,
      schema_sha256 text NOT NULL,
      source_artifact_id text NOT NULL,
      source_artifact_sha256 text NOT NULL,
      source_role text NOT NULL,
      target_key text NOT NULL,
      citation_location text NOT NULL,
      binding_state text NOT NULL,
      created_by_uid text NOT NULL,
      created_at text NOT NULL,
      reviewed_by_uid text NOT NULL,
      reviewed_at text NOT NULL,
      review_note text NOT NULL,
      withdrawn_by_uid text NOT NULL,
      withdrawn_at text NOT NULL,
      withdrawal_note text NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      revision integer NOT NULL
    );
    CREATE TABLE compliance_calculator_versions (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      calculator_key text NOT NULL,
      version integer NOT NULL
    );
    CREATE TABLE compliance_calculation_runs (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      case_id text NOT NULL,
      case_revision integer NOT NULL,
      calculator_version_id text NOT NULL,
      input_snapshot text NOT NULL,
      output_snapshot text NOT NULL,
      run_by_uid text NOT NULL,
      run_at text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_activity_work_pack_instances (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      work_order_id text NOT NULL,
      compliance_case_id text NOT NULL,
      instance_key text NOT NULL,
      revision integer NOT NULL,
      response_snapshot text NOT NULL
    );
    CREATE TABLE compliance_activity_work_pack_calculation_reviews (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      calculation_run_id text NOT NULL,
      decision text NOT NULL,
      input_sha256 text NOT NULL,
      output_sha256 text NOT NULL,
      reviewer_uid text NOT NULL,
      review_note text NOT NULL,
      reviewed_at text NOT NULL
    );

    INSERT INTO compliance_organisations
      (id, organisation_code, status)
    VALUES ('${ORGANISATION_ID}', 'CREDITEX-AU', 'active');
    INSERT INTO admin_users
      (firebase_uid, display_name, role, status)
    VALUES
      ('admin-reader', 'Governance Reader', 'reviewer', 'active'),
      ('admin-author', 'Pack Author', 'admin', 'active'),
      ('admin-reviewer', 'Pack Reviewer', 'reviewer', 'active'),
      ('source-capturer', 'Source Capturer', 'admin', 'active'),
      ('source-reviewer', 'Source Reviewer', 'reviewer', 'active');
  `);
  return database;
}

function requirement({ customerSignatureRequired = false } = {}) {
  return {
    id: "requirement-1",
    requirementCode: "REQ-1",
    title: "Governed field declaration",
    description: "Capture the exact governed field declaration.",
    evidenceType: customerSignatureRequired ? "signature" : "declaration",
    captureTiming: "at_install",
    minimumCount: 1,
    maximumCount: 1,
    originalRequired: false,
    metadataRequired: false,
    gpsRequired: false,
    dateStampRequired: false,
    installerSignatureRequired: false,
    customerSignatureRequired,
    allowedContentTypes: [],
    conditionSnapshot: {},
    fieldSchema: {},
    sourceCitation: "Official evidence guide, requirement 1",
    sortOrder: 10,
  };
}

function schema({ includeDependencies = true } = {}) {
  const dependencies = includeDependencies
    ? [
        {
          dependencyKey: "approved-product",
          kind: "product",
          label: "Approved product",
          required: true,
          registryCode: "veu-approved-products",
          productKind: "veu_weather_sealing",
          productCategory: ACTIVITY.productCategory,
          selectionMode: "single",
          minimumCount: 1,
          maximumCount: 1,
        },
        {
          dependencyKey: "governed-scenario",
          kind: "scenario",
          label: "Governed scenario",
          required: true,
          scenarioCodes: [ACTIVITY.scenarioCode || "default-scenario"],
          selectionMode: "single",
        },
        {
          dependencyKey: "certificate-calculation",
          kind: "calculator",
          label: "Certificate calculation",
          required: true,
          catalogueFormulaKey: CALCULATION.formulaKey,
          calculatorKey: "certificate_calculation",
          calculatorVersion: 1,
          requiredInputKeys: ["quantity"],
        },
      ]
    : [];
  return activityWorkPack.validateCreditexActivityWorkPack({
    contract: activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
    activityTemplateId: ACTIVITY.templateId,
    version: 1,
    title: `${ACTIVITY.title} governed work pack`,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2099-12-31",
    catalogueReviewedOn: governmentCatalogue.GOVERNMENT_CATALOGUE_REVIEWED_ON,
    stages: [{
      stageKey: "field-capture",
      order: 1,
      label: "Field capture",
      description: "Complete the exact governed field requirements.",
    }],
    signerRoles: [],
    dependencies,
    sections: [{
      sectionKey: "evidence",
      order: 1,
      title: "Evidence",
      description: "Governed evidence requirements.",
      visibility: null,
      repeatability: null,
      prompts: [{
        promptKey: "requirement-answer",
        order: 1,
        type: "text",
        label: "Requirement answer",
        instructions: "",
        required: true,
        visibility: null,
        dependencyKeys: includeDependencies
          ? dependencies.map(({ dependencyKey }) => dependencyKey)
          : [],
        requirementKeys: ["REQ-1"],
        stageKey: "field-capture",
        options: [],
        signerRoleKey: "",
        attestation: null,
        minimumLength: 1,
        maximumLength: 500,
        minimumNumber: null,
        maximumNumber: null,
        numberStep: null,
        unit: "",
        minimumSelections: null,
        maximumSelections: null,
        fileRequirement: null,
        referenceDocument: null,
      }],
    }],
    documentOutputs: [{
      outputKey: "completed-activity-form",
      title: "Completed governed activity form",
      sourceBindingTargetKey: "final-form-template",
      rendererVersion:
        activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION,
      required: true,
      placements: [{
        placementKey: "requirement-answer",
        kind: "text",
        sourcePath: "/response/answers/requirement-answer",
        signaturePromptKey: "",
        signerRoleKey: "",
        pageIndex: 0,
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.1,
        fontFamily: "helvetica",
        fontSize: 10,
        minimumFontSize: 6,
        overflow: "wrap",
        maximumLines: 3,
        textFormat: "text",
      }],
    }],
  });
}

function manualBindingSnapshot(governedRequirement) {
  return manualPolicy.validateManualPolicyBindingSnapshot({
    contract: manualPolicy.CREDITEX_MANUAL_POLICY_BINDING_CONTRACT,
    organisationId: ORGANISATION_ID,
    activityTemplate: { ...ACTIVITY },
    program: {
      id: PROGRAM_ID,
      programCode: PROGRAM.programCode,
      name: PROGRAM.name,
      schemeKind: PROGRAM.outcomeClass,
      jurisdiction: PROGRAM.jurisdiction,
      administeringBody: PROGRAM.administeringBody,
      officialSourceUrl: PROGRAM.officialSourceUrl,
      officialSourceTitle: PROGRAM.officialSourceTitle,
      officialSourceVersion: "2026.1",
      officialSourceSha256: PROGRAM_HASH,
      officialSourceCheckedAt: NOW,
      publicationRequestId: "publish-program",
      publicationSnapshotSha256: "6".repeat(64),
      publishedByUid: "admin-reviewer",
      publishedAt: NOW,
    },
    activity: {
      id: ACTIVITY_VERSION_ID,
      programId: PROGRAM_ID,
      activityKey: ACTIVITY.activityKey,
      version: 1,
      title: ACTIVITY.title,
      serviceCategory: ACTIVITY.serviceCategory,
      registryActivityCode: ACTIVITY.registryActivityCode,
      specificationPart: ACTIVITY.specificationPart,
      productCategory: ACTIVITY.productCategory,
      scenarioCode: ACTIVITY.scenarioCode,
      scenario: ACTIVITY.scenario,
      jurisdiction: PROGRAM.jurisdiction,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2099-12-31",
      officialSourceUrl: PROGRAM.officialSourceUrl,
      officialSourceTitle: `${ACTIVITY.title} official source`,
      officialSourceVersion: "2026.1",
      officialSourceSha256: ACTIVITY_HASH,
      officialSourceCheckedAt: NOW,
      publicationRequestId: "publish-activity",
      publicationSnapshotSha256: "7".repeat(64),
      publishedByUid: "admin-reviewer",
      publishedAt: NOW,
    },
    evidencePolicy: {
      id: POLICY_ID,
      organisationId: ORGANISATION_ID,
      activityVersionId: ACTIVITY_VERSION_ID,
      version: 1,
      title: `${ACTIVITY.title} evidence policy`,
      officialSourceUrl: PROGRAM.officialSourceUrl,
      officialSourceTitle: `${ACTIVITY.title} evidence guide`,
      officialSourceVersion: "2026.1",
      officialSourceSha256: POLICY_HASH,
      officialSourceCheckedAt: NOW,
      publicationRequestId: "publish-policy",
      publicationSnapshotSha256: "8".repeat(64),
      contentRevision: 1,
      publishedByUid: "admin-reviewer",
      publishedAt: NOW,
    },
    sourceApprovals: {
      programBindingId: "program-source-binding",
      activityBindingId: "activity-source-binding",
      evidencePolicyBindingId: "policy-source-binding",
    },
    requirements: [governedRequirement],
  });
}

async function seedGovernedActivity(database, {
  includeDependencies = true,
  includeFinalPdfSource = true,
  customerSignatureRequired = false,
} = {}) {
  const governedRequirement = requirement({ customerSignatureRequired });
  const workPack = schema({ includeDependencies });
  const schemaSha256 = activityWorkPack.creditexActivityWorkPackSha256(workPack);
  const bindingSnapshot = manualBindingSnapshot(governedRequirement);
  const bindingSha256 = await manualPolicy.manualPolicySha256(
    manualPolicy.canonicalManualPolicyJson(bindingSnapshot),
  );
  database.prepare(`INSERT INTO compliance_programs (
      id, organisation_id, program_code, name, scheme_kind, jurisdiction,
      administering_body, official_source_url, official_source_title,
      official_source_version, official_source_sha256,
      official_source_checked_at, publish_state, publication_request_id,
      publication_snapshot_sha256, published_by_uid, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026.1', ?, ?, 'published',
      'publish-program', ?, 'admin-reviewer', ?)`)
    .run(
      PROGRAM_ID,
      ORGANISATION_ID,
      PROGRAM.programCode,
      PROGRAM.name,
      PROGRAM.outcomeClass,
      PROGRAM.jurisdiction,
      PROGRAM.administeringBody,
      PROGRAM.officialSourceUrl,
      PROGRAM.officialSourceTitle,
      PROGRAM_HASH,
      NOW,
      "6".repeat(64),
      NOW,
    );
  database.prepare(`INSERT INTO compliance_activity_versions (
      id, program_id, activity_key, version, title, service_category,
      registry_activity_code, specification_part, product_category,
      scenario_code, scenario, jurisdiction, effective_from, effective_to,
      official_source_url, official_source_title, official_source_version,
      official_source_sha256, official_source_checked_at, publish_state,
      publication_request_id, publication_snapshot_sha256, published_by_uid,
      published_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01',
      '2099-12-31', ?, ?, '2026.1', ?, ?, 'published', 'publish-activity',
      ?, 'admin-reviewer', ?)`)
    .run(
      ACTIVITY_VERSION_ID,
      PROGRAM_ID,
      ACTIVITY.activityKey,
      ACTIVITY.title,
      ACTIVITY.serviceCategory,
      ACTIVITY.registryActivityCode,
      ACTIVITY.specificationPart,
      ACTIVITY.productCategory,
      ACTIVITY.scenarioCode,
      ACTIVITY.scenario,
      PROGRAM.jurisdiction,
      PROGRAM.officialSourceUrl,
      `${ACTIVITY.title} official source`,
      ACTIVITY_HASH,
      NOW,
      "7".repeat(64),
      NOW,
    );
  database.prepare(`INSERT INTO compliance_evidence_policy_versions (
      id, organisation_id, activity_version_id, version, title,
      official_source_url, official_source_title, official_source_version,
      official_source_sha256, official_source_checked_at,
      requirements_complete, publish_state, publication_request_id,
      publication_snapshot_sha256, content_revision, published_by_uid,
      published_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, '2026.1', ?, ?, 1, 'published',
      'publish-policy', ?, 1, 'admin-reviewer', ?)`)
    .run(
      POLICY_ID,
      ORGANISATION_ID,
      ACTIVITY_VERSION_ID,
      `${ACTIVITY.title} evidence policy`,
      PROGRAM.officialSourceUrl,
      `${ACTIVITY.title} evidence guide`,
      POLICY_HASH,
      NOW,
      "8".repeat(64),
      NOW,
    );
  database.prepare(`INSERT INTO compliance_evidence_requirements (
      id, organisation_id, policy_version_id, requirement_code, title,
      description, evidence_type, capture_timing, minimum_count,
      maximum_count, original_required, metadata_required, gps_required,
      date_stamp_required, installer_signature_required,
      customer_signature_required, allowed_content_types,
      condition_snapshot, field_schema, source_citation, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      governedRequirement.id,
      ORGANISATION_ID,
      POLICY_ID,
      governedRequirement.requirementCode,
      governedRequirement.title,
      governedRequirement.description,
      governedRequirement.evidenceType,
      governedRequirement.captureTiming,
      governedRequirement.minimumCount,
      governedRequirement.maximumCount,
      Number(governedRequirement.originalRequired),
      Number(governedRequirement.metadataRequired),
      Number(governedRequirement.gpsRequired),
      Number(governedRequirement.dateStampRequired),
      Number(governedRequirement.installerSignatureRequired),
      Number(governedRequirement.customerSignatureRequired),
      JSON.stringify(governedRequirement.allowedContentTypes),
      JSON.stringify(governedRequirement.conditionSnapshot),
      JSON.stringify(governedRequirement.fieldSchema),
      governedRequirement.sourceCitation,
      governedRequirement.sortOrder,
    );
  database.prepare(`INSERT INTO compliance_manual_policy_bindings (
      id, organisation_id, activity_template_id, activity_version_id,
      evidence_policy_version_id, version, binding_snapshot,
      binding_snapshot_sha256, lifecycle_state, requested_by_uid,
      approved_by_uid, approved_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'approved', 'admin-author',
      'admin-reviewer', ?)`)
    .run(
      MANUAL_BINDING_ID,
      ORGANISATION_ID,
      ACTIVITY.templateId,
      ACTIVITY_VERSION_ID,
      POLICY_ID,
      JSON.stringify(bindingSnapshot),
      bindingSha256,
      NOW,
    );
  database.prepare(`INSERT INTO compliance_activity_work_pack_versions (
      id, organisation_id, activity_version_id, activity_template_id,
      manual_policy_binding_id, manual_policy_binding_version,
      manual_policy_binding_sha256, evidence_policy_version_id,
      evidence_policy_version, evidence_policy_source_sha256, version,
      contract, title, schema_snapshot, schema_sha256, effective_from,
      effective_to, publish_state, authored_by_uid, authored_at,
      updated_by_uid, updated_at, reviewed_by_uid, reviewed_at, review_note,
      withdrawn_by_uid, withdrawn_at, withdrawal_note, abandoned_by_uid,
      abandoned_at, abandonment_note, created_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, ?, 1, ?, ?, ?, ?, '2026-01-01',
      '2099-12-31', 'published', 'admin-author', ?, 'admin-author', ?,
      'admin-reviewer', ?, 'Independently checked against current sources.',
      '', '', '', '', '', '', ?)`)
    .run(
      WORK_PACK_VERSION_ID,
      ORGANISATION_ID,
      ACTIVITY_VERSION_ID,
      ACTIVITY.templateId,
      MANUAL_BINDING_ID,
      bindingSha256,
      POLICY_ID,
      POLICY_HASH,
      activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
      workPack.title,
      JSON.stringify(workPack),
      schemaSha256,
      NOW,
      NOW,
      NOW,
      NOW,
    );
  database.prepare(`INSERT INTO compliance_official_source_artifacts (
      id, organisation_id, source_url, source_host, source_title,
      source_version, original_file_name, content_type, size_bytes, sha256,
      object_key, retrieval_method, asserted_retrieved_at, captured_by_uid,
      captured_at
    ) VALUES ('artifact-current', ?, ?, 'official.example.gov.au',
      'Current official evidence and form source', '2026.1', 'current.pdf',
      'application/pdf', 1000, ?, 'sources/current.pdf', 'official_download',
      ?, 'source-capturer', ?)`)
    .run(ORGANISATION_ID, PROGRAM.officialSourceUrl, ARTIFACT_HASH, NOW, NOW);
  database.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, decision, reviewed_by_uid,
      reviewed_at
    ) VALUES ('artifact-review-current', ?, 'artifact', 'artifact-current',
      'artifact-current', ?, 'sources/current.pdf', 'approved',
      'source-reviewer', ?)`)
    .run(ORGANISATION_ID, ARTIFACT_HASH, NOW);
  const sourceTargets = [
    ["binding-work-pack", "requirement", "work_pack", "Governed requirements"],
    ...(includeFinalPdfSource
      ? [["binding-final-pdf", "requirement", "final-form-template", "Approved final PDF"]]
      : []),
    ...(includeDependencies
      ? [
          ["binding-product", "product", "approved-product", "Product register"],
          ["binding-scenario", "scenario", "governed-scenario", "Scenario rule"],
          ["binding-calculator", "calculator", "certificate-calculation", "Calculator method"],
        ]
      : []),
  ];
  const insertSource = database.prepare(`INSERT INTO
      compliance_activity_work_pack_source_bindings (
        id, organisation_id, work_pack_version_id, schema_sha256,
        source_artifact_id, source_artifact_sha256, source_role, target_key,
        citation_location, binding_state, created_by_uid, created_at,
        reviewed_by_uid, reviewed_at, review_note, withdrawn_by_uid,
        withdrawn_at, withdrawal_note
      ) VALUES (?, ?, ?, ?, 'artifact-current', ?, ?, ?, ?, 'approved',
        'admin-author', ?, 'admin-reviewer', ?,
        'Independently checked against exact retained source.', '', '', '')`);
  for (const [id, role, target, citation] of sourceTargets) {
    insertSource.run(
      id,
      ORGANISATION_ID,
      WORK_PACK_VERSION_ID,
      schemaSha256,
      ARTIFACT_HASH,
      role,
      target,
      citation,
      NOW,
      NOW,
    );
  }
  return { bindingSha256, schemaSha256, workPack };
}

async function governance(database) {
  return server.listCreditexWorkPackGovernance(testD1(database), ACTOR);
}

function selectedCoverage(result) {
  return result.coverage.find(
    ({ activityTemplateId }) => activityTemplateId === ACTIVITY.templateId,
  );
}

function assertBlocked(result, expectedBlocker) {
  const row = selectedCoverage(result);
  assert.equal(row.ready, false);
  if (expectedBlocker) assert.ok(row.blockers.includes(expectedBlocker), row.blockers);
}

test("governance readiness: clean inventory keeps every current or limited activity visible and blocked", async () => {
  const database = governanceDatabase();
  const result = await governance(database);
  assert.equal(
    result.coverage.length,
    workPackCoverage.CREDITEX_WORK_PACK_COVERAGE.length,
  );
  assert.ok(result.coverage.every((row) =>
    !row.ready && row.blockers.includes("current_activity_version_required")
  ));
});

test("governance readiness: a fully exact governed activity is ready", async () => {
  const database = governanceDatabase();
  await seedGovernedActivity(database);
  const row = selectedCoverage(await governance(database));
  assert.equal(row.ready, true);
  assert.deepEqual(row.blockers, []);
});

test("governance readiness: withdrawn or incomplete evidence policy is not ready", async (t) => {
  for (const [name, update] of [
    ["withdrawn", "publish_state = 'withdrawn'"],
    ["incomplete", "requirements_complete = 0"],
  ]) {
    await t.test(name, async () => {
      const database = governanceDatabase();
      await seedGovernedActivity(database);
      database.exec(`UPDATE compliance_evidence_policy_versions SET ${update}`);
      assertBlocked(
        await governance(database),
        "work_pack_published_effective_version_required",
      );
    });
  }
});

test("governance readiness: withdrawn manual-policy binding is not ready", async () => {
  const database = governanceDatabase();
  await seedGovernedActivity(database);
  database.exec(`UPDATE compliance_manual_policy_bindings
    SET lifecycle_state = 'withdrawn'`);
  assertBlocked(
    await governance(database),
    "work_pack_published_effective_version_required",
  );
});

test("governance readiness: stale source SHA or review object identity is not ready", async (t) => {
  await t.test("binding SHA", async () => {
    const database = governanceDatabase();
    await seedGovernedActivity(database);
    database.exec(`UPDATE compliance_activity_work_pack_source_bindings
      SET source_artifact_sha256 = '${OTHER_HASH}'
      WHERE id = 'binding-work-pack'`);
    assertBlocked(
      await governance(database),
      "work_pack_composition_identity_required",
    );
  });
  await t.test("review object identity", async () => {
    const database = governanceDatabase();
    await seedGovernedActivity(database);
    database.exec(`UPDATE compliance_official_source_review_decisions
      SET artifact_object_key = 'sources/stale.pdf'
      WHERE id = 'artifact-review-current'`);
    assertBlocked(
      await governance(database),
      "work_pack_source_composition_not_approved",
    );
  });
});

test("governance readiness: same-person or note-less independent reviews are not ready", async (t) => {
  await t.test("same work-pack author and reviewer", async () => {
    const database = governanceDatabase();
    await seedGovernedActivity(database);
    database.exec(`UPDATE compliance_activity_work_pack_versions
      SET reviewed_by_uid = authored_by_uid`);
    assertBlocked(
      await governance(database),
      "work_pack_independent_review_required",
    );
  });
  await t.test("source binding missing review note", async () => {
    const database = governanceDatabase();
    await seedGovernedActivity(database);
    database.exec(`UPDATE compliance_activity_work_pack_source_bindings
      SET review_note = '' WHERE id = 'binding-work-pack'`);
    assertBlocked(
      await governance(database),
      "work_pack_source_composition_not_approved",
    );
  });
});

test("governance readiness: duplicate exact source binding is not ready", async () => {
  const database = governanceDatabase();
  await seedGovernedActivity(database);
  database.exec(`INSERT INTO compliance_activity_work_pack_source_bindings
    SELECT 'binding-work-pack-duplicate', organisation_id,
      work_pack_version_id, schema_sha256, source_artifact_id,
      source_artifact_sha256, source_role, target_key, citation_location,
      binding_state, created_by_uid, created_at, reviewed_by_uid, reviewed_at,
      review_note, withdrawn_by_uid, withdrawn_at, withdrawal_note
    FROM compliance_activity_work_pack_source_bindings
    WHERE id = 'binding-work-pack'`);
  assertBlocked(
    await governance(database),
    "work_pack_source_composition_duplicate",
  );
});

test("governance readiness: schema cannot omit product, scenario, and calculator dependencies", async () => {
  const database = governanceDatabase();
  await seedGovernedActivity(database, { includeDependencies: false });
  assertBlocked(
    await governance(database),
    "work_pack_catalogue_dependencies_incomplete",
  );
});

test("governance readiness: required signer or final-PDF source omission is not ready", async (t) => {
  await t.test("customer signer", async () => {
    const database = governanceDatabase();
    await seedGovernedActivity(database, { customerSignatureRequired: true });
    assertBlocked(
      await governance(database),
      "work_pack_requirement_mapping_incompatible",
    );
  });
  await t.test("final PDF source", async () => {
    const database = governanceDatabase();
    await seedGovernedActivity(database, { includeFinalPdfSource: false });
    assertBlocked(
      await governance(database),
      "work_pack_source_composition_incomplete",
    );
  });
});
