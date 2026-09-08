import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const routeFile = new URL(
  "../src/app/api/trade-team/work-packs/route.ts",
  import.meta.url,
);
const panelFile = new URL(
  "../src/components/TradeJobFilesPanel.tsx",
  import.meta.url,
);
const routeSource = readFileSync(routeFile, "utf8");
const panelSource = readFileSync(panelFile, "utf8");

class Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
}

function d1(database) {
  return { prepare: (sql) => new Statement(database, sql) };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY, firebase_uid text NOT NULL, partner_type text NOT NULL,
      record_status text NOT NULL, assignee_member_id text NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY, organisation_id text NOT NULL,
      work_order_id text NOT NULL, installer_uid text NOT NULL
    );
    CREATE TABLE compliance_activity_work_pack_instances (
      id text PRIMARY KEY, organisation_id text NOT NULL, instance_key text NOT NULL,
      compliance_case_id text NOT NULL, work_order_id text NOT NULL, revision integer NOT NULL
    );
    CREATE TABLE compliance_activity_work_pack_artifacts (
      id text PRIMARY KEY, organisation_id text NOT NULL, instance_key text NOT NULL,
      case_instance_id text NOT NULL, object_key text NOT NULL,
      original_file_name text NOT NULL, content_type text NOT NULL,
      size_bytes integer NOT NULL, original_sha256 text NOT NULL,
      integrity_receipt_id text NOT NULL, verification_state text NOT NULL,
      supersedes_artifact_id text NOT NULL
    );
    INSERT INTO trade_work_orders VALUES
      ('job-1', 'owner-1', 'installer', 'active', 'worker-1'),
      ('job-2', 'owner-1', 'installer', 'active', 'worker-2');
    INSERT INTO compliance_cases VALUES
      ('case-1', 'creditex', 'job-1', 'owner-1');
    INSERT INTO compliance_activity_work_pack_instances VALUES
      ('instance-1', 'creditex', 'pack-1', 'case-1', 'job-1', 1);
  `);
  return database;
}

function insertArtifact(database, bytes, overrides = {}) {
  const record = {
    id: "artifact-1",
    organisationId: "creditex",
    instanceKey: "pack-1",
    caseInstanceId: "instance-1",
    custodyLocator: "private/work-packs/evidence-1",
    fileName: "existing-unit.jpg",
    contentType: "image/jpeg",
    sizeBytes: bytes.byteLength,
    originalSha256: sha256(bytes),
    receiptId: "receipt-1",
    verificationState: "matched",
    supersedesArtifactId: "",
    ...overrides,
  };
  database.prepare(`INSERT INTO compliance_activity_work_pack_artifacts
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      record.id,
      record.organisationId,
      record.instanceKey,
      record.caseInstanceId,
      record.custodyLocator,
      record.fileName,
      record.contentType,
      record.sizeBytes,
      record.originalSha256,
      record.receiptId,
      record.verificationState,
      record.supersedesArtifactId,
    );
  return record;
}

function loadRoute({ database, bucket, scope }) {
  const output = ts.transpileModule(routeSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "src/app/api/trade-team/work-packs/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const calls = { scope: 0, byteResponse: [] };
  const mocks = {
    "../../../../../db": { getD1: () => d1(database) },
    "@/lib/admin-server": {
      adminJson: (value, status = 200) => Response.json(value, { status }),
    },
    "@/lib/bounded-json-request": {
      readBoundedJsonRequest: async (request) => request.json(),
    },
    "@/lib/creditex-custody-bucket": {
      getCreditexCustodyBucket: () => bucket,
    },
    "@/lib/creditex-activity-work-pack-server": {},
    "@/lib/creditex-compliance-server": {},
    "./_shared": {
      assignedWorkPackOrigin: () => null,
      assignedWorkPackRequestScope: async () => {
        calls.scope += 1;
        return scope;
      },
      assignedWorkPackBytesResponse: (retained) => {
        calls.byteResponse.push(retained);
        return new Response(retained.bytes, {
          status: 200,
          headers: {
            "Content-Type": retained.contentType,
            "Content-Disposition": `inline; filename="${retained.fileName}"`,
            "Cache-Control": "private, no-store",
            "X-Creditex-SHA256": retained.sha256,
          },
        });
      },
      assignedWorkPackError: (error) => Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "failed",
      }, { status: 500 }),
    },
  };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return { route: moduleRecord.exports, calls };
}

function artifactRequest(overrides = {}) {
  const query = new URLSearchParams({
    view: "artifact",
    workOrderId: "job-1",
    caseInstanceId: "instance-1",
    artifactId: "artifact-1",
    ...overrides,
  });
  return new Request(`https://example.test/api/trade-team/work-packs?${query}`);
}

