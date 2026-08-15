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
import * as currentContent from "../src/data/creditex-current-work-pack-content.ts";
import * as sourcedDraft from "../src/lib/creditex-work-pack-content-draft.ts";

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
    "../data/creditex-current-work-pack-content.ts": currentContent,
    "./creditex-work-pack-content-draft.ts": sourcedDraft,
    "./creditex-work-pack-schema-guards.ts": {
      async ensureCreditexWorkPackSchemaGuards() {},
    },
    "./creditex-sres-certificate-activation-server.ts": {
      loadCreditexSresActivationState() {
        throw new Error("SRES activation is outside sourced-draft authoring.");
      },
    },
    "./creditex-custody-bucket.ts": {
      getCreditexCustodyBucket() {
        throw new Error("Custody bytes are outside sourced-draft authoring.");
      },
    },
    "./jpeg-exif-verifier.ts": { verifyJpegExif() {} },
    "./creditex-activity-work-pack-pdf-renderer.ts": {
      renderCreditexActivityWorkPackPdf() {
        throw new Error("PDF rendering is outside sourced-draft authoring.");
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

const VEU_CANDIDATES = currentContent.CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES
  .filter((candidate) =>
    candidate.sourceCatalogue === "VEU"
      && candidate.draftCreationState === "source_bound_guided_capture"
  );
const NSW_CANDIDATES = currentContent.CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES
  .filter((candidate) =>
    candidate.sourceCatalogue === "NSW_CERTIFICATE"
      && candidate.draftCreationState === "source_backed_review_draft"
  );
const CANDIDATE = VEU_CANDIDATES[0];
const ACTIVITY = governmentCatalogue.GOVERNMENT_ACTIVITY_TEMPLATES.find(
  (activity) => activity.templateId === CANDIDATE.templateId,
);
const PROGRAM = governmentCatalogue.GOVERNMENT_PROGRAM_TEMPLATES.find(
  (program) => program.programCode === ACTIVITY.programCode,
);
const NSW_CANDIDATE = NSW_CANDIDATES[0];
const NSW_ACTIVITY = governmentCatalogue.GOVERNMENT_ACTIVITY_TEMPLATES.find(
  (activity) => activity.templateId === NSW_CANDIDATE.templateId,
);
const NSW_PROGRAM = governmentCatalogue.GOVERNMENT_PROGRAM_TEMPLATES.find(
  (program) => program.programCode === NSW_ACTIVITY.programCode,
);
const ACTOR = Object.freeze({
  actorUid: "admin-author",
  actorKind: "admin",
  organisationId: "org-creditex",
});

function sourcedDraftDatabase({
  candidate = CANDIDATE,
  activity = ACTIVITY,
  program = PROGRAM,
  effectiveFrom = "2026-01-01",
} = {}) {
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
      email text NOT NULL,
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
      publish_state text NOT NULL
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
      jurisdiction text NOT NULL,
      effective_from text NOT NULL,
      effective_to text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      version integer NOT NULL,
      official_source_sha256 text NOT NULL,
      requirements_complete integer NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      policy_version_id text NOT NULL,
      requirement_code text NOT NULL
    );
    CREATE TABLE compliance_manual_policy_bindings (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_template_id text NOT NULL,
      activity_version_id text NOT NULL,
      evidence_policy_version_id text NOT NULL,
      version integer NOT NULL,
      binding_snapshot_sha256 text NOT NULL,
      lifecycle_state text NOT NULL
    );
    CREATE TABLE compliance_official_source_artifacts (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      client_request_id text NOT NULL,
      source_url text NOT NULL,
      source_title text NOT NULL,
      source_version text NOT NULL,
      sha256 text NOT NULL,
      object_key text NOT NULL,
      content_type text NOT NULL DEFAULT 'application/pdf',
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
      reviewed_at text NOT NULL,
      supersedes_decision_id text NOT NULL DEFAULT ''
    );
  `);
  database.exec(read("../drizzle/0142_creditex_activity_work_packs.sql"));
  database.prepare(`INSERT INTO compliance_organisations
    (id, organisation_code, status) VALUES (?, 'CREDITEX-AU', 'active')`)
    .run(ACTOR.organisationId);
  database.exec(`
    INSERT INTO admin_users (firebase_uid, display_name, role, status)
    VALUES
      ('admin-author', 'Named Author', 'owner', 'active'),
      ('admin-reviewer', 'Named Reviewer', 'reviewer', 'active');
  `);
  database.prepare(`INSERT INTO compliance_programs
    (id, organisation_id, program_code, publish_state)
    VALUES ('program-current', ?, ?, 'published')`)
    .run(ACTOR.organisationId, program.programCode);
  database.prepare(`INSERT INTO compliance_activity_versions (
      id, program_id, activity_key, version, title, service_category,
      registry_activity_code, specification_part, product_category,
      scenario_code, jurisdiction, effective_from, effective_to, publish_state
    ) VALUES (
      'activity-current', 'program-current', ?, 1, ?, ?, ?, ?, ?, ?, ?,
      ?, '', 'published'
    )`).run(
      activity.activityKey,
      activity.title,
      activity.serviceCategory,
      activity.registryActivityCode || "",
      activity.specificationPart || "",
      activity.productCategory,
      activity.scenarioCode || "",
      program.jurisdiction,
      effectiveFrom,
    );
  const exactSource = candidate.sources[0];
  database.prepare(`INSERT INTO compliance_official_source_artifacts (
      id, organisation_id, client_request_id, source_url, source_title,
      source_version, sha256, object_key, captured_at
    ) VALUES (
      'artifact-exact', ?, ?, ?, ?, ?, ?, 'source/exact.pdf',
      '2026-08-15T00:00:00.000Z'
    )`).run(
      ACTOR.organisationId,
      `official-source-import:2026-08-15:${exactSource.sourceId}`,
      exactSource.officialUrl,
      exactSource.title,
      exactSource.version,
      exactSource.expectedSha256,
    );
  database.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, decision, reviewed_at
    ) VALUES (
      'artifact-review', ?, 'artifact', 'artifact-exact', 'artifact-exact',
      ?, 'source/exact.pdf', 'approved', '2026-08-15T00:10:00.000Z'
    )`).run(ACTOR.organisationId, exactSource.expectedSha256);
  return database;
}

