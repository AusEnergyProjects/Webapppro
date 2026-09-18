import test from "node:test";
import assert from "node:assert/strict";
import { defaultActivityFieldForm, applyDefaultActivityFormPolicy, activityFieldWorkerForm } from "../src/lib/trade-activity-forms-library.ts";
import { activityHash, activityMissing, normaliseActivityAnswers } from "../src/lib/trade-activity-forms.ts";

import { CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES } from "../src/data/creditex-current-work-pack-content.ts";

const record = (form, evidence = []) => ({ id: "activity-one", form, formSha256: activityHash(form), answers: {}, evidence, signatures: [] });

for (const [templateId, kind] of [["sres-ashp", "ashp"], ["sres-swh", "swh"]]) {
  test(`${templateId} requires its own signed assignment and installer statement artifacts`, () => {
    const form = defaultActivityFieldForm(templateId);
    assert.equal(form.version, 3);
    const keys = [`evidence.${kind}_stc_assignment`, `evidence.${kind}_installer_compliance_certificate`];
    for (const key of keys) {
      const field = form.fields.find((item) => item.key === key);
      assert.equal(field.type, "document"); assert.equal(field.required, true); assert.equal(field.phase, "after");
      assert.ok(field.sourceRequirementId); assert.match(field.referenceDocuments[0].url, /^https:\/\/cer.gov.au\//);
      assert.ok(activityMissing(record(form), "after", false).some((item) => item.key === key && item.kind === "evidence"));
      assert.throws(() => normaliseActivityAnswers(form, { [key]: true }), /INVALID_ACTIVITY_FIELD/);
    }
    const uploaded = keys.map((key) => ({ fieldKey: key }));
    assert.ok(activityMissing(record(form, uploaded), "after", false).every((item) => !keys.includes(item.key)));
    assert.ok(form.fields.every((field) => !/bess2|sres_battery|^nmi$|^account_holder$/.test(field.key)));
    assert.match(form.fields.find((field) => field.key === keys[0]).help, /owner.*installation address.*registered agent.*tank serial numbers/);
    assert.match(form.fields.find((field) => field.key === keys[0]).help, /incentive.*retailer name\/ABN/);
  });
}

test("Activity 48 contract must precede work and its assignment cannot use another activity template", () => {
  const form = defaultActivityFieldForm("veu-48");
  const contract = form.fields.find((field) => field.key === "evidence.insulation-ap-consumer-contract");
  const assignment = form.fields.find((field) => field.key === "evidence.insulation-veec-assignment");
  assert.equal(contract.phase, "before"); assert.equal(assignment.phase, "after");
  assert.equal(contract.required, true); assert.equal(assignment.required, true);
  assert.equal(contract.type, "document"); assert.equal(assignment.type, "document");
  assert.match(assignment.help, /Do not use an Activity 1, 3 or 6 assignment/);
  assert.ok(activityMissing(record(form), "before", false).some((item) => item.key === contract.key));
  assert.ok(activityMissing(record(form), "after", false).some((item) => item.key === assignment.key));
  assert.ok(form.reviewNotes.some((note) => note.includes("No current downloadable prescribed Activity 48 assignment template was verified")));
});

test("edited or old masters cannot remove, relabel or weaken mandatory assignment evidence", () => {
  for (const id of ["sres-ashp", "sres-swh", "veu-48"]) {
    const baseline = defaultActivityFieldForm(id);
    const controlled = baseline.fields.filter((field) => /assignment|consumer-contract/.test(field.sourceRequirementId || ""));
    const removed = { ...structuredClone(baseline), version: 1, fields: baseline.fields.filter((field) => !controlled.includes(field)), reviewNotes: [] };
    const restored = applyDefaultActivityFormPolicy(removed, baseline);
    assert.equal(restored.version, 3); assert.notEqual(activityHash(restored), activityHash(removed));
    for (const expected of controlled) assert.deepEqual(restored.fields.find((field) => field.key === expected.key), expected);
    const weakened = structuredClone(baseline);
    for (const field of weakened.fields) if (controlled.some((item) => item.key === field.key)) { field.required = false; field.type = "boolean"; field.label = "Optional"; field.condition = { fieldKey: "skip", equals: true }; }
    const governed = applyDefaultActivityFormPolicy(weakened, baseline);
    for (const expected of controlled) assert.deepEqual(governed.fields.find((field) => field.key === expected.key), expected);
  }
});

test("hot-water artifact policy does not publish legacy assignment or alter other technologies", () => {
  for (const id of ["sres-ashp", "sres-swh", "veu-48"]) {
    const form = defaultActivityFieldForm(id);
    assert.ok(form.fields.flatMap((field) => field.referenceDocuments || []).every((item) => !/STC%20Assignment|STC Assignment|sample-stc-assignment/.test(item.url)));
  }
  const pv = defaultActivityFieldForm("sres-pv");
  assert.equal(pv.version, 3);
  assert.ok(pv.fields.every((field) => !/ashp_stc_assignment|swh_stc_assignment|insulation-veec-assignment/.test(field.key)));
});

const coveredProgrammes = new Set(["SRES", "VEU", "NSW-ESS", "NSW-PDRS", "ACT-EEIS", "SA-REPS"]);
const primaryArtifacts = (form) => form.fields.filter(field => /assignment|nomination|signed-activity-record/.test(`${field.sourceRequirementId || ""} ${field.label}`) && field.type === "document");

test("every generated certificate, ACT EEIS and SA REPS activity requires its exact programme artifact", () => {
  const counts = {};
  for (const candidate of CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES) {
    const form = defaultActivityFieldForm(candidate.templateId);
    if (!coveredProgrammes.has(candidate.programCode)) {
      assert.ok(form.fields.every(field => !/veu-signed-assignment|signed-programme-nomination|act-eeis-signed-activity-record|sa-reps-signed-activity-record/.test(field.key)), candidate.templateId);
      continue;
    }
    counts[candidate.programCode] = (counts[candidate.programCode] || 0) + 1;
    const artifacts = primaryArtifacts(form);
    assert.ok(artifacts.length, candidate.templateId);
    assert.equal(form.version, 3);
    for (const field of artifacts) {
      assert.equal(field.required, true, candidate.templateId + ":" + field.key);
      assert.equal(field.presentation, undefined, candidate.templateId + ":" + field.key);
      assert.equal(field.condition, undefined, candidate.templateId + ":" + field.key);
      assert.ok(field.referenceDocuments.length);
      assert.ok(field.referenceDocuments.every(source => source.url.startsWith("https://")));
      const projected = activityFieldWorkerForm(form).fields.find(item => item.key === field.key);
      assert.equal(projected.presentation, undefined);
      assert.ok(activityMissing(record(form), field.phase, false).some(item => item.key === field.key && item.kind === "evidence"));
      assert.throws(() => normaliseActivityAnswers(form, { [field.key]: true }), /INVALID_ACTIVITY_FIELD/);
    }
    const missing = { ...structuredClone(form), version: 1, fields: form.fields.filter(field => !artifacts.includes(field)) };
    const restored = applyDefaultActivityFormPolicy(missing, form);
    assert.equal(restored.version, 3);
    for (const expected of artifacts) assert.deepEqual(restored.fields.find(field => field.key === expected.key), expected);
    const weakened = structuredClone(form);
    for (const field of weakened.fields) if (artifacts.some(item => item.key === field.key)) {
      field.required = false; field.type = "boolean"; field.presentation = "derived"; field.phase = "before"; field.condition = { fieldKey: "skip", equals: true };
    }
    const governed = applyDefaultActivityFormPolicy(weakened, form);
    for (const expected of artifacts) assert.deepEqual(governed.fields.find(field => field.key === expected.key), expected);
  }
  assert.deepEqual(counts, { SRES: 6, VEU: 31, "NSW-ESS": 42, "NSW-PDRS": 9, "ACT-EEIS": 25, "SA-REPS": 26 });
});

test("VEU 1, 3 and 6 residential and business forms keep their own current controlled assignment", () => {
  for (const id of ["veu-1", "veu-3", "veu-6"]) {
    for (const variant of defaultActivityFieldForm(id).variantOptions) {
      const form = defaultActivityFieldForm(id, variant.id);
      const field = form.fields.find(field => field.key === "evidence.veu-signed-assignment");
      assert.equal(field.phase, "after");
      assert.match(field.label, new RegExp("Activity " + id.slice(4) + " VEEC"));
      assert.match(field.help, /current Creditex-approved.*exact activity and residential\/business/);
      assert.ok(field.referenceDocuments.some(source => source.url.includes("VEET%20guidelines%20v16")));
      const withAuthority = { ...record(form), signatures: form.declarations.map(declaration => ({ declarationKey: declaration.key, role: declaration.role, formSha256: activityHash(form) })) };
      assert.ok(activityMissing(withAuthority, "after", false).some(item => item.key === field.key));
    }
  }
});

test("NSW nominations use the correct implementation phase and BESS2 exception", () => {
  for (const candidate of CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.filter(candidate => ["NSW-ESS", "NSW-PDRS"].includes(candidate.programCode))) {
    const form = defaultActivityFieldForm(candidate.templateId);
    const nomination = primaryArtifacts(form).find(field => /nomination/.test(`${field.sourceRequirementId} ${field.label}`));
    assert.ok(nomination, candidate.templateId);
    assert.equal(nomination.phase, candidate.templateId === "nsw-pdrs-bess2" ? "after" : "before", candidate.templateId);
    if (candidate.templateId === "nsw-pdrs-bess2") assert.match(nomination.help, /within 90 days of onboarding and before certificate creation/);
  }
  const heer = defaultActivityFieldForm("nsw-ess-d1");
  assert.equal(heer.fields.find(field => field.key === "evidence.site-assessor-declaration").phase, "before");
  assert.equal(heer.fields.find(field => field.key === "evidence.post-implementation-declaration").phase, "after");
  const iheab = defaultActivityFieldForm("nsw-ess-f1-1");
  const alternative = iheab.fields.find(field => field.key === "evidence.installer-declaration");
  assert.equal(alternative.required, true); assert.equal(alternative.phase, "after");
  assert.match(alternative.label, /declaration, CCEW or commissioning report/);
  assert.ok(iheab.fields.every(field => field.key !== "evidence.installer-declaration.supporting"));
});

test("PV retailer statement follows actual retailer involvement while PV and battery assignment always remain required", () => {
  const pv = defaultActivityFieldForm("sres-pv");
  const key = pv.fields.find(field => field.sourceRequirementId === "pv_retailer_statement").key;
  for (const involved of [false, true]) {
    const missing = activityMissing({ ...record(pv), answers: { "scope.solar_retailer_involved": involved } }, "after", false);
    assert.equal(missing.some(field => field.key === key), involved);
    assert.ok(missing.some(field => field.key === "evidence.pv_stc_assignment"));
  }
  assert.deepEqual(pv.declarations.find(declaration => declaration.key.startsWith("sres_pv_retailer_statement:")).condition, { fieldKey: "scope.solar_retailer_involved", equals: true });
  const battery = defaultActivityFieldForm("sres-bess");
  assert.ok(activityMissing(record(battery), "after", false).some(field => field.key === "evidence.battery_stc_assignment"));
  assert.ok(battery.reviewNotes.some(note => /finalises the quantity-dependent statutory assignment/.test(note)));
  assert.ok(pv.fields.every(field => !/certificate.*quantity|stc_count|deeming_years/.test(field.key)));
});

test("ACT signed safety artifacts respect the actual insulation scope and timing", () => {
  const insulation = defaultActivityFieldForm("act-eeis-1-8");
  for (const key of ["evidence.act-insulation-electrical-safety-report", "evidence.act-insulation-term-of-responsibility"]) {
    const field = insulation.fields.find(field => field.key === key);
    assert.equal(field.required, true); assert.equal(field.phase, "before");
    assert.ok(activityMissing(record(insulation), "before", false).some(item => item.key === key));
  }
  for (const performed of [false, true]) {
    const missing = activityMissing({ ...record(insulation), answers: { "scope.act_insulation_electrical_work": performed, "scope.act_insulation_downlights_present": performed } }, "before", false);
    assert.equal(missing.some(item => item.key === "evidence.act-insulation-electrical-safety-certificate"), performed);
    assert.equal(missing.some(item => item.key === "evidence.act-insulation-no-downlights-statement"), !performed);
  }
  const lighting = defaultActivityFieldForm("act-eeis-4-2");
  assert.equal(lighting.fields.find(field => field.key === "evidence.act-lighting-compliance-declaration").phase, "after");
  assert.ok(lighting.fields.every(field => !field.key.startsWith("evidence.act-insulation-")));
});

test("SA insulation acknowledgement supplements its activity record without becoming a universal REPS assignment", () => {
  for (const id of ["sa-reps-bs1a", "sa-reps-bs1b"]) {
    const form = defaultActivityFieldForm(id);
    for (const key of ["evidence.sa-insulation-installer-acknowledgement", "evidence.sa-reps-signed-activity-record"]) {
      const field = form.fields.find(field => field.key === key);
      assert.equal(field.required, true); assert.equal(field.phase, "after");
      assert.ok(activityMissing(record(form), "after", false).some(item => item.key === key));
    }
  }
  assert.ok(defaultActivityFieldForm("sa-reps-bs2").fields.every(field => field.key !== "evidence.sa-insulation-installer-acknowledgement"));
});
