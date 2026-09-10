import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as assessment from "../src/lib/trade-rental-assessment.mjs";
import * as evidence from "../src/lib/trade-rental-evidence.mjs";
import * as workflow from "../src/lib/rental-assessor-workflow.mjs";
import * as answerPresentation from "../src/lib/rental-report-answer.mjs";

test("dwelling report preserves earlier faults and evidence without treating them as current dwelling answers", async () => {
  const sourceText = fs.readFileSync(new URL("../src/lib/trade-rental-report-server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${sourceText}\nexport { buildReportSnapshot };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const evidenceBytes = new Uint8Array([1, 2, 3, 4]);
  const dependencies = {
    "cloudflare:workers": { env: { EVIDENCE: { get: async () => ({ arrayBuffer: async () => evidenceBytes.buffer }) } } },
    "../../db": {}, "@/lib/trade-team-server": {}, "@/lib/trade-team-sync-server": {},
    "@/lib/trade-rental-assessment.mjs": assessment, "@/lib/trade-issued-document-store": {},
    "@/lib/trade-rental-report-links": {}, "@/lib/customer-plan-pdf-fonts": {},
    "@/lib/trade-rental-evidence.mjs": evidence, "@/lib/trade-rental-credentials": {},
    "@/lib/rental-assessor-workflow.mjs": workflow,
    "@/lib/rental-report-answer.mjs": answerPresentation,
    "@/lib/trade-rental-schema-guards": {},
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    assert.ok(id in dependencies, `Unmocked dependency ${id}`);
    return dependencies[id];
  }, moduleRecord, moduleRecord.exports);
  const template = { credentialGate: "qualified_assessor", sections: [{ key: "windows", title: "Windows",
    checks: [{ key: "window_operation_security", prompt: "Do the property's windows work and lock?" }] }] };
  const source = {
    inspection: { property_snapshot: {}, assessment_scope: "current_minimum_standards", inspection_number: "RMS-EXAMPLE" },
    modules: [{ id: "module", module_key: "minimum_standards", status: "complete", template_snapshot: template,
      credential_snapshot: { gate: "assigned_assessor" }, answers: { rentalRegime: "ordinary_residential", inspectionDate: "2026-09-09" } }],
    items: [
      { id: "old-window", module_id: "module", item_key: "old-window", section_key: "windows", check_key: "window_operation_security",
        instance_key: "window-1", location_label: "Old front window", outcome: "does_not_meet", public_notes: "Latch did not work", response_json: { roomId: "old-room" } },
      { id: "dwelling", module_id: "module", item_key: "dwelling", section_key: "windows", check_key: "window_operation_security",
        instance_key: "property", location_label: "Property", outcome: "meets", public_notes: "Checked dwelling" },
    ],
    findings: [{ id: "finding", moduleId: "module", itemId: "old-window", title: "Broken latch", status: "non_compliant", severity: "required" }],
    evidence: [{ id: "evidence", item_id: "old-window", finding_id: "finding", object_key: "old-photo", size_bytes: 4,
      content_type: "image/jpeg", file_name: "earlier.jpg", evidence_type: "photo", caption_snapshot: "Earlier latch" }],
    business: {}, assessor: { first_name: "Alex", last_name: "Assessor" },
  };
  const original = structuredClone(source);
  const { snapshot, preparedObjects } = await moduleRecord.exports.buildReportSnapshot(source, {
    reportId: "report", reportNumber: "REPORT-1", revision: 1, issuedAt: "2026-09-09T02:00:00Z",
  });
  assert.deepEqual(source, original, "Source records and frozen template are not rewritten");
  const items = snapshot.modules[0].sections[0].items;
  const historical = items.find((item) => item.historicalObservation);
  const current = items.find((item) => !item.historicalObservation);
  assert.equal(historical.outcome, "does_not_meet");
  assert.match(historical.prompt, /^Earlier observation:/);
  assert.equal(historical.response.roomId, undefined, "Internal room metadata is not public");
  assert.equal(current.outcome, "meets");
  assert.equal(current.instanceKey, "property");
  assert.equal(snapshot.modules[0].credentialGate, "assigned_assessor");
  assert.equal(snapshot.findings[0].historicalObservation, true);
  assert.match(snapshot.findings[0].title, /^Earlier observation: Broken latch$/);
  assert.equal(snapshot.evidence[0].itemId, historical.id);
  assert.equal(snapshot.evidence[0].findingId, snapshot.findings[0].id);
  assert.equal(preparedObjects.length, 1);
  assert.deepEqual(preparedObjects[0].bytes, evidenceBytes);
});

test("one shower observation renders a current pass, future recommendation and shared photo reference", async () => {
  const sourceText = fs.readFileSync(new URL("../src/lib/trade-rental-report-server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${sourceText}\nexport { buildReportSnapshot };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    "cloudflare:workers": { env: { EVIDENCE: { get: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) } } },
    "../../db": {}, "@/lib/trade-team-server": {}, "@/lib/trade-team-sync-server": {},
    "@/lib/trade-rental-assessment.mjs": assessment, "@/lib/trade-issued-document-store": {},
    "@/lib/trade-rental-report-links": {}, "@/lib/customer-plan-pdf-fonts": {},
    "@/lib/trade-rental-evidence.mjs": evidence, "@/lib/trade-rental-credentials": {},
    "@/lib/rental-assessor-workflow.mjs": workflow, "@/lib/trade-rental-schema-guards": {},
    "@/lib/rental-report-answer.mjs": answerPresentation,
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    assert.ok(id in dependencies, `Unmocked dependency ${id}`);
    return dependencies[id];
  }, moduleRecord, moduleRecord.exports);
  const template = assessment.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  const source = {
    inspection: { property_snapshot: {}, assessment_scope: "current_minimum_standards", inspection_number: "RMS-SHOWER" },
    modules: [{ id: "private-module-id", module_key: "minimum_standards", status: "complete", template_snapshot: template,
      credential_snapshot: {}, answers: { rentalRegime: "ordinary_residential", inspectionDate: "2026-09-10" } }],
    items: [{ id: "private-shower-id", module_id: "private-module-id", item_key: "minimum_standards:bathroom:showerhead_rating:property",
      section_key: "bathroom", check_key: "showerhead_rating", instance_key: "property", location_label: "Property", outcome: "meets",
      response_json: { welsRating: "3 stars", flowLitresPerMinute: "7.5", showerCaptureVersion: 1 }, public_notes: "" }],
    findings: [], evidence: [{ id: "photo", item_id: "private-shower-id", object_key: "photo", size_bytes: 3, content_type: "image/jpeg", file_name: "shower.jpg", evidence_type: "photo" }],
    business: {}, assessor: {},
  };
  const { snapshot, preparedObjects } = await moduleRecord.exports.buildReportSnapshot(source, {
    reportId: "report", reportNumber: "T-RMS-1", revision: 1, issuedAt: "2026-09-10T01:00:00Z",
  });
  const items = snapshot.modules[0].sections.flatMap((section) => section.items);
  const current = items.find((item) => item.checkKey === "showerhead_rating");
  const future = items.find((item) => item.checkKey === "shower_2027_readiness");
  assert.equal(current.outcome, "meets");
  assert.equal(current.answerLabel, "3 stars");
  assert.equal(future.outcome, "does_not_meet");
  assert.equal(future.answerLabel, "3 stars", "Both standards retain the one selected rating");
  assert.equal(future.assessmentPhase, "energy_readiness_2027");
  assert.equal(snapshot.findings[0].status, "recommendation");
  assert.equal(snapshot.findings[0].details.evidenceSourceItemId, current.id);
  assert.equal(future.evidenceSourceItemId, current.id);
  assert.equal(snapshot.evidence[0].itemId, current.id);
  assert.equal(preparedObjects.length, 1, "The source photo is embedded once, with a shared reference");
  assert.doesNotMatch(JSON.stringify(snapshot), /private-shower-id|private-module-id/);
});
