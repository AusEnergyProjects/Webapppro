import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  CREDITEX_PILOT_SCHEMA_GUARD_DEFINITIONS,
  ensureCreditexPilotSchemaGuards,
} from "../src/lib/creditex-schema-guards.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0099_creditex_synthetic_pilot.sql");
const schema = read("../db/schema.ts");
const contractSource = read("../src/lib/creditex-veu-pilot-contract.ts");
const server = read("../src/lib/creditex-veu-pilot-server.ts");
const route = read("../src/app/api/creditex/pilot/route.ts");
const workspace = read("../src/components/CreditexVeuPilotWorkspace.tsx");
const sresCalculator = read("../src/components/CreditexSresCalculator.tsx");
const allProgramCalculator = read(
  "../src/components/CreditexAllProgramCalculator.tsx",
);
const governedCalculator = read(
  "../src/components/CreditexGovernedProgramCalculator.tsx",
);
const officialProductPicker = read(
  "../src/components/CreditexOfficialProductPicker.tsx",
);
const calculationWorkspace = [
  workspace,
  sresCalculator,
  allProgramCalculator,
  governedCalculator,
  officialProductPicker,
].join("\n");
const workspaceStyles = read(
  "../src/components/CreditexVeuPilotWorkspace.module.css",
);
const manualEvidenceWorkspace = read(
  "../src/components/CreditexManualEvidenceLab.tsx",
);
const auditWorkspace = read(
  "../src/components/CreditexVeuJobAuditWorkspace.tsx",
);
const auditWorkspaceStyles = read(
  "../src/components/CreditexVeuJobAuditWorkspace.module.css",
);
const portal = read("../src/components/CreditexCompliancePortal.tsx");
const portalStyles = read(
  "../src/components/CreditexCompliancePortal.module.css",
);
const migrationDirectory = new URL("../drizzle/", import.meta.url);
const completeMigrationChain = fs.readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

function loadPilotContract() {
  const output = ts.transpileModule(contractSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "creditex-veu-pilot-contract.ts",
  }).outputText;
  const record = { exports: {} };
  const require = (specifier) => {
    if (specifier === "./australian-government-program-catalogue") {
      return { GOVERNMENT_ACTIVITY_TEMPLATES };
    }
    throw new Error(`Unexpected pilot contract dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    record,
    record.exports,
  );
  return record.exports;
}

const pilotContract = loadPilotContract();

function loadPilotServer() {
  const output = ts.transpileModule(server, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "creditex-veu-pilot-server.ts",
  }).outputText;
  const record = { exports: {} };
  const require = (specifier) => {
    if (specifier === "./creditex-veu-pilot-contract") return pilotContract;
    throw new Error(`Unexpected pilot server dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    record,
    record.exports,
  );
  return record.exports;
}

const pilotServer = loadPilotServer();

class TestD1Statement {
  constructor(database, metrics, sql, values = []) {
    this.database = database;
    this.metrics = metrics;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    assert.ok(
      values.length <= 100,
      `D1 statement exceeds the 100-bound-parameter limit: ${values.length}`,
    );
    return new TestD1Statement(this.database, this.metrics, this.sql, values);
  }

  async measure(operation) {
    if (!this.metrics.trackConcurrency) return operation();
    this.metrics.active += 1;
    this.metrics.maxActive = Math.max(
      this.metrics.maxActive,
      this.metrics.active,
    );
    await Promise.resolve();
    try {
      return operation();
    } finally {
      this.metrics.active -= 1;
    }
  }

  async first() {
    return this.measure(
      () => this.database.prepare(this.sql).get(...this.values) || null,
    );
  }

  async all() {
    return this.measure(
      () => ({ results: this.database.prepare(this.sql).all(...this.values) }),
    );
  }

  async run() {
    return this.measure(() => {
      const result = this.database.prepare(this.sql).run(...this.values);
      return {
        success: true,
        meta: {
          changes: Number(result.changes),
          last_row_id: result.lastInsertRowid,
        },
      };
    });
  }
}

function testD1(database) {
  const metrics = {
    active: 0,
    maxActive: 0,
    trackConcurrency: false,
  };
  return {
    metrics,
    prepare(sql) {
      return new TestD1Statement(database, metrics, sql);
    },
    async batch(statements) {
      assert.ok(
        statements.length <= 50,
        `Synthetic pilot batch exceeds the 50-subrequest safety budget: ${statements.length}`,
      );
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function applyCompleteMigrationChain(database) {
  assert.equal(completeMigrationChain.length, 141);
  assert.match(completeMigrationChain[0], /^0000_/);
  assert.match(completeMigrationChain.at(-1), /^0142_/);
  let emulatedFtsTables = 0;
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
        emulatedFtsTables += 1;
      }
    }
  }
  assert.equal(
    emulatedFtsTables,
    5,
    "node:sqlite lacks FTS5; all five search indexes need table-compatible test substitutes",
  );
}

function pilotMember(suffix) {
  return {
    uid: `creditex-pilot-admin-${suffix}`,
    organisationId: `org_creditex_synthetic_pilot_${suffix}`,
    role: "admin",
    authTime: Math.floor(Date.now() / 1_000),
  };
}

async function provisionCompletePilot(d1, member) {
  const started = await pilotServer.startCreditexVeuPilot(
    d1,
    member,
    pilotContract.CREDITEX_VEU_PILOT_CONFIRMATION,
  );
  assert.equal(started.alreadyExists, false);
  for (let cohort = 1; cohort <= 30; cohort += 1) {
    const result =
      await pilotServer.provisionNextCreditexVeuPilotCohort(d1, member);
    assert.equal(result.complete, false);
    assert.equal(result.provisioned.jobs, 10);
  }
  assert.deepEqual(
    await pilotServer.provisionNextCreditexVeuPilotCohort(d1, member),
    { runId: started.runId, complete: true },
  );
  const finalised = await pilotServer.finaliseCreditexVeuPilot(d1, member);
  assert.equal(finalised.alreadyFinalised, false);
  assert.equal(finalised.regulatorAcceptedCount, 0);
  assert.equal(finalised.externalSubmissionEnabled, false);
  return { runId: started.runId, finalised };
}

function pilotPopulation(database, runId) {
  const row = database.prepare(`SELECT
      (SELECT COUNT(*) FROM compliance_pilot_installers
        WHERE pilot_run_id = ?) AS installers,
      (SELECT COUNT(*) FROM compliance_pilot_technicians
        WHERE pilot_run_id = ?) AS technicians,
      (SELECT COUNT(*) FROM compliance_pilot_jobs
        WHERE pilot_run_id = ?) AS jobs,
      (SELECT COUNT(DISTINCT activity_template_id)
        FROM compliance_pilot_jobs WHERE pilot_run_id = ?) AS activities,
      (SELECT COUNT(*) FROM compliance_cases
        WHERE work_order_id IN (
          SELECT work_order_id FROM compliance_pilot_jobs
          WHERE pilot_run_id = ?
        )) AS regulated_cases`).get(
    runId,
    runId,
    runId,
    runId,
    runId,
  );
  return {
    installers: Number(row.installers),
    technicians: Number(row.technicians),
    jobs: Number(row.jobs),
    activities: Number(row.activities),
    regulatedCases: Number(row.regulated_cases),
  };
}

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

function loadIsolatedWorkspaceFunction(name) {
  const sourceFile = ts.createSourceFile(
    "CreditexVeuPilotWorkspace.tsx",
    workspace,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const declaration = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === name,
  );
  assert.ok(declaration, `Missing workspace function: ${name}`);
  const isolatedSource = declaration.getText(sourceFile)
    .replace(/^export\s+/, "");
  const output = ts.transpileModule(isolatedSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: `${name}.ts`,
  }).outputText;
  return new Function(`${output}\nreturn ${name};`)();
}

function projectionColumnCount(source) {
  const selectIndex = source.indexOf("SELECT");
  assert.notEqual(selectIndex, -1, "Missing SELECT projection");
  return source
    .slice(selectIndex + "SELECT".length)
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .length;
}