test("all 57 current VEU and exact-form NSW candidates map every exact source to a deterministic workflow target", () => {
  assert.equal(VEU_CANDIDATES.length, 31);
  assert.equal(NSW_CANDIDATES.length, 26);
  for (const candidate of [...VEU_CANDIDATES, ...NSW_CANDIDATES]) {
    const workPack = sourcedDraft.createCreditexSourcedWorkPackDraft({
      candidate,
      version: 1,
      effectiveFrom: candidate.sourceCatalogue === "NSW_CERTIFICATE"
        ? "2026-07-01"
        : "2026-01-01",
      effectiveTo: "",
      catalogueReviewedOn: "2026-08-15",
    });
    const bindings = sourcedDraft.creditexSourcedWorkPackSourceBindings(
      candidate,
      workPack,
    );
    const targetKeys = new Set([
      "work_pack",
      ...workPack.sections.map((section) => section.sectionKey),
      ...workPack.sections.flatMap((section) =>
        section.prompts.map((prompt) => prompt.promptKey)
      ),
      ...workPack.sections.flatMap((section) =>
        section.prompts.flatMap((prompt) => prompt.referenceDocument
          ? [prompt.referenceDocument.sourceBindingTargetKey]
          : [])
      ),
      ...workPack.dependencies.map((dependency) => dependency.dependencyKey),
    ]);
    assert.ok(bindings.length >= candidate.sources.length);
    assert.ok(bindings.every((binding) =>
      /^source-[0-9a-f]{20}$/.test(binding.sourceId)
        && /^[0-9a-f]{64}$/.test(binding.expectedSha256)
        && targetKeys.has(binding.targetKey)
        && (binding.sourceRole === "requirement"
          || workPack.dependencies.some((dependency) =>
            dependency.kind === binding.sourceRole
              && dependency.dependencyKey === binding.targetKey
          ))
        && candidate.sources.concat(candidate.referenceDocuments)
          .concat(candidate.prompts.map((prompt) => prompt.source))
          .concat(candidate.evidenceRequirements.map((item) => item.source))
          .concat(candidate.productNeeds.map((item) => item.source))
          .concat([candidate.scenarioNeed.source])
          .concat(candidate.calculatorNeeds.map((item) => item.source))
          .some((source) => source.sourceId === binding.sourceId)
    ));
  }
  assert.ok(NSW_CANDIDATES.every((candidate) =>
    candidate.candidateOnly
      && candidate.guidedCaptureState === "source_backed_review_candidate"
      && candidate.activationReady === false
  ));
  assert.equal(currentContent.CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES
    .filter((candidate) =>
      candidate.sourceCatalogue === "NSW_CERTIFICATE"
        && candidate.draftCreationState === "not_available"
    ).length, 22);
});

