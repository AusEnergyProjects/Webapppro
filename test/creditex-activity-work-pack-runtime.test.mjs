import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { PDFDocument } from "pdf-lib";
import { createServer } from "vite";

import * as activityWorkPack from "../src/lib/creditex-activity-work-pack.ts";
import * as governmentCatalogue from "../src/lib/australian-government-program-catalogue.ts";
import * as interchangePreflight from "../src/lib/creditex-interchange-preflight.ts";
import * as manualPolicy from "../src/lib/creditex-manual-policy-merge.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORGANISATION_ID = "org_creditex_au";
const OWNER_UID = "installer-runtime";
const WORKER_UID = "worker-runtime-one";
const WORKER_TWO_UID = "worker-runtime-two";
const MEMBER_ID = "member-runtime-one";
const MEMBER_TWO_ID = "member-runtime-two";
const WORK_ORDER_ID = "work-order-runtime";
const INTENT_ID = "intent-runtime";
const PROGRAM_ID = "program-runtime";
const ACTIVITY_VERSION_ID = "activity-runtime";
const POLICY_ID = "policy-runtime";
const MANUAL_BINDING_ID = "manual-binding-runtime";
const WORK_PACK_VERSION_ID = "work-pack-runtime";
const SOURCE_ARTIFACT_ID = "source-artifact-runtime";
const SOURCE_REVIEW_ID = "source-review-runtime";
const SOURCE_OBJECT_KEY = "creditex/sources/runtime-template.pdf";
const NOW = "2026-08-15T00:00:00.000Z";
const REVISION_TIME = "2026-08-15T00:00:01.000Z";
const ACTIVITY = governmentCatalogue.GOVERNMENT_ACTIVITY_TEMPLATES.find(
  (candidate) => candidate.templateId === "qld-her-assessment",
);
const PROGRAM = governmentCatalogue.GOVERNMENT_PROGRAM_TEMPLATES.find(
  (candidate) => candidate.programCode === ACTIVITY.programCode,
);
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

class MemoryR2Object {
  constructor(record) {
    this.record = record;
    this.key = record.key;
    this.size = record.bytes.byteLength;
    this.httpMetadata = record.httpMetadata;
    this.customMetadata = record.customMetadata;
  }

  async arrayBuffer() {
    return this.record.bytes.slice().buffer;
  }
}

class MemoryR2Bucket {
  constructor() {
    this.records = new Map();
    this.deleted = [];
  }

  async get(key) {
    const record = this.records.get(key);
    return record ? new MemoryR2Object(record) : null;
  }

  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array
      ? value.slice()
      : new Uint8Array(value.slice(0));
    this.records.set(key, {
      key,
      bytes,
      httpMetadata: { ...(options.httpMetadata || {}) },
      customMetadata: { ...(options.customMetadata || {}) },
    });
    return new MemoryR2Object(this.records.get(key));
  }

  async delete(key) {
    this.deleted.push(key);
    this.records.delete(key);
  }
}

const bucket = new MemoryR2Bucket();
globalThis.__CREDITEX_RUNTIME_TEST_ENV__ = { EVIDENCE: bucket };
const cloudflareTestEnvPlugin = {
  name: "creditex-runtime-cloudflare-test-env",
  resolveId(source) {
    return source === "cloudflare:workers"
      ? "\0creditex-runtime-cloudflare-test-env"
      : null;
  },
  load(id) {
    return id === "\0creditex-runtime-cloudflare-test-env"
      ? "export const env = globalThis.__CREDITEX_RUNTIME_TEST_ENV__;"
      : null;
  },
};
const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [cloudflareTestEnvPlugin],
  root: ROOT,
});
const server = await vite.ssrLoadModule(
  "/src/lib/creditex-activity-work-pack-server.ts",
);
const complianceServer = await vite.ssrLoadModule(
  "/src/lib/creditex-compliance-server.ts",
);
const tradeComplianceIntent = await vite.ssrLoadModule(
  "/src/lib/trade-compliance-intent.ts",
);
const schemaGuards = await vite.ssrLoadModule(
  "/src/lib/creditex-schema-guards.ts",
);
const workPackSchemaGuards = await vite.ssrLoadModule(
  "/src/lib/creditex-work-pack-schema-guards.ts",
);
const outputActions = await vite.ssrLoadModule(
  "/src/lib/creditex-output-action-server.ts",
);
const sresActivation = await vite.ssrLoadModule(
  "/src/lib/creditex-sres-certificate-activation-server.ts",
);

after(async () => {
  await vite.close();
  delete globalThis.__CREDITEX_RUNTIME_TEST_ENV__;
});

class TestD1Statement {
  constructor(owner, sql, values = []) {
    this.owner = owner;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.owner, this.sql, values);
  }

  async first() {
    return this.owner.sqlite.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

class TestD1Database {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this.batchInterceptors = [];
  }

  prepare(sql) {
    return new TestD1Statement(this, sql);
  }

  interceptNextBatch(predicate, callback) {
    this.batchInterceptors.push({ predicate, callback });
  }

  async batch(statements) {
    const interceptorIndex = this.batchInterceptors.findIndex(({ predicate }) =>
      predicate(statements)
    );
    if (interceptorIndex >= 0) {
      const [{ callback }] = this.batchInterceptors.splice(interceptorIndex, 1);
      await callback(statements, this.sqlite);
    }
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function applyMigrations(sqlite) {
  const migrations = fs.readdirSync(path.join(ROOT, "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name)
      && name <= "0146_creditex_sres_certificate_activation_evidence.sql")
    .filter((name) => name !== "0044_flimsy_omega_flight.sql")
    .sort();
  for (const migration of migrations) {
    sqlite.exec(fs.readFileSync(path.join(ROOT, "drizzle", migration), "utf8")
      .replaceAll("--> statement-breakpoint", ""));
  }
}

function runtimeDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);
  return { sqlite, database: new TestD1Database(sqlite) };
}

async function installSchemaGuards(database) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await schemaGuards.ensureCreditexSchemaGuards(database);
      return;
    } catch (error) {
      if (!String(error?.message || error).startsWith("CREDITEX_SCHEMA_GUARDS_INSTALLING:")) {
        throw error;
      }
    }
  }
  throw new Error("CREDITEX_SCHEMA_GUARDS_DID_NOT_INSTALL");
}

function idempotency(clientActionId) {
  return {
    clientActionId,
    deviceId: "browser-runtime-device",
    payloadHash: sha256(Buffer.from(clientActionId)),
  };
}

function installedWorkPackGuardCount(sqlite) {
  return workPackSchemaGuards.CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS
    .filter(({ name }) => sqlite.prepare(
      "SELECT 1 present FROM sqlite_schema WHERE type = 'trigger' AND name = ?",
    ).get(name)?.present === 1).length;
}

function scope({ workerUid = WORKER_UID, memberId = MEMBER_ID } = {}) {
  return {
    ownerUid: OWNER_UID,
    actorUid: workerUid,
    actorMemberId: memberId,
    scope: "team",
  };
}

function prompt(overrides) {
  return {
    promptKey: "prompt",
    order: 1,
    type: "text",
    label: "Prompt",
    instructions: "",
    required: false,
    visibility: null,
    dependencyKeys: [],
    requirementKeys: [],
    stageKey: "field-capture",
    options: [],
    signerRoleKey: "",
    attestation: null,
    minimumLength: null,
    maximumLength: null,
    minimumNumber: null,
    maximumNumber: null,
    numberStep: null,
    unit: "",
    minimumSelections: null,
    maximumSelections: null,
    fileRequirement: null,
    referenceDocument: null,
    ...overrides,
  };
}

function governedRequirement({
  id,
  requirementCode,
  evidenceType,
  installerSignatureRequired = false,
}) {
  return {
    id,
    requirementCode,
    title: requirementCode,
    description: `Capture ${requirementCode}.`,
    evidenceType,
    captureTiming: "during_install",
    minimumCount: 1,
    maximumCount: 1,
    originalRequired: false,
    metadataRequired: false,
    gpsRequired: false,
    dateStampRequired: false,
    installerSignatureRequired,
    customerSignatureRequired: false,
    allowedContentTypes: evidenceType === "photo" ? ["image/png"] : [],
    conditionSnapshot: {},
    fieldSchema: {},
    sourceCitation: `Official source ${requirementCode}`,
    sortOrder: requirementCode === "REQ-SIGN" ? 20 : 10,
  };
}

function workPackSchema() {
  const dependencies = [
    {
      dependencyKey: "product-not-applicable",
      kind: "product",
      label: "No official product dependency",
      required: false,
      registryCode: "not_applicable",
      productKind: "not_applicable",
      productCategory: "Not applicable",
      selectionMode: "single",
      minimumCount: 1,
      maximumCount: 1,
    },
    {
      dependencyKey: "scenario-not-applicable",
      kind: "scenario",
      label: "No government scenario dependency",
      required: false,
      scenarioCodes: ["not_applicable"],
      selectionMode: "single",
    },
    {
      dependencyKey: "calculator-not-applicable",
      kind: "calculator",
      label: "No certificate calculator",
      required: false,
      catalogueFormulaKey: "not_applicable",
      calculatorKey: "not_applicable",
      calculatorVersion: 1,
      requiredInputKeys: ["not_applicable"],
    },
  ];
  return activityWorkPack.validateCreditexActivityWorkPack({
    contract: activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
    activityTemplateId: ACTIVITY.templateId,
    version: 1,
    title: "Existing-home energy rating field work pack",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2099-12-31",
    catalogueReviewedOn: governmentCatalogue.GOVERNMENT_CATALOGUE_REVIEWED_ON,
    stages: [{
      stageKey: "field-capture",
      order: 1,
      label: "Field capture",
      description: "Complete the governed field record.",
    }],
    signerRoles: [{
      roleKey: "assigned-technician",
      label: "Assigned technician",
      capacity: "technician",
      identitySource: "assigned_worker",
      minimumSignatures: 1,
      maximumSignatures: 1,
      identityRequirements: [
        { fieldKey: "full-name", label: "Full name", required: true },
        { fieldKey: "email", label: "Email", required: true },
        { fieldKey: "member-id", label: "Member ID", required: true },
        { fieldKey: "uid", label: "User ID", required: true },
      ],
    }],
    dependencies,
    sections: [{
      sectionKey: "evidence",
      order: 1,
      title: "Evidence",
      description: "Simple governed evidence collection.",
      visibility: null,
      repeatability: null,
      prompts: [
        prompt({
          promptKey: "show-hidden-photo",
          order: 1,
          type: "checkbox",
          label: "Show conditional photo",
        }),
        prompt({
          promptKey: "visit-note",
          order: 2,
          type: "text",
          label: "Visit note",
        }),
        prompt({
          promptKey: "hidden-photo",
          order: 3,
          type: "photo",
          label: "Conditional photo",
          required: true,
          visibility: {
            match: "all",
            conditions: [{
              promptKey: "show-hidden-photo",
              scope: "work_pack",
              operator: "equals",
              value: true,
            }],
          },
          requirementKeys: ["REQ-HIDDEN-PHOTO"],
          fileRequirement: {
            minimumCount: 1,
            maximumCount: 1,
            allowedContentTypes: ["image/png"],
            originalRequired: false,
            metadataRequired: false,
            gpsRequired: false,
            captureTimeRequired: false,
          },
        }),
        prompt({
          promptKey: "technician-signature",
          order: 4,
          type: "signature",
          label: "Technician signature",
          required: true,
          requirementKeys: ["REQ-SIGN"],
          signerRoleKey: "assigned-technician",
          attestation: {
            text: "I confirm this exact governed field record is true and complete.",
            version: "1",
            sourceBindingTargetKey: "technician-attestation",
          },
        }),
      ],
    }],
    documentOutputs: [{
      outputKey: "completed-field-form",
      title: "Completed field form",
      sourceBindingTargetKey: "final-form-template",
      rendererVersion: activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION,
      required: true,
      placements: [
        {
          placementKey: "technician-name",
          kind: "text",
          sourcePath: "/prefill/assignmentContext/assignedWorkerName",
          signaturePromptKey: "",
          signerRoleKey: "",
          pageIndex: 0,
          x: 0.1,
          y: 0.72,
          width: 0.8,
          height: 0.08,
          fontFamily: "helvetica",
          fontSize: 10,
          minimumFontSize: 6,
          overflow: "shrink",
          maximumLines: 1,
          textFormat: "text",
        },
        {
          placementKey: "technician-signature",
          kind: "signature",
          sourcePath: "",
          signaturePromptKey: "technician-signature",
          signerRoleKey: "assigned-technician",
          pageIndex: 0,
          x: 0.1,
          y: 0.5,
          width: 0.8,
          height: 0.16,
          fontFamily: "helvetica",
          fontSize: 10,
          minimumFontSize: 6,
          overflow: "shrink",
          maximumLines: 1,
          textFormat: "text",
        },
      ],
    }],
  });
}