test("migration creates a constrained, synthetic-only pilot domain", (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(migration);

  const expectedTables = [
    "compliance_pilot_calculator_contracts",
    "compliance_pilot_connector_runs",
    "compliance_pilot_control_options",
    "compliance_pilot_events",
    "compliance_pilot_evidence_contracts",
    "compliance_pilot_installers",
    "compliance_pilot_jobs",
    "compliance_pilot_runs",
    "compliance_pilot_source_instruments",
    "compliance_pilot_technicians",
  ];
  const actualTables = database.prepare(`SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'compliance_pilot_%'
      ORDER BY name`).all().map((row) => row.name);
  assert.deepEqual(actualTables, expectedTables);

  for (const tableName of expectedTables) {
    assert.match(
      schema,
      new RegExp(`sqliteTable\\("${tableName.replaceAll("_", "\\_")}"`),
    );
  }

  assert.match(
    migration,
    /`record_mode` text DEFAULT 'synthetic_test' NOT NULL CHECK \(`record_mode` = 'synthetic_test'\)/,
  );
  assert.match(
    migration,
    /`installer_target` integer DEFAULT 10 NOT NULL CHECK \(`installer_target` = 10\)/,
  );
  assert.match(
    migration,
    /`technicians_per_installer` integer DEFAULT 3 NOT NULL CHECK \(`technicians_per_installer` = 3\)/,
  );
  assert.match(
    migration,
    /`jobs_per_technician` integer DEFAULT 10 NOT NULL CHECK \(`jobs_per_technician` = 10\)/,
  );
  assert.match(
    migration,
    /`installer_slot` integer NOT NULL CHECK \(`installer_slot` BETWEEN 1 AND 10\)/,
  );
  assert.match(
    migration,
    /`technician_slot` integer NOT NULL CHECK \(`technician_slot` BETWEEN 1 AND 3\)/,
  );
  assert.match(
    migration,
    /`mode` text DEFAULT 'dry_run' NOT NULL CHECK \(`mode` = 'dry_run'\)/,
  );
  assert.match(
    migration,
    /`external_submission_enabled` integer DEFAULT 0 NOT NULL CHECK \(`external_submission_enabled` = 0\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `compliance_pilot_installer_slot_idx`/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `compliance_pilot_technician_slot_idx`/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `compliance_pilot_jobs_work_order_idx`/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `compliance_pilot_connector_run_idx`/,
  );
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(
    migration,
    /CREATE TABLE `(?:compliance_cases|compliance_certificate_lots|compliance_submission_batch_items)`/,
  );

  const hash = "0".repeat(64);
  assert.throws(
    () => database.prepare(`INSERT INTO compliance_pilot_runs (
        id, organisation_id, program_code, name, seed_version,
        installer_target, technicians_per_installer, jobs_per_technician,
        activity_catalogue_sha256, source_manifest_sha256, created_by_uid,
        created_at, updated_at
      ) VALUES (?, ?, 'VEU', ?, ?, 9, 3, 10, ?, ?, ?, ?, ?)`).run(
      "invalid-run",
      "organisation",
      "Invalid target",
      "seed",
      hash,
      hash,
      "actor",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => database.prepare(`INSERT INTO compliance_pilot_connector_runs (
        id, pilot_run_id, connector_code, mapping_version, status,
        artifact_sha256, artifact_manifest, external_submission_enabled,
        created_by_uid, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'prepared', ?, '{}', 1, ?, ?, ?)`).run(
      "invalid-connector",
      "pilot",
      "VEU_REGISTRY_SYNTHETIC",
      "v1",
      hash,
      "actor",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ),
    /CHECK constraint failed/,
  );
});

test("database guards prevent synthetic work entering regulated case or submission flows", (t) => {
  const guardInventory = new Map(
    CREDITEX_PILOT_SCHEMA_GUARD_DEFINITIONS.map(
      (definition) => [definition.name, definition.sql],
    ),
  );
  for (const guardName of [
    "compliance_pilot_sources_parent_guard",
    "compliance_pilot_controls_parent_guard",
    "compliance_pilot_evidence_parent_guard",
    "compliance_pilot_calculators_parent_guard",
    "compliance_pilot_installers_parent_guard",
    "compliance_pilot_technicians_parent_guard",
    "compliance_pilot_jobs_parent_guard",
    "compliance_pilot_connectors_parent_guard",
    "compliance_pilot_events_parent_guard",
    "compliance_pilot_verified_claims_guard",
    "compliance_pilot_run_authority_claims_guard",
  ]) {
    assert.ok(guardInventory.has(guardName), `Missing pilot guard ${guardName}`);
  }
  assert.match(
    guardInventory.get("compliance_pilot_events_parent_guard"),
    /pilot_run\.`organisation_id` = NEW\.`organisation_id`/,
  );
  assert.match(
    guardInventory.get("compliance_pilot_jobs_parent_guard"),
    /work\.`firebase_uid` = installer\.`trade_account_uid`[\s\S]*work\.`source_reference` = NEW\.`pilot_run_id`/,
  );
  assert.match(
    guardInventory.get("compliance_pilot_connectors_parent_guard"),
    /NEW\.`external_submission_enabled` <> 0/,
  );
  assert.match(
    guardInventory.get("compliance_pilot_verified_claims_guard"),
    /COMPLIANCE_PILOT_VERIFICATION_FORBIDDEN/,
  );
  assert.match(
    guardInventory.get("compliance_pilot_run_authority_claims_guard"),
    /COMPLIANCE_PILOT_AUTHORITY_CLAIM_FORBIDDEN/,
  );

  const guardNames = [
    "compliance_cases_synthetic_work_order_guard",
    "compliance_batch_items_synthetic_case_guard",
    "trade_work_orders_synthetic_identity_no_update",
  ];
  const guards = guardNames.map((name) => {
    const definition = CREDITEX_PILOT_SCHEMA_GUARD_DEFINITIONS.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(definition, `Missing schema guard ${name}`);
    return definition;
  });

  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      source_type text NOT NULL,
      source_reference text NOT NULL,
      work_number text NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL
    );
    CREATE TABLE compliance_submission_batch_items (
      id text PRIMARY KEY NOT NULL,
      case_id text NOT NULL
    );`);
  for (const guard of guards) database.exec(guard.sql);

  database.prepare(`INSERT INTO trade_work_orders
      (id, firebase_uid, source_type, source_reference, work_number)
      VALUES ('synthetic-work', 'synthetic-installer', 'synthetic_pilot',
        'pilot-run', 'TEST-VEU-I01-T01-J01')`).run();
  assert.throws(
    () => database.prepare(`INSERT INTO compliance_cases (id, work_order_id)
      VALUES ('regulated-case', 'synthetic-work')`).run(),
    /COMPLIANCE_SYNTHETIC_CASE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`UPDATE trade_work_orders
      SET work_number = 'MUTATED' WHERE id = 'synthetic-work'`).run(),
    /COMPLIANCE_SYNTHETIC_WORK_IDENTITY_IMMUTABLE/,
  );

  database.prepare(`INSERT INTO trade_work_orders
      (id, firebase_uid, source_type, source_reference, work_number)
      VALUES ('normal-work', 'installer', 'internal', 'job', 'JOB-1')`).run();
  database.prepare(`INSERT INTO compliance_cases (id, work_order_id)
      VALUES ('existing-case', 'normal-work')`).run();
  database.prepare(`UPDATE trade_work_orders
      SET source_type = 'synthetic_pilot' WHERE id = 'normal-work'`).run();
  assert.throws(
    () => database.prepare(`INSERT INTO compliance_submission_batch_items
      (id, case_id) VALUES ('batch-item', 'existing-case')`).run(),
    /COMPLIANCE_SYNTHETIC_SUBMISSION_FORBIDDEN/,
  );
});

test("complete migration chain provisions and reconciles the governed 10/30/300 VEU pilot", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  applyCompleteMigrationChain(database);
  const d1 = testD1(database);
  await ensureCreditexPilotSchemaGuards(d1);

  const member = {
    uid: "creditex-pilot-admin",
    organisationId: "org_creditex_synthetic_pilot_test",
    role: "admin",
    authTime: Math.floor(Date.now() / 1_000),
  };
  const started = await pilotServer.startCreditexVeuPilot(
    d1,
    member,
    pilotContract.CREDITEX_VEU_PILOT_CONFIRMATION,
  );
  assert.equal(started.alreadyExists, false);
  assert.equal(
    started.runId,
    [
      "creditex-veu-pilot",
      pilotContract.CREDITEX_VEU_PILOT_SEED_VERSION,
      member.organisationId,
    ].join(":"),
  );
  assert.deepEqual(
    await pilotServer.startCreditexVeuPilot(
      d1,
      member,
      pilotContract.CREDITEX_VEU_PILOT_CONFIRMATION,
    ),
    { runId: started.runId, alreadyExists: true },
  );

  for (let cohort = 1; cohort <= 30; cohort += 1) {
    const result =
      await pilotServer.provisionNextCreditexVeuPilotCohort(d1, member);
    assert.equal(result.complete, false);
    assert.equal(result.provisioned.jobs, 10);
    assert.equal(
      (result.provisioned.installerSlot - 1) * 3
        + result.provisioned.technicianSlot,
      cohort,
    );
  }
  assert.deepEqual(
    await pilotServer.provisionNextCreditexVeuPilotCohort(d1, member),
    { runId: started.runId, complete: true },
  );

  const firstFinalise = await pilotServer.finaliseCreditexVeuPilot(d1, member);
  const secondFinalise = await pilotServer.finaliseCreditexVeuPilot(d1, member);
  assert.equal(firstFinalise.artifactSha256.length, 64);
  assert.equal(secondFinalise.artifactSha256, firstFinalise.artifactSha256);
  assert.deepEqual(firstFinalise.counts, secondFinalise.counts);
  assert.equal(firstFinalise.alreadyFinalised, false);
  assert.equal(secondFinalise.alreadyFinalised, true);
  assert.equal(firstFinalise.regulatorAcceptedCount, 0);
  assert.equal(secondFinalise.regulatorAcceptedCount, 0);
  assert.equal(firstFinalise.externalSubmissionEnabled, false);
  assert.deepEqual(
    await pilotServer.provisionNextCreditexVeuPilotCohort(d1, member),
    { runId: started.runId, complete: true },
  );

  assert.deepEqual(firstFinalise.counts, {
    installers: 10,
    technicians: 30,
    jobs: 300,
    activities: pilotContract.CREDITEX_VEU_PILOT_ACTIVITIES.length,
    sources: pilotContract.CREDITEX_VEU_PILOT_SOURCES.length,
    hashedSources: pilotContract.CREDITEX_VEU_PILOT_SOURCES.filter(
      (source) => source.officialSourceSha256,
    ).length,
    controlOptions: pilotContract.CREDITEX_VEU_PILOT_CONTROL_OPTIONS.length,
    calculatorContracts: pilotContract.CREDITEX_VEU_PILOT_ACTIVITIES.length,
    evidenceContracts:
      pilotContract.CREDITEX_VEU_PILOT_EVIDENCE_CONTRACTS.length,
    regulatedCases: 0,
  });

  const installers = database.prepare(`SELECT installer.installer_slot,
      COUNT(DISTINCT technician.id) AS technicians,
      COUNT(DISTINCT job.id) AS jobs
    FROM compliance_pilot_installers installer
    JOIN compliance_pilot_technicians technician
      ON technician.installer_id = installer.id
    JOIN compliance_pilot_jobs job
      ON job.installer_id = installer.id
    WHERE installer.pilot_run_id = ?
    GROUP BY installer.id, installer.installer_slot
    ORDER BY installer.installer_slot`).all(started.runId);
  assert.equal(installers.length, 10);
  assert.ok(
    installers.every(
      (installer) => installer.technicians === 3 && installer.jobs === 30,
    ),
  );
  const technicians = database.prepare(`SELECT technician.id,
      COUNT(job.id) AS jobs
    FROM compliance_pilot_technicians technician
    JOIN compliance_pilot_jobs job
      ON job.technician_id = technician.id
    WHERE technician.pilot_run_id = ?
    GROUP BY technician.id`).all(started.runId);
  assert.equal(technicians.length, 30);
  assert.ok(technicians.every((technician) => technician.jobs === 10));

  const activityIds = database.prepare(`SELECT DISTINCT activity_template_id
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ?
      ORDER BY activity_template_id`).all(started.runId)
    .map((row) => row.activity_template_id);
  assert.deepEqual(
    activityIds,
    pilotContract.CREDITEX_VEU_PILOT_ACTIVITIES
      .map((activity) => activity.templateId)
      .sort(),
  );
  const partSixJobs = database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ? AND registry_activity_code = '6'`)
    .get(started.runId);
  const activityCounts = database.prepare(`SELECT MIN(job_count) AS minimum,
      MAX(job_count) AS maximum
    FROM (
      SELECT activity_template_id, COUNT(*) AS job_count
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ?
      GROUP BY activity_template_id
    )`).get(started.runId);
  assert.ok(partSixJobs.count > 0);
  assert.ok(activityCounts.maximum - activityCounts.minimum <= 1);

  const connector = database.prepare(`SELECT *
      FROM compliance_pilot_connector_runs
      WHERE pilot_run_id = ?`).get(started.runId);
  assert.equal(connector.mode, "dry_run");
  assert.equal(connector.status, "validated");
  assert.equal(connector.item_count, 300);
  assert.equal(connector.accepted_count, 0);
  assert.equal(connector.rejected_count, 0);
  assert.equal(connector.unmatched_count, 0);
  assert.equal(connector.duplicate_count, 0);
  assert.equal(connector.external_submission_enabled, 0);
  assert.equal(connector.artifact_sha256, firstFinalise.artifactSha256);
  const manifest = JSON.parse(connector.artifact_manifest);
  assert.equal(manifest.schemaVersion, "creditex-veu-synthetic-dry-run-v2");
  assert.equal(manifest.recordMode, "synthetic_test");
  assert.equal(manifest.externalSubmissionEnabled, false);
  assert.equal(manifest.validation.expectedItems, 300);
  assert.equal(manifest.validation.regulatorResponseReceived, false);
  assert.equal(manifest.items.length, 300);
  assert.deepEqual(
    Object.keys(manifest.items[0]).toSorted(),
    [
      "activityDate",
      "activityTemplateId",
      "caseNumber",
      "jobNumber",
      "registryActivityCode",
      "specificationPart",
    ],
  );
  assert.deepEqual(
    manifest.items.map((item) => item.jobNumber),
    manifest.items.map((item) => item.jobNumber).toSorted(),
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_pilot_connector_runs
      WHERE pilot_run_id = ?`).get(started.runId).count,
    1,
  );

  const filters = pilotServer.parseCreditexPilotFilters(
    new URLSearchParams([
      ["page", "0"],
      ["pageSize", "100"],
    ]),
  );
  d1.metrics.active = 0;
  d1.metrics.maxActive = 0;
  d1.metrics.trackConcurrency = true;
  const dashboard = await pilotServer.loadCreditexVeuPilotDashboard(
    d1,
    member,
    filters,
  );
  d1.metrics.trackConcurrency = false;
  assert.equal(d1.metrics.active, 0);
  assert.ok(
    d1.metrics.maxActive <= 6,
    `Dashboard exceeded the six-connection D1 limit: ${d1.metrics.maxActive}`,
  );
  assert.equal(dashboard.configured, true);
  assert.equal(dashboard.run.id, started.runId);
  assert.equal(dashboard.run.recordMode, "synthetic_test");
  assert.equal(dashboard.run.status, "active");
  assert.deepEqual(dashboard.targets, {
    installers: 10,
    technicians: 30,
    jobs: 300,
    techniciansPerInstaller: 3,
    jobsPerTechnician: 10,
    activityFamilies: pilotContract.CREDITEX_VEU_PILOT_ACTIVITIES.length,
  });
  assert.equal(dashboard.installers.length, 10);
  assert.equal(dashboard.technicians.length, 30);
  assert.equal(dashboard.activities.length, activityIds.length);
  assert.equal(dashboard.jobs.length, 100);
  assert.equal(dashboard.pagination.total, 300);
  assert.equal(dashboard.pagination.pageCount, 3);
  assert.equal(dashboard.priorities.length, 5);
  assert.equal(dashboard.connectors.length, 1);
  assert.deepEqual(dashboard.boundaries, {
    regulatedCasesCreated: 0,
    firebaseTestUsersCreated: 0,
    customerEmailsOrPhonesCreated: 0,
    evidenceObjectsCreated: 0,
    certificateLotsCreated: 0,
    tradesCreated: 0,
    settlementsCreated: 0,
    externalSubmissionEnabled: false,
    fieldLoginStatus:
      "Blocked. Assignment-only technicians have no Firebase identity.",
  });
  assert.equal(dashboard.jobs[0].appointment.appointmentType, "installation");
  assert.equal(dashboard.jobs[0].work.workType, "job");
  assert.equal(dashboard.jobs[0].customer.customerType, "residential");
  assert.equal(dashboard.jobs[0].site.state, "VIC");
  assert.equal(dashboard.jobs[0].site.postcode, "3000");
  assert.equal(dashboard.jobs[0].customer.email, "");
  assert.equal(dashboard.jobs[0].customer.phone, "");
  assert.ok(dashboard.jobs[0].workOrderId);
  assert.ok(dashboard.jobs[0].createdAt);
  assert.equal(
    dashboard.currentSourcePack.packId,
    "veu-v25-2026-07-21-program-pack-draft-v1",
  );
  assert.equal(dashboard.currentSourcePack.activationEnabled, false);
  assert.equal(
    dashboard.currentSourcePack.independentApprovalState,
    "not_approved",
  );

  for (const [query, field, expected] of [
    [dashboard.jobs[0].technician.technicianCode, "technicianCode", 10],
    [dashboard.jobs[0].installer.companyCode, "installerCode", 30],
    [dashboard.jobs[0].scenario, "scenario", null],
    ["not started", "invoiceStatus", 300],
    ["VIC", "state", 300],
  ]) {
    const searched = await pilotServer.loadCreditexVeuPilotDashboard(
      d1,
      member,
      pilotServer.parseCreditexPilotFilters(new URLSearchParams({
        q: query,
        page: "0",
        pageSize: "300",
      })),
    );
    assert.ok(searched.pagination.total > 0, `${field} search returned no jobs`);
    if (expected !== null) assert.equal(searched.pagination.total, expected);
    assert.ok(
      searched.jobs.every((job) => {
        if (field === "technicianCode") {
          return job.technician.technicianCode === query;
        }
        if (field === "installerCode") {
          return job.installer.companyCode === query;
        }
        if (field === "scenario") return job.scenario === query;
        if (field === "invoiceStatus") {
          return job.crm.invoiceStatus === "not_started";
        }
        return job.site.state === query;
      }),
      `${field} search returned a job outside its matching cohort`,
    );
  }

  const allRowsFilters = pilotServer.parseCreditexPilotFilters(
    new URLSearchParams({
      page: "0",
      pageSize: "300",
      sortBy: "activityDate",
      sortDirection: "desc",
      customerType: "residential",
      postcode: "3000",
    }),
  );
  const allRowsDashboard = await pilotServer.loadCreditexVeuPilotDashboard(
    d1,
    member,
    allRowsFilters,
  );
  assert.equal(allRowsDashboard.jobs.length, 300);
  assert.equal(allRowsDashboard.pagination.total, 300);
  assert.equal(allRowsDashboard.pagination.pageCount, 1);
  assert.equal(
    new Set(allRowsDashboard.jobs.map((job) => job.id)).size,
    300,
  );
  assert.deepEqual(
    allRowsDashboard.jobs.map((job) => job.activityDate),
    allRowsDashboard.jobs
      .map((job) => job.activityDate)
      .toSorted()
      .reverse(),
  );

  const firstPilotWork = database.prepare(`SELECT work.id, work.firebase_uid
      FROM compliance_pilot_jobs job
      JOIN trade_work_orders work ON work.id = job.work_order_id
      WHERE job.pilot_run_id = ?
      ORDER BY job.job_number
      LIMIT 1`).get(started.runId);
  database.prepare(`INSERT INTO trade_crm_appointments (
      id, work_order_id, firebase_uid, appointment_type, title, starts_at,
      ends_at, assignee_member_id, assignee_label, status,
      travel_started_at, arrived_at, work_started_at, completed_at,
      last_transition_by_uid, notes, revision, created_at, updated_at
    ) VALUES (
      'synthetic-latest-appointment', ?, ?, 'installation',
      'Latest synthetic appointment', '2026-12-31T09:00:00+11:00',
      '2026-12-31T11:00:00+11:00', '', '', 'scheduled', '', '', '', '',
      '', 'TEST ONLY', 1, '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z'
    )`).run(firstPilotWork.id, firstPilotWork.firebase_uid);
  const afterSecondAppointment =
    await pilotServer.loadCreditexVeuPilotDashboard(
      d1,
      member,
      pilotServer.parseCreditexPilotFilters(
        new URLSearchParams({
          page: "0",
          pageSize: "300",
          sortBy: "jobNumber",
          sortDirection: "asc",
        }),
      ),
    );
  assert.equal(afterSecondAppointment.jobs.length, 300);
  assert.equal(afterSecondAppointment.pagination.total, 300);
  assert.equal(
    afterSecondAppointment.jobs[0].appointment.id,
    "synthetic-latest-appointment",
  );

  const regulatedSnapshot = () => database.prepare(`SELECT
      (SELECT COUNT(*) FROM compliance_cases) AS cases,
      (SELECT COUNT(*) FROM compliance_case_evidence) AS evidence,
      (SELECT COUNT(*) FROM compliance_submission_batches) AS batches,
      (SELECT COUNT(*) FROM compliance_submission_batch_items) AS batch_items,
      (SELECT COUNT(*) FROM compliance_submission_artifacts) AS artifacts,
      (SELECT COUNT(*) FROM compliance_submission_responses) AS responses,
      (SELECT COUNT(*) FROM compliance_certificate_lots) AS certificate_lots,
      (SELECT COUNT(*) FROM compliance_trades) AS trades,
      (SELECT COUNT(*) FROM compliance_settlements) AS settlements`)
    .get();
  const beforeDetailRead = regulatedSnapshot();
  d1.metrics.active = 0;
  d1.metrics.maxActive = 0;
  d1.metrics.trackConcurrency = true;
  const jobWorkspace = await pilotServer.loadCreditexVeuPilotJobWorkspace(
    d1,
    member,
    afterSecondAppointment.jobs[0].id,
  );
  d1.metrics.trackConcurrency = false;
  assert.equal(d1.metrics.active, 0);
  assert.ok(
    d1.metrics.maxActive <= 6,
    `Job detail exceeded the six-connection D1 limit: ${d1.metrics.maxActive}`,
  );
  assert.equal(jobWorkspace.readOnly, true);
  assert.equal(jobWorkspace.run.id, started.runId);
  assert.equal(jobWorkspace.job.id, afterSecondAppointment.jobs[0].id);
  assert.equal(jobWorkspace.job.recordMode, "synthetic_test");
  assert.equal(jobWorkspace.job.work.sourceType, "synthetic_pilot");
  assert.equal(jobWorkspace.job.work.sourceReference, started.runId);
  assert.equal(
    jobWorkspace.job.customer.id,
    afterSecondAppointment.jobs[0].customer.id,
  );
  assert.equal(jobWorkspace.job.site.addressState, "VIC");
  assert.equal(jobWorkspace.customerJobs.length, 1);
  assert.equal(jobWorkspace.appointments.length, 2);
  assert.deepEqual(
    jobWorkspace.appointments.map((appointment) => appointment.startsAt),
    jobWorkspace.appointments
      .map((appointment) => appointment.startsAt)
      .toSorted(),
  );
  assert.equal(
    jobWorkspace.appointments.at(-1).id,
    "synthetic-latest-appointment",
  );
  assert.deepEqual(jobWorkspace.appointmentAudit, {
    revisions: [],
    rescheduleRequests: [],
    rescheduleEvents: [],
  });
  assert.equal(jobWorkspace.crm.events.length, 1);
  assert.deepEqual(jobWorkspace.crm.tasks, []);
  assert.deepEqual(jobWorkspace.crm.notes, []);
  assert.deepEqual(jobWorkspace.crm.forms, []);
  assert.deepEqual(jobWorkspace.crm.media, []);
  assert.deepEqual(jobWorkspace.crm.quotes, []);
  assert.deepEqual(jobWorkspace.crm.invoices, []);
  assert.equal(jobWorkspace.priorities.length, 5);
  assert.equal(
    jobWorkspace.rules.sources.length,
    pilotContract.CREDITEX_VEU_PILOT_SOURCES.length,
  );
  assert.equal(
    jobWorkspace.lookups.options.length,
    pilotContract.CREDITEX_VEU_PILOT_CONTROL_OPTIONS.length,
  );
  assert.equal(
    jobWorkspace.evidence.contracts.length,
    pilotContract.CREDITEX_VEU_PILOT_EVIDENCE_CONTRACTS.length,
  );
  assert.equal(
    jobWorkspace.calculator.contract.activityTemplateId,
    afterSecondAppointment.jobs[0].activityTemplateId,
  );
  assert.equal(jobWorkspace.submission.connectors.length, 1);
  assert.equal(jobWorkspace.submission.externalSubmissionEnabled, false);
  assert.deepEqual(jobWorkspace.boundaries, {
    syntheticOnly: true,
    regulatedCasesCreated: 0,
    complianceEvidenceCreated: 0,
    submissionItemsCreated: 0,
    externalSubmissionEnabled: false,
  });
  assert.deepEqual(
    jobWorkspace.capabilities.map((capability) => capability.key),
    pilotContract.CREDITEX_VEU_PILOT_JOB_DETAIL_SECTIONS.map(
      (section) => section.key,
    ),
  );
  assert.equal(
    new Set(jobWorkspace.capabilities.map((capability) => capability.key)).size,
    pilotContract.CREDITEX_VEU_PILOT_JOB_DETAIL_SECTIONS.length,
  );
  const capabilities = Object.fromEntries(
    jobWorkspace.capabilities.map((capability) => [
      capability.key,
      capability,
    ]),
  );
  for (const section of [
    "customer_files",
    "customer_create_job",
    "job_transactions",
    "job_emails",
    "appointment_questions",
    "appointment_certificate_submissions",
    "appointment_decommissioning",
    "appointment_correspondence",
    "copy_selection",
  ]) {
    assert.equal(capabilities[section].available, false, section);
    assert.equal(capabilities[section].count, 0, section);
    assert.equal(capabilities[section].readOnly, true, section);
    assert.ok(capabilities[section].reason, section);
  }
  for (const section of [
    "job_actions",
    "job_questions",
    "job_files",
    "job_issues",
  ]) {
    assert.equal(capabilities[section].available, true, section);
    assert.equal(capabilities[section].count, 0, section);
    assert.equal(capabilities[section].readOnly, true, section);
  }
  assert.equal(capabilities.job_history.count, 1);
  for (const section of ["print", "print_preview"]) {
    assert.equal(capabilities[section].available, true, section);
    assert.equal(capabilities[section].count, 1, section);
    assert.equal(capabilities[section].readOnly, true, section);
  }
  assert.equal(capabilities.compliance_calculations.available, true);
  assert.deepEqual(regulatedSnapshot(), beforeDetailRead);
  assert.doesNotMatch(
    JSON.stringify(jobWorkspace),
    /objectKey|evidenceEnvelope|providerMessageId/,
  );
  const insertPilotMedia = database.prepare(`INSERT INTO trade_crm_job_media (
      id, work_order_id, firebase_uid, category, file_name, content_type,
      size_bytes, object_key, caption, source, evidence_envelope,
      original_sha256, created_at, updated_at
    ) VALUES (?, ?, ?, 'installation', ?, 'image/jpeg', 1024, ?, '', ?, ?, ?,
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`);
  const mediaTruthCases = [
    {
      id: "media-envelope-only",
      source: "field_app",
      envelope: {
        schemaVersion: 1,
        source: "in_app_camera",
        capture: { observedAtUtc: "" },
        location: {
          state: "permission_denied",
          latitude: null,
          longitude: null,
        },
        original: {
          exifState: "not_returned",
          exif: null,
          widthPixels: null,
          heightPixels: null,
        },
      },
      metadataPresent: false,
      gpsPresent: false,
    },
    {
      id: "media-invalid-coordinates",
      source: "field_app",
      envelope: {
        schemaVersion: 1,
        source: "document_picker",
        capture: { observedAtUtc: "2026-08-01T00:00:00.000Z" },
        location: {
          state: "captured",
          latitude: -37.8136,
          longitude: 181,
        },
        original: {
          exifState: "not_applicable",
          exif: null,
          widthPixels: null,
          heightPixels: null,
        },
      },
      metadataPresent: false,
      gpsPresent: false,
    },
    {
      id: "media-valid-gps",
      source: "field_app",
      envelope: {
        schemaVersion: 1,
        source: "document_picker",
        capture: { observedAtUtc: "2026-08-01T00:00:00.000Z" },
        location: {
          state: "captured",
          latitude: -37.8136,
          longitude: 144.9631,
        },
        original: {
          exifState: "not_applicable",
          exif: null,
          widthPixels: null,
          heightPixels: null,
        },
      },
      metadataPresent: false,
      gpsPresent: true,
    },
    {
      id: "media-valid-capture",
      source: "field_app",
      envelope: {
        schemaVersion: 1,
        source: "in_app_camera",
        capture: { observedAtUtc: "2026-08-01T00:00:00.000Z" },
        location: {
          state: "unavailable",
          latitude: null,
          longitude: null,
        },
        original: {
          exifState: "not_returned",
          exif: null,
          widthPixels: 1920,
          heightPixels: 1080,
        },
      },
      metadataPresent: true,
      gpsPresent: false,
    },
    {
      id: "media-valid-exif",
      source: "field_app",
      envelope: {
        schemaVersion: 1,
        source: "document_picker",
        capture: { observedAtUtc: "" },
        location: {
          state: "not_requested",
          latitude: null,
          longitude: null,
        },
        original: {
          exifState: "available",
          exif: { DateTimeOriginal: "2026:08:01 10:00:00" },
          widthPixels: null,
          heightPixels: null,
        },
      },
      metadataPresent: true,
      gpsPresent: false,
    },
  ];
  for (const mediaCase of mediaTruthCases) {
    insertPilotMedia.run(
      mediaCase.id,
      firstPilotWork.id,
      firstPilotWork.firebase_uid,
      `${mediaCase.id}.jpg`,
      `private/${mediaCase.id}`,
      mediaCase.source,
      JSON.stringify(mediaCase.envelope),
      "a".repeat(64),
    );
  }
  const mediaTruthWorkspace =
    await pilotServer.loadCreditexVeuPilotJobWorkspace(
      d1,
      member,
      afterSecondAppointment.jobs[0].id,
    );
  const mediaFlags = Object.fromEntries(
    mediaTruthWorkspace.crm.media.map((item) => [
      item.id,
      {
        metadataPresent: item.metadataPresent,
        gpsPresent: item.gpsPresent,
      },
    ]),
  );
  assert.deepEqual(
    mediaFlags,
    Object.fromEntries(
      mediaTruthCases.map((mediaCase) => [
        mediaCase.id,
        {
          metadataPresent: mediaCase.metadataPresent,
          gpsPresent: mediaCase.gpsPresent,
        },
      ]),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(mediaTruthWorkspace),
    /evidenceEnvelope|private\/media-/,
  );
  await assert.rejects(
    pilotServer.loadCreditexVeuPilotJobWorkspace(
      d1,
      member,
      "unknown-synthetic-job",
    ),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_JOB_NOT_FOUND");
      assert.equal(error.status, 404);
      assert.equal(error.message, "The synthetic pilot job was not found.");
      return true;
    },
  );

  assert.throws(
    () => pilotServer.parseCreditexPilotFilters(
      new URLSearchParams({
        sortBy: "job.job_number; DROP TABLE compliance_pilot_jobs",
      }),
    ),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_FILTER_INVALID");
      assert.equal(error.status, 400);
      return true;
    },
  );

  const firstWorkOrder = database.prepare(`SELECT work_order_id
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ?
      ORDER BY job_number
      LIMIT 1`).get(started.runId).work_order_id;
  const insertCase = database.prepare(`INSERT INTO compliance_cases (
      id, case_number, organisation_id, program_id, work_order_id,
      installer_uid, activity_version_id, activity_date, site_jurisdiction,
      activity_snapshot, created_by_type, created_by_uid, created_at, updated_at
    ) VALUES (?, ?, ?, 'test-program', ?, 'test-installer',
      'test-activity-version', '2026-08-01', 'VIC', '{}', 'compliance',
      ?, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`);
  assert.throws(
    () => insertCase.run(
      "forbidden-pilot-case",
      "FORBIDDEN-PILOT-CASE",
      member.organisationId,
      firstWorkOrder,
      member.uid,
    ),
    /COMPLIANCE_SYNTHETIC_CASE_FORBIDDEN/,
  );

  database.prepare(`INSERT INTO trade_work_orders (
      id, firebase_uid, partner_type, work_type, source_type, source_reference,
      work_number, title, service_category, service_categories, site_area,
      stage, priority, scheduled_start, scheduled_end, assignee_member_id,
      assignee_label, revision, record_status, created_at, updated_at
    ) VALUES (
      'control-work', 'control-installer', 'installer', 'job', 'internal',
      'control', 'CONTROL-JOB-1', 'Control job', 'other', '["other"]', '',
      'scheduled', 'standard', '2026-08-01T09:00:00.000Z',
      '2026-08-01T10:00:00.000Z', '', '', 1, 'active',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    )`).run();
  database.prepare(`INSERT INTO trade_crm_service_sites (
      id, firebase_uid, customer_id, address_state, record_status,
      created_at, updated_at
    ) VALUES (
      'control-site', 'control-installer', '', 'VIC', 'active',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    )`).run();
  database.prepare(`INSERT INTO trade_crm_job_details (
      id, work_order_id, firebase_uid, service_site_id, created_at, updated_at
    ) VALUES (
      'control-detail', 'control-work', 'control-installer', 'control-site',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    )`).run();
  database.prepare(`INSERT INTO compliance_programs (
      id, organisation_id, program_code, name, scheme_kind, jurisdiction,
      administering_body, official_source_url, official_source_title,
      official_source_checked_at, created_by_uid, created_at, updated_at
    ) VALUES (
      'control-program', ?, 'CONTROL', 'Control program', 'other', 'VIC',
      'Test regulator', 'https://example.test/control',
      'Control source', '2026-08-01T00:00:00.000Z', ?,
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    )`).run(member.organisationId, member.uid);
  database.prepare(`INSERT INTO compliance_activity_versions (
      id, program_id, activity_key, version, title, service_category,
      product_category, scenario, jurisdiction, effective_from,
      official_source_url, official_source_title,
      official_source_checked_at, created_by_uid, created_at, updated_at
    ) VALUES (
      'control-activity-version', 'control-program', 'control-activity', 1,
      'Control activity', 'other', 'Other', 'Control scenario', 'VIC',
      '2026-01-01', 'https://example.test/control',
      'Control source', '2026-08-01T00:00:00.000Z', ?,
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    )`).run(member.uid);
  const controlIntentSnapshot = JSON.stringify({
    contract: "tlink-creditex-job-intent-v1",
    program: {
      templateId: "control-program-template",
      programCode: "CONTROL",
    },
    activity: {
      templateId: "control-activity-template",
      activityKey: "control-activity",
      serviceCategory: "other",
    },
    siteJurisdiction: "VIC",
    catalogueReviewedOn: "2026-08-01",
  });
  const controlIntentSha256 = createHash("sha256")
    .update(controlIntentSnapshot)
    .digest("hex");
  database.prepare(`INSERT INTO trade_work_order_compliance_intents (
      id, work_order_id, intent_key, installer_uid,
      compliance_organisation_id, program_template_id, activity_template_id,
      program_code, registry_activity_code, service_category,
      site_jurisdiction, planned_start, catalogue_reviewed_on,
      intent_snapshot, intent_snapshot_sha256, status, compliance_case_id,
      revision, created_by_uid, created_at, updated_at
    ) VALUES (
      'control-intent', 'control-work',
      'program:control-program-template:activity:control-activity-template',
      'control-installer', ?, 'control-program-template',
      'control-activity-template', 'CONTROL', '', 'other', 'VIC',
      '2026-08-01T09:00:00.000Z', '2026-08-01', ?, ?, 'planned', '', 1, ?,
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    )`).run(
      member.organisationId,
      controlIntentSnapshot,
      controlIntentSha256,
      member.uid,
    );
  database.prepare(`INSERT INTO compliance_cases (
      id, case_number, organisation_id, program_id, work_order_id,
      compliance_intent_id, installer_uid, activity_version_id, activity_date,
      site_jurisdiction, activity_snapshot, created_by_type, created_by_uid,
      created_at, updated_at
    ) VALUES (
      'control-case', 'CONTROL-CASE', ?, 'control-program', 'control-work',
      'control-intent', 'control-installer', 'control-activity-version',
      '2026-08-01', 'VIC', '{}', 'compliance', ?,
      '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z'
    )`).run(member.organisationId, member.uid);
  database.prepare(`UPDATE trade_work_orders
      SET source_type = 'synthetic_pilot'
      WHERE id = 'control-work'`).run();
  assert.throws(
    () => database.prepare(`INSERT INTO compliance_submission_batch_items (
        id, organisation_id, batch_id, case_id, case_revision, created_by_uid,
        created_at, updated_at
      ) VALUES (
        'forbidden-batch-item', ?, 'test-batch', 'control-case', 1, ?,
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
      )`).run(member.organisationId, member.uid),
    /COMPLIANCE_SYNTHETIC_SUBMISSION_FORBIDDEN/,
  );

  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_cases compliance_case
      JOIN compliance_pilot_jobs pilot_job
        ON pilot_job.work_order_id = compliance_case.work_order_id
      WHERE pilot_job.pilot_run_id = ?`).get(started.runId).count,
    0,
  );
  for (const tableName of [
    "compliance_certificate_lots",
    "compliance_trades",
    "compliance_settlements",
  ]) {
    assert.equal(
      database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
      0,
    );
  }

  database.exec(
    "DROP TRIGGER IF EXISTS trade_work_orders_synthetic_identity_no_update",
  );
  database.prepare(`UPDATE trade_work_orders
      SET source_type = 'internal'
      WHERE id = ?`).run(firstPilotWork.id);
  await assert.rejects(
    pilotServer.loadCreditexVeuPilotJobWorkspace(
      d1,
      member,
      afterSecondAppointment.jobs[0].id,
    ),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_JOB_NOT_FOUND");
      assert.equal(error.status, 404);
      assert.equal(error.message, "The synthetic pilot job was not found.");
      return true;
    },
  );
  database.prepare(`UPDATE trade_work_orders
      SET source_type = 'synthetic_pilot', firebase_uid = 'corrupt-owner'
      WHERE id = ?`).run(firstPilotWork.id);
  await assert.rejects(
    pilotServer.loadCreditexVeuPilotJobWorkspace(
      d1,
      member,
      afterSecondAppointment.jobs[0].id,
    ),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_JOB_NOT_FOUND");
      assert.equal(error.status, 404);
      assert.equal(error.message, "The synthetic pilot job was not found.");
      return true;
    },
  );
});

