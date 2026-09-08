import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { UNFINISHED_ACTIVITY_FIELD_INTENTS_SQL, submittedActivityFieldCaseSql, submittedActivityFieldRecordSql } from "../src/lib/trade-activity-forms-completion.ts";
import {
  ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS,
  INSTALLER_ID_SELFIE_FIELD_KEY,
  activityConsumerDocuments,
  activityFieldCatalogue,
  activityPrefill,
  applyDefaultActivityFormPolicy,
  defaultActivityFieldForm,
} from "../src/lib/trade-activity-forms-library.ts";
import { activityMissing } from "../src/lib/trade-activity-forms.ts";
import { activityWizardSteps } from "../src/lib/trade-activity-form-flow.ts";
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

function conditionReferences(condition) {
  if (!condition) return [];
  if (condition.fieldKey) return [condition.fieldKey];
  return [...(condition.all || []), ...(condition.any || [])].flatMap(conditionReferences);
}

function conditionLeaves(condition) {
  if (!condition) return [];
  if (condition.fieldKey) return [condition];
  return [...(condition.all || []), ...(condition.any || [])].flatMap(conditionLeaves);
}

function potentialWizardFieldOrder(form) {
  const result = [];
  const emittedGroups = new Set();
  for (const phase of ["before", "after"]) {
    const fields = form.fields.filter((field) => field.phase === phase);
    for (const field of fields) {
      if (!field.repeatGroup) {
        result.push(field.key);
        continue;
      }
      const groupKey = `${phase}:${field.section}:${field.repeatGroup}`;
      if (emittedGroups.has(groupKey)) continue;
      emittedGroups.add(groupKey);
      result.push(...fields.filter((member) => member.section === field.section && member.repeatGroup === field.repeatGroup).map((member) => member.key));
    }
  }
  return result;
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
    const installerSelfies = form.fields.filter((field) => field.key === INSTALLER_ID_SELFIE_FIELD_KEY);
    assert.equal(installerSelfies.length, 1, `${item.activityTemplateId}/${form.variantId}: one installer ID selfie`);
    assert.deepEqual(installerSelfies[0], {
      key: INSTALLER_ID_SELFIE_FIELD_KEY, section: "Start of job", label: "Take a selfie holding your installer ID",
      type: "photo", required: true, options: [],
      help: "Before work starts, take a clear selfie at the job address showing your face and installer ID. TLink records the capture time and GPS location.",
      phase: "before", requireLocation: true,
    });
    assert.equal(form.fields.find((field) => field.phase === "before")?.key, INSTALLER_ID_SELFIE_FIELD_KEY);
    assert.equal(activityWizardSteps(form, {})[0]?.key, INSTALLER_ID_SELFIE_FIELD_KEY);
    assert.equal(new Set(form.fields.map((field) => field.key)).size, form.fields.length);
    assert.ok(form.declarations.some((declaration) => declaration.role === "technician"));
    assert.ok(form.fields.every((field) => !/Attach the signed Creditex|Does this condition apply/.test(`${field.label} ${field.help}`)), item.activityTemplateId);
    assert.ok(form.fields.every((field) => /^[a-zA-Z0-9._:-]{1,180}$/.test(field.key)), item.activityTemplateId);
    assert.ok(form.fields.filter((field) => field.autofill).every((field) => ["derived", "prefilled"].includes(field.presentation)), item.activityTemplateId);
    assert.ok(!form.fields.some((field) => /(?:signature|declaration|acknowledgement|acknowledgment|assignment)(?:\.|_|-)*(?:date|signed(?:\.|_|-)*at)$/i.test(field.key)
      || /^signatureEvents\..+\.localDate$/.test(field.autofill || "")), item.activityTemplateId);
    assert.ok(!form.fields.some((field) => /^(?:job\.actualInstallationDate|job\.invoice\.|productRegistry\.)/.test(field.autofill || "")), item.activityTemplateId);
    for (const field of form.fields.filter((candidate) => candidate.type === "select")) {
      assert.ok(field.options.every((option) => field.optionLabels?.[option]?.trim()), `${item.activityTemplateId}/${form.variantId}: ${field.key}`);
      assert.ok(field.options.filter((option) => /^Class[1-9]$/i.test(option)).every((option) => /^Class [1-9] building$/.test(field.optionLabels[option])), field.key);
    }
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

test("all implementation and installation dates come from the scheduled appointment", () => {
  let checked = 0;
  for (const item of activityFieldCatalogue()) {
    const defaultForm = defaultActivityFieldForm(item.activityTemplateId);
    const variants = [defaultForm.variantId, ...defaultForm.variantOptions.map((variant) => variant.id).filter((id) => id !== defaultForm.variantId)];
    for (const variant of variants) {
      const form = defaultActivityFieldForm(item.activityTemplateId, variant);
      const scheduled = activityPrefill(form, { scheduledInstallationDate: "2026-09-09", technician: "" });
      for (const field of form.fields.filter((candidate) => candidate.key === "implementation_date"
        || candidate.key === "installation.date" || candidate.key.endsWith(".installation_date"))) {
        checked++;
        assert.equal(field.presentation, "derived", `${item.activityTemplateId}/${variant}: ${field.key}`);
        assert.equal(field.autofill, "job.appointment.date", `${item.activityTemplateId}/${variant}: ${field.key}`);
        assert.equal(scheduled[field.key], "2026-09-09", `${item.activityTemplateId}/${variant}: ${field.key}`);
        assert.ok(!activityWizardSteps(form, {}).some((step) => step.kind === "field" && step.field.baseKey === field.key),
          `${item.activityTemplateId}/${variant}: ${field.key}`);
      }
    }
  }
  assert.ok(checked > 0);
});

test("every catalogue variant orders condition inputs before the questions they control", () => {
  for (const item of activityFieldCatalogue()) {
    const defaultForm = defaultActivityFieldForm(item.activityTemplateId);
    const variants = [defaultForm.variantId, ...defaultForm.variantOptions.map((variant) => variant.id).filter((id) => id !== defaultForm.variantId)];
    for (const variant of variants) {
      const form = defaultActivityFieldForm(item.activityTemplateId, variant);
      const indexes = new Map(potentialWizardFieldOrder(form).map((key, index) => [key, index]));
      for (const field of form.fields) for (const dependencyKey of conditionReferences(field.condition)) {
        const dependencyIndex = indexes.get(dependencyKey);
        assert.notEqual(dependencyIndex, undefined, `${item.activityTemplateId}/${variant}: ${field.key} is missing ${dependencyKey}`);
        assert.ok(dependencyIndex < indexes.get(field.key),
          `${item.activityTemplateId}/${variant}: ${dependencyKey} must be reachable before ${field.key}`);
      }
    }
  }
});

test("every catalogue variant keeps each phase and section in one navigable wizard run", () => {
  for (const item of activityFieldCatalogue()) {
    const defaultForm = defaultActivityFieldForm(item.activityTemplateId);
    const variants = [defaultForm.variantId, ...defaultForm.variantOptions.map((variant) => variant.id).filter((id) => id !== defaultForm.variantId)];
    for (const variant of variants) {
      const form = defaultActivityFieldForm(item.activityTemplateId, variant);
      const fields = new Map(form.fields.map((field) => [field.key, field]));
      const completed = new Set();
      let current = "";
      for (const key of potentialWizardFieldOrder(form)) {
        const field = fields.get(key);
        const section = `${field.phase}:${field.section}`;
        if (section === current) continue;
        assert.ok(!completed.has(section), `${item.activityTemplateId}/${variant}: ${section} is split into multiple runs`);
        if (current) completed.add(current);
        current = section;
      }
    }
  }
});

test("every catalogue condition compares a value with the controller's actual field type", () => {
  let checked = 0;
  for (const item of activityFieldCatalogue()) {
    const defaultForm = defaultActivityFieldForm(item.activityTemplateId);
    const variants = [defaultForm.variantId, ...defaultForm.variantOptions.map((variant) => variant.id).filter((id) => id !== defaultForm.variantId)];
    for (const variant of variants) {
      const form = defaultActivityFieldForm(item.activityTemplateId, variant);
      const fields = new Map(form.fields.map((field) => [field.key, field]));
      for (const dependent of [...form.fields, ...form.declarations]) for (const condition of conditionLeaves(dependent.condition)) {
        checked++;
        const input = fields.get(condition.fieldKey);
        assert.ok(input, `${item.activityTemplateId}/${variant}: ${dependent.key} is missing ${condition.fieldKey}`);
        const value = condition.lessThanOrEqual ?? condition.equals ?? condition.notEquals;
        if (condition.lessThanOrEqual !== undefined) {
          assert.equal(input.type, "number", `${item.activityTemplateId}/${variant}: ${dependent.key}`);
          assert.equal(typeof value, "number", `${item.activityTemplateId}/${variant}: ${dependent.key}`);
          assert.ok(Number.isFinite(value), `${item.activityTemplateId}/${variant}: ${dependent.key}`);
          continue;
        }
        if (input.type === "boolean") assert.equal(typeof value, "boolean", `${item.activityTemplateId}/${variant}: ${dependent.key}`);
        else if (input.type === "number") {
          assert.equal(typeof value, "number", `${item.activityTemplateId}/${variant}: ${dependent.key}`);
          assert.ok(Number.isFinite(value), `${item.activityTemplateId}/${variant}: ${dependent.key}`);
        } else {
          assert.ok(["text", "date", "select"].includes(input.type), `${item.activityTemplateId}/${variant}: ${condition.fieldKey} cannot control visibility`);
          assert.equal(typeof value, "string", `${item.activityTemplateId}/${variant}: ${dependent.key}`);
          if (input.type === "select") assert.ok(input.options.includes(value), `${item.activityTemplateId}/${variant}: ${dependent.key}`);
        }
      }
    }
  }
  assert.ok(checked > 300);
});

test("conditional ordering fails closed for missing references, phase inversions and cycles", () => {
  const baseline = defaultActivityFieldForm("veu-6", "veu_6_residential");
  const custom = (key, phase, condition, section = "Custom routing") => ({ key, section, label: key, type: "boolean", required: true,
    options: [], help: "", phase, condition });

  const missing = structuredClone(baseline);
  missing.fields.push(custom("custom.missing-dependent", "before", { fieldKey: "custom.not-present", equals: true }));
  assert.throws(() => applyDefaultActivityFormPolicy(missing, baseline), /INVALID_ACTIVITY_FORM_CONDITION_REFERENCE/);

  const inverted = structuredClone(baseline);
  inverted.fields.push(custom("custom.before-dependent", "before", { fieldKey: "custom.after-input", equals: true }),
    custom("custom.after-input", "after"));
  assert.throws(() => applyDefaultActivityFormPolicy(inverted, baseline), /INVALID_ACTIVITY_FORM_CONDITION_PHASE/);

  const cyclic = structuredClone(baseline);
  cyclic.fields.push(custom("custom.cycle-a", "after", { fieldKey: "custom.cycle-b", equals: true }),
    custom("custom.cycle-b", "after", { fieldKey: "custom.cycle-a", equals: true }));
  assert.throws(() => applyDefaultActivityFormPolicy(cyclic, baseline), /INVALID_ACTIVITY_FORM_CONDITION_CYCLE/);

  const sectionCycle = structuredClone(baseline);
  sectionCycle.fields.push(custom("custom.section-a-input", "after", undefined, "Custom A"),
    custom("custom.section-a-dependent", "after", { fieldKey: "custom.section-b-input", equals: true }, "Custom A"),
    custom("custom.section-b-input", "after", undefined, "Custom B"),
    custom("custom.section-b-dependent", "after", { fieldKey: "custom.section-a-input", equals: true }, "Custom B"));
  assert.throws(() => applyDefaultActivityFormPolicy(sectionCycle, baseline), /INVALID_ACTIVITY_FORM_CONDITION_SECTION_CYCLE/);
});

test("saved masters normalise boolean condition words and reject values that cannot match the controller", () => {
  const baseline = defaultActivityFieldForm("veu-6", "veu_6_residential");
  const custom = (key, type, condition) => ({ key, section: "Custom routing", label: key, type, required: true,
    options: [], help: "", phase: "after", condition });
  const normalised = structuredClone(baseline);
  normalised.fields.push(custom("custom.boolean-input", "boolean"),
    custom("custom.boolean-dependent", "text", { fieldKey: "custom.boolean-input", equals: "Yes" }));
  const governed = applyDefaultActivityFormPolicy(normalised, baseline);
  assert.deepEqual(governed.fields.find((field) => field.key === "custom.boolean-dependent").condition,
    { fieldKey: "custom.boolean-input", equals: true });

  const invalid = structuredClone(baseline);
  invalid.fields.push(custom("custom.invalid-input", "boolean"),
    custom("custom.invalid-dependent", "text", { fieldKey: "custom.invalid-input", equals: "maybe" }));
  assert.throws(() => applyDefaultActivityFormPolicy(invalid, baseline), /INVALID_ACTIVITY_FORM_CONDITION_VALUE/);

  const invalidUpperBound = structuredClone(baseline);
  invalidUpperBound.fields.push(custom("custom.non-number-input", "boolean"),
    custom("custom.invalid-upper-bound", "text", { fieldKey: "custom.non-number-input", lessThanOrEqual: 1 }));
  assert.throws(() => applyDefaultActivityFormPolicy(invalidUpperBound, baseline), /INVALID_ACTIVITY_FORM_CONDITION_VALUE/);
});

test("every booking handout has one complete provider-accepted receipt and no manual delivery duplicate", async () => {
  const receiptKeys = new Set(Object.values(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS));
  assert.equal(receiptKeys.size, 9);
  const manualKeys = new Set(["disclosures.veu_factsheet_given", "disclosures.veu_rights_given", "disclosures.veu_factsheet_method",
    "disclosures.veu_factsheet_time", "consumer_checks.sizing_factsheet_received", "consumer_checks.sizing_consistency_informed",
    "customer_documents", "factsheet_receipt", "factsheet", "cooktop_consumer_fact_sheet_provided"]);
  const manualEvidence = new Set(["factsheet-delivery", "customer-factsheet", "facts"]);
  for (const item of activityFieldCatalogue()) {
    const defaultForm = defaultActivityFieldForm(item.activityTemplateId);
    const variants = [defaultForm.variantId, ...defaultForm.variantOptions.map((variant) => variant.id).filter((id) => id !== defaultForm.variantId)];
    for (const variant of variants) {
      const form = defaultActivityFieldForm(item.activityTemplateId, variant);
      const documents = activityConsumerDocuments(item.activityTemplateId, variant);
      const receipts = form.fields.filter((field) => receiptKeys.has(field.key));
      assert.equal(receipts.length, documents.length ? receiptKeys.size : 0, `${item.activityTemplateId}/${variant}`);
      if (!documents.length) continue;
      assert.ok(documents.every((document) => document.requiredTiming === "booking_before_customer_agreement"));
      assert.ok(receipts.every((field) => field.presentation === "derived" && field.required === false && !/Delivered/i.test(field.label)));
      assert.ok(receipts.every((field) => /Provider-accepted/i.test(field.label)), `${item.activityTemplateId}/${variant}`);
      assert.deepEqual(receipts.find((field) => field.key === ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.providerAccepted).referenceDocuments,
        documents.map(({ title, url }) => ({ title, url })));
      assert.ok(!form.fields.some((field) => manualKeys.has(field.key) || manualEvidence.has(field.sourceRequirementId)), `${item.activityTemplateId}/${variant}`);
    }
  }
  const bytes = await renderCreditexConsumerRightsPdf({ regular: fs.readFileSync(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url)),
    bold: fs.readFileSync(new URL("../public/fonts/LiberationSans-Bold.ttf", import.meta.url)) });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1); assert.match(pdf.getTitle(), /Creditex Statement of Rights/);
});

