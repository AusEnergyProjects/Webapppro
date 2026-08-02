import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const contractSource = read("../src/lib/creditex-dataforce-job-csv.ts");
const serverSource = read("../src/lib/creditex-dataforce-import-server.ts");
const routeSource = read("../src/app/api/creditex/dataforce/route.ts");
const migrationSource = read("../drizzle/0100_creditex_dataforce_staging.sql");

function loadModule(source, fileName, dependencies = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
  }).outputText;
  const record = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    record,
    record.exports,
  );
  return record.exports;
}

const contract = loadModule(
  contractSource,
  "creditex-dataforce-job-csv.ts",
);
const server = loadModule(
  serverSource,
  "creditex-dataforce-import-server.ts",
  { "./creditex-dataforce-job-csv": contract },
);

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  first() {
    return this.database.first(this);
  }

  all() {
    return this.database.all(this);
  }
}

class FakeD1 {
  constructor() {
    this.batches = [];
    this.rows = [];
    this.audits = [];
    this.batchCalls = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  first(statement) {
    if (
      statement.sql.includes("FROM compliance_legacy_import_batches")
      && statement.sql.includes("content_sha256 = ?")
    ) {
      return this.batches.find((batch) => (
        batch.organisation_id === statement.bindings[0]
        && batch.content_sha256 === statement.bindings[1]
      )) || null;
    }
    throw new Error(`Unexpected first SQL: ${statement.sql}`);
  }

  all(statement) {
    if (statement.sql.includes("FROM compliance_legacy_import_batches")) {
      const organisationId = statement.bindings[0];
      return {
        results: this.batches
          .filter((batch) => batch.organisation_id === organisationId)
          .sort((left, right) => (
            right.created_at.localeCompare(left.created_at)
            || right.id.localeCompare(left.id)
          ))
          .slice(0, Number(statement.bindings[1])),
      };
    }
    throw new Error(`Unexpected all SQL: ${statement.sql}`);
  }

  async batch(statements) {
    this.batchCalls.push(statements);
    const results = [];
    for (const statement of statements) {
      if (
        statement.sql.includes(
          "INSERT INTO compliance_legacy_import_batches",
        )
      ) {
        const [
          id,
          organisationId,
          fileName,
          contentSha256,
          fileSizeBytes,
          rowCount,
          createdByUid,
          createdAt,
        ] = statement.bindings;
        const exists = this.batches.some((batch) => (
          batch.id === id
          || (
            batch.organisation_id === organisationId
            && batch.content_sha256 === contentSha256
          )
        ));
        if (!exists) {
          this.batches.push({
            id,
            organisation_id: organisationId,
            file_name: fileName,
            content_sha256: contentSha256,
            file_size_bytes: fileSizeBytes,
            row_count: rowCount,
            status: "staged_unmapped",
            regulated_job_creation_enabled: 0,
            created_by_uid: createdByUid,
            created_at: createdAt,
          });
        }
        results.push({ meta: { changes: exists ? 0 : 1 } });
      } else if (
        statement.sql.includes(
          "INSERT INTO compliance_legacy_import_rows",
        )
      ) {
        const rows = JSON.parse(statement.bindings[0]);
        for (const row of rows) {
          if (!this.rows.some((existing) => existing.id === row.id)) {
            this.rows.push(row);
          }
        }
        results.push({ meta: { changes: rows.length } });
      } else if (
        statement.sql.includes("INSERT INTO compliance_audit_events")
      ) {
        const [id, organisationId, actorUid, targetId, metadata, createdAt] =
          statement.bindings;
        if (!this.audits.some((audit) => audit.id === id)) {
          this.audits.push({
            id,
            organisationId,
            actorUid,
            targetId,
            metadata,
            createdAt,
          });
        }
        results.push({ meta: { changes: 1 } });
      } else {
        throw new Error(`Unexpected batch SQL: ${statement.sql}`);
      }
    }
    return results;
  }
}

const identity = {
  uid: "creditex-admin-uid",
  email: "admin@example.invalid",
  emailVerified: true,
  membershipId: "member-1",
  organisationId: "creditex-org-1",
  organisationCode: "CREDITEX",
  organisationLegalName: "Creditex",
  organisationTradingName: "Creditex",
  displayName: "Creditex Admin",
  role: "admin",
  governanceIdentityVerified: true,
};

function record(jobId, overrides = {}) {
  return {
    ...Object.fromEntries(
      contract.DATAFORCE_JOB_CSV_HEADERS.map((header) => [header, ""]),
    ),
    "App Id": `APP-${jobId}`,
    "Job Id": jobId,
    Status: "audited",
    SubStatus: "passed",
    "Work Type": "Home Energy Rating Assessment",
    Customer: "Sensitive Customer",
    Email: "sensitive.customer@example.com",
    Address: "1 Sensitive Street",
    ...overrides,
  };
}

test("stage import is bounded, immutable staging and idempotent per organisation and content hash", async () => {
  const database = new FakeD1();
  const csv = contract.exportDataforceJobCsv([
    record("JOB-1001"),
    record("JOB-1002"),
  ]);

  const first = await server.stageCreditexDataforceImport(
    database,
    identity,
    {
      fileName: String.raw`C:\Exports\jobs <latest>.csv`,
      csv,
    },
    { now: "2026-08-02T01:02:03.000Z" },
  );

  assert.deepEqual(first.validation.summary, {
    totalRows: 2,
    acceptedRows: 2,
    rejectedRows: 0,
    duplicateRows: 0,
  });
  assert.equal(first.batch.fileName, "jobs _latest_.csv");
  assert.equal(first.batch.status, "staged_unmapped");
  assert.equal(first.batch.reused, false);
  assert.equal(database.batches.length, 1);
  assert.equal(database.batches[0].regulated_job_creation_enabled, 0);
  assert.equal(database.rows.length, 2);
  assert.ok(database.rows.every((row) => (
    row.mappingStatus === "staged_unmapped"
    && /^[0-9a-f]{64}$/.test(row.rowSha256)
  )));
  assert.equal(database.audits.length, 1);
  assert.doesNotMatch(
    database.audits[0].metadata,
    /Sensitive Customer|sensitive\.customer|Sensitive Street/,
  );

  const capturedSql = database.batchCalls[0]
    .map((statement) => statement.sql)
    .join("\n");
  assert.doesNotMatch(
    capturedSql,
    /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:compliance_cases|trade_work_orders|compliance_certificate_lots|compliance_submission_batches|compliance_certificate_trades|compliance_settlements)/i,
  );

  const second = await server.stageCreditexDataforceImport(
    database,
    identity,
    { fileName: "renamed.csv", csv },
    { now: "2026-08-02T02:03:04.000Z" },
  );
  assert.equal(second.batch.id, first.batch.id);
  assert.equal(second.batch.fileName, first.batch.fileName);
  assert.equal(second.batch.reused, true);
  assert.equal(database.batchCalls.length, 1);
  assert.equal(database.rows.length, 2);
  assert.equal(database.audits.length, 1);

  const listed = await server.listCreditexDataforceImportBatches(
    database,
    identity,
  );
  assert.deepEqual(listed, [{
    id: first.batch.id,
    fileName: "jobs _latest_.csv",
    rowCount: 2,
    status: "staged_unmapped",
    createdAt: "2026-08-02T01:02:03.000Z",
  }]);
  assert.doesNotMatch(
    JSON.stringify(listed),
    /Sensitive Customer|sensitive\.customer|Sensitive Street|dataJson|jobId/,
  );
});

