import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST,
  importCreditexOfficialSourceCustodyBatch,
  listCreditexOfficialSourceCustodyCandidateStatus,
  validateCreditexOfficialSourceCustodyManifest,
} from "../src/lib/creditex-official-source-batch-import-server.ts";
import {
  isAllowedOfficialAuthorityHost,
  normaliseOfficialSourceUrl,
} from "../src/lib/creditex-official-source-custody-server.ts";

const custodyMigration = fs.readFileSync(
  new URL(
    "../drizzle/0102_creditex_official_source_custody.sql",
    import.meta.url,
  ),
  "utf8",
);
const serverFetchMigration = fs.readFileSync(
  new URL(
    "../drizzle/0145_creditex_server_fetched_official_source_custody.sql",
    import.meta.url,
  ),
  "utf8",
);
const trackedManifestBytes = fs.readFileSync(
  new URL(
    "../src/data/creditex-official-source-custody-candidates-2026-08-15.json",
    import.meta.url,
  ),
);

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
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
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

class FakeR2 {
  objects = new Map();
  puts = 0;

  async put(key, value, options = {}) {
    this.puts += 1;
    this.objects.set(key, {
      bytes: new Uint8Array(value.slice(0)),
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    });
  }

  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      size: stored.bytes.byteLength,
      httpMetadata: stored.httpMetadata,
      arrayBuffer: async () => stored.bytes.slice().buffer,
    };
  }

  async head(key) {
    return this.objects.get(key) || null;
  }

  async delete(key) {
    this.objects.delete(key);
  }
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE admin_users (
      firebase_uid text PRIMARY KEY NOT NULL,
      role text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_organisations (
      id text PRIMARY KEY NOT NULL,
      organisation_code text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_users (
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      role text NOT NULL,
      status text NOT NULL
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
  `);
  database.exec(custodyMigration);
  database.exec(serverFetchMigration);
  database.exec(`
    CREATE TABLE compliance_official_source_review_decisions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      subject_type text NOT NULL,
      subject_id text NOT NULL,
      decision text NOT NULL,
      reviewed_at text NOT NULL
    );
    INSERT INTO compliance_organisations (id, organisation_code, status)
      VALUES ('org-1', 'CREDITEX-AU', 'active');
    INSERT INTO admin_users (firebase_uid, role, status)
      VALUES ('ops-owner', 'owner', 'active');
    INSERT INTO compliance_users (
      organisation_id, firebase_uid, role, status
    ) VALUES ('org-1', 'creditex-manager', 'case_manager', 'active');
  `);
  return {
    database,
    d1: testD1(database),
    bucket: new FakeR2(),
    admin: {
      uid: "ops-owner",
      organisationId: "org-1",
      role: "owner",
      actorKind: "admin",
    },
    complianceManager: {
      uid: "creditex-manager",
      organisationId: "org-1",
      role: "case_manager",
      actorKind: "compliance",
    },
  };
}

const defaultBytes = new TextEncoder().encode("code,name\n1,Exact source\n");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifest(overrides = new Map()) {
  const candidates = Array.from({ length: 167 }, (_, index) => {
    const sourceId = `source-${index.toString(16).padStart(20, "0")}`;
    const replacement = overrides.get(sourceId) || {};
    const bytes = replacement.bytes || defaultBytes;
    const officialUrl = replacement.officialUrl
      || `https://www.energy.vic.gov.au/source/${sourceId}.csv`;
    return {
      sourceId,
      programCodes: ["VEU"],
      authorityClass: "government_or_regulator",
      authorityHost: new URL(officialUrl).hostname,
      officialUrl,
      expectedFinalAuthorityHost: new URL(
        replacement.expectedFinalUrl || officialUrl,
      ).hostname,
      expectedFinalUrl: replacement.expectedFinalUrl || officialUrl,
      sourceTitle: `Official source ${index}`,
      sourceVersion: "2026.1",
      statedEffectiveDate: "2026-07-01",
      originalFileName: `${sourceId}.csv`,
      expectedContentType: "text/csv",
      expectedSizeBytes: replacement.expectedSizeBytes ?? bytes.byteLength,
      expectedSha256: replacement.expectedSha256 || sha256(bytes),
      observedOn: "2026-08-15",
      pendingIndependentCreditexReview: true,
      operationallyApproved: false,
      ...replacement.fields,
    };
  });
  return validateCreditexOfficialSourceCustodyManifest({
    contract: "creditex-official-source-custody-import/v1",
    observedOn: "2026-08-15",
    sourceAuditManifestSha256: "0".repeat(64),
    candidateCount: 167,
    authorityBoundary: "australian_government_or_regulator_https_only",
    custodyBoundary: "Exact bytes only and pending independent review.",
    candidates,
  });
}

