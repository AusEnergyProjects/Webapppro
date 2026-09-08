import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import * as core from "../src/lib/trade-activity-forms.ts";
import * as flow from "../src/lib/trade-activity-form-flow.ts";
import * as receipt from "../src/lib/scheduled-activity-customer-document-receipt.ts";
import { canEditCreditexFieldMasters } from "../src/lib/creditex-field-master-access.ts";
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

function fixture(fieldForm = form(), options = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT, record_status TEXT, source_type TEXT, source_reference TEXT,
      assignee_member_id TEXT, assignee_label TEXT, stage TEXT, service_category TEXT, revision INTEGER);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT, firebase_uid TEXT, customer_source TEXT, crm_customer_id TEXT, service_site_id TEXT);
    CREATE TABLE trade_crm_customers (id TEXT, firebase_uid TEXT, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, business_name TEXT, business_number TEXT);
    CREATE TABLE trade_crm_service_sites (id TEXT, firebase_uid TEXT, address_line_1 TEXT, address_line_2 TEXT, suburb TEXT, address_state TEXT, postcode TEXT);
    CREATE TABLE trade_accounts (firebase_uid TEXT, address_line_1 TEXT, suburb TEXT, address_state TEXT, postcode TEXT, document_phone TEXT, phone TEXT,
      document_email TEXT, email TEXT);
    CREATE TABLE trade_work_order_events (id TEXT, work_order_id TEXT, firebase_uid TEXT, event_type TEXT, summary TEXT, created_at TEXT);
    CREATE TABLE trade_activity_customer_document_deliveries (id TEXT, work_order_id TEXT, appointment_id TEXT, firebase_uid TEXT,
      recipient_email_sha256 TEXT, activity_bindings TEXT, document_ids TEXT, document_sha256_set TEXT, pack_sha256 TEXT,
      provider TEXT, provider_message_id TEXT, status TEXT, accepted_at TEXT);
    CREATE TABLE trade_team_members (id TEXT, owner_uid TEXT, status TEXT, display_name TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE trade_team_member_credentials (id TEXT, owner_uid TEXT, team_member_id TEXT, file_id TEXT, credential_number TEXT, name TEXT,
      rental_gate TEXT, credential_type TEXT, jurisdiction TEXT, expires_at TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE trade_team_member_files (id TEXT, owner_uid TEXT, team_member_id TEXT, status TEXT, expires_at TEXT);
    CREATE TABLE trade_work_order_compliance_intents (id TEXT PRIMARY KEY, work_order_id TEXT, installer_uid TEXT, compliance_organisation_id TEXT,
      activity_template_id TEXT, status TEXT, program_code TEXT, intent_snapshot TEXT, created_at TEXT);
    INSERT INTO trade_work_orders VALUES
      ('job-a','owner-a','installer','active','direct','','worker-a','Worker A','scheduled','hot-water',1),
      ('job-b','owner-b','installer','active','direct','','worker-b','Worker B','scheduled','hot-water',1);
    INSERT INTO trade_work_order_compliance_intents VALUES
      ('intent-a','job-a','owner-a','creditex-a','activity-a','planned','TEST','{}','2026-09-07'),
      ('intent-b','job-b','owner-b','creditex-b','activity-a','planned','TEST','{}','2026-09-07');
    INSERT INTO trade_team_members VALUES ('worker-a','owner-a','active','Worker A','Worker','A');`);
  database.exec(read("../drizzle/0170_trade_activity_forms.sql"));
  const d1 = { prepare(sql) { return { bind(...values) { return {
    async first() { return database.prepare(sql).get(...values) || null; },
    async all() { return { results: database.prepare(sql).all(...values) }; },
    async run() { await options.beforeRun?.({ sql, values, database }); const result = database.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
  }; } }; } };
  d1.batch = async (statements) => {
    database.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec("COMMIT"); return results; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
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
    "./trade-activity-forms-library.ts": {
      defaultActivityFieldForm: options.defaultFormFactory || (() => structuredClone(options.defaultForm || fieldForm)), activityPrefill: options.activityPrefill || (() => ({})),
      activityConsumerDocuments: () => options.consumerDocuments || [],
      applyDefaultActivityFormPolicy: options.applyPolicy || ((value) => value),
      ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS: {
        deliveryId: "delivery.booking_documents.delivery_id",
        providerAccepted: "delivery.booking_documents.provider_accepted", method: "delivery.booking_documents.method", acceptedAt: "delivery.booking_documents.accepted_at",
        recipient: "delivery.booking_documents.recipient", appointmentId: "delivery.booking_documents.appointment_id",
        documentIds: "delivery.booking_documents.document_ids", documentSha256Set: "delivery.booking_documents.document_sha256_set",
        packSha256: "delivery.booking_documents.pack_sha256",
      },
    },
    "./trade-activity-forms.ts": core,
    "./trade-activity-form-flow.ts": flow,
    "./scheduled-activity-customer-document-receipt.ts": receipt,
    "./trade-activity-forms-pdf.ts": { validateActivityEvidenceBytes, renderActivityFieldPdf: async () => new TextEncoder().encode("%PDF-test-final-custody") },
    "./customer-plan-pdf-fonts": { loadCustomerPlanPdfFonts: async () => ({ regular: new Uint8Array(), bold: new Uint8Array() }) },
  });
  const access = { ownerUid: "owner-a", actorUid: "field-member:worker-a", memberId: "worker-a", isOwner: false,
    jobScope: "own", canViewFieldEvidence: true, canManageFieldEvidence: true, businessName: "Test business", displayName: "Worker A" };
  return { database, server, access, objects };
}

function acceptedCustomerDocumentDelivery(database, {
  id = "delivery-a", providerMessageId = "email-a", recipient = "pat@example.com", appointmentId = "appointment-a",
  documentIds = ["factsheet"], documentSha256Set = ["a".repeat(64)], acceptedAt = "2026-09-08T01:02:03.000Z",
  activityBindings = [{ activityTemplateId: "activity-a", variantId: "" }], packSha256 = "b".repeat(64),
} = {}) {
  database.prepare(`INSERT INTO trade_activity_customer_document_deliveries
    (id, work_order_id, appointment_id, firebase_uid, recipient_email_sha256, activity_bindings, document_ids, document_sha256_set,
     pack_sha256, provider, provider_message_id, status, accepted_at)
    VALUES (?, 'job-a', ?, 'owner-a', ?, ?, ?, ?, ?, 'resend', ?, 'provider_accepted', ?)`)
    .run(id, appointmentId, createHash("sha256").update(recipient).digest("hex"), JSON.stringify(activityBindings),
      JSON.stringify(documentIds), JSON.stringify(documentSha256Set), packSha256, providerMessageId, acceptedAt);
  return receipt.scheduledActivityCustomerDocumentReceiptSummary({ deliveryId: id, providerMessageId, acceptedAt, recipient,
    appointmentId, documentIds, documentSha256Set });
}

test("file and PDF custody digests are the SHA-256 of original bytes", () => {
  const bytes = new Uint8Array([0, 255, 65, 13, 10, 99]);
  assert.equal(core.activityHash(bytes), createHash("sha256").update(bytes).digest("hex"));
  assert.notEqual(core.activityHash(bytes), core.activityHash({ 0: 0, 1: 255, 2: 65, 3: 13, 4: 10, 5: 99 }));
});

test("server progress counts required field work and signatures without system-filled fields", () => {
  const fieldForm = form();
  fieldForm.fields.push({ ...field("delivery.booking_documents.provider_accepted", "before", "boolean"), presentation: "derived" });
  const { database, server } = fixture(fieldForm);
  try {
    const record = { id: "record-a", recordNumber: "TAF-A", intentId: "intent-a", workOrderId: "job-a", ownerUid: "owner-a",
      organisationId: "creditex-a", revision: 1, status: "draft", form: fieldForm, formSha256: core.activityHash(fieldForm), answers: {},
      evidence: [], signatures: [], signerDefaults: { customer: "", technician: "Worker A" }, createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z", submittedAt: "", reportUrl: "" };
    assert.deepEqual(server.activityPresentation(record).progress, { complete: 0, total: 4 });
  } finally { database.close(); }
});

test("signing never waits on unfinished fields or evidence but submission remains fail closed", async () => {
  const fieldForm = form();
  fieldForm.fields.push({ ...field("system_customer_email", "before"), presentation: "derived", autofill: "job.customer.email" });
  fieldForm.fields.push({ ...field("electrician.licence_number", "before"), presentation: "derived", autofill: "job.credential.electrician",
    condition: { fieldKey: "before_name", equals: "Customer" } });
  fieldForm.fields.find((item) => item.key === "photo").required = true;
  const { database, server, access } = fixture(fieldForm);
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.ok(core.activityMissing(record, "before", false).some((item) => item.key === "system_customer_email"));
    assert.ok(core.activityMissing(record, "before", false).some((item) => item.key === "before_name"));
    assert.ok(core.activityMissing(record, "after", false).some((item) => item.key === "after_model"));
    assert.ok(core.activityMissing(record, "after", false).some((item) => item.key === "photo" && item.kind === "evidence"));
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    assert.equal(record.signatures.length, 2);
    const duplicate = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    assert.equal(duplicate.revision, record.revision);
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Unit" });
    assert.equal(record.signatures.length, 2);
    assert.ok(core.activityMissing(record).some((item) => item.key === "before_customer" && item.kind === "signature"));
    assert.ok(core.activityMissing(record).some((item) => item.key === "after_technician" && item.kind === "signature"));
    await assert.rejects(server.submitActivityRecord(access, record.id, record.revision), /ACTIVITY_FORM_INCOMPLETE/);
  } finally { database.close(); }
});

test("named Creditex field-master editors can author without governed-review permission while unsafe identities are rejected", async () => {
  let identity = {
    uid: "creditex-reviewer",
    organisationId: "creditex-a",
    organisationCode: "CREDITEX-AU",
    governanceIdentityVerified: false,
    role: "reviewer",
    displayName: "Casey Reviewer",
    email: "casey.reviewer@creditex.example",
  };
  const masterActor = sourceFunction(read("../src/app/api/trade-activity-forms/route.ts"), "masterActor", {
    canEditCreditexFieldMasters,
    getD1: () => ({}),
    requireComplianceAccess: async () => identity,
  });
  const request = new Request("https://example.test/api/trade-activity-forms");
  for (const role of ["admin", "case_manager", "reviewer"]) {
    identity = { ...identity, role };
    assert.deepEqual(await masterActor(request, "creditex"), { uid: "creditex-reviewer", organisationId: "creditex-a" });
  }
  for (const unsafeIdentity of [
    { organisationCode: "OTHER-PROVIDER" },
    { role: "auditor" },
    { email: "info@creditex.example" },
    { displayName: "Casey" },
    { displayName: "Creditex Admin" },
  ]) {
    identity = { ...identity, ...unsafeIdentity };
    await assert.rejects(masterActor(request, "creditex"), /ACTIVITY_AUTHOR_REQUIRED/);
    identity = {
      uid: "creditex-reviewer",
      organisationId: "creditex-a",
      organisationCode: "CREDITEX-AU",
      governanceIdentityVerified: false,
      role: "reviewer",
      displayName: "Casey Reviewer",
      email: "casey.reviewer@creditex.example",
    };
  }
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

test("the booked contact pre-fills customer signing while an authorised alternate signer remains explicit", async () => {
  const { database, server, access } = fixture();
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "Pat Customer Pty Ltd", "11122233344");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)")
      .run("job-a", "owner-a", "installer_crm", "customer-a", "");
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(record.signerDefaults.customer, "Pat Customer");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Unit" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Alex Authorised Delegate", acknowledged: true, strokes });
    assert.equal(record.signatures[0].signerName, "Alex Authorised Delegate");
  } finally { database.close(); }
});

test("a business name never invents the booked contact's signer identity", async () => {
  const { database, server, access } = fixture();
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("customer-a", "owner-a", "", "", "office@example.com", "0400000000", "Customer Company Pty Ltd", "11122233344");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)")
      .run("job-a", "owner-a", "installer_crm", "customer-a", "");
    const record = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(record.signerDefaults.customer, "");
  } finally { database.close(); }
});

test("reassigning an unsigned draft refreshes assigned technician identity and signer defaults", async () => {
  const fieldForm = form();
  fieldForm.fields.push({ ...field("installer.full_name", "after"), presentation: "derived", autofill: "job.assignee.fullName" });
  const { database, server, access } = fixture(fieldForm, {
    activityPrefill: (formValue, context) => Object.fromEntries(formValue.fields
      .filter((item) => item.autofill === "job.assignee.fullName")
      .map((item) => [item.key, context.technician])),
  });
  try {
    database.prepare("INSERT INTO trade_team_members VALUES (?, ?, ?, ?, ?, ?)").run("worker-c", "owner-a", "active", "Worker C", "Worker", "C");
    const opened = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(opened.answers["installer.full_name"], "Worker A");
    database.prepare("UPDATE trade_work_orders SET assignee_member_id = ?, assignee_label = ? WHERE id = ?").run("worker-c", "Worker C", "job-a");
    const reassignedAccess = { ...access, actorUid: "field-member:worker-c", memberId: "worker-c", displayName: "Worker C" };
    const refreshed = await server.loadActivityRecord(reassignedAccess, opened.id);
    assert.equal(refreshed.answers["installer.full_name"], "Worker C");
    assert.equal(refreshed.signerDefaults.technician, "Worker C");
    await assert.rejects(server.loadActivityRecord(access, opened.id), /JOB_NOT_ASSIGNED/);
  } finally { database.close(); }
});

test("trade profile email prefills required system-owned business email fields", async () => {
  const fieldForm = form();
  fieldForm.fields.push({ ...field("installer.email", "after"), presentation: "derived", autofill: "job.trade.email" });
  const { database, server, access } = fixture(fieldForm, {
    activityPrefill: (formValue, context) => Object.fromEntries(formValue.fields
      .filter((item) => item.autofill === "job.trade.email")
      .map((item) => [item.key, context.businessEmail || ""])),
  });
  try {
    database.prepare(`INSERT INTO trade_accounts
      (firebase_uid, address_line_1, suburb, address_state, postcode, document_phone, phone, document_email, email)
      VALUES (?, '', '', '', '', '', '', ?, ?)`).run("owner-a", "documents@example.com", "login@example.com");
    const opened = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(opened.answers["installer.email"], "documents@example.com");
  } finally { database.close(); }
});

test("saved SRES team accreditations prefill installer, designer and connection details", async () => {
  const fieldForm = form();
  fieldForm.fields.push(
    { ...field("installer.accreditation_number", "after"), presentation: "prefilled", autofill: "job.credential.installer" },
    { ...field("designer.accreditation_number", "after"), presentation: "prefilled", autofill: "job.credential.designer" },
    { ...field("installer.accreditation_type", "after"), presentation: "prefilled", autofill: "job.credentialType.installer" },
    { ...field("installation.connection_type", "after"), presentation: "derived", autofill: "job.credentialType.connection" },
  );
  const { database, server, access } = fixture(fieldForm, {
    activityPrefill: (formValue, context) => Object.fromEntries(formValue.fields.map((item) => [item.key, ({
      "job.credential.installer": context.credentialNumbers?.installer,
      "job.credential.designer": context.credentialNumbers?.designer,
      "job.credentialType.installer": context.credentialTypes?.installer,
      "job.credentialType.connection": context.credentialTypes?.connection,
    })[item.autofill] || ""])),
  });
  try {
    for (const [id, gate, name, number] of [
      ["installer", "sres_installer_accreditation", "SAA Grid connected installer accreditation", "SAA-I-1"],
      ["designer", "sres_designer_accreditation", "SAA Grid connected designer accreditation", "SAA-D-1"],
    ]) {
      database.prepare("INSERT INTO trade_team_member_files VALUES (?, ?, ?, 'active', ?)").run(`file-${id}`, "owner-a", "worker-a", "2027-09-08");
      database.prepare("INSERT INTO trade_team_member_credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NATIONAL', ?, 'active', ?)")
        .run(`credential-${id}`, "owner-a", "worker-a", `file-${id}`, number, name, gate, "accreditation", "2027-09-08", "2026-09-08T00:00:00.000Z");
    }
    const opened = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(opened.answers["installer.accreditation_number"], "SAA-I-1");
    assert.equal(opened.answers["designer.accreditation_number"], "SAA-D-1");
    assert.equal(opened.answers["installer.accreditation_type"], "SAA Grid connected installer accreditation");
    assert.equal(opened.answers["installation.connection_type"], "Grid connected");
    const editableAnswers = Object.fromEntries(Object.entries(opened.answers)
      .filter(([key]) => fieldForm.fields.find((fieldValue) => fieldValue.key === key)?.type === "text"));
    const saved = await server.saveActivityAnswers(access, opened.id, opened.revision, {
      ...editableAnswers, "installer.accreditation_number": "SAA-OTHER-INSTALLER",
    });
    const reloaded = await server.loadActivityRecord(access, saved.id);
    assert.equal(reloaded.answers["installer.accreditation_number"], "SAA-OTHER-INSTALLER", "An explicit role holder remains editable");
    assert.equal(reloaded.answers["installation.connection_type"], "Grid connected", "A derived job fact still refreshes from the profile");
  } finally { database.close(); }
});

test("explicit specialist credential roles prefill exact crew identifiers without credential-name inference", async () => {
  const fieldForm = form();
  fieldForm.fields.push(
    { ...field("workers.licensed_plumber.licence_or_registration", "after"), presentation: "derived", autofill: "job.credential.licensed_plumber" },
    { ...field("workers.registered_plumber.licence_or_registration", "after"), presentation: "derived", autofill: "job.credential.registered_plumber" },
    { ...field("workers.refrigerant_handler.licence_or_registration", "after"), presentation: "derived", autofill: "job.credential.refrigerant_handler" },
  );
  const { database, server, access } = fixture(fieldForm, {
    activityPrefill: (formValue, context) => Object.fromEntries(formValue.fields.map((item) => [item.key, ({
      "job.credential.licensed_plumber": context.credentialNumbers?.licensed_plumber,
      "job.credential.registered_plumber": context.credentialNumbers?.registered_plumber,
      "job.credential.refrigerant_handler": context.credentialNumbers?.refrigerant_handler,
    })[item.autofill] || ""])),
  });
  try {
    const credentials = [
      ["licensed-valid", "licensed_plumber", "licence", "Opaque credential A", "PLUMB-L1", "2026-09-08T00:00:00.000Z"],
      ["licensed-valid-z", "licensed_plumber", "licence", "Opaque credential Z", "PLUMB-L2", "2026-09-08T00:00:00.000Z"],
      ["licensed-wrong-type", "licensed_plumber", "registration", "Opaque credential B", "WRONG-L-TYPE", "2026-09-08T02:00:00.000Z"],
      ["registered-valid", "registered_plumber", "registration", "Opaque credential C", "PLUMB-R1", "2026-09-08T00:00:00.000Z"],
      ["registered-wrong-type", "registered_plumber", "licence", "Opaque credential D", "WRONG-R-TYPE", "2026-09-08T02:00:00.000Z"],
      ["refrigerant-valid", "refrigerant_handler", "licence", "Opaque credential E", "REF-1", "2026-09-08T00:00:00.000Z"],
      ["refrigerant-wrong-type", "refrigerant_handler", "registration", "Opaque credential F", "WRONG-REF-TYPE", "2026-09-08T02:00:00.000Z"],
      ["misleading-name", "licensed_electrician", "licence", "Plumber gasfitter ARCtick refrigerant licence", "WRONG-NAME-MATCH", "2026-09-08T03:00:00.000Z"],
    ];
    for (const [id, gate, type, name, number, updatedAt] of credentials) {
      database.prepare("INSERT INTO trade_team_member_files VALUES (?, ?, ?, 'active', ?)").run(`file-${id}`, "owner-a", "worker-a", "2027-09-08");
      database.prepare("INSERT INTO trade_team_member_credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VIC', ?, 'active', ?)")
        .run(`credential-${id}`, "owner-a", "worker-a", `file-${id}`, number, name, gate, type, "2027-09-08", updatedAt);
    }

    const opened = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(opened.answers["workers.licensed_plumber.licence_or_registration"], "PLUMB-L2",
      "Equal update times resolve by stable credential ID order");
    assert.equal(opened.answers["workers.registered_plumber.licence_or_registration"], "PLUMB-R1");
    assert.equal(opened.answers["workers.refrigerant_handler.licence_or_registration"], "REF-1");
  } finally { database.close(); }
});

test("wrong credential classes cannot populate SRES or electrical licence fields", async () => {
  const fieldForm = form();
  fieldForm.fields.push(
    { ...field("installer.accreditation_number", "after"), presentation: "derived", autofill: "job.credential.installer" },
    { ...field("designer.accreditation_number", "after"), presentation: "derived", autofill: "job.credential.designer" },
    { ...field("electrician.licence_number", "after"), presentation: "derived", autofill: "job.credential.electrician" },
  );
  const { database, server, access } = fixture(fieldForm, {
    activityPrefill: (formValue, context) => Object.fromEntries(formValue.fields.map((item) => [item.key, ({
      "job.credential.installer": context.credentialNumbers?.installer,
      "job.credential.designer": context.credentialNumbers?.designer,
      "job.credential.electrician": context.credentialNumbers?.electrician,
    })[item.autofill] || ""])),
  });
  try {
    for (const [id, gate, type, jurisdiction, number] of [
      ["installer-wrong-type", "sres_installer_accreditation", "licence", "NATIONAL", "NOT-SRES-I"],
      ["installer-wrong-jurisdiction", "sres_installer_accreditation", "accreditation", "VIC", "NOT-SRES-J"],
      ["designer-wrong-gate", "licensed_electrician", "accreditation", "VIC", "NOT-SRES-D"],
      ["electrician-wrong-type", "licensed_electrician", "training", "VIC", "NOT-ELEC"],
    ]) {
      database.prepare("INSERT INTO trade_team_member_files VALUES (?, ?, ?, 'active', ?)").run(`file-${id}`, "owner-a", "worker-a", "2027-09-08");
      database.prepare("INSERT INTO trade_team_member_credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)")
        .run(`credential-${id}`, "owner-a", "worker-a", `file-${id}`, number, id, gate, type, jurisdiction, "2027-09-08", "2026-09-08T00:00:00.000Z");
    }
    const opened = await server.openActivityRecord(access, "job-a", "intent-a");
    for (const key of ["installer.accreditation_number", "designer.accreditation_number", "electrician.licence_number"]) {
      assert.equal(opened.answers[key], "", key);
      assert.ok(core.activityMissing(opened).some((item) => item.key === key), key);
    }
  } finally { database.close(); }
});

test("an activity opens with its booked variant and rejects a conflicting client variant", async () => {
  const selected = [];
  const fieldForm = form();
  const { database, server, access } = fixture(fieldForm, {
    defaultFormFactory: (_templateId, variantId) => { selected.push(variantId); return { ...structuredClone(fieldForm), variantId }; },
  });
  try {
    database.prepare("UPDATE trade_work_order_compliance_intents SET intent_snapshot = ? WHERE id = ?")
      .run(JSON.stringify({ activity: { variantId: "activity_business" } }), "intent-a");
    const opened = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(opened.form.variantId, "activity_business");
    assert.deepEqual(selected, ["activity_business"]);
    await assert.rejects(
      server.changeActivityVariant(access, opened.id, opened.revision, "activity_residential"),
      /ACTIVITY_FORM_VARIANT_MISMATCH/,
    );
  } finally { database.close(); }

  const second = fixture(fieldForm, { defaultFormFactory: (_templateId, variantId) => ({ ...structuredClone(fieldForm), variantId }) });
  try {
    second.database.prepare("UPDATE trade_work_order_compliance_intents SET intent_snapshot = ? WHERE id = ?")
      .run(JSON.stringify({ activity: { variantId: "activity_business" } }), "intent-a");
    await assert.rejects(second.server.openActivityRecord(second.access, "job-a", "intent-a", "activity_residential"), /ACTIVITY_FORM_VARIANT_MISMATCH/);
  } finally { second.database.close(); }
});

test("a corrupted stored master cannot open a field record", async () => {
  const { database, server, access } = fixture();
  try {
    const fieldForm = form(); fieldForm.version = 2;
    database.prepare(`INSERT INTO trade_activity_field_masters
      (id, organisation_id, activity_template_id, variant_id, version, form_json, form_sha256, published_by_uid, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("master", "creditex-a", "activity-a", "", 2,
        core.activityCanonical(fieldForm), "b".repeat(64), "creditex", "2026-09-08T00:00:00.000Z");
    await assert.rejects(server.openActivityRecord(access, "job-a", "intent-a"), /ACTIVITY_MASTER_INTEGRITY_FAILED/);
  } finally { database.close(); }
});

