import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import * as core from "../src/lib/trade-activity-forms.ts";
import * as flow from "../src/lib/trade-activity-form-flow.ts";
import { renderActivityFieldPdf, validateActivityEvidenceBytes } from "../src/lib/trade-activity-forms-pdf.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const serverSource = read("../src/lib/trade-activity-forms-server.ts");
function loadModule(source, dependencies) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
function sourceFunction(source, name, dependencies) {
  const ast = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing function ${name}`);
  const output = ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(dependencies), `${output}; return ${name};`)(...Object.values(dependencies));
}
const field = (key, phase, type = "text", required = true) => ({ key, phase, type, required, section: "Test section", label: key, help: "", options: [] });
const form = () => ({ id: "form-a", title: "Test activity", version: 1, activityTemplateId: "activity-a", programCode: "TEST", variantId: "", variantOptions: [],
  fields: [field("before_name", "before"), field("after_model", "after"), field("photo", "after", "photo", false), field("document", "after", "document", false)],
  declarations: [
    { key: "before_customer", title: "Before work", phase: "before", role: "customer", required: true, text: "Customer confirms this before-work record.", sourceUrl: "", sourceTextSha256: "" },
    { key: "after_technician", title: "After work", phase: "after", role: "technician", required: true, text: "Technician confirms this after-work record.", sourceUrl: "", sourceTextSha256: "" },
  ], sources: [], reviewNotes: [] });
const strokes = [{ points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.8 }, { x: 0.9, y: 0.2 }] }];

function fixture(fieldForm = form()) {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT, record_status TEXT, source_type TEXT, source_reference TEXT,
      assignee_member_id TEXT, assignee_label TEXT, stage TEXT, service_category TEXT, revision INTEGER);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT, firebase_uid TEXT, customer_source TEXT, crm_customer_id TEXT, service_site_id TEXT);
    CREATE TABLE trade_crm_customers (id TEXT, firebase_uid TEXT, first_name TEXT, last_name TEXT, email TEXT, phone TEXT);
    CREATE TABLE trade_crm_service_sites (id TEXT, firebase_uid TEXT, address_line_1 TEXT, address_line_2 TEXT, suburb TEXT, address_state TEXT, postcode TEXT);
    CREATE TABLE trade_team_members (id TEXT, owner_uid TEXT, status TEXT, display_name TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE trade_team_member_credentials (id TEXT, owner_uid TEXT, team_member_id TEXT, file_id TEXT, credential_number TEXT, name TEXT,
      rental_gate TEXT, credential_type TEXT, expires_at TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE trade_team_member_files (id TEXT, owner_uid TEXT, team_member_id TEXT, status TEXT, expires_at TEXT);
    CREATE TABLE trade_work_order_compliance_intents (id TEXT PRIMARY KEY, work_order_id TEXT, installer_uid TEXT, compliance_organisation_id TEXT,
      activity_template_id TEXT, status TEXT, program_code TEXT, intent_snapshot TEXT, created_at TEXT);
    INSERT INTO trade_work_orders VALUES
      ('job-a','owner-a','installer','active','direct','','worker-a','Worker A','scheduled','hot-water',1),
      ('job-b','owner-b','installer','active','direct','','worker-b','Worker B','scheduled','hot-water',1);
    INSERT INTO trade_work_order_compliance_intents VALUES
      ('intent-a','job-a','owner-a','creditex-a','activity-a','planned','TEST','{}','2026-09-07'),
      ('intent-b','job-b','owner-b','creditex-b','activity-a','planned','TEST','{}','2026-09-07');`);
  database.exec(read("../drizzle/0170_trade_activity_forms.sql"));
  const d1 = { prepare(sql) { return { bind(...values) { return {
    async first() { return database.prepare(sql).get(...values) || null; },
    async all() { return { results: database.prepare(sql).all(...values) }; },
    async run() { const result = database.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
  }; } }; } };
  const objects = new Map();
  const bucket = {
    async get(key) { const bytes = objects.get(key); return bytes ? { async arrayBuffer() { return Uint8Array.from(bytes).buffer; } } : null; },
    async put(key, bytes) { objects.set(key, Uint8Array.from(bytes)); },
    async delete(key) { objects.delete(key); },
  };
  const assignedJob = sourceFunction(read("../src/lib/trade-team-server.ts"), "assignedJob", { getD1: () => d1 });
  const server = loadModule(serverSource, {
    "cloudflare:workers": { env: { EVIDENCE: bucket } },
    "../../db": { getD1: () => d1 }, "./trade-team-server": { assignedJob },
    "./trade-activity-forms-library.ts": { defaultActivityFieldForm: () => structuredClone(fieldForm), activityPrefill: () => ({}) },
    "./trade-activity-forms.ts": core,
    "./trade-activity-form-flow.ts": flow,
    "./trade-activity-forms-pdf.ts": { validateActivityEvidenceBytes, renderActivityFieldPdf: async () => new TextEncoder().encode("%PDF-test-final-custody") },
    "./customer-plan-pdf-fonts": { loadCustomerPlanPdfFonts: async () => ({ regular: new Uint8Array(), bold: new Uint8Array() }) },
  });
  const access = { ownerUid: "owner-a", actorUid: "field-member:worker-a", memberId: "worker-a", isOwner: false,
    jobScope: "own", canViewFieldEvidence: true, canManageFieldEvidence: true, businessName: "Test business", displayName: "Worker A" };
  return { database, server, access, objects };
}