test("two Creditex organisations provision independent 10/30/300 pilots without collisions", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  applyCompleteMigrationChain(database);
  const d1 = testD1(database);
  await ensureCreditexPilotSchemaGuards(d1);

  const firstMember = pilotMember("tenant_a");
  const secondMember = pilotMember("tenant_b");
  const first = await provisionCompletePilot(d1, firstMember);
  const second = await provisionCompletePilot(d1, secondMember);
  assert.notEqual(first.runId, second.runId);
  assert.notEqual(
    first.finalised.artifactSha256,
    second.finalised.artifactSha256,
  );
  const firstOrganisationJob = database.prepare(`SELECT id
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ?
      ORDER BY job_number ASC
      LIMIT 1`).get(first.runId);
  await assert.rejects(
    pilotServer.loadCreditexVeuPilotJobWorkspace(
      d1,
      secondMember,
      firstOrganisationJob.id,
    ),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_JOB_NOT_FOUND");
      assert.equal(error.status, 404);
      assert.equal(error.message, "The synthetic pilot job was not found.");
      return true;
    },
  );
  for (const result of [first, second]) {
    assert.deepEqual(pilotPopulation(database, result.runId), {
      installers: 10,
      technicians: 30,
      jobs: 300,
      activities: pilotContract.CREDITEX_VEU_PILOT_ACTIVITIES.length,
      regulatedCases: 0,
    });
  }

  const jobIdentityCounts = database.prepare(`SELECT
      COUNT(*) AS rows,
      COUNT(DISTINCT id) AS ids,
      COUNT(DISTINCT case_number) AS case_numbers,
      COUNT(DISTINCT job_number) AS job_numbers,
      COUNT(DISTINCT work_order_id) AS work_order_ids
    FROM compliance_pilot_jobs`).get();
  assert.deepEqual({ ...jobIdentityCounts }, {
    rows: 600,
    ids: 600,
    case_numbers: 600,
    job_numbers: 600,
    work_order_ids: 600,
  });
  const ownerIdentityCounts = database.prepare(`SELECT
      COUNT(*) AS installers,
      COUNT(DISTINCT installer.id) AS installer_ids,
      COUNT(DISTINCT installer.trade_account_uid) AS account_uids,
      COUNT(DISTINCT account.email) AS account_emails
    FROM compliance_pilot_installers installer
    JOIN trade_accounts account
      ON account.firebase_uid = installer.trade_account_uid`).get();
  assert.deepEqual({ ...ownerIdentityCounts }, {
    installers: 20,
    installer_ids: 20,
    account_uids: 20,
    account_emails: 20,
  });
  const technicianIdentityCounts = database.prepare(`SELECT
      COUNT(*) AS technicians,
      COUNT(DISTINCT technician.id) AS technician_ids,
      COUNT(DISTINCT technician.team_member_id) AS team_member_ids,
      COUNT(DISTINCT team_member.owner_uid) AS owner_uids
    FROM compliance_pilot_technicians technician
    JOIN trade_team_members team_member
      ON team_member.id = technician.team_member_id`).get();
  assert.deepEqual({ ...technicianIdentityCounts }, {
    technicians: 60,
    technician_ids: 60,
    team_member_ids: 60,
    owner_uids: 20,
  });
  const workOrderCounts = database.prepare(`SELECT
      COUNT(*) AS jobs,
      COUNT(DISTINCT work.id) AS work_ids,
      COUNT(DISTINCT work.work_number) AS work_numbers,
      COUNT(DISTINCT work.firebase_uid) AS owner_uids,
      COUNT(DISTINCT work.source_reference) AS pilot_runs
    FROM trade_work_orders work
    WHERE work.source_type = 'synthetic_pilot'`).get();
  assert.deepEqual({ ...workOrderCounts }, {
    jobs: 600,
    work_ids: 600,
    work_numbers: 600,
    owner_uids: 20,
    pilot_runs: 2,
  });
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_pilot_jobs job
      JOIN compliance_pilot_installers installer
        ON installer.id = job.installer_id
        AND installer.pilot_run_id = job.pilot_run_id
      JOIN compliance_pilot_technicians technician
        ON technician.id = job.technician_id
        AND technician.installer_id = installer.id
        AND technician.pilot_run_id = job.pilot_run_id
      JOIN trade_work_orders work
        ON work.id = job.work_order_id
      WHERE work.firebase_uid <> installer.trade_account_uid
        OR work.source_type <> 'synthetic_pilot'
        OR work.source_reference <> job.pilot_run_id`).get().count,
    0,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_pilot_connector_runs`).get().count,
    2,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_pilot_connector_runs
      WHERE mode <> 'dry_run'
        OR status <> 'validated'
        OR accepted_count <> 0
        OR external_submission_enabled <> 0`).get().count,
    0,
  );
});

test("a government-source seed change archives the previous pilot and creates a separate successor", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  applyCompleteMigrationChain(database);
  const d1 = testD1(database);
  await ensureCreditexPilotSchemaGuards(d1);
  const member = pilotMember("seed_successor");
  const previousRunId = "creditex-veu-pilot:previous-seed:test";
  database.prepare(`INSERT INTO compliance_pilot_runs (
      id, organisation_id, program_code, name, seed_version, record_mode,
      status, installer_target, technicians_per_installer,
      jobs_per_technician, activity_catalogue_sha256,
      source_manifest_sha256, rule_import_status, lookup_status,
      evidence_status, calculator_status, connector_status,
      created_by_uid, created_at, activated_at, archived_at, updated_at
    ) VALUES (
      ?, ?, 'VEU', 'Previous synthetic VEU pilot',
      'veu-v24-previous-synthetic-v1', 'synthetic_test', 'active',
      10, 3, 10, ?, ?, 'captured_pending_independent_review',
      'contracts_ready_live_sources_blocked',
      'transport_contract_ready_physical_acceptance_blocked',
      'typed_contract_ready_formula_blocked', 'dry_run_only', ?,
      '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '',
      '2026-07-01T00:00:00.000Z'
    )`).run(
    previousRunId,
    member.organisationId,
    "0".repeat(64),
    "1".repeat(64),
    member.uid,
  );

  const filters = pilotServer.parseCreditexPilotFilters(
    new URLSearchParams({ page: "0", pageSize: "50" }),
  );
  const beforeArchive = await pilotServer.loadCreditexVeuPilotDashboard(
    d1,
    member,
    filters,
  );
  assert.equal(beforeArchive.configured, false);
  assert.equal(beforeArchive.previousRun.id, previousRunId);
  assert.equal(beforeArchive.previousRun.status, "active");
  assert.equal(
    beforeArchive.archiveConfirmationPhrase,
    "ARCHIVE SYNTHETIC VEU PILOT",
  );
  await assert.rejects(
    pilotServer.startCreditexVeuPilot(
      d1,
      member,
      pilotContract.CREDITEX_VEU_PILOT_CONFIRMATION,
    ),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_PREVIOUS_SEED_ACTIVE");
      assert.equal(error.status, 409);
      return true;
    },
  );

  const archived = await pilotServer.archiveCreditexVeuPilot(
    d1,
    member,
    "ARCHIVE SYNTHETIC VEU PILOT",
  );
  assert.deepEqual(archived, { runId: previousRunId, archived: true });
  assert.equal(
    database.prepare(`SELECT status FROM compliance_pilot_runs
      WHERE id = ?`).get(previousRunId).status,
    "archived",
  );

  const successor = await pilotServer.startCreditexVeuPilot(
    d1,
    member,
    pilotContract.CREDITEX_VEU_PILOT_CONFIRMATION,
  );
  assert.equal(successor.alreadyExists, false);
  assert.notEqual(successor.runId, previousRunId);
  assert.match(
    successor.runId,
    new RegExp(pilotContract.CREDITEX_VEU_PILOT_SEED_VERSION),
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_pilot_runs WHERE organisation_id = ?`)
      .get(member.organisationId).count,
    2,
  );
});

