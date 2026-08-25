import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  canonicalCreditexWorkPackSchemaGuardSql,
  CREDITEX_WORK_PACK_REQUIRED_SCHEMA_TABLES,
  CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS,
  CREDITEX_WORK_PACK_SCHEMA_GUARD_REPLACEMENT_DEFINITIONS,
  ensureCreditexWorkPackSchemaGuards,
} from "../src/lib/creditex-work-pack-schema-guards.ts";
import {
  CREDITEX_OFFICIAL_SOURCE_CUSTODY_SCHEMA_GUARD_DEFINITIONS,
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const migrationNames = [
  "0142_creditex_activity_work_packs.sql",
  "0143_creditex_admin_official_source_capture.sql",
  "0144_creditex_output_actions.sql",
  "0145_creditex_server_fetched_official_source_custody.sql",
  "0146_creditex_sres_certificate_activation_evidence.sql",
  "0147_creditex_controlled_product_permission_sources.sql",
];

function migration(name) {
  return fs.readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
}

function testD1(database) {
  class Statement {
    constructor(sql, values = []) {
      this.sql = sql;
      this.values = values;
    }
    bind(...values) {
      return new Statement(this.sql, values);
    }
    async all() {
      return { results: database.prepare(this.sql).all(...this.values) };
    }
    async run() {
      const result = database.prepare(this.sql).run(...this.values);
      return { success: true, meta: { changes: Number(result.changes) } };
    }
  }
  return {
    prepare(sql) {
      return new Statement(sql);
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function triggerlessSchemaDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const name of [migrationNames[0], migrationNames[2], migrationNames[4]]) {
    database.exec(migration(name));
  }
  return database;
}

test("Sites migrations 0142 through 0147 contain no trigger statements", () => {
  for (const [index, name] of migrationNames.entries()) {
    const sql = migration(name);
    assert.doesNotMatch(sql, /\bCREATE\s+TRIGGER\b/i, name);
    assert.doesNotMatch(sql, /\bDROP\s+TRIGGER\b/i, name);
    assert.match(
      sql,
      index % 2 === 0
        ? /creditex-work-pack-schema-guards\.ts/
        : /creditex-schema-guards\.ts/,
      name,
    );
  }
});

test("the prepared-statement guard inventory is exact and complete", () => {
  assert.equal(CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.length, 72);
  assert.equal(CREDITEX_WORK_PACK_REQUIRED_SCHEMA_TABLES.length, 16);
  assert.equal(
    new Set(CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.map((item) => item.name)).size,
    CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.length,
  );
  assert.ok(CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.every(
    (definition) => definition.sql.startsWith("CREATE TRIGGER IF NOT EXISTS ")
      && definition.sql.endsWith("END;"),
  ));
  for (const prefix of [
    "compliance_work_pack_",
    "compliance_output_action_",
    "compliance_sres_",
  ]) {
    assert.ok(CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.some(
      (definition) => definition.name.startsWith(prefix),
    ));
  }
});

test("the SRES activation guards stay below D1 expression depth without weakening custody checks", () => {
  const snapshotNames = new Set([
    "compliance_sres_activation_snapshot_insert_guard",
    "compliance_sres_activation_snapshot_compliance_author_guard",
    "compliance_sres_activation_snapshot_admin_author_guard",
    "compliance_sres_activation_snapshot_record_binding_guard",
    "compliance_sres_activation_snapshot_record_freshness_guard",
    "compliance_sres_activation_snapshot_record_review_guard",
    "compliance_sres_activation_snapshot_completeness_guard",
  ]);
  const outputNames = new Set([
    "compliance_sres_output_action_activation_guard",
    "compliance_sres_output_action_record_binding_guard",
    "compliance_sres_output_action_record_freshness_guard",
    "compliance_sres_output_action_record_review_guard",
  ]);
  const snapshotGuards = CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.filter(
    (definition) => snapshotNames.has(definition.name),
  );
  const outputGuards = CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.filter(
    (definition) => outputNames.has(definition.name),
  );
  const snapshotGuard = snapshotGuards.map((definition) => definition.sql).join("\n");
  const outputGuard = outputGuards.map((definition) => definition.sql).join("\n");

  assert.equal(snapshotGuards.length, 7);
  assert.equal(outputGuards.length, 4);
  assert.ok([...snapshotGuards, ...outputGuards].every(
    (definition) => (definition.sql.match(/SELECT CASE/g) ?? []).length === 1,
  ));

  assert.equal(
    (snapshotGuard.match(/COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_RECORD_INVALID/g) ?? []).length,
    3,
  );
  assert.match(snapshotGuard, /COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_AUTHOR_INVALID/);
  assert.match(snapshotGuard, /COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_INCOMPLETE/);
  assert.match(snapshotGuard, /successor\.supersedes_record_id = record\.id/);
  assert.match(snapshotGuard, /successor\.supersedes_decision_id = source_review\.id/);
  assert.match(
    snapshotGuard,
    /COUNT\(DISTINCT json_extract\(item\.value, '\$\.evidenceKind'\)\)/,
  );

  assert.equal(
    (outputGuard.match(/COMPLIANCE_SRES_OUTPUT_ACTIVATION_INVALID/g) ?? []).length,
    4,
  );
  assert.match(outputGuard, /json_each\(activation\.snapshot_json, '\$\.records'\)/);
  assert.match(outputGuard, /successor\.supersedes_record_id = record\.id/);
  assert.match(outputGuard, /successor\.supersedes_decision_id = source_review\.id/);
});

test("runtime installation restores all guards before direct guarded work", async () => {
  const database = triggerlessSchemaDatabase();
  database.exec(`
    INSERT INTO compliance_output_action_events (
      id, organisation_id, packet_id, sequence, from_status, to_status,
      actor_kind, actor_uid, adapter_receipt_id, summary, metadata,
      occurred_at, created_at
    ) VALUES (
      'event-before-guards', 'org', 'packet', 1, '', 'prepared',
      'compliance', 'actor', '', 'Prepared packet event.', '{}',
      '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'
    );
  `);

  const d1 = testD1(database);
  await ensureCreditexWorkPackSchemaGuards(d1);
  await ensureCreditexWorkPackSchemaGuards(d1);

  const installed = database.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name",
  ).all();
  assert.equal(installed.length, 72);
  for (const definition of CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS) {
    const row = installed.find((item) => item.name === definition.name);
    assert.ok(row, definition.name);
    assert.equal(
      canonicalCreditexWorkPackSchemaGuardSql(row.sql),
      canonicalCreditexWorkPackSchemaGuardSql(definition.sql),
      definition.name,
    );
  }
  assert.throws(
    () => database.prepare(`UPDATE compliance_output_action_events
      SET summary = 'Changed immutable event.'
      WHERE id = 'event-before-guards'`).run(),
    /COMPLIANCE_OUTPUT_ACTION_EVENT_IMMUTABLE/,
  );
  database.close();
});

test("runtime installation atomically replaces only exact known SRES predecessors", async () => {
  const database = triggerlessSchemaDatabase();
  for (const replacement of CREDITEX_WORK_PACK_SCHEMA_GUARD_REPLACEMENT_DEFINITIONS) {
    database.exec(replacement.previousSql);
  }

  await ensureCreditexWorkPackSchemaGuards(testD1(database));

  const installed = new Map(database.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'",
  ).all().map((row) => [row.name, row.sql]));
  for (const replacement of CREDITEX_WORK_PACK_SCHEMA_GUARD_REPLACEMENT_DEFINITIONS) {
    const current = CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.find(
      (definition) => definition.name === replacement.name,
    );
    assert.ok(current, replacement.name);
    assert.equal(
      canonicalCreditexWorkPackSchemaGuardSql(installed.get(replacement.name)),
      canonicalCreditexWorkPackSchemaGuardSql(current.sql),
      replacement.name,
    );
  }
  database.close();
});

