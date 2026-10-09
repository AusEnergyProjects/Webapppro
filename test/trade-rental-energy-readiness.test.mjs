import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as templates from "../src/lib/trade-rental-assessment.mjs";
import * as credentials from "../src/lib/trade-rental-credentials.ts";
import * as evidence from "../src/lib/trade-rental-evidence.mjs";
import * as quotation from "../src/lib/rental-quotation.mjs";
import * as workflow from "../src/lib/rental-assessor-workflow.mjs";
import * as answerPresentation from "../src/lib/rental-report-answer.mjs";
import * as branding from "../src/lib/rental-report-branding.mjs";

const scopeMigration = fs.readFileSync(new URL("../drizzle/0171_trade_rental_assessment_scope.sql", import.meta.url), "utf8");

test("frozen room-based declarations use the current dwelling wording in completion warnings", () => {
  const moduleTemplate = { key: "minimum_standards", sections: [], metadataFields: [
    { key: "coverageConfirmed", type: "checkbox", required: true, label: "I have added every relevant room, door, window, fixture and area to the repeatable checks" },
  ] };
  const completion = templates.rentalAssessmentCompletion({ moduleTemplate, answers: {} });
  assert.equal(completion.blockers.find((entry) => entry.key === "metadata:coverageConfirmed").label,
    "I have checked the property and recorded any areas I could not access is required.");
  assert.match(moduleTemplate.metadataFields[0].label, /every relevant room/, "The historical template remains unchanged");
});

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
  assert.equal(full.modules.minimum_standards.sections.flatMap((section) => section.checks).length, 31);
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
    id: check.key, itemKey: check.key, instanceKey: "property", sectionKey: section.key, checkKey: check.key,
    locationLabel: "Recorded area", outcome: "meets", requiredEvidenceCount: 1,
    responseJson: ["heating_2027_readiness", "hot_water_2027_readiness"].includes(check.key) ? { cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Concealed route was not accessible" } : {},
  })));
  const input = { moduleTemplate, items, findings: [], evidenceCounts: Object.fromEntries(items.map((item) => [item.id, item.checkKey === "cooling_2027_readiness" ? 2 : 1])), photoCounts: Object.fromEntries(items.map((item) => [item.id, item.checkKey === "cooling_2027_readiness" ? 2 : 1])),
    answers: { inspectionDate: "2026-09-07", rentalRegime: "ordinary_residential", dwellingClass: "house", coverageConfirmed: true, assessorDeclaration: true } };
  assert.equal(templates.rentalAssessmentCompletion(input).complete, true);
  assert.equal(templates.rentalAssessmentCompletion({ ...input, evidenceCounts: {} }).complete, false);
  assert.equal(templates.rentalAssessmentCompletion({ ...input, answers: { ...input.answers, assessorDeclaration: false } }).complete, false);
  assert.equal(templates.rentalAssessmentCompletion({ ...input, items: [{ ...items[0], outcome: "does_not_meet" }, ...items.slice(1)] }).complete, false);
});