test("file and PDF custody digests are the SHA-256 of original bytes", () => {
  const bytes = new Uint8Array([0, 255, 65, 13, 10, 99]);
  assert.equal(core.activityHash(bytes), createHash("sha256").update(bytes).digest("hex"));
  assert.notEqual(core.activityHash(bytes), core.activityHash({ 0: 0, 1: 255, 2: 65, 3: 13, 4: 10, 5: 99 }));
});

test("actual Creditex organisation membership can author while another organisation is rejected", async () => {
  let organisationCode = "CREDITEX-AU";
  const masterActor = sourceFunction(read("../src/app/api/trade-activity-forms/route.ts"), "masterActor", {
    getD1: () => ({}), requireComplianceAccess: async () => ({ uid: "creditex-reviewer", organisationId: "creditex-a", organisationCode, governanceIdentityVerified: true }),
  });
  const request = new Request("https://example.test/api/trade-activity-forms");
  assert.deepEqual(await masterActor(request, "creditex"), { uid: "creditex-reviewer", organisationId: "creditex-a" });
  organisationCode = "OTHER-PROVIDER";
  await assert.rejects(masterActor(request, "creditex"), /ACTIVITY_AUTHOR_REQUIRED/);
});

test("records cannot be opened or read across business or assigned-worker boundaries", async () => {
  const { database, server, access } = fixture();
  try {
    const record = await server.openActivityRecord(access, "job-a", "intent-a");
    await assert.rejects(server.openActivityRecord(access, "job-a", "intent-b"), /ACTIVITY_INTENT_NOT_ACTIVE/);
    await assert.rejects(server.openActivityRecord(access, "job-b", "intent-b"), /JOB_NOT_FOUND/);
    await assert.rejects(server.loadActivityRecord({ ...access, ownerUid: "owner-b" }, record.id), /ACTIVITY_RECORD_NOT_FOUND/);
    await assert.rejects(server.loadActivityRecord({ ...access, memberId: "different-worker" }, record.id), /JOB_NOT_ASSIGNED/);
    await assert.rejects(server.saveActivityAnswers({ ...access, canManageFieldEvidence: false }, record.id, record.revision, {}), /ACTIVITY_ACCESS_REQUIRED/);
  } finally { database.close(); }
});

test("concurrent opens return one durable record and stale saves cannot replace the winning revision", async () => {
  const { database, server, access } = fixture();
  try {
    const opened = await Promise.all([server.openActivityRecord(access, "job-a", "intent-a"), server.openActivityRecord(access, "job-a", "intent-a")]);
    assert.equal(opened[0].id, opened[1].id);
    const writes = await Promise.allSettled([
      server.saveActivityAnswers(access, opened[0].id, 1, { before_name: "First" }),
      server.saveActivityAnswers(access, opened[0].id, 1, { before_name: "Second" }),
    ]);
    assert.equal(writes.filter((value) => value.status === "fulfilled").length, 1);
    assert.match(writes.find((value) => value.status === "rejected").reason.message, /ACTIVITY_REVISION_CONFLICT/);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_activity_field_records").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_activity_field_record_versions").get().count, 2);
  } finally { database.close(); }
});

test("database payload identity guards reject missing identity keys rather than allowing SQL NULL", () => {
  const { database } = fixture();
  try {
    assert.throws(() => database.prepare(`INSERT INTO trade_activity_field_records
      (id, intent_id, work_order_id, owner_uid, organisation_id, activity_template_id, revision, status, payload, actor_uid, created_at, updated_at)
      VALUES ('malformed', 'intent-a', 'job-a', 'owner-a', 'creditex-a', 'activity-a', 1, 'draft', '{}', 'actor', 'now', 'now')`).run(), /CHECK constraint failed/);
  } finally { database.close(); }
});