test("provider-accepted booking document receipts hydrate records and cannot be overwritten by the field client", async () => {
  const derived = (key, type = "text") => ({ ...field(key, "before", type, false), presentation: "derived" });
  const fieldForm = form();
  fieldForm.fields.push(
    derived("delivery.booking_documents.delivery_id"),
    derived("delivery.booking_documents.provider_accepted", "boolean"),
    derived("delivery.booking_documents.method"),
    derived("delivery.booking_documents.accepted_at"),
    derived("delivery.booking_documents.recipient"),
    derived("delivery.booking_documents.appointment_id"),
    derived("delivery.booking_documents.document_ids"),
    derived("delivery.booking_documents.document_sha256_set"),
    derived("delivery.booking_documents.pack_sha256"),
  );
  const { database, server, access } = fixture(fieldForm, { consumerDocuments: [{ key: "factsheet" }] });
  try {
    const hash = "a".repeat(64);
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "", "");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)").run("job-a", "owner-a", "direct", "customer-a", "");
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)").run("event", "job-a", "owner-a", "customer_documents_provider_accepted",
      acceptedCustomerDocumentDelivery(database, { documentSha256Set: [hash] }), "2026-09-08T01:02:03.000Z");
    const opened = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(opened.answers["delivery.booking_documents.provider_accepted"], true);
    assert.equal(opened.answers["delivery.booking_documents.method"], "email");
    assert.equal(opened.answers["delivery.booking_documents.recipient"], "pat@example.com");
    const saved = await server.saveActivityAnswers(access, opened.id, opened.revision, {
      ...opened.answers, before_name: "Pat", "delivery.booking_documents.provider_accepted": false, "delivery.booking_documents.method": "paper",
    });
    assert.equal(saved.answers["delivery.booking_documents.provider_accepted"], true);
    assert.equal(saved.answers["delivery.booking_documents.method"], "email");
    assert.equal(saved.answers.before_name, "Pat");
    const signed = await server.signActivityDeclaration(access, saved.id, { expectedRevision: saved.revision,
      declarationKey: "before_customer", signerName: "Pat Customer", acknowledged: true, strokes });
    const reloaded = await server.loadActivityRecord(access, signed.id);
    assert.equal(reloaded.answers["delivery.booking_documents.accepted_at"], "2026-09-08T01:02:03.000Z");
    assert.deepEqual(core.activityMissing(reloaded, "before"), []);
  } finally { database.close(); }
});

