import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";
import * as templates from "../src/lib/trade-rental-assessment.mjs";
import * as evidence from "../src/lib/trade-rental-evidence.mjs";
import * as workflow from "../src/lib/rental-assessor-workflow.mjs";
import * as quotation from "../src/lib/rental-quotation.mjs";

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE trade_work_orders (id TEXT, firebase_uid TEXT, revision INTEGER, stage TEXT, record_status TEXT, assignee_member_id TEXT);
    INSERT INTO trade_work_orders VALUES ('job','owner',12,'completed','active','assessor');
    CREATE TABLE trade_rental_inspections (id TEXT, work_order_id TEXT, firebase_uid TEXT, inspection_number TEXT,
      jurisdiction TEXT, status TEXT, template_key TEXT, template_version INTEGER, rules_effective_from TEXT,
      assessment_scope TEXT, selected_modules_snapshot TEXT, property_snapshot TEXT, assessor_snapshot TEXT,
      assessor_member_id TEXT, revision INTEGER, submitted_at TEXT, issued_at TEXT, issued_report_id TEXT,
      created_at TEXT, updated_at TEXT);
    INSERT INTO trade_rental_inspections VALUES ('inspection','job','owner','RMS-TEST','VIC','issued',
      'vic-rental-minimum-standards',4,'2026-06-30','current_minimum_standards','[]',
      '{"customerName":"Original customer"}','{"displayName":"Original assessor"}','assessor',7,
      '2026-10-09T02:00:00Z','2026-10-09T03:00:00Z','report-r2','2026-10-08T23:00:00Z','2026-10-09T03:00:00Z');
    CREATE TABLE trade_rental_inspection_modules (id TEXT, inspection_id TEXT, firebase_uid TEXT, selected_required INTEGER, created_at TEXT);
    CREATE TABLE trade_rental_inspection_items (id TEXT, inspection_id TEXT, firebase_uid TEXT, sort_order INTEGER, created_at TEXT);
    CREATE TABLE trade_rental_findings (id TEXT, inspection_id TEXT, firebase_uid TEXT, sort_order INTEGER, created_at TEXT);
    CREATE TABLE trade_rental_evidence_links (id TEXT, inspection_id TEXT, firebase_uid TEXT, job_media_id TEXT, sort_order INTEGER, created_at TEXT);
    CREATE TABLE trade_crm_job_media (id TEXT, firebase_uid TEXT, file_name TEXT, content_type TEXT, size_bytes INTEGER, evidence_envelope TEXT);
  `);
  function statement(query, bindings = []) {
    return { bind: (...values) => statement(query, values),
      async first() { return sql.prepare(query).get(...bindings) || null; },
      async all() { return { results: sql.prepare(query).all(...bindings) }; },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...bindings).changes) } }; } };
  }
  const d1 = { prepare: statement };
  const snapshot = () => ({
    job: { ...sql.prepare("SELECT * FROM trade_work_orders").get() },
    inspection: { ...sql.prepare("SELECT * FROM trade_rental_inspections").get() },
  });
  return { sql, d1, snapshot };
}

const heldReview = { status: "held", message: "Waiting for owner review.", at: "2026-10-09T03:01:00Z" };
const correctedReport = { reportId: "report-r3", reportNumber: "RMS-TEST-R3", status: "issued" };

function loadRoute(f, options = {}) {
  const access = { ownerUid: "owner", actorUid: "owner", memberId: "owner-member", isOwner: true,
    canManageFieldEvidence: true, canViewFieldEvidence: true, canRunReports: true, ...options.permissions };
  const calls = { correction: [], coolingCorrection: [], email: 0, issuance: 0, reconcile: 0, lifetime: [] };
  const dependencies = {
    "cloudflare:workers": { waitUntil: (promise) => { calls.lifetime.push(promise); options.onWaitUntil?.(promise); } },
    "@/lib/trade-form-job-progress": { reconcileTradeFormJobProgress: async () => { calls.reconcile++; return { stage: "completed" }; } },
    "../../../../db": { getD1: () => f.d1 },
    "@/lib/admin-server": { mfaErrorResponse, adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, max) => String(value ?? "").trim().slice(0, max), sameOrigin: () => true },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access, assignedJob: async (_, id) => {
      const job = f.sql.prepare("SELECT * FROM trade_work_orders WHERE id = ? AND firebase_uid = ?").get(id, access.ownerUid);
      if (!job) throw new Error("JOB_NOT_FOUND");
      return job;
    } },
    "@/lib/trade-team-sync-server": {},
    "@/lib/trade-rental-assessment.mjs": templates,
    "@/lib/trade-rental-evidence.mjs": evidence,
    "@/lib/rental-assessor-workflow.mjs": workflow,
    "@/lib/rental-quotation.mjs": quotation,
    "@/lib/trade-rental-credentials": {},
    "@/lib/trade-rental-schema-guards": { ensureTradeRentalSchemaGuards: async () => {} },
    "@/lib/bounded-json-request": { BoundedJsonRequestError: class extends Error {}, readBoundedJsonRequest: (request) => request.json() },
    "@/lib/trade-rental-report-email-server": {
      rentalReportDeliveryRecipient: async () => null, rentalReportDeliveryState: async () => null,
      rentalReportDeliveryReview: async () => options.review === undefined ? heldReview : options.review,
      emailRentalAssessmentReport: async () => { calls.email++; return { status: "accepted" }; },
    },
    "@/lib/trade-rental-report-server": {
      ownerRentalReportPresentation: async () => {
        if (options.reports) return options.reports;
        const currentReportId = f.snapshot().inspection.issued_report_id;
        return currentReportId === "report-r2" ? [{ id: "report-r2", status: "issued" }]
          : [{ id: currentReportId, status: "issued" }, { id: "report-r2", status: "issued" }];
      },
      correctRentalAssessmentReportFormatting: async (input) => {
        calls.correction.push(input);
        if (options.correct) return options.correct(input);
        f.sql.exec("UPDATE trade_rental_inspections SET issued_report_id='report-r3', revision=revision+1");
        return correctedReport;
      },
      correctRentalAssessmentCoolingAccess: async (input) => {
        calls.coolingCorrection.push(input);
        if (!options.correctCooling) throw new Error("Cooling correction service was not configured for this test");
        return options.correctCooling(input);
      },
      issueRentalAssessmentReport: async () => { calls.issuance++; return {}; },
    },
  };
  const source = fs.readFileSync(new URL("../src/app/api/trade-rental-inspections/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected route dependency: ${id}`);
    return dependencies[id];
  }, moduleRecord, moduleRecord.exports);
  return { ...moduleRecord.exports, access, calls };
}