function frozenVersionThreeTemplate() {
  const template = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  template.templateVersion = 3;
  template.metadataFields = template.metadataFields.filter((field) => field.key !== "homeStarCommissioned");
  for (const section of template.sections) for (const check of section.checks) {
    check.responseFields = check.responseFields.filter((field) => field.captureVersion !== 4);
    delete check.operationPhotoRequired;
  }
  const electrical = template.sections.find((section) => section.key === "electrical_safety");
  const protectedCheck = electrical.checks[0];
  delete protectedCheck.verificationBasis;
  protectedCheck.credentialGate = "licensed_electrician";
  protectedCheck.prompt = "Power outlet and lighting circuits have the required circuit breaker and residual current device protection.";
  electrical.checks.unshift({ key: "switchboard_observation", prompt: "The switchboard and circuit schedule have been recorded.", required: true, requiredEvidenceCount: 1, responseType: "outcome", responseFields: quotation.rentalObservationFields("switchboard_observation"), repeatBy: "property", credentialGate: "assigned_assessor", help: "Record the accessible switchboard front and labels without removing covers.", photoGuidance: "Photograph the switchboard and readable labels." });
  return template;
}

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
    CREATE TABLE trade_crm_job_media (id TEXT, work_order_id TEXT, firebase_uid TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,evidence_envelope TEXT);
    CREATE TABLE trade_rental_inspection_events (id TEXT,inspection_id TEXT,report_id TEXT,report_link_id TEXT,firebase_uid TEXT,actor_type TEXT,actor_uid TEXT,
      event_type TEXT,request_id TEXT,summary TEXT,metadata TEXT,source_ip_sha256 TEXT,user_agent_sha256 TEXT,created_at TEXT);
  `);
  const legacy = frozenVersionThreeTemplate();
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

function loadRoute(fixture, permissions = {}, reportApi = {}) {
  const access = { ownerUid: "owner", actorUid: "worker-uid", memberId: "worker", displayName: "Alex Installer", isOwner: false,
    canManageFieldEvidence: true, canViewFieldEvidence: true, canRunReports: true, ...permissions };
  const source = fs.readFileSync(new URL("../src/app/api/trade-rental-inspections/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  const dependencies = {
    "@/lib/trade-form-job-progress": { reconcileTradeFormJobProgress: async () => ({changed:false,stage:"in_progress",blockers:[]}) },
    "../../../../db": { getD1: () => fixture.d1 },
    "@/lib/admin-server": { mfaErrorResponse, adminJson: (value, status = 200) => Response.json(value, { status }), cleanAdminText: (value, max) => String(value ?? "").trim().slice(0, max), sameOrigin: () => true },
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
    "@/lib/rental-assessor-workflow.mjs": workflow,
    "@/lib/trade-rental-evidence.mjs": evidence,
    "@/lib/trade-rental-credentials": credentials,
    "@/lib/trade-rental-schema-guards": { ensureTradeRentalSchemaGuards: async () => {} },
    "@/lib/bounded-json-request": { BoundedJsonRequestError: class extends Error {}, readBoundedJsonRequest: (request) => request.json() },
    "@/lib/trade-rental-report-email-server": { rentalReportDeliveryRecipient: async () => null, rentalReportDeliveryState: async () => null },
    "@/lib/trade-rental-report-server": { ownerRentalReportPresentation: async () => [], ...reportApi },
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

test("quoting capture API persists actual cable, count, heating/cooling rating and shared-supply answers", async () => {
  const cases = [
    ["heating", "heating_2027_readiness", { applianceType: "Split system", cableMeasurementStatus: "Measured", airconTotalCableMetres: 22.5, cableRouteBasis: "Switchboard via roof, 2m drop and indoor/outdoor interconnection", heatingGemsStatus: "Label recorded", heatingEnergyRating: "4.5 stars", heatingRatingZone: "Cold", heatingRatingBasis: "Appliance label", heatingGemsReference: "GEMS model example" }],
    ["heating", "heating_2027_readiness", { applianceType: "Gas heater", cableMeasurementStatus: "Estimated", airconSwitchboardToOutdoorMetres: 15.2, airconOutdoorToIndoorMetres: 6.4, cableRouteBasis: "Switchboard through roof to proposed outdoor unit; indoor unit on living-room wall" }],
    ["heating", "heating_2027_readiness", { applianceType: "Unknown", cableMeasurementStatus: "Measured", airconSwitchboardToOutdoorMetres: 0, airconOutdoorToIndoorMetres: 0, airconTotalCableMetres: 22.5, cableRouteBasis: "Separate proposed positions; prior total retained" }],
    ["kitchen", "cooktop_function", { cableMeasurementStatus: "Estimated", cooktopCableRunMetres: 15.75, cableRouteBasis: "Roof route includes 3m wall drop" }],
    ["hot_water", "hot_water_2027_readiness", { hotWaterSupplyType: "Individual unit", cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Switchboard route concealed" }],
    ["lighting", "artificial_lighting", { downlightCountStatus: "Counted", nonIc4DownlightCount: 7, downlightEvidence: "Seven readable non-IC4 labels" }],
    ["lighting", "artificial_lighting", { downlightCountStatus: "Counted", nonIc4DownlightCount: 7 }],
    ["lighting", "artificial_lighting", { downlightCountStatus: "Unknown", downlightCountLimitation: "Labels not accessible", nonIc4DownlightCount: "7", downlightEvidence: "Earlier estimate retained" }],
    ["cooling", "cooling_2027_readiness", { applianceType: "Ducted", coolingGemsStatus: "Not available", coolingRatingLimitation: "No star label; request registration information" }],
    ["hot_water", "hot_water_2027_readiness", { hotWaterSupplyType: "Shared building system", sharedHotWaterServiceStatus: "Hot water supplied when checked", sharedHotWaterLimitation: "Building plant not inspected; ask manager for access" }],
  ];
  for (const [sectionKey, checkKey, responseValues] of cases) {
    const fixture = databaseFixture();
    try {
      const response = await post(loadRoute(fixture), { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey, checkKey, outcome: "meets", response: responseValues });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const row = fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items WHERE check_key = ?").get(checkKey);
      const expected = Object.fromEntries(Object.entries(responseValues).map(([key, value]) => [key, typeof value === "number" ? String(value) : value]));
      assert.deepEqual(JSON.parse(row.response_json), expected);
      const payload = await response.json();
      assert.deepEqual(payload.items.find((item) => item.checkKey === checkKey).response, expected, "Draft responses retain inactive earlier values for history");
    } finally { fixture.sql.close(); }
  }
});

test("RCAC API validates each proposed segment and never replaces either with the earlier combined total", async () => {
  for (const key of ["airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres"]) {
    for (const value of ["-1", "1e3", "1,000", "abc", true, {}, []]) {
      const fixture = databaseFixture();
      try {
        const tables = ["trade_work_orders", "trade_rental_inspections", "trade_rental_inspection_modules", "trade_rental_inspection_items", "trade_rental_inspection_events"];
        const before = tables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all());
        const response = await post(loadRoute(fixture), { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0, sectionKey: "heating", checkKey: "heating_2027_readiness", outcome: "meets", response: { cableMeasurementStatus: "Estimated", airconSwitchboardToOutdoorMetres: "15.2", cableRouteBasis: "Proposed roof route", [key]: value } });
        assert.equal(response.status, 400, `${key}: ${JSON.stringify(value)}`);
        assert.deepEqual(tables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all()), before, "Invalid segment capture writes no changes");
      } finally { fixture.sql.close(); }
    }
  }
  const fixture = databaseFixture();
  try {
    const response = await post(loadRoute(fixture), { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0, sectionKey: "heating", checkKey: "heating_2027_readiness", outcome: "meets", response: { cableMeasurementStatus: "Estimated", airconTotalCableMetres: "22.5", cableRouteBasis: "Earlier combined route" } });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const saved = JSON.parse(fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items WHERE check_key = 'heating_2027_readiness'").get().response_json);
    assert.equal(saved.airconTotalCableMetres, "22.5");
    assert.equal(Object.hasOwn(saved, "airconSwitchboardToOutdoorMetres"), false);
    assert.equal(Object.hasOwn(saved, "airconOutdoorToIndoorMetres"), false);
  } finally { fixture.sql.close(); }
});

test("invalid non-IC4 counts and invented capture choices cause no assessment, evidence, event or job writes", async () => {
  const fixture = databaseFixture();
  try {
    const tables = ["trade_work_orders", "trade_rental_inspections", "trade_rental_inspection_modules", "trade_rental_inspection_items", "trade_rental_findings", "trade_rental_evidence_links", "trade_rental_inspection_events"];
    const before = tables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all());
    const invalid = [
      ...[-1, "-1", 1.5, "1.0", "1e3", "1,000", Number.MAX_SAFE_INTEGER + 1, true, {}, []].map((nonIc4DownlightCount) => ({ nonIc4DownlightCount })),
      { cableMeasurementStatus: "Probably" }, { downlightCountStatus: "Assumed zero" }, { heatingGemsStatus: "Auto verified" },
      { coolingRatingZone: "Any zone" }, { heatingRatingBasis: "Guessed" }, { hotWaterSupplyType: "Exempt apartment" },
      { sharedHotWaterServiceStatus: "Plant compliant" }, { hotWaterCableRunMetres: "-3" },
    ];
    for (const responseValues of invalid) {
      const response = await post(loadRoute(fixture), { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey: "lighting", checkKey: "artificial_lighting", outcome: "meets", response: { downlightCountStatus: "Counted", ...responseValues } });
      assert.equal(response.status, 400, JSON.stringify(responseValues));
      assert.deepEqual(tables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all()), before);
    }
  } finally { fixture.sql.close(); }
});

test("same-scope question upgrade adopts v4 once with CAS and preserves existing answers, items, findings and photo links", async () => {
  const fixture = databaseFixture();
  try {
    const oldTemplate = frozenVersionThreeTemplate();
    const oldAnswers = { dwellingClass: "unit_apartment", occupancyAtAssessment: "vacant", rentalRegime: "ordinary_residential", agreementStartDate: "2026-01-01", roomRoster: [{ id: "earlier-room", label: "Earlier room" }], coverageConfirmed: true, assessorDeclaration: true };
    fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, template_version = 3, answers = ?").run(JSON.stringify(oldTemplate), JSON.stringify(oldAnswers));
    fixture.sql.exec("UPDATE trade_rental_inspections SET template_version = 3");
    fixture.sql.prepare("UPDATE trade_rental_inspection_items SET response_json = ?").run(JSON.stringify({ model: "Previously captured label", measurement: "Previously measured 4m", limitationReason: "Earlier safe access limit" }));
    fixture.sql.exec("INSERT INTO trade_crm_job_media (id, work_order_id, firebase_uid, file_name, content_type, size_bytes) VALUES ('photo','job','owner','retained.jpg','image/jpeg',24)");
    fixture.sql.exec("INSERT INTO trade_rental_evidence_links (id, inspection_id, module_id, item_id, job_media_id, firebase_uid, evidence_type, status) VALUES ('link','inspection','module','old-item','photo','owner','photo','active')");
    fixture.sql.exec("INSERT INTO trade_rental_findings (id, inspection_id, module_id, item_id, firebase_uid, title, description) VALUES ('finding','inspection','module','old-item','owner','Earlier note','Existing finding')");
    const retainedTables = ["trade_rental_inspection_items", "trade_rental_findings", "trade_rental_evidence_links", "trade_crm_job_media"];
    const retainedBefore = retainedTables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all());
    const request = { action: "set_assessment_scope", moduleId: "module", scope: "current_minimum_standards", expectedInspectionRevision: 1, expectedModuleRevision: 1 };
    const route = loadRoute(fixture);
    const response = await post(route, request);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const payload = await response.json();
    assert.equal(payload.inspection.templateVersion, 4);
    assert.equal(payload.modules[0].template.templateVersion, 4);
    assert.equal(payload.modules[0].template.historicalChecks[0].check.key, "switchboard_observation");
    assert.equal(payload.modules[0].answers.homeStarCommissioned, false);
    for (const key of ["dwellingClass", "occupancyAtAssessment", "rentalRegime", "agreementStartDate", "roomRoster"]) assert.deepEqual(payload.modules[0].answers[key], oldAnswers[key]);
    assert.equal(payload.modules[0].answers.coverageConfirmed, false);
    assert.equal(payload.modules[0].answers.assessorDeclaration, false);
    assert.deepEqual(retainedTables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all()), retainedBefore);
    const history = JSON.parse(fixture.sql.prepare("SELECT metadata FROM trade_rental_inspection_events").get().metadata);
    assert.deepEqual(history.previousTemplate, oldTemplate);
    assert.deepEqual(history.previousAnswers, oldAnswers);
    assert.equal((await post(route, request)).status, 409, "Stale upgrade cannot duplicate the event");
    const beforeNoop = ["trade_work_orders", "trade_rental_inspections", "trade_rental_inspection_modules", "trade_rental_inspection_events"].map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all());
    assert.equal((await post(route, { ...request, expectedInspectionRevision: 2, expectedModuleRevision: 2 })).status, 200);
    assert.deepEqual(["trade_work_orders", "trade_rental_inspections", "trade_rental_inspection_modules", "trade_rental_inspection_events"].map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all()), beforeNoop, "Current questions need no version, declaration or history rewrite");
  } finally { fixture.sql.close(); }
});

test("question upgrade refuses issued records, stale revisions and denied access without writes", async () => {
  for (const scenario of ["issued", "stale inspection", "stale module", "denied"]) {
    const fixture = databaseFixture();
    try {
      if (scenario === "issued") fixture.sql.exec("UPDATE trade_rental_inspections SET status = 'issued', issued_report_id = 'frozen-report'");
      const tables = ["trade_work_orders", "trade_rental_inspections", "trade_rental_inspection_modules", "trade_rental_inspection_items", "trade_rental_inspection_events"];
      const before = tables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all());
      const result = await post(loadRoute(fixture, scenario === "denied" ? { canManageFieldEvidence: false } : {}), { action: "set_assessment_scope", moduleId: "module", scope: "current_minimum_standards", expectedInspectionRevision: scenario === "stale inspection" ? 0 : 1, expectedModuleRevision: scenario === "stale module" ? 0 : 1 });
      assert.equal(result.status, scenario === "denied" ? 403 : 409, scenario);
      assert.deepEqual(tables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all()), before);
    } finally { fixture.sql.close(); }
  }
});

test("actual module completion enforces v4 downlight truth but preserves v3 completion and earlier inactive answers", async () => {
  for (const version of [3, 4]) {
    const fixture = databaseFixture();
    try {
      const template = { key: "minimum_standards", templateVersion: version, credentialGate: "assigned_assessor", metadataFields: [], sections: [{ key: "lighting", title: "Lighting", checks: [{ key: "artificial_lighting", required: true, repeatBy: "property", requiredEvidenceCount: 0 }] }] };
      fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, answers = ?").run(JSON.stringify(template), JSON.stringify({ coverageConfirmed: true, assessorDeclaration: true }));
      fixture.sql.exec("UPDATE trade_rental_inspection_items SET section_key = 'lighting', check_key = 'artificial_lighting', location_label = 'Property', response_json = '{}'");
      const route = loadRoute(fixture);
      const request = { action: "complete_module", moduleId: "module", expectedRevision: 1 };
      const result = await post(route, request);
      assert.equal(result.status, version === 4 ? 409 : 200, JSON.stringify(await result.clone().json()));
      if (version === 4) {
        assert.equal(fixture.sql.prepare("SELECT status FROM trade_rental_inspection_modules").get().status, "draft");
        assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events").get().count, 0);
        fixture.sql.prepare("UPDATE trade_rental_inspection_items SET response_json = ?").run(JSON.stringify({ downlightCountStatus: "Unknown", downlightCountLimitation: "Labels not accessible", nonIc4DownlightCount: "7", downlightEvidence: "Earlier count" }));
        const completed = await post(route, request);
        assert.equal(completed.status, 200, JSON.stringify(await completed.clone().json()));
        assert.equal(JSON.parse(fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items").get().response_json).nonIc4DownlightCount, "7");
      }
    } finally { fixture.sql.close(); }
  }
});

test("v4 completion requires quote-ready cable runs for working appliances while v3 keeps its frozen completion contract", async () => {
  const cases = [
    ["kitchen", "cooktop_function", "cooktopCableRunMetres", {}],
    ["hot_water", "hot_water_2027_readiness", "hotWaterCableRunMetres", { applianceType: "Gas storage", hotWaterSupplyType: "Individual unit" }],
    ["hot_water", "hot_water_2027_readiness", "hotWaterCableRunMetres", { applianceType: "Instant gas", hotWaterSupplyType: "Individual unit" }],
    ["hot_water", "hot_water_2027_readiness", "hotWaterCableRunMetres", { applianceType: "Heat pump", hotWaterSupplyType: "Individual unit" }],
    ["heating", "heating_2027_readiness", "airconSwitchboardToOutdoorMetres", { applianceType: "Gas heater" }],
    ["heating", "heating_2027_readiness", "airconSwitchboardToOutdoorMetres", { applianceType: "Unknown" }],
    ["heating", "heating_2027_readiness", "airconTotalCableMetres", { applianceType: "Split system" }],
  ];
  for (const version of [3, 4]) for (const [sectionKey, checkKey, lengthKey, identity] of cases) {
    const fixture = databaseFixture();
    try {
      const template = { key: "minimum_standards", templateVersion: version, credentialGate: "assigned_assessor", metadataFields: [], sections: [{ key: sectionKey, title: "Appliance observation", checks: [{ key: checkKey, required: true, repeatBy: "property", requiredEvidenceCount: 0, responseFields: [] }] }] };
      const frozen = JSON.stringify(template);
      fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, answers = ?").run(frozen, JSON.stringify({ coverageConfirmed: true, assessorDeclaration: true }));
      fixture.sql.prepare("UPDATE trade_rental_inspection_items SET section_key = ?, check_key = ?, location_label = 'Property', response_json = ?, required_evidence_count = 0").run(sectionKey, checkKey, JSON.stringify(identity));
      fixture.sql.exec(`INSERT INTO trade_crm_job_media (id,work_order_id,firebase_uid,file_name,content_type,size_bytes) VALUES ('appliance-photo','job','owner','appliance.jpg','image/jpeg',32);
        INSERT INTO trade_rental_evidence_links (id,inspection_id,module_id,item_id,job_media_id,firebase_uid,evidence_type,status) VALUES ('appliance-link','inspection','module','old-item','appliance-photo','owner','photo','active');`);
      const route = loadRoute(fixture), request = { action: "complete_module", moduleId: "module", expectedRevision: 1 };
      const initial = await post(route, request);
      assert.equal(initial.status, version === 4 ? 409 : 200, `${checkKey} v${version}: ${JSON.stringify(await initial.clone().json())}`);
      if (version === 4) {
        assert.match(JSON.stringify((await initial.json()).blockers), /cable length was measured/);
        for (const partial of [
          { cableMeasurementStatus: "Measured", cableRouteBasis: "Observed roof route" },
          { cableMeasurementStatus: "Estimated", [lengthKey]: "12.5" },
          { cableMeasurementStatus: "Unable to determine" },
        ]) {
          fixture.sql.prepare("UPDATE trade_rental_inspection_items SET response_json = ?").run(JSON.stringify({ ...identity, ...partial }));
          const incomplete = await post(route, request); assert.equal(incomplete.status, 409, JSON.stringify(await incomplete.clone().json()));
          assert.equal(fixture.sql.prepare("SELECT status FROM trade_rental_inspection_modules").get().status, "draft");
          assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events").get().count, 0, "Rejected completion does not write an event or complete the module");
        }
        fixture.sql.prepare("UPDATE trade_rental_inspection_items SET response_json = ?").run(JSON.stringify({ ...identity, cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Concealed cable route could not be checked safely" }));
        const completed = await post(route, request); assert.equal(completed.status, 200, JSON.stringify(await completed.clone().json()));
      }
      assert.equal(fixture.sql.prepare("SELECT template_snapshot FROM trade_rental_inspection_modules").get().template_snapshot, frozen, "Quoting capture never rewrites the frozen template");
      assert.equal(fixture.sql.prepare("SELECT status FROM trade_rental_inspection_modules").get().status, "complete");
    } finally { fixture.sql.close(); }
  }
});

test("the main-living-heater check completes without a duplicate quote and a first proposed RCAC segment is enough for existing v4 completion", async () => {
  for (const [checkKey, responseValues] of [
    ["main_living_heater", { applianceType: "Gas heater" }],
    ["heating_2027_readiness", { applianceType: "Gas heater", cableMeasurementStatus: "Estimated", airconSwitchboardToOutdoorMetres: "15.2", cableRouteBasis: "Switchboard via roof to proposed outdoor position" }],
    ["heating_2027_readiness", { applianceType: "Gas heater", cableMeasurementStatus: "Estimated", airconTotalCableMetres: "22.5", cableRouteBasis: "Earlier combined route" }],
  ]) {
    const fixture = databaseFixture();
    try {
      const template = { key: "minimum_standards", templateVersion: 4, credentialGate: "assigned_assessor", metadataFields: [], sections: [{ key: "heating", title: "Heating observation", checks: [{ key: checkKey, required: true, repeatBy: "property", requiredEvidenceCount: 0, responseFields: [] }] }] };
      const frozen = JSON.stringify(template);
      fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, answers = ?").run(frozen, JSON.stringify({ coverageConfirmed: true, assessorDeclaration: true }));
      fixture.sql.prepare("UPDATE trade_rental_inspection_items SET section_key = 'heating', check_key = ?, location_label = 'Property', response_json = ?, required_evidence_count = 0").run(checkKey, JSON.stringify(responseValues));
      fixture.sql.exec(`INSERT INTO trade_crm_job_media (id,work_order_id,firebase_uid,file_name,content_type,size_bytes) VALUES ('appliance-photo','job','owner','appliance.jpg','image/jpeg',32);
        INSERT INTO trade_rental_evidence_links (id,inspection_id,module_id,item_id,job_media_id,firebase_uid,evidence_type,status) VALUES ('appliance-link','inspection','module','old-item','appliance-photo','owner','photo','active');`);
      const response = await post(loadRoute(fixture), { action: "complete_module", moduleId: "module", expectedRevision: 1 });
      assert.equal(response.status, 200, `${checkKey}: ${JSON.stringify(await response.clone().json())}`);
      assert.equal(fixture.sql.prepare("SELECT status FROM trade_rental_inspection_modules").get().status, "complete");
      assert.equal(fixture.sql.prepare("SELECT template_snapshot FROM trade_rental_inspection_modules").get().template_snapshot, frozen);
      const saved = JSON.parse(fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items").get().response_json);
      assert.deepEqual(saved, responseValues, "Completion neither synthesizes a second segment nor rewrites the old combined total");
    } finally { fixture.sql.close(); }
  }
});

test("actual v4 shared hot-water completion accepts a working apartment supply with one photo and rejects contradictory or missing observations", async () => {
  for (const [sharedHotWaterServiceStatus, sharedHotWaterLimitation, expectedStatus, blocker] of [
    ["Hot water supplied when checked", "Building plant not accessible", 200, null],
    ["No hot water when checked", "Building plant not accessible", 409, /needing action/],
    ["Not checked", "Building plant not accessible", 409, /could not be checked/],
    ["Hot water supplied when checked", "", 409, /not inspected/],
  ]) {
    const fixture = databaseFixture();
    try {
      const current = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
      const section = current.sections.find(entry => entry.key === "hot_water");
      const template = { ...current, metadataFields: current.metadataFields.filter(field => ["coverageConfirmed", "assessorDeclaration"].includes(field.key)), sections: [section] };
      const frozen = JSON.stringify(template);
      fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, template_version = 4, answers = ?").run(frozen, JSON.stringify({ rentalRegime: "ordinary_residential" }));
      const route = loadRoute(fixture);
      const responseValues = { hotWaterSupplyType: "Shared building system", sharedHotWaterServiceStatus, sharedHotWaterLimitation, limitationStatus: "Not accessible", model: "Earlier individual unit observation" };
      const saved = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey: "hot_water", checkKey: "hot_water_2027_readiness", outcome: "meets", response: responseValues });
      assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
      const item = fixture.sql.prepare("SELECT * FROM trade_rental_inspection_items WHERE check_key = 'hot_water_2027_readiness'").get();
      assert.deepEqual(JSON.parse(item.response_json), Object.fromEntries(Object.entries(responseValues).filter(([, value]) => value !== "")), "Actual nonblank answers and inactive history persist; plant measurements or certifications are never invented");
      assert.equal((await post(route, { action: "save_module_answers", moduleId: "module", expectedRevision: 2, answers: { rentalRegime: "ordinary_residential", coverageConfirmed: true, assessorDeclaration: true } })).status, 200);
      const finish = { action: "complete_module", moduleId: "module", expectedRevision: 3 };
      if (expectedStatus === 200) {
        const absentPhoto = await post(route, finish);
        assert.equal(absentPhoto.status, 409);
        assert.match(JSON.stringify((await absentPhoto.json()).blockers), /photo|evidence/i, "Actual apartment supply evidence is still required");
      }
      fixture.sql.prepare("INSERT INTO trade_crm_job_media (id,work_order_id,firebase_uid,file_name,content_type,size_bytes) VALUES ('apartment-supply-photo','job','owner','apartment-tap.jpg','image/jpeg',32)").run();
      fixture.sql.prepare("INSERT INTO trade_rental_evidence_links (id,inspection_id,module_id,item_id,job_media_id,firebase_uid,evidence_type,status) VALUES ('supply-photo-link','inspection','module',?,'apartment-supply-photo','owner','photo','active')").run(item.id);
      const finished = await post(route, finish);
      assert.equal(finished.status, expectedStatus, JSON.stringify(await finished.clone().json()));
      if (blocker) assert.match(JSON.stringify((await finished.json()).blockers), blocker);
      assert.equal(fixture.sql.prepare("SELECT status FROM trade_rental_inspection_modules").get().status, expectedStatus === 200 ? "complete" : "draft");
      assert.equal(fixture.sql.prepare("SELECT template_snapshot FROM trade_rental_inspection_modules").get().template_snapshot, frozen, "Observed apartment supply never rewrites the frozen standard or issued history");
      assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_crm_job_media").get().count, 1, "An inaccessible plant photo is not required to finish the supply observation");
    } finally { fixture.sql.close(); }
  }
});

test("v4 video-reviewed switchboard saves both authoritative results and completes with a photo and no mandatory extra note", async () => {
  for (const outcome of ["meets", "does_not_meet"]) {
    const fixture = databaseFixture();
    try {
      const current = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
      const section = current.sections.find((entry) => entry.key === "electrical_safety");
      assert.deepEqual(section.checks.map((check) => check.key), ["outlet_lighting_protection"]);
      const template = { ...current, metadataFields: current.metadataFields.filter((field) => ["coverageConfirmed", "assessorDeclaration"].includes(field.key)), sections: [section] };
      fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, template_version = 4, answers = ?").run(JSON.stringify(template), JSON.stringify({ rentalRegime: "ordinary_residential", coverageConfirmed: true, assessorDeclaration: true }));
      const route = loadRoute(fixture);
      const saved = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey: "electrical_safety", checkKey: "outlet_lighting_protection", outcome, response: {} });
      assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
      const item = fixture.sql.prepare("SELECT * FROM trade_rental_inspection_items WHERE check_key = 'outlet_lighting_protection'").get();
      assert.equal(item.outcome, outcome);
      assert.deepEqual(JSON.parse(item.response_json), {}, "No invented reviewer credentials or additional answers");
      assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_team_member_credentials").get().count, 0);
      if (outcome === "does_not_meet") {
        const finding = fixture.sql.prepare("SELECT title, description FROM trade_rental_findings WHERE item_id = ?").get(item.id);
        assert.deepEqual({ ...finding }, { title: section.checks[0].prompt, description: "Recorded result: Does not meet." });
      }
      assert.equal((await post(route, { action: "save_module_answers", moduleId: "module", expectedRevision: 2, answers: { coverageConfirmed: true, assessorDeclaration: true } })).status, 200);
      const finish = { action: "complete_module", moduleId: "module", expectedRevision: 3 };
      const absentPhoto = await post(route, finish);
      assert.equal(absentPhoto.status, 409);
      assert.match(JSON.stringify((await absentPhoto.json()).blockers), /photo/);
      assert.equal(fixture.sql.prepare("SELECT status FROM trade_rental_inspection_modules").get().status, "draft");
      fixture.sql.prepare("INSERT INTO trade_crm_job_media (id, work_order_id, firebase_uid, file_name, content_type, size_bytes) VALUES ('board-photo','job','owner','board.jpg','image/jpeg',32)").run();
      fixture.sql.prepare("INSERT INTO trade_rental_evidence_links (id, inspection_id, module_id, item_id, job_media_id, firebase_uid, evidence_type, status) VALUES ('board-link','inspection','module',?,'board-photo','owner','photo','active')").run(item.id);
      const completed = await post(route, finish);
      assert.equal(completed.status, 200, JSON.stringify(await completed.clone().json()));
      assert.equal(fixture.sql.prepare("SELECT status FROM trade_rental_inspection_modules").get().status, "complete");
      const events = fixture.sql.prepare("SELECT actor_uid FROM trade_rental_inspection_events").all();
      assert.ok(events.every((event) => event.actor_uid === "worker-uid"), "Existing authenticated actor provenance remains authoritative");
    } finally { fixture.sql.close(); }
  }
});

test("v4 switchboard rejects provisional answers and generic adverse observations still require their description", async () => {
  const fixture = databaseFixture();
  try {
    const current = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
    fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?").run(JSON.stringify(current));
    const route = loadRoute(fixture);
    for (const outcome of ["specialist_verification_required", "not_accessible", "not_applicable", "exemption_evidence_pending"]) {
      const result = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey: "electrical_safety", checkKey: "outlet_lighting_protection", outcome, publicNotes: "Earlier provisional answer" });
      assert.equal(result.status, 400, outcome);
    }
    const generic = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
      sectionKey: "bathroom", checkKey: "bathroom_facilities", outcome: "does_not_meet", response: {} });
    assert.equal(generic.status, 400);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_events").get().count, 0);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_findings").get().count, 0);
  } finally { fixture.sql.close(); }
});

test("corrected inactive numeric drafts do not block the actual API and valid earlier measurements remain retained", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    const base = { action: "save_item", moduleId: "module", sectionKey: "kitchen", checkKey: "cooktop_function", outcome: "meets" };
    const first = await post(route, { ...base, expectedModuleRevision: 1, expectedItemRevision: 0, response: { cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Current route inaccessible", cooktopCableRunMetres: "abc" } });
    assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
    let row = fixture.sql.prepare("SELECT * FROM trade_rental_inspection_items WHERE check_key = 'cooktop_function'").get();
    assert.deepEqual(JSON.parse(row.response_json), { cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Current route inaccessible" }, "An invalid unsaved inactive value is not a recorded measurement");
    const measured = await post(route, { ...base, expectedModuleRevision: 2, expectedItemRevision: 1, response: { cableMeasurementStatus: "Measured", cooktopCableRunMetres: "15", cableRouteBasis: "Safe roof route to appliance" } });
    assert.equal(measured.status, 200);
    const corrected = await post(route, { ...base, expectedModuleRevision: 3, expectedItemRevision: 2, response: { cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Revised route concealed", cooktopCableRunMetres: "abc", cableRouteBasis: "Earlier route" } });
    assert.equal(corrected.status, 200, JSON.stringify(await corrected.clone().json()));
    row = fixture.sql.prepare("SELECT * FROM trade_rental_inspection_items WHERE check_key = 'cooktop_function'").get();
    assert.equal(JSON.parse(row.response_json).cooktopCableRunMetres, "15", "The valid previously recorded inactive length stays available for history");
    assert.equal(JSON.parse(row.response_json).cableLimitationReason, "Revised route concealed");
    const before = ["trade_work_orders", "trade_rental_inspections", "trade_rental_inspection_modules", "trade_rental_inspection_items", "trade_rental_inspection_events"].map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all());
    const activeInvalid = await post(route, { ...base, expectedModuleRevision: 4, expectedItemRevision: 3, response: { cableMeasurementStatus: "Measured", cooktopCableRunMetres: "abc", cableRouteBasis: "Current route" } });
    assert.equal(activeInvalid.status, 400);
    assert.deepEqual(["trade_work_orders", "trade_rental_inspections", "trade_rental_inspection_modules", "trade_rental_inspection_items", "trade_rental_inspection_events"].map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all()), before);
  } finally { fixture.sql.close(); }
});

test("explicit v4 upgrade retains retired switchboard responses and photos while excluding its old question from active completion", async () => {
  const fixture = databaseFixture();
  try {
    fixture.sql.exec("UPDATE trade_rental_inspection_items SET section_key = 'electrical_safety', check_key = 'switchboard_observation', response_json = '{\"model\":\"Earlier recorded front labels\"}'");
    fixture.sql.exec("UPDATE trade_rental_inspection_modules SET answers = json_set(answers, '$.rentalRegime', 'ordinary_residential')");
    fixture.sql.exec("INSERT INTO trade_crm_job_media (id, work_order_id, firebase_uid, file_name, content_type, size_bytes) VALUES ('old-board-photo','job','owner','earlier-board.jpg','image/jpeg',32)");
    fixture.sql.exec("INSERT INTO trade_rental_evidence_links (id, inspection_id, module_id, item_id, job_media_id, firebase_uid, evidence_type, status) VALUES ('old-board-link','inspection','module','old-item','old-board-photo','owner','photo','active')");
    const before = ["trade_rental_inspection_items", "trade_rental_evidence_links", "trade_crm_job_media"].map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all());
    const changed = await post(loadRoute(fixture), { action: "set_assessment_scope", moduleId: "module", scope: "current_minimum_standards", expectedInspectionRevision: 1, expectedModuleRevision: 1 });
    assert.equal(changed.status, 200, JSON.stringify(await changed.clone().json()));
    const payload = await changed.json();
    assert.deepEqual(["trade_rental_inspection_items", "trade_rental_evidence_links", "trade_crm_job_media"].map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all()), before);
    assert.equal(payload.items.find((item) => item.checkKey === "switchboard_observation").historicalObservation, true, "Retired field answer is historical, not a current form step");
    assert.equal(payload.evidence.find((entry) => entry.itemId === "old-item").jobMediaId, "old-board-photo");
    assert.ok(payload.modules[0].template.historicalChecks.some((entry) => entry.check.key === "switchboard_observation"));
    assert.equal(payload.completion.module.blockers.some((blocker) => String(blocker.key).includes("switchboard_observation")), false);
    assert.ok(payload.completion.module.blockers.some((blocker) => String(blocker.label).includes("switchboard meet")), "The current selected review answer is still required");
  } finally { fixture.sql.close(); }
});

test("actual issued-report source retains retired switchboard photos and answers as history with frozen HomeStar opt-in", async () => {
  const fixture = databaseFixture();
  try {
    fixture.sql.exec(`CREATE TABLE trade_accounts (firebase_uid TEXT, partner_type TEXT, business_name TEXT, abn TEXT, contact_name TEXT, phone TEXT, email TEXT, document_business_name TEXT, document_phone TEXT, document_email TEXT, address_line_1 TEXT, suburb TEXT, address_state TEXT, postcode TEXT);
      INSERT INTO trade_accounts VALUES ('owner','installer','Synthetic assessment issuer','73675233557','Synthetic contact','','qa@example.invalid','','','','','','','');
      ALTER TABLE trade_team_members ADD COLUMN member_uid TEXT;
      ALTER TABLE trade_team_members ADD COLUMN email TEXT;
      ALTER TABLE trade_team_members ADD COLUMN phone TEXT;
      ALTER TABLE trade_team_members ADD COLUMN role TEXT;
      ALTER TABLE trade_team_members ADD COLUMN capabilities TEXT;
      ALTER TABLE trade_crm_job_media ADD COLUMN object_key TEXT;
      ALTER TABLE trade_crm_job_media ADD COLUMN caption TEXT;
      ALTER TABLE trade_crm_job_media ADD COLUMN original_sha256 TEXT;`);
    const current = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
    const template = templates.rentalAssessmentTemplateWithHistory({ ...current, metadataFields: [], sections: [current.sections.find((section) => section.key === "electrical_safety")] }, frozenVersionThreeTemplate());
    const answers = { homeStarCommissioned: true, rentalRegime: "ordinary_residential", assessorDeclaration: true, coverageConfirmed: true };
    const confirmedAt = "2026-10-08T01:00:00.000Z";
    const credential = await credentials.currentRentalModuleCredentialSnapshot({ db: fixture.d1, ownerUid: "owner", assessorMemberId: "worker", moduleKey: "minimum_standards", requiredCapability: "assigned_assessor", answers, confirmedAt });
    fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, answers = ?, status = 'complete', credential_snapshot = ?, completed_at = ?").run(JSON.stringify(template), JSON.stringify(answers), JSON.stringify(credential), confirmedAt);
    fixture.sql.exec("UPDATE trade_rental_inspection_items SET section_key = 'electrical_safety', check_key = 'switchboard_observation', outcome = 'meets', required_evidence_count = 1, response_json = '{\"model\":\"Earlier board labels\"}'");
    fixture.sql.exec(`INSERT INTO trade_rental_inspection_items (id,inspection_id,module_id,firebase_uid,item_key,section_key,check_key,instance_key,location_label,outcome,response_json,public_notes,internal_notes,required_evidence_count,sort_order,revision,completed_by_uid,completed_at,created_at,updated_at)
      VALUES ('current-board','inspection','module','owner','current-board','electrical_safety','outlet_lighting_protection','property','Property','meets','{}','','',1,1,1,'worker-uid','${confirmedAt}','${confirmedAt}','${confirmedAt}')`);
    const capture = { source: "in_app_camera", capture: { captureObservedAtUtc: confirmedAt, utcOffsetMinutes: 660 }, location: { state: "captured", observedAtUtc: confirmedAt, latitude: -37.8136, longitude: 144.9631, accuracyMetres: 7, mocked: false } };
    for (const [mediaId, itemId] of [["old-photo", "old-item"], ["current-photo", "current-board"]]) {
      fixture.sql.prepare("INSERT INTO trade_crm_job_media (id,work_order_id,firebase_uid,file_name,content_type,size_bytes,evidence_envelope,object_key,caption) VALUES (?,'job','owner',?,'image/jpeg',3,?,?,?)").run(mediaId, `${mediaId}.jpg`, JSON.stringify(capture), mediaId, `${mediaId} captured evidence`);
      fixture.sql.prepare("INSERT INTO trade_rental_evidence_links (id,inspection_id,module_id,item_id,job_media_id,firebase_uid,evidence_type,status,purpose,caption_snapshot) VALUES (?,'inspection','module',?,?,'owner','photo','active','Switchboard evidence','Captured board')").run(`${mediaId}-link`, itemId, mediaId);
    }
    const sourceText = fs.readFileSync(new URL("../src/lib/trade-rental-report-server.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(`${sourceText}\nexport { reportSource, buildReportSnapshot };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const bytes = new Uint8Array([1, 2, 3]);
    const dependencies = {
      "cloudflare:workers": { env: { EVIDENCE: { get: async () => ({ arrayBuffer: async () => bytes.buffer }) } } }, "../../db": { getD1: () => fixture.d1 },
      "@/lib/trade-team-server": { assignedJob: async (access, id) => fixture.sql.prepare("SELECT * FROM trade_work_orders WHERE id = ? AND firebase_uid = ?").get(id, access.ownerUid) },
      "@/lib/trade-team-sync-server": {}, "@/lib/trade-rental-assessment.mjs": templates, "@/lib/trade-issued-document-store": {}, "@/lib/trade-rental-report-links": {}, "@/lib/customer-plan-pdf-fonts": {},
      "@/lib/trade-rental-evidence.mjs": evidence, "@/lib/trade-rental-credentials": credentials, "@/lib/rental-assessor-workflow.mjs": workflow, "@/lib/rental-report-answer.mjs": answerPresentation,
      "@/lib/trade-rental-schema-guards": {}, "@/lib/rental-report-branding.mjs": branding, "@/lib/rental-quotation.mjs": quotation,
    };
    const moduleRecord = { exports: {} };
    new Function("require", "module", "exports", compiled)((id) => { assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id]; }, moduleRecord, moduleRecord.exports);
    const beforeItems = fixture.sql.prepare("SELECT * FROM trade_rental_inspection_items").all();
    const source = await moduleRecord.exports.reportSource({ ownerUid: "owner", actorUid: "worker-uid", memberId: "worker", canRunReports: true }, "job");
    assert.equal(source.items.length, 2);
    assert.equal(source.evidence.length, 2, "Actual source selection retains the retired photo before snapshot creation");
    const { snapshot, preparedObjects } = await moduleRecord.exports.buildReportSnapshot(source, { reportId: "report", reportNumber: "SYNTHETIC-REPORT", revision: 1, issuedAt: confirmedAt });
    assert.equal(snapshot.report.branding, "homestar");
    assert.equal(snapshot.business.name, "Synthetic assessment issuer");
    const retired = snapshot.modules[0].sections[0].items.find((item) => item.checkKey === "switchboard_observation");
    assert.equal(retired.historicalObservation, true);
    assert.match(retired.prompt, /^Earlier observation:/);
    assert.equal(retired.response.model, "Earlier board labels");
    assert.equal(snapshot.modules[0].sections[0].items.find((item) => item.checkKey === "outlet_lighting_protection").answerLabel, "Meets");
    assert.ok(snapshot.evidence.some((entry) => entry.itemId === retired.id));
    assert.equal(preparedObjects.length, 2);
    assert.deepEqual(fixture.sql.prepare("SELECT * FROM trade_rental_inspection_items").all(), beforeItems);
  } finally { fixture.sql.close(); }
});

