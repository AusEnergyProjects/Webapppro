import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

const fieldSource = fs.readFileSync(new URL("../src/app/api/trade-field-work/route.ts", import.meta.url), "utf8");
const syncSource = fs.readFileSync(new URL("../src/app/api/trade-team/sync/route.ts", import.meta.url), "utf8");

function compile(source, fileName, mocks) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function access(overrides = {}) {
  return {
    ownerUid: "owner-1", actorUid: "actor-1", memberId: "member-1",
    displayName: "Technician", isOwner: false, canViewFieldEvidence: true,
    canManageFieldEvidence: false, jobScope: "own", ...overrides,
  };
}

function acceptedJob(overrides = {}) {
  return {
    id: "job-1", firebase_uid: "owner-1", work_number: "JOB-1042",
    title: "Customer heat-pump quote", service_category: "Heating and cooling",
    site_area: "Ballarat VIC", stage: "scheduled", priority: "normal",
    scheduled_start: "2026-08-13T00:00:00.000Z", scheduled_end: "2026-08-13T02:00:00.000Z",
    assignee_member_id: "member-1", assignee_label: "Technician", source_type: "public_lead",
    revision: 4, updated_at: "2026-08-12T00:00:00.000Z", record_status: "active",
    partner_type: "installer", customer_source: "public_lead_released",
    description: "Inspect the customer property and prepare the draft quote.",
    customer_name: "Jane Customer", customer_phone: "0400 111 222",
    site_label: "Customer property", address_line_1: "10 Main Street", address_line_2: "",
    suburb: "Ballarat", address_state: "VIC", postcode: "3350",
    appointment_id: "appointment-1", appointment_status: "scheduled",
    starts_at: "2026-08-13T00:00:00.000Z", ends_at: "2026-08-13T02:00:00.000Z",
    appointment_starts_at: "2026-08-13T00:00:00.000Z", appointment_ends_at: "2026-08-13T02:00:00.000Z",
    travel_started_at: "", arrived_at: "", work_started_at: "", completed_at: "", open_issues: 0,
    ...overrides,
  };
}

function assigned(accessRecord, jobs, workOrderId) {
  const row = jobs.find((item) => item.id === workOrderId && item.firebase_uid === accessRecord.ownerUid
    && item.record_status === "active");
  if (!row) throw new Error("JOB_NOT_FOUND");
  if (!accessRecord.isOwner && accessRecord.jobScope === "own"
    && row.assignee_member_id !== accessRecord.memberId) throw new Error("JOB_NOT_ASSIGNED");
  return row;
}

function fieldRoute(accessRecord, jobs) {
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async all() { return { results: [] }; }
    async first() {
      if (this.sql.includes("SELECT w.id, w.work_number")) {
        return jobs.find((row) => row.id === this.values[0] && row.firebase_uid === this.values[1]) || null;
      }
      if (this.sql.includes("SELECT COUNT(*) count")) return { count: 0 };
      return null;
    }
  }
  const db = { prepare: (sql) => new Statement(sql) };
  return compile(fieldSource, "src/app/api/trade-field-work/route.ts", {
    "cloudflare:workers": { env: {} }, "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum), sameOrigin: () => true },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => accessRecord,
      assignedJob: async (_access, workOrderId) => assigned(accessRecord, jobs, workOrderId) },
    "@/lib/trade-team-sync-server": { jobSyncChangeStatements: () => [], nextJobRevision: (value) => Number(value) + 1 },
    "@/lib/photo-request-review-server": { photoRequestProofOverview: async () => ({ proofReady: true }) },
    "@/lib/trade-photo-requests": { normalisePhotoRequirements: (value) => value },
    "@/lib/trade-crm-job-media-cleanup": { drainTradeCrmJobMediaCleanup: async () => ({ processed: 0 }) },
    "@/lib/trade-rental-image-dimensions.mjs": { rentalImageWithinReportLimit: () => true },
    "@/lib/trade-rental-evidence.mjs": { rentalEvidencePhotoCapture: () => ({}) },
    "@/lib/bounded-json-request": { BoundedJsonRequestError: class extends Error {}, readBoundedJsonRequest: async (request) => request.json() },
  });
}

