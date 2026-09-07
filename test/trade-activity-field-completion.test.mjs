import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { UNFINISHED_ACTIVITY_FIELD_INTENTS_SQL, submittedActivityFieldCaseSql, submittedActivityFieldRecordSql } from "../src/lib/trade-activity-forms-completion.ts";
import { defaultActivityFieldForm, activityFieldCatalogue } from "../src/lib/trade-activity-forms-library.ts";
import { GOVERNMENT_ACTIVITY_TEMPLATES } from "../src/lib/australian-government-program-catalogue.ts";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import { renderCreditexConsumerRightsPdf } from "../src/lib/trade-activity-forms-pdf.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_work_order_compliance_intents (id TEXT, work_order_id TEXT, installer_uid TEXT, compliance_organisation_id TEXT, activity_template_id TEXT, status TEXT);
    CREATE TABLE trade_activity_field_records (id TEXT, intent_id TEXT, work_order_id TEXT, owner_uid TEXT, organisation_id TEXT, activity_template_id TEXT, status TEXT, pdf_object_key TEXT, pdf_sha256 TEXT);
    CREATE TABLE compliance_cases (id TEXT, compliance_intent_id TEXT, installer_uid TEXT, work_order_id TEXT, organisation_id TEXT, status TEXT);
    CREATE TABLE compliance_activity_work_pack_instances (id TEXT, compliance_case_id TEXT, compliance_intent_id TEXT, work_order_id TEXT, organisation_id TEXT, status TEXT, instance_key TEXT, work_pack_version_id TEXT, revision INTEGER);
    CREATE TABLE compliance_activity_work_pack_final_records (case_instance_id TEXT, organisation_id TEXT, instance_key TEXT, work_pack_version_id TEXT);
    INSERT INTO trade_work_order_compliance_intents VALUES ('intent-1','job','owner','creditex','activity-1','planned'), ('intent-2','job','owner','creditex','activity-2','planned');`);
  const missing = () => db.prepare(`SELECT COUNT(*) n FROM (${UNFINISHED_ACTIVITY_FIELD_INTENTS_SQL})`).get("job", "owner").n;
  const submit = (id, intent, activity, owner = "owner", organisation = "creditex", status = "submitted_for_creditex_review", pdf = "retained.pdf") => {
    db.prepare("INSERT INTO trade_activity_field_records VALUES (?,?,?,?,?,?,?,?,?)").run(id, intent, "job", owner, organisation, activity, status, pdf, "a".repeat(64));
  };
  return { db, missing, submit };
}

test("each current activity needs its own completed field handoff", () => {
  const { db, missing, submit } = fixture();
  assert.equal(missing(), 2);
  submit("one", "intent-1", "activity-1"); assert.equal(missing(), 1);
  submit("two", "intent-2", "activity-2"); assert.equal(missing(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compliance_cases").get().n, 0, "Certificate-case creation is not a field-completion requirement");
  db.close();
});

test("another tenant, organisation, activity, draft or missing PDF cannot satisfy an intent", () => {
  const { db, missing, submit } = fixture();
  submit("wrong-owner", "intent-1", "activity-1", "other");
  submit("wrong-org", "intent-1", "activity-1", "owner", "other");
  submit("wrong-activity", "intent-1", "activity-2");
  submit("draft", "intent-1", "activity-1", "owner", "creditex", "draft");
  submit("no-pdf", "intent-1", "activity-1", "owner", "creditex", "submitted_for_creditex_review", "");
  assert.equal(missing(), 2);
  assert.throws(() => submittedActivityFieldRecordSql("injected_alias; DROP TABLE anything"));
  assert.throws(() => submittedActivityFieldCaseSql("anything"));
  db.close();
});

test("the existing governed completed work-pack path remains valid but an unfinished newer revision blocks it", () => {
  const { db, missing } = fixture();
  db.exec(`INSERT INTO compliance_cases VALUES ('case','intent-1','owner','job','creditex','draft');
    INSERT INTO compliance_activity_work_pack_instances VALUES ('pack','case','intent-1','job','creditex','completed','instance','v1',1);
    INSERT INTO compliance_activity_work_pack_final_records VALUES ('pack','creditex','instance','v1');`);
  assert.equal(missing(), 1);
  db.exec(`INSERT INTO compliance_activity_work_pack_instances VALUES ('newer','case','intent-1','job','creditex','in_progress','instance','v1',2)`);
  assert.equal(missing(), 2);
  db.close();
});

test("all current selectable activities have specific runnable fields and no missing Creditex-template upload", () => {
  const catalogue = activityFieldCatalogue();
  const current = GOVERNMENT_ACTIVITY_TEMPLATES.filter((item) => ["current", "limited"].includes(item.catalogueState));
  assert.deepEqual(new Set(catalogue.map((item) => item.activityTemplateId)), new Set(current.map((item) => item.templateId)));
  for (const item of catalogue) {
    const defaultForm = defaultActivityFieldForm(item.activityTemplateId);
    for (const form of [defaultForm, ...defaultForm.variantOptions.filter((variant) => variant.id !== defaultForm.variantId).map((variant) => defaultActivityFieldForm(item.activityTemplateId, variant.id))]) {
    assert.ok(form.fields.length > 0, item.activityTemplateId); assert.equal(form.activityTemplateId, item.activityTemplateId);
    assert.equal(new Set(form.fields.map((field) => field.key)).size, form.fields.length);
    assert.ok(form.declarations.some((declaration) => declaration.role === "technician"));
    assert.ok(form.fields.every((field) => !/Attach the signed Creditex|Does this condition apply/.test(`${field.label} ${field.help}`)), item.activityTemplateId);
    assert.ok(form.fields.every((field) => /^[a-zA-Z0-9._:-]{1,180}$/.test(field.key)), item.activityTemplateId);
    const keys = new Set(form.fields.map((field) => field.key));
    const check = (condition, phase) => { if (!condition) return; if (condition.fieldKey) {
      assert.ok(keys.has(condition.fieldKey), `${item.activityTemplateId}: ${condition.fieldKey}`);
      if (phase === "before") assert.equal(form.fields.find((field) => field.key === condition.fieldKey).phase, "before", `${item.activityTemplateId}: before-work condition cannot depend on later work`);
    } for (const child of [...(condition.all || []), ...(condition.any || [])]) check(child, phase); };
    form.fields.forEach((field) => check(field.condition, field.phase)); form.declarations.forEach((declaration) => {
      check(declaration.condition, declaration.phase);
      for (const token of declaration.text.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const input = form.fields.find((field) => field.key === `binding.${token[1]}`);
        assert.ok(input, `${item.activityTemplateId}: ${token[1]} has a collectable binding`);
        if (declaration.phase === "before") assert.equal(input.phase, "before");
      }
    });
    }
  }
});

test("consumer receipt questions expose applicable handouts before signing without claiming opening is delivery", async () => {
  for (const item of activityFieldCatalogue()) {
    const form = defaultActivityFieldForm(item.activityTemplateId);
    if (item.programCode === "VEU") {
      const receipt = form.fields.find((field) => field.key === "disclosures.veu_factsheet_given");
      assert.equal(receipt.phase, "before"); assert.equal(receipt.requiredValue, true);
      assert.ok(receipt.referenceDocuments.some((document) => /consumer-factsheet\.pdf$/.test(document.url)));
      assert.ok(receipt.referenceDocuments.some((document) => document.url === "/api/trade-activity-forms?consumerDocument=veu-rights-v1"));
    }
    if (item.programCode.startsWith("NSW") && /^(D16|D17|D19|BESS[1-4])$/.test(item.activityCode)) {
      const receipts = form.fields.filter((field) => /factsheet/i.test(`${field.key} ${field.label}`));
      assert.ok(receipts.length, item.activityTemplateId);
      assert.ok(receipts.every((field) => field.referenceDocuments?.length && field.phase === "before"), item.activityTemplateId);
    }
  }
  const bytes = await renderCreditexConsumerRightsPdf({ regular: fs.readFileSync(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url)),
    bold: fs.readFileSync(new URL("../public/fonts/LiberationSans-Bold.ttf", import.meta.url)) });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1); assert.match(pdf.getTitle(), /Creditex Statement of Rights/);
});