async function pdfTemplate() {
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

function manualBindingSnapshot(requirements, sourceHash) {
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
      officialSourceSha256: sourceHash,
      officialSourceCheckedAt: NOW,
      publicationRequestId: "publish-program-runtime",
      publicationSnapshotSha256: "6".repeat(64),
      publishedByUid: "governance-reviewer",
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
      officialSourceSha256: sourceHash,
      officialSourceCheckedAt: NOW,
      publicationRequestId: "publish-activity-runtime",
      publicationSnapshotSha256: "7".repeat(64),
      publishedByUid: "governance-reviewer",
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
      officialSourceSha256: sourceHash,
      officialSourceCheckedAt: NOW,
      publicationRequestId: "publish-policy-runtime",
      publicationSnapshotSha256: "8".repeat(64),
      contentRevision: 1,
      publishedByUid: "governance-reviewer",
      publishedAt: NOW,
    },
    sourceApprovals: {
      programBindingId: "official-binding-program-runtime",
      activityBindingId: "official-binding-activity-runtime",
      evidencePolicyBindingId: "official-binding-policy-runtime",
    },
    requirements,
  });
}

function insertRequirement(sqlite, requirement) {
  sqlite.prepare(`INSERT INTO compliance_evidence_requirements (
      id, organisation_id, policy_version_id, requirement_code, title,
      description, evidence_type, capture_timing, minimum_count,
      maximum_count, original_required, metadata_required, gps_required,
      date_stamp_required, installer_signature_required,
      customer_signature_required, allowed_content_types,
      condition_snapshot, field_schema, source_citation, sort_order,
      created_by_uid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      'governance-author', ?, ?)`)
    .run(
      requirement.id,
      ORGANISATION_ID,
      POLICY_ID,
      requirement.requirementCode,
      requirement.title,
      requirement.description,
      requirement.evidenceType,
      requirement.captureTiming,
      requirement.minimumCount,
      requirement.maximumCount,
      Number(requirement.originalRequired),
      Number(requirement.metadataRequired),
      Number(requirement.gpsRequired),
      Number(requirement.dateStampRequired),
      Number(requirement.installerSignatureRequired),
      Number(requirement.customerSignatureRequired),
      JSON.stringify(requirement.allowedContentTypes),
      JSON.stringify(requirement.conditionSnapshot),
      JSON.stringify(requirement.fieldSchema),
      requirement.sourceCitation,
      requirement.sortOrder,
      NOW,
      NOW,
    );
}