test("before-work signing permits after-work capture and locks signed answers without losing audit history", async () => {
  const { database, server, access } = fixture();
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    const originalSignature = structuredClone(record.signatures[0]);
    await assert.rejects(server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Replaced" }), /ACTIVITY_SIGNED_SCOPE_LOCKED/);
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Installed unit" });
    assert.deepEqual(record.signatures[0], originalSignature);
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    const submitted = await server.submitActivityRecord(access, record.id, record.revision);
    assert.equal(submitted.status, "submitted_for_creditex_review");
    await assert.rejects(server.saveActivityAnswers(access, submitted.id, submitted.revision, submitted.answers), /ACTIVITY_ALREADY_SUBMITTED/);
    assert.throws(() => database.prepare("UPDATE trade_activity_field_records SET revision = revision + 1 WHERE id = ?").run(submitted.id), /immutable/);
    assert.throws(() => database.prepare("DELETE FROM trade_activity_field_record_versions WHERE record_id = ?").run(submitted.id), /retained/);
    assert.ok(database.prepare("SELECT COUNT(*) count FROM trade_activity_field_record_versions WHERE record_id = ?").get(submitted.id).count >= 6);
  } finally { database.close(); }
});

test("adding an optional before-work signature cannot invalidate an existing final signature", async () => {
  const optionalBefore = form();
  optionalBefore.declarations[0].required = false;
  const { database, server, access } = fixture(optionalBefore);
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Unit" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    await assert.rejects(server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes }), /ACTIVITY_SIGNED_SCOPE_LOCKED|ACTIVITY_SIGNING_NOT_READY/);
    assert.deepEqual(core.activityMissing(await server.loadActivityRecord(access, record.id)), []);
  } finally { database.close(); }
});

test("corrupted stored evidence is rejected and a revoked share token no longer resolves", async () => {
  const { database, server, access, objects } = fixture();
  try {
    const bytes = new Uint8Array([255, 216, 255, 1, 2, 3]);
    objects.set("original", bytes);
    const evidence = { id: "photo-a", objectKey: "original", contentType: "image/jpeg", fileName: "photo.jpg", sha256: core.activityHash(bytes) };
    assert.deepEqual((await server.readActivityEvidence({ evidence: [evidence] }, "photo-a")).bytes, bytes);
    objects.set("original", new Uint8Array([255, 216, 255, 4, 5, 6]));
    await assert.rejects(server.readActivityEvidence({ evidence: [evidence] }, "photo-a"), /ACTIVITY_EVIDENCE_INTEGRITY_FAILED/);
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Unit" });
    for (const declaration of ["before_customer", "after_technician"]) record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: declaration, signerName: "Signer", acknowledged: true, strokes });
    record = await server.submitActivityRecord(access, record.id, record.revision);
    const url = new URL(await server.shareActivityReport(access, record.id, "https://example.test"));
    const token = url.searchParams.get("reportToken");
    assert.equal((await server.sharedActivityRecord(token)).id, record.id);
    await server.shareActivityReport(access, record.id, "https://example.test", true);
    await assert.rejects(server.sharedActivityRecord(token), /ACTIVITY_REPORT_LINK_UNAVAILABLE/);
  } finally { database.close(); }
});

test("header-only malformed uploads are rejected before they can trap the saved draft", async () => {
  const { database, server, access, objects } = fixture();
  try {
    const record = await server.openActivityRecord(access, "job-a", "intent-a");
    for (const [fieldKey, name, type, content] of [
      ["photo", "broken.jpg", "image/jpeg", new Uint8Array([255, 216, 255, 0, 0])],
      ["document", "broken.pdf", "application/pdf", new TextEncoder().encode("%PDF-")],
    ]) {
      await assert.rejects(server.uploadActivityEvidence(access, record.id, record.revision, fieldKey, new File([content], name, { type }), {}), /INVALID_ACTIVITY_FILE/);
      assert.equal(objects.size, 0);
      assert.equal((await server.loadActivityRecord(access, record.id)).revision, record.revision);
    }
  } finally { database.close(); }
});