test("dwelling answers need no room, window roster or location and preserve historical observations", async () => {
  const fixture = databaseFixture();
  try {
    const template = JSON.parse(fixture.sql.prepare("SELECT template_snapshot FROM trade_rental_inspection_modules").get().template_snapshot);
    template.credentialGate = "qualified_assessor";
    template.sections.forEach((section) => section.checks.forEach((check) => {
      if (check.credentialGate === "assigned_assessor") check.credentialGate = "qualified_assessor";
    }));
    fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, required_capability = 'qualified_assessor'").run(JSON.stringify(template));
    const frozen = fixture.sql.prepare("SELECT template_snapshot FROM trade_rental_inspection_modules").get().template_snapshot;
    const route = loadRoute(fixture);
    for (const [sectionKey, checkKey] of [["toilets", "toilet_function"], ["lighting", "artificial_lighting"], ["windows", "window_operation_security"], ["draughtproofing", "windows_2027_readiness"]]) {
      const revision = fixture.sql.prepare("SELECT revision FROM trade_rental_inspection_modules").get().revision;
      const response = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: revision, expectedItemRevision: 0,
        sectionKey, checkKey, instanceKey: "property", outcome: "meets", response: {} });
      assert.equal(response.status, 200, `${checkKey}: ${JSON.stringify(await response.clone().json())}`);
      const saved = (await response.json()).items.find((item) => item.checkKey === checkKey);
      assert.equal(saved.instanceKey, "property");
      assert.equal(saved.locationLabel, "Property");
    }
    assert.equal(fixture.sql.prepare("SELECT template_snapshot FROM trade_rental_inspection_modules").get().template_snapshot, frozen, "Frozen template remains available for audit");
    assert.equal(fixture.sql.prepare("SELECT public_notes FROM trade_rental_inspection_items WHERE id = 'old-item'").get().public_notes, "Existing observation");
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_items").get().count, 5);
    assert.equal((await post(loadRoute(fixture, { ownerUid: "other-owner" }), { action: "save_item", moduleId: "module", expectedModuleRevision: 5,
      sectionKey: "lighting", checkKey: "artificial_lighting", outcome: "meets" })).status, 404);
  } finally { fixture.sql.close(); }
});

