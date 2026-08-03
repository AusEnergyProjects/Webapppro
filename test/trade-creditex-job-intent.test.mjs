import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), "utf8");
const intentHelperSource = stripTypeScriptTypes(
  read("../src/lib/trade-compliance-intent.ts").replace(
    '"./australian-government-program-catalogue"',
    JSON.stringify(
      pathToFileURL(
        path.join(
          here,
          "../src/lib/australian-government-program-catalogue.ts",
        ),
      ).href,
    ),
  ),
  { mode: "strip" },
);
const {
  CREDITEX_PARTNER_ORGANISATION_CODE,
  resolveTradeComplianceIntent,
  stableTradeComplianceIntentJson,
  TRADE_COMPLIANCE_INTENT_CONTRACT,
  TradeComplianceIntentError,
} = await import(
  `data:text/javascript;base64,${Buffer.from(intentHelperSource).toString("base64")}`
);
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const complianceRoute = read("../src/app/api/trade-compliance/route.ts");
const creditexQueueRoute = read("../src/app/api/creditex/job-intents/route.ts");
const creditexQueueUi = read(
  "../src/components/CreditexPlannedIntakeQueue.tsx",
);
const creditexAuditRoute = read(
  "../src/app/api/creditex/job-intents/[intentId]/route.ts",
);
const migration = read("../drizzle/0115_trade_creditex_job_intent.sql");
const crmWriteGuardMigration = read(
  "../drizzle/0116_trade_crm_write_guard.sql",
);
const schema = read("../db/schema.ts");
const migrationDirectory = new URL("../drizzle/", import.meta.url);
const completeMigrationChain = fs.readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const INTENT_GUARD_NAMES = [
  "trade_compliance_intent_update_guard",
  "trade_compliance_intent_delete_guard",
];

const NOW = "2026-08-03T00:00:00.000Z";
const LATER = "2026-08-03T00:01:00.000Z";
const PLANNED_START = "2026-08-10T09:00:00.000Z";
const AUSTRALIAN_STATES = [
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
];

function program(programCode) {
  const item = GOVERNMENT_PROGRAM_TEMPLATES.find(
    (candidate) => candidate.programCode === programCode,
  );
  assert.ok(item, `Missing program template ${programCode}`);
  return item;
}

function activity(programCode, registryActivityCode) {
  const item = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (candidate) =>
      candidate.programCode === programCode
      && candidate.registryActivityCode === registryActivityCode,
  );
  assert.ok(
    item,
    `Missing activity template ${programCode}/${registryActivityCode}`,
  );
  return item;
}

function resolve({
  programCode,
  registryActivityCode,
  siteJurisdiction,
  plannedStart = PLANNED_START,
}) {
  return resolveTradeComplianceIntent({
    mode: "planned",
    programTemplateId: program(programCode).templateId,
    activityTemplateId: activity(
      programCode,
      registryActivityCode,
    ).templateId,
    siteJurisdiction,
    plannedStart,
  });
}

function assertIntentError(action, expectedCode) {
  assert.throws(
    action,
    (error) =>
      error instanceof TradeComplianceIntentError
      && error.code === expectedCode,
  );
}

function applyCompleteMigrationChain(database) {
  assert.equal(completeMigrationChain.length, 119);
  assert.match(completeMigrationChain[0], /^0000_/);
  assert.match(completeMigrationChain.at(-1), /^0118_/);
  for (const name of completeMigrationChain) {
    const migrationSource = fs.readFileSync(
      new URL(name, migrationDirectory),
      "utf8",
    );
    for (const statement of migrationSource
      .split("--> statement-breakpoint")
      .map((item) => item.trim())
      .filter(Boolean)) {
      try {
        database.exec(statement);
      } catch (error) {
        const ftsDefinition = statement.match(
          /^CREATE VIRTUAL TABLE ([a-z_]+) USING fts5\((.*)\);?$/is,
        );
        if (
          !(error instanceof Error)
          || !error.message.includes("no such module: fts5")
          || !ftsDefinition
        ) {
          throw error;
        }
        const columns = ftsDefinition[2]
          .split(",")
          .map((definition) => definition.trim())
          .filter((definition) => !definition.startsWith("tokenize="))
          .map((definition) => `${definition.split(/\s+/)[0]} text`);
        database.exec(
          `CREATE TABLE ${ftsDefinition[1]} (${columns.join(", ")})`,
        );
      }
    }
  }
}