test("specialist booking factsheets are selected only for their exact activities and premises", () => {
  const keys = (templateId, variantId = "") => activityConsumerDocuments(templateId, variantId).map((item) => item.key);
  const baseVeu = ["veu-consumer-factsheet", "creditex-veu-statement-of-rights-v1"];
  for (const templateId of ["veu-13", "veu-14", "veu-15", "veu-17", "veu-30", "veu-31", "veu-32", "veu-33", "veu-34", "veu-35", "veu-36", "veu-37", "veu-38", "veu-39"]) {
    assert.deepEqual(keys(templateId), baseVeu, templateId);
  }
  for (const templateId of ["veu-1", "veu-3"]) {
    assert.deepEqual(keys(templateId, `${templateId.replace("-", "_")}_residential`), [...baseVeu, "veu-water-heating-consumer-factsheet"]);
    assert.deepEqual(keys(templateId, `${templateId.replace("-", "_")}_business`), baseVeu);
  }
  assert.deepEqual(keys("veu-6", "veu_6_residential"), [...baseVeu, "veu-heating-cooling-consumer-factsheet"]);
  assert.deepEqual(keys("veu-6", "veu_6_business"), baseVeu);
  assert.deepEqual(keys("veu-46"), [...baseVeu, "veu-cooktop-consumer-factsheet"]);
  assert.deepEqual(keys("veu-47"), baseVeu, "Activity 47 FAQs are optional guidance, not a mandatory signing gate");
  assert.deepEqual(keys("nsw-ess-f16"), ["nsw-heer_hw_facts"]);
  assert.deepEqual(keys("nsw-ess-f17"), ["nsw-heer_hw_facts"]);
});