const requestBody = { workOrderId: "job", action: "correct_report_formatting", reportId: "report-r2", expectedInspectionRevision: 7 };
const coolingRequestBody = { ...requestBody, action: "correct_cooling_access" };
const post = (route, body = requestBody, signal) => route.POST(new Request("https://test.example/api/trade-rental-inspections", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
}));
const get = (route) => route.GET(new Request("https://test.example/api/trade-rental-inspections?workOrderId=job"));

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

test("formatting correction is an owner report action without reopening the completed assessment or sending email", async () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    const route = loadRoute(f);
    const response = await post(route);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const payload = await response.json();
    assert.deepEqual(payload.correctedReport, correctedReport);
    assert.equal(payload.inspection.issuedReportId, "report-r3");
    assert.deepEqual(payload.reports.map((report) => report.id), ["report-r3", "report-r2"], "The response reloads the corrected report and original history");
    assert.equal(payload.inspection.status, "issued");
    assert.equal(payload.permissions.canEdit, false);
    assert.equal(payload.permissions.canIssue, false, "The owner never becomes the assigned assessor");
    assert.deepEqual(payload.deliveryReview, heldReview);
    assert.equal(route.calls.correction.length, 1);
    assert.deepEqual(route.calls.correction[0], { access: route.access, workOrderId: "job", reportId: "report-r2",
      expectedInspectionRevision: 7, origin: "https://test.example" });
    assert.equal(route.calls.email, 0);
    assert.equal(route.calls.issuance, 0);
    assert.equal(route.calls.reconcile, 0, "A formatting-only correction does not transition an already completed job");
    assert.equal(route.calls.lifetime.length, 1);
    assert.deepEqual(f.snapshot().job, before.job);
    assert.equal(f.snapshot().inspection.assessor_snapshot, before.inspection.assessor_snapshot);
    assert.equal(f.snapshot().inspection.property_snapshot, before.inspection.property_snapshot);
    const edit = await post(route, { workOrderId: "job", action: "save_item" });
    assert.equal(edit.status, 409, "Normal assessment edits remain locked after a report correction");
  } finally { f.sql.close(); }
});