function seedOfficialSourceApproval(sqlite, templateBytes, sourceHash) {
  sqlite.prepare(`INSERT INTO compliance_official_source_artifacts (
      id, organisation_id, client_request_id, source_url, source_host, source_title,
      source_version, original_file_name, content_type, size_bytes, sha256,
      object_key, retrieval_method, asserted_retrieved_at, captured_by_uid,
      captured_at
    ) VALUES (?, ?, 'source-request-runtime', ?, 'www.chde.qld.gov.au', ?,
      '2026.1', 'runtime.pdf', 'application/pdf', ?, ?, ?, 'manual_upload', ?,
      'source-capturer', ?)`)
    .run(
      SOURCE_ARTIFACT_ID,
      ORGANISATION_ID,
      PROGRAM.officialSourceUrl,
      PROGRAM.officialSourceTitle,
      templateBytes.byteLength,
      sourceHash,
      SOURCE_OBJECT_KEY,
      NOW,
      NOW,
    );
  sqlite.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, decision, review_note, reviewed_by_uid,
      reviewed_at
    ) VALUES (?, ?, 'artifact', ?, ?, ?, ?, 'approved',
      'Exact retained source independently reviewed.', 'source-reviewer', ?)`)
    .run(
      SOURCE_REVIEW_ID,
      ORGANISATION_ID,
      SOURCE_ARTIFACT_ID,
      SOURCE_ARTIFACT_ID,
      sourceHash,
      SOURCE_OBJECT_KEY,
      NOW,
    );
  for (const [suffix, targetType, targetId] of [
    ["program", "program", PROGRAM_ID],
    ["activity", "activity", ACTIVITY_VERSION_ID],
    ["policy", "evidence_policy", POLICY_ID],
  ]) {
    const bindingId = `official-binding-${suffix}-runtime`;
    sqlite.prepare(`INSERT INTO compliance_official_source_bindings (
        id, organisation_id, artifact_id, target_type, target_id,
        citation_location, binding_state, rule_activation_enabled,
        created_by_uid, created_at
      ) VALUES (?, ?, ?, ?, ?, 'Whole retained source', 'pending_review', 0,
        'source-capturer', ?)`)
      .run(
        bindingId,
        ORGANISATION_ID,
        SOURCE_ARTIFACT_ID,
        targetType,
        targetId,
        NOW,
      );
    sqlite.prepare(`INSERT INTO compliance_official_source_review_decisions (
        id, organisation_id, subject_type, subject_id, artifact_id,
        artifact_sha256, artifact_object_key, binding_target_type,
        binding_target_id, citation_location, decision, review_note, reviewed_by_uid,
        reviewed_at
      ) VALUES (?, ?, 'binding', ?, ?, ?, ?, ?, ?, 'Whole retained source',
        'approved', 'Exact binding independently reviewed.', 'source-reviewer', ?)`)
      .run(
        `official-binding-review-${suffix}-runtime`,
        ORGANISATION_ID,
        bindingId,
        SOURCE_ARTIFACT_ID,
        sourceHash,
        SOURCE_OBJECT_KEY,
        targetType,
        targetId,
        NOW,
      );
  }
}

async function seedGovernance(sqlite, templateBytes) {
  const sourceHash = sha256(templateBytes);
  seedOfficialSourceApproval(sqlite, templateBytes, sourceHash);
  const requirements = [
    governedRequirement({
      id: "requirement-hidden-photo-runtime",
      requirementCode: "REQ-HIDDEN-PHOTO",
      evidenceType: "photo",
    }),
    governedRequirement({
      id: "requirement-signature-runtime",
      requirementCode: "REQ-SIGN",
      evidenceType: "signature",
      installerSignatureRequired: true,
    }),
  ];
  const workPack = workPackSchema();
  const schemaSha256 = activityWorkPack.creditexActivityWorkPackSha256(workPack);
  const bindingSnapshot = manualBindingSnapshot(requirements, sourceHash);
  const bindingSha256 = await manualPolicy.manualPolicySha256(
    manualPolicy.canonicalManualPolicyJson(bindingSnapshot),
  );

  sqlite.prepare(`INSERT INTO compliance_programs (
      id, organisation_id, program_code, name, scheme_kind, jurisdiction,
      administering_body, official_source_url, official_source_title,
      official_source_version, official_source_sha256,
      official_source_checked_at, publish_state, publication_request_id,
      publication_snapshot_sha256, published_by_uid, published_at,
      created_by_uid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026.1', ?, ?, 'published',
      'publish-program-runtime', ?, 'governance-reviewer', ?,
      'governance-author', ?, ?)`)
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
      sourceHash,
      NOW,
      "6".repeat(64),
      NOW,
      NOW,
      NOW,
    );
  sqlite.prepare(`INSERT INTO compliance_activity_versions (
      id, program_id, activity_key, version, title, service_category,
      registry_activity_code, specification_part, product_category,
      scenario_code, scenario, jurisdiction, effective_from, effective_to,
      official_source_url, official_source_title, official_source_version,
      official_source_sha256, official_source_checked_at, publish_state,
      publication_request_id, publication_snapshot_sha256, published_by_uid,
      published_at, created_by_uid, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01',
      '2099-12-31', ?, ?, '2026.1', ?, ?, 'published',
      'publish-activity-runtime', ?, 'governance-reviewer', ?,
      'governance-author', ?, ?)`)
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
      sourceHash,
      NOW,
      "7".repeat(64),
      NOW,
      NOW,
      NOW,
    );
  sqlite.prepare(`INSERT INTO compliance_evidence_policy_versions (
      id, organisation_id, activity_version_id, version, title,
      official_source_url, official_source_title, official_source_version,
      official_source_sha256, official_source_checked_at,
      requirements_complete, publish_state, publication_request_id,
      publication_snapshot_sha256, content_revision, published_by_uid,
      published_at, created_by_uid, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, '2026.1', ?, ?, 1, 'published',
      'publish-policy-runtime', ?, 1, 'governance-reviewer', ?,
      'governance-author', ?, ?)`)
    .run(
      POLICY_ID,
      ORGANISATION_ID,
      ACTIVITY_VERSION_ID,
      `${ACTIVITY.title} evidence policy`,
      PROGRAM.officialSourceUrl,
      `${ACTIVITY.title} evidence guide`,
      sourceHash,
      NOW,
      "8".repeat(64),
      NOW,
      NOW,
      NOW,
    );
  for (const requirement of requirements) insertRequirement(sqlite, requirement);
  sqlite.prepare(`INSERT INTO compliance_manual_policy_bindings (
      id, organisation_id, activity_template_id, activity_version_id,
      evidence_policy_version_id, version, program_id, program_source_binding_id,
      activity_source_binding_id, evidence_policy_source_binding_id,
      binding_snapshot, binding_snapshot_sha256, lifecycle_state,
      requested_by_uid, requested_at, approved_by_uid, approved_at,
      approval_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 'official-binding-program-runtime',
      'official-binding-activity-runtime', 'official-binding-policy-runtime',
      ?, ?, 'approved', 'governance-author', ?, 'governance-reviewer', ?,
      'Independent manual policy approval.', ?, ?)`)
    .run(
      MANUAL_BINDING_ID,
      ORGANISATION_ID,
      ACTIVITY.templateId,
      ACTIVITY_VERSION_ID,
      POLICY_ID,
      PROGRAM_ID,
      JSON.stringify(bindingSnapshot),
      bindingSha256,
      NOW,
      NOW,
      NOW,
      NOW,
    );
  sqlite.prepare(`INSERT INTO compliance_activity_work_pack_versions (
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
      '2099-12-31', 'draft', 'governance-author', ?, 'governance-author', ?,
      '', '', '',
      '', '', '', '', '', '', ?)`)
    .run(
      WORK_PACK_VERSION_ID,
      ORGANISATION_ID,
      ACTIVITY_VERSION_ID,
      ACTIVITY.templateId,
      MANUAL_BINDING_ID,
      bindingSha256,
      POLICY_ID,
      sourceHash,
      activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
      workPack.title,
      JSON.stringify(workPack),
      schemaSha256,
      NOW,
      NOW,
      NOW,
    );

  const sourceTargets = [
    ["source-work-pack-runtime", "requirement", "work_pack"],
    ["source-product-runtime", "product", "product-not-applicable"],
    ["source-scenario-runtime", "scenario", "scenario-not-applicable"],
    ["source-calculator-runtime", "calculator", "calculator-not-applicable"],
    ["source-output-runtime", "requirement", `output:${PROGRAM.claimOutputCode}`],
    ["source-attestation-runtime", "requirement", "technician-attestation"],
    ["source-final-pdf-runtime", "requirement", "final-form-template"],
  ];
  const insertSource = sqlite.prepare(`INSERT INTO
      compliance_activity_work_pack_source_bindings (
        id, organisation_id, work_pack_version_id, schema_sha256,
        source_artifact_id, source_artifact_sha256, source_role, target_key,
        citation_location, binding_state, created_by_uid, created_at,
        reviewed_by_uid, reviewed_at, review_note, withdrawn_by_uid,
        withdrawn_at, withdrawal_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Whole retained source', 'pending_review',
        'governance-author', ?, '', '', '', '', '', '')`);
  for (const [id, role, target] of sourceTargets) {
    insertSource.run(
      id,
      ORGANISATION_ID,
      WORK_PACK_VERSION_ID,
      schemaSha256,
      SOURCE_ARTIFACT_ID,
      sourceHash,
      role,
      target,
      NOW,
    );
    sqlite.prepare(`UPDATE compliance_activity_work_pack_source_bindings
        SET binding_state = 'approved', reviewed_by_uid = 'governance-reviewer',
          reviewed_at = ?, review_note = 'Independent exact-source review.'
        WHERE id = ? AND binding_state = 'pending_review'`)
      .run(NOW, id);
  }
  sqlite.prepare(`UPDATE compliance_activity_work_pack_versions
      SET publish_state = 'published', reviewed_by_uid = 'governance-reviewer',
        reviewed_at = ?, review_note = 'Independent exact-source review.'
      WHERE id = ? AND publish_state = 'draft'`)
    .run(NOW, WORK_PACK_VERSION_ID);
  return { bindingSha256, schemaSha256, sourceHash, workPack };
}

function intentSnapshot() {
  return tradeComplianceIntent.resolveTradeComplianceIntent({
    mode: "planned",
    programTemplateId: PROGRAM.templateId,
    activityTemplateId: ACTIVITY.templateId,
    siteJurisdiction: PROGRAM.jurisdiction,
    plannedStart: "2026-08-15T09:00:00.000Z",
  }).snapshot;
}

function seedOperationalRecords(sqlite) {
  sqlite.prepare(`INSERT INTO trade_accounts (
      firebase_uid, email, business_name, contact_name, phone, partner_type,
      business_website, service_states, capabilities, summary, account_status,
      verification_status, consent_version, consent_at,
      created_at, updated_at, abn, verified_abn
    ) VALUES (?, 'owner@example.test', 'Runtime Installer Pty Ltd',
      'Owner Runtime', '0400000000', 'installer', '', '["QLD"]', '[]', '',
      'active', 'verified', 'runtime', ?, ?, ?, '12345678901',
      '12345678901')`)
    .run(OWNER_UID, NOW, NOW, NOW);
  sqlite.prepare(`INSERT INTO trade_team_members (
      id, owner_uid, member_uid, email, display_name, role, status,
      invited_at, accepted_at, last_active_at, created_at, updated_at,
      first_name, last_name, phone, can_manage_jobs, can_view_field_evidence,
      can_manage_field_evidence, job_scope, schedule_scope
    ) VALUES (?, ?, ?, 'worker-one@example.test', 'Worker One', 'technician',
      'active', ?, ?, ?, ?, ?, 'Worker', 'One', '0411111111', 1, 1, 1,
      'team', 'team')`)
    .run(MEMBER_ID, OWNER_UID, WORKER_UID, NOW, NOW, NOW, NOW, NOW);
  sqlite.prepare(`INSERT INTO trade_team_members (
      id, owner_uid, member_uid, email, display_name, role, status,
      invited_at, accepted_at, last_active_at, created_at, updated_at,
      first_name, last_name, phone, can_manage_jobs, can_view_field_evidence,
      can_manage_field_evidence, job_scope, schedule_scope
    ) VALUES (?, ?, ?, 'worker-two@example.test', 'Worker Two', 'technician',
      'active', ?, ?, ?, ?, ?, 'Worker', 'Two', '0422222222', 1, 1, 1,
      'team', 'team')`)
    .run(MEMBER_TWO_ID, OWNER_UID, WORKER_TWO_UID, NOW, NOW, NOW, NOW, NOW);
  sqlite.prepare(`INSERT INTO trade_work_orders (
      id, firebase_uid, partner_type, work_type, source_type,
      source_reference, work_number, title, service_category, site_area,
      stage, priority, scheduled_start, scheduled_end, assignee_label,
      assignee_member_id, revision, record_status, created_at, updated_at
    ) VALUES (?, ?, 'installer', 'job', 'internal', '', 'JOB-RUNTIME',
      'Runtime governed field job', ?, 'Brisbane', 'scheduled', 'standard',
      '2026-08-15T09:00:00.000Z', '2026-08-15T10:00:00.000Z',
      'Worker One', ?, 1, 'active', ?, ?)`)
    .run(WORK_ORDER_ID, OWNER_UID, ACTIVITY.serviceCategory, MEMBER_ID, NOW, NOW);
  sqlite.prepare(`INSERT INTO trade_crm_customers (
      id, firebase_uid, customer_number, customer_type, first_name, last_name,
      business_name, email, phone, address_line_1, address_line_2, suburb,
      address_state, postcode, tags, private_notes, record_status, created_at,
      updated_at
    ) VALUES ('customer-runtime', ?, 'CUS-RUNTIME', 'residential', 'Customer',
      'Runtime', '', 'customer@example.test', '0433333333', '1 Runtime Way',
      '', 'Brisbane', 'QLD', '4000', '[]', '', 'active', ?, ?)`)
    .run(OWNER_UID, NOW, NOW);
  sqlite.prepare(`INSERT INTO trade_crm_service_sites (
      id, firebase_uid, customer_id, site_label, address_line_1,
      address_line_2, suburb, address_state, postcode, access_instructions,
      parking_instructions, hazard_notes, is_primary, record_status,
      created_at, updated_at
    ) VALUES ('site-runtime', ?, 'customer-runtime', 'Primary site',
      '1 Runtime Way', '', 'Brisbane', 'QLD', '4000', '', '', '', 1,
      'active', ?, ?)`)
    .run(OWNER_UID, NOW, NOW);
  sqlite.prepare(`INSERT INTO trade_crm_customer_contacts (
      id, firebase_uid, customer_id, first_name, last_name, role_label,
      email, phone, is_primary, record_status, created_at, updated_at
    ) VALUES ('contact-runtime', ?, 'customer-runtime', 'Customer', 'Runtime',
      'Primary contact', 'customer@example.test', '0433333333', 1, 'active',
      ?, ?)`)
    .run(OWNER_UID, NOW, NOW);
  sqlite.prepare(`INSERT INTO trade_crm_site_contacts (
      id, firebase_uid, service_site_id, customer_contact_id, role_label,
      is_primary, record_status, created_at, updated_at
    ) VALUES ('site-contact-runtime', ?, 'site-runtime', 'contact-runtime',
      'Primary service contact', 1, 'active', ?, ?)`)
    .run(OWNER_UID, NOW, NOW);
  sqlite.prepare(`INSERT INTO trade_crm_job_details (
      id, work_order_id, firebase_uid, crm_customer_id, service_site_id,
      customer_source, pipeline_stage, description, customer_reference,
      next_action, tags, estimated_value_cents, quoted_value_cents,
      invoiced_value_cents, paid_value_cents, quote_status, invoice_status,
      payment_due_at, created_at, updated_at
    ) VALUES ('job-detail-runtime', ?, ?, 'customer-runtime', 'site-runtime',
      'trade_owned', 'scheduled', '', '', '', '[]', 0, 0, 0, 0,
      'not_started', 'not_started', '', ?, ?)`)
    .run(WORK_ORDER_ID, OWNER_UID, NOW, NOW);
  sqlite.prepare(`UPDATE compliance_organisations
      SET legal_name = 'Creditex Australia Pty Ltd', trading_name = 'Creditex',
        abn = '10987654321', status = 'active', updated_at = ?
      WHERE id = ? AND organisation_code = 'CREDITEX-AU'`)
    .run(NOW, ORGANISATION_ID);
  sqlite.prepare(`INSERT INTO admin_users (
      id, firebase_uid, email, display_name, role, status, invited_by_uid,
      last_login_at, created_at, updated_at
    ) VALUES ('admin-runtime-verifier', 'runtime-platform-owner',
      'platform-owner@creditex.test', 'Runtime Platform Owner', 'owner',
      'active', 'runtime-bootstrap', '', ?, ?)`)
    .run(NOW, NOW);
  for (const [id, uid, email, displayName, role] of [
    ["compliance-author-runtime", "governance-author", "author@creditex.test", "Governance Author", "admin"],
    ["compliance-reviewer-runtime", "governance-reviewer", "reviewer@creditex.test", "Governance Reviewer", "admin"],
    ["compliance-source-runtime", "source-capturer", "source@creditex.test", "Source Custodian", "case_manager"],
    ["compliance-source-reviewer-runtime", "source-reviewer", "source-reviewer@creditex.test", "Source Reviewer", "admin"],
  ]) {
    sqlite.prepare(`INSERT INTO compliance_users (
        id, organisation_id, firebase_uid, email, display_name, role, status,
        created_by_uid, last_login_at, created_at, updated_at,
        governance_identity_verified, governance_identity_verified_by_uid,
        governance_identity_verified_at, governance_identity_verification_basis
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'runtime-bootstrap', '', ?, ?, 1,
        'runtime-platform-owner', ?, 'Bounded runtime governance fixture')`)
      .run(id, ORGANISATION_ID, uid, email, displayName, role, NOW, NOW, NOW);
  }
  sqlite.prepare(`INSERT INTO compliance_participants (
      id, organisation_id, participant_type, external_reference, legal_name,
      trading_name, abn, contact_email, status, effective_from, effective_to,
      created_by_uid, created_at, updated_at
    ) VALUES ('participant-runtime', ?, 'installer', ?,
      'Runtime Installer Pty Ltd', 'Runtime Installer', '12345678901',
      'owner@example.test', 'active', '2026-01-01', '',
      'governance-author', ?, ?)`)
    .run(ORGANISATION_ID, OWNER_UID, NOW, NOW);
  const snapshot = intentSnapshot();
  const snapshotJson = tradeComplianceIntent.stableTradeComplianceIntentJson(snapshot);
  sqlite.prepare(`INSERT INTO trade_work_order_compliance_intents (
      id, work_order_id, installer_uid, compliance_organisation_id,
      program_template_id, activity_template_id, program_code,
      registry_activity_code, service_category, site_jurisdiction,
      planned_start, catalogue_reviewed_on, intent_snapshot,
      intent_snapshot_sha256, status, compliance_case_id, revision,
      created_by_uid, created_at, updated_at, intent_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-08-15T09:00:00.000Z',
      ?, ?, ?, 'planned', '', 1, ?, ?, ?, ?)`)
    .run(
      INTENT_ID,
      WORK_ORDER_ID,
      OWNER_UID,
      ORGANISATION_ID,
      PROGRAM.templateId,
      ACTIVITY.templateId,
      PROGRAM.programCode,
      ACTIVITY.registryActivityCode,
      ACTIVITY.serviceCategory,
      PROGRAM.jurisdiction,
      governmentCatalogue.GOVERNMENT_CATALOGUE_REVIEWED_ON,
      snapshotJson,
      sha256(Buffer.from(snapshotJson)),
      OWNER_UID,
      NOW,
      NOW,
      `program:${PROGRAM.templateId}:activity:${ACTIVITY.templateId}`,
    );
}

async function seededRuntime() {
  bucket.records.clear();
  bucket.deleted.length = 0;
  const runtime = runtimeDatabase();
  seedOperationalRecords(runtime.sqlite);
  const templateBytes = await pdfTemplate();
  const governance = await seedGovernance(runtime.sqlite, templateBytes);
  await installSchemaGuards(runtime.database);
  await bucket.put(SOURCE_OBJECT_KEY, templateBytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { sha256: governance.sourceHash },
  });
  return { ...runtime, ...governance, templateBytes };
}

function ownerScope() {
  return {
    ownerUid: OWNER_UID,
    actorUid: OWNER_UID,
    actorMemberId: "",
    scope: "team",
  };
}

function outputActor(actorUid, actorKind = "compliance") {
  return Object.freeze({
    actorUid,
    actorKind,
    organisationId: ORGANISATION_ID,
  });
}

async function openAssignedRuntimeWorkPack(database) {
  const [ready] = await complianceServer.reconcileReadyPlannedComplianceWorkPacks(
    database,
    {
      workOrderId: WORK_ORDER_ID,
      installerUid: OWNER_UID,
      actorUid: OWNER_UID,
      createdAt: REVISION_TIME,
    },
  );
  assert.equal(ready.workPackReady, true, JSON.stringify(ready.blockers));
  const projection = await server.loadAssignedCreditexActivityWorkPack(database, {
    ...scope(),
    caseInstanceId: ready.workPackInstanceId,
  });
  return { ready, projection };
}

function markRuntimeSiteProviderSelected(sqlite) {
  sqlite.prepare(`UPDATE trade_crm_service_sites
      SET address_entry_mode = 'provider_selected',
        address_provider = 'google-places',
        address_provider_reference = 'places/runtime-site',
        address_formatted = '1 Runtime Way, Brisbane QLD 4000, Australia',
        address_verified_at = '2026-08-15T00:00:01.500Z'
      WHERE id = 'site-runtime'`)
    .run();
}

function runtimeSiteAddressRecord(sqlite) {
  return { ...sqlite.prepare(`SELECT address_line_1, address_line_2, suburb,
      address_state, postcode, address_entry_mode, address_provider,
      address_provider_reference, address_formatted, address_verified_at
    FROM trade_crm_service_sites WHERE id = 'site-runtime'`).get() };
}

async function signaturePacket(database, projection, {
  workerUid = WORKER_UID,
  memberId = MEMBER_ID,
  signedAt = "2026-08-15T00:00:05.000Z",
  clientUploadId = "signature-upload-runtime",
} = {}) {
  const workerScope = scope({ workerUid, memberId });
  const signerBinding = projection.signerBindings.find(({ roleKey }) =>
    roleKey === "assigned-technician"
  );
  assert.ok(signerBinding);
  const signerIdentity = Object.freeze({
    contract: activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_SIGNER_IDENTITY_CONTRACT,
    ...signerBinding,
  });
  const signerIdentitySha256 = interchangePreflight.creditexCanonicalSha256(
    signerIdentity,
  );
  const attestation = Object.freeze({
    contract: activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT,
    promptKey: "technician-signature",
    signerRoleKey: "assigned-technician",
    text: "I confirm this exact governed field record is true and complete.",
    version: "1",
    sourceBindingTargetKey: "technician-attestation",
    signerIdentity,
    signerIdentitySha256,
    ...projection.signatureBindings,
  });
  const attestationSha256 = interchangePreflight.creditexCanonicalSha256(attestation);
  const signaturePayload = Object.freeze({
    contract: activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT,
    instanceKey: projection.instance.instanceKey,
    caseInstanceId: projection.instance.id,
    promptKey: "technician-signature",
    signerRoleKey: "assigned-technician",
    signerName: signerIdentity.signerName,
    signerCapacity: signerIdentity.capacity,
    signerIdentitySha256,
    attestationSha256,
    ...projection.signatureBindings,
    strokes: [{
      points: [
        { x: 0.1, y: 0.2, pressure: 0.5, capturedAtOffsetMs: 0 },
        { x: 0.8, y: 0.7, pressure: 0.5, capturedAtOffsetMs: 200 },
      ],
    }],
    signedAt,
  });
  const bytes = new TextEncoder().encode(JSON.stringify(signaturePayload));
  const uploaded = await server.captureAssignedCreditexActivityWorkPackBrowserUpload(
    database,
    {
      ...workerScope,
      caseInstanceId: projection.instance.id,
      sectionKey: "evidence",
      promptKey: "technician-signature",
      clientUploadId,
      purpose: "signature",
      fileName: "technician-signature.json",
      contentType: "application/json",
      bytes,
      now: signedAt,
    },
  );
  const deviceAttestation = Object.freeze({
    contract: activityWorkPack.CREDITEX_ACTIVITY_WORK_PACK_DEVICE_ATTESTATION_CONTRACT,
    deviceId: uploaded.upload.deviceId,
    appId: "tlink-web",
    appVersion: "1.0.0",
    appBuild: "runtime-test",
    sessionId: uploaded.upload.sessionId,
    capturedByUid: workerUid,
    signedAt,
    deviceContext: { platform: "runtime-test" },
  });
  return {
    workerScope,
    packet: {
      sectionKey: "evidence",
      promptKey: "technician-signature",
      clientUploadId,
      signerIdentity,
      signerIdentitySha256,
      signaturePayload,
      signaturePayloadSha256: interchangePreflight.creditexCanonicalSha256(
        signaturePayload,
      ),
      attestation,
      attestationSha256,
      deviceAttestation,
      deviceAttestationSha256: interchangePreflight.creditexCanonicalSha256(
        deviceAttestation,
      ),
      signatureSha256: uploaded.upload.sha256,
    },
  };
}

test("empty assigned work-pack listing installs all guards before returning", async () => {
  const { sqlite, database } = runtimeDatabase();
  const result = await server.listAssignedCreditexActivityWorkPacks(
    database,
    scope(),
  );
  assert.deepEqual(result, []);
  assert.equal(
    installedWorkPackGuardCount(sqlite),
    workPackSchemaGuards.CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.length,
  );
  sqlite.close();
});

test("empty guided auto-open installs all work-pack guards before its first read", async () => {
  const { sqlite, database } = runtimeDatabase();
  let result;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      result = await complianceServer.autoOpenReadyPlannedComplianceWorkPacks(
        database,
        {
          workOrderId: "missing-runtime-work-order",
          installerUid: "missing-runtime-installer",
          actorUid: "missing-runtime-installer",
          createdAt: NOW,
        },
      );
      break;
    } catch (error) {
      if (!String(error?.message || error).startsWith(
        "CREDITEX_SCHEMA_GUARDS_INSTALLING:",
      )) throw error;
    }
  }
  assert.deepEqual(result, []);
  assert.equal(
    installedWorkPackGuardCount(sqlite),
    workPackSchemaGuards.CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.length,
  );
  sqlite.close();
});

test("guided work-pack reconciliation retries atomically and remains idempotent without certificates", async () => {
  const { sqlite, database } = await seededRuntime();
  database.interceptNextBatch(
    (statements) => statements.some(({ sql }) =>
      sql.includes("INSERT INTO") && sql.includes("compliance_cases")
    ),
    async () => {
      throw new Error("transient guided work-pack batch failure");
    },
  );
  await assert.rejects(
    complianceServer.reconcileReadyPlannedComplianceWorkPacks(database, {
      workOrderId: WORK_ORDER_ID,
      installerUid: OWNER_UID,
      actorUid: OWNER_UID,
      createdAt: REVISION_TIME,
    }),
    /transient guided work-pack batch failure/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM compliance_cases").get().count, 0);
  assert.equal(
    sqlite.prepare("SELECT status FROM trade_work_order_compliance_intents WHERE id = ?")
      .get(INTENT_ID).status,
    "planned",
  );

  const [created] = await complianceServer.reconcileReadyPlannedComplianceWorkPacks(
    database,
    {
      workOrderId: WORK_ORDER_ID,
      installerUid: OWNER_UID,
      actorUid: OWNER_UID,
      createdAt: REVISION_TIME,
    },
  );
  assert.equal(created.workPackReady, true);
  assert.ok(created.complianceCaseId);
  assert.ok(created.workPackInstanceId);
  const [duplicate] = await complianceServer.reconcileReadyPlannedComplianceWorkPacks(
    database,
    {
      workOrderId: WORK_ORDER_ID,
      installerUid: OWNER_UID,
      actorUid: OWNER_UID,
      createdAt: "2026-08-15T00:00:02.000Z",
    },
  );
  assert.deepEqual(duplicate, created);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM compliance_cases").get().count, 1);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) count FROM compliance_activity_work_pack_instances")
      .get().count,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) count FROM compliance_certificate_lots")
      .get().count,
    0,
  );
});

test("assigned work-pack rejects hidden evidence and binds commit, signatures, reassignment and final PDF cleanup", async () => {
  const { sqlite, database } = await seededRuntime();
  const { projection: opened } = await openAssignedRuntimeWorkPack(database);

  await assert.rejects(
    server.captureAssignedCreditexActivityWorkPackBrowserUpload(database, {
      ...scope(),
      caseInstanceId: opened.instance.id,
      sectionKey: "evidence",
      promptKey: "hidden-photo",
      clientUploadId: "hidden-photo-runtime",
      purpose: "artifact",
      fileName: "hidden.png",
      contentType: "image/png",
      bytes: new Uint8Array([1]),
      now: "2026-08-15T00:00:02.000Z",
    }),
    (error) => error?.code === "WORK_PACK_PROMPT_NOT_VISIBLE",
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) count FROM compliance_activity_work_pack_browser_upload_receipts")
      .get().count,
    0,
  );

  const commitInput = {
    ...scope(),
    caseInstanceId: opened.instance.id,
    expectedResponseSha256: opened.instance.responseSha256,
    sectionPatches: [{
      sectionKey: "evidence",
      answers: { "visit-note": "Runtime visit note" },
    }],
    idempotency: idempotency("commit-runtime"),
    now: "2026-08-15T00:00:03.000Z",
  };
  const committed = await server.commitAssignedCreditexActivityWorkPack(
    database,
    commitInput,
  );
  assert.equal(committed.status, "applied");
  const duplicateCommit = await server.commitAssignedCreditexActivityWorkPack(
    database,
    commitInput,
  );
  assert.equal(duplicateCommit.status, "duplicate");
  assert.equal(duplicateCommit.projection.instance.id, committed.projection.instance.id);

  const prepared = await server.prepareAssignedCreditexActivityWorkPackSigning(
    database,
    {
      ...scope(),
      caseInstanceId: committed.projection.instance.id,
      expectedResponseSha256: committed.projection.instance.responseSha256,
      idempotency: idempotency("prepare-runtime"),
      now: "2026-08-15T00:00:04.000Z",
    },
  );
  assert.equal(prepared.projection.instance.status, "ready_to_sign");
  const firstSignature = await signaturePacket(database, prepared.projection);
  const captureIdempotency = {
    ...idempotency("capture-runtime"),
    deviceId: firstSignature.packet.deviceAttestation.deviceId,
  };
  assert.equal(server.CREDITEX_WORK_PACK_SIGNATURE_CLOCK_SKEW_MS, 300_000);
  assert.equal(
    server.CREDITEX_WORK_PACK_SIGNATURE_OFFLINE_MAX_AGE_MS,
    7 * 24 * 60 * 60 * 1000,
  );
  const futureSignature = await signaturePacket(database, prepared.projection, {
    signedAt: "2026-08-15T00:05:01.000Z",
    clientUploadId: "signature-upload-future-runtime",
  });
  await assert.rejects(
    server.captureAssignedCreditexActivityWorkPackSignatures(database, {
      ...futureSignature.workerScope,
      caseInstanceId: prepared.projection.instance.id,
      expectedResponseSha256: prepared.projection.instance.responseSha256,
      packets: [futureSignature.packet],
      idempotency: {
        ...idempotency("capture-future-runtime"),
        deviceId: futureSignature.packet.deviceAttestation.deviceId,
      },
      now: "2026-08-15T00:00:00.000Z",
    }),
    (error) => error?.code === "WORK_PACK_SIGNATURE_TIME_OUT_OF_BOUNDS",
  );
  const preRevisionSignature = await signaturePacket(database, prepared.projection, {
    signedAt: "2026-08-14T23:54:59.000Z",
    clientUploadId: "signature-upload-pre-revision-runtime",
  });
  await assert.rejects(
    server.captureAssignedCreditexActivityWorkPackSignatures(database, {
      ...preRevisionSignature.workerScope,
      caseInstanceId: prepared.projection.instance.id,
      expectedResponseSha256: prepared.projection.instance.responseSha256,
      packets: [preRevisionSignature.packet],
      idempotency: {
        ...idempotency("capture-pre-revision-runtime"),
        deviceId: preRevisionSignature.packet.deviceAttestation.deviceId,
      },
      now: "2026-08-15T00:00:06.000Z",
    }),
    (error) => error?.code === "WORK_PACK_SIGNATURE_TIME_OUT_OF_BOUNDS",
  );
  await assert.rejects(
    server.captureAssignedCreditexActivityWorkPackSignatures(database, {
      ...ownerScope(),
      caseInstanceId: prepared.projection.instance.id,
      expectedResponseSha256: prepared.projection.instance.responseSha256,
      packets: [firstSignature.packet],
      idempotency: captureIdempotency,
      now: "2026-08-15T00:00:06.000Z",
    }),
    (error) => error?.code === "WORK_PACK_ASSIGNED_SIGNER_ACTOR_MISMATCH",
  );
  const forgedPayload = {
    ...firstSignature.packet.signaturePayload,
    strokes: [{ points: [
      { x: 0.2, y: 0.2, pressure: 0.5, capturedAtOffsetMs: 0 },
      { x: 0.9, y: 0.7, pressure: 0.5, capturedAtOffsetMs: 200 },
    ] }],
  };
  await assert.rejects(
    server.captureAssignedCreditexActivityWorkPackSignatures(database, {
      ...firstSignature.workerScope,
      caseInstanceId: prepared.projection.instance.id,
      expectedResponseSha256: prepared.projection.instance.responseSha256,
      packets: [{
        ...firstSignature.packet,
        signaturePayload: forgedPayload,
        signaturePayloadSha256:
          interchangePreflight.creditexCanonicalSha256(forgedPayload),
      }],
      idempotency: { ...captureIdempotency, clientActionId: "capture-forged-runtime" },
      now: "2026-08-15T00:00:06.000Z",
    }),
    (error) => error?.code === "WORK_PACK_SIGNATURE_EXACT_BYTES_REQUIRED",
  );
  const captured = await server.captureAssignedCreditexActivityWorkPackSignatures(
    database,
    {
      ...firstSignature.workerScope,
      caseInstanceId: prepared.projection.instance.id,
      expectedResponseSha256: prepared.projection.instance.responseSha256,
      packets: [firstSignature.packet],
      idempotency: captureIdempotency,
      now: "2026-08-15T00:00:06.000Z",
    },
  );
  assert.equal(captured.projection.signatures.filter(({ action }) =>
    action === "captured"
  ).length, 1);
  assert.deepEqual(
    captured.projection.signatures.map(({ signedAt, capturedAt }) => ({
      signedAt,
      capturedAt,
    })),
    [{
      signedAt: "2026-08-15T00:00:05.000Z",
      capturedAt: "2026-08-15T00:00:06.000Z",
    }],
  );

  sqlite.prepare(`UPDATE trade_work_orders
      SET assignee_member_id = ?, assignee_label = 'Worker Two',
        revision = revision + 1, updated_at = ? WHERE id = ?`)
    .run(MEMBER_TWO_ID, "2026-08-15T00:00:07.000Z", WORK_ORDER_ID);
  const refreshed = await server.refreshAssignedCreditexActivityWorkPackExecutionContext(
    database,
    {
      ...ownerScope(),
      caseInstanceId: captured.projection.instance.id,
      expectedResponseSha256: captured.projection.instance.responseSha256,
      idempotency: idempotency("refresh-runtime"),
      now: "2026-08-15T00:00:08.000Z",
    },
  );
  assert.equal(refreshed.projection.instance.status, "in_progress");
  assert.equal(refreshed.projection.executionContext.assignment.memberUid, WORKER_TWO_UID);
  assert.equal(
    sqlite.prepare(`SELECT COUNT(*) count
        FROM compliance_activity_work_pack_signatures WHERE action = 'revoked'`)
      .get().count,
    1,
  );
  const secondPrepared = await server.prepareAssignedCreditexActivityWorkPackSigning(
    database,
    {
      ...scope({ workerUid: WORKER_TWO_UID, memberId: MEMBER_TWO_ID }),
      caseInstanceId: refreshed.projection.instance.id,
      expectedResponseSha256: refreshed.projection.instance.responseSha256,
      idempotency: idempotency("prepare-reassigned-runtime"),
      now: "2026-08-15T00:00:09.000Z",
    },
  );
  const secondSignature = await signaturePacket(database, secondPrepared.projection, {
    workerUid: WORKER_TWO_UID,
    memberId: MEMBER_TWO_ID,
    signedAt: "2026-08-15T00:00:10.000Z",
    clientUploadId: "signature-upload-reassigned-runtime",
  });
  const secondCaptured = await server.captureAssignedCreditexActivityWorkPackSignatures(
    database,
    {
      ...secondSignature.workerScope,
      caseInstanceId: secondPrepared.projection.instance.id,
      expectedResponseSha256: secondPrepared.projection.instance.responseSha256,
      packets: [secondSignature.packet],
      idempotency: {
        ...idempotency("capture-reassigned-runtime"),
        deviceId: secondSignature.packet.deviceAttestation.deviceId,
      },
      now: "2026-08-15T00:00:11.000Z",
    },
  );
  database.interceptNextBatch(
    (statements) => statements.some(({ sql }) =>
      sql.includes("INSERT INTO")
        && sql.includes("compliance_activity_work_pack_final_records")
    ),
    async () => {
      throw new Error("transient final record batch failure");
    },
  );
  const finaliseInput = {
    ...secondSignature.workerScope,
    caseInstanceId: secondCaptured.projection.instance.id,
    expectedResponseSha256: secondCaptured.projection.instance.responseSha256,
    idempotency: idempotency("finalise-runtime"),
    now: "2026-08-15T00:00:12.000Z",
  };
  await assert.rejects(
    server.finaliseAssignedCreditexActivityWorkPack(database, finaliseInput),
    /transient final record batch failure/,
  );
  assert.equal(bucket.deleted.length, 1);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) count FROM compliance_activity_work_pack_final_records")
      .get().count,
    0,
  );
  const finalised = await server.finaliseAssignedCreditexActivityWorkPack(
    database,
    finaliseInput,
  );
  assert.equal(finalised.projection.instance.status, "completed");
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) count FROM compliance_activity_work_pack_final_records")
      .get().count,
    1,
  );
  const finalObjectKey = sqlite.prepare(`SELECT object_key
      FROM compliance_activity_work_pack_final_records LIMIT 1`)
    .get().object_key;
  const retainedFinal = bucket.records.get(finalObjectKey);
  assert.ok(retainedFinal);
  assert.equal(new TextDecoder().decode(retainedFinal.bytes.slice(0, 4)), "%PDF");

  const preparer = outputActor("governance-author");
  const reviewer = outputActor("governance-reviewer");
  const platformAdmin = outputActor("runtime-platform-owner", "admin");
  const providerRecorder = outputActor("source-capturer");
  const finalIdentity = sqlite.prepare(`SELECT instance.response_sha256 instance_response,
      instance.status instance_status, final_record.response_sha256 final_response,
      final_record.instance_sha256 final_instance,
      pack.publish_state, activity.publish_state activity_publish_state,
      manual.lifecycle_state, policy.publish_state policy_publish_state,
      compliance_case.activity_date
    FROM compliance_activity_work_pack_instances instance
    JOIN compliance_activity_work_pack_final_records final_record
      ON final_record.case_instance_id = instance.id
    JOIN compliance_activity_work_pack_versions pack
      ON pack.id = instance.work_pack_version_id
    JOIN compliance_cases compliance_case
      ON compliance_case.id = instance.compliance_case_id
    JOIN compliance_activity_versions activity
      ON activity.id = compliance_case.activity_version_id
    JOIN compliance_manual_policy_bindings manual
      ON manual.id = pack.manual_policy_binding_id
    JOIN compliance_evidence_policy_versions policy
      ON policy.id = pack.evidence_policy_version_id
    WHERE instance.id = ?`).get(finalised.projection.instance.id);
  assert.equal(finalIdentity.instance_status, "completed");
  assert.equal(finalIdentity.instance_response, finalIdentity.final_instance);
  assert.notEqual(finalIdentity.instance_response, finalIdentity.final_response);
  assert.equal(finalIdentity.publish_state, "published");
  assert.equal(finalIdentity.activity_publish_state, "published");
  assert.equal(finalIdentity.lifecycle_state, "approved");
  assert.equal(finalIdentity.policy_publish_state, "published");
  const readiness = await server.loadCreditexActivityWorkPackOutputReadiness(
    database,
    preparer,
    {
      activityTemplateId: ACTIVITY.templateId,
      caseInstanceId: finalised.projection.instance.id,
    },
  );
  assert.equal(readiness.outputClass, PROGRAM.outcomeClass);
  assert.notEqual(readiness.outputClass, "tradable_certificate");
  assert.equal(readiness.outputActionReady, true, JSON.stringify(readiness.outputActionBlockers));
  assert.equal(
    readiness.operationalOutputDefinition.outputClass,
    PROGRAM.outcomeClass,
  );

  const candidates = await outputActions.listCreditexOutputActionCandidates(
    database,
    preparer,
  );
  const candidate = candidates.find(({ caseInstanceId }) =>
    caseInstanceId === finalised.projection.instance.id
  );
  assert.ok(candidate);
  assert.equal(candidate.ready, true, JSON.stringify(candidate.blockers));
  assert.equal(candidate.actionKind, "operational_output");
  assert.equal(candidate.jobReference, "JOB-RUNTIME");
  assert.equal(candidate.customerLabel, "Customer Runtime");
  assert.equal(candidate.expectedQuantity, "");
  assert.equal(candidate.expectedUnit, "");

  await assert.rejects(
    outputActions.prepareCreditexCertificateAction(database, preparer, {
      idempotencyKey: "certificate-for-non-certificate-runtime",
      activityTemplateId: ACTIVITY.templateId,
      caseInstanceId: finalised.projection.instance.id,
    }),
    (error) => error?.code === "OUTPUT_ACTION_NOT_A_CERTIFICATE_ACTIVITY",
  );
  assert.equal(
    sqlite.prepare(`SELECT COUNT(*) count FROM compliance_output_action_packets
      WHERE action_kind = 'certificate_submission'`).get().count,
    0,
  );

  await assert.rejects(
    outputActions.prepareCreditexOperationalOutputAction(
      database,
      preparer,
      {
        idempotencyKey: "unready-operational-runtime",
        activityTemplateId: ACTIVITY.templateId,
        caseInstanceId: finalised.projection.instance.id,
      },
      {
        resolveCoverage: async () => [{
          ...readiness,
          outputActionReady: false,
          outputActionBlockers: ["runtime_blocker"],
        }],
      },
    ),
    (error) => error?.code === "OUTPUT_ACTION_OPERATIONAL_NOT_READY",
  );

  await assert.rejects(
    outputActions.prepareCreditexOperationalOutputAction(
      database,
      preparer,
      {
        idempotencyKey: "wrong-operational-class-runtime",
        activityTemplateId: ACTIVITY.templateId,
        caseInstanceId: finalised.projection.instance.id,
      },
      {
        resolveCoverage: async () => [{
          ...readiness,
          outputClass: "grant",
          operationalOutputDefinition: {
            ...readiness.operationalOutputDefinition,
            outputClass: "grant",
          },
        }],
      },
    ),
    (error) => error?.code === "OUTPUT_ACTION_OPERATIONAL_CLASS_INVALID",
  );

  const outputPrepared = await outputActions.prepareCreditexOperationalOutputAction(
    database,
    preparer,
    {
      idempotencyKey: "operational-output-runtime",
      activityTemplateId: ACTIVITY.templateId,
      caseInstanceId: finalised.projection.instance.id,
    },
    { now: () => "2026-08-15T00:00:13.000Z" },
  );
  assert.equal(outputPrepared.status, "prepared");
  assert.equal(outputPrepared.action.actionKind, "operational_output");
  assert.equal(outputPrepared.action.outputClass, PROGRAM.outcomeClass);
  assert.equal(outputPrepared.action.status, "prepared");
  assert.equal(outputPrepared.action.quantity, "");
  assert.equal(outputPrepared.action.unit, "");
  assert.equal(
    outputPrepared.action.packet.workPack.instanceSha256,
    finalIdentity.final_instance,
  );
  assert.equal(
    outputPrepared.action.packet.workPack.responseSha256,
    finalIdentity.final_response,
  );
  assert.notEqual(
    outputPrepared.action.packet.workPack.instanceSha256,
    outputPrepared.action.packet.workPack.responseSha256,
  );
  assert.equal(
    outputPrepared.action.packet.operationalOutputDefinition.outputClass,
    PROGRAM.outcomeClass,
  );

  const idempotentReplay = await outputActions
    .prepareCreditexOperationalOutputAction(database, preparer, {
      idempotencyKey: "operational-output-runtime",
      activityTemplateId: ACTIVITY.templateId,
      caseInstanceId: finalised.projection.instance.id,
    });
  assert.equal(idempotentReplay.status, "duplicate");
  assert.equal(idempotentReplay.action.id, outputPrepared.action.id);
  const finalRecordReplay = await outputActions
    .prepareCreditexOperationalOutputAction(database, preparer, {
      idempotencyKey: "operational-output-final-record-replay-runtime",
      activityTemplateId: ACTIVITY.templateId,
      caseInstanceId: finalised.projection.instance.id,
    });
  assert.equal(finalRecordReplay.status, "duplicate");
  assert.equal(finalRecordReplay.action.id, outputPrepared.action.id);
  assert.equal(
    sqlite.prepare(`SELECT COUNT(*) count FROM compliance_output_action_packets
      WHERE action_kind = 'operational_output'`).get().count,
    1,
  );

  await assert.rejects(
    outputActions.reviewCreditexOutputAction(database, preparer, {
      packetId: outputPrepared.action.id,
      expectedPacketSha256: outputPrepared.action.packetSha256,
      decision: "approved",
      comment: "The preparer must not review this packet.",
    }),
    (error) => error?.code === "OUTPUT_ACTION_SELF_REVIEW_BLOCKED",
  );
  const reviewed = await outputActions.reviewCreditexOutputAction(
    database,
    reviewer,
    {
      packetId: outputPrepared.action.id,
      expectedPacketSha256: outputPrepared.action.packetSha256,
      decision: "approved",
      comment: "Independent exact packet review completed.",
    },
    { now: () => "2026-08-15T00:00:14.000Z" },
  );
  assert.equal(reviewed.action.review.decision, "approved");

  const manualSubmission = {
    packetId: outputPrepared.action.id,
    expectedPacketSha256: outputPrepared.action.packetSha256,
    providerName: "Queensland program administrator",
    providerReference: "QLD-RUNTIME-0001",
    submissionMethod: "secure provider portal",
  };
  await assert.rejects(
    outputActions.recordManualCreditexOutputSubmission(
      database,
      platformAdmin,
      { ...manualSubmission, submittedAt: "2026-08-15T00:00:12.000Z" },
      { now: () => "2026-08-15T00:00:15.000Z" },
    ),
    (error) => error?.code === "OUTPUT_ACTION_SUBMITTED_AT_INVALID",
  );
  await assert.rejects(
    outputActions.recordManualCreditexOutputSubmission(
      database,
      platformAdmin,
      { ...manualSubmission, submittedAt: "2026-08-15T00:06:00.000Z" },
      { now: () => "2026-08-15T00:00:15.000Z" },
    ),
    (error) => error?.code === "OUTPUT_ACTION_SUBMITTED_AT_INVALID",
  );
  const submitted = await outputActions.recordManualCreditexOutputSubmission(
    database,
    platformAdmin,
    { ...manualSubmission, submittedAt: "2026-08-15T00:00:16.000Z" },
    { now: () => "2026-08-15T00:00:16.000Z" },
  );
  assert.equal(submitted.action.status, "submitted");
  assert.equal(submitted.action.providerReference, "QLD-RUNTIME-0001");

  const manualOutcome = {
    packetId: outputPrepared.action.id,
    expectedPacketSha256: outputPrepared.action.packetSha256,
    providerStatus: "provider_accepted",
    providerName: "Queensland program administrator",
    providerReference: "QLD-RUNTIME-0001",
    responseCode: "ACCEPTED",
    responseText: "Provider retained and accepted the exact operational output packet.",
  };
  await assert.rejects(
    outputActions.recordManualCreditexOutputProviderOutcome(
      database,
      platformAdmin,
      { ...manualOutcome, occurredAt: "2026-08-15T00:00:17.000Z" },
      { now: () => "2026-08-15T00:00:17.000Z" },
    ),
    (error) =>
      error?.code === "OUTPUT_ACTION_PROVIDER_OUTCOME_REVIEW_SEPARATION_REQUIRED",
  );
  await assert.rejects(
    outputActions.recordManualCreditexOutputProviderOutcome(
      database,
      providerRecorder,
      { ...manualOutcome, occurredAt: "2026-08-15T00:00:15.000Z" },
      { now: () => "2026-08-15T00:00:17.000Z" },
    ),
    (error) => error?.code === "OUTPUT_ACTION_PROVIDER_OCCURRED_AT_INVALID",
  );
  await assert.rejects(
    outputActions.recordManualCreditexOutputProviderOutcome(
      database,
      providerRecorder,
      { ...manualOutcome, occurredAt: "2026-08-15T00:06:30.000Z" },
      { now: () => "2026-08-15T00:00:17.000Z" },
    ),
    (error) => error?.code === "OUTPUT_ACTION_PROVIDER_OCCURRED_AT_INVALID",
  );
  const accepted = await outputActions.recordManualCreditexOutputProviderOutcome(
    database,
    providerRecorder,
    { ...manualOutcome, occurredAt: "2026-08-15T00:00:17.000Z" },
    { now: () => "2026-08-15T00:00:17.000Z" },
  );
  assert.equal(accepted.action.status, "provider_accepted");
  assert.equal(accepted.action.providerReference, "QLD-RUNTIME-0001");
  const receiptSummaries = await outputActions.listCreditexOutputActionReceipts(
    database,
    ORGANISATION_ID,
  );
  const providerReceipt = receiptSummaries.find(({ providerStatus }) =>
    providerStatus === "provider_accepted"
  );
  assert.ok(providerReceipt);
  const exactProviderReceipt = await outputActions.loadCreditexOutputActionReceipt(
    database,
    ORGANISATION_ID,
    providerReceipt.id,
  );
  assert.equal(exactProviderReceipt.packetId, outputPrepared.action.id);
  assert.equal(exactProviderReceipt.providerStatus, "provider_accepted");
  assert.equal(
    exactProviderReceipt.response.responseText,
    manualOutcome.responseText,
  );
  assert.equal(
    interchangePreflight.creditexCanonicalSha256(exactProviderReceipt.response),
    exactProviderReceipt.responseSha256,
  );
  assert.equal(JSON.stringify(exactProviderReceipt).includes("object_key"), false);

  assert.throws(
    () => sqlite.prepare(`UPDATE compliance_output_action_packets
      SET output_code = 'FORGED' WHERE id = ?`).run(outputPrepared.action.id),
    /COMPLIANCE_OUTPUT_ACTION_PACKET_IMMUTABLE/,
  );
  assert.throws(
    () => sqlite.prepare(`UPDATE compliance_output_action_events
      SET summary = 'Forged accepted history.' WHERE packet_id = ? AND sequence = 3`)
      .run(outputPrepared.action.id),
    /COMPLIANCE_OUTPUT_ACTION_EVENT_IMMUTABLE/,
  );
  const adminAudit = sqlite.prepare(`SELECT actor_type, metadata
      FROM compliance_audit_events
      WHERE target_id = ? AND event_type = 'output_action.status_changed'
        AND actor_uid = 'runtime-platform-owner'
      ORDER BY created_at DESC LIMIT 1`).get(outputPrepared.action.id);
  assert.equal(adminAudit.actor_type, "compliance");
  assert.equal(JSON.parse(adminAudit.metadata).identityRealm, "admin");

  const postPrepareCandidates = await outputActions
    .listCreditexOutputActionCandidates(database, preparer);
  const postPrepareCandidate = postPrepareCandidates.find(({ caseInstanceId }) =>
    caseInstanceId === finalised.projection.instance.id
  );
  assert.equal(postPrepareCandidate.ready, false);
  assert.equal(postPrepareCandidate.existingActionId, outputPrepared.action.id);
  assert.equal(postPrepareCandidate.existingStatus, "provider_accepted");
  assert.ok(postPrepareCandidate.blockers.includes("output_action_already_prepared"));

});

test("source-backed not-applicable dependencies reject forged product, scenario and calculator actions", async () => {
  const { database } = await seededRuntime();
  const { projection } = await openAssignedRuntimeWorkPack(database);
  const common = {
    ...scope(),
    caseInstanceId: projection.instance.id,
    expectedResponseSha256: projection.instance.responseSha256,
  };
  await assert.rejects(
    server.selectAssignedCreditexActivityWorkPackOfficialProducts(database, {
      ...common,
      dependencyKey: "product-not-applicable",
      selections: [{
        selectionId: "forged-product-selection",
        snapshotId: "forged-snapshot",
        quantity: 1,
      }],
      idempotency: idempotency("forged-product-runtime"),
      now: "2026-08-15T00:00:02.000Z",
    }),
    (error) => error?.code === "WORK_PACK_PRODUCT_DEPENDENCY_INVALID",
  );
  await assert.rejects(
    server.selectAssignedCreditexActivityWorkPackScenario(database, {
      ...common,
      dependencyKey: "scenario-not-applicable",
      scenarioCode: "FORGED-SCENARIO",
      idempotency: idempotency("forged-scenario-runtime"),
      now: "2026-08-15T00:00:02.000Z",
    }),
    (error) => error?.code === "WORK_PACK_SCENARIO_INVALID",
  );
  await assert.rejects(
    server.runAssignedCreditexActivityWorkPackCalculator(database, {
      ...common,
      dependencyKey: "calculator-not-applicable",
      idempotency: idempotency("forged-calculator-runtime"),
      now: "2026-08-15T00:00:02.000Z",
    }),
    (error) => error?.code === "WORK_PACK_CALCULATOR_DEPENDENCY_INVALID",
  );
});

test("work-pack address corrections persist as manual pending review without stale provider provenance", async () => {
  const { sqlite, database } = await seededRuntime();
  const { projection } = await openAssignedRuntimeWorkPack(database);
  markRuntimeSiteProviderSelected(sqlite);

  const result = await server.updateAssignedCreditexActivityWorkPackCustomerContext(database, {
    ...scope(),
    caseInstanceId: projection.instance.id,
    expectedResponseSha256: projection.instance.responseSha256,
    customerContextBinding: projection.customerContextBinding,
    sitePatch: {
      addressLine1: "2 Corrected Way",
      addressLine2: "Unit 4",
      suburb: "Brisbane",
      state: "QLD",
      postcode: "4000",
    },
    idempotency: idempotency("customer-address-correction-runtime"),
    now: "2026-08-15T00:00:03.000Z",
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(runtimeSiteAddressRecord(sqlite), {
    address_line_1: "2 Corrected Way",
    address_line_2: "Unit 4",
    suburb: "Brisbane",
    address_state: "QLD",
    postcode: "4000",
    address_entry_mode: "manual_pending_review",
    address_provider: "",
    address_provider_reference: "",
    address_formatted: "",
    address_verified_at: "",
  });
});

test("work-pack name and contact corrections retain unchanged site provenance", async () => {
  const { sqlite, database } = await seededRuntime();
  const { projection } = await openAssignedRuntimeWorkPack(database);
  markRuntimeSiteProviderSelected(sqlite);

  const result = await server.updateAssignedCreditexActivityWorkPackCustomerContext(database, {
    ...scope(),
    caseInstanceId: projection.instance.id,
    expectedResponseSha256: projection.instance.responseSha256,
    customerContextBinding: projection.customerContextBinding,
    customerPatch: { firstName: "Corrected" },
    contactPatch: { phone: "0499999999" },
    idempotency: idempotency("customer-contact-correction-runtime"),
    now: "2026-08-15T00:00:03.000Z",
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(runtimeSiteAddressRecord(sqlite), {
    address_line_1: "1 Runtime Way",
    address_line_2: "",
    suburb: "Brisbane",
    address_state: "QLD",
    postcode: "4000",
    address_entry_mode: "provider_selected",
    address_provider: "google-places",
    address_provider_reference: "places/runtime-site",
    address_formatted: "1 Runtime Way, Brisbane QLD 4000, Australia",
    address_verified_at: "2026-08-15T00:00:01.500Z",
  });
});

test("customer, site and contact updates roll back atomically when customer CAS loses", async () => {
  const { sqlite, database } = await seededRuntime();
  const { projection } = await openAssignedRuntimeWorkPack(database);
  database.interceptNextBatch(
    (statements) => statements.some(({ sql }) =>
      sql.includes("UPDATE trade_crm_customers SET first_name")
    ),
    async (_statements, raw) => {
      raw.prepare("UPDATE trade_crm_customers SET updated_at = ? WHERE id = 'customer-runtime'")
        .run("2026-08-15T00:00:02.000Z");
    },
  );
  await assert.rejects(
    server.updateAssignedCreditexActivityWorkPackCustomerContext(database, {
      ...scope(),
      caseInstanceId: projection.instance.id,
      expectedResponseSha256: projection.instance.responseSha256,
      customerContextBinding: projection.customerContextBinding,
      customerPatch: { firstName: "Corrected" },
      sitePatch: { addressLine1: "2 Corrected Way" },
      contactPatch: { phone: "0499999999" },
      idempotency: idempotency("customer-cas-runtime"),
      now: "2026-08-15T00:00:03.000Z",
    }),
    /NOT NULL constraint failed: trade_work_orders.revision/,
  );
  assert.equal(
    sqlite.prepare("SELECT first_name FROM trade_crm_customers WHERE id = 'customer-runtime'")
      .get().first_name,
    "Customer",
  );
  assert.equal(
    sqlite.prepare("SELECT address_line_1 FROM trade_crm_service_sites WHERE id = 'site-runtime'")
      .get().address_line_1,
    "1 Runtime Way",
  );
  assert.equal(
    sqlite.prepare("SELECT phone FROM trade_crm_customer_contacts WHERE id = 'contact-runtime'")
      .get().phone,
    "0433333333",
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) count FROM compliance_activity_work_pack_instances")
      .get().count,
    1,
  );
});

test("guided work-pack reconciliation reports hard governance blockers without a case or certificate", async () => {
  const { sqlite, database } = runtimeDatabase();
  seedOperationalRecords(sqlite);
  await installSchemaGuards(database);
  const [blocked] = await complianceServer.reconcileReadyPlannedComplianceWorkPacks(
    database,
    {
      workOrderId: WORK_ORDER_ID,
      installerUid: OWNER_UID,
      actorUid: OWNER_UID,
      createdAt: REVISION_TIME,
    },
  );
  assert.equal(blocked.workPackReady, false);
  assert.ok(blocked.blockers.some(({ code }) =>
    code === "published_effective_activity_version_required"
  ));
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM compliance_cases").get().count, 0);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) count FROM compliance_certificate_lots")
      .get().count,
    0,
  );
});

function sresActivationRuntime() {
  const runtime = runtimeDatabase();
  seedOperationalRecords(runtime.sqlite);
  return runtime;
}
function seedSresActivationRuntime(sqlite) {
  const organisationId = sqlite.prepare(`SELECT id
      FROM compliance_organisations WHERE organisation_code = 'CREDITEX-AU'`)
    .get().id;
  const sourceSha256 = "a".repeat(64);
  const otherSourceSha256 = "b".repeat(64);
  const sourceObjectKey = "creditex/sres/current-source.pdf";
  const recordedAt = "2026-08-15T00:00:00.000Z";
  const definitionSha256 = `sha256:${"1".repeat(64)}`;
  const responseSha256 = `sha256:${"2".repeat(64)}`;
  const schemaSnapshot = JSON.stringify({
    contract: "creditex-activity-work-pack/v1",
    activityTemplateId: "sres-pv-small-generation-unit",
    version: 1,
    effectiveFrom: "2026-01-01",
    effectiveTo: "",
    stages: [{}],
    signerRoles: [],
    dependencies: [],
    sections: [{}],
  });
  const responseSnapshot = JSON.stringify({
    contract: "creditex-activity-work-pack-instance/v1",
    prefill: {
      contract: "creditex-activity-work-pack-prefill/v1",
      customerContext: {
        contract: "creditex-activity-work-pack-customer-context/v1",
        editable: false,
        contextSha256: `sha256:${"3".repeat(64)}`,
        customerId: "",
        siteId: "",
        contactId: "",
        customerRevision: "",
        siteRevision: "",
        contactRevision: "",
      },
    },
    response: {
      contract: "creditex-activity-work-pack-response/v1",
      answers: {},
      repeatableSections: {},
      dependencyResolutions: {},
      schemaSha256: definitionSha256,
    },
    declarations: {},
    finalisation: null,
    compositionLockId: "",
    compositionSha256: "",
    definitionSha256,
    prefillSha256: `sha256:${"4".repeat(64)}`,
    responseSha256,
    declarationsSha256: `sha256:${"5".repeat(64)}`,
  });
  for (const user of [
    ["sres-author", "admin", "SRES Author", "sres-reviewer"],
    ["sres-reviewer", "reviewer", "SRES Reviewer", "sres-author"],
  ]) {
    sqlite.prepare(`INSERT INTO compliance_users (
        id, organisation_id, firebase_uid, email, status, role, display_name,
        created_by_uid, created_at, updated_at, governance_identity_verified,
        governance_identity_verified_by_uid, governance_identity_verified_at,
        governance_identity_verification_basis
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, 'runtime-bootstrap', ?, ?, 1, ?, ?,
        'Bounded SRES activation runtime fixture')`)
      .run(
        `member:${user[0]}`,
        organisationId,
        user[0],
        `${user[0]}@example.test`,
        user[1],
        user[2],
        recordedAt,
        recordedAt,
        user[3],
        recordedAt,
      );
  }
  sqlite.prepare(`INSERT INTO compliance_programs
      (id, organisation_id, program_code, name, scheme_kind, jurisdiction,
      administering_body, official_source_url, official_source_title,
      official_source_checked_at, created_by_uid, created_at, updated_at)
    VALUES ('sres-program', ?, 'SRES', 'Small-scale Renewable Energy Scheme',
      'tradable_certificate', 'AU', 'Clean Energy Regulator',
      'https://cer.gov.au/sres', 'Current official SRES source', ?,
      'sres-author', ?, ?)`)
    .run(organisationId, recordedAt, recordedAt, recordedAt);
  sqlite.prepare(`INSERT INTO compliance_activity_versions (
      id, program_id, activity_key, version, title, service_category,
      registry_activity_code, product_category, scenario, jurisdiction,
      effective_from, official_source_url, official_source_title,
      official_source_checked_at, created_by_uid, created_at, updated_at
    ) VALUES ('sres-activity-version', 'sres-program', 'pv', 1,
      'Small generation unit', 'solar', 'PV', 'Solar PV',
      'Small generation unit installation', 'AU', '2026-01-01',
      'https://cer.gov.au/sres', 'Current official SRES source', ?,
      'sres-author', ?, ?)`)
    .run(recordedAt, recordedAt, recordedAt);
  sqlite.prepare(`INSERT INTO compliance_activity_work_pack_versions (
      id, organisation_id, activity_version_id, activity_template_id,
      manual_policy_binding_id, manual_policy_binding_version,
      manual_policy_binding_sha256, evidence_policy_version_id,
      evidence_policy_version, evidence_policy_source_sha256, version,
      contract, title, schema_snapshot, schema_sha256, effective_from,
      authored_by_uid, authored_at, updated_by_uid, updated_at, created_at
    ) VALUES ('sres-work-pack-version', ?, 'sres-activity-version',
      'sres-pv-small-generation-unit', 'sres-manual-policy', 1, ?,
      'sres-evidence-policy', 1, ?, 1, 'creditex-activity-work-pack/v1',
      'SRES PV work pack', ?, ?, '2026-01-01', 'sres-author', ?,
      'sres-author', ?, ?)`)
    .run(
      organisationId,
      "6".repeat(64),
      "7".repeat(64),
      schemaSnapshot,
      definitionSha256,
      recordedAt,
      recordedAt,
      recordedAt,
    );
  const sresIntent = tradeComplianceIntent.resolveTradeComplianceIntent({
    mode: "planned",
    programTemplateId: "au-sres",
    activityTemplateId: "sres-pv",
    siteJurisdiction: "QLD",
    plannedStart: "2026-08-15T09:00:00.000Z",
  }).snapshot;
  const sresIntentJson =
    tradeComplianceIntent.stableTradeComplianceIntentJson(sresIntent);
  sqlite.prepare(`INSERT INTO trade_work_order_compliance_intents (
      id, work_order_id, installer_uid, compliance_organisation_id,
      program_template_id, activity_template_id, program_code,
      registry_activity_code, service_category, site_jurisdiction,
      planned_start, catalogue_reviewed_on, intent_snapshot,
      intent_snapshot_sha256, status, compliance_case_id, revision,
      created_by_uid, created_at, updated_at, intent_key
    ) VALUES ('sres-intent-runtime', ?, ?, ?, 'au-sres', 'sres-pv', 'SRES',
      'PV', 'solar', 'QLD', '2026-08-15T09:00:00.000Z', ?, ?, ?, 'planned',
      '', 1, ?, ?, ?, 'program:au-sres:activity:sres-pv')`)
    .run(
      WORK_ORDER_ID,
      OWNER_UID,
      organisationId,
      governmentCatalogue.GOVERNMENT_CATALOGUE_REVIEWED_ON,
      sresIntentJson,
      sha256(Buffer.from(sresIntentJson)),
      OWNER_UID,
      recordedAt,
      recordedAt,
    );
  sqlite.prepare(`INSERT INTO compliance_cases
      (id, case_number, organisation_id, program_id, work_order_id,
      installer_uid, activity_version_id, activity_date, site_jurisdiction,
      activity_snapshot, created_by_type, created_by_uid, created_at,
      updated_at, compliance_intent_id)
    VALUES ('sres-case', 'SRES-RUNTIME-1', ?, 'sres-program',
      ?, ?, 'sres-activity-version',
      '2026-08-15', 'QLD', '{}', 'compliance', 'sres-author', ?, ?,
      'sres-intent-runtime')`)
    .run(organisationId, WORK_ORDER_ID, OWNER_UID, recordedAt, recordedAt);
  sqlite.prepare(`INSERT INTO compliance_activity_work_pack_instances (
      id, organisation_id, compliance_case_id, work_pack_version_id,
      work_order_id, activity_date, instance_key, revision, response_snapshot,
      response_sha256, created_by_uid, created_at
    ) VALUES ('sres-instance', ?, 'sres-case', 'sres-work-pack-version',
      ?, '2026-08-15', 'sres-instance-key', 1, ?, ?,
      'sres-author', ?)`)
    .run(
      organisationId,
      WORK_ORDER_ID,
      responseSnapshot,
      responseSha256,
      recordedAt,
    );
  for (const source of [
    ["sres-source", sourceSha256, sourceObjectKey, "sres-source-review"],
    ["sres-other-source", otherSourceSha256,
      "creditex/sres/other-source.pdf", "sres-other-source-review"],
  ]) {
    sqlite.prepare(`INSERT INTO compliance_official_source_artifacts (
        id, organisation_id, client_request_id, source_url, source_host,
        source_title, source_version, original_file_name, content_type,
        size_bytes, sha256, object_key, asserted_retrieved_at, captured_by_uid,
        captured_at
      ) VALUES (?, ?, ?, 'https://cer.gov.au/sres', 'cer.gov.au',
        'Current official SRES source', '2026-08-15', 'sres-source.pdf',
        'application/pdf', 1, ?, ?, ?, 'sres-author', ?)`)
      .run(
        source[0],
        organisationId,
        `capture:${source[0]}`,
        source[1],
        source[2],
        recordedAt,
        recordedAt,
      );
    sqlite.prepare(`INSERT INTO compliance_official_source_review_decisions (
        id, organisation_id, subject_type, subject_id, artifact_id,
        artifact_sha256, artifact_object_key, decision, review_note,
        reviewed_by_uid, reviewed_at, supersedes_decision_id
      ) VALUES (?, ?, 'artifact', ?, ?, ?, ?, 'approved',
        'Exact official SRES source independently reviewed.',
        'sres-reviewer', ?, '')`)
      .run(
        source[3],
        organisationId,
        source[0],
        source[0],
        source[1],
        source[2],
        recordedAt,
      );
  }
  sqlite.prepare(`INSERT INTO compliance_equipment_records (
      id, organisation_id, case_id, record_type, status, product_registry,
      product_reference, quantity, evidence_snapshot, recorded_by_uid,
      recorded_at, created_at, updated_at
    ) VALUES ('sres-equipment', ?, 'sres-case', 'installed', 'installed',
      'cer_sres_pv', 'CER-PV-123', 1, ?, 'sres-author', ?, ?, ?)`)
    .run(
      organisationId,
      JSON.stringify({
        contract: "creditex-work-pack-official-product-selection/v2",
        sourceSha256: `sha256:${sourceSha256}`,
      }),
      recordedAt,
      recordedAt,
      recordedAt,
    );
  for (const participant of [
    ["sres-agent", "agent", "Creditex Pty Ltd", "REC-AGENT-1"],
    ["sres-installer", "installer", "SRES Installer", "ACC-INSTALLER-1"],
    ["sres-wrong-agent", "retailer", "Wrong Participant", "WRONG-1"],
  ]) {
    sqlite.prepare(`INSERT INTO compliance_participants (
        id, organisation_id, participant_type, legal_name,
        external_reference, status, created_by_uid, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', 'sres-author', ?, ?)`)
      .run(
        participant[0],
        organisationId,
        ...participant.slice(1),
        recordedAt,
        recordedAt,
      );
  }
  for (const ability of [
    ["sres-agent-ability", "sres-agent", "sres_registered_agent", "agent"],
    ["sres-installer-ability", "sres-installer",
      "sres_installer_accreditation", "installer"],
    ["sres-designer-ability", "sres-installer",
      "sres_designer_accreditation", "designer"],
    ["sres-wrong-agent-ability", "sres-wrong-agent",
      "sres_registered_agent", "agent"],
  ]) {
    sqlite.prepare(`INSERT INTO compliance_participant_abilities (
        id, organisation_id, participant_id, activity_version_id,
        ability_code, ability_role, status, effective_from, effective_to,
        evidence_snapshot, approved_by_uid, approved_at, created_by_uid,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'sres-activity-version', ?, ?, 'active',
        '2026-01-01', '2026-12-31', ?, 'sres-reviewer', ?, 'sres-author', ?, ?)`)
      .run(
        ability[0],
        organisationId,
        ability[1],
        ability[2],
        ability[3],
        JSON.stringify({ sourceSha256: `sha256:${sourceSha256}` }),
        recordedAt,
        recordedAt,
        recordedAt,
      );
  }
  sqlite.prepare(`INSERT INTO compliance_calculator_versions (
      id, organisation_id, activity_version_id, calculator_key, version,
      title, output_type, specification, rounding_policy, official_source_url,
      official_source_version, approval_state, primary_approver_uid,
      secondary_approver_uid, approved_at, official_source_sha256, created_by_uid,
      created_at, updated_at
    ) VALUES ('sres-calculator', ?, 'sres-activity-version', 'sres_stc', 1,
      'Exact SRES STC calculator', 'STC', '{}', '{}',
      'https://cer.gov.au/sres', '2026-08-15', 'approved',
      'calculator-author', 'calculator-reviewer', ?, ?, 'calculator-author', ?, ?)`)
    .run(organisationId, recordedAt, sourceSha256, recordedAt, recordedAt);
  sqlite.prepare(`INSERT INTO compliance_calculator_engine_receipts (
      id, organisation_id, calculator_version_id, calculator_version_number,
      engine_contract_id, engine_contract_hash,
      golden_vector_suite_sha256, engine_suite_hash, suite_receipt_hash,
      suite_receipt_schema, vector_count, executed_by_uid, executed_at, result,
      created_at
    ) VALUES ('sres-engine-receipt', ?, 'sres-calculator', 1,
      'creditex-fixed-decimal-engine-contract/base10-strings-v2', ?, ?, ?, ?,
      'creditex-calculator-suite-receipt/v2', 3,
      'calculator-runner', ?, 'passed', ?)`)
    .run(
      organisationId,
      `sha256:${"c".repeat(64)}`,
      "d".repeat(64),
      `sha256:${"e".repeat(64)}`,
      `sha256:${"f".repeat(64)}`,
      recordedAt,
      recordedAt,
    );
  return { organisationId, sourceSha256, sourceObjectKey };
}