function response(bytes = defaultBytes, init = {}) {
  return new Response(bytes, {
    status: init.status || 200,
    headers: {
      "content-type": "text/csv; charset=UTF-8",
      "content-length": String(bytes.byteLength),
      etag: '"exact-v1"',
      "last-modified": "Sat, 15 Aug 2026 00:00:00 GMT",
      ...init.headers,
    },
  });
}

function importInput(sourceIds) {
  return {
    confirmExactOfficialSourceCustodyImport: true,
    manifestContract: "creditex-official-source-custody-import/v1",
    sourceIds,
  };
}

test("tracked custody manifest contains exactly 167 metadata-only government and approved regulator candidates", () => {
  assert.equal(
    sha256(trackedManifestBytes),
    "fc7e8eb93a081e5fabd7f24fc763098655add0955608efeb9142c025ee4cedef",
  );
  assert.equal(
    CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST.sourceAuditManifestSha256,
    "56a1fd50cea659f3d7e81d413f1fd69a7aeeefe6149501aef4291c8e8a9b66a3",
  );
  assert.equal(CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST.candidateCount, 167);
  assert.equal(
    CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST.candidates.length,
    167,
  );
  assert.equal(
    new Set(
      CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST.candidates.map(
        (candidate) => candidate.sourceId,
      ),
    ).size,
    167,
  );
  assert.equal(isAllowedOfficialAuthorityHost("www.qca.org.au"), true);
  assert.equal(
    normaliseOfficialSourceUrl(
      "https://www.qca.org.au/wp-content/source.pdf",
    ).host,
    "www.qca.org.au",
  );
  const serialized = JSON.stringify(CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST);
  assert.doesNotMatch(serialized, /tmp\/|localCopies|firstPageText|rawBytes/);
  assert.equal(
    CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST.candidates.every(
      (candidate) =>
        candidate.authorityClass === "government_or_regulator"
        && candidate.pendingIndependentCreditexReview === true
        && candidate.operationallyApproved === false,
    ),
    true,
  );
});