test("server persists one immutable-provenance draft, replays its request and enforces schema CAS", async () => {
  const database = sourcedDraftDatabase();
  const d1 = testD1(database);
  const created = await server.createCreditexSourcedWorkPackDraft(
    d1,
    ACTOR,
    {
      activityVersionId: "activity-current",
      clientRequestId: "forms-sourced-draft:test-request-1",
    },
    {
      now: "2026-08-15T01:00:00.000Z",
      idFactory: () => "source-candidate-1",
    },
  );
  assert.equal(created.replayed, false);
  const row = database.prepare(`SELECT *
    FROM compliance_activity_work_pack_versions WHERE id = ?`).get(
      created.savedVersionId,
    );
  assert.equal(row.origin_kind, "source_candidate");
  assert.equal(row.publish_state, "draft");
  assert.equal(row.manual_policy_binding_id, "");
  assert.equal(row.evidence_policy_version_id, "");
  assert.equal(row.source_candidate_sha256, created.sourceCandidateSha256);
  assert.equal(row.source_binding_map_sha256, created.sourceBindingMapSha256);
  assert.deepEqual(
    JSON.parse(row.candidate_blockers_snapshot),
    CANDIDATE.blockers,
  );
  const sourceMap = JSON.parse(row.source_binding_map_snapshot);
  assert.ok(sourceMap.some((binding) =>
    binding.sourceId === CANDIDATE.sources[0].sourceId
      && binding.artifactId === "artifact-exact"
      && binding.exactArtifactMatch
      && binding.artifactReviewState === "approved"
  ));

  const replayed = await server.createCreditexSourcedWorkPackDraft(
    d1,
    ACTOR,
    {
      activityVersionId: "activity-current",
      clientRequestId: "forms-sourced-draft:test-request-1",
    },
    { now: "2026-08-15T01:01:00.000Z" },
  );
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.savedVersionId, created.savedVersionId);
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM compliance_activity_work_pack_versions`).get().count, 1);

  const editedSchema = {
    ...JSON.parse(row.schema_snapshot),
    title: "Edited current VEU guided workflow",
  };
  const updated = await server.updateCreditexWorkPackDraft(
    d1,
    ACTOR,
    {
      id: created.savedVersionId,
      expectedSchemaSha256: created.schemaSha256,
      schema: editedSchema,
      effectiveFrom: editedSchema.effectiveFrom,
      effectiveTo: editedSchema.effectiveTo,
    },
    { now: "2026-08-15T01:02:00.000Z" },
  );
  assert.notEqual(updated.schemaSha256, created.schemaSha256);
  await assert.rejects(
    server.updateCreditexWorkPackDraft(
      d1,
      ACTOR,
      {
        id: created.savedVersionId,
        expectedSchemaSha256: created.schemaSha256,
        schema: editedSchema,
        effectiveFrom: editedSchema.effectiveFrom,
        effectiveTo: editedSchema.effectiveTo,
      },
      { now: "2026-08-15T01:03:00.000Z" },
    ),
    (error) => error.code === "WORK_PACK_DRAFT_CHANGED",
  );
  const retained = database.prepare(`SELECT source_candidate_sha256,
      source_binding_map_sha256, candidate_blockers_snapshot
    FROM compliance_activity_work_pack_versions WHERE id = ?`).get(
      created.savedVersionId,
    );
  assert.equal(retained.source_candidate_sha256, created.sourceCandidateSha256);
  assert.equal(retained.source_binding_map_sha256, created.sourceBindingMapSha256);
  assert.equal(retained.candidate_blockers_snapshot, row.candidate_blockers_snapshot);
});

test("server persists an exact-form NSW review draft without making it publishable", async () => {
  const database = sourcedDraftDatabase({
    candidate: NSW_CANDIDATE,
    activity: NSW_ACTIVITY,
    program: NSW_PROGRAM,
    effectiveFrom: "2026-07-01",
  });
  const created = await server.createCreditexSourcedWorkPackDraft(
    testD1(database),
    ACTOR,
    {
      activityVersionId: "activity-current",
      clientRequestId: "forms-sourced-draft:nsw-review-1",
    },
    {
      now: "2026-08-15T01:30:00.000Z",
      idFactory: () => "source-candidate-nsw-1",
    },
  );
  const row = database.prepare(`SELECT *
    FROM compliance_activity_work_pack_versions WHERE id = ?`).get(
      created.savedVersionId,
    );
  assert.equal(row.activity_template_id, NSW_CANDIDATE.templateId);
  assert.equal(row.origin_kind, "source_candidate");
  assert.equal(row.publish_state, "draft");
  assert.equal(row.source_candidate_sha256, created.sourceCandidateSha256);
  assert.deepEqual(
    JSON.parse(row.candidate_blockers_snapshot),
    NSW_CANDIDATE.blockers,
  );
  const schema = activityWorkPack.validateCreditexActivityWorkPack(
    JSON.parse(row.schema_snapshot),
  );
  assert.ok(schema.sections.flatMap((section) => section.prompts)
    .some((prompt) => prompt.required));
  assert.ok(schema.dependencies
    .filter((dependency) => dependency.kind !== "product")
    .every((dependency) => !dependency.required));
});

test("candidate-origin drafts cannot enter publication or activation", async () => {
  const database = sourcedDraftDatabase();
  const d1 = testD1(database);
  const created = await server.createCreditexSourcedWorkPackDraft(
    d1,
    ACTOR,
    {
      activityVersionId: "activity-current",
      clientRequestId: "forms-sourced-draft:test-request-2",
    },
    {
      now: "2026-08-15T02:00:00.000Z",
      idFactory: () => "source-candidate-2",
    },
  );
  await assert.rejects(
    server.publishCreditexWorkPackVersion(
      d1,
      {
        ...ACTOR,
        actorUid: "admin-reviewer",
      },
      {
        id: created.savedVersionId,
        expectedSchemaSha256: created.schemaSha256,
        comment: "Independent review cannot publish a candidate-origin draft.",
      },
      { now: "2026-08-15T02:10:00.000Z" },
    ),
    (error) => error.code === "WORK_PACK_SOURCE_CANDIDATE_REVIEW_REQUIRED",
  );
  assert.equal(database.prepare(`SELECT publish_state
    FROM compliance_activity_work_pack_versions WHERE id = ?`).get(
      created.savedVersionId,
    ).publish_state, "draft");
});

test("the API accepts only activity identity and request identity for sourced drafts", () => {
  const api = read("../src/app/api/creditex/work-packs/_shared.ts");
  assert.match(api, /action === "create_sourced_draft"/);
  assert.match(api, /createCreditexSourcedWorkPackDraft\(database, actor/);
  assert.match(api, /activityVersionId: body\.activityVersionId/);
  assert.match(api, /clientRequestId: body\.clientRequestId/);
  const branch = api.match(
    /action === "create_sourced_draft"\)[\s\S]+?\} else if/,
  )?.[0] || "";
  assert.doesNotMatch(branch, /body\.schema/);
  assert.doesNotMatch(branch, /body\.sourceCandidate/);
  assert.doesNotMatch(branch, /body\.sourceBindingMap/);
});