test("VEU Activity 6 preserves audit codes while deriving scheduled, product and commercial facts", () => {
  const residential = defaultActivityFieldForm("veu-6", "veu_6_residential");
  const business = defaultActivityFieldForm("veu-6", "veu_6_business");
  assert.deepEqual(activityConsumerDocuments("veu-6", residential.variantId).map((item) => item.key), [
    "veu-consumer-factsheet",
    "creditex-veu-statement-of-rights-v1",
    "veu-heating-cooling-consumer-factsheet",
  ]);
  assert.equal(activityConsumerDocuments("veu-6", business.variantId).length, 2);

  const scenario = residential.fields.find((field) => field.key === "baseline.scenario");
  assert.deepEqual(scenario.options, ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi"]);
  assert.match(scenario.optionLabels.i, /Hard-wired resistance electric room heater/i);
  assert.match(scenario.optionLabels.xi, /No decommissioning/i);
  const removal = residential.fields.find((field) => field.key === "prework_scope.removal_scope");
  assert.match(removal.optionLabels.retain_unsafe_or_impractical, /not practical and safe|unsafe or impractical/i);
  const repair = residential.fields.find((field) => field.key === "prework_scope.repair_scope");
  assert.match(repair.optionLabels.some, /some required building repairs/i);

  assert.equal(residential.fields.find((field) => field.key === "customer_property.installation_address")?.presentation, "derived");
  const officeCommercialKeys = [
    "value_required_in_assignment_or_linked_invoice",
    "benefit_payment.benefit_type",
    "benefit_payment.other_benefit",
    "benefit_payment.benefit_amount",
    "benefit_payment.gross_price",
    "benefit_payment.consumer_paid",
    "evidence.air-conditioner-invoice",
  ];
  for (const form of [residential, business]) {
    const installationDate = form.fields.find((field) => field.key === "customer_property.installation_date");
    assert.equal(installationDate?.presentation, "derived");
    assert.equal(installationDate?.autofill, "job.appointment.date");
    for (const key of ["installed_product.category", "installed_product.same_oem"]) {
      assert.equal(form.fields.find((field) => field.key === key)?.presentation, "derived", `${form.variantId}: ${key}`);
      assert.ok(!activityWizardSteps(form, { "installed_product.isMultiSplit": true })
        .some((step) => step.kind === "field" && step.field.baseKey === key), `${form.variantId}: ${key}`);
    }
    assert.equal(form.fields.find((field) => field.key === "installed_product.brand")?.label, "Approved brand");
    assert.equal(form.fields.find((field) => field.key === "installed_product.model")?.label, "Approved model");
    for (const [key, label] of [
      ["installed_product.indoor_heating_kw", "Total installed heating capacity (kW)"],
      ["installed_product.indoor_cooling_kw", "Total installed cooling capacity (kW)"],
    ]) {
      const field = form.fields.find((candidate) => candidate.key === key);
      assert.equal(field?.label, label, `${form.variantId}: ${key}`);
      assert.equal(field?.condition, undefined, `${form.variantId}: ${key}`);
      assert.ok(activityWizardSteps(form, { "installed_product.isMultiSplit": false })
        .some((step) => step.kind === "field" && step.field.baseKey === key), `${form.variantId}: ${key}`);
    }
    for (const key of officeCommercialKeys) {
      assert.equal(form.fields.find((field) => field.key === key)?.presentation, "derived", `${form.variantId}: ${key}`);
      assert.ok(!activityWizardSteps(form, { value_required_in_assignment_or_linked_invoice: true })
        .some((step) => step.kind === "field" && step.field.baseKey === key), `${form.variantId}: ${key}`);
    }
  }
  for (const key of ["workers.electrician.name", "workers.electrician.company_address", "workers.electrician.phone",
    "workers.electrician.licence_or_registration", "workers.licensed_plumber.name", "workers.refrigerant_handler.name"]) {
    const field = residential.fields.find((candidate) => candidate.key === key);
    assert.equal(field?.presentation, "derived", key);
    assert.ok(field?.autofill, key);
    assert.match(field?.label || "", /Electrician|Licensed plumber|Refrigerant handler/i, key);
  }
  assert.ok(!residential.fields.some((field) => /(?:declaration|acknowledgement|assignment)_date$/.test(field.key)));
});

test("VEU Activity 6 presents each scenario and equipment controller before its follow-up", () => {
  for (const variant of ["veu_6_residential", "veu_6_business"]) {
    const form = defaultActivityFieldForm("veu-6", variant);
    const answers = {
      "baseline.scenario": "i",
      "baseline.removed": "no",
      "installed_product.isMultiSplit": true,
      "baseline.isDucted": true,
      "installed_product.isDucted": true,
      value_required_in_assignment_or_linked_invoice: true,
      "certificates.bpc_required": "yes",
      "certificates.coes_required": "yes",
    };
    const wizardFields = activityWizardSteps(form, answers).filter((step) => step.kind === "field");
    const indexes = new Map(wizardFields.map((step, index) => [step.field.baseKey, index]));
    for (const [dependentKey, dependencyKeys] of [
      ["evidence.air-conditioner-existing", ["baseline.scenario"]],
      ["baseline.retained_reason", ["baseline.scenario", "baseline.removed"]],
      ["installed_product.ductwork_replaced", ["baseline.isDucted", "installed_product.isDucted"]],
      ["consumer_checks.certificate_delivery_informed", ["certificates.bpc_required", "certificates.coes_required"]],
    ]) {
      const dependent = form.fields.find((field) => field.key === dependentKey);
      assert.ok(dependent, `${variant}: ${dependentKey}`);
      assert.notEqual(indexes.get(dependentKey), undefined, `${variant}: ${dependentKey} must be visible in the activated wizard`);
      const references = new Set(conditionReferences(dependent.condition));
      for (const dependencyKey of dependencyKeys) {
        assert.ok(references.has(dependencyKey), `${variant}: ${dependentKey} must depend on ${dependencyKey}`);
        assert.notEqual(indexes.get(dependencyKey), undefined, `${variant}: ${dependencyKey} must be visible in the activated wizard`);
        assert.ok(indexes.get(dependencyKey) < indexes.get(dependentKey), `${variant}: ${dependencyKey} must precede ${dependentKey}`);
      }
    }
  }
});

test("SRES battery VPP questions use the recorded numeric distance without a duplicate confirmation", () => {
  const form = defaultActivityFieldForm("sres-bess", "sres_bess");
  const vpp = form.fields.find((field) => field.key === "vpp_capable");
  assert.ok(!form.fields.some((field) => field.key === "scope.distance_km_at_most_1"));
  assert.deepEqual(vpp?.condition, { any: [
    { fieldKey: "grid_connected", equals: true },
    { fieldKey: "distance_km", lessThanOrEqual: 1 },
  ] });
  const visible = (answers, key) => activityWizardSteps(form, answers)
    .some((step) => step.kind === "field" && step.field.baseKey === key);
  assert.equal(visible({ grid_connected: true }, "vpp_capable"), true);
  assert.equal(visible({ grid_connected: false, distance_km: 0.75 }, "vpp_capable"), true);
  assert.equal(visible({ grid_connected: false, distance_km: 1 }, "vpp_capable"), true);
  assert.equal(visible({ grid_connected: false, distance_km: 1.01 }, "vpp_capable"), false);
  assert.equal(visible({ grid_connected: false, distance_km: "0.75" }, "vpp_capable"), false);
});

test("VEU Activity 6 puts required photos and documents beside the facts they prove", () => {
  const form = defaultActivityFieldForm("veu-6", "veu_6_residential");
  const existing = form.fields.find((field) => field.key === "evidence.air-conditioner-existing");
  const installed = form.fields.find((field) => field.key === "evidence.air-conditioner-installed");
  const decommissioned = form.fields.find((field) => field.key === "evidence.air-conditioner-decommissioned");
  assert.equal(existing.section, "Existing equipment"); assert.equal(existing.phase, "before");
  assert.equal(installed.section, "Installed equipment"); assert.equal(installed.phase, "after");
  assert.equal(decommissioned.section, "Existing equipment"); assert.equal(decommissioned.phase, "after");
  assert.ok([existing, installed, decommissioned].every((field) => field.type === "photo" && field.requireLocation
    && field.sourceRequirementId === "air-conditioner-photos" && field.evidenceFor.length));
  assert.ok(!form.fields.some((field) => field.key === "evidence.air-conditioner-photos"));
  const invoice = form.fields.find((field) => field.key === "evidence.air-conditioner-invoice");
  assert.equal(invoice.section, "Benefit and payment");
  assert.equal(invoice.presentation, "derived");
  assert.ok(!activityWizardSteps(form, {}).some((step) => step.kind === "field" && step.field.baseKey === invoice.key));
  assert.equal(form.fields.find((field) => field.key === "evidence.air-conditioner-electrical-certificate").section, "Trade certificates");
});

test("catalogue and exact evidence uploads merge only when their source identity matches", () => {
  const expectations = [
    ["nsw-ess-d1", "pre-installation-photo", { required: true, type: "photo", requireLocation: true, phase: "before" }],
    ["nsw-ess-d5", "existing-or-empty-site-photo", { required: true, type: "photo", requireLocation: true, phase: "before" }],
    ["nsw-pdrs-sys2", "licence", { required: true, type: "document", phase: "after" }],
    ["nsw-ess-d17", "manual-location-evidence", { required: true, type: "document", phase: "after" }],
    ["nsw-pdrs-bess1", "warranty", { required: true, type: "document", phase: "after" }],
  ];
  for (const [templateId, requirementId, strict] of expectations) {
    const fields = defaultActivityFieldForm(templateId).fields.filter((field) => field.sourceRequirementId === requirementId);
    assert.equal(fields.length, 1, `${templateId}: ${requirementId}`);
    for (const [key, value] of Object.entries(strict)) assert.equal(fields[0][key], value, `${templateId}: ${requirementId}.${key}`);
  }
  for (const item of activityFieldCatalogue()) {
    const defaultForm = defaultActivityFieldForm(item.activityTemplateId);
    const variants = [defaultForm.variantId, ...defaultForm.variantOptions.map((variant) => variant.id).filter((id) => id !== defaultForm.variantId)];
    for (const variant of variants) {
      const form = defaultActivityFieldForm(item.activityTemplateId, variant);
      const bySource = new Map();
      for (const field of form.fields.filter((candidate) => candidate.sourceRequirementId)) {
        bySource.set(field.sourceRequirementId, [...(bySource.get(field.sourceRequirementId) || []), field]);
      }
      for (const [sourceId, fields] of bySource) {
        if (fields.length === 1) continue;
        assert.ok(item.activityTemplateId === "veu-6" && sourceId === "air-conditioner-photos"
          || item.activityTemplateId === "veu-44" && sourceId === "ci-water-heater-existing-product", `${item.activityTemplateId}/${variant}: ${sourceId}`);
        assert.equal(new Set(fields.map((field) => field.key)).size, fields.length);
        assert.ok(fields.every((field) => field.condition || item.activityTemplateId === "veu-6" && field.key === "evidence.air-conditioner-installed"));
      }
    }
  }
});

test("saved masters cannot invent derived facts or weaken baseline receipts, evidence, declarations or select labels", () => {
  const baseline = defaultActivityFieldForm("veu-6", "veu_6_residential");
  const stale = structuredClone(baseline);
  const receiptKeys = new Set(Object.values(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS));
  const evidenceKey = "evidence.air-conditioner-existing";
  const removedDeclaration = baseline.declarations.at(-1);
  stale.fields = stale.fields.filter((field) => !receiptKeys.has(field.key) && field.key !== evidenceKey);
  stale.fields = stale.fields.filter((field) => field.key !== INSTALLER_ID_SELFIE_FIELD_KEY);
  stale.fields.unshift({ key: "custom.installer_badge_selfie", section: "Custom", label: "Installer badge selfie",
    type: "photo", required: false, options: [], help: "Installer identity", phase: "after", requireLocation: false });
  stale.fields.push({ key: "disclosures.veu_factsheet_given", section: "Customer information", label: "Has the customer received the factsheet?",
    type: "boolean", required: true, options: [], help: "", phase: "before" });
  stale.fields.push({ key: "custom.spoofed_job_fact", section: "Custom", label: "Spoofed", type: "text", required: true, options: [], help: "",
    phase: "before", presentation: "derived", autofill: "job.customer.fullName", sourceRequirementId: "air-conditioner-photos", evidenceFor: ["invented"] });
  const governedKeys = ["customer_property.installation_date", "installed_product.category", "installed_product.same_oem",
    "value_required_in_assignment_or_linked_invoice", "benefit_payment.benefit_type", "benefit_payment.other_benefit",
    "benefit_payment.benefit_amount", "benefit_payment.gross_price", "benefit_payment.consumer_paid", "evidence.air-conditioner-invoice"];
  for (const key of governedKeys) {
    delete stale.fields.find((field) => field.key === key).presentation;
    if (key === "customer_property.installation_date") delete stale.fields.find((field) => field.key === key).autofill;
  }
  stale.declarations = stale.declarations.filter((declaration) => declaration.key !== removedDeclaration.key);
  const sourcedDeclaration = stale.declarations.find((declaration) => declaration.sourceUrl || declaration.sourceTextSha256);
  if (sourcedDeclaration) { sourcedDeclaration.title = "Weakened declaration"; sourcedDeclaration.text = "Weakened text"; sourcedDeclaration.required = false; }
  delete stale.fields.find((field) => field.key === "baseline.scenario").optionLabels;
  const upgraded = applyDefaultActivityFormPolicy(stale, baseline);
  assert.equal(upgraded.fields.filter((field) => /installer.*(?:badge|id).*selfie|installer-id-selfie/i.test(field.key)).length, 1);
  assert.deepEqual(upgraded.fields.find((field) => field.key === INSTALLER_ID_SELFIE_FIELD_KEY), baseline.fields[0]);
  assert.ok(!upgraded.fields.some((field) => field.key === "disclosures.veu_factsheet_given"));
  const spoofed = upgraded.fields.find((field) => field.key === "custom.spoofed_job_fact");
  assert.equal(spoofed.presentation, undefined); assert.equal(spoofed.autofill, undefined);
  assert.equal(spoofed.sourceRequirementId, undefined); assert.equal(spoofed.evidenceFor, undefined);
  assert.equal(upgraded.fields.find((field) => field.key === "workers.electrician.name").presentation, "derived");
  for (const key of governedKeys) assert.equal(upgraded.fields.find((field) => field.key === key)?.presentation, "derived", key);
  assert.equal(upgraded.fields.find((field) => field.key === "customer_property.installation_date")?.autofill, "job.appointment.date");
  assert.match(upgraded.fields.find((field) => field.key === "baseline.scenario").optionLabels.i, /Hard-wired/i);
  assert.deepEqual(upgraded.fields.find((field) => field.key === evidenceKey), baseline.fields.find((field) => field.key === evidenceKey));
  assert.ok([...receiptKeys].every((key) => upgraded.fields.some((field) => field.key === key)));
  assert.equal(upgraded.fields.filter((field) => field.sourceRequirementId === "air-conditioner-photos").length, 3);
  assert.deepEqual(upgraded.declarations.find((declaration) => declaration.key === removedDeclaration.key), JSON.parse(JSON.stringify(removedDeclaration)));
  if (sourcedDeclaration) assert.deepEqual(upgraded.declarations.find((declaration) => declaration.key === sourcedDeclaration.key),
    JSON.parse(JSON.stringify(baseline.declarations.find((declaration) => declaration.key === sourcedDeclaration.key))));
  assert.ok(activityWizardSteps(upgraded, {}).every((step) => step.kind !== "field" || step.field.presentation !== "derived"));
  assert.deepEqual(activityMissing({ id: "record", form: upgraded, formSha256: "hash", answers: {}, evidence: [], signatures: [] })
    .filter((item) => Object.values(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS).includes(item.key)), []);
});

test("saved master policy preserves an equivalent baseline installer ID selfie key and evidence", () => {
  const baseline = defaultActivityFieldForm("veu-6", "veu_6_residential");
  const canonical = baseline.fields.find((field) => field.key === INSTALLER_ID_SELFIE_FIELD_KEY);
  const equivalent = {
    ...canonical,
    key: "evidence.approved-installer-id-selfie",
    evidenceFor: ["installer.identity"],
  };
  baseline.fields = [equivalent, ...baseline.fields.filter((field) => field.key !== INSTALLER_ID_SELFIE_FIELD_KEY)];
  const saved = structuredClone(baseline);
  saved.fields.unshift({ ...canonical, required: false, requireLocation: false });

  const governed = applyDefaultActivityFormPolicy(saved, baseline);
  const selfieFields = governed.fields.filter((field) => /installer.*(?:id|identity|badge).*selfie|installer-id-selfie/i
    .test(`${field.key} ${field.label} ${field.help}`));
  assert.equal(selfieFields.length, 1);
  assert.equal(selfieFields[0].key, equivalent.key);
  assert.deepEqual(selfieFields[0].evidenceFor, equivalent.evidenceFor);
  assert.ok(!governed.fields.some((field) => field.key === INSTALLER_ID_SELFIE_FIELD_KEY));
});
test("scheduled installation and specialist crew details prefill without asking the field worker", () => {
  const form = defaultActivityFieldForm("veu-6", "veu_6_residential");
  const context = { address: "1 Test Street, Melbourne VIC 3000", customerName: "Pat Customer",
    customerEmail: "pat@example.com", customerPhone: "0400000000", businessName: "Example Electrical Pty Ltd",
    businessAddress: "2 Trade Road, Melbourne VIC 3000", businessPhone: "0390000000", technician: "Alex Electrician",
    scheduledInstallationDate: "2026-09-09",
    credentialNumbers: { electrician: "ELEC-1", licensed_plumber: "PLUMB-L1", registered_plumber: "PLUMB-R1", refrigerant_handler: "REF-1" } };
  const expectedSources = {
    name: "job.assignee.fullName",
    company_name: "job.trade.name",
    company_address: "job.trade.address",
    phone: "job.trade.phone",
  };
  const applicableAnswers = {
    electrical_work_performed: true,
    licensed_plumbing_work_performed_or_registered_plumber_supervision_required: true,
    signing_installer_is_registered_plumber_not_licensed_plumber: true,
    handling_fluorocarbon_refrigerant_covered_by_ozone_act: true,
  };
  for (const role of ["electrician", "licensed_plumber", "registered_plumber", "refrigerant_handler"]) {
    for (const [fact, source] of Object.entries(expectedSources)) {
      const key = `workers.${role}.${fact}`;
      const field = form.fields.find((candidate) => candidate.key === key);
      assert.equal(field?.presentation, "derived", key);
      assert.equal(field?.autofill, source, key);
      assert.ok(!activityWizardSteps(form, applicableAnswers).some((step) => step.kind === "field" && step.field.key === key), `${key} comes from Teams`);
    }
    const credentialKey = `workers.${role}.licence_or_registration`;
    const credentialField = form.fields.find((candidate) => candidate.key === credentialKey);
    assert.equal(credentialField?.presentation, "derived", credentialKey);
    assert.equal(credentialField?.autofill, `job.credential.${role}`, credentialKey);
  }
  const answers = activityPrefill(form, context);
  assert.equal(answers["workers.electrician.name"], "Alex Electrician");
  assert.equal(answers["workers.licensed_plumber.company_name"], "Example Electrical Pty Ltd");
  assert.equal(answers["workers.registered_plumber.company_address"], "2 Trade Road, Melbourne VIC 3000");
  assert.equal(answers["workers.refrigerant_handler.phone"], "0390000000");
  assert.equal(answers["workers.electrician.licence_or_registration"], "ELEC-1");
  assert.equal(answers["workers.licensed_plumber.licence_or_registration"], "PLUMB-L1");
  assert.equal(answers["workers.registered_plumber.licence_or_registration"], "PLUMB-R1");
  assert.equal(answers["workers.refrigerant_handler.licence_or_registration"], "REF-1");
  assert.equal(answers["customer_property.installation_address"], "1 Test Street, Melbourne VIC 3000");
  assert.equal(answers["customer_property.installation_date"], "2026-09-09");

  const missingProfileData = activityPrefill(form, { ...context, technician: "", businessAddress: "", businessPhone: "", credentialNumbers: {} });
  assert.equal(missingProfileData["workers.electrician.name"], undefined);
  assert.equal(missingProfileData["workers.licensed_plumber.company_address"], undefined);
  assert.equal(missingProfileData["workers.registered_plumber.phone"], undefined);
  assert.equal(missingProfileData["workers.refrigerant_handler.licence_or_registration"], undefined);
});

test("SRES accreditation fields use only their exact credential class and fail closed when it is absent", () => {
  const form = defaultActivityFieldForm("sres-pv");
  for (const key of ["installer.full_name", "installer.company_name", "installer.accreditation_number",
    "designer.full_name", "designer.accreditation_number", "electrician.full_name", "electrician.licence_number",
    "binding.installer.full_name", "binding.designer.full_name"]) {
    const field = form.fields.find((candidate) => candidate.key === key);
    assert.equal(field?.presentation, "derived", key);
    assert.ok(field?.autofill, key);
    assert.ok(!activityWizardSteps(form, {}).some((step) => step.kind === "field" && step.field.key === key), key);
  }
  const wrongCredentials = activityPrefill(form, { address: "1 Test Street", customerName: "Pat Customer", customerEmail: "pat@example.com",
    customerPhone: "0400000000", businessName: "Example Electrical Pty Ltd", technician: "Alex Electrician",
    credentialNumbers: { electrician: "ELEC-1", licensed_plumber: "PLUMB-1", refrigerant_handler: "REF-1" } });
  assert.equal(wrongCredentials["installer.accreditation_number"], undefined);
  assert.equal(wrongCredentials["designer.accreditation_number"], undefined);
  const missing = activityMissing({ id: "record", form, formSha256: "hash", answers: wrongCredentials, evidence: [], signatures: [] });
  assert.ok(missing.some((item) => item.key === "installer.accreditation_number"));
  assert.ok(missing.some((item) => item.key === "designer.accreditation_number"));

  const exactCredentials = activityPrefill(form, { address: "1 Test Street", customerName: "Pat Customer", customerEmail: "pat@example.com",
    customerPhone: "0400000000", businessName: "Example Electrical Pty Ltd", technician: "Alex Electrician",
    credentialNumbers: { electrician: "ELEC-1", installer: "SAA-I1", designer: "SAA-D1" },
    credentialTypes: { installer: "Grid connected installer", designer: "Grid connected designer", connection: "Grid connected" } });
  assert.equal(exactCredentials["installer.accreditation_number"], "SAA-I1");
  assert.equal(exactCredentials["designer.accreditation_number"], "SAA-D1");
});

test("saved SRES masters always source role identities from team profiles", () => {
  const baseline = defaultActivityFieldForm("sres-pv");
  const stale = structuredClone(baseline);
  const installer = stale.fields.find((field) => field.key === "installer.full_name");
  installer.presentation = "derived";
  installer.autofill = "job.trade.name";
  stale.fields = stale.fields.filter((field) => field.key !== "designer.full_name");
  const governed = applyDefaultActivityFormPolicy(stale, baseline);
  assert.equal(governed.fields.find((field) => field.key === "installer.full_name")?.presentation, "derived");
  assert.equal(governed.fields.find((field) => field.key === "installer.full_name")?.autofill, "job.assignee.fullName");
  assert.equal(governed.fields.find((field) => field.key === "designer.full_name")?.presentation, "derived");
});

test("broad SRES, VEU and NSW crew summaries are sourced from current team setup", () => {
  for (const [templateId, keys] of [
    ["sres-pv", ["installers", "saa"]],
    ["veu-13", ["installer_details_company_and_licences"]],
    ["nsw-ess-d17", ["installers", "licensed_roles"]],
  ]) {
    const form = defaultActivityFieldForm(templateId);
    for (const key of keys) {
      const field = form.fields.find((candidate) => candidate.key === key);
      assert.equal(field?.required, true, `${templateId}: ${key}`);
      assert.equal(field?.presentation, "derived", `${templateId}: ${key}`);
      assert.equal(field?.autofill, "job.assignee.profile", `${templateId}: ${key}`);
    }
  }
});

test("activities without a universal booking handout do not ask the tradie for an unsupported generic customer-document record", () => {
  const unsupportedKeys = new Set(["customer_documents", "factsheet_receipt", "factsheet"]);
  for (const templateId of ["sres-pv", "sres-bess", "sres-swh", "sres-ashp", "nsw-pdrs-hvac1", "nsw-pdrs-hvac2", "nsw-pdrs-bess5"]) {
    const form = defaultActivityFieldForm(templateId);
    assert.ok(!form.fields.some((field) => unsupportedKeys.has(field.key)), templateId);
    assert.ok(form.declarations.some((declaration) => declaration.role === "customer" && declaration.required), templateId);
    assert.ok(form.declarations.some((declaration) => declaration.role === "technician" && declaration.required), templateId);
  }
  for (const templateId of ["nsw-pdrs-hvac1", "nsw-pdrs-hvac2", "nsw-pdrs-bess5"]) {
    const form = defaultActivityFieldForm(templateId);
    assert.ok(form.fields.some((field) => field.key === "nomination_delivery" && field.required && field.phase === "before"), templateId);
  }
});

test("every supported appointment, customer, property, Creditex, trade, worker and credential source prefills across the catalogue", () => {
  const context = { address: "1 Test Street, Melbourne VIC 3000", customerName: "Pat Customer", customerEmail: "pat@example.com",
    customerPhone: "0400000000", customerBusinessName: "Pat Customer Pty Ltd", customerBusinessNumber: "11122233344",
    businessName: "Example Electrical Pty Ltd", businessAddress: "2 Trade Road, Melbourne VIC 3000", businessPhone: "0390000000",
    businessEmail: "trade@example.com", technician: "Alex Electrician", scheduledInstallationDate: "2026-09-09",
    workerCredentials: [
      { name: "Electrical licence", number: "ELEC-1", type: "licence", jurisdiction: "VIC", gate: "licensed_electrician" },
      { name: "Plumbing licence", number: "PLUMB-1", type: "licence", jurisdiction: "VIC", gate: "licensed_plumber" },
      { name: "Battery installer", number: "SAA-I1", type: "accreditation", jurisdiction: "NATIONAL", gate: "sres_installer_accreditation" },
      { name: "Battery designer", number: "SAA-D1", type: "accreditation", jurisdiction: "NATIONAL", gate: "sres_designer_accreditation" },
    ],
    credentialNumbers: { electrician: "ELEC-1", licensed_plumber: "PLUMB-1", registered_plumber: "PLUMB-R1", refrigerant_handler: "REF-1",
      installer: "SAA-I1", designer: "SAA-D1" }, credentialTypes: { installer: "Grid-connect installer", designer: "Grid-connect designer", connection: "Grid connected" } };
  const supported = /^(?:job\.appointment\.date|job\.property\.fullAddress|job\.customer\.(?:name|fullName|email|phone|companyName|abnOrAcn|identity)|job\.customer\.authorisedSignatory\.(?:signatory_name|signatory_company|signatory_email|signatory_phone)|job\.trade\.(?:name|address|phone|email|identity)|job\.assignee\.(?:fullName|businessAndTechnician|profile)|job\.credential\.(?:electrician|licensed_plumber|registered_plumber|refrigerant_handler|installer|designer)|job\.credentialType\.(?:installer|designer|connection)|creditex\.provider\.(?:legalName|abn|email|phone|contact|identity|accreditation\.[A-Z-]+\..+))$/;
  const counts = { appointment: 0, customer: 0, property: 0, creditex: 0, trade: 0, worker: 0, credential: 0 };
  for (const item of activityFieldCatalogue()) {
    const defaultForm = defaultActivityFieldForm(item.activityTemplateId);
    const variants = [defaultForm.variantId, ...defaultForm.variantOptions.map((variant) => variant.id).filter((id) => id !== defaultForm.variantId)];
    for (const variant of variants) {
      const form = defaultActivityFieldForm(item.activityTemplateId, variant);
      const answers = activityPrefill(form, context);
      for (const field of form.fields.filter((candidate) => ["derived", "prefilled"].includes(candidate.presentation))) {
        if (field.autofill) assert.match(field.autofill, supported, `${item.activityTemplateId}/${variant}: ${field.key}`);
        else assert.ok(Object.values(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS).includes(field.key)
          || field.help === "Completed from the TLink quote, invoice or Creditex calculation outside the installer workflow."
          || item.activityTemplateId === "veu-6" && ["installed_product.category", "installed_product.same_oem"].includes(field.key),
        `${item.activityTemplateId}/${variant}: ${field.key}`);
      }
      for (const field of form.fields.filter((candidate) => supported.test(candidate.autofill || ""))) {
        assert.ok(["derived", "prefilled"].includes(field.presentation), `${item.activityTemplateId}/${variant}: ${field.key}`);
        if (field.required) assert.ok(answers[field.key], `${item.activityTemplateId}/${variant}: ${field.key} (${field.autofill})`);
        if (field.autofill.startsWith("job.appointment")) counts.appointment++;
        else if (field.autofill.startsWith("job.customer")) counts.customer++;
        else if (field.autofill.startsWith("job.property")) counts.property++;
        else if (field.autofill.startsWith("creditex.provider")) counts.creditex++;
        else if (field.autofill.startsWith("job.trade")) counts.trade++;
        else if (field.autofill.startsWith("job.assignee")) counts.worker++;
        else counts.credential++;
      }
    }
  }
  assert.ok(Object.values(counts).every((count) => count > 0), JSON.stringify(counts));
});

test("profile summaries cannot substitute unrelated credentials for the required trade roles", () => {
  const context = { address: "1 Test Street", customerName: "Pat Customer", customerEmail: "pat@example.com",
    customerPhone: "0400000000", businessName: "Trade business", technician: "Alex Installer",
    workerCredentials: [{ name: "First aid", number: "FA-1", type: "training", jurisdiction: "VIC", gate: "first_aid" }] };
  for (const [template, key] of [["sres-pv", "saa"], ["sres-bess", "battery_accreditation"], ["sres-ashp", "installer_licences"], ["veu-13", "installer_details_company_and_licences"]]) {
    const form = defaultActivityFieldForm(template);
    assert.equal(activityPrefill(form, context)[key], undefined, key);
    const onlyElectrician = { ...context, workerCredentials: [{ name: "Electrician", number: "EL-1", type: "licence", jurisdiction: "VIC", gate: "licensed_electrician" }] };
    if (key !== "installer_details_company_and_licences") assert.equal(activityPrefill(form, onlyElectrician)[key], undefined, key);
  }
  const solarOnly = { ...context, workerCredentials: [
    { name: "Electrician", number: "EL-1", type: "licence", jurisdiction: "VIC", gate: "licensed_electrician" },
    { name: "PV installer", number: "SAA-I1", type: "accreditation", jurisdiction: "NATIONAL", gate: "sres_installer_accreditation" },
    { name: "PV designer", number: "SAA-D1", type: "accreditation", jurisdiction: "NATIONAL", gate: "sres_designer_accreditation" },
  ] };
  assert.ok(activityPrefill(defaultActivityFieldForm("sres-pv"), solarOnly).saa);
  assert.equal(activityPrefill(defaultActivityFieldForm("sres-bess"), solarOnly).battery_accreditation, undefined);
});