test("active job CAS preserves the immutable population manifest", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  applyCompleteMigrationChain(database);
  const d1 = testD1(database);
  await ensureCreditexPilotSchemaGuards(d1);
  const member = pilotMember("cas");
  const pilot = await provisionCompletePilot(d1, member);

  const jobBefore = database.prepare(`SELECT id, review_status,
      evidence_status, lookup_status, connector_status, updated_at
    FROM compliance_pilot_jobs
    WHERE pilot_run_id = ?
    ORDER BY job_number
    LIMIT 1`).get(pilot.runId);
  assert.equal(jobBefore.connector_status, "dry_run_staged");
  const connectorBefore = database.prepare(`SELECT artifact_sha256,
      artifact_manifest, accepted_count, external_submission_enabled,
      status, updated_at
    FROM compliance_pilot_connector_runs
    WHERE pilot_run_id = ?`).get(pilot.runId);
  assert.equal(connectorBefore.accepted_count, 0);
  assert.equal(connectorBefore.external_submission_enabled, 0);
  assert.equal(connectorBefore.status, "validated");
  const activationManifest = JSON.parse(connectorBefore.artifact_manifest);
  assert.equal(activationManifest.items.length, 300);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const updated = await pilotServer.updateCreditexVeuPilotJob(
    d1,
    member,
    {
      jobId: jobBefore.id,
      expectedUpdatedAt: jobBefore.updated_at,
      reviewStatus: "in_review",
      evidenceStatus: "in_progress",
      lookupStatus: "blocked",
    },
  );
  assert.deepEqual(updated, {
    jobId: jobBefore.id,
    reviewStatus: "in_review",
    evidenceStatus: "in_progress",
    lookupStatus: "blocked",
  });
  const jobAfter = database.prepare(`SELECT id, review_status,
      evidence_status, lookup_status, connector_status, updated_at
    FROM compliance_pilot_jobs WHERE id = ?`).get(jobBefore.id);
  assert.equal(jobAfter.review_status, "in_review");
  assert.equal(jobAfter.evidence_status, "in_progress");
  assert.equal(jobAfter.lookup_status, "blocked");
  assert.equal(jobAfter.connector_status, "dry_run_staged");
  assert.notEqual(jobAfter.updated_at, jobBefore.updated_at);
  const eventCountAfterUpdate = database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_pilot_events
      WHERE pilot_run_id = ? AND event_type = 'pilot.job_status_changed'`)
    .get(pilot.runId).count;
  assert.equal(eventCountAfterUpdate, 1);

  await assert.rejects(
    pilotServer.updateCreditexVeuPilotJob(d1, member, {
      jobId: jobBefore.id,
      expectedUpdatedAt: jobBefore.updated_at,
      reviewStatus: "changes_required",
      evidenceStatus: "changes_required",
      lookupStatus: "not_checked",
    }),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_JOB_CHANGED");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.deepEqual(
    database.prepare(`SELECT id, review_status, evidence_status,
        lookup_status, connector_status, updated_at
      FROM compliance_pilot_jobs WHERE id = ?`).get(jobBefore.id),
    jobAfter,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count
      FROM compliance_pilot_events
      WHERE pilot_run_id = ? AND event_type = 'pilot.job_status_changed'`)
      .get(pilot.runId).count,
    eventCountAfterUpdate,
  );
  assert.deepEqual(
    database.prepare(`SELECT artifact_sha256, artifact_manifest,
        accepted_count, external_submission_enabled, status, updated_at
      FROM compliance_pilot_connector_runs
      WHERE pilot_run_id = ?`).get(pilot.runId),
    connectorBefore,
  );

  const finalisedAgain =
    await pilotServer.finaliseCreditexVeuPilot(d1, member);
  assert.equal(finalisedAgain.alreadyFinalised, true);
  assert.equal(
    finalisedAgain.artifactSha256,
    connectorBefore.artifact_sha256,
  );
  assert.equal(finalisedAgain.regulatorAcceptedCount, 0);
  assert.equal(finalisedAgain.externalSubmissionEnabled, false);
  assert.deepEqual(
    database.prepare(`SELECT artifact_sha256, artifact_manifest,
        accepted_count, external_submission_enabled, status, updated_at
      FROM compliance_pilot_connector_runs
      WHERE pilot_run_id = ?`).get(pilot.runId),
    connectorBefore,
  );
  assert.equal(
    database.prepare(`SELECT connector_status
      FROM compliance_pilot_jobs WHERE id = ?`).get(jobBefore.id)
      .connector_status,
    "dry_run_staged",
  );
});