test("validation failures return bounded non-PII issues and perform no write", async () => {
  const database = new FakeD1();
  const csv = contract.exportDataforceJobCsv([
    record("JOB-DUPLICATE"),
    record("JOB-SECOND", {
      Customer: "Private Duplicate Person",
      Email: "private.duplicate@example.com",
    }),
  ]).replace('"JOB-SECOND"', '"JOB-DUPLICATE"');

  await assert.rejects(
    () => server.stageCreditexDataforceImport(
      database,
      identity,
      { fileName: "duplicate.csv", csv },
    ),
    (error) => {
      assert.equal(error.code, "DATAFORCE_IMPORT_VALIDATION_FAILED");
      assert.equal(error.status, 400);
      assert.equal(error.validation.summary.duplicateRows, 1);
      assert.ok(error.validation.issues.length <= 50);
      assert.doesNotMatch(
        JSON.stringify(error.validation),
        /Private Duplicate Person|private\.duplicate@example\.com/,
      );
      return true;
    },
  );
  assert.equal(database.batchCalls.length, 0);
});

test("storage limits reject oversized source and row counts before any staging write", async () => {
  const oversizedDatabase = new FakeD1();
  await assert.rejects(
    () => server.stageCreditexDataforceImport(
      oversizedDatabase,
      identity,
      {
        fileName: "oversized.csv",
        csv: "x".repeat(
          server.CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumSourceBytes + 1,
        ),
      },
    ),
    (error) => (
      error.code === "DATAFORCE_IMPORT_TOO_LARGE"
      && error.status === 413
      && error.validation.issues[0].code === "SOURCE_TOO_LARGE"
    ),
  );
  assert.equal(oversizedDatabase.batchCalls.length, 0);

  const rowLimitDatabase = new FakeD1();
  const headers = contract.DATAFORCE_JOB_CSV_HEADERS.join(",");
  const rows = Array.from(
    {
      length:
        server.CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumRows + 1,
    },
    (_, index) => {
      const values = Array(23).fill("");
      values[0] = `APP-${index + 1}`;
      values[1] = `JOB-${index + 1}`;
      return values.join(",");
    },
  );
  await assert.rejects(
    () => server.stageCreditexDataforceImport(
      rowLimitDatabase,
      identity,
      { fileName: "too-many.csv", csv: [headers, ...rows].join("\r\n") },
    ),
    (error) => (
      error.code === "DATAFORCE_IMPORT_TOO_MANY_ROWS"
      && error.status === 413
      && error.validation.summary.totalRows === 2_501
      && error.validation.issues.some(
        (issue) => issue.code === "CSV_TOO_MANY_ROWS",
      )
    ),
  );
  assert.equal(rowLimitDatabase.batchCalls.length, 0);
});