function syncRoute(accessRecord, jobs) {
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return this.sql.includes("COALESCE(MAX(sequence)") ? { sequence: 0 } : null; }
    async all() {
      if (this.sql.includes("SELECT w.id, w.work_number")) {
        return { results: jobs.filter((row) => row.firebase_uid === accessRecord.ownerUid
          && (accessRecord.jobScope !== "own" || row.assignee_member_id === accessRecord.memberId)) };
      }
      return { results: [] };
    }
  }
  const db = { prepare: (sql) => new Statement(sql) };
  return compile(syncSource, "src/app/api/trade-team/sync/route.ts", {
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": { adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum), sameOrigin: () => true },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => accessRecord,
      assignedJob: async (_access, workOrderId) => assigned(accessRecord, jobs, workOrderId) },
    "@/lib/trade-team-sync-server": { nextJobRevision: (value) => Number(value) + 1 },
    "@/lib/trade-mobile-server": { MOBILE_CLIENT_ID_PATTERN: /^[A-Za-z0-9_-]+$/, MOBILE_CONTRACT_VERSION: 3,
      mobileAppPolicy: () => ({ maxPersonalDataAgeSeconds: 86_400 }), mobileErrorResponse: () => null,
      requireRegisteredMobileDevice: async () => ({ deviceId: "device-1", deviceName: "Field phone", platform: "ios" }) },
    "@/lib/trade-form-library.mjs": { normalizeTradeFormAnswers: (value) => value, tradeFormCompletion: () => ({ ready: true, missing: [] }) },
    "@/lib/asset-lifecycle.mjs": { addMonthsToIsoDate: (value) => value },
    "@/lib/photo-request-review": { photoRequestEvidenceKey: () => "evidence" },
    "@/lib/trade-photo-requests": { normalisePhotoRequirements: (value) => value },
    "@/lib/bounded-json-request": { BoundedJsonRequestError: class extends Error {}, readBoundedJsonRequest: async (request) => request.json() },
    "@/lib/creditex-activity-work-pack-server": {
      listAssignedCreditexActivityWorkPacks: async () => [],
    },
    "@/lib/creditex-work-pack-schema-guards": {
      ensureCreditexWorkPackSchemaGuards: async () => {},
    },
    "@/lib/creditex-compliance-server": {
      reconcileReadyPlannedComplianceWorkPacks: async () => [],
    },
  });
}

function assertCustomerContext(entity) {
  if (Object.hasOwn(entity, "protectedJob")) assert.equal(entity.protectedJob, false);
  assert.equal(entity.title, "Customer heat-pump quote");
  assert.equal(entity.customerName, "Jane Customer");
  assert.equal(entity.customerPhone || entity.phone, "0400 111 222");
  assert.equal(entity.serviceAddress || entity.address, "10 Main Street, Ballarat, VIC, 3350");
}

test("assigned own-scope and team-scope field routes expose accepted lead customer context", async () => {
  const job = acceptedJob();
  for (const accessRecord of [access(), access({ memberId: "dispatcher-1", jobScope: "team" })]) {
    const response = await fieldRoute(accessRecord, [job]).GET(new Request("https://test/api/trade-field-work?workOrderId=job-1"));
    assert.equal(response.status, 200);
    assertCustomerContext((await response.json()).fieldJob);
  }
  const denied = await fieldRoute(access({ memberId: "other-member" }), [job]).GET(
    new Request("https://test/api/trade-field-work?workOrderId=job-1"),
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).fieldJob, undefined);
});

test("assigned own-scope and team-scope mobile sync exposes accepted lead context with 24-hour PII purge", async () => {
  const job = acceptedJob();
  for (const accessRecord of [access(), access({ memberId: "dispatcher-1", jobScope: "team" })]) {
    const response = await syncRoute(accessRecord, [job]).GET(new Request("https://test/api/trade-team/sync?deviceId=device-1"));
    assert.equal(response.status, 200);
    const entity = (await response.json()).changes[0].entity;
    assertCustomerContext(entity);
    assert.equal(entity.offlinePolicy.containsPersonalData, true);
    assert.equal(entity.offlinePolicy.maxAgeSeconds, 86_400);
    assert.equal(entity.offlinePolicy.purgeWhenUnassigned, true);
  }
  const denied = await syncRoute(access({ memberId: "other-member" }), [job]).GET(
    new Request("https://test/api/trade-team/sync?deviceId=device-1"),
  );
  assert.deepEqual((await denied.json()).changes, []);
});

test("platform-private and opportunity jobs remain masked in field and mobile projections", async () => {
  const privateJob = acceptedJob({ id: "private-job", customer_source: "platform_private", source_type: "internal" });
  const opportunity = acceptedJob({ id: "opportunity-job", customer_source: "public_lead_released", source_type: "opportunity" });
  for (const job of [privateJob, opportunity]) {
    const fieldResponse = await fieldRoute(access(), [job]).GET(new Request(`https://test/api/trade-field-work?workOrderId=${job.id}`));
    const fieldPayload = await fieldResponse.json();
    assert.equal(fieldPayload.protectedJob, true);
    const fieldJob = fieldPayload.fieldJob;
    assert.equal(fieldJob.title, "Assigned field job");
    assert.equal(fieldJob.phone, "");
    assert.equal(fieldJob.address, "");
    const syncResponse = await syncRoute(access(), [job]).GET(new Request("https://test/api/trade-team/sync?deviceId=device-1"));
    const entity = (await syncResponse.json()).changes[0].entity;
    assert.equal(entity.protectedJob, true);
    assert.equal(entity.customerPhone, "");
    assert.equal(entity.serviceAddress, "");
    assert.equal(entity.description, "");
  }
  assert.match(fieldSource, /if \(protectedJob\(job\) && signerRole === "customer"\)/);
});