test("pending earlier window answers retain their identity without requiring room setup", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    const base = { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
      sectionKey: "draughtproofing", checkKey: "windows_2027_readiness", instanceKey: "old-window", locationLabel: "Earlier front window", outcome: "meets" };
    for (const roomId of [null, {}, [], "", "a".repeat(121), "bad/id"]) {
      assert.equal((await post(route, { ...base, response: { roomId } })).status, 400);
    }
    const response = await post(route, { ...base, response: { roomId: "earlier-room" } });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const saved = (await response.json()).items.find((item) => item.instanceKey === "old-window");
    assert.equal(saved.locationLabel, "Earlier front window");
    assert.equal(saved.response.roomId, "earlier-room");
    assert.equal(saved.itemKey, templates.rentalAssessmentItemKey("minimum_standards", "draughtproofing", "windows_2027_readiness", "old-window"), "Photo queue still resolves the captured item");
  } finally { fixture.sql.close(); }
});

test("frozen v3 observations save without specialist credentials while their circuit verification stays protected", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    const assessmentModule = frozenVersionThreeTemplate();
    const checks = assessmentModule.sections.flatMap((section) => section.checks.map((check) => ({ section, check })));
    assert.deepEqual(checks.filter(({ check }) => check.credentialGate !== assessmentModule.credentialGate)
      .map(({ check }) => check.key), ["outlet_lighting_protection"]);
    for (const { section, check } of checks.filter(({ check }) => check.credentialGate === "assigned_assessor")) {
      const revision = fixture.sql.prepare("SELECT revision FROM trade_rental_inspection_modules").get().revision;
      const response = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: revision, expectedItemRevision: 0,
        sectionKey: section.key, checkKey: check.key, instanceKey: "property", locationLabel: "Observed area", outcome: "meets",
        response: { model: "Readable equipment label" }, publicNotes: "Observed safely without licensed testing" });
      assert.equal(response.status, 200, `${check.key}: ${JSON.stringify(await response.clone().json())}`);
    }
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_team_member_credentials").get().count, 0);
    const revision = fixture.sql.prepare("SELECT revision FROM trade_rental_inspection_modules").get().revision;
    const verification = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: revision, expectedItemRevision: 0,
      sectionKey: "electrical_safety", checkKey: "outlet_lighting_protection", outcome: "meets",
      response: { credentialVerified: true, credentialNumber: "CLIENT-FORGED", credentialType: "licensed_electrician" } });
    assert.equal(verification.status, 409);
    const blocked = await verification.json();
    assert.equal(blocked.code, "RENTAL_ITEM_CREDENTIAL_REQUIRED");
    assert.equal(blocked.moduleId, "module");
    assert.equal(blocked.sectionKey, "electrical_safety");
    assert.equal(blocked.checkKey, "outlet_lighting_protection");
    assert.equal(blocked.checkLabel, checks.find(({ check }) => check.key === blocked.checkKey).check.prompt);
    assert.equal(blocked.requiredCapability, "licensed_electrician");
    assert.match(blocked.error, /Specialist verification needed/);
    assert.doesNotMatch(blocked.error, /module can be completed/);
    assert.equal(fixture.sql.prepare("SELECT revision FROM trade_rental_inspection_modules").get().revision, revision);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_items WHERE check_key = 'outlet_lighting_protection'").get().count, 0);
  } finally { fixture.sql.close(); }
});