test("a changed customer email clears its receipt without blocking on-device signing", async () => {
  const derived = (key, type = "text") => ({ ...field(key, "before", type, false), presentation: "derived" });
  const fieldForm = form();
  fieldForm.fields.push(
    derived("delivery.booking_documents.delivery_id"), derived("delivery.booking_documents.provider_accepted", "boolean"), derived("delivery.booking_documents.method"), derived("delivery.booking_documents.accepted_at"),
    derived("delivery.booking_documents.recipient"), derived("delivery.booking_documents.appointment_id"), derived("delivery.booking_documents.document_ids"), derived("delivery.booking_documents.document_sha256_set"), derived("delivery.booking_documents.pack_sha256"),
  );
  const { database, server, access } = fixture(fieldForm, { consumerDocuments: [{ key: "factsheet" }] });
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "", "");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)").run("job-a", "owner-a", "direct", "customer-a", "");
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)").run("event", "job-a", "owner-a", "customer_documents_provider_accepted",
      acceptedCustomerDocumentDelivery(database), "2026-09-08T01:02:03.000Z");
    const opened = await server.openActivityRecord(access, "job-a", "intent-a");
    const saved = await server.saveActivityAnswers(access, opened.id, opened.revision, { ...opened.answers, before_name: "Pat" });
    assert.equal(saved.answers["delivery.booking_documents.provider_accepted"], true);
    database.prepare("UPDATE trade_crm_customers SET email = ? WHERE id = ? AND firebase_uid = ?").run("new-address@example.com", "customer-a", "owner-a");
    const refreshed = await server.loadActivityRecord(access, saved.id);
    assert.equal(refreshed.answers["delivery.booking_documents.provider_accepted"], undefined);
    assert.equal(refreshed.answers["delivery.booking_documents.recipient"], undefined);
    const signed = await server.signActivityDeclaration(access, saved.id, { expectedRevision: refreshed.revision,
      declarationKey: "before_customer", signerName: "Pat Customer", acknowledged: true, strokes });
    assert.equal(signed.signatures.length, 1);
    assert.equal(signed.answers["delivery.booking_documents.provider_accepted"], undefined);
  } finally { database.close(); }
});

