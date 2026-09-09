import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as templates from "../src/lib/trade-rental-assessment.mjs";
import * as credentials from "../src/lib/trade-rental-credentials.ts";
import * as evidence from "../src/lib/trade-rental-evidence.mjs";
import * as quotation from "../src/lib/rental-quotation.mjs";

const scopeMigration = fs.readFileSync(new URL("../drizzle/0171_trade_rental_assessment_scope.sql", import.meta.url), "utf8");

test("readiness selects six future energy areas while retaining the complete current assessment", () => {
  const snapshot = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"], "energy_readiness_2027");
  const assessmentModule = snapshot.modules.minimum_standards;
  assert.equal(snapshot.assessmentScope, "energy_readiness_2027");
  assert.equal(snapshot.key, "vic-rental-minimum-standards");
  assert.deepEqual(assessmentModule.sections.map((section) => section.key), ["heating", "cooling", "hot_water", "showers", "ceiling_insulation", "draughtproofing"]);
  assert.equal(assessmentModule.sections.flatMap((section) => section.checks).length, 8);
  assert.equal(assessmentModule.credentialGate, "assigned_assessor");
  assert.ok(assessmentModule.metadataFields.every((field) => field.phase && field.source));
  assert.deepEqual(assessmentModule.metadataFields.filter((field) => field.phase === "final").map((field) => field.key), ["coverageConfirmed", "assessorDeclaration"]);
  assert.ok(assessmentModule.metadataFields.every((field) => !["qualificationType", "qualificationNumber", "credentialConfirmed"].includes(field.key)));
  const checks = assessmentModule.sections.flatMap((section) => section.checks);
  assert.ok(checks.every((check) => check.requiredEvidenceCount > 0 && check.sourceUrl.startsWith("https://www.consumer.vic.gov.au/")));
  assert.ok(assessmentModule.sections.at(-1).checks.every((check) => check.effectiveFrom === "2027-07-01"));
  assert.match(assessmentModule.sections[0].checks[0].help, /working heater.*can stay/i);
  assert.match(assessmentModule.sections[1].checks[0].trigger, /1 July 2030/);
  assert.match(assessmentModule.sections[4].checks[0].help, /Existing insulation need not be upgraded/);
  assert.match(assessmentModule.sections.at(-1).checks.at(-1).help, /unflued or open-flued.*six months/i);
  assert.match(assessmentModule.reportBoundary, /not a declaration of non-compliance today/);
  const full = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"]);
  assert.equal(full.assessmentScope, "current_minimum_standards");
  assert.equal(full.modules.minimum_standards.sections.length, 20);
  assert.equal(full.modules.minimum_standards.sections.flatMap((section) => section.checks).length, 32);
  assert.throws(() => templates.rentalAssessmentTemplateSnapshot(["minimum_standards"], "invented"), /SCOPE_INVALID/);
});

test("rental scope has a dedicated persisted field while retaining the database-approved template identity", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`CREATE TABLE trade_rental_inspections (
      template_key TEXT NOT NULL CHECK (template_key = 'vic-rental-minimum-standards')
    )`);
    for (const statement of scopeMigration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) database.exec(statement);
    const snapshot = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"], "energy_readiness_2027");
    database.prepare("INSERT INTO trade_rental_inspections (template_key, assessment_scope) VALUES (?, ?)")
      .run(snapshot.key, snapshot.assessmentScope);
    assert.deepEqual({ ...database.prepare("SELECT template_key, assessment_scope FROM trade_rental_inspections").get() }, {
      template_key: "vic-rental-minimum-standards",
      assessment_scope: "energy_readiness_2027",
    });
  } finally { database.close(); }
});