test("the review payload exposes correction only to the actual owner with both required permissions", async () => {
  for (const permissions of [
    {},
    { isOwner: false, actorUid: "assessor-uid", memberId: "assessor" },
    { actorUid: "another-user" },
    { canRunReports: false },
    { canManageFieldEvidence: false },
  ]) {
    const f = fixture();
    try {
      const route = loadRoute(f, { permissions });
      const response = await get(route);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.permissions.canCorrectReportFormatting, Object.keys(permissions).length === 0, JSON.stringify(permissions));
      assert.equal(payload.permissions.canEdit, false);
      assert.equal(payload.formattingRevisionPending, false);
      assert.equal(route.calls.correction.length, 0);
    } finally { f.sql.close(); }
  }
});

test("the review payload distinguishes a staged corrected PDF while keeping the inspection and job completed", async () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    const route = loadRoute(f, { reports: [{ id: "report-r2", status: "issued" }, { id: "report-r3", status: "staged" }] });
    const response = await get(route);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.formattingRevisionPending, true);
    assert.equal(payload.inspection.status, "issued");
    assert.equal(payload.inspection.issuedReportId, "report-r2");
    assert.equal(payload.permissions.canEdit, false);
    assert.deepEqual(payload.deliveryReview, heldReview);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(route.calls.correction.length, 0);
    assert.equal(route.calls.email, 0);
  } finally { f.sql.close(); }
});

test("team members and owners without report or evidence-management permission cannot correct an issued report", async () => {
  for (const permissions of [
    { isOwner: false, actorUid: "assessor-uid", memberId: "assessor" },
    { actorUid: "other-user" },
    { canRunReports: false },
    { canManageFieldEvidence: false },
  ]) {
    const f = fixture();
    try {
      const before = f.snapshot();
      const route = loadRoute(f, { permissions });
      const response = await post(route);
      assert.equal(response.status, 403, JSON.stringify(permissions));
      assert.equal(route.calls.correction.length, 0);
      assert.equal(route.calls.lifetime.length, 0);
      assert.deepEqual(f.snapshot(), before);
    } finally { f.sql.close(); }
  }
});

test("a different business owner cannot reach the formatting correction service", async () => {
  const f = fixture();
  try {
    const route = loadRoute(f, { permissions: { ownerUid: "another-owner", actorUid: "another-owner" } });
    const response = await post(route);
    assert.equal(response.status, 404);
    assert.equal(route.calls.correction.length, 0);
    assert.equal(route.calls.lifetime.length, 0);
  } finally { f.sql.close(); }
});