test("structured observations persist every shared field, including zero, without losing legacy notes", async () => {
  const fixture = databaseFixture();
  try {
    const responseValues = {
      ...Object.fromEntries(Object.keys(quotation.RENTAL_OBSERVATION_NUMBER_FIELDS).map((key, index) => [key, key === "joistClearWidthMm" ? "430" : key === "nonIc4DownlightCount" ? "7" : index ? "12.5" : 0])),
      ...Object.fromEntries(Object.entries(quotation.RENTAL_OBSERVATION_SELECT_OPTIONS).map(([key, options]) => [key, options[0].value])),
      applianceType: "Legacy installer description", measurement: "Earlier dimensions retained", model: "Existing model label",
      serialNumber: "SERIAL-123", actionTaken: "Observed from ground level", limitationReason: "Roof access was locked", unknownField: "discard",
    };
    const response = await post(loadRoute(fixture), { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
      sectionKey: "heating", checkKey: "heating_2027_readiness", outcome: "meets", response: responseValues });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const row = fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items WHERE check_key = 'heating_2027_readiness'").get();
    const expected = { ...responseValues }; delete expected.unknownField;
    expected[Object.keys(quotation.RENTAL_OBSERVATION_NUMBER_FIELDS)[0]] = "0";
    assert.deepEqual(JSON.parse(row.response_json), expected);
  } finally { fixture.sql.close(); }
});

