import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as library from "../src/lib/trade-activity-forms-library.ts";
import * as core from "../src/lib/trade-activity-forms.ts";
import * as bounded from "../src/lib/bounded-json-request.ts";
import * as flow from "../src/lib/trade-activity-form-flow.ts";
import { validateActivityEvidenceBytes } from "../src/lib/trade-activity-forms-pdf.ts";
import { PDFDocument } from "pdf-lib";

const source = fs.readFileSync(new URL("../src/app/api/trade-activity-forms/route.ts", import.meta.url), "utf8");
function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_work_orders (id TEXT, firebase_uid TEXT, record_status TEXT, assignee_member_id TEXT);
    INSERT INTO trade_work_orders VALUES ('job','owner','active','worker');
    CREATE TABLE trade_work_order_compliance_intents (id TEXT PRIMARY KEY, work_order_id TEXT, installer_uid TEXT, compliance_organisation_id TEXT, activity_template_id TEXT, status TEXT);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT, firebase_uid TEXT, customer_source TEXT, crm_customer_id TEXT, service_site_id TEXT);
    CREATE TABLE trade_crm_customers (id TEXT, firebase_uid TEXT, first_name TEXT, last_name TEXT, email TEXT, phone TEXT);
    CREATE TABLE trade_crm_service_sites (id TEXT, firebase_uid TEXT, address_line_1 TEXT, address_line_2 TEXT, suburb TEXT, address_state TEXT, postcode TEXT);
    CREATE TABLE trade_team_members (id TEXT, owner_uid TEXT, status TEXT, display_name TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE trade_team_member_credentials (id TEXT, owner_uid TEXT, team_member_id TEXT, file_id TEXT, credential_number TEXT, name TEXT, rental_gate TEXT, credential_type TEXT, expires_at TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE trade_team_member_files (id TEXT, owner_uid TEXT, team_member_id TEXT, status TEXT, expires_at TEXT);`);
  database.exec(fs.readFileSync(new URL("../drizzle/0170_trade_activity_forms.sql", import.meta.url), "utf8"));
  const d1 = { prepare(sql) { return { bind(...values) { return {
    async first() { return database.prepare(sql).get(...values) || null; },
    async all() { return { results: database.prepare(sql).all(...values) }; },
    async run() { const result = database.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
  }; } }; } };
  const load = (text, imports) => {
    const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", compiled)((name) => { assert.ok(name in imports, name); return imports[name]; }, module, module.exports);
    return module.exports;
  };
  const access = { ownerUid: "owner", actorUid: "owner", isOwner: true, memberId: "worker", jobScope: "team", displayName: "Owner", businessName: "Trade business" };
  const objects = new Map();
  const bucket = { async put(key, bytes) { objects.set(key, bytes); }, async delete(key) { objects.delete(key); },
    async get(key) { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => new Uint8Array(bytes).buffer } : null; } };
  const server = load(fs.readFileSync(new URL("../src/lib/trade-activity-forms-server.ts", import.meta.url), "utf8"), {
    "cloudflare:workers": { env: { EVIDENCE: bucket } }, "../../db": { getD1: () => d1 },
    "./trade-team-server": { assignedJob: async (_access, id) => { assert.equal(id, "job"); return { assignee_member_id: "worker", assignee_label: "Worker" }; } },
    "./trade-activity-forms-library.ts": library, "./trade-activity-forms.ts": core, "./trade-activity-form-flow.ts": flow,
    "./trade-activity-forms-pdf.ts": { validateActivityEvidenceBytes },
  });
  const dependencies = {
    "../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": { sameOrigin: () => true, adminJson: (body, status = 200) => Response.json(body, { status }),
      requireAdminIdentity: async () => ({ uid: "aea-admin" }) },
    "@/lib/compliance-access-server": { requireComplianceAccess: async () => ({ uid: "creditex-author", organisationId: "creditex", organisationCode: "CREDITEX-AU", governanceIdentityVerified: true }) },
    "@/lib/creditex-official-source-custody-server": { resolveActiveCreditexOfficialSourceOrganisation: async () => "creditex" },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access }, "@/lib/trade-activity-forms-server": server,
    "@/lib/bounded-json-request": bounded, "@/lib/trade-activity-forms-library": library, "@/lib/trade-activity-forms": core,
  };
  const route = load(source, dependencies);
  const save = async (form, expectedVersion = 0, actorMode = "creditex") => {
    const response = await route.POST(new Request("https://test.invalid/api/trade-activity-forms", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_master", actorMode, activityTemplateId: form.activityTemplateId, variantId: form.variantId, expectedVersion, form }) }));
    return { status: response.status, body: await response.json() };
  };
  return { database, save, route, objects };
}

test("every unmodified current activity master and premises variant publishes through the real API", async () => {
  const { database, save } = fixture(); let published = 0; const failures = [];
  try {
    for (const item of library.activityFieldCatalogue()) {
      const defaultForm = library.defaultActivityFieldForm(item.activityTemplateId);
      for (const variant of [defaultForm.variantId, ...defaultForm.variantOptions.map((option) => option.id).filter((id) => id !== defaultForm.variantId)]) {
        const form = library.defaultActivityFieldForm(item.activityTemplateId, variant);
        const result = await save(form);
        if (result.status !== 200) failures.push(`${item.activityTemplateId}/${variant}: ${result.status} ${result.body.code}`);
        else {
          const retained = database.prepare("SELECT form_json, form_sha256 FROM trade_activity_field_masters WHERE activity_template_id = ? AND variant_id = ?").get(item.activityTemplateId, variant);
          assert.equal(core.activityHash(JSON.parse(retained.form_json)), retained.form_sha256);
          assert.equal(result.body.expectedVersion, 2); published++;
        }
      }
    }
    assert.deepEqual(failures, []);
    assert.ok(published >= 195);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_activity_field_masters").get().n, published);
  } finally { database.close(); }
});

function editableForm() {
  const base = library.defaultActivityFieldForm(library.activityFieldCatalogue()[0].activityTemplateId);
  const field = (key, phase = "before") => ({ key, phase, label: key, section: "Customer", type: "text", required: true, help: "", options: [] });
  return { ...base, fields: [field("scope"), field("binding.customer_name"), field("model", "after")],
    declarations: [{ key: "customer", title: "Customer", role: "customer", phase: "before", required: true, text: "I am {{customer_name}}.", sourceUrl: "", sourceTextSha256: "" }] };
}

test("edited masters reject missing, later-stage, cyclic or non-answer condition inputs and impossible signature bindings", async () => {
  const { database, save } = fixture();
  const cases = [
    ["missing condition input", (form) => { form.fields[0].condition = { fieldKey: "missing", equals: "yes" }; }],
    ["before field depends on after answer", (form) => { form.fields[0].condition = { fieldKey: "model", equals: "yes" }; }],
    ["self-dependent question", (form) => { form.fields[0].condition = { fieldKey: "scope", equals: "yes" }; }],
    ["mutual dependency", (form) => { form.fields[0].condition = { fieldKey: "binding.customer_name", equals: "yes" }; form.fields[1].condition = { fieldKey: "scope", equals: "yes" }; }],
    ["condition depends on photo answer", (form) => { form.fields[2].type = "photo"; form.fields[1].phase = "after"; form.fields[1].condition = { fieldKey: "model", equals: "yes" }; }],
    ["missing declaration binding", (form) => { form.declarations[0].text = "I am {{unknown}}."; }],
    ["before signature needs after binding", (form) => { form.fields[1].phase = "after"; }],
    ["signature binding is an upload", (form) => { form.fields[1].type = "photo"; }],
    ["hidden signature binding", (form) => { form.fields[1].condition = { fieldKey: "scope", equals: "yes" }; }],
    ["before declaration depends on after answer", (form) => { form.declarations[0].condition = { fieldKey: "model", equals: "yes" }; }],
    ["unreachable required select value", (form) => { form.fields[0].type = "select"; form.fields[0].options = ["one", "two"]; form.fields[0].requiredValue = "three"; }],
  ];
  const failures = [];
  try {
    for (const [label, edit] of cases) {
      const form = editableForm(); edit(form);
      const current = database.prepare("SELECT COALESCE(MAX(version),0) version FROM trade_activity_field_masters WHERE activity_template_id = ? AND variant_id = ?").get(form.activityTemplateId, form.variantId).version;
      const result = await save(form, current);
      if (result.status !== 400 || result.body.code !== "INVALID_ACTIVITY_MASTER") failures.push(`${label}: ${result.status} ${result.body.code}`);
    }
    assert.deepEqual(failures, []); assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_activity_field_masters").get().n, 0);
  } finally { database.close(); }
});

test("valid conditional declaration edits publish immediately and stale admin saves preserve the published version", async () => {
  const { database, save } = fixture();
  try {
    const form = editableForm(); form.declarations[0].condition = { fieldKey: "scope", equals: "yes" }; form.fields[1].condition = { fieldKey: "scope", equals: "yes" };
    const first = await save(form, 0, "admin"); assert.equal(first.status, 200);
    const stale = await save({ ...form, title: "Stale edit" }, 0, "creditex"); assert.equal(stale.status, 409);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_activity_field_masters").get().n, 1);
    assert.equal(JSON.parse(database.prepare("SELECT form_json FROM trade_activity_field_masters").get().form_json).title, form.title);
  } finally { database.close(); }
});

test("saving and reloading a default master changes newly opened field records while VEU44 supports a manufacturer PDF without invented GPS", async () => {
  const { database, save, route, objects } = fixture();
  const jsonPost = async (body) => {
    const response = await route.POST(new Request("https://test.invalid/api/trade-activity-forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  };
  try {
    const form = library.defaultActivityFieldForm("veu-44"); form.title = "Creditex edited commercial water heating form";
    const published = await save(form); assert.equal(published.status, 200);
    const reloadedResponse = await route.GET(new Request("https://test.invalid/api/trade-activity-forms?view=masters&actorMode=creditex&activityTemplateId=veu-44"));
    const reloaded = await reloadedResponse.json(); assert.equal(reloaded.form.title, form.title); assert.equal(reloaded.form.version, published.body.form.version);
    database.prepare("INSERT INTO trade_work_order_compliance_intents VALUES ('intent','job','owner','creditex','veu-44','planned')").run();
    let { record } = await jsonPost({ action: "open", workOrderId: "job", intentId: "intent" });
    assert.equal(record.form.version, published.body.form.version); assert.equal(record.form.title, form.title);
    assert.equal(record.formSha256, core.activityHash(published.body.form));
    const plate = "baseline.product_plate_readable";
    const photoField = form.fields.find((field) => field.key === "evidence.ci-water-heater-existing-product");
    const documentField = form.fields.find((field) => field.key === "evidence.ci-water-heater-existing-product.manufacturer");
    const visiblePhoto = flow.expandedActivityFields(form, { [plate]: true });
    assert.ok(visiblePhoto.some((field) => field.key === photoField.key)); assert.ok(!visiblePhoto.some((field) => field.key === documentField.key));
    assert.equal(photoField.type, "photo"); assert.equal(photoField.requireLocation, true);
    ({ record } = await jsonPost({ action: "save", recordId: record.id, expectedRevision: record.revision, answers: { ...record.answers, [plate]: false } }));
    const visibleDocument = flow.expandedActivityFields(record.form, record.answers);
    assert.ok(visibleDocument.some((field) => field.key === documentField.key)); assert.ok(!visibleDocument.some((field) => field.key === photoField.key));
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
    const upload = new FormData(); upload.append("recordId", record.id); upload.append("expectedRevision", String(record.revision));
    upload.append("fieldKey", documentField.key); upload.append("file", new Blob([bytes], { type: "application/pdf" }), "manufacturer-information.pdf");
    const response = await route.POST(new Request("https://test.invalid/api/trade-activity-forms", { method: "POST", body: upload }));
    const uploaded = await response.json(); assert.equal(response.status, 200, JSON.stringify(uploaded));
    const evidence = uploaded.record.evidence[0]; assert.equal(evidence.contentType, "application/pdf");
    assert.equal(evidence.latitude, null); assert.equal(evidence.longitude, null); assert.equal(evidence.metadataOrigin, "file_upload");
    assert.equal(evidence.sha256, core.activityHash(bytes)); assert.equal(objects.size, 1);
  } finally { database.close(); }
});
