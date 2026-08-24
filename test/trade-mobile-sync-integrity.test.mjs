import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

class BoundedJsonRequestError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const boundedJsonRequest = {
  BoundedJsonRequestError,
  readBoundedJsonRequest: async (request) => request.json(),
};

const source = fs.readFileSync(
  new URL("../src/app/api/trade-team/sync/route.ts", import.meta.url),
  "utf8",
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

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

function testD1(database) {
  let beforeNextBatch = null;
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    injectBeforeNextBatch(callback) {
      beforeNextBatch = callback;
    },
    async batch(statements) {
      if (beforeNextBatch) {
        const callback = beforeNextBatch;
        beforeNextBatch = null;
        callback();
      }
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function loadRoute(mocks) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: "src/app/api/trade-team/sync/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier === "@/lib/bounded-json-request") {
      return boundedJsonRequest;
    }
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function syncDatabase(stage = "in_progress", revision = 5) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      partner_type text NOT NULL,
      record_status text NOT NULL,
      work_number text NOT NULL DEFAULT '',
      title text NOT NULL DEFAULT '',
      service_category text NOT NULL DEFAULT '',
      site_area text NOT NULL DEFAULT '',
      stage text NOT NULL,
      priority text NOT NULL DEFAULT 'standard',
      scheduled_start text NOT NULL DEFAULT '',
      scheduled_end text NOT NULL DEFAULT '',
      assignee_member_id text NOT NULL DEFAULT 'member-1',
      assignee_label text NOT NULL DEFAULT 'Field technician',
      source_type text NOT NULL DEFAULT 'internal',
      revision integer NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_work_order_compliance_intents (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      intent_key text NOT NULL,
      installer_uid text NOT NULL,
      compliance_organisation_id text NOT NULL,
      program_template_id text NOT NULL,
      activity_template_id text NOT NULL,
      program_code text NOT NULL,
      registry_activity_code text NOT NULL,
      planned_start text NOT NULL,
      status text NOT NULL,
      intent_snapshot text NOT NULL,
      compliance_case_id text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_work_order_tasks (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      title text NOT NULL DEFAULT '',
      due_at text NOT NULL DEFAULT '',
      status text NOT NULL,
      completed_at text NOT NULL,
      revision integer NOT NULL,
      updated_at text NOT NULL,
      created_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_job_forms (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      template_key text NOT NULL,
      template_version integer NOT NULL DEFAULT 1,
      template_name text NOT NULL DEFAULT '',
      jurisdiction text NOT NULL DEFAULT 'VIC',
      template_snapshot text NOT NULL,
      status text NOT NULL,
      revision integer NOT NULL,
      answers text NOT NULL,
      completed_by_uid text NOT NULL,
      completed_at text NOT NULL,
      updated_at text NOT NULL,
      created_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_crm_job_notes (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      note_type text NOT NULL,
      issue_status text NOT NULL
    );
    CREATE TABLE trade_crm_job_plans (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      completed_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_crm_job_plan_phases (
      id text PRIMARY KEY NOT NULL,
      job_plan_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      completed_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_plan_requirements (
      id text PRIMARY KEY NOT NULL,
      job_plan_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_photo_requests (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      revision integer NOT NULL,
      requirements text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_job_media (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      photo_request_id text NOT NULL,
      photo_requirement_id text NOT NULL,
      source text NOT NULL,
      category text NOT NULL DEFAULT '',
      file_name text NOT NULL DEFAULT '',
      content_type text NOT NULL DEFAULT '',
      size_bytes integer NOT NULL DEFAULT 0,
      caption text NOT NULL DEFAULT '',
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_photo_requirement_reviews (
      id text PRIMARY KEY NOT NULL,
      photo_request_id text NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      request_revision integer NOT NULL,
      review_revision integer NOT NULL,
      photo_requirement_id text NOT NULL,
      status text NOT NULL,
      reason_code text NOT NULL,
      guidance text NOT NULL,
      reviewed_upload_count integer NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_photo_request_completions (
      id text PRIMARY KEY NOT NULL,
      photo_request_id text NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      request_revision integer NOT NULL,
      completion_revision integer NOT NULL,
      checklist_version text NOT NULL,
      evidence_key text NOT NULL,
      required_count integer NOT NULL,
      supplied_count integer NOT NULL,
      completed_at text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      starts_at text NOT NULL,
      ends_at text NOT NULL DEFAULT '',
      travel_started_at text NOT NULL DEFAULT '',
      arrived_at text NOT NULL DEFAULT '',
      work_started_at text NOT NULL DEFAULT '',
      completed_at text NOT NULL DEFAULT '',
      last_transition_by_uid text NOT NULL DEFAULT '',
      revision integer NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      customer_source text NOT NULL DEFAULT 'internal',
      description text NOT NULL DEFAULT '',
      crm_customer_id text NOT NULL DEFAULT '',
      service_site_id text NOT NULL DEFAULT '',
      pipeline_stage text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_customers (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL,
      business_name text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      phone text NOT NULL
    );
    CREATE TABLE trade_crm_service_sites (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      site_label text NOT NULL,
      address_line_1 text NOT NULL,
      address_line_2 text NOT NULL,
      suburb text NOT NULL,
      address_state text NOT NULL,
      postcode text NOT NULL
    );
    CREATE TABLE trade_crm_customer_contacts (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL,
      phone text NOT NULL
    );
    CREATE TABLE trade_crm_site_contacts (
      id text PRIMARY KEY NOT NULL,
      service_site_id text NOT NULL,
      customer_contact_id text NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL,
      is_primary integer NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY NOT NULL,
      activity_key text NOT NULL,
      registry_activity_code text NOT NULL,
      title text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY NOT NULL,
      activity_version_id text NOT NULL,
      organisation_id text NOT NULL
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY NOT NULL,
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
      sort_order integer NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      case_number text NOT NULL,
      organisation_id text NOT NULL,
      work_order_id text NOT NULL,
      compliance_intent_id text NOT NULL DEFAULT '',
      installer_uid text NOT NULL,
      activity_version_id text NOT NULL,
      evidence_policy_version_id text NOT NULL,
      status text NOT NULL,
      evidence_status text NOT NULL,
      revision integer NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_activity_work_pack_instances (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      compliance_case_id text NOT NULL,
      work_order_id text NOT NULL,
      compliance_intent_id text NOT NULL,
      instance_key text NOT NULL,
      work_pack_version_id text NOT NULL,
      revision integer NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_activity_work_pack_final_records (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      instance_key text NOT NULL,
      case_instance_id text NOT NULL,
      work_pack_version_id text NOT NULL
    );
    CREATE TABLE compliance_case_evidence (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      case_id text NOT NULL,
      requirement_id text NOT NULL,
      status text NOT NULL,
      original_sha256 text NOT NULL,
      supersedes_evidence_id text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_rental_inspections (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      inspection_number text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'draft',
      template_key text NOT NULL DEFAULT 'vic-rental-minimum-standards',
      template_version integer NOT NULL DEFAULT 1,
      rules_effective_from text NOT NULL DEFAULT '2026-06-30',
      module_selection_snapshot text NOT NULL DEFAULT '["minimum_standards"]',
      assessor_member_id text NOT NULL DEFAULT '',
      revision integer NOT NULL DEFAULT 1,
      issued_report_id text NOT NULL DEFAULT '',
      issued_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_rental_inspection_modules (
      id text PRIMARY KEY NOT NULL,
      inspection_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL DEFAULT 'not_started'
    );
    CREATE TABLE trade_rental_inspection_items (
      id text PRIMARY KEY NOT NULL,
      inspection_id text NOT NULL,
      firebase_uid text NOT NULL
    );
    CREATE TABLE trade_rental_evidence_links (
      id text PRIMARY KEY NOT NULL,
      inspection_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL DEFAULT 'active'
    );
    CREATE TABLE trade_offline_actions (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      actor_uid text NOT NULL,
      member_id text NOT NULL,
      device_id text NOT NULL,
      client_action_id text NOT NULL,
      payload_hash text NOT NULL,
      action_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      base_revision integer NOT NULL,
      result_revision integer NOT NULL,
      status text NOT NULL,
      lease_until text NOT NULL,
      error_code text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (owner_uid, client_action_id)
    );
    CREATE TABLE trade_work_order_events (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      event_type text NOT NULL,
      summary text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_team_sync_changes (
      sequence integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      owner_uid text NOT NULL,
      audience_member_id text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      operation text NOT NULL,
      revision integer NOT NULL,
      changed_at text NOT NULL
    );
    CREATE TABLE trade_mobile_push_outbox (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      audience_member_id text NOT NULL,
      event_key text NOT NULL UNIQUE,
      event_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      payload text NOT NULL,
      status text NOT NULL,
      attempts integer NOT NULL,
      next_attempt_at text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
  `);
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, partner_type, record_status, stage, revision, updated_at)
    VALUES ('job-1', 'owner-1', 'installer', 'active', ?, ?, 'initial')`)
    .run(stage, revision);
  database.prepare(`INSERT INTO trade_work_order_tasks
    (id, work_order_id, firebase_uid, status, completed_at, revision, updated_at)
    VALUES ('task-1', 'job-1', 'owner-1', 'pending', '', 2, 'initial')`)
    .run();
  database.prepare(`INSERT INTO trade_job_forms
    (id, work_order_id, firebase_uid, template_key, template_snapshot,
     status, revision, answers, completed_by_uid, completed_at, updated_at)
    VALUES ('form-1', 'job-1', 'owner-1', 'field-form',
      '{"name":"Field form","fields":[]}', 'draft', 1, '{}', '', '', 'initial')`)
    .run();
  return database;
}

function routeHarness(database, { assigned = true, workPacks = [] } = {}) {
  const d1 = testD1(database);
  const workPackCalls = [];
  const workPackMutationCalls = [];
  const access = {
    ownerUid: "owner-1",
    actorUid: "actor-1",
    memberId: "member-1",
    displayName: "Field technician",
    isOwner: false,
    jobScope: "own",
    canManageJobs: true,
    canViewFieldEvidence: true,
    canManageFieldEvidence: true,
  };
  const route = loadRoute({
    "../../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": {
      adminJson: (body, status = 200) => Response.json(body, { status }),
      cleanAdminText: (value, maximum) => (
        typeof value === "string" ? value.trim().slice(0, maximum) : ""
      ),
      sameOrigin: () => true,
    },
    "@/lib/trade-team-server": {
      assignedJob: async (_access, workOrderId) => {
        if (!assigned) throw new Error("JOB_NOT_ASSIGNED");
        const row = database.prepare(`SELECT revision FROM trade_work_orders
          WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`)
          .get(workOrderId, access.ownerUid);
        if (!row) throw new Error("JOB_NOT_FOUND");
        return {
          revision: Number(row.revision),
          assignee_member_id: "member-1",
          source_type: "internal",
          source_reference: "",
        };
      },
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": {
      nextJobRevision: (value) => Number(value) + 1,
    },
    "@/lib/trade-mobile-server": {
      mobileAppPolicy: () => ({ contractVersion: 3 }),
      mobileErrorResponse: () => null,
      MOBILE_CLIENT_ID_PATTERN: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/,
      MOBILE_CONTRACT_VERSION: 3,
      requireRegisteredMobileDevice: async () => ({
        deviceId: "device-001",
        deviceName: "Field phone",
        platform: "ios",
      }),
    },
    "@/lib/trade-form-library.mjs": {
      normalizeTradeFormAnswers: () => ({}),
      tradeFormCompletion: () => ({ ready: true, missing: [] }),
    },
    "@/lib/asset-lifecycle.mjs": {
      addMonthsToIsoDate: (value) => value,
    },
    "@/lib/photo-request-review": {
      photoRequestEvidenceKey: async (input) => [
        input.requestId,
        input.requestRevision,
        input.checklistVersion,
        ...[...input.mediaIds].sort(),
      ].join("|"),
    },
    "@/lib/trade-photo-requests": {
      normalisePhotoRequirements: (value) => value,
    },
    "@/lib/creditex-activity-work-pack-server": {
      CreditexActivityWorkPackServerError: class extends Error {
        constructor(code, status, message) {
          super(message);
          this.code = code;
          this.status = status;
        }
      },
      listAssignedCreditexActivityWorkPacks: async (_database, input) => {
        workPackCalls.push(input);
        return workPacks;
      },
      loadAssignedCreditexActivityWorkPack: async (_database, input) => (
        workPacks.find((pack) => pack.instance.id === input.caseInstanceId) || {
          instance: {
            id: input.caseInstanceId,
            workOrderId: "job-1",
            revision: 2,
            responseSha256: `sha256:${"a".repeat(64)}`,
          },
        }
      ),
      commitAssignedCreditexActivityWorkPack: async (_database, input) => {
        workPackMutationCalls.push({ action: "commit", input });
        return {
          status: "applied",
          action: "work_pack_commit",
          projection: {
            instance: {
              id: input.caseInstanceId,
              revision: 3,
              responseSha256: `sha256:${"b".repeat(64)}`,
            },
          },
        };
      },
      prepareAssignedCreditexActivityWorkPackSigning: async (_database, input) => {
        workPackMutationCalls.push({ action: "prepare", input });
        return {
          status: "applied",
          action: "work_pack_prepare_signing",
          projection: {
            instance: {
              id: input.caseInstanceId,
              revision: 3,
              responseSha256: `sha256:${"c".repeat(64)}`,
            },
          },
        };
      },
      captureAssignedCreditexActivityWorkPackSignatures: async (_database, input) => {
        workPackMutationCalls.push({ action: "capture", input });
        return {
          status: "applied",
          action: "work_pack_capture_signatures",
          projection: {
            instance: {
              id: input.caseInstanceId,
              revision: 3,
              responseSha256: input.expectedResponseSha256,
            },
          },
        };
      },
      updateAssignedCreditexActivityWorkPackCustomerContext: async (_database, input) => {
        workPackMutationCalls.push({ action: "customer", input });
        return {
          status: "applied",
          action: "work_pack_update_customer_context",
          projection: {
            instance: {
              id: input.caseInstanceId,
              revision: 3,
              responseSha256: `sha256:${"d".repeat(64)}`,
            },
          },
        };
      },
      finaliseAssignedCreditexActivityWorkPack: async (_database, input) => {
        workPackMutationCalls.push({ action: "finalize", input });
        return {
          status: "applied",
          action: "work_pack_finalize",
          projection: {
            instance: {
              id: input.caseInstanceId,
              revision: 4,
              responseSha256: input.expectedResponseSha256,
            },
          },
        };
      },
    },
    "@/lib/creditex-work-pack-schema-guards": {
      ensureCreditexWorkPackSchemaGuards: async () => {},
    },
    "@/lib/creditex-compliance-server": {
      reconcileReadyPlannedComplianceWorkPacks: async () => [],
    },
  });
  return { route, d1, workPackCalls, workPackMutationCalls };
}

function seedReadyPhotoProof(database) {
  const requirements = JSON.stringify([{
    id: "photo-required",
    label: "Installed unit",
    required: true,
  }]);
  database.prepare(`INSERT INTO trade_crm_photo_requests
    (id, work_order_id, firebase_uid, revision, requirements, status)
    VALUES ('photo-request-1', 'job-1', 'owner-1', 1, ?, 'completed')`)
    .run(requirements);
  database.prepare(`INSERT INTO trade_crm_job_media
    (id, work_order_id, firebase_uid, photo_request_id,
     photo_requirement_id, source, created_at)
    VALUES ('photo-media-1', 'job-1', 'owner-1', 'photo-request-1',
      'photo-required', 'customer_request', '2026-08-01T00:00:00.000Z')`)
    .run();
  database.prepare(`INSERT INTO trade_crm_photo_requirement_reviews
    (id, photo_request_id, work_order_id, firebase_uid, request_revision,
     review_revision, photo_requirement_id, status, reason_code, guidance,
     reviewed_upload_count, created_at)
    VALUES ('photo-review-1', 'photo-request-1', 'job-1', 'owner-1', 1,
      1, 'photo-required', 'accepted', '', '', 1,
      '2026-08-01T00:01:00.000Z')`)
    .run();
  database.prepare(`INSERT INTO trade_crm_photo_request_completions
    (id, photo_request_id, work_order_id, firebase_uid, request_revision,
     completion_revision, checklist_version, evidence_key, required_count,
     supplied_count, completed_at)
    VALUES ('photo-completion-1', 'photo-request-1', 'job-1', 'owner-1', 1,
      1, 'checklist-1',
      'photo-request-1|1|checklist-1|photo-media-1', 1, 1,
      '2026-08-01T00:02:00.000Z')`)
    .run();
}

function prepareFinishableJob(database) {
  database.prepare("DELETE FROM trade_work_order_tasks").run();
  database.prepare("DELETE FROM trade_job_forms").run();
  database.prepare(`INSERT INTO trade_crm_appointments
    (id, work_order_id, firebase_uid, status, starts_at,
     travel_started_at, arrived_at, work_started_at, completed_at,
     last_transition_by_uid, revision, updated_at)
    VALUES ('appointment-1', 'job-1', 'owner-1', 'in_progress',
      '2026-08-01T00:00:00.000Z', '', '', '2026-08-01T00:10:00.000Z',
      '', 'actor-1', 1, 'initial')`)
    .run();
  seedReadyPhotoProof(database);
}

function seedComplianceIntent(database, {
  id = "intent-1",
  workOrderId = "job-1",
  installerUid = "owner-1",
  complianceOrganisationId = "org-veec",
  programTemplateId = "program-veu",
  programCode = "VEU",
  programName = "Victorian Energy Upgrades",
  activityTemplateId = "activity-template-1",
  activityCode = "6",
  activityTitle = "High-efficiency space conditioning",
  plannedStart = "2026-08-20T00:00:00.000Z",
  status = "planned",
  complianceCaseId = "",
} = {}) {
  const snapshot = JSON.stringify({
    contract: "tlink-creditex-job-intent-v1",
    plannedStart,
    program: {
      templateId: programTemplateId,
      programCode,
      name: programName,
    },
    activity: {
      templateId: activityTemplateId,
      activityKey: `${programCode}_${activityCode}`,
      registryActivityCode: activityCode,
      title: activityTitle,
    },
    governance: {
      state: "setup_required",
      message: "Creditex must resolve and publish the exact governed field pack.",
    },
  });
  database.prepare(`INSERT INTO trade_work_order_compliance_intents
    (id, work_order_id, intent_key, installer_uid,
     compliance_organisation_id, program_template_id, activity_template_id,
     program_code, registry_activity_code, planned_start, status,
     intent_snapshot, compliance_case_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      workOrderId,
      id,
      installerUid,
      complianceOrganisationId,
      programTemplateId,
      activityTemplateId,
      programCode,
      activityCode,
      plannedStart,
      status,
      snapshot,
      complianceCaseId,
      "2026-08-01T00:00:00.000Z",
    );
}

function seedLinkedWorkPack(database, {
  intentId = "intent-linked-pack",
  caseId = "case-linked-pack",
  organisationId = "org-veec",
  status = "in_progress",
  revision = 1,
  withFinalRecord = status === "completed",
} = {}) {
  if (!database.prepare(`SELECT 1 found FROM trade_work_order_compliance_intents
    WHERE id = ?`).get(intentId)) {
    seedComplianceIntent(database, {
      id: intentId,
      complianceOrganisationId: organisationId,
      status: "case_linked",
      complianceCaseId: caseId,
    });
  }
  if (!database.prepare("SELECT 1 found FROM compliance_cases WHERE id = ?").get(caseId)) {
    database.prepare(`INSERT INTO compliance_cases
      (id, case_number, organisation_id, work_order_id, compliance_intent_id,
       installer_uid, activity_version_id, evidence_policy_version_id, status,
       evidence_status, revision, updated_at)
      VALUES (?, ?, ?, 'job-1', ?, 'owner-1', 'activity-linked-pack',
        'policy-linked-pack', 'draft', 'in_progress', 1,
        '2026-08-01T00:00:00.000Z')`)
      .run(caseId, `CASE-${intentId}`, organisationId, intentId);
  }
  const caseInstanceId = `${caseId}-pack-${revision}`;
  const instanceKey = `${caseId}-pack`;
  const workPackVersionId = `version-${caseId}`;
  database.prepare(`INSERT INTO compliance_activity_work_pack_instances
    (id, organisation_id, compliance_case_id, work_order_id,
     compliance_intent_id, instance_key, work_pack_version_id, revision, status)
    VALUES (?, ?, ?, 'job-1', ?, ?, ?, ?, ?)`)
    .run(
      caseInstanceId,
      organisationId,
      caseId,
      intentId,
      instanceKey,
      workPackVersionId,
      revision,
      status,
    );
  if (withFinalRecord) {
    database.prepare(`INSERT INTO compliance_activity_work_pack_final_records
      (id, organisation_id, instance_key, case_instance_id, work_pack_version_id)
      VALUES (?, ?, ?, ?, ?)`)
      .run(
        `final-${caseInstanceId}`,
        organisationId,
        instanceKey,
        caseInstanceId,
        workPackVersionId,
      );
  }
}

function seedGovernedComplianceCases(database) {
  const activities = [
    ["activity-stc", "SRES_HEAT_PUMP", "STC", "Heat-pump water heater"],
    ["activity-veec", "VEU_HOT_WATER", "1", "Victorian hot-water upgrade"],
    ["activity-foreign", "FOREIGN_ACTIVITY", "FOREIGN", "Foreign tenant activity"],
  ];
  const policies = [
    ["policy-stc", "activity-stc", "org-stc"],
    ["policy-veec", "activity-veec", "org-veec"],
    ["policy-foreign", "activity-foreign", "org-foreign"],
  ];
  const requirements = [
    ["requirement-stc", "org-stc", "policy-stc", "STC_INSTALLED_UNIT", "Installed unit"],
    ["requirement-veec", "org-veec", "policy-veec", "VEEC_DECOMMISSION", "Decommissioned unit"],
    ["requirement-foreign", "org-foreign", "policy-foreign", "FOREIGN_PROOF", "Foreign proof"],
  ];
  const cases = [
    ["case-stc", "STC-001", "org-stc", "intent-linked", "owner-1", "activity-stc", "policy-stc"],
    ["case-veec", "VEEC-001", "org-veec", "", "owner-1", "activity-veec", "policy-veec"],
    ["case-foreign", "FOREIGN-001", "org-foreign", "", "owner-2", "activity-foreign", "policy-foreign"],
  ];
  const insertActivity = database.prepare(`INSERT INTO compliance_activity_versions
    (id, activity_key, registry_activity_code, title) VALUES (?, ?, ?, ?)`);
  for (const row of activities) insertActivity.run(...row);
  const insertPolicy = database.prepare(`INSERT INTO compliance_evidence_policy_versions
    (id, activity_version_id, organisation_id) VALUES (?, ?, ?)`);
  for (const row of policies) insertPolicy.run(...row);
  const insertRequirement = database.prepare(`INSERT INTO compliance_evidence_requirements
    (id, organisation_id, policy_version_id, requirement_code, title,
     description, evidence_type, capture_timing, minimum_count, maximum_count,
     original_required, metadata_required, gps_required, date_stamp_required,
     installer_signature_required, customer_signature_required,
     allowed_content_types, condition_snapshot, field_schema, sort_order)
    VALUES (?, ?, ?, ?, ?, '', 'photo', 'any', 1, 1, 0, 0, 0, 0, 0, 0,
      '["image/jpeg"]', '{}', '{}', 1)`);
  for (const row of requirements) insertRequirement.run(...row);
  const insertCase = database.prepare(`INSERT INTO compliance_cases
    (id, case_number, organisation_id, compliance_intent_id, work_order_id, installer_uid,
     activity_version_id, evidence_policy_version_id, status, evidence_status,
     revision, updated_at)
    VALUES (?, ?, ?, ?, 'job-1', ?, ?, ?, 'draft', 'in_progress', 1,
      '2026-08-01T00:00:00.000Z')`);
  for (const row of cases) insertCase.run(...row);
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, status, original_sha256)
    VALUES ('evidence-stc', 'org-stc', 'case-stc', 'requirement-stc',
      'received', 'hash-stc')`).run();
}

async function bootstrap(route) {
  const response = await route.GET(new Request(
    "https://app.example/api/trade-team/sync?deviceId=device-001&platform=ios&appVersion=1.0.0",
  ));
  return { response, payload: await response.json() };
}

async function postActions(route, actions) {
  const response = await route.POST(new Request(
    "https://app.example/api/trade-team/sync",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "device-001",
        platform: "ios",
        appVersion: "1.0.0",
        actions,
      }),
    },
  ));
  return { response, payload: await response.json() };
}

test("bootstrap fails closed before companion rows can exceed its response cap", async () => {
  const database = syncDatabase("in_progress", 5);
  const insert = database.prepare(`INSERT INTO trade_work_order_tasks
    (id, work_order_id, firebase_uid, status, completed_at, revision, updated_at)
    VALUES (?, 'job-1', 'owner-1', 'pending', '', 1, 'initial')`);
  database.exec("BEGIN");
  for (let index = 0; index < 10_000; index += 1) {
    insert.run(`bounded-task-${index}`);
  }
  database.exec("COMMIT");
  const { route } = routeHarness(database);

  const result = await bootstrap(route);
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "SYNC_RESPONSE_CARDINALITY_EXCEEDED");
  assert.match(result.payload.error, /too much active field data/);
});

test("bootstrap returns every current activity intent with its validated case link and preserves own-job scope", async () => {
  const database = syncDatabase("in_progress", 5);
  seedGovernedComplianceCases(database);
  seedComplianceIntent(database, {
    id: "intent-linked",
    complianceOrganisationId: "org-stc",
    programTemplateId: "program-sres",
    programCode: "SRES",
    programName: "Small-scale Renewable Energy Scheme",
    activityTemplateId: "activity-stc-template",
    activityCode: "STC",
    activityTitle: "Heat-pump water heater",
    status: "case_linked",
    complianceCaseId: "case-stc",
  });
  seedComplianceIntent(database, {
    id: "intent-setup",
    activityTemplateId: "activity-setup-template",
    activityCode: "6",
    activityTitle: "High-efficiency space conditioning",
  });
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, partner_type, record_status, stage, revision,
     assignee_member_id, updated_at)
    VALUES ('job-other-member', 'owner-1', 'installer', 'active',
      'scheduled', 1, 'member-2', 'initial')`).run();
  seedComplianceIntent(database, {
    id: "intent-other-member",
    workOrderId: "job-other-member",
  });
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, partner_type, record_status, stage, revision,
     assignee_member_id, updated_at)
    VALUES ('job-foreign-owner', 'owner-2', 'installer', 'active',
      'scheduled', 1, 'member-1', 'initial')`).run();
  seedComplianceIntent(database, {
    id: "intent-foreign-owner",
    workOrderId: "job-foreign-owner",
    installerUid: "owner-2",
  });
  const { route } = routeHarness(database);

  const result = await bootstrap(route);
  assert.equal(result.response.status, 200);
  assert.deepEqual(
    result.payload.changes.map((change) => change.entityId),
    ["job-1"],
  );
  const job = result.payload.changes[0].entity;
  assert.deepEqual(
    job.complianceIntents.map((intent) => ({
      id: intent.id,
      programCode: intent.programCode,
      activityCode: intent.activityCode,
      activityTitle: intent.activityTitle,
      plannedDate: intent.plannedDate,
      status: intent.status,
      governanceState: intent.governanceState,
      governanceMessage: intent.governanceMessage,
      linkedCaseReady: intent.linkedCaseReady,
      complianceCaseId: intent.complianceCaseId,
      caseNumber: intent.caseNumber,
      caseStatus: intent.caseStatus,
      evidenceStatus: intent.evidenceStatus,
    })),
    [
      {
        id: "intent-linked",
        programCode: "SRES",
        activityCode: "STC",
        activityTitle: "Heat-pump water heater",
        plannedDate: "2026-08-20",
        status: "case_linked",
        governanceState: "setup_required",
        governanceMessage: "Creditex must resolve and publish the exact governed field pack.",
        linkedCaseReady: true,
        complianceCaseId: "case-stc",
        caseNumber: "STC-001",
        caseStatus: "draft",
        evidenceStatus: "in_progress",
      },
      {
        id: "intent-setup",
        programCode: "VEU",
        activityCode: "6",
        activityTitle: "High-efficiency space conditioning",
        plannedDate: "2026-08-20",
        status: "planned",
        governanceState: "setup_required",
        governanceMessage: "Creditex must resolve and publish the exact governed field pack.",
        linkedCaseReady: false,
        complianceCaseId: "",
        caseNumber: "",
        caseStatus: "",
        evidenceStatus: "",
      },
    ],
  );
});

test("bootstrap loads pinned work packs through the assigned own scope without exposing protected customer PII", async () => {
  const database = syncDatabase("scheduled", 1);
  const protectedPack = {
    instance: {
      id: "work-pack-1",
      workOrderId: "job-1",
      complianceIntentId: "intent-protected",
      responseSha256: `sha256:${"a".repeat(64)}`,
    },
    protectedCustomer: true,
    customerContextBinding: {
      contract: "creditex-activity-work-pack-customer-context/v1",
      editable: false,
      customerId: "",
      siteId: "",
      contactId: "",
      customerRevision: "",
      siteRevision: "",
      contactRevision: "",
      contextSha256: `sha256:${"b".repeat(64)}`,
    },
    customerContext: {
      editable: false,
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      addressLine1: "",
      addressLine2: "",
      suburb: "",
      state: "",
      postcode: "",
      customerRevision: "",
      siteRevision: "",
      contactRevision: "",
    },
  };
  const { route, workPackCalls } = routeHarness(database, {
    workPacks: [protectedPack],
  });

  const result = await bootstrap(route);
  assert.equal(result.response.status, 200);
  assert.deepEqual(workPackCalls, [{
    ownerUid: "owner-1",
    actorUid: "actor-1",
    actorMemberId: "member-1",
    scope: "own",
    workOrderIds: ["job-1"],
  }]);
  const [projected] = result.payload.changes[0].entity.activityWorkPacks;
  assert.equal(projected.instance.id, "work-pack-1");
  assert.equal(projected.protectedCustomer, true);
  assert.equal(projected.customerContext.editable, false);
  assert.equal(projected.customerContext.firstName, "");
  assert.equal(projected.customerContext.phone, "");
  assert.equal(projected.customerContext.addressLine1, "");
});

test("work-pack signatures use the separate prepared-revision capture action", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route, workPackMutationCalls } = routeHarness(database);
  const sha = (character) => `sha256:${character.repeat(64)}`;
  const signedAt = "2026-08-14T10:00:00.000Z";
  const signerIdentity = {
    contract: "creditex-activity-work-pack-signer-identity/v1",
    roleKey: "customer",
    capacity: "Customer",
    identitySource: "customer_context",
    signerName: "Test Customer",
    signerUid: "",
    fields: { authority: "Owner" },
  };
  const attestation = {
    contract: "creditex-activity-work-pack-signature-attestation/v1",
    promptKey: "customer-signature",
    signerRoleKey: "customer",
    text: "I confirm the work and declaration.",
    version: "2026-08-14",
    sourceBindingTargetKey: "customer-declaration",
    signerIdentity,
    signerIdentitySha256: sha("1"),
    definitionSha256: sha("2"),
    prefillSha256: sha("3"),
    responseSha256: sha("4"),
    declarationsSha256: sha("5"),
  };
  const signaturePayload = {
    contract: "creditex-activity-work-pack-signature-payload/v1",
    instanceKey: "instance-key",
    caseInstanceId: "work-pack-1",
    promptKey: "customer-signature",
    signerRoleKey: "customer",
    signerName: "Test Customer",
    signerCapacity: "Customer",
    signerIdentitySha256: sha("1"),
    attestationSha256: sha("6"),
    definitionSha256: sha("2"),
    prefillSha256: sha("3"),
    responseSha256: sha("4"),
    declarationsSha256: sha("5"),
    strokes: [{ points: [
      { x: 0.1, y: 0.2, pressure: null, capturedAtOffsetMs: 0 },
      { x: 0.4, y: 0.5, pressure: 0.5, capturedAtOffsetMs: 10 },
      { x: 0.7, y: 0.3, pressure: 0.6, capturedAtOffsetMs: 20 },
    ] }],
    signedAt,
  };
  const deviceAttestation = {
    contract: "creditex-activity-work-pack-device-attestation/v1",
    deviceId: "device-001",
    appId: "au.com.australianenergyassessments.field",
    appVersion: "1.0.0",
    appBuild: "1",
    sessionId: "capture-session-1",
    capturedByUid: "actor-1",
    signedAt,
    deviceContext: { platform: "ios", physicalDevice: true },
  };
  const packet = {
    sectionKey: "signatures",
    repeatInstanceKey: "",
    promptKey: "customer-signature",
    clientUploadId: "upload-signature-1",
    signerIdentity,
    signerIdentitySha256: sha("1"),
    signaturePayload,
    signaturePayloadSha256: sha("7"),
    attestation,
    attestationSha256: sha("6"),
    deviceAttestation,
    deviceAttestationSha256: sha("8"),
    signatureSha256: "9".repeat(64),
  };

  const commitAttempt = await postActions(route, [{
    clientActionId: "work-pack-bad-signature-phase",
    type: "work_pack_commit",
    workOrderId: "job-1",
    caseInstanceId: "work-pack-1",
    expectedResponseSha256: sha("a"),
    signaturePackets: [packet],
  }]);
  assert.equal(commitAttempt.payload.results[0].code, "WORK_PACK_SIGNATURE_PHASE_REQUIRED");
  assert.equal(workPackMutationCalls.length, 0);

  const captured = await postActions(route, [{
    clientActionId: "work-pack-signature-capture",
    type: "work_pack_capture_signatures",
    workOrderId: "job-1",
    caseInstanceId: "work-pack-1",
    expectedResponseSha256: sha("a"),
    signaturePackets: [packet],
  }]);
  assert.equal(captured.payload.results[0].status, "applied");
  assert.equal(workPackMutationCalls[0].action, "capture");
  assert.equal(workPackMutationCalls[0].input.packets[0].promptKey, "customer-signature");
  assert.equal(workPackMutationCalls[0].input.packets[0].deviceAttestation.deviceId, "device-001");
  assert.equal(workPackMutationCalls[0].input.packets[0].deviceAttestation.capturedByUid, "actor-1");
  assert.equal(workPackMutationCalls[0].input.packets[0].signaturePayload.strokes[0].points.length, 3);
});

test("customer correction echoes the authoritative non-PII binding", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route, workPackMutationCalls } = routeHarness(database);
  const binding = {
    contract: "creditex-activity-work-pack-customer-context/v1",
    editable: true,
    customerId: "customer-1",
    siteId: "site-1",
    contactId: "contact-1",
    customerRevision: "2026-08-14T01:00:00.000Z",
    siteRevision: "2026-08-14T01:00:00.000Z",
    contactRevision: "2026-08-14T01:00:00.000Z",
    contextSha256: `sha256:${"a".repeat(64)}`,
  };
  const result = await postActions(route, [{
    clientActionId: "work-pack-customer-correct",
    type: "work_pack_update_customer_context",
    workOrderId: "job-1",
    caseInstanceId: "work-pack-1",
    expectedResponseSha256: `sha256:${"b".repeat(64)}`,
    customerContextBinding: binding,
    customerPatch: { firstName: "Correct" },
    sitePatch: { postcode: "3000" },
    contactPatch: { phone: "0400000000" },
  }]);
  assert.equal(result.payload.results[0].status, "applied");
  assert.deepEqual(workPackMutationCalls[0].input.customerContextBinding, binding);
  assert.deepEqual(workPackMutationCalls[0].input.customerPatch, { firstName: "Correct" });
  assert.deepEqual(workPackMutationCalls[0].input.sitePatch, { postcode: "3000" });
});

test("offline finalization uses the governed renderer and returns the completed projection", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route, workPackMutationCalls } = routeHarness(database);
  const responseSha256 = `sha256:${"e".repeat(64)}`;
  const result = await postActions(route, [{
    clientActionId: "work-pack-finalize-record",
    type: "work_pack_finalize",
    workOrderId: "job-1",
    caseInstanceId: "work-pack-1",
    expectedResponseSha256: responseSha256,
  }]);
  assert.equal(result.payload.results[0].status, "applied");
  assert.equal(result.payload.results[0].actionType, "work_pack_finalize");
  assert.equal(workPackMutationCalls[0].action, "finalize");
  assert.equal(workPackMutationCalls[0].input.expectedResponseSha256, responseSha256);
  assert.equal(workPackMutationCalls[0].input.idempotency.deviceId, "device-001");
});

test("bootstrap fails closed when one job exceeds the selected-activity work-pack limit", async () => {
  const database = syncDatabase("scheduled", 1);
  for (let index = 0; index < 13; index += 1) {
    seedComplianceIntent(database, {
      id: `intent-limit-${index}`,
      activityTemplateId: `activity-limit-${index}`,
      activityCode: String(index + 1),
    });
  }
  const { route } = routeHarness(database);

  const result = await bootstrap(route);
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "SYNC_RESPONSE_CARDINALITY_EXCEEDED");
});

test("an activity awaiting its governed case blocks both server finish paths", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  seedComplianceIntent(database, { id: "intent-awaiting-pack" });
  const { route } = routeHarness(database);

  const stageAttempt = await postActions(route, [{
    clientActionId: "work-pack-stage-finish",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 5,
    stage: "completed",
  }]);
  assert.equal(stageAttempt.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(stageAttempt.payload.results[0].error, /Creditex compliance work packs/);

  const fieldAttempt = await postActions(route, [{
    clientActionId: "work-pack-field-finish",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(fieldAttempt.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(fieldAttempt.payload.results[0].error, /Creditex compliance work packs/);
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision FROM trade_work_orders
      WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 5 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_offline_actions").get().count, 0);
});

test("a linked activity remains blocked until its current work pack is completed", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  seedLinkedWorkPack(database, { status: "in_progress" });
  const { route } = routeHarness(database);

  const stageAttempt = await postActions(route, [{
    clientActionId: "linked-work-pack-stage-finish",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 5,
    stage: "completed",
  }]);
  assert.equal(stageAttempt.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(stageAttempt.payload.results[0].error, /Creditex compliance work packs/);

  const fieldAttempt = await postActions(route, [{
    clientActionId: "linked-work-pack-field-finish",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(fieldAttempt.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(fieldAttempt.payload.results[0].error, /Creditex compliance work packs/);
});

test("only the current completed work-pack revision with its final PDF satisfies field finish", async () => {
  const completedDatabase = syncDatabase("in_progress", 5);
  prepareFinishableJob(completedDatabase);
  seedLinkedWorkPack(completedDatabase, { status: "completed" });
  const completedHarness = routeHarness(completedDatabase);
  const completed = await postActions(completedHarness.route, [{
    clientActionId: "current-completed-work-pack",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(completed.payload.results[0].status, "applied");

  const missingRecordDatabase = syncDatabase("in_progress", 5);
  prepareFinishableJob(missingRecordDatabase);
  seedLinkedWorkPack(missingRecordDatabase, {
    status: "completed",
    withFinalRecord: false,
  });
  const missingRecordHarness = routeHarness(missingRecordDatabase);
  const missingRecord = await postActions(missingRecordHarness.route, [{
    clientActionId: "completed-work-pack-without-pdf",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(missingRecord.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(missingRecord.payload.results[0].error, /Creditex compliance work packs/);

  const supersededDatabase = syncDatabase("in_progress", 5);
  prepareFinishableJob(supersededDatabase);
  seedLinkedWorkPack(supersededDatabase, { status: "completed" });
  seedLinkedWorkPack(supersededDatabase, { status: "in_progress", revision: 2 });
  const supersededHarness = routeHarness(supersededDatabase);
  const blocked = await postActions(supersededHarness.route, [{
    clientActionId: "superseded-completed-work-pack",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(blocked.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(blocked.payload.results[0].error, /Creditex compliance work packs/);
});

test("the atomic finish guard rejects a work pack added after preflight", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  const { route, d1 } = routeHarness(database);
  d1.injectBeforeNextBatch(() => {
    seedComplianceIntent(database, { id: "intent-raced-pack" });
  });

  const result = await postActions(route, [{
    clientActionId: "work-pack-finish-race",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(result.payload.results[0].status, "conflict");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision FROM trade_work_orders
      WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 5 },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, revision FROM trade_crm_appointments
      WHERE id = 'appointment-1'`).get() },
    { status: "in_progress", revision: 1 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
});

test("offline stage changes cannot complete blocked work or reopen a terminal job", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route } = routeHarness(database);
  let result = await postActions(route, [{
    clientActionId: "action-stage-complete",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 5,
    stage: "completed",
  }]);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.results[0].code, "FINISH_BLOCKED");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision FROM trade_work_orders
      WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 5 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_offline_actions").get().count, 0);

  database.prepare(`UPDATE trade_work_orders
    SET stage = 'completed' WHERE id = 'job-1'`).run();
  result = await postActions(route, [{
    clientActionId: "action-stage-reopen",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 5,
    stage: "backlog",
  }]);
  assert.equal(result.payload.results[0].code, "JOB_TERMINAL");
  assert.equal(database.prepare("SELECT stage FROM trade_work_orders WHERE id = 'job-1'").get().stage, "completed");
});

test("bootstrap returns every owner-scoped compliance pack and both finish preflights require all governed evidence", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  seedGovernedComplianceCases(database);
  const { route } = routeHarness(database);

  const initial = await bootstrap(route);
  assert.equal(initial.response.status, 200);
  const job = initial.payload.changes.find((change) => change.entityId === "job-1")?.entity;
  assert.ok(job);
  assert.deepEqual(
    job.complianceCases.map((item) => item.caseId),
    ["case-stc", "case-veec"],
  );
  assert.equal(job.compliance, undefined);
  assert.deepEqual(
    job.complianceCases.map((item) => ({
      caseId: item.caseId,
      evidenceStatus: item.evidenceStatus,
      requirementIds: item.requirements.map((requirement) => requirement.id),
      requirementStates: item.requirements.map((requirement) => requirement.status),
    })),
    [
      {
        caseId: "case-stc",
        evidenceStatus: "in_progress",
        requirementIds: ["requirement-stc"],
        requirementStates: ["in_review"],
      },
      {
        caseId: "case-veec",
        evidenceStatus: "in_progress",
        requirementIds: ["requirement-veec"],
        requirementStates: ["pending"],
      },
    ],
  );

  const stageAttempt = await postActions(route, [{
    clientActionId: "multi-case-stage-finish",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 5,
    stage: "completed",
  }]);
  assert.equal(stageAttempt.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(stageAttempt.payload.results[0].error, /governed evidence/);

  const fieldAttempt = await postActions(route, [{
    clientActionId: "multi-case-field-finish",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(fieldAttempt.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(fieldAttempt.payload.results[0].error, /governed evidence/);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_offline_actions").get().count, 0);

  database.prepare("DELETE FROM compliance_cases WHERE id = 'case-veec'").run();
  const singleCase = await bootstrap(route);
  const singleCaseJob = singleCase.payload.changes.find(
    (change) => change.entityId === "job-1",
  )?.entity;
  assert.deepEqual(
    {
      arrayCaseIds: singleCaseJob.complianceCases.map((item) => item.caseId),
      legacyCaseId: singleCaseJob.compliance.caseId,
    },
    {
      arrayCaseIds: ["case-stc"],
      legacyCaseId: "case-stc",
    },
  );
});

test("the atomic finish guard rechecks every governed case without foreign-tenant leakage", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  seedGovernedComplianceCases(database);
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, status, original_sha256)
    VALUES ('evidence-veec', 'org-veec', 'case-veec', 'requirement-veec',
      'received', 'hash-veec')`).run();
  const { route, d1 } = routeHarness(database);

  d1.injectBeforeNextBatch(() => {
    database.prepare(`UPDATE compliance_case_evidence
      SET status = 'rejected' WHERE id = 'evidence-veec'`).run();
  });
  const raced = await postActions(route, [{
    clientActionId: "multi-case-evidence-race",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(raced.payload.results[0].status, "conflict");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision FROM trade_work_orders
      WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 5 },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, revision FROM trade_crm_appointments
      WHERE id = 'appointment-1'`).get() },
    { status: "in_progress", revision: 1 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);

  database.prepare(`UPDATE compliance_case_evidence
    SET status = 'received' WHERE id = 'evidence-veec'`).run();
  const completed = await postActions(route, [{
    clientActionId: "multi-case-finish-ready",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(completed.payload.results[0].status, "applied");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision FROM trade_work_orders
      WHERE id = 'job-1'`).get() },
    { stage: "completed", revision: 6 },
  );
});

test("superseded governed evidence cannot satisfy an offline finish", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  seedGovernedComplianceCases(database);
  database.exec(`
    INSERT INTO compliance_case_evidence
      (id, organisation_id, case_id, requirement_id, status, original_sha256)
    VALUES
      ('evidence-veec-original', 'org-veec', 'case-veec',
       'requirement-veec', 'received', 'hash-veec-original');
    INSERT INTO compliance_case_evidence
      (id, organisation_id, case_id, requirement_id, status, original_sha256,
       supersedes_evidence_id)
    VALUES
      ('evidence-veec-replacement', 'org-veec', 'case-veec',
       'requirement-veec', 'rejected', 'hash-veec-replacement',
       'evidence-veec-original');
  `);
  const { route } = routeHarness(database);

  const blocked = await postActions(route, [{
    clientActionId: "multi-case-superseded-evidence",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(blocked.payload.results[0].code, "FINISH_BLOCKED");
  assert.match(blocked.payload.results[0].error, /governed evidence/);
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision FROM trade_work_orders
      WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 5 },
  );

  database.prepare(`UPDATE compliance_case_evidence
    SET status = 'under_review'
    WHERE id = 'evidence-veec-replacement'`).run();
  const completed = await postActions(route, [{
    clientActionId: "multi-case-replacement-evidence",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(completed.payload.results[0].status, "applied");
});

for (const terminalStage of ["completed", "cancelled"]) {
  test(`all offline mutations reject immutable ${terminalStage} jobs`, async () => {
    const database = syncDatabase(terminalStage, 5);
    const { route } = routeHarness(database);
    const { payload } = await postActions(route, [
      {
        clientActionId: `terminal-stage-${terminalStage}`,
        type: "set_job_stage",
        workOrderId: "job-1",
        baseRevision: 5,
        stage: "ready",
      },
      {
        clientActionId: `terminal-task-${terminalStage}`,
        type: "set_task_status",
        workOrderId: "job-1",
        taskId: "task-1",
        baseRevision: 2,
        status: "done",
      },
      {
        clientActionId: `terminal-form-${terminalStage}`,
        type: "save_job_form",
        workOrderId: "job-1",
        formId: "form-1",
        baseRevision: 1,
        answers: {},
        complete: false,
      },
      {
        clientActionId: `terminal-time-${terminalStage}`,
        type: "add_time_entry",
        workOrderId: "job-1",
        baseRevision: 5,
        workDate: "2026-08-01",
        durationMinutes: 30,
        notes: "",
      },
      {
        clientActionId: `terminal-field-${terminalStage}`,
        type: "advance_field_job",
        workOrderId: "job-1",
        baseRevision: 5,
        transition: "start_work",
      },
    ]);
    assert.deepEqual(
      payload.results.map((item) => item.code),
      Array(5).fill("JOB_TERMINAL"),
    );
    assert.deepEqual(
      { ...database.prepare(`SELECT stage, revision, updated_at
        FROM trade_work_orders WHERE id = 'job-1'`).get() },
      { stage: terminalStage, revision: 5, updated_at: "initial" },
    );
    assert.deepEqual(
      { ...database.prepare(`SELECT status, revision, updated_at
        FROM trade_work_order_tasks WHERE id = 'task-1'`).get() },
      { status: "pending", revision: 2, updated_at: "initial" },
    );
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_offline_actions").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count, 0);
  });
}

test("a concurrent job CAS loss rolls back child, receipt, event and sync writes", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route, d1 } = routeHarness(database);
  const action = {
    clientActionId: "action-task-race",
    type: "set_task_status",
    workOrderId: "job-1",
    taskId: "task-1",
    baseRevision: 2,
    status: "done",
  };
  d1.injectBeforeNextBatch(() => {
    database.prepare(`UPDATE trade_work_orders
      SET revision = 9, updated_at = 'concurrent'
      WHERE id = 'job-1'`).run();
  });
  const { payload } = await postActions(route, [action]);
  assert.equal(payload.results[0].status, "conflict");
  assert.equal(payload.results[0].currentJobRevision, 9);
  assert.deepEqual(
    { ...database.prepare(`SELECT status, revision, updated_at
      FROM trade_work_order_tasks WHERE id = 'task-1'`).get() },
    { status: "pending", revision: 2, updated_at: "initial" },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision, updated_at
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 9, updated_at: "concurrent" },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, result_revision
      FROM trade_offline_actions WHERE client_action_id = 'action-task-race'`).get() },
    { status: "conflict", result_revision: 9 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count, 0);
  const replay = await postActions(route, [action]);
  assert.deepEqual(
    {
      status: replay.payload.results[0].status,
      entityId: replay.payload.results[0].entityId,
      currentRevision: replay.payload.results[0].currentRevision,
      currentJobRevision: replay.payload.results[0].currentJobRevision,
    },
    {
      status: "conflict",
      entityId: "task-1",
      currentRevision: 2,
      currentJobRevision: 9,
    },
  );
});

test("stale task and form conflicts include both child and current job revisions", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route } = routeHarness(database);
  const { payload } = await postActions(route, [
    {
      clientActionId: "action-task-stale",
      type: "set_task_status",
      workOrderId: "job-1",
      taskId: "task-1",
      baseRevision: 1,
      status: "done",
    },
    {
      clientActionId: "action-form-stale",
      type: "save_job_form",
      workOrderId: "job-1",
      formId: "form-1",
      baseRevision: 2,
      answers: {},
    },
  ]);
  assert.deepEqual(
    payload.results.map((result) => ({
      status: result.status,
      entityId: result.entityId,
      currentRevision: result.currentRevision,
      currentJobRevision: result.currentJobRevision,
    })),
    [
      {
        status: "conflict",
        entityId: "task-1",
        currentRevision: 2,
        currentJobRevision: 5,
      },
      {
        status: "conflict",
        entityId: "form-1",
        currentRevision: 1,
        currentJobRevision: 5,
      },
    ],
  );
});

test("conflict replay reasserts technician assignment before returning revisions", async () => {
  const database = syncDatabase("in_progress", 5);
  database.prepare(`INSERT INTO trade_offline_actions
    (id, owner_uid, actor_uid, member_id, device_id, client_action_id,
     payload_hash, action_type, entity_type, entity_id, base_revision,
     result_revision, status, lease_until, error_code, created_at, updated_at)
    VALUES ('receipt-unassigned', 'owner-1', 'actor-1', 'member-1',
      'device-001', 'action-task-unassigned', '', 'set_task_status', 'job',
      'job-1', 2, 5, 'conflict', '', 'REVISION_CONFLICT', 'initial', 'initial')`)
    .run();
  const action = {
    clientActionId: "action-task-unassigned",
    type: "set_task_status",
    workOrderId: "job-1",
    taskId: "task-1",
    baseRevision: 2,
    status: "done",
  };
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(
      Object.fromEntries(
        Object.entries(action).sort(([left], [right]) => left.localeCompare(right)),
      ),
    )),
  );
  const hashText = Buffer.from(hash).toString("base64url");
  database.prepare(`UPDATE trade_offline_actions SET payload_hash = ?
    WHERE id = 'receipt-unassigned'`).run(hashText);
  const { route } = routeHarness(database, { assigned: false });
  const { payload } = await postActions(route, [action]);
  assert.deepEqual(payload.results[0], {
    clientActionId: "action-task-unassigned",
    status: "rejected",
    code: "JOB_NOT_ASSIGNED",
    error: "This job is no longer assigned to this team account.",
  });
});

test("an allowed nonterminal stage change writes its receipt, event, sync audiences and push", async () => {
  const database = syncDatabase("backlog", 1);
  database.prepare("DELETE FROM trade_work_order_tasks").run();
  const { route } = routeHarness(database);
  const { payload } = await postActions(route, [{
    clientActionId: "action-stage-ready",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 1,
    stage: "ready",
  }]);
  assert.equal(payload.results[0].status, "applied");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    { stage: "ready", revision: 2 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_offline_actions WHERE status = 'applied'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count, 1);
});

test("finish atomically reasserts required photo proof and writes one completion", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  const { route } = routeHarness(database);
  const { payload } = await postActions(route, [{
    clientActionId: "action-finish-success",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(payload.results[0].status, "applied");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    { stage: "completed", revision: 6 },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, revision
      FROM trade_crm_appointments WHERE id = 'appointment-1'`).get() },
    { status: "completed", revision: 2 },
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count FROM trade_offline_actions
      WHERE status = 'applied'`).get().count,
    1,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    2,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
    2,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count,
    1,
  );
});

test("a concurrent photo-proof change rolls back the entire finish batch", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  const { route, d1 } = routeHarness(database);
  d1.injectBeforeNextBatch(() => {
    database.prepare(`INSERT INTO trade_crm_photo_requirement_reviews
      (id, photo_request_id, work_order_id, firebase_uid, request_revision,
       review_revision, photo_requirement_id, status, reason_code, guidance,
       reviewed_upload_count, created_at)
      VALUES ('photo-review-2', 'photo-request-1', 'job-1', 'owner-1', 1,
        2, 'photo-required', 'retake_requested', 'clearer_photo',
        'Take a clearer photo.', 1, '2026-08-01T00:03:00.000Z')`)
      .run();
  });
  const { payload } = await postActions(route, [{
    clientActionId: "action-finish-photo-race",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(payload.results[0].status, "conflict");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision, updated_at
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 5, updated_at: "initial" },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, revision, completed_at, updated_at
      FROM trade_crm_appointments WHERE id = 'appointment-1'`).get() },
    {
      status: "in_progress",
      revision: 1,
      completed_at: "",
      updated_at: "initial",
    },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, result_revision
      FROM trade_offline_actions
      WHERE client_action_id = 'action-finish-photo-race'`).get() },
    { status: "conflict", result_revision: 5 },
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    0,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
    0,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count,
    0,
  );
});