test("a customer-document delivery bound to a different activity or variant cannot hydrate but does not block signing", async () => {
  const derived = (key, type = "text") => ({ ...field(key, "before", type, false), presentation: "derived" });
  const fieldForm = { ...form(), variantId: "variant-a" };
  fieldForm.fields.push(
    derived("delivery.booking_documents.delivery_id"), derived("delivery.booking_documents.provider_accepted", "boolean"), derived("delivery.booking_documents.method"), derived("delivery.booking_documents.accepted_at"),
    derived("delivery.booking_documents.recipient"), derived("delivery.booking_documents.appointment_id"), derived("delivery.booking_documents.document_ids"), derived("delivery.booking_documents.document_sha256_set"), derived("delivery.booking_documents.pack_sha256"),
  );
  const { database, server, access } = fixture(fieldForm, { consumerDocuments: [{ key: "factsheet" }] });
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "", "");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)")
      .run("job-a", "owner-a", "direct", "customer-a", "");
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)")
      .run("event-wrong-binding", "job-a", "owner-a", "customer_documents_provider_accepted",
        acceptedCustomerDocumentDelivery(database, {
          activityBindings: [
            { activityTemplateId: "activity-a", variantId: "variant-b" },
            { activityTemplateId: "activity-b", variantId: "variant-a" },
          ],
        }), "2026-09-08T01:02:03.000Z");

    let record = await server.openActivityRecord(access, "job-a", "intent-a", "variant-a");
    assert.equal(record.answers["delivery.booking_documents.delivery_id"], undefined);
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], undefined);
    assert.equal(record.answers["delivery.booking_documents.pack_sha256"], undefined);
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Pat" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Pat Customer", acknowledged: true, strokes });
    const stored = JSON.parse(database.prepare("SELECT payload FROM trade_activity_field_records WHERE id = ?").get(record.id).payload);
    assert.equal(stored.signatures.length, 1);
    assert.equal(stored.answers["delivery.booking_documents.provider_accepted"], undefined);
  } finally { database.close(); }
});