test("assigned job members can read exact current work-pack artifact bytes", async () => {
  const bytes = new TextEncoder().encode("exact governed evidence");
  const database = fixture();
  const artifact = insertArtifact(database, bytes);
  const reads = [];
  const bucket = {
    async get(locator) {
      reads.push(locator);
      return locator === artifact.custodyLocator ? {
        httpMetadata: { contentType: artifact.contentType },
        arrayBuffer: async () => Uint8Array.from(bytes).buffer,
      } : null;
    },
  };
  const { route, calls } = loadRoute({
    database,
    bucket,
    scope: {
      ownerUid: "owner-1",
      actorUid: "worker-uid",
      actorMemberId: "worker-1",
      scope: "own",
      canViewFieldEvidence: true,
    },
  });

  const response = await route.GET(artifactRequest());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "exact governed evidence");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-creditex-sha256"), artifact.originalSha256);
  assert.deepEqual(reads, [artifact.custodyLocator]);
  assert.equal(calls.scope, 1);
  assert.equal(calls.byteResponse[0].fileName, artifact.fileName);
  assert.equal(calls.byteResponse[0].custodyReceiptId, artifact.receiptId);
});

test("cross-job, unassigned, replaced and tampered artifact reads fail closed", async () => {
  const bytes = new TextEncoder().encode("exact governed evidence");
  const database = fixture();
  const artifact = insertArtifact(database, bytes);
  const reads = [];
  const bucket = {
    async get(locator) {
      reads.push(locator);
      return {
        httpMetadata: { contentType: artifact.contentType },
        arrayBuffer: async () => new TextEncoder().encode("tampered evidence").buffer,
      };
    },
  };
  const assigned = loadRoute({
    database,
    bucket,
    scope: {
      ownerUid: "owner-1",
      actorUid: "worker-uid",
      actorMemberId: "worker-1",
      scope: "own",
      canViewFieldEvidence: true,
    },
  });

  const crossJob = await assigned.route.GET(artifactRequest({ workOrderId: "job-2" }));
  assert.equal(crossJob.status, 404);
  assert.doesNotMatch(await crossJob.text(), /private\/work-packs/);

  const unassigned = loadRoute({
    database,
    bucket,
    scope: {
      ownerUid: "owner-1",
      actorUid: "other-worker-uid",
      actorMemberId: "worker-2",
      scope: "own",
      canViewFieldEvidence: true,
    },
  });
  assert.equal((await unassigned.route.GET(artifactRequest())).status, 404);
  assert.deepEqual(reads, []);

  const tampered = await assigned.route.GET(artifactRequest());
  assert.equal(tampered.status, 409);
  assert.equal((await tampered.json()).code, "WORK_PACK_ARTIFACT_INTEGRITY_MISMATCH");

  database.prepare(`INSERT INTO compliance_activity_work_pack_artifacts
    VALUES ('artifact-2', 'creditex', 'pack-1', 'instance-1', 'private/replacement',
      'replacement.jpg', 'image/jpeg', 1, ?, 'receipt-2', 'matched', 'artifact-1')`)
    .run(sha256(new Uint8Array([1])));
  assert.equal((await assigned.route.GET(artifactRequest())).status, 404);
});

test("the Files panel exposes governed artifacts through identifiers only", () => {
  assert.match(panelSource, /view: "artifact"/);
  assert.match(panelSource, /workOrderId,/);
  assert.match(panelSource, /caseInstanceId: pack\.instance\.id/);
  assert.match(panelSource, /artifactId: artifact\.id/);
  assert.doesNotMatch(panelSource, /individual portal download is not available/);
  assert.match(routeSource, /work_order\.firebase_uid = \?/);
  assert.match(routeSource, /\? = 'team' OR work_order\.assignee_member_id = \?/);
  assert.match(routeSource, /successor\.supersedes_artifact_id = artifact\.id/);
  assert.match(routeSource, /newer\.revision > instance\.revision/);
  assert.doesNotMatch(panelSource, /object_key|custody_locator|private\/work-packs/);
});

test("work-pack artifact bytes require field-evidence permission", async () => {
  const bytes = new TextEncoder().encode("exact governed evidence");
  const database = fixture();
  insertArtifact(database, bytes);
  let reads = 0;
  const { route } = loadRoute({
    database,
    bucket: { async get() { reads += 1; return null; } },
    scope: {
      ownerUid: "owner-1",
      actorUid: "worker-uid",
      actorMemberId: "worker-1",
      scope: "own",
      canViewFieldEvidence: false,
    },
  });

  const response = await route.GET(artifactRequest());
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FIELD_EVIDENCE_ACCESS_REQUIRED");
  assert.equal(reads, 0);
});