test("runtime installation fails closed for absent tables and mismatched guards", async () => {
  const missing = new DatabaseSync(":memory:");
  await assert.rejects(
    ensureCreditexWorkPackSchemaGuards(testD1(missing)),
    /CREDITEX_WORK_PACK_SCHEMA_MIGRATIONS_REQUIRED/,
  );
  missing.close();

  const mismatched = triggerlessSchemaDatabase();
  mismatched.exec(`CREATE TRIGGER compliance_output_action_event_update_guard
    BEFORE UPDATE ON compliance_output_action_events
    BEGIN SELECT RAISE(ABORT, 'weaker guard'); END;`);
  await assert.rejects(
    ensureCreditexWorkPackSchemaGuards(testD1(mismatched)),
    /CREDITEX_WORK_PACK_SCHEMA_GUARD_MISMATCH:compliance_output_action_event_update_guard/,
  );
  mismatched.close();
});

test("official-source guards removed from 0143, 0145 and 0147 remain runtime-owned", () => {
  assert.equal(CREDITEX_OFFICIAL_SOURCE_CUSTODY_SCHEMA_GUARD_DEFINITIONS.length, 3);
  for (const name of [
    "compliance_official_source_artifacts_actor_guard",
    "compliance_official_source_artifacts_no_update",
    "compliance_official_source_artifacts_no_delete",
  ]) {
    const definition = CREDITEX_SCHEMA_GUARD_DEFINITIONS.find(
      (item) => item.name === name,
    );
    assert.ok(definition, name);
    assert.match(definition.sql, /^CREATE TRIGGER IF NOT EXISTS /);
    assert.ok(
      CREDITEX_OFFICIAL_SOURCE_CUSTODY_SCHEMA_GUARD_DEFINITIONS.some(
        (item) => item.name === name,
      ),
      `${name}: scoped custody guard`,
    );
  }
});

