import assert from "node:assert/strict";
import {
  CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS,
  canonicalCreditexJobLifecycleSchemaGuardSql,
} from "../../src/lib/creditex-job-lifecycle-schema-guards.ts";

export const FIELD_CORRECTION_GUARD_NAMES = CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS
  .filter(({ name }) => name.startsWith("trade_activity_field_"))
  .map(({ name }) => name);

export const JOB_LIFECYCLE_GUARD_NAMES = CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS
  .filter(({ name }) => name.startsWith("creditex_job_") || name === "creditex_completed_workpack_correction_guard"
    || name === "trade_job_cancel_completion_history_guard")
  .map(({ name }) => name);

export const REGISTRY_BATCH_GUARD_NAMES = CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS
  .filter(({ name }) => name.startsWith("creditex_registry_batch_"))
  .map(({ name }) => name);

// Unit fixtures deliberately contain only the tables for the subsystem under
// test. Install and verify that subsystem's exact production trigger bodies;
// the full-schema Sites regression tests exercise the production bootstrap.
export function lifecycleGuardFixture(database, names) {
  assert.ok(names.length > 0, "An explicit guard scope is required");
  const definitions = names.map(name => {
    const definition = CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS.find(item => item.name === name);
    assert.ok(definition, `Unknown lifecycle guard ${name}`);
    return definition;
  });
  for (const definition of definitions) database.exec(definition.sql);
  return {
    async ensureCreditexJobLifecycleSchemaGuards() {
      for (const definition of definitions) {
        const installed = database.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(definition.name);
        assert.equal(canonicalCreditexJobLifecycleSchemaGuardSql(installed?.sql || ""),
          canonicalCreditexJobLifecycleSchemaGuardSql(definition.sql), definition.name);
      }
    },
  };
}

export function lifecycleGuardDependency(names) {
  assert.ok(names.length > 0, "An explicit guard scope is required");
  const definitions = names.map(name => {
    const definition = CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS.find(item => item.name === name);
    assert.ok(definition, `Unknown lifecycle guard ${name}`);
    return definition;
  });
  return {
    async ensureCreditexJobLifecycleSchemaGuards(database) {
      for (const definition of definitions) await database.prepare(definition.sql).run();
      const installed = await database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
      for (const definition of definitions) {
        const row = installed.results.find(item => item.name === definition.name);
        assert.equal(canonicalCreditexJobLifecycleSchemaGuardSql(row?.sql || ""),
          canonicalCreditexJobLifecycleSchemaGuardSql(definition.sql), definition.name);
      }
    },
  };
}
