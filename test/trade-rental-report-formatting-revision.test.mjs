import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { canonicalRentalJson, publicRentalReportValue, rentalReportExpiresAt } from "../src/lib/trade-rental-assessment.mjs";
import { TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS } from "../src/lib/trade-rental-schema-guards.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (value) => new TextEncoder().encode(value);

function loadTypescript(path, mocks) {
  const output = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", output)((name) => mocks[name] || {}, record, record.exports);
  return record.exports;
}

function d1For(sql) {
  const hooks = { beforeBatch: null, afterBatch: null };
  class Statement {
    constructor(query, values = []) { this.query = query; this.values = values; }
    bind(...values) { return new Statement(this.query, values); }
    async first() { return sql.prepare(this.query).get(...this.values) || null; }
    async all() { return { results: sql.prepare(this.query).all(...this.values) }; }
    runSync() { const result = sql.prepare(this.query).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
    async run() { return this.runSync(); }
  }
  return { hooks, prepare: (query) => new Statement(query), async batch(statements) {
    const before = hooks.beforeBatch; hooks.beforeBatch = null;
    if (before) await before(statements);
    sql.exec("BEGIN");
    let results;
    try { results = statements.map((statement) => statement.runSync()); sql.exec("COMMIT"); }
    catch (error) { sql.exec("ROLLBACK"); throw error; }
    const after = hooks.afterBatch; hooks.afterBatch = null;
    if (after) await after(statements);
    return results;
  } };
}

async function fixture({ cooling = false, coolingCount = 1, coolingAccess = "Not accessed", coolingAppliance = "No fixed cooling", coolingLimitation = "No limitation", retainedAccess = "Not accessed", coolingFindingSnapshot = true } = {}) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT,stage TEXT,revision INTEGER,updated_at TEXT,assignee_member_id TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,service_site_id TEXT);
    CREATE TABLE trade_work_order_events(id TEXT,work_order_id TEXT,firebase_uid TEXT,event_type TEXT,summary TEXT NOT NULL,created_at TEXT);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT,firebase_uid TEXT,status TEXT);
    INSERT INTO trade_work_orders VALUES('job','owner','active','completed',12,'2026-10-09T01:00:00.000Z','worker');`);
  const migration = read("../drizzle/0160_trade_rental_inspections.sql");
  sql.exec(migration.slice(migration.indexOf("CREATE TABLE `trade_rental_inspections`")).replaceAll("--> statement-breakpoint", ""));
  sql.exec("ALTER TABLE trade_rental_inspections ADD COLUMN selected_modules_snapshot TEXT;");
  const originalIssuedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  sql.prepare(`INSERT INTO trade_rental_inspections(id,work_order_id,firebase_uid,inspection_number,status,template_key,
    template_version,rules_effective_from,module_selection_snapshot,property_snapshot,assessor_uid,assessor_member_id,
    assessor_snapshot,revision,issued_report_id,issued_at,created_by_uid,created_at,updated_at)
    VALUES('inspection','job','owner','RMS-TEST','issued','vic-rental-minimum-standards',1,'2026-06-30',
      '["minimum_standards"]','{"address":"Original property"}','worker-uid','worker','{"name":"Kris"}',7,'original',?,'owner',?,?)`)
    .run(originalIssuedAt, originalIssuedAt, originalIssuedAt);
  const evidenceBytes = encode("same retained photograph bytes");
  const evidenceHash = digest(evidenceBytes);
  const originalPdf = encode("%PDF-original immutable issued document");
  const originalPdfHash = digest(originalPdf);
  const originalPdfKey = `trade-issued-documents/rental-report/original/revision-2/${originalPdfHash}.pdf`;
  const evidenceKey = `trade-issued-documents/rental-report/original/revision-2/evidence/photo/${evidenceHash}-original.jpg`;
  const snapshot = {
    schemaVersion: "tlink-rental-report-v1",
    report: { id: "original", number: "RMS-TEST-R2", revision: 2, issuedAt: originalIssuedAt, generatedAt: originalIssuedAt, branding: "homestar" },
    property: { customerName: "Blain", address: "Original property", customerEmail: "client@example.test" },
    business: { name: "Original Business", abn: "73675233557" },
    inspection: { number: "RMS-TEST", assessmentDate: "2026-10-08" },
    issuer: { name: "Kris", declaration: "Original attestation", qualificationNumber: "Q-123", authenticatedAt: originalIssuedAt },
    modules: [{ id: "module", key: "minimum_standards", credential: { licence: "original licence" },
      answers: { inspectionDate: "2026-10-08", assessorDeclaration: true },
      sections: [{ key: "ceiling", items: [{ id: "item", checkKey: "insulation", response: { joistSpacingMm: "400" }, outcome: "could_not_check" }] }] }],
    findings: [{ id: "finding", itemId: "item", description: "Original saved finding" }],
    evidence: [{ id: "photo", itemId: "item", fileName: "original.jpg", contentType: "image/jpeg", originalSha256: evidenceHash,
      sizeBytes: evidenceBytes.byteLength, objectKey: evidenceKey, capture: { capturedAt: originalIssuedAt, source: "camera" }, caption: "Original caption" }],
    sources: [{ url: "https://example.test/original-standard", version: "original" }],
  };
  if (cooling) {
    snapshot.modules[0].sections.push({ key: "cooling", items: Array.from({ length: coolingCount }, (_, index) => ({
      id: `cooling-${index}`, checkKey: "cooling_2027_readiness", response: { applianceType: coolingAppliance, accessStatus: coolingAccess,
        limitationStatus: coolingLimitation, limitationReason: "Original reason", roomLengthMm: "4200" },
      outcome: "does_not_meet", answerLabel: "Work needed for the applicable 2027 requirement", publicNotes: "No cooling installed", historicalObservation: false,
    })) });
    snapshot.findings.push({ id: "cooling-finding", itemId: "cooling-0", description: "No fixed cooling", status: "recommendation",
      details: coolingFindingSnapshot
        ? { responseSnapshot: { applianceType: coolingAppliance, accessStatus: retainedAccess, limitationStatus: coolingLimitation, roomLengthMm: "4200" } }
        : { quotation: { measurements: "Original measurement note" } } });
  }
  const snapshotJson = canonicalRentalJson(snapshot);
  sql.prepare(`INSERT INTO trade_rental_reports(id,inspection_id,firebase_uid,report_number,revision,status,report_snapshot,
    source_snapshot_sha256,pdf_object_key,pdf_sha256,pdf_size_bytes,issued_by_uid,issued_by_member_id,issuer_snapshot,
    staged_at,issued_at,created_at,updated_at) VALUES('original','inspection','owner','RMS-TEST-R2',2,'issued',?,?,?,?,?,
      'worker-uid','worker',?,?,?,?,?)`).run(snapshotJson, digest(snapshotJson), originalPdfKey, originalPdfHash,
        originalPdf.byteLength, JSON.stringify(snapshot.issuer), originalIssuedAt, originalIssuedAt, originalIssuedAt, originalIssuedAt);
  sql.prepare(`INSERT INTO trade_rental_report_links(id,report_id,inspection_id,firebase_uid,token_hash,encrypted_token,
    expires_at,created_by_uid,created_at,updated_at) VALUES('old-link','original','inspection','owner',?,'retained-token',?,'worker-uid',?,?)`)
    .run(digest("test-secret"), rentalReportExpiresAt(originalIssuedAt), originalIssuedAt, originalIssuedAt);
  const d1 = d1For(sql);
  const objects = new Map([[originalPdfKey, originalPdf], [evidenceKey, evidenceBytes]]);
  const puts = [], deletes = [], rendered = [];
  const hooks = { render: null, failPut: false };
  const store = {
    async get(key) { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null; },
    async put(key, value) { if (hooks.failPut) throw new Error("storage write failed"); const bytes = new Uint8Array(value); objects.set(key, bytes); puts.push(key); },
    async delete(key) { deletes.push(key); objects.delete(key); },
  };
  const issuedStore = loadTypescript("../src/lib/trade-issued-document-store.ts", { "cloudflare:workers": { env: { EVIDENCE: store } } });
  const realSync = loadTypescript("../src/lib/trade-team-sync-server.ts", {});
  const guardNames = new Set([
    "trade_rental_inspections_issue_transition_guard", "trade_rental_inspections_terminal_immutable", "trade_rental_inspections_terminal_transition_guard",
    "trade_rental_reports_identity_immutable", "trade_rental_reports_terminal_immutable", "trade_rental_reports_transition_guard",
    "trade_rental_reports_parent_guard_insert", "trade_rental_report_links_parent_guard_insert",
    "trade_rental_events_parent_guard_insert", "trade_rental_events_append_only_update", "trade_rental_events_append_only_delete",
    "trade_rental_formatting_request_guard_insert", "trade_rental_formatting_issued_guard_insert",
    "trade_rental_answer_request_guard_insert", "trade_rental_answer_issued_guard_insert",
  ]);
  for (const definition of TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS) if (guardNames.has(definition.name)) sql.exec(definition.sql);
  const access = { ownerUid: "owner", actorUid: "owner", memberId: "owner-member", isOwner: true, canRunReports: true, canManageFieldEvidence: true, displayName: "James" };
  const api = loadTypescript("../src/lib/trade-rental-report-server.ts", {
    "cloudflare:workers": { env: { EVIDENCE: store } }, "../../db": { getD1: () => d1 },
    "@/lib/trade-team-server": { async assignedJob(caller, id) {
      const row = sql.prepare("SELECT * FROM trade_work_orders WHERE id=? AND firebase_uid=? AND record_status='active'").get(id, caller.ownerUid);
      if (!row) throw new Error("JOB_NOT_FOUND"); return row;
    } },
    "@/lib/trade-team-sync-server": { nextJobRevision: realSync.nextJobRevision,
      guardedOnlineJobMutationBatch: realSync.guardedOnlineJobMutationBatch, jobSyncChangeStatements: () => [] },
    "@/lib/trade-rental-assessment.mjs": { canonicalRentalJson, publicRentalReportValue, rentalReportExpiresAt },
    "@/lib/trade-issued-document-store": issuedStore,
    "@/lib/trade-rental-schema-guards": { ensureTradeRentalSchemaGuards: async () => {} },
    "@/lib/customer-plan-pdf-fonts": { loadCustomerPlanPdfFonts: async () => undefined },
    "@/lib/trade-rental-report-brand": { rentalReportBrandBytes: () => undefined },
    "@/lib/trade-rental-report-pdf.mjs": { async createRentalAssessmentPdfBytes(report) {
      rendered.push(structuredClone(report)); if (hooks.render) await hooks.render(report);
      return encode(`%PDF-corrected ${report.report.number}`);
    } },
    "@/lib/trade-rental-report-links": { newRentalReportSecret: () => crypto.randomUUID(), hashRentalReportSecret: async (value) => digest(value),
      protectRentalReportSecret: async () => "retained-token", recoverRentalReportSecret: async () => "test-secret",
      rentalReportPath: (id, secret) => `/rental-report/${id}.${secret}`,
      splitRentalReportToken: (value) => { const [linkId, secret] = value.split("."); return { linkId, secret }; } },
  });
  function event(type, metadata = {}, requestId = crypto.randomUUID()) {
    sql.prepare(`INSERT INTO trade_rental_inspection_events(id,inspection_id,report_id,firebase_uid,actor_type,actor_uid,event_type,request_id,metadata,created_at)
      VALUES(?,'inspection','original','owner','owner','owner',?,?,?,?)`).run(crypto.randomUUID(), type, requestId, JSON.stringify(metadata), new Date().toISOString());
  }
  event("report_email_review_held");
  const input = { access, workOrderId: "job", reportId: "original", expectedInspectionRevision: 7, origin: "https://test.example" };
  return { sql, d1, api, access, input, objects, puts, deletes, rendered, hooks, snapshot, snapshotJson, originalIssuedAt,
    originalPdfKey, evidenceKey, event, correct: (change = {}) => api.correctRentalAssessmentReportFormatting({ ...input, ...change }),
    correctCooling: (change = {}) => api.correctRentalAssessmentCoolingAccess({ ...input, ...change }) };
}

test("owner formatting correction issues a new immutable revision with original answers, credentials, evidence and complete job", async () => {
  const f = await fixture();
  try {
    const original = f.sql.prepare("SELECT * FROM trade_rental_reports WHERE id='original'").get();
    const oldLink = f.sql.prepare("SELECT * FROM trade_rental_report_links WHERE id='old-link'").get();
    const before = f.sql.prepare("SELECT * FROM trade_rental_inspections").get();
    const result = await f.correct();
    assert.equal(result.revision, 3); assert.equal(result.reportNumber, "RMS-TEST-R3");
    assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_reports WHERE id='original'").get(), original);
    assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_report_links WHERE id='old-link'").get(), oldLink);
    const after = f.sql.prepare("SELECT * FROM trade_rental_inspections").get();
    assert.deepEqual({ ...after, issued_report_id: before.issued_report_id, revision: before.revision, updated_at: before.updated_at }, { ...before });
    assert.equal(after.status, "issued"); assert.equal(after.issued_report_id, result.reportId); assert.equal(after.revision, 8);
    const current = f.sql.prepare("SELECT * FROM trade_rental_reports WHERE id=?").get(result.reportId);
    assert.equal(current.issued_by_uid, "worker-uid"); assert.equal(current.issued_by_member_id, "worker");
    assert.equal(current.issuer_snapshot, original.issuer_snapshot);
    const corrected = JSON.parse(current.report_snapshot);
    assert.deepEqual({ ...corrected, report: f.snapshot.report, evidence: f.snapshot.evidence }, f.snapshot);
    assert.equal(corrected.issuer.authenticatedAt, f.originalIssuedAt);
    assert.equal(corrected.report.formattingCorrection.sourceReportId, "original");
    assert.equal(corrected.evidence[0].id, "photo"); assert.notEqual(corrected.evidence[0].objectKey, f.evidenceKey);
    assert.deepEqual(f.objects.get(corrected.evidence[0].objectKey), f.objects.get(f.evidenceKey));
    assert.equal(f.sql.prepare("SELECT stage,revision FROM trade_work_orders").get().stage, "completed");
    assert.equal(f.sql.prepare("SELECT event_type FROM trade_rental_inspection_events WHERE event_type LIKE 'report_email_review%' ORDER BY rowid DESC").get().event_type, "report_email_review_held");
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events WHERE event_type='report_email_requested'").get().count, 0);
    assert.equal(f.deletes.length, 0);
    assert.deepEqual((await f.api.authenticatedRentalReportPdf({ access: f.access, workOrderId: "job", reportId: "original" })).bytes, f.objects.get(f.originalPdfKey));
    const authorised = await f.api.authoriseRentalReportToken("old-link.test-secret");
    assert.equal(authorised.report_id, "original");
  } finally { f.sql.close(); }
});

test("correction replay returns its committed current revision without duplicate report, files or events", async () => {
  const f = await fixture();
  try {
    const first = await f.correct(); const counts = { puts: f.puts.length, events: f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events").get().count };
    const replay = await f.correct(); assert.equal(replay.reportId, first.reportId);
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_reports").get().count, 2);
    assert.equal(f.puts.length, counts.puts); assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events").get().count, counts.events);
  } finally { f.sql.close(); }
});

test("non-owner, impersonated owner, missing permission and cross-business access cannot correct a report", async () => {
  for (const change of [{ isOwner: false }, { actorUid: "worker-uid" }, { canRunReports: false }, { canManageFieldEvidence: false }, { ownerUid: "another-owner", actorUid: "another-owner" }]) {
    const f = await fixture();
    try {
      Object.assign(f.access, change);
      await assert.rejects(f.correct, /REPORT_DELIVERY_OWNER_REQUIRED|JOB_NOT_FOUND/);
      assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_reports").get().count, 1); assert.equal(f.puts.length, 0);
    } finally { f.sql.close(); }
  }
});

test("correction rejects stale inspection, wrong current report and noninteger revision without writing", async () => {
  for (const change of [{ expectedInspectionRevision: 6 }, { reportId: "another-report" }, { expectedInspectionRevision: "7" }, { expectedInspectionRevision: 0 }]) {
    const f = await fixture();
    try { await assert.rejects(() => f.correct(change), /RENTAL_REPORT_FORMATTING_CONFLICT/); assert.equal(f.puts.length, 0); }
    finally { f.sql.close(); }
  }
});

test("correction requires a held owner review and forbids accepted, in-flight and indeterminate delivery", async () => {
  for (const state of ["released", "accepted", "inflight", "indeterminate"]) {
    const f = await fixture();
    try {
      if (state === "released") f.event("report_email_review_released");
      else if (state === "accepted") f.event("report_email_accepted");
      else if (state === "inflight") f.event("report_email_requested", {}, "send:1");
      else f.event("report_email_failed", { outcome: "indeterminate" });
      await assert.rejects(f.correct, /REPORT_DELIVERY_REVIEW_REQUIRED|REPORT_DELIVERY_ALREADY_SENDING/);
      assert.equal(f.puts.length, 0); assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_reports").get().count, 1);
    } finally { f.sql.close(); }
  }
});

test("a known failed email attempt permits correction while review remains held", async () => {
  const f = await fixture();
  try { f.event("report_email_requested", {}, "send:1"); f.event("report_email_failed", { outcome: "failed" }, "send:1:failed"); assert.equal((await f.correct()).revision, 3); }
  finally { f.sql.close(); }
});

test("verified frozen source hash, existing PDF and evidence bytes are required", async () => {
  for (const state of ["snapshot", "pdf", "photo"]) {
    const f = await fixture();
    try {
      if (state === "snapshot") { f.sql.exec("DROP TRIGGER trade_rental_reports_identity_immutable; DROP TRIGGER trade_rental_reports_terminal_immutable;"); f.sql.exec("UPDATE trade_rental_reports SET source_snapshot_sha256='" + "0".repeat(64) + "'"); }
      if (state === "pdf") f.objects.set(f.originalPdfKey, encode("%PDF-altered"));
      if (state === "photo") f.objects.set(f.evidenceKey, encode("altered"));
      await assert.rejects(f.correct, /RENTAL_REPORT_INVALID|ISSUED_PDF_INTEGRITY|RENTAL_REPORT_EVIDENCE_INTEGRITY/);
      assert.equal(f.puts.length, 0); assert.equal(f.sql.prepare("SELECT issued_report_id FROM trade_rental_inspections").get().issued_report_id, "original");
    } finally { f.sql.close(); }
  }
});

test("render or object storage failure cleans only new objects and leaves original issued report/current pointer/job intact", async () => {
  for (const state of ["render", "storage"]) {
    const f = await fixture();
    try {
      if (state === "render") f.hooks.render = async () => { throw new Error("render failed"); };
      else f.hooks.failPut = true;
      await assert.rejects(f.correct, /render failed|storage write failed/);
      assert.equal(f.sql.prepare("SELECT status,issued_report_id,revision FROM trade_rental_inspections").get().issued_report_id, "original");
      assert.equal(f.sql.prepare("SELECT stage,revision FROM trade_work_orders").get().revision, 12);
      assert.equal(f.sql.prepare("SELECT status FROM trade_rental_reports WHERE id<>'original'").get().status, "failed");
      assert.ok(f.objects.has(f.originalPdfKey)); assert.ok(f.objects.has(f.evidenceKey));
      assert.ok(f.deletes.every((key) => !key.includes("/original/")));
    } finally { f.sql.close(); }
  }
});

test("review release, delivery claim or a newer inspection winning during render rolls back final commit", async () => {
  for (const state of ["release", "delivery", "inspection"]) {
    const f = await fixture();
    try {
      f.hooks.render = async () => {
        if (state === "release") f.event("report_email_review_released");
        if (state === "delivery") f.event("report_email_requested", {}, "racing-send");
        if (state === "inspection") f.sql.exec("UPDATE trade_rental_inspections SET revision=8");
      };
      await assert.rejects(f.correct, /ONLINE_MUTATION_CONFLICT|rental.*invalid/);
      assert.equal(f.sql.prepare("SELECT issued_report_id FROM trade_rental_inspections").get().issued_report_id, "original");
      assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_report_links").get().count, 1);
      assert.equal(f.sql.prepare("SELECT status FROM trade_rental_reports WHERE id<>'original'").get().status, "failed");
      assert.ok(f.objects.has(f.originalPdfKey)); assert.ok(f.objects.has(f.evidenceKey));
    } finally { f.sql.close(); }
  }
});

test("concurrent formatting requests create one stage and one new issued revision", async () => {
  const f = await fixture();
  try {
    let release; let started;
    const rendering = new Promise((resolve) => { started = resolve; });
    f.hooks.render = async () => { started(); await new Promise((resolve) => { release = resolve; }); };
    const first = f.correct(); await rendering;
    await assert.rejects(f.correct, /RENTAL_REPORT_FORMATTING_PENDING/);
    release(); assert.equal((await first).revision, 3);
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_reports").get().count, 2);
  } finally { f.sql.close(); }
});

test("commit response loss reconciles already issued correction without cleaning its immutable objects", async () => {
  const f = await fixture();
  try {
    f.hooks.render = async () => { f.d1.hooks.afterBatch = () => { throw new Error("response lost after commit"); }; };
    const result = await f.correct(); assert.equal(result.revision, 3); assert.equal(f.deletes.length, 0);
    assert.equal(f.sql.prepare("SELECT issued_report_id FROM trade_rental_inspections").get().issued_report_id, result.reportId);
  } finally { f.sql.close(); }
});

test("an interrupted stale correction can be cleaned and retried while original remains issued", async () => {
  const f = await fixture();
  try {
    let release; let started;
    const rendering = new Promise((resolve) => { started = resolve; });
    f.hooks.render = async () => { started(); await new Promise((resolve) => { release = resolve; }); throw new Error("old worker ended"); };
    const first = f.correct().catch((error) => error); await rendering;
    f.sql.prepare("UPDATE trade_rental_reports SET updated_at=? WHERE status='staged'").run(new Date(Date.now() - 16 * 60 * 1000).toISOString());
    f.hooks.render = null;
    const retry = await f.correct(); assert.equal(retry.revision, 4);
    release(); assert.match((await first).message, /old worker ended/);
    assert.equal(f.sql.prepare("SELECT issued_report_id FROM trade_rental_inspections").get().issued_report_id, retry.reportId);
    assert.equal(f.sql.prepare("SELECT status FROM trade_rental_reports WHERE id='original'").get().status, "issued");
    assert.equal(f.sql.prepare("SELECT stage FROM trade_work_orders").get().stage, "completed");
    assert.ok(f.objects.has(f.originalPdfKey)); assert.ok(f.objects.has(f.evidenceKey));
  } finally { f.sql.close(); }
});

test("cooling owner correction changes access only, preserves no cooling, limitation, outcome, issuer and original report", async () => {
  const f = await fixture({ cooling: true, coolingLimitation: "Not accessible" });
  try {
    const before = f.sql.prepare("SELECT * FROM trade_rental_reports WHERE id='original'").get();
    const result = await f.correctCooling();
    assert.equal(result.revision, 3);
    const corrected = JSON.parse(f.sql.prepare("SELECT report_snapshot FROM trade_rental_reports WHERE id=?").get(result.reportId).report_snapshot);
    const expected = structuredClone(f.snapshot);
    expected.modules[0].sections[1].items[0].response.accessStatus = "Clear access";
    expected.findings[1].details.responseSnapshot.accessStatus = "Clear access";
    assert.deepEqual({ ...corrected, report: expected.report, evidence: expected.evidence }, expected);
    const item = corrected.modules[0].sections[1].items[0];
    assert.equal(item.response.applianceType, "No fixed cooling");
    assert.equal(item.response.limitationStatus, "Not accessible");
    assert.equal(item.outcome, "does_not_meet");
    assert.equal(corrected.issuer.authenticatedAt, f.originalIssuedAt);
    assert.deepEqual(corrected.report.answerCorrection, {
      sourceReportId: "original", sourceReportNumber: "RMS-TEST-R2", sourceReportRevision: 2, sourceIssuedAt: f.originalIssuedAt,
      field: "accessStatus", fieldPath: "$.modules[0].sections[1].items[0].response.accessStatus", itemId: "cooling-0",
      checkKey: "cooling_2027_readiness", fromValue: "Not accessed", toValue: "Clear access", correctedByOwnerUid: "owner", correctedAt: result.issuedAt,
    });
    assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_reports WHERE id='original'").get(), before);
    assert.equal(f.sql.prepare("SELECT stage FROM trade_work_orders").get().stage, "completed");
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events WHERE event_type='report_answer_revision_issued'").get().count, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events WHERE event_type='report_email_requested'").get().count, 0);
    assert.equal((await f.correctCooling()).reportId, result.reportId);
    assert.equal((await f.api.authoriseRentalReportToken("old-link.test-secret")).report_id, "original");
    const publicSnapshot = f.api.publicRentalReportPayload({ report_snapshot: JSON.stringify(corrected), expires_at: result.expiresAt }, "public-token");
    assert.equal(publicSnapshot.report.answerCorrection.correctedByOwnerUid, undefined);
    assert.equal(publicSnapshot.report.answerCorrection.sourceReportId, undefined);
    assert.equal(publicSnapshot.report.answerCorrection.toValue, "Clear access");
  } finally { f.sql.close(); }
});

test("cooling access correction rejects missing, multiple, different equipment, unexpected answer and mismatched finding copies", async () => {
  for (const scenario of [{ cooling: false }, { cooling: true, coolingCount: 2 }, { cooling: true, coolingCount: 0 },
    { cooling: true, coolingAppliance: "Split system" }, { cooling: true, coolingAccess: "Clear access" }, { cooling: true, retainedAccess: "Clear access" }]) {
    const f = await fixture(scenario);
    try {
      await assert.rejects(f.correctCooling, /RENTAL_REPORT_COOLING_ACCESS_INVALID/);
      assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_reports").get().count, 1);
      assert.equal(f.sql.prepare("SELECT issued_report_id FROM trade_rental_inspections").get().issued_report_id, "original");
      assert.equal(f.puts.length, 0);
    } finally { f.sql.close(); }
  }
});

test("cooling correction requires owner permissions, held email review and exact current revision", async () => {
  for (const scenario of ["permission", "hold", "delivery", "revision"]) {
    const f = await fixture({ cooling: true });
    try {
      if (scenario === "permission") f.access.canManageFieldEvidence = false;
      if (scenario === "hold") f.event("report_email_review_released");
      if (scenario === "delivery") f.event("report_email_accepted");
      await assert.rejects(() => f.correctCooling(scenario === "revision" ? { expectedInspectionRevision: 6 } : {}),
        /REPORT_DELIVERY_OWNER_REQUIRED|REPORT_DELIVERY_REVIEW_REQUIRED|REPORT_DELIVERY_ALREADY_SENDING|RENTAL_REPORT_FORMATTING_CONFLICT/);
      assert.equal(f.puts.length, 0);
    } finally { f.sql.close(); }
  }
});

test("cooling answer correction rolls back a final commit if review releases during render", async () => {
  const f = await fixture({ cooling: true });
  try {
    f.hooks.render = async () => { f.event("report_email_review_released"); };
    await assert.rejects(f.correctCooling, /ONLINE_MUTATION_CONFLICT|rental.*invalid/);
    assert.equal(f.sql.prepare("SELECT issued_report_id FROM trade_rental_inspections").get().issued_report_id, "original");
    assert.equal(f.sql.prepare("SELECT status FROM trade_rental_reports WHERE id<>'original'").get().status, "failed");
    assert.ok(f.objects.has(f.originalPdfKey)); assert.ok(f.objects.has(f.evidenceKey));
  } finally { f.sql.close(); }
});

test("cooling correction without a finding response copy preserves the existing formatting history and old report links", async () => {
  const f = await fixture({ cooling: true, coolingFindingSnapshot: false });
  try {
    const formatted = await f.correct();
    const formattingSnapshot = JSON.parse(f.sql.prepare("SELECT report_snapshot FROM trade_rental_reports WHERE id=?").get(formatted.reportId).report_snapshot);
    const corrected = await f.correctCooling({ reportId: formatted.reportId, expectedInspectionRevision: 8 });
    const result = JSON.parse(f.sql.prepare("SELECT report_snapshot FROM trade_rental_reports WHERE id=?").get(corrected.reportId).report_snapshot);
    assert.equal(corrected.revision, 4);
    assert.deepEqual(result.report.formattingCorrection, formattingSnapshot.report.formattingCorrection);
    assert.deepEqual(result.findings, formattingSnapshot.findings);
    assert.equal(result.modules[0].sections[1].items[0].response.accessStatus, "Clear access");
    assert.equal(result.modules[0].sections[1].items[0].response.limitationStatus, "No limitation");
    assert.equal((await f.api.authoriseRentalReportToken("old-link.test-secret")).report_id, "original");
    assert.equal((await f.api.authenticatedRentalReportPdf({ access: f.access, workOrderId: "job", reportId: formatted.reportId })).reportNumber, "RMS-TEST-R3");
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_rental_reports WHERE status='issued'").get().count, 3);
  } finally { f.sql.close(); }
});