test("a terminal provider event invalidates its receipt without stopping the field workflow", async () => {
  const derived = (key, type = "text") => ({ ...field(key, "before", type, false), presentation: "derived" });
  const fieldForm = form();
  fieldForm.fields.push(
    derived("delivery.booking_documents.delivery_id"), derived("delivery.booking_documents.provider_accepted", "boolean"), derived("delivery.booking_documents.method"), derived("delivery.booking_documents.accepted_at"),
    derived("delivery.booking_documents.recipient"), derived("delivery.booking_documents.appointment_id"), derived("delivery.booking_documents.document_ids"), derived("delivery.booking_documents.document_sha256_set"), derived("delivery.booking_documents.pack_sha256"),
  );
  const { database, server, access } = fixture(fieldForm, { consumerDocuments: [{ key: "factsheet" }] });
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "", "");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)").run("job-a", "owner-a", "direct", "customer-a", "");
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)").run("event", "job-a", "owner-a", "customer_documents_provider_accepted",
      acceptedCustomerDocumentDelivery(database), "2026-09-08T01:02:03.000Z");
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { ...record.answers, before_name: "Pat" });
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], true);
    database.prepare("UPDATE trade_activity_customer_document_deliveries SET status = 'bounced' WHERE id = ?").run("delivery-a");
    const refreshed = await server.loadActivityRecord(access, record.id);
    assert.equal(refreshed.answers["delivery.booking_documents.provider_accepted"], undefined);
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: refreshed.revision,
      declarationKey: "before_customer", signerName: "Pat", acknowledged: true, strokes });
    assert.equal(record.signatures.length, 1);
  } finally { database.close(); }
});

test("a delivery bounce at the write boundary is retained for office follow-up without rejecting the signature", async () => {
  let armBounce = false;
  let bounced = false;
  const derived = (key, type = "text") => ({ ...field(key, "before", type, false), presentation: "derived" });
  const fieldForm = form();
  fieldForm.fields.push(
    derived("delivery.booking_documents.delivery_id"), derived("delivery.booking_documents.provider_accepted", "boolean"), derived("delivery.booking_documents.method"), derived("delivery.booking_documents.accepted_at"),
    derived("delivery.booking_documents.recipient"), derived("delivery.booking_documents.appointment_id"), derived("delivery.booking_documents.document_ids"), derived("delivery.booking_documents.document_sha256_set"), derived("delivery.booking_documents.pack_sha256"),
  );
  const { database, server, access } = fixture(fieldForm, {
    consumerDocuments: [{ key: "factsheet" }],
    beforeRun: ({ sql, database: db }) => {
      if (armBounce && !bounced && /UPDATE trade_activity_field_records SET revision/.test(sql)) {
        bounced = true;
        db.prepare("UPDATE trade_activity_customer_document_deliveries SET status = 'bounced' WHERE id = ?").run("delivery-a");
      }
    },
  });
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "", "");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)")
      .run("job-a", "owner-a", "direct", "customer-a", "");
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)")
      .run("event", "job-a", "owner-a", "customer_documents_provider_accepted",
        acceptedCustomerDocumentDelivery(database), "2026-09-08T01:02:03.000Z");
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { ...record.answers, before_name: "Pat" });
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], true);

    armBounce = true;
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Pat Customer", acknowledged: true, strokes });
    assert.equal(bounced, true);
    const stored = JSON.parse(database.prepare("SELECT payload FROM trade_activity_field_records WHERE id = ?").get(record.id).payload);
    assert.equal(stored.signatures.length, 1);
    assert.equal(stored.revision, record.revision);
    const refreshed = await server.loadActivityRecord(access, record.id);
    assert.equal(refreshed.answers["delivery.booking_documents.provider_accepted"], undefined);
    assert.deepEqual(core.activityMissing(refreshed, "before"), []);
  } finally { database.close(); }
});

test("delivery reconciliation never invalidates an on-device customer signature", async () => {
  const derived = (key, type = "text") => ({ ...field(key, "before", type, false), presentation: "derived" });
  const fieldForm = form();
  fieldForm.fields.push(
    derived("delivery.booking_documents.delivery_id"), derived("delivery.booking_documents.provider_accepted", "boolean"), derived("delivery.booking_documents.method"), derived("delivery.booking_documents.accepted_at"),
    derived("delivery.booking_documents.recipient"), derived("delivery.booking_documents.appointment_id"), derived("delivery.booking_documents.document_ids"), derived("delivery.booking_documents.document_sha256_set"), derived("delivery.booking_documents.pack_sha256"),
  );
  const { database, server, access } = fixture(fieldForm, { consumerDocuments: [{ key: "factsheet" }] });
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "", "");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)")
      .run("job-a", "owner-a", "direct", "customer-a", "");
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)")
      .run("event-initial", "job-a", "owner-a", "customer_documents_provider_accepted",
        acceptedCustomerDocumentDelivery(database), "2026-09-08T01:02:03.000Z");

    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], true);
    record = await server.saveActivityAnswers(access, record.id, record.revision, {
      ...record.answers, before_name: "Pat", after_model: "Installed unit",
    });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Pat Customer", acknowledged: true, strokes });
    const originalCustomerSignature = structuredClone(record.signatures[0]);
    assert.deepEqual(core.activityMissing(record, "before"), []);

    database.prepare("UPDATE trade_activity_customer_document_deliveries SET status = 'bounced' WHERE id = ?").run("delivery-a");
    record = await server.loadActivityRecord(access, record.id);
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], undefined);
    assert.equal(record.answers["delivery.booking_documents.accepted_at"], undefined);
    assert.deepEqual(record.signatures, [originalCustomerSignature]);
    assert.deepEqual(core.activityMissing(record, "before"), []);

    const resendAcceptedAt = "2026-09-08T02:02:03.000Z";
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)")
      .run("event-resend", "job-a", "owner-a", "customer_documents_provider_accepted",
        acceptedCustomerDocumentDelivery(database, {
          id: "delivery-b", providerMessageId: "email-b", acceptedAt: resendAcceptedAt,
        }), resendAcceptedAt);
    record = await server.loadActivityRecord(access, record.id);
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], true);
    assert.equal(record.answers["delivery.booking_documents.accepted_at"], resendAcceptedAt);
    assert.deepEqual(record.signatures, [originalCustomerSignature]);
    assert.deepEqual(core.activityMissing(record, "before"), []);
    const duplicate = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Pat Customer", acknowledged: true, strokes });
    assert.equal(duplicate.revision, record.revision);
    assert.deepEqual(core.activityMissing(record, "before"), []);

    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    assert.equal(record.signatures.filter((item) => item.declarationKey === "after_technician").length, 1);
    assert.deepEqual(core.activityMissing(record), []);
  } finally { database.close(); }
});