test("an activated archived pilot rejects finalisation without mutation", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  applyCompleteMigrationChain(database);
  const d1 = testD1(database);
  await ensureCreditexPilotSchemaGuards(d1);
  const member = pilotMember("archive_active");
  const pilot = await provisionCompletePilot(d1, member);
  const archivedJobId = database.prepare(`SELECT id
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ?
      ORDER BY job_number ASC
      LIMIT 1`).get(pilot.runId).id;
  await pilotServer.archiveCreditexVeuPilot(
    d1,
    member,
    "ARCHIVE SYNTHETIC VEU PILOT",
  );

  const snapshot = () => ({
    run: database.prepare(`SELECT status, activated_at, archived_at, updated_at
      FROM compliance_pilot_runs WHERE id = ?`).get(pilot.runId),
    connectors: database.prepare(`SELECT id, status, item_count,
        accepted_count, artifact_sha256, artifact_manifest,
        external_submission_enabled, updated_at
      FROM compliance_pilot_connector_runs
      WHERE pilot_run_id = ?
      ORDER BY id`).all(pilot.runId),
    jobs: database.prepare(`SELECT id, review_status, connector_status,
        updated_at
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ?
      ORDER BY id`).all(pilot.runId),
    events: database.prepare(`SELECT id, event_type, summary, metadata,
        created_at
      FROM compliance_pilot_events
      WHERE pilot_run_id = ?
      ORDER BY id`).all(pilot.runId),
  });
  const archivedState = snapshot();
  assert.equal(archivedState.run.status, "archived");
  assert.ok(archivedState.run.activated_at);
  assert.ok(archivedState.run.archived_at);
  assert.equal(archivedState.connectors.length, 1);
  assert.equal(archivedState.connectors[0].accepted_count, 0);
  await assert.rejects(
    pilotServer.loadCreditexVeuPilotJobWorkspace(
      d1,
      member,
      archivedJobId,
    ),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_JOB_NOT_FOUND");
      assert.equal(error.status, 404);
      assert.equal(error.message, "The synthetic pilot job was not found.");
      return true;
    },
  );

  await assert.rejects(
    pilotServer.finaliseCreditexVeuPilot(d1, member),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_ARCHIVED");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.deepEqual(snapshot(), archivedState);
});