test("formatting correction validates report and revision before starting durable work", async () => {
  for (const body of [
    { ...requestBody, expectedInspectionRevision: undefined },
    { ...requestBody, expectedInspectionRevision: "7" },
    { ...requestBody, expectedInspectionRevision: null },
    { ...requestBody, expectedInspectionRevision: 7.5 },
    { ...requestBody, expectedInspectionRevision: -1 },
    { ...requestBody, reportId: undefined },
    { ...requestBody, reportId: " " },
  ]) {
    const f = fixture();
    try {
      const route = loadRoute(f);
      const response = await post(route, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(route.calls.correction.length, 0);
      assert.equal(route.calls.lifetime.length, 0);
    } finally { f.sql.close(); }
  }
});

test("a valid stale inspection revision cannot create a formatting revision", async () => {
  for (const expectedInspectionRevision of [6, 8]) {
    const f = fixture();
    try {
      const route = loadRoute(f);
      const response = await post(route, { ...requestBody, expectedInspectionRevision });
      assert.equal(response.status, 409, String(expectedInspectionRevision));
      assert.equal(route.calls.correction.length, 0);
      assert.equal(route.calls.lifetime.length, 0);
    } finally { f.sql.close(); }
  }
});

test("correction service boundary failures remain blocked and return an actionable conflict or pending response", async () => {
  for (const [code, status] of [
    ["REPORT_DELIVERY_OWNER_REQUIRED", 403],
    ["REPORT_DELIVERY_REVIEW_REQUIRED", 409],
    ["REPORT_DELIVERY_ALREADY_SENDING", 409],
    ["RENTAL_REPORT_FORMATTING_CONFLICT", 409],
    ["RENTAL_REPORT_FORMATTING_PENDING", 503],
  ]) {
    const f = fixture();
    try {
      const before = f.snapshot();
      const route = loadRoute(f, { correct: async () => { throw new Error(code); },
        onWaitUntil: (promise) => { void promise.catch(() => {}); } });
      const response = await post(route);
      assert.equal(response.status, status, code);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(typeof payload.error, "string");
      assert.ok(payload.error.length > 0);
      if (code === "RENTAL_REPORT_FORMATTING_PENDING") assert.equal(payload.code, code);
      assert.deepEqual(f.snapshot(), before);
      assert.equal(route.calls.email, 0);
      assert.equal(route.calls.reconcile, 0);
      await assert.rejects(route.calls.lifetime[0], (error) => error.message === code);
    } finally { f.sql.close(); }
  }
});

test("a timed-out owner request cannot cancel or duplicate the protected formatting revision", async () => {
  const f = fixture();
  const correction = deferred();
  const registered = deferred();
  try {
    const route = loadRoute(f, { correct: () => correction.promise, onWaitUntil: () => registered.resolve() });
    const abort = new AbortController();
    let completed = false;
    const responsePromise = post(route, requestBody, abort.signal).then((response) => { completed = true; return response; });
    await registered.promise;
    assert.equal(route.calls.correction.length, 1);
    assert.equal(route.calls.lifetime.length, 1);
    abort.abort();
    await Promise.resolve();
    assert.equal(completed, false, "The route must not return success before the actual correction completes");
    f.sql.exec("UPDATE trade_rental_inspections SET issued_report_id='report-r3', revision=revision+1");
    correction.resolve(correctedReport);
    const response = await responsePromise;
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.correctedReport, correctedReport);
    assert.equal(payload.inspection.issuedReportId, "report-r3");
    assert.equal(await route.calls.lifetime[0], response, "waitUntil protects the exact response work that is awaited");
    assert.equal(route.calls.correction.length, 1);
    assert.equal(route.calls.email, 0);
    assert.equal(route.calls.reconcile, 0);
  } finally { f.sql.close(); }
});

test("a failed durable formatting correction returns an error instead of a false issued result", async () => {
  const f = fixture();
  const correction = deferred();
  const registered = deferred();
  try {
    const route = loadRoute(f, { correct: () => correction.promise, onWaitUntil: (promise) => {
      void promise.catch(() => {});
      registered.resolve();
    } });
    const before = f.snapshot();
    const responsePromise = post(route);
    await registered.promise;
    correction.reject(new Error("RENTAL_REPORT_STORAGE_UNAVAILABLE"));
    const response = await responsePromise;
    assert.equal(response.status, 503);
    assert.equal((await response.json()).ok, false);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(route.calls.email, 0);
    assert.equal(route.calls.reconcile, 0);
    await assert.rejects(route.calls.lifetime[0], /RENTAL_REPORT_STORAGE_UNAVAILABLE/);
  } finally { f.sql.close(); }
});