function routeTemplate(name) {
  const match = creditexQueueRoute.match(
    new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`),
  );
  assert.ok(match, `Missing ${name} SQL template`);
  return match[1];
}

test("SRES is nationally compatible while VEU and NSW ESS remain state-bound", () => {
  for (const siteJurisdiction of AUSTRALIAN_STATES) {
    const resolved = resolve({
      programCode: "SRES",
      registryActivityCode: "PV",
      siteJurisdiction,
    });
    assert.equal(resolved?.snapshot.siteJurisdiction, siteJurisdiction);
    assert.equal(resolved?.program.jurisdiction, "AU");
  }

  assert.equal(
    resolve({
      programCode: "VEU",
      registryActivityCode: "1",
      siteJurisdiction: "VIC",
    })?.program.jurisdiction,
    "VIC",
  );
  assert.equal(
    resolve({
      programCode: "NSW-ESS",
      registryActivityCode: "C1",
      siteJurisdiction: "NSW",
    })?.program.jurisdiction,
    "NSW",
  );

  assertIntentError(
    () =>
      resolve({
        programCode: "VEU",
        registryActivityCode: "1",
        siteJurisdiction: "NSW",
      }),
    "PROGRAM_JURISDICTION_MISMATCH",
  );
  assertIntentError(
    () =>
        resolve({
          programCode: "NSW-ESS",
          registryActivityCode: "C1",
          siteJurisdiction: "VIC",
        }),
    "PROGRAM_JURISDICTION_MISMATCH",
  );
});

test("planning resolution requires an exact controlled program and activity pair", () => {
  assertIntentError(
    () =>
      resolveTradeComplianceIntent({
        mode: "planned",
        programTemplateId: program("SRES").templateId,
        activityTemplateId: activity("VEU", "1").templateId,
        siteJurisdiction: "VIC",
        plannedStart: PLANNED_START,
      }),
    "GOVERNMENT_ACTIVITY_NOT_FOUND",
  );

  assertIntentError(
    () =>
      resolveTradeComplianceIntent({
        mode: "planned",
        programTemplateId: "SRES",
        activityTemplateId: "PV",
        siteJurisdiction: "VIC",
        plannedStart: PLANNED_START,
      }),
    "GOVERNMENT_PROGRAM_NOT_FOUND",
  );
  assertIntentError(
    () =>
      resolveTradeComplianceIntent({
        mode: "planned",
        programTemplateId: program("SRES").templateId,
        activityTemplateId: "PV",
        siteJurisdiction: "VIC",
        plannedStart: PLANNED_START,
      }),
    "GOVERNMENT_ACTIVITY_NOT_FOUND",
  );
  assertIntentError(
    () =>
      resolveTradeComplianceIntent({
        mode: "free-text-program",
        programTemplateId: program("SRES").templateId,
        activityTemplateId: activity("SRES", "PV").templateId,
        siteJurisdiction: "VIC",
        plannedStart: PLANNED_START,
      }),
    "COMPLIANCE_INTENT_INVALID",
  );
});

test("future, closed and specialist catalogue activities fail closed", () => {
  assertIntentError(
    () =>
      resolve({
        programCode: "NSW-ESS",
        registryActivityCode: "D6",
        siteJurisdiction: "NSW",
      }),
    "ACTIVITY_NOT_COMMENCED",
  );
  assertIntentError(
    () =>
      resolve({
        programCode: "VEU",
        registryActivityCode: "45",
        siteJurisdiction: "VIC",
      }),
    "ACTIVITY_CLOSED",
  );
  assertIntentError(
    () =>
      resolve({
        programCode: "VEU",
        registryActivityCode: "PBA-MV",
        siteJurisdiction: "VIC",
      }),
    "SPECIALIST_WORKFLOW_REQUIRED",
  );
});

test("planned intent snapshot is deterministic and remains setup-required", () => {
  const resolved = resolve({
    programCode: "SRES",
    registryActivityCode: "PV",
    siteJurisdiction: "VIC",
  });
  assert.ok(resolved);

  const expected = {
    contract: "tlink-creditex-job-intent-v1",
    catalogueReviewedOn: "2026-08-01",
    plannedStart: PLANNED_START,
    siteJurisdiction: "VIC",
    program: {
      templateId: "au-sres",
      programCode: "SRES",
      name: "Small-scale Renewable Energy Scheme",
      jurisdiction: "AU",
      outcomeClass: "tradable_certificate",
      claimOutputCode: "STC",
      claimOutputLabel: "Small-scale technology certificates (STCs)",
      administeringBody: "Clean Energy Regulator",
      officialSourceUrl:
        "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/create-small-scale-technology-certificates",
      officialSourceTitle: "Create small-scale technology certificates",
      catalogueState: "current",
      operatingNote:
        "STCs are created through the REC Registry by an eligible owner or registered agent. Product lists, deeming periods and evidence requirements are dynamic.",
    },
    activity: {
      templateId: "sres-pv",
      activityKey: "pv",
      registryActivityCode: "PV",
      title: "Small-scale solar PV system",
      serviceCategory: "solar",
      specificationPart: "",
      productCategory: "Small-scale solar PV system",
      scenarioCode: "",
      scenario: "No separate government scenario code",
      catalogueState: "current",
    },
    governance: {
      state: "setup_required",
      message:
        "Creditex intake starts with the job. TLink must resolve the exact published government rule and evidence policy before a regulated case opens.",
    },
  };
  assert.equal(
    TRADE_COMPLIANCE_INTENT_CONTRACT,
    "tlink-creditex-job-intent-v1",
  );
  assert.deepEqual(resolved.snapshot, expected);
  assert.equal(
    stableTradeComplianceIntentJson(resolved.snapshot),
    JSON.stringify(expected),
  );
});

test("new work order and controlled intent share one atomic batch after enquiry ownership checks", () => {
  assert.match(
    crmRoute,
    /FROM trade_crm_enquiries[\s\S]*WHERE id = \? AND firebase_uid = \? AND protected_source = 0/,
  );
  assert.match(
    crmRoute,
    /enquiryCustomerId !== customerId[\s\S]*enquiryServiceSiteId !== serviceSiteId[\s\S]*!sourceEnquirySiteAdopted/,
  );
  assert.match(
    crmRoute,
    /UPDATE trade_crm_enquiries[\s\S]*SET service_site_id = \?, updated_at = \?[\s\S]*service_site_id = '' AND protected_source = 0/,
  );
  assert.match(
    crmRoute,
    /INSERT INTO trade_crm_write_guards[\s\S]*CASE WHEN changes\(\) = 1 THEN 1 ELSE 0 END/,
  );

  const batchStart = crmRoute.indexOf(
    "const batchStatements: D1PreparedStatement[] = [",
  );
  const workOrderInsert = crmRoute.indexOf(
    "INSERT INTO trade_work_orders",
    batchStart,
  );
  const intentInsert = crmRoute.indexOf(
    "INSERT INTO trade_work_order_compliance_intents",
    workOrderInsert,
  );
  const batchExecution = crmRoute.indexOf(
    "await db.batch(batchStatements)",
    intentInsert,
  );
  assert.ok(batchStart >= 0, "Missing creation batch");
  assert.ok(workOrderInsert > batchStart, "Work order is outside creation batch");
  assert.ok(intentInsert > workOrderInsert, "Intent is outside creation batch");
  assert.ok(
    batchExecution > intentInsert,
    "Work order and intent are not committed by one D1 batch",
  );
});

test("converted-enquiry site adoption has a transactional write guard", () => {
  assert.doesNotMatch(crmWriteGuardMigration, /CREATE\s+TRIGGER/i);
  const database = new DatabaseSync(":memory:");
  database.exec(crmWriteGuardMigration);
  database.exec("CREATE TABLE source_record (id text PRIMARY KEY, value text NOT NULL);");
  database.prepare("INSERT INTO source_record (id, value) VALUES ('source-1', '')").run();

  database.exec("BEGIN");
  try {
    database.prepare("UPDATE source_record SET value = 'site-1' WHERE id = 'missing'").run();
    assert.throws(
      () => database.prepare(`INSERT INTO trade_crm_write_guards (
          id, firebase_uid, operation_id, step_number, verified, created_at
        ) VALUES ('guard-failed', 'installer-1', 'operation-failed', 1,
          CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?)`)
        .run(NOW),
      /trade_crm_write_guard_verified_check|CHECK constraint failed/,
    );
  } finally {
    database.exec("ROLLBACK");
  }

  database.exec("BEGIN");
  database.prepare("UPDATE source_record SET value = 'site-1' WHERE id = 'source-1'").run();
  database.prepare(`INSERT INTO trade_crm_write_guards (
      id, firebase_uid, operation_id, step_number, verified, created_at
    ) VALUES ('guard-passed', 'installer-1', 'operation-passed', 1,
      CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?)`)
    .run(NOW);
  database.exec("COMMIT");
  assert.equal(
    database.prepare("SELECT verified FROM trade_crm_write_guards").get().verified,
    1,
  );
});

test("planned work is assigned fail-closed to the active Creditex partner", () => {
  assert.equal(CREDITEX_PARTNER_ORGANISATION_CODE, "CREDITEX-AU");
  assert.match(
    crmRoute,
    /WHERE organisation_code = \? AND status = 'active' LIMIT 1/,
  );
  assert.match(
    crmRoute,
    /\.bind\(CREDITEX_PARTNER_ORGANISATION_CODE\)/,
  );
  assert.match(
    crmRoute,
    /if \(complianceIntent && !creditexOrganisation(?:\?\.id)?\)/,
  );
  assert.doesNotMatch(
    crmRoute,
    /creditexOrganisation\?\.id \|\| ""/,
  );
  assert.match(
    creditexQueueRoute,
    /access\.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE/,
  );
  assert.match(
    creditexQueueRoute,
    /WHERE intent\.compliance_organisation_id = \?/,
  );
  assert.match(
    complianceRoute,
    /WHERE organisation_code = \? AND status = 'active'[\s\S]*\.bind\(CREDITEX_PARTNER_ORGANISATION_CODE\)/,
  );
  assert.match(
    complianceRoute,
    /organisationCode: creditexOrganisation\.code/,
  );
  assert.match(
    complianceRoute,
    /expectedOrganisation: creditexOrganisation/,
  );
  assert.match(
    complianceRoute,
    /active_case\.organisation_id = \?/,
  );
});

test("Creditex register retains every assigned status and opens an audited full job workspace", () => {
  assert.match(creditexQueueUi, /const auditLauncherRef = useRef<HTMLButtonElement \| null>\(null\)/);
  assert.match(
    creditexQueueUi,
    /onClick=\{\(event\) => void openAudit\(item, event\.currentTarget\)\}/,
  );
  assert.match(creditexQueueUi, /aria-controls="creditex-full-audit-workspace"/);
  assert.match(
    creditexQueueUi,
    /const launcher = auditLauncherRef\.current;[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*launcher\?\.isConnected[\s\S]*launcher\.focus\(\)/,
  );
  assert.match(creditexQueueRoute, /"Cache-Control": "private, no-store"/);
  assert.match(creditexQueueRoute, /const PAGE_SIZE = 75/);
  assert.match(creditexQueueRoute, /count\(\*\) total/);
  assert.match(creditexQueueRoute, /totalPages/);
  assert.match(creditexQueueRoute, /value === "superseded"/);
  assert.match(creditexQueueRoute, /installerBusiness:/);
  assert.match(creditexQueueRoute, /jobNumber:/);
  assert.match(creditexQueueRoute, /activityTitle:/);
  assert.match(creditexQueueRoute, /claimOutputCode:/);
  assert.match(
    creditexQueueRoute,
    /access\.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE/,
  );
  assert.match(
    creditexQueueRoute,
    /WHERE intent\.compliance_organisation_id = \?/,
  );
  assert.match(
    creditexQueueRoute,
    /LEFT JOIN trade_crm_job_details details[\s\S]*details\.firebase_uid = work\.firebase_uid[\s\S]*details\.customer_source = 'trade_owned'/,
  );
  assert.match(
    creditexQueueRoute,
    /LEFT JOIN trade_crm_customers customer[\s\S]*customer\.firebase_uid = work\.firebase_uid/,
  );
  assert.match(
    creditexQueueRoute,
    /LEFT JOIN trade_crm_service_sites site[\s\S]*site\.firebase_uid = work\.firebase_uid[\s\S]*site\.customer_id = customer\.id/,
  );
  assert.match(
    creditexQueueRoute,
    /customerName,[\s\S]*customerEmail:[\s\S]*customerPhone:[\s\S]*serviceAddress:/,
  );
  assert.doesNotMatch(
    creditexQueueRoute,
    /\binstallerUid:|\bfirebaseUid:|intentSnapshot:|intent_snapshot:\s*String/,
  );
  assert.match(
    creditexAuditRoute,
    /WHERE id = \? AND compliance_organisation_id = \?/,
  );
  assert.match(creditexAuditRoute, /trade_crm_job_media/);
  assert.match(creditexAuditRoute, /trade_crm_quote_versions/);
  assert.match(creditexAuditRoute, /trade_crm_quick_invoice_revisions/);
  assert.match(creditexAuditRoute, /compliance_case_evidence/);
  assert.match(creditexAuditRoute, /INSERT INTO compliance_audit_events/);
  assert.match(creditexAuditRoute, /'job\.private_details_viewed'/);
  assert.match(creditexAuditRoute, /"encrypted_token"/);
  assert.match(creditexAuditRoute, /"object_key"/);
  assert.match(creditexAuditRoute, /"idempotency_key"/);
  assert.match(creditexAuditRoute, /PRIVATE_GROUP_FIELDS/);
  assert.match(creditexAuditRoute, /field\.endsWith\("_uid"\)/);
  assert.match(creditexAuditRoute, /CREDITEX_JOB_GRAPH_INCOMPLETE/);
  assert.match(creditexAuditRoute, /CREDITEX_JOB_GRAPH_MISMATCH/);
  assert.match(
    creditexAuditRoute,
    /const enquiryIdsSql = `SELECT id FROM trade_crm_enquiries[\s\S]*AND id = \?[\s\S]*AND customer_id = \?[\s\S]*AND service_site_id = \?`/,
  );
  assert.doesNotMatch(
    creditexAuditRoute,
    /customer_id = \?[\s\S]{0,100}\(\? = '' OR service_site_id = \?\)/,
  );
  assert.match(
    creditexAuditRoute,
    /!privateServerField\(field, groupKey\)/,
  );
});

test("Creditex planned-intake queue SQL executes against the complete migration schema", () => {
  const database = new DatabaseSync(":memory:");
  applyCompleteMigrationChain(database);
  const selectMatch = creditexQueueRoute.match(
    /const rows = await database\.prepare\(`([\s\S]*?)`\)\s*\.bind\(/,
  );
  assert.ok(selectMatch, "Missing planned-intake register query");
  const query = selectMatch[1]
    .replace("${QUEUE_JOINS}", routeTemplate("QUEUE_JOINS"))
    .replace("${QUEUE_WHERE}", routeTemplate("QUEUE_WHERE"));
  assert.doesNotMatch(query, /\$\{/);
  const bindings = [
    "creditex-org",
    "all",
    "all",
    "",
    ...Array.from({ length: 15 }, () => "%"),
    75,
    0,
  ];
  assert.equal(
    (query.match(/\?/g) || []).length,
    bindings.length,
    "Queue bindings must stay aligned with the executable query",
  );
  assert.deepEqual(database.prepare(query).all(...bindings), []);
});

test("governed case creation links only the matching planned intent and supersedes a mismatch", () => {
  assert.match(
    complianceRoute,
    /prepared\.activitySnapshot\.programCode/,
  );
  assert.match(
    complianceRoute,
    /prepared\.activitySnapshot\.registryActivityCode/,
  );
  assert.match(
    complianceRoute,
    /prepared\.activitySnapshot\.activityKey/,
  );
  assert.match(
    complianceRoute,
    /UPDATE trade_work_order_compliance_intents[\s\S]*SET status = 'case_linked', compliance_case_id = \?, updated_at = \?[\s\S]*WHERE compliance_organisation_id = \?[\s\S]*work_order_id = \? AND installer_uid = \? AND status = 'planned'[\s\S]*program_code = \?[\s\S]*registry_activity_code = \?[\s\S]*json_extract\(intent_snapshot, '\$\.activity\.activityKey'\) = \?[\s\S]*service_category = \?[\s\S]*site_jurisdiction = \?[\s\S]*substr\(planned_start, 1, 10\) = \?/,
  );
  assert.match(
    complianceRoute,
    /UPDATE trade_work_order_compliance_intents[\s\S]*SET status = 'superseded', compliance_case_id = '', updated_at = \?[\s\S]*WHERE compliance_organisation_id = \?[\s\S]*work_order_id = \? AND installer_uid = \? AND status = 'planned'[\s\S]*AND NOT \([\s\S]*program_code = \?[\s\S]*registry_activity_code = \?[\s\S]*json_extract\(intent_snapshot, '\$\.activity\.activityKey'\) = \?[\s\S]*service_category = \?[\s\S]*site_jurisdiction = \?[\s\S]*substr\(planned_start, 1, 10\) = \?/,
  );

  const linkUpdate = complianceRoute.indexOf(
    "UPDATE trade_work_order_compliance_intents",
  );
  const batchExecution = complianceRoute.indexOf(
    "await database.batch(statements)",
    linkUpdate,
  );
  assert.ok(linkUpdate >= 0);
  assert.ok(
    batchExecution > linkUpdate,
    "Intent lifecycle updates must share the governed case batch",
  );
});

function intentDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(migration);
  for (const name of INTENT_GUARD_NAMES) {
    const definition = CREDITEX_SCHEMA_GUARD_DEFINITIONS.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(definition, `Missing runtime schema guard ${name}`);
    database.exec(definition.sql);
  }
  return database;
}

function insertIntent(
  database,
  {
    id,
    workOrderId,
    revision = 1,
    status = "planned",
    complianceCaseId = "",
    snapshot,
    programTemplateId = snapshot.program.templateId,
  },
) {
  const intentSnapshot = stableTradeComplianceIntentJson(snapshot);
  const intentSnapshotSha256 = createHash("sha256")
    .update(intentSnapshot)
    .digest("hex");
  return database.prepare(`
    INSERT INTO trade_work_order_compliance_intents (
      id, work_order_id, installer_uid, compliance_organisation_id,
      program_template_id, activity_template_id, program_code,
      registry_activity_code, service_category, site_jurisdiction,
      planned_start, catalogue_reviewed_on, intent_snapshot,
      intent_snapshot_sha256, status, compliance_case_id, revision,
      created_by_uid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workOrderId,
    "installer-1",
    "creditex-org",
    programTemplateId,
    snapshot.activity.templateId,
    snapshot.program.programCode,
    snapshot.activity.registryActivityCode,
    snapshot.activity.serviceCategory,
    snapshot.siteJurisdiction,
    snapshot.plannedStart,
    snapshot.catalogueReviewedOn,
    intentSnapshot,
    intentSnapshotSha256,
    status,
    complianceCaseId,
    revision,
    "installer-1",
    NOW,
    NOW,
  );
}

test("migration stays Sites-safe while Drizzle and runtime guards preserve its contract", () => {
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
  const migrationCheckNames = [
    ...migration.matchAll(
      /CONSTRAINT\s+(trade_compliance_intent_[a-z_]+)\s+CHECK/gi,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(migrationCheckNames, [
    "trade_compliance_intent_identity_check",
    "trade_compliance_intent_status_check",
    "trade_compliance_intent_case_check",
    "trade_compliance_intent_snapshot_check",
    "trade_compliance_intent_time_check",
  ]);
  for (const checkName of migrationCheckNames) {
    assert.match(
      schema,
      new RegExp(`check\\("${checkName}"`),
      `Drizzle schema is missing ${checkName}`,
    );
  }

  const database = intentDatabase();
  const snapshot = resolve({
    programCode: "SRES",
    registryActivityCode: "PV",
    siteJurisdiction: "VIC",
  })?.snapshot;
  assert.ok(snapshot);

  assert.equal(
    insertIntent(database, {
      id: "intent-1",
      workOrderId: "work-1",
      snapshot,
    }).changes,
    1,
  );
  assert.throws(
    () =>
      insertIntent(database, {
        id: "intent-bad-snapshot",
        workOrderId: "work-bad-snapshot",
        snapshot,
        programTemplateId: "not-the-snapshot-program",
      }),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      insertIntent(database, {
        id: "intent-duplicate-active",
        workOrderId: "work-1",
        revision: 2,
        snapshot,
      }),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () =>
      database.prepare(`
        UPDATE trade_work_order_compliance_intents
        SET service_category = 'battery'
        WHERE id = 'intent-1'
      `).run(),
    /TRADE_COMPLIANCE_INTENT_IMMUTABLE/,
  );

  assert.equal(
    database.prepare(`
      UPDATE trade_work_order_compliance_intents
      SET status = 'case_linked', compliance_case_id = 'case-1', updated_at = ?
      WHERE id = 'intent-1'
    `).run(LATER).changes,
    1,
  );
  const linked = database.prepare(`
    SELECT status, compliance_case_id
    FROM trade_work_order_compliance_intents
    WHERE id = 'intent-1'
  `).get();
  assert.equal(linked.status, "case_linked");
  assert.equal(linked.compliance_case_id, "case-1");
  assert.throws(
    () =>
      database.prepare(`
        UPDATE trade_work_order_compliance_intents
        SET updated_at = ?
        WHERE id = 'intent-1'
      `).run("2026-08-03T00:02:00.000Z"),
    /TRADE_COMPLIANCE_INTENT_IMMUTABLE/,
  );

  assert.equal(
    insertIntent(database, {
      id: "intent-2",
      workOrderId: "work-2",
      snapshot,
    }).changes,
    1,
  );
  assert.equal(
    database.prepare(`
      UPDATE trade_work_order_compliance_intents
      SET status = 'superseded', compliance_case_id = '', updated_at = ?
      WHERE id = 'intent-2'
    `).run(LATER).changes,
    1,
  );
  assert.throws(
    () =>
      database.prepare(`
        DELETE FROM trade_work_order_compliance_intents
        WHERE id = 'intent-2'
      `).run(),
    /TRADE_COMPLIANCE_INTENT_DELETE_BLOCKED/,
  );
});