test("receipt hydration skips an invalid same-time candidate and finds the latest valid accepted delivery", async () => {
  const derived = (key, type = "text") => ({ ...field(key, "before", type, false), presentation: "derived" });
  const fieldForm = form();
  fieldForm.fields.push(
    derived("delivery.booking_documents.delivery_id"), derived("delivery.booking_documents.provider_accepted", "boolean"), derived("delivery.booking_documents.method"), derived("delivery.booking_documents.accepted_at"),
    derived("delivery.booking_documents.recipient"), derived("delivery.booking_documents.appointment_id"), derived("delivery.booking_documents.document_ids"), derived("delivery.booking_documents.document_sha256_set"), derived("delivery.booking_documents.pack_sha256"),
  );
  const { database, server, access } = fixture(fieldForm, { consumerDocuments: [{ key: "factsheet" }] });
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "", "");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)").run("job-a", "owner-a", "direct", "customer-a", "");
    const accepted = acceptedCustomerDocumentDelivery(database, { id: "delivery-good", providerMessageId: "email-good" });
    const bounced = acceptedCustomerDocumentDelivery(database, { id: "delivery-bad", providerMessageId: "email-bad" });
    database.prepare("UPDATE trade_activity_customer_document_deliveries SET status = 'bounced' WHERE id = ?").run("delivery-bad");
    const occurredAt = "2026-09-08T01:02:03.000Z";
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)").run("event-a-good", "job-a", "owner-a", "customer_documents_provider_accepted", accepted, occurredAt);
    database.prepare("INSERT INTO trade_work_order_events VALUES (?, ?, ?, ?, ?, ?)").run("event-z-bad", "job-a", "owner-a", "customer_documents_provider_accepted", bounced, occurredAt);
    const record = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], true);
    assert.equal(record.answers["delivery.booking_documents.accepted_at"], "2026-09-08T01:02:03.000Z");
  } finally { database.close(); }
});

test("booking email delivery stays advisory while the complete field record can be signed and submitted", async () => {
  const derived = (key, type = "text") => ({ ...field(key, "before", type, false), presentation: "derived" });
  const fieldForm = form();
  fieldForm.fields.push(
    derived("delivery.booking_documents.delivery_id"), derived("delivery.booking_documents.provider_accepted", "boolean"), derived("delivery.booking_documents.method"), derived("delivery.booking_documents.accepted_at"),
    derived("delivery.booking_documents.recipient"), derived("delivery.booking_documents.appointment_id"), derived("delivery.booking_documents.document_ids"), derived("delivery.booking_documents.document_sha256_set"), derived("delivery.booking_documents.pack_sha256"),
  );
  const { database, server, access } = fixture(fieldForm, { consumerDocuments: [{ key: "factsheet" }] });
  try {
    database.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("customer-a", "owner-a", "Pat", "Customer", "pat@example.com", "0400000000", "", "");
    database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, ?, ?)").run("job-a", "owner-a", "direct", "customer-a", "");
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Pat", after_model: "Installed unit" });
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], undefined);
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Pat", acknowledged: true, strokes });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    record = await server.submitActivityRecord(access, record.id, record.revision);
    assert.equal(record.status, "submitted_for_creditex_review");
    assert.equal(record.answers["delivery.booking_documents.provider_accepted"], undefined);
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

test("opening an existing unsigned draft applies the current shared form policy without losing valid answers", async () => {
  const currentForm = form();
  currentForm.fields[0].label = "Current customer name";
  const legacyForm = form();
  legacyForm.fields[0].label = "Legacy customer name";
  legacyForm.fields.push(field("obsolete_duplicate", "before"));
  const { database, server, access } = fixture(legacyForm, {
    defaultForm: currentForm,
    applyPolicy: (_saved, baseline) => structuredClone(baseline),
  });
  try {
    const record = { id: "record-legacy", recordNumber: "TAF-LEGACY", intentId: "intent-a", workOrderId: "job-a", ownerUid: "owner-a",
      organisationId: "creditex-a", revision: 1, status: "draft", form: legacyForm, formSha256: core.activityHash(legacyForm),
      answers: { before_name: "Pat", obsolete_duplicate: "Repeated" }, evidence: [], signatures: [], signerDefaults: { customer: "Pat", technician: "Worker A" },
      hasUserEdits: true, createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", submittedAt: "", reportUrl: "" };
    database.prepare(`INSERT INTO trade_activity_field_records
      (id, intent_id, work_order_id, owner_uid, organisation_id, activity_template_id, revision, status, payload, actor_uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.intentId, record.workOrderId, record.ownerUid,
        record.organisationId, legacyForm.activityTemplateId, record.revision, record.status, core.activityCanonical(record), "legacy", record.createdAt, record.updatedAt);
    const upgraded = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(upgraded.revision, 2);
    assert.equal(upgraded.form.fields.find((item) => item.key === "before_name").label, "Current customer name");
    assert.equal(upgraded.form.fields.some((item) => item.key === "obsolete_duplicate"), false);
    assert.equal(upgraded.answers.before_name, "Pat");
    assert.equal(upgraded.answers.obsolete_duplicate, undefined);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_activity_field_record_versions WHERE record_id = ?").get(record.id).count, 2);
  } finally { database.close(); }
});

test("an unsigned master upgrade drops evidence that no longer meets the field type or location policy", async () => {
  const currentForm = form();
  currentForm.fields = currentForm.fields.map((item) => item.key === "document"
    ? { ...item, type: "photo", required: true, requireLocation: true }
    : item);
  const legacyForm = form();
  legacyForm.fields = legacyForm.fields.map((item) => item.key === "document"
    ? { ...item, type: "document", required: true }
    : item);
  const { database, server, access } = fixture(legacyForm, {
    defaultForm: currentForm,
    applyPolicy: (_saved, baseline) => structuredClone(baseline),
  });
  try {
    const record = { id: "record-evidence-upgrade", recordNumber: "TAF-EVIDENCE", intentId: "intent-a", workOrderId: "job-a", ownerUid: "owner-a",
      organisationId: "creditex-a", revision: 1, status: "draft", form: legacyForm, formSha256: core.activityHash(legacyForm), answers: {},
      evidence: [{ id: "old-document", fieldKey: "document", fileName: "old.pdf", contentType: "application/pdf", size: 12,
        sha256: "a".repeat(64), objectKey: "old", capturedAt: "", uploadedAt: "2026-09-07T00:00:00.000Z", latitude: null,
        longitude: null, accuracy: null, metadataOrigin: "file_upload" }], signatures: [], signerDefaults: { customer: "", technician: "Worker A" },
      hasUserEdits: true, createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", submittedAt: "", reportUrl: "" };
    database.prepare(`INSERT INTO trade_activity_field_records
      (id, intent_id, work_order_id, owner_uid, organisation_id, activity_template_id, revision, status, payload, actor_uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.intentId, record.workOrderId, record.ownerUid,
        record.organisationId, legacyForm.activityTemplateId, record.revision, record.status, core.activityCanonical(record), "legacy", record.createdAt, record.updatedAt);
    const upgraded = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(upgraded.revision, 2);
    assert.equal(upgraded.form.fields.find((item) => item.key === "document").type, "photo");
    assert.deepEqual(upgraded.evidence, []);
    assert.ok(core.activityMissing(upgraded).some((item) => item.key === "document" && item.kind === "evidence"));
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

test("technician signing is restricted to the assigned active member and stores the server-bound name", async () => {
  const { database, server, access } = fixture();
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Installed unit" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    await assert.rejects(server.signActivityDeclaration({ ...access, isOwner: true, jobScope: "team", memberId: "manager" }, record.id, {
      expectedRevision: record.revision, declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes,
    }), /ACTIVITY_TECHNICIAN_SIGNER_NOT_ASSIGNED/);
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "after_technician", signerName: "Unrelated Person", acknowledged: true, strokes });
    assert.equal(record.signatures.find((signature) => signature.declarationKey === "after_technician")?.signerName, "Worker A");
    assert.equal(record.signatures.find((signature) => signature.declarationKey === "after_technician")?.actorUid, access.actorUid);
  } finally { database.close(); }
});

