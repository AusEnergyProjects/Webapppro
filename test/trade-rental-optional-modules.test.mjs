import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as assessment from "../src/lib/trade-rental-assessment.mjs";
import * as evidence from "../src/lib/trade-rental-evidence.mjs";
import * as workflow from "../src/lib/rental-assessor-workflow.mjs";
import {
  assertRentalModuleCredentialCurrent,
  currentRentalModuleCredentialSnapshot,
  rentalModuleProfileAnswers,
} from "../src/lib/trade-rental-credentials.ts";

const completedAt = "2026-09-10T02:00:00.000Z";
const cases = [
  { key: "electrical_safety_check", gate: "licensed_electrician", nameKey: "electricianName", numberKey: "licenceNumber", type: "licence", checks: 7 },
  { key: "gas_safety_check", gate: "licensed_gasfitter", nameKey: "gasfitterName", numberKey: "licenceNumber", type: "registration", checks: 6 },
  { key: "smoke_alarm_check", gate: "suitably_qualified_smoke_alarm_worker", nameKey: "workerName", numberKey: "qualificationNumber", type: "training", checks: 4 },
];

function completeFixture(entry) {
  const moduleTemplate = assessment.rentalAssessmentTemplateSnapshot([entry.key]).modules[entry.key];
  const answers = {
    inspectionDate: "2026-09-10", [entry.nameKey]: "Alex Assessor", [entry.numberKey]: "TEST-100",
    ...(entry.key === "electrical_safety_check" ? { standardEdition: "AS/NZS 3019:2022" } : {}),
    ...(entry.key === "smoke_alarm_check" ? { qualificationType: "Smoke alarm service training" } : {}),
    credentialConfirmed: true, coverageConfirmed: true, assessorDeclaration: true,
  };
  const items = moduleTemplate.sections.flatMap((section) => section.checks.map((check) => {
    const instanceKey = check.repeatBy === "property" ? "property" : "equipment-1";
    const itemKey = assessment.rentalAssessmentItemKey(entry.key, section.key, check.key, instanceKey);
    return {
      id: itemKey, itemKey, sectionKey: section.key, checkKey: check.key, instanceKey,
      locationLabel: "Equipment 1", outcome: "meets", requiredEvidenceCount: check.requiredEvidenceCount,
      responseJson: check.responseType === "test_result"
        ? { testMethod: "Recorded test method", testInstrument: "Test instrument 100", testResult: "Measured result and acceptance decision" }
        : check.responseType === "action_record" ? { actionTaken: "No repair required following the recorded check" } : {},
    };
  }));
  return { moduleTemplate, answers, items, findings: [],
    evidenceCounts: Object.fromEntries(items.map((item) => [item.id, 1])), photoCounts: {} };
}