test("ceiling joist gaps persist as whole millimetres at both input bounds", async () => {
  for (const joistClearWidthMm of [1, "430", "5000"]) {
    const fixture = databaseFixture();
    try {
      const values = { joistClearWidthMm, areaSquareMetres: "12.5", insulationDepthMm: 0, insulationRating: "None" };
      const response = await post(loadRoute(fixture), { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey: "ceiling_insulation", checkKey: "ceiling_2027_readiness", outcome: "does_not_meet", response: values,
        publicNotes: "No insulation is visible in the accessible ceiling area.",
        finding: { title: "Bare ceiling area", description: "No insulation is visible in the accessible ceiling area." } });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const expected = { ...values, joistClearWidthMm: String(joistClearWidthMm), insulationDepthMm: "0" };
      const row = fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items WHERE check_key = 'ceiling_2027_readiness'").get();
      assert.deepEqual(JSON.parse(row.response_json), expected);
      const payload = await response.json();
      assert.deepEqual(payload.items.find((item) => item.checkKey === "ceiling_2027_readiness").response, expected);
      assert.equal(fixture.sql.prepare("SELECT revision FROM trade_rental_inspection_modules").get().revision, 2);
    } finally { fixture.sql.close(); }
  }
});

test("ceiling observations remain valid without a joist gap and retain safe-access limitations", async () => {
  const observations = [
    { outcome: "meets", response: { insulationRating: "R5 or above" } },
    { outcome: "meets", response: { joistClearWidthMm: "", insulationRating: "R5 or above" }, expected: { insulationRating: "R5 or above" } },
    { outcome: "not_accessible", response: { limitationStatus: "Not accessible", limitationReason: "The roof access hatch was locked." } },
    { outcome: "not_accessible", response: { joistClearWidthMm: " ", limitationStatus: "Unsafe to measure", limitationReason: "Exposed wiring prevented safe roof-space access." },
      expected: { limitationStatus: "Unsafe to measure", limitationReason: "Exposed wiring prevented safe roof-space access." } },
  ];
  for (const observation of observations) {
    const fixture = databaseFixture();
    try {
      const response = await post(loadRoute(fixture), { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey: "ceiling_insulation", checkKey: "ceiling_2027_readiness", outcome: observation.outcome, response: observation.response,
        publicNotes: observation.response.limitationReason || "Insulation is present in the accessible area.",
        finding: { title: "Ceiling access limitation", description: observation.response.limitationReason || "Insulation is present in the accessible area." } });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const row = fixture.sql.prepare("SELECT outcome, response_json FROM trade_rental_inspection_items WHERE check_key = 'ceiling_2027_readiness'").get();
      assert.equal(row.outcome, observation.outcome);
      assert.deepEqual(JSON.parse(row.response_json), observation.expected || observation.response);
      assert.equal(Object.hasOwn(JSON.parse(row.response_json), "joistClearWidthMm"), false, "An unmeasured gap must not be invented");
    } finally { fixture.sql.close(); }
  }
});