test("a business display name cannot stand in for the assigned technician's personal name", async () => {
  const { database, server, access } = fixture();
  try {
    database.prepare("UPDATE trade_team_members SET display_name = ?, first_name = '', last_name = '' WHERE id = ?")
      .run("Test Electrical Pty Ltd", "worker-a");
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.equal(record.signerDefaults.technician, "");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Installed unit" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    await assert.rejects(server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "after_technician", signerName: "Test Electrical Pty Ltd", acknowledged: true, strokes }),
    /ACTIVITY_TECHNICIAN_IDENTITY_REQUIRED/);
  } finally { database.close(); }
});

test("technician signing atomically rejects a reassignment made at the write boundary", async () => {
  let armReassignment = false;
  let reassigned = false;
  const { database, server, access } = fixture(form(), {
    beforeRun: ({ sql, database: db }) => {
      if (armReassignment && !reassigned && /UPDATE trade_activity_field_records SET revision/.test(sql)) {
        reassigned = true;
        db.prepare("UPDATE trade_work_orders SET assignee_member_id = ?, assignee_label = ? WHERE id = ?")
          .run("worker-c", "Worker C", "job-a");
      }
    },
  });
  try {
    database.prepare("INSERT INTO trade_team_members VALUES (?, ?, ?, ?, ?, ?)").run("worker-c", "owner-a", "active", "Worker C", "Worker", "C");
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Installed unit" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    armReassignment = true;
    await assert.rejects(server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes }), /JOB_NOT_ASSIGNED/);
    assert.equal(reassigned, true);
    const stored = JSON.parse(database.prepare("SELECT payload FROM trade_activity_field_records WHERE id = ?").get(record.id).payload);
    assert.equal(stored.signatures.some((signature) => signature.declarationKey === "after_technician"), false);
  } finally { database.close(); }
});

test("an inactive assigned member cannot supply a technician declaration identity", async () => {
  const { database, server, access } = fixture();
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Installed unit" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    database.prepare("UPDATE trade_team_members SET status = 'inactive' WHERE id = ?").run("worker-a");
    await assert.rejects(server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes }), /ACTIVITY_TECHNICIAN_IDENTITY_REQUIRED/);
  } finally { database.close(); }
});

test("signed drafts remain editable and retain invalidated signatures as audit history", async () => {
  const { database, server, access } = fixture();
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    const originalSignature = structuredClone(record.signatures[0]);
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Replaced" });
    assert.deepEqual(record.signatures[0], originalSignature);
    assert.ok(core.activityMissing(record, "before").some((item) => item.key === "before_customer" && item.kind === "signature"));
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Replaced", after_model: "Installed unit" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    const submitted = await server.submitActivityRecord(access, record.id, record.revision);
    assert.equal(submitted.status, "submitted_for_creditex_review");
    await assert.rejects(server.saveActivityAnswers(access, submitted.id, submitted.revision, submitted.answers), /ACTIVITY_ALREADY_SUBMITTED/);
    assert.throws(() => database.prepare("UPDATE trade_activity_field_records SET revision = revision + 1 WHERE id = ?").run(submitted.id), /immutable/);
    assert.throws(() => database.prepare("DELETE FROM trade_activity_field_record_versions WHERE record_id = ?").run(submitted.id), /retained/);
    assert.ok(database.prepare("SELECT COUNT(*) count FROM trade_activity_field_record_versions WHERE record_id = ?").get(submitted.id).count >= 6);
  } finally { database.close(); }
});

test("adding an optional before-work signature keeps the old final signature as audit history and permits re-signing", async () => {
  const optionalBefore = form();
  optionalBefore.declarations[0].required = false;
  const { database, server, access } = fixture(optionalBefore);
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Unit" });
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    const originalFinalSignature = structuredClone(record.signatures[0]);
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    assert.deepEqual(record.signatures[0], originalFinalSignature);
    assert.ok(core.activityMissing(record).some((item) => item.key === "after_technician" && item.kind === "signature"));
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision, declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes });
    assert.deepEqual(core.activityMissing(record), []);
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


test("phone saves apply only changed answers to the latest record automatically", async () => {
  const { database, server, access } = fixture();
  try {
    let initial = await server.openActivityRecord(access, "job-a", "intent-a");
    initial = await server.saveActivityAnswers(access, initial.id, initial.revision, { before_name: "Customer", after_model: "Old model" });
    await server.saveActivityAnswers(access, initial.id, initial.revision, { ...initial.answers, before_name: "Office corrected customer" });
    const saved = await server.saveActivityAnswers(access, initial.id, initial.revision,
      { ...initial.answers, after_model: "Installed model" }, initial.answers);
    assert.equal(saved.answers.before_name, "Office corrected customer");
    assert.equal(saved.answers.after_model, "Installed model");
    const latestPhone = await server.saveActivityAnswers(access, initial.id, initial.revision,
      { ...initial.answers, after_model: "Corrected installed model" }, initial.answers);
    assert.equal(latestPhone.answers.after_model, "Corrected installed model");
    assert.equal(latestPhone.answers.before_name, "Office corrected customer");
  } finally { database.close(); }
});

test("automatic draft merge keeps audit signatures while allowing the phone answer to advance", async () => {
  const { database, server, access } = fixture();
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer" });
    const base = record;
    record = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    const saved = await server.saveActivityAnswers(access, record.id, base.revision,
      { before_name: "Changed signed customer" }, base.answers);
    assert.equal(saved.answers.before_name, "Changed signed customer");
    assert.equal(saved.signatures.length, 1);
    assert.ok(core.activityMissing(saved, "before").some((item) => item.key === "before_customer" && item.kind === "signature"));
  } finally { database.close(); }
});