// Execute production credential SQL, including owner/member joins and expiry predicates.
function credentialDatabase(entry, t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE trade_team_members (id TEXT, owner_uid TEXT, status TEXT, display_name TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE trade_team_member_files (id TEXT, owner_uid TEXT, team_member_id TEXT, status TEXT,
      expires_at TEXT, file_name TEXT, title TEXT, sha256 TEXT, updated_at TEXT);
    CREATE TABLE trade_team_member_credentials (id TEXT, owner_uid TEXT, team_member_id TEXT, rental_gate TEXT,
      status TEXT, credential_type TEXT, name TEXT, credential_number TEXT, issuer TEXT, jurisdiction TEXT,
      expires_at TEXT, updated_at TEXT, file_id TEXT);
    INSERT INTO trade_team_members VALUES ('member-1', 'owner-1', 'active', 'Alex Assessor', 'Alex', 'Assessor');
    INSERT INTO trade_team_member_files VALUES ('file-1', 'owner-1', 'member-1', 'active', '2026-09-30',
      'test-credential.pdf', 'Test credential', '${"a".repeat(64)}', '2026-09-01T00:00:00.000Z');
  `);
  sqlite.prepare(`INSERT INTO trade_team_member_credentials VALUES
    ('credential-1', 'owner-1', 'member-1', ?, 'active', ?, 'Test credential', 'TEST-100',
      'Test issuer', 'VIC', '2026-09-30', '2026-09-01T00:00:00.000Z', 'file-1')`).run(entry.gate, entry.type);
  const db = { prepare(sql) { return { bind(...bindings) {
    return { async first() { return sqlite.prepare(sql).get(...bindings) || null; } };
  } }; } };
  const input = { db, ownerUid: "owner-1", assessorMemberId: "member-1", moduleKey: entry.key,
    requiredCapability: entry.gate, answers: completeFixture(entry).answers, confirmedAt: completedAt };
  return { sqlite, db, input };
}

for (const entry of cases) {
  test(`${entry.key}: complete checks need evidence, test results, locations and explicit signoff`, () => {
    const input = completeFixture(entry);
    assert.equal(input.items.length, entry.checks);
    assert.equal(input.moduleTemplate.credentialGate, entry.gate);
    assert.equal(input.moduleTemplate.assessmentScope, "statutory_safety_check");
    assert.deepEqual(assessment.rentalAssessmentCompletion(input), { complete: true, blockers: [] });
    for (const field of ["credentialConfirmed", "coverageConfirmed", "assessorDeclaration"]) {
      const result = assessment.rentalAssessmentCompletion({ ...input, answers: { ...input.answers, [field]: false } });
      assert.ok(result.blockers.some((blocker) => blocker.key === `metadata:${field}`), field);
    }
    const tested = input.items.find((item) => item.responseJson.testResult);
    const withoutResult = structuredClone(input);
    withoutResult.items.find((item) => item.id === tested.id).responseJson.testResult = "";
    assert.ok(assessment.rentalAssessmentCompletion(withoutResult).blockers.some((blocker) => blocker.key === `response:${tested.itemKey}:testResult`));
    const withoutEvidence = { ...input, evidenceCounts: { ...input.evidenceCounts, [tested.id]: 0 } };
    assert.ok(assessment.rentalAssessmentCompletion(withoutEvidence).blockers.some((blocker) => blocker.key === `evidence:${tested.itemKey}`));
    const repeated = structuredClone(input);
    const item = repeated.items.find((candidate) => candidate.instanceKey !== "property");
    item.locationLabel = "";
    assert.ok(assessment.rentalAssessmentCompletion(repeated).blockers.some((blocker) => blocker.key === `location:${item.itemKey}`));
    assert.equal(assessment.rentalAssessmentCompletion({ ...input, items: input.items.slice(1) }).complete, false);
  });

  test(`${entry.key}: an unperformed test records a limitation without invented readings`, () => {
    for (const outcome of ["not_accessible", "specialist_verification_required", "exemption_evidence_pending"]) {
      const input = completeFixture(entry);
      const item = input.items.find((candidate) => candidate.responseJson.testResult);
      item.outcome = outcome;
      item.responseJson = {};
      input.evidenceCounts[item.id] = 0;
      input.findings = [{ itemId: item.id, title: "Test not performed", description: "Equipment could not be accessed safely", severity: "required" }];
      assert.deepEqual(assessment.rentalAssessmentCompletion(input), { complete: true, blockers: [] }, outcome);
      assert.ok(assessment.rentalAssessmentCompletion({ ...input, findings: [] }).blockers.some((blocker) => blocker.key === `finding:${item.itemKey}`));
    }
  });

  test(`${entry.key}: profile and signoff use only the assigned member's matching documented credential`, async (t) => {
    const { sqlite, input } = credentialDatabase(entry, t);
    const profile = await rentalModuleProfileAnswers({ ...input, checkedAt: completedAt });
    assert.equal(profile[entry.nameKey], "Alex Assessor");
    assert.equal(profile[entry.numberKey], "TEST-100");
    assert.equal(profile.credentialConfirmed, undefined, "A stored licence never infers the worker's confirmation");
    const snapshot = await currentRentalModuleCredentialSnapshot(input);
    assert.equal(snapshot.gate, entry.gate);
    assert.equal(snapshot.credentialType, entry.type);
    assert.equal(snapshot.supportingFileSha256, "a".repeat(64));
    assert.equal(snapshot.verificationBasis, "manager_attested_document");
    for (const answers of [
      { ...input.answers, credentialConfirmed: false }, { ...input.answers, assessorDeclaration: false },
      { ...input.answers, [entry.nameKey]: "Another Worker" }, { ...input.answers, [entry.numberKey]: "WRONG-100" },
    ]) await assert.rejects(() => currentRentalModuleCredentialSnapshot({ ...input, answers }), /RENTAL_MODULE_CREDENTIAL_REQUIRED/);
    for (const sql of [
      "UPDATE trade_team_member_credentials SET owner_uid = 'other-owner'",
      "UPDATE trade_team_member_credentials SET team_member_id = 'other-member'",
      "UPDATE trade_team_member_credentials SET rental_gate = 'unrelated_gate'",
      "UPDATE trade_team_member_credentials SET credential_type = 'insurance'",
      "UPDATE trade_team_member_credentials SET status = 'inactive'",
      "UPDATE trade_team_member_credentials SET expires_at = '2026-09-09'",
      "UPDATE trade_team_member_files SET team_member_id = 'other-member'",
      "UPDATE trade_team_member_files SET status = 'inactive'",
      "UPDATE trade_team_member_files SET expires_at = '2026-09-09'",
      "DELETE FROM trade_team_member_files",
    ]) {
      sqlite.exec("SAVEPOINT invalid_credential");
      sqlite.exec(sql);
      await assert.rejects(() => currentRentalModuleCredentialSnapshot(input), /RENTAL_MODULE_CREDENTIAL_REQUIRED/, sql);
      assert.equal((await rentalModuleProfileAnswers({ ...input, checkedAt: completedAt }))[entry.numberKey], "", sql);
      sqlite.exec("ROLLBACK TO invalid_credential; RELEASE invalid_credential");
    }
  });

  test(`${entry.key}: report issue rechecks expiry and supporting-document integrity`, async (t) => {
    const { sqlite, input } = credentialDatabase(entry, t);
    const storedSnapshot = await currentRentalModuleCredentialSnapshot(input);
    const issue = { ...input, storedSnapshot, completedAt, checkedAt: "2026-09-30T23:00:00.000Z" };
    await assertRentalModuleCredentialCurrent(issue);
    await assert.rejects(() => assertRentalModuleCredentialCurrent({ ...issue, checkedAt: "2026-10-01T00:00:00.000Z" }), /RENTAL_MODULE_CREDENTIAL_CHANGED/);
    sqlite.prepare("UPDATE trade_team_member_files SET sha256 = ?").run("b".repeat(64));
    await assert.rejects(() => assertRentalModuleCredentialCurrent(issue), /RENTAL_MODULE_CREDENTIAL_CHANGED/);
  });
}