test("repeated required answers and photos bind to their own item and enter the signed scope", async () => {
  const repeated = form();
  repeated.fields = [field("before_name", "before"),
    { ...field("present", "after", "boolean"), repeatGroup: "products" },
    { ...field("model", "after"), repeatGroup: "products", condition: { fieldKey: "present", equals: true } },
    { ...field("photo", "after", "photo"), repeatGroup: "products", condition: { fieldKey: "present", equals: true } }];
  const { database, server, access } = fixture(repeated);
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, {
      before_name: "Customer", "$repeat.products": 2, present: false, "present[1]": true,
    });
    assert.deepEqual(core.activityMissing(record, "after", false).map((item) => item.key).sort(), ["model[1]", "photo[1]"]);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
    const photo = new File([png], "second-item.png", { type: "image/png" });
    await assert.rejects(server.uploadActivityEvidence(access, record.id, record.revision, "photo", photo, {}), /INVALID_ACTIVITY_FIELD/);
    const beforeUpload = core.activitySigningScope(record, "after");
    record = await server.uploadActivityEvidence(access, record.id, record.revision, "photo[1]", photo, {});
    assert.equal(record.evidence[0].fieldKey, "photo[1]");
    assert.notEqual(core.activitySigningScope(record, "after"), beforeUpload);
    assert.deepEqual(core.activityMissing(record, "after", false).map((item) => item.key), ["model[1]"]);
    await assert.rejects(server.saveActivityAnswers(access, record.id, record.revision, { ...record.answers, "model[2]": "Out of range" }), /INVALID_ACTIVITY_REPEAT/);
  } finally { database.close(); }
});

test("a final PDF retains a captured image after its conditional question is no longer visible", async () => {
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
  const conditional = form();
  conditional.fields = [field("present", "after", "boolean"), { ...field("photo", "after", "photo"), condition: { fieldKey: "present", equals: true } }];
  const record = { id: "record-pdf", recordNumber: "TAF-PDF", workOrderId: "job-a", form: conditional, answers: { present: false }, signatures: [], submittedAt: "2026-09-07T01:00:00Z",
    evidence: [{ id: "photo-original", fieldKey: "photo", contentType: "image/png", fileName: "retained-original.png", sha256: core.activityHash(image), capturedAt: "", uploadedAt: "2026-09-07T00:00:00Z", latitude: null, longitude: null, accuracy: null, metadataOrigin: "file_upload" }] };
  const rendered = await renderActivityFieldPdf(record, new Map([["photo-original", image]]), {
    regular: fs.readFileSync(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url)),
    bold: fs.readFileSync(new URL("../public/fonts/LiberationSans-Bold.ttf", import.meta.url)),
  });
  const pdf = await PDFDocument.load(rendered);
  const imageResources = pdf.getPages().flatMap((page) => page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.entries() || []);
  assert.ok(imageResources.length > 0, "Retained original photo must be embedded in the final PDF, including when its question was subsequently hidden");
});

test("location-required capture rejects missing, mocked or stale location and retries remain idempotent", async () => {
  const locatedForm = form();
  locatedForm.fields.find((item) => item.key === "photo").requireLocation = true;
  const { database, server, access, objects } = fixture(locatedForm);
  try {
    const record = await server.openActivityRecord(access, "job-a", "intent-a");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
    const file = new File([png], "captured.png", { type: "image/png" });
    const capturedAt = new Date().toISOString();
    const capture = { capturedAt, locationObservedAt: capturedAt, latitude: -37.8, longitude: 145.1, accuracy: 10, mocked: false, metadataOrigin: "device_capture" };
    for (const metadata of [{}, { ...capture, mocked: true }, { ...capture, accuracy: 101 }, { ...capture, locationObservedAt: new Date(Date.now() - 180_000).toISOString() }]) {
      await assert.rejects(server.uploadActivityEvidence(access, record.id, record.revision, "photo", file, metadata), /ACTIVITY_PHOTO_LOCATION_REQUIRED/);
      assert.equal(objects.size, 0);
    }
    const uploadId = crypto.randomUUID();
    const uploaded = await server.uploadActivityEvidence(access, record.id, record.revision, "photo", file, capture, uploadId);
    const replayed = await server.uploadActivityEvidence(access, record.id, record.revision, "photo", file, capture, uploadId);
    assert.equal(replayed.revision, uploaded.revision);
    assert.equal(replayed.evidence.length, 1);
    assert.equal(objects.size, 1);
    await assert.rejects(server.uploadActivityEvidence(access, record.id, record.revision, "document", file, capture, uploadId), /ACTIVITY_UPLOAD_ID_CONFLICT/);
    const ios = await server.uploadActivityEvidence(access, record.id, uploaded.revision, "photo", file, { ...capture, mocked: null }, crypto.randomUUID());
    assert.equal(ios.evidence.at(-1).locationMocked, null, "iOS does not report a mock flag; preserve that absence without rejecting accurate location or inventing false");
  } finally { database.close(); }
});