test("the owner delegates only the fixed cooling access correction on a completed job and reloads the held report history", async () => {
  const f = fixture();
  const coolingReport = { reportId: "report-r4", reportNumber: "RMS-TEST-R4", status: "issued" };
  try {
    const before = f.snapshot();
    const route = loadRoute(f, { correctCooling: async () => {
      // This route fixture simulates the service committing a revision. The service tests verify its exact frozen-answer change.
      f.sql.exec("UPDATE trade_rental_inspections SET issued_report_id='report-r4', revision=revision+1");
      return coolingReport;
    } });
    const response = await post(route, { ...coolingRequestBody, accessStatus: "Cannot access", limitationStatus: "No limitation",
      outcome: "Meets", itemId: "unrelated-item", answers: { arbitrary: "Must not be forwarded" } });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const payload = await response.json();
    assert.deepEqual(route.calls.coolingCorrection, [{ access: route.access, workOrderId: "job", reportId: "report-r2",
      expectedInspectionRevision: 7, origin: "https://test.example" }], "Client values cannot broaden the fixed service action");
    assert.deepEqual(payload.correctedReport, coolingReport);
    assert.equal(payload.inspection.issuedReportId, "report-r4");
    assert.deepEqual(payload.reports.map((report) => report.id), ["report-r4", "report-r2"]);
    assert.equal(payload.inspection.status, "issued");
    assert.equal(payload.permissions.canEdit, false);
    assert.equal(payload.permissions.canIssue, false);
    assert.deepEqual(payload.deliveryReview, heldReview);
    assert.equal(route.calls.correction.length, 0, "Cooling access correction must not use the formatting-only service");
    assert.equal(route.calls.email, 0);
    assert.equal(route.calls.issuance, 0);
    assert.equal(route.calls.reconcile, 0);
    assert.equal(route.calls.lifetime.length, 1);
    assert.deepEqual(f.snapshot().job, before.job);
    const { issued_report_id, revision, ...inspectionFacts } = f.snapshot().inspection;
    const { issued_report_id: previousReportId, revision: previousRevision, ...previousFacts } = before.inspection;
    assert.equal(issued_report_id, "report-r4");
    assert.equal(revision, previousRevision + 1);
    assert.equal(previousReportId, "report-r2");
    assert.deepEqual(inspectionFacts, previousFacts, "The route itself does not change source answers or assessor facts");
    assert.equal((await post(route, { workOrderId: "job", action: "save_item" })).status, 409);
  } finally { f.sql.close(); }
});

test("cooling access correction rejects unauthorized actors and other businesses before invoking the service", async () => {
  for (const [permissions, status] of [
    [{ isOwner: false, actorUid: "assessor-uid", memberId: "assessor" }, 403],
    [{ actorUid: "other-user" }, 403],
    [{ canRunReports: false }, 403],
    [{ canManageFieldEvidence: false }, 403],
    [{ ownerUid: "other-business", actorUid: "other-business" }, 404],
  ]) {
    const f = fixture();
    try {
      const before = f.snapshot();
      const route = loadRoute(f, { permissions });
      const response = await post(route, coolingRequestBody);
      assert.equal(response.status, status, JSON.stringify(permissions));
      assert.equal(route.calls.coolingCorrection.length, 0);
      assert.equal(route.calls.correction.length, 0);
      assert.equal(route.calls.lifetime.length, 0);
      assert.deepEqual(f.snapshot(), before);
    } finally { f.sql.close(); }
  }
});

test("cooling access correction validates its source report and inspection revision before durable work", async () => {
  for (const [fields, status] of [
    [{ expectedInspectionRevision: undefined }, 400],
    [{ expectedInspectionRevision: "7" }, 400],
    [{ expectedInspectionRevision: null }, 400],
    [{ expectedInspectionRevision: 7.5 }, 400],
    [{ expectedInspectionRevision: -1 }, 400],
    [{ reportId: undefined }, 400],
    [{ reportId: " " }, 400],
    [{ expectedInspectionRevision: 6 }, 409],
    [{ expectedInspectionRevision: 8 }, 409],
  ]) {
    const f = fixture();
    try {
      const before = f.snapshot();
      const route = loadRoute(f);
      const response = await post(route, { ...coolingRequestBody, ...fields });
      assert.equal(response.status, status, JSON.stringify(fields));
      assert.equal(route.calls.coolingCorrection.length, 0);
      assert.equal(route.calls.correction.length, 0);
      assert.equal(route.calls.lifetime.length, 0);
      assert.deepEqual(f.snapshot(), before);
    } finally { f.sql.close(); }
  }
});