function functionSlice(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, functionName);
  const remainder = source.slice(start + 1);
  const next = remainder.search(/\n(?:export )?(?:async )?function |\nexport type /);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}

function assertGuardBeforeQuery(source, functionName, guardCall, queryCall) {
  const body = functionSlice(source, functionName);
  const guard = body.indexOf(guardCall);
  const query = body.indexOf(queryCall);
  assert.notEqual(guard, -1, `${functionName}: guard call`);
  assert.notEqual(query, -1, `${functionName}: database query`);
  assert.ok(guard < query, `${functionName}: guard must precede database query`);
}

test("every direct work-pack read boundary installs guards before its first query", () => {
  const activity = fs.readFileSync(
    new URL("../src/lib/creditex-activity-work-pack-server.ts", import.meta.url),
    "utf8",
  );
  const output = fs.readFileSync(
    new URL("../src/lib/creditex-output-action-server.ts", import.meta.url),
    "utf8",
  );
  const sres = fs.readFileSync(
    new URL("../src/lib/creditex-sres-certificate-activation-server.ts", import.meta.url),
    "utf8",
  );
  const compliance = fs.readFileSync(
    new URL("../src/lib/creditex-compliance-server.ts", import.meta.url),
    "utf8",
  );
  const sync = fs.readFileSync(
    new URL("../src/app/api/trade-team/sync/route.ts", import.meta.url),
    "utf8",
  );
  const custody = fs.readFileSync(
    new URL("../src/lib/creditex-official-source-custody-server.ts", import.meta.url),
    "utf8",
  );
  for (const functionName of [
    "resolvePublishedCreditexActivityWorkPack",
    "assignedInstanceRow",
    "listAssignedCreditexActivityWorkPacks",
    "governanceIdentity",
  ]) {
    assertGuardBeforeQuery(
      activity,
      functionName,
      "await ensureCreditexWorkPackSchemaGuards(database)",
      "database.prepare",
    );
  }
  assertGuardBeforeQuery(
    activity,
    "projectAssignedInstance",
    "await ensureCreditexWorkPackSchemaGuards(database)",
    "resolvePinnedCreditexActivityWorkPack(database",
  );
  for (const functionName of [
    "loadCreditexOutputAction",
    "listCreditexOutputActionReceipts",
    "loadCreditexOutputActionReceipt",
  ]) {
    assertGuardBeforeQuery(
      output,
      functionName,
      "await ensureCreditexWorkPackSchemaGuards(database)",
      "database.prepare",
    );
  }
  assertGuardBeforeQuery(
    output,
    "outputActorCapabilities",
    "await ensureCreditexWorkPackSchemaGuards(database)",
    "loadCreditexWorkPackGovernanceIdentity(database",
  );
  assertGuardBeforeQuery(
    sres,
    "activationIdentity",
    "await ensureCreditexWorkPackSchemaGuards(database)",
    "database.prepare",
  );
  assertGuardBeforeQuery(
    compliance,
    "autoOpenReadyPlannedComplianceWorkPacks",
    "await ensureCreditexWorkPackSchemaGuards(database)",
    "database.prepare",
  );
  assertGuardBeforeQuery(
    sync,
    "fieldFinishState",
    "await ensureCreditexWorkPackSchemaGuards(db)",
    "db.prepare",
  );
  assertGuardBeforeQuery(
    custody,
    "captureOfficialSourceArtifact",
    "await ensureCreditexOfficialSourceCustodySchemaGuards(database)",
    "existingCapture(",
  );
});