test("0145 preserves downstream work-pack and output trigger references across the custody table rebuild", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE admin_users (
      firebase_uid text PRIMARY KEY NOT NULL,
      role text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_organisations (
      id text PRIMARY KEY NOT NULL,
      organisation_code text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_users (
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      role text NOT NULL,
      status text NOT NULL
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
  `);
  database.exec(custodyMigration);
  database.exec(`
    CREATE TABLE downstream_work_pack_source (
      id text PRIMARY KEY NOT NULL,
      source_artifact_id text NOT NULL
    );
    CREATE TABLE downstream_output_evidence (
      id text PRIMARY KEY NOT NULL,
      source_artifact_id text NOT NULL
    );
    CREATE TRIGGER downstream_work_pack_source_insert_guard
    BEFORE INSERT ON downstream_work_pack_source
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM compliance_official_source_artifacts artifact
        WHERE artifact.id = NEW.source_artifact_id
      ) THEN RAISE(ABORT, 'DOWNSTREAM_WORK_PACK_SOURCE_INVALID') END;
    END;
    CREATE TRIGGER downstream_output_evidence_insert_guard
    BEFORE INSERT ON downstream_output_evidence
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM compliance_official_source_artifacts artifact
        WHERE artifact.id = NEW.source_artifact_id
      ) THEN RAISE(ABORT, 'DOWNSTREAM_OUTPUT_SOURCE_INVALID') END;
    END;
  `);

  database.exec(serverFetchMigration);

  const downstreamTriggers = database.prepare(`
    SELECT name, sql
    FROM sqlite_schema
    WHERE type = 'trigger'
      AND name IN (
        'downstream_work_pack_source_insert_guard',
        'downstream_output_evidence_insert_guard'
      )
    ORDER BY name
  `).all();
  assert.equal(downstreamTriggers.length, 2);
  for (const trigger of downstreamTriggers) {
    assert.match(trigger.sql, /compliance_official_source_artifacts/);
    assert.doesNotMatch(trigger.sql, /compliance_official_source_artifacts_previous/);
  }

  database.exec(`
    INSERT INTO compliance_organisations (id, organisation_code, status)
      VALUES ('org-1', 'CREDITEX-AU', 'active');
    INSERT INTO admin_users (firebase_uid, role, status)
      VALUES ('ops-owner', 'owner', 'active');
    INSERT INTO compliance_official_source_artifacts (
      id, organisation_id, client_request_id, source_url, source_final_url,
      source_host, source_title, source_version, original_file_name,
      content_type, size_bytes, sha256, object_key, retrieval_method,
      asserted_retrieved_at, source_etag, source_last_modified, custody_state,
      rule_activation_enabled, captured_by_uid, captured_at
    ) VALUES (
      'artifact-1', 'org-1', 'request-1',
      'https://www.energy.vic.gov.au/source.csv',
      'https://www.energy.vic.gov.au/source.csv',
      'www.energy.vic.gov.au', 'Official source', '2026.1', 'source.csv',
      'text/csv', 1, '${"0".repeat(64)}', 'official/source.csv',
      'server_fetch', '2026-08-15T00:00:00.000Z', '', '', 'pending_review',
      0, 'ops-owner', '2026-08-15T00:00:00.000Z'
    );
    INSERT INTO downstream_work_pack_source (id, source_artifact_id)
      VALUES ('work-pack-1', 'artifact-1');
    INSERT INTO downstream_output_evidence (id, source_artifact_id)
      VALUES ('output-1', 'artifact-1');
  `);
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM downstream_work_pack_source").get().count,
    1,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM downstream_output_evidence").get().count,
    1,
  );
});

test("server fetch imports exact bytes once and leaves the source unbound and pending independent review", async () => {
  const { database, d1, bucket, admin } = fixture();
  const sourceId = "source-00000000000000000000";
  const sourceManifest = manifest();
  const result = await importCreditexOfficialSourceCustodyBatch(
    d1,
    bucket,
    admin,
    importInput([sourceId]),
    {
      manifest: sourceManifest,
      fetchImpl: async (url, init) => {
        assert.equal(url, sourceManifest.candidates[0].officialUrl);
        assert.equal(init.redirect, "manual");
        assert.equal(init.cache, "no-store");
        return response();
      },
      now: () => new Date(Date.now() - 60_000),
    },
  );

  assert.equal(result.captured, 1, JSON.stringify(result));
  assert.equal(result.failed, 0);
  assert.equal(result.automaticBindingPerformed, false);
  assert.equal(result.automaticApprovalPerformed, false);
  assert.equal(result.operationalReadinessClaimed, false);
  assert.equal(result.items[0].status, "captured_pending_independent_review");
  assert.equal(bucket.puts, 1);
  const artifact = database.prepare(
    "SELECT * FROM compliance_official_source_artifacts",
  ).get();
  assert.equal(artifact.retrieval_method, "server_fetch");
  assert.equal(artifact.source_final_url, sourceManifest.candidates[0].expectedFinalUrl);
  assert.equal(artifact.sha256, sha256(defaultBytes));
  assert.equal(artifact.size_bytes, defaultBytes.byteLength);
  assert.equal(artifact.custody_state, "pending_review");
  assert.equal(artifact.rule_activation_enabled, 0);
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_bindings",
    ).get().count,
    0,
  );
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_review_decisions",
    ).get().count,
    0,
  );
  const stored = [...bucket.objects.values()][0];
  assert.deepEqual(stored.bytes, defaultBytes);
  assert.equal(stored.customMetadata.retrievalMethod, "server_fetch");
});

test("an authorised Creditex case manager can start the same pending-only import", async () => {
  const { database, d1, bucket, complianceManager } = fixture();
  const sourceId = "source-00000000000000000000";
  const result = await importCreditexOfficialSourceCustodyBatch(
    d1,
    bucket,
    complianceManager,
    importInput([sourceId]),
    { manifest: manifest(), fetchImpl: async () => response() },
  );

  assert.equal(result.captured, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.automaticApprovalPerformed, false);
  assert.equal(result.automaticBindingPerformed, false);
  assert.equal(
    database.prepare(
      "SELECT captured_by_uid FROM compliance_official_source_artifacts",
    ).get().captured_by_uid,
    "creditex-manager",
  );
});

test("tampered bytes and size drift fail as itemized outcomes without R2 or D1 custody", async () => {
  for (const [name, fetchedBytes, expectedCode] of [
    [
      "hash",
       Uint8Array.from(defaultBytes, (byte, index) =>
         index === defaultBytes.byteLength - 2 ? byte ^ 1 : byte),
      "SOURCE_FETCH_HASH_MISMATCH",
    ],
    [
      "size",
      new TextEncoder().encode("short"),
      "SOURCE_FETCH_SIZE_MISMATCH",
    ],
  ]) {
    const { database, d1, bucket, admin } = fixture();
    const sourceId = "source-00000000000000000000";
    const sourceManifest = manifest();
    const result = await importCreditexOfficialSourceCustodyBatch(
      d1,
      bucket,
      admin,
      importInput([sourceId]),
      {
        manifest: sourceManifest,
        fetchImpl: async () => response(fetchedBytes),
      },
    );
    assert.equal(result.failed, 1, name);
    assert.equal(result.items[0].code, expectedCode, name);
    assert.equal(bucket.puts, 0, name);
    assert.equal(
      database.prepare(
        "SELECT COUNT(*) count FROM compliance_official_source_artifacts",
      ).get().count,
      0,
      name,
    );
  }
});

test("redirects cannot leave the exact approved authority hosts", async () => {
  const { database, d1, bucket, admin } = fixture();
  const sourceId = "source-00000000000000000000";
  let fetches = 0;
  const result = await importCreditexOfficialSourceCustodyBatch(
    d1,
    bucket,
    admin,
    importInput([sourceId]),
    {
      manifest: manifest(),
      fetchImpl: async () => {
        fetches += 1;
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://www.esc.vic.gov.au/redirected.csv",
          },
        });
      },
    },
  );
  assert.equal(result.failed, 1);
  assert.equal(result.items[0].code, "SOURCE_FETCH_REDIRECT_HOST_REJECTED");
  assert.equal(fetches, 1);
  assert.equal(bucket.puts, 0);
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_artifacts",
    ).get().count,
    0,
  );
});

test("partial failures retain successful items and never claim batch readiness", async () => {
  const { database, d1, bucket, admin } = fixture();
  const first = "source-00000000000000000000";
  const second = "source-00000000000000000001";
  const sourceManifest = manifest();
  const result = await importCreditexOfficialSourceCustodyBatch(
    d1,
    bucket,
    admin,
    importInput([first, second]),
    {
      manifest: sourceManifest,
      fetchImpl: async (url) => url.includes(second)
        ? response(new Uint8Array(), {
            status: 503,
            headers: { "content-length": "0" },
          })
        : response(),
    },
  );
  assert.equal(result.captured, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.items[0].status, "captured_pending_independent_review");
  assert.equal(result.items[1].status, "failed");
  assert.equal(result.items[1].code, "SOURCE_FETCH_HTTP_FAILED");
  assert.equal(result.operationalReadinessClaimed, false);
  assert.equal(bucket.puts, 1);
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_artifacts",
    ).get().count,
    1,
  );
});

test("idempotent replay verifies retained bytes without duplicate custody or approval", async () => {
  const { database, d1, bucket, admin } = fixture();
  const sourceId = "source-00000000000000000000";
  const sourceManifest = manifest();
  const options = {
    manifest: sourceManifest,
    fetchImpl: async () => response(),
  };
  await importCreditexOfficialSourceCustodyBatch(
    d1,
    bucket,
    admin,
    importInput([sourceId]),
    options,
  );
  const replay = await importCreditexOfficialSourceCustodyBatch(
    d1,
    bucket,
    admin,
    importInput([sourceId]),
    options,
  );
  assert.equal(replay.reused, 1, JSON.stringify(replay));
  assert.equal(replay.items[0].status, "reused_pending_independent_review");
  assert.equal(bucket.puts, 1);
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_artifacts",
    ).get().count,
    1,
  );
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_audit_events",
    ).get().count,
    1,
  );
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_review_decisions",
    ).get().count,
    0,
  );

  const status = await listCreditexOfficialSourceCustodyCandidateStatus(
    d1,
    "org-1",
    { pageSize: 100, manifest: sourceManifest },
  );
  assert.equal(status.total, 167);
  assert.equal(status.imported, 1);
  assert.equal(status.missing, 166);
  assert.equal(status.pendingIndependentReview, 1);
  assert.equal(status.operationallyReady, 0);
  assert.equal(
    status.items[0].status,
    "custody_pending_independent_review",
  );
});

test("batch validation is bounded and requires an explicit exact-import confirmation", async () => {
  const { d1, bucket, admin } = fixture();
  const sourceManifest = manifest();
  await assert.rejects(
    importCreditexOfficialSourceCustodyBatch(
      d1,
      bucket,
      admin,
      {
        ...importInput(["source-00000000000000000000"]),
        confirmExactOfficialSourceCustodyImport: false,
      },
      { manifest: sourceManifest, fetchImpl: async () => response() },
    ),
    (error) => error.code === "SOURCE_BATCH_CONFIRMATION_REQUIRED",
  );
  await assert.rejects(
    importCreditexOfficialSourceCustodyBatch(
      d1,
      bucket,
      admin,
      importInput(Array.from(
        { length: 9 },
        (_, index) => `source-${index.toString(16).padStart(20, "0")}`,
      )),
      { manifest: sourceManifest, fetchImpl: async () => response() },
    ),
    (error) => error.code === "SOURCE_BATCH_SIZE_INVALID",
  );
});
