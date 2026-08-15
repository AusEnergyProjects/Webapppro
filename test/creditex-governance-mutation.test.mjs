import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const source = fs.readFileSync(
  new URL("../src/lib/creditex-compliance-server.ts", import.meta.url),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: "creditex-compliance-server.ts",
}).outputText;
const moduleRecord = { exports: {} };
const require = (specifier) => {
  if (specifier === "./creditex-schema-guards") {
    return { ensureCreditexSchemaGuards: async () => {} };
  }
  if (specifier === "./creditex-source-lookup-review-server") {
    return {
      CreditexSourceLookupReviewError: class extends Error {},
      requireCurrentApprovedOfficialSourceBinding: async () => (
        "test-approved-binding"
      ),
    };
  }
  if (specifier === "./creditex-activity-work-pack-server") {
    return {
      CreditexActivityWorkPackServerError: class extends Error {},
      prepareCreditexActivityWorkPackAttachment: async () => {
        throw new Error("Unexpected work-pack attachment in governance test");
      },
      resolvePublishedCreditexActivityWorkPack: async () => {
        throw new Error("Unexpected work-pack resolution in governance test");
      },
    };
  }
  throw new Error(`Unexpected module dependency: ${specifier}`);
};
new Function("require", "module", "exports", output)(
  require,
  moduleRecord,
  moduleRecord.exports,
);
const { runComplianceGovernanceMutation } = moduleRecord.exports;

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }
}

function testD1(database) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    async batch(statements) {
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

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE compliance_organisations (
      id text PRIMARY KEY NOT NULL
    );
    CREATE TABLE compliance_write_guards (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      operation_id text NOT NULL,
      step_number integer NOT NULL CHECK (step_number > 0),
      verified integer NOT NULL CHECK (verified = 1),
      created_at text NOT NULL,
      UNIQUE (operation_id, step_number)
    );
    CREATE TABLE compliance_audit_events (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      actor_type text NOT NULL,
      actor_uid text NOT NULL,
      event_type text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      summary text NOT NULL,
      metadata text NOT NULL CHECK (json_valid(metadata)),
      created_at text NOT NULL
    );
    CREATE TABLE governed_state (
      id text PRIMARY KEY NOT NULL,
      revision integer NOT NULL,
      label text NOT NULL
    );
    INSERT INTO compliance_organisations (id) VALUES ('org');
    INSERT INTO governed_state (id, revision, label)
      VALUES ('target', 1, 'initial');
  `);
  return { database, d1: testD1(database) };
}

const member = { uid: "named-admin", organisationId: "org" };
const audit = {
  eventType: "governance.test",
  targetType: "fixture",
  targetId: "target",
  summary: "A governed test mutation completed.",
};

test("every required governance statement is guarded before audit", async () => {
  const { database, d1 } = fixture();
  await runComplianceGovernanceMutation(
    d1,
    member,
    [
      d1.prepare("UPDATE governed_state SET label = 'unused' WHERE id = 'missing'"),
      d1.prepare("UPDATE governed_state SET revision = 2 WHERE id = 'target' AND revision = 1"),
      d1.prepare("UPDATE governed_state SET label = 'complete' WHERE id = 'target' AND revision = 2"),
    ],
    audit,
    { optionalStatementIndexes: [0] },
    "2026-08-01T00:00:00.000Z",
  );

  const state = database.prepare(
    "SELECT revision, label FROM governed_state",
  ).get();
  assert.equal(state.revision, 2);
  assert.equal(state.label, "complete");
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_write_guards").get().count,
    2,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_audit_events").get().count,
    1,
  );
});

test("a stale intermediate required write rolls back later state and audit", async () => {
  const { database, d1 } = fixture();
  await assert.rejects(
    runComplianceGovernanceMutation(
      d1,
      member,
      [
        d1.prepare("UPDATE governed_state SET revision = 2 WHERE id = 'target' AND revision = 99"),
        d1.prepare("UPDATE governed_state SET label = 'must-not-persist' WHERE id = 'target'"),
      ],
      audit,
      {},
      "2026-08-01T00:00:00.000Z",
    ),
    /CHECK constraint failed: verified = 1/,
  );

  const state = database.prepare(
    "SELECT revision, label FROM governed_state",
  ).get();
  assert.equal(state.revision, 1);
  assert.equal(state.label, "initial");
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_write_guards").get().count,
    0,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_audit_events").get().count,
    0,
  );
});