test("invalid ceiling joist gaps are rejected before any assessment or job write", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    const tables = ["trade_rental_inspection_modules", "trade_rental_inspections", "trade_work_orders", "trade_rental_inspection_items", "trade_rental_findings", "trade_rental_inspection_events"];
    const before = tables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all());
    for (const joistClearWidthMm of [0, "0", -1, "-430", 430.5, "430.0", "0.5", 5001, "5001", "not measured", "430 mm", true, {}, []]) {
      const response = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey: "ceiling_insulation", checkKey: "ceiling_2027_readiness", outcome: "does_not_meet", response: { joistClearWidthMm },
        publicNotes: "No insulation is visible in the accessible ceiling area." });
      assert.equal(response.status, 400, JSON.stringify(joistClearWidthMm));
      assert.equal((await response.json()).code, "RENTAL_OBSERVATION_RESPONSE_INVALID");
      assert.deepEqual(tables.map((table) => fixture.sql.prepare(`SELECT * FROM ${table}`).all()), before, `Rejected gap ${JSON.stringify(joistClearWidthMm)} must not change records or revisions`);
    }
  } finally { fixture.sql.close(); }
});

test("invalid structured measurements and choices are rejected before saving observations", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    const numberKey = Object.keys(quotation.RENTAL_OBSERVATION_NUMBER_FIELDS)[0];
    const invalidResponses = [
      ...[-1, "-0.5", "Infinity", "NaN", "0x10", "12 mm", "9".repeat(501), {}, [], true].map((value) => ({ [numberKey]: value })),
      ...Object.keys(quotation.RENTAL_OBSERVATION_SELECT_OPTIONS).flatMap((key) => [{ [key]: "made-up-option" }, { [key]: true }]),
    ];
    for (const value of invalidResponses) {
      const response = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
        sectionKey: "heating", checkKey: "heating_2027_readiness", outcome: "meets", response: { applianceType: "Split system", heatingGemsStatus: "Label recorded", ...value } });
      assert.equal(response.status, 400, JSON.stringify(value));
      assert.equal((await response.json()).code, "RENTAL_OBSERVATION_RESPONSE_INVALID");
    }
    assert.equal(fixture.sql.prepare("SELECT revision FROM trade_rental_inspection_modules").get().revision, 1);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_items WHERE check_key = 'heating_2027_readiness'").get().count, 0);
    const empty = Object.fromEntries([...Object.keys(quotation.RENTAL_OBSERVATION_NUMBER_FIELDS), ...Object.keys(quotation.RENTAL_OBSERVATION_SELECT_OPTIONS)].map((key) => [key, ""]));
    const optional = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
      sectionKey: "heating", checkKey: "heating_2027_readiness", outcome: "meets", response: empty });
    assert.equal(optional.status, 200);
    assert.deepEqual(JSON.parse(fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items WHERE check_key = 'heating_2027_readiness'").get().response_json), {});
  } finally { fixture.sql.close(); }
});

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
    const upgraded = await post(route, { ...request, scope: "current_minimum_standards", expectedInspectionRevision: 2, expectedModuleRevision: 2 });
    assert.equal(upgraded.status, 200);
    const full = await upgraded.json();
    assert.equal(full.modules[0].template.sections.flatMap((section) => section.checks).length, 31);
    assert.equal(full.items.find((item) => item.id === "old-item").publicNotes, "Existing observation");
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) count FROM trade_rental_inspection_items").get().count, 1, "Explicit upgrade never rewrites or duplicates saved items");
    fixture.sql.exec("UPDATE trade_rental_inspections SET status = 'issued'");
    assert.equal((await post(route, { ...request, expectedInspectionRevision: 2, expectedModuleRevision: 2 })).status, 409);
    assert.equal((await post(loadRoute(fixture, { ownerUid: "other-owner" }), request)).status, 404);
  } finally { fixture.sql.close(); }
});

test("metadata patches preserve answers and historical rooms while dates and profile details are automatic", async () => {
  const fixture = databaseFixture();
  try {
    const roster = [{ id: "old-room", label: "Earlier room", type: "bedroom" }];
    fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET answers = ?").run(JSON.stringify({ roomRoster: roster, dwellingClass: "house", occupancyAtAssessment: "vacant", coverageConfirmed: false }));
    fixture.sql.exec("UPDATE trade_rental_inspection_items SET created_at = '2026-09-08T15:30:00Z'");
    const route = loadRoute(fixture);
    const body = { action: "save_module_answers", moduleId: "module", expectedRevision: 1,
      answers: { agreementStartDate: "2026-01-01", inspectionDate: "2099-01-01", assessorName: "Forged name", qualificationNumber: "FAKE", roomRoster: [] } };
    const saved = await post(route, body);
    assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
    let answers = (await saved.json()).modules[0].answers;
    assert.equal(answers.inspectionDate, "2026-09-09", "Australian assessment date comes from its first recorded observation");
    assert.equal(answers.assessorName, "Alex Installer");
    assert.equal(answers.qualificationNumber, "");
    assert.equal(answers.dwellingClass, "house");
    assert.equal(answers.occupancyAtAssessment, "vacant");
    assert.equal(answers.agreementStartDate, "2026-01-01");
    assert.deepEqual(answers.roomRoster, roster, "Retired roster stays in history but cannot be edited by new workflow");
    assert.equal((await post(route, body)).status, 409);
    const changed = await post(route, { ...body, expectedRevision: 2, answers: { weatherConditions: "Dry" } });
    assert.equal(changed.status, 200);
    answers = JSON.parse(fixture.sql.prepare("SELECT answers FROM trade_rental_inspection_modules").get().answers);
    assert.equal(answers.inspectionDate, "2026-09-09");
    assert.equal(answers.agreementStartDate, "2026-01-01");
    assert.equal(answers.weatherConditions, "Dry");
    fixture.sql.exec("UPDATE trade_rental_inspections SET status = 'issued'");
    assert.equal((await post(route, { ...body, expectedRevision: 3 })).status, 409);
    assert.equal((await post(loadRoute(fixture, { ownerUid: "other-owner" }), body)).status, 404);
  } finally { fixture.sql.close(); }
});