function reportBuilder(objects) {
  const source = fs.readFileSync(new URL("../src/lib/trade-rental-report-server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${source}\nexport { buildReportSnapshot };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    "cloudflare:workers": { env: { EVIDENCE: { get: async (key) => objects.has(key)
      ? { arrayBuffer: async () => objects.get(key).buffer } : null } } },
    "../../db": {}, "@/lib/trade-team-server": {}, "@/lib/trade-team-sync-server": {},
    "@/lib/trade-rental-assessment.mjs": assessment, "@/lib/trade-issued-document-store": {},
    "@/lib/trade-rental-report-links": {}, "@/lib/customer-plan-pdf-fonts": {},
    "@/lib/trade-rental-evidence.mjs": evidence, "@/lib/trade-rental-credentials": {},
    "@/lib/rental-assessor-workflow.mjs": workflow, "@/lib/trade-rental-schema-guards": {},
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    assert.ok(id in dependencies, `Unmocked dependency ${id}`);
    return dependencies[id];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports.buildReportSnapshot;
}

test("one safety report retains all selected add-ons, test results, credentials and evidence", async () => {
  const source = { inspection: { property_snapshot: {}, inspection_number: "RMS-OPTIONAL" },
    modules: [], items: [], findings: [], evidence: [], business: {}, assessor: {} };
  const objects = new Map();
  for (const entry of cases) {
    const fixture = completeFixture(entry);
    const moduleId = `private-${entry.key}`;
    source.modules.push({ id: moduleId, module_key: entry.key, template_name: fixture.moduleTemplate.title,
      template_snapshot: fixture.moduleTemplate, answers: fixture.answers, status: "complete", completed_at: completedAt,
      credential_snapshot: { gate: entry.gate, credentialNumber: "TEST-100", supportingFileSha256: "a".repeat(64) } });
    for (const item of fixture.items) source.items.push({ id: item.id, module_id: moduleId, item_key: item.itemKey,
      section_key: item.sectionKey, check_key: item.checkKey, instance_key: item.instanceKey,
      location_label: item.locationLabel, outcome: item.outcome, response_json: item.responseJson });
    const bytes = new Uint8Array([1, 2, 3, objects.size]);
    objects.set(entry.key, bytes);
    source.evidence.push({ id: `private-evidence-${entry.key}`, item_id: fixture.items[0].id, object_key: entry.key,
      content_type: "application/pdf", evidence_type: "document", file_name: `${entry.key}.pdf`, size_bytes: bytes.length,
      original_sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const original = structuredClone(source);
  const build = reportBuilder(objects);
  const report = { reportId: "report-optional", reportNumber: "RMS-OPTIONAL-R1", revision: 1, issuedAt: completedAt };
  const { snapshot, preparedObjects } = await build(source, report);
  assert.deepEqual(source, original, "Issuance does not rewrite frozen templates or results");
  assert.equal(snapshot.inspection.title, "Victorian rental safety-check report");
  assert.equal(snapshot.inspection.applicabilityLimitation, "");
  assert.deepEqual(snapshot.modules.map((module) => module.key), cases.map((entry) => entry.key));
  for (const entry of cases) {
    const assessmentModule = snapshot.modules.find((candidate) => candidate.key === entry.key);
    assert.equal(assessmentModule.assessmentScope, "statutory_safety_check");
    assert.equal(assessmentModule.credentialGate, entry.gate);
    assert.equal(assessmentModule.credential.credentialNumber, "TEST-100");
    const items = assessmentModule.sections.flatMap((section) => section.items);
    assert.equal(items.length, entry.checks);
    assert.ok(items.some((item) => item.response.testResult === "Measured result and acceptance decision"));
    assert.ok(items.every((item) => !item.historicalObservation && !item.derived));
    const file = snapshot.evidence.find((item) => item.fileName === `${entry.key}.pdf`);
    assert.ok(items.some((item) => item.id === file.itemId));
    assert.equal(file.originalSha256, source.evidence.find((item) => item.file_name === file.fileName).original_sha256);
  }
  assert.equal(preparedObjects.length, 3);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-electrical|private-gas|private-smoke/);
  const tampered = structuredClone(source);
  tampered.evidence[1].original_sha256 = "f".repeat(64);
  await assert.rejects(() => build(tampered, report), /RENTAL_REPORT_EVIDENCE_INTEGRITY/);
  objects.delete(cases[2].key);
  await assert.rejects(() => build(source, report), /RENTAL_REPORT_EVIDENCE_UNAVAILABLE/);
});