function sresActivationActor(organisationId, actorUid) {
  return { organisationId, actorUid, actorKind: "compliance" };
}

test("SRES activation binds eight current reviewed gates and invalidates stale source state", async () => {
  const { sqlite, database } = sresActivationRuntime();
  const { organisationId, sourceSha256, sourceObjectKey } =
    seedSresActivationRuntime(sqlite);
  const author = sresActivationActor(organisationId, "sres-author");
  const reviewer = sresActivationActor(organisationId, "sres-reviewer");
  let identifierSequence = 0;
  const options = (timestamp) => ({
    now: () => timestamp,
    id: (scopeKey) => `${scopeKey}:${String(++identifierSequence).padStart(3, "0")}`,
  });
  const scopeInput = {
    activityTemplateId: "sres-pv-small-generation-unit",
    caseId: "sres-case",
  };
  const details = {
    rec_registry_submission_contract: {
      submissionMethod: "manual",
      providerName: "Clean Energy Regulator",
      schemaVersion: "2026-08-15",
      contractSha256: `sha256:${sourceSha256}`,
    },
    declaration_snapshot: {
      declarationVersion: "2026-08-15",
      declarationDocumentSha256: `sha256:${sourceSha256}`,
    },
    component_recall_status: { providerReference: "CER-RECALL-20260815" },
    calculator_vector_suite: { engineReceiptId: "sres-engine-receipt" },
    registered_agent_assignment: {
      participantAbilityId: "sres-agent-ability",
      assignmentReference: "CREDITEX-SRES-CASE-1",
    },
    component_eligibility: {},
    installer_accreditation: {
      participantAbilityId: "sres-installer-ability",
    },
    designer_accreditation: {
      participantAbilityId: "sres-designer-ability",
    },
  };

  await assert.rejects(
    sresActivation.recordCreditexSresActivationEvidence(database, author, {
      clientRequestId: "sres-mismatch-source-request",
      ...scopeInput,
      evidenceKind: "calculator_vector_suite",
      subjectKey: "job:calculator_vector_suite",
      sourceArtifactId: "sres-other-source",
      sourceRecordKey: "Golden vector suite",
      details: details.calculator_vector_suite,
    }, options("2026-08-15T01:00:00.000Z")),
    (error) => error?.code === "SRES_ACTIVATION_CALCULATOR_SOURCE_MISMATCH",
  );
  await assert.rejects(
    sresActivation.recordCreditexSresActivationEvidence(database, author, {
      clientRequestId: "sres-wrong-role-request",
      ...scopeInput,
      evidenceKind: "registered_agent_assignment",
      subjectKey: "job:registered_agent_assignment",
      sourceArtifactId: "sres-source",
      sourceRecordKey: "Registered agent assignment",
      details: {
        participantAbilityId: "sres-wrong-agent-ability",
        assignmentReference: "CREDITEX-SRES-CASE-1",
      },
    }, options("2026-08-15T01:00:00.000Z")),
    (error) => error?.code === "SRES_ACTIVATION_ABILITY_NOT_ACTIVE",
  );

  const records = [];
  for (const evidenceKind of sresActivation.CREDITEX_SRES_ACTIVATION_EVIDENCE_KINDS) {
    const saved = await sresActivation.recordCreditexSresActivationEvidence(
      database,
      author,
      {
        clientRequestId: `sres-record-request:${evidenceKind}`,
        ...scopeInput,
        evidenceKind,
        subjectKey: `job:${evidenceKind}`,
        sourceArtifactId: "sres-source",
        sourceRecordKey: `Official source record for ${evidenceKind}`,
        details: details[evidenceKind],
      },
      options("2026-08-15T01:00:00.000Z"),
    );
    records.push(saved);
  }
  await assert.rejects(
    sresActivation.reviewCreditexSresActivationEvidence(database, author, {
      recordId: records[0].recordId,
      decision: "approved",
      reviewNote: "Author must not review their own evidence.",
    }, options("2026-08-15T01:01:00.000Z")),
    (error) => error?.code === "SRES_ACTIVATION_SELF_REVIEW_FORBIDDEN",
  );
  await assert.rejects(
    sresActivation.freezeCreditexSresActivationSnapshot(database, author, {
      clientRequestId: "sres-freeze-before-review",
      ...scopeInput,
    }, options("2026-08-15T01:01:00.000Z")),
    (error) => error?.code === "SRES_ACTIVATION_INCOMPLETE",
  );
  await sresActivation.reviewCreditexSresActivationEvidence(
    database,
    reviewer,
    {
      recordId: records[0].recordId,
      decision: "rejected",
      reviewNote: "The retained REC submission contract requires replacement.",
    },
    options("2026-08-15T01:01:00.000Z"),
  );
  for (const record of records.slice(1)) {
    await sresActivation.reviewCreditexSresActivationEvidence(
      database,
      reviewer,
      {
        recordId: record.recordId,
        decision: "approved",
        reviewNote: "Exact source, response hash and current scope independently checked.",
      },
      options("2026-08-15T01:01:00.000Z"),
    );
  }
  const rejectedState = await sresActivation.loadCreditexSresActivationState(
    database,
    author,
    scopeInput,
    options("2026-08-15T01:01:30.000Z"),
  );
  assert.equal(rejectedState.gates[0].status, "rejected");
  const replacementInput = {
    clientRequestId: "sres-record-replacement-request",
    ...scopeInput,
    evidenceKind: "rec_registry_submission_contract",
    subjectKey: "job:rec_registry_submission_contract",
    sourceArtifactId: "sres-source",
    sourceRecordKey: "Official source record for rec_registry_submission_contract",
    details: details.rec_registry_submission_contract,
    supersedesRecordId: records[0].recordId,
  };
  assert.deepEqual(
    { ...sqlite.prepare(`SELECT activity_template_id, case_id, evidence_kind,
        subject_key
      FROM compliance_sres_activation_records WHERE id = ?`)
      .get(records[0].recordId) },
    {
      activity_template_id: "sres-pv-small-generation-unit",
      case_id: "",
      evidence_kind: "rec_registry_submission_contract",
      subject_key: "job:rec_registry_submission_contract",
    },
  );
  const replacement = await sresActivation.recordCreditexSresActivationEvidence(
    database,
    author,
    replacementInput,
    options("2026-08-15T01:01:40.000Z"),
  );
  const replacementReplay = await sresActivation.recordCreditexSresActivationEvidence(
    database,
    author,
    replacementInput,
    options("2026-08-15T01:01:40.000Z"),
  );
  assert.equal(replacementReplay.recordId, replacement.recordId);
  await sresActivation.reviewCreditexSresActivationEvidence(
    database,
    reviewer,
    {
      recordId: replacement.recordId,
      decision: "approved",
      reviewNote: "Replacement submission contract independently checked and approved.",
    },
    options("2026-08-15T01:01:50.000Z"),
  );
  const frozen = await sresActivation.freezeCreditexSresActivationSnapshot(
    database,
    author,
    {
      clientRequestId: "sres-freeze-reviewed-request",
      ...scopeInput,
    },
    options("2026-08-15T01:02:00.000Z"),
  );
  const ready = await sresActivation.loadCreditexSresActivationState(
    database,
    author,
    scopeInput,
    options("2026-08-15T01:03:00.000Z"),
  );
  assert.equal(ready.ready, true);
  assert.equal(ready.gates.filter((gate) => gate.status === "approved").length, 8);
  assert.equal(ready.snapshotSha256, frozen.snapshotSha256);
  assert.equal(
    installedWorkPackGuardCount(sqlite),
    workPackSchemaGuards.CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.length,
  );
  assert.throws(() => sqlite.prepare(`UPDATE compliance_activity_work_pack_versions
      SET activity_version_id = 'forged-activity-version'
      WHERE id = 'sres-work-pack-version'`).run(),
  /COMPLIANCE_WORK_PACK_ACTIVITY_VERSION_REQUIRED/);

  sqlite.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, decision, review_note,
      reviewed_by_uid, reviewed_at, supersedes_decision_id
    ) VALUES ('sres-source-withdrawal', ?, 'artifact', 'sres-source',
      'sres-source', ?, ?, 'withdrawn',
      'The previously approved source is no longer current.',
      'sres-reviewer', ?, 'sres-source-review')`)
    .run(
      organisationId,
      sourceSha256,
      sourceObjectKey,
      "2026-08-15T01:04:30.000Z",
    );
  const stale = await sresActivation.loadCreditexSresActivationState(
    database,
    author,
    scopeInput,
    options("2026-08-15T01:05:00.000Z"),
  );
  assert.equal(stale.ready, false);
  assert.throws(() => sqlite.prepare(`UPDATE compliance_sres_activation_snapshots
      SET created_at = created_at WHERE id = ?`).run(frozen.snapshot.snapshotId),
  /COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_IMMUTABLE/);
});