test("older qualified-assessor forms use Team profile details and retain an honest empty qualification", async () => {
  const fixture = databaseFixture();
  try {
    const input = { db: fixture.d1, ownerUid: "owner", assessorMemberId: "worker", moduleKey: "minimum_standards", requiredCapability: "qualified_assessor",
      answers: { assessorDeclaration: true, qualificationType: "Forged", qualificationNumber: "FAKE" }, confirmedAt: "2026-09-09T00:00:00Z" };
    const empty = await credentials.currentRentalModuleCredentialSnapshot(input);
    assert.equal(empty.verificationBasis, "assigned_team_profile");
    assert.equal(empty.gate, "assigned_assessor");
    assert.equal(empty.credentialNumber, "");
    fixture.sql.exec(`INSERT INTO trade_team_member_credentials VALUES ('credential','owner','worker','training','Property assessor','ASSESS-42',
      '', 'active','VIC','','2026-09-07','');`);
    const current = await credentials.currentRentalModuleCredentialSnapshot(input);
    assert.equal(current.credentialNumber, "ASSESS-42");
    assert.equal(current.credentialName, "Property assessor");
    assert.equal(current.assessorName, "Alex Installer");
    const checked = await credentials.assertRentalModuleCredentialCurrent({ ...input, storedSnapshot: current, completedAt: input.confirmedAt, checkedAt: input.confirmedAt });
    assert.deepEqual(checked, current);
    fixture.sql.exec("UPDATE trade_team_member_credentials SET status = 'archived'");
    await assert.rejects(() => credentials.assertRentalModuleCredentialCurrent({ ...input, storedSnapshot: current, completedAt: input.confirmedAt, checkedAt: input.confirmedAt }), /CREDENTIAL_CHANGED/);
    await assert.rejects(() => credentials.currentRentalModuleCredentialSnapshot({ ...input, answers: {} }), /CREDENTIAL_REQUIRED/);
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

test("an older dwelling module completes with its automatic date and Team identity without rooms or manual qualifications", async () => {
  const fixture = databaseFixture();
  try {
    const full = templates.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
    const toilets = full.sections.find((section) => section.key === "toilets");
    const frozen = { ...full, credentialGate: "qualified_assessor", sections: [{ ...toilets,
      checks: toilets.checks.map((check) => ({ ...check, repeatBy: "room", credentialGate: "qualified_assessor" })) }],
      metadataFields: [
        { key: "inspectionDate", type: "date", required: true },
        { key: "qualificationType", type: "text", required: true },
        { key: "qualificationNumber", type: "text", required: true },
        { key: "credentialConfirmed", type: "checkbox", required: true },
        { key: "coverageConfirmed", type: "checkbox", required: true },
        { key: "assessorDeclaration", type: "checkbox", required: true },
      ] };
    fixture.sql.prepare("UPDATE trade_rental_inspection_modules SET template_snapshot = ?, required_capability = 'qualified_assessor', answers = '{}'").run(JSON.stringify(frozen));
    fixture.sql.exec("DELETE FROM trade_rental_inspection_items");
    const route = loadRoute(fixture);
    const observed = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
      sectionKey: "toilets", checkKey: "toilet_function", instanceKey: "property", outcome: "meets", response: {} });
    assert.equal(observed.status, 200, JSON.stringify(await observed.clone().json()));
    const started = JSON.parse(fixture.sql.prepare("SELECT answers FROM trade_rental_inspection_modules").get().answers).inspectionDate;
    assert.match(started, /^\d{4}-\d{2}-\d{2}$/);
    const declared = await post(route, { action: "save_module_answers", moduleId: "module", expectedRevision: 2,
      answers: { coverageConfirmed: true, assessorDeclaration: true } });
    assert.equal(declared.status, 200, JSON.stringify(await declared.clone().json()));
    const completed = await post(route, { action: "complete_module", moduleId: "module", expectedRevision: 3 });
    assert.equal(completed.status, 200, JSON.stringify(await completed.clone().json()));
    const saved = fixture.sql.prepare("SELECT status,answers,credential_snapshot,template_snapshot FROM trade_rental_inspection_modules").get();
    const answers = JSON.parse(saved.answers);
    assert.equal(saved.status, "complete");
    assert.equal(answers.assessorName, "Alex Installer");
    assert.equal(answers.inspectionDate, started);
    assert.equal(answers.qualificationNumber, "");
    assert.equal(answers.roomRoster, undefined);
    assert.equal(JSON.parse(saved.credential_snapshot).verificationBasis, "assigned_team_profile");
    assert.equal(JSON.parse(saved.template_snapshot).credentialGate, "qualified_assessor", "Original frozen template remains unchanged");
  } finally { fixture.sql.close(); }
});

test("assessment API saves an electrical observation without trade scope and preserves its unresolved result", async () => {
  const fixture = databaseFixture();
  try {
    const route = loadRoute(fixture);
    const response = await post(route, { action: "save_item", moduleId: "module", expectedModuleRevision: 1, expectedItemRevision: 0,
      sectionKey: "electrical_safety", checkKey: "outlet_lighting_protection", instanceKey: "property", outcome: "specialist_verification_required",
      response: {}, finding: { title: "Electrical observation", description: "Hallway board photographed. Protection needs an electrician to check." } });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const saved = fixture.sql.prepare("SELECT description, scope_summary, quantity_milli, finding_status FROM trade_rental_findings").get();
    assert.equal(saved.description, "Hallway board photographed. Protection needs an electrician to check.");
    assert.equal(saved.scope_summary, "");
    assert.equal(saved.quantity_milli, 0);
    assert.equal(saved.finding_status, "not_tested");
    const payload = await response.json();
    assert.equal(payload.completion.module.complete, false, "Saving an observation does not bypass remaining checks or photo evidence");
    const item = fixture.sql.prepare("SELECT outcome, response_json FROM trade_rental_inspection_items WHERE check_key = 'outlet_lighting_protection'").get();
    assert.equal(item.outcome, "specialist_verification_required");
    assert.equal(JSON.parse(item.response_json).credentialVerified, undefined);
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
    for (const [table, field, invalid, valid] of [
      ["trade_team_member_credentials", "expires_at", "2020-01-01", "2099-12-31"],
      ["trade_team_member_files", "status", "archived", "active"],
      ["trade_team_member_credentials", "team_member_id", "other-worker", "worker"],
    ]) {
      fixture.sql.prepare(`UPDATE ${table} SET ${field} = ?`).run(invalid);
      assert.equal((await post(route, input)).status, 409, `${table}.${field}`);
      fixture.sql.prepare(`UPDATE ${table} SET ${field} = ?`).run(valid);
    }
    const response = await post(route, input);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const saved = JSON.parse(fixture.sql.prepare("SELECT response_json FROM trade_rental_inspection_items WHERE check_key = 'outlet_lighting_protection'").get().response_json);
    assert.equal(saved.credentialNumber, "LIC-VERIFIED");
    assert.equal(saved.credentialVerified, true);
    assert.equal(saved.credentialType, "licensed_electrician");
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

function reportIssuanceFixture() {
  const fixture = databaseFixture();
  fixture.sql.exec(`CREATE TABLE trade_rental_reports (
    id TEXT, inspection_id TEXT, firebase_uid TEXT, report_number TEXT, revision INTEGER, status TEXT,
    report_snapshot TEXT, pdf_object_key TEXT, pdf_sha256 TEXT, pdf_size_bytes INTEGER, issuer_snapshot TEXT,
    issued_at TEXT, updated_at TEXT);
    CREATE TABLE trade_rental_report_links (id TEXT,report_id TEXT,inspection_id TEXT,firebase_uid TEXT,
    status TEXT,expires_at TEXT,view_count INTEGER,download_count INTEGER,token_issue INTEGER,
    token_hash TEXT,encrypted_token TEXT,created_at TEXT);
    UPDATE trade_rental_inspections SET status='issuing';`);
  fixture.sql.prepare(`INSERT INTO trade_rental_reports VALUES
    ('report','inspection','owner','RMS-TEST-R1',1,'staged','{}','','',0,'{}','',?)`).run(new Date().toISOString());
  const access = { ownerUid: 'owner', actorUid: 'worker-uid', memberId: 'worker', canRunReports: true };
  const source = fs.readFileSync(new URL('../src/lib/trade-rental-report-server.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(`${source}\nexport { recoverStaleRentalIssuance };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    'cloudflare:workers': { env: {} }, '../../db': { getD1: () => fixture.d1 },
    '@/lib/trade-team-server': { assignedJob: async (caller, id) => {
      const job = fixture.sql.prepare('SELECT * FROM trade_work_orders WHERE id=? AND firebase_uid=?').get(id,caller.ownerUid);
      if (!job) throw new Error('JOB_NOT_FOUND'); return job;
    } },
    '@/lib/trade-rental-schema-guards': { ensureTradeRentalSchemaGuards: async () => {} },
  };
  const moduleRecord = { exports: {} };
  new Function('require','module','exports',compiled)((id) => dependencies[id] || {}, moduleRecord,moduleRecord.exports);
  const markIssued = () => fixture.sql.exec(`UPDATE trade_rental_inspections SET status='issued',issued_report_id='report';
    UPDATE trade_rental_reports SET status='issued',issued_at='2026-09-10T01:00:00Z';`);
  return { ...fixture, server: moduleRecord.exports, access, markIssued,
    issue: () => moduleRecord.exports.issueRentalAssessmentReport({ access, workOrderId:'job',origin:'https://test.example' }) };
}

test('active report generation returns transient503 and keeps editing locked', async () => {
  const f = reportIssuanceFixture();
  try {
    const route = loadRoute(f, {}, f.server);
    const response = await post(route, { action:'issue_report' });
    assert.equal(response.status,503);
    assert.equal((await response.json()).code,'RENTAL_REPORT_ISSUING');
    assert.equal(f.sql.prepare('SELECT status FROM trade_rental_reports').get().status,'staged');
    assert.equal((await post(route,{ action:'save_module_answers',moduleId:'module',expectedRevision:1,answers:{} })).status,409);
  } finally { f.sql.close(); }
});

test('report retry returns the already issued report without issuing or renewing any links', async () => {
  const f = reportIssuanceFixture();
  try {
    f.markIssued();
    const route = loadRoute(f, {}, f.server);
    for (let attempt=0;attempt<2;attempt++) {
      const response = await post(route,{action:'issue_report'});
      assert.equal(response.status,200);
      assert.equal((await response.json()).issuedReport.reportId,'report');
    }
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_rental_reports').get().count,1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_rental_report_links').get().count,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_rental_inspection_events').get().count,0);
  } finally { f.sql.close(); }
});

test('report completing during a retry returns its current issued identity', async () => {
  const f = reportIssuanceFixture();
  try {
    const originalPrepare = f.d1.prepare;
    let inspectionReads=0;
    f.d1.prepare = (query) => {
      const statement = originalPrepare(query);
      if (!query.includes('SELECT * FROM trade_rental_inspections')) return statement;
      return { ...statement, bind(...values) {
        const bound=statement.bind(...values);
        return { ...bound, async first() {
          const row=await bound.first();
          if (++inspectionReads===2) f.markIssued();
          return row;
        } };
      } };
    };
    const result = await f.issue();
    assert.equal(result.reportId,'report');
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_rental_reports').get().count,1);
  } finally { f.sql.close(); }
});

test('idempotent report retries still reject missing permission, wrong owner and unassigned assessor', async () => {
  for (const change of [{canRunReports:false},{ownerUid:'another-owner'},{memberId:'another-worker'}]) {
    const f=reportIssuanceFixture();
    try {
      f.markIssued();Object.assign(f.access,change);
      await assert.rejects(f.issue,/REPORT_PERMISSION_REQUIRED|JOB_NOT_FOUND|ASSESSOR_REQUIRED/);
      assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_rental_reports').get().count,1);
    } finally { f.sql.close(); }
  }
});

test('stale recovery leaves active generation alone and releases only stages older than15minutes', async () => {
  const f=reportIssuanceFixture();
  try {
    await f.server.recoverStaleRentalIssuance('owner','job');
    assert.equal(f.sql.prepare('SELECT status FROM trade_rental_inspections').get().status,'issuing');
    f.sql.prepare('UPDATE trade_rental_reports SET updated_at=?').run(new Date(Date.now()-16*60*1000).toISOString());
    await f.server.recoverStaleRentalIssuance('owner','job');
    assert.equal(f.sql.prepare('SELECT status FROM trade_rental_inspections').get().status,'in_progress');
    const report=f.sql.prepare('SELECT status,issuer_snapshot FROM trade_rental_reports').get();
    assert.equal(report.status,'failed');
    assert.ok(JSON.parse(report.issuer_snapshot).cleanupCompletedAt);
  } finally { f.sql.close(); }
});