test("only Creditex administrators and case managers can stage imports", async () => {
  const database = new FakeD1();
  const csv = contract.exportDataforceJobCsv([record("JOB-ROLE")]);
  await assert.rejects(
    () => server.stageCreditexDataforceImport(
      database,
      { ...identity, role: "reviewer" },
      { fileName: "jobs.csv", csv },
    ),
    (error) => (
      error.code === "DATAFORCE_IMPORT_ROLE_REQUIRED"
      && error.status === 403
    ),
  );
  assert.equal(database.batchCalls.length, 0);
});

test("route and schema enforce authenticated no-store staging without regulated creation", () => {
  assert.match(routeSource, /if \(!sameOrigin\(request\)\)/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
  assert.match(routeSource, /requireFirebaseIdentity\(request\)/);
  assert.match(routeSource, /requireComplianceIdentity\(identity/);
  assert.match(
    routeSource,
    /\? \["admin", "case_manager"\]\s*: \["admin", "case_manager", "reviewer", "auditor"\]/,
  );
  assert.match(routeSource, /ensureCreditexPilotSchemaGuards\(database\)/);
  assert.match(routeSource, /"stage_import"/);
  assert.match(routeSource, /json\(\{ ok: true, \.\.\.result \}/);
  assert.match(routeSource, /json\(\{ ok: true, batches \}\)/);
  assert.doesNotMatch(routeSource, /export async function (PUT|PATCH|DELETE)/);

  assert.match(migrationSource, /file_size_bytes[^]*<= 5242880/);
  assert.match(migrationSource, /row_count[^]*<= 2500/);
  assert.match(
    migrationSource,
    /regulated_job_creation_enabled[^]*CHECK \(`regulated_job_creation_enabled` = 0\)/,
  );
  assert.match(
    migrationSource,
    /mapping_status[^]*CHECK \(`mapping_status` = 'staged_unmapped'\)/,
  );
  assert.doesNotMatch(
    serverSource,
    /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:compliance_cases|trade_work_orders|compliance_certificate_lots|compliance_submission_batches|compliance_certificate_trades|compliance_settlements)/i,
  );
});