test("readiness still requires actual observations, evidence, findings and final declarations", () => {
  const moduleTemplate = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"], "energy_readiness_2027").modules.minimum_standards;
  const items = moduleTemplate.sections.flatMap((section) => section.checks.map((check) => ({
    id: check.key, itemKey: check.key, sectionKey: section.key, checkKey: check.key,
    locationLabel: "Recorded area", outcome: "meets", requiredEvidenceCount: 1,
  })));
  const input = { moduleTemplate, items, findings: [], evidenceCounts: Object.fromEntries(items.map((item) => [item.id, 1])),
    answers: { inspectionDate: "2026-09-07", rentalRegime: "ordinary_residential", dwellingClass: "house", coverageConfirmed: true, assessorDeclaration: true } };
  assert.equal(templates.rentalAssessmentCompletion(input).complete, true);
  assert.equal(templates.rentalAssessmentCompletion({ ...input, evidenceCounts: {} }).complete, false);
  assert.equal(templates.rentalAssessmentCompletion({ ...input, answers: { ...input.answers, assessorDeclaration: false } }).complete, false);
  assert.equal(templates.rentalAssessmentCompletion({ ...input, items: [{ ...items[0], outcome: "does_not_meet" }, ...items.slice(1)] }).complete, false);
});

function databaseFixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE trade_team_members (id TEXT, owner_uid TEXT, status TEXT, display_name TEXT, first_name TEXT, last_name TEXT);
    INSERT INTO trade_team_members VALUES ('worker','owner','active','Assigned profile','Alex','Installer');
    CREATE TABLE trade_team_member_credentials (id TEXT,owner_uid TEXT,team_member_id TEXT,credential_type TEXT,name TEXT,credential_number TEXT,
      rental_gate TEXT,status TEXT,jurisdiction TEXT,expires_at TEXT,updated_at TEXT,file_id TEXT);
    CREATE TABLE trade_team_member_files (id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_work_orders (id TEXT, firebase_uid TEXT, revision INTEGER, stage TEXT, record_status TEXT, updated_at TEXT, assignee_member_id TEXT);
    INSERT INTO trade_work_orders VALUES ('job','owner',1,'scheduled','active','before','worker');
    CREATE TABLE trade_rental_inspections (id TEXT,work_order_id TEXT,firebase_uid TEXT,inspection_number TEXT,jurisdiction TEXT,status TEXT,
      template_key TEXT,template_version INTEGER,rules_effective_from TEXT,assessment_scope TEXT,selected_modules_snapshot TEXT,module_selection_snapshot TEXT,
      property_snapshot TEXT,assessor_snapshot TEXT,assessor_member_id TEXT,revision INTEGER,submitted_at TEXT,issued_at TEXT,issued_report_id TEXT,created_at TEXT,updated_at TEXT);
    INSERT INTO trade_rental_inspections VALUES ('inspection','job','owner','RMS-TEST','VIC','scheduled','vic-rental-minimum-standards',1,'2026-06-30','current_minimum_standards',
      '["minimum_standards"]','["minimum_standards"]','{}','{}','worker',1,'','','','before','before');
    CREATE TABLE trade_rental_inspection_modules (id TEXT,inspection_id TEXT,firebase_uid TEXT,module_key TEXT,selected_required INTEGER,status TEXT,
      template_version INTEGER,template_name TEXT,required_capability TEXT,template_snapshot TEXT,answers TEXT,credential_snapshot TEXT,revision INTEGER,
      completed_by_uid TEXT,completed_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_rental_inspection_items (id TEXT,inspection_id TEXT,module_id TEXT,firebase_uid TEXT,item_key TEXT,section_key TEXT,check_key TEXT,
      instance_key TEXT,location_label TEXT,outcome TEXT,response_json TEXT,public_notes TEXT,internal_notes TEXT,required_evidence_count INTEGER,
      sort_order INTEGER,revision INTEGER,completed_by_uid TEXT,completed_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_rental_findings (id TEXT,inspection_id TEXT,module_id TEXT,item_id TEXT,firebase_uid TEXT,finding_key TEXT,category TEXT,title TEXT,
      description TEXT,standard_reference TEXT,finding_status TEXT,severity TEXT,trade_category TEXT,location_label TEXT,recommended_action TEXT,
      scope_summary TEXT,quantity_milli INTEGER,unit_label TEXT,details TEXT,internal_notes TEXT,sort_order INTEGER,revision INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_rental_evidence_links (id TEXT,inspection_id TEXT,module_id TEXT,item_id TEXT,finding_id TEXT,job_media_id TEXT,firebase_uid TEXT,
      requirement_key TEXT,evidence_type TEXT,purpose TEXT,caption_snapshot TEXT,status TEXT,sort_order INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_crm_job_media (id TEXT, firebase_uid TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,evidence_envelope TEXT);
    CREATE TABLE trade_rental_inspection_events (id TEXT,inspection_id TEXT,report_id TEXT,report_link_id TEXT,firebase_uid TEXT,actor_type TEXT,actor_uid TEXT,
      event_type TEXT,request_id TEXT,summary TEXT,metadata TEXT,source_ip_sha256 TEXT,user_agent_sha256 TEXT,created_at TEXT);
  `);
  const legacy = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"], "current_minimum_standards").modules.minimum_standards;
  sql.prepare(`INSERT INTO trade_rental_inspection_modules VALUES ('module','inspection','owner','minimum_standards',1,'draft',1,'Full assessment',
    'assigned_assessor',?,'{"assessorDeclaration":true,"qualificationNumber":"OLD-TEST"}','{}',1,'','','before','before')`).run(JSON.stringify(legacy));
  sql.exec(`INSERT INTO trade_rental_inspection_items VALUES ('old-item','inspection','module','owner','old-key','bathroom','bathroom_facilities',
    'property','','meets','{}','Existing observation','',1,0,1,'worker','before','before','before');`);
  function statement(query, bindings = []) {
    return { query, bindings, bind(...values) { return statement(query, values); },
      async first() { return sql.prepare(query).get(...bindings) || null; },
      async all() { return { results: sql.prepare(query).all(...bindings) }; },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...bindings).changes) } }; } };
  }
  const d1 = { prepare: statement, async batch(statements) { return Promise.all(statements.map((entry) => entry.run())); } };
  return { sql, d1 };
}

function loadRoute(fixture, permissions = {}) {
  const access = { ownerUid: "owner", actorUid: "worker-uid", memberId: "worker", displayName: "Alex Installer", isOwner: false,
    canManageFieldEvidence: true, canViewFieldEvidence: true, canRunReports: true, ...permissions };
  const source = fs.readFileSync(new URL("../src/app/api/trade-rental-inspections/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  const dependencies = {
    "../../../../db": { getD1: () => fixture.d1 },
    "@/lib/admin-server": { adminJson: (value, status = 200) => Response.json(value, { status }), cleanAdminText: (value, max) => String(value ?? "").trim().slice(0, max), sameOrigin: () => true },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access, assignedJob: async (_, id) => {
      const job = fixture.sql.prepare("SELECT * FROM trade_work_orders WHERE id = ? AND firebase_uid = ?").get(id, access.ownerUid);
      if (!job) throw new Error("JOB_NOT_FOUND"); return job;
    } },
    "@/lib/trade-team-sync-server": { nextJobRevision: (revision) => Number(revision) + 1, jobSyncChangeStatements: () => [],
      guardedOnlineJobMutationBatch: async (_, statements, expected) => {
        fixture.sql.exec("BEGIN");
        try { for (const entry of statements) await entry.run();
          const row = fixture.sql.prepare("SELECT revision FROM trade_work_orders WHERE id = ? AND firebase_uid = ?").get(expected.workOrderId, expected.ownerUid);
          if (row.revision !== expected.jobRevision) throw new Error("ONLINE_MUTATION_CONFLICT");
          fixture.sql.exec("COMMIT");
        } catch (error) { fixture.sql.exec("ROLLBACK"); throw error; }
      } },
    "@/lib/trade-rental-assessment.mjs": templates,
    "@/lib/rental-quotation.mjs": quotation,
    "@/lib/trade-rental-evidence.mjs": evidence,
    "@/lib/trade-rental-credentials": credentials,
    "@/lib/trade-rental-schema-guards": { ensureTradeRentalSchemaGuards: async () => {} },
    "@/lib/bounded-json-request": { BoundedJsonRequestError: class extends Error {}, readBoundedJsonRequest: (request) => request.json() },
    "@/lib/trade-rental-report-server": { ownerRentalReportPresentation: async () => [] },
  };
  new Function("require", "module", "exports", compiled)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const post = (route, value) => route.POST(new Request("https://test.example/api/trade-rental-inspections", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workOrderId: "job", ...value }),
}));

test("scope API switches unissued tests with CAS, retains old observations and rejects issued records", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    const request = { action: "set_assessment_scope", moduleId: "module", scope: "energy_readiness_2027", expectedInspectionRevision: 1, expectedModuleRevision: 1 };
    const response = await post(route, request);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const payload = await response.json();
    assert.equal(payload.inspection.assessmentScope, "energy_readiness_2027");
    assert.equal(fixture.sql.prepare("SELECT assessment_scope FROM trade_rental_inspections").get().assessment_scope, "energy_readiness_2027");
    assert.equal(payload.modules[0].template.sections.length, 6);
    assert.equal(payload.modules[0].answers.assessorName, "Alex Installer");
    assert.equal(payload.modules[0].answers.assessorDeclaration, false);
    assert.equal(payload.items.length, 0, "Current readiness payload must not relabel old bathroom observations");
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_items").get().count, 1);
    const history = JSON.parse(fixture.sql.prepare("SELECT metadata FROM trade_rental_inspection_events").get().metadata);
    assert.equal(history.previousAnswers.qualificationNumber, "OLD-TEST");
    assert.equal((await post(route, request)).status, 409);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events").get().count, 1);
    fixture.sql.exec("UPDATE trade_rental_inspections SET status = 'issued'");
    assert.equal((await post(route, { ...request, expectedInspectionRevision: 2, expectedModuleRevision: 2 })).status, 409);
    assert.equal((await post(loadRoute(fixture, { ownerUid: "other-owner" }), request)).status, 404);
  } finally { fixture.sql.close(); }
});

test("saved assessor identity is taken from Team and observations invalidate earlier declarations", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    await post(route, { action: "set_assessment_scope", moduleId: "module", scope: "energy_readiness_2027", expectedInspectionRevision: 1, expectedModuleRevision: 1 });
    const saved = await post(route, { action: "save_module_answers", moduleId: "module", expectedRevision: 2,
      answers: { assessorName: "Forged name", inspectionDate: "2026-09-07", dwellingClass: "house", coverageConfirmed: true, assessorDeclaration: true } });
    assert.equal(saved.status, 200);
    let row = fixture.sql.prepare("SELECT answers,revision FROM trade_rental_inspection_modules").get();
    assert.equal(JSON.parse(row.answers).assessorName, "Alex Installer");
    const changed = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: row.revision, expectedItemRevision: 0,
      sectionKey: "heating", checkKey: "heating_2027_readiness", instanceKey: "property", outcome: "meets", response: {}, publicNotes: "Observed operating system" });
    assert.equal(changed.status, 200, JSON.stringify(await changed.clone().json()));
    row = fixture.sql.prepare("SELECT answers FROM trade_rental_inspection_modules").get();
    assert.equal(JSON.parse(row.answers).assessorDeclaration, undefined);
    const credential = await credentials.currentRentalModuleCredentialSnapshot({ db: fixture.d1, ownerUid: "owner", assessorMemberId: "worker",
      moduleKey: "minimum_standards", requiredCapability: "assigned_assessor", answers: { assessorDeclaration: true }, confirmedAt: "2026-09-07T00:00:00Z" });
    assert.equal(credential.verificationBasis, "assigned_team_profile");
    assert.equal(credential.assessorName, "Alex Installer");
    assert.equal(credential.credentialNumber, "");
    await assert.rejects(() => credentials.currentRentalModuleCredentialSnapshot({ db: fixture.d1, ownerUid: "owner", assessorMemberId: "worker",
      moduleKey: "minimum_standards", requiredCapability: "assigned_assessor", answers: {}, confirmedAt: "2026-09-07T00:00:00Z" }), /CREDENTIAL_REQUIRED/);
  } finally { fixture.sql.close(); }
});

test("a specialist result uses the assigned Team licence and cannot accept a made-up per-job credential", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    const input = { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
      sectionKey: "electrical_safety", checkKey: "outlet_lighting_protection", instanceKey: "property", outcome: "meets",
      response: { credentialVerified: true, credentialNumber: "INVENTED" } };
    assert.equal((await post(route, input)).status, 409);
    fixture.sql.exec(`INSERT INTO trade_team_member_credentials VALUES ('credential','owner','worker','licence','Electrical licence','LIC-VERIFIED',
      'licensed_electrician','active','VIC','2099-12-31','2026-09-07','credential-file');
      INSERT INTO trade_team_member_files VALUES ('credential-file','owner','worker','active','2099-12-31');`);
    const response = await post(route, input);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const saved = JSON.parse(fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items WHERE check_key = 'outlet_lighting_protection'").get().response_json);
    assert.equal(saved.credentialNumber, "LIC-VERIFIED");
    assert.equal(saved.credentialVerified, true);
  } finally { fixture.sql.close(); }
});

test("assignment credential predicate checks every selected professional gate using the same worker and owner", () => {
  const fixture = databaseFixture();
  try {
    assert.deepEqual(credentials.rentalAssignmentRequiredGates(["minimum_standards"]), []);
    assert.deepEqual(credentials.rentalAssignmentRequiredGates(["gas_safety_check", "electrical_safety_check", "gas_safety_check"]),
      ["licensed_gasfitter", "licensed_electrician"]);
    assert.throws(() => credentials.rentalAssignmentCredentialSql("member.id OR 1=1", "member.owner_uid"), /SQL_IDENTIFIER_INVALID/);
    const query = fixture.sql.prepare(`SELECT member.id FROM trade_team_members member WHERE member.status = 'active'
      AND ${credentials.rentalAssignmentCredentialSql("member.id", "member.owner_uid")}`);
    const eligible = (gates) => query.all(JSON.stringify(gates), "2026-09-07", "2026-09-07").map((row) => row.id);
    assert.deepEqual(eligible([]), ["worker"], "General observational assessment needs no licence");
    assert.deepEqual(eligible(["licensed_electrician"]), []);
    fixture.sql.exec(`INSERT INTO trade_team_member_credentials VALUES ('electrical','owner','worker','licence','Electrical','LIC-123',
      'licensed_electrician','active','VIC','2099-12-31','2026-09-07','electrical-file');
      INSERT INTO trade_team_member_files VALUES ('electrical-file','owner','worker','active','2099-12-31');`);
    assert.deepEqual(eligible(["licensed_electrician"]), ["worker"]);
    assert.deepEqual(eligible(["licensed_electrician", "licensed_gasfitter"]), []);
    for (const [table, field, invalid, valid] of [
      ["trade_team_member_credentials", "credential_number", "  ", "LIC-123"],
      ["trade_team_member_credentials", "credential_type", "training", "licence"],
      ["trade_team_member_credentials", "owner_uid", "another-owner", "owner"],
      ["trade_team_member_credentials", "team_member_id", "another-worker", "worker"],
      ["trade_team_member_credentials", "jurisdiction", "NSW", "VIC"],
      ["trade_team_member_credentials", "expires_at", "2026-09-06", "2099-12-31"],
      ["trade_team_member_files", "owner_uid", "another-owner", "owner"],
      ["trade_team_member_files", "team_member_id", "another-worker", "worker"],
      ["trade_team_member_files", "status", "archived", "active"],
      ["trade_team_member_files", "expires_at", "", "2099-12-31"],
    ]) {
      fixture.sql.prepare(`UPDATE ${table} SET ${field} = ?`).run(invalid);
      assert.deepEqual(eligible(["licensed_electrician"]), [], `${table}.${field} must match`);
      fixture.sql.prepare(`UPDATE ${table} SET ${field} = ?`).run(valid);
    }
    fixture.sql.exec(`INSERT INTO trade_team_member_credentials VALUES ('smoke','owner','worker','training','Smoke alarm training','TRAIN-123',
      'suitably_qualified_smoke_alarm_worker','active','NATIONAL','2099-12-31','2026-09-07','electrical-file');`);
    assert.deepEqual(eligible(["licensed_electrician", "suitably_qualified_smoke_alarm_worker"]), ["worker"]);
    fixture.sql.exec("INSERT INTO trade_team_members VALUES ('owner','owner','active','Owner','Business','Owner')");
    assert.deepEqual(eligible(["licensed_electrician"]), ["worker"], "Business ownership never grants a professional credential");
  } finally { fixture.sql.close(); }
});