test("signature content binding accepts a harmless later revision but rejects changed work", async () => {
  const { database, server, access } = fixture();
  try {
    let record = await server.openActivityRecord(access, "job-a", "intent-a");
    record = await server.saveActivityAnswers(access, record.id, record.revision, { before_name: "Customer", after_model: "Original" });
    const shown = server.activityPresentation(record);
    await server.saveActivityAnswers(access, record.id, record.revision, { ...record.answers, after_model: "After-work change" });
    const signed = await server.signActivityDeclaration(access, record.id, { expectedRevision: record.revision,
      expectedScope: shown.signingScopes.before, declarationKey: "before_customer", signerName: "Customer", acknowledged: true, strokes });
    assert.equal(signed.signatures.length, 1);
    await assert.rejects(server.signActivityDeclaration(access, record.id, { expectedRevision: signed.revision,
      expectedScope: shown.signingScopes.after, declarationKey: "after_technician", signerName: "Worker A", acknowledged: true, strokes }), /ACTIVITY_SIGNING_SCOPE_CHANGED/);
  } finally { database.close(); }
});

function signingProfileFixture(options = {}) {
  const context = fixture(form(), options);
  context.database.exec(`ALTER TABLE trade_team_members ADD COLUMN member_uid TEXT DEFAULT '';
    ALTER TABLE trade_team_members ADD COLUMN updated_at TEXT DEFAULT '';
    ALTER TABLE trade_accounts ADD COLUMN contact_name TEXT DEFAULT '';
    CREATE TABLE trade_team_member_events (id TEXT, owner_uid TEXT, team_member_id TEXT, actor_uid TEXT,
      entity_type TEXT, entity_id TEXT, event_type TEXT, metadata TEXT, created_at TEXT);`);
  return context;
}

test("an owner contact is suggested but becomes signing identity only after personal confirmation", async () => {
  const { database, server, access } = signingProfileFixture();
  try {
    database.exec(`UPDATE trade_team_members SET first_name = '', last_name = '', member_uid = 'owner-a', display_name = 'Business Pty Ltd';
      INSERT INTO trade_accounts (firebase_uid, contact_name) VALUES ('owner-a', 'Pat Owner');`);
    const ownerAccess = { ...access, isOwner: true, actorUid: "owner-a" };
    const record = await server.openActivityRecord(ownerAccess, "job-a", "intent-a");
    assert.equal(record.signerDefaults.technician, "");
    assert.deepEqual(await server.activitySigningProfileSetup(ownerAccess, record), {
      firstName: "Pat", lastName: "Owner", firstNameLocked: false, lastNameLocked: false, canSave: true,
    });
    const saved = await server.saveActivitySigningProfile(ownerAccess, record.id, { firstName: "James", lastName: "Technician" });
    assert.equal(saved.signerDefaults.technician, "James Technician");
    assert.equal(await server.activitySigningProfileSetup(ownerAccess, saved), undefined);
    assert.equal(saved.revision, record.revision);
    assert.equal(database.prepare("SELECT display_name FROM trade_team_members WHERE id = 'worker-a'").get().display_name, "Business Pty Ltd");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events").get().count, 1);
    assert.equal((await server.openActivityRecord(ownerAccess, "job-a", "intent-a")).signerDefaults.technician, "James Technician");
    await server.saveActivitySigningProfile(ownerAccess, record.id, { firstName: "Overwrite", lastName: "Attempt" });
    assert.equal((await server.loadActivityRecord(ownerAccess, record.id)).signerDefaults.technician, "James Technician");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events").get().count, 1);
  } finally { database.close(); }
});

test("staff name setup fills missing parts only and never suggests the business contact", async () => {
  const { database, server, access } = signingProfileFixture();
  try {
    database.exec(`UPDATE trade_team_members SET first_name = 'Existing', last_name = '', display_name = 'Business Pty Ltd';
      INSERT INTO trade_accounts (firebase_uid, contact_name) VALUES ('owner-a', 'Somebody Else');`);
    const record = await server.openActivityRecord(access, "job-a", "intent-a");
    assert.deepEqual(await server.activitySigningProfileSetup(access, record), {
      firstName: "Existing", lastName: "", firstNameLocked: true, lastNameLocked: false, canSave: true,
    });
    await assert.rejects(server.saveActivitySigningProfile(access, record.id, { firstName: "Changed", lastName: " " }), /ACTIVITY_SIGNING_PROFILE_NAME_REQUIRED/);
    const saved = await server.saveActivitySigningProfile(access, record.id, { firstName: "Changed", lastName: "Surname" });
    assert.equal(saved.signerDefaults.technician, "Existing Surname");
    assert.equal(database.prepare("SELECT display_name FROM trade_team_members WHERE id = 'worker-a'").get().display_name, "Business Pty Ltd");
  } finally { database.close(); }
});

test("signing profile setup refuses another assigned worker, inactive member and cross-business access", async () => {
  const { database, server, access } = signingProfileFixture();
  try {
    database.exec("UPDATE trade_team_members SET first_name = '', last_name = ''");
    const record = await server.openActivityRecord(access, "job-a", "intent-a");
    const manager = { ...access, isOwner: true, memberId: "manager", jobScope: "team" };
    assert.equal((await server.activitySigningProfileSetup(manager, record)).canSave, false);
    await assert.rejects(server.saveActivitySigningProfile(manager, record.id, { firstName: "Wrong", lastName: "Person" }), /ACTIVITY_TECHNICIAN_SIGNER_NOT_ASSIGNED/);
    await assert.rejects(server.saveActivitySigningProfile({ ...access, ownerUid: "owner-b" }, record.id, { firstName: "Wrong", lastName: "Person" }), /ACTIVITY_RECORD_NOT_FOUND/);
    database.exec("UPDATE trade_team_members SET status = 'inactive'");
    await assert.rejects(server.saveActivitySigningProfile(access, record.id, { firstName: "Wrong", lastName: "Person" }), /ACTIVITY_TECHNICIAN_SIGNER_NOT_ASSIGNED/);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events").get().count, 0);
  } finally { database.close(); }
});

test("signing profile name confirmation cannot overwrite a concurrent name change or changed assignment", async () => {
  for (const mutation of ["UPDATE trade_team_members SET first_name = 'New', last_name = 'Name' WHERE id = 'worker-a'",
    "UPDATE trade_work_orders SET assignee_member_id = 'worker-c' WHERE id = 'job-a'"]) {
    let armed = false;
    const { database, server, access } = signingProfileFixture({ beforeRun({ sql, database: db }) {
      if (armed && /UPDATE trade_team_members SET/.test(sql)) { armed = false; db.exec(mutation); }
    } });
    try {
      database.exec("UPDATE trade_team_members SET first_name = '', last_name = ''");
      const record = await server.openActivityRecord(access, "job-a", "intent-a");
      armed = true;
      await assert.rejects(server.saveActivitySigningProfile(access, record.id, { firstName: "Old", lastName: "Name" }), /ACTIVITY_SIGNING_PROFILE_CHANGED/);
      assert.notEqual(database.prepare("SELECT first_name FROM trade_team_members WHERE id = 'worker-a'").get().first_name, "Old");
      assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_member_events").get().count, 0);
    } finally { database.close(); }
  }
});