test("a partial provisioning pilot can be archived without deleting its cohort", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  applyCompleteMigrationChain(database);
  const d1 = testD1(database);
  await ensureCreditexPilotSchemaGuards(d1);
  const member = pilotMember("archive_partial");
  const started = await pilotServer.startCreditexVeuPilot(
    d1,
    member,
    pilotContract.CREDITEX_VEU_PILOT_CONFIRMATION,
  );
  const cohort =
    await pilotServer.provisionNextCreditexVeuPilotCohort(d1, member);
  assert.equal(cohort.complete, false);
  assert.deepEqual(cohort.provisioned, {
    installerSlot: 1,
    technicianSlot: 1,
    jobs: 10,
  });
  await pilotServer.archiveCreditexVeuPilot(
    d1,
    member,
    "ARCHIVE SYNTHETIC VEU PILOT",
  );

  const snapshot = () => ({
    run: database.prepare(`SELECT status, activated_at, archived_at, updated_at
      FROM compliance_pilot_runs WHERE id = ?`).get(started.runId),
    counts: pilotPopulation(database, started.runId),
    installers: database.prepare(`SELECT id, status, updated_at
      FROM compliance_pilot_installers
      WHERE pilot_run_id = ? ORDER BY id`).all(started.runId),
    technicians: database.prepare(`SELECT id, status, updated_at
      FROM compliance_pilot_technicians
      WHERE pilot_run_id = ? ORDER BY id`).all(started.runId),
    jobs: database.prepare(`SELECT id, review_status, connector_status,
        updated_at
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ? ORDER BY id`).all(started.runId),
    accounts: database.prepare(`SELECT account.firebase_uid,
        account.account_status, account.availability_status,
        account.is_synthetic, account.updated_at
      FROM trade_accounts account
      JOIN compliance_pilot_installers installer
        ON installer.trade_account_uid = account.firebase_uid
      WHERE installer.pilot_run_id = ?
      ORDER BY account.firebase_uid`).all(started.runId),
    workOrders: database.prepare(`SELECT id, stage, record_status, updated_at
      FROM trade_work_orders
      WHERE source_type = 'synthetic_pilot' AND source_reference = ?
      ORDER BY id`).all(started.runId),
    appointments: database.prepare(`SELECT appointment.id,
        appointment.status, appointment.updated_at
      FROM trade_crm_appointments appointment
      JOIN compliance_pilot_jobs job
        ON job.work_order_id = appointment.work_order_id
      WHERE job.pilot_run_id = ?
      ORDER BY appointment.id`).all(started.runId),
    connectors: database.prepare(`SELECT id
      FROM compliance_pilot_connector_runs
      WHERE pilot_run_id = ?`).all(started.runId),
    events: database.prepare(`SELECT id, event_type, summary, metadata,
        created_at
      FROM compliance_pilot_events
      WHERE pilot_run_id = ?
      ORDER BY id`).all(started.runId),
  });
  const archivedState = snapshot();
  assert.equal(archivedState.run.status, "archived");
  assert.equal(archivedState.run.activated_at, "");
  assert.ok(archivedState.run.archived_at);
  assert.deepEqual(archivedState.counts, {
    installers: 1,
    technicians: 1,
    jobs: 10,
    activities: 10,
    regulatedCases: 0,
  });
  assert.equal(archivedState.installers[0].status, "archived");
  assert.equal(archivedState.technicians[0].status, "archived");
  assert.ok(
    archivedState.jobs.every((job) => job.review_status === "archived"),
  );
  assert.ok(
    archivedState.accounts.every(
      (account) =>
        account.account_status === "closed"
        && account.availability_status === "paused"
        && account.is_synthetic === 1,
    ),
  );
  assert.ok(
    archivedState.workOrders.every(
      (work) =>
        work.stage === "cancelled" && work.record_status === "archived",
    ),
  );
  assert.ok(
    archivedState.appointments.every(
      (appointment) => appointment.status === "cancelled",
    ),
  );
  assert.equal(archivedState.connectors.length, 0);

  assert.deepEqual(
    await pilotServer.provisionNextCreditexVeuPilotCohort(d1, member),
    { runId: started.runId, complete: true },
  );
  await assert.rejects(
    pilotServer.finaliseCreditexVeuPilot(d1, member),
    (error) => {
      assert.equal(error.code, "CREDITEX_PILOT_ARCHIVED");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.deepEqual(snapshot(), archivedState);
});

test("pilot targets are exactly 10 installers, 30 technicians and 300 jobs", () => {
  assert.equal(pilotContract.CREDITEX_VEU_PILOT_INSTALLER_COUNT, 10);
  assert.equal(
    pilotContract.CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER,
    3,
  );
  assert.equal(pilotContract.CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN, 10);
  assert.equal(pilotContract.CREDITEX_VEU_PILOT_JOB_COUNT, 300);

  assert.match(
    server,
    /installers:\s*CREDITEX_VEU_PILOT_INSTALLER_COUNT/,
  );
  assert.match(
    server,
    /technicians:\s*CREDITEX_VEU_PILOT_INSTALLER_COUNT\s*\*\s*CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER/s,
  );
  assert.match(server, /jobs:\s*CREDITEX_VEU_PILOT_JOB_COUNT/);
  assert.match(
    server,
    /counts\.installers !== targets\.installers[\s\S]*counts\.technicians !== targets\.technicians[\s\S]*counts\.jobs !== targets\.jobs/,
  );
  assert.match(
    server,
    /source, control, evidence, calculator, 10-installer, 30-technician, 300-job, all-activity and zero-regulated-case contracts reconcile/,
  );
});

test("current VEU specification sources preserve the official v24 to v25 effective boundary", () => {
  const v25 = pilotContract.CREDITEX_VEU_CURRENT_SOURCE_PACK_SOURCES.find(
    (source) => source.sourceKey === "veu-specifications-v25",
  );
  const v24 = pilotContract.CREDITEX_VEU_CURRENT_SOURCE_PACK_SOURCES.find(
    (source) => source.sourceKey === "veu-specifications-v24-comparison",
  );

  assert.deepEqual(
    {
      version: v25?.officialVersion,
      effectiveFrom: v25?.effectiveFrom,
      hashStatus: v25?.hashStatus,
    },
    {
      version: "25.0",
      effectiveFrom: "2026-07-21",
      hashStatus: "download_blocked_pending_hash",
    },
  );
  assert.deepEqual(
    {
      version: v24?.officialVersion,
      effectiveFrom: v24?.effectiveFrom,
      effectiveTo: v24?.effectiveTo,
      hashStatus: v24?.hashStatus,
    },
    {
      version: "24.0 comparison source",
      effectiveFrom: "2026-06-30",
      effectiveTo: "2026-07-20",
      hashStatus: "download_blocked_pending_hash",
    },
  );
  assert.equal(
    pilotContract.CREDITEX_VEU_CURRENT_SOURCE_PACK.activationEnabled,
    false,
  );
});

test("every VEU activity family is data-driven and receives a balanced pilot cohort", () => {
  const expectedActivities = GOVERNMENT_ACTIVITY_TEMPLATES.filter(
    (activity) => activity.programCode === "VEU",
  );
  const pilotActivities = pilotContract.CREDITEX_VEU_PILOT_ACTIVITIES;
  assert.ok(expectedActivities.length > 1);
  assert.ok(pilotContract.CREDITEX_VEU_PILOT_JOB_COUNT >= expectedActivities.length);
  assert.deepEqual(pilotActivities, expectedActivities);
  assert.equal(
    new Set(pilotActivities.map((activity) => activity.templateId)).size,
    pilotActivities.length,
  );
  assert.ok(pilotActivities.every((activity) => activity.programCode === "VEU"));
  assert.equal(
    pilotActivities.filter(
      (activity) => activity.registryActivityCode === "6",
    ).length,
    1,
  );

  const allocation = new Map(
    pilotActivities.map((activity) => [activity.templateId, 0]),
  );
  for (
    let jobIndex = 0;
    jobIndex < pilotContract.CREDITEX_VEU_PILOT_JOB_COUNT;
    jobIndex += 1
  ) {
    const activity = pilotActivities[jobIndex % pilotActivities.length];
    allocation.set(activity.templateId, allocation.get(activity.templateId) + 1);
  }
  const allocatedCounts = Array.from(allocation.values());
  assert.ok(allocatedCounts.every((count) => count > 0));
  assert.ok(Math.max(...allocatedCounts) - Math.min(...allocatedCounts) <= 1);

  assert.match(
    contractSource,
    /GOVERNMENT_ACTIVITY_TEMPLATES\.filter\(\s*\(activity\) => activity\.programCode === "VEU"/,
  );
  assert.match(
    server,
    /CREDITEX_VEU_PILOT_ACTIVITIES\[\s*globalJobIndex % CREDITEX_VEU_PILOT_ACTIVITIES\.length\s*\]/,
  );
  for (const source of [contractSource, server, route, workspace]) {
    assert.doesNotMatch(source, /6\(23\)/);
  }

  const sourceKeys = new Set(
    pilotContract.CREDITEX_VEU_PILOT_SOURCES.map((source) => source.sourceKey),
  );
  assert.equal(sourceKeys.size, pilotContract.CREDITEX_VEU_PILOT_SOURCES.length);
  assert.ok(
    pilotContract.CREDITEX_VEU_PILOT_SOURCES.every(
      (source) => source.officialSourceUrl.startsWith("https://"),
    ),
  );
  const controlsByType = Map.groupBy(
    pilotContract.CREDITEX_VEU_PILOT_CONTROL_OPTIONS,
    (option) => option.controlType,
  );
  assert.deepEqual(
    new Set(controlsByType.keys()),
    new Set([
      "participant_status",
      "accreditation_status",
      "licence_status",
      "product_status",
      "recall_status",
      "suspension_status",
      "evidence_status",
      "review_status",
      "activity_status",
    ]),
  );
  for (const options of controlsByType.values()) {
    assert.ok(options.length > 1);
    assert.equal(
      new Set(options.map((option) => option.optionCode)).size,
      options.length,
    );
    assert.ok(options.every((option) => sourceKeys.has(option.sourceKey)));
  }

  for (const activity of pilotActivities) {
    const input = pilotContract.calculatorInputSchema(activity);
    const output = pilotContract.calculatorOutputSchema(activity);
    assert.equal(
      input.properties.activityTemplateId.const,
      activity.templateId,
    );
    assert.equal(output.oneOf[0].properties.kind.const, "blocked");
    assert.equal(
      output.oneOf[1].properties.activityTemplateId.const,
      activity.templateId,
    );
    assert.equal(output.oneOf[1].properties.unit.const, "VEEC");
  }
});

test("manifest generation is deterministic, dry-run only and isolated from regulated writes", () => {
  assert.match(server, /Object\.keys\(record\)\s*\.sort\(\)/);
  assert.match(
    server,
    /function pilotRunId\(organisationId: string\) \{[\s\S]*CREDITEX_VEU_PILOT_SEED_VERSION[\s\S]*organisationId[\s\S]*\.join\(":"\);/,
  );
  assert.match(
    server,
    /const workOrderId = `\$\{run\.id\}:work:\$\{jobCode\}`;/,
  );
  assert.match(
    server,
    /const pilotJobId = `\$\{run\.id\}:pilot-job:\$\{jobCode\}`;/,
  );
  assert.match(
    server,
    /const date = new Date\(Date\.UTC\(2026, 7, 4 \+ \(globalJobIndex % 90\)\)\)/,
  );
  assert.match(
    server,
    /FROM compliance_pilot_jobs[\s\S]*WHERE pilot_run_id = \?[\s\S]*ORDER BY job_number/,
  );

  const finalise = sourceSection(
    server,
    "export async function finaliseCreditexVeuPilot",
    "export async function updateCreditexVeuPilotJob",
  );
  const manifest = sourceSection(
    finalise,
    "const manifest = {",
    "const now = new Date().toISOString();",
  );
  assert.match(
    manifest,
    /schemaVersion: "creditex-veu-synthetic-dry-run-v2"/,
  );
  assert.match(manifest, /recordMode: "synthetic_test"/);
  assert.match(manifest, /externalSubmissionEnabled: false/);
  assert.match(
    manifest,
    /kind: "deterministic_immutable_population_check"/,
  );
  assert.match(manifest, /expectedItems: CREDITEX_VEU_PILOT_JOB_COUNT/);
  assert.match(manifest, /regulatorResponseReceived: false/);
  assert.match(manifest, /items: jobs\.results\.map/);
  assert.match(manifest, /const artifactManifest = canonicalJson\(manifest\)/);
  assert.match(
    manifest,
    /const artifactSha256 = await sha256Hex\(artifactManifest\)/,
  );
  assert.doesNotMatch(manifest, /randomUUID|Date\.now|new Date/);
  assert.match(
    finalise,
    /`\$\{run\.id\}:connector:veu-registry-synthetic:v1`/,
  );
  assert.match(
    finalise,
    /'VEU_REGISTRY_SYNTHETIC', 'v1', 'dry_run', 'validated'/,
  );
  assert.match(
    finalise,
    /counts\.regulatedCases !== 0/,
  );
  assert.doesNotMatch(server, /\bfetch\s*\(/);

  const writeTargets = new Set(
    Array.from(server.matchAll(
      /\b(?:INSERT(?:\s+OR\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi,
    ), (match) => match[1].toLowerCase()),
  );
  for (const forbiddenTable of [
    "compliance_cases",
    "compliance_certificate_lots",
    "compliance_submission_batches",
    "compliance_submission_batch_items",
    "compliance_trades",
    "compliance_settlements",
  ]) {
    assert.equal(
      writeTargets.has(forbiddenTable),
      false,
      `Synthetic pilot must not write ${forbiddenTable}`,
    );
  }
  assert.match(
    server,
    /SELECT COUNT\(\*\) FROM compliance_cases[\s\S]*AS regulated_cases/,
  );
  assert.match(server, /certificateLotsCreated: 0/);
  assert.match(server, /tradesCreated: 0/);
  assert.match(server, /settlementsCreated: 0/);
  assert.match(server, /externalSubmissionEnabled: false/);
});

test("API exposes only the authenticated, same-origin pilot control surface", () => {
  assert.equal(
    (route.match(/if \(!sameOrigin\(request\)\)/g) || []).length,
    2,
  );
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
  assert.match(route, /requireFirebaseIdentity\(request\)/);
  assert.match(route, /requireComplianceIdentity\(identity/);
  assert.match(
    route,
    /allowedRoles: \["admin", "case_manager", "reviewer", "auditor"\]/,
  );
  assert.match(route, /parseCreditexPilotFilters/);
  assert.match(route, /loadCreditexVeuPilotDashboard/);
  assert.match(route, /loadCreditexVeuPilotJobWorkspace/);
  assert.match(route, /searchParams\.get\("jobId"\)/);
  assert.ok(
    route.indexOf('searchParams.get("jobId")')
      < route.indexOf("parseCreditexPilotFilters("),
    "The opaque job-detail route must branch before dashboard filter parsing.",
  );
  assert.match(route, /return json\(\{ ok: true, workspace \}\)/);
  assert.deepEqual(
    Array.from(route.matchAll(/action === "([^"]+)"/g), (match) => match[1]),
    ["start", "provision_next", "finalise", "update_job", "archive"],
  );
  assert.doesNotMatch(route, /action === "(?:submit|publish|trade)"/);
  assert.doesNotMatch(
    route,
    /export async function (?:PUT|PATCH|DELETE)/,
  );
});

test("job detail projection is fail-closed, owner-scoped and read-only", () => {
  const detail = sourceSection(
    server,
    "export async function loadCreditexVeuPilotJobWorkspace",
    "export async function loadCreditexVeuPilotDashboard",
  );
  assert.doesNotMatch(
    detail,
    /\b(?:INSERT(?:\s+OR\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\b/i,
  );
  assert.match(detail, /run\.status === "archived"/);
  assert.match(detail, /job\.record_mode = 'synthetic_test'/);
  assert.match(detail, /account\.is_synthetic = 1/);
  assert.match(detail, /team\.owner_uid = installer\.trade_account_uid/);
  assert.match(detail, /team\.member_uid = ''[\s\S]*team\.email = ''/);
  assert.match(detail, /work\.firebase_uid = installer\.trade_account_uid/);
  assert.match(detail, /work\.source_type = 'synthetic_pilot'/);
  assert.match(detail, /work\.source_reference = job\.pilot_run_id/);
  assert.match(detail, /work\.record_status = 'active'/);
  assert.match(detail, /pilotJobNotFound\(\)/);
  assert.match(detail, /externalSubmissionEnabled: false/);
  assert.doesNotMatch(detail, /object_key|evidence_envelope AS|provider_message_id/i);
});

test("job detail keeps each D1 projection within the 100-column limit", () => {
  const detail = sourceSection(
    server,
    "export async function loadCreditexVeuPilotJobWorkspace",
    "export async function loadCreditexVeuPilotDashboard",
  );
  const jobCoreProjection = sourceSection(
    detail,
    "const jobCore = await database.prepare(`SELECT",
    "    FROM compliance_pilot_jobs job",
  );
  const privateProjection = sourceSection(
    detail,
    "const privateDetail = await database.prepare(`SELECT",
    "    FROM trade_crm_job_details detail",
  );
  assert.ok(
    projectionColumnCount(jobCoreProjection) <= 100,
    "The synthetic job core projection exceeds D1's 100-column limit.",
  );
  assert.ok(
    projectionColumnCount(privateProjection) <= 100,
    "The private CRM projection exceeds D1's 100-column limit.",
  );

  const jobCoreQuery = sourceSection(
    detail,
    "const jobCore = await database.prepare(`SELECT",
    "  const privateDetail = await database.prepare(`SELECT",
  );
  assert.doesNotMatch(
    jobCoreQuery,
    /trade_crm_(?:job_details|customers|service_sites)/,
  );

  const privateQuery = sourceSection(
    detail,
    "const privateDetail = await database.prepare(`SELECT",
    "  const job: Record<string, unknown>",
  );
  assert.match(privateQuery, /detail\.work_order_id = \?/);
  assert.match(privateQuery, /detail\.firebase_uid = \?/);
  assert.match(
    privateQuery,
    /customer\.firebase_uid = detail\.firebase_uid/,
  );
  assert.match(privateQuery, /customer\.record_status = 'active'/);
  assert.match(privateQuery, /site\.firebase_uid = detail\.firebase_uid/);
  assert.match(privateQuery, /site\.record_status = 'active'/);
  assert.match(privateQuery, /pilotJobNotFound\(\)/);
});

test("job row clipboard cells remain single-line and spreadsheet-safe", () => {
  const safeCell = loadIsolatedWorkspaceFunction(
    "spreadsheetSafeClipboardCell",
  );
  assert.equal(safeCell("plain value"), "plain value");
  assert.equal(safeCell("one\ttwo\r\nthree"), "one two three");
  assert.equal(safeCell("line\u2028separator"), "line separator");
  for (const formula of [
    "=HYPERLINK(\"https://example.test\")",
    "+cmd|' /C calc'!A0",
    "-2+3",
    "@SUM(1,2)",
    " \uFEFF=1+1",
    "\u200B@SUM(1,2)",
  ]) {
    assert.equal(
      safeCell(formula),
      `'${formula}`,
      `${formula} must be copied as text`,
    );
  }

  const clipboardText = sourceSection(
    workspace,
    "function dataforceClipboardText",
    "function customerName",
  );
  assert.match(
    clipboardText,
    /DATAFORCE_JOB_CSV_HEADERS\.map\([\s\S]*spreadsheetSafeClipboardCell/,
  );
  for (const copyFunction of ["copyJobRow", "copyRegisterRow"]) {
    const copySource = sourceSection(
      workspace,
      `async function ${copyFunction}`,
      copyFunction === "copyJobRow"
        ? "async function copyRegisterRow"
        : "async function downloadDataforceCsv",
    );
    assert.match(
      copySource,
      /dataforceClipboardText\([^,]+,\s*includeHeaders\)/,
    );
  }
});

test("Creditex UI surfaces all five priorities, compact quick filters and controlled job menus", () => {
  const priorities = sourceSection(
    server,
    "function pilotPriorities",
    "export async function startCreditexVeuPilot",
  );
  const advancedFilters = sourceSection(
    workspace,
    "function AdvancedRegisterFilters",
    "export function CreditexVeuPilotWorkspace",
  );
  const sortHeader = sourceSection(
    workspace,
    "function PilotSortHeader",
    "function pilotJobCellValue",
  );
  const jobColumns = sourceSection(
    workspace,
    "const DATAFORCE_JOB_COLUMN_CONFIG",
    "type Filters",
  );
  assert.deepEqual(
    Array.from(priorities.matchAll(/key: "([^"]+)"/g), (match) => match[1]),
    [
      "official_instruments",
      "controlled_lookups",
      "original_evidence",
      "calculator_contracts",
      "connector_cutover",
    ],
  );
  assert.deepEqual(
    Array.from(priorities.matchAll(/number: (\d)/g), (match) => Number(match[1])),
    [1, 2, 3, 4, 5],
  );

  for (const [key, label] of [
    ["sources", "Sources"],
    ["lookups", "Lookups"],
    ["evidence", "Evidence"],
    ["calculators", "Calculators"],
    ["connectors", "Connectors"],
  ]) {
    assert.match(workspace, new RegExp(`\\["${key}", "${label}"\\]`));
    assert.match(workspace, new RegExp(`panel === "${key}"`));
  }
  assert.doesNotMatch(workspace, /[^\x00-\x7F]/);
  assert.match(workspace, /Blocked adapter descriptors/);
  assert.doesNotMatch(workspace, /Dry-run adapters/);
  assert.match(workspace, /snapshot\.priorities\.map/);
  assert.match(advancedFilters, /visibleActivities\.map/);
  assert.match(
    advancedFilters,
    /onChange\(\{ activityTemplateId: event\.target\.value \}\)/,
  );
  assert.match(advancedFilters, /visibleInstallers\.map/);
  assert.match(advancedFilters, /visibleTechnicians\.map/);
  assert.match(advancedFilters, /register\.facets\.statuses\.map/);
  assert.match(advancedFilters, /register\.facets\.postcodes\.map/);
  assert.match(workspace, /Object\.entries\(snapshot\.controls \|\| \{\}\)/);
  assert.ok((workspace.match(/<select/g) || []).length >= 8);
  assert.match(workspace, /<table className=\{styles\.jobTable\}>/);
  assert.match(workspace, /<caption>/);
  assert.match(workspace, /<thead>/);
  assert.match(workspace, /<tbody>/);
  assert.match(workspace, /scope="col"/);
  assert.match(workspace, /aria-sort=\{state === "none" \? undefined : state\}/);
  assert.match(workspace, /Actions for \$\{job\.jobNumber\}/);
  assert.match(workspace, /className=\{styles\.advancedFilters\}/);
  assert.match(workspace, /className=\{styles\.quickFilters\}/);
  assert.match(workspace, /type="search"/);
  assert.match(workspace, /Installer company/);
  assert.match(workspace, /Program activity/);
  assert.ok(
    advancedFilters.indexOf("styles.quickFilters")
      < advancedFilters.indexOf("<details>"),
  );
  assert.equal((advancedFilters.match(/Installer company/g) || []).length, 1);
  assert.equal((advancedFilters.match(/Program activity/g) || []).length, 1);
  assert.doesNotMatch(advancedFilters, /<details open>/);
  assert.doesNotMatch(advancedFilters, /Search type|Bulk actions/);
  assert.doesNotMatch(workspace, /aria-label="VEU activity tabs"/);
  assert.match(advancedFilters, /value=\{option\.value\}/);
  assert.doesNotMatch(workspace, /className=\{styles\.roster\}/);
  assert.doesNotMatch(workspaceStyles, /\.activityRail/);
  assert.doesNotMatch(workspaceStyles, /\.rosterGrid/);
  assert.match(workspace, /Download CSV/);
  assert.match(workspace, /Import CSV/);
  assert.match(workspace, /\/api\/creditex\/dataforce/);
  assert.match(workspace, /\/api\/creditex\/official-sources\/reviews/);
  assert.match(workspace, /\/api\/creditex\/operational-lookups\/reviews/);
  assert.match(workspace, /CreditexManualEvidenceLab/);
  assert.match(workspace, /projectCreditexJobToDataforceRecord/);
  assert.match(workspace, /exportDataforceJobCsv/);
  assert.match(
    workspace,
    /No regulated jobs, cases or certificates were created/,
  );
  assert.match(workspaceStyles, /\.importDialog/);
  assert.deepEqual(
    Array.from(
      jobColumns.matchAll(/^  "([^"]+)": (?:\{|\{ key:)/gm),
      (match) => match[1],
    ),
    [
      "App Id",
      "Job Id",
      "Status",
      "SubStatus",
      "Type",
      "Work Type",
      "Scheduled Datetime",
      "Balance",
      "Certificates (VEECs)",
      "Submission",
      "Invoiced",
      "Field Worker",
      "Agent",
      "Client",
      "Customer",
      "Company Name",
      "Ext Cust Ref",
      "Phone",
      "Mobile",
      "Email",
      "Address",
      "Suburb",
      "Postcode",
    ],
  );
  assert.match(
    jobColumns,
    /DATAFORCE_JOB_CSV_HEADERS\.map\(\(label\) => \(\{/,
  );
  assert.doesNotMatch(jobColumns, /label:\s*"Row"|key:\s*"actions"/);
  for (const label of [
    "Work &amp; personnel",
    "Status &amp; location",
    "Display",
  ]) {
    assert.match(advancedFilters, new RegExp(label));
  }
  assert.doesNotMatch(
    sourceSection(workspaceStyles, ".jobTable {", ".jobTable caption"),
    /display:\s*none/,
  );
  assert.match(workspaceStyles, /\.tableViewport\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(
    workspaceStyles,
    /\.workspace\s*\{[\s\S]*display:\s*flex[\s\S]*height:\s*100%[\s\S]*overflow:\s*hidden/,
  );
  assert.match(
    workspaceStyles,
    /\.panelViewport\s*\{[\s\S]*overflow-y:\s*auto/,
  );
  assert.match(
    workspaceStyles,
    /\.panelViewport\[data-panel="jobs"\]\s*\{[\s\S]*overflow:\s*hidden/,
  );
  assert.match(
    workspaceStyles,
    /\.panelTabs\s*\{[\s\S]*overflow-y:\s*hidden/,
  );
  assert.doesNotMatch(workspaceStyles, /\.workspace\[data-panel="jobs"\] \.header/);
  assert.match(workspace, /role="tablist"/);
  assert.match(workspace, /role="tabpanel"/);
  assert.match(workspace, /aria-selected=\{panel === key\}/);
  assert.match(workspace, /aria-labelledby=\{`creditex-veu-pilot-tab-\$\{panel\}`\}/);
  assert.match(workspace, /aria-label="Search all populated job data"/);
  assert.match(workspace, /placeholder="Search all populated job data"/);
  assert.ok(
    workspace.indexOf("Density")
      < workspace.indexOf('className={styles.registerSearch}'),
  );
  assert.ok(
    workspace.indexOf('className={styles.registerSearch}')
      < workspace.indexOf('aria-label="Advanced search"'),
  );
  assert.match(
    workspace,
    /className=\{styles\.registerTools\}[\s\S]*aria-label="Refresh jobs"[\s\S]*>\s*Refresh\s*<\/span>[\s\S]*aria-label="Advanced search"/,
  );
  assert.match(workspace, />\s*Advanced search\s*<\/span>/);
  assert.match(workspace, />\s*Filters\s*<\/span>/);
  assert.match(workspace, /className=\{styles\.densityControl\}/);
  assert.match(workspace, /aria-label="Job row density"/);
  assert.match(
    workspace,
    /if \(column\.label === "App Id"\)[\s\S]*className=\{styles\.rowActionButton\}/,
  );
  assert.match(workspace, /data-column=\{column\.key\}/);
  assert.match(
    workspace,
    /\{PILOT_JOB_COLUMNS\.length\} Dataforce columns/,
  );
  assert.match(
    workspaceStyles,
    /\.registerTools label\s*\{[\s\S]*display:\s*inline-flex[\s\S]*align-items:\s*center/,
  );
  assert.match(
    workspaceStyles,
    /@media \(max-width: 480px\)[\s\S]*\.compactButtonLabel\s*\{[\s\S]*display:\s*inline/,
  );
  for (const expression of [
    "job.scenario",
    "installer.company_code",
    "technician.technician_code",
    "detail.invoice_status",
    "customer.email",
    "customer.phone",
    "site.address_state",
    "appointment.status",
  ]) {
    assert.match(server, new RegExp(`"${expression.replaceAll(".", "\\.")}"`));
  }
  assert.match(
    server,
    /PILOT_SEARCH_EXPRESSIONS\.map[\s\S]*REPLACE\(LOWER\(CAST\(COALESCE/,
  );
  assert.match(workspaceStyles, /--pilot-canvas:\s*#020b18/);
  assert.match(workspaceStyles, /--pilot-teal:\s*#20cbb8/);
  assert.match(workspace, /Append-only review ledger/);
  assert.match(manualEvidenceWorkspace, /Form builder/);
  assert.match(manualEvidenceWorkspace, /Manual jobs/);
  assert.match(manualEvidenceWorkspace, /Installer preview/);
  assert.match(manualEvidenceWorkspace, /Submit for Creditex audit/);
  assert.match(calculationWorkspace, /National certificate calculation workspace/);
  assert.match(calculationWorkspace, /Estimate STCs/);
  assert.match(calculationWorkspace, /REBATE CALCULATOR/);
  assert.match(calculationWorkspace, /NSW-PDRS-2026/);
  assert.match(calculationWorkspace, /NSW-ESS-2026/);
  assert.match(calculationWorkspace, /Victorian Energy Upgrades/);
  assert.match(calculationWorkspace, /Choose brand/);
  assert.match(calculationWorkspace, /Choose model/);
  assert.match(calculationWorkspace, /\/api\/creditex\/official-products/);
  assert.match(calculationWorkspace, /\/api\/creditex\/program-estimates/);
  assert.match(
    calculationWorkspace,
    /Final eligibility is checked before certificate creation/,
  );
  assert.match(calculationWorkspace, /Activity calculation readiness/);
  assert.match(calculationWorkspace, /\/api\/creditex\/stc-estimates/);
  assert.match(calculationWorkspace, /Estimate only/);
  assert.match(portal, /options: \{ requestTimeoutMs\?: number \} = \{\}/);
  assert.match(portal, /options\.requestTimeoutMs \?\? 20_000/);
  assert.match(portal, /requestTimeoutMs \/ 1_000/);
  assert.match(sresCalculator, /requestTimeoutMs: 90_000/);
  assert.match(allProgramCalculator, /requestTimeoutMs: 300_000/);
  assert.match(calculationWorkspace, /Safety certification date/);
  assert.doesNotMatch(calculationWorkspace, /Site-assessed hours \| audit required/);
  assert.match(workspace, /Controlled submission boundary/);
  assert.match(workspace, /External submission blocked/);
  assert.match(workspace, /No public national calculation API exists/);
  assert.match(
    workspaceStyles,
    /\.registerTools \.filterToggle\[aria-expanded="true"\]\s*\{[\s\S]*border-color:\s*var\(--pilot-line-strong\)[\s\S]*background:\s*#0d2a39[\s\S]*color:\s*var\(--pilot-ink\)/,
  );
  assert.match(
    workspaceStyles,
    /\.jobRegister > header \.registerTools button,[\s\S]*height:\s*28px[\s\S]*max-height:\s*28px/,
  );
  assert.match(workspace, /Exact staged-row binding available/);
  assert.match(workspace, /External transport remains blocked/);
  assert.match(
    portalStyles,
    /\.pilotShell\s*\{[\s\S]*background:\s*#020b18/,
  );
  assert.match(
    portalStyles,
    /\.pilotFrame \.topbar\s*\{[\s\S]*background:\s*#031524/,
  );
  assert.match(
    workspaceStyles,
    /\.jobTable\s*\{[\s\S]*font-size:\s*0\.75rem/,
  );
  assert.match(
    workspaceStyles,
    /\.jobWorkspace\[data-density="comfortable"\] \.jobTable\s*\{[\s\S]*font-size:\s*0\.8rem/,
  );
  assert.match(
    workspaceStyles,
    /\.statusCell,[\s\S]*\.mappingCell\s*\{[\s\S]*font-size:\s*0\.72rem/,
  );
  assert.match(
    workspaceStyles,
    /\.filterDrawer\s*\{[\s\S]*position:\s*absolute[\s\S]*transform:\s*translateX\(102%\)/,
  );
  assert.match(
    workspaceStyles,
    /\.filterDrawer\[data-open="true"\]\s*\{[\s\S]*transform:\s*translateX\(0\)/,
  );
  assert.match(
    workspaceStyles,
    /\.filterDrawer\s*\{[\s\S]*width:\s*min\(19rem,/,
  );
  assert.match(
    workspace,
    /import \{[\s\S]*CreditexVeuJobAuditWorkspace[\s\S]*\} from "\.\/CreditexVeuJobAuditWorkspace"/,
  );
  assert.match(workspace, /onDoubleClick=\{\(event\) =>/);
  assert.match(workspace, /onContextMenu=\{\(event\) =>/);
  assert.match(workspace, /JOB_CONTEXT_ITEMS\.map/);
  assert.match(workspace, /APPOINTMENT_CONTEXT_ITEMS\.map/);
  assert.match(workspace, /<CreditexVeuJobAuditWorkspace/);
  assert.equal(
    (workspace.match(/onClick=\{onCopySelection\}/g) || []).length,
    2,
  );
  assert.doesNotMatch(
    workspace,
    /Copy Selection[\s\S]{0,250}disabled|disabled[\s\S]{0,250}Copy Selection/,
  );
  assert.match(workspace, /const detail = await openRecord\(job, "print_preview"\)/);
  assert.match(workspace, /window\.requestAnimationFrame\(\(\) =>[\s\S]*window\.print\(\)/);
  assert.match(workspace, /\{filtersOpen && \([\s\S]*<AdvancedRegisterFilters/);
  assert.match(
    workspace,
    /drawerElement\.addEventListener\("keydown", trapFocus\)/,
  );
  assert.match(
    workspace,
    /window\.setTimeout\(\(\) =>[\s\S]*\(focusable\[0\] \|\| drawerElement\)\.focus\(\)/,
  );
  assert.match(
    workspace,
    /className=\{styles\.advancedFilters\}[\s\S]*role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="creditex-advanced-register-filters-title"/,
  );
  assert.match(
    workspace,
    /className=\{styles\.jobRegister\} inert=\{filtersOpen\}/,
  );
  assert.match(
    workspace,
    /className=\{styles\.panelTabs\}[\s\S]{0,120}inert=\{filtersOpen\}/,
  );
  assert.match(
    workspace,
    /document\.addEventListener\([\s\S]*"pointerdown"[\s\S]*closeSortMenuOnOutsidePointer[\s\S]*true/,
  );
  assert.match(
    workspace,
    /target\?\.closest\("\[data-sort-menu\]"\)/,
  );
  assert.match(
    workspace,
    /aria-expanded=\{open\}/,
  );
  assert.match(
    workspace,
    /event\.key !== "Escape" \|\| !open[\s\S]*closeAndRestoreFocus\(\)/,
  );
  assert.equal(
    (sortHeader.match(/closeAndRestoreFocus\(\)/g) || []).length,
    5,
  );
  assert.match(
    sortHeader,
    /onSort\(column\.sortKey!, "asc"\);[\s\S]{0,120}closeAndRestoreFocus\(\)/,
  );
  assert.match(
    sortHeader,
    /onSort\(column\.sortKey!, "desc"\);[\s\S]{0,120}closeAndRestoreFocus\(\)/,
  );
  assert.match(
    sortHeader,
    /onSort\("jobId", "asc"\);[\s\S]{0,120}closeAndRestoreFocus\(\)/,
  );
  assert.match(
    sourceSection(
      workspace,
      "async function copyJobRow",
      "async function openPrint",
    ),
    /finally\s*\{\s*closeContextMenu\(\);\s*\}/,
  );
  assert.match(
    auditWorkspaceStyles,
    /\.workspace\s*\{[\s\S]*position:\s*fixed[\s\S]*inset:\s*0/,
  );
  assert.match(auditWorkspaceStyles, /background:\s*#020b18/);
  assert.match(
    auditWorkspaceStyles,
    /background:\s*linear-gradient\(135deg, #031524, #075b59\)/,
  );
  assert.match(auditWorkspace, /detailMatchesJob\(job, detail\)/);
  assert.match(auditWorkspace, /disabled=\{writeBlocked\}/);
  assert.match(auditWorkspace, /detail\.customerJobs\.map/);
  assert.match(auditWorkspace, /detail\.appointmentAudit\.revisions\.filter/);
  assert.match(auditWorkspace, /detail\.appointmentAudit\.rescheduleRequests\.filter/);
  assert.match(auditWorkspace, /detail\.appointmentAudit\.rescheduleEvents\.filter/);
  for (const provenanceField of [
    "revision.changedByUid",
    "request.accessNotes",
    "request.decisionNote",
    "request.decidedByUid",
    "event.actorUid",
  ]) {
    assert.match(auditWorkspace, new RegExp(provenanceField.replace(".", "\\.")));
  }
  assert.match(
    auditWorkspace,
    /detail\.boundaries\.regulatedCasesCreated/,
  );
  assert.match(
    auditWorkspace,
    /detail\.boundaries\.complianceEvidenceCreated/,
  );
  assert.match(
    auditWorkspace,
    /detail\.boundaries\.submissionItemsCreated/,
  );
  assert.match(auditWorkspace, /Job-level regulated records/);
  assert.doesNotMatch(workspace, /boundaries=\{snapshot\.boundaries\}/);
  assert.doesNotMatch(auditWorkspace, /boundaries\?\.regulatedCasesCreated/);
  assert.match(
    auditWorkspace,
    /media\.filter\(\(item\) => item\.originalHashPresent\)\.length/,
  );
  assert.match(auditWorkspace, /disabled=\{!detailReady\}/);
  assert.match(
    auditWorkspace,
    /\{leftOpen && <aside className=\{styles\.leftRail\}/,
  );
  assert.match(
    auditWorkspace,
    /\{rightOpen && <aside className=\{styles\.rightRail\}/,
  );
  for (const section of [
    "customer_details",
    "customer_jobs",
    "customer_files",
    "customer_create_job",
    "job_summary",
    "job_appointments",
    "job_actions",
    "job_questions",
    "job_quote_invoice",
    "job_calculations",
    "job_transactions",
    "job_files",
    "job_issues",
    "job_emails",
    "job_history",
    "appointment_summary",
    "appointment_actions",
    "appointment_questions",
    "appointment_certificate_submissions",
    "appointment_decommissioning",
    "appointment_correspondence",
    "appointment_audit",
    "appointment_history",
    "print_preview",
  ]) {
    assert.match(
      auditWorkspace,
      new RegExp(`section: "${section}"`),
      `Missing full-record workspace section ${section}`,
    );
  }
  assert.match(
    workspace,
    /Exercise every VEU activity family across synthetic installer\s*records, field assignments and Creditex compliance workflow\s*structure/,
  );
  assert.match(workspace, /Physical field capture is not enabled/);
  assert.match(
    workspace,
    /These records\s*can never become regulated cases, certificates, registry\s*submissions, trades or settlements/,
  );
  assert.match(
    workspace,
    /The database rejects any regulated compliance case or\s*submission item linked to a synthetic pilot work order/,
  );
  assert.match(
    workspace,
    /zero regulator acceptances because no regulator request is sent,\s*and no staged Dataforce or Runabout row can create a customer,\s*job, regulated case, certificate, submission, trade or\s*settlement/,
  );

  assert.match(
    portal,
    /import \{ CreditexVeuPilotWorkspace \} from "\.\/CreditexVeuPilotWorkspace"/,
  );
  assert.match(portal, /id="creditex-tab-pilot"/);
  assert.match(portal, /aria-controls="creditex-panel-pilot"/);
  assert.match(portal, /tab === "pilot"/);
  assert.match(
    portal,
    /<CreditexVeuPilotWorkspace api=\{api\} role=\{session\.role\} \/>/,
  );
});