test("cooling access service conflicts, pending revisions, and failures never become false success or report email", async () => {
  for (const [code, status] of [
    ["REPORT_DELIVERY_OWNER_REQUIRED", 403],
    ["REPORT_DELIVERY_REVIEW_REQUIRED", 409],
    ["REPORT_DELIVERY_ALREADY_SENDING", 409],
    ["RENTAL_REPORT_FORMATTING_CONFLICT", 409],
    ["RENTAL_REPORT_COOLING_ACCESS_INVALID", 409],
    ["RENTAL_REPORT_FORMATTING_PENDING", 503],
    ["RENTAL_REPORT_STORAGE_UNAVAILABLE", 503],
  ]) {
    const f = fixture();
    try {
      const before = f.snapshot();
      const route = loadRoute(f, { correctCooling: async () => { throw new Error(code); },
        onWaitUntil: (promise) => { void promise.catch(() => {}); } });
      const response = await post(route, coolingRequestBody);
      assert.equal(response.status, status, code);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.ok(payload.error.length > 0);
      if (code === "RENTAL_REPORT_FORMATTING_PENDING") assert.equal(payload.code, code);
      assert.equal(route.calls.coolingCorrection.length, 1);
      assert.equal(route.calls.correction.length, 0);
      assert.equal(route.calls.email, 0);
      assert.equal(route.calls.issuance, 0);
      assert.equal(route.calls.reconcile, 0);
      assert.deepEqual(f.snapshot(), before);
      await assert.rejects(route.calls.lifetime[0], (error) => error.message === code);
    } finally { f.sql.close(); }
  }
});

test("the cooling access correction survives request cancellation and awaits the exact protected revision work", async () => {
  const f = fixture();
  const correction = deferred();
  const registered = deferred();
  const coolingReport = { reportId: "report-r4", reportNumber: "RMS-TEST-R4", status: "issued" };
  try {
    const route = loadRoute(f, { correctCooling: () => correction.promise, onWaitUntil: () => registered.resolve() });
    const abort = new AbortController();
    let completed = false;
    const responsePromise = post(route, coolingRequestBody, abort.signal).then((response) => { completed = true; return response; });
    await registered.promise;
    assert.equal(route.calls.coolingCorrection.length, 1);
    assert.equal(route.calls.lifetime.length, 1);
    abort.abort();
    await Promise.resolve();
    assert.equal(completed, false, "Success must wait for the service to commit the corrected revision");
    assert.equal(f.snapshot().inspection.issued_report_id, "report-r2");
    f.sql.exec("UPDATE trade_rental_inspections SET issued_report_id='report-r4', revision=revision+1");
    correction.resolve(coolingReport);
    const response = await responsePromise;
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.correctedReport, coolingReport);
    assert.equal(payload.inspection.issuedReportId, "report-r4");
    assert.deepEqual(payload.deliveryReview, heldReview);
    assert.equal(await route.calls.lifetime[0], response);
    assert.equal(route.calls.coolingCorrection.length, 1);
    assert.equal(route.calls.correction.length, 0);
    assert.equal(route.calls.email, 0);
    assert.equal(route.calls.issuance, 0);
    assert.equal(route.calls.reconcile, 0);
  } finally { f.sql.close(); }
});

test("a protected cooling access correction failure cannot advance the issued report pointer", async () => {
  const f = fixture();
  const correction = deferred();
  const registered = deferred();
  try {
    const before = f.snapshot();
    const route = loadRoute(f, { correctCooling: () => correction.promise, onWaitUntil: (promise) => {
      void promise.catch(() => {});
      registered.resolve();
    } });
    const responsePromise = post(route, coolingRequestBody);
    await registered.promise;
    correction.reject(new Error("RENTAL_REPORT_STORAGE_UNAVAILABLE"));
    const response = await responsePromise;
    assert.equal(response.status, 503);
    assert.equal((await response.json()).ok, false);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(route.calls.coolingCorrection.length, 1);
    assert.equal(route.calls.correction.length, 0);
    assert.equal(route.calls.email, 0);
    assert.equal(route.calls.reconcile, 0);
    await assert.rejects(route.calls.lifetime[0], /RENTAL_REPORT_STORAGE_UNAVAILABLE/);
  } finally { f.sql.close(); }
});
